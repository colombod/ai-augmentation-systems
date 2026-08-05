// Unit tests for record-invocation.js's own logic — field whitelisting, NDJSON
// formatting, .delivery/ resolution. Does NOT test hook firing reliability or
// timing; that is an empirical spike (harden-02), not something a unit test
// can substitute for. Run with: node --test hooks/scripts/record-invocation.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findDeliveryRoot,
  invokedNameFrom,
  buildRecord,
  recordInvocation,
} = require('./record-invocation.js');

function makeScratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-invocation-test-'));
  return root;
}

test('findDeliveryRoot: finds .delivery/ in the starting directory', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  assert.equal(findDeliveryRoot(root), path.join(root, '.delivery'));
});

test('findDeliveryRoot: finds .delivery/ by walking upward from a subdirectory', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findDeliveryRoot(nested), path.join(root, '.delivery'));
});

test('findDeliveryRoot: returns null when no .delivery/ exists anywhere reachable', () => {
  const root = makeScratchProject();
  assert.equal(findDeliveryRoot(root), null);
});

test('invokedNameFrom: extracts skill name from a Skill tool_input', () => {
  assert.equal(
    invokedNameFrom('Skill', { skill: 'delivery:prd', args: 'x' }),
    'delivery:prd'
  );
});

test('invokedNameFrom: extracts subagent_type from an Agent tool_input', () => {
  assert.equal(
    invokedNameFrom('Agent', { subagent_type: 'delivery:product-owner' }),
    'delivery:product-owner'
  );
});

test('invokedNameFrom: returns null for an unrelated tool', () => {
  assert.equal(invokedNameFrom('Bash', { command: 'ls' }), null);
});

test('buildRecord: PostToolUse maps to outcome "success"', () => {
  const record = buildRecord({
    session_id: 's1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill: 'delivery:brief' },
    tool_use_id: 'toolu_1',
    cwd: '/proj',
  });
  assert.equal(record.outcome, 'success');
  assert.equal(record.invoked_name, 'delivery:brief');
  assert.equal(record.session_id, 's1');
  assert.ok(record.ts);
});

test('buildRecord: PostToolUseFailure maps to outcome "error"', () => {
  const record = buildRecord({
    session_id: 's1',
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Skill',
    tool_input: { skill: 'delivery:prd' },
    cwd: '/proj',
  });
  assert.equal(record.outcome, 'error');
});

test('buildRecord: never includes raw tool_input on the record — whitelist enforced', () => {
  const record = buildRecord({
    session_id: 's1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill: 'delivery:brief', secret_looking_field: 'sk-should-not-appear' },
    cwd: '/proj',
  });
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('secret_looking_field'));
  assert.ok(!serialized.includes('sk-should-not-appear'));
});

test('recordInvocation: no-ops (returns null) when no .delivery/ is reachable', () => {
  const root = makeScratchProject();
  const result = recordInvocation(
    { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'x' } },
    { cwd: root }
  );
  assert.equal(result, null);
});

test('recordInvocation: ignores non-Skill/Agent tool calls entirely', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const result = recordInvocation(
    { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    { cwd: root }
  );
  assert.equal(result, null);
  assert.equal(fs.existsSync(path.join(root, '.delivery', 'invocations')), false);
});

test('recordInvocation: appends one NDJSON line to the session ledger', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const result = recordInvocation(
    {
      session_id: 'sess-abc',
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'delivery:research' },
      cwd: root,
    },
    { cwd: root }
  );
  assert.ok(result);
  const contents = fs.readFileSync(result.ledgerPath, 'utf8').trim().split('\n');
  assert.equal(contents.length, 1);
  const parsed = JSON.parse(contents[0]);
  assert.equal(parsed.invoked_name, 'delivery:research');
});

test('recordInvocation: a retry appends a second distinct line, does not overwrite the first', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const payload = {
    session_id: 'sess-retry',
    tool_name: 'Skill',
    tool_input: { skill: 'delivery:prd' },
    cwd: root,
  };
  recordInvocation({ ...payload, hook_event_name: 'PostToolUseFailure' }, { cwd: root });
  recordInvocation({ ...payload, hook_event_name: 'PostToolUse' }, { cwd: root });

  const ledgerPath = path.join(root, '.delivery', 'invocations', 'sess-retry.ndjson');
  const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).outcome, 'error');
  assert.equal(JSON.parse(lines[1]).outcome, 'success');
});

test('main(): a malformed/empty stdin payload does not throw and exits cleanly', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'record-invocation.js');
  // Deliberately broken JSON on stdin.
  const result = execFileSync('node', [scriptPath], {
    input: '{not valid json',
    encoding: 'utf8',
  });
  assert.equal(result, ''); // no stdout expected, and critically: no throw
});

test('main(): empty stdin does not throw', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'record-invocation.js');
  const result = execFileSync('node', [scriptPath], { input: '', encoding: 'utf8' });
  assert.equal(result, '');
});
