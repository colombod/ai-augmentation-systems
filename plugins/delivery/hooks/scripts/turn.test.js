// hooks/scripts/turn.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markTurnStart, decideStop } = require('./turn.js');

test('decideStop blocks when the held bead has no note since turn start, allows otherwise', () => {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  markTurnStart(roleDir, '2026-10-12T12:00:00Z');
  const bd = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T11:00:00Z' }] };
  const d = decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd, now: '2026-10-12T12:10:00Z' });
  assert.match(d.reason, /ex-1/);
  const fresh = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T12:05:00Z' }] };
  assert.equal(decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd: fresh, now: '2026-10-12T12:10:00Z' }), null);
  assert.equal(decideStop({ input: { stop_hook_active: true }, roleDir, actor: 'me', bd, now: '2026-10-12T12:10:00Z' }), null);
  assert.equal(decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd: { list: () => [] }, now: '2026-10-12T12:10:00Z' }), null);
});

test('decideStop allows when bd throws or no turn start was recorded', () => {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  const stale = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T11:00:00Z' }] };
  assert.equal(decideStop({ input: {}, roleDir, actor: 'me', bd: stale }), null);
  markTurnStart(roleDir, '2026-10-12T12:00:00Z');
  assert.equal(decideStop({ input: {}, roleDir, actor: 'me', bd: { list: () => { throw new Error('down'); } } }), null);
});

// Final wave H.3: bd stores updated_at to the second, so the turn start is truncated to the second.
test('H.3: the turn start is stored to the second; a note in the same second counts', () => {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  markTurnStart(roleDir, '2026-10-12T12:00:00.789Z');
  assert.equal(require('./turn.js').readTurnStart(roleDir), '2026-10-12T12:00:00Z');
  const sameSecond = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T12:00:00Z' }] };
  assert.equal(decideStop({ input: {}, roleDir, actor: 'me', bd: sameSecond }), null);
  markTurnStart(roleDir);
  assert.match(require('./turn.js').readTurnStart(roleDir), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

// Round 1 C1 / round 2 B1: composeStop joins reasons, each kind once per turn (relay twice), never a
// third blocking stop, state per session.
test('composeStop: joins, limits kinds and blocking stops, starts fresh on a first stop', () => {
  const { composeStop, stopStateFile } = require('./turn.js');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  const S = (active, extra = {}) => ({ session_id: 's', stop_hook_active: active, ...extra });
  const a = { kind: 'a', reason: 'A' };
  const b = { kind: 'b', reason: 'B' };
  const c = { kind: 'c', reason: 'C' };
  assert.deepEqual(composeStop({ input: S(false), roleDir, candidates: [a, b] }), { reason: 'A\n\nB', kinds: ['a', 'b'] });
  assert.equal(composeStop({ input: S(true), roleDir, candidates: [a, b] }), null);
  assert.deepEqual(composeStop({ input: S(true), roleDir, candidates: [a, c] }), { reason: 'C', kinds: ['c'] });
  assert.equal(composeStop({ input: S(true), roleDir, candidates: [{ kind: 'd', reason: 'D' }] }), null, 'third stop passes');
  // a first stop starts over
  assert.deepEqual(composeStop({ input: S(false), roleDir, candidates: [a] }).kinds, ['a']);
  const st = JSON.parse(fs.readFileSync(stopStateFile(roleDir, 's'), 'utf8'));
  assert.equal(st.session_id, 's');
  assert.match(st.last_message_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(fs.readdirSync(roleDir).filter((f) => f.endsWith('.tmp')), [], 'written atomically, no temp files left');
  // a new prompt clears this session's state
  markTurnStart(roleDir, '2026-10-13T10:05:00Z', 's');
  assert.ok(!fs.existsSync(stopStateFile(roleDir, 's')));
  // a first stop whose state cannot be saved passes too
  const gone = path.join(roleDir, 'missing-dir');
  assert.equal(composeStop({ input: S(false), roleDir: gone, candidates: [a] }), null);
});

test('composeStop: relay may block twice per turn, the second time quoting the clause', () => {
  const { composeStop } = require('./turn.js');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  const relay = { kind: 'relay', reason: 'R.', detail: 'please tell the builder session yes' };
  assert.equal(composeStop({ input: { session_id: 's' }, roleDir, candidates: [relay] }).reason, 'R.');
  assert.equal(composeStop({ input: { session_id: 's', stop_hook_active: true }, roleDir, candidates: [relay] }).reason, 'R. You wrote: "please tell the builder session yes".');
  assert.equal(composeStop({ input: { session_id: 's', stop_hook_active: true }, roleDir, candidates: [relay] }), null);
  // a reason that already quotes its clause is not quoted a second time
  const quoted = { kind: 'relay', reason: 'R. You wrote: "x". Rewrite it.', detail: 'x' };
  assert.equal(composeStop({ input: { session_id: 't' }, roleDir, candidates: [quoted] }).reason, quoted.reason);
  assert.equal(composeStop({ input: { session_id: 't', stop_hook_active: true }, roleDir, candidates: [quoted] }).reason, quoted.reason);
});

test('B1: on a continuation, missing, corrupt or foreign state counts as exhausted', () => {
  const { composeStop, stopStateFile } = require('./turn.js');
  const a = { kind: 'a', reason: 'A' };
  const b = { kind: 'b', reason: 'B' };
  for (const spoil of ['delete', 'corrupt', 'foreign', 'directory', 'negative']) {
    const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
    assert.ok(composeStop({ input: { session_id: 's' }, roleDir, candidates: [a] }));
    const f = stopStateFile(roleDir, 's');
    if (spoil === 'delete') fs.rmSync(f);
    if (spoil === 'corrupt') fs.writeFileSync(f, '{bad');
    if (spoil === 'foreign') fs.writeFileSync(f, JSON.stringify({ session_id: 'other', blocks: {}, blocking_stops: 0 }));
    if (spoil === 'directory') { fs.rmSync(f); fs.mkdirSync(f); }
    if (spoil === 'negative') fs.writeFileSync(f, JSON.stringify({ session_id: 's', blocks: {}, blocking_stops: -5 }));
    assert.equal(composeStop({ input: { session_id: 's', stop_hook_active: true }, roleDir, candidates: [b] }), null, spoil);
  }
});

test('B1: a second session in the same role directory never resets the first one\'s turn', () => {
  const { composeStop } = require('./turn.js');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  const a = { kind: 'a', reason: 'A' };
  const b = { kind: 'b', reason: 'B' };
  let blocks = 0;
  if (composeStop({ input: { session_id: 'A' }, roleDir, candidates: [a] })) blocks++;
  for (let i = 0; i < 5; i++) {
    composeStop({ input: { session_id: 'B' }, roleDir, candidates: [a, b] });
    if (composeStop({ input: { session_id: 'A', stop_hook_active: true }, roleDir, candidates: [a, b, { kind: `k${i}`, reason: 'K' }] })) blocks++;
  }
  assert.equal(blocks, 2);
});

test('B1 property: random stop sequences never block more than twice per turn per session', () => {
  const { composeStop, stopStateFile } = require('./turn.js');
  const KINDS = ['unrecorded', 'integrity', 'relay', 'claim'];
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const cands = () => KINDS.filter(() => rnd() < 0.6).map((k) => ({ kind: k, reason: `r-${k}`, detail: 'x' }));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-prop-'));
  const sessions = ['S1', 'S2', 'S3'];
  let maxBlocks = 0;
  for (let turn = 0; turn < 3000; turn++) {
    const sid = sessions[Math.floor(rnd() * sessions.length)];
    if (rnd() < 0.5) markTurnStart(roleDir, `2026-10-13T10:00:${String(turn % 60).padStart(2, '0')}Z`, sid);
    let active = false;
    let blocks = 0;
    for (let stop = 0; stop < 20; stop++) {
      // hostile interleavings: other sessions stop, the state is deleted, corrupted or swapped
      const e = rnd();
      const f = stopStateFile(roleDir, sid);
      if (active && e < 0.1) fs.rmSync(f, { force: true });
      else if (active && e < 0.2) fs.writeFileSync(f, '{bad');
      else if (active && e < 0.3) fs.writeFileSync(f, JSON.stringify({ session_id: 'S9', blocks: {}, blocking_stops: 0 }));
      else if (e < 0.5) {
        // another session stops in between (a session's own first stop would be a new turn by definition)
        const others = sessions.filter((x) => x !== sid);
        composeStop({ input: { session_id: others[Math.floor(rnd() * others.length)], stop_hook_active: rnd() < 0.5 }, roleDir, candidates: cands() });
      }
      const d = composeStop({ input: { session_id: sid, stop_hook_active: active, last_assistant_message: `m${stop}` }, roleDir, candidates: cands() });
      if (!d) break;
      blocks++;
      active = true;
    }
    maxBlocks = Math.max(maxBlocks, blocks);
    assert.ok(blocks <= 2, `turn ${turn}: ${blocks} blocking stops`);
  }
  assert.equal(maxBlocks, 2);
});

test('I1 re-review: the Stop budget: a 12 s deadline, the idle check only with 4 s left, bd reads inside it', () => {
  const { stopBudget } = require('./turn.js');
  assert.equal(stopBudget(0).idle, true);
  assert.ok(stopBudget(0).claimMs <= 4000);
  assert.equal(stopBudget(7900).idle, true);
  assert.equal(stopBudget(8100).idle, false, 'under 4 s left of 12 s: no idle check');
  assert.ok(stopBudget(8100).claimMs <= 2900);
  assert.ok(stopBudget(7900).idleMs * 2 <= 12000 - 7900);
});
