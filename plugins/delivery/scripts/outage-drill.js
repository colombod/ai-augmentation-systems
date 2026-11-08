#!/usr/bin/env node
// scripts/outage-drill.js — one owner-consented outage drill on this host: the network is cut for up to
// 30 minutes and the host restarts once, so the team's recovery after an outage is seen working.
// lib/outage-drill.js holds the rules.
//   outage-drill.js plan [--cut-minutes <n>] [--record <id>]
//       read-only: the cut length, when the network comes back, when the host restarts, the consent
//       record and whether a drill already spent it, and whether a leftover headless claude child
//       (--print with --sdk-url) is running. Starts, schedules and writes nothing.
//   outage-drill.js run --record <id> --cut-minutes <n> --restart
//       the Reality Checker's only. The cut drops the session that runs it, so before the cut it makes
//       two transient system timers (systemd-run, owned by PID 1, outliving the session): the network
//       restore at n minutes and the restart m minutes later (default 1), then writes the drill's row
//       to the watchdog directory's drills.ndjson, and only then cuts. One drill per consent record.
// Exit codes: 0 ok; 1 refused or failed (nothing cut); 2 usage.
const L = require('./lib/outage-drill.js');
const { whoAmI, ownerRecord } = require('./lib/gate-context.js');

const USAGE = 'usage: outage-drill.js plan [--cut-minutes <n>] [--record <id>] | outage-drill.js run --record <id> --cut-minutes <n> --restart   (each takes --project <root>)';
const ROLE = 'reality-checker';
const VALUED = { '--cut-minutes': 'cut', '--record': 'record', '--project': 'project' };

function parse(argv) {
  const o = { _: [], restart: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--restart') o.restart = true;
    else if (VALUED[a]) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); o[VALUED[a]] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

const spawnExec = (args) => require('child_process').spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 30000 });
const psList = () => require('child_process').execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
const failText = (r) => String((r && (r.stderr || r.error)) || `exit ${r ? r.status : 'unknown'}`).trim().split('\n')[0].slice(0, 200);

// The consent: the owner's own record, read as operator.js verify reads it (no ledger write).
function consent(root, id, verifyRecord) {
  const verify = verifyRecord || require('./lib/operator-records.js').verifyRecord;
  return ownerRecord(root, id, (r, i) => verify(r, i, { noLedger: true }));
}

function plan(who, o, { now, verifyRecord, ps }) {
  const cut = o.cut === undefined ? String(L.MAX_CUT_MINUTES) : o.cut;
  const after = L.RESTART_AFTER;
  const bad = L.checkMinutes(cut);
  if (bad) return { code: 2, out: `outage-drill.js: ${bad}` };
  const t = L.times(now, Number(cut), after);
  const lines = ['Outage drill plan (nothing is started, scheduled or written):',
    `  network cut: ${cut} minutes, from the run (${t.started_at} if run now)`,
    `  network back: ${t.restore_at}`,
    `  host restart: ${t.restart_at} (${after} minute after the network is back)`,
    '  not covered: an offline gap longer than the cut (the consent is one cut of up to 30 minutes and one restart)'];
  if (!o.record) lines.push('  consent: no record named (pass --record <id>)');
  else {
    const v = consent(who.root, o.record, verifyRecord);
    lines.push(v.ok ? `  consent: ${o.record} verifies as the owner's word` : `  consent: ${o.record} refused: ${v.why}`);
    const used = L.drillOf(who.root, o.record);
    lines.push(used ? `  used: yes, a drill on it started ${used.started_at}; run is refused` : '  used: no drill on it yet');
  }
  let text = null;
  try { text = String(ps()); } catch (err) { text = null; }
  const left = text === null ? null : L.leftoverChildren(text);
  if (left === null) lines.push('  pre-flight: the process list could not be read (ps failed)');
  else if (!left.length) lines.push('  pre-flight: no leftover claude child with --print and --sdk-url is running');
  else lines.push(`  pre-flight: ${left.length} leftover claude child${left.length > 1 ? 'ren' : ''} with --print and --sdk-url running (pid ${left.map((p) => p.pid).join(', ')}); stop ${left.length > 1 ? 'them' : 'it'} before a reattach`);
  lines.push(`  to run: outage-drill.js run --record ${o.record || '<id>'} --cut-minutes ${cut} --restart`);
  return { code: 0, out: lines.join('\n') };
}

// Order: the record verifies, no drill spent it, the restore is scheduled, the restart is scheduled, the
// row is written, the cut runs. A step that fails stops there and undoes the timers made before it, so a
// failed schedule never cuts and a failed cut never restarts the host.
function run(who, o, { env, now, verifyRecord, exec }) {
  const refuse = (why) => ({ code: 1, out: `outage-drill.js: ${why}` });
  const v = consent(who.root, o.record, verifyRecord);
  if (!v.ok) return refuse(`refused: ${v.why}; nothing scheduled or cut`);
  const used = L.drillOf(who.root, o.record);
  if (used) return refuse(`refused: ${o.record} was already used for a drill started ${used.started_at}; one drill per consent, nothing scheduled or cut`);
  const cut = Number(o.cut);
  const after = L.RESTART_AFTER;
  const t = L.times(now, cut, after);
  const made = [];
  const undo = () => { for (const kind of made) { try { exec(L.stopArgs(kind, o.record, env)); } catch (err) { /* the timer may be gone */ } } };
  const steps = [['restore', cut * 60, L.COMMANDS.restore], ['restart', (cut + after) * 60, L.COMMANDS.reboot]];
  for (const [kind, seconds, cmd] of steps) {
    let r;
    try { r = exec(L.timerArgs(kind, o.record, seconds, cmd, env)); } catch (err) { r = { status: null, error: err.message }; }
    if (!r || r.status !== 0) { undo(); return refuse(`could not schedule the ${kind} (${failText(r)}); nothing cut. The timers need the system manager: \`sudo -n\` must run systemd-run, or set DELIVERY_DRILL_PRIVILEGE`); }
    made.push(kind);
  }
  const row = { type: 'drill', record: o.record, ...t, cut_minutes: cut, restart_after_minutes: after, units: made.map((k) => `${L.unitName(k, o.record)}.timer`), by: who.actor || null };
  try { L.append(who.root, row); } catch (err) { undo(); return refuse(`could not write the drill's row (${err.message}); timers stopped, nothing cut`); }
  let r;
  try { r = exec(L.cutArgs(env)); } catch (err) { r = { status: null, error: err.message }; }
  if (!r || r.status !== 0) {
    undo();
    try { L.append(who.root, { type: 'cut_failed', record: o.record, at: now, why: failText(r) }); } catch (err) { /* the drill row stands */ }
    return { code: 1, out: `outage-drill.js: the cut failed (${failText(r)}); both timers stopped, the host does not restart. The record is spent (one drill per consent).` };
  }
  return { code: 0, out: `Network cut at ${t.started_at} for ${cut} minutes: it comes back at ${t.restore_at} (${row.units[0]}) and the host restarts at ${t.restart_at} (${row.units[1]}). The drill's row is in ${require('path').relative(who.root, L.ledgerFile(who.root))}.` };
}

function main(argv, { cwd = process.cwd(), env = process.env, now, verifyRecord, who: given, exec = spawnExec, ps = psList } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `outage-drill.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['plan', 'run'].includes(cmd) || o._.length > 1) return { code: 2, out: USAGE };
  const at = now || new Date().toISOString();
  const who = given || whoAmI({ cwd, env, project: o.project });
  if (cmd === 'run') {
    if (!o.record) return { code: 2, out: `outage-drill.js: run needs --record <id>, the owner's consent\n${USAGE}` };
    const bad = L.checkMinutes(o.cut);
    if (bad) return { code: 2, out: `outage-drill.js: ${bad}` };
    if (!o.restart) return { code: 2, out: 'outage-drill.js: run needs --restart: the consent is a cut and one restart, never a cut alone' };
    // the lane gives run to the Reality Checker only; a role whose lane runs anything meets this
    if (who.roleId !== ROLE) return { code: 1, out: `outage-drill.js: run is the Reality Checker's (${who.roleId ? `role ${who.roleId}` : 'no role session here'}); outage-drill.js plan shows what it would do` };
  }
  if (!who.root) return { code: 2, out: 'outage-drill.js: no project found; pass --project <root>' };
  return cmd === 'plan' ? plan(who, o, { now: at, verifyRecord, ps }) : run(who, o, { env, now: at, verifyRecord, exec });
}

// Exports come first so a module that requires this file sees them even while main runs.
module.exports = { main, parse };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `outage-drill.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

