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

// One transcript file, read in chunks from `from.offset` (transcripts only grow), never whole: a file
// of any size is counted, and a scan cut short by the deadline resumes where it stopped. Each message
// is [epoch seconds, weighted] at its first line's time; a streamed message repeats its id on several
// lines whose output_tokens grow, so the largest reading per id counts (PR 54 review I-3). Lines of
// one message are contiguous, so only the last id needs carrying across a resume.
// Returns { offset, msgs, tailId, unreadable, done }.
function scanFile(file, { from = null, deadline = Infinity, chunk = 1 << 20 } = {}) {
  const st = from && Array.isArray(from.msgs) ? { offset: from.offset || 0, msgs: from.msgs.map((m) => [...m]), tailId: from.tailId || null, unreadable: from.unreadable || 0 } : { offset: 0, msgs: [], tailId: null, unreadable: 0 };
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (err) { return { ...st, unreadable: st.unreadable + 1, done: true }; }
  const ids = new Map(st.tailId && st.msgs.length ? [[st.tailId, st.msgs.length - 1]] : []);
  const take = (line) => {
    if (!line.includes('"usage"')) return null;
    let r;
    try { r = JSON.parse(line); } catch (err) { return 'torn'; }
    const m = r && r.type === 'assistant' && r.message;
    if (!m || !m.usage || !r.timestamp) return null;
    const w = weighted(m.usage, m.model);
    const key = m.id || r.requestId || r.uuid || null;
    if (key && ids.has(key)) { const e = st.msgs[ids.get(key)]; e[1] = Math.max(e[1], w); return null; }
    st.msgs.push([Math.floor(Date.parse(r.timestamp) / 1000), w]);
    if (key) { ids.set(key, st.msgs.length - 1); st.tailId = key; }
    return null;
  };
  const buf = Buffer.alloc(chunk);
  let carry = Buffer.alloc(0);
  let pos = st.offset;
  let done = true;
  try {
    for (;;) {
      if (Date.now() > deadline) { done = false; break; }
      const n = fs.readSync(fd, buf, 0, chunk, pos);
      if (n <= 0) break;
      pos += n;
      let data = Buffer.concat([carry, buf.subarray(0, n)]);
      let nl;
      while ((nl = data.indexOf(10)) >= 0) {
        const line = data.subarray(0, nl).toString('utf8');
        data = data.subarray(nl + 1);
        st.offset += nl + 1;
        if (take(line) === 'torn') st.unreadable++;
      }
      // a partial last line is read again next time, from the offset of its start
      carry = Buffer.from(data);
    }
    // a whole last line with no newline yet counts now and is read again next time (its id dedups it)
    if (done && carry.length) take(carry.toString('utf8'));
  } finally { fs.closeSync(fd); }
  return { ...st, done };
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
const CACHE_VERSION = 2;

function saveCache(root, cache) {
  if (!root) return;
  try {
    fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
    const tmp = `${cacheFile(root)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, cacheFile(root));
  } catch (err) { /* a cache that cannot be written only costs a rescan */ }
}

// Weighted tokens of messages at or after `since` across the given files (default: the team's
// transcripts). Each file resumes from its cached offset when it only grew, and is rescanned when it
// shrank or was replaced. With a deadline (the hooks pass theirs), the scan stops in time, keeps what
// it read, and says the figure is partial; the cache is saved as it goes.
// { tokens, files, messages, unreadable, partial, note? }
function tokensSince(root, since, { files, deadline = Infinity, chunk } = {}) {
  const list = files || transcriptFiles(root);
  const t0 = (Date.parse(since || 0) || 0) / 1000;
  let cache = { v: CACHE_VERSION, files: {} };
  try { cache = JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')); } catch (err) { cache = { v: CACHE_VERSION, files: {} }; }
  if (!cache || cache.v !== CACHE_VERSION || typeof cache.files !== 'object') cache = { v: CACHE_VERSION, files: {} };
  let tokens = 0;
  let messages = 0;
  let unreadable = 0;
  let partial = false;
  let lastSave = Date.now();
  let dirty = false;
  for (const f of list) {
    let st;
    try { st = fs.statSync(f); } catch (err) { continue; }
    let c = cache.files[f];
    const grew = c && st.size >= c.offset && st.mtimeMs >= c.mtimeMs;
    if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs || !c.done) {
      if (Date.now() > deadline) partial = true;
      else {
        const r = scanFile(f, { from: grew ? c : null, deadline, chunk });
        c = { size: st.size, mtimeMs: st.mtimeMs, ...r };
        cache.files[f] = c;
        dirty = true;
        if (!r.done) partial = true;
        if (Date.now() - lastSave > 300) { saveCache(root, cache); lastSave = Date.now(); dirty = false; }
      }
    }
    if (!c) continue;
    for (const [t, w] of c.msgs || []) if (t >= t0) { tokens += w; messages++; }
    unreadable += c.unreadable || 0;
  }
  if (dirty) saveCache(root, cache);
  const notes = [];
  if (!list.length) notes.push('no role transcripts are known yet (the roster records them)');
  if (partial) notes.push('partial: the scan ran out of time; the rest is read on the next check');
  return { tokens, files: list.length, messages, unreadable, partial, ...(notes.length ? { note: notes.join('; ') } : {}) };
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
