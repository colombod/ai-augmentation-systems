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
  // the session is named <instance>@<team>, and the table names every peer's session the same way
  assert.ok(out.includes(`You are the session "builder-1@${team.prefix}" (instance builder-1).`), out.slice(0, 600));
  assert.ok(out.includes(`| chief-of-staff | pc | opus | delivery/chief-of-staff | \`chief-of-staff@${team.prefix}\` |`));
  assert.ok(out.includes(`\`builder-1@${team.prefix}\`, \`builder-2@${team.prefix}\``));
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

// 8wz.1: with the project known, scripts are named through its launcher, which survives plugin installs;
// any other use of the root (templates, the sealed runner under scripts/testing/) stays absolute
test('a brief names plugin scripts through the project launcher only when the project is given', () => {
  const { renderRoot } = require('./compose-brief.js');
  const root = '/plug/delivery/1.2.3';
  const proj = '/w/my proj';
  const text = 'run `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js verify <id>` or node ${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js add x\n'
    + 'obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md, test with `node ${CLAUDE_PLUGIN_ROOT}/scripts/testing/run-tests.js`';
  assert.equal(renderRoot(text, root, proj), "run `node '/w/my proj/.delivery/bin/delivery.js' operator.js verify <id>` or node '/w/my proj/.delivery/bin/delivery.js' evidence.js add x\n"
    + 'obey /plug/delivery/1.2.3/templates/writing-standard.md, test with `node /plug/delivery/1.2.3/scripts/testing/run-tests.js`');
  assert.equal(renderRoot(text, root), 'run `node /plug/delivery/1.2.3/scripts/operator.js verify <id>` or node /plug/delivery/1.2.3/scripts/evidence.js add x\n'
    + 'obey /plug/delivery/1.2.3/templates/writing-standard.md, test with `node /plug/delivery/1.2.3/scripts/testing/run-tests.js`');
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'builder-1');
  const rules = fs.readFileSync(path.join(TEMPLATES, 'team-rules.md'), 'utf8');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
  const full = composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules, pluginRoot: root, projectRoot: '/w/p' });
  assert.ok(full.includes('`node /w/p/.delivery/bin/delivery.js operator.js verify <id>`'));
  assert.doesNotMatch(full, /\/plug\/delivery\/1\.2\.3\/scripts\/[a-z0-9-]+\.js/);
  const short = (projectRoot) => shortBrief({ team, hosts, instance: 'builder-1', role: inst.role, roleDir: '/r', pluginRoot: root, projectRoot });
  assert.ok(short('/w/p').includes('Operator commands: `node /w/p/.delivery/bin/delivery.js operator.js <command>`'));
  assert.ok(short().includes('Operator commands: `node /plug/delivery/1.2.3/scripts/operator.js <command>`'));
});

test('the chief of staff\'s routing table renders its optional rows only for roles the team has', () => {
  const { applyRoleConditions } = require('./compose-brief.js');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', 'delivery/chief-of-staff');
  const body = brief.body;
  const rows = (team) => applyRoleConditions(body, team).split('\n').filter((l) => /^\| .* \| .* \|$/.test(l) && !/^\|---/.test(l) && !/The ask is about/.test(l)).map((l) => l.split('|')[2].trim());
  const minimal = { roles: ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder'].map((id) => ({ id })) };
  const full = { roles: [...minimal.roles, { id: 'staffing' }, { id: 'progress-observer' }, { id: 'spike-researcher' }] };
  const m = rows(minimal);
  assert.ok(!m.includes('Spike Researcher') && !m.includes('Staffing') && !m.includes('Progress Observer'), m.join(', '));
  assert.ok(m.includes('Product Manager') && m.includes('Delivery Manager') && m.includes('you'));
  assert.ok(m.some((r) => r.startsWith('Delivery Manager, who')), 'spikes go to the Delivery Manager without a Spike Researcher');
  const f = rows(full);
  for (const r of ['Spike Researcher', 'Staffing', 'Progress Observer']) assert.ok(f.includes(r), r);
  assert.ok(!applyRoleConditions(body, full).includes('<!--'), 'no markers are left');
});
