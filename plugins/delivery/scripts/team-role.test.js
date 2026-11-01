// scripts/team-role.test.js — run through scripts/testing/run-tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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
