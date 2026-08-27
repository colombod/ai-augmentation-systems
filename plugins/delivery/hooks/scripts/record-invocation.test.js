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

// This exact test would have passed against the original (upward-only)
// implementation while the real hook silently failed against this actual
// repo — that gap was found only by running the real script against the
// real repo, not by any unit test. It's added here so it can never happen
// silently again.
test('findDeliveryRoot: finds .delivery/ in a marketplace-style subdirectory below cwd', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'delivery', '.delivery'), { recursive: true });
  assert.equal(
    findDeliveryRoot(root),
    path.join(root, 'plugins', 'delivery', '.delivery')
  );
});

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

test('findDeliveryRoot: multiple .delivery/ found downward is ambiguous — declines rather than guessing', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });
  assert.equal(findDeliveryRoot(root), null);
});

test('recordInvocation: an ambiguous downward search still resolves for a session with an established ledger in one candidate', () => {
  // Reproduces a real gap found live in the chief-of-staff epic's own spike: this repo is a
  // multi-plugin monorepo (plugins/delivery/.delivery + plugins/attractor/.delivery, added
  // after harden-02's own 21/21 verification ran, never re-tested against this shape). A
  // session's first call can land with an unambiguous cwd and write successfully, then a
  // LATER call in the exact same session arrives with an ambiguous cwd (e.g. a background
  // subagent dispatch resolving to the repo root) and, before this fix, silently no-ops —
  // even though the session already proved which root it belongs to.
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });

  const first = recordInvocation(
    { session_id: 'sess-continuity', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } },
    { cwd: path.join(root, 'plugins', 'a') }
  );
  assert.ok(first);
  assert.equal(first.ledgerPath, path.join(root, 'plugins', 'a', '.delivery', 'invocations', 'sess-continuity.ndjson'));

  const second = recordInvocation(
    { session_id: 'sess-continuity', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'delivery:chief-of-staff' } },
    { cwd: root }
  );
  assert.ok(second, 'second call should not silently no-op — session already has an established ledger root');
  assert.equal(second.ledgerPath, path.join(root, 'plugins', 'a', '.delivery', 'invocations', 'sess-continuity.ndjson'));

  const lines = fs.readFileSync(second.ledgerPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
});

test('recordInvocation: a genuinely new session with an ambiguous cwd still declines to ATTRIBUTE — but records the ambiguity instead of vanishing (gy5.2)', () => {
  // Contract changed deliberately after the 08-10..14 blackout: the old
  // behavior here was `assert.equal(result, null)` — a silent no-op, which is
  // exactly what made a dead observer indistinguishable from an idle session.
  // The "no false positive" half of the old test still binds: no candidate may
  // receive an ATTRIBUTED line. The record itself must exist, marked ambiguous.
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });

  const result = recordInvocation(
    { session_id: 'sess-brand-new', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } },
    { cwd: root }
  );
  assert.ok(result && result.ledgerPaths.length === 2);
  assert.equal(result.record.attribution, 'ambiguous');
  for (const p of ['a', 'b']) {
    const lines = fs
      .readFileSync(path.join(root, 'plugins', p, '.delivery', 'invocations', 'sess-brand-new.ndjson'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.ok(lines.every((l) => l.attribution === 'ambiguous'), `candidate ${p} must hold no attributed line`);
  }
});

test('findDeliveryRoot: downward search skips node_modules', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'node_modules', 'some-pkg', '.delivery'), { recursive: true });
  assert.equal(findDeliveryRoot(root), null);
});

test('findDeliveryRoot: downward search respects a bounded depth', () => {
  const root = makeScratchProject();
  // 6 levels deep — beyond DOWNWARD_SEARCH_MAX_DEPTH (4)
  fs.mkdirSync(path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', '.delivery'), { recursive: true });
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

test('recordInvocation: ambiguous with no established ledger writes an ambiguous record to EVERY candidate', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });

  const result = recordInvocation(
    { session_id: 'sess-blackout', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief', secret: 'must-not-leak' } },
    { cwd: root }
  );

  assert.ok(result, 'ambiguity must not be a silent no-op');
  for (const p of ['a', 'b']) {
    const ledger = path.join(root, 'plugins', p, '.delivery', 'invocations', 'sess-blackout.ndjson');
    assert.ok(fs.existsSync(ledger), `candidate ${p} must carry the ambiguous record`);
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].attribution, 'ambiguous');
    assert.equal(lines[0].invoked_name, 'delivery:brief');
    assert.equal(lines[0].candidates.length, 2);
    assert.ok(!JSON.stringify(lines[0]).includes('must-not-leak'), 'whitelist must hold for ambiguous records');
  }
});

test('recordInvocation: ambiguous records do not satisfy the continuity tiebreaker — next ambiguous call stays ambiguous', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });

  recordInvocation(
    { session_id: 'sess-two-amb', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief' } },
    { cwd: root }
  );
  recordInvocation(
    { session_id: 'sess-two-amb', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:research' } },
    { cwd: root }
  );

  for (const p of ['a', 'b']) {
    const ledger = path.join(root, 'plugins', p, '.delivery', 'invocations', 'sess-two-amb.ndjson');
    const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 2, `both ambiguous calls must appear in candidate ${p}`);
    assert.ok(lines.every((l) => l.attribution === 'ambiguous'));
  }
});

test('recordInvocation: an attributed line later in the session upgrades the tiebreaker — subsequent ambiguous cwd resolves to that root', () => {
  const root = makeScratchProject();
  fs.mkdirSync(path.join(root, 'plugins', 'a', '.delivery'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'b', '.delivery'), { recursive: true });

  // 1. bootstrap: first call ambiguous (previously the permanent dead end)
  recordInvocation(
    { session_id: 'sess-upgrade', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief' } },
    { cwd: root }
  );
  // 2. session moves into candidate a and writes an attributed line
  const attributed = recordInvocation(
    { session_id: 'sess-upgrade', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:prd' } },
    { cwd: path.join(root, 'plugins', 'a') }
  );
  assert.ok(attributed.record.attribution === undefined || attributed.record.attribution !== 'ambiguous');
  // 3. back at the ambiguous cwd: continuity must now resolve to a, attributed
  const third = recordInvocation(
    { session_id: 'sess-upgrade', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:architecture' } },
    { cwd: root }
  );
  assert.ok(third.ledgerPath, 'third call must resolve, not stay ambiguous');
  assert.ok(third.ledgerPath.includes(path.join('plugins', 'a', '.delivery')));
  const aLines = fs.readFileSync(path.join(root, 'plugins', 'a', '.delivery', 'invocations', 'sess-upgrade.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(aLines.filter((l) => l.attribution !== 'ambiguous').length, 2, 'prd + architecture attributed to a');
  const bLines = fs.readFileSync(path.join(root, 'plugins', 'b', '.delivery', 'invocations', 'sess-upgrade.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(bLines.every((l) => l.attribution === 'ambiguous'), 'b must never receive an attributed line');
});

test('recordInvocation: zero candidates anywhere is still a no-op (nothing governed here)', () => {
  const root = makeScratchProject();
  const result = recordInvocation(
    { session_id: 'sess-nowhere', hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'delivery:brief' } },
    { cwd: root }
  );
  assert.equal(result, null);
});
