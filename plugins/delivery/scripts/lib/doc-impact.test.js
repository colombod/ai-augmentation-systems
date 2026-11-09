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
  for (const paths of [['src/import.test.js'], ['tests/a.py', 'src/fixtures/a.json'], ['package-lock.json'], ['plugins/x/.superpowers/p.md', '.github/workflows/ci.yml', '.beads/config.yaml'], ['src/__tests__/a.js']]) {
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

test('a tool users run is not a test: scripts/testing/run-tests.js needs the line', () => {
  const r = D.check(pr(['plugins/x/scripts/testing/run-tests.js'], 'Refs ex-1'));
  assert.equal(r.ok, false);
  assert.match(r.why, /changes what users see \(plugins\/x\/scripts\/testing\/run-tests\.js\)/);
});

test('a .txt outside docs/ is data, not a doc: it neither needs nor satisfies the doc-impact line', () => {
  assert.equal(D.isDoc('src/fixtures/words.txt'), false);
  assert.equal(D.isDoc('requirements.txt'), false);
  assert.equal(D.isDoc('plugins/x/docs/reference.txt'), true);
  assert.equal(D.isDoc('README.txt'), true);
  assert.equal(D.check(pr(['requirements.txt'], 'Refs ex-1')).ok, false, 'a changed requirements.txt is user-visible');
  const r = D.check(pr(['src/import.js', 'requirements.txt'], 'Doc-impact: the import guide'));
  assert.equal(r.ok, false);
  assert.match(r.why, /names docs \("the import guide"\) but changes no doc file/);
});

test('an empty doc-impact line is refused, and the next line is not read as its value', () => {
  for (const body of ['Refs ex-1\nDoc-impact:', 'Refs ex-1\nDoc-impact:   \nREADME', 'Doc-impact:\t\n']) {
    const r = D.check(pr(['src/import.js', 'README.md'], body));
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.why, /its doc-impact line is empty/);
  }
});

// delivery-plugin-planning-8l1.4.1: a builder cannot edit a pull request's description (gh pr edit fails,
// and the lane refuses body files and gh api writes), so the line also counts from a comment on the
// pull request, which gh pr comment posts and which adds no commit, or from a commit message in it.
// Where it appears more than once the latest says it: description, then commits, then comments, in order.
test('the line counts from a comment on the pull request or a commit message in it, not only the description', () => {
  const fromComment = { ...pr(['src/import.js'], 'Refs ex-1'), comments: [{ body: 'Looks good' }, { body: 'Doc-impact: none (a refactor users never see)' }] };
  assert.deepEqual(D.check(fromComment), { ok: true });
  const fromCommit = { ...pr(['src/import.js'], 'Refs ex-1'), commits: [{ messageHeadline: 'Import a CSV', messageBody: 'Refs ex-1\n\nDoc-impact: none (an internal parser change)' }] };
  assert.deepEqual(D.check(fromCommit), { ok: true });
  // a comment or a commit with no line changes nothing
  const r = D.check({ ...pr(['src/import.js'], 'Refs ex-1'), comments: [{ body: 'Rebased.' }], commits: [{ messageHeadline: 'x', messageBody: '' }] });
  assert.equal(r.ok, false);
  assert.match(r.why, /no doc-impact line/);
});

test('the latest line says the doc impact: a later comment corrects the description, either way', () => {
  // the description names docs it does not touch; a later comment says none, with a reason
  const fixed = { ...pr(['src/import.js'], 'Doc-impact: README import section'), comments: [{ body: 'Doc-impact: none (the README does not describe the parser)' }] };
  assert.deepEqual(D.check(fixed), { ok: true });
  // the description says none; a later comment leaves the line empty: refused
  const broken = { ...pr(['src/import.js'], 'Doc-impact: none (internal)'), comments: [{ body: 'Doc-impact:' }] };
  assert.match(D.check(broken).why, /its doc-impact line is empty/);
  // the description's line comes before the commits', so a commit's line wins over it
  const commit = { ...pr(['src/import.js'], 'Doc-impact:'), commits: [{ messageHeadline: 'x', messageBody: 'Doc-impact: none (a fixture only)' }] };
  assert.deepEqual(D.check(commit), { ok: true });
});

test('the refusal names the comment a builder can post, with the pull request number', () => {
  const r = D.check(pr(['src/import.js'], 'Refs ex-1'), { pr: 478 });
  assert.match(r.fix, /gh pr comment 478 --body 'Doc-impact: <the docs this pull request updates>'/);
  assert.match(r.fix, /gh pr comment 478 --body 'Doc-impact: none \(<why users see no change>\)'/);
  assert.match(r.fix, /a comment adds no commit, so a passing review still counts/);
  assert.match(D.check(pr(['src/import.js'], 'Refs ex-1')).fix, /gh pr comment <pr> --body/, 'no number known: a placeholder');
});
