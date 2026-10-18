// hooks/scripts/hooks-matchers.test.js — every tool matcher in hooks.json covers exactly the tools it
// is meant for. Evaluated with unanchored RegExp.test, the loosest reading a harness could apply, so
// an unanchored "Write" would match TodoWrite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks.json'), 'utf8')).hooks;
const matcherFor = (event, script) => {
  const e = hooks[event].find((x) => x.hooks.some((h) => (h.args || []).some((a) => a.endsWith(script))));
  return new RegExp(e.matcher);
};
const NEVER = ['TodoWrite', 'WebFetch', 'Read', 'Glob', 'Grep', 'BashOutput', 'KillShell', 'ExitPlanMode', 'NotebookRead', 'Task', 'SkillX', 'MyBash', 'EditX'];

test('lane: exactly the write and shell tools, and every MCP tool', () => {
  const m = matcherFor('PreToolUse', 'role-lane.js');
  for (const t of ['Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'Bash', 'Monitor', 'PowerShell', 'mcp__github__create_issue', 'mcp__ccd_session_mgmt__send_message']) assert.ok(m.test(t), t);
  for (const t of [...NEVER, 'xmcp__foo']) assert.ok(!m.test(t), t);
});

test('leak guard: write and shell tools, and git-hosting MCP tools only', () => {
  const m = matcherFor('PreToolUse', 'leak-guard.js');
  for (const t of ['Write', 'Bash', 'PowerShell', 'mcp__github__create_pull_request', 'mcp__gitlab__create_issue']) assert.ok(m.test(t), t);
  for (const t of [...NEVER, 'mcp__slack__post_message', 'mcp__ccd_session_mgmt__send_message']) assert.ok(!m.test(t), t);
});

test('bd guard, operator channel guard and invocation recorder match their exact tools', () => {
  const bd = matcherFor('PreToolUse', 'bd-guard-hook.js');
  for (const t of ['Bash', 'Monitor', 'PowerShell']) assert.ok(bd.test(t), t);
  for (const t of [...NEVER, 'Write']) assert.ok(!bd.test(t), t);
  const ask = matcherFor('PreToolUse', 'ask-guard.js');
  for (const t of ['AskUserQuestion', 'PushNotification', 'SendUserFile']) assert.ok(ask.test(t), t);
  for (const t of [...NEVER, 'AskUserQuestions', 'MySendUserFile']) assert.ok(!ask.test(t), t);
  // the post-push re-scan was removed (A2): the durable control is a push-side scan in CI
  assert.ok(!JSON.stringify(hooks).includes('leak-post-push'));
  for (const ev of ['PostToolUse', 'PostToolUseFailure']) {
    // PostToolUse has two recorder entries (artifact writes synchronous, the rest async)
    const entries = hooks[ev].filter((x) => x.hooks.some((y) => (y.args || []).some((a) => a.endsWith('record-invocation.js'))));
    const rec = { test: (t) => entries.some((x) => new RegExp(x.matcher).test(t)) };
    for (const t of ['Skill', 'Agent', 'Write', 'Edit', 'NotebookEdit', 'mcp__Claude_Browser__computer']) assert.ok(rec.test(t), t);
    for (const t of NEVER) assert.ok(!rec.test(t), t);
    for (const e of entries) assert.equal(e.hooks[0].timeout, 5);
    if (ev === 'PostToolUseFailure') assert.equal(entries[0].hooks[0].async, true);
  }
});

test('Copilot: a successful write is recorded synchronously, so the hash is of the version the tool wrote', () => {
  const entries = hooks.PostToolUse.filter((x) => x.hooks.some((y) => (y.args || []).some((a) => a.endsWith('record-invocation.js'))));
  for (const t of ['Write', 'Edit', 'NotebookEdit']) {
    const e = entries.filter((x) => new RegExp(x.matcher).test(t));
    assert.equal(e.length, 1, t);
    assert.notEqual(e[0].hooks[0].async, true, t);
  }
  for (const t of ['Skill', 'Agent']) assert.equal(entries.find((x) => new RegExp(x.matcher).test(t)).hooks[0].async, true, t);
});
