// hooks/scripts/leak.test.js — run with: node --test hooks/scripts/leak.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, scanPushed } = require('./leak.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
const product = path.join(roleDir, 'product');
fs.mkdirSync(product, { recursive: true });
const denylist = ['Sell duplicates faster', 'Casual Carl', 'Phase 2: Beads over Dolt'];

test('loadDenylist reads lines and tolerates a missing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  assert.deepEqual(loadDenylist(root), []);
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'denylist.txt'), 'A b c\n\n D e f \n');
  assert.deepEqual(loadDenylist(root), ['A b c', 'D e f']);
});

test('extractMessages pulls commit and PR text', () => {
  assert.deepEqual(extractMessages('git commit -m "fix login" -m "Refs ex-1"'), ['fix login', 'Refs ex-1']);
  assert.deepEqual(extractMessages('gh pr create --title "Login fix" --body "Refs ex-1"'), ['Login fix', 'Refs ex-1']);
  assert.deepEqual(extractMessages('git commit -F msg.txt'), ['<file: msg.txt>']);
  assert.deepEqual(extractMessages('git status'), []);
  assert.deepEqual(extractMessages('gh pr create --title="x y" --body-file b.md'), ['x y', '<file: b.md>']);
});

test('scanText is a case-insensitive literal match and catches .delivery paths', () => {
  assert.deepEqual(scanText('we sell DUPLICATES faster now', denylist), { phrase: 'Sell duplicates faster' });
  assert.equal(scanText('fix login (Refs ex-1)', denylist), null);
  assert.deepEqual(scanText('see .delivery/stories/x.md', denylist), { phrase: '.delivery/' });
  assert.equal(scanText('phase 2: beads over dolt', ['Phase 2: Beads over Dolt']).phrase, 'Phase 2: Beads over Dolt');
  assert.equal(scanText('anything', ['.*']), null);
});

test('decideLeak acts only in the product worktree', () => {
  const bad = { toolName: 'Bash', toolInput: { command: 'git commit -m "Sell duplicates faster"' }, roleDir, denylist };
  assert.equal(decideLeak({ ...bad, cwd: path.join(roleDir, 'project') }), null);
  const d = decideLeak({ ...bad, cwd: product });
  assert.match(d.reason, /Sell duplicates faster/);
  assert.match(d.reason, /Refs <bead id>/);
  assert.equal(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -m "fix login" -m "Refs ex-1"' }, cwd: product, roleDir, denylist }), null);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'gh issue create --title x' }, cwd: product, roleDir, denylist }).reason, /for users/);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -F m.txt' }, cwd: product, roleDir, denylist }).reason, /inline/);
  assert.match(decideLeak({ toolName: 'Write', toolInput: { file_path: '.delivery/team/team.json' }, cwd: product, roleDir, denylist }).reason, /\.delivery/);
  assert.equal(decideLeak({ toolName: 'Write', toolInput: { file_path: 'src/a.js' }, cwd: product, roleDir, denylist }), null);
});

test('scanPushed scans the pushed range', () => {
  const git = (args) => (args.includes('@{upstream}..HEAD') ? 'fix login\n\nRefs ex-1\n\nCasual Carl wants this\n' : '');
  assert.deepEqual(scanPushed({ cwd: product, roleDir, denylist, git }), ['Casual Carl']);
  assert.deepEqual(scanPushed({ cwd: path.join(roleDir, 'project'), roleDir, denylist, git }), []);
});

// ---- subprocess test ----
const PLUGIN_ROOT = path.join(__dirname, '..', '..');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'team', 'denylist.txt'), 'Casual Carl\n');
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-team-'));
  const { roleDir: rd } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir: rd };
}

function runHook(script, input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('leak-guard hook denies a leaking commit from product and is silent from project', () => {
  const b = preparedRole('builder-1');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const input = (cwd) => ({ cwd, session_id: 's', tool_name: 'Bash', tool_input: { command: 'git commit -m "for Casual Carl"' } });
  const json = JSON.parse(runHook('leak-guard.js', input(path.join(b.roleDir, 'product')), env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /Casual Carl/);
  assert.equal(runHook('leak-guard.js', input(path.join(b.roleDir, 'project')), env), '');
});
