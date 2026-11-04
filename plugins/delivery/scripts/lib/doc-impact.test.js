// scripts/lib/doc-impact.test.js — the doc-impact line the merge gate asks of a change users can see:
// refused without one, passed with docs named and touched, or with "none" and a reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./doc-impact.js');

const f = (...paths) => paths.map((p) => ({ path: p, additions: 3, deletions: 1 }));
const pr = (paths, body) => ({ files: f(...paths), body });

test('a user-visible change with no doc-impact line is refused, naming the line to add', () => {
  const r = D.check(pr(['src/import.js'], 'Imports a dropped CSV.\n\nRefs ex-1'));
  assert.equal(r.ok, false);
  assert.match(r.why, /changes what users see \(src\/import\.js\) and its description has no doc-impact line/);
  assert.match(r.fix, /Doc-impact: <the docs this pull request updates>/);
  assert.match(r.fix, /Doc-impact: none \(<why users see no change>\)/);
});

test('a line naming docs passes when the pull request touches a doc file, and is refused when it touches none', () => {
  assert.equal(D.check(pr(['src/import.js', 'README.md'], 'Refs ex-1\nDoc-impact: README import section')).ok, true);
  assert.equal(D.check(pr(['src/import.js', 'plugins/x/docs/reference.txt'], 'doc impact: reference')).ok, true);
  const r = D.check(pr(['src/import.js'], 'Refs ex-1\nDoc-impact: README import section'));
  assert.equal(r.ok, false);
  assert.match(r.why, /names docs \("README import section"\) but changes no doc file/);
});

test('"none" passes only with a reason', () => {
  assert.equal(D.check(pr(['src/import.js'], 'Doc-impact: none (an internal retry; nothing a user reads changes)')).ok, true);
  assert.equal(D.check(pr(['src/import.js'], 'Doc-impact: None: refactor only')).ok, true);
  const r = D.check(pr(['src/import.js'], 'Doc-impact: none'));
  assert.equal(r.ok, false);
  assert.match(r.why, /says none without a reason/);
});

test('a change users cannot see needs no line: tests, lockfiles, the team\'s own records', () => {
  for (const paths of [['src/import.test.js'], ['scripts/testing/harness.js', 'tests/a.py'], ['package-lock.json'], ['plugins/x/.superpowers/p.md', '.github/workflows/ci.yml', '.beads/config.yaml'], ['src/__tests__/a.js']]) {
    assert.equal(D.check(pr(paths, 'Refs ex-1')).ok, true, paths.join(','));
  }
});

test('a pull request that changes only docs is its own doc impact', () => {
  assert.equal(D.check(pr(['README.md', 'plugins/x/docs/quickstart.md'], 'Refs ex-1')).ok, true);
});

test('a line quoted mid-sentence does not count; it must start a line', () => {
  assert.equal(D.check(pr(['src/a.js'], 'We forgot the Doc-impact: none (x) line.')).ok, false);
});

test('an unreadable file list is a warning, never a pass presented as checked', () => {
  const r = D.check({ body: 'Refs ex-1' });
  assert.equal(r.ok, true);
  assert.match(r.warning, /doc impact not checked: the pull request's files could not be read/);
});
