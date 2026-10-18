#!/usr/bin/env node
// scripts/owner-queue.js — the owner queue (lib/owner-queue.js) at the command line (R-07, R-44).
//   owner-queue.js add --kind signin|consent|payment|secret|account|decision --what '<one action>'
//     --where '<app or place>' --steps '<exact steps>' [--expect '<what they see>'] [--check '<read-back command>']
//     [--bead <id>] [--about scope|money|irreversible --question q-...]   (decision steps)
//   owner-queue.js list [--all] [--json]      the daily batch: every open step with its exact steps
//   owner-queue.js done <o-id>                after the owner says done; prints the read-back to run
// Only the Chief of Staff adds or closes steps, from its role session.
// Exit codes: 0 ok; 1 refused; 2 usage.
const Q = require('./lib/owner-queue.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = "usage: owner-queue.js add --kind <kind> --what '<one action>' --where '<place>' --steps '<exact steps>' [--expect ..] [--check ..] [--bead ..] [--about .. --question q-..] | list [--all] [--json] | done <o-id>";
const VALUE = ['--kind', '--what', '--where', '--steps', '--expect', '--check', '--bead', '--about', '--question', '--project'];

function parse(argv) {
  const out = { _: [], all: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all' || a === '--json') out[a.slice(2)] = true;
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

function questionChecker(root) {
  return (id) => {
    try { const r = require('./lib/operator-records.js').getRecord(root, id); return Boolean(r && r.kind === 'question'); } catch (err) { return false; }
  };
}

function main(argv, { cwd = process.cwd(), env = process.env, now, who: given, questionExists } = {}) {
  const a = parse(argv);
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'owner-queue.js: no project found; pass --project <root>' };
  const [cmd, id] = a._;
  if (cmd === 'list') {
    const steps = a.all ? Q.list(who.root) : Q.open(who.root);
    if (a.json) return { code: 0, out: JSON.stringify(steps, null, 2) };
    return { code: 0, out: (a.all ? steps.map((s) => `${s.id}  ${s.kind}  ${s.done_at ? `done ${s.done_at}` : 'open'}  ${s.what}`) : Q.batchLines(steps)).join('\n') };
  }
  if (cmd !== 'add' && !(cmd === 'done' && id)) return { code: 2, out: USAGE };
  if (who.roleId !== 'chief-of-staff') return { code: 1, out: 'owner-queue.js: the Chief of Staff keeps the owner queue.\nMessage the Chief of Staff with the exact step.' };
  if (cmd === 'add') {
    const r = Q.add(who.root, a, { instance: who.instance, now, questionExists: questionExists || questionChecker(who.root) });
    if (r.ok) return { code: 0, out: `${r.row.id}: queued for the owner's daily batch` };
    return { code: 1, out: `owner-queue.js: refused: ${r.error}.\n${r.team === 'check' ? 'Message the Delivery Manager: it plans a reality check (`reality-check.js plan <bead>`) and the Reality Checker runs it.' : r.team ? 'Message the Delivery Manager: the team does it.' : "Queue it with exact steps: `owner-queue.js add --kind <kind> --what '<one action>' --where '<place>' --steps '<exact steps>'`"}` };
  }
  const r = Q.done(who.root, id, { instance: who.instance, now });
  if (!r.ok) return { code: 1, out: `owner-queue.js: ${r.error}.\nSee the open steps: \`owner-queue.js list --all\`` };
  return { code: 0, out: r.step.check ? `${id} done. Check it now: ${r.step.check}` : `${id} done` };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `owner-queue.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
