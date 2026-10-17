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
  captureActionFrom,
  isGovernedToolCall,
  buildRecord,
  recordInvocation,
} = require('./record-invocation.js');

// the ledger is opt-in (A3); these tests exercise it switched on unless they say otherwise
process.env.DELIVERY_LEDGER = '1';

function makeScratchProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'record-invocation-test-'));
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

test('findDeliveryRoot: upward search still wins over downward when both exist', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  fs.mkdirSync(path.join(root, 'sub', 'nested', '.delivery'), { recursive: true });
  const startDir = path.join(root, 'sub');
  fs.mkdirSync(startDir, { recursive: true });
  // From root/sub: root/.delivery is above (upward), root/sub/nested/.delivery is below.
  // Upward should win — it's the "reuse the enclosing one" case, cheaper and less ambiguous.
  assert.equal(findDeliveryRoot(startDir), path.join(root, '.delivery'));
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

// --- harden-03: capture-tool discrimination ---
// Discriminator sourced from each tool's own schema (see CAPTURE_TOOL_ACTIONS'
// comment) — headless sessions confirmed to have no access to these tools,
// so these test the logic against the tools' documented contracts, not a
// live capture.

test('captureActionFrom: recognizes a real screenshot action on the browser tool', () => {
  assert.equal(
    captureActionFrom('mcp__Claude_Browser__computer', { action: 'screenshot', tabId: 'tab-2' }),
    'screenshot'
  );
});

test('captureActionFrom: recognizes zoom as a capture action on the browser tool', () => {
  assert.equal(
    captureActionFrom('mcp__Claude_Browser__computer', { action: 'zoom', region: [0, 0, 100, 100] }),
    'zoom'
  );
});

test('captureActionFrom: a non-capture action on the same tool is not a capture', () => {
  assert.equal(
    captureActionFrom('mcp__Claude_Browser__computer', { action: 'left_click', coordinate: [10, 10] }),
    null
  );
  assert.equal(
    captureActionFrom('mcp__Claude_Browser__computer', { action: 'scroll', scroll_direction: 'down' }),
    null
  );
});

test('captureActionFrom: recognizes a real screenshot action on the simulator tool', () => {
  assert.equal(
    captureActionFrom('mcp__Claude_Code_iOS_Simulator__control', { action: 'screenshot' }),
    'screenshot'
  );
});

test('captureActionFrom: a non-capture action on the simulator tool is not a capture', () => {
  assert.equal(
    captureActionFrom('mcp__Claude_Code_iOS_Simulator__control', { action: 'tap', x: 10, y: 10 }),
    null
  );
});

test('captureActionFrom: an unrelated tool is never a capture', () => {
  assert.equal(captureActionFrom('Bash', { command: 'ls' }), null);
  assert.equal(captureActionFrom('Read', { file_path: '/x' }), null);
});

test('isGovernedToolCall: true for Skill, Agent, and known capture tools; false otherwise', () => {
  assert.equal(isGovernedToolCall('Skill'), true);
  assert.equal(isGovernedToolCall('Agent'), true);
  assert.equal(isGovernedToolCall('mcp__Claude_Browser__computer'), true);
  assert.equal(isGovernedToolCall('mcp__Claude_Code_iOS_Simulator__control'), true);
  assert.equal(isGovernedToolCall('Bash'), false);
  assert.equal(isGovernedToolCall('Read'), false);
});

test('buildRecord: sets capture_action for a real screenshot call', () => {
  const record = buildRecord({
    session_id: 's1',
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__Claude_Browser__computer',
    tool_input: { action: 'screenshot', tabId: 'tab-2' },
    cwd: '/proj',
  });
  assert.equal(record.capture_action, 'screenshot');
  assert.equal(record.tool_name, 'mcp__Claude_Browser__computer');
});

test('buildRecord: capture_action is null for a non-capture action, even on a capture-capable tool', () => {
  const record = buildRecord({
    session_id: 's1',
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__Claude_Browser__computer',
    tool_input: { action: 'left_click', coordinate: [1, 1] },
    cwd: '/proj',
  });
  assert.equal(record.capture_action, null);
});

test('recordInvocation: a real screenshot call is recorded, given a reachable .delivery/', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const result = recordInvocation(
    {
      session_id: 'sess-capture',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__Claude_Browser__computer',
      tool_input: { action: 'screenshot', tabId: 'tab-2' },
      cwd: root,
    },
    { cwd: root }
  );
  assert.ok(result);
  const parsed = JSON.parse(fs.readFileSync(result.ledgerPath, 'utf8').trim());
  assert.equal(parsed.capture_action, 'screenshot');
});

test('recordInvocation: a non-capture action on the browser tool is not recorded', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const result = recordInvocation(
    {
      session_id: 'sess-click',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__Claude_Browser__computer',
      tool_input: { action: 'left_click', coordinate: [1, 1] },
      cwd: root,
    },
    { cwd: root }
  );
  assert.equal(result, null);
  assert.equal(fs.existsSync(path.join(root, '.delivery', 'invocations')), false);
});

// --- gy5.2: observer silence made visible ---------------------------------
// The 2026-08-10..14 blackout (context-management initiative, gy5.1): a whole
// pipeline ran from an ambiguous cwd, every governed call hit the decline
// branch, and the decline wrote NOTHING — silence indistinguishable from
// idleness, and the session-continuity tiebreaker could never engage because
// it requires the very ledger file the decline prevents (bootstrap dead-end).
// These tests pin the fix: ambiguity is recorded, not swallowed.

test('recordInvocation: zero candidates anywhere is still a no-op (nothing governed here)', () => {
  const root = makeScratchProject();
  const result = recordInvocation(
    { session_id: 'sess-nowhere', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief' } },
    { cwd: root }
  );
  assert.equal(result, null);
});

// --- gy5.3: per-artifact-version provenance via observed artifact writes ---
// The Skill/Agent lines prove a phase ran; they cannot say which artifact
// version it produced. Write/Edit calls into a .delivery/ tree can: the
// artifact's own path picks its root (no cwd ambiguity by construction), and
// a content hash of the file after the write binds the line to a version.

const crypto = require('node:crypto');

test('recordInvocation: a Write into a .delivery tree records an artifact_write with relative path and content hash', () => {
  const root = makeScratchProject();
  const dRoot = path.join(root, 'plugins', 'a', '.delivery');
  const artifact = path.join(dRoot, 'initiatives', 'x', 'brief.md');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, 'brief body\n');

  const result = recordInvocation(
    { session_id: 'sess-aw', hook_event_name: 'PostToolUse', tool_name: 'Write',
      tool_input: { file_path: artifact, content: 'SECRET raw input must not be stored' } },
    { cwd: path.join(root, 'plugins', 'a') } // a session inside the project; the artifact path picks the root
  );

  assert.ok(result && result.ledgerPath.includes(path.join('plugins', 'a', '.delivery', 'invocations')));
  const line = JSON.parse(fs.readFileSync(result.ledgerPath, 'utf8').trim().split('\n').pop());
  assert.equal(line.record_type, 'artifact_write');
  assert.equal(line.artifact, path.join('initiatives', 'x', 'brief.md'));
  assert.equal(line.content_hash, crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'));
  assert.ok(!JSON.stringify(line).includes('SECRET'), 'raw tool_input must never be stored');
});

test('recordInvocation: an Edit to the same artifact appends a second line with the new hash — provenance follows versions', () => {
  const root = makeScratchProject();
  const dRoot = path.join(root, '.delivery');
  const artifact = path.join(dRoot, 'prd.md');
  fs.mkdirSync(dRoot, { recursive: true });

  fs.writeFileSync(artifact, 'v1\n');
  recordInvocation({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: artifact } }, { cwd: root });
  fs.writeFileSync(artifact, 'v2\n');
  recordInvocation({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: artifact } }, { cwd: root });

  const lines = fs.readFileSync(path.join(dRoot, 'invocations', 's.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.notEqual(lines[0].content_hash, lines[1].content_hash);
  assert.equal(lines[1].content_hash, crypto.createHash('sha256').update('v2\n').digest('hex'));
});

test('recordInvocation: writes outside any .delivery tree, into invocations/ itself, or failed writes record nothing', () => {
  const root = makeScratchProject();
  const dRoot = path.join(root, '.delivery');
  fs.mkdirSync(path.join(dRoot, 'invocations'), { recursive: true });
  const outside = path.join(root, 'src', 'index.js');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, 'code');
  const ledgerFile = path.join(dRoot, 'invocations', 'other.ndjson');
  fs.writeFileSync(ledgerFile, '');
  const artifact = path.join(dRoot, 'brief.md');
  fs.writeFileSync(artifact, 'x');

  assert.equal(recordInvocation({ session_id: 's2', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: outside } }, { cwd: root }), null);
  assert.equal(recordInvocation({ session_id: 's2', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: ledgerFile } }, { cwd: root }), null);
  assert.equal(recordInvocation({ session_id: 's2', hook_event_name: 'PostToolUseFailure', tool_name: 'Write', tool_input: { file_path: artifact }, error_message: 'boom' }, { cwd: root }), null);
  assert.ok(!fs.existsSync(path.join(dRoot, 'invocations', 's2.ndjson')));
});

// --- gating (hook hardening c) ---------------------------------------------
test('gating: a non-role session under a directory with no .delivery/ writes nothing and returns fast, even with projects below it', () => {
  const root = makeScratchProject();
  // projects below the cwd used to be found by a downward search and written to as "ambiguous"
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });
  for (let i = 0; i < 300; i++) fs.mkdirSync(path.join(root, 'deep', String(i), 'x', 'y'), { recursive: true });
  const prev = process.env.DELIVERY_ROLE;
  delete process.env.DELIVERY_ROLE;
  try {
    const t0 = Date.now();
    const r = recordInvocation({ session_id: 'sess-plain', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief' } }, { cwd: root });
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 200, 'no directory walk below the cwd');
    // nor does an artifact write into a project the session is not working in
    const artifact = path.join(root, 'plugins', 'a', '.delivery', 'brief.md');
    fs.writeFileSync(artifact, 'x\n');
    assert.equal(recordInvocation({ session_id: 'sess-plain', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: artifact } }, { cwd: root }), null);
    for (const p of ['a', 'b']) assert.ok(!fs.existsSync(path.join(root, 'plugins', p, '.delivery', 'invocations')), p);
  } finally { if (prev === undefined) delete process.env.DELIVERY_ROLE; else process.env.DELIVERY_ROLE = prev; }
});

test('gating: a session inside a project with .delivery/ still records; a role session outside its tree records into its project', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const r = recordInvocation({ session_id: 'sess-in', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } }, { cwd: path.join(root) });
  assert.ok(r && r.ledgerPath.startsWith(path.join(root, '.delivery', 'invocations')));
  const elsewhere = makeScratchProject();
  const prev = { role: process.env.DELIVERY_ROLE, pr: process.env.DELIVERY_PROJECT_ROOT };
  process.env.DELIVERY_ROLE = 'builder-1';
  process.env.DELIVERY_PROJECT_ROOT = root;
  try {
    const r2 = recordInvocation({ session_id: 'sess-role', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'delivery:feature-critic' } }, { cwd: elsewhere });
    assert.ok(r2 && r2.ledgerPath.startsWith(path.join(root, '.delivery', 'invocations')));
  } finally {
    for (const [k, v] of [['DELIVERY_ROLE', prev.role], ['DELIVERY_PROJECT_ROOT', prev.pr]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('A3: the ledger is opt-in: without DELIVERY_LEDGER=1 nothing is recorded, even inside a project or as a role', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, '.delivery'));
  const prev = { l: process.env.DELIVERY_LEDGER, r: process.env.DELIVERY_ROLE };
  try {
    for (const v of [undefined, '0', 'true']) {
      if (v === undefined) delete process.env.DELIVERY_LEDGER; else process.env.DELIVERY_LEDGER = v;
      process.env.DELIVERY_ROLE = 'builder-1';
      assert.equal(recordInvocation({ session_id: 'off', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } }, { cwd: root }), null, String(v));
    }
    assert.ok(!fs.existsSync(path.join(root, '.delivery', 'invocations')));
    process.env.DELIVERY_LEDGER = '1';
    assert.ok(recordInvocation({ session_id: 'on', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } }, { cwd: root }));
  } finally {
    for (const [k, v] of [['DELIVERY_LEDGER', prev.l], ['DELIVERY_ROLE', prev.r]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
