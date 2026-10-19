// scripts/lib/watch.js — the polling budget (R-25): a watcher declares its exit and its time limit, and
// GitHub reads are shared.
//
// In the Vault a watcher sat stuck for 7 hours, one session ran 126 Monitor loops, and the Progress
// Observer polled 30 pull requests every 90 s; GitHub's secondary rate limit then failed a production
// deploy. A watcher here needs an exit condition (text its read must show), a maximum duration (at most
// MAX_HOURS) and an interval of at least MIN_GH_S seconds for GitHub. Reads of gh go through a cache
// under <project>/.delivery/cache/gh/, shared by every role on the host, fresh for TTL_MS (4 minutes, the
// team's one query per 4 minutes of R-25): 30 watchers on one pull request cost one call per refresh,
// and only one caller refreshes an entry at a time. An entry is keyed by the read, its repository (-R,
// GH_REPO, else the working directory gh resolves it from) and its host (GH_HOST).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_GH_S = 240;
const TTL_MS = 240e3;
const PRUNE_MS = 3600e3;
const MAX_ENTRIES = 500;
const LOCK_STALE_MS = 90e3;
const MAX_HOURS = 6;
// the gh reads a watcher may repeat (`gh run watch` is itself a loop: use until instead)
const READS = ['pr view', 'pr list', 'pr checks', 'pr status', 'issue view', 'issue list', 'run view', 'run list', 'repo view', 'release list', 'release view'];

// '90s', '4m', '2h' (or plain seconds) to seconds; NaN when unreadable
function seconds(s) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(s == null ? '' : s).trim());
  return m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[m[2] || 's']) : NaN;
}

// null when the watcher is within the budget; else the reason, in one line
function budgetProblem({ every, max, until }) {
  if (!until || !String(until).trim()) return 'a watcher needs an exit condition: --until <text the read shows when you are done>';
  const e = seconds(every);
  const m = seconds(max);
  if (!Number.isFinite(m) || m <= 0) return 'a watcher needs a time limit: --max <duration>, as 2h';
  if (m > MAX_HOURS * 3600) return `--max ${max} is over the ${MAX_HOURS} h limit: a watcher that long is stuck; check again later instead`;
  if (!Number.isFinite(e) || e <= 0) return 'a watcher needs an interval: --every <duration>, as 5m';
  if (e < MIN_GH_S) return `polling GitHub every ${e} s is under the ${MIN_GH_S / 60} min minimum; use --every ${MIN_GH_S / 60}m or more (reads are shared for ${TTL_MS / 60000} min across the team)`;
  return null;
}

// gh's own polling (`pr checks --watch -i 1`, `-w`, grouped short options) is refused: only
// `watch.js until` repeats a read (Copilot 349)
const POLLING_FLAG = /^(?:--watch|--interval)(?:=.*)?$|^-[A-Za-z]*[wi][A-Za-z]*$/;
// null when args are a gh read a watcher may repeat; else the reason
function readProblem(args) {
  const list = (args || []).map(String);
  const words = list.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ');
  if (!READS.includes(words)) return `only gh reads can be watched (${READS.join(', ')}); got gh ${list.join(' ')}`;
  const poll = list.find((a) => POLLING_FLAG.test(a));
  return poll ? `gh's own polling (${poll}) is not allowed: watch.js until repeats the read, at most every ${MIN_GH_S / 60} min` : null;
}

const cacheDir = (root) => path.join(root, '.delivery', 'cache', 'gh');
// what gh answers depends on more than its arguments (Copilot 305)
function contextOf(args, { cwd = process.cwd(), env = process.env } = {}) {
  const list = (args || []).map(String);
  let repo = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '-R' || list[i] === '--repo') repo = list[i + 1] || null;
    else if (list[i].startsWith('--repo=')) repo = list[i].slice(7);
  }
  if (!repo && /github\.com\/[^/]+\/[^/]+/.test(list.join(' '))) repo = 'url';
  repo = repo || env.GH_REPO || null;
  let where = null;
  if (!repo) { try { where = fs.realpathSync(cwd); } catch (err) { where = path.resolve(cwd); } }
  return { repo: repo ? repo.toLowerCase() : null, host: (env.GH_HOST || 'github.com').toLowerCase(), cwd: where };
}
const keyOf = (args, ctx = {}) => crypto.createHash('sha256').update(JSON.stringify({ args, repo: ctx.repo || null, host: ctx.host || 'github.com', cwd: ctx.cwd || null })).digest('hex').slice(0, 16);

const fresh = (file, now, ttl) => {
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c && now - c.at < ttl ? c : null; } catch (err) { return null; }
};
const sleepMs = (n) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);

// entries older than an hour go, and at most MAX_ENTRIES stay (the newest)
function prune(dir, now) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const p = path.join(dir, f); return { p, t: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.t - a.t);
    files.forEach((x, i) => { if (i >= MAX_ENTRIES || now - x.t > PRUNE_MS) fs.unlinkSync(x.p); });
  } catch (err) { /* nothing to prune */ }
}

// One gh read through the shared cache, its exit status kept with it: a pending check or a rate-limit
// error is shared for the window too (Copilot 065). run(args) -> { code, out }. A cold or stale entry is refreshed
// by one caller at a time: the others wait for its result (Copilot 374). { code, out, cached, age }
function ghRead(root, args, { run, now = Date.now(), ttl = TTL_MS, cwd, env, waitMs = 60e3 } = {}) {
  const dir = cacheDir(root);
  const file = path.join(dir, `${keyOf(args, contextOf(args, { cwd, env }))}.json`);
  const hit = (c) => ({ code: c.code, out: c.out, cached: true, age: Math.max(0, Math.round((now - c.at) / 1000)) });
  let c = fresh(file, now, ttl);
  if (c) return hit(c);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ig = path.join(root, '.delivery', 'cache', '.gitignore');
    if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  } catch (err) { /* uncached below */ }
  const lock = `${file}.lock`;
  let fd = null;
  const until = Date.now() + waitMs;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch (err) {
      if (err.code !== 'EEXIST') break;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch (e) { continue; }
      if (Date.now() > until) break;
      sleepMs(50);
      // another caller is refreshing it: its result is ours
      c = fresh(file, now, ttl);
      if (c) return hit(c);
    }
  }
  try {
    c = fresh(file, now, ttl);
    if (c) return hit(c);
    const r = run(args);
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ at: now, args, code: r.code, out: r.out }));
      fs.renameSync(tmp, file);
      prune(dir, now);
    } catch (err) { /* a cache that cannot be written only costs a call */ }
    return { code: r.code, out: r.out, cached: false, age: 0 };
  } finally { if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (e) { /* gone */ } } }
}

// Poll read() every `every` seconds until its output matches `until`, for at most `max` seconds.
// sleep(seconds) and clock() are injected in tests. { done, out, polls, waited }
function watch({ read, until, every, max, sleep, clock = () => Date.now() }) {
  const re = new RegExp(until, 'i');
  const e = seconds(every);
  const m = seconds(max);
  const t0 = clock();
  let polls = 0;
  for (;;) {
    const r = read();
    polls++;
    if (r.code === 0 && re.test(r.out || '')) return { done: true, out: r.out, polls, waited: Math.round((clock() - t0) / 1000) };
    const waited = (clock() - t0) / 1000;
    if (waited + e > m) return { done: false, out: r.out, polls, waited: Math.round(waited) };
    sleep(e);
  }
}

module.exports = { contextOf, keyOf, prune, MAX_ENTRIES, MIN_GH_S, TTL_MS, MAX_HOURS, READS, seconds, budgetProblem, readProblem, ghRead, watch, cacheDir };
