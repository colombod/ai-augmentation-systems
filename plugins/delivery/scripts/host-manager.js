#!/usr/bin/env node
// scripts/host-manager.js — the host manager: one role session per machine, opened by the owner from their
// Claude app, that says which role sessions and host jobs of every product team on this machine are down
// and brings them back; lib/host-manager.js holds the rules.
//   host-manager.js status [--json]     per team: how many of its role sessions run, which are down, which
//                                       hold work; per host job unit: running, or stopped since when; a
//                                       source that cannot be read is a SOURCE UNAVAILABLE line, never
//                                       counted as running
//   host-manager.js restart [--json]    the owner's restart: restarts every installed host job (its timer
//                                       and path units, then one run of its service), running or not, then
//                                       per team starts the missing role sessions that hold work and
//                                       restarts every running one that holds work onto the installed
//                                       plugin (team-revive.js: its caps, its restart of an idle session
//                                       only after a fresh read of the sessions just before any stop; a
//                                       busy one is named, never stopped; a role a user unit serves through
//                                       that unit). It then reads the sessions every 10 s, for up to 5
//                                       minutes, until each session it started or restarted is listed, and
//                                       replies from that read, starting with the installed plugin version:
//                                       Back only for a session listed in its role directory whose roster
//                                       entry records the installed plugin; what did not come back, and why
//   host-manager.js tick                the unattended pass its timer runs every 5 minutes. A silence of 30
//                                       minutes (an instance holding work with no bead note and no wake, a
//                                       host job with no pass) is one outage per team and instance, or team
//                                       and host job, in an outage ledger in the user's state directory; the
//                                       pass that first sees it alerts the owner once. A down instance or a
//                                       silent job is restarted; an instance still listed as running is only
//                                       named in the alert, never stopped: it may be in the middle of a turn
//   host-manager.js install-role [--dry-run] --project <root> [--instance <id>]
//                                       the Chief of Staff's own session unit,
//                                       delivery-role-<instance>-<team tag>.service: run-session in its
//                                       role directory, as the host manager's unit runs (start.js --launch
//                                       --keep-alive runs it). Nothing is installed while a user unit the
//                                       plugin did not write serves that directory: that unit is named,
//                                       never changed
//   host-manager.js install [--dry-run] --project <root> [--instance <id>]
//                                       the systemd user units: delivery-host-manager.service (the Remote
//                                       Control session, restarted always) and the tick's service and timer
//                                       (each watchdog run also runs it when the units are missing and the
//                                       host manager's role directory is prepared)
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

const USAGE = 'usage: host-manager.js status [--json] | host-manager.js restart [--json] | host-manager.js tick | host-manager.js install [--dry-run] --project <root> [--instance <id>] | host-manager.js install-role [--dry-run] --project <root> [--instance <id>] | host-manager.js run-session --project <root> --instance <id>';
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const RESTART_SEC = 30;
// A session that exits at once (an expired sign-in, a refused flag) must not restart every 30 seconds
// for ever. Two bounds, each one a systemd that is too old for the other still has: the delay grows from
// 30 seconds to 30 minutes over 5 restarts (RestartSteps and RestartMaxDelaySec, systemd 254 and later;
// an older one warns of an unknown key and keeps the 30 seconds), and at most 5 starts in 15 minutes
// (StartLimitIntervalSec and StartLimitBurst in [Unit], every systemd in use). A unit that hits the start
// limit is failed until the watchdog's next pass (every 15 minutes) resets it and starts it again.
const RESTART_STEPS = 5;
const RESTART_MAX_DELAY = '30min';
const START_LIMIT_INTERVAL = '15min';
const START_LIMIT_BURST = 5;
// run-session's exit when a host-manager session is already live: a success the unit does not restart
// (SuccessExitStatus and RestartPreventExitStatus). With Restart=always any other exit, 0 included, is
// restarted, so a live host manager made the unit exit five times in its start limit, fail, and be reset
// and started again by the watchdog's next pass, every pass (rv-198). Inactive, the unit is started once a
// pass and stops again until the live session ends.
const ALREADY_RUNNING = 3;
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
    try { f = TR.gather(root, team, { env, home, live: sessions, ...(teamDeps ? teamDeps(root) : {}) }); a = R.assess(f); } catch (err) { teams.push({ root, name: (team && team.project) || path.basename(root), manifestUnavailable: `its records could not be read: ${firstLine(err)}` }); continue; }
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
// The role a directory's marker names, as team-revive.js reads it: { roleId } or { roleId: null }.
function markerWho(cwd) {
  try { const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js'); const v = validMarker(findRoleMarker(cwd)); if (v) return { roleId: v.role.id }; } catch (err) { /* no marker that names a role */ }
  return { roleId: null };
}
// Two readings, and a refusal from either holds: the process this code runs in (its own directory and
// environment), and what the caller passes. A caller's cwd, env or who can only make it stricter: code in
// a builder's session that passes cwd '/' and an empty env, or who host-manager, is still in a builder's
// session.
function guard(cmd, deps) {
  const own = refusal(cmd, process.cwd(), process.env, markerWho(process.cwd()));
  if (own) return own;
  const cwd = deps.cwd || process.cwd();
  return refusal(cmd, cwd, deps.env || process.env, deps.who || markerWho(cwd));
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

// Each started instance's confirmation (lib/host-manager.js confirmation) from a read. old: { root:
// { instance: the session a restart stopped } }, never taken for the one that came back.
function confirmAll(read, want, old = {}) {
  const out = {};
  for (const [root, instances] of Object.entries(want)) {
    const t = read.teams.find((x) => x.root === root);
    out[root] = {};
    for (const i of instances) {
      if (!t || !t.facts) { out[root][i] = { state: 'unread' }; continue; }
      const entry = (t.facts.roster || {})[i] || {};
      out[root][i] = HM.confirmation({ live: t.facts.live, entry, roleDir: entry.role_dir || t.facts.defaultDir(i), installed: t.facts.installed, old: (old[root] || {})[i] || null });
    }
  }
  return out;
}

// The restart, from a read already made (the tick's) or a new one.
// o.facts, o.silent: the tick's, else read here. o.everyTeam (the owner's restart): every installed host
// job is restarted, and every team's start pass runs with force: each running instance holding work,
// restarted by team-revive's stale-session path (its safeties all hold: idle on a fresh read just before
// any stop, its server and recorded link, the caps, a ledger row, one at a time), and a role a user unit
// serves through that unit. The tick runs the start pass only where an instance holding work is down,
// with no force, and restarts no running job.
function restart(deps = {}, before, o = {}) {
  const no = guard('restart', deps);
  if (no) throw new Error(no);
  if (!before) before = read(deps);
  const now = deps.now || new Date().toISOString();
  const facts = o.facts || factsOf(before, deps);
  const silent = o.silent || HM.silences(before, facts, now);
  const TR = require('./team-revive.js');
  const run = runner(deps.exec);
  const plan = HM.restartPlan(before, silent, { everyTeam: Boolean(o.everyTeam) });
  // one window for the whole restart, from here: every team's start pass (and the settle each one waits
  // for a start that exits at once) comes out of it, and so does the wait for what it started
  const sleep = deps.sleep || sleepMs;
  const clock = deps.clock || Date.now;
  const every = deps.pollEveryMs !== undefined ? deps.pollEveryMs : POLL_EVERY_MS;
  const max = deps.pollMaxMs !== undefined ? deps.pollMaxMs : POLL_MAX_MS;
  const t0 = clock();
  const jobErrors = {};
  // the owner's restart: every installed job, running or not; its service runs once only after its timer
  // (and path unit) restarted
  const restartJobErrors = {};
  const ranService = {};
  for (const j of plan.restartJobs.filter((x) => !x.unavailable)) {
    let failed = null;
    for (const u of [j.timer, ...(j.path ? [j.path] : [])]) { try { run('systemctl', ['--user', 'restart', u]); } catch (err) { failed = `restarting ${u} failed (${firstLine(err)})`; break; } }
    if (!failed) { try { run('systemctl', ['--user', 'start', '--no-block', j.service]); ranService[j.service] = true; } catch (err) { failed = `its timer restarted, but one run of ${j.service} did not start (${firstLine(err)})`; ranService[j.service] = firstLine(err); } }
    if (failed) restartJobErrors[j.timer] = failed;
  }
  for (const unit of plan.jobs) { try { run('systemctl', ['--user', 'start', unit]); } catch (err) { jobErrors[unit] = firstLine(err); } }
  // one pass of each restarted job at once, not at its next timer tick; --no-block: a run takes minutes
  for (const u of before.units.filter((x) => x.service && plan.jobs.includes(x.unit))) { try { run('systemctl', ['--user', 'start', '--no-block', u.service]); } catch (err) { jobErrors[u.unit] = jobErrors[u.unit] || `its service did not start: ${firstLine(err)}`; } }
  // a job whose timer runs but which has run no pass: one run of its service, once
  const kickErrors = {};
  for (const k of plan.kick) {
    // a service the owner's restart already ran once is not run twice; its outcome is the kick's
    if (ranService[k.service] === true) continue;
    if (ranService[k.service]) { kickErrors[k.service] = ranService[k.service]; continue; }
    if (plan.restartJobs.some((j) => j.service === k.service)) { kickErrors[k.service] = restartJobErrors[k.timer] || 'its timer did not restart'; continue; }
    try { run('systemctl', ['--user', 'start', '--no-block', k.service]); } catch (err) { kickErrors[k.service] = firstLine(err); }
  }
  const refused = {};
  const started = {};
  const restarted = {};
  const held = {};
  const unforced = {};
  const oldSessions = {};
  // a role a user unit serves is restarted through that unit (lib/team-revive.js remoteControlUnitFor)
  const restartUnit = (unit) => run('systemctl', ['--user', 'restart', unit]);
  for (const t of before.teams) {
    if (t.manifestUnavailable || !t.team) continue;
    const root = t.root;
    const want = plan.instances[root] || [];
    const force = plan.force[root] || [];
    if (!want.length && !o.everyTeam) continue;
    refused[root] = {};
    let r;
    try {
      r = TR.revive(root, t.team, { start: true, cwd: deps.cwd, env: deps.env || process.env, home: deps.home, live: before.live, relist: () => sessionsNow(deps), only: want, ...(force.length ? { force } : {}), restartUnit, ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.stop ? { stop: deps.stop } : {}), ...(deps.teamDeps ? deps.teamDeps(root) : {}) });
    } catch (err) { for (const i of want) refused[root][i] = `the start failed: ${firstLine(err)}`; for (const i of force) (unforced[root] = unforced[root] || {})[i] = `the restart pass failed: ${firstLine(err)}`; continue; }
    started[root] = {};
    // a start that exited within its settle is recorded failed by the start pass: named, not waited for
    for (const [i, x] of Object.entries(r.started || {})) {
      if (x && x.failed) refused[root][i] = 'its start exited at once, recorded failed; the next pass retries it';
      else started[root][i] = x;
    }
    for (const i of r.a.missing) if (want.includes(i.instance) && !(r.started || {})[i.instance]) refused[root][i.instance] = whyNot(r.a, i);
    const byStale = Object.fromEntries((r.a.stale || []).map((i) => [i.instance, i.stale]));
    for (const [i, x] of Object.entries(r.restarted || {})) {
      const st = byStale[i] || {};
      (restarted[root] = restarted[root] || {})[i] = { ...x, from: st.version, to: st.installed, ...(st.forced ? { forced: true } : {}) };
      if (x.pid || x.unit) (oldSessions[root] = oldSessions[root] || {})[i] = { sessionId: st.session || null, pid: st.pid || null };
    }
    // a restart not made now (busy, a cap, no server or link, running twice) is named with why
    for (const [i, st] of Object.entries(byStale)) {
      if ((r.restarted || {})[i]) continue;
      if (st.skip) (held[root] = held[root] || {})[i] = { why: st.skip };
      else if (st.held) (held[root] = held[root] || {})[i] = { why: st.held, busy: st.busy || null, held: true };
      else if (!r.a.restart) (held[root] = held[root] || {})[i] = { why: r.a.paused ? 'paused by the owner' : 'the open sessions could not be read', held: true };
    }
    // a running instance the owner asked for that had no restart to make: why
    for (const i of force) {
      if (byStale[i] || (r.restarted || {})[i]) continue;
      const it = r.a.instances.find((x) => x.instance === i);
      (unforced[root] = unforced[root] || {})[i] = r.a.locked ? 'another start pass holds the start lock; it is not restarted now' : it && it.running ? `${it.running}, and no open session of it is listed to restart` : 'whether it runs could not be read';
    }
  }
  // the reply comes from a read made after the restart; while a started session is not listed (or has
  // not recorded its plugin version yet), or a host job whose service it ran has written no new pass,
  // the read is made again, until the window closes
  const startedNames = Object.fromEntries(Object.entries(started).map(([root, x]) => [root, Object.keys(x)]).filter(([, l]) => l.length));
  const restartedNames = Object.fromEntries(Object.entries(oldSessions).map(([root, x]) => [root, Object.keys(x)]));
  const passOf = deps.lastPass || lastPassOf;
  const readPasses = () => Object.fromEntries(plan.kick.map((k) => [k.root, passOf(k.root)]));
  let after = read(deps);
  let confirmed = confirmAll(after, startedNames);
  let restartConfirmed = confirmAll(after, restartedNames, oldSessions);
  let passes = readPasses();
  const newPass = (k) => Number.isFinite(passes[k.root]) && (!Number.isFinite(k.lastPass) || passes[k.root] > k.lastPass);
  const pending = () => [confirmed, restartConfirmed].some((c) => Object.values(c).some((byI) => Object.values(byI).some(HM.waiting))) || plan.kick.some((k) => !kickErrors[k.service] && !newPass(k));
  while (pending() && clock() - t0 < max) {
    sleep(Math.min(every, max - (clock() - t0)));
    after = read(deps);
    confirmed = confirmAll(after, startedNames);
    restartConfirmed = confirmAll(after, restartedNames, oldSessions);
    passes = readPasses();
  }
  const waited = clock() - t0;
  confirmed = { ...confirmAll(after, plan.instances), ...confirmed };
  // the installed plugin, as the teams read it (the reply's first line on the owner's restart)
  const installedOf = (r) => { const t = r.teams.find((x) => x.facts && x.facts.installed); return t ? t.facts.installed : null; };
  const version = o.everyTeam ? (installedOf(after) || installedOf(before) || (() => { try { return require('./lib/plugin-version.js').runningVersion() || null; } catch (err) { return null; } })()) : undefined;
  return { plan, before, after, silent, lines: HM.restartLines(before, after, plan, { refused, jobErrors, started, confirmed, waited, restarted, passes, kickErrors, silent, version, restartJobErrors, held, unforced, restartConfirmed, everyTeam: Boolean(o.everyTeam) }) };
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

// The roles whose session a unit the plugin writes serves: the host manager (one per machine) and each
// team's Chief of Staff (the session the owner talks to). Both run run-session, so both start by the same
// rules: the recorded session reattached once, otherwise a server that stays up.
const UNIT_ROLES = [HM.ROLE, 'chief-of-staff'];
function unitRoleOf(root, team, host, instance) {
  const all = M.expandInstances(team).filter((x) => !(x.role && x.role.retired) && UNIT_ROLES.includes(M.canonicalRoleId(x.role.id)));
  if (instance) return all.find((x) => x.instance === instance) || null;
  return all.find((x) => x.role.host === host && M.canonicalRoleId(x.role.id) === HM.ROLE) || null;
}
// the session name run-session gives a role: the host manager's is per machine (<instance>@<host>), every
// other role's per team, as team-revive names it (<instance>@<team>)
function unitSessionName(team, x, host) {
  return M.canonicalRoleId(x.role.id) === HM.ROLE ? `${x.instance}@${host}` : require('./lib/session-name.js').sessionName(x.instance, team.prefix);
}
// a role's own unit: delivery-role-<instance>-<team tag>, so two teams' Chief of Staff units on one
// machine never share a name, and lib/service-limits.js reads it as a unit that holds one session
const roleUnitName = (root, instance) => `delivery-role-${instance}-${WD().tagOf(root)}.service`;

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

// The Remote Control command the host manager's session runs, read when it starts (run-session), by
// team-revive's own rules (lib/team-revive.js linkFor, STAY_UP): the session last recorded for its role
// directory (claude's own pointer, else the roster's) is reattached once, so a restart of the unit brings
// back the same session in the owner's app; when none is recorded, or the recorded one never joined or
// already ran (a reattach is single-session and ends after its task), a server that stays up after each
// task. Its starts are rows of the team's revive ledger (SESSION_ROW), so the once-only rule holds across
// the unit's restarts. -> { args, roleDir, sessionId, dropped, why, modeSkip }
const SESSION_ROW = 'host-manager-session';
const ROLE_SESSION_ROW = 'role-unit-session';
function sessionArgs(root, team, instance, { env, home, host, name = `${instance}@${host}`, row = SESSION_ROW }) {
  const { roleDir, remote } = roleDirOf(root, team, instance);
  const pointer = R.pointerOf(R.configDirOf(env, home), roleDir);
  const recorded = (pointer && pointer.sessionId) || (/^[A-Za-z0-9_-]{1,128}$/.test(String(remote || '')) ? remote : null);
  let entry = {};
  try { entry = require('./lib/roster.js').readRoster(root).instances[instance] || {}; } catch (err) { entry = {}; }
  const starts = R.ledger(root).filter((r) => r.type === row && r.instance === instance);
  const l = R.linkFor(recorded, starts, entry);
  const m = R.modeOf(team);
  const args = ['remote-control', '--name', name, ...(l.remoteId ? ['--session-id', l.remoteId] : R.STAY_UP), ...(m.mode ? ['--permission-mode', m.mode] : [])];
  const dropped = l.staleId || l.endedId || null;
  return { args, roleDir, sessionId: l.remoteId, dropped, why: l.staleId ? 'never joined' : l.endedId ? 'already ran' : null, modeSkip: m.skip || null };
}

function unitFiles(root, team, instance, { env, home, host, roleDir }) {
  const W = WD();
  const dir = HM.unitDir(home);
  const PATH = W.jobPath(env, home);
  const config = env.CLAUDE_CONFIG_DIR || null;
  const m = R.modeOf(team);
  // the directories the ledger and the host file are found by: a unit started by systemd has neither
  // variable unless the unit sets it, so one set at install is carried into the units, and the unit, the
  // owner's shell and the ledger agree on one place
  const xdg = ['XDG_STATE_HOME', 'XDG_CONFIG_HOME'].filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  const vars = [`PATH=${PATH}`, `DELIVERY_ROLE=${instance}`, `DELIVERY_HOST=${host}`, ...(config ? [`CLAUDE_CONFIG_DIR=${config}`] : []), ...xdg];
  const env1 = vars.map((v) => `Environment=${W.sdq(v)}\n`).join('');
  const launcher = require('./lib/launcher.js').launcherPath(root);
  const log = path.join(HM.stateDir(env, home), 'tick.log');
  return {
    stateDir: HM.stateDir(env, home),
    modeSkip: m.skip || null,
    files: [
      { file: path.join(dir, HM.UNIT), body: `[Unit]\nDescription=delivery host manager: the Remote Control session ${sdName(instance, host)} for every product team on this machine\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=${START_LIMIT_INTERVAL}\nStartLimitBurst=${START_LIMIT_BURST}\n\n[Service]\nType=simple\nWorkingDirectory=${W.sdPct(roleDir)}\n${env1}ExecStart=/usr/bin/env ${['node', launcher, 'host-manager.js', 'run-session', '--project', root, '--instance', instance].map(W.sdq).join(' ')}\nKillMode=process\nRestart=always\nSuccessExitStatus=${ALREADY_RUNNING}\nRestartPreventExitStatus=${ALREADY_RUNNING}\nRestartSec=${RESTART_SEC}\nRestartSteps=${RESTART_STEPS}\nRestartMaxDelaySec=${RESTART_MAX_DELAY}\nTasksMax=${TASKS_MAX}\n\n[Install]\nWantedBy=default.target\n` },
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

// The host manager this host would install, by the rules install applies: the team's manifest names a
// host-manager instance on this host (or the one asked for) and its role directory is prepared here.
// -> { team, host, hm, roleDir } or { why, unreadable? } (the line install says). watchdog.js reads it
// before each run's install, so a team with no host manager, or one not yet prepared, is left alone and
// unrecorded; a team.json that cannot be read (missing, not JSON, no roles list) is said, never thrown.
// Prepared means the role directory holds its role marker (.delivery-role.json, which prepare-role.js
// writes): the directory is the roster's role_dir when one is recorded, and role sessions write the
// roster, so a directory that merely exists is not taken as a prepared host manager.
function installTarget(root, o = {}, { env = process.env, hostname } = {}) {
  const unreadable = (err) => ({ unreadable: true, why: `host-manager.js: the team at ${root} could not be read (${firstLine(err)}); nothing was installed.` });
  let team;
  try { team = M.loadManifest(root).team; } catch (err) { return unreadable(err); }
  if (!team || typeof team !== 'object' || !Array.isArray(team.roles)) return unreadable(new Error('team.json has no roles list'));
  const host = R.hostOf(env, hostname !== undefined ? hostname : os.hostname());
  let hm;
  try { hm = hostManagerOf(root, team, host, o.instance); } catch (err) { return unreadable(err); }
  if (!hm) return { why: `host-manager.js: team.json of ${root} has no host manager${o.instance ? ` instance ${o.instance}` : ` on host "${host}"`} (Staffing adds it: team-role.js add host-manager), so its session has no role directory; nothing was installed.` };
  const { roleDir } = roleDirOf(root, team, hm.instance);
  if (!fs.existsSync(roleDir)) return { why: `host-manager.js: the host manager's role directory ${roleDir} is not prepared on this host (prepare-role.js --instance ${hm.instance} prepares it); nothing was installed.` };
  const markerFile = path.join(roleDir, '.delivery-role.json');
  if (!fs.existsSync(markerFile)) return { why: `host-manager.js: the host manager's role directory ${roleDir} is not prepared on this host (it holds no .delivery-role.json; prepare-role.js --instance ${hm.instance} prepares it); nothing was installed.` };
  // the marker must be this instance's: a directory another role was prepared in (or a marker someone
  // wrote by hand with other fields) is not a prepared host manager, so its session is never put there
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch (err) { marker = null; }
  if (!marker || marker.role !== 'host-manager' || marker.instance !== hm.instance) return { why: `host-manager.js: the role marker in ${roleDir} is not the host manager's (it names role ${(marker && marker.role) || 'none'}, instance ${(marker && marker.instance) || 'none'}; prepare-role.js --instance ${hm.instance} prepares it); nothing was installed.` };
  return { team, host, hm, roleDir };
}

// install(root, o, deps) -> { code, out, wrote }. Used by host-manager.js install, by watchdog.js install
// (when the units are missing), so a team's first install also brings the host manager, and by each
// watchdog run (watchdog.js ensureHostManager) when Staffing prepared the host manager after that.
// wrote: the unit files written, also on a failure part way; attempted: the install got past its guards
// and began writing (a failure from then on is the caller's to record).
// o.onlyMissing (the watchdog's installs): a unit file that already exists is kept as it is, never
// rewritten, so an owner's edit of the tick service or timer survives; the reload, enable and start
// still run, which is how a run repeats an enable that failed without writing anything again.
// deps.writeFile: the write of a unit file (a test's failing write).
function install(root, o = {}, { env = process.env, home = os.homedir(), exec, has, hostname, cwd, who, writeFile = fs.writeFileSync, live } = {}) {
  const no = guard('install', { cwd, env, who });
  if (no) return { code: 1, out: no, wrote: [] };
  if (!whichOf(has)('systemctl')) return { code: 1, out: 'host-manager.js: this host has no systemctl, so the host manager\'s units cannot be installed here; nothing was installed.', wrote: [] };
  const target = installTarget(root, o, { env, hostname });
  if (target.why) return { code: 1, out: target.why, wrote: [] };
  const { team, host, hm, roleDir } = target;
  const u = unitFiles(root, team, hm.instance, { env, home, host, roleDir });
  if (u.modeSkip) return { code: 1, out: `host-manager.js: ${u.modeSkip}; nothing was installed.`, wrote: [] };
  const run = runner(exec);
  const file = HM.hostFile(env, home);
  const lines = [];
  const head = `The host manager ${hm.instance}@${host} runs as ${HM.UNIT} in ${roleDir} (Restart=always, started at boot), and ${HM.TICK_TIMER} runs host-manager.js tick every 5 minutes. Teams it serves: ${file}, and every installed watchdog host job.`;
  // the service is started at once only when no host manager is live and the open sessions could be
  // read: started beside a live one it is a second host manager (rv-198). Otherwise it is enabled for the
  // next boot and left to the watchdog's start check (startHostManager), which makes the same match. The
  // dry run prints the same choice.
  const lv = liveHostManager(root, { env, home, hostname, live });
  const startNow = !lv.unreadable && !lv.sessions.length;
  const commands = startNow ? u.commands : u.commands.map(([c, a]) => (a.join(' ') === `--user enable --now ${HM.UNIT}` ? [c, ['--user', 'enable', HM.UNIT]] : [c, a]));
  const notNow = startNow ? null : lv.unreadable ? `the open sessions could not be listed, so ${HM.UNIT} is enabled and left to the watchdog's start check.` : `the host manager already runs, so ${HM.UNIT} is enabled for the next boot.`;
  if (o.dryRun) {
    lines.push(`Dry run. ${head}`, `Would add ${root} to ${file}.`);
    for (const f of u.files) lines.push(`Would write ${f.file}:`, f.body.trimEnd());
    for (const [cmd, args] of commands) lines.push(`Would run: ${cmd} ${args.join(' ')}`);
    if (notNow) lines.push(`Would not start it now: ${notNow}`);
    const l = lingerLine(run, env);
    if (l) lines.push(l);
    lines.push('Nothing was written.');
    return { code: 0, out: lines.join('\n'), wrote: [] };
  }
  const wrote = [];
  const kept = [];
  try {
    if (HM.addHostTeam(file, root)) lines.push(`Added ${root} to ${file}`);
    const lp = require('./lib/launcher.js').ensureLauncher(root, PLUGIN_ROOT, env.CLAUDE_CONFIG_DIR);
    if (lp) throw new Error(lp);
    for (const f of u.files) {
      if (o.onlyMissing && fs.existsSync(f.file)) { kept.push(f.file); lines.push(`Kept ${f.file} (installed already)`); continue; }
      fs.mkdirSync(path.dirname(f.file), { recursive: true }); writeFile(f.file, f.body); wrote.push(f.file); lines.push(`Wrote ${f.file}`);
    }
    // before the units are enabled: systemd opens the tick's StandardOutput=append: file itself and
    // fails the service (status 209/STDOUT) when its directory is missing
    fs.mkdirSync(u.stateDir, { recursive: true });
    for (const [cmd, args] of commands) { run(cmd, args); lines.push(`Ran: ${cmd} ${args.join(' ')}`); }
    if (notNow) lines.push(`Not started now: ${notNow}`);
  } catch (err) { return { code: 1, out: `${lines.join('\n')}\nhost-manager.js: not installed (${firstLine(err)})`.trim(), wrote, kept, attempted: true }; }
  lines.push(`Installed. ${head}`);
  const l = lingerLine(run, env);
  if (l) lines.push(l);
  return { code: 0, out: lines.join('\n'), wrote, kept, attempted: true };
}

// The Chief of Staff's own unit (installRole): the host manager's session unit, for one team's role. It
// runs run-session, so the session is read when the unit starts (the recorded one reattached once, else a
// server that stays up), its restarts are bounded the same way, KillMode=process keeps what the session
// started through a restart of the unit, and TasksMax is what lib/service-limits.js asks of a unit that
// holds one role session: claude is the unit's own main process (process.execve), so it runs in the
// unit's cgroup and nowhere else.
function roleUnitFiles(root, team, instance, { env, home, host, roleDir }) {
  const W = WD();
  const SL = require('./lib/service-limits.js');
  const unit = roleUnitName(root, instance);
  const config = env.CLAUDE_CONFIG_DIR || null;
  const xdg = ['XDG_STATE_HOME', 'XDG_CONFIG_HOME'].filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  const vars = [`PATH=${W.jobPath(env, home)}`, `DELIVERY_ROLE=${instance}`, `DELIVERY_HOST=${host}`, ...(config ? [`CLAUDE_CONFIG_DIR=${config}`] : []), ...xdg];
  const launcher = require('./lib/launcher.js').launcherPath(root);
  const name = require('./lib/session-name.js').sessionName(instance, team.prefix).replace(/%/g, '%%');
  const body = `[Unit]\nDescription=delivery role session ${name}: the Remote Control session of ${team.project}'s ${instance}\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=${START_LIMIT_INTERVAL}\nStartLimitBurst=${START_LIMIT_BURST}\n\n[Service]\nType=simple\nWorkingDirectory=${W.sdPct(roleDir)}\n${vars.map((v) => `Environment=${W.sdq(v)}\n`).join('')}ExecStart=/usr/bin/env ${['node', launcher, 'host-manager.js', 'run-session', '--project', root, '--instance', instance].map(W.sdq).join(' ')}\nKillMode=process\nRestart=always\nSuccessExitStatus=${ALREADY_RUNNING}\nRestartPreventExitStatus=${ALREADY_RUNNING}\nRestartSec=${RESTART_SEC}\nRestartSteps=${RESTART_STEPS}\nRestartMaxDelaySec=${RESTART_MAX_DELAY}\nTasksMax=${SL.needOf(unit, 0)}\n\n[Install]\nWantedBy=default.target\n`;
  return { unit, file: path.join(HM.unitDir(home), unit), body, modeSkip: R.modeOf(team).skip || null };
}

// The Chief of Staff instance this host would serve with its own unit: the one named, else the team's
// Chief of Staff on this host, with its role directory prepared (its marker names it). -> { team, host, x,
// roleDir } or { why }.
function roleTarget(root, o, { env, hostname }) {
  let team;
  try { team = M.loadManifest(root).team; } catch (err) { return { why: `host-manager.js: the team at ${root} could not be read (${firstLine(err)}); nothing was installed.` }; }
  if (!team || !Array.isArray(team.roles)) return { why: `host-manager.js: the team at ${root} has no roles list; nothing was installed.` };
  const host = R.hostOf(env, hostname !== undefined ? hostname : os.hostname());
  const x = M.expandInstances(team).find((i) => !(i.role && i.role.retired) && M.canonicalRoleId(i.role.id) === 'chief-of-staff' && (o.instance ? i.instance === o.instance : i.role.host === host));
  if (!x) return { why: `host-manager.js: team.json of ${root} has no Chief of Staff${o.instance ? ` instance ${o.instance}` : ` on host "${host}"`}; nothing was installed.` };
  const { roleDir } = roleDirOf(root, team, x.instance);
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8')); } catch (err) { marker = null; }
  if (!marker || marker.instance !== x.instance) return { why: `host-manager.js: the role directory ${roleDir} is not prepared for ${x.instance} (no role marker naming it; prepare-role.js --instance ${x.instance} prepares it); nothing was installed.` };
  return { team, host, x, roleDir };
}

// installRole(root, o, deps) -> { code, out, wrote }. Writes the Chief of Staff's own unit, reloads and
// enables it; it is started at once only when no session of it is live (one read of the open sessions):
// started beside a live one it would be a second, and the start pass starts it through this unit once
// that session is gone. A user unit someone else wrote that serves the same directory (a hand-written
// Remote Control service) refuses the install: two start paths would serve one directory. That unit is
// the owner's, so it is named with the fix and never edited, stopped or disabled here.
function installRole(root, o = {}, { env = process.env, home = os.homedir(), exec, has, hostname, cwd, who, live, writeFile = fs.writeFileSync } = {}) {
  const no = guard('install-role', { cwd, env, who });
  if (no) return { code: 1, out: no, wrote: [] };
  if (!whichOf(has)('systemctl')) return { code: 1, out: 'host-manager.js: this host has no systemctl, so the Chief of Staff\'s unit cannot be installed here; nothing was installed.', wrote: [] };
  const t = roleTarget(root, o, { env, hostname });
  if (t.why) return { code: 1, out: t.why, wrote: [] };
  const u = roleUnitFiles(root, t.team, t.x.instance, { env, home, host: t.host, roleDir: t.roleDir });
  if (u.modeSkip) return { code: 1, out: `host-manager.js: ${u.modeSkip}; nothing was installed.`, wrote: [] };
  const hand = R.servingUnits(t.roleDir, { home }).filter((s) => !s.written && s.unit !== u.unit);
  if (hand.length) return { code: 1, out: hand.map((s) => `host-manager.js: ${s.unit} serves ${t.roleDir} with claude remote-control, and the delivery plugin did not write it, so ${u.unit} is not installed beside it (two start paths would serve one role directory). The plugin never changes that unit: stop and disable ${s.unit} (systemctl --user disable --now ${s.unit}), then run install-role again.`).join('\n'), wrote: [] };
  const run = runner(exec);
  const name = unitSessionName(t.team, t.x, t.host);
  const listed = sessionsNow({ env, live });
  const OS = require('./lib/one-session.js');
  const lives = Array.isArray(listed) ? listed.filter(hostManagerMatch([t.roleDir], [name])) : null;
  const startNow = Array.isArray(lives) && !lives.length;
  const commands = [['systemctl', ['--user', 'daemon-reload']], ['systemctl', ['--user', 'enable', ...(startNow ? ['--now'] : []), u.unit]]];
  const notNow = startNow ? null : lives ? `${t.x.instance} already runs as ${OS.described(lives)}, so ${u.unit} is enabled and starts it once that session is gone (the start pass starts it through the unit)` : `the open sessions could not be listed, so ${u.unit} is enabled and the start pass starts it`;
  const head = `${t.x.instance} runs as ${u.unit} in ${t.roleDir} (run-session, Restart=always with bounded restarts, started at boot).`;
  if (o.dryRun) {
    const lines = [`Dry run. ${head}`, `Would write ${u.file}:`, u.body.trimEnd(), ...commands.map(([c, a]) => `Would run: ${c} ${a.join(' ')}`)];
    if (notNow) lines.push(`Would not start it now: ${notNow}.`);
    lines.push('Nothing was written.');
    return { code: 0, out: lines.join('\n'), wrote: [] };
  }
  const lines = [];
  const wrote = [];
  try {
    const lp = require('./lib/launcher.js').ensureLauncher(root, PLUGIN_ROOT, env.CLAUDE_CONFIG_DIR);
    if (lp) throw new Error(lp);
    fs.mkdirSync(path.dirname(u.file), { recursive: true });
    writeFile(u.file, u.body); wrote.push(u.file); lines.push(`Wrote ${u.file}`);
    for (const [c, a] of commands) { run(c, a); lines.push(`Ran: ${c} ${a.join(' ')}`); }
    if (notNow) lines.push(`Not started now: ${notNow}.`);
  } catch (err) { return { code: 1, out: `${lines.join('\n')}\nhost-manager.js: not installed (${firstLine(err)})`.trim(), wrote }; }
  lines.push(`Installed. ${head}`);
  const l = lingerLine(run, env);
  if (l) lines.push(l);
  return { code: 0, out: lines.join('\n'), wrote };
}

// run-session: what the host manager's unit runs. The session it reattaches to is read now, not at
// install, and claude replaces this process (process.execve, node 22.15 and later), so the unit's main
// process is claude and Restart= sees it exit. A node without execve starts nothing: claude as a child
// would outlive a stop of the unit (KillMode=process stops only the main process), and the next start
// would be a second host manager beside it. deps: execve, resolveBin, now (in a test).
// A live host-manager session: one in its role directory or under its name <instance>@<host>
// (lib/one-session.js), the match run-session makes before it starts one and the watchdog makes before it
// starts the unit (rv-198). { sessions } (possibly none), or { unreadable } when the open sessions could
// not be listed. With no host manager in this project's team.json, the unit's own WorkingDirectory is
// its role directory.
function hostManagerMatch(roleDirs, names) {
  const OS = require('./lib/one-session.js');
  return (s) => Boolean(s) && (roleDirs.some((d) => d && OS.inside(s.cwd, d)) || (Boolean(s.name) && names.includes(s.name)));
}
function liveHostManager(root, { env = process.env, home = os.homedir(), hostname, live } = {}) {
  const host = R.hostOf(env, hostname !== undefined ? hostname : os.hostname());
  let team = null;
  try { team = M.loadManifest(root).team; } catch (err) { team = null; }
  const hm = team ? hostManagerOf(root, team, host) : null;
  const roleDirs = [];
  const names = [];
  if (hm) { roleDirs.push(roleDirOf(root, team, hm.instance).roleDir); names.push(`${hm.instance}@${host}`); }
  try {
    const wd = /^WorkingDirectory=(.+)$/m.exec(fs.readFileSync(path.join(HM.unitDir(home), HM.UNIT), 'utf8'));
    if (wd) roleDirs.push(wd[1].trim().replace(/%%/g, '%'));
  } catch (err) { /* no unit: the team's role directory alone */ }
  if (!roleDirs.length && !names.length) return { sessions: [] };
  const listed = sessionsNow({ env, live });
  if (!Array.isArray(listed)) return { unreadable: true };
  return { sessions: listed.filter(hostManagerMatch(roleDirs, names)) };
}

function resolveOnPath(bin, env) {
  if (bin.includes('/')) return bin;
  for (const d of String(env.PATH || '').split(path.delimiter)) { if (!d) continue; const f = path.join(d, bin); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch (err) { /* not here */ } }
  return null;
}
function runSession(root, o, { env = process.env, home = os.homedir(), hostname, execve, resolveBin, now, live } = {}) {
  let team;
  try { team = M.loadManifest(root).team; } catch (err) { return { code: 1, out: `host-manager.js: the team at ${root} could not be read (${firstLine(err)}); no session started.` }; }
  const host = R.hostOf(env, hostname !== undefined ? hostname : os.hostname());
  const hm = unitRoleOf(root, team, host, o.instance);
  if (!hm) return { code: 1, out: `host-manager.js: team.json of ${root} has no ${o.instance ? `instance ${o.instance} whose session a plugin unit serves (${UNIT_ROLES.join(', ')})` : `host manager on host "${host}"`}; no session started.` };
  const name = unitSessionName(team, hm, host);
  const row = M.canonicalRoleId(hm.role.id) === HM.ROLE ? SESSION_ROW : ROLE_SESSION_ROW;
  const a = sessionArgs(root, team, hm.instance, { env, home, host, name, row });
  if (a.modeSkip) return { code: 1, out: `host-manager.js: ${a.modeSkip}; no session started.` };
  // One live session per role (lib/one-session.js, hjx.1.6.17): a host-manager session already live in its
  // role directory or under its own name <instance>@<host> is never given a second one beside it, and
  // none is started while the open sessions cannot be read. A live one is a success the unit does not
  // restart (ALREADY_RUNNING); a list that cannot be read is a failure Restart= tries again.
  const OS = require('./lib/one-session.js');
  const listed = sessionsNow({ env, live });
  if (!Array.isArray(listed)) return { code: 1, out: 'host-manager.js: the open sessions could not be listed (claude agents --json), so a start could put a second host manager beside a live one; no session started.' };
  const running = listed.filter(hostManagerMatch([a.roleDir], [name]));
  if (running.length) return { code: ALREADY_RUNNING, out: `host-manager.js: ${hm.instance} already runs as ${OS.described(running)}; no second session started.` };
  const ex = execve !== undefined ? execve : (typeof process.execve === 'function' ? process.execve.bind(process) : null);
  if (!ex) return { code: 1, out: `host-manager.js: run-session needs node 22.15 or later (process.execve), so that claude is the unit's own process; this is node ${process.version}. No session started.` };
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const file = (resolveBin || ((b) => resolveOnPath(b, env)))(bin);
  if (!file) return { code: 1, out: `host-manager.js: ${bin} is not on PATH (${env.PATH || 'unset'}); no session started.` };
  const note = a.dropped ? `host-manager.js: the recorded session ${a.dropped} ${a.why}, so it is not reattached again: a new server that stays up.` : '';
  // recorded before the exec, which does not return: the pid is claude's from here on
  R.record(root, { type: row, at: now || new Date().toISOString(), instance: hm.instance, pid: process.pid, session_id: a.sessionId, args: a.args, ...(a.dropped ? { dropped: a.dropped, why: a.why } : {}) });
  if (note) process.stderr.write(`${note}\n`);
  // the unit's WorkingDirectory is the role directory, which execve keeps
  ex(file, [path.basename(bin), ...a.args], env);
  return { code: 0, out: note };
}

// restart and tick start sessions and host jobs: in a role session they are the host manager's alone.
// install changes the machine's own units: never from a role session.
function refusal(cmd, cwd, env, who, instance) {
  const role = WD().roleContext(cwd, env);
  if (!role) return null;
  if (cmd === 'install-role') return `host-manager.js: install-role writes this machine's user units and runs from a shell outside any role session (${role}); start.js --launch --keep-alive runs it.`;
  if (cmd === 'install') return `host-manager.js: install writes this machine's user units and runs from a shell outside any role session (${role}); watchdog.js install --apply runs it too, and so does each run of the watchdog's host job when the units are missing.`;
  const id = (who && who.roleId) || env.DELIVERY_ROLE_ID || M.canonicalRoleId(env.DELIVERY_ROLE) || null;
  if (id === HM.ROLE) return null;
  // the Chief of Staff's own unit runs run-session in its role directory, for that role alone
  if (cmd === 'run-session' && id && id !== HM.ROLE && UNIT_ROLES.includes(id) && instance && M.canonicalRoleId(instance) === id) return null;
  return `host-manager.js: ${cmd} is the host manager's (${role}${id ? `, role ${id}` : ''}); message the host manager with what is down.`;
}

function main(argv, { cwd = process.cwd(), env = process.env, who, ...deps } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `host-manager.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['status', 'restart', 'tick', 'install', 'install-role', 'run-session'].includes(cmd) || o._.length > 1) return { code: 2, out: USAGE };
  if (cmd !== 'status') {
    const me = who || (() => { try { return require('./lib/gate-context.js').whoAmI({ cwd, env }); } catch (err) { return {}; } })();
    const no = refusal(cmd, cwd, env, me, o.instance);
    if (no) return { code: 1, out: no };
  }
  const d = { env, cwd, who, ...deps };
  if (cmd === 'run-session') {
    if (!o.project || !o.instance) return { code: 2, out: `host-manager.js: run-session needs --project <root> and --instance <id>\n${USAGE}` };
    return runSession(path.resolve(o.project), o, d);
  }
  if (cmd === 'install-role') {
    if (!o.project) return { code: 2, out: `host-manager.js: install-role needs --project <root> (the team whose Chief of Staff it serves)\n${USAGE}` };
    return installRole(path.resolve(o.project), o, d);
  }
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

module.exports = { UNIT_ROLES, roleUnitName, roleUnitFiles, installRole, liveHostManager, main, read, status, restart, tick, install, installTarget, runSession, sessionArgs, unitFiles, refusal, deliverAlert, lastPassOf, factsOf, sessionsNow, POLL_EVERY_MS, POLL_MAX_MS };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `host-manager.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}
