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
  const want = ['cursors/', '*.lock', '*.lock.stale-*', '*.stale-*'];
  fs.mkdirSync(opDir(root), { recursive: true });
  let have = '';
  try { have = fs.readFileSync(f, 'utf8'); } catch (e) { /* new */ }
  const missing = want.filter((l) => !have.split('\n').includes(l));
  if (!missing.length) return;
  try { fs.writeFileSync(f, have + (have && !have.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n'); } catch (e) { /* raced */ }
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

// sha256 of the (up to 4096) bytes just before `offset`: detects a transcript rewritten larger.
function tailHash(file, offset) {
  try {
    const buf = fs.readFileSync(file);
    if (offset > buf.length) return null;
    return sha256(buf.subarray(Math.max(0, offset - 4096), offset));
  } catch (e) { return null; }
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
// When this session became the role: the first time a capture hook saw this session id in the role
// directory (SessionStart always runs first in a role session, so earlier transcript lines are
// prompts from before the session was a role). <roleDir>/.delivery-role-since.json holds
// { sessions: { <session id>: <ISO time> } }: one entry per session, never overwritten, updated
// atomically under a lock, the oldest pruned beyond ROLE_SINCE_KEEP. roleBoundary returns
// { since, created } (created: this call wrote it); create:false only reads.
const ROLE_SINCE_KEEP = 32;
function roleBoundary(roleDir, sessionId, { now, create = true } = {}) {
  if (!roleDir || !sessionId) return { since: null, created: false };
  const f = path.join(roleDir, '.delivery-role-since.json');
  const valid = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t));
  const read = () => {
    const cur = readJson(f);
    if (cur && plainObject(cur.sessions)) return { ...cur.sessions };
    // the first version kept one { session_id, since }
    if (cur && typeof cur.session_id === 'string' && valid(cur.since)) return { [cur.session_id]: cur.since };
    return {};
  };
  const have = read()[sessionId];
  if (valid(have)) return { since: have, created: false };
  if (!create) return { since: null, created: false };
  try {
    return chain.withLock(f + '.lock', () => {
      const sessions = read();
      if (valid(sessions[sessionId])) return { since: sessions[sessionId], created: false };
      const since = new Date(now || Date.now()).toISOString();
      sessions[sessionId] = since;
      const keep = Object.entries(sessions).filter(([, t]) => valid(t)).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, ROLE_SINCE_KEEP);
      writeJsonAtomic(f, { sessions: Object.fromEntries(keep) });
      return { since, created: true };
    });
  } catch (e) { return { since: null, created: false }; }
}
function roleSince(roleDir, sessionId, opts = {}) { return roleBoundary(roleDir, sessionId, opts).since; }

function headsFile(root) { return path.join(opDir(root), 'cursors', 'heads.json'); }
const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function readHeads(root) { const h = readJson(headsFile(root)); return plainObject(h) ? h : {}; }
// null, or why heads.json cannot be used. A broken heads file would silently switch truncation checks
// off, so it is reported as a problem and never overwritten (the bad file stays as evidence).
function headsProblem(root) {
  let raw;
  try { raw = fs.readFileSync(headsFile(root), 'utf8'); } catch (e) { return null; }
  let h;
  try { h = JSON.parse(raw); } catch (e) { return 'is not valid JSON'; }
  if (!plainObject(h)) return 'is not a JSON object';
  for (const [k, v] of Object.entries(h)) {
    if (!plainObject(v) || !Number.isInteger(v.count) || v.count < 0) return `entry ${k} has no non-negative integer count`;
  }
  return null;
}
function setHead(root, host, head) {
  chain.withLock(headsFile(root) + '.lock', () => {
    if (headsProblem(root)) return;
    const heads = readHeads(root);
    // callers check before taking the lock; re-check under it so a stale reader cannot lower a head
    // another writer raised meanwhile (that would hide a later truncation): the highest verified head
    // stays, and a different hash at the same count is a conflict, not an update
    const cur = heads[host];
    if (cur && (head.count < cur.count || (head.count === cur.count && head.last_hash !== cur.last_hash))) return;
    heads[host] = head;
    writeJsonAtomic(headsFile(root), heads);
  });
}

function dropHead(root, key) {
  chain.withLock(headsFile(root) + '.lock', () => {
    if (headsProblem(root)) return;
    const heads = readHeads(root);
    if (!(key in heads)) return;
    delete heads[key];
    writeJsonAtomic(headsFile(root), heads);
  });
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
  let rewritten = false;
  if (cursor.offset && cursor.tail_sha256 && tailHash(transcriptPath, cursor.offset) !== cursor.tail_sha256) {
    rewritten = true; // bytes before the stored offset changed: rescan from the top (dedupe is safe)
  }
  let read = transcript.readHumanInputs(transcriptPath, rewritten
    ? { fromLine: 0 } : { fromLine: cursor.line, fromOffset: cursor.offset || 0 });
  let base = rewritten ? { total_user_records: 0, with_origin: 0 }
    : { total_user_records: cursor.total_user_records || 0, with_origin: cursor.with_origin || 0 };
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
        // a prompt typed before this session became the role (a resumed or adopted session): kept
        // and citable, never pending (see roleSince)
        if (opts.roleSince && Date.parse(e.ts) < Date.parse(opts.roleSince)) e.pre_role = true;
        return e;
      }, { alreadyLocked: true, prevFile });
      idx.map.set(key, stored.id);
      idx.last_id = stored.id;
      added++;
    }
    if (added) {
      // a head only ever advances: a log that was truncated stays flagged by verify
      const h = verifyHostRaw(projectRoot, host);
      const cur = readHeads(projectRoot)[host];
      if (h.ok && (!cur || (h.count >= cur.count && (cur.count === 0 || h.hashes[cur.count - 1] === cur.last_hash)))) {
        setHead(projectRoot, host, { count: h.count, last_hash: h.last_hash });
      }
    }
    if (added || idx.dirty) writeJsonAtomic(idx.file, { last_id: idx.last_id, map: Object.fromEntries(idx.map) });
    // cursor advances only after the entries are on disk
    cursor = {
      line: read.lastLine,
      offset: read.lastOffset,
      tail_sha256: tailHash(transcriptPath, read.lastOffset),
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
  const state = head ? 'recorded' : 'absent';
  if (head) {
    if (v.count < head.count) {
      return { ok: false, count: v.count, host, heads: state, error: `host ${host}: truncated, ${v.count} entries but ${head.count} were recorded` };
    }
    if (head.count > 0 && v.hashes[head.count - 1] !== head.last_hash) {
      return { ok: false, count: v.count, host, heads: state, error: `host ${host}: history rewritten, entry ${head.count} no longer matches the recorded head` };
    }
  }
  if (!head || v.count > head.count) setHead(projectRoot, host, { count: v.count, last_hash: v.last_hash });
  return { ok: true, count: v.count, host, last_hash: v.last_hash, heads: state };
}

function verifyInputs(projectRoot, opts = {}) {
  if (opts.host) return verifyHost(projectRoot, safeHost(opts.host));
  let count = 0;
  const hostHeads = {};
  let state = 'recorded';
  for (const host of listHosts(projectRoot)) {
    const v = verifyHost(projectRoot, host);
    if (v.heads === 'absent') state = 'absent';
    if (!v.ok) return { ...v, count: count + v.count, host_heads: hostHeads };
    count += v.count;
    hostHeads[host] = { count: v.count, last_hash: v.last_hash };
  }
  return { ok: true, count, heads: state, host_heads: hostHeads };
}

// ---- publish / refresh (best effort, never throw) ----

// Output keeps its leading whitespace: porcelain status lines start with a status column that may be
// a space (' M path'), and trimming it shifts every column after it.
function git(cwd, args, o = {}) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024, env: o.env ? { ...process.env, ...o.env } : process.env, input: o.input });
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || '').trim() };
}

// git status entries under rels, parsed from -z output: [{ code: 'XY', path }].
function porcelain(root, rels) {
  const r = cp.spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...rels], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return [];
  const parts = (r.stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    out.push({ code, path: e.slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i++; // the rename source follows
  }
  return out;
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
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return { ok: false, reason: 'not a git repository', no_remote: true };
    const up = upstreamOf(projectRoot);
    if (!up) return { ok: false, reason: 'no upstream', no_remote: true };
    if (opts.fetch !== false) {
      const f = git(projectRoot, ['fetch', up.remote]);
      if (!f.ok) return { ok: false, reason: f.err || 'fetch failed', remote: up.remote };
    }
    const diff = git(projectRoot, ['diff', '--name-only', 'HEAD', '@{u}', '--', OP_PATH]);
    const own = [];
    if (opts.host) own.push(`${OP_PATH}/inputs/${safeHost(opts.host)}/`);
    const ownFiles = opts.instance ? [`${OP_PATH}/records/${opts.instance}.ndjson`] : [];
    const updated = [];
    const diverged = [];
    for (const p of diff.out ? diff.out.split('\n') : []) {
      if (own.some((o) => p.startsWith(o)) || ownFiles.includes(p)) {
        // a file only this writer appends to: upstream holding lines the local copy lacks means
        // another writer (a second clone or a forked instance) appended to it
        const abs = path.join(projectRoot, p);
        if (fs.existsSync(abs)) {
          const show = cp.spawnSync('git', ['show', `@{u}:${p}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
          if (show.status === 0) {
            let local = '';
            try { local = fs.readFileSync(abs, 'utf8'); } catch (e) { local = ''; }
            if (!local.startsWith(show.stdout)) diverged.push(p);
          }
        }
        continue;
      }
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
    return { ok: true, updated, diverged, remote: up.remote };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

// Commit and push only .delivery/operator. Never touches other work: path-scoped add and
// commit, refuses to push when unpushed commits touch anything else, no autostash or rebase.
// opts: { force, host, instance }.
function publish(projectRoot, opts = {}) {
  const r = publishInner(projectRoot, opts);
  try {
    const f = path.join(opDir(projectRoot), 'cursors', 'last-publish.json');
    if (r.published) writeJsonAtomic(f, { at: Date.now() });
    else if (r.reason && r.reason !== 'throttled' && r.reason !== 'not a git repository') writeJsonAtomic(f, { at: Date.now(), reason: r.reason });
  } catch (e) { /* best effort */ }
  return r;
}

// The reason the last real push attempt failed (throttled calls do not overwrite it), or null.
function lastPublishReason(projectRoot) {
  const j = readJson(path.join(opDir(projectRoot), 'cursors', 'last-publish.json'));
  return j && j.reason ? j.reason : null;
}

function publishInner(projectRoot, opts = {}) {
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
    // only this writer's own files: its host's inputs, its instance's records, the .gitignore
    const hostRel = `${OP_PATH}/inputs/${safeHost(opts.host)}`;
    // LEDGER.md is generated by whichever host wrote last (derived, never merged by hand)
    const own = [`${OP_PATH}/.gitignore`, `${OP_PATH}/LEDGER.md`, hostRel];
    if (opts.instance) own.push(`${OP_PATH}/records/${opts.instance}.ndjson`);
    const ownPaths = own.filter((p) => fs.existsSync(path.join(projectRoot, p)));
    if (ownPaths.length) {
      const add = git(projectRoot, ['add', '--', ...ownPaths]);
      if (!add.ok) return no(add.err);
    }
    const staged = ownPaths.length ? git(projectRoot, ['diff', '--cached', '--numstat', '--', ...ownPaths]) : { out: '' };
    const lines = staged.out ? staged.out.split('\n') : [];
    const n = lines.filter((l) => !l.endsWith('.gitignore'))
      .reduce((s, l) => s + (Number(l.split('\t')[0]) || 0), 0);
    if (lines.length) {
      const c = git(projectRoot, ['commit', '--only', '--no-verify', '--no-gpg-sign', '-m', `operator: ${n} entries`, '--', ...ownPaths]);
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
      // Rejected: another writer pushed first. Never merge into, delete from or reset this checkout
      // (for a role session it is the operator's own project checkout, shared by every local role,
      // so its untracked operator files can be another session's unpublished records). Build the
      // next upstream commit with git plumbing instead: upstream's tree plus this writer's own
      // committed chain files, checked append-only against upstream, and push that.
      const f = git(projectRoot, ['fetch', up.remote]);
      if (!f.ok) return no(f.err || 'fetch failed');
      if (unrelated().length) return no('unpushed unrelated commits', { paths: unrelated() });
      const rec = publishOnUpstream(projectRoot, up, own, opts, n);
      if (!rec.ok) return no(rec.reason, rec.extra || {});
      r = rec;
      // bring other writers' files into the working tree, operator paths only, never over local appends
      if (r.ok) { try { refresh(projectRoot, { host: opts.host, instance: opts.instance, fetch: false }); } catch (e) { /* best effort */ } }
    }
    return r.ok ? { ok: true, published: true, entries: n } : no(r.err);
  } catch (e) {
    return no(String(e && e.message || e));
  }
}

// Commit this writer's own committed operator files on top of the upstream tip, without touching
// the working tree or the branch: a temporary index seeded from upstream, the own files' HEAD
// contents added after an append-only check (the upstream copy must be a prefix of ours, else the
// chain forked), commit-tree on upstream, push the commit. { ok, reason?, extra? }.
function publishOnUpstream(projectRoot, up, own, opts, n) {
  const idx = path.join(os.tmpdir(), `operator-publish-${process.pid}-${Date.now()}.index`);
  const env = { GIT_INDEX_FILE: idx };
  try {
    const listed = git(projectRoot, ['ls-tree', '-r', '--name-only', 'HEAD', '--', ...own]);
    const files = listed.out ? listed.out.split('\n').filter(Boolean) : [];
    const rt = git(projectRoot, ['read-tree', up.ref], { env });
    if (!rt.ok) return { ok: false, reason: rt.err || 'read-tree failed' };
    const recFile = opts.instance ? `${OP_PATH}/records/${opts.instance}.ndjson` : null;
    const hostRel = `${OP_PATH}/inputs/${safeHost(opts.host)}/`;
    const forks = [];
    for (const p of files) {
      const ours = cp.spawnSync('git', ['show', `HEAD:${p}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      if (ours.status !== 0) continue;
      const theirs = cp.spawnSync('git', ['show', `${up.ref}:${p}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      const derived = p === `${OP_PATH}/.gitignore` || p === `${OP_PATH}/LEDGER.md`;
      if (!derived && theirs.status === 0) {
        if (theirs.stdout.startsWith(ours.stdout)) continue; // upstream already holds all of ours
        if (!ours.stdout.startsWith(theirs.stdout)) { forks.push(p); continue; }
      }
      const blob = git(projectRoot, ['hash-object', '-w', '--stdin'], { input: ours.stdout });
      if (!blob.ok) return { ok: false, reason: blob.err || 'hash-object failed' };
      const ui = git(projectRoot, ['update-index', '--add', '--cacheinfo', `100644,${blob.out},${p}`], { env });
      if (!ui.ok) return { ok: false, reason: ui.err || 'update-index failed' };
    }
    if (forks.length) {
      // the records chain is named first: it is the one writes are refused on
      if (recFile && forks.includes(recFile)) return { ok: false, reason: `records chain forked: another writer appended to records/${opts.instance}.ndjson`, extra: { forked: recFile } };
      const hit = forks.find((p) => p.startsWith(hostRel));
      if (hit) return { ok: false, reason: `inputs chain forked: another writer appended to ${hit.slice(OP_PATH.length + 1)}`, extra: { forked: hit } };
      return { ok: false, reason: `${forks[0]} differs from the upstream copy; nothing was pushed`, extra: { forked: forks[0] } };
    }
    const tree = git(projectRoot, ['write-tree'], { env });
    const upTree = git(projectRoot, ['rev-parse', `${up.ref}^{tree}`]);
    if (!tree.ok || !upTree.ok) return { ok: false, reason: tree.err || upTree.err || 'write-tree failed' };
    if (tree.out === upTree.out) return { ok: true, published: true, entries: n };
    const upTip = git(projectRoot, ['rev-parse', up.ref]);
    const c = git(projectRoot, ['commit-tree', tree.out, '-p', upTip.out, '-m', `operator: ${n} entries`]);
    if (!c.ok) return { ok: false, reason: c.err || 'commit-tree failed' };
    const push = git(projectRoot, ['push', up.remote, `${c.out}:refs/heads/${up.branch}`]);
    if (!push.ok) return { ok: false, reason: push.err || 'push rejected' };
    git(projectRoot, ['fetch', up.remote]);
    return { ok: true, published: true, entries: n };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  } finally {
    try { fs.unlinkSync(idx); } catch (e) { /* gone */ }
  }
}

// Entries this writer holds that the upstream does not: { count, reason }. Read-only.
function unpublished(projectRoot, opts = {}) {
  try {
    if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) return { count: 0, reason: 'not a git repository' };
    const up = upstreamOf(projectRoot);
    if (!up) return { count: 0, reason: 'no upstream' };
    // opts.all: every chain in the operator directory (a reader that does not know its host)
    const rels = opts.all ? [`${OP_PATH}/inputs`, `${OP_PATH}/records`] : [`${OP_PATH}/inputs/${safeHost(opts.host)}`];
    for (const i of opts.all ? [] : (opts.instances || (opts.instance ? [opts.instance] : []))) rels.push(`${OP_PATH}/records/${i}.ndjson`);
    let count = 0;
    const d = git(projectRoot, ['diff', '--numstat', '@{u}', '--', ...rels]);
    for (const l of d.out ? d.out.split('\n') : []) count += Number(l.split('\t')[0]) || 0;
    for (const e of porcelain(projectRoot, rels)) {
      if (e.code !== '??') continue;
      try { count += fs.readFileSync(path.join(projectRoot, e.path), 'utf8').split('\n').filter(Boolean).length; } catch (x) { /* gone */ }
    }
    return { count, reason: count ? 'not pushed to ' + up.ref : null };
  } catch (e) {
    return { count: 0, reason: String(e && e.message || e) };
  }
}

module.exports = { porcelain, roleBoundary, roleSince, headsProblem, unpublished, dropHead, lastPublishReason, syncTranscript, getInput, listInputs, verifyInputs, publish, refresh, safeHost, parseId, listHosts, readHeads, setHead, opDir };
