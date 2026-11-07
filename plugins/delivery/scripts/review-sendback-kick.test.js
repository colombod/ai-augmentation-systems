// scripts/review-sendback-kick.test.js — hjx.1.1: a pull request sent back to its builder is a handover,
// so review.js send-back starts a watchdog run now (lib/kick.js), as a message and a handoff do. Before,
// it waited for the next timer pass to reach the builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { loadManifest } = require('./lib/manifest.js');
const K = require('./lib/kick.js');
const review = require('./review.js');

const BEAD = 'ex-vault-0n9-3';
const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const VIEW = { headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'CONFLICTING', statusCheckRollup: [], files: [], body: `Refs ${BEAD}`, title: 'Import', state: 'OPEN' };
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const whoOf = (root) => ({ root, team: { ...loadManifest(root).team, product_github: 'example/example' }, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 'dev@pc/delivery-lead' });
const run = (who, args) => review.main(args, { who, bd: memBd([storyBead({ id: BEAD, assignee: 'dev@pc/builder-1' })]), gh: () => VIEW, env: ENV });

test('hjx.1.1: send-back drops a kick, so the builder is woken at once; a request does not', () => {
  const root = makeProject();
  const who = whoOf(root);
  assert.equal(run(who, ['request', '478', '--reviewer', 'agent-r1']).code, 0);
  assert.equal(K.waiting(root), 0, 'a review request is not a handover to the builder');
  // a refused send-back (no reason) hands nothing over
  assert.equal(run(who, ['send-back', '478']).code, 2);
  assert.equal(K.waiting(root), 0);
  assert.equal(run(who, ['send-back', '478', '--reason', 'conflict']).code, 0);
  assert.equal(K.waiting(root), 1);
  assert.match(K.take(root).join('\n'), /send-back of PR 478/);
});
