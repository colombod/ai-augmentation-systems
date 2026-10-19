// scripts/flow.test.js — flow limits (R-23) replayed on Vault moments through the real lane and bd-guard
// hook processes (testing/role-harness.js): 13 parallel builders on the collections epic (AI 10-09), eight
// beads moved to one session in a minute (10-11 08:10), and a builder's third open pull request.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./lib/warnings.js');
const { harness } = require('./testing/role-harness.js');
const { teamStatus, renderStatus } = require('./team-status.js');

const H = (n) => `${String(n).padStart(4, '0')}${'a'.repeat(36)}`;
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const story = (id, over = {}) => ({ id, title: `Story ${id}`, parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'], ...over, metadata: { surface: 'S1', area: 'collection', ...(over.metadata || {}) } });
const claim = (h, inst, id) => h.bash(inst, `bd update ${id} --claim`);

test('R-23: 13 parallel builders on the collections epic and eight beads to one session warn, never block, and head the status', () => {
  const ids = Array.from({ length: 13 }, (_, i) => `ex-col-${i + 1}`);
  const h = harness({ beads: Object.fromEntries(ids.map((id) => [id, story(id)])) });
  const outs = ids.map((id, i) => claim(h, `builder-${(i % 2) + 1}`, id));
  assert.deepEqual(outs.map((o) => o.deny), ids.map(() => null), 'no claim is refused');
  assert.match(outs[2].ctx, /builder-1 would hold 2 in progress and 0 queued \(limit 1 in progress and 1 queued\)/);
  assert.match(outs[2].ctx, /2 stories in progress for 2 builder\(s\)/);
  // 10-11 08:10: eight beads moved to one session in a minute
  const h2 = harness({ beads: Object.fromEntries(ids.slice(0, 8).map((id) => [id, story(id)])) });
  const moved = ids.slice(0, 8).map((id) => h2.bash('delivery-lead', `bd update ${id} --assignee dev@pc/builder-1`));
  assert.deepEqual(moved.map((o) => o.deny), moved.map(() => null));
  assert.doesNotMatch(moved[0].ctx || '', /would hold/);
  assert.match(moved[1].ctx, /builder-1 would hold 0 in progress and 2 queued/);
  const status = renderStatus(teamStatus(h2.root, { bdCheck: () => false }), null).split('\n');
  assert.match(status[0], /^Flow warnings open: wip-session 7$/, 'at the top of the Delivery Manager\'s status');
  assert.equal(W.list(h2.root).filter((w) => w.kind === 'wip-session').length, 7);
});

test('R-23: a third open pull request from one builder warns at review request', () => {
  const pr = (n) => ({ headRefOid: H(n), headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: `a${n}.js`, additions: 5, deletions: 0 }], body: `Refs ex-col-${n}`, title: `t${n}` });
  const beads = Object.fromEntries([1, 2, 3].map((n) => [`ex-col-${n}`, story(`ex-col-${n}`, { assignee: 'dev@pc/builder-1', status: 'in_progress' })]));
  const h = harness({ beads, prs: { 1: pr(1), 2: pr(2), 3: pr(3) } });
  const req = (n) => h.bash('delivery-lead', `${h.script('review.js')} request ${n} --reviewer builder-2`);
  assert.doesNotMatch(req(1).out + req(2).out, /open pull request/);
  const third = req(3);
  assert.equal(third.code, 0);
  assert.match(third.out, /warning w-.*: builder-1 already has 2 open pull request\(s\) \(PR 1, PR 2\), the limit is 2/);
});

test('Copilot 864 884: a reassigned in-progress story and each story of a bulk claim count toward the session\'s WIP', () => {
  const h = harness({ beads: { 'ex-a': story('ex-a', { status: 'in_progress', assignee: 'dev@pc/builder-1' }), 'ex-b': story('ex-b', { status: 'in_progress', assignee: 'dev@pc/builder-2' }), 'ex-c': story('ex-c'), 'ex-d': story('ex-d') } });
  const moved = h.bash('delivery-lead', 'bd update ex-b --assignee dev@pc/builder-1');
  assert.equal(moved.deny, null);
  assert.match(moved.ctx, /builder-1 would hold 2 in progress and 0 queued/);
  const bulk = h.bash('builder-2', 'bd update ex-c ex-d --claim');
  assert.equal(bulk.deny, null);
  assert.match(bulk.ctx, /ex-d: builder-2 would hold 2 in progress and 0 queued/);
  assert.doesNotMatch(bulk.ctx, /ex-c: builder-2 would hold/);
});

test('Copilot 925: a pull request closed on GitHub without merging no longer counts as open', () => {
  const pr = (n, state) => ({ headRefOid: H(n), headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: `a${n}.js`, additions: 5, deletions: 0 }], body: `Refs ex-col-${n}`, title: `t${n}`, ...(state ? { state } : {}) });
  const beads = Object.fromEntries([1, 2, 3].map((n) => [`ex-col-${n}`, story(`ex-col-${n}`, { assignee: 'dev@pc/builder-1', status: 'in_progress' })]));
  const h = harness({ beads, prs: { 1: pr(1), 2: pr(2), 3: pr(3) } });
  const req = (n) => h.bash('delivery-lead', `${h.script('review.js')} request ${n} --reviewer builder-2`);
  req(1); req(2);
  h.setPr(1, (p) => { p.state = 'CLOSED'; });
  h.setPr(2, (p) => { p.state = 'CLOSED'; });
  assert.doesNotMatch(req(3).out, /open pull request/);
});
