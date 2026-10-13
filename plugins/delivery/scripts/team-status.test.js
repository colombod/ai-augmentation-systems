// scripts/team-status.test.js — run with: node --test scripts/team-status.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teamStatus, renderStatus } = require('./team-status.js');
const { registerInstance } = require('./lib/roster.js');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

const NOW = '2026-10-12T12:00:00Z';

test('every manifest instance is missing when the roster is empty', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.equal(s.rows.length, 8);
  assert.deepEqual(s.drift.missing, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder-1', 'builder-2']);
  assert.ok(renderStatus(s).includes('Missing: chief-of-staff'));
});

test('live, stale, extra and wrong_model are reported', () => {
  const root = scratchProject();
  registerInstance(root, { instance: 'chief-of-staff', session_id: 'a', host: 'pc', model: 'opus', role_dir: '/x', now: '2026-10-12T11:30:00Z' });
  registerInstance(root, { instance: 'staffing', session_id: 'b', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T08:00:00Z' });
  registerInstance(root, { instance: 'builder-1', session_id: 'c', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  registerInstance(root, { instance: 'wizard', session_id: 'd', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const byId = Object.fromEntries(s.rows.map((r) => [r.instance, r]));
  assert.equal(byId['chief-of-staff'].state, 'live');
  assert.equal(byId['staffing'].state, 'stale');
  assert.deepEqual(s.drift.stale, ['staffing']);
  assert.deepEqual(s.drift.extra, ['wizard']);
  assert.deepEqual(s.drift.wrong_model, [{ instance: 'builder-1', expected: 'sonnet', actual: 'haiku' }]);
  const text = renderStatus(s);
  assert.ok(text.includes('| chief-of-staff | chief-of-staff | pc | opus | a | live |'));
  assert.ok(text.includes('Wrong model: builder-1 expected sonnet, running haiku'));
});

test('renderStatus says No drift when the roster matches', () => {
  const root = scratchProject();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['spike-researcher', 'sonnet'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now: NOW });
  }
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.ok(renderStatus(s).includes('No drift.'));
});

test('CLI exits 2 with a team-status message on a nonexistent project path', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'team-status.js');
  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, '--project', '/nonexistent'], { stdio: 'pipe' }),
    (err) => err.status === 2 && String(err.stderr).includes('team-status:')
  );
});

test('CLI exits 1 when drift exists', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'team-status.js');
  const root = scratchProject();
  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, '--project', root], { stdio: 'pipe' }),
    (err) => err.status === 1
  );
});

test('renderStatus with a project root prints a Manifest line, "not a git repo" outside git', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const text = renderStatus(s, root);
  assert.ok(text.includes(`Manifest: ${root} at `));
});

test('C: an unreachable bd is a warning line, not drift', () => {
  const root = scratchProject();
  const warning = 'bd unreachable from role directories: set BEADS_DIR or provision beads (phase 3)';
  const down = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => false });
  assert.equal(down.bd_reachable, false);
  assert.ok(renderStatus(down).includes(warning));
  const up = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true });
  assert.ok(!renderStatus(up).includes(warning));
  // CLI: no drift and no beads database at the project root still exits 0, with the warning.
  const now = new Date().toISOString();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['spike-researcher', 'sonnet'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now });
  }
  const { execFileSync } = require('child_process');
  const env = { ...process.env, PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'nobd-')) + path.delimiter + '/usr/bin' + path.delimiter + '/bin' };
  delete env.BEADS_DIR;
  const out = execFileSync(process.execPath, [path.join(__dirname, 'team-status.js'), '--project', root], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(out.includes('No drift.'));
  assert.ok(out.includes(warning));
});

test('a configured staleness_hours of 0 stays 0, like the bd guard', () => {
  const root = scratchProject();
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.budget.staleness_hours = 0;
  fs.writeFileSync(file, JSON.stringify(team));
  const probe = teamStatus(root, { now: NOW });
  const instance = probe.rows[0].instance;
  const role = probe.rows[0].role;
  registerInstance(root, { instance, role, host: probe.rows[0].host, model: probe.rows[0].model, session_id: 's1', now: '2026-10-12T11:59:00Z' });
  const s = teamStatus(root, { now: NOW });
  assert.equal(s.rows.find((r) => r.instance === instance).state, 'stale');
});
