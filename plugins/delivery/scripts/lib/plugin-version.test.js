// scripts/lib/plugin-version.test.js — run through scripts/testing/run-tests.js
// delivery-plugin-planning-8wz: after a plugin install, a role session resumed by the watchdog kept the
// old version's script paths and the new lane refused them; the owner had to restart sessions by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PV = require('./plugin-version.js');
const WD = require('./watchdog.js');
const { registerInstance } = require('./roster.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const NOW = PV.runningVersion(PLUGIN_ROOT);

test('8wz: the running version, version order, a version in commands, and a sibling version path', () => {
  assert.match(NOW, /^\d+\.\d+\.\d+$/);
  assert.equal(PV.compare('0.43.9', '0.43.20'), -1, 'numeric, not text, order');
  assert.equal(PV.compare('0.43.20', '0.43.20'), 0);
  assert.equal(PV.compare('1.0.0', '0.99.99'), 1);
  assert.equal(PV.compare(null, '0.43.20'), null);
  assert.equal(PV.versionInText('node /h/.claude/plugins/cache/m/delivery/0.43.12/scripts/a.js x\nnode /h/.claude/plugins/cache/m/delivery/0.43.13/scripts/b.js'), '0.43.13');
  assert.equal(PV.versionInText('node /src/checkout/delivery/scripts/a.js'), null, 'a development checkout names no version');
  const root = '/h/cache/m/delivery/0.43.20';
  assert.deepEqual(PV.otherVersionPath('/h/cache/m/delivery/0.43.18/scripts/operator.js', root), { version: '0.43.18', rest: 'scripts/operator.js', current: '/h/cache/m/delivery/0.43.20/scripts/operator.js' });
  assert.equal(PV.otherVersionPath('/h/cache/m/delivery/0.43.20/scripts/operator.js', root), null, 'the running version is not another one');
  assert.equal(PV.otherVersionPath('/h/cache/m/attractor/0.2.0/scripts/x.js', root), null, 'another plugin');
  assert.equal(PV.otherVersionPath('/h/cache/m/delivery/0.43.18/scripts/operator.js', '/src/checkout/delivery'), null, 'a development root has no siblings');
  assert.equal(PV.otherVersionPath('/src/checkout/1.2.3/scripts/a.js', '/src/checkout/delivery'), null, 'nor a versioned directory beside it');
});

const role = (over = {}) => {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-role-'));
  return { instance: 'delivery-lead', role: 'delivery-lead', session: 's-dm', roleDir, context: 50000, pluginVersion: '0.43.18', ...over };
};

test('8wz: a session that last ran an older plugin is woken fresh, not resumed; same, newer or unknown resumes', () => {
  const installed = '0.43.20';
  const s = role();
  try {
    const old = WD.wakeCommand(s, `${WD.WAKE_OPENING}: go`, [], 'auto', { installed });
    assert.equal(old.mode, 'fresh');
    assert.equal(old.why, 'plugin');
    assert.ok(!old.args.includes('--resume'), old.args.join(' '));
    assert.deepEqual(old.args.slice(0, 4), ['--permission-mode', 'auto', '--name', 'delivery-lead']);
    assert.ok(old.args[5].startsWith(`${WD.WAKE_OPENING}: You are delivery-lead, starting a fresh session`), old.args[5]);
    assert.match(old.args[5], /ran the delivery plugin 0\.43\.18, and 0\.43\.20 is installed now/);
    for (const v of ['0.43.20', '0.43.21', null]) {
      assert.equal(WD.wakeCommand({ ...s, pluginVersion: v }, 'go', [], 'auto', { installed }).mode, 'resume', String(v));
    }
    assert.equal(WD.wakeCommand(s, 'go', [], 'auto', {}).mode, 'resume', 'no installed version known: resume');
    // an open session is handed the wake as a message, never forked or started fresh beside it (one live
    // session per role, hjx.1.6.17), and a busy one is never touched: a running wake is not stopped
    assert.equal(WD.wakeCommand(s, 'go', [{ sessionId: 's-dm', status: 'idle' }], 'auto', { installed }).mode, 'message');
    assert.ok(WD.wakeCommand(s, 'go', [{ sessionId: 's-dm', status: 'busy' }], 'auto', { installed }).skip);
    // the heavy-context fresh wake keeps its own words
    assert.match(WD.wakeCommand({ ...s, pluginVersion: installed, context: 236000 }, 'go', [], 'auto', { installed }).args[5], /\(236k tokens\) is not loaded/);
  } finally { fs.rmSync(s.roleDir, { recursive: true, force: true }); }
});

test('8wz: the watchdog reads the version a session last ran from the roster, else from its own commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-proj-'));
  try {
    const roleDir = path.join(root, 'dm');
    fs.mkdirSync(roleDir);
    const transcript = path.join(root, 't.jsonl');
    const use = (cmd) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-01T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'u1', input: { command: cmd } }] } });
    fs.writeFileSync(transcript, `${use('node /h/cache/m/delivery/0.43.12/scripts/team-status.js')}\n${use('node /h/cache/m/delivery/0.43.13/scripts/plan.js select')}\n`);
    registerInstance(root, { instance: 'delivery-lead', session_id: 's-dm', host: 'pc', model: 'sonnet', role_dir: roleDir, now: '2026-11-01T10:00:00Z', transcript_path: transcript });
    const of = () => WD.sessions(root).find((x) => x.instance === 'delivery-lead').pluginVersion;
    assert.equal(of(), '0.43.13', 'no version recorded: the last plugin path the session ran');
    registerInstance(root, { instance: 'delivery-lead', session_id: 's-dm', host: 'pc', model: 'sonnet', role_dir: roleDir, now: '2026-11-01T11:00:00Z', transcript_path: transcript, plugin_version: '0.43.20' });
    assert.equal(of(), '0.43.20', 'the version its start recorded');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('8wz: the lane names the current path when it refuses a path to another installed version', () => {
  const { loadPolicy, decideLane } = require('../../hooks/scripts/lane.js');
  const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-lane-'));
  try {
    const cos = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
    const root = '/h/cache/m/delivery/0.43.20';
    const run = (command, pluginRoot = root) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: cos, roleDir, groups: GROUPS, pluginRoot, cwd: roleDir });
    assert.equal(run(`node ${root}/scripts/team-status.js`).allow, true, 'the running version passes');
    const old = run('node /h/cache/m/delivery/0.43.18/scripts/team-status.js --json');
    assert.equal(old.allow, false);
    assert.match(old.reason, /names the delivery plugin 0\.43\.18, and 0\.43\.20 is the version running now/);
    assert.ok(old.reason.includes(`Run the same command at the current plugin root: \`node ${root}/scripts/team-status.js --json\``), old.reason);
    // the corrected command is one the lane runs: the session can take it as given
    assert.equal(run(`node ${root}/scripts/team-status.js --json`).allow, true);
    // a script the lane would refuse at any version: the current path, and no invitation to run it
    const other = run('node /h/cache/m/delivery/0.43.18/scripts/materialise.js');
    assert.equal(other.allow, false);
    assert.match(other.reason, /which your lane does not run either/);
    assert.ok(!/Run the same command/.test(other.reason));
    // a refusal with no other version in it reads as before
    assert.ok(!/version running now/.test(run('node /elsewhere/scripts/team-status.js').reason));
    assert.ok(!/version running now/.test(run('node /h/cache/m/delivery/0.43.18/scripts/team-status.js', '/src/checkout/delivery').reason), 'a development root');
  } finally { fs.rmSync(roleDir, { recursive: true, force: true }); }
});
