// scripts/owner-queue.test.js — R-07, R-44: the owner is asked only for what no agent can do, with exact steps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const q = require('./owner-queue.js');

const NOW = '2026-10-17T22:51:28Z';
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oq-'));
const run = (root, roleId, argv, over = {}) => q.main(argv, { who: { root, roleId, instance: roleId }, now: NOW, questionExists: (id) => id === 'q-chief-of-staff-3', ...over });
const SIGN_IN = ['add', '--kind', 'signin', '--what', 'Sign in to the Vault website in Edge', '--where', 'Edge on your PC',
  '--steps', 'Open the Vault website and sign in with any method you use', '--expect', 'your collection page', '--check', 'curl -s https://example.com/health'];

test('R-07 10-17 21:00: "run the CSV drop and tell me what you see" is refused; a check is not the owner\'s', () => {
  const root = project();
  const r = run(root, 'chief-of-staff', ['add', '--kind', 'account', '--what', 'run the CSV drop in ChatGPT and tell me what you see', '--where', 'ChatGPT', '--steps', 'drop the file']);
  assert.equal(r.code, 1);
  assert.match(r.out, /check or a relay/);
  assert.equal(run(root, 'chief-of-staff', ['add', '--kind', 'verification', '--what', 'x', '--where', 'y', '--steps', 'z']).code, 1);
  // "open session X and type" is a relay, whatever the kind
  assert.equal(run(root, 'chief-of-staff', ['add', '--kind', 'account', '--what', 'approve the push', '--where', 'builder', '--steps', 'open the General Worker 2 session and type push the draft']).code, 1);
  assert.equal(run(root, 'chief-of-staff', ['list']).out, 'Nothing needs you today.');
});

test('R-44: a sign-in step with exact steps is queued, shown in the daily batch and closed with its read-back', () => {
  const root = project();
  assert.equal(run(root, 'chief-of-staff', ['add', '--kind', 'signin', '--what', 'Sign in', '--where', 'Edge']).code, 1, 'exact steps are required');
  const added = run(root, 'chief-of-staff', SIGN_IN);
  assert.equal(added.code, 0, added.out);
  const id = added.out.split(':')[0];
  const batch = run(root, 'chief-of-staff', ['list']).out.split('\n');
  assert.deepEqual(batch.slice(0, 3), ['1 thing only you can do today:', '1. Sign in to the Vault website in Edge (Edge on your PC)', '   Steps: Open the Vault website and sign in with any method you use']);
  const done = run(root, 'chief-of-staff', ['done', id]);
  assert.match(done.out, /Check it now: curl -s https:\/\/example\.com\/health/);
  assert.equal(run(root, 'chief-of-staff', ['done', id]).code, 1);
  assert.equal(run(root, 'chief-of-staff', ['list']).out, 'Nothing needs you today.');
});

test('R-44: a decision step is scope, money or irreversible and cites a logged question; only the CoS keeps the queue', () => {
  const root = project();
  const decision = ['add', '--kind', 'decision', '--what', 'Turn extra usage on or leave it off', '--where', 'this chat', '--steps', 'Reply "extra on" or "wait"'];
  assert.equal(run(root, 'chief-of-staff', [...decision, '--about', 'naming', '--question', 'q-chief-of-staff-3']).code, 1);
  assert.equal(run(root, 'chief-of-staff', [...decision, '--about', 'money']).code, 1);
  assert.equal(run(root, 'chief-of-staff', [...decision, '--about', 'money', '--question', 'q-chief-of-staff-9']).code, 1);
  assert.equal(run(root, 'chief-of-staff', [...decision, '--about', 'money', '--question', 'q-chief-of-staff-3']).code, 0);
  for (const role of ['product-manager', 'delivery-lead', null]) assert.equal(run(root, role, SIGN_IN).code, 1, String(role));
  assert.equal(run(root, null, ['list']).code, 0, 'anyone may read the batch');
});
