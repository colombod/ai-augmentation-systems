// scripts/goal.test.js — R-42: constraints change only on the owner's word, replayed on Vault moments.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const goal = require('./goal.js');
const Goal = require('./lib/goal.js');
const { decideLane, loadPolicy } = require('../hooks/scripts/lane.js');
const { manifestWarnings } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
const NOW = '2026-10-17T21:13:43Z';
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
const who = (root, roleId) => ({ root, roleId, instance: roleId });
// owner decisions by id: the quote is the owner's exact words
const RECORDS = {
  'dec-chief-of-staff-7': { quote: 'keep usage under 30% of the week for this goal', kind: 'decision' },
  'dec-chief-of-staff-8': { quote: 'no parallel run are justified', kind: 'decision' },
  'dec-chief-of-staff-9': { quote: 'pause everything until I am back', kind: 'decision' },
  'dec-chief-of-staff-10': { quote: 'keep usage under 30% of the week', kind: 'decision', revoked: true },
};
const verifyRecord = (root, id) => {
  const r = RECORDS[id];
  if (!r) return { ok: false, code: 'not_found' };
  return { ok: true, chain: [{ kind: r.kind, quote: r.quote }], notes: r.revoked ? [`${id} was revoked by rev-1`] : [] };
};
const run = (root, roleId, argv) => goal.main(argv, { who: who(root, roleId), verifyRecord, now: NOW });

test('R-42 10-17 21:13: the CoS cannot set its own 30% usage envelope; the owner\'s words can', () => {
  const root = project();
  // no record at all
  const bare = run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '30']);
  assert.equal(bare.code, 1);
  assert.match(bare.out, /--record <dec-id>/);
  // a record that does not say 30 (the owner said something else) does not cover it
  assert.equal(run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '30', '--record', 'dec-chief-of-staff-8']).code, 1);
  // an unknown or revoked record
  assert.equal(run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '30', '--record', 'dec-chief-of-staff-99']).code, 1);
  assert.equal(run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '30', '--record', 'dec-chief-of-staff-10']).code, 1);
  assert.equal(Goal.value(root, 'budget.usage_envelope'), null);
  // the owner said it
  const ok = run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '30', '--record', 'dec-chief-of-staff-7']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(Goal.value(root, 'budget.usage_envelope'), 30);
  // a different figure than the owner's is still refused
  assert.equal(run(root, 'chief-of-staff', ['set', 'budget.usage_envelope', '40', '--record', 'dec-chief-of-staff-7']).code, 1);
  assert.equal(Goal.read(root).history.length, 1);
});

test('R-42: only the CoS or PM records a constraint, and only from a role session (fail closed)', () => {
  const root = project();
  for (const role of ['delivery-lead', 'builder', null]) {
    assert.equal(run(root, role, ['set', 'budget.usage_envelope', '30', '--record', 'dec-chief-of-staff-7']).code, 1, String(role));
  }
  assert.equal(run(root, 'product-manager', ['set', 'scope', 'parallel run', '--record', 'dec-chief-of-staff-8']).code, 0);
});

test('R-42 "IDLE NOW": a pause needs the owner\'s word or an open andon, and lapses with it', () => {
  const root = project();
  assert.equal(run(root, 'chief-of-staff', ['set', 'pause', 'paused']).code, 1);
  assert.equal(run(root, 'chief-of-staff', ['set', 'pause', 'paused', '--record', 'dec-chief-of-staff-8']).code, 1);
  assert.equal(Goal.activePause(root, { verifyRecord }).paused, false);
  // a mechanical trigger: refused while no andon is open, accepted while one is, lifted when it closes
  assert.equal(run(root, 'delivery-lead', ['pause', '--trigger', 'andon:a-1']).code, 1);
  assert.equal(run(root, 'delivery-lead', ['pause', '--trigger', 'ci:main']).code, 1);
  fs.mkdirSync(path.join(root, '.delivery', 'andon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'andon', 'a-1.json'), JSON.stringify({ status: 'open' }));
  assert.equal(run(root, 'builder', ['pause', '--trigger', 'andon:a-1']).code, 1, 'a builder does not pause the team');
  assert.equal(run(root, 'delivery-lead', ['pause', '--trigger', 'andon:a-1']).code, 0);
  assert.deepEqual(Goal.activePause(root, { verifyRecord }), { paused: true, by: 'andon:a-1' });
  fs.writeFileSync(path.join(root, '.delivery', 'andon', 'a-1.json'), JSON.stringify({ status: 'closed' }));
  assert.equal(Goal.activePause(root, { verifyRecord }).paused, false);
  // the owner's own pause holds while its record verifies
  assert.equal(run(root, 'chief-of-staff', ['set', 'pause', 'paused', '--record', 'dec-chief-of-staff-9']).code, 0);
  assert.equal(Goal.activePause(root, { verifyRecord }).paused, true);
  RECORDS['dec-chief-of-staff-9'].revoked = true;
  try { assert.equal(Goal.activePause(root, { verifyRecord }).paused, false); } finally { delete RECORDS['dec-chief-of-staff-9'].revoked; }
});

test('R-42: no default budget; the idle and briefing limits default to 30 and 12', () => {
  const root = project();
  for (const f of ['budget.weekly_units', 'budget.usage_envelope', 'budget.lean_at']) assert.equal(Goal.value(root, f), null, f);
  assert.equal(Goal.value(root, 'idle_minutes'), 30);
  assert.equal(Goal.value(root, 'briefing_lines'), 12);
  assert.match(run(root, 'chief-of-staff', ['show']).out, /budget\.weekly_units: not set by the owner/);
  // a budget figure written into team.json is ignored with a warning
  assert.ok(manifestWarnings({ roles: [], budget: { usage_envelope: 30 } }).some((w) => /budget\.usage_envelope is ignored/.test(w)));
});

test('R-42 lane: no role writes the goal sheet directly; the CoS runs goal.js set; committing it is fine', () => {
  const projectRoot = project();
  const roleDir = project();
  const builder = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/builder' });
  const cos = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
  const lane = (policy, toolName, toolInput) => decideLane({ toolName, toolInput, policy, roleDir, groups: GROUPS, pluginRoot: PLUGIN_ROOT, cwd: projectRoot, projectRoot });
  const file = path.join(projectRoot, '.delivery', 'goal.json');
  assert.equal(lane(builder, 'Write', { file_path: file }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'echo {} > .delivery/goal.json' }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: `sed -i s/30/90/ ${file}` }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'git checkout -- .delivery/goal.json' }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'git add .delivery/goal.json' }).allow, true);
  assert.equal(lane(builder, 'Bash', { command: 'cat .delivery/goal.json' }).allow, true);
  const script = path.join(PLUGIN_ROOT, 'scripts', 'goal.js');
  assert.equal(lane(cos, 'Bash', { command: `node ${script} set budget.usage_envelope 30 --record dec-chief-of-staff-7` }).allow, true);
  assert.equal(lane(cos, 'Bash', { command: `node ${script} show` }).allow, true);
});
