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
  const git = (args) => (args[0] === 'log' ? 'fix login\n\nRefs ex-1\n\nCasual   Carl\nwants this\n' : '');
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

// ---- probe table: [command | tool descriptor, cwd (relative to roleDir), expectDenied] ----
const P = 'Sell duplicates faster';
const probes = [
  [`cd product && git commit -m "${P}"`, '.', true],
  [`git -C product commit -m "${P}"`, '.', true],
  [`git -C ../product commit -m "${P}"`, 'project', true],
  [`git -C ../project commit -m "${P}"`, 'product', false],
  [`cd ../product; git commit -m "${P}"`, 'project', true],
  [`git commit -m "${P}"`, 'project', false],
  [`cd ../project && git commit -m "${P}"`, 'product', false],
  [`git commit -am "${P}"`, 'product', true],
  [`git commit -qm "${P}"`, 'product', true],
  [`git commit -m"${P}"`, 'product', true],
  [`git commit -m${P.replace(/ /g, '')}`, 'product', false],
  [`git commit -mCasualCarl`, 'product', false],
  [`git commit -m "ok" -m "casual   carl"`, 'product', true],
  [`git commit -m "Sell\nduplicates  faster"`, 'product', true],
  [`git commit -m "Sell\u00a0duplicates faster"`, 'product', true],
  [`git commit -m "see .Delivery/x"`, 'product', true],
  [`git commit -F m.txt`, 'product', true],
  [`git commit -qF m.txt`, 'product', true],
  [`git commit -t tpl.txt`, 'product', true],
  [`git commit --template=tpl.txt`, 'product', true],
  [`git commit --mess "${P}"`, 'product', true],
  [`git commit --message="${P}"`, 'product', true],
  [`git --no-pager -c user.name=x commit -m "${P}"`, 'product', true],
  [`git --git-dir=.git commit -m "${P}"`, 'product', true],
  [`/usr/bin/git commit -m "${P}"`, 'product', true],
  [`env GIT_AUTHOR_NAME=x git commit -m "${P}"`, 'product', true],
  [`FOO=1 command git commit -m "${P}"`, 'product', true],
  [`bash -c 'git commit -m x'`, 'product', true],
  [`sh -c "gh pr create --title x"`, 'product', true],
  [`bash -c 'ls'`, 'product', false],
  [`git merge feature -m "${P}"`, 'product', true],
  [`git merge feature -F m.txt`, 'product', true],
  [`git tag -a v1 -m "${P}"`, 'product', true],
  [`git notes add -m "${P}"`, 'product', true],
  [`gh pr create --title="${P}" --body ok`, 'product', true],
  [`gh -R org/repo pr create --body "${P}"`, 'product', true],
  [`gh --repo=org/repo pr comment 3 -b "${P}"`, 'product', true],
  [`gh pr merge 3 --subject "${P}"`, 'product', true],
  [`gh pr merge 3 -t "${P}"`, 'product', true],
  [`gh pr review 3 --body "${P}"`, 'product', true],
  [`gh pr close 3 -c "${P}"`, 'product', true],
  [`gh issue close 3 --comment "${P}"`, 'product', true],
  [`gh issue edit 3 -b "${P}"`, 'product', true],
  [`gh issue comment 3 --body-file b.md`, 'product', true],
  [`gh release create v1 --notes "${P}"`, 'product', true],
  [`gh release create v1 -n "${P}"`, 'product', true],
  [`gh release edit v1 --notes-file n.md`, 'product', true],
  [`gh pr create -t "fine" -b "Refs ex-1"`, 'product', false],
  [`gh api repos/o/r/issues/3/comments`, 'product', true],
  [`gh api -X POST repos/o/r/x`, 'product', true],
  [`gh api --method PATCH repos/o/r/x`, 'product', true],
  [`gh api -f body=x repos/o/r/x`, 'product', true],
  [`gh api --input b.json repos/o/r/x`, 'product', true],
  [`gh api repos/o/r/pulls`, 'product', false],
  [`gh issue create --title x`, 'product', true],
  [`git status && git log`, 'product', false],
  [{ tool: 'Write', path: 'product/.delivery/x.md' }, '.', true],
  [{ tool: 'Write', path: 'product/.Delivery/x.md' }, 'project', true],
  [{ tool: 'Edit', path: '../product/.beads/a' }, 'project', true],
  [{ tool: 'Write', path: 'product/config/team.json' }, '.', true],
  [{ tool: 'Write', path: 'product/config/steam.json' }, '.', false],
  [{ tool: 'Write', path: 'product/src/a.js' }, '.', false],
  [{ tool: 'Write', path: 'project/.delivery/x.md' }, '.', false],
  [{ tool: 'MultiEdit', path: 'product/src/a.js', edits: [{ file_path: 'product/.beads/z' }] }, '.', true],
  [{ tool: 'NotebookEdit', path: 'product/.delivery/n.ipynb' }, '.', true],
];

test('probe table: commands and tools are gated by effective directory and resolved path', () => {
  fs.mkdirSync(path.join(roleDir, 'project'), { recursive: true });
  const list = [...denylist];
  for (const [probe, where, expectDenied] of probes) {
    const cwd = path.join(roleDir, where);
    const call = typeof probe === 'string'
      ? { toolName: 'Bash', toolInput: { command: probe.replace(/\\n/g, '\n').replace(/\\u00a0/g, '\u00a0') } }
      : { toolName: probe.tool, toolInput: { file_path: path.join(roleDir, probe.path.replace(/^\.\.\//, '')), edits: probe.edits && probe.edits.map((e) => ({ file_path: path.join(roleDir, e.file_path) })) } };
    if (typeof probe !== 'string' && probe.path.startsWith('..')) call.toolInput.file_path = path.relative(cwd, path.join(roleDir, probe.path.replace(/^\.\.\//, '')));
    const d = decideLeak({ ...call, cwd, roleDir, denylist: list });
    assert.equal(!!d, expectDenied, `${JSON.stringify(probe)} from ${where}: ${d ? d.reason : 'allowed'}`);
  }
});

test('push range: recorded upstream, tags, and no duplicate .delivery/ hit', () => {
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-push-'));
  fs.mkdirSync(path.join(rd, 'product'), { recursive: true });
  const cwd = path.join(rd, 'product');
  const calls = [];
  const git = (args) => { calls.push(args); if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return 'abc123\n'; if (args[0] === 'log') return 'x .delivery/a and .DELIVERY/b'; if (args[0] === 'for-each-ref') return 'tag says Casual Carl'; return ''; };
  require('./leak.js').recordPrepush({ roleDir: rd, dir: cwd, git });
  assert.deepEqual(scanPushed({ cwd, roleDir: rd, denylist, git }), ['.delivery/']);
  assert.ok(calls.some((a) => a[0] === 'log' && a[1] === 'abc123..HEAD'));
  assert.deepEqual(scanPushed({ cwd, roleDir: rd, denylist, git, tags: true }), ['Casual Carl', '.delivery/']);
});
