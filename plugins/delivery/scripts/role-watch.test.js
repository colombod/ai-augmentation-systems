// scripts/role-watch.test.js — the Delivery Manager's pass over the role instances holding work
// (lib/role-watch.js, `watchdog.js pass`), replayed on a real night: a builder woken every cycle for
// beads waiting on review, then a review sent back the next morning.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const RW = require('./lib/role-watch.js');
const W = require('./lib/watchdog.js');
const { registerInstance } = require('./lib/roster.js');
const { harness } = require('./testing/role-harness.js');
const watchdog = require('./watchdog.js');

const DM = 'delivery-lead';
const M = 60e3;
const iso = (t) => new Date(t).toISOString();
const T = (s) => Date.parse(s);

// the night: builder-2 holds two beads that wait on review (PR 150, PR 151) and one queued behind
// them; the watchdog woke it every 16 minutes from 20:33 for the beads it could not move
const EVENING = '2026-11-02T20:10:00Z';
const nightBeads = () => [
  { id: 'ex-4-4', status: 'in_progress', assignee: 'dev@pc/builder-2', priority: 0, updated_at: EVENING, created_at: '2026-11-02T09:00:00Z' },
  { id: 'ex-2ys', status: 'in_progress', assignee: 'dev@pc/builder-2', priority: 1, updated_at: EVENING, created_at: '2026-11-02T09:00:00Z' },
  { id: 'ex-8-2', status: 'in_progress', assignee: 'dev@pc/builder-2', priority: 1, updated_at: EVENING, created_at: '2026-11-02T09:00:00Z' },
  { id: 'ex-4-5', status: 'in_progress', assignee: 'dev@pc/builder-1', priority: 0, updated_at: '2026-11-02T19:00:00Z', created_at: '2026-11-02T09:00:00Z' },
];
const nightPrs = () => [{ pr: 150, state: 'waiting', beads: ['ex-2ys'] }, { pr: 151, state: 'waiting', beads: ['ex-4-4'] }];
// one wake every 16 minutes from 20:33 until `until`, each naming the beads it could not move
function nightWakes(until) {
  const out = [];
  for (let t = T('2026-11-02T20:33:00Z'); t <= T(until); t += 16 * M) out.push({ type: 'wake', at: iso(t), instance: 'builder-2', keys: ['assigned:ex-4-4', 'assigned:ex-2ys'], pid: 0 });
  return out;
}
const sessionsAt = (seen) => [
  { instance: 'builder-1', role: 'builder', lastActive: T(seen), waitUntil: -Infinity, limit: null },
  { instance: 'builder-2', role: 'builder', lastActive: T(seen), waitUntil: -Infinity, limit: null },
  { instance: DM, role: DM, lastActive: T(seen), waitUntil: -Infinity, limit: null },
];
const facts = (over = {}) => ({ dm: DM, builders: ['builder-1', 'builder-2'], beads: nightBeads(), ready: [], sessions: sessionsAt(EVENING), wakes: [], prs: nightPrs(), handoffs: [], messages: [], stallHours: 2, ...over });
const of = (res, i) => res.instances.find((x) => x.instance === i);
// a builder that holds nothing gets work only when it is live: its session is on this host's roster
const withB3 = (sessions, seen) => [...sessions, { instance: 'builder-3', role: 'builder', lastActive: T(seen), waitUntil: -Infinity, limit: null }];

test('TR-1: the pass acts on the builder woken for work it cannot move long before its 48th wake', () => {
  // 21:15: three wakes so far (20:33, 20:49, 21:05), none moved a bead
  const res = RW.pass(facts({ now: '2026-11-02T21:15:00Z', wakes: nightWakes('2026-11-02T21:15:00Z') }));
  const b2 = of(res, 'builder-2');
  assert.equal(b2.wakesToday, 3);
  assert.equal(b2.wasted, 3);
  assert.ok(b2.wakesToday < W.MESSAGE_DAILY_CAP, 'acted on before the cap is spent');
  assert.deepEqual(b2.onDm, ['ex-4-4', 'ex-2ys'], 'the beads in review are the manager\'s to move');
  assert.equal(b2.action.kind, 'note-block');
  assert.deepEqual(b2.action.beads, ['ex-4-4', 'ex-2ys']);
  // the reviews it waits on head the manager's own list
  assert.deepEqual(res.own.filter((o) => o.kind === 'pr').map((o) => o.ref), ['PR 150', 'PR 151']);
  // two wakes in, the pattern is not yet called
  const early = RW.pass(facts({ now: '2026-11-02T20:55:00Z', wakes: nightWakes('2026-11-02T20:55:00Z') }));
  assert.equal(of(early, 'builder-2').wasted, 2);
  assert.equal(of(early, 'builder-2').action, undefined);
});

test('TR-1: a review sent back reaches its builder at the next pass, whatever its wakes spent', () => {
  // 11:00 the next day: PR 151 is sent back; builder-2 last moved at 07:49 and has spent 48 wakes
  const prs = [{ pr: 150, state: 'waiting', beads: ['ex-2ys'] }, { pr: 151, state: 'sent-back', beads: ['ex-4-4'], sentBackAt: '2026-11-03T11:00:00Z', note: 'the test misses the second criterion' }];
  const wakes = nightWakes('2026-11-03T09:00:00Z');
  const res = RW.pass(facts({ now: '2026-11-03T11:05:00Z', prs, wakes, sessions: sessionsAt('2026-11-03T07:49:00Z') }));
  const b2 = of(res, 'builder-2');
  assert.equal(b2.action.kind, 'unblock');
  assert.equal(b2.action.pr, 151);
  assert.match(b2.action.message, /PR 151 was sent back to you: the test misses the second criterion/);
  assert.deepEqual(b2.action.beads, ['ex-4-4']);
  // the sent-back pull request is the builder's now, not the manager's
  assert.ok(!res.own.some((o) => o.ref === 'PR 151'));
  assert.match(RW.lines(res).join('\n'), /action: unblock: PR 151 was sent back .*Message builder-2: "PR 151 was sent back to you/);
  // once builder-2 touches the bead after the send-back, the result is taken
  const beads = nightBeads().map((b) => (b.id === 'ex-4-4' ? { ...b, updated_at: '2026-11-03T11:10:00Z' } : b));
  const after = RW.pass(facts({ now: '2026-11-03T11:20:00Z', prs, beads, wakes: [], sessions: sessionsAt('2026-11-03T11:10:00Z') }));
  assert.equal(of(after, 'builder-2').sentBack.length, 0);
});

test('TR-2: the pass lists every instance holding work as running, moving and wasted wakes, with an action for each that fails', () => {
  const now = '2026-11-02T23:30:00Z';
  const sessions = sessionsAt(EVENING).map((s) => (s.instance === 'builder-1' ? { ...s, lastActive: T('2026-11-02T23:25:00Z') } : s));
  const beads = nightBeads().map((b) => (b.id === 'ex-4-5' ? { ...b, updated_at: '2026-11-02T23:20:00Z' } : b));
  // builder-1 was woken at 23:00 and moved its bead at 23:20: that wake did its work
  const wakes = [...nightWakes(now), { type: 'wake', at: '2026-11-02T23:00:00Z', instance: 'builder-1', keys: ['assigned:ex-4-5'], pid: 0 }];
  const res = RW.pass(facts({ now, beads, sessions, wakes }));
  assert.deepEqual(res.instances.map((x) => x.instance), ['builder-1', 'builder-2']);
  const b1 = of(res, 'builder-1');
  assert.deepEqual([b1.running, b1.moving, b1.wakesToday, b1.wasted, b1.fails, b1.action], [true, true, 1, 0, [], undefined]);
  const b2 = of(res, 'builder-2');
  assert.deepEqual([b2.running, b2.moving], [false, false]);
  assert.ok(b2.fails.length && b2.action, 'a failing instance has an action');
  const text = RW.lines(res).join('\n');
  assert.match(text, /- builder-1: running yes, moving yes, wasted wakes 0 of 1 today; holds ex-4-5$/m);
  assert.match(text, /- builder-2: running no, moving no, wasted wakes 12 of 12 today; holds ex-4-4, ex-2ys, ex-8-2 \(waiting on you: ex-4-4, ex-2ys\)$/m);
  assert.match(text, /fails: 12 wakes today found nothing to do \(cap 48\); nothing moved for 3\.3 h \(limit 2 h\)/);
  // the manager itself holds no line: its own work is step 1
  const mine = RW.pass(facts({ now, beads: [...beads, { id: 'ex-dm', status: 'in_progress', assignee: `dev@pc/${DM}`, updated_at: EVENING }] }));
  assert.ok(!mine.instances.some((x) => x.instance === DM));
});

test('TR-3: the manager\'s own waiting merge, deploy or review comes before the role-instance check', () => {
  const now = '2026-11-02T23:30:00Z';
  const beads = [...nightBeads(), { id: 'ex-shipped', status: 'in_progress', assignee: 'dev@pc/builder-1', labels: ['state-merged'], updated_at: '2026-11-02T22:00:00Z' }];
  const handoffs = [{ id: 'h-1', bead: 'ex-shipped', step: 'deploy', to: DM, pr: '149', at: '2026-11-02T22:00:00Z' }];
  const res = RW.pass(facts({ now, beads, handoffs, prs: [...nightPrs(), { pr: 152, state: 'passed', beads: ['ex-8-2'] }], messages: [{ to: DM, entries: [{ from: 'builder-1', message: 'PR ready' }], upTo: 1 }] }));
  assert.deepEqual(res.own.map((o) => o.kind), ['handoff', 'message', 'pr', 'pr', 'pr']);
  assert.ok(!res.own.some((o) => o.kind === 'evidence' && o.ref === 'ex-shipped'), 'a bead with a handoff is listed once');
  const text = RW.lines(res);
  const first = text.findIndex((l) => /^1\. Yours first \(5\):/.test(l));
  const second = text.findIndex((l) => /^2\. Role instances holding work/.test(l));
  assert.ok(first > 0 && second > first, 'step 1 is printed before step 2');
  assert.ok(text.slice(first + 1, second).some((l) => /PR 152 \(ex-8-2\) is passed: run the merge check and merge it/.test(l)));
  assert.ok(text.slice(first + 1, second).some((l) => /ex-shipped: PR 149 is merged; deploy it and record it/.test(l)));
  // a holder whose work waits only on the manager is not failed for not moving it: the one line names
  // the manager's wait, and the action is a note, never a restart or a reassignment
  const only = RW.pass(facts({ now, beads: nightBeads().filter((b) => ['ex-4-4', 'ex-2ys'].includes(b.id)) }));
  assert.deepEqual(of(only, 'builder-2').fails, ['ex-4-4, ex-2ys wait on delivery-lead past 2 h']);
  assert.equal(of(only, 'builder-2').action.kind, 'note-block');
});

test('TR-4: every failing instance gets a note on its bead, once per change of action', () => {
  const h = harness({ beads: Object.fromEntries(nightBeads().map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const notes = (id) => String(bd.show(id).notes || '');
  const now = '2026-11-02T23:30:00Z';
  const res = RW.pass(facts({ now, wakes: nightWakes(now) }));
  const rec = RW.record(h.root, res, { bd });
  assert.deepEqual(rec.noted.sort(), ['ex-2ys', 'ex-4-4', 'ex-4-5', 'ex-8-2']);
  assert.match(notes('ex-4-5'), /delivery-lead pass: builder-1 fails \(nothing moved for 4\.5 h \(limit 2 h\)\); action restart/);
  assert.match(notes('ex-4-4'), /2026-11-02 delivery-lead pass: builder-2 fails \(12 wakes today found nothing to do \(cap 48\); nothing moved for 3\.3 h \(limit 2 h\)\); action note-block: builder-2 is woken for work that waits on delivery-lead/);
  // every stall the watchdog raises on held work (the lines the owner's briefing shows) has the note beside it
  const st = W.stalls({ beads: nightBeads(), ready: [], now, sessions: sessionsAt(EVENING), team: null }).stalls.filter((s) => s.kind === 'quiet');
  assert.deepEqual(st.map((s) => s.bead).sort(), ['ex-2ys', 'ex-4-4', 'ex-4-5', 'ex-8-2']);
  for (const s of st) assert.match(notes(s.bead), new RegExp(`delivery-lead pass: ${s.target} fails`));
  // the next pass, the same action: no second note, but the pass row is kept
  const again = RW.record(h.root, RW.pass(facts({ now: '2026-11-02T23:46:00Z', wakes: nightWakes('2026-11-02T23:46:00Z') })), { bd });
  assert.deepEqual(again.noted, []);
  assert.equal(RW.previous(h.root).length, 2);
  assert.equal(RW.previous(h.root)[1].instances.find((x) => x.instance === 'builder-2').action.kind, 'note-block');
  // a changed action is noted again
  const prs = [{ pr: 150, state: 'waiting', beads: ['ex-2ys'] }, { pr: 151, state: 'sent-back', beads: ['ex-4-4'], sentBackAt: '2026-11-02T23:50:00Z' }];
  const third = RW.record(h.root, RW.pass(facts({ now: '2026-11-02T23:55:00Z', prs, wakes: nightWakes('2026-11-02T23:55:00Z') })), { bd });
  assert.deepEqual(third.noted, ['ex-4-4', 'ex-2ys', 'ex-8-2'], 'builder-2\'s action changed; builder-1\'s did not');
  assert.match(notes('ex-4-4'), /action unblock: PR 151 was sent back/);
});

// the reviewer's probe on PR 158: a holder whose only beads wait on the manager, quiet past stall_hours,
// with no wasted wake. The watchdog raises each as a quiet stall; the pass names it and notes it.
test('TR-4: held work waiting only on the manager, quiet past stall_hours with no wasted wake, gets a note too', () => {
  const beads = nightBeads().filter((b) => ['ex-4-4', 'ex-2ys'].includes(b.id));
  const h = harness({ beads: Object.fromEntries(beads.map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const now = '2026-11-02T23:30:00Z';
  const res = RW.pass(facts({ now, beads, wakes: [] }));
  const b2 = of(res, 'builder-2');
  assert.equal(b2.wasted, 0);
  assert.deepEqual(b2.fails, ['ex-4-4, ex-2ys wait on delivery-lead past 2 h']);
  assert.deepEqual([b2.action.kind, b2.action.beads], ['note-block', ['ex-4-4', 'ex-2ys']]);
  assert.match(b2.action.why, /wait on delivery-lead, not on builder-2/);
  const rec = RW.record(h.root, res, { bd });
  assert.deepEqual(rec.noted.sort(), ['ex-2ys', 'ex-4-4']);
  const st = W.stalls({ beads, ready: [], now, sessions: sessionsAt(EVENING), team: null }).stalls.filter((x) => x.kind === 'quiet');
  assert.deepEqual(st.map((x) => x.bead).sort(), ['ex-2ys', 'ex-4-4']);
  for (const x of st) assert.match(String(bd.show(x.bead).notes || ''), /delivery-lead pass: builder-2 fails \(ex-4-4, ex-2ys wait on delivery-lead past 2 h\); action note-block/);
  // within stall_hours it is not a failure
  assert.deepEqual(of(RW.pass(facts({ now: '2026-11-02T21:00:00Z', beads, wakes: [] })), 'builder-2').fails, []);
});

test('the pass names the manager by its instance, never a fixed delivery-lead', () => {
  const h = harness({ beads: Object.fromEntries(nightBeads().map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const now = '2026-11-02T23:30:00Z';
  const messages = [{ to: 'delivery-lead', entries: [{ at: now }] }, { to: 'dm-2', entries: [{ at: now }, { at: now }] }];
  const res = RW.pass(facts({ now, dm: 'dm-2', messages, wakes: nightWakes(now) }));
  assert.deepEqual(res.own.filter((o) => o.kind === 'message').map((o) => o.ref), ['dm-2'], 'a message for another instance is not this manager\'s');
  assert.match(of(res, 'builder-2').action.why, /waits on dm-2/);
  RW.record(h.root, res, { bd });
  assert.match(String(bd.show('ex-4-4').notes), /dm-2 pass: builder-2 fails/);
  assert.doesNotMatch(String(bd.show('ex-4-4').notes), /delivery-lead/);
});

// TR-6 end to end: the pass with every builder stuck sends Staffing its roster command; once the new
// builder is on the team, the next pass assigns it the top-priority bead and tells it
test('TR-6: --record asks Staffing for the builder, then assigns the bead to it once it is on the team', () => {
  const ready = [{ id: 'ex-p0', status: 'open', priority: 0, created_at: '2026-11-02T22:00:00Z' }];
  const h = harness({ beads: Object.fromEntries([...nightBeads(), ...ready].map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const inbox = (to) => { try { return fs.readFileSync(path.join(h.root, '.delivery', 'watchdog', 'inbox', `${to}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (err) { return []; } };
  const now = '2026-11-03T02:00:00Z';
  const first = RW.record(h.root, RW.pass(facts({ now, ready, staffing: 'staffing', wakes: nightWakes(now) })), { bd, actor: 'dev@pc/delivery-lead' });
  assert.equal(first.team, 'add-builder');
  const asked = inbox('staffing');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].from, 'delivery-lead');
  assert.match(asked[0].message, /team-role\.js add builder --count 3\. My next pass assigns ex-p0 to it/);
  assert.match(String(bd.show('ex-p0').notes), /asked staffing to add builder 3 through its roster command/);
  // the next pass, still waiting on Staffing: no second message
  const later = '2026-11-03T02:16:00Z';
  assert.equal(RW.record(h.root, RW.pass(facts({ now: later, ready, wakes: nightWakes(later) })), { bd, actor: 'dev@pc/delivery-lead' }).team, null);
  assert.equal(inbox('staffing').length, 1);
  // Staffing added builder-3: the pass after it assigns the bead and tells the new builder
  const after = '2026-11-03T02:30:00Z';
  const third = RW.record(h.root, RW.pass(facts({ now: after, ready, builders: ['builder-1', 'builder-2', 'builder-3'], sessions: withB3(sessionsAt(EVENING), after), wakes: nightWakes(after) })), { bd, actor: 'dev@pc/delivery-lead' });
  assert.equal(third.team, 'assign');
  assert.equal(bd.show('ex-p0').assignee, 'dev@pc/builder-3');
  assert.match(String(bd.show('ex-p0').notes), /delivery-lead pass: assigned to builder-3/);
  const told = inbox('builder-3');
  assert.equal(told.length, 1);
  assert.match(told[0].message, /top-priority ex-p0 is assigned to you/);
});

test('TR-6: every builder stuck and a top-priority bead ready: the pass adds a builder through the roster command; a free builder is assigned instead', () => {
  const now = '2026-11-03T02:00:00Z';
  const ready = [{ id: 'ex-p0', status: 'open', priority: 0, created_at: '2026-11-02T22:00:00Z' }];
  const res = RW.pass(facts({ now, ready, wakes: nightWakes(now) }));
  assert.ok(res.instances.every((x) => x.fails.length), 'both builders fail a check');
  assert.equal(res.team.kind, 'add-builder');
  assert.equal(res.team.count, 3);
  assert.equal(res.team.bead, 'ex-p0');
  assert.match(res.team.command, /team-role\.js add builder --count 3; then assign ex-p0 to the new builder/);
  assert.match(RW.lines(res).join('\n'), /^3\. Team: add-builder: every builder \(builder-1, builder-2\) holds stuck work and top-priority ex-p0 is ready/m);
  // a third builder holding nothing is assigned the bead, and no builder is added
  const free = RW.pass(facts({ now, ready, builders: ['builder-1', 'builder-2', 'builder-3'], sessions: withB3(sessionsAt(EVENING), now), wakes: nightWakes(now) }));
  assert.deepEqual([free.team.kind, free.team.to, free.team.bead], ['assign', 'builder-3', 'ex-p0']);
  // one builder still moving: no builder is added
  const moving = RW.pass(facts({ now, ready, beads: nightBeads().map((b) => (b.id === 'ex-4-5' ? { ...b, updated_at: '2026-11-03T01:50:00Z' } : b)), wakes: nightWakes(now) }));
  assert.equal(moving.team, null);
  // no top-priority work ready: no builder is added
  assert.equal(RW.pass(facts({ now, ready: [{ ...ready[0], priority: 1 }], wakes: nightWakes(now) })).team, null);
});

test('a session stopped on the usage limit is reported with its resume time, not restarted; its top-priority work moves only to a free builder', () => {
  const now = '2026-11-03T02:00:00Z';
  const limit = { at: '2026-11-02T22:00:00Z', resetsAt: '2026-11-03T05:00:00Z', window: 'five_hour' };
  const sessions = sessionsAt('2026-11-02T22:00:00Z').map((s) => (s.instance === 'builder-1' ? { ...s, limit } : s));
  const res = RW.pass(facts({ now, sessions }));
  const b1 = of(res, 'builder-1');
  assert.equal(b1.action.kind, 'report');
  assert.match(b1.action.why, /not restarted, the watchdog resumes it at 2026-11-03 05:00 UTC/);
  assert.ok(!b1.fails.some((f) => /nothing moved/.test(f)));
  const free = RW.pass(facts({ now, sessions: withB3(sessions, now), builders: ['builder-1', 'builder-2', 'builder-3'] }));
  assert.deepEqual([of(free, 'builder-1').action.kind, of(free, 'builder-1').action.to], ['reassign', 'builder-3']);
});

test('a holder that is not running and has not moved its own work is restarted; one still running is raised', () => {
  const now = '2026-11-03T02:00:00Z';
  const beads = [{ id: 'ex-a', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: '2026-11-02T22:00:00Z' }];
  assert.equal(of(RW.pass(facts({ now, beads, prs: [] })), 'builder-1').action.kind, 'restart');
  const sessions = sessionsAt('2026-11-03T01:58:00Z');
  // the only builder: nobody can take it, so the blocker is raised
  const running = of(RW.pass(facts({ now, beads, prs: [], sessions, builders: ['builder-1'] })), 'builder-1');
  assert.equal(running.running, true);
  assert.equal(running.action.kind, 'raise');
  // a free builder takes it instead
  const handed = of(RW.pass(facts({ now, beads, prs: [], sessions: withB3(sessions, now), builders: ['builder-1', 'builder-3'] })), 'builder-1');
  assert.deepEqual([handed.action.kind, handed.action.to], ['reassign', 'builder-3']);
});

test('data the pass cannot read is reported, never shown as a healthy team', () => {
  const h = harness({ beads: {} });
  const broken = { list: () => { throw new Error('bd: database is locked'); }, ready: () => [] };
  const out = watchdog.main(['pass', '--record'], { cwd: h.root, env: { ...process.env, DELIVERY_ROLE: '' }, now: '2026-11-03T02:00:00Z', bd: broken });
  assert.equal(out.code, 0);
  assert.match(out.out, /^The record could not be read \(bd: database is locked\): no role instance is reported healthy\./);
  assert.ok(!fs.existsSync(RW.file(h.root)), 'no pass row from data it could not read');
});

test('watchdog.js pass runs in a role session, reads the roster and the wake log, and --record notes the held bead', () => {
  const h = harness({ beads: {
    'ex-a': { id: 'ex-a', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: '2026-11-02T20:00:00Z' },
    'ex-b': { id: 'ex-b', status: 'in_progress', assignee: 'dev@pc/builder-2', updated_at: '2026-11-03T01:50:00Z' },
  } });
  for (const [instance, seen] of [['builder-1', '2026-11-02T20:00:00Z'], ['builder-2', '2026-11-03T01:55:00Z'], [DM, '2026-11-03T01:00:00Z']]) registerInstance(h.root, { instance, session_id: `sess-${instance}`, host: 'pc', model: 'sonnet', role_dir: h.roleDir(instance), now: seen });
  W.log(h.root, { type: 'wake', at: '2026-11-03T01:00:00Z', instance: 'builder-1', keys: ['assigned:ex-a'], pid: 0 });
  const env = { ...process.env, DELIVERY_ROLE: DM, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` };
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env });
  // read-only first: the fake bd stamps a note with the real clock, which would move the bead
  const json = JSON.parse(watchdog.main(['pass', '--json'], { cwd: h.root, env, now: '2026-11-03T02:00:00Z', bd }).out);
  assert.deepEqual(json.instances.map((x) => [x.instance, x.running, x.moving, x.wasted]), [['builder-1', false, false, 1], ['builder-2', true, true, 0]]);
  assert.equal(json.noted, null, 'without --record nothing is written');
  assert.ok(!fs.existsSync(RW.file(h.root)));
  const out = watchdog.main(['pass', '--record'], { cwd: h.root, env, now: '2026-11-03T02:00:00Z', bd });
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, /^1\. Yours first: nothing waits on you\.$/m);
  assert.match(out.out, /- builder-1: running no, moving no, wasted wakes 1 of 1 today; holds ex-a$/m);
  assert.match(out.out, /action: restart: builder-1 is not running and its work has not moved; start it on ex-a/);
  assert.match(out.out, /- builder-2: running yes, moving yes, wasted wakes 0 of 0 today; holds ex-b$/m);
  assert.match(out.out, /^Noted on ex-a\.$/m);
  assert.match(String(bd.show('ex-a').notes), /delivery-lead pass: builder-1 fails \(nothing moved for 6\.0 h \(limit 2 h\)\); action restart/);
  assert.equal(RW.previous(h.root).length, 1);
});

// review waits are the manager's, not the holder's: builders whose only failure is held work waiting on
// the manager are not stuck, so no builder is added for them
test('TR-6: builders that only wait on review are not stuck: no builder is added', () => {
  const now = '2026-11-03T02:00:00Z';
  const quiet = '2026-11-02T22:30:00Z';
  const beads = [
    { id: 'ex-r1', status: 'in_progress', assignee: 'dev@pc/builder-1', priority: 1, updated_at: quiet, created_at: quiet },
    { id: 'ex-r2', status: 'in_progress', assignee: 'dev@pc/builder-2', priority: 1, updated_at: quiet, created_at: quiet },
  ];
  const prs = [{ pr: 160, state: 'waiting', beads: ['ex-r1'] }, { pr: 161, state: 'waiting', beads: ['ex-r2'] }];
  const ready = [{ id: 'ex-p0', status: 'open', priority: 0, created_at: '2026-11-02T22:00:00Z' }];
  const res = RW.pass(facts({ now, beads, prs, ready, sessions: sessionsAt('2026-11-03T01:58:00Z'), wakes: [] }));
  for (const i of ['builder-1', 'builder-2']) {
    assert.equal(of(res, i).running, true, i);
    assert.equal(of(res, i).quietOnly, true, i);
    assert.equal(of(res, i).action.kind, 'note-block', i);
  }
  assert.equal(res.team, null);
});

// at budget.builders_cap the roster command refuses: the pass asks the Chief of Staff once instead
test('TR-6: at builders_cap the pass raises the cap to the Chief of Staff once instead of queuing a refused command', () => {
  const ready = [{ id: 'ex-p0', status: 'open', priority: 0, created_at: '2026-11-02T22:00:00Z' }];
  const h = harness({ beads: Object.fromEntries([...nightBeads(), ...ready].map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const inbox = (to) => { try { return fs.readFileSync(path.join(h.root, '.delivery', 'watchdog', 'inbox', `${to}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (err) { return []; } };
  const now = '2026-11-03T02:00:00Z';
  const res = RW.pass(facts({ now, ready, cap: 2, chief: 'cos-1', wakes: nightWakes(now) }));
  assert.deepEqual([res.team.kind, res.team.to, res.team.count], ['raise-cap', 'cos-1', 3]);
  assert.match(res.team.why, /builders_cap 2 is reached/);
  assert.doesNotMatch(res.team.command, /team-role\.js add builder/);
  assert.equal(RW.record(h.root, res, { bd, actor: 'dev@pc/delivery-lead' }).team, 'raise-cap');
  assert.equal(inbox('staffing').length, 0, 'no command the roster refuses is queued');
  assert.equal(inbox('cos-1').length, 1);
  assert.match(inbox('cos-1')[0].message, /raise builders_cap to 3/);
  assert.match(String(bd.show('ex-p0').notes), /asked cos-1 once for the owner to raise builders_cap to 3/);
  const later = '2026-11-03T02:16:00Z';
  RW.record(h.root, RW.pass(facts({ now: later, ready, cap: 2, chief: 'cos-1', wakes: nightWakes(later) })), { bd, actor: 'dev@pc/delivery-lead' });
  assert.equal(inbox('cos-1').length, 1, 'asked once');
  // under the cap Staffing adds the builder as before
  assert.equal(RW.pass(facts({ now, ready, cap: 3, wakes: nightWakes(now) })).team.kind, 'add-builder');
});

test('TR-6: a quiet pass between two passes with the same team action does not queue it again', () => {
  const ready = [{ id: 'ex-p0', status: 'open', priority: 0, created_at: '2026-11-02T22:00:00Z' }];
  const h = harness({ beads: Object.fromEntries([...nightBeads(), ...ready].map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const asked = () => { try { return fs.readFileSync(path.join(h.root, '.delivery', 'watchdog', 'inbox', 'staffing.ndjson'), 'utf8').trim().split('\n').length; } catch (err) { return 0; } };
  const at = (now, r) => RW.record(h.root, RW.pass(facts({ now, ready: r, wakes: nightWakes(now) })), { bd, actor: 'dev@pc/delivery-lead' });
  assert.equal(at('2026-11-03T02:00:00Z', ready).team, 'add-builder');
  assert.equal(at('2026-11-03T02:16:00Z', []).team, null, 'a pass with no team action');
  assert.equal(at('2026-11-03T02:32:00Z', ready).team, null);
  assert.equal(asked(), 1);
});

test('watchdog.js pass --record is the manager\'s: another role session is refused and nothing is written', () => {
  const h = harness({ beads: { 'ex-a': { id: 'ex-a', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: '2026-11-02T20:00:00Z' } } });
  const env = { ...process.env, DELIVERY_ROLE: 'builder-1', BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` };
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env });
  const out = watchdog.main(['pass', '--record'], { cwd: h.root, env, now: '2026-11-03T02:00:00Z', bd });
  assert.equal(out.code, 1);
  assert.match(out.out, /pass --record is delivery-lead's; builder-1 runs watchdog\.js pass to read it/);
  assert.ok(!fs.existsSync(RW.file(h.root)));
  assert.equal(String(bd.show('ex-a').notes || ''), '');
  assert.equal(watchdog.main(['pass'], { cwd: h.root, env, now: '2026-11-03T02:00:00Z', bd }).code, 0, 'reading the pass stays open');
});

// hjx.1.6.12.1: the pass assigned only the first top-priority bead to the first free builder, one a pass,
// so other free builders sat idle beside ready work. Every free live builder is now paired with a ready
// item of its own, in priority order, P0 or not.
const liveAt = (instance, seen) => ({ instance, role: 'builder', lastActive: T(seen), waitUntil: -Infinity, limit: null });
const item = (id, priority, extra = {}) => ({ id, status: 'open', priority, created_at: '2026-11-02T22:00:00Z', ...extra });
const four = ['builder-1', 'builder-2', 'builder-3', 'builder-4'];
const fourLive = (seen) => [...sessionsAt(seen), liveAt('builder-3', seen), liveAt('builder-4', seen)];

test('hjx.1.6.12.1: every free live builder is paired with its own ready item, in priority order, not only P0', () => {
  const now = '2026-11-03T02:00:00Z';
  const ready = [item('ex-c', 2), item('ex-b', 1), item('ex-a', 0), item('ex-epic', 0, { issue_type: 'epic' }), item('ex-taken', 0, { assignee: 'dev@pc/builder-1' }), item('ex-spike', 0, { labels: ['spike'] }), item('ex-done', 0, { labels: ['state-merged'] })];
  const res = RW.pass(facts({ now, ready, builders: four, sessions: fourLive(now), wakes: nightWakes(now) }));
  assert.equal(res.team.kind, 'assign');
  assert.deepEqual(res.team.pairs.map((p) => [p.bead, p.to]), [['ex-a', 'builder-3'], ['ex-b', 'builder-4']], 'one item each, highest priority first');
  assert.deepEqual([res.team.bead, res.team.to], ['ex-a', 'builder-3']);
  assert.match(RW.lines(res).join('\n'), /^3\. Team: assign: .*ex-a to builder-3.*ex-b to builder-4/m);
  // a ready item below P0 is assigned too
  const p1 = RW.pass(facts({ now, ready: [item('ex-b', 1)], builders: four, sessions: fourLive(now), wakes: nightWakes(now) }));
  assert.deepEqual(p1.team.pairs.map((p) => [p.bead, p.to]), [['ex-b', 'builder-3']]);
  // more free builders than items: each item once
  const one = RW.pass(facts({ now, ready: [item('ex-a', 0)], builders: four, sessions: fourLive(now), wakes: nightWakes(now) }));
  assert.deepEqual(one.team.pairs.map((p) => [p.bead, p.to]), [['ex-a', 'builder-3']]);
});

test('hjx.1.6.12.1: a builder with no live session is not assigned; nothing ready assigns nothing', () => {
  const now = '2026-11-03T02:00:00Z';
  const ready = [item('ex-a', 0), item('ex-b', 1)];
  // builder-4 is on the team but has no session on this host: only builder-3 gets work
  const res = RW.pass(facts({ now, ready, builders: four, sessions: [...sessionsAt(now), liveAt('builder-3', now)], wakes: nightWakes(now) }));
  assert.deepEqual(res.team.pairs.map((p) => [p.bead, p.to]), [['ex-a', 'builder-3']]);
  assert.equal(RW.pass(facts({ now, ready: [], builders: four, sessions: fourLive(now), wakes: nightWakes(now) })).team, null);
});

test('hjx.1.6.12.1: --record assigns every pair and tells each builder, once', () => {
  const ready = [item('ex-a', 0), item('ex-b', 2)];
  const h = harness({ beads: Object.fromEntries([...nightBeads(), ...ready].map((b) => [b.id, b])) });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: { ...process.env, BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` } });
  const inbox = (to) => { try { return fs.readFileSync(path.join(h.root, '.delivery', 'watchdog', 'inbox', `${to}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (err) { return []; } };
  const now = '2026-11-03T02:00:00Z';
  const run = (at) => RW.record(h.root, RW.pass(facts({ now: at, ready, builders: four, sessions: fourLive(at), wakes: nightWakes(at) })), { bd, actor: 'dev@pc/delivery-lead' });
  assert.equal(run(now).team, 'assign');
  assert.equal(bd.show('ex-a').assignee, 'dev@pc/builder-3');
  assert.equal(bd.show('ex-b').assignee, 'dev@pc/builder-4');
  assert.match(String(bd.show('ex-b').notes), /delivery-lead pass: assigned to builder-4/);
  assert.match(inbox('builder-3')[0].message, /top-priority ex-a is assigned to you/);
  assert.match(inbox('builder-4')[0].message, /ready ex-b \(P2\) is assigned to you/);
  // the same pairs on the next pass are not assigned or messaged again
  assert.equal(run('2026-11-03T02:16:00Z').team, null);
  assert.equal(inbox('builder-3').length, 1);
  assert.equal(inbox('builder-4').length, 1);
});
