// scripts/lib/user-guard.test.js — the user-level setup guard: installed idempotently into a config
// dir's settings.json beside whatever else is there, its launcher runs the plugin's guard (or, with no
// plugin, its own fallback), and the host job installs it every cycle but never from a test run.
// Every test uses a fixture config dir, never the real one. Run with: scripts/testing/run-tests.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const UG = require('./user-guard.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const OTHER = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };

test('install writes the launcher and the three hook entries, keeping every other key and hook', () => {
  const cfg = mk('ug-cfg-');
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ model: 'opus', env: { FOO: '1' }, hooks: { PreToolUse: [OTHER], Stop: [OTHER] } }));
  const r = UG.ensureUserGuard({ configDir: cfg, pluginRoot: PLUGIN_ROOT });
  assert.equal(r.changed, true);
  const launcher = path.join(cfg, 'delivery', 'bin', 'setup-guard.js');
  assert.ok(fs.statSync(launcher).mode & 0o100, 'executable');
  const s = readJ(path.join(cfg, 'settings.json'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.env, { FOO: '1' });
  assert.deepEqual(s.hooks.Stop, [OTHER]);
  assert.deepEqual(s.hooks.PreToolUse[0], OTHER);
  for (const ev of UG.EVENTS) {
    const mine = s.hooks[ev].filter((e) => JSON.stringify(e).includes('delivery/bin/setup-guard.js'));
    assert.equal(mine.length, 1, ev);
    assert.equal(mine[0].matcher, UG.MATCHER);
    assert.equal(mine[0].hooks[0].command, `node ${JSON.stringify(launcher)}`);
  }
});

test('install is idempotent: a second run changes nothing, byte for byte', () => {
  const cfg = mk('ug-cfg-');
  UG.ensureUserGuard({ configDir: cfg, pluginRoot: PLUGIN_ROOT });
  const f = path.join(cfg, 'settings.json');
  const text = fs.readFileSync(f, 'utf8');
  const launcher = fs.readFileSync(UG.launcherPath(cfg), 'utf8');
  const again = UG.ensureUserGuard({ configDir: cfg, pluginRoot: PLUGIN_ROOT });
  assert.deepEqual(again, { changed: false, line: null });
  assert.equal(fs.readFileSync(f, 'utf8'), text);
  assert.equal(fs.readFileSync(UG.launcherPath(cfg), 'utf8'), launcher);
});

test('an entry of ours for another path is replaced; an unparsable settings.json is left alone', () => {
  const cfg = mk('ug-cfg-');
  const stale = { matcher: UG.MATCHER, hooks: [{ type: 'command', command: 'node "/old/delivery/bin/setup-guard.js"' }] };
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [stale, OTHER] } }));
  UG.ensureUserGuard({ configDir: cfg, pluginRoot: PLUGIN_ROOT });
  const pre = readJ(path.join(cfg, 'settings.json')).hooks.PreToolUse;
  assert.equal(pre.length, 2);
  assert.deepEqual(pre[0], OTHER);
  assert.ok(pre[1].hooks[0].command.includes(cfg));
  const bad = mk('ug-bad-');
  fs.writeFileSync(path.join(bad, 'settings.json'), '{ not json');
  const r = UG.ensureUserGuard({ configDir: bad, pluginRoot: PLUGIN_ROOT });
  assert.match(r.line, /does not parse/);
  assert.equal(fs.readFileSync(path.join(bad, 'settings.json'), 'utf8'), '{ not json');
});

const incident = (file) => JSON.stringify({ session_id: 's', tool_use_id: 't', hook_event_name: 'PreToolUse', cwd: '/', tool_name: 'Write', tool_input: { file_path: file, content: JSON.stringify({ env: { TMPDIR: '/x' } }) } });
function runLauncher(cfg, input, home) {
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_DATA: mk('ug-data-') };
  delete env.DELIVERY_ROLE; delete env.DELIVERY_ROLE_DIR;
  return spawnSync(process.execPath, [UG.launcherPath(cfg)], { input, env, encoding: 'utf8' });
}

test('the launcher runs the installed plugin\'s guard with the same stdin: the incident is refused', () => {
  const cfg = mk('ug-cfg-');
  const home = mk('ug-home-');
  UG.ensureUserGuard({ configDir: cfg, pluginRoot: PLUGIN_ROOT });
  const r = runLauncher(cfg, incident(path.join(cfg, 'settings.json')), home);
  assert.equal(r.status, 0);
  const d = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /^Refused: this changes where temp files go \(TMPDIR in /);
  assert.equal(runLauncher(cfg, JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/', tool_name: 'Bash', tool_input: { command: 'ls' } }), home).stdout, '');
});

test('with no plugin installed the launcher falls back to its own check, so removing the plugin does not switch it off', () => {
  const cfg = mk('ug-cfg-');
  const home = mk('ug-home-');
  // a plugin root inside the config dir's plugin cache is not embedded, and no installed_plugins.json names one
  UG.ensureUserGuard({ configDir: cfg, pluginRoot: path.join(cfg, 'plugins', 'cache', 'm', 'delivery', '0.0.1') });
  const r = runLauncher(cfg, incident(path.join(home, '.claude', 'settings.json')), home);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /delivery plugin is not installed/);
  assert.match(runLauncher(cfg, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'claude plugin uninstall delivery' } }), home).stdout, /deny/);
  assert.equal(runLauncher(cfg, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), home).stdout, '');
  assert.equal(runLauncher(cfg, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'settings.json', content: 'TMPDIR' } }), home).stdout, '');
});

test('the team command installs it; the host job installs it every cycle but never inside the sealed test runner', () => {
  const cfg = mk('ug-cfg-');
  const cli = require('../setup-guard.js');
  assert.equal(cli.main(['install', '--config-dir', cfg]).code, 0);
  assert.ok(fs.existsSync(UG.launcherPath(cfg)));
  assert.match(cli.main(['install', '--config-dir', cfg]).out, /already installed/);
  assert.equal(cli.main(['remove']).code, 2);
  const WD = require('../watchdog.js');
  const home = mk('ug-home-');
  assert.equal(WD.defaultUserGuard({ DELIVERY_SEAL_ACTIVE: 'tok' }, home), null);
  assert.equal(WD.defaultUserGuard({ DELIVERY_SEALED_RUN: 'host-tmp:x:y' }, home), null);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'a test run writes nothing');
  const other = mk('ug-cfg-');
  assert.match(WD.defaultUserGuard({ CLAUDE_CONFIG_DIR: other }, home), /setup guard: wrote/);
  assert.ok(fs.existsSync(path.join(other, 'settings.json')));
});

test('the host job\'s run calls the install step, and a dry run does not', () => {
  const { harness } = require('../testing/role-harness.js');
  const watchdog = require('../watchdog.js');
  const h = harness({});
  const memStore = () => ({ list: () => [], ready: () => [], show: () => null });
  const calls = [];
  const deps = { cwd: h.root, env: { ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, '..', 'testing')}${path.delimiter}${process.env.PATH}` }, live: [], bd: memStore(), sweep: () => ({ removed: [], failed: [] }), spawn: () => 999999999, update: { exec: () => { throw new Error('no claude here'); }, alive: () => false }, userGuard: (env, home) => { calls.push(home); return 'setup guard: installed (stub)'; } };
  const r = watchdog.main(['run'], deps);
  assert.match(r.out, /setup guard: installed \(stub\)/);
  assert.equal(calls.length, 1);
  watchdog.main(['run', '--dry-run'], deps);
  assert.equal(calls.length, 1, 'a dry run installs nothing');
});
