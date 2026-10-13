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
  if (idx && idx.last_id === lastId && idx.map && typeof idx.map === 'object') {
    return { file, last_id: lastId, map: new Map(Object.entries(idx.map)), dirty: false };
  }
  const map = new Map();
  for (const f of files) {
    for (const e of readEntries(path.join(hostDir(root, host), f))) { const k = dedupeKey(e); if (k) map.set(k, e.id); }
  }
  return { file, last_id: lastId, map, dirty: true };
}

// Local-only record of how long each host chain was and its last hash, so a deleted tail
// is detectable (a pure hash chain cannot see its own truncation).
function headsFile(root) { return path.join(opDir(root), 'cursors', 'heads.json'); }
function readHeads(root) { return readJson(headsFile(root)) || {}; }
function setHead(root, host, head) {
  const heads = readHeads(root);
  heads[host] = head;
  writeJsonAtomic(headsFile(root), heads);
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
  let read = transcript.readHumanInputs(transcriptPath, { fromLine: cursor.line, fromOffset: cursor.offset || 0 });
  let base = { total_user_records: cursor.total_user_records || 0, with_origin: cursor.with_origin || 0 };
  if (read.rescanned || read.lastLine < cursor.line) { // rewritten: rescan (dedupe protects)
    if (!read.rescanned) read = transcript.readHumanInputs(transcriptPath, { fromLine: 0 });
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
      if (idx.map.has(key)) continue;
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
          session_id: inp.session_id || sessionId || null,
          instance: instance || null,
          role: role || null,
          source: inp.source,
          text: t.text,
          text_sha256: sha256(full),
          ext_id: extId,
          uuid: inp.uuid || null,
          transcript_ref: { file: path.basename(transcriptPath), line: inp.line },
        };
        if (t.truncated) e.truncated = true;
        return e;
      }, { alreadyLocked: true, prevFile });
      idx.map.set(key, stored.id);
      idx.last_id = stored.id;
      added++;
    }
    if (added) {
      const h = verifyHostRaw(projectRoot, host);
      if (h.ok) setHead(projectRoot, host, { count: h.count, last_hash: h.last_hash });
    }
    if (added || idx.dirty) writeJsonAtomic(idx.file, { last_id: idx.last_id, map: Object.fromEntries(idx.map) });
    // cursor advances only after the entries are on disk
    cursor = {
      line: read.lastLine,
      offset: read.lastOffset,
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

// Chain, sequence and text checks for one host, without consulting heads.
function verifyHostRaw(projectRoot, host) {
  let prev = '0';
  let count = 0;
  let lastSeq = 0;
  const hashes = [];
  for (const f of monthFiles(projectRoot, host)) {
    const file = path.join(hostDir(projectRoot, host), f);
    const v = chain.verifyChain(file, { prev });
    if (!v.ok) return { ok: false, count: count + v.count, host, file, at: v.at, error: `host ${host} ${f}: ${v.error}` };
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const e = JSON.parse(lines[i]);
      hashes.push(e.hash);
      const p = parseId(e.id);
      if (!p || p.host !== host || p.seq !== lastSeq + 1) {
        return { ok: false, count, host, file, at: i + 1, error: `host ${host} ${f} line ${i + 1}: unexpected id ${e.id} after seq ${lastSeq}` };
      }
      lastSeq = p.seq;
      if (typeof e.text === 'string' && !e.truncated && sha256(e.text) !== e.text_sha256) {
        return { ok: false, count, host, file, at: i + 1, error: `host ${host} ${f} line ${i + 1}: text does not match text_sha256 for ${e.id}` };
      }
    }
    prev = v.last_hash;
    count += v.count;
  }
  return { ok: true, count, host, last_hash: prev, hashes };
}

function verifyHost(projectRoot, host) {
  const v = verifyHostRaw(projectRoot, host);
  if (!v.ok) return v;
  const head = readHeads(projectRoot)[host];
  if (head) {
    if (v.count < head.count) {
      return { ok: false, count: v.count, host, error: `host ${host}: truncated, ${v.count} entries but ${head.count} were recorded` };
    }
    if (head.count > 0 && v.hashes[head.count - 1] !== head.last_hash) {
      return { ok: false, count: v.count, host, error: `host ${host}: history rewritten, entry ${head.count} no longer matches the recorded head` };
    }
  }
  if (!head || v.count > head.count) setHead(projectRoot, host, { count: v.count, last_hash: v.last_hash });
  return { ok: true, count: v.count, host, last_hash: v.last_hash };
}

function verifyInputs(projectRoot, opts = {}) {
  if (opts.host) return verifyHost(projectRoot, safeHost(opts.host));
  let count = 0;
  const heads = {};
  for (const host of listHosts(projectRoot)) {
    const v = verifyHost(projectRoot, host);
    if (!v.ok) return { ...v, count: count + v.count, heads };
    count += v.count;
    heads[host] = { count: v.count, last_hash: v.last_hash };
  }
  return { ok: true, count, heads };
}

// ---- publish / refresh (best effort, never throw) ----

function git(cwd, args) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const OP_PATH = '.delivery/operator';

function upstreamOf(root) {
  const r = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!r.ok || !r.out.includes('/')) return null;
  const i = r.out.indexOf('/');
  return { ref: r.out, remote: r.out.slice(0, i), branch: r.out.slice(i + 1) };
}

// Bring other writers' operator files from the upstream into the working tree, path by path.
// Never touches anything outside .delivery/operator and never overwrites this host's or this
// instance's own chain files. opts: { host, instance, fetch = true }.
function refresh(projectRoot, opts = {}) {
  try {
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return { ok: false, reason: 'not a git repository' };
    const up = upstreamOf(projectRoot);
    if (!up) return { ok: false, reason: 'no upstream' };
    if (opts.fetch !== false) {
      const f = git(projectRoot, ['fetch', up.remote]);
      if (!f.ok) return { ok: false, reason: f.err || 'fetch failed' };
    }
    const diff = git(projectRoot, ['diff', '--name-only', 'HEAD', '@{u}', '--', OP_PATH]);
    const own = [];
    if (opts.host) own.push(`${OP_PATH}/inputs/${safeHost(opts.host)}/`);
    const ownFiles = opts.instance ? [`${OP_PATH}/records/${opts.instance}.ndjson`] : [];
    const updated = [];
    for (const p of diff.out ? diff.out.split('\n') : []) {
      if (own.some((o) => p.startsWith(o)) || ownFiles.includes(p)) continue;
      // chains are append-only: take the upstream copy only when the local file is missing or a
      // prefix of it, so a newer local file (this writer's own, unpublished) is never replaced
      const abs = path.join(projectRoot, p);
      if (fs.existsSync(abs)) {
        const show = cp.spawnSync('git', ['show', `@{u}:${p}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        if (show.status !== 0) continue;
        let local = '';
        try { local = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
        if (!show.stdout.startsWith(local) || show.stdout === local) continue;
      }
      const c = git(projectRoot, ['checkout', '@{u}', '--', p]);
      if (c.ok) { updated.push(p); git(projectRoot, ['reset', '-q', 'HEAD', '--', p]); }
    }
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

// Commit and push only .delivery/operator. Never touches other work: path-scoped add and
// commit, refuses to push when unpushed commits touch anything else, no autostash or rebase.
// opts: { force, host, instance }.
function publish(projectRoot, opts = {}) {
  const no = (reason, extra = {}) => ({ ok: false, published: false, reason, ...extra });
  try {
    const stamp = path.join(opDir(projectRoot), 'cursors', 'last-publish.json');
    if (!opts.force) {
      const last = readJson(stamp);
      if (last && Date.now() - last.at < PUBLISH_THROTTLE_MS) return no('throttled');
    }
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return no('not a git repository');
    try { writeJsonAtomic(stamp, { at: Date.now() }); } catch (e) { /* ignore */ }
    ensureGitignore(projectRoot);
    const add = git(projectRoot, ['add', '--', OP_PATH]);
    if (!add.ok) return no(add.err);
    const staged = git(projectRoot, ['diff', '--cached', '--numstat', '--', OP_PATH]);
    const lines = staged.out ? staged.out.split('\n') : [];
    const n = lines.reduce((s, l) => s + (Number(l.split('\t')[0]) || 0), 0);
    if (lines.length) {
      const c = git(projectRoot, ['commit', '--only', '--no-verify', '--no-gpg-sign', '-m', `operator: ${n} entries`, '--', OP_PATH]);
      if (!c.ok) return no(c.err || c.out);
    }
    const up = upstreamOf(projectRoot);
    if (!up) return no('no upstream', { committed: lines.length > 0 });

    const unrelated = () => {
      const d = git(projectRoot, ['diff', '--name-only', '@{u}...HEAD']);
      return d.out.split('\n').filter((p) => p && !p.startsWith(OP_PATH + '/'));
    };
    if (unrelated().length) return no('unpushed unrelated commits', { paths: unrelated() });

    const push = () => git(projectRoot, ['push', up.remote, `HEAD:${up.branch}`]);
    let r = push();
    if (!r.ok) {
      // rejected: fetch, merge the upstream (path-scoped work was verified above) and retry once
      const f = git(projectRoot, ['fetch', up.remote]);
      if (!f.ok) return no(f.err || 'fetch failed');
      if (unrelated().length) return no('unpushed unrelated commits', { paths: unrelated() });
      const m = git(projectRoot, ['merge', '--no-edit', '--no-verify', '--no-gpg-sign', '@{u}']);
      if (!m.ok) { git(projectRoot, ['merge', '--abort']); return no(m.err || m.out || 'merge failed'); }
      r = push();
    }
    return r.ok ? { ok: true, published: true, entries: n } : no(r.err);
  } catch (e) {
    return no(String(e && e.message || e));
  }
}

module.exports = { syncTranscript, getInput, listInputs, verifyInputs, publish, refresh, safeHost, parseId, listHosts };
