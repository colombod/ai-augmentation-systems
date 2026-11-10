// scripts/lib/service-limits.test.js — a service's TasksMax is read against the team's role sessions on
// its host (hjx.1.6.14: a Chief of Staff service at TasksMax 300 started two or three roles), with
// systemctl injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const SL = require('./service-limits.js');
const { serviceLimitRows } = require('../start.js');

const team = { project: 'ex', prefix: 'ex', roles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc', count: 4 }, { id: 'tech-writer', host: 'cloud' }, { id: 'old', host: 'pc', retired: true }] };

// a systemctl that knows units: { name: { TasksMax, TasksCurrent } }; list fails when units is null
function systemctl(units) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (units === null) return { ok: false, out: '', err: 'Failed to connect to bus: No medium found' };
    if (args[1] === 'list-units') return { ok: true, out: Object.keys(units).map((u) => `${u} loaded active running x`).join('\n') };
    if (args[1] === 'show') { const u = units[args[args.length - 1]]; return { ok: true, out: Object.entries(u).map(([k, v]) => `${k}=${v}`).join('\n') }; }
    return { ok: false, out: '' };
  };
  return { run, calls };
}

test('a service needs 200 tasks per role session on its host plus its own, never under 4096', () => {
  assert.equal(SL.sessionsOn(team, 'pc'), 5, 'chief + four builders; another host and a retired role do not count');
  assert.equal(SL.sessionsOn(null, 'pc'), 0);
  assert.equal(SL.sessionsOn({ roles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'staffing' }] }, 'pc'), 1, 'a role with no host field is counted on no host');
  assert.equal(SL.tasksMaxFor(0), 4096);
  assert.equal(SL.tasksMaxFor(5), 4096);
  assert.equal(SL.tasksMaxFor(30), 6200);
});

test('each delivery and Remote Control service is read with its limit; one under what the team needs warns with the command that raises it', () => {
  const s = systemctl({
    'delivery-watchdog-f9e11c68.service': { TasksMax: '4096', TasksCurrent: '486', ActiveState: 'activating' },
    'claude-rc-chief-of-staff.service': { TasksMax: '300', TasksCurrent: '182', ActiveState: 'active' },
    'claude-rc-x.service': { TasksMax: 'infinity', TasksCurrent: '18446744073709551615', ActiveState: 'inactive' },
  });
  const services = SL.readServices(s.run);
  assert.deepEqual(s.calls[0], ['systemctl', '--user', 'list-units', '--type=service', '--all', '--no-legend', '--plain', 'delivery-*.service', 'claude-rc-*.service']);
  assert.deepEqual(services.map((x) => [x.unit, x.tasksMax, x.tasksCurrent]), [['delivery-watchdog-f9e11c68.service', 4096, 486], ['claude-rc-chief-of-staff.service', 300, 182], ['claude-rc-x.service', Infinity, null]]);
  const rows = SL.serviceRows(services, 12);
  assert.deepEqual(rows.map((r) => r.status), ['pass', 'warn', 'pass']);
  assert.match(rows[1].detail, /TasksMax 300, 182 in use; the team has 12 role sessions on this host, which need 4096/);
  assert.match(rows[1].fix, /^systemctl --user set-property claude-rc-chief-of-staff\.service TasksMax=4096/);
  assert.equal(rows[0].status, 'pass');
  assert.ok(rows.every((r) => r.hard === false), 'a low limit never fails --check: it warns');
  // a limit exactly at what the team needs passes; one below warns
  assert.equal(SL.serviceRows([{ unit: 'u.service', tasksMax: 6200, tasksCurrent: 1 }], 30)[0].status, 'pass');
  assert.equal(SL.serviceRows([{ unit: 'u.service', tasksMax: 6199, tasksCurrent: 1 }], 30)[0].status, 'warn');
});

test('a role\'s own unit holds one session and needs one session\'s limit, not the team\'s', () => {
  const rows = SL.serviceRows([{ unit: 'delivery-role-builder-2.service', tasksMax: 1000, tasksCurrent: 52 }, { unit: 'delivery-role-staffing.service', tasksMax: 999, tasksCurrent: 5 }, { unit: 'delivery-watchdog-x.service', tasksMax: 1000, tasksCurrent: 5 }], 12);
  assert.deepEqual(rows.map((r) => r.status), ['pass', 'warn', 'warn']);
  assert.match(rows[0].detail, /it holds one role session, which needs 1000/);
  assert.match(rows[1].fix, /TasksMax=1000/);
  assert.match(rows[2].detail, /the team has 12 role sessions on this host, which need 4096/);
});

test('systemctl that cannot be read is one unknown row, never a pass; a limit that cannot be read is unknown; no services is no rows', () => {
  const rows = SL.serviceRows(SL.readServices(systemctl(null).run), 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unknown');
  assert.match(rows[0].detail, /No medium found/);
  assert.equal(SL.serviceRows([{ unit: 'u.service', tasksMax: null, tasksCurrent: null }], 5)[0].status, 'unknown');
  assert.deepEqual(SL.serviceRows([], 5), []);
  assert.equal(SL.num('[not set]'), null);
});

test('start.js --check reads the team on this host from team.json and rates every service against it', () => {
  const rows = serviceLimitRows({ team, host: 'pc', services: [{ unit: 'claude-rc-chief-of-staff.service', tasksMax: 300, tasksCurrent: 182 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'warn');
  assert.match(rows[0].detail, /the team has 5 role sessions on this host/);
  assert.match(serviceLimitRows({ team, host: 'cloud', services: [{ unit: 'a.service', tasksMax: 300, tasksCurrent: 1 }] })[0].detail, /the team has 1 role session on this host/);
});
