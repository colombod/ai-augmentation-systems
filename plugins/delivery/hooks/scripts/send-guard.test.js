// hooks/scripts/send-guard.test.js — run with: node scripts/testing/run-tests.js
// Two teams on one host, with the same role names and different bead prefixes: a role session of team A
// reaches only team A's sessions, by their <instance>@<team> names.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { decideSend, judge } = require('./send-guard.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest');

// a project whose manifest is the fixture with `prefix`, and the role directory prepared for `instance`
// (and for each of `others`, in the same team directory)
function teamWith(prefix, instance, ...others) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `send-${prefix}-`));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  const team = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'team.json'), 'utf8'));
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'team', 'team.json'), JSON.stringify({ ...team, project: prefix, prefix }, null, 2));
  fs.copyFileSync(path.join(FIXTURE, 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), `send-${prefix}-team-`));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  for (const o of others) prepareRole({ projectRoot, instance: o, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir, teamDir, team: { ...team, project: prefix, prefix } };
}

// Claude Code's live-session records (~/.claude/sessions/<pid>.json); none by default
const EMPTY_SESSIONS = fs.mkdtempSync(path.join(os.tmpdir(), 'send-sessions-none-'));
function sessionsDir(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-sessions-'));
  // one file per record (the guard reads the pid inside, not the file name)
  rows.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i + 1}.json`), JSON.stringify({ sessionId: `s${i}`, status: 'idle', ...r })));
  return dir;
}
// a pid that ran and has ended
const DEAD = spawnSync(process.execPath, ['-e', '0']).pid;

function runHook(input, instance, sessions = EMPTY_SESSIONS) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DELIVERY_CLAUDE_SESSIONS_DIR: sessions };
  delete env.DELIVERY_ROLE_DIR;
  if (instance) env.DELIVERY_ROLE = instance; else delete env.DELIVERY_ROLE;
  return spawnSync(process.execPath, [path.join(__dirname, 'send-guard.js')], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8' });
}
const send = (cwd, to, tool = 'SendMessage') => ({ cwd, session_id: 's', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: tool === 'SendMessage' ? { to, message: 'joined: builder-1, idle' } : { session_id: to, message: 'x' } });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null);

test('two teams on one host: A\'s bare "chief-of-staff" and B\'s qualified name are refused from A, naming A\'s session; A\'s own qualified name passes', () => {
  const a = teamWith('alpha', 'builder-1');
  teamWith('beta', 'builder-1');
  const bare = decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1'));
  assert.equal(bare.permissionDecision, 'deny');
  assert.match(bare.permissionDecisionReason, /^"chief-of-staff" is a bare role name; session names are shared by every team on this machine/);
  assert.match(bare.permissionDecisionReason, /send to chief-of-staff@alpha\.$/);
  const other = decision(runHook(send(a.roleDir, 'chief-of-staff@beta'), 'builder-1'));
  assert.equal(other.permissionDecision, 'deny');
  assert.match(other.permissionDecisionReason, /^"chief-of-staff@beta" is a session of another team \(prefix beta\), not of this one \(alpha\)/);
  assert.match(other.permissionDecisionReason, /send to chief-of-staff@alpha\.$/);
  assert.equal(runHook(send(a.roleDir, 'chief-of-staff@alpha'), 'builder-1').stdout, '', 'this team\'s qualified name passes');
  assert.equal(runHook(send(a.roleDir, 'chief-of-staff@alpha- [ex-1]'), 'builder-1').stdout, '', 'a trailing "-" and a [ref] change nothing');
  // the session tool is guarded the same way
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff', 'mcp__ccd_session_mgmt__send_message'), 'builder-1')).permissionDecision, 'deny');
});

test('a bare instance, alias, steward or a role this team does not have is refused; names that are no role pass', () => {
  const { team } = teamWith('alpha', 'builder-1');
  const reason = (to) => { const d = judge(team, to, 'pc'); return d && d.reason; };
  assert.match(reason('builder-2 [ex-1]'), /^"builder-2" is a bare role name.*\nRole sessions are named <instance>@<team>: send to builder-2@alpha\.$/s);
  assert.match(reason('Delivery-Manager'), /send to delivery-lead@alpha\.$/);
  assert.match(reason('builder'), /no session of this team is "builder"; this team's sessions are chief-of-staff@alpha, .*builder-1@alpha, builder-2@alpha/);
  assert.match(reason('tech-writer'), /no session of this team is "tech-writer"/, 'a role another team on the host may run');
  assert.match(reason('builder-1@beta'), /another team \(prefix beta\).*send to builder-1@alpha\./s);
  for (const to of ['main', 'a1b2c3d4', 'researcher-agent', 'someone@example', 'builder-1@alpha', '*', '']) assert.equal(judge(team, to, 'pc'), null, to);
  assert.equal(judge({ ...team, prefix: '' }, 'chief-of-staff', 'pc'), null, 'a team with no prefix cannot qualify a name: inert');
});

test('inert outside a role session, with another session\'s marker, for another tool or a manifest that does not load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-none-'));
  assert.equal(runHook(send(dir, 'chief-of-staff'), undefined).stdout, '');
  const { projectRoot, roleDir } = teamWith('alpha', 'builder-2');
  assert.equal(runHook(send(roleDir, 'chief-of-staff'), 'someone-else').stdout, '', 'the marker belongs to another session');
  assert.equal(runHook({ ...send(roleDir, 'chief-of-staff'), tool_name: 'Agent' }, 'builder-2').stdout, '');
  const garbage = runHook('not json', 'builder-2');
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
  fs.rmSync(path.join(projectRoot, '.delivery', 'team', 'team.json'));
  assert.equal(runHook(send(roleDir, 'chief-of-staff'), 'builder-2').stdout, '');
  assert.equal(decideSend(null), null);
});

// TODO(delivery-plugin-planning-tqv.5): drop these with the bare-name fallback.
// Sessions started before qualified names still run under bare names: a bare send to one of this team's
// instances passes, with a warning, while every live session of that name is in that instance's role
// directory of this team. Anything else, or sessions that cannot be read, is refused.
test('transition: a bare name of our own instance passes with a warning only while its live sessions are all ours', () => {
  const a = teamWith('alpha', 'builder-1', 'chief-of-staff');
  const b = teamWith('beta', 'builder-1', 'chief-of-staff');
  const ourCos = path.join(a.teamDir, 'chief-of-staff');
  const theirCos = path.join(b.teamDir, 'chief-of-staff');
  const live = (cwd) => ({ pid: process.pid, cwd, name: 'chief-of-staff' });
  // ours alone, and a stale record of the same name in the other team (its pid has ended): allowed
  const ours = sessionsDir([live(ourCos), { pid: DEAD, cwd: theirCos, name: 'chief-of-staff' }]);
  const ok = JSON.parse(runHook(send(a.roleDir, 'chief-of-staff [ex-1]'), 'builder-1', ours).stdout);
  assert.equal(ok.hookSpecificOutput.permissionDecision, undefined, 'a warning, not a decision');
  assert.match(ok.hookSpecificOutput.additionalContext, /bare session name; allowed for now.*Send to chief-of-staff@alpha from now on/);
  assert.equal(ok.systemMessage, ok.hookSpecificOutput.additionalContext);
  // the scratch team's bare send while the live chief-of-staff is ours: refused, naming its own
  const fromB = decision(runHook(send(b.roleDir, 'chief-of-staff'), 'builder-1', ours));
  assert.equal(fromB.permissionDecision, 'deny');
  assert.match(fromB.permissionDecisionReason, /send to chief-of-staff@beta\.$/);
  // two live sessions of that name, one in each team: refused from both sides
  const both = sessionsDir([live(ourCos), live(theirCos)]);
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1', both)).permissionDecision, 'deny');
  assert.equal(decision(runHook(send(b.roleDir, 'chief-of-staff'), 'builder-1', both)).permissionDecision, 'deny');
  // a live one elsewhere on the machine (not a role directory): refused
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1', sessionsDir([live(ourCos), live(os.tmpdir())]))).permissionDecision, 'deny');
  // none live, no sessions directory, or a record that cannot be read: refused (fail closed)
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1', sessionsDir([{ pid: DEAD, cwd: ourCos, name: 'chief-of-staff' }]))).permissionDecision, 'deny');
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1', path.join(EMPTY_SESSIONS, 'missing'))).permissionDecision, 'deny');
  const broken = sessionsDir([live(ourCos)]);
  fs.writeFileSync(path.join(broken, '999999.json'), '{not json');
  assert.equal(decision(runHook(send(a.roleDir, 'chief-of-staff'), 'builder-1', broken)).permissionDecision, 'deny');
  // a name that is no instance of this team (an alias) gets no fallback, even with a live session of ours
  const dm = sessionsDir([{ pid: process.pid, cwd: ourCos, name: 'delivery-manager' }]);
  assert.equal(decision(runHook(send(a.roleDir, 'delivery-manager'), 'builder-1', dm)).permissionDecision, 'deny');
  // a display name ("Chief of Staff") is the role all the same, as a target and as a live session's name:
  // the scratch team's send to "Chief of Staff [a1fbfe]" is refused, ours passes with the warning
  const shown = sessionsDir([{ pid: process.pid, cwd: ourCos, name: 'Chief of Staff' }]);
  assert.equal(decision(runHook(send(b.roleDir, 'Chief of Staff [a1fbfe]'), 'builder-1', shown)).permissionDecision, 'deny');
  for (const to of ['Chief of Staff [a1fbfe]', 'chief-of-staff']) {
    const w = JSON.parse(runHook(send(a.roleDir, to), 'builder-1', shown).stdout);
    assert.match(w.hookSpecificOutput.additionalContext, /Send to chief-of-staff@alpha from now on/, to);
  }
});
