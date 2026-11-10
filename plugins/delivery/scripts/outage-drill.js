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
// the host this drill would cut: the one the consent must name
const hostOf = (env) => require('./lib/team-revive.js').hostOf(env);

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

// The consent: the owner's own record, read as operator.js verify reads it (no ledger write), and for this
// drill only. Any verified owner record (a budget, an approval of a pull request) would otherwise cut the
// network and restart the machine, so, as prepare-role scopes an approved permission rule:
//   - the record's scope carries the label outage-drill:<this host>. The recording agent writes the
//     scope, so the label alone is not enough:
//   - the owner's own words name the network cut and the restart, with no negation. Those words are the
//     verified quote, or, when the owner answered a confirmation, the question they were shown and the
//     answer they picked, captured with their input (the answer must be the input itself). The scope
//     and the statement the agent wrote never count as the owner's words.
const DRILL_LABEL = (host) => `outage-drill:${host}`;
const CUT = /\bnetwork\b[^.?!]*\b(?:cut|off|down|disconnect\w*)\b|\b(?:cut|disconnect\w*)\b[^.?!]*\bnetwork\b/i;
const RESTART = /\b(?:restart\w*|reboot\w*)\b/i;
// fails closed: without the negation lexicon no words are taken as a yes
const negated = (q) => { let neg; try { ({ hasNegation: neg } = require('./lib/operator-records.js')); } catch (err) { return true; } return typeof neg !== 'function' || neg(String(q || '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLowerCase(), { before: false }); };
function consent(root, id, verifyRecord, host) {
  const verify = verifyRecord || require('./lib/operator-records.js').verifyRecord;
  let chain = [];
  const v = ownerRecord(root, id, (r, i) => { const out = verify(r, i, { noLedger: true }); chain = (out && Array.isArray(out.chain)) ? out.chain : []; return out; });
  if (!v.ok) return v;
  const want = DRILL_LABEL(host);
  const labels = (v.head && v.head.scope && Array.isArray(v.head.scope.labels)) ? v.head.scope.labels : [];
  if (!host || !labels.includes(want)) return { ok: false, why: `${id} is not scoped to a drill on this host (its scope needs the label ${want})` };
  const asked = chain.filter((h) => h && h.kind === 'input' && h.source === 'human' && h.asked && h.asked.contract === 'delivery.confirmation/1'
    && h.asked.multi_select !== true && String(h.asked.answer || '').trim() === String(h.text || '').trim());
  const answers = [v.quote, ...asked.map((h) => h.asked.answer)];
  if (answers.some(negated)) return { ok: false, why: `the owner's words in ${id} carry a negation, so they do not consent to the drill` };
  const said = [v.quote, ...asked.map((h) => h.asked.question)].join(' ');
  if (!CUT.test(said)) return { ok: false, why: `the owner's words in ${id} do not name the network cut` };
  if (!RESTART.test(said)) return { ok: false, why: `the owner's words in ${id} do not name the restart` };
  return v;
}

function plan(who, o, { env = process.env, now, verifyRecord, ps }) {
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
    const v = consent(who.root, o.record, verifyRecord, hostOf(env));
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
  const v = consent(who.root, o.record, verifyRecord, hostOf(env));
  if (!v.ok) return refuse(`refused: ${v.why}; nothing scheduled or cut`);
  const used = L.drillOf(who.root, o.record);
  if (used) return refuse(`refused: ${o.record} was already used for a drill started ${used.started_at}; one drill per consent, nothing scheduled or cut`);
  // Two runs at once would both find no row and both schedule a restart: the record is claimed first, by
  // an exclusive create beside the ledger. A claim never goes stale: once a run gets past its schedule
  // the record is spent anyway (one drill per consent); a run that fails before its row gives it back.
  const fs = require('fs');
  const path = require('path');
  const claim = path.join(path.dirname(L.ledgerFile(who.root)), `drill-${String(o.record).replace(/[^A-Za-z0-9._-]/g, '_')}.claim`);
  try { fs.mkdirSync(path.dirname(claim), { recursive: true }); fs.writeFileSync(claim, `${now}\n`, { flag: 'wx' }); } catch (err) {
    return refuse(err.code === 'EEXIST' ? `refused: another run on ${o.record} is under way or done; one drill per consent, nothing scheduled or cut` : `refused: the record could not be claimed (${err.message}); nothing scheduled or cut`);
  }
  const unclaim = () => { try { fs.unlinkSync(claim); } catch (err) { /* already gone */ } };
  const cut = Number(o.cut);
  const after = L.RESTART_AFTER;
  const t = L.times(now, cut, after);
  const made = [];
  const undo = () => { for (const kind of made) { try { exec(L.stopArgs(kind, o.record, env)); } catch (err) { /* the timer may be gone */ } } unclaim(); };
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
    // A cut that exits non-zero or is killed at the exec's limit may still have taken the network down:
    // stopping the restore timer too would leave the host offline with nothing to bring it back. Only the
    // restart is stopped (first, so the host never restarts on a failed drill); the restore runs at once,
    // through the same privilege, so a half-done cut does not wait out the whole cut length; and the
    // restore timer stays as the backstop, for a restore that fails now or a cut that lands after it.
    try { exec(L.stopArgs('restart', o.record, env)); } catch (err) { /* the timer may be gone */ }
    let back;
    try { back = exec(L.restoreArgs(env)); } catch (err) { back = { status: null, error: err.message }; }
    const restored = !!back && back.status === 0;
    try { L.append(who.root, { type: 'cut_failed', record: o.record, at: now, why: failText(r), restore_now: restored ? 'ok' : 'failed' }); } catch (err) { /* the drill row stands */ }
    return { code: 1, out: `outage-drill.js: the cut failed (${failText(r)}); the restart timer is stopped and the host does not restart. ${restored ? 'The network restore ran at once' : `The network restore at once failed (${failText(back)})`}, and the restore timer stays: the network comes back by ${t.restore_at} (${row.units[0]}) whatever the cut did. The record is spent (one drill per consent).` };
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
  return cmd === 'plan' ? plan(who, o, { env, now: at, verifyRecord, ps }) : run(who, o, { env, now: at, verifyRecord, exec });
}

// Exports come first so a module that requires this file sees them even while main runs.
module.exports = { main, parse };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `outage-drill.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

