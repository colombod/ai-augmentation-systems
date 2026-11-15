// scripts/lib/service-limits.js — the systemd task limit (TasksMax) a service needs to hold the team's
// sessions, and the check that reads each delivery service's limit against the team size.
//
// A systemd service's cgroup has a TasksMax: every thread of every process in it counts. A Claude session
// is on the order of 100+ tasks (2026-11-08 on wintermute: a Chief of Staff service at TasksMax 300 held
// 182 tasks and started only two or three roles; the watchdog's at 600 held eight roles and aborted them
// all at their start). Role sessions now start in scopes of their own (lib/team-revive.js scopedCommand),
// but what a service starts inside itself (the watchdog's wakes, a session the owner started from a unit)
// still counts against it, so a unit must allow the whole team on its host. The sizing assumes at most
// one watchdog wake per role at once (the watchdog never wakes a role whose last wake still runs) at
// about 200 tasks each, plus the service's own process.
// A role counts on the host its team.json entry names; a role with no host field names no host, so it
// is counted on none.
const M = require('./manifest.js');

// the tasks a service allows per session it may hold, with room over the 100+ a session takes
const TASKS_PER_SESSION = 200;
// never less than this: the figure the owner approved for the watchdog service (2026-11-08)
const MIN_TASKS = 4096;

// a unit that holds one role session (delivery-role-<instance>, as the owner's manual starts named them):
// the limit a role's own scope gets (lib/team-revive.js SCOPE_LIMITS)
const ONE_SESSION_TASKS = 1000;
const ONE_SESSION_UNIT = /^delivery-role-/;

// the role instances of the team on host (none retired)
function sessionsOn(team, host) {
  if (!team || !Array.isArray(team.roles)) return 0;
  return M.expandInstances(team).filter((i) => !(i.role && i.role.retired) && (!host || i.role.host === host)).length;
}

// the TasksMax a service needs for n sessions: one per session plus its own, never under MIN_TASKS
const tasksMaxFor = (n) => Math.max(MIN_TASKS, TASKS_PER_SESSION * ((Number(n) || 0) + 1));

// The delivery services on this host and the Remote Control services that hold role sessions, read from
// systemctl --user: [{ unit, tasksMax: number | Infinity | null, tasksCurrent: number | null, state }],
// or { unreadable } when systemctl cannot be read. run(cmd, args) -> { ok, out, err }.
const PATTERNS = ['delivery-*.service', 'claude-rc-*.service'];
function readServices(run) {
  const list = run('systemctl', ['--user', 'list-units', '--type=service', '--all', '--no-legend', '--plain', ...PATTERNS]);
  if (!list.ok) return { unreadable: `systemctl --user list-units failed${list.err ? `: ${String(list.err).split('\n')[0].slice(0, 120)}` : ''}` };
  const units = String(list.out || '').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => /\.service$/.test(u || ''));
  const out = [];
  for (const unit of [...new Set(units)]) {
    const s = run('systemctl', ['--user', 'show', '-p', 'TasksMax', '-p', 'TasksCurrent', '-p', 'ActiveState', unit]);
    const kv = {};
    for (const l of String((s.ok && s.out) || '').split('\n')) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1).trim(); }
    const current = num(kv.TasksCurrent);
    out.push({ unit, tasksMax: num(kv.TasksMax), tasksCurrent: current === Infinity ? null : current, state: kv.ActiveState || null });
  }
  return out;
}
// systemd prints "infinity" (or the largest 64-bit value) for no limit, and that same value for a count
// it does not track; anything else unreadable is null
function num(v) {
  if (v === undefined || v === null || !/^(infinity|\d+)$/.test(String(v).trim())) return null;
  const n = Number(v);
  return v === 'infinity' || n >= 2 ** 63 ? Infinity : n;
}

// what unit needs with n role sessions on its host: one session's limit for a role's own unit, else the
// team's (the watchdog's wakes and a Remote Control service's starts run in its cgroup)
const needOf = (unit, n) => (ONE_SESSION_UNIT.test(unit) ? ONE_SESSION_TASKS : tasksMaxFor(n));

// The check rows for start.js --check: one per service, its limit against what it must hold.
function serviceRows(services, n) {
  if (services && services.unreadable) return [{ name: 'service task limits', status: 'unknown', detail: services.unreadable, fix: 'check with `systemctl --user show -p TasksMax <unit>`', hard: false }];
  if (!services || !services.length) return [];
  return services.map((s) => {
    const used = s.tasksCurrent !== null && s.tasksCurrent !== undefined ? `, ${s.tasksCurrent} in use` : '';
    const name = `service ${s.unit}`;
    if (s.tasksMax === null || s.tasksMax === undefined) return { name, status: 'unknown', detail: `TasksMax could not be read${used}`, fix: `check with \`systemctl --user show -p TasksMax ${s.unit}\``, hard: false };
    const max = s.tasksMax === Infinity ? 'infinity' : String(s.tasksMax);
    const one = ONE_SESSION_UNIT.test(s.unit);
    const need = needOf(s.unit, n);
    const detail = one ? `TasksMax ${max}${used}; it holds one role session, which needs ${need}` : `TasksMax ${max}${used}; the team has ${n} role session${n === 1 ? '' : 's'} on this host, which need ${need}`;
    return s.tasksMax >= need
      ? { name, status: 'pass', detail, hard: false }
      : { name, status: 'warn', detail, fix: `systemctl --user set-property ${s.unit} TasksMax=${need} (a session takes 100+ tasks, so a lower cap stops role starts)`, hard: false };
  });
}

module.exports = { TASKS_PER_SESSION, MIN_TASKS, ONE_SESSION_TASKS, needOf, PATTERNS, sessionsOn, tasksMaxFor, readServices, serviceRows, num };
