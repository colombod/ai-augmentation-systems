// scripts/prepare-role.test.js — run with: node --test scripts/prepare-role.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareRole } = require('./prepare-role.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function scratchProjectRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-project-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function scratchProductRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-product-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'README.md'), 'product\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('prepareRole creates a thinking role directory without a product worktree', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(roleDir, path.join(teamDir, 'chief-of-staff'));
  assert.ok(fs.existsSync(path.join(roleDir, 'project', '.delivery', 'team', 'team.json')));
  assert.ok(!fs.existsSync(path.join(roleDir, 'product')));
  const settings = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.DELIVERY_ROLE, 'chief-of-staff');
  assert.equal(settings.env.DELIVERY_HOST, 'pc');
  assert.equal(settings.env.BEADS_ACTOR, 'tester@pc/chief-of-staff');
  assert.equal(settings.env.DELIVERY_PROJECT_ROOT, projectRoot);
  const brief = fs.readFileSync(path.join(roleDir, 'CLAUDE.local.md'), 'utf8');
  assert.ok(brief.startsWith('# Role: chief-of-staff (chief-of-staff) on example'));
  const marker = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8'));
  assert.equal(marker.instance, 'chief-of-staff');
  assert.equal(marker.role, 'chief-of-staff');
  assert.equal(marker.project_root, projectRoot);
});

test('prepareRole creates a product worktree for a builder on branch team/<instance>', () => {
  const projectRoot = scratchProjectRepo();
  const productRepo = scratchProductRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'builder-2', teamDir, pluginRoot: PLUGIN_ROOT, productRepo, user: 'tester' });
  assert.ok(fs.existsSync(path.join(roleDir, 'product', 'README.md')));
  assert.equal(git(path.join(roleDir, 'product'), 'branch', '--show-current').trim(), 'team/builder-2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).env.BEADS_ACTOR, 'tester@pc/builder-2');
});

test('prepareRole is idempotent: second run rewrites settings and brief, keeps the clone', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  fs.writeFileSync(path.join(teamDir, 'staffing', 'project', 'keep.txt'), 'x');
  const second = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.ok(fs.existsSync(path.join(second.roleDir, 'project', 'keep.txt')));
  assert.ok(fs.existsSync(path.join(second.roleDir, 'CLAUDE.local.md')));
});

test('prepareRole refuses an instance that is not in the manifest', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  assert.throws(() => prepareRole({ projectRoot, instance: 'wizard', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' }), /unknown instance "wizard"/);
});

test('prepareRole rewrites origin to the project remote, or keeps the local path when there is none', () => {
  const withRemote = scratchProjectRepo();
  git(withRemote, 'remote', 'add', 'origin', 'https://example.invalid/proj.git');
  const teamA = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const a = prepareRole({ projectRoot: withRemote, instance: 'staffing', teamDir: teamA, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(git(path.join(a.roleDir, 'project'), 'remote', 'get-url', 'origin').trim(), 'https://example.invalid/proj.git');
  const noRemote = scratchProjectRepo();
  const teamB = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const b = prepareRole({ projectRoot: noRemote, instance: 'staffing', teamDir: teamB, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(git(path.join(b.roleDir, 'project'), 'remote', 'get-url', 'origin').trim(), noRemote);
});
