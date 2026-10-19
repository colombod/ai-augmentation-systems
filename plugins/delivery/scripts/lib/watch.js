// scripts/lib/watch.js — the polling budget (R-25): a watcher declares its exit and its time limit, and
// GitHub reads are shared.
//
// In the Vault a watcher sat stuck for 7 hours, one session ran 126 Monitor loops, and the Progress
// Observer polled 30 pull requests every 90 s; GitHub's secondary rate limit then failed a production
// deploy. A watcher here needs an exit condition (text its read must show), a maximum duration (at most
// MAX_HOURS) and an interval of at least MIN_GH_S seconds for GitHub. Reads of gh go through a cache
// under <project>/.delivery/cache/gh/, shared by every role on the host, fresh for TTL_MS: 30 watchers on
// one pull request cost one call per two minutes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_GH_S = 240;
const TTL_MS = 120e3;
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

// null when args are a gh read a watcher may repeat; else the reason
function readProblem(args) {
  const words = (args || []).filter((a) => !String(a).startsWith('-')).slice(0, 2).join(' ');
  return READS.includes(words) ? null : `only gh reads can be watched (${READS.join(', ')}); got gh ${(args || []).join(' ')}`;
}

const cacheDir = (root) => path.join(root, '.delivery', 'cache', 'gh');
const keyOf = (args) => crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);

// One gh read through the shared cache. run(args) -> { code, out }. { code, out, cached, age }
function ghRead(root, args, { run, now = Date.now(), ttl = TTL_MS } = {}) {
  const dir = cacheDir(root);
  const file = path.join(dir, `${keyOf(args)}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && now - c.at < ttl && c.code === 0) return { code: c.code, out: c.out, cached: true, age: Math.round((now - c.at) / 1000) };
  } catch (err) { /* no cache yet */ }
  const r = run(args);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ig = path.join(root, '.delivery', 'cache', '.gitignore');
    if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at: now, args, code: r.code, out: r.out }));
    fs.renameSync(tmp, file);
  } catch (err) { /* a cache that cannot be written only costs a call */ }
  return { code: r.code, out: r.out, cached: false, age: 0 };
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

module.exports = { MIN_GH_S, TTL_MS, MAX_HOURS, READS, seconds, budgetProblem, readProblem, ghRead, watch, cacheDir };
