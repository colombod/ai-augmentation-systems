// hooks/scripts/ask-guard.test.js — run with: node --test hooks/scripts/ask-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { decideAsk, REASON, CHANNEL_REASON } = require('./ask-guard.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

function runHook(input, instance) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  delete env.DELIVERY_ROLE_DIR;
  if (instance) env.DELIVERY_ROLE = instance; else delete env.DELIVERY_ROLE;
  return spawnSync(process.execPath, [path.join(__dirname, 'ask-guard.js')], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8' });
}

const ask = (cwd) => ({ cwd, session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'A or B?' }] } });

test('denies AskUserQuestion for builder, delivery-lead and progress-observer with the exact reason', () => {
  for (const instance of ['builder-1', 'delivery-lead', 'progress-observer']) {
    const { roleDir } = preparedRole(instance);
    const r = runHook(ask(roleDir), instance);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } }, instance);
  }
  assert.equal(REASON, `You do not address the operator. Message the Chief of Staff with the one question (SendMessage to the chief-of-staff session); the answer comes back to you as a decision record id you verify with \`node ${path.join(__dirname, '..', '..', 'scripts', 'operator.js')} verify <id>\`.`);
});

test('allows the chief of staff and the product manager', () => {
  for (const instance of ['chief-of-staff', 'product-manager']) {
    const { roleDir } = preparedRole(instance);
    const r = runHook(ask(roleDir), instance);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', instance);
  }
});

test('inert without a marker, with a marker of another session, with an unloadable manifest, or for another tool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-none-'));
  assert.equal(runHook(ask(dir), undefined).stdout, '');
  const { projectRoot, roleDir } = preparedRole('builder-2');
  assert.equal(runHook(ask(roleDir), 'someone-else').stdout, '', 'the marker belongs to another session');
  assert.equal(runHook({ ...ask(roleDir), tool_name: 'Bash' }, 'builder-2').stdout, '');
  const garbage = runHook('not json', 'builder-2');
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
  fs.rmSync(path.join(projectRoot, '.delivery', 'team', 'team.json'));
  const r = runHook(ask(roleDir), 'builder-2');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'a manifest that does not load leaves the guard inert');
  assert.equal(decideAsk(null), null);
  assert.equal(decideAsk({}), null);
});

test('PushNotification and SendUserFile are operator channels too: denied for workers, allowed for the askers', () => {
  assert.equal(CHANNEL_REASON, 'You do not address the operator. Message the Chief of Staff; the Chief of Staff decides what reaches the operator.');
  for (const instance of ['builder-1', 'spike-researcher', 'delivery-lead', 'staffing', 'progress-observer']) {
    const { roleDir } = preparedRole(instance);
    for (const tool of ['PushNotification', 'SendUserFile']) {
      const out = JSON.parse(runHook({ ...ask(roleDir), tool_name: tool, tool_input: {} }, instance).stdout);
      assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', `${instance} ${tool}`);
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, CHANNEL_REASON);
    }
  }
  for (const instance of ['chief-of-staff', 'product-manager']) {
    const { roleDir } = preparedRole(instance);
    for (const tool of ['PushNotification', 'SendUserFile']) assert.equal(runHook({ ...ask(roleDir), tool_name: tool, tool_input: {} }, instance).stdout, '', `${instance} ${tool}`);
  }
  assert.equal(decideAsk({ tool_name: 'constructor' }), null, 'only the named tools are channels');
});

test('hooks.json routes the operator channels, and only them, to the guard', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entry = hooks.PreToolUse.find((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith('ask-guard.js'))));
  assert.ok(entry, 'ask-guard.js is wired');
  const re = new RegExp(`^(?:${entry.matcher})$`);
  for (const tool of ['AskUserQuestion', 'PushNotification', 'SendUserFile']) assert.ok(re.test(tool), tool);
  assert.ok(!re.test('Bash'));
  assert.ok(!re.test('SendMessage'));
});
