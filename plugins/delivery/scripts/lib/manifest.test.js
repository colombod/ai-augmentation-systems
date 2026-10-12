// scripts/lib/manifest.test.js — run with: node --test scripts/lib/manifest.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProjectRoot, loadManifest, validateManifest, expandInstances } = require('./manifest.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
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
  delete team.roles[4].steward;
  delete team.roles[5].steward;
  const problems = validateManifest(team, hosts);
  assert.ok(problems.some((p) => p.includes('unknown host "mars"')));
  assert.ok(problems.some((p) => p.includes('duplicate role id "chief-of-staff"')));
  assert.ok(problems.some((p) => p.includes('model "gpt"')));
  assert.ok(problems.some((p) => p.includes('no steward for host "pc"')));
});

test('expandInstances expands count into numbered instances', () => {
  const root = scratchProject();
  const { team } = loadManifest(root);
  const ids = expandInstances(team).map((i) => i.instance);
  assert.deepEqual(ids, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'builder-1', 'builder-2']);
});
