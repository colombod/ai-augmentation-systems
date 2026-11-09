#!/usr/bin/env node
// scripts/team-revive.js — the product team's role sessions on this host are running whenever the product
// has work in flight, on the Remote Control links the owner follows (dec-chief-of-staff-000279);
// lib/team-revive.js holds the rules.
//   team-revive.js check [--json] [--project <root>]   read-only: for each role instance of this team on
//                                                      this host, whether a session runs in its role
//                                                      directory, the work in flight, and per missing
//                                                      instance the command start would run. A source that
//                                                      cannot be read is a line that says so.
//   team-revive.js start [--dry-run] [--project <root>] starts each missing instance, detached, in its role
//                                                      directory: `claude remote-control --name <instance>@<team>
//                                                      --spawn session --permission-mode <team mode>`, or with
//                                                      `--session-id <id>` in place of `--spawn session` when a
//                                                      Remote Control session was recorded for it, each in its
//                                                      own `systemd-run --user --scope` where systemd runs. A start
//                                                      whose process exits within a minute is a failed row,
//                                                      retried at the next pass. Only with
//                                                      work in flight and no owner pause; one start per
//                                                      instance an hour, six a day; each start is a row in
//                                                      the watchdog's revive.ndjson, its output in its logs.
// The host job runs start each pass (watchdog.js run). In a role session only the Chief of Staff and the
// host manager may run start: no other role starts sessions (R-42). --project names any team's root, so
// the host manager checks and starts every team on its machine from its own role directory. Exit codes: 0 ok (a missing session is not an error); 1
// refused; 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./lib/team-revive.js');
const WD = require('./lib/watchdog.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: team-revive.js check [--json] | team-revive.js start [--dry-run]   (each takes --project <root>)';
const CHIEF = 'chief-of-staff';
// the host manager restarts every team on its machine (scripts/host-manager.js), so it starts sessions too
const STARTERS = [CHIEF, 'host-manager'];

function parse(argv) {
  const o = { _: [], json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--project') { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); o.project = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

// A Remote Control server alive at pid: a pid the system gave to another program since is not ours.
// true, false, or null when ps fails (throws, exits non-zero, times out): the process list could not be
// read, which is neither running nor gone (lib/team-revive.js assess names it and starts nothing).
const psCommand = (pid) => require('child_process').execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
function serverAlive(pid, { exec = psCommand, kill = (p) => process.kill(p, 0) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid); } catch (err) { if (err.code !== 'EPERM') return false; }
  let cmd;
  try { cmd = String(exec(pid)); } catch (err) { return null; }
  return !cmd.trim() || /remote-control/.test(cmd);
}

// The Remote Control server a session process runs under: its parent, when that parent's command is
// `claude remote-control` (claude 2.1.318 runs each Remote Control session as a child `--print --sdk-url`
// process of the server, read on a real host). { pid, self } with self when this very process runs
// inside it (stopping it would stop this pass), null when the parent is no Remote Control server, or
// { unreadable } when ps fails.
const psRow = (pid) => require('child_process').execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
function parentOf(pid, exec) {
  const m = String(exec(pid)).trim().match(/^(\d+)\s+([\s\S]*)$/);
  return m ? { ppid: Number(m[1]), command: m[2] } : null;
}
const RC_SERVER = /(^|[\s/])claude(\s|$)[\s\S]*\bremote-control\b/;
function serverOf(pid, { exec = psRow, self = process.pid } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const p = parentOf(pid, exec);
    if (!p || p.ppid <= 1) return null;
    const server = parentOf(p.ppid, exec);
    if (!server || !RC_SERVER.test(server.command)) return null;
    // this process inside the server's tree: walk up from here, a bounded number of steps
    let inside = false;
    let q = self;
    for (let n = 0; n < 32 && q > 1; n++) {
      if (q === p.ppid) { inside = true; break; }
      const r = parentOf(q, exec);
      if (!r) break;
      q = r.ppid;
    }
    return { pid: p.ppid, self: inside };
  } catch (err) { return { unreadable: String(err.message || err).split('\n')[0].slice(0, 120) }; }
}

// Stop a Remote Control server and wait for it and its session to be gone: true when both are, false
// after waitMs (a server that did not stop is never doubled by a second one in its directory).
const sleep = (msec) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, msec);
function stopServer(serverPid, sessionPid, { kill = (p, sig) => process.kill(p, sig), waitMs = 15000, stepMs = 250 } = {}) {
  const gone = (p) => { if (!p) return true; try { kill(p, 0); return false; } catch (err) { return err.code !== 'EPERM'; } };
  try { kill(serverPid, 'SIGTERM'); } catch (err) { if (err.code !== 'ESRCH') return false; }
  for (let waited = 0; waited <= waitMs; waited += stepMs) {
    if (gone(serverPid) && gone(sessionPid)) return true;
    sleep(stepMs);
  }
  return false;
}

// The open pull requests of the product repository, or { unreadable } with why.
function openPrs(team, env) {
  const repo = require('./lib/gh-pr.js').productRepoOf(team);
  if (!repo) return { unreadable: 'the product repository is not known: team.json has no product_github' };
  const r = require('child_process').spawnSync('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,headRefName', '--limit', '200'], { encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) return { unreadable: `gh pr list --repo ${repo} failed: ${String(r.stderr || r.error || `exit ${r.status}`).trim().split('\n')[0].slice(0, 160)}` };
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (err) { return { unreadable: 'gh pr list gave no JSON' }; }
  return Array.isArray(j) ? j : { unreadable: 'gh pr list gave no list' };
}

// The facts the rules read, each from its own source; deps replace any of them in a test.
function gather(root, team, { env = process.env, now, bd, live, prs, alive, hostname, home, configDir, pause, installed, server } = {}) {
  const config = configDir || R.configDirOf(env, home);
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const store = bd || require('./lib/bd.js').makeBd({ cwd: root, env, timeoutMs: 15000 });
  let inProgress;
  try { inProgress = store.list({ status: 'in_progress' }) || []; } catch (err) { inProgress = { unreadable: String(err.message || err).split('\n')[0].slice(0, 160) }; }
  let paused;
  try { paused = Boolean((pause || ((r) => require('./lib/goal.js').activePause(r, { warn: false })))(root).paused); } catch (err) { paused = { unreadable: String(err.message || err).split('\n')[0].slice(0, 160) }; }
  let roster = {};
  try { roster = require('./lib/roster.js').readRoster(root).instances || {}; } catch (err) { roster = {}; }
  return {
    now: now || new Date().toISOString(),
    host: R.hostOf(env, hostname !== undefined ? hostname : os.hostname()),
    team,
    roster,
    live: live !== undefined ? live : require('./watchdog.js').liveSessions(bin, env),
    bridges: R.bridgeSessions(config),
    pointer: (dir) => R.pointerOf(config, dir),
    defaultDir: (instance) => path.join(root, '..', `${team && team.project}-team`, instance),
    exists: (dir) => fs.existsSync(dir),
    inProgress,
    prs: prs !== undefined ? (typeof prs === 'function' ? prs(team) : prs) : openPrs(team, env),
    messages: require('./lib/inbox.js').pending(root),
    handoffs: require('./lib/handoff.js').pending(root),
    paused,
    rows: R.ledger(root),
    alive: alive || serverAlive,
    // the installed plugin: the host job runs it (watchdog.js self-update installs before a pass wakes anyone)
    installed: installed !== undefined ? installed : require('./lib/plugin-version.js').runningVersion(),
    serverOf: server || serverOf,
  };
}

// The environment of a started session: no identity of the session that ran this (a Chief of Staff's
// role, actor and Remote Control bridge variables would make the new session answer as it), and the
// role it serves; its role directory's settings set the rest at its start, as for every role session.
const CALLER_VARS = ['DELIVERY_ROLE_ID', 'DELIVERY_ROLE_DIR', 'DELIVERY_PROJECT_ROOT', 'DELIVERY_RUNNER', 'DELIVERY_MODE', 'DELIVERY_LARGE_MODEL', 'DELIVERY_WAKE', 'DELIVERY_WAKE_ID', 'DELIVERY_WAKE_KICK', 'BEADS_ACTOR'];
function startEnv(env, instance) {
  const out = require('./lib/fresh-session-env.js').freshSessionEnv(env, {});
  for (const k of CALLER_VARS) delete out[k];
  for (const k of Object.keys(out)) if (/^CLAUDE_CODE_(BRIDGE_|SESSION_ACCESS_TOKEN|ENVIRONMENT_KIND|WORKER_EPOCH|RESUME_INTERRUPTED_TURN)/.test(k)) delete out[k];
  return { ...out, DELIVERY_ROLE: instance };
}

// Detached, its output in a log: a Remote Control server lives as long as its session, never bounded by
// the wake's two-hour limit (lib/wake-run.js), and outlives the run or the session that started it.
function spawnRemote(bin, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = require('child_process').spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', (err) => { try { fs.appendFileSync(logPath, `team-revive: could not start ${bin}: ${err.message}\n`); } catch (e) { /* the log is best effort */ } });
  child.unref();
  fs.closeSync(fd);
  return child.pid || null;
}

// systemd-run where it can reach this user's systemd manager (Linux with a user manager: the host job's
// service runs under it, and so does a desktop login), else null, and a start is a plain detached child.
// The manager is reached through XDG_RUNTIME_DIR, so without it systemd-run --user would fail every start.
function systemdRunOf(env = process.env, { platform = process.platform, exists = fs.existsSync } = {}) {
  if (platform !== 'linux' || !env.XDG_RUNTIME_DIR) return null;
  const rt = env.XDG_RUNTIME_DIR;
  if (!exists(path.join(rt, 'systemd', 'private')) && !exists(path.join(rt, 'bus'))) return null;
  for (const d of String(env.PATH || '/usr/bin:/bin').split(path.delimiter)) {
    const f = path.join(d || '.', 'systemd-run');
    if (d && exists(f)) return f;
  }
  return null;
}

// systemd-run's own refusal in a start's log, before claude ran: "Failed to start transient scope unit",
// "Failed to connect to bus", "Failed to create bus connection", an unknown property
const SYSTEMD_RUN_REFUSED = /^(Failed to (start transient|connect to (bus|user scope bus)|create bus connection|set unit properties)|Unknown assignment|Failed to parse)/m;
function systemdRunRefused(logFile) {
  try { return SYSTEMD_RUN_REFUSED.test(fs.readFileSync(logFile, 'utf8')); } catch (err) { return false; }
}

// Whether pid has exited: gone, or a zombie (a detached child of this pass that died is not reaped while
// the pass runs synchronously). A process that cannot be read is taken as still running.
function exited(pid) {
  try { process.kill(pid, 0); } catch (err) { return err.code !== 'EPERM'; }
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return st.slice(st.lastIndexOf(')') + 2, st.lastIndexOf(')') + 3) === 'Z';
  } catch (err) { /* no /proc: macOS */ }
  try { return /^Z/.test(String(require('child_process').execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })).trim()); } catch (err) { return false; }
}
// The pids among pids that exit within waitMs, polled every stepMs; returns early once all have exited.
function settleStarts(pids, { waitMs = R.SETTLE_MS, stepMs = 2000, isExited = exited, sleep = (t) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, t) } = {}) {
  const gone = new Set(pids.filter((p) => !Number.isInteger(p) || p <= 0));
  for (let waited = 0; ; waited += stepMs) {
    for (const p of pids) if (!gone.has(p) && isExited(p)) gone.add(p);
    if (gone.size === pids.length || waited >= waitMs) return gone;
    sleep(Math.min(stepMs, waitMs - waited));
  }
}

// check, or start: { a, lines, started }. The remote session ids claude recorded are copied into the
// roster on a start pass, so the next start reattaches the owner's link even when claude's own files go.
// A start pass holds the project's start lock (lib/team-revive.js startLock) from its read of the facts to
// its last ledger row, so a second pass (the Chief of Staff's beside the host job's) sees the first's
// starts or starts nothing. check and --dry-run read only and take no lock.
function revive(root, team, opts = {}) {
  if (!opts.start || opts.dryRun) return revivePass(root, team, opts);
  // the guard holds for every caller, a script loading this module included: a start from a role
  // session that may not start sessions is refused here as main() refuses it
  // read twice, the process this runs in and what the caller passes, and refused when either is a role
  // session that may not start sessions: a caller's cwd or env can only make it stricter
  const no = callerRefusal(process.cwd(), process.env) || callerRefusal(opts.cwd || process.cwd(), opts.env || process.env);
  if (no) throw new Error(no);
  const lock = R.startLock(root);
  if (lock.held) {
    const { start, dryRun, env = process.env, spawn, ...deps } = opts;
    const a = { ...R.assess(gather(root, team, { env, ...deps })), go: false, locked: lock.held };
    return { a, started: {}, lines: [`Not started now: another start pass holds the start lock (pid ${lock.held.pid || 'unknown'}, ${path.relative(root, R.lockFile(root))}); it starts what is missing.`] };
  }
  try { return revivePass(root, team, opts); } finally { lock.release(); }
}

// A stale session is restarted only after a second read of the open sessions finds it still idle (the
// first read may be seconds old), and only once its server stopped; each restart is a ledger row.
function restartStale(root, f, a, { env, bin, spawn, stop, relist, systemdRun = null }) {
  const out = {};
  for (const i of a.stale.filter((x) => !x.stale.skip && !x.stale.held)) {
    const st = i.stale;
    const now = relist();
    if (!Array.isArray(now)) { out[i.instance] = { why: 'the open sessions could not be read again just before the stop' }; continue; }
    const row = now.find((s) => s && s.sessionId === st.session);
    if (!row) { out[i.instance] = { why: 'its session is no longer open; the next pass starts it if it is missing' }; continue; }
    if (row.status !== 'idle') { out[i.instance] = { why: `it became ${row.status || 'busy'} just before the stop` }; continue; }
    const at = f.now;
    if (!stop(st.server, st.pid)) {
      R.record(root, { type: 'restart-failed', at, instance: i.instance, server: st.server, from: st.version, to: st.installed });
      out[i.instance] = { why: `its Remote Control server (pid ${st.server}) did not stop` };
      continue;
    }
    const logPath = path.join(root, WD.REL, 'logs', `revive-${i.instance}-${at.replace(/[:.]/g, '-')}.log`);
    let pid;
    // a restarted session gets its own scope too, as a start does
    const cmd = R.scopedCommand(bin, st.args, { instance: i.instance, at, systemdRun });
    try { pid = spawn(cmd.bin, cmd.args, { cwd: i.roleDir, env: startEnv(env, i.instance), logPath }); } catch (err) {
      // its server is already stopped: the row says so, the caps count it, and the next pass starts the missing session
      R.record(root, { type: 'restart-failed', at, instance: i.instance, server: st.server, stopped: st.server, from: st.version, to: st.installed, error: err.message });
      out[i.instance] = { why: `its Remote Control server stopped, and the new one did not start: ${err.message}` };
      continue;
    }
    R.record(root, { type: 'restart', at, instance: i.instance, pid, args: st.args, ...(cmd.unit ? { unit: cmd.unit } : {}), session_id: st.remoteId, mode: st.mode, from: st.version, to: st.installed, stopped: st.server, log: path.relative(root, logPath) });
    out[i.instance] = { pid, log: path.relative(root, logPath) };
  }
  return out;
}

// only: the instances a start may bring back (the host manager's restart starts the ones that hold
// work and leaves an idle one down); unset, every missing instance
// A start pass spawns every missing instance, then waits SETTLE_MS (settle) for any that exit at once: those
// get a 'failed' row, are named Failed, and the next pass retries them (lib/team-revive.js assess). settle is
// the real wait only with the real spawn; a test that injects spawn injects settle too, or gets none.
function revivePass(root, team, { start = false, dryRun = false, env = process.env, spawn = spawnRemote, stop = stopServer, relist, settle, systemdRun, only = null, ...deps } = {}) {
  const f = gather(root, team, { env, ...deps });
  const a = R.assess(f);
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const started = {};
  const sdRun = systemdRun !== undefined ? systemdRun : systemdRunOf(env);
  if (start && !dryRun) {
    const RO = require('./lib/roster.js');
    for (const i of a.instances) if (i.remoteId && f.roster[i.instance] && f.roster[i.instance].remote_session_id !== i.remoteId) { try { RO.setRemoteSession(root, { instance: i.instance, remote_session_id: i.remoteId }); } catch (err) { /* the next pass records it */ } }
  }
  if (start && !dryRun && a.go) {
    for (const i of a.missing.filter((x) => !x.skip && !x.held && (!only || only.includes(x.instance)))) {
      const at = f.now;
      const logPath = path.join(root, WD.REL, 'logs', `revive-${i.instance}-${at.replace(/[:.]/g, '-')}.log`);
      const cmd = R.scopedCommand(bin, i.args, { instance: i.instance, at, systemdRun: sdRun });
      const pid = spawn(cmd.bin, cmd.args, { cwd: i.roleDir, env: startEnv(env, i.instance), logPath });
      R.record(root, { type: 'start', at, instance: i.instance, pid, args: i.args, session_id: i.remoteId, mode: i.mode, log: path.relative(root, logPath), ...(cmd.unit ? { unit: cmd.unit } : {}) });
      started[i.instance] = { pid, log: path.relative(root, logPath), at, args: i.args, roleDir: i.roleDir, ...(cmd.unit ? { unit: cmd.unit } : {}) };
    }
    const wait = settle !== undefined ? settle : (spawn === spawnRemote ? settleStarts : null);
    const failStarts = (names) => {
      if (!wait || !names.length) return [];
      const gone = wait(names.map((n) => started[n].pid));
      const out = names.filter((n) => gone.has(started[n].pid));
      for (const n of out) {
        started[n].failed = true;
        R.record(root, { type: 'failed', at: new Date().toISOString(), instance: n, pid: started[n].pid, start_at: started[n].at, why: `exited within ${Math.round(R.SETTLE_MS / 1000)}s of its start`, log: started[n].log, ...(started[n].unit ? { unit: started[n].unit } : {}) });
      }
      return out;
    };
    // a scoped start whose log shows systemd-run's own refusal (no user manager, a refused property) never
    // reached claude: it is started again at once as a plain detached child, which the next start of the
    // pass waits for in turn, so a host where systemd-run fails still starts its team
    for (const n of failStarts(Object.keys(started)).filter((x) => started[x].unit && systemdRunRefused(path.join(root, started[x].log)))) {
      const was = started[n];
      const at = new Date().toISOString();
      const logPath = path.join(root, WD.REL, 'logs', `revive-${n}-${at.replace(/[:.]/g, '-')}.log`);
      const pid = spawn(bin, was.args, { cwd: was.roleDir, env: startEnv(env, n), logPath });
      R.record(root, { type: 'start', at, instance: n, pid, args: was.args, session_id: (a.missing.find((x) => x.instance === n) || {}).remoteId || null, log: path.relative(root, logPath), fallback_from: was.unit });
      started[n] = { pid, log: path.relative(root, logPath), at, args: was.args, roleDir: was.roleDir, fallbackFrom: was.unit };
      failStarts([n]);
    }
  }
  let restarted = {};
  if (start && !dryRun && a.restart && a.stale.length) {
    const again = relist || (() => (deps.live !== undefined ? deps.live : require('./watchdog.js').liveSessions(bin, env)));
    restarted = restartStale(root, f, a, { env, bin, spawn, stop, relist: again, systemdRun: sdRun });
  }
  return { a, started, restarted, lines: R.lines(a, { bin, started, restarted, dryRun: start && dryRun }) };
}

// A role session other than the Chief of Staff's or the host manager's never starts sessions; outside any role session (the
// host job, the owner's shell) start runs. The role is read from the marker in or above the directory,
// else from the session's environment, as the watchdog reads it.
function refusal(cwd, env, who) {
  const role = require('./watchdog.js').roleContext(cwd, env);
  if (!role) return null;
  const id = who.roleId || env.DELIVERY_ROLE_ID || require('./lib/manifest.js').canonicalRoleId(env.DELIVERY_ROLE) || null;
  if (STARTERS.includes(id)) return null;
  return `team-revive.js: start is the Chief of Staff's, the host manager's and the host job's (${role}${id ? `, role ${id}` : ''}); run team-revive.js check and tell the Chief of Staff what is missing.`;
}

// The role of the session calling, from its role marker (the instance it names in team.json) or its
// environment, as refusal() reads it, for a caller that gives no who.
function callerRefusal(cwd, env) {
  let who = { roleId: null };
  try {
    const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js');
    const v = validMarker(findRoleMarker(cwd));
    if (v) who = { roleId: v.role.id };
  } catch (err) { who = { roleId: null }; }
  return refusal(cwd, env, who);
}

function main(argv, { cwd = process.cwd(), env = process.env, ...deps } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `team-revive.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['check', 'start'].includes(cmd) || o._.length > 1) return { code: 2, out: USAGE };
  const { who: given, ...rest } = deps;
  let who = given || whoAmI({ cwd, env, project: o.project });
  // --project names the team, wherever this runs: in a role directory the marker names the session's own
  // team, and the host manager reads and starts every team on its machine from its own one
  if (!given && o.project && path.resolve(o.project) !== who.root) {
    const root = path.resolve(o.project);
    let team = null;
    try { team = require('./lib/manifest.js').loadManifest(root).team; } catch (err) { team = null; }
    who = { ...who, root, team };
  }
  if (cmd === 'start') { const no = refusal(cwd, env, who); if (no) return { code: 1, out: no }; }
  if (!who.root) return { code: 2, out: 'team-revive.js: no project found; pass --project <root>' };
  const r = revive(who.root, who.team, { start: cmd === 'start', dryRun: o.dryRun, env, cwd, ...rest });
  if (o.json) return { code: 0, out: JSON.stringify({ ...r.a, started: r.started, restarted: r.restarted || {} }, null, 2) };
  return { code: 0, out: r.lines.join('\n') };
}

module.exports = { main, revive, gather, startEnv, refusal, callerRefusal, serverAlive, serverOf, stopServer, systemdRunOf, settleStarts, exited, systemdRunRefused };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `team-revive.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}
