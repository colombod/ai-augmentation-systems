// scripts/experts.test.js — a product's own experts installed into role sessions.
// Run with: node --test scripts/experts.test.js
// Each test runs the real prepare-role as a child process where a role session would, so what is
// checked is the file a session loads, not a function's return value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');
const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');
const PREPARE = path.join(__dirname, 'prepare-role.js');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function project(experts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-project-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  // background maintenance racing a local clone has failed CI once (prepare-role.test.js on #62)
  git(root, 'config', 'maintenance.auto', 'false');
  git(root, 'config', 'gc.auto', '0');
  fs.mkdirSync(path.join(root, '.delivery', 'team', 'experts'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  for (const [file, text] of Object.entries(experts)) fs.writeFileSync(path.join(root, '.delivery', 'team', 'experts', file), text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const expert = (name, description = `${name} specialist`) => `---\nname: ${name}\ncomponents: [app]\ndescription: ${description}\n---\n\n# ${name}\n\nBody of ${name}.\n`;

function prepare(projectRoot, teamDir) {
  const r = spawnSync(process.execPath, [PREPARE, '--project', projectRoot, '--instance', 'staffing', '--team-dir', teamDir, '--user', 'tester'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout + r.stderr;
}

const agentsOf = (teamDir) => path.join(teamDir, 'staffing', '.claude', 'agents');

test('an expert the project defines is installed, byte for byte, where the role session loads subagents', () => {
  const text = expert('security-reviewer');
  const root = project({ 'security-reviewer.md': text });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  const out = prepare(root, teamDir);
  const target = path.join(agentsOf(teamDir), 'security-reviewer.md');
  assert.equal(fs.readFileSync(target, 'utf8'), text);
  assert.doesNotMatch(out, /warning/);
});

test('a project with no experts directory installs nothing and warns about nothing', () => {
  const root = project();
  fs.rmSync(path.join(root, '.delivery', 'team', 'experts'), { recursive: true });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  const out = prepare(root, teamDir);
  assert.equal(fs.existsSync(agentsOf(teamDir)), false);
  assert.doesNotMatch(out, /expert/);
});

test('an expert removed from the project is removed from the role on the next prepare; the user\'s own agent stays', () => {
  const root = project({ 'infra-manager.md': expert('infra-manager'), 'security-reviewer.md': expert('security-reviewer') });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  prepare(root, teamDir);
  const mine = path.join(agentsOf(teamDir), 'my-notes.md');
  fs.writeFileSync(mine, expert('my-notes'));
  fs.rmSync(path.join(root, '.delivery', 'team', 'experts', 'infra-manager.md'));
  const out = prepare(root, teamDir);
  assert.equal(fs.existsSync(path.join(agentsOf(teamDir), 'infra-manager.md')), false);
  assert.match(out, /removed \(expert retired\): .*infra-manager\.md/);
  assert.equal(fs.existsSync(path.join(agentsOf(teamDir), 'security-reviewer.md')), true);
  assert.equal(fs.readFileSync(mine, 'utf8'), expert('my-notes'));
});

test('a changed expert is updated on the next prepare', () => {
  const root = project({ 'infra-manager.md': expert('infra-manager', 'first') });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  prepare(root, teamDir);
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'experts', 'infra-manager.md'), expert('infra-manager', 'second'));
  prepare(root, teamDir);
  assert.match(fs.readFileSync(path.join(agentsOf(teamDir), 'infra-manager.md'), 'utf8'), /description: second/);
});

test('an agent the user wrote under the same name is never overwritten; the expert is reported as not installed', () => {
  const root = project({ 'infra-manager.md': expert('infra-manager') });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  fs.mkdirSync(agentsOf(teamDir), { recursive: true });
  const theirs = '---\nname: infra-manager\ndescription: the user\'s own\n---\n';
  fs.writeFileSync(path.join(agentsOf(teamDir), 'infra-manager.md'), theirs);
  const out = prepare(root, teamDir);
  assert.equal(fs.readFileSync(path.join(agentsOf(teamDir), 'infra-manager.md'), 'utf8'), theirs);
  assert.match(out, /warning: expert infra-manager not installed: .* was not written by the plugin/);
});

test('a malformed expert is reported and skipped; the good ones beside it are installed', () => {
  const root = project({
    'no-name.md': '---\ndescription: x\n---\n',
    'wrong-name.md': expert('other-name'),
    'no-description.md': '---\nname: no-description\n---\n',
    'good.md': expert('good'),
  });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  const out = prepare(root, teamDir);
  assert.match(out, /expert .*no-name\.md not installed: its frontmatter has no name/);
  assert.match(out, /expert .*wrong-name\.md not installed: its name "other-name" is not its file name "wrong-name"/);
  assert.match(out, /expert .*no-description\.md not installed: its frontmatter has no description/);
  assert.deepEqual(fs.readdirSync(agentsOf(teamDir)).sort(), ['good.md']);
});

test('more than a handful of experts is said, and all of them are still installed', () => {
  const six = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => [`${n}.md`, expert(n)]));
  const root = project(six);
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  const out = prepare(root, teamDir);
  assert.match(out, /6 experts in .*: more than a handful \(5\)/);
  assert.equal(fs.readdirSync(agentsOf(teamDir)).length, 6);
  const five = project(Object.fromEntries(Object.entries(six).slice(0, 5)));
  const teamDir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-team-'));
  assert.doesNotMatch(prepare(five, teamDir5), /more than a handful/);
});
