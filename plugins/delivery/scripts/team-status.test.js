// scripts/team-status.test.js — run with: node --test scripts/team-status.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teamStatus, renderStatus } = require('./team-status.js');
const { registerInstance } = require('./lib/roster.js');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

const NOW = '2026-10-12T12:00:00Z';

test('every manifest instance is missing when the roster is empty', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.equal(s.rows.length, 7);
  assert.deepEqual(s.drift.missing, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'builder-1', 'builder-2']);
  assert.ok(renderStatus(s).includes('Missing: chief-of-staff'));
});

test('live, stale, extra and wrong_model are reported', () => {
  const root = scratchProject();
  registerInstance(root, { instance: 'chief-of-staff', session_id: 'a', host: 'pc', model: 'opus', role_dir: '/x', now: '2026-10-12T11:30:00Z' });
  registerInstance(root, { instance: 'staffing', session_id: 'b', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T08:00:00Z' });
  registerInstance(root, { instance: 'builder-1', session_id: 'c', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  registerInstance(root, { instance: 'wizard', session_id: 'd', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const byId = Object.fromEntries(s.rows.map((r) => [r.instance, r]));
  assert.equal(byId['chief-of-staff'].state, 'live');
  assert.equal(byId['staffing'].state, 'stale');
  assert.deepEqual(s.drift.stale, ['staffing']);
  assert.deepEqual(s.drift.extra, ['wizard']);
  assert.deepEqual(s.drift.wrong_model, [{ instance: 'builder-1', expected: 'sonnet', actual: 'haiku' }]);
  const text = renderStatus(s);
  assert.ok(text.includes('| chief-of-staff | chief-of-staff | pc | opus | a | live |'));
  assert.ok(text.includes('Wrong model: builder-1 expected sonnet, running haiku'));
});

test('renderStatus says No drift when the roster matches', () => {
  const root = scratchProject();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now: NOW });
  }
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.ok(renderStatus(s).includes('No drift.'));
});
