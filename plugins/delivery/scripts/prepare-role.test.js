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
// the full manifest the tests run against (templates/ holds the minimal one users start from)
const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function scratchProjectRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-project-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
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
  assert.equal(settings.env.DELIVERY_ROLE_DIR, roleDir);
  const brief = fs.readFileSync(path.join(roleDir, 'CLAUDE.local.md'), 'utf8');
  assert.ok(brief.startsWith('# Role: chief-of-staff (chief-of-staff) on example'));
  // the rendered rules carry the record rule (12), never the old relay-refusing sentence
  assert.ok(brief.includes('12. **Operator decisions are records, never relays.**'));
  // C2: the role session's Bash has no CLAUDE_PLUGIN_ROOT, so the brief carries the absolute path
  assert.ok(!brief.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(brief.includes(`node ${path.join(PLUGIN_ROOT, 'scripts', 'operator.js')} verify <id>`));
  assert.ok(!brief.includes("passes as the operator's word"));
  assert.ok(brief.includes("### The operator's time is yours to protect"));
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).env.DELIVERY_RUNNER, 'superpowers');
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

test('prepareRole merges settings, keeps foreign keys, sets DELIVERY_MODE and enabledPlugins, no defaultMode', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const file = path.join(roleDir, '.claude', 'settings.local.json');
  const first = JSON.parse(fs.readFileSync(file, 'utf8'));
  // I5: the lane's own commands are pre-allowed (no permission prompt only the operator can clear)
  assert.ok(first.permissions.allow.includes('Bash(bd ready:*)'));
  assert.ok(first.permissions.allow.includes(`Bash(node ${path.join(PLUGIN_ROOT, 'scripts', 'operator.js')} record:*)`));
  assert.ok(!first.permissions.allow.some((r) => /Bash\(git push|Bash\(\*/.test(r)), 'nothing outside the chief of staff lane');
  assert.equal(first.env.DELIVERY_MODE, 'delegate');
  assert.equal(first.enabledPlugins['delivery@ai-augmentation-systems'], true);
  const generated = first.permissions.allow.slice();
  first.permissions = { allow: ['Bash(ls)'], defaultMode: 'auto' };
  first.model = 'haiku';
  fs.writeFileSync(file, JSON.stringify(first));
  prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const second = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(second.permissions.allow[0], 'Bash(ls)', 'a user rule is kept');
  assert.deepEqual(second.permissions.allow.slice(1).sort(), generated.sort());
  assert.equal(second.permissions.defaultMode, undefined);
  assert.equal(second.model, 'opus');
  assert.equal(second.enabledPlugins['delivery@ai-augmentation-systems'], true);
});

test('prepareRole tolerates invalid settings JSON, writes actor into the marker and a roster gitignore', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  fs.writeFileSync(path.join(roleDir, '.claude', 'settings.local.json'), '{ nope');
  const again = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.ok(again.files.some((f) => f.startsWith('warning:') && f.includes('not valid JSON')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8')).actor, 'tester@pc/staffing');
  const ignore = path.join(projectRoot, '.delivery', 'team', '.gitignore');
  assert.equal(fs.readFileSync(ignore, 'utf8'), 'roster.json\nroster.json.*\n');
  fs.writeFileSync(ignore, 'custom\n');
  prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(fs.readFileSync(ignore, 'utf8'), 'custom\n');
});

test('prepareRole warns when a code-touching role has no product repo', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { files } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.ok(files.includes('warning: no product worktree (pass --product-repo)'));
});

test('C: prepareRole writes BEADS_DIR when the project has .beads, never overwriting a user value', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  let { roleDir } = prepareRole({ projectRoot, instance: 'delivery-lead', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const read = () => JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(read().env.BEADS_DIR, undefined);
  fs.mkdirSync(path.join(projectRoot, '.beads'));
  ({ roleDir } = prepareRole({ projectRoot, instance: 'delivery-lead', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' }));
  assert.equal(read().env.BEADS_DIR, path.join(projectRoot, '.beads'));
  const s = read();
  s.env.BEADS_DIR = '/custom/beads';
  fs.writeFileSync(path.join(roleDir, '.claude', 'settings.local.json'), JSON.stringify(s));
  prepareRole({ projectRoot, instance: 'delivery-lead', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(read().env.BEADS_DIR, '/custom/beads');
});

test('C: a BEADS_DIR prepare-role wrote earlier is refreshed when the project moves; a user value never is', () => {
  const projectRoot = scratchProjectRepo();
  fs.mkdirSync(path.join(projectRoot, '.beads'));
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const prep = (root) => prepareRole({ projectRoot: root, instance: 'delivery-lead', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const { roleDir } = prep(projectRoot);
  const settingsFile = path.join(roleDir, '.claude', 'settings.local.json');
  const marker = () => JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8'));
  const read = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(marker().beads_dir_written, path.join(projectRoot, '.beads'));
  // The project directory moves: the value prepare-role wrote is stale and is refreshed.
  const moved = `${projectRoot}-moved`;
  fs.renameSync(projectRoot, moved);
  prep(moved);
  assert.equal(read().env.BEADS_DIR, path.join(moved, '.beads'));
  assert.equal(marker().beads_dir_written, path.join(moved, '.beads'));
  // A value the user set is left alone, and is not recorded as ours.
  const s = read();
  s.env.BEADS_DIR = '/custom/beads';
  fs.writeFileSync(settingsFile, JSON.stringify(s));
  prep(moved);
  assert.equal(read().env.BEADS_DIR, '/custom/beads');
  assert.equal(marker().beads_dir_written, undefined);
  // And once the marker no longer remembers a write, a later run does not claim the user's value either.
  fs.renameSync(moved, projectRoot);
  prep(projectRoot);
  assert.equal(read().env.BEADS_DIR, '/custom/beads');
});

test('I5: an unrestricted (any) lane gets no pre-allowed commands', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const settings = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.permissions.allow, undefined);
});

test('hardening a/b: native deny rules per role, idempotent, keeping the user\'s own rules', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const ASK = ['AskUserQuestion', 'PushNotification', 'SendUserFile'];
  const settingsOf = (instance) => {
    const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    return { roleDir, s: JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')) };
  };
  const deny = (instance) => ((settingsOf(instance).s.permissions || {}).deny || []).slice().sort();
  // operator-facing roles may ask; the chief of staff has no git push in its lane; only the delivery
  // lead merges, so every other role gets the gh pr merge backstop
  const M = 'Bash(gh pr merge:*)';
  assert.deepEqual(deny('chief-of-staff'), ['Bash(curl:*)', M, 'Bash(git push:*)', 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(wget:*)'].sort());
  // the product manager, delivery lead and staffing push plan documents (git-write-project)
  assert.deepEqual(deny('product-manager'), ['Bash(curl:*)', M, 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(wget:*)'].sort());
  assert.deepEqual(deny('delivery-lead'), [...ASK, 'Bash(curl:*)', 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(wget:*)'].sort());
  assert.ok(settingsOf('delivery-lead').s.permissions.allow.includes(M), 'the delivery lead merges without a prompt');
  assert.deepEqual(deny('staffing'), [...ASK, 'Bash(curl:*)', M, 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(wget:*)'].sort());
  assert.deepEqual(deny('progress-observer'), [...ASK, 'Bash(curl:*)', M, 'Bash(git push:*)', 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(wget:*)'].sort());
  // workers (lane any) keep their commands but never address the operator and never merge
  assert.deepEqual(deny('builder-1'), [...ASK, M].sort());
  assert.deepEqual(deny('spike-researcher'), [...ASK, M].sort());
  // idempotent; a user's own deny rule is kept, even one the plugin also manages; a rule the plugin
  // added earlier (listed in its sidecar) is taken out once the role no longer needs it
  const { roleDir, s } = settingsOf('chief-of-staff');
  s.permissions.deny = [...s.permissions.deny, 'Bash(npm publish:*)', 'AskUserQuestion', 'PushNotification'];
  fs.writeFileSync(path.join(roleDir, '.claude', 'settings.local.json'), JSON.stringify(s));
  const sidecar = path.join(roleDir, '.claude', '.delivery-managed-deny.json');
  fs.writeFileSync(sidecar, JSON.stringify({ deny: [...JSON.parse(fs.readFileSync(sidecar, 'utf8')).deny, 'PushNotification'] }));
  const again = deny('chief-of-staff');
  assert.ok(again.includes('Bash(npm publish:*)'));
  assert.ok(again.includes('AskUserQuestion'), 'a deny the user wrote is never removed');
  assert.ok(!again.includes('PushNotification'), 'the chief of staff may notify: the plugin-added deny is removed');
  assert.deepEqual(deny('chief-of-staff'), again);
});

test('A5: a builder gets DELIVERY_LARGE_MODEL from its manifest large_model (default opus); a manager does not', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const envOf = (instance) => JSON.parse(fs.readFileSync(path.join(prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 't' }).roleDir, '.claude', 'settings.local.json'), 'utf8')).env;
  assert.equal(envOf('builder-1').DELIVERY_LARGE_MODEL, 'opus');
  assert.equal(envOf('chief-of-staff').DELIVERY_LARGE_MODEL, undefined);
  const file = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.find((r) => r.id === 'builder').large_model = 'sonnet';
  fs.writeFileSync(file, JSON.stringify(team));
  assert.equal(envOf('builder-1').DELIVERY_LARGE_MODEL, 'sonnet');
});

test('ruling 4: prepare-role --instance delivery-manager prepares the delivery-lead instance', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'delivery-manager', teamDir, pluginRoot: PLUGIN_ROOT, user: 't' });
  assert.equal(path.basename(roleDir), 'delivery-lead');
  assert.match(fs.readFileSync(path.join(roleDir, 'CLAUDE.local.md'), 'utf8'), /Delivery Manager/);
});

test('final M6: prepare-role reports an unknown model name of the role it prepares as a warning', () => {
  const projectRoot = scratchProjectRepo();
  const file = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.find((r) => r.id === 'staffing').model = 'claude-sonnet-9';
  fs.writeFileSync(file, JSON.stringify(team));
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { files } = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 't' });
  assert.ok(files.some((f) => /^warning: .*"claude-sonnet-9"/.test(f)), files.join('\n'));
  const other = prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 't' });
  assert.ok(!other.files.some((f) => /claude-sonnet-9/.test(f)), 'only the prepared role\'s own model');
});

test('Copilot: a deny rule the user had is never removed, even one the plugin also manages', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const prep = () => prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' }).roleDir;
  const file = (dir) => path.join(dir, '.claude', 'settings.local.json');
  const dir = prep();
  const s = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
  s.permissions.deny = [...s.permissions.deny, 'Bash(sudo:*)', 'Bash(rm:*)'];
  fs.writeFileSync(file(dir), JSON.stringify(s));
  prep();
  const deny = JSON.parse(fs.readFileSync(file(dir), 'utf8')).permissions.deny;
  assert.ok(deny.includes('Bash(sudo:*)') && deny.includes('Bash(rm:*)'), JSON.stringify(deny));
});
