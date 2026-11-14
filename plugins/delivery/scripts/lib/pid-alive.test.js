// scripts/lib/pid-alive.test.js — a wake pid counts as a running wake only while it is that wake.
// hjx.1.6.20: a reality-checker wake recorded pid 2162035 on 2026-11-01 and ended; on 2026-11-10 the
// system gave that pid to an unrelated program (a session's PDF tool server). `ps -p` printed nothing
// for it on this host and the check took empty output as alive, so every install was held for 91 hours
// and no new wake started.
const test = require('node:test');
const assert = require('node:assert/strict');
const WD = require('./watchdog.js');

const T0 = Date.parse('2026-11-01T22:53:39Z');
const iso = (t) => new Date(t).toISOString();
const SUP = '/usr/bin/node /x/delivery/scripts/lib/wake-run.js 7200000 claude --resume s -p hi';
// a process that answers kill(pid, 0), with what /proc says about it (null: unreadable)
const proc = ({ cmd = SUP, started = T0 - 2000, exists = true } = {}) => ({
  exists: () => exists,
  cmdline: () => cmd,
  startedMs: () => started,
});

test('a wake supervisor that started with its wake row is a running wake', () => {
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 60e3, proc: proc() }), true);
  // a hung wake past its timeout is still that wake: it still holds, and the hold is reported overdue
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 91 * 3600e3, proc: proc() }), true);
});

test('a pid the system gave to another program after the wake ended is not a running wake', () => {
  // the reported case: the pid now runs a PDF tool server, started nine days after the wake row
  const pdf = proc({ cmd: 'node /home/u/.npm/_npx/x/node_modules/.bin/mcp-pdf-server --stdio', started: T0 + 9 * 24 * 3600e3 });
  assert.equal(WD.pidAlive(2162035, { since: iso(T0), now: T0 + 12 * 24 * 3600e3, proc: pdf }), false);
  // another program, whenever it started
  assert.equal(WD.pidAlive(2162035, { since: iso(T0), now: T0 + 60e3, proc: proc({ cmd: 'node server.js', started: T0 - 2000 }) }), false);
  // even a later wake supervisor on the same pid is a different wake than this row's
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 5 * 3600e3, proc: proc({ started: T0 + 3600e3 }) }), false);
  // a pid that no longer exists
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 60e3, proc: proc({ exists: false }) }), false);
});

test('a pid whose command and start cannot be read counts only within the wake timeout', () => {
  const blind = proc({ cmd: null, started: null });
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 60e3, proc: blind }), true, 'inside the timeout: kept, as before');
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + (WD.WAKE_TIMEOUT_H + 1) * 3600e3, proc: blind }), false, 'past it: never a hold with no end');
  // a known supervisor whose start time cannot be read is judged by its command alone
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 91 * 3600e3, proc: proc({ started: null }) }), true);
  // a readable command that is not a supervisor is not a wake, start time or not
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 60e3, proc: proc({ cmd: 'node other.js', started: null }) }), false);
});

test('with no wake row time, a pid is a running wake while it is a wake supervisor, as before', () => {
  assert.equal(WD.pidAlive(4242, { proc: proc() }), true);
  assert.equal(WD.pidAlive(4242, { proc: proc({ cmd: 'node other.js' }) }), false);
  assert.equal(WD.pidAlive(4242, { proc: proc({ cmd: null, started: null }) }), true, 'unknown and no row: kept, as before');
});

test('the default reads: this test process is no wake supervisor, and a pid that does not exist is not alive', () => {
  assert.equal(WD.pidAlive(process.pid), false);
  assert.equal(WD.pidAlive(process.pid, { since: iso(Date.now() - 1000) }), false);
  assert.equal(WD.pidAlive(2 ** 22 + 12345, { since: iso(Date.now()) }), false);
  assert.equal(WD.pidAlive(0), false);
});
