// scripts/lib/manifest.test.js — run with: node --test scripts/lib/manifest.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { manifestWarnings, findProjectRoot, loadManifest, validateManifest, expandInstances } = require('./manifest.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
// the full manifest the tests run against (templates/ holds the minimal one users start from)
const MANIFEST_FIXTURE = path.join(__dirname, '..', 'testing', 'manifest');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

test('findProjectRoot walks upward to the directory holding .delivery/team/team.json', () => {
  const root = scratchProject();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), root);
});

test('findProjectRoot returns null when nothing is found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-none-'));
  assert.equal(findProjectRoot(dir), null);
});

test('findProjectRoot honours DELIVERY_PROJECT_ROOT', () => {
  const root = scratchProject();
  process.env.DELIVERY_PROJECT_ROOT = root;
  try {
    assert.equal(findProjectRoot(os.tmpdir()), root);
  } finally {
    delete process.env.DELIVERY_PROJECT_ROOT;
  }
});

test('loadManifest parses team and hosts', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  assert.equal(team.project, 'example');
  assert.ok(hosts.hosts.pc);
});

test('loadManifest throws a named error on bad JSON', () => {
  const root = scratchProject();
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), '{ not json');
  assert.throws(() => loadManifest(root), /manifest: team\.json/);
});

test('validateManifest accepts the template', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  assert.deepEqual(validateManifest(team, hosts), []);
});

test('validateManifest reports unknown host, duplicate id, bad model, missing steward', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  team.roles[0].host = 'mars';
  team.roles[1].id = 'chief-of-staff';
  team.roles[2].model = 'gpt';
  delete team.roles.find((r) => r.id === 'progress-observer').steward;
  delete team.roles.find((r) => r.id === 'builder').steward;
  const problems = validateManifest(team, hosts);
  assert.ok(problems.some((p) => p.includes('unknown host "mars"')));
  assert.ok(problems.some((p) => p.includes('duplicate role id "chief-of-staff"')));
  // A4: any model string is accepted (a warning, not a problem)
  assert.ok(!problems.some((p) => p.includes('model "gpt"')));
  assert.ok(manifestWarnings(team).some((w) => w.includes('model "gpt"') && /passed to Claude Code as written/.test(w)));
  assert.ok(problems.some((p) => p.includes('no steward for host "pc"')), 'two hosts in use: stewards are required');
});

test('A4: a single-host team needs no steward; a missing model falls back to the brief default_model; an empty model is refused', () => {
  const hosts = { hosts: { pc: { kind: 'pc' } } };
  const team = { project: 'x', prefix: 'x', bd_host: 'pc', roles: [
    { id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc' },
    { id: 'builder', brief: 'delivery/builder', host: 'pc', model: 'claude-sonnet-9' },
  ] };
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.equal(manifestWarnings(team).length, 1);
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'man-a4-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify(team));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify(hosts));
  const loaded = loadManifest(root).team;
  assert.equal(loaded.roles[0].model, 'opus', 'chief-of-staff default_model');
  assert.equal(loaded.roles[1].model, 'claude-sonnet-9');
  assert.ok(validateManifest({ ...team, roles: [{ ...team.roles[0], model: '  ' }] }, hosts).some((p) => /invalid "model"/.test(p)));
  // the fields no script reads are still accepted
  assert.deepEqual(validateManifest({ ...team, product_repo: 'git@x:y.git', budget: { max_roles: 3 } }, { hosts: { pc: { kind: 'pc', dolt_server: true, check: 'prepush' } } }), []);
});

test('expandInstances expands count into numbered instances', () => {
  const root = scratchProject();
  const { team } = loadManifest(root);
  const ids = expandInstances(team).map((i) => i.instance);
  assert.deepEqual(ids, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder-1', 'builder-2']);
});

test('validateManifest rejects role ids that are not path-safe', () => {
  const { team, hosts } = loadManifest(scratchProject());
  team.roles[0].id = '../evil';
  assert.ok(validateManifest(team, hosts).some((p) => p.includes('role id "../evil" must match ^[a-z0-9][a-z0-9-]*$')));
});

test('validateManifest rejects a brief ref that is not delivery/<id> or project/<id>', () => {
  const { team, hosts } = loadManifest(scratchProject());
  team.roles[0].brief = '../x';
  assert.ok(validateManifest(team, hosts).some((p) => p.includes('brief') && p.includes('../x')));
});

test('findProjectRoot prefers the marker project_root over the clone inside a role directory', () => {
  const original = scratchProject();
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-role-'));
  const clone = path.join(roleDir, 'project');
  fs.mkdirSync(path.join(clone, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(clone, '.delivery', 'team', 'team.json'));
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), JSON.stringify({ instance: 'x', project_root: original }));
  assert.equal(findProjectRoot(clone), original);
});

test('validateManifest rejects an unknown runner and accepts the three known ones', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  const builder = team.roles.find((r) => r.id === 'builder');
  builder.runner = 'magic';
  assert.ok(validateManifest(team, hosts).some((p) => p.includes('runner "magic"')));
  for (const r of ['superpowers', 'attractor', 'plain']) {
    builder.runner = r;
    assert.ok(!validateManifest(team, hosts).some((p) => p.includes('runner')));
  }
});

test('A4: templates/ holds the minimal four-role single-host team, valid and without the never-read fields', () => {
  const T = path.join(__dirname, '..', '..', 'templates');
  const team = JSON.parse(fs.readFileSync(path.join(T, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(T, 'hosts.json'), 'utf8'));
  assert.deepEqual(team.roles.map((r) => r.id), ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder']);
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.equal(team.product_repo, undefined);
  assert.equal((team.budget || {}).max_roles, undefined);
  for (const h of Object.values(hosts.hosts)) { assert.equal(h.dolt_server, undefined); assert.equal(h.check, undefined); }
});

test('ruling 4: "delivery-manager" is accepted wherever a role id is typed and means delivery-lead', () => {
  const { canonicalRoleId } = require('./manifest.js');
  assert.equal(canonicalRoleId('delivery-manager'), 'delivery-lead');
  assert.equal(canonicalRoleId('delivery-manager-2'), 'delivery-lead-2');
  assert.equal(canonicalRoleId('builder-1'), 'builder-1');
  const hosts = { hosts: { pc: { kind: 'pc' } } };
  const team = { project: 'x', prefix: 'x', bd_host: 'pc', roles: [{ id: 'delivery-manager', brief: 'delivery/delivery-manager', host: 'pc' }] };
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.equal(team.roles[0].id, 'delivery-lead');
  assert.deepEqual(expandInstances(team).map((i) => i.instance), ['delivery-lead']);
});

test('Copilot: the single-host exemption counts every active host, cloud included, and ignores retired roles', () => {
  const hosts = { hosts: { pc: { kind: 'pc' }, cloud: { kind: 'cloud' }, box: { kind: 'ssh' } } };
  const role = (id, host, extra = {}) => ({ id, brief: `delivery/${id}`, host, model: 'sonnet', ...extra });
  const pcCloud = { project: 'x', prefix: 'x', bd_host: 'pc', roles: [role('chief-of-staff', 'pc'), role('builder', 'cloud')] };
  assert.ok(validateManifest(pcCloud, hosts).some((p) => p.includes('no steward for host "pc"')), 'a PC-plus-cloud team needs the PC steward');
  assert.ok(!validateManifest(pcCloud, hosts).some((p) => p.includes('"cloud"')), 'a cloud host has no steward');
  const retiredBox = { project: 'x', prefix: 'x', bd_host: 'pc', roles: [role('chief-of-staff', 'pc'), role('builder', 'pc'), role('spike-researcher', 'box', { retired: true })] };
  assert.deepEqual(validateManifest(retiredBox, hosts), [], 'a retired role on another host does not make the team multi-host');
});

// the fields the watchdog and the reviewer read from team.json: a value they cannot use is refused at
// setup, both ways (the valid forms pass)
test('validateManifest: permission_mode, test_command and wake_fresh_above_tokens', () => {
  const { team, hosts } = loadManifest(scratchProject());
  const problems = (extra) => validateManifest({ ...team, ...extra }, hosts);
  for (const ok of [{ permission_mode: 'auto' }, { permission_mode: 'default' }, { test_command: 'make ci' }, { wake_fresh_above_tokens: 0 }, { wake_fresh_above_tokens: 150000 }]) {
    assert.deepEqual(problems(ok), [], JSON.stringify(ok));
  }
  for (const [bad, re] of [
    [{ permission_mode: 'Auto' }, /"permission_mode" must be a Claude Code permission mode/],
    [{ test_command: '' }, /"test_command" must be one line of shell/],
    [{ test_command: 'a\nb' }, /"test_command" must be one line of shell/],
    [{ wake_fresh_above_tokens: '0' }, /"wake_fresh_above_tokens" must be a whole number/],
    [{ wake_fresh_above_tokens: 1.5 }, /"wake_fresh_above_tokens" must be a whole number/],
    [{ wake_fresh_above_tokens: -1 }, /"wake_fresh_above_tokens" must be a whole number/],
  ]) assert.ok(problems(bad).some((p) => re.test(p)), JSON.stringify(bad));
});
