#!/usr/bin/env node
// scripts/goal.js — the goal sheet's constraint fields (lib/goal.js) at the command line (R-42).
//   goal.js show [--json] [--project <root>]
//   goal.js set <field> <value> --record <dec-id>     only on a record made for it (operator.js record --goal
//                                                       <field>=<value>) whose quote states the value
//   goal.js pause --trigger andon:<ev-row-id>          a failed check row pauses work until a pass follows
// No role sets a budget, a pause, the scope or the approval policy on its own say-so. Writes need a
// role session (the role comes from its marker); without one they are refused.
// Exit codes: 0 ok; 1 refused; 2 usage.
const Goal = require('./lib/goal.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: goal.js show [--json] | goal.js set <field> <value> --record <dec-id> | goal.js pause --trigger andon:<failed evidence row id>';

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

// judged: the typed judge's goal_instruction answer for a set ({ p, model }), asked by the CLI when the
// judge is on (see judgeFor); undefined means the judge is off and the rule alone decides.
function main(argv, { cwd = process.cwd(), env = process.env, now, who: given, verifyRecord, bd, judged } = {}) {
  const a = parse(argv);
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'goal.js: no project found; pass --project <root>' };
  const [cmd, field, value] = a._;
  if (cmd === 'show') {
    if (a.json) {
      const g = Goal.read(who.root);
      const values = Object.fromEntries([...Object.keys(Goal.FIELDS).filter((f) => !Goal.FIELDS[f].op), 'scope'].map((f) => [f, Goal.value(who.root, f, { g, verifyRecord, warn: false })]));
      return { code: 0, out: JSON.stringify({ values, fields: g.fields, pause: Goal.activePause(who.root, { verifyRecord, beadOf: beadReader(who, bd) }) }, null, 2) };
    }
    return { code: 0, out: Goal.showLines(who.root, { verifyRecord, beadOf: beadReader(who, bd) }).join('\n') };
  }
  if (cmd === 'set' && field && value !== undefined) {
    const fix = `\`operator.js record --cite <in-id> --quote '<the owner's words>' --statement '<...>' --goal ${field}=${value}\`, then \`goal.js set ${field} ${value} --record <dec-id>\``;
    if (!Goal.writersOf(field).includes(who.roleId)) return { code: 1, out: `goal.js: ${field} changes only on the owner's word, recorded by the Chief of Staff.\nMessage the Chief of Staff.` };
    if (!a.record) return { code: 1, out: `goal.js: ${field} changes only on the owner's word.\nRecord it for this change: ${fix}` };
    const r = Goal.set({ root: who.root, who, field, value, record: a.record, verifyRecord, judged, now });
    if (!r.ok) return { code: 1, out: `goal.js: refused: ${r.error}.\nAsk the owner in your next briefing; record it for this change: ${fix}` };
    return { code: 0, out: `${field} = ${Array.isArray(r.entry.value) ? r.entry.value.join(', ') : r.entry.value} under ${a.record}` };
  }
  if (cmd === 'pause' && a.trigger) {
    if (!Goal.TRIGGER_WRITERS.includes(who.roleId)) return { code: 1, out: 'goal.js: a trigger pause is the Delivery Manager\'s.\nMessage the Delivery Manager.' };
    const m = /^andon:ev-(.+)-\d+$/.exec(a.trigger);
    let bead = null;
    if (m) { try { bead = (bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 })).show(m[1]); } catch (err) { bead = null; } }
    if (m && !bead) return { code: 1, out: `goal.js: refused: bead ${m[1]} cannot be read, so its evidence cannot be checked.\nCheck it: \`bd show ${m[1]}\`` };
    const r = Goal.pauseOnTrigger({ root: who.root, who, trigger: a.trigger, bead, now });
    if (!r.ok) return { code: 1, out: `goal.js: refused: ${r.error}.\nA pause needs a failed check row or the owner's word: \`goal.js pause --trigger andon:<ev-row-id>\`` };
    return { code: 0, out: `paused on ${a.trigger}; it lifts when the trigger closes` };
  }
  return { code: 2, out: USAGE };
}

function beadReader(who, bd) {
  return (id) => (bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 })).show(id);
}

// The second key (two-key rule): with the typed judge on, ask goal_instruction about the record's quote.
// Off, refused or failed: undefined when the judge is off (the rule alone decides); a failed call counts
// as p 0, so a change never passes on a judge that did not answer.
async function judgeFor(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const a = parse(argv);
  const [cmd, field, value] = a._;
  if (cmd !== 'set' || !a.record) return undefined;
  const who = whoAmI({ cwd, env, project: a.project });
  const judge = require('./lib/judge.js');
  const cfg = judge.judgeConfig(who.team, env);
  if (!cfg.enabled) return undefined;
  const quote = Goal.recordQuote(who.root, a.record);
  const r = await judge.ask('goal_instruction', { quote: quote || '', field, value }, { config: cfg, env, projectRoot: who.root, gate: 'goal.js' });
  return { p: typeof r.p === 'number' ? r.p : 0, model: r.model || null };
}

if (require.main === module) {
  (async () => {
    let r;
    try { r = main(process.argv.slice(2), { judged: await judgeFor(process.argv.slice(2)) }); } catch (err) { r = { code: 2, out: `goal.js: ${err.message}\n${USAGE}` }; }
    (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
    process.exitCode = r.code;
  })();
}

module.exports = { main, judgeFor };
