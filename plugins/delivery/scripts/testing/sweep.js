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
// A recorded path that no longer exists is dropped from the registry; one that fails a check stays.
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

// appended in one write, so runs recording at once do not interleave lines
function record(p, { registry = registryPath(), pid = process.pid, now = Date.now() } = {}) {
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.appendFileSync(registry, `${JSON.stringify({ path: p, pid, at: new Date(now).toISOString() })}\n`);
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

// rewrite the registry without the given paths. A line another run appends between the read and the
// rename is lost, which only means that path is never swept: the safe way to be wrong.
function forget(paths, { registry = registryPath() } = {}) {
  const drop = new Set(paths);
  const keep = entries(registry).filter((e) => !drop.has(e.path));
  const tmp = `${registry}.${process.pid}`;
  try {
    fs.writeFileSync(tmp, keep.map((e) => `${JSON.stringify(e)}\n`).join(''));
    fs.renameSync(tmp, registry);
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (err) { /* none */ } }
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
    if (path.dirname(p) !== TMP || path.basename(p).startsWith('.')) continue;
    let st;
    try { st = fs.lstatSync(p); } catch (err) { if (err.code === 'ENOENT') gone.push(p); continue; }
    // lstat: a symlink is not a directory here, so it is never followed
    if (!st.isDirectory()) continue;
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

module.exports = { sweep, record, forget, entries, registryPath, summary, MIN_AGE_MIN, TMP };

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
