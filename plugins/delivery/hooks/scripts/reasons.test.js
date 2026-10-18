// hooks/scripts/reasons.test.js — R-46: every hook's block or warning reason is at most two lines and
// its last line names the way out (an exact command, or the role to message). A check on the output
// format, not on the wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reasonProblems } = require('../../scripts/lib/short-reason.js');
const { decideLane, loadPolicy } = require('./lane.js');
const { REASON, CHANNEL_REASON } = require('./ask-guard.js');
const { decideLeak, UNANALYSABLE } = require('./leak.js');
const RG = require('./relay-guard.js');
const { decideStop } = require('./turn.js');
const { decideBd } = require('./bd-guard.js');
const M = require('./message-checks.js');
const goal = require('../../scripts/goal.js');
const oq = require('../../scripts/owner-queue.js');
const I = require('../../scripts/lib/idle.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'reasons-'));

function laneReasons() {
  const roleDir = tmp();
  const out = [];
  for (const role of ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'builder', 'spike-researcher']) {
    const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` });
    const d = (toolName, toolInput, over = {}) => decideLane({ toolName, toolInput, policy, roleDir, groups: GROUPS, pluginRoot: PLUGIN_ROOT, cwd: roleDir, projectRoot: roleDir, hostHeadless: false, ...over });
    for (const r of [
      d('Write', { file_path: '/etc/hosts' }),
      d('Bash', { command: 'npm test $(whoami)' }),
      d('PowerShell', { command: 'Get-ChildItem' }),
      d('mcp__docs__create_document', {}),
      d('Bash', { command: 'gh pr merge 7' }),
      d('Write', { file_path: path.join(roleDir, '.delivery', 'operator', 'x') }),
      d('Write', { file_path: path.join(roleDir, '.delivery', 'goal.json') }),
      d('mcp__Claude_Browser__navigate', {}, { hostHeadless: true, hostName: 'buildbox', desktopHosts: ['pc'] }),
    ]) if (r && !r.allow) out.push([`lane ${role}`, r.reason]);
  }
  return out;
}

function leakReasons() {
  const roleDir = tmp();
  const product = path.join(roleDir, 'product');
  fs.mkdirSync(product, { recursive: true });
  const denylist = ['Sell duplicates faster'];
  const d = (toolName, toolInput) => decideLeak({ toolName, toolInput, cwd: product, roleDir, denylist });
  return [
    d('Bash', { command: 'git commit -m "Sell duplicates faster"' }),
    d('Bash', { command: 'gh issue create --title x' }),
    d('Bash', { command: 'git commit -F m.txt' }),
    d('Bash', { command: 'git commit -m "$(cat m)"' }),
    d('Bash', { command: 'bash -c "git commit -m x"' }),
    d('Bash', { command: 'gh api -X POST repos/o/r/issues' }),
    d('Bash', { command: 'git commit -m "unbalanced' }),
    d('Write', { file_path: '.delivery/team/team.json' }),
  ].filter(Boolean).map((r) => ['leak', r.reason]).concat([['leak fail-closed', UNANALYSABLE]]);
}

function relayReasons() {
  const op = 'node /p/scripts/operator.js';
  return [
    RG.relayReason('', 'Please tell the builder session to use postgres'),
    RG.relayReason('dec-1', 'Please tell the builder session to use postgres', 'The typed judge rates this message p 0.90 as a relay request (advisory evidence).'),
    ...RG.relayCandidates('x', null, { p: 0.6, block_threshold: 0.8, warn_threshold: 0.5 }).map((c) => c.reason),
  ].map((r) => ['relay', r]).concat([op].map(() => ['ask', REASON]), [['ask', CHANNEL_REASON]]);
}

function stopReasons() {
  const roleDir = tmp();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const claim = decideStop({ input: {}, roleDir, actor: 'a', bd: { list: () => [{ id: 'ex-7', updated_at: '2020-01-01T00:00:00Z' }] } });
  const msg = M.messageFindings({ message: 'Please unlock it and tell me when it is unlocked.', role: 'chief-of-staff', judged: { orders_owner: { p: 0.9 }, block_threshold: 0.8 }, ordersMode: null });
  const idle = I.idleLine({ idle: true, ready: ['ex-1'], minutes: 45 });
  return [['claim note', `Reminder: ${claim.reason}`], ['orders', msg.candidates[0].reason], ['message reminder', M.reminderText(msg.warnings.concat([{ kind: 'jargon' }]))], ['idle', idle]];
}

function scriptReasons() {
  const root = tmp();
  const who = (roleId) => ({ root, roleId, instance: roleId });
  return [
    goal.main(['set', 'budget.usage_envelope', '30'], { who: who('chief-of-staff') }).out,
    goal.main(['set', 'budget.usage_envelope', '30', '--record', 'dec-x-1'], { who: who('chief-of-staff'), verifyRecord: () => ({ ok: false, code: 'not_found' }) }).out,
    goal.main(['pause', '--trigger', 'andon:a-1'], { who: who('delivery-lead') }).out,
    oq.main(['add', '--kind', 'signin', '--what', 'x', '--where', 'y', '--steps', 'z'], { who: who('builder') }).out,
    oq.main(['add', '--kind', 'verification', '--what', 'x', '--where', 'y', '--steps', 'z'], { who: who('chief-of-staff') }).out,
    oq.main(['add', '--kind', 'account', '--what', 'run the CSV drop and tell me what you see', '--where', 'y', '--steps', 'z'], { who: who('chief-of-staff') }).out,
    oq.main(['add', '--kind', 'signin', '--what', 'x', '--where', 'y'], { who: who('chief-of-staff') }).out,
    oq.main(['done', 'o-none-1'], { who: who('chief-of-staff') }).out,
    goal.main(['set', 'budget.usage_envelope', '30'], { who: who('builder') }).out,
    goal.main(['pause', '--trigger', 'andon:ev-x-1'], { who: who('builder') }).out,
    goal.main(['pause', '--trigger', 'andon:ev-x-1'], { who: who('delivery-lead'), bd: { show: () => ({ id: 'x', metadata: {} }) } }).out,
    RG.unrecordedReason([{ id: 'in-pc-000001', text: 'x'.repeat(200) }, { id: 'in-pc-000002' }], 'node /a/rather/long/plugin/cache/path/delivery/0.23.0/scripts/operator.js'),
    RG.integrityReason('chief-of-staff', { code: 'truncated', error: 'x'.repeat(200) }, 'node /p/scripts/operator.js', 'chief-of-staff'),
    RG.integrityReason('product-manager', { code: 'truncated', error: 'x' }, 'node /p/scripts/operator.js', 'product-manager'),
    RG.tornTailReason('chief-of-staff', { error: 'x' }, 'node /p/scripts/operator.js'),
  ].map((r) => ['script', r]);
}

function bdReasons() {
  const bd = { show: (id) => ({ id, status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: new Date().toISOString(), labels: [], metadata: {} }), list: () => [] };
  return ['bd update ex-1 --claim', 'bd dep add ex-1 --blocked-by ex-2', 'bd reopen ex-1']
    .map((command) => decideBd({ command, actor: 'me@pc/builder-1', roleId: 'builder', staleHours: 2, bd, now: new Date().toISOString() }))
    .filter(Boolean).map((r) => ['bd', r.reason]);
}

test('R-46: every hook and script reason is at most two lines and ends with the way out', () => {
  const all = [...laneReasons(), ...leakReasons(), ...relayReasons(), ...stopReasons(), ...scriptReasons(), ...bdReasons()];
  assert.ok(all.length >= 40, `collected ${all.length} reasons`);
  const bad = all.map(([where, r]) => [where, r, reasonProblems(r)]).filter(([, , p]) => p.length);
  assert.deepEqual(bad, []);
});

test('R-46: the rule itself flags a long refusal and one with no way out', () => {
  assert.deepEqual(reasonProblems('Refused.\nMessage the Delivery Manager.'), []);
  assert.deepEqual(reasonProblems('Refused because a, b and c.'), ['the last line names no command and no role to message']);
  assert.deepEqual(reasonProblems('a\nb\nRun `bd ready`.'), ['3 lines']);
  assert.deepEqual(reasonProblems(`${'x'.repeat(301)}\nRun \`bd ready\`.`), ['a line of 301 characters']);
});
