// hooks/scripts/send-guard-live.test.js — run with: node scripts/testing/run-tests.js
// hjx.1.6.13: a role session started by team-revive, a wake or by hand runs under a name Claude Code made
// up ("builder-92", "reality-checker-82"), not under <instance>@<team>, and Claude Code's SendMessage
// refuses any name with "@". The guard refused those generated names as bare role names, so no message
// reached a live role session. A name that exactly names a live session running in one of this team's
// role directories (holding that instance's marker for this project) is that session, whatever it is called.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest');

function teamWith(prefix, ...instances) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sgl-${prefix}-`));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  const team = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'team.json'), 'utf8'));
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'team', 'team.json'), JSON.stringify({ ...team, project: prefix, prefix }, null, 2));
  fs.copyFileSync(path.join(FIXTURE, 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), `sgl-${prefix}-team-`));
  for (const i of instances) prepareRole({ projectRoot, instance: i, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, teamDir, dir: (i) => path.join(teamDir, i) };
}
function sessionsDir(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgl-sessions-'));
  rows.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i + 1}.json`), JSON.stringify({ sessionId: `s${i}`, status: 'idle', ...r })));
  return dir;
}
const live = (cwd, name) => ({ pid: process.pid, cwd, name });
function hook(fromDir, instance, to, sessions) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DELIVERY_CLAUDE_SESSIONS_DIR: sessions, DELIVERY_ROLE: instance };
  delete env.DELIVERY_ROLE_DIR;
  const input = { cwd: fromDir, session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to, message: 'x' } };
  const r = spawnSync(process.execPath, [path.join(__dirname, 'send-guard.js')], { input: JSON.stringify(input), env, encoding: 'utf8' });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('the generated name of a live session in one of this team\'s role directories passes, as ListAgents prints it', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2', 'chief-of-staff');
  const s = sessionsDir([live(a.dir('builder-2'), 'builder-92'), live(a.dir('chief-of-staff'), 'chief-of-staff-bf')]);
  for (const to of ['builder-92', 'builder-92 [cb11c7]', 'chief-of-staff-bf']) {
    const d = hook(a.dir('builder-1'), 'builder-1', to, s);
    assert.ok(!d || d.permissionDecision !== 'deny', `${to}: ${JSON.stringify(d)}`);
    assert.ok(!d || !d.additionalContext, `${to}: no warning for a live session of this team: ${JSON.stringify(d)}`);
  }
});

test('a generated name another team\'s live session holds, or both teams hold, is refused from either side', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2');
  const b = teamWith('beta', 'builder-1', 'builder-2');
  const theirs = sessionsDir([live(b.dir('builder-2'), 'builder-92')]);
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-92', theirs).permissionDecision, 'deny');
  const both = sessionsDir([live(a.dir('builder-2'), 'builder-92'), live(b.dir('builder-2'), 'builder-92')]);
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-92', both).permissionDecision, 'deny');
  assert.equal(hook(b.dir('builder-1'), 'builder-1', 'builder-92', both).permissionDecision, 'deny');
});

test('a live session in a team directory that holds no marker of this project is not this team\'s', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2');
  // a directory beside ours, named like an instance, with no role marker at all
  const stray = path.join(a.teamDir, 'builder-3');
  fs.mkdirSync(stray);
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-38', sessionsDir([live(stray, 'builder-38')])).permissionDecision, 'deny');
  // a session elsewhere on the machine
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-38', sessionsDir([live(os.tmpdir(), 'builder-38')])).permissionDecision, 'deny');
});

test('an instance\'s directory whose marker names another project or another instance is not this team\'s', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2');
  const markerFile = path.join(a.dir('builder-2'), '.delivery-role.json');
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  const s = sessionsDir([live(a.dir('builder-2'), 'builder-92')]);
  assert.ok(!hook(a.dir('builder-1'), 'builder-1', 'builder-92', s), 'its own marker: ours');
  fs.writeFileSync(markerFile, JSON.stringify({ ...marker, project_root: fs.mkdtempSync(path.join(os.tmpdir(), 'sgl-other-')) }));
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-92', s).permissionDecision, 'deny', 'another project');
  fs.writeFileSync(markerFile, JSON.stringify({ ...marker, instance: 'builder-1' }));
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-92', s).permissionDecision, 'deny', 'another instance');
});

test('only an exact name passes: the start of a live session\'s name is still judged as a role name', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2');
  const s = sessionsDir([live(a.dir('builder-2'), 'builder-92')]);
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-9', s).permissionDecision, 'deny');
});

test('a dead session\'s generated name is not live, so it gets no pass', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2');
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  assert.equal(hook(a.dir('builder-1'), 'builder-1', 'builder-92', sessionsDir([{ pid: dead, cwd: a.dir('builder-2'), name: 'builder-92' }])).permissionDecision, 'deny');
});

test('after a restart every role of the team, under whatever name it came back with, can be sent to', () => {
  const M = require('../../scripts/lib/manifest.js');
  const team = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'team.json'), 'utf8'));
  const all = M.expandInstances(team).filter((i) => !(i.role && i.role.retired)).map((i) => i.instance);
  const a = teamWith('alpha', ...all);
  // the names Claude Code makes up: the directory's name and a short tag
  const named = all.map((i, n) => ({ instance: i, name: `${i}-${(n + 10).toString(16)}` }));
  const s = sessionsDir(named.map((x) => live(a.dir(x.instance), x.name)));
  const from = all[0];
  for (const x of named) {
    const d = hook(a.dir(from), from, x.name, s);
    assert.ok(!d || d.permissionDecision !== 'deny', `${x.instance} as ${x.name}: ${JSON.stringify(d)}`);
  }
});

test('a live session of this team named <instance>@<team> is offered by its socket, since SendMessage refuses "@"', () => {
  const a = teamWith('alpha', 'builder-1', 'staffing');
  const s = sessionsDir([{ ...live(a.dir('staffing'), 'staffing@alpha'), messagingSocketPath: '/run/x/42.sock' }]);
  const d = hook(a.dir('builder-1'), 'builder-1', 'builder-77', s);
  assert.match(d.permissionDecisionReason, /by the name to send to: uds:\/run\/x\/42\.sock \(staffing\)\./);
});

test('a refusal names this team\'s live sessions by the names a send reaches them by', () => {
  const a = teamWith('alpha', 'builder-1', 'builder-2', 'chief-of-staff');
  const b = teamWith('beta', 'builder-2');
  const s = sessionsDir([live(a.dir('builder-2'), 'builder-92'), live(a.dir('chief-of-staff'), 'chief-of-staff-bf'), live(b.dir('builder-2'), 'builder-77')]);
  const d = hook(a.dir('builder-1'), 'builder-1', 'builder-77', s);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /This team's live sessions, by the name to send to: builder-92 \(builder-2\), chief-of-staff-bf \(chief-of-staff\)\./);
  assert.doesNotMatch(d.permissionDecisionReason, /builder-77 \(/, 'the other team\'s session is not offered');
});
