// scripts/lib/operator-log.js — the operator inputs log.
// One hash chain per host: <operator dir>/inputs/<host>/<YYYY-MM>.ndjson, single writer per file
// so git never merges a chain (the operator dir is in the private store, see operator-store.js). Ids embed the host: in-<host>-<6-digit seq>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const chain = require('./chain.js');
const store = require('./operator-store.js');
const transcript = require('./transcript.js');

const MAX_TEXT_BYTES = 65536;
const PUBLISH_THROTTLE_MS = 30 * 1000;

// Where the operator records live: the private store of a git project, else <project>/.delivery/operator.
const opDir = (root) => store.operatorDir(root);
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

// Only for a project outside git (records in <project>/.delivery/operator): the private store keeps its
// local state out of commits with its own exclude file.
function ensureGitignore(root) {
  if (store.storeDir(root)) return;
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
// When this session became the role: the first time a capture hook saw this session id for the role
// instance (SessionStart always runs first in a role session, so earlier transcript lines are prompts
// from before the session was a role). Local state of the operator store:
// <operator dir>/cursors/role-since/<instance>.json holds { sessions: { <session id>: <ISO time> } }:
// one entry per session, never overwritten, updated atomically under a lock, the oldest pruned beyond
// ROLE_SINCE_KEEP. Without opts.projectRoot and opts.instance (and to read boundaries an earlier
// version kept) the file is <roleDir>/.delivery-role-since.json. roleBoundary returns
// { since, created } (created: this call wrote it); create:false only reads.
const ROLE_SINCE_KEEP = 32;
function roleBoundary(roleDir, sessionId, { now, create = true, projectRoot, instance } = {}) {
  if (!sessionId || (!roleDir && !(projectRoot && instance))) return { since: null, created: false };
  const legacy = roleDir ? path.join(roleDir, '.delivery-role-since.json') : null;
  const f = projectRoot && instance
    ? path.join(opDir(projectRoot), 'cursors', 'role-since', `${String(instance).replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
    : legacy;
  const valid = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t));
  const readFrom = (file) => {
    const cur = file ? readJson(file) : null;
    if (cur && plainObject(cur.sessions)) return { ...cur.sessions };
    // the first version kept one { session_id, since }
    if (cur && typeof cur.session_id === 'string' && valid(cur.since)) return { [cur.session_id]: cur.since };
    return {};
  };
  const read = () => {
    const own = readFrom(f);
    if (f !== legacy && legacy && !valid(own[sessionId])) {
      const old = readFrom(legacy)[sessionId];
      if (valid(old)) own[sessionId] = old;
    }
    return own;
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
  // a store that has never seen the remote first takes this host's published chain (see bootstrap)
  if (opts.bootstrap !== false) store.bootstrap(projectRoot, storeOpts(projectRoot, { host, instance }));
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
    ? { fromLine: 0 } : { fromLine: cursor.line, fromOffset: cursor.offset || 0, lastAssistant: cursor.last_assistant || null, pendingAsks: cursor.pending_asks || {} });
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
        // what the owner answered: the AskUserQuestion question, or the session's message before a typed reply
        if (inp.asked) e.asked = inp.asked;
        if (inp.after_assistant) e.after_assistant = inp.after_assistant;
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
      last_assistant: read.lastAssistant || null,
      pending_asks: read.pendingAsks || {},
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
// Storage and transport are operator-store.js: a private git repository inside the project's .git
// directory. Nothing here runs git in the user's checkout.

// The chains a publish is about to commit must verify first (store paths relative to the operator
// directory). Returns null, or { path, error } for the first that does not.
function checkChains(projectRoot) {
  // root: where the chains are read (the project, or a scratch copy of what is about to be pushed)
  return (rels, root = projectRoot) => {
    const hosts = new Set();
    const instances = new Set();
    for (const r of rels) {
      const im = /^inputs\/([^/]+)\//.exec(r);
      if (im) hosts.add(im[1]);
      const rm = /^records\/(.+)\.ndjson$/.exec(r);
      if (rm) instances.add(rm[1]);
    }
    for (const h of [...hosts].sort()) {
      const v = verifyHostRaw(root, h);
      if (!v.ok) return { path: `inputs/${h}/`, error: v.error };
    }
    const R = require('./operator-records.js'); // loaded late: operator-records requires this module
    for (const i of [...instances].sort()) {
      const v = R.verifyRecordsFile(root, i, { setHead: false });
      if (!v.ok) return { path: `records/${i}.ndjson`, error: v.error };
    }
    return null;
  };
}

// opts.host: this host's label (its inputs chains are written here only); opts.instance and
// opts.instances: the instances whose records chains are written here only (operator.js passes every
// instance of this host from the manifest). Without a host no owner rule applies (a reader).
function storeOpts(projectRoot, opts) {
  const instances = [...new Set([...(opts.instances || []), ...(opts.instance ? [opts.instance] : [])])];
  return { check: checkChains(projectRoot), host: opts.host ? safeHost(opts.host) : undefined, instances };
}

// Bring other writers' records from the remote into the private store (fetch and an append-only
// merge in the store only). { ok, updated, diverged, reason?, no_remote?, remote? }.
function refresh(projectRoot, opts = {}) {
  try {
    const r = store.refresh(projectRoot, storeOpts(projectRoot, opts));
    // a refresh that worked clears the reason the last push failed (a fork that was resolved since)
    if (r.ok) {
      try {
        const f = path.join(opDir(projectRoot), 'cursors', 'last-publish.json');
        const j = readJson(f);
        if (j && j.reason) writeJsonAtomic(f, { at: j.at });
      } catch (e) { /* best effort */ }
    }
    return r;
  } catch (e) {
    return { ok: false, updated: [], diverged: [], reason: String(e && e.message || e) };
  }
}

// Commit this store's new entries and push them to the delivery-operator branch of the project's
// origin. Throttled unless opts.force. { ok, published, entries?, reason?, diverged? }.
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
  try {
    if (!opts.force) {
      const last = readJson(path.join(opDir(projectRoot), 'cursors', 'last-publish.json'));
      if (last && Date.now() - last.at < PUBLISH_THROTTLE_MS) return { ok: false, published: false, reason: 'throttled' };
    }
    return store.publish(projectRoot, storeOpts(projectRoot, opts));
  } catch (e) {
    return { ok: false, published: false, reason: String(e && e.message || e) };
  }
}

// Entries this store holds that the remote branch does not (as last fetched). opts: { host, instance,
// instances } limit the count to those chains; opts.all counts every chain. { count, reason }.
function unpublished(projectRoot, opts = {}) {
  const host = safeHost(opts.host);
  const inst = new Set(opts.instances || (opts.instance ? [opts.instance] : []));
  const filter = opts.all ? null : (rel) => rel.startsWith(`inputs/${host}/`) || inst.has((/^records\/(.+)\.ndjson$/.exec(rel) || [])[1]);
  return store.unpublished(projectRoot, { filter });
}

module.exports = { roleBoundary, roleSince, headsProblem, unpublished, dropHead, lastPublishReason, syncTranscript, getInput, listInputs, verifyInputs, publish, refresh, safeHost, parseId, listHosts, readHeads, setHead, opDir };
