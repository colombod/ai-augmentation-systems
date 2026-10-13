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
