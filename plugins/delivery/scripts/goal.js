#!/usr/bin/env node
// scripts/goal.js — the goal sheet's constraint fields (lib/goal.js) at the command line (R-42).
//   goal.js show [--json] [--project <root>]
//   goal.js ask <field> <value>                        records goal.js's own question for the change (Yes/No)
//   goal.js set <field> <value> --record <dec-id>     on the owner's yes to that question, recorded with
//                                                       operator.js record --answers <q> --goal <field>=<value>;
//                                                       free text only with the typed judge's yes as well
//   goal.js pause --trigger andon:<ev-row-id>          a failed check row pauses work until a pass follows
// No role sets a budget, a pause, the scope or the approval policy on its own say-so. Writes need a
// role session (the role comes from its marker); without one they are refused.
// Exit codes: 0 ok; 1 refused; 2 usage.
const Goal = require('./lib/goal.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: goal.js show [--json] | goal.js ask <field> <value> | goal.js set <field> <value> --record <dec-id> | goal.js pause --trigger andon:<failed evidence row id>';

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
function main(argv, { cwd = process.cwd(), env = process.env, now, who: given, verifyRecord, bd, judged, recordQuestion } = {}) {
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
  if (cmd === 'ask' && field && value !== undefined) {
    // the question is worded here, never by the session, so a yes means exactly this change
    if (!Goal.writersOf(field).includes(who.roleId) || who.roleId !== 'chief-of-staff') return { code: 1, out: 'goal.js: the Chief of Staff asks the owner about a goal change.\nMessage the Chief of Staff.' };
    const text = Goal.questionText(field, value);
    if (!text) return { code: 1, out: `goal.js: refused: ${field} ${value} is not a goal change (fields: ${Object.keys(Goal.FIELDS).join(', ')}).\nSee the fields: \`goal.js show\`` };
    let q;
    try { q = (recordQuestion || operatorAsk(who))({ text, field, value }); } catch (err) { return { code: 1, out: `goal.js: the question was not recorded (${String(err.message).split('\n')[0]}).\nRetry: \`goal.js ask ${field} ${value}\`` }; }
    const payload = JSON.stringify({ questions: [{ question: text, header: 'Goal change', multiSelect: false, options: [{ label: 'Yes', description: 'Make this change' }, { label: 'No', description: 'Leave it as it is' }] }] });
    return { code: 0, out: `Ask the owner exactly: "${text}" (Yes / No). Question ${q}. AskUserQuestion input:\n${payload}\nRecord the yes: \`operator.js record --cite <in-id> --quote '<their answer>' --statement '<the change>' --answers ${q} --goal ${field}=${value}\`, then \`goal.js set ${field} ${value} --record <dec-id>\`` };
  }
  if (cmd === 'set' && field && value !== undefined) {
    const fix = `ask the owner: \`goal.js ask ${field} ${value}\``;
    if (!Goal.writersOf(field).includes(who.roleId)) return { code: 1, out: `goal.js: ${field} changes only on the owner's word, recorded by the Chief of Staff.\nMessage the Chief of Staff.` };
    if (!a.record) return { code: 1, out: `goal.js: ${field} changes only on the owner's yes to goal.js's question.\nTo change it, ${fix}` };
    const r = Goal.set({ root: who.root, who, field, value, record: a.record, verifyRecord, judged, now });
    if (!r.ok) return { code: 1, out: `goal.js: refused: ${r.error}.\nTo change it, ${fix}` };
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

// operator.js ask from this role session (its own checks, records and publish); returns the q- id
function operatorAsk(who) {
  return ({ text }) => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [require('path').join(__dirname, 'operator.js'), 'ask', '--text', text, '--asker', who.instance, '--options', 'Yes|No', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const j = JSON.parse(out.trim().split('\n').pop());
    if (!j.ok || !j.id) throw new Error(j.error || j.message || 'operator.js ask refused');
    return j.id;
  };
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
