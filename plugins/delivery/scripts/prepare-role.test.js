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
  // C2: the role session's Bash has no CLAUDE_PLUGIN_ROOT, so the brief names the project's launcher
  // (8wz.1: a versioned plugin path breaks at the next install), written beside it and never committed
  const L = require('./lib/launcher.js');
  assert.ok(!brief.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(brief.includes(`${L.launcherCommand(projectRoot, 'operator.js')} verify <id>`));
  assert.equal(L.resolveLauncher(projectRoot, PLUGIN_ROOT), path.resolve(PLUGIN_ROOT));
  assert.equal(fs.readFileSync(path.join(projectRoot, '.delivery', 'bin', '.gitignore'), 'utf8'), '*\n');
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

test('prepareRole merges settings, keeps foreign keys, sets DELIVERY_MODE and enabledPlugins, the team\'s permission mode as default', () => {
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
  assert.equal(second.permissions.defaultMode, 'auto', 'the team\'s mode (auto when team.json names none), never a leftover');
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

// Copilot on #112: re-preparing without --user keeps the saved actor; an explicit --user changes it
test('prepareRole keeps the role\'s saved actor when no user is given', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'alice' });
  const actor = () => JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8')).actor;
  prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT });
  assert.equal(actor(), 'alice@pc/staffing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).env.BEADS_ACTOR, 'alice@pc/staffing');
  prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'bob' });
  assert.equal(actor(), 'bob@pc/staffing');
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
  const denyAll = (instance) => ((settingsOf(instance).s.permissions || {}).deny || []).slice().sort();
  // operator-facing roles may ask; the chief of staff has no git push in its lane; only the delivery
  // lead merges, so every other role gets the gh pr merge backstop
  const M = 'Bash(gh pr merge:*)';
  // no role here has a reach lane: browser, desktop and computer-use servers are denied to all (R-05)
  const R = require('./prepare-role.js').REACH_DENY;
  assert.deepEqual(R, ['mcp__Claude_Browser', 'mcp__claude-in-chrome', 'mcp__computer-use', 'mcp__Claude_Code_iOS_Simulator', 'mcp__playwright', 'mcp__chrome-devtools', 'mcp__puppeteer']);
  const deny = (instance) => denyAll(instance).filter((r) => !R.includes(r));
  for (const i of ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder-1']) assert.deepEqual(denyAll(i).filter((r) => R.includes(r)), R.slice().sort(), i);
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

// kk5 (dec-chief-of-staff-000076): no session the plugin spawns may come up in manual-approve mode,
// however it is started (the owner's Claude app via Remote Control, a typed start command, a fresh
// wake), so the team's permission mode is each role's default, not only a launch flag.
test('kk5: every role defaults to the team\'s permission mode; auto when unset; an owner\'s default is respected', () => {
  const settingsOf = (mode) => {
    const projectRoot = scratchProjectRepo();
    const file = path.join(projectRoot, '.delivery', 'team', 'team.json');
    const team = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (mode === undefined) delete team.permission_mode; else team.permission_mode = mode;
    fs.writeFileSync(file, JSON.stringify(team, null, 2));
    const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
    const out = {};
    for (const instance of ['chief-of-staff', 'product-manager']) {
      const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
      out[instance] = (JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).permissions || {}).defaultMode;
    }
    return out;
  };
  assert.deepEqual(settingsOf(undefined), { 'chief-of-staff': 'auto', 'product-manager': 'auto' });
  assert.deepEqual(settingsOf('acceptEdits'), { 'chief-of-staff': 'acceptEdits', 'product-manager': 'acceptEdits' });
  assert.deepEqual(settingsOf('default'), { 'chief-of-staff': undefined, 'product-manager': undefined }, 'an owner who chose default gets it');
});

// 07t: a session started by a service manager gets its bare PATH; bd lives in ~/.local/bin, so every
// bd call failed with ENOENT. The role's PATH is written from the tools resolved at preparation.
test('prepareRole writes a PATH that finds bd for a session started with a bare PATH, and keeps a user PATH', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-bin-'));
  fs.writeFileSync(path.join(bin, 'bd'), '#!/bin/sh\necho fake-bd\n', { mode: 0o755 });
  const saved = process.env.PATH;
  // a private home for the spawned shells, removed whatever happens (Copilot on #116)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-home-'));
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try {
    const { roleDir } = prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    const file = path.join(roleDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-empty-'));
    // with the service manager's bare PATH bd is not found; with the role's PATH it runs. HOME is
    // set: a real bd that wins the lookup writes ~/.config/bd, which without HOME landed in the cwd
    assert.throws(() => execFileSync('/bin/sh', ['-c', 'bd'], { env: { HOME: home, PATH: bare }, stdio: 'pipe' }));
    assert.equal(execFileSync('/bin/sh', ['-c', 'bd'], { env: { HOME: home, PATH: settings.env.PATH }, stdio: 'pipe' }).toString().trim(), 'fake-bd');
    assert.ok(settings.env.PATH.split(path.delimiter).includes(path.dirname(process.execPath)));
    // the preparing shell's order is kept: a bd earlier on its PATH is the one the role runs
    const first = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-bin-'));
    fs.writeFileSync(path.join(first, 'bd'), '#!/bin/sh\necho first-bd\n', { mode: 0o755 });
    const { rolePath } = require('./prepare-role.js');
    const ordered = rolePath({ PATH: `${first}${path.delimiter}${bin}` });
    assert.equal(execFileSync('/bin/sh', ['-c', 'bd'], { env: { HOME: home, PATH: ordered }, stdio: 'pipe' }).toString().trim(), 'first-bd');
    // a relative entry is made absolute against the preparing directory
    assert.ok(rolePath({ PATH: 'rel/bin' }, '/h', '/work').split(path.delimiter).includes('/work/rel/bin'));
    // traversal is kept as written: through a symlink, link/.. is not the directory holding link (Copilot on #115)
    assert.deepEqual(rolePath({ PATH: '/a/link/../bin:x/../y' }, '/h', '/work').split(path.delimiter).slice(0, 2), ['/a/link/../bin', '/work/x/../y']);
    // an empty component searches the preparing directory, and stays first (Copilot on #115)
    assert.equal(rolePath({ PATH: ':/other/bin' }, '/h', '/work').split(path.delimiter)[0], '/work');
    assert.ok(!rolePath({}, '/h', '/work').split(path.delimiter).includes('/work'));
    // a re-prepare refreshes the PATH it wrote: bd moved, the new place is found
    const bin2 = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-bin-'));
    fs.renameSync(path.join(bin, 'bd'), path.join(bin2, 'bd'));
    process.env.PATH = `${bin2}${path.delimiter}${saved}`;
    prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    const again = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(execFileSync('/bin/sh', ['-c', 'bd'], { env: { HOME: home, PATH: again.env.PATH }, stdio: 'pipe' }).toString().trim(), 'fake-bd');
    // a PATH the user set is never touched
    again.env.PATH = '/my/own/bin:/usr/bin';
    fs.writeFileSync(file, JSON.stringify(again));
    prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).env.PATH, '/my/own/bin:/usr/bin');
    // an empty PATH is a valid user choice too (Copilot on #115)
    const empty = JSON.parse(fs.readFileSync(file, 'utf8'));
    empty.env.PATH = '';
    fs.writeFileSync(file, JSON.stringify(empty));
    prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).env.PATH, '');
  } finally { process.env.PATH = saved; fs.rmSync(home, { recursive: true, force: true }); }
});

// 8l1.3.4.1.1: an owner-approved permission rule reaches the role's settings, only on a verified record
function withPermissions(projectRoot, permissions) {
  const f = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(f, 'utf8'));
  team.roles.find((r) => r.id === 'builder').permissions = permissions;
  fs.writeFileSync(f, JSON.stringify(team, null, 2));
}
const CLOSE = 'Bash(gh pr close:*)';
const ownerSaid = (labels) => ({ ok: true, chain: [{ kind: 'record', quote: 'builders close superseded pull requests', scope: { beads: [], labels, initiatives: [] } }, { kind: 'input', source: 'human', text: 'let builders close superseded pull requests' }] });
const OWNER_OK = ownerSaid([`permission:builder=${CLOSE}`]);
const fakeVerify = (good, result = OWNER_OK) => (root, id) => (good.includes(id) ? result : { ok: false, error: 'no such record' });
const REC = 'dec-chief-of-staff-000309';

test('8l1.3.4.1.1: an owner-approved permission rule is written for every instance of the role while its record verifies', () => {
  const projectRoot = scratchProjectRepo();
  withPermissions(projectRoot, [{ allow: CLOSE, record: REC }]);
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const allowOf = (instance, verifyRecord) => {
    const { roleDir, files } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester', verifyRecord });
    const s = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
    return { roleDir, files, allow: (s.permissions && s.permissions.allow) || [] };
  };
  for (const i of ['builder-1', 'builder-2']) assert.deepEqual(allowOf(i, fakeVerify([REC])).allow, [CLOSE], i);
  // another role does not get it
  assert.ok(!allowOf('spike-researcher', fakeVerify([REC])).allow.includes(CLOSE));
  // a user's own allow rule stays; once the record no longer verifies the plugin's rule is taken out
  const { roleDir } = allowOf('builder-1', fakeVerify([REC]));
  const sf = path.join(roleDir, '.claude', 'settings.local.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.permissions.allow.push('Bash(make:*)');
  fs.writeFileSync(sf, JSON.stringify(s));
  const gone = allowOf('builder-1', fakeVerify([]));
  assert.deepEqual(gone.allow, ['Bash(make:*)']);
  assert.ok(gone.files.some((f) => /permission rule Bash\(gh pr close:\*\) not written: dec-chief-of-staff-000309 does not verify/.test(f)), gone.files.join('\n'));
});

test('8l1.3.4.1.1: a permission rule whose record does not verify, or rests on no owner words, is refused and named', () => {
  const projectRoot = scratchProjectRepo();
  withPermissions(projectRoot, [{ allow: CLOSE, record: REC }]);
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const notOwner = () => ({ ok: true, chain: [{ kind: 'record' }, { kind: 'input', source: 'agent', text: 'an agent said so' }] });
  for (const verifyRecord of [fakeVerify([]), notOwner]) {
    const { roleDir, files } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester', verifyRecord });
    const s = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
    assert.equal((s.permissions || {}).allow, undefined);
    assert.ok(files.some((f) => /^warning: permission rule Bash\(gh pr close:\*\) not written: dec-chief-of-staff-000309 /.test(f)), files.join('\n'));
  }
});

test('8l1.3.4.1.1: the manifest refuses a permissions entry without a record id', () => {
  const { validateManifest } = require('./lib/manifest.js');
  const team = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8'));
  const builder = team.roles.find((r) => r.id === 'builder');
  builder.permissions = [{ allow: CLOSE, record: REC }];
  assert.deepEqual(validateManifest(team, hosts).filter((p) => /permissions/.test(p)), []);
  for (const bad of [[{ allow: CLOSE }], [{ allow: CLOSE, record: 'the owner said so' }], [{ allow: '', record: REC }], { allow: CLOSE, record: REC }]) {
    builder.permissions = bad;
    assert.ok(validateManifest(team, hosts).some((p) => /role "builder" has invalid "permissions"/.test(p)), JSON.stringify(bad));
  }
});

const settingsAllow = (roleDir) => {
  const s = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
  return (s.permissions && s.permissions.allow) || [];
};

test('8l1.3.4.1.1: a verified owner record not scoped to this role and this rule authorises nothing', () => {
  const projectRoot = scratchProjectRepo();
  withPermissions(projectRoot, [{ allow: CLOSE, record: REC }]);
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const outOfScope = [[], ['permission:spike-researcher=' + CLOSE], ['permission:builder=Bash(gh pr merge:*)'], ['permission:builder']];
  for (const labels of outOfScope) {
    const { roleDir, files } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester', verifyRecord: fakeVerify([REC], ownerSaid(labels)) });
    assert.ok(!settingsAllow(roleDir).includes(CLOSE), JSON.stringify(labels));
    assert.ok(files.some((f) => f.includes(`not written: ${REC} is not scoped to this rule for role builder (its scope needs the label permission:builder=${CLOSE})`)), files.join('\n'));
  }
  // the same record, scoped to this rule for this role, does authorise it
  const { roleDir } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester', verifyRecord: fakeVerify([REC]) });
  assert.ok(settingsAllow(roleDir).includes(CLOSE));
});

test('8l1.3.4.1.1: a permission rule broader than one specific command is refused by the manifest and never written', () => {
  const { validateManifest, permissionRuleProblem } = require('./lib/manifest.js');
  const team = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8'));
  const builder = team.roles.find((r) => r.id === 'builder');
  const broad = ['Bash', 'Bash(*)', 'Bash(:*)', 'Bash(git:*)', 'Bash(gh pr *:*)', 'Bash(gh pr close; rm -rf x:*)', 'Bash(gh $(id):*)', 'Write', 'Edit(**)', 'mcp__*', 'WebFetch'];
  for (const allow of broad) {
    assert.ok(permissionRuleProblem(allow), allow);
    builder.permissions = [{ allow, record: REC }];
    assert.ok(validateManifest(team, hosts).some((p) => p.startsWith(`team.json: role "builder" permission rule ${allow} is refused: `)), allow);
  }
  for (const allow of [CLOSE, 'Bash(gh pr close 136)']) assert.equal(permissionRuleProblem(allow), null, allow);
  // a broad rule that reaches prepare-role (a hand-edited manifest) is refused there too, even with a scoped record
  const { ownerApproved } = require('./prepare-role.js');
  const got = ownerApproved('/nowhere', { id: 'builder', permissions: [{ allow: 'Bash(*)', record: REC }] }, fakeVerify([REC], ownerSaid(['permission:builder=Bash(*)'])));
  assert.deepEqual(got.rules, []);
  assert.match(got.refused[0].why, /no wildcard/);
});

test('8l1.3.4.1.1: a rule taken out of the manifest, or whose record stops verifying while the lane cannot load, leaves the settings', () => {
  const projectRoot = scratchProjectRepo();
  withPermissions(projectRoot, [{ allow: CLOSE, record: REC }]);
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const run = (extra) => prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester', verifyRecord: fakeVerify([REC]), ...extra });
  const { roleDir } = run();
  assert.ok(settingsAllow(roleDir).includes(CLOSE));
  // removed from the manifest: taken out on the next run
  withPermissions(projectRoot, []);
  run();
  assert.ok(!settingsAllow(roleDir).includes(CLOSE));
  // written again, then the lane cannot load (no lane-groups.json in this plugin root) and the record stops verifying
  withPermissions(projectRoot, [{ allow: CLOSE, record: REC }]);
  run();
  assert.ok(settingsAllow(roleDir).includes(CLOSE));
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-'));
  for (const e of fs.readdirSync(PLUGIN_ROOT)) if (e !== 'hooks') fs.symlinkSync(path.join(PLUGIN_ROOT, e), path.join(brokenRoot, e));
  fs.mkdirSync(path.join(brokenRoot, 'hooks'));
  for (const e of fs.readdirSync(path.join(PLUGIN_ROOT, 'hooks'))) if (e !== 'lane-groups.json') fs.symlinkSync(path.join(PLUGIN_ROOT, 'hooks', e), path.join(brokenRoot, 'hooks', e));
  const { files } = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: brokenRoot, user: 'tester', verifyRecord: fakeVerify([]) });
  assert.ok(files.some((f) => f.startsWith('warning: lane permission rules not written')), files.join('\n'));
  assert.ok(!settingsAllow(roleDir).includes(CLOSE));
});
