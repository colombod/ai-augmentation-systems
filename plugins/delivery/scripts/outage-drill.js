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
//     answer they picked, captured with their input (the answer must be the input itself); neither the
//     answer nor the question may carry a negation. The scope and the statement the agent wrote never
//     count as the owner's words.
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
  // the question counts as the owner's words for naming the cut and the restart, so it is held to the same
  // rule: a yes to "cut the network, but do not restart" is no consent to a cut and a restart
  if (asked.some((h) => negated(h.asked.question))) return { ok: false, why: `the question the owner answered in ${id} carries a negation, so a yes to it does not consent to the drill` };
  const said = [v.quote, ...asked.map((h) => h.asked.question)].join(' ');
  if (!CUT.test(said)) return { ok: false, why: `the owner's words in ${id} do not name the network cut` };
  if (!RESTART.test(said)) return { ok: false, why: `the owner's words in ${id} do not name the restart` };
  return v;
}

// Every claim beside the ledger. A run killed between its claim and its row (the session dropped, the host
// lost power) leaves its claim, and each later run on that record is refused: plan shows the claim, how old
// it is and which run made it, and how to clear it. Reads only.
function claimLines(root, now) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.dirname(L.ledgerFile(root));
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => L.CLAIM_RE.test(n)).sort(); } catch (err) { names = []; }
  if (!names.length) return ['  claims: none'];
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let made = null;
    try { made = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { made = null; }
    if (!made || typeof made !== 'object') made = {};
    let at = Number.isFinite(Date.parse(made.at)) ? new Date(Date.parse(made.at)).toISOString() : null;
    if (!at) { try { at = fs.statSync(file).mtime.toISOString(); } catch (err) { at = null; } }
    const record = typeof made.record === 'string' ? made.record : name.slice('drill-'.length, -'.claim'.length);
    const age = at ? `${Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 60000))} minutes ago (${at})` : 'at an unknown time';
    const by = made.by || made.pid ? `by ${made.by || 'an unknown actor'}${made.pid ? `, pid ${made.pid}` : ''}` : 'by an unknown run';
    const spent = L.drillOf(root, record);
    out.push(`  claim: ${record} claimed ${age} ${by}; ${spent ? 'its drill row spends the record, so clearing the claim does not free it' : 'a run on it is refused while the claim is there'}`);
    if (!spent) out.push(`    to clear it when no run on it is under way: rm ${file}`);
  }
  return out;
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
  lines.push(...claimLines(who.root, now));
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
// row is written, the cut runs. A schedule or row that fails stops there and stops the timers, so nothing
// is cut; a cut that fails never restarts the host and still brings the network back.
function run(who, o, { env, now, verifyRecord, exec, fs = require('fs') }) {
  const refuse = (why) => ({ code: 1, out: `outage-drill.js: ${why}` });
  const v = consent(who.root, o.record, verifyRecord, hostOf(env));
  if (!v.ok) return refuse(`refused: ${v.why}; nothing scheduled or cut`);
  const used = L.drillOf(who.root, o.record);
  if (used) return refuse(`refused: ${o.record} was already used for a drill started ${used.started_at}; one drill per consent, nothing scheduled or cut`);
  // Two runs at once would both find no row and both schedule a restart: the record is claimed first, by
  // an exclusive create beside the ledger. A run that fails before its row gives it back; once its row is
  // written the record is spent anyway (one drill per consent). A run killed between the two leaves the
  // claim, which plan shows with its age, its maker and how to clear it: it is never cleared on its own.
  // The claim says when and by which run it was made, so plan can show a claim left behind.
  const path = require('path');
  const claim = L.claimFile(who.root, o.record);
  const made_by = { record: o.record, at: now, by: who.actor || null, pid: process.pid };
  try { fs.mkdirSync(path.dirname(claim), { recursive: true }); fs.writeFileSync(claim, `${JSON.stringify(made_by)}\n`, { flag: 'wx' }); } catch (err) {
    return refuse(err.code === 'EEXIST' ? `refused: another run on ${o.record} is under way or done; one drill per consent, nothing scheduled or cut` : `refused: the record could not be claimed (${err.message}); nothing scheduled or cut`);
  }
  const unclaim = () => { try { fs.unlinkSync(claim); } catch (err) { /* already gone */ } };
  const cut = Number(o.cut);
  const after = L.RESTART_AFTER;
  const t = L.times(now, cut, after);
  const made = [];
  // A schedule reported as failed (non-zero, timed out, thrown) may still have made its unit, so the undo
  // also stops the kind that failed. Newest first: the restart is always stopped before the restore.
  const undo = (failed) => {
    for (const kind of [...made, ...(failed ? [failed] : [])].reverse()) { try { exec(L.stopArgs(kind, o.record, env)); } catch (err) { /* the timer may be gone */ } }
    unclaim();
  };
  const steps = [['restore', cut * 60, L.COMMANDS.restore], ['restart', (cut + after) * 60, L.COMMANDS.reboot]];
  for (const [kind, seconds, cmd] of steps) {
    let r;
    try { r = exec(L.timerArgs(kind, o.record, seconds, cmd, env)); } catch (err) { r = { status: null, error: err.message }; }
    if (!r || r.status !== 0) { undo(kind); return refuse(`could not schedule the ${kind} (${failText(r)}); nothing cut. The timers need the system manager: \`sudo -n\` must run systemd-run, or set DELIVERY_DRILL_PRIVILEGE`); }
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

// The role of the session this process runs in, read from the process's own environment and role marker,
// never from what a caller passes: main takes an injected who for its tests, so `node -e` or a script of
// its own could otherwise name itself the Reality Checker. null outside a role session (no DELIVERY_ROLE);
// a role session whose marker cannot be read is no Reality Checker.
function ownRole() {
  if (!process.env.DELIVERY_ROLE) return null;
  try {
    const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js');
    const valid = validMarker(findRoleMarker(process.cwd()));
    return (valid && valid.role && valid.role.id) || 'unknown';
  } catch (err) { return 'unknown'; }
}

function main(argv, { cwd = process.cwd(), env = process.env, now, verifyRecord, who: given, exec = spawnExec, ps = psList, fs } = {}) {
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
    // the lane gives run to the Reality Checker only and refuses it per command to every other role; a
    // run that gets past the lane some other way meets this, on both the given role and the process's own
    const own = ownRole();
    if (own !== null && own !== ROLE) return { code: 1, out: `outage-drill.js: run is the Reality Checker's (this process runs in a role ${own} session); outage-drill.js plan shows what it would do` };
    if (who.roleId !== ROLE) return { code: 1, out: `outage-drill.js: run is the Reality Checker's (${who.roleId ? `role ${who.roleId}` : 'no role session here'}); outage-drill.js plan shows what it would do` };
  }
  if (!who.root) return { code: 2, out: 'outage-drill.js: no project found; pass --project <root>' };
  return cmd === 'plan' ? plan(who, o, { env, now: at, verifyRecord, ps }) : run(who, o, { env, now: at, verifyRecord, exec, fs });
}

// Exports come first so a module that requires this file sees them even while main runs.
module.exports = { main, parse };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `outage-drill.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

