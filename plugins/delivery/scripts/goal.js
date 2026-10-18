#!/usr/bin/env node
// scripts/goal.js — the goal sheet's constraint fields (lib/goal.js) at the command line (R-42).
//   goal.js show [--json] [--project <root>]
//   goal.js set <field> <value> --record <dec-id>     only when the owner's quote in the record covers it
//   goal.js pause --trigger andon:<id>                 a mechanical pause, lifted when the andon closes
// No role sets a budget, a pause, the scope or the approval policy on its own say-so. Writes need a
// role session (the role comes from its marker); without one they are refused.
// Exit codes: 0 ok; 1 refused; 2 usage.
const Goal = require('./lib/goal.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: goal.js show [--json] | goal.js set <field> <value> --record <dec-id> | goal.js pause --trigger andon:<id>';

function parse(argv) {
  const out = { _: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (['--record', '--trigger', '--project'].includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

function main(argv, { cwd = process.cwd(), env = process.env, now, who: given, verifyRecord } = {}) {
  const a = parse(argv);
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'goal.js: no project found; pass --project <root>' };
  const [cmd, field, value] = a._;
  if (cmd === 'show') {
    if (a.json) {
      const g = Goal.read(who.root);
      const values = Object.fromEntries(Object.keys(Goal.FIELDS).map((f) => [f, Goal.value(who.root, f, g)]));
      return { code: 0, out: JSON.stringify({ values, fields: g.fields, pause: Goal.activePause(who.root, { verifyRecord }) }, null, 2) };
    }
    return { code: 0, out: Goal.showLines(who.root, { verifyRecord }).join('\n') };
  }
  if (cmd === 'set' && field && value !== undefined) {
    if (!a.record) return { code: 1, out: `goal.js: ${field} changes only on the owner's word.\nRecord it first, then: \`goal.js set ${field} ${value} --record <dec-id>\`` };
    const r = Goal.set({ root: who.root, who, field, value, record: a.record, verifyRecord, now });
    if (!r.ok) return { code: 1, out: `goal.js: refused: ${r.error}.\nAsk the owner in your next briefing, record the answer, then: \`goal.js set ${field} <value> --record <dec-id>\`` };
    return { code: 0, out: `${field} = ${Array.isArray(r.entry.value) ? r.entry.value.join(', ') : r.entry.value} under ${a.record}` };
  }
  if (cmd === 'pause' && a.trigger) {
    const r = Goal.pauseOnTrigger({ root: who.root, who, trigger: a.trigger, now });
    if (!r.ok) return { code: 1, out: `goal.js: refused: ${r.error}.\nA pause needs an open andon or the owner's word: \`goal.js set pause paused --record <dec-id>\`` };
    return { code: 0, out: `paused on ${a.trigger}; it lifts when the trigger closes` };
  }
  return { code: 2, out: USAGE };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `goal.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
