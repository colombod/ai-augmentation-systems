#!/usr/bin/env node
// scripts/plan-sync.js — keep the planning repository true to what shipped (lib/plan-sync.js).
//   plan-sync.js check   read only: what in the plan is behind; exit 1 when anything is
//   plan-sync.js apply   bring it up to date: story statuses from the beads, the feature map from the
//                        product's default branch, and push the plan to origin; exit 1 on a problem
// merge-gate.js merged runs apply after every merge, and the merge gate refuses the next merge while
// check reports drift, so nobody has to remember to run either.
const PS = require('./lib/plan-sync.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: plan-sync.js check | apply [--project <root>]';

function beadsOf(root, bd) {
  try { return (bd || require('./lib/bd.js').makeBd({ cwd: root, timeoutMs: 15000 })).list({ all: true }); } catch (err) { return null; }
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, who: given, now, source } = {}) {
  const args = argv.slice();
  const i = args.indexOf('--project');
  const project = i >= 0 ? args.splice(i, 2)[1] : undefined;
  const [sub] = args;
  if (!['check', 'apply'].includes(sub) || args.length > 1) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project });
  if (!who.root) return { code: 2, out: 'plan-sync.js: no project found; pass --project <root>' };
  const beads = beadsOf(who.root, bd);
  if (sub === 'check') {
    const d = PS.drift(who.root, { beads });
    const note = beads ? '' : '\n(bd could not be read: story statuses not checked)';
    if (!d.length) return { code: 0, out: `plan-sync: the plan is up to date with what shipped.${note}` };
    return { code: 1, out: `plan-sync: the plan is behind what shipped:\n${d.map((x) => `  ${x.detail}`).join('\n')}\nBring it up to date: ${require('./lib/reviews.js').cmd('plan-sync.js', 'apply')}${note}` };
  }
  const r = PS.apply(who.root, { beads, team: who.team, roleDir: who.roleDir, env, now, source });
  const out = [...r.lines.map((l) => `plan-sync: ${l}`), ...r.problems.map((p) => `plan-sync: not done: ${p}`)];
  if (!out.length) out.push('plan-sync: the plan was already up to date.');
  return { code: r.ok ? 0 : 1, out: out.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `plan-sync.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
