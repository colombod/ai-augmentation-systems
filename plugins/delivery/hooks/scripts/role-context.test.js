// hooks/scripts/role-context.test.js — run with: node --test hooks/scripts/role-context.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRoleMarker, composeForMarker, sessionStartText, promptSubmitText } = require('./role-context.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function scratchProjectRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-project-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function preparedRole(instance) {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

test('findRoleMarker returns null outside a role directory', () => {
  assert.equal(findRoleMarker(fs.mkdtempSync(path.join(os.tmpdir(), 'nomarker-'))), null);
});

test('findRoleMarker finds the marker from a subdirectory of the role dir', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const sub = path.join(roleDir, 'project', '.delivery');
  const found = findRoleMarker(sub);
  assert.equal(found.marker.instance, 'delivery-lead');
});

test('composeForMarker reflects a manifest change made after prepare', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  const teamFile = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  team.roles.push({ id: 'infra-vercel', brief: 'delivery/builder', host: 'pc', model: 'sonnet' });
  fs.writeFileSync(teamFile, JSON.stringify(team, null, 2));
  const { marker } = findRoleMarker(roleDir);
  const text = composeForMarker(marker, PLUGIN_ROOT);
  assert.ok(text.includes('| infra-vercel | pc | sonnet |'));
});

test('sessionStartText registers the session in the roster and returns the brief', () => {
  const { projectRoot, roleDir } = preparedRole('staffing');
  const text = sessionStartText({ cwd: roleDir, session_id: 'sess-1' }, PLUGIN_ROOT, { now: '2026-10-12T12:00:00Z', claim: () => null });
  assert.ok(text.startsWith('# Role: staffing'));
  const roster = JSON.parse(fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.equal(roster.instances.staffing.session_id, 'sess-1');
  assert.equal(roster.instances.staffing.last_seen, '2026-10-12T12:00:00Z');
});

test('sessionStartText is empty outside a role directory', () => {
  assert.equal(sessionStartText({ cwd: os.tmpdir(), session_id: 'x' }, PLUGIN_ROOT, { claim: () => null }), '');
});

test('promptSubmitText is one line with role and claim', () => {
  const { roleDir } = preparedRole('builder-2');
  const text = promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-12: Add login' });
  assert.equal(text, 'You are builder-2 (builder). Current claim: ex-12: Add login.');
  const idle = promptSubmitText({ cwd: roleDir }, { claim: () => null });
  assert.equal(idle, 'You are builder-2 (builder). Current claim: none (idle; say so and what you could take).');
});
