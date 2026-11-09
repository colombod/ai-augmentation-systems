#!/usr/bin/env node
// scripts/host-manager.js — the host manager: one role session per machine, opened by the owner from their
// Claude app, that says which role sessions and host jobs of every product team on this machine are down
// and brings them back; lib/host-manager.js holds the rules.
//   host-manager.js status [--json]     per team: how many of its role sessions run, which are down, which
//                                       hold work; per host job unit: running, or stopped since when; a
//                                       source that cannot be read is a SOURCE UNAVAILABLE line, never
//                                       counted as running
//   host-manager.js restart [--json]    starts each stopped host job (its timer and path units, and one run
//                                       of its service), one run of the service of a job whose timer runs
//                                       but which has run no pass for 30 minutes, then each team's missing
//                                       role sessions that hold work (team-revive.js, its caps applying, and
//                                       its restart of a session on an older plugin, with a fresh read of the
//                                       sessions just before any stop). It then reads the sessions every 10 s,
//                                       for up to 5 minutes, until each session it started is listed, and
//                                       replies from that read: Back only for a session listed in its role
//                                       directory whose roster entry records the installed plugin; what did
//                                       not come back, and why
//   host-manager.js tick                the unattended pass its timer runs every 5 minutes. A silence of 30
//                                       minutes (an instance holding work with no bead note and no wake, a
//                                       host job with no pass) is one outage per team and instance, or team
//                                       and host job, in an outage ledger in the user's state directory; the
//                                       pass that first sees it alerts the owner once. A down instance or a
//                                       silent job is restarted; an instance still listed as running is only
//                                       named in the alert, never stopped: it may be in the middle of a turn
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

// The open sessions, read now: `claude agents --json`, or the injected list (a function is a fresh read
// on every call, as a restart's reads after its starts need).
function sessionsNow({ env = process.env, live } = {}) {
  if (typeof live === 'function') return live();
  if (live !== undefined) return live;
  return WD().liveSessions(env.DELIVERY_CLAUDE_BIN || 'claude', env);
}

// One read of the whole machine. deps: env, home, exec (systemctl), has, live (`claude agents`), teamDeps
// (root -> what team-revive's gather takes in a test: bd, prs, alive, pause, configDir, hostname).
function read({ env = process.env, home = os.homedir(), exec, has, live, teamDeps } = {}) {
  const TR = require('./team-revive.js');
  const unavailable = [];
  const fromFile = HM.readHostTeams(HM.hostFile(env, home));
  if (fromFile.unreadable) unavailable.push(`the host's team list (${fromFile.unreadable})`);
  const roots = HM.teamRoots(fromFile.teams, HM.unitRoots(HM.unitDir(home)));
  const sessions = sessionsNow({ env, live });
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

// How a restart waits for the sessions it started to be listed: a Remote Control server takes seconds to
// a minute to open its session and record its plugin version. Every read in between is a fresh one.
const POLL_EVERY_MS = 10e3;
const POLL_MAX_MS = 5 * 60e3;
const sleepMs = (msec) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, msec);

// The time of a team's last host job pass: its job log is written by every run (watchdog.js jobFiles)
function lastPassOf(root) { try { return fs.statSync(path.join(root, '.delivery', 'watchdog', 'job.log')).mtimeMs; } catch (err) { return null; } }

// What the silences are read from, per team: its in-progress beads, its watchdog wakes, its last pass.
function factsOf(read, deps = {}) {
  const WDL = require('./lib/watchdog.js');
  const facts = {};
  for (const t of read.teams) {
    if (t.manifestUnavailable) continue;
    const timer = read.units.find((u) => u.root === t.root && u.service);
    facts[t.root] = { inProgress: t.facts.inProgress, wakes: WDL.logRows(t.root).filter((r) => r.type === 'wake'), lastPass: (deps.lastPass || lastPassOf)(t.root), jobInstalled: Boolean(timer && timer.loaded) };
  }
  return facts;
}

// Each started instance's confirmation (lib/host-manager.js confirmation) from a read.
function confirmAll(read, want) {
  const out = {};
  for (const [root, instances] of Object.entries(want)) {
    const t = read.teams.find((x) => x.root === root);
    out[root] = {};
    for (const i of instances) {
      if (!t || !t.facts) { out[root][i] = { state: 'unread' }; continue; }
      const entry = (t.facts.roster || {})[i] || {};
      out[root][i] = HM.confirmation({ live: t.facts.live, entry, roleDir: entry.role_dir || t.facts.defaultDir(i), installed: t.facts.installed });
    }
  }
  return out;
}

// The restart, from a read already made (the tick's) or a new one.
// o.facts, o.silent: the tick's, else read here. o.everyTeam (the owner's restart): every team's start
// pass runs, so a session on an older plugin is restarted by team-revive's stale-session path, with a
// fresh read of the sessions just before any stop; the tick runs the start pass only where an instance
// holding work is down.
function restart(deps = {}, before, o = {}) {
  const no = guard('restart', deps);
  if (no) throw new Error(no);
  if (!before) before = read(deps);
  const now = deps.now || new Date().toISOString();
  const facts = o.facts || factsOf(before, deps);
  const silent = o.silent || HM.silences(before, facts, now);
  const TR = require('./team-revive.js');
  const run = runner(deps.exec);
  const plan = HM.restartPlan(before, silent);
  const jobErrors = {};
  for (const unit of plan.jobs) { try { run('systemctl', ['--user', 'start', unit]); } catch (err) { jobErrors[unit] = firstLine(err); } }
  // one pass of each restarted job at once, not at its next timer tick; --no-block: a run takes minutes
  for (const u of before.units.filter((x) => x.service && plan.jobs.includes(x.unit))) { try { run('systemctl', ['--user', 'start', '--no-block', u.service]); } catch (err) { jobErrors[u.unit] = jobErrors[u.unit] || `its service did not start: ${firstLine(err)}`; } }
  // a job whose timer runs but which has run no pass: one run of its service, once
  const kickErrors = {};
  for (const k of plan.kick) { try { run('systemctl', ['--user', 'start', '--no-block', k.service]); } catch (err) { kickErrors[k.service] = firstLine(err); } }
  const refused = {};
  const started = {};
  const restarted = {};
  for (const t of before.teams) {
    if (t.manifestUnavailable || !t.team) continue;
    const root = t.root;
    const want = plan.instances[root] || [];
    if (!want.length && !o.everyTeam) continue;
    refused[root] = {};
    let r;
    try {
      r = TR.revive(root, t.team, { start: true, cwd: deps.cwd, env: deps.env || process.env, live: before.live, relist: () => sessionsNow(deps), only: want, ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.stop ? { stop: deps.stop } : {}), ...(deps.teamDeps ? deps.teamDeps(root) : {}) });
    } catch (err) { for (const i of want) refused[root][i] = `the start failed: ${firstLine(err)}`; continue; }
    started[root] = r.started || {};
    for (const i of r.a.missing) if (want.includes(i.instance) && !r.started[i.instance]) refused[root][i.instance] = whyNot(r.a, i);
    const byStale = Object.fromEntries((r.a.stale || []).map((i) => [i.instance, i.stale]));
    for (const [i, x] of Object.entries(r.restarted || {})) (restarted[root] = restarted[root] || {})[i] = { ...x, from: byStale[i] && byStale[i].version, to: byStale[i] && byStale[i].installed };
  }
  // the reply comes from a read made after the restart; while a started session is not listed (or has
  // not recorded its plugin version yet) the read is made again, up to POLL_MAX_MS
  const sleep = deps.sleep || sleepMs;
  const clock = deps.clock || Date.now;
  const every = deps.pollEveryMs !== undefined ? deps.pollEveryMs : POLL_EVERY_MS;
  const max = deps.pollMaxMs !== undefined ? deps.pollMaxMs : POLL_MAX_MS;
  const startedNames = Object.fromEntries(Object.entries(started).map(([root, s]) => [root, Object.keys(s)]).filter(([, l]) => l.length));
  const t0 = clock();
  let after = read(deps);
  let confirmed = confirmAll(after, startedNames);
  const pending = () => Object.values(confirmed).some((byI) => Object.values(byI).some(HM.waiting));
  while (pending() && clock() - t0 < max) {
    sleep(every);
    after = read(deps);
    confirmed = confirmAll(after, startedNames);
  }
  const waited = clock() - t0;
  confirmed = { ...confirmAll(after, plan.instances), ...confirmed };
  const passes = Object.fromEntries(plan.kick.map((k) => [k.root, (deps.lastPass || lastPassOf)(k.root)]));
  return { plan, before, after, silent, lines: HM.restartLines(before, after, plan, { refused, jobErrors, started, confirmed, waited, restarted, passes, kickErrors, silent }) };
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

function tick(deps = {}) {
  const no = guard('tick', deps);
  if (no) throw new Error(no);
  const env = deps.env || process.env;
  const home = deps.home || os.homedir();
  const now = deps.now || new Date().toISOString();
  const before = read(deps);
  const facts = factsOf(before, deps);
  const silent = HM.silences(before, facts, now);
  const file = HM.outageFile(env, home);
  const open = HM.openOutages(HM.readLedger(file));
  const keys = new Set(silent.map((s) => s.key));
  const over = [];
  for (const [key, row] of open) if (!keys.has(key)) { HM.appendRow(file, { type: 'close', key, at: now, outage: row.id }); over.push(row); }
  const overLines = over.map((r) => `the outage open since ${r.at} is over (${r.what})`);
  if (!silent.length) return { code: 0, out: `${now} host manager: nothing silent${overLines.length ? `; ${overLines.join('; ')}` : ''}.`, silent };
  const r = restart(deps, before, { facts, silent });
  const fresh = silent.filter((s) => !open.has(s.key));
  const head = [`${now} host manager: silent: ${silent.map((s) => s.what).join('; ')}.`, ...overLines.map((l) => `Closed: ${l}.`)];
  const still = silent.filter((s) => open.has(s.key)).map((s) => `${s.what} (open since ${open.get(s.key).at}, the owner was alerted then)`);
  if (still.length) head.push(`Still silent, in an open outage: ${still.join('; ')}.`);
  if (!fresh.length) return { code: 0, out: [...head, ...r.lines].join('\n'), silent };
  const t = Date.parse(now) || Date.now();
  const ids = fresh.map((s, k) => HM.appendRow(file, { type: 'open', key: s.key, id: `out-${t}-${k}`, at: now, what: s.what }).id);
  const text = HM.alertText(fresh, r.lines);
  const to = deliverAlert(r.after, text, env);
  HM.appendRow(file, { type: 'alert', at: now, outages: ids, keys: fresh.map((s) => s.key), text, delivered_to: to });
  return { code: 0, out: [...head, ...r.lines, `Alert: ${text}`, to.length ? `Sent to ${to.join(', ')} (its team's inbox; that team's watchdog hands it to the session).` : `No host manager instance is in any team on this host: the alert is in ${file} only.`].join('\n'), silent };
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
    const r = restart(d, undefined, { everyTeam: true });
    return { code: 0, out: o.json ? JSON.stringify({ plan: r.plan, lines: r.lines, teams: r.after.teams, units: r.after.units, unavailable: r.after.unavailable }, null, 2) : r.lines.join('\n') };
  }
  return tick(d);
}

module.exports = { main, read, status, restart, tick, install, unitFiles, refusal, deliverAlert, lastPassOf, factsOf, sessionsNow, POLL_EVERY_MS, POLL_MAX_MS };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `host-manager.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}
