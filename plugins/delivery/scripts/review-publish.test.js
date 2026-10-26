// scripts/review-publish.test.js — a review or merge row written on one host reaches the project repo's
// origin, so the merge gate on another host (or after a container restart) reads the same rows.
// review.js and merge-gate.js run in this process with a real git, a temp bare origin and clones of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { loadManifest } = require('./lib/manifest.js');
const R = require('./lib/reviews.js');
const review = require('./review.js');
const mergeGate = require('./merge-gate.js');

const BEAD = 'ex-vault-0n9-3';
const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const VIEW = { headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'src/import.js', additions: 50, deletions: 5 }], body: `Refs ${BEAD}`, title: 'Import', state: 'MERGED' };
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
const CHAIN = (pr, writer) => `.delivery/reviews/prs/${pr}/${writer}.ndjson`;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => cp.execFileSync('git', a, { cwd, env: ENV, encoding: 'utf8' }).trim();

// a project root that is a clone of a bare origin, with the manifest and a story committed on main
function project({ origin = true } = {}) {
  const root = makeProject();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'project');
  const bare = tmp('rp-origin-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  if (origin) { git(root, 'remote', 'add', 'origin', bare); git(root, 'push', '-q', 'origin', 'main'); }
  return { root, bare };
}
const cloneOf = (bare) => { const d = path.join(tmp('rp-clone-'), 'project'); cp.execFileSync('git', ['clone', '-q', '-b', 'main', bare, d], { env: ENV }); return d; };
const whoOf = (root, instance = 'delivery-lead', roleId = instance === 'delivery-lead' ? 'delivery-lead' : 'builder') => {
  const team = { ...loadManifest(root).team, product_github: 'example/example' };
  return { root, team, instance, roleId, actor: `dev@pc/${instance}` };
};
const bd = () => memBd([storyBead({ id: BEAD, assignee: 'dev@pc/builder-1', metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } })]);
const run = (who, args) => review.main(args, { who, bd: bd(), gh: () => VIEW, env: ENV });
const request = (who, reviewer = 'agent-r1') => run(who, ['request', '478', '--reviewer', reviewer]);
const record = (who, by = 'agent-r1') => run(who, ['record', '478', '--head', H1, '--result', 'pass', '--summary', 'ok', ...(who.roleId === 'delivery-lead' ? ['--by', by] : [])]);
const subjects = (bare) => git(bare, 'log', 'main', '--format=%s').split('\n');
const filesOf = (dir, rev) => git(dir, 'show', '--format=', '--name-only', rev).split('\n').filter(Boolean);

test('publish 1: request and record each reach origin as a commit holding only the chain file', () => {
  const { root, bare } = project();
  const who = whoOf(root);
  assert.equal(request(who).code, 0);
  assert.equal(record(who).code, 0);
  assert.deepEqual(subjects(bare).slice(0, 2), ['reviews: PR 478 review (delivery-lead)', 'reviews: PR 478 request (delivery-lead)']);
  for (const rev of ['main', 'main~1']) assert.deepEqual(filesOf(bare, rev), [CHAIN(478, 'delivery-lead')]);
  assert.equal(git(bare, 'show', `main:${CHAIN(478, 'delivery-lead')}`).split('\n').length, 2);
});

test('publish 1: ci, send-back and the merged row are published too', () => {
  const { root, bare } = project();
  const who = whoOf(root);
  request(who);
  assert.equal(run(who, ['ci', '478', '--head', H1, '--result', 'pass', '--run', 'r1']).code, 0);
  assert.equal(run(who, ['send-back', '478', '--reason', 'changes']).code, 0);
  const merged = mergeGate.main(['merged', '478'], { who, bd: bd(), gh: () => VIEW, env: ENV, cwd: root });
  assert.ok(/merged at/.test(merged.out), merged.out);
  assert.deepEqual(subjects(bare).slice(0, 4), ['reviews: PR 478 merged (delivery-lead)', 'reviews: PR 478 sent-back (delivery-lead)', 'reviews: PR 478 ci (delivery-lead)', 'reviews: PR 478 request (delivery-lead)']);
});

test('publish 2: a second clone of origin reads the same rows and the gate finds the passing review', () => {
  const { root, bare } = project();
  const who = whoOf(root);
  request(who);
  record(who);
  const other = cloneOf(bare);
  assert.deepEqual(R.read(other, 478).rows.map((r) => r.type), ['request', 'review']);
  const check = mergeGate.check(other, '478', { head: H1, gh: () => VIEW, team: whoOf(other).team, repo: 'example/example' });
  assert.doesNotMatch(check.out, /no independent review/);
  assert.equal(check.code, 0, check.out);
});

test('publish 3: with no origin the command succeeds, the row is written and committed, and one line says why it is not published', () => {
  const { root } = project({ origin: false });
  const who = whoOf(root);
  const r = request(who);
  assert.equal(r.code, 0);
  assert.match(r.out, /\nreview rows for PR 478 not published: the project repo has no origin remote$/);
  assert.equal(R.read(root, 478).rows.length, 1);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'reviews: PR 478 request (delivery-lead)');
});

test('publish 3: an unreachable origin is the same, and the next command publishes the earlier rows too', () => {
  const { root, bare } = project();
  git(root, 'remote', 'set-url', 'origin', path.join(os.tmpdir(), 'rp-no-such-origin'));
  const who = whoOf(root);
  const r = request(who);
  assert.equal(r.code, 0);
  assert.match(r.out, /review rows for PR 478 not published: origin is not reachable/);
  const again = record(who);
  assert.equal(again.code, 0);
  assert.match(again.out, /not published/);
  assert.equal(R.read(root, 478).rows.length, 2);
  git(root, 'remote', 'set-url', 'origin', bare);
  const third = run(who, ['ci', '478', '--head', H1, '--result', 'pass', '--run', 'r1']);
  assert.equal(third.code, 0);
  assert.doesNotMatch(third.out, /not published/);
  assert.equal(git(bare, 'show', `main:${CHAIN(478, 'delivery-lead')}`).split('\n').length, 3);
  assert.equal(subjects(bare).filter((s) => /^reviews:/.test(s)).length, 3);
});

test('publish: a rejected push (origin moved) fetches, rebases the record commit and retries once', () => {
  const { root, bare } = project();
  const other = cloneOf(bare);
  fs.writeFileSync(path.join(other, 'NOTES.md'), 'moved\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'origin moves');
  git(other, 'push', '-q', 'origin', 'main');
  const r = request(whoOf(root));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /not published/);
  assert.deepEqual(subjects(bare).slice(0, 2), ['reviews: PR 478 request (delivery-lead)', 'origin moves']);
});

test('publish 4: a modified or staged file the Delivery Manager has in the root is not committed or pushed', () => {
  const { root, bare } = project();
  const story = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.appendFileSync(story, '\nunfinished\n');
  fs.writeFileSync(path.join(root, 'staged.md'), 'staged\n');
  git(root, 'add', 'staged.md');
  const r = request(whoOf(root));
  assert.equal(r.code, 0);
  assert.deepEqual(filesOf(bare, 'main'), [CHAIN(478, 'delivery-lead')]);
  const status = git(root, 'status', '--porcelain');
  assert.match(status, /^\s?M \.delivery\/stories\/vault-0n9-3\.md$/m);
  assert.match(status, /^A  staged\.md$/m);
});

test('publish: two writers on two hosts each push their own chain file; both are read', () => {
  const { root, bare } = project();
  const dm = whoOf(root);
  request(dm, 'builder-2');
  const host2 = cloneOf(bare);
  const rec = record(whoOf(host2, 'builder-2'));
  assert.equal(rec.code, 0, rec.out);
  const third = cloneOf(bare);
  assert.deepEqual(fs.readdirSync(path.join(third, '.delivery', 'reviews', 'prs', '478')).sort(), ['builder-2.ndjson', 'delivery-lead.ndjson']);
  assert.deepEqual(R.read(third, 478).rows.map((r) => r.type), ['request', 'review']);
});

test('publish: a project root that is not a git checkout prints nothing about publishing', () => {
  const root = makeProject();
  const r = request(whoOf(root));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /not published/);
});
