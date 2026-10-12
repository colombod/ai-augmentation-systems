// scripts/lib/roster.test.js — run with: node --test scripts/lib/roster.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRoster, writeRoster, registerInstance } = require('./roster.js');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  return root;
}

test('readRoster returns empty instances when the file is missing', () => {
  assert.deepEqual(readRoster(scratch()), { instances: {} });
});

test('registerInstance inserts then updates, keeping joined_at', () => {
  const root = scratch();
  const t1 = '2026-10-12T10:00:00Z';
  const t2 = '2026-10-12T11:00:00Z';
  registerInstance(root, { instance: 'builder-1', session_id: 's1', host: 'pc', model: 'sonnet', role_dir: '/x', now: t1 });
  const r = registerInstance(root, { instance: 'builder-1', session_id: 's2', host: 'pc', model: 'haiku', role_dir: '/x', now: t2 });
  assert.equal(r.instances['builder-1'].joined_at, t1);
  assert.equal(r.instances['builder-1'].last_seen, t2);
  assert.equal(r.instances['builder-1'].session_id, 's2');
  assert.equal(r.instances['builder-1'].model, 'haiku');
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.deepEqual(onDisk, r);
});
