// scripts/lib/pid-alive.test.js — a wake pid counts as a running wake only while it is that wake.
// clock-sensitive
// (it compares a real process's kernel start with row times, so the clock guard re-runs it under shifted
// clocks: scripts/testing/clock-guard.test.js)
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
  // a hung wake past its timeout is still that wake (pidAlive tells the truth about the process); the host
  // job ends it (lib/watchdog.js overdueWakes, stopWake), so it no longer holds the install (hjx.1.6.20.1)
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + 91 * 3600e3, proc: proc() }), true);
});

test('a pid the system gave to another program after the wake ended is not a running wake', () => {
  // the reported case: the pid now runs a PDF tool server, started nine days after the wake row
  const pdf = proc({ cmd: 'node mcp-pdf-server --stdio', started: T0 + 9 * 24 * 3600e3 });
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

test('an unreadable pid counts for the wake timeout plus the kill grace, which wake-run.js may still live', () => {
  const blind = proc({ cmd: null, started: null });
  const bound = WD.WAKE_TIMEOUT_H * 3600e3 + WD.KILL_GRACE_MS;
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + bound - 1000, proc: blind }), true, 'inside the grace');
  assert.equal(WD.pidAlive(4242, { since: iso(T0), now: T0 + bound + 1000, proc: blind }), false, 'past it');
});

// rv-204: the system's own reads, on a real supervisor, and the host job's check that uses them
const fs = require('fs');
const path = require('path');
function realSupervisor(t) {
  if (!fs.existsSync('/proc/self/stat')) { t.skip('no /proc on this host'); return null; }
  const sup = require('child_process').spawn(process.execPath, [path.join(__dirname, 'wake-run.js'), '60000', process.execPath, '-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore', detached: true });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  // every time in these cases is built from the supervisor's own start, as the kernel reports it: the
  // suite may run with its clock a month ahead (CI), and a real process starts on the real clock
  const spawnedAt = WD.procReads.startedMs(sup.pid);
  const stop = () => { try { process.kill(-sup.pid, 'SIGKILL'); } catch (e) { /* gone */ } };
  if (!Number.isFinite(spawnedAt)) { stop(); t.skip('the start time of a process cannot be read here'); return null; }
  return { sup, spawnedAt, now: spawnedAt + 5000, stop };
}

test('a real wake supervisor is that wake for a row written just after it started, and not for a row from long before', (t) => {
  const r = realSupervisor(t);
  if (!r) return;
  try {
    assert.equal(WD.pidAlive(r.sup.pid, { since: iso(r.spawnedAt + 1000), now: r.now }), true, 'its own row, written just after the spawn');
    assert.equal(WD.pidAlive(r.sup.pid, { since: iso(r.spawnedAt - 10 * 60e3), now: r.now }), false, 'a row from ten minutes before it existed is another wake');
  } finally { r.stop(); }
});

test('the host job asks with the row time and its clock: a wake ended in this run, or a pid reused since its row, holds nothing', (t) => {
  const r = realSupervisor(t);
  if (!r) return;
  try {
    const job = require('../watchdog.js');
    const now = r.now;
    assert.equal(job.wakeAlive(new Set(), now)(r.sup.pid, iso(r.spawnedAt + 1000)), true);
    assert.equal(job.wakeAlive(new Set(), now)(r.sup.pid, iso(r.spawnedAt - 10 * 60e3)), false, 'the row time reaches the check');
    assert.equal(job.wakeAlive(new Set([r.sup.pid]), now)(r.sup.pid, iso(r.spawnedAt + 1000)), false, 'its kick said it ended');
  } finally { r.stop(); }
});

// rv-204: the wake plan and the Delivery Manager's pass ask about a session's last wake with its row time
test('the wake plan does not hold a session on a reused pid, and holds an unreadable one only within the bound', () => {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pid-plan-'));
  try {
    const rowAt = T0;
    WD.log(root, { type: 'wake', at: iso(rowAt), keys: ['quiet:ex-8'], instance: 'builder', pid: 2162035 });
    const stall = { kind: 'quiet', key: 'quiet:ex-9', bead: 'ex-9', target: 'builder', due: true, line: 'ex-9 has not moved', prompt: 'Move ex-9.' };
    const asked = [];
    const planAt = (now, p) => WD.plan({ stalls: [stall] }, { root, now: iso(now), alive: (pid, since) => { asked.push(since); return WD.pidAlive(pid, { since, now, proc: p }); } });
    const later = rowAt + 12 * 24 * 3600e3;
    const reused = planAt(later, proc({ cmd: 'node mcp-pdf-server --stdio', started: rowAt + 9 * 24 * 3600e3 }));
    assert.equal(asked[0], iso(rowAt), 'the row time reaches the check');
    assert.deepEqual(reused.wakes.map((w) => w.keys).flat(), ['quiet:ex-9'], `a reused pid holds nothing: ${JSON.stringify(reused.held)}`);
    const blind = proc({ cmd: null, started: null });
    assert.match(planAt(rowAt + 30 * 60e3, blind).held[0].reason, /still running/, 'unreadable, inside the bound: held');
    assert.deepEqual(planAt(later, blind).wakes.map((w) => w.keys).flat(), ['quiet:ex-9'], 'unreadable, past the bound: not held');
    // the plan's own default check gets the row time too: this test process is no supervisor
    WD.log(root, { type: 'wake', at: iso(Date.now()), keys: ['quiet:ex-7'], instance: 'builder', pid: process.pid });
    assert.equal(WD.plan({ stalls: [stall] }, { root, now: iso(Date.now() + 2 * 3600e3) }).wakes.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the wake plan\'s own check reads a real supervisor by its row time: a row from long before it is another wake', (t) => {
  const r = realSupervisor(t);
  if (!r) return;
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pid-plan-real-'));
  try {
    const stall = { kind: 'quiet', key: 'quiet:ex-9', bead: 'ex-9', target: 'builder', due: true, line: 'ex-9 has not moved', prompt: 'Move ex-9.' };
    // a row from three hours before this supervisor existed: the pid is not that wake, so nothing holds
    WD.log(root, { type: 'wake', at: iso(r.spawnedAt - 3 * 3600e3), keys: ['quiet:ex-8'], instance: 'builder', pid: r.sup.pid });
    assert.equal(WD.plan({ stalls: [stall] }, { root, now: iso(r.now) }).wakes.length, 1);
    // its own row, just after it started: it holds
    WD.log(root, { type: 'wake', at: iso(r.spawnedAt + 1000), keys: ['quiet:ex-7'], instance: 'builder', pid: r.sup.pid });
    const held = WD.plan({ stalls: [stall] }, { root, now: iso(r.now) });
    assert.equal(held.wakes.length, 0);
    assert.match(held.held[0].reason, /still running/);
  } finally { r.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the Delivery Manager\'s pass asks about a holder\'s last wake with its row time', () => {
  const RW = require('./role-watch.js');
  const at = '2026-11-03T02:00:00Z';
  const asked = [];
  const res = RW.pass({ now: at, builders: ['builder-1'], beads: [{ id: 'ex-1', status: 'in_progress', assignee: 'u@h/builder-1', updated_at: '2026-11-02T20:00:00Z', created_at: '2026-11-02T09:00:00Z' }],
    sessions: [{ instance: 'builder-1', role: 'builder', lastActive: Date.parse('2026-11-02T20:00:00Z'), waitUntil: -Infinity, limit: null }],
    wakes: [{ type: 'wake', at: '2026-11-02T21:00:00Z', instance: 'builder-1', keys: ['assigned:ex-1'], pid: 2162035 }],
    alive: (pid, since) => { asked.push([pid, since]); return WD.pidAlive(pid, { since, now: Date.parse(at), proc: proc({ cmd: 'node mcp-pdf-server --stdio', started: Date.parse(at) - 60e3 }) }); } });
  assert.deepEqual(asked[0], [2162035, '2026-11-02T21:00:00Z']);
  assert.equal(res.instances[0].running, false, 'a reused pid is no running wake');
});
