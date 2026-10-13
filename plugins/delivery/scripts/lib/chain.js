// scripts/lib/chain.js — append-only hash chain in an NDJSON file.
// hash = sha256(prev + "\n" + canonical(entry without hash)); the first entry's prev is "0".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 10000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

function canonical(obj) {
  return JSON.stringify(canonicalize(obj));
}

function hashEntry(prev, entry) {
  const { hash, ...rest } = entry; // eslint-disable-line no-unused-vars
  return crypto.createHash('sha256').update(prev + '\n' + canonical(rest)).digest('hex');
}

// Last non-empty line of a file as a string, or null. Reads backwards in chunks.
function readLastLine(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  try {
    let pos = fs.fstatSync(fd).size;
    let buf = Buffer.alloc(0);
    const CHUNK = 64 * 1024;
    while (pos > 0) {
      const n = Math.min(CHUNK, pos);
      pos -= n;
      const chunk = Buffer.alloc(n);
      fs.readSync(fd, chunk, 0, n, pos);
      buf = Buffer.concat([chunk, buf]);
      const text = buf.toString('utf8').replace(/\s+$/, '');
      const nl = text.lastIndexOf('\n');
      if (nl !== -1) return text.slice(nl + 1);
      if (pos === 0) return text || null;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function lastEntryOf(file) {
  const line = readLastLine(file);
  if (!line) return null;
  try { return JSON.parse(line); } catch (e) { return null; }
}

function readToken(lockFile) {
  try { return fs.readFileSync(lockFile, 'utf8'); } catch (e) { return null; }
}

// The lock file holds `<pid>:<random>`; the token identifies the holder.
function acquireLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const token = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try { fs.writeSync(fd, token); } finally { fs.closeSync(fd); }
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age;
      let seen;
      try {
        age = Date.now() - fs.statSync(lockFile).mtimeMs;
        seen = readToken(lockFile);
      } catch (e) { continue; /* vanished: retry */ }
      if (age > LOCK_STALE_MS) {
        // Break by renaming to a unique name, then re-check the token we judged stale.
        const aside = `${lockFile}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(lockFile, aside);
          if (readToken(aside) === seen) { fs.unlinkSync(aside); continue; }
          // we moved a lock that was replaced meanwhile: put it back if nobody took the slot
          try { fs.linkSync(aside, lockFile); } catch (e) { /* slot taken */ }
          try { fs.unlinkSync(aside); } catch (e) { /* ignore */ }
        } catch (e) { /* lost the race, retry */ }
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`could not acquire lock ${lockFile} within ${LOCK_TIMEOUT_MS} ms`);
      sleepSync(5 + Math.floor(Math.random() * 10));
    }
  }
}

function releaseLock(lockFile, token) {
  if (readToken(lockFile) === token) { try { fs.unlinkSync(lockFile); } catch (e) { /* gone */ } }
}

function withLock(lockFile, fn) {
  const token = acquireLock(lockFile);
  try { return fn(); } finally { releaseLock(lockFile, token); }
}

function validLine(line) {
  try {
    const o = JSON.parse(line);
    return o && typeof o === 'object' && typeof o.hash === 'string' ? o : null;
  } catch (e) { return null; }
}

// If the file's last non-empty line is not a complete entry, move the tail aside as evidence
// (`<file>.partial-<ts>`) and truncate back to the last valid line. Returns the last valid
// entry (or null when no valid line remains).
function repairTail(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trim() === '') return null;
  const lines = raw.split('\n');
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  if (validLine(lines[end - 1])) return validLine(lines[end - 1]);
  let k = end;
  let last = null;
  while (k > 0) {
    last = validLine(lines[k - 1]);
    if (last) break;
    k--;
  }
  const keep = lines.slice(0, k);
  const tail = lines.slice(k).join('\n');
  fs.writeFileSync(`${file}.partial-${Date.now()}-${process.pid}`, tail);
  fs.writeFileSync(file, keep.length ? keep.join('\n') + '\n' : '');
  return last;
}

// Append one entry. `entry` is an object, or a function (lastEntry|null) => object|null, called
// under the lock so callers can derive sequence numbers; null means "append nothing".
// opts.prevFile: file whose last entry supplies prev when `file` is empty or new.
// opts.lockFile: lock to use (default `<file>.lock`); opts.alreadyLocked: caller holds it.
function appendEntry(file, entry, opts = {}) {
  const doAppend = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let last = null;
    let exists = false;
    try { exists = fs.statSync(file).size > 0; } catch (e) { exists = false; }
    if (exists) {
      const tail = readLastLine(file);
      last = tail ? validLine(tail) : null;
      if (!last) last = repairTail(file); // never treat a non-empty file as empty
    }
    if (!last && opts.prevFile) last = lastEntryOf(opts.prevFile);
    const body = typeof entry === 'function' ? entry(last) : entry;
    if (body === null || body === undefined) return null;
    const { hash, prev, ...rest } = body; // eslint-disable-line no-unused-vars
    const p = last && last.hash ? last.hash : '0';
    const stored = { ...rest, prev: p };
    stored.hash = hashEntry(p, stored);
    let line = JSON.stringify(stored) + '\n';
    // A crashed writer may have left no trailing newline; keep our line whole.
    try {
      const size = fs.statSync(file).size;
      if (size > 0) {
        const fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, size - 1);
        fs.closeSync(fd);
        if (b[0] !== 0x0a) line = '\n' + line;
      }
    } catch (e) { /* new file */ }
    fs.appendFileSync(file, line);
    return stored;
  };
  if (opts.alreadyLocked) return doAppend();
  return withLock(opts.lockFile || file + '.lock', doAppend);
}

// verifyChain(file, { prev }) -> { ok, count, last_hash } | { ok:false, count, error, at }
function verifyChain(file, opts = {}) {
  let prev = opts.prev || '0';
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { ok: true, count: 0, last_hash: prev }; }
  const lines = raw.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const at = i + 1;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch (e) {
      return { ok: false, count, at, error: `line ${at}: not valid JSON` };
    }
    if (!entry || typeof entry !== 'object') return { ok: false, count, at, error: `line ${at}: not an object` };
    if (entry.prev !== prev) {
      return { ok: false, count, at, error: `line ${at}: prev does not match the previous entry's hash (entry removed or reordered)` };
    }
    if (hashEntry(prev, entry) !== entry.hash) {
      return { ok: false, count, at, error: `line ${at}: hash mismatch (entry was modified)` };
    }
    prev = entry.hash;
    count++;
  }
  return { ok: true, count, last_hash: prev };
}

module.exports = { canonical, hashEntry, appendEntry, verifyChain, withLock, readLastLine, lastEntryOf };
