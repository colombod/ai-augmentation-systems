// scripts/lib/role-scope.js — the one way the plugin starts a role session: in a systemd user scope of
// its own, outside the cgroup of whatever starts it (hjx.1.6.10.1.2).
//
// A session started by a service runs in that service's cgroup and shares its TasksMax. PR 189 put
// team-revive's starts in scopes of their own, but the watchdog's wake (a resume or a fresh session
// under lib/wake-run.js) and start.js --launch still spawned claude straight from the job, so a woken
// role ran inside delivery-watchdog-<hash>.service: the reality check on a8b06e2 found builder-4 there.
// Every spawn of a role session goes through roleCommand; scripts/role-scope.test.js lists the spawns
// and names any that does not.
const fs = require('fs');
const path = require('path');
const R = require('./team-revive.js');

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

// The command that starts bin args as instance's role session: { bin, args, unit }, under its own
// scope where systemd runs (lib/team-revive.js scopedCommand), else bin args as they are.
// systemdRun: a path to use, null for none, or left out to find it from env.
function roleCommand(bin, args, { instance, at = new Date().toISOString(), env = process.env, systemdRun } = {}) {
  return R.scopedCommand(bin, args, { instance, at, systemdRun: systemdRun !== undefined ? systemdRun : systemdRunOf(env) });
}

// systemd-run's own refusal in a start's log, before the command ran: "Failed to start transient scope
// unit", "Failed to connect to bus", "Failed to create bus connection", an unknown property
const SYSTEMD_RUN_REFUSED = /^(Failed to (start transient|connect to (bus|user scope bus)|create bus connection|set unit properties)|Unknown assignment|Failed to parse)/m;
function refusedIn(logFile) {
  try { return SYSTEMD_RUN_REFUSED.test(fs.readFileSync(logFile, 'utf8')); } catch (err) { return false; }
}
// how long a scoped start is watched for systemd-run's refusal: it refuses at once, before its command runs
const REFUSE_WAIT_MS = 3000;

// Starts bin args as instance's role session, detached, its output appended to logPath: in its own scope
// (roleCommand), and when systemd-run refuses that scope, once more as a plain child, but only if
// stillMissing() says the role has no live session by then (lib/one-session.js). Returns
// { pid, unit, fallbackFrom } for a start, or { pid: null, refused, why } when nothing runs: a refused
// scope with the role live by then, or the sessions unreadable. Before this, a refused scope left the
// wake logged as woken and --launch saying started, with nothing running (rv-202).
// deps (tests): spawn (child_process.spawn), settle(pids) -> Set of pids that exited.
// sdFetch: the service directory's (lib/service-directory.js); a scoped start that runs is registered there.
function startRole(bin, args, { instance, env = process.env, cwd, logPath, systemdRun, stillMissing = () => true, spawn = require('child_process').spawn, settle, sdFetch } = {}) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const run = (b, a) => {
    const fd = fs.openSync(logPath, 'a');
    const child = spawn(b, a, { cwd, env: require('./fresh-session-env.js').withoutTestRunMark(env), detached: true, stdio: ['ignore', fd, fd] });
    if (child && typeof child.on === 'function') child.on('error', (err) => { try { fs.appendFileSync(logPath, `could not start ${b}: ${err.message}\n`); } catch (e) { /* the log is best effort */ } });
    if (child && typeof child.unref === 'function') child.unref();
    fs.closeSync(fd);
    return (child && child.pid) || null;
  };
  const cmd = roleCommand(bin, args, { instance, env, systemdRun });
  const pid = run(cmd.bin, cmd.args);
  if (!cmd.unit || !pid) return { pid, unit: cmd.unit };
  const wait = settle || ((pids) => require('../team-revive.js').settleStarts(pids, { waitMs: REFUSE_WAIT_MS, stepMs: 100 }));
  if (!wait([pid]).has(pid) || !refusedIn(logPath)) {
    // the scope runs: registered with the service directory; one it cannot reach is registered next pass;
    // a name it lists under another owner is not posted, and the result says so (directoryHeld)
    let held = null;
    try { const SD = require('./service-directory.js'); const g = SD.register(SD.scopeName(cmd.unit), { fetch: sdFetch }); if (!g.ok && 'held' in g) held = g.why; } catch (err) { /* next pass */ }
    return held ? { pid, unit: cmd.unit, directoryHeld: held } : { pid, unit: cmd.unit };
  }
  let missing;
  try { missing = stillMissing(); } catch (err) { missing = null; }
  if (missing !== true) return { pid: null, refused: cmd.unit, why: missing === false ? 'it has a live session by now' : 'the open sessions could not be listed again' };
  return { pid: run(bin, args), unit: null, fallbackFrom: cmd.unit };
}

module.exports = { systemdRunOf, roleCommand, startRole, refusedIn, SYSTEMD_RUN_REFUSED, REFUSE_WAIT_MS };
