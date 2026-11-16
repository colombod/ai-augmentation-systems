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

test('list filters by assignee and status', () => {
  const bd = makeBd({ env: { ...fakeEnv(), BEADS_ACTOR: 'me@pc/builder-1' } });
  bd.create({ id: 'ex-1', title: 'one' });
  bd.create({ id: 'ex-2', title: 'two' });
  bd.exec(['update', 'ex-1', '--claim']);
  assert.deepEqual(bd.list({ assignee: 'me@pc/builder-1', status: 'in_progress' }).map((b) => b.id), ['ex-1']);
  assert.deepEqual(bd.list({ status: 'open' }).map((b) => b.id), ['ex-2']);
  assert.deepEqual(bd.list({ assignee: 'nobody' }), []);
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

// A bd on PATH that runs this shell body for every call (8l1.4.1.2.1)
function bdThat(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-look-'));
  fs.writeFileSync(path.join(dir, 'bd'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, BD_LOOK_DIR: dir };
}
const BEAD_JSON = 'echo \'[{"id":"ex-1","title":"t"}]\'';
const COUNT = 'n=$(cat "$BD_LOOK_DIR/n" 2>/dev/null || echo 0); echo $((n+1)) > "$BD_LOOK_DIR/n";';

test('lookup tells a bead, a missing bead, a bd error and a timeout apart', () => {
  const { lookupProblem } = require('./bd.js');
  assert.equal(makeBd({ env: bdThat(BEAD_JSON) }).lookup('ex-1').bead.title, 't');
  assert.deepEqual(makeBd({ env: bdThat('echo \'Error fetching ex-1: no issue found matching "ex-1"\' >&2; exit 1') }).lookup('ex-1'), { missing: true });
  const locked = makeBd({ env: bdThat('echo "warning: beads.role not configured" >&2; echo "Error: database is locked" >&2; exit 1') }).lookup('ex-1');
  assert.deepEqual(locked, { error: 'Error: database is locked' });
  // an untagged notice ahead of the error line is skipped too: the error line is the one named
  const noticed = makeBd({ env: bdThat('echo "beads.role not configured for this clone" >&2; echo "Error: database is locked" >&2; exit 1') }).lookup('ex-1');
  assert.deepEqual(noticed, { error: 'Error: database is locked' });
  assert.equal(lookupProblem('ex-1', locked), 'bead ex-1 could not be read: Error: database is locked; try again in a moment');
  assert.equal(lookupProblem('ex-1', { missing: true }), 'no bead ex-1');
  const slow = makeBd({ env: bdThat('sleep 5'), timeoutMs: 300 }).lookup('ex-1');
  assert.deepEqual(slow, { error: 'bd did not answer within 300 ms (timed out)' });
  // show keeps its contract: null for a failed read, the bead when there is one
  assert.equal(makeBd({ env: bdThat('exit 1') }).show('ex-1'), null);
  assert.equal(makeBd({ env: bdThat(BEAD_JSON) }).show('ex-1').title, 't');
});

test('lookup reads once more after a failed read, and not after a missing bead', () => {
  const env = bdThat(`${COUNT} [ "$n" = 0 ] && { echo "Error: database is locked" >&2; exit 1; }; ${BEAD_JSON}`);
  assert.equal(makeBd({ env }).lookup('ex-1').bead.title, 't', 'the second read answers');
  assert.equal(fs.readFileSync(path.join(env.BD_LOOK_DIR, 'n'), 'utf8').trim(), '2');
  const gone = bdThat(`${COUNT} echo 'no issue found matching "ex-1"' >&2; exit 1`);
  assert.deepEqual(makeBd({ env: gone }).lookup('ex-1'), { missing: true });
  assert.equal(fs.readFileSync(path.join(gone.BD_LOOK_DIR, 'n'), 'utf8').trim(), '1', 'a missing bead is not read twice');
});

test('rv-216: a timeout is not read again, an error is; show() reads once; a timeout after a warning is named a timeout', () => {
  // a bd that counts its calls and never answers in time
  const slow = bdThat(`${COUNT} sleep 5`);
  assert.deepEqual(makeBd({ env: slow, timeoutMs: 300 }).lookup('ex-1'), { error: 'bd did not answer within 300 ms (timed out)' });
  assert.equal(fs.readFileSync(path.join(slow.BD_LOOK_DIR, 'n'), 'utf8').trim(), '1', 'a timeout is not waited for twice');
  // show() is one read, as before lookup existed: a failed read is null after one call
  const flaky = bdThat(`${COUNT} [ "$n" = 0 ] && { echo "Error: database is locked" >&2; exit 1; }; ${BEAD_JSON}`);
  assert.equal(makeBd({ env: flaky }).show('ex-1'), null);
  assert.equal(fs.readFileSync(path.join(flaky.BD_LOOK_DIR, 'n'), 'utf8').trim(), '1', 'show() does not retry');
  // bd printed its beads.role warning, then hung: the error is the timeout, not the warning or "bd failed"
  const warned = makeBd({ env: bdThat('echo "warning: beads.role not configured (GH#2950)." >&2; sleep 5'), timeoutMs: 300 }).lookup('ex-1');
  assert.deepEqual(warned, { error: 'bd did not answer within 300 ms (timed out)' });
});
