// scripts/lib/first-turn.test.js — the first turn every started or woken role session is given
// (hjx.1.6.12 criteria 1 and 2): it reads its in-progress beads, bd ready and its messages, continues,
// and with nothing held takes the next ready item or says Blocked: with the reason.
require('../testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const FT = require('./first-turn.js');
const WD = require('./watchdog.js');

test('the first turn reads in-progress beads, then bd ready, then messages, in that order', () => {
  const t = FT.FIRST_TURN;
  const inProgress = t.indexOf('--status in_progress');
  const ready = t.indexOf('bd ready');
  const messages = t.indexOf('messages');
  assert.ok(inProgress >= 0 && ready > inProgress && messages > ready, t);
});

test('the first turn says continue what you hold, and with nothing held take the next ready item or note Blocked:', () => {
  assert.match(FT.FIRST_TURN, /Continue what you hold/);
  assert.match(FT.FIRST_TURN, /Holding nothing, take the next ready item/);
  assert.match(FT.FIRST_TURN, /bd update <id> --claim/);
  assert.match(FT.FIRST_TURN, /starts "Blocked:"/);
  // the old idle wording only asked the role to look and report, which left it idle (dec-chief-of-staff-000383)
  assert.doesNotMatch(FT.FIRST_TURN, /say what you could take/);
});

// criterion 1, the team-revive path: `claude remote-control` takes no prompt, so a session it starts
// comes up with no turn at all. The next pass wakes it once, with the first turn.
const fs = require('fs');
const os = require('os');
const path = require('path');
const iso = (t) => new Date(t).toISOString();
const NOW = Date.parse('2026-11-08T23:30:00Z');
const b3 = (lastActive) => ({ instance: 'builder-3', role: 'builder', session: 's-b3', roleDir: os.tmpdir(), lastActive });
const start = (at, instance = 'builder-3') => ({ type: 'start', at: iso(at), instance, pid: 1 });

test('a session the revive started and that has had no turn since is woken once, with the first turn', () => {
  const at = NOW - 5 * 60e3;
  const st = WD.stalls({ now: iso(NOW), sessions: [b3(NOW - 3600e3)], starts: [start(at)] });
  const s = st.stalls.filter((x) => x.kind === 'started');
  assert.equal(s.length, 1, JSON.stringify(st.stalls));
  assert.equal(s[0].target, 'builder-3');
  assert.equal(s[0].key, `started:builder-3:${iso(at)}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-start-'));
  try {
    const p = WD.plan(st, { root, now: iso(NOW), alive: () => false });
    assert.equal(p.wakes.length, 1, JSON.stringify(p));
    assert.ok(p.wakes[0].prompt.includes(FT.FIRST_TURN), p.wakes[0].prompt);
    assert.match(p.wakes[0].prompt, /started by the team revive/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the start wake is a handover: a stall wake twenty minutes ago does not hold it to the hourly gate', () => {
  const at = NOW - 5 * 60e3;
  const st = WD.stalls({ now: iso(NOW), sessions: [b3(NOW - 3600e3)], starts: [start(at)] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-start-gate-'));
  try {
    WD.log(root, { type: 'wake', at: iso(NOW - 20 * 60e3), keys: ['quiet:ex-q:2026-11-08T20:00:00.000Z'], instance: 'builder-3', pid: 7 });
    const p = WD.plan(st, { root, now: iso(NOW), alive: () => false });
    assert.deepEqual(p.wakes.map((w) => w.keys).flat(), [`started:builder-3:${iso(at)}`], JSON.stringify(p));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no start wake once the session has had a turn, while it is still coming up, or once a wake carried it', () => {
  const at = NOW - 5 * 60e3;
  const started = (facts) => WD.stalls({ now: iso(NOW), ...facts }).stalls.filter((x) => x.kind === 'started');
  assert.equal(started({ sessions: [b3(at + 60e3)], starts: [start(at)] }).length, 0, 'active after the start: it has its turn');
  assert.equal(started({ sessions: [b3(NOW - 3600e3)], starts: [start(NOW - 60e3)] }).length, 0, 'started a minute ago: still coming up');
  assert.equal(started({ sessions: [b3(NOW - 3600e3)], starts: [start(at)], wakes: [{ at: iso(at + 3 * 60e3), keys: [`started:builder-3:${iso(at)}`] }] }).length, 0, 'already woken for this start');
  // quiet since before the start, so only the start's age keeps it out
  assert.equal(started({ sessions: [b3(NOW - 8 * 3600e3)], starts: [start(NOW - 7 * 3600e3)] }).length, 0, 'a start hours old is the revive\'s to retry, not a first turn');
  assert.equal(started({ sessions: [b3(NOW - 8 * 3600e3)], starts: [start(NOW - 5 * 3600e3)] }).length, 1, 'inside the window it still goes');
  assert.equal(started({ sessions: [b3(NOW - 3600e3)], starts: [start(at, 'builder-9')] }).length, 0, 'no session of that instance on the roster');
  // the newest start of an instance is the one that counts
  const two = started({ sessions: [b3(NOW - 3600e3)], starts: [start(NOW - 30 * 60e3), start(at)] });
  assert.deepEqual(two.map((x) => x.key), [`started:builder-3:${iso(at)}`]);
  // a row that is not a start (a refusal, a skip) is no start
  assert.equal(started({ sessions: [b3(NOW - 3600e3)], starts: [{ ...start(at), type: 'skip' }] }).length, 0);
});

test('the pass reads the start rows from the file the team revive writes, and only start rows', () => {
  const TR = require('./team-revive.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ledger-'));
  try {
    assert.deepEqual(WD.reviveStarts(root), [], 'no ledger yet');
    TR.record(root, start(NOW - 5 * 60e3));
    TR.record(root, { type: 'skip', at: iso(NOW), instance: 'builder-2' });
    fs.appendFileSync(TR.ledgerFile(root), '{torn\n');
    const rows = WD.reviveStarts(root);
    assert.deepEqual(rows.map((r) => [r.type, r.instance]), [['start', 'builder-3']]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a pass reads the revive ledger: a session on the roster started since it was last seen gets the start wake', () => {
  const TR = require('./team-revive.js');
  const { registerInstance } = require('./roster.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-read-'));
  try {
    registerInstance(root, { instance: 'builder-3', session_id: 's-b3', host: 'pc', model: 'opus', role_dir: root, now: iso(NOW - 3600e3) });
    const bd = { list: () => [], ready: () => [], show: () => null };
    const kinds = () => {
      const res = WD.read(root, { bd, now: iso(NOW), installed: true, pause: { paused: false } });
      assert.equal(res.unreadable, undefined, res.unreadable);
      return res.stalls.filter((s) => s.kind === 'started').map((s) => s.target);
    };
    assert.deepEqual(kinds(), [], 'no start recorded: nothing to give a first turn');
    TR.record(root, start(NOW - 5 * 60e3));
    assert.deepEqual(kinds(), ['builder-3']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// criterion 4: idle with ready work is a stall within one pass. The team-wide idle rule (lib/idle.js)
// fires only when nothing at all is in progress, so one builder idle beside ready stories went unseen
// while any other bead moved. Each idle builder is now woken to claim a ready story of its own.
const bld = (instance, quietMin, extra = {}) => ({ instance, role: 'builder', session: `s-${instance}`, roleDir: os.tmpdir(), lastActive: NOW - quietMin * 60e3, ...extra });
const story = (id, extra = {}) => ({ id, status: 'open', labels: ['story'], updated_at: iso(NOW - 3600e3), ...extra });
const unclaimed = (facts) => WD.stalls({ now: iso(NOW), ...facts }).stalls.filter((x) => x.kind === 'unclaimed');

test('each builder holding nothing and quiet past the assigned gap is woken for a ready story of its own', () => {
  const ready = [story('ex-1'), story('ex-2'), story('ex-3')];
  const s = unclaimed({ beads: ready, ready, sessions: [bld('builder', 30), bld('builder-2', 45)] });
  assert.deepEqual(s.map((x) => [x.target, x.bead]), [['builder', 'ex-1'], ['builder-2', 'ex-2']], 'one item each, never the same one');
  assert.equal(s[0].key, 'unclaimed:builder:ex-1');
  assert.match(s[0].prompt, /You hold nothing and ex-1 is ready.*bd update ex-1 --claim/);
});

test('no idle-builder wake for a builder with work, a quiet spell under the gap, a limit, or a non-builder role', () => {
  const ready = [story('ex-1'), story('ex-2')];
  const facts = (sessions, beads = ready) => ({ beads, ready, sessions });
  assert.deepEqual(unclaimed(facts([bld('builder', 30)], [...ready, { id: 'ex-ip', status: 'in_progress', assignee: 'u@h/builder', updated_at: iso(NOW - 60e3) }])), [], 'it holds work in progress');
  const mine = story('ex-mine', { assignee: 'u@h/builder' });
  assert.deepEqual(unclaimed({ beads: [mine, ...ready], ready: [mine, ...ready], sessions: [bld('builder', 30)] }), [], 'it holds assigned ready work: the assigned rule wakes it');
  assert.deepEqual(unclaimed(facts([bld('builder', 5)])), [], 'quiet five minutes: not idle yet');
  assert.deepEqual(unclaimed(facts([bld('builder', 30, { waitUntil: NOW + 60e3 })])), [], 'it is waiting on something it named');
  assert.deepEqual(unclaimed(facts([{ ...bld('reality-checker', 30), role: 'reality-checker' }])), [], 'only builders claim stories');
});

test('only unassigned, claimable story beads are offered', () => {
  const taken = story('ex-taken', { assignee: 'u@h/builder-4' });
  const spike = { id: 'ex-spike', status: 'open', labels: ['spike'], updated_at: iso(NOW - 3600e3) };
  const red = story('ex-red');
  const ok = story('ex-ok');
  const ready = [taken, spike, red, ok];
  const s = unclaimed({ beads: ready, ready, sessions: [bld('builder', 30), bld('builder-2', 30)], claimable: (b) => b.id !== 'ex-red' });
  assert.deepEqual(s.map((x) => [x.target, x.bead]), [['builder', 'ex-ok']], 'one claimable story, one wake');
});

test('an idle-builder wake waits the assigned gap after the last wake, and is recorded as an idle-role warning', () => {
  const ready = [story('ex-1')];
  const st = WD.stalls({ now: iso(NOW), beads: ready, ready, sessions: [bld('builder', 30)] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-unclaimed-'));
  try {
    WD.log(root, { type: 'wake', at: iso(NOW - 2 * 60e3), keys: ['message:builder:3'], instance: 'builder', pid: 7 });
    const held = WD.plan(st, { root, now: iso(NOW), alive: () => false });
    // nothing else is in progress here, so the team-wide idle rule wakes the Delivery Manager as well
    const mine = (p) => p.wakes.filter((w) => w.target === 'builder');
    assert.equal(mine(held).length, 0, JSON.stringify(held));
    assert.match(held.held.find((x) => x.target === 'builder').reason, /waits 5 min between wakes/);
    const later = WD.plan(st, { root, now: iso(NOW + 4 * 60e3), alive: () => false });
    assert.deepEqual(mine(later).map((w) => w.keys).flat(), ['unclaimed:builder:ex-1']);
    WD.recordAll(root, st, [], { now: iso(NOW) });
    const rows = require('./warnings.js').list(root).filter((w) => w.kind === 'idle-role');
    assert.equal(rows.length, 1, JSON.stringify(require('./warnings.js').list(root)));
    assert.match(rows[0].detail, /builder holds nothing.*ex-1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every watchdog wake prompt carries the first turn, after the opening and before the reply line', () => {
  const p = WD.wakePrompt(['ex-a is assigned to you and waiting (open).'], 'did');
  assert.ok(p.startsWith(`${WD.WAKE_OPENING}: `), 'the opening stays first: transcript.js tells a wake from a typed prompt by it');
  const at = p.indexOf(FT.FIRST_TURN);
  assert.ok(at > p.indexOf('ex-a is assigned'), p);
  assert.ok(p.endsWith('Reply in one line with what you did.'), p);
});
