// hooks/scripts/setup-guard.test.js — the setup guard binds every session on the host: temp-location
// changes are refused (record or not), other ruled-on machine setup is refused naming its record, and
// the refusal never sends the session to the operator. Run with: scripts/testing/run-tests.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const S = require('./setup.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const HOME = '/hm/u';
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const TEMP_DEC = { id: 'dec-chief-of-staff-000014', kind: 'decision', statement: 'Standing rule: the team never leaves files in /tmp and never fills shared storage. Tests must run in a sealed, capped private /tmp. No relocating temp files elsewhere.' };
const RULE_DEC = { id: 'dec-chief-of-staff-000155', kind: 'decision', statement: 'Any session must check recorded operator decisions before changing machine settings or where files go.' };
const PROXY_DEC = { id: 'dec-chief-of-staff-000300', kind: 'decision', statement: 'Sessions on this host use HTTPS_PROXY as set by the machine setup; it is not changed per session.' };
const PERM_DEC = { id: 'dec-chief-of-staff-000301', kind: 'decision', statement: 'The permissions of role sessions are written by prepare-role only.' };
const REBOOT_DEC = { id: 'dec-chief-of-staff-000211', kind: 'decision', statement: 'Wintermute is a server: never rely on a restart to clear team leftovers.' };
const RECORDS = [TEMP_DEC, RULE_DEC, PROXY_DEC, PERM_DEC, REBOOT_DEC];

const ROLE_SETTINGS = '/hm/u/team/builder/.claude/settings.local.json';
const BEFORE = JSON.stringify({ env: { DELIVERY_ROLE: 'builder' }, enabledPlugins: { 'delivery@ai-augmentation-systems': true } }, null, 2);
const files = (map) => (f) => { if (Object.prototype.hasOwnProperty.call(map, f)) return map[f]; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
const decide = (toolName, toolInput, over = {}) => S.decideSetup({ toolName, toolInput, cwd: '/hm/u/work', home: HOME, env: {}, readFile: files({ [ROLE_SETTINGS]: BEFORE, '/hm/u/.bashrc': 'export PATH=/usr/bin\n', '/hm/u/.claude/settings.json': BEFORE }), records: RECORDS, ...over });
const bash = (command, over) => decide('Bash', { command }, over);

// The reason may say "do not ask the operator", and nothing else that sends the session to them.
function assertNoOperatorAsk(reason) {
  const rest = reason.replace(/do not ask the operator/g, '');
  assert.doesNotMatch(rest, /ask the operator|ask the owner|operator.*approv|owner.*approv|ask (?:the )?(?:user|human)/i, reason);
}

// ---- temp location: the incident and its relatives ----

test('the incident: adding TMPDIR to a role settings.local.json is refused, naming the operator records', () => {
  const after = JSON.stringify({ env: { DELIVERY_ROLE: 'builder', TMPDIR: '/hm/u/.cache/delivery-team-tmp' }, enabledPlugins: { 'delivery@ai-augmentation-systems': true } }, null, 2);
  const w = decide('Write', { file_path: ROLE_SETTINGS, content: after });
  assert.ok(w, 'Write refused');
  assert.match(w.reason, /^Refused: this changes where temp files go \(TMPDIR in \/hm\/u\/team\/builder\/\.claude\/settings\.local\.json\)/);
  assert.match(w.reason, /dec-chief-of-staff-000014 "Standing rule/);
  assert.match(w.reason, /not a session's call \(dec-chief-of-staff-000155\)/);
  assert.match(w.reason, /message the Chief of Staff with the record id \(dec-chief-of-staff-000014\); do not ask the operator\./);
  assertNoOperatorAsk(w.reason);
  const e = decide('Edit', { file_path: ROLE_SETTINGS, old_string: '"DELIVERY_ROLE": "builder"', new_string: '"DELIVERY_ROLE": "builder",\n    "TMPDIR": "/hm/u/.cache/delivery-team-tmp"' });
  assert.ok(e && /TMPDIR/.test(e.reason) && /dec-chief-of-staff-000014/.test(e.reason), 'Edit refused');
  const me = decide('MultiEdit', { file_path: ROLE_SETTINGS, edits: [{ old_string: '"builder"', new_string: '"builder", "TMPDIR": "/x"' }] });
  assert.ok(me && /TMPDIR/.test(me.reason), 'MultiEdit refused');
});

test('the record that rules on the location is cited first, ahead of a newer one that only mentions temp files', () => {
  const newer = { id: 'dec-chief-of-staff-000213', kind: 'decision', statement: 'Disk and temp-file growth from team runs is a defect to prevent.' };
  const d = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { records: [newer, TEMP_DEC] });
  assert.match(d.reason, /ruled on it: dec-chief-of-staff-000014 .*; dec-chief-of-staff-000213/);
  assert.match(d.reason, /record id \(dec-chief-of-staff-000014\)/);
});

test('CLAUDE_CODE_TMPDIR, TMP and TEMP are temp locations too; a changed value is refused like a new one', () => {
  for (const k of ['CLAUDE_CODE_TMPDIR', 'TMP', 'TEMP', 'TEMPDIR']) {
    const d = decide('Write', { file_path: '/hm/u/.claude/settings.json', content: JSON.stringify({ env: { [k]: '/x' } }) });
    assert.ok(d && d.reason.includes(`(${k} in /hm/u/.claude/settings.json)`), k);
  }
  const prev = JSON.stringify({ env: { TMPDIR: '/a' } });
  const changed = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { TMPDIR: '/b' } }) }, { readFile: () => prev });
  assert.ok(changed, 'a changed TMPDIR value is refused');
  const unchanged = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { TMPDIR: '/a' }, theme: 'dark' }) }, { readFile: () => prev });
  assert.equal(unchanged, null, 'an untouched TMPDIR beside another edit is allowed');
});

test('temp location is refused with no records at all (a hard rule), still pointing at the Chief of Staff only', () => {
  const d = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { records: [] });
  assert.ok(d);
  assert.match(d.reason, /temp files are not relocated/);
  assert.match(d.reason, /message the Chief of Staff; do not ask the operator\.$/);
  assert.doesNotMatch(d.reason, /dec-/);
  const thrown = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { records: () => { throw new Error('store broken'); } });
  assert.ok(thrown, 'a records lookup that throws still refuses');
  assertNoOperatorAsk(d.reason);
});

test('removing TMPDIR (how it was reverted) is allowed, by Write, Edit, jq del and sed delete', () => {
  const prev = JSON.stringify({ env: { DELIVERY_ROLE: 'builder', TMPDIR: '/hm/u/.cache/delivery-team-tmp' } }, null, 2);
  const rf = () => prev;
  assert.equal(decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ env: { DELIVERY_ROLE: 'builder' } }) }, { readFile: rf }), null);
  assert.equal(decide('Edit', { file_path: ROLE_SETTINGS, old_string: ',\n    "TMPDIR": "/hm/u/.cache/delivery-team-tmp"', new_string: '' }, { readFile: rf }), null);
  assert.equal(bash(`jq 'del(.env.TMPDIR)' ${ROLE_SETTINGS} > x.json && mv x.json ${ROLE_SETTINGS}`), null);
  assert.equal(bash("sed -i '/TMPDIR/d' ~/.bashrc"), null);
});

test('an unparsable settings file that gains a temp name is refused; one without is left alone', () => {
  assert.ok(decide('Write', { file_path: ROLE_SETTINGS, content: '{ "env": { "TMPDIR": "/x", } ' }));
  assert.equal(decide('Write', { file_path: ROLE_SETTINGS, content: '{ "env": { "FOO": ' }), null);
});

test('shell and session environment files: a temp assignment is refused, a removal or other line allowed', () => {
  for (const line of ['export TMPDIR=/hm/u/.cache/t', 'TMPDIR=/x', 'setenv TMPDIR /x', 'set -gx TMPDIR /x']) {
    const d = decide('Edit', { file_path: '/hm/u/.bashrc', old_string: 'export PATH=/usr/bin', new_string: `export PATH=/usr/bin\n${line}` });
    assert.ok(d && /TMPDIR in \/hm\/u\/\.bashrc/.test(d.reason), line);
  }
  assert.ok(decide('Write', { file_path: '/hm/u/.config/environment.d/50-tmp.conf', content: 'TMPDIR=/x\n' }));
  assert.ok(decide('Write', { file_path: '/hm/u/.config/systemd/user/foo.service', content: '[Service]\nEnvironment=TMPDIR=/x\n' }));
  assert.ok(decide('Write', { file_path: '/etc/environment', content: 'TMP=/x\n' }));
  assert.ok(decide('Write', { file_path: '/etc/profile.d/tmp.sh', content: 'export TEMP=/x\n' }));
  assert.equal(decide('Write', { file_path: '/hm/u/.bashrc', content: '' }, { readFile: () => 'export TMPDIR=/x\n' }), null, 'removing it');
  assert.equal(decide('Edit', { file_path: '/hm/u/.bashrc', old_string: 'export PATH=/usr/bin', new_string: 'export PATH=/usr/bin\nalias ll="ls -l"' }), null, 'an alias');
  assert.equal(decide('Write', { file_path: '/hm/u/work/notes.sh', content: 'export TMPDIR=/x\n' }), null, 'a script that is not a session environment file');
  assert.equal(decide('Write', { file_path: '/hm/u/work/settings.json', content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { readFile: () => '{}' }), null, 'a settings.json outside .claude');
});

test('shell commands that persist a temp location are refused', () => {
  const refused = [
    'systemctl --user set-environment TMPDIR=/x',
    'systemctl --user import-environment TMPDIR',
    'launchctl setenv TMPDIR /x',
    'echo "export TMPDIR=/x" >> ~/.bashrc',
    'echo "TMPDIR=/x" | tee -a ~/.profile',
    "sed -i 's/^#TMPDIR=.*/TMPDIR=\\/x/' /hm/u/.zshrc",
    `jq '.env.TMPDIR = "/x"' ${ROLE_SETTINGS} > /hm/u/s.json && mv /hm/u/s.json ${ROLE_SETTINGS}`,
    `python3 -c "import json;p='${ROLE_SETTINGS}';d=json.load(open(p));d['env']['TMPDIR']='/x';json.dump(d,open(p,'w'))"`,
    'echo "export CLAUDE_CODE_TMPDIR=/x" >> "$CLAUDE_ENV_FILE"',
    'claude config set -g env.TMPDIR /x',
  ];
  for (const c of refused) {
    const d = bash(c);
    assert.ok(d && /^Refused: this changes where temp files go/.test(d.reason), c);
    assertNoOperatorAsk(d.reason);
  }
  assert.ok(decide('PowerShell', { command: 'setx TMP C:\\x' }), 'setx');
  assert.ok(decide('PowerShell', { command: "[Environment]::SetEnvironmentVariable('TEMP', 'C:\\x', 'User')" }), 'SetEnvironmentVariable');
  assert.ok(decide('Monitor', { command: 'systemctl --user set-environment TMPDIR=/x' }), 'Monitor too');
});

test('one-off and read-only temp commands are allowed', () => {
  for (const c of [
    'TMPDIR=/x node foo.js',
    'echo $TMPDIR',
    'grep TMPDIR ~/.bashrc',
    'grep TMPDIR= ~/.bashrc > /hm/u/work/found.txt',
    `cat ${ROLE_SETTINGS}`,
    `jq .env.TMPDIR ${ROLE_SETTINGS}`,
    'export TMPDIR=/x; make test',
    'systemctl --user show-environment | grep TMPDIR',
    'systemctl --user restart delivery-watchdog-abc.service',
    'ls /tmp',
  ]) assert.equal(bash(c), null, c);
  assert.equal(decide('PowerShell', { command: '$env:TMP = "C:\\x"; npm test' }), null, 'a PowerShell session variable');
});

// ---- other machine setup the operator ruled on ----

test('a settings env key named by a decision is refused naming it; one no decision names is allowed', () => {
  const d = decide('Edit', { file_path: ROLE_SETTINGS, old_string: '"DELIVERY_ROLE": "builder"', new_string: '"DELIVERY_ROLE": "builder", "HTTPS_PROXY": "http://p:1"' });
  assert.ok(d);
  assert.match(d.reason, /^Refused: this changes HTTPS_PROXY in .*settings\.local\.json, machine setup the operator ruled on: dec-chief-of-staff-000300 "Sessions on this host use HTTPS_PROXY/);
  assert.match(d.reason, /record id \(dec-chief-of-staff-000300\); do not ask the operator\.$/);
  assertNoOperatorAsk(d.reason);
  assert.equal(decide('Edit', { file_path: ROLE_SETTINGS, old_string: '"DELIVERY_ROLE": "builder"', new_string: '"DELIVERY_ROLE": "builder", "FOO_BAR": "1"' }), null, 'unnamed env key');
  assert.equal(decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ ...JSON.parse(BEFORE), theme: 'dark' }) }), null, 'an unnamed top-level key');
  assert.equal(decide('Edit', { file_path: ROLE_SETTINGS, old_string: '"DELIVERY_ROLE": "builder"', new_string: '"DELIVERY_ROLE": "builder", "https_proxy": "x"' }), null, 'an env-like key matches case-sensitively');
});

test('a settings top-level key named by a decision is refused; a short key never matches by accident', () => {
  const d = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ ...JSON.parse(BEFORE), permissions: { allow: ['Bash(*)'] } }) });
  assert.ok(d && /changes permissions in .* dec-chief-of-staff-000301/.test(d.reason));
  assert.equal(S.keyMatcher('ui'), null);
  assert.ok(S.keyMatcher('Permissions').test('the permissions of'));
});

test('a record of another kind or an inferred answer does not refuse; a settled answer does', () => {
  const edit = { file_path: ROLE_SETTINGS, old_string: '"DELIVERY_ROLE": "builder"', new_string: '"DELIVERY_ROLE": "builder", "HTTPS_PROXY": "x"' };
  assert.equal(decide('Edit', edit, { records: [{ ...PROXY_DEC, kind: 'delegation' }] }), null);
  assert.equal(decide('Edit', edit, { records: [{ ...PROXY_DEC, id: 'ans-1', kind: 'answer', confidence: 'inferred' }] }), null);
  assert.ok(decide('Edit', edit, { records: [{ ...PROXY_DEC, id: 'ans-2', kind: 'answer', confidence: 'settled' }] }));
});

test('an env file assignment named by a decision is refused; a persistent session-manager variable too', () => {
  assert.ok(decide('Edit', { file_path: '/hm/u/.bashrc', old_string: 'export PATH=/usr/bin', new_string: 'export PATH=/usr/bin\nexport HTTPS_PROXY=http://p' }));
  const s = bash('systemctl --user set-environment HTTPS_PROXY=http://p');
  assert.ok(s && /HTTPS_PROXY in the persistent user environment/.test(s.reason));
  assert.equal(bash('systemctl --user set-environment FOO=1'), null);
});

test('disabling the delivery plugin is refused; removing it from a project file is allowed', () => {
  const off = { ...JSON.parse(BEFORE), enabledPlugins: { 'delivery@ai-augmentation-systems': false } };
  const d = decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify(off) });
  assert.ok(d && /disables the delivery plugin/.test(d.reason));
  assertNoOperatorAsk(d.reason);
  const gone = { env: { DELIVERY_ROLE: 'builder' }, enabledPlugins: {} };
  assert.ok(decide('Write', { file_path: '/hm/u/.claude/settings.json', content: JSON.stringify(gone) }), 'removed at user scope');
  assert.equal(decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify(gone) }), null, 'removed from a project file');
  assert.equal(decide('Write', { file_path: ROLE_SETTINGS, content: JSON.stringify({ ...JSON.parse(BEFORE), enabledPlugins: { 'delivery@ai-augmentation-systems': true, 'other@x': false } }) }), null, 'another plugin');
});

test('a reboot is refused when a record rules out relying on a restart, allowed when none does', () => {
  for (const c of ['sudo reboot', 'reboot', 'systemctl reboot', 'shutdown -r now']) {
    const d = bash(c);
    assert.ok(d && /restarts the machine.*dec-chief-of-staff-000211/.test(d.reason), c);
  }
  assert.equal(bash('sudo reboot', { records: [TEMP_DEC, { id: 'dec-x', kind: 'decision', statement: 'Install the release, and restart the team onto it.' }] }), null);
  assert.equal(bash('echo reboot later'), null);
});

test('ordinary writes and commands never read the records', () => {
  let reads = 0;
  const records = () => { reads++; return RECORDS; };
  decide('Write', { file_path: '/hm/u/work/a.js', content: 'TMPDIR=1' }, { records });
  decide('Bash', { command: 'npm test' }, { records });
  decide('Edit', { file_path: ROLE_SETTINGS, old_string: '"builder"', new_string: '"builder"' }, { records });
  assert.equal(reads, 0);
});

test('projectRoots finds the role project, the watchdog units and DELIVERY_PROJECTS', () => {
  const home = mk('setup-home-');
  const units = path.join(home, '.config', 'systemd', 'user');
  fs.mkdirSync(units, { recursive: true });
  fs.writeFileSync(path.join(units, 'delivery-watchdog-0a1b2c3d.service'), '[Service]\nWorkingDirectory=/srv/p%%1\nExecStart=/usr/bin/env "node" "/srv/p%%1/job.js"\n');
  fs.writeFileSync(path.join(units, 'other.service'), '[Service]\nWorkingDirectory=/srv/no\n');
  const agents = path.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'com.delivery-plugin.watchdog.0a1b2c3d.plist'), '<dict><key>WorkingDirectory</key><string>/srv/a&amp;b</string></dict>');
  const roleDir = mk('setup-role-');
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), JSON.stringify({ instance: 'builder', project_root: '/srv/role' }));
  const saved = process.env.DELIVERY_ROLE_DIR;
  delete process.env.DELIVERY_ROLE_DIR;
  try {
    assert.deepEqual(S.projectRoots({ cwd: roleDir, home, env: { DELIVERY_PROJECTS: ['/srv/e', 'relative'].join(path.delimiter) } }), ['/srv/role', '/srv/p%1', '/srv/a&b', '/srv/e']);
  } finally { if (saved !== undefined) process.env.DELIVERY_ROLE_DIR = saved; }
});

test('the fail-safe recognises a settings file plus a temp name, and nothing else', () => {
  const ctx = { cwd: '/hm/u', home: HOME, env: {} };
  assert.equal(S.obviousTempSettings({ file_path: ROLE_SETTINGS, content: '"TMPDIR"' }, ctx), true);
  assert.equal(S.obviousTempSettings({ file_path: ROLE_SETTINGS, content: '"FOO"' }, ctx), false);
  assert.equal(S.obviousTempSettings({ file_path: '/hm/u/a.js', content: 'TMPDIR' }, ctx), false);
  assert.equal(S.obviousTempSettings({ command: `echo TMPDIR >> ${ROLE_SETTINGS}` }, ctx), true);
});

// ---- the hook, end to end ----

function runHook(input, env = {}) {
  const e = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
  return spawnSync(process.execPath, [path.join(__dirname, 'setup-guard.js')], { input: typeof input === 'string' ? input : JSON.stringify(input), env: e, encoding: 'utf8' });
}
const denial = (r) => { assert.equal(r.status, 0); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null; };

// A project with real operator records: a captured operator input and a decision citing it.
function recordsProject() {
  const log = require('../../scripts/lib/operator-log.js');
  const R = require('../../scripts/lib/operator-records.js');
  const root = mk('setup-proj-');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'x', prefix: 'x', bd_host: 'pc', roles: [{ id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus' }] }));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
  const tr = path.join(mk('setup-tr-'), 't.jsonl');
  const said = 'The team never leaves files in /tmp; no relocating temp files elsewhere.';
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p1', uuid: 'u1', timestamp: '2099-10-13T10:00:01.000Z', sessionId: 'S', message: { role: 'user', content: said } }) + '\n');
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: 'S', instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc', now: new Date('2026-10-13T12:00:00Z') });
  const by = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: 'S', host: 'pc' };
  const dec = R.recordDecision({ projectRoot: root, cite: 'in-pc-000001', quote: said, statement: 'Standing rule: the team never leaves files in /tmp. No relocating temp files elsewhere.', scope: { beads: [], labels: [], initiatives: [] }, by });
  return { root, id: dec.id };
}

function preparedRole(instance) {
  const projectRoot = mk('setup-rproj-');
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  const teamDir = mk('setup-team-');
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const incident = (cwd, file) => ({ cwd, session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: '"env": {', new_string: '"env": {\n    "TMPDIR": "/hm/u/.cache/delivery-team-tmp",' } });
const NO_ROLE = { DELIVERY_ROLE: undefined, DELIVERY_ROLE_DIR: undefined };

test('end to end: a session that is no team role is refused the incident, naming the record', () => {
  const { root, id } = recordsProject();
  const home = mk('setup-h-');
  const target = path.join(mk('setup-t-'), 'builder', '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ env: { DELIVERY_ROLE: 'builder' } }, null, 2));
  const plain = mk('setup-plain-');
  const d = denial(runHook(incident(plain, target), { HOME: home, DELIVERY_PROJECTS: root, ...NO_ROLE }));
  assert.equal(d.permissionDecision, 'deny');
  assert.ok(d.permissionDecisionReason.includes(`(TMPDIR in ${target})`), d.permissionDecisionReason);
  assert.ok(d.permissionDecisionReason.includes(`${id} "Standing rule`), d.permissionDecisionReason);
  assertNoOperatorAsk(d.permissionDecisionReason);
  // with no record to read, still refused
  const bare = denial(runHook(incident(plain, target), { HOME: home, DELIVERY_PROJECTS: undefined, ...NO_ROLE }));
  assert.equal(bare.permissionDecision, 'deny');
  assert.doesNotMatch(bare.permissionDecisionReason, /dec-/);
  // an ordinary edit of that file, and a one-off temp variable on a command, pass
  const ok = runHook({ ...incident(plain, target), tool_input: { file_path: target, old_string: '"env": {', new_string: '"env": {\n    "FOO": "1",' } }, { HOME: home, DELIVERY_PROJECTS: root, ...NO_ROLE });
  assert.equal(ok.stdout, '');
  assert.equal(runHook({ cwd: plain, session_id: 's', tool_name: 'Bash', tool_input: { command: 'TMPDIR=/x node foo.js' } }, { HOME: home, ...NO_ROLE }).stdout, '');
});

test('end to end: a role session is refused the incident on its own settings, the records named', () => {
  const { roleDir } = preparedRole('builder-1');
  const { root, id } = recordsProject();
  const home = mk('setup-h-');
  const target = path.join(roleDir, '.claude', 'settings.local.json');
  const before = JSON.parse(fs.readFileSync(target, 'utf8'));
  const content = JSON.stringify({ ...before, env: { ...(before.env || {}), TMPDIR: '/hm/u/.cache/delivery-team-tmp' } });
  const d = denial(runHook({ cwd: roleDir, session_id: 's', tool_name: 'Write', tool_input: { file_path: target, content } },
    { HOME: home, DELIVERY_ROLE: 'builder-1', DELIVERY_ROLE_DIR: roleDir, DELIVERY_PROJECTS: root }));
  assert.equal(d.permissionDecision, 'deny');
  assert.ok(d.permissionDecisionReason.includes(id), d.permissionDecisionReason);
  assertNoOperatorAsk(d.permissionDecisionReason);
});

test('end to end: garbage input and an unrelated tool leave the hook silent', () => {
  assert.equal(runHook('not json').stdout, '');
  assert.equal(runHook({ cwd: '/', tool_name: 'Read', tool_input: { file_path: '/etc/environment' } }).stdout, '');
});

test('hooks.json routes write and shell tools to the setup guard', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entry = hooks.PreToolUse.find((e) => e.hooks.some((h) => (h.args || []).some((a) => a.endsWith('setup-guard.js'))));
  assert.ok(entry, 'setup-guard.js is wired');
  const re = new RegExp(entry.matcher);
  for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Monitor', 'PowerShell']) assert.ok(re.test(t), t);
  for (const t of ['TodoWrite', 'Read', 'MyBash', 'EditX', 'mcp__github__create_issue']) assert.ok(!re.test(t), t);
  assert.equal(entry.hooks[0].command, 'node');
  assert.equal(entry.hooks[0].timeout, 10);
});
