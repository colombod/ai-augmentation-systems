// scripts/lib/operator-log.js — the operator inputs log.
// One hash chain per host: .delivery/operator/inputs/<host>/<YYYY-MM>.ndjson, single writer per file
// so git never merges a chain. Ids embed the host: in-<host>-<6-digit seq>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const chain = require('./chain.js');
const transcript = require('./transcript.js');

const MAX_TEXT_BYTES = 65536;
const PUBLISH_THROTTLE_MS = 30 * 1000;
const OP_REL = path.join('.delivery', 'operator');

const opDir = (root) => path.join(root, OP_REL);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeHost(host) {
  const h = String(host || os.hostname() || 'local').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[-.]+/, '');
  return h || 'local';
}
function hostDir(root, host) { return path.join(opDir(root), 'inputs', host); }
function monthFiles(root, host) {
  const d = hostDir(root, host);
  try { return fs.readdirSync(d).filter((f) => /^\d{4}-\d{2}\.ndjson$/.test(f)).sort(); } catch (e) { return []; }
}
function listHosts(root) {
  try {
    return fs.readdirSync(path.join(opDir(root), 'inputs'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) { return []; }
}
function parseId(id) {
  const m = /^in-(.+)-(\d{6,})$/.exec(String(id || ''));
  return m ? { host: m[1], seq: Number(m[2]) } : null;
}
function pad(n) { return String(n).padStart(6, '0'); }

function readEntries(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch (e) { /* verifyInputs reports it */ }
  }
  return out;
}

function ensureGitignore(root) {
  const f = path.join(opDir(root), '.gitignore');
  if (fs.existsSync(f)) return;
  fs.mkdirSync(opDir(root), { recursive: true });
  try { fs.writeFileSync(f, 'cursors/\n*.lock\n', { flag: 'wx' }); } catch (e) { /* raced */ }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function truncateText(text) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= MAX_TEXT_BYTES) return { text, truncated: false };
  const cut = buf.subarray(0, MAX_TEXT_BYTES).toString('utf8').replace(/�+$/, '');
  return { text: cut, truncated: true };
}

// ext_id -> input id for one host, local-only, rebuilt from the log when missing or stale.
// Human inputs dedupe by ext_id (promptId or delivery_id). Records of other sources can share a
// promptId within one turn (observed on real transcripts), so they dedupe by record uuid.
function dedupeKey(e) {
  return e.source === 'human' ? e.ext_id : (e.uuid || e.ext_id);
}

function loadIndex(root, host) {
  const file = path.join(opDir(root), 'cursors', `inputs-index-${host}.json`);
  const files = monthFiles(root, host);
  let lastId = null;
  if (files.length) {
    const last = chain.lastEntryOf(path.join(hostDir(root, host), files[files.length - 1]));
    lastId = last ? last.id : null;
  }
  const idx = readJson(file);
  if (idx && idx.last_id === lastId && idx.map && typeof idx.map === 'object') return { file, last_id: lastId, map: idx.map, dirty: false };
  const map = {};
  for (const f of files) {
    for (const e of readEntries(path.join(hostDir(root, host), f))) { const k = dedupeKey(e); if (k) map[k] = e.id; }
  }
  return { file, last_id: lastId, map, dirty: true };
}

function syncTranscript(opts) {
  const { projectRoot, transcriptPath, sessionId, instance, role } = opts;
  const host = safeHost(opts.host);
  const now = opts.now ? new Date(opts.now) : new Date();
  ensureGitignore(projectRoot);

  const cursorFile = path.join(opDir(projectRoot), 'cursors', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  let cursor = readJson(cursorFile) || { line: 0, transcript: transcriptPath, total_user_records: 0, with_origin: 0 };
  if (cursor.transcript !== transcriptPath) {
    cursor = { line: 0, transcript: transcriptPath, total_user_records: 0, with_origin: 0 };
  }
  let read = transcript.readHumanInputs(transcriptPath, { fromLine: cursor.line });
  let base = { total_user_records: cursor.total_user_records || 0, with_origin: cursor.with_origin || 0 };
  if (read.lastLine < cursor.line) { // transcript shrank: it was rewritten, rescan (ext_id dedupe protects)
    read = transcript.readHumanInputs(transcriptPath, { fromLine: 0 });
    base = { total_user_records: 0, with_origin: 0 };
  }

  const monthName = `${now.toISOString().slice(0, 7)}.ndjson`;
  const dir = hostDir(projectRoot, host);
  const lockFile = path.join(dir, '.host.lock');
  let added = 0;

  chain.withLock(lockFile, () => {
    const idx = loadIndex(projectRoot, host);
    for (const inp of read.inputs) {
      if (inp.source === 'system') continue;
      const extId = inp.ext_id || `${sessionId}:${inp.line}`;
      const key = dedupeKey({ source: inp.source, ext_id: extId, uuid: inp.uuid });
      if (idx.map[key]) continue;
      const files = monthFiles(projectRoot, host);
      const latest = files.length ? files[files.length - 1] : null;
      // never write into an older month than the newest existing file: keep one linear chain
      const target = latest && latest > monthName ? latest : monthName;
      const prevFile = latest && latest !== target ? path.join(dir, latest) : null;
      const full = inp.text;
      const t = truncateText(full);
      const stored = chain.appendEntry(path.join(dir, target), (last) => {
        const seq = last ? (parseId(last.id) || { seq: 0 }).seq + 1 : 1;
        const e = {
          id: `in-${host}-${pad(seq)}`,
          host,
          ts: inp.timestamp || now.toISOString(),
          captured_at: now.toISOString(),
          session_id: sessionId || inp.session_id || null,
          instance: instance || null,
          role: role || null,
          source: inp.source,
          text: t.text,
          text_sha256: sha256(full),
          ext_id: extId,
          uuid: inp.uuid || null,
          transcript_ref: { file: transcriptPath, line: inp.line },
        };
        if (t.truncated) e.truncated = true;
        return e;
      }, { alreadyLocked: true, prevFile });
      idx.map[key] = stored.id;
      idx.last_id = stored.id;
      added++;
    }
    if (added || idx.dirty) writeJsonAtomic(idx.file, { last_id: idx.last_id, map: idx.map });
    // cursor advances only after the entries are on disk
    cursor = {
      line: read.lastLine,
      transcript: transcriptPath,
      total_user_records: base.total_user_records + read.total_user_records,
      with_origin: base.with_origin + read.with_origin,
    };
    writeJsonAtomic(cursorFile, cursor);
  });

  return { added, status: transcript.formatStatus(cursor) };
}

function getInput(projectRoot, id) {
  const p = parseId(id);
  if (!p) return null;
  const host = safeHost(p.host);
  for (const f of monthFiles(projectRoot, host)) {
    for (const e of readEntries(path.join(hostDir(projectRoot, host), f))) if (e.id === id) return e;
  }
  return null;
}

function listInputs(projectRoot, opts = {}) {
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  const out = [];
  for (const host of listHosts(projectRoot)) {
    for (const f of monthFiles(projectRoot, host)) {
      for (const e of readEntries(path.join(hostDir(projectRoot, host), f))) {
        if (opts.source && e.source !== opts.source) continue;
        if (opts.sessionId && e.session_id !== opts.sessionId) continue;
        if (sinceMs !== null && !(Date.parse(e.ts) >= sinceMs)) continue;
        out.push(e);
      }
    }
  }
  out.sort((a, b) => (Date.parse(a.captured_at) - Date.parse(b.captured_at)) || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
    ((parseId(a.id) || {}).seq - (parseId(b.id) || {}).seq));
  return out;
}

function verifyHost(projectRoot, host) {
  let prev = '0';
  let count = 0;
  let lastSeq = 0;
  for (const f of monthFiles(projectRoot, host)) {
    const file = path.join(hostDir(projectRoot, host), f);
    const v = chain.verifyChain(file, { prev });
    if (!v.ok) return { ok: false, count: count + v.count, host, file, at: v.at, error: `host ${host} ${f}: ${v.error}` };
    for (const [i, e] of readEntries(file).entries()) {
      const p = parseId(e.id);
      if (!p || p.host !== host || p.seq !== lastSeq + 1) {
        return { ok: false, count, host, file, at: i + 1, error: `host ${host} ${f}: unexpected id ${e.id} after seq ${lastSeq}` };
      }
      lastSeq = p.seq;
      if (typeof e.text === 'string' && !e.truncated && sha256(e.text) !== e.text_sha256) {
        return { ok: false, count, host, file, at: i + 1, error: `host ${host} ${f}: text does not match text_sha256 for ${e.id}` };
      }
    }
    prev = v.last_hash;
    count += v.count;
  }
  return { ok: true, count, host };
}

function verifyInputs(projectRoot, opts = {}) {
  if (opts.host) return verifyHost(projectRoot, safeHost(opts.host));
  let count = 0;
  for (const host of listHosts(projectRoot)) {
    const v = verifyHost(projectRoot, host);
    if (!v.ok) return { ...v, count: count + v.count };
    count += v.count;
  }
  return { ok: true, count };
}

// ---- publish / refresh (best effort, never throw) ----

function git(cwd, args) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function publish(projectRoot, opts = {}) {
  try {
    const stamp = path.join(opDir(projectRoot), 'cursors', 'last-publish.json');
    if (!opts.force) {
      const last = readJson(stamp);
      if (last && Date.now() - last.at < PUBLISH_THROTTLE_MS) return { published: false, reason: 'throttled' };
    }
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return { published: false, reason: 'not a git repository' };
    try { writeJsonAtomic(stamp, { at: Date.now() }); } catch (e) { /* ignore */ }
    ensureGitignore(projectRoot);
    const add = git(projectRoot, ['add', '--', '.delivery/operator']);
    if (!add.ok) return { published: false, reason: add.err };
    const staged = git(projectRoot, ['diff', '--cached', '--numstat', '--', '.delivery/operator']);
    const lines = staged.out ? staged.out.split('\n') : [];
    const n = lines.reduce((s, l) => s + (Number(l.split('\t')[0]) || 0), 0);
    if (lines.length) {
      const c = git(projectRoot, ['commit', '-m', `operator: ${n} entries`, '--', '.delivery/operator']);
      if (!c.ok) return { published: false, reason: c.err || c.out };
    }
    const hasUpstream = git(projectRoot, ['rev-parse', '--abbrev-ref', '@{u}']).ok;
    if (!hasUpstream && !git(projectRoot, ['remote']).out) return { published: false, reason: 'no remote', committed: lines.length > 0 };
    const push = () => (hasUpstream ? git(projectRoot, ['push']) : git(projectRoot, ['push', '-u', 'origin', 'HEAD']));
    let r = push();
    if (!r.ok) {
      const pull = git(projectRoot, ['pull', '--rebase', '--autostash']);
      if (!pull.ok) { git(projectRoot, ['rebase', '--abort']); return { published: false, reason: pull.err || 'pull failed' }; }
      r = push();
    }
    return r.ok ? { published: true, entries: n } : { published: false, reason: r.err };
  } catch (e) {
    return { published: false, reason: String(e && e.message || e) };
  }
}

function refresh(projectRoot) {
  try {
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return { ok: false, reason: 'not a git repository' };
    if (!git(projectRoot, ['remote']).out) return { ok: false, reason: 'no remote' };
    const clean = git(projectRoot, ['status', '--porcelain']).out === '';
    if (clean) {
      const ff = git(projectRoot, ['pull', '--ff-only']);
      if (ff.ok) return { ok: true, mode: 'ff' };
    }
    const r = git(projectRoot, ['pull', '--rebase', '--autostash']);
    if (!r.ok) { git(projectRoot, ['rebase', '--abort']); return { ok: false, reason: r.err }; }
    return { ok: true, mode: 'rebase' };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

module.exports = { syncTranscript, getInput, listInputs, verifyInputs, publish, refresh, safeHost, parseId, listHosts };
