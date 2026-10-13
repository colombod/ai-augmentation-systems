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

// Round 1 C1: composeStop joins reasons, each kind once per turn, never a third blocking stop.
test('composeStop: joins, limits each kind to once per turn and two blocking stops, resets on a first stop', () => {
  const { composeStop, STOP_STATE } = require('./turn.js');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  markTurnStart(roleDir, '2026-10-13T10:00:00Z');
  const a = { kind: 'a', reason: 'A' };
  const b = { kind: 'b', reason: 'B' };
  const c = { kind: 'c', reason: 'C' };
  assert.deepEqual(composeStop({ input: {}, roleDir, sessionId: 's', candidates: [a, b] }), { reason: 'A\n\nB', kinds: ['a', 'b'] });
  assert.equal(composeStop({ input: { stop_hook_active: true }, roleDir, sessionId: 's', candidates: [a, b] }), null);
  assert.deepEqual(composeStop({ input: { stop_hook_active: true }, roleDir, sessionId: 's', candidates: [a, c] }), { reason: 'C', kinds: ['c'] });
  assert.equal(composeStop({ input: { stop_hook_active: true }, roleDir, sessionId: 's', candidates: [{ kind: 'd', reason: 'D' }] }), null, 'third stop passes');
  // a first stop or another session starts over
  assert.deepEqual(composeStop({ input: {}, roleDir, sessionId: 's', candidates: [a] }).kinds, ['a']);
  assert.deepEqual(composeStop({ input: { stop_hook_active: true }, roleDir, sessionId: 'other', candidates: [a] }).kinds, ['a']);
  const st = JSON.parse(fs.readFileSync(path.join(roleDir, STOP_STATE), 'utf8'));
  assert.equal(st.session_id, 'other');
  assert.match(st.last_message_hash, /^[0-9a-f]{64}$/);
  // a new turn start clears the state
  markTurnStart(roleDir, '2026-10-13T10:05:00Z');
  assert.ok(!fs.existsSync(path.join(roleDir, STOP_STATE)));
  // a continuation whose state cannot be saved fails open
  const gone = path.join(roleDir, 'missing-dir');
  assert.equal(composeStop({ input: { stop_hook_active: true }, roleDir: gone, sessionId: 's', candidates: [a] }), null);
  assert.deepEqual(composeStop({ input: {}, roleDir: gone, sessionId: 's', candidates: [a] }).kinds, ['a']);
});
