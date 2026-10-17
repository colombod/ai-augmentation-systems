// scripts/lib/compose-brief.test.js — run with: node --test scripts/lib/compose-brief.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, loadRoleBrief, composeBrief, shortBrief } = require('./compose-brief.js');
const { loadManifest, expandInstances } = require('./manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
// the full manifest the tests run against (templates/ holds the minimal one users start from)
const MANIFEST_FIXTURE = path.join(__dirname, '..', 'testing', 'manifest');

function templateManifest() {
  return {
    team: JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8')),
    hosts: JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8')),
  };
}

test('parseFrontmatter splits meta and body and types booleans', () => {
  const { meta, body } = parseFrontmatter('---\nid: x\ntouches_code: true\n---\n\nBody here\n');
  assert.deepEqual(meta, { id: 'x', touches_code: true });
  assert.equal(body.trim(), 'Body here');
});

test('loadRoleBrief reads a delivery role and prepends the composed agent body', () => {
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', 'delivery/chief-of-staff');
  assert.equal(brief.meta.id, 'chief-of-staff');
  assert.ok(brief.body.includes('You are Chief of Staff'));
  assert.ok(brief.body.includes('## As a session'));
  assert.ok(brief.body.indexOf('You are Chief of Staff') < brief.body.indexOf('## As a session'));
});

test('loadRoleBrief reads a project brief from .delivery/team/briefs', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'brief-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'briefs', 'vercel.md'), '---\nid: vercel\ntouches_code: false\n---\nVercel text\n');
  const brief = loadRoleBrief(PLUGIN_ROOT, root, 'project/vercel');
  assert.equal(brief.body.trim(), 'Vercel text');
});

test('composeBrief contains rules, routing table, role text and host limits', () => {
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'builder-1');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
  const rules = fs.readFileSync(path.join(TEMPLATES, 'team-rules.md'), 'utf8');
  const out = composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules });
  assert.ok(out.startsWith('# Role: builder-1 (builder) on example'));
  assert.ok(out.includes('# Team rules'));
  assert.ok(out.includes('| chief-of-staff | pc | opus |'));
  assert.ok(out.includes('You build.'));
  assert.ok(out.includes('Host pc: pc, bd via wrapper, has a display, has desktop apps'));
  assert.ok(out.includes('Your beads actor is'));
});

test('composeBrief says a headless host cannot run browser or desktop checks', () => {
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'progress-observer');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
  const out = composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules: '' });
  assert.ok(out.includes('Host buildbox: ssh, bd native, headless'));
  assert.ok(out.includes('cannot run browser, desktop-app or computer-use checks'));
});

test('loadRoleBrief rejects composes in a project brief', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'brief-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'briefs', 'evil.md'), '---\nid: evil\ncomposes: ../../etc/hosts\n---\nx\n');
  assert.throws(() => loadRoleBrief(PLUGIN_ROOT, root, 'project/evil'), /project briefs cannot compose/);
});

test('loadRoleBrief rejects a delivery composes path that escapes agents/', () => {
  const pluginRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'plug-'));
  fs.mkdirSync(path.join(pluginRoot, 'roles'));
  fs.mkdirSync(path.join(pluginRoot, 'agents'));
  fs.writeFileSync(path.join(pluginRoot, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(pluginRoot, 'roles', 'x.md'), '---\nid: x\ncomposes: ../secret.txt\n---\nbody\n');
  assert.throws(() => loadRoleBrief(pluginRoot, '/nonexistent', 'delivery/x'), /must be under agents\//);
});

test('composeBrief adds Delegate mode for chief-of-staff only', () => {
  const { team, hosts } = templateManifest();
  const rules = fs.readFileSync(path.join(TEMPLATES, 'team-rules.md'), 'utf8');
  const make = (name) => {
    const inst = expandInstances(team).find((i) => i.instance === name);
    const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
    return composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules });
  };
  assert.ok(make('chief-of-staff').includes('# Delegate mode'));
  assert.ok(!make('builder-1').includes('# Delegate mode'));
});

test('shortBrief is header, routing table, host and pointer, with no rules or role body', () => {
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'builder-1');
  const out = shortBrief({ team, hosts, instance: 'builder-1', role: inst.role, roleDir: '/r/builder-1' });
  assert.ok(out.startsWith('# Role: builder-1 (builder) on example'));
  assert.ok(out.includes('| chief-of-staff | pc | opus |'));
  assert.ok(out.includes('Host pc:'));
  assert.ok(out.includes('Your full brief and the team rules are in /r/builder-1/CLAUDE.local.md; it is binding. Re-read it if you are unsure of your role.'));
  assert.ok(!out.includes('# Team rules'));
  assert.ok(!out.includes('You build.'));
});
