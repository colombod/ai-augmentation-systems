// scripts/team-role.test.js — run through scripts/testing/run-tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { addRole } = require('./team-role.js');

const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'team-role-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return { root, git, team: () => JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'team.json'), 'utf8')) };
}

// dec-chief-of-staff-000177: team.json changes through a validating command, never a free-form edit
test('team-role add: adds a shipped role on the main host with its default model, validated and committed', () => {
  const p = project();
  const before = p.team().roles.length;
  const dry = addRole(p.root, 'tech-writer', { dryRun: true });
  assert.equal(dry.code, 0, dry.out);
  assert.equal(p.team().roles.length, before, 'a dry run writes nothing');
  const r = addRole(p.root, 'tech-writer');
  assert.equal(r.code, 0, r.out);
  const added = p.team().roles.find((x) => x.id === 'tech-writer');
  const hosts = p.team().roles.filter((x) => x.id !== 'tech-writer').map((x) => x.host);
  const main = hosts.sort((a, b) => hosts.filter((h) => h === b).length - hosts.filter((h) => h === a).length)[0];
  assert.deepEqual(added, { id: 'tech-writer', brief: 'delivery/tech-writer', host: main, model: 'sonnet' });
  assert.match(p.git('log', '-1', '--format=%s'), /team: add the tech-writer role/);
  assert.equal(p.git('status', '--porcelain').trim(), '', 'the change is committed');
});

test('team-role add: refuses an unknown role, a duplicate, a bad model and an unknown host, writing nothing', () => {
  const p = project();
  const text = () => fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const before = text();
  assert.match(addRole(p.root, 'astronaut').out, /not a role this plugin ships/);
  assert.match(addRole(p.root, 'chief-of-staff').out, /already on the team/);
  assert.match(addRole(p.root, 'tech-writer', { model: 'gpt' }).out, /--model must be one of/);
  const bad = addRole(p.root, 'tech-writer', { host: 'nowhere' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /invalid/);
  assert.equal(text(), before);
});

const rewrite = (p, f) => {
  const file = path.join(p.root, '.delivery', 'team', 'team.json');
  fs.writeFileSync(file, `${JSON.stringify(f(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2)}\n`);
  p.git('commit', '-q', '-am', 'fixture');
};

// Copilot on #118 (4437630094): delivery-manager is typed for delivery-lead wherever a role id is typed
test('team-role add: delivery-manager is the Delivery Manager\'s id, delivery-lead', () => {
  const p = project();
  assert.match(addRole(p.root, 'delivery-manager').out, /delivery-lead is already on the team/);
  rewrite(p, (t) => ({ ...t, roles: t.roles.filter((r) => r.id !== 'delivery-lead') }));
  const r = addRole(p.root, 'delivery-manager');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(p.team().roles.find((x) => x.id === 'delivery-lead'), { id: 'delivery-lead', brief: 'delivery/delivery-lead', host: 'pc', model: 'sonnet' });
  assert.equal(p.team().roles.some((x) => x.id === 'delivery-manager'), false);
});

// Copilot on #118 (4437630106): a retired role does not run, so its host does not vote
test('team-role add: the default host is the one most active roles run on; retired roles do not vote', () => {
  const p = project();
  // every active role moved to buildbox; eight retired roles left on pc outnumber them
  rewrite(p, (t) => ({ ...t, roles: [...t.roles.map((r) => ({ ...r, host: 'buildbox' })),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `old-${n}`, brief: `project/old-${n}`, host: 'pc', model: 'sonnet', retired: true }))] }));
  const r = addRole(p.root, 'tech-writer');
  assert.equal(r.code, 0, r.out);
  assert.equal(p.team().roles.find((x) => x.id === 'tech-writer').host, 'buildbox');
});

// Copilot on #118 (4437630064): in a role session the roster change goes to the role's own clone, which
// it then publishes; the shared checkout DELIVERY_PROJECT_ROOT names is never written
test('team-role add: from a role directory it commits in the role\'s clone, not the shared checkout', () => {
  const p = project();
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-role-staffing-'));
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), JSON.stringify({ role: 'staffing', instance: 'staffing', project_root: p.root }));
  execFileSync('git', ['clone', '-q', p.root, path.join(roleDir, 'project')], { stdio: 'pipe' });
  const clone = (...a) => execFileSync('git', ['-C', path.join(roleDir, 'project'), ...a], { stdio: 'pipe' }).toString();
  clone('config', 'user.email', 't@t'); clone('config', 'user.name', 't');
  const shared = fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const env = { ...process.env, DELIVERY_PROJECT_ROOT: p.root };
  const r = spawnSync(process.execPath, [path.join(__dirname, 'team-role.js'), 'add', 'tech-writer'], { cwd: roleDir, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /committed in your clone/);
  assert.match(r.stdout, /push origin HEAD:staffing\/add-tech-writer/);
  assert.equal(fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8'), shared, 'the shared checkout is untouched');
  assert.equal(p.git('status', '--porcelain').trim(), '');
  const mine = JSON.parse(fs.readFileSync(path.join(roleDir, 'project', '.delivery', 'team', 'team.json'), 'utf8'));
  assert.ok(mine.roles.some((x) => x.id === 'tech-writer'));
  assert.match(clone('log', '-1', '--format=%s'), /team: add the tech-writer role/);
  assert.equal(clone('status', '--porcelain').trim(), '', 'committed in the clone');
  // --project still names a checkout explicitly (the operator's own)
  const q = project();
  const r2 = spawnSync(process.execPath, [path.join(__dirname, 'team-role.js'), 'add', 'tech-writer', '--project', q.root], { cwd: roleDir, env, encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(q.team().roles.some((x) => x.id === 'tech-writer'));
});
