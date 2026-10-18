#!/usr/bin/env node
// scripts/warnings.js — the warnings ledger (lib/warnings.js) at the command line.
//   warnings.js list [--open] [--overdue] [--json] [--project <root>]
//   warnings.js ack <w-id> --reason '<why it is resolved or accepted>' [--project <root>]
// Only the Delivery Manager acknowledges: in a role session any other role is refused; outside a
// role session (the owner at a terminal) the acknowledgement is recorded as the operator's.
// Exit codes: 0 ok; 1 refused; 2 usage.
const W = require('./lib/warnings.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = "usage: warnings.js list [--open] [--overdue] [--json] | warnings.js ack <w-id> --reason '<why>'";

function parse(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--open', '--overdue', '--json'].includes(a)) out.flags.add(a.slice(2));
    else if (a === '--reason' || a === '--project') { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const line = (w) => `${w.id}  ${w.at}  ${w.rule || '-'}  ${w.kind}  ${w.bead || '-'}  ${w.detail}${w.acked_by ? `  [acked by ${w.acked_by}: ${w.ack_reason}]` : ''}`;

function main(argv, { cwd = process.cwd(), env = process.env, now } = {}) {
  const a = parse(argv);
  const who = whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'warnings.js: no project found; pass --project <root>' };
  const [cmd, id] = a._;
  if (cmd === 'list') {
    const all = W.list(who.root);
    const s = W.summary(all, now);
    let shown = a.flags.has('overdue') ? s.overdue : a.flags.has('open') ? all.filter((w) => !w.acked_by) : all;
    if (a.flags.has('json')) return { code: 0, out: JSON.stringify({ ...s, overdue: s.overdue.map((w) => w.id), warnings: shown }, null, 2) };
    const kinds = Object.entries(s.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    shown = shown.map(line);
    return { code: 0, out: [`Warnings: ${s.open} open, ${s.acked} acknowledged; ${s.overdue.length} open over ${W.OVERDUE_HOURS} h. Open by kind: ${kinds}`, ...shown].join('\n') };
  }
  if (cmd === 'ack' && id) {
    if (env.DELIVERY_ROLE && who.roleId !== 'delivery-lead') return { code: 1, out: `warnings.js: only the Delivery Manager acknowledges warnings (this session is ${who.roleId || env.DELIVERY_ROLE}); message the Delivery Manager with the warning id.` };
    const r = W.ack(who.root, { id, reason: a.reason, by: who.instance || 'operator', instance: who.instance || 'operator', now });
    return r.ok ? { code: 0, out: `acknowledged ${id}` } : { code: 1, out: `warnings.js: ${r.error}` };
  }
  return { code: 2, out: USAGE };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `warnings.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
