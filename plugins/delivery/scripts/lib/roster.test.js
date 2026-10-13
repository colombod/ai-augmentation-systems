// scripts/lib/roster.test.js — run with: node --test scripts/lib/roster.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { readRoster, writeRoster, registerInstance, touchInstance } = require('./roster.js');

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

test('six concurrent registerInstance calls all land in a parseable roster', async () => {
  const root = scratch();
  const script = `const { registerInstance } = require(${JSON.stringify(path.join(__dirname, 'roster.js'))});
    registerInstance(process.argv[1], { instance: process.argv[2], session_id: 's', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T10:00:00Z' });`;
  const run = (args) => new Promise((res, rej) => execFile(process.execPath, args, (e, out, err) => (e ? rej(Object.assign(e, { out, err })) : res(out))));
  await Promise.all([1, 2, 3, 4, 5, 6].map((n) => run(['-e', script, root, `builder-${n}`])));
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.equal(Object.keys(onDisk.instances).length, 6);
  assert.ok(!fs.existsSync(path.join(root, '.delivery', 'team', 'roster.json.lock')));
});

test('readRoster moves a corrupt file aside and returns an empty roster', () => {
  const root = scratch();
  const file = path.join(root, '.delivery', 'team', 'roster.json');
  fs.writeFileSync(file, '{ not json');
  const r = readRoster(root);
  assert.deepEqual(r.instances, {});
  assert.ok(r.recovered_from && fs.existsSync(r.recovered_from));
  assert.ok(!fs.existsSync(file));
});

test('touchInstance updates only last_seen and ignores absent instances', () => {
  const root = scratch();
  registerInstance(root, { instance: 'staffing', session_id: 's1', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T10:00:00Z' });
  touchInstance(root, { instance: 'staffing', now: '2026-10-12T11:00:00Z' });
  touchInstance(root, { instance: 'ghost', now: '2026-10-12T11:00:00Z' });
  const r = readRoster(root);
  assert.equal(r.instances.staffing.last_seen, '2026-10-12T11:00:00Z');
  assert.equal(r.instances.staffing.joined_at, '2026-10-12T10:00:00Z');
  assert.equal(r.instances.staffing.session_id, 's1');
  assert.equal(r.instances.ghost, undefined);
});

test('a stale lock is removed and a fresh one times out', () => {
  const { withRosterLock } = require('./roster.js');
  const root = scratch();
  const lock = path.join(root, '.delivery', 'team', 'roster.json.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.equal(withRosterLock(root, () => 'ok'), 'ok');
  fs.writeFileSync(lock, '');
  assert.throws(() => withRosterLock(root, () => 'no'), /roster: lock timeout/);
});

test('setTranscriptPath records the transcript, writes only on change, and survives registerInstance for the same session', () => {
  const { setTranscriptPath } = require('./roster.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-tr-'));
  const now = '2026-10-13T10:00:00Z';
  assert.equal(setTranscriptPath(root, { instance: 'builder-1', session_id: 's1', transcript_path: '/t/s1.jsonl', host: 'pc', role_dir: '/x', now }), true);
  assert.equal(setTranscriptPath(root, { instance: 'builder-1', session_id: 's1', transcript_path: '/t/s1.jsonl', host: 'pc', role_dir: '/x', now }), false);
  registerInstance(root, { instance: 'builder-1', session_id: 's1', host: 'pc', model: 'sonnet', role_dir: '/x', now });
  assert.equal(readRoster(root).instances['builder-1'].transcript_path, '/t/s1.jsonl');
  assert.equal(readRoster(root).instances['builder-1'].model, 'sonnet');
  registerInstance(root, { instance: 'builder-1', session_id: 's2', host: 'pc', model: 'sonnet', role_dir: '/x', now });
  assert.equal(readRoster(root).instances['builder-1'].transcript_path, undefined, 'a new session drops the old transcript');
});
