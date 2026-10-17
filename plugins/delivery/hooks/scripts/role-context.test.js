// hooks/scripts/role-context.test.js — run with: node --test hooks/scripts/role-context.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRoleMarker, composeForMarker, sessionStartText, promptSubmitText } = require('./role-context.js');
const { expandInstances, loadManifest } = require('../../scripts/lib/manifest.js');
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

// Runs fn with DELIVERY_ROLE set the way prepare-role's settings.local.json sets it for a real session.
function withRole(instance, fn) {
  const prev = process.env.DELIVERY_ROLE;
  if (instance === undefined) delete process.env.DELIVERY_ROLE; else process.env.DELIVERY_ROLE = instance;
  try { return fn(); } finally { if (prev === undefined) delete process.env.DELIVERY_ROLE; else process.env.DELIVERY_ROLE = prev; }
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

test('sessionStartText registers the session in the roster and returns the short brief', () => {
  const { projectRoot, roleDir } = preparedRole('staffing');
  const text = withRole('staffing', () => sessionStartText({ cwd: roleDir, session_id: 'sess-1' }, PLUGIN_ROOT, { now: '2026-10-12T12:00:00Z', claim: () => null }));
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
  const text = withRole('builder-2', () => promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-12: Add login' }));
  assert.equal(text, 'You are builder-2 (builder). Current claim: ex-12: Add login.');
  assert.ok(fs.existsSync(path.join(roleDir, '.delivery-turn')), 'prompt-submit marks the turn start');
  const idle = withRole('builder-2', () => promptSubmitText({ cwd: roleDir }, { claim: () => null }));
  assert.equal(idle, 'You are builder-2 (builder). Current claim: none (idle; say so and what you could take).');
});

test('compaction restates the role through SessionStart', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const text = withRole('delivery-lead', () => sessionStartText({ cwd: roleDir, session_id: 's', source: 'compact' }, PLUGIN_ROOT, { claim: () => null }));
  assert.ok(text.startsWith('Context was compacted. Your role is restated below; it has not changed.'));
  assert.ok(text.includes('# Role: delivery-lead'));
});

test('sessionStartText stays under the 10,000 character cap for every instance and refreshes CLAUDE.local.md', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-team-'));
  const { team } = loadManifest(projectRoot);
  for (const { instance } of expandInstances(team)) {
    const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
    const brief = path.join(roleDir, 'CLAUDE.local.md');
    fs.writeFileSync(brief, 'SENTINEL');
    const text = withRole(instance, () => sessionStartText({ cwd: roleDir, session_id: 's', source: 'startup' }, PLUGIN_ROOT, { claim: () => null }));
    assert.ok(text.length < 10000, `${instance}: ${text.length}`);
    assert.ok(text.includes('| chief-of-staff | pc | opus |'));
    assert.ok(text.includes(`${roleDir}/CLAUDE.local.md; it is binding.`));
    const onDisk = fs.readFileSync(brief, 'utf8');
    assert.ok(!onDisk.includes('SENTINEL'));
    assert.ok(onDisk.startsWith('# Role:'));
  }
});

test('a marker whose project_root does not exist and DELIVERY_ROLE unset produces nothing and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-forged-'));
  const ghost = path.join(os.tmpdir(), `ctx-ghost-${process.pid}`, 'proj');
  fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ instance: 'staffing', role: 'staffing', project_root: ghost, host: 'pc', model: 'sonnet' }));
  assert.equal(withRole(undefined, () => sessionStartText({ cwd: dir, session_id: 's' }, PLUGIN_ROOT, { claim: () => null })), '');
  assert.equal(withRole(undefined, () => promptSubmitText({ cwd: dir }, { claim: () => null })), '');
  assert.ok(!fs.existsSync(path.dirname(ghost)));
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.local.md')));
});

test('DELIVERY_ROLE set but no manifest at project_root yields a one-line notice and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-nomanifest-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-empty-'));
  fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ instance: 'staffing', role: 'staffing', project_root: empty, host: 'pc', model: 'sonnet' }));
  const text = withRole('staffing', () => sessionStartText({ cwd: dir, session_id: 's' }, PLUGIN_ROOT, { claim: () => null }));
  assert.ok(text.startsWith(`Role staffing: cannot load the team manifest at ${empty} (`));
  assert.ok(text.trimEnd().endsWith('Tell the Chief of Staff.'));
  assert.equal(text.trimEnd().split('\n').length, 1);
  assert.deepEqual(fs.readdirSync(empty), []);
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.local.md')));
});

test('promptSubmitText touches last_seen when older than 5 minutes, not when recent', () => {
  const { projectRoot, roleDir } = preparedRole('staffing');
  const rosterFile = path.join(projectRoot, '.delivery', 'team', 'roster.json');
  const seed = (last_seen) => fs.writeFileSync(rosterFile, JSON.stringify({ instances: { staffing: { session_id: 's', host: 'pc', model: 'sonnet', role_dir: roleDir, joined_at: last_seen, last_seen } } }));
  const now = '2026-10-12T12:00:00.000Z';
  seed('2026-10-12T11:50:00.000Z');
  withRole('staffing', () => promptSubmitText({ cwd: roleDir }, { claim: () => null, now }));
  assert.equal(JSON.parse(fs.readFileSync(rosterFile, 'utf8')).instances.staffing.last_seen, now);
  seed('2026-10-12T11:59:00.000Z');
  withRole('staffing', () => promptSubmitText({ cwd: roleDir }, { claim: () => null, now }));
  assert.equal(JSON.parse(fs.readFileSync(rosterFile, 'utf8')).instances.staffing.last_seen, '2026-10-12T11:59:00.000Z');
});

test('currentClaim returns the id alone when the item has no title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebd-'));
  fs.writeFileSync(path.join(dir, 'bd'), '#!/bin/sh\necho \'[{"id":"ex-9"}]\'\n', { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${prev}`;
  try {
    assert.equal(require('./role-context.js').currentClaim('a@pc/x'), 'ex-9');
  } finally {
    process.env.PATH = prev;
  }
});

test('C: bdOptionsFor runs bd at the project root, defaults BEADS_DIR, falls back to the hook cwd', () => {
  const { bdOptionsFor } = require('./role-context.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-bd-'));
  const prev = process.env.BEADS_DIR;
  delete process.env.BEADS_DIR;
  try {
    let o = bdOptionsFor({ project_root: root }, '/elsewhere');
    assert.equal(o.cwd, root);
    assert.equal(o.env.BEADS_DIR, undefined);
    fs.mkdirSync(path.join(root, '.beads'));
    o = bdOptionsFor({ project_root: root }, '/elsewhere');
    assert.equal(o.env.BEADS_DIR, path.join(root, '.beads'));
    process.env.BEADS_DIR = '/custom/beads';
    assert.equal(bdOptionsFor({ project_root: root }, '/elsewhere').env.BEADS_DIR, '/custom/beads');
    delete process.env.BEADS_DIR;
    o = bdOptionsFor({ project_root: path.join(root, 'missing') }, '/elsewhere');
    assert.equal(o.cwd, '/elsewhere');
    assert.equal(o.env.BEADS_DIR, undefined);
  } finally {
    if (prev === undefined) delete process.env.BEADS_DIR; else process.env.BEADS_DIR = prev;
  }
});

// Final wave F: the marker is found through DELIVERY_ROLE_DIR when the session leaves its role directory.
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

test('F: findRoleMarker uses DELIVERY_ROLE_DIR from outside the role tree; inert without it', () => {
  const { validMarker } = require('./role-context.js');
  const { roleDir } = preparedRole('builder-1');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-outside-'));
  withEnv({ DELIVERY_ROLE: 'builder-1', DELIVERY_ROLE_DIR: roleDir }, () => {
    const found = findRoleMarker(outside);
    assert.equal(found.marker.instance, 'builder-1');
    assert.equal(found.markerFile, path.join(roleDir, '.delivery-role.json'));
    assert.equal(validMarker(found).roleDir, roleDir);
  });
  withEnv({ DELIVERY_ROLE: 'builder-1', DELIVERY_ROLE_DIR: undefined }, () => {
    assert.equal(findRoleMarker(outside), null);
  });
  // DELIVERY_ROLE unset, or a directory with no marker: walk up from cwd as before.
  withEnv({ DELIVERY_ROLE: undefined, DELIVERY_ROLE_DIR: roleDir }, () => {
    assert.equal(findRoleMarker(outside), null);
  });
  withEnv({ DELIVERY_ROLE: 'builder-1', DELIVERY_ROLE_DIR: outside }, () => {
    assert.equal(findRoleMarker(outside), null);
    assert.equal(findRoleMarker(path.join(roleDir, 'project')).marker.instance, 'builder-1');
  });
  // A marker found through the environment is still validated against DELIVERY_ROLE.
  withEnv({ DELIVERY_ROLE: 'builder-2', DELIVERY_ROLE_DIR: roleDir }, () => {
    assert.equal(validMarker(findRoleMarker(outside)), null);
  });
});

test('F: the lane hook judges a session that left its role directory', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-outside-'));
  const run = (env) => execFileSync(process.execPath, [path.join(__dirname, 'role-lane.js')], { input: JSON.stringify({ cwd: outside, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }), env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  assert.equal(JSON.parse(run({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: roleDir })).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: '' }), '');
});

// Operator decisions: capture runs first in the role hooks and never changes their own output.
test('promptSubmitText and sessionStartText append the capture note; a throwing capture changes nothing', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const pending = () => ({ added: 0, status: 'ok', pending: [{ id: 'in-pc-000004', text: 'phase 2 before phase 3' }] });
  const text = withRole('delivery-lead', () => promptSubmitText({ cwd: roleDir }, { claim: () => null, capture: pending }));
  assert.ok(text.startsWith('You are delivery-lead (delivery-lead). Current claim: none'));
  assert.match(text, /\nOperator inputs with no record yet: in-pc-000004 \("phase 2 before phase 3"\)\. See `node .*operator\.js pending`\.$/);
  const start = withRole('delivery-lead', () => sessionStartText({ cwd: roleDir, session_id: 's' }, PLUGIN_ROOT, { claim: () => null, capture: pending }));
  assert.ok(start.startsWith('# Role: delivery-lead'));
  assert.match(start, /Operator inputs with no record yet: in-pc-000004/);
  const boom = () => { throw new Error('boom'); };
  fs.rmSync(path.join(roleDir, '.delivery-last-claim'), { force: true }); // as if the claim just changed
  assert.equal(withRole('delivery-lead', () => promptSubmitText({ cwd: roleDir }, { claim: () => null, capture: boom })),
    'You are delivery-lead (delivery-lead). Current claim: none (idle; say so and what you could take).');
  // the role line repeats only when the claim changes (A2): the same idle claim says nothing new
  const quiet = () => ({ added: 0, status: 'ok', pending: [] });
  assert.equal(withRole('delivery-lead', () => promptSubmitText({ cwd: roleDir }, { claim: () => null, capture: quiet })), '');
  assert.equal(withRole('delivery-lead', () => promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-9: x', capture: quiet })),
    'You are delivery-lead (delivery-lead). Current claim: ex-9: x.');
});

test('promptSubmitText with an unloadable manifest still reports the capture problem; warn receives it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cap-nomanifest-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cap-empty-'));
  fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ instance: 'staffing', role: 'staffing', project_root: empty, host: 'pc', model: 'sonnet' }));
  const warned = [];
  const text = withRole('staffing', () => promptSubmitText({ cwd: dir, session_id: 's' }, { claim: () => null, warn: (m) => warned.push(m) }));
  assert.match(text, /^Operator capture: operator capture is off for staffing: \.delivery\/team\/team\.json cannot be loaded/);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^delivery: operator capture is off for staffing/);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('hardening e: startup and resume inject no role block when CLAUDE.local.md is current; a changed file or clear/compact restates it', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const brief = path.join(roleDir, 'CLAUDE.local.md');
  for (const source of ['startup', 'resume']) {
    const text = withRole('delivery-lead', () => sessionStartText({ cwd: roleDir, session_id: 's', source }, PLUGIN_ROOT, { claim: () => null }));
    assert.ok(!text.includes('# Role: delivery-lead'), `${source}: ${text}`);
    assert.match(text, /^You hold no claim\./);
  }
  // the manifest changed since the file was written: the loaded copy is stale, so restate and say re-read
  fs.writeFileSync(brief, fs.readFileSync(brief, 'utf8') + '\nstale line\n');
  const changed = withRole('delivery-lead', () => sessionStartText({ cwd: roleDir, session_id: 's', source: 'startup' }, PLUGIN_ROOT, { claim: () => null }));
  assert.match(changed, /CLAUDE\.local\.md was rewritten at this start .* re-read it now/);
  assert.ok(changed.includes('# Role: delivery-lead'));
  assert.ok(!fs.readFileSync(brief, 'utf8').includes('stale line'), 'the file is rewritten');
  for (const source of ['clear', 'compact']) {
    const text = withRole('delivery-lead', () => sessionStartText({ cwd: roleDir, session_id: 's', source }, PLUGIN_ROOT, { claim: () => null }));
    assert.ok(text.includes('# Role: delivery-lead'), source);
  }
});
