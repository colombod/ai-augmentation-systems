// scripts/lib/bd.test.js — run with: node --test scripts/lib/bd.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeBd } = require('./bd.js');

const FAKE_DIR = path.join(__dirname, '..', 'testing');

function fakeEnv() {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')), 'store.json');
  return { ...process.env, PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: store };
}

test('show returns null for an unknown id and the bead after create', () => {
  const bd = makeBd({ env: fakeEnv() });
  assert.equal(bd.show('ex-ph1'), null);
  const id = bd.create({ id: 'ex-ph1', title: 'Phase 1: Foundations', type: 'epic', labels: ['roadmap'], metadata: { doc_id: 'phase-1' }, priority: 1 });
  assert.equal(id, 'ex-ph1');
  const bead = bd.show('ex-ph1');
  assert.equal(bead.title, 'Phase 1: Foundations');
  assert.deepEqual(bead.labels, ['roadmap']);
  assert.equal(bead.metadata.doc_id, 'phase-1');
});

test('update changes title, adds labels, merges metadata and appends notes', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-s1', title: 'old', type: 'task' });
  bd.update('ex-s1', { title: 'new', addLabels: ['story'], metadata: { k: 'v' }, appendNotes: 'hello' });
  const b = bd.show('ex-s1');
  assert.equal(b.title, 'new');
  assert.ok(b.labels.includes('story'));
  assert.equal(b.metadata.k, 'v');
  assert.ok(b.notes.includes('hello'));
});

test('depAdd is idempotent and depsOf lists blockers', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-a', title: 'a' });
  bd.create({ id: 'ex-b', title: 'b' });
  bd.depAdd('ex-b', 'ex-a');
  bd.depAdd('ex-b', 'ex-a');
  assert.deepEqual(bd.depsOf('ex-b'), ['ex-a']);
  assert.deepEqual(bd.depsOf('ex-a'), []);
});

test('list filters by label and hides closed unless all', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-1', title: 'one', labels: ['roadmap'] });
  bd.create({ id: 'ex-2', title: 'two', labels: ['other'] });
  bd.exec(['close', 'ex-2', '--reason', 'EVIDENCE: done']);
  assert.deepEqual(bd.list({ label: 'roadmap' }).map((b) => b.id), ['ex-1']);
  assert.deepEqual(bd.list({ all: true }).map((b) => b.id).sort(), ['ex-1', 'ex-2']);
  bd.create({ id: 'ex-3', title: 'bare' });
  const bare = bd.list({ all: true }).find((b) => b.id === 'ex-3');
  assert.deepEqual(bare.labels, []);
  assert.deepEqual(bare.metadata, {});
});

test('create of an existing id throws with the bd message', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-dup', title: 'x' });
  assert.throws(() => bd.create({ id: 'ex-dup', title: 'x' }), /already exists/);
});

test('create with a parent sets it via update', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-p', title: 'epic', type: 'epic' });
  bd.create({ id: 'ex-c', title: 'child', type: 'task', parent: 'ex-p' });
  assert.equal(bd.show('ex-c').parent, 'ex-p');
});

test('depsOf ignores the parent-child row', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-p', title: 'epic', type: 'epic' });
  bd.create({ id: 'ex-a', title: 'a' });
  bd.create({ id: 'ex-b', title: 'b', parent: 'ex-p' });
  bd.depAdd('ex-b', 'ex-a');
  assert.deepEqual(bd.depsOf('ex-b'), ['ex-a']);
});

test('show of a bare bead defaults labels, metadata and parent, and exposes type', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-bare', title: 'bare', type: 'task' });
  const b = bd.show('ex-bare');
  assert.deepEqual(b.labels, []);
  assert.deepEqual(b.metadata, {});
  assert.equal(b.parent, null);
  assert.equal(b.type, 'task');
});

test('depRemove removes one blocker and leaves the rest', () => {
  const bd = makeBd({ env: fakeEnv() });
  for (const id of ['ex-a', 'ex-b', 'ex-c']) bd.create({ id, title: id });
  bd.depAdd('ex-c', 'ex-a');
  bd.depAdd('ex-c', 'ex-b');
  bd.depRemove('ex-c', 'ex-a');
  assert.deepEqual(bd.depsOf('ex-c'), ['ex-b']);
});

test('depAdd that would create a cycle throws the real bd message', () => {
  const bd = makeBd({ env: fakeEnv() });
  for (const id of ['ex-a', 'ex-b', 'ex-c']) bd.create({ id, title: id });
  bd.depAdd('ex-b', 'ex-a');
  bd.depAdd('ex-c', 'ex-b');
  bd.exec(['close', 'ex-b', '--reason', 'EVIDENCE: done']);
  assert.throws(() => bd.depAdd('ex-a', 'ex-c'), /adding dependency would create a cycle/);
  assert.throws(() => bd.depAdd('ex-a', 'ex-a'), /cycle/);
});
