#!/usr/bin/env node
// scripts/host-manager.js — the host manager: one role session per machine, opened by the owner from their
// Claude app, that says which role sessions and host jobs of every product team on this machine are down
// and brings them back; lib/host-manager.js holds the rules.
//   host-manager.js status [--json]     per team: how many of its role sessions run, which are down, which
//                                       hold work; per host job unit: running, or stopped since when; a
//                                       source that cannot be read is a SOURCE UNAVAILABLE line, never
//                                       counted as running
//   host-manager.js restart [--json]    starts each stopped host job (its timer and path units, and one run
//                                       of its service), then each team's missing role sessions that hold
//                                       work (team-revive.js, its caps applying), and replies from a read
//                                       made after it: what came back, what did not and why
//   host-manager.js tick                the unattended pass its timer runs every 5 minutes: a silence of 30
//                                       minutes (an instance holding work with no bead note and no wake, a
//                                       host job with no pass) is a restart and one alert for the owner per
//                                       outage, kept in an outage ledger in the user's state directory
//   host-manager.js install [--dry-run] --project <root> [--instance <id>]
//                                       the systemd user units: delivery-host-manager.service (the Remote
//                                       Control session, restarted always) and the tick's service and timer
// The teams are the host file (${XDG_CONFIG_HOME:-~/.config}/delivery/host-teams.json, which each install
// adds its project to) together with every installed watchdog host job. In a role session only the host
// manager runs restart and tick; install runs outside any role session. Exit codes: 0 ok (something down
// is not an error); 1 refused or not installed; 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HM = require('./lib/host-manager.js');
const R = require('./lib/team-revive.js');
const M = require('./lib/manifest.js');

const USAGE = 'usage: host-manager.js status [--json] | host-manager.js restart [--json] | host-manager.js tick | host-manager.js install [--dry-run] --project <root> [--instance <id>]';
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const RESTART_SEC = 30;
// its own unit, so not inside a watchdog job's cgroup: a Remote Control session and the tools it runs
// need far more tasks than a capped host job allows. KillMode=process on both services: the role
// sessions a restart starts are children of the unit that ran it, and a restart of the host manager (or
// the end of a tick's oneshot run) must not take the team down with it.
const TASKS_MAX = 4096;

function parse(argv) {
  const o = { _: [], json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--project' || a === '--instance') { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

const firstLine = (err) => String((err && (err.stderr || err.message)) || err).trim().split('\n')[0].slice(0, 200);
const runner = (exec) => exec || ((cmd, args) => require('child_process').execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }));
const whichOf = (has) => has || ((cmd) => { try { require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (err) { return false; } });
const WD = () => require('./watchdog.js');
const jobUnits = (root) => { const tag = WD().tagOf(root); return { timer: `delivery-watchdog-${tag}.timer`, path: `delivery-watchdog-${tag}.path`, service: `delivery-watchdog-${tag}.service` }; };

function readUnit(run, unit) {
  try {
    return HM.unitState(unit, HM.parseShow(run('systemctl', ['--user', 'show', unit, '--no-pager', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'InactiveEnterTimestamp', '-p', 'StateChangeTimestamp'])));
  } catch (err) { return { unit, unavailable: `systemctl --user show failed: ${firstLine(err)}` }; }
}

// One read of the whole machine. deps: env, home, exec (systemctl), has, live (`claude agents`), teamDeps
// (root -> what team-revive's gather takes in a test: bd, prs, alive, pause, configDir, hostname).
function read({ env = process.env, home = os.homedir(), exec, has, live, teamDeps } = {}) {
  const TR = require('./team-revive.js');
  const unavailable = [];
  const fromFile = HM.readHostTeams(HM.hostFile(env, home));
  if (fromFile.unreadable) unavailable.push(`the host's team list (${fromFile.unreadable})`);
  const roots = HM.teamRoots(fromFile.teams, HM.unitRoots(HM.unitDir(home)));
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const sessions = live !== undefined ? live : WD().liveSessions(bin, env);
  const systemd = whichOf(has)('systemctl');
  const run = runner(exec);
  if (!systemd) unavailable.push('the host job units (no systemctl on this host)');
  const teams = [];
  const units = [];
  for (const root of roots) {
    let team = null;
    try { team = M.loadManifest(root).team; } catch (err) { teams.push({ root, name: path.basename(root), manifestUnavailable: firstLine(err) }); continue; }
    let f;
    let a;
    try { f = TR.gather(root, team, { env, live: sessions, ...(teamDeps ? teamDeps(root) : {}) }); a = R.assess(f); } catch (err) { teams.push({ root, name: (team && team.project) || path.basename(root), manifestUnavailable: `its records could not be read: ${firstLine(err)}` }); continue; }
    const t = HM.teamState(root, a, f);
    Object.defineProperty(t, 'facts', { value: f, enumerable: false });
    Object.defineProperty(t, 'team', { value: team, enumerable: false });
    teams.push(t);
    if (!systemd) continue;
    const j = jobUnits(root);
    const timer = { ...readUnit(run, j.timer), job: true, team: t.name, root, service: j.service };
    units.push(timer);
    const p = { ...readUnit(run, j.path), job: true, team: t.name, root };
    if (p.loaded || p.unavailable) units.push(p);
  }
  if (systemd) for (const u of [HM.UNIT, HM.TICK_TIMER]) { const s = readUnit(run, u); if (s.loaded || s.unavailable) units.push(s); }
  return { teams, units, unavailable, live: sessions };
}

function status(deps) {
  const r = read(deps);
  return { read: r, lines: HM.statusLines(r) };
}

// Why a missing instance the restart wanted was not started, from its start pass.
function whyNot(a, i) {
  if (a.locked) return 'another start pass holds the start lock; it starts what is missing';
  if (i.skip) return `not started: ${i.skip}`;
  if (i.held) return `held by the start caps: ${i.held}`;
  if (a.paused) return 'paused by the owner';
  if (!a.inFlight) return 'no work in flight in what could be read';
  if (!a.go) return 'the open sessions could not be read';
  return 'not started';
}

// The restart, from a read already made (the tick's) or a new one.
// restart, tick and install refuse a caller in a role session other than the host manager's, whoever
// calls them: main(), or code that loads this module
function guard(cmd, deps) {
  const cwd = deps.cwd || process.cwd();
  const env = deps.env || process.env;
  let who = deps.who;
  if (!who) {
    who = { roleId: null };
    try { const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js'); const v = validMarker(findRoleMarker(cwd)); if (v) who = { roleId: v.role.id }; } catch (err) { who = { roleId: null }; }
  }
  return refusal(cmd, cwd, env, who);
}

function restart(deps = {}, before) {
  const no = guard('restart', deps);
  if (no) throw new Error(no);
  if (!before) before = read(deps);
  const TR = require('./team-revive.js');
  const run = runner(deps.exec);
  const plan = HM.restartPlan(before);
  const jobErrors = {};
  for (const unit of plan.jobs) { try { run('systemctl', ['--user', 'start', unit]); } catch (err) { jobErrors[unit] = firstLine(err); } }
  // one pass of each restarted job at once, not at its next timer tick; --no-block: a run takes minutes
  for (const u of before.units.filter((x) => x.service && plan.jobs.includes(x.unit))) { try { run('systemctl', ['--user', 'start', '--no-block', u.service]); } catch (err) { jobErrors[u.unit] = jobErrors[u.unit] || `its service did not start: ${firstLine(err)}`; } }
  const refused = {};
  for (const [root, want] of Object.entries(plan.instances)) {
    const t = before.teams.find((x) => x.root === root);
    refused[root] = {};
    let r;
    try { r = TR.revive(root, t.team, { start: true, cwd: deps.cwd, env: deps.env || process.env, live: before.live, only: want, ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.teamDeps ? deps.teamDeps(root) : {}) }); } catch (err) { for (const i of want) refused[root][i] = `the start failed: ${firstLine(err)}`; continue; }
    for (const i of r.a.missing) if (want.includes(i.instance) && !r.started[i.instance]) refused[root][i.instance] = whyNot(r.a, i);
  }
  const after = read(deps);
  return { plan, before, after, lines: HM.restartLines(before, after, plan, { refused, jobErrors }) };
}

// The alert goes to the host manager's own session: a message kept in its team's inbox (lib/inbox.js),
// which that team's watchdog hands to the session as a wake. Returns the instances it was queued for.
function deliverAlert(read, text, env) {
  const out = [];
  for (const t of read.teams) {
    if (t.manifestUnavailable || !t.team) continue;
    const host = t.facts && t.facts.host;
    for (const i of M.expandInstances(t.team).filter((x) => !(x.role && x.role.retired) && M.canonicalRoleId(x.role.id) === HM.ROLE && (!host || x.role.host === host))) {
      try { if (require('./lib/inbox.js').queue(t.root, { to: i.instance, from: 'host-manager tick', summary: 'the team went silent and was restarted', message: text })) out.push(`${t.name} ${i.instance}`); } catch (err) { /* the row below still records the alert */ }
    }
  }
  return out;
}

// The time of a team's last host job pass: its job log is written by every run (watchdog.js jobFiles)
function lastPassOf(root) { try { return fs.statSync(path.join(root, '.delivery', 'watchdog', 'job.log')).mtimeMs; } catch (err) { return null; } }

function tick(deps = {}) {
  const no = guard('tick', deps);
  if (no) throw new Error(no);
  const env = deps.env || process.env;
  const home = deps.home || os.homedir();
  const now = deps.now || new Date().toISOString();
  const before = read(deps);
  const WDL = require('./lib/watchdog.js');
  const facts = {};
  for (const t of before.teams) {
    if (t.manifestUnavailable) continue;
    const timer = before.units.find((u) => u.root === t.root && u.service);
    facts[t.root] = { inProgress: t.facts.inProgress, wakes: WDL.logRows(t.root).filter((r) => r.type === 'wake'), lastPass: (deps.lastPass || lastPassOf)(t.root), jobInstalled: Boolean(timer && timer.loaded) };
  }
  const silent = HM.silences(before, facts, now);
  const file = HM.outageFile(env, home);
  const open = HM.openOutage(HM.readLedger(file));
  if (!silent.length) {
    if (open) HM.appendRow(file, { type: 'close', at: now, outage: open.id });
    return { code: 0, out: `${now} host manager: nothing silent${open ? `; the outage open since ${open.at} is over` : ''}.`, silent };
  }
  const r = restart(deps, before);
  if (open) return { code: 0, out: [`${now} host manager: still silent, in the outage open since ${open.at} (the owner was alerted then): ${silent.map((s) => s.what).join('; ')}.`, ...r.lines].join('\n'), silent };
  const outage = HM.appendRow(file, { type: 'open', id: `out-${Date.parse(now) || Date.now()}`, at: now, silent: silent.map((s) => s.what) });
  const text = HM.alertText(silent, r.lines);
  const to = deliverAlert(r.after, text, env);
  HM.appendRow(file, { type: 'alert', at: now, outage: outage.id, text, delivered_to: to });
  return { code: 0, out: [`${now} host manager: silent: ${silent.map((s) => s.what).join('; ')}.`, ...r.lines, `Alert: ${text}`, to.length ? `Sent to ${to.join(', ')} (its team's inbox; that team's watchdog hands it to the session).` : `No host manager instance is in any team on this host: the alert is in ${file} only.`].join('\n'), silent };
}

// ---- install: the systemd user units ----

function hostManagerOf(root, team, host, instance) {
  const all = M.expandInstances(team).filter((x) => !(x.role && x.role.retired) && M.canonicalRoleId(x.role.id) === HM.ROLE);
  if (instance) return all.find((x) => x.instance === instance) || null;
  return all.find((x) => x.role.host === host) || null;
}
// the role directory, as team-revive.js finds it: the roster's, else the team layout's
function roleDirOf(root, team, instance) {
  let e = {};
  try { e = require('./lib/roster.js').readRoster(root).instances[instance] || {}; } catch (err) { e = {}; }
  return { roleDir: e.role_dir || path.join(root, '..', `${team.project}-team`, instance), remote: e.remote_session_id || null };
}

function unitFiles(root, team, instance, { env, home, host, roleDir, sessionId }) {
  const W = WD();
  const dir = HM.unitDir(home);
  const PATH = W.jobPath(env, home);
  const config = env.CLAUDE_CONFIG_DIR || null;
  const m = R.modeOf(team);
  const args = ['remote-control', '--name', `${instance}@${host}`, ...(sessionId ? ['--session-id', sessionId] : ['--spawn', 'session']), ...(m.mode ? ['--permission-mode', m.mode] : [])];
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  // the directories the ledger and the host file are found by: a unit started by systemd has neither
  // variable unless the unit sets it, so one set at install is carried into the units, and the unit, the
  // owner's shell and the ledger agree on one place
  const xdg = ['XDG_STATE_HOME', 'XDG_CONFIG_HOME'].filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  const vars = [`PATH=${PATH}`, `DELIVERY_ROLE=${instance}`, `DELIVERY_HOST=${host}`, ...(config ? [`CLAUDE_CONFIG_DIR=${config}`] : []), ...xdg];
  const env1 = vars.map((v) => `Environment=${W.sdq(v)}\n`).join('');
  const launcher = require('./lib/launcher.js').launcherPath(root);
  const log = path.join(HM.stateDir(env, home), 'tick.log');
  return {
    args,
    stateDir: HM.stateDir(env, home),
    modeSkip: m.skip || null,
    files: [
      { file: path.join(dir, HM.UNIT), body: `[Unit]\nDescription=delivery host manager: the Remote Control session ${sdName(instance, host)} for every product team on this machine\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=0\n\n[Service]\nType=simple\nWorkingDirectory=${W.sdPct(roleDir)}\n${env1}ExecStart=/usr/bin/env ${[bin, ...args].map(W.sdq).join(' ')}\nKillMode=process\nRestart=always\nRestartSec=${RESTART_SEC}\nTasksMax=${TASKS_MAX}\n\n[Install]\nWantedBy=default.target\n` },
      { file: path.join(dir, HM.TICK_SERVICE), body: `[Unit]\nDescription=delivery host manager: the unattended pass over every product team on this machine\n\n[Service]\nType=oneshot\nKillMode=process\nTasksMax=${TASKS_MAX}\nWorkingDirectory=${W.sdPct(root)}\n${vars.filter((v) => !v.startsWith('DELIVERY_ROLE=')).map((v) => `Environment=${W.sdq(v)}\n`).join('')}ExecStart=/usr/bin/env ${['node', launcher, 'host-manager.js', 'tick'].map(W.sdq).join(' ')}\nStandardOutput=append:${W.sdPct(log)}\nStandardError=append:${W.sdPct(log)}\n` },
      { file: path.join(dir, HM.TICK_TIMER), body: `[Unit]\nDescription=delivery host manager: its pass every 5 min\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=5min\n\n[Install]\nWantedBy=timers.target\n` },
    ],
    commands: [['systemctl', ['--user', 'daemon-reload']], ['systemctl', ['--user', 'enable', '--now', HM.UNIT]], ['systemctl', ['--user', 'enable', '--now', HM.TICK_TIMER]]],
  };
}
const sdName = (instance, host) => `${instance}@${host}`.replace(/%/g, '%%');

// Lingering: without it a user unit starts only when the user logs in, not at boot. Reported, never run:
// enabling it is the machine's own setup.
function lingerLine(run, env) {
  const user = env.USER || env.LOGNAME || (() => { try { return os.userInfo().username; } catch (err) { return ''; } })();
  let out = '';
  try { out = run('loginctl', ['show-user', user, '-p', 'Linger']); } catch (err) { return `Whether lingering is on for ${user || 'this user'} could not be read (${firstLine(err)}): without it the host manager starts at login, not at boot (loginctl enable-linger ${user || '$USER'}).`; }
  return /Linger=yes/.test(out) ? null : `Lingering is off for ${user}: the host manager starts at login, not at boot, until this is run once on this machine: loginctl enable-linger ${user}`;
}

// install(root, o, deps) -> { code, out }. Used by host-manager.js install and by watchdog.js install
// (when the units are missing), so a team's first install also brings the host manager.
function install(root, o = {}, { env = process.env, home = os.homedir(), exec, has, hostname, cwd, who } = {}) {
  const no = guard('install', { cwd, env, who });
  if (no) return { code: 1, out: no };
  if (!whichOf(has)('systemctl')) return { code: 1, out: 'host-manager.js: this host has no systemctl, so the host manager\'s units cannot be installed here; nothing was installed.' };
  let team;
  try { team = M.loadManifest(root).team; } catch (err) { return { code: 1, out: `host-manager.js: the team at ${root} could not be read (${firstLine(err)}); nothing was installed.` }; }
  const host = R.hostOf(env, hostname !== undefined ? hostname : os.hostname());
  const hm = hostManagerOf(root, team, host, o.instance);
  if (!hm) return { code: 1, out: `host-manager.js: team.json of ${root} has no host manager${o.instance ? ` instance ${o.instance}` : ` on host "${host}"`} (Staffing adds it: team-role.js add host-manager), so its session has no role directory; nothing was installed.` };
  const { roleDir, remote } = roleDirOf(root, team, hm.instance);
  if (!fs.existsSync(roleDir)) return { code: 1, out: `host-manager.js: the host manager's role directory ${roleDir} is not prepared on this host (prepare-role.js --instance ${hm.instance} prepares it); nothing was installed.` };
  const pointer = R.pointerOf(R.configDirOf(env, home), roleDir);
  const sessionId = (pointer && pointer.sessionId) || (/^[A-Za-z0-9_-]{1,128}$/.test(String(remote || '')) ? remote : null);
  const u = unitFiles(root, team, hm.instance, { env, home, host, roleDir, sessionId });
  if (u.modeSkip) return { code: 1, out: `host-manager.js: ${u.modeSkip}; nothing was installed.` };
  const run = runner(exec);
  const file = HM.hostFile(env, home);
  const lines = [];
  const head = `The host manager ${hm.instance}@${host} runs as ${HM.UNIT} in ${roleDir} (Restart=always, started at boot), and ${HM.TICK_TIMER} runs host-manager.js tick every 5 minutes. Teams it serves: ${file}, and every installed watchdog host job.`;
  if (o.dryRun) {
    lines.push(`Dry run. ${head}`, `Would add ${root} to ${file}.`);
    for (const f of u.files) lines.push(`Would write ${f.file}:`, f.body.trimEnd());
    for (const [cmd, args] of u.commands) lines.push(`Would run: ${cmd} ${args.join(' ')}`);
    const l = lingerLine(run, env);
    if (l) lines.push(l);
    lines.push('Nothing was written.');
    return { code: 0, out: lines.join('\n') };
  }
  try {
    if (HM.addHostTeam(file, root)) lines.push(`Added ${root} to ${file}`);
    const lp = require('./lib/launcher.js').ensureLauncher(root, PLUGIN_ROOT, env.CLAUDE_CONFIG_DIR);
    if (lp) throw new Error(lp);
    for (const f of u.files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.body); lines.push(`Wrote ${f.file}`); }
    // before the units are enabled: systemd opens the tick's StandardOutput=append: file itself and
    // fails the service (status 209/STDOUT) when its directory is missing
    fs.mkdirSync(u.stateDir, { recursive: true });
    for (const [cmd, args] of u.commands) { run(cmd, args); lines.push(`Ran: ${cmd} ${args.join(' ')}`); }
  } catch (err) { return { code: 1, out: `${lines.join('\n')}\nhost-manager.js: not installed (${firstLine(err)})`.trim() }; }
  lines.push(`Installed. ${head}`);
  const l = lingerLine(run, env);
  if (l) lines.push(l);
  return { code: 0, out: lines.join('\n') };
}

// restart and tick start sessions and host jobs: in a role session they are the host manager's alone.
// install changes the machine's own units: never from a role session.
function refusal(cmd, cwd, env, who) {
  const role = WD().roleContext(cwd, env);
  if (!role) return null;
  if (cmd === 'install') return `host-manager.js: install writes this machine's user units and runs from a shell outside any role session (${role}); watchdog.js install --apply runs it too.`;
  const id = (who && who.roleId) || env.DELIVERY_ROLE_ID || M.canonicalRoleId(env.DELIVERY_ROLE) || null;
  if (id === HM.ROLE) return null;
  return `host-manager.js: ${cmd} is the host manager's (${role}${id ? `, role ${id}` : ''}); message the host manager with what is down.`;
}

function main(argv, { cwd = process.cwd(), env = process.env, who, ...deps } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `host-manager.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['status', 'restart', 'tick', 'install'].includes(cmd) || o._.length > 1) return { code: 2, out: USAGE };
  if (cmd !== 'status') {
    const me = who || (() => { try { return require('./lib/gate-context.js').whoAmI({ cwd, env }); } catch (err) { return {}; } })();
    const no = refusal(cmd, cwd, env, me);
    if (no) return { code: 1, out: no };
  }
  const d = { env, cwd, who, ...deps };
  if (cmd === 'install') {
    if (!o.project) return { code: 2, out: `host-manager.js: install needs --project <root> (the team whose manifest holds the host manager)\n${USAGE}` };
    return install(path.resolve(o.project), o, d);
  }
  if (cmd === 'status') {
    const r = status(d);
    return { code: 0, out: o.json ? JSON.stringify({ teams: r.read.teams, units: r.read.units, unavailable: r.read.unavailable }, null, 2) : r.lines.join('\n') };
  }
  if (cmd === 'restart') {
    const r = restart(d);
    return { code: 0, out: o.json ? JSON.stringify({ plan: r.plan, lines: r.lines, teams: r.after.teams, units: r.after.units, unavailable: r.after.unavailable }, null, 2) : r.lines.join('\n') };
  }
  return tick(d);
}

module.exports = { main, read, status, restart, tick, install, unitFiles, refusal, deliverAlert, lastPassOf };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `host-manager.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}
