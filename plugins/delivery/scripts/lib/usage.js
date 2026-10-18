// scripts/lib/usage.js — what the team has spent, from what a script can actually read (R-31 probe, R-34).
//
// The probe (phase 2): the Claude Code CLI has no usage subcommand, and hooks receive no usage
// figures. Two readings exist:
//   1. Session transcripts: every assistant message carries usage (input, cache creation, cache read,
//      output tokens) and its model. The format is undocumented, so the reader fails open and says so.
//      Streamed messages repeat one message id on several lines with the same usage: counted once.
//   2. The status line: Claude Code passes the statusLine command a JSON document whose rate_limits
//      field (subscribers only, after the first reply, while the API reports it) holds
//      seven_day.used_percentage and resets_at. Only a statusLine command sees it, so usage.js
//      statusline writes a snapshot a role session's status line can feed; nothing else reads it live.
// Tokens become cost-weighted "sonnet input equivalents" (output 5x, cache writes 1.25x, cache reads
// 0.1x, opus 1.7x, haiku 0.35x), the shape of list prices; units are those divided by unit_tokens.
const fs = require('fs');
const path = require('path');
const { withLock } = require('./lock.js');

const WEIGHT = { input: 1, cache_creation: 1.25, cache_read: 0.1, output: 5 };
const MODEL = { opus: 1.7, sonnet: 1, haiku: 0.35 };
const SNAPSHOT_MAX_AGE_MS = 6 * 3600e3;
const WEEK_MS = 7 * 24 * 3600e3;

const modelKind = (m) => (/opus/i.test(String(m || '')) ? 'opus' : /haiku/i.test(String(m || '')) ? 'haiku' : 'sonnet');
const modelWeight = (m) => MODEL[modelKind(m)];

function weighted(u, model) {
  if (!u || typeof u !== 'object') return 0;
  const n = (k) => (Number.isFinite(u[k]) ? u[k] : 0);
  return (n('input_tokens') * WEIGHT.input + n('cache_creation_input_tokens') * WEIGHT.cache_creation
    + n('cache_read_input_tokens') * WEIGHT.cache_read + n('output_tokens') * WEIGHT.output) * modelWeight(model);
}

// { hours: { 'YYYY-MM-DDTHH': weighted }, messages, unreadable } for one transcript file
function scanFile(file) {
  const out = { hours: {}, messages: 0, unreadable: 0 };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { out.unreadable = 1; return out; }
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let r;
    try { r = JSON.parse(line); } catch (err) { out.unreadable++; continue; }
    const m = r && r.type === 'assistant' && r.message;
    if (!m || !m.usage || !r.timestamp) continue;
    const key = m.id || r.requestId || r.uuid;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const hour = String(r.timestamp).slice(0, 13);
    out.hours[hour] = (out.hours[hour] || 0) + weighted(m.usage, m.model);
    out.messages++;
  }
  return out;
}

// Every transcript beside the role sessions' known ones (earlier sessions of the same role directory
// share it), and their subagents' transcripts.
function transcriptFiles(root) {
  let roster = { instances: {} };
  try { roster = require('./roster.js').readRoster(root); } catch (err) { roster = { instances: {} }; }
  const dirs = new Set(Object.values(roster.instances || {}).map((e) => e && e.transcript_path).filter((p) => typeof p === 'string' && p).map((p) => path.dirname(p)));
  const files = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { continue; }
    for (const e of names) {
      if (e.isFile() && e.name.endsWith('.jsonl')) files.push(path.join(dir, e.name));
      else if (e.isDirectory()) {
        const sub = path.join(dir, e.name, 'subagents');
        try { for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(path.join(sub, f)); } catch (err) { /* none */ }
      }
    }
  }
  return files;
}

const cacheFile = (root) => path.join(root, '.delivery', 'usage', 'transcripts.json');

// Weighted tokens since `since` across the given files (default: the team's transcripts). Each file is
// scanned again only when its size or mtime changed. { tokens, files, messages, unreadable, note? }
function tokensSince(root, since, { files } = {}) {
  const list = files || transcriptFiles(root);
  const t0 = Date.parse(since || 0) || 0;
  let cache = { files: {} };
  try { cache = JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')); } catch (err) { cache = { files: {} }; }
  if (!cache || typeof cache.files !== 'object') cache = { files: {} };
  let tokens = 0;
  let messages = 0;
  let unreadable = 0;
  let changed = false;
  for (const f of list) {
    let st;
    try { st = fs.statSync(f); } catch (err) { continue; }
    if (st.mtimeMs < t0) continue;
    let c = cache.files[f];
    if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) { c = { size: st.size, mtimeMs: st.mtimeMs, ...scanFile(f) }; cache.files[f] = c; changed = true; }
    for (const [hour, w] of Object.entries(c.hours || {})) if (Date.parse(`${hour}:59:59Z`) >= t0) tokens += w;
    messages += c.messages || 0;
    unreadable += c.unreadable || 0;
  }
  if (changed && root) {
    try {
      fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
      withLock(`${cacheFile(root)}.lock`, () => fs.writeFileSync(cacheFile(root), JSON.stringify(cache)));
    } catch (err) { /* a cache that cannot be written only costs a rescan */ }
  }
  return { tokens, files: list.length, messages, unreadable, ...(list.length ? {} : { note: 'no role transcripts are known yet (the roster records them)' }) };
}

// ---- the status line snapshot ----
const snapshotFile = (root) => path.join(root, '.delivery', 'usage', 'statusline.json');

// From the status line's JSON input: the weekly window, or null when the input has none.
function snapshotOf(input, now) {
  const w = input && input.rate_limits && input.rate_limits.seven_day;
  if (!w || !Number.isFinite(w.used_percentage) || !Number.isFinite(w.resets_at)) return null;
  return { seven_day: { used_percentage: w.used_percentage, resets_at: w.resets_at }, at: now || new Date().toISOString() };
}

function writeSnapshot(root, snap) {
  if (!root || !snap) return false;
  fs.mkdirSync(path.dirname(snapshotFile(root)), { recursive: true });
  const tmp = `${snapshotFile(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap));
  fs.renameSync(tmp, snapshotFile(root));
  return true;
}

// The weekly reading while it is fresh and its window has not reset; else null.
function readSnapshot(root, now) {
  let s;
  try { s = JSON.parse(fs.readFileSync(snapshotFile(root), 'utf8')); } catch (err) { return null; }
  const t = Date.parse(now || new Date().toISOString());
  const w = s && s.seven_day;
  if (!w || !Number.isFinite(w.used_percentage) || !Number.isFinite(w.resets_at)) return null;
  if (t - Date.parse(s.at) > SNAPSHOT_MAX_AGE_MS || w.resets_at * 1000 <= t) return null;
  return { usedPct: w.used_percentage, resetsAt: new Date(w.resets_at * 1000).toISOString(), periodStart: new Date(w.resets_at * 1000 - WEEK_MS).toISOString(), at: s.at };
}

module.exports = { weighted, scanFile, transcriptFiles, tokensSince, snapshotOf, writeSnapshot, readSnapshot, modelKind, WEIGHT, MODEL, WEEK_MS };
