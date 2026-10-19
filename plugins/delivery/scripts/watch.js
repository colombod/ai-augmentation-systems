#!/usr/bin/env node
// scripts/watch.js — watch GitHub within the polling budget (R-25); lib/watch.js holds the rules.
//   watch.js gh <gh read args...>                   one gh read through the team's 2-minute cache
//   watch.js until <text> --every <5m> --max <2h> -- gh <gh read args...>
//                                                   repeat the read until its output shows <text> (a
//                                                   regular expression, any case), at most --max (6 h),
//                                                   at least every 4 minutes. Exit 0 when it shows,
//                                                   1 when the time limit passes first.
// Use this instead of a `while ... sleep` loop, `watch -n` or a Monitor that polls gh. Exit 2: refused.
const { spawnSync } = require('child_process');
const WT = require('./lib/watch.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: watch.js gh <gh read args...> | watch.js until <text> --every <5m> --max <2h> -- gh <gh read args...>';
const ghRun = (env) => (args) => {
  const r = spawnSync('gh', args, { env, encoding: 'utf8', timeout: 60000 });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.status ? r.stderr || '' : ''}`.trim() };
};
const sleepSync = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

function main(argv, { cwd = process.cwd(), env = process.env, run, sleep = sleepSync, clock, now } = {}) {
  const who = whoAmI({ cwd, env });
  const root = who.root || cwd;
  const read = (args) => WT.ghRead(root, args, { run: run || ghRun(env), now: now ? now() : Date.now() });
  const [cmd, ...rest] = argv;
  if (cmd === 'gh') {
    const bad = WT.readProblem(rest);
    if (bad) return { code: 2, out: `watch.js: ${bad}` };
    const r = read(rest);
    return { code: r.code, out: `${r.out}${r.cached ? `\n(from the team's cache, ${r.age} s old)` : ''}` };
  }
  if (cmd !== 'until') return { code: 2, out: USAGE };
  const dash = rest.indexOf('--');
  const opts = dash >= 0 ? rest.slice(0, dash) : rest;
  const target = dash >= 0 ? rest.slice(dash + 1) : [];
  const o = { until: null, every: undefined, max: undefined };
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === '--every') o.every = opts[++i];
    else if (opts[i] === '--max') o.max = opts[++i];
    else if (!o.until && !opts[i].startsWith('--')) o.until = opts[i];
    else return { code: 2, out: `watch.js: unknown option ${opts[i]}\n${USAGE}` };
  }
  const bad = WT.budgetProblem(o) || (target[0] !== 'gh' ? 'the read to watch goes after --, as -- gh pr view 471 --json state' : WT.readProblem(target.slice(1)));
  if (bad) return { code: 2, out: `watch.js: ${bad}` };
  try { new RegExp(o.until); } catch (err) { return { code: 2, out: `watch.js: --until is not a valid pattern (${err.message})` }; }
  const r = WT.watch({ read: () => read(target.slice(1)), until: o.until, every: o.every, max: o.max, sleep, clock });
  return r.done
    ? { code: 0, out: `Done after ${r.polls} read${r.polls > 1 ? 's' : ''} (${r.waited} s): the read shows ${o.until}.\n${r.out}` }
    : { code: 1, out: `Stopped at the time limit (${o.max}) after ${r.polls} reads: the read never showed ${o.until}. Last read:\n${r.out}` };
}

if (require.main === module) {
  const r = main(process.argv.slice(2));
  (r.code === 2 ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
