#!/usr/bin/env node
// sweep.js — remove what the plugin's own test runs left in the host's /tmp.
//   node sweep.js [--dry-run] [--min-age <minutes>] [--json]
//
// A suite run through the sealed runner leaves nothing on the host. A run that is not sealed (the owner's
// recorded opt-out, a host without bubblewrap) puts everything it makes in one private directory under the
// system temp dir, and removes it at the end; a run killed before then leaves it, and on a server whose
// /tmp is memory-backed those pile up until the disk is full. The owner's rule (dec-chief-of-staff-000014,
// dec-chief-of-staff-000211): the host is never left to a restart or a person to clean, so the watchdog
// runs this every cycle and logs what it removed.
//
// What may go is never guessed from a name (review of #126: a name match over /tmp would delete another
// tool's /tmp/home-XXXXXX). A run records each directory it makes there, when it makes it, in a registry
// outside /tmp (record()), and forgets it once it has removed it (forget()). The sweep removes a recorded
// path only when every one of these holds, and nothing else, ever:
//   - it sits directly in /tmp, whatever TMPDIR says, never deeper and never anywhere else;
//   - it is a real directory, not a symlink and not a file;
//   - it belongs to the user running the sweep;
//   - the process that recorded it is gone, so a run in progress is never touched;
//   - nothing in it has changed for --min-age minutes (60 by default).
// A recorded path that no longer exists, or that the sweep could never remove (not directly in /tmp, not a
// real directory), is dropped from the registry; one that may yet pass (owner, live run, age) stays.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_AGE_MIN = 60;
// the host's /tmp itself: the one place the sweep reads, whatever TMPDIR points at
const TMP = '/tmp';

// one JSON line per directory a run made: { path, pid, at }. In the user's state directory, so it
// outlives /tmp being cleared and is never itself a candidate.
function registryPath(env = process.env) {
  if (env.DELIVERY_TMP_REGISTRY) return env.DELIVERY_TMP_REGISTRY;
  const state = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(state, 'delivery', 'tmp-created.ndjson');
}

// Every change to the registry is made holding its lock, a file beside it created exclusively, so a run
// recording while a sweep or another run forgets cannot lose its line (review of #126: a rewrite that
// raced an append dropped the path, and that directory then leaked forever). A lock whose holder is gone
// is taken over; a live holder is waited for, never for long, since it only reads and writes one file.
//
// The lock holds "<pid> <token>", the token new on every hold, so a lock is told from the next one even
// when the pid is the same (review of #126, tqv.1). Taking over a stale lock is done holding a second,
// short gate (lock.takeover, created exclusively), and removes the lock only if it still holds the very
// token seen stale: two runs that both saw a dead holder cannot both remove a lock, so a third run's
// fresh lock is never removed and a stale one is never put back. A lock is stale when its holder is
// gone, when it carries this process's pid but not a token this process holds (left by an earlier
// process with our pid, or put back by the old takeover), or when it is older than LOCK_STALE_MS, since
// a hold lasts milliseconds and a pid that is reused by a live process (another user's included: EPERM
// reads as alive) would otherwise refuse every record until that process exits.
const LOCK_WAIT_MS = 10000;
const LOCK_STALE_MS = 5000; // below LOCK_WAIT_MS, so a waiter takes a reused-pid lock over before it gives up
const GATE_STALE_MS = 2000; // the gate is held for one read and one unlink
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const held = new Set(); // tokens of the locks this process holds now

function readLock(lock) {
  let text;
  let st;
  try { text = fs.readFileSync(lock, 'utf8'); st = fs.statSync(lock); } catch (e) { return null; } // released meanwhile
  const [pid, token = ''] = text.trim().split(/\s+/);
  return { text, pid: Number(pid) || 0, token, ageMs: Date.now() - st.mtimeMs };
}

function isStale(h, isAlive) {
  if (h.ageMs > LOCK_STALE_MS) return true;
  if (!h.pid) return false; // being written by a run that has just created it: young, so wait
  if (h.pid === process.pid) return !held.has(h.token);
  return !isAlive(h.pid);
}

// remove the lock only if it still holds the text seen stale, holding the gate so no other takeover runs
function takeOver(lock, seen) {
  const gate = `${lock}.takeover`;
  let fd;
  try { fd = fs.openSync(gate, 'wx'); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // a gate left by a run that died mid-takeover: old, since a takeover lasts microseconds
    try { if (Date.now() - fs.statSync(gate).mtimeMs > GATE_STALE_MS) fs.rmSync(gate, { force: true }); } catch (err) { /* gone */ }
    return;
  }
  try {
    fs.closeSync(fd);
    let now = null;
    try { now = fs.readFileSync(lock, 'utf8'); } catch (e) { /* released meanwhile */ }
    if (now === seen.text) fs.rmSync(lock, { force: true });
  } finally { fs.rmSync(gate, { force: true }); }
}

function withLock(registry, fn, { waitMs = LOCK_WAIT_MS, isAlive = alive } = {}) {
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  const lock = `${registry}.lock`;
  const until = Date.now() + waitMs;
  for (;;) {
    let fd = null;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (fd !== null) {
      const token = crypto.randomBytes(8).toString('hex');
      const mine = `${process.pid} ${token}`;
      held.add(token);
      try { fs.writeSync(fd, mine); fs.closeSync(fd); return fn(); } finally {
        held.delete(token);
        // release only our own lock: one taken over after LOCK_STALE_MS is the new holder's now
        try { if (fs.readFileSync(lock, 'utf8') === mine) fs.rmSync(lock, { force: true }); } catch (e) { /* gone */ }
      }
    }
    const h = readLock(lock);
    if (!h) continue;
    if (h.pid === process.pid && held.has(h.token)) throw new Error(`the sweep registry ${registry} is already locked by this process`);
    if (isStale(h, isAlive)) { takeOver(lock, h); continue; }
    if (Date.now() >= until) throw new Error(`the sweep registry ${registry} is locked by process ${h.pid || 'unknown'}`);
    pause(20);
  }
}

// one line per directory, appended under the lock
function record(p, { registry = registryPath(), pid = process.pid, now = Date.now(), waitMs } = {}) {
  withLock(registry, () => fs.appendFileSync(registry, `${JSON.stringify({ path: p, pid, at: new Date(now).toISOString() })}\n`), { waitMs });
}

function entries(registry) {
  let text = '';
  try { text = fs.readFileSync(registry, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e && typeof e.path === 'string') out.push(e); } catch (err) { /* a torn line: skip */ }
  }
  return out;
}

// rewrite the registry without the given paths, under the lock, so no line appended meanwhile is lost
function forget(paths, { registry = registryPath(), waitMs } = {}) {
  const drop = new Set(paths);
  withLock(registry, () => {
    const keep = entries(registry).filter((e) => !drop.has(e.path));
    const tmp = `${registry}.${process.pid}`;
    try {
      fs.writeFileSync(tmp, keep.map((e) => `${JSON.stringify(e)}\n`).join(''));
      fs.renameSync(tmp, registry);
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (err) { /* none */ } }
  }, { waitMs });
}

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// the newest modification anywhere under dir, bounded: a run still writing keeps it young
function newestChange(dir, limit = 5000) {
  let newest = 0;
  let n = 0;
  const stack = [dir];
  while (stack.length && n < limit) {
    const d = stack.pop();
    let st;
    try { st = fs.lstatSync(d); } catch (e) { continue; }
    newest = Math.max(newest, st.mtimeMs);
    n += 1;
    if (!st.isDirectory()) continue;
    let list;
    try { list = fs.readdirSync(d); } catch (e) { continue; }
    for (const x of list) stack.push(path.join(d, x));
  }
  return n >= limit ? Infinity : newest; // too large to read cheaply: treat as busy, never guess
}

function sweep({ registry = registryPath(), minAgeMin = MIN_AGE_MIN, now = Date.now(), uid = process.getuid ? process.getuid() : null, dryRun = false, isAlive = alive } = {}) {
  const removed = [];
  const failed = [];
  const gone = [];
  const seen = new Set();
  for (const e of entries(registry)) {
    const p = e.path;
    if (seen.has(p)) continue;
    seen.add(p);
    // what the sweep can never act on is dropped too, so the registry stays bounded (review of #126)
    if (path.dirname(p) !== TMP || path.basename(p).startsWith('.')) { gone.push(p); continue; }
    let st;
    try { st = fs.lstatSync(p); } catch (err) { if (err.code === 'ENOENT') gone.push(p); continue; }
    // lstat: a symlink is not a directory here, so it is never followed; what is not the directory the
    // run made is never removed, and forgotten
    if (!st.isDirectory()) { gone.push(p); continue; }
    if (uid !== null && st.uid !== uid) continue;
    if (isAlive(e.pid)) continue;
    if (now - newestChange(p) < minAgeMin * 60000) continue;
    if (!dryRun) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (err) { failed.push({ path: p, error: err.code || err.message }); continue; }
    }
    removed.push(p);
  }
  if (!dryRun && (removed.length || gone.length)) forget([...removed, ...gone], { registry });
  return { removed, failed };
}

function summary(r, dryRun) {
  if (!r.removed.length && !r.failed.length) return 'sweep: no test leftovers in /tmp';
  const lines = [`sweep: ${dryRun ? 'would remove' : 'removed'} ${r.removed.length} test leftover(s) from /tmp${r.removed.length ? `: ${r.removed.map((p) => path.basename(p)).join(' ')}` : ''}`];
  for (const f of r.failed) lines.push(`sweep: could not remove ${f.path} (${f.error})`);
  return lines.join('\n');
}

module.exports = { sweep, record, forget, withLock, entries, registryPath, summary, MIN_AGE_MIN, TMP, LOCK_STALE_MS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--min-age');
  const minAgeMin = i >= 0 ? Number(argv[i + 1]) : MIN_AGE_MIN;
  if (!Number.isFinite(minAgeMin) || minAgeMin < 5) { process.stderr.write('sweep: --min-age must be a number of minutes, at least 5\n'); process.exit(2); }
  const dryRun = argv.includes('--dry-run');
  const r = sweep({ minAgeMin, dryRun });
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(r, null, 2)}\n` : `${summary(r, dryRun)}\n`);
  process.exit(r.failed.length ? 1 : 0);
}
