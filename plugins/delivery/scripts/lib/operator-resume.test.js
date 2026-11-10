// scripts/lib/operator-resume.test.js — run with: node scripts/testing/run-tests.js
// delivery-plugin-planning-hb1.8: resuming a session copies its earlier messages into the new session's
// transcript. Read from the chief-of-staff's real transcripts: each copy keeps its record uuid and its
// timestamp, but carries a new promptId (one per file, shared by every copied record) or none at all. Human
// inputs were deduped on promptId first, so every resume captured every earlier input again. The record
// uuid is the message's identity; a copy is the same input, a new record is a new one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./operator-log.js');

const mk = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const human = (text, n, sessionId, extra = {}) => ({
  type: 'user', origin: { kind: 'human' }, promptId: `p${n}`, uuid: `u${n}`,
  timestamp: `2026-11-04T08:37:${String(n % 60).padStart(2, '0')}.000Z`, sessionId,
  message: { role: 'user', content: text }, ...extra,
});
// the copy a resume writes: the same uuid and timestamp, a new session and the resume's own promptId
const copied = (rec, sessionId, promptId) => {
  const c = { ...rec, sessionId };
  if (promptId === null) delete c.promptId; else c.promptId = promptId;
  return c;
};
function transcript(records) {
  const f = path.join(mk('opres-tr-'), 't.jsonl');
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}
const sync = (root, tr, sessionId) => log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId, instance: 'chief-of-staff',
  role: 'chief-of-staff', host: 'pc', now: new Date('2026-11-04T12:00:00Z') });
const texts = (root) => log.listInputs(root).map((e) => e.text);

test('a resumed session copies earlier inputs with a new promptId: they are not captured again, a new input after them is', () => {
  const root = mk('opres-proj-');
  const one = human('one', 1, 'sess-1');
  const two = human('two', 2, 'sess-1');
  assert.strictEqual(sync(root, transcript([one, two]), 'sess-1').added, 2);
  // the resume: a new transcript and session, the two earlier inputs copied under the resume's promptId,
  // then one new input that shares that promptId too
  const resumed = transcript([copied(one, 'sess-2', 'r-1'), copied(two, 'sess-2', 'r-1'), human('three', 3, 'sess-2', { promptId: 'r-1' })]);
  assert.strictEqual(sync(root, resumed, 'sess-2').added, 1);
  assert.deepStrictEqual(texts(root), ['one', 'two', 'three']);
  // a second resume, copying all three again
  const again = transcript([one, two, { ...human('three', 3, 'sess-2') }].map((r) => copied(r, 'sess-3', 'r-2')));
  assert.strictEqual(sync(root, again, 'sess-3').added, 0);
});

test('a copy with no promptId at all is the same input as the one captured first', () => {
  const root = mk('opres-proj-');
  const one = human('one', 1, 'sess-1');
  sync(root, transcript([one]), 'sess-1');
  assert.strictEqual(sync(root, transcript([copied(one, 'sess-2', null)]), 'sess-2').added, 0);
  assert.deepStrictEqual(texts(root), ['one']);
});

test('two inputs with the same words are two inputs: the record, not its text, is the identity', () => {
  const root = mk('opres-proj-');
  const first = human('yes', 1, 'sess-1');
  const later = human('yes', 2, 'sess-2', { promptId: 'r-1' });
  sync(root, transcript([first]), 'sess-1');
  assert.strictEqual(sync(root, transcript([copied(first, 'sess-2', 'r-1'), later]), 'sess-2').added, 1);
  assert.deepStrictEqual(texts(root), ['yes', 'yes']);
});

// a resume onto a new plugin version: the index of known inputs was written by the version before, keyed
// on promptId alone. It is rebuilt from the log, where each entry keeps its uuid, so the copies still match.
test('after a resume onto a new plugin version, an index written by the version before still finds the copies', () => {
  const root = mk('opres-proj-');
  const one = human('one', 1, 'sess-1');
  const two = human('two', 2, 'sess-1');
  sync(root, transcript([one, two]), 'sess-1');
  const curDir = path.join(root, '.delivery', 'operator', 'cursors');
  const file = path.join(curDir, fs.readdirSync(curDir).find((f) => /^inputs-index-/.test(f)));
  const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
  // the older version's shape: its own last id, and keys on promptId only, no format marker
  const ids = log.listInputs(root).map((e) => e.id);
  fs.writeFileSync(file, JSON.stringify({ last_id: idx.last_id, map: { p1: ids[0], p2: ids[1] } }));
  const resumed = transcript([copied(one, 'sess-2', 'r-1'), copied(two, 'sess-2', 'r-1'), human('three', 3, 'sess-2', { promptId: 'r-1' })]);
  assert.strictEqual(sync(root, resumed, 'sess-2').added, 1);
  assert.deepStrictEqual(texts(root), ['one', 'two', 'three']);
});
