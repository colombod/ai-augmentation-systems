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

module.exports = { systemdRunOf, roleCommand };
