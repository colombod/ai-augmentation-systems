// scripts/testing/role-env.test.js — hjx.1.1.2: a test file run straight from a role session (a reality
// check runs the watchdog tests this way) clears the role's own variables, as run-tests.js does, and
// keeps the seal's, so it sees what CI sees and the seal still holds.
require('./role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const { clearRoleEnv, SEAL_VARS } = require('./role-env.js');
const { cleanEnv } = require('./run-tests.js');

test('hjx.1.1.2: a role session\'s DELIVERY_ and BEADS_ variables are cleared; the seal\'s and everything else are kept', () => {
  const env = {
    DELIVERY_ROLE: 'reality-checker', DELIVERY_ROLE_ID: 'reality-checker', DELIVERY_PROJECT_ROOT: '/live/project', DELIVERY_WAKE: 'resume',
    BEADS_ACTOR: 'dev@pc/reality-checker', BEADS_DIR: '/live/project/.beads', BD_ACTOR: 'dev@pc/reality-checker',
    DELIVERY_SEAL_ACTIVE: 'tok', DELIVERY_SEALED_RUN: 'host-tmp:x:y', DELIVERY_TMP_REGISTRY: '/tmp/reg',
    PATH: '/usr/bin', TZ: 'UTC',
  };
  const out = clearRoleEnv(env);
  assert.equal(out, env, 'clears in place, so process.env itself is changed');
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CONFIG_DIR', 'DELIVERY_SEALED_RUN', 'DELIVERY_SEAL_ACTIVE', 'DELIVERY_TMP_REGISTRY', 'PATH', 'TZ'], 'and a Claude configuration of its own (hjx.1.1.4)');
});

test('hjx.1.1.2: it clears exactly what the sealed runner clears, apart from the seal\'s own variables', () => {
  const env = { DELIVERY_X: '1', DELIVERY_SEAL_ACTIVE: 't', BEADS_Y: '2', BD_ACTOR: 'a', BD_OTHER: 'b', HOME: '/h' };
  const runner = Object.keys(cleanEnv(env));
  const here = Object.keys(clearRoleEnv({ ...env })).filter((k) => !SEAL_VARS.includes(k) && k !== 'CLAUDE_CONFIG_DIR');
  assert.deepEqual(here.sort(), runner.sort());
});

// hjx.1.1.4: run from the installed plugin (a reality check), this plugin sits under the host's
// <config>/plugins/cache, so every watchdog run a test made ran the real self-update against the host's
// install: it fetched the marketplace clone and read the host's installed versions, and the tests woke
// differently whenever the host's main was ahead (dlv-2ex, B2, 45, 50 not ok in turn).
const fs = require('fs');
const os = require('os');
const path = require('path');
const hostCfg = path.resolve(os.homedir(), '.claude');

test('hjx.1.1.4: the Claude configuration is a fresh empty directory, never the host\'s, so no run reads the host\'s install', () => {
  const e = { CLAUDE_CONFIG_DIR: hostCfg, HOME: os.homedir() };
  clearRoleEnv(e);
  const dir = e.CLAUDE_CONFIG_DIR;
  assert.ok(dir && path.isAbsolute(dir));
  assert.notEqual(path.resolve(dir), hostCfg);
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep), `${dir} is under the temp directory`);
  assert.deepEqual(fs.readdirSync(dir), [], 'empty: no installed_plugins.json, no marketplaces');
  assert.ok(!path.resolve(__dirname).startsWith(path.resolve(dir, 'plugins', 'cache') + path.sep), 'this plugin is not an install of that configuration');
  assert.equal(e.HOME, os.homedir(), 'HOME is kept: tests read it as the user\'s home');
  assert.notEqual(clearRoleEnv({}).CLAUDE_CONFIG_DIR, dir, 'each call its own directory');
});

// rv-220: the installed layout the bug needs, built here (scratch/repro-installed.sh made deterministic): the
// plugin under <config>/plugins/cache, installed_plugins.json naming it, and a marketplace clone whose
// origin's main is a version ahead. Under the host's configuration the self-update a watchdog run starts
// fetches that clone; under the cleared environment it finds no install and fetches nothing.
function installedLayout() {
  const { execFileSync } = require('child_process');
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-'));
  const C = path.join(W, 'claude');
  const P = path.join(C, 'plugins', 'cache', 'ai-augmentation-systems', 'delivery', '0.43.85');
  fs.mkdirSync(P, { recursive: true });
  const O = path.join(W, 'origin');
  const g = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
  fs.mkdirSync(path.join(O, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(O, 'plugins', 'delivery', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(O, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'ai-augmentation-systems', plugins: [{ name: 'delivery', source: './plugins/delivery' }] }));
  const manifest = path.join(O, 'plugins', 'delivery', '.claude-plugin', 'plugin.json');
  fs.writeFileSync(manifest, JSON.stringify({ name: 'delivery', version: '0.43.85' }));
  execFileSync('git', ['init', '-q', '-b', 'main', O], { stdio: 'ignore' });
  g(O, 'add', '-A');
  g(O, 'commit', '-qm', 'base');
  const base = execFileSync('git', ['-C', O, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const M = path.join(C, 'plugins', 'marketplaces', 'ai-augmentation-systems');
  execFileSync('git', ['clone', '-q', O, M], { stdio: 'ignore' });
  fs.writeFileSync(manifest, JSON.stringify({ name: 'delivery', version: '0.43.99' }));
  g(O, 'commit', '-qam', 'delivery 0.43.99 (#999)');
  fs.writeFileSync(path.join(C, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'delivery@ai-augmentation-systems': [{ scope: 'user', installPath: P, version: '0.43.85', gitCommitSha: base }] } }));
  fs.writeFileSync(path.join(C, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'ai-augmentation-systems': { source: { source: 'github', repo: 'colombod/ai-augmentation-systems' }, installLocation: M } }));
  return { W, C, P, fetched: () => fs.existsSync(path.join(M, '.git', 'FETCH_HEAD')) };
}

test('hjx.1.1.4: from an installed layout, the host\'s configuration makes the self-update fetch the marketplace; the cleared one makes it fetch nothing', () => {
  const SU = require('../lib/self-update.js');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
  // the bug: run from <config>/plugins/cache with the host's configuration, the self-update reaches its install
  const host = installedLayout();
  const ranHost = [];
  SU.selfUpdate(project, { pluginRoot: host.P, env: { CLAUDE_CONFIG_DIR: host.C }, exec: (bin, args) => { ranHost.push([bin, ...args]); return ''; } });
  assert.equal(host.fetched(), true, 'under the host configuration the marketplace clone is fetched');
  // the fix: the same layout, the environment cleared as every test file clears it
  const cleared = installedLayout();
  const ran = [];
  const r = SU.selfUpdate(project, { pluginRoot: cleared.P, env: clearRoleEnv({ CLAUDE_CONFIG_DIR: cleared.C }), exec: (bin, args) => { ran.push([bin, ...args]); return ''; } });
  assert.deepEqual(r, { lines: [], installed: false });
  assert.equal(cleared.fetched(), false, 'the cleared environment fetches nothing');
  assert.deepEqual(ran, [], 'and runs nothing');
});

test('rv-220: the configuration directories a test process makes are gone when it exits', () => {
  const { spawnSync } = require('child_process');
  const code = `const { clearRoleEnv } = require(${JSON.stringify(path.join(__dirname, 'role-env.js'))}); const a = clearRoleEnv({}).CLAUDE_CONFIG_DIR; for (let i = 0; i < 12; i++) clearRoleEnv({}); const b = clearRoleEnv({}).CLAUDE_CONFIG_DIR; process.stdout.write(JSON.stringify([a, b, require('fs').existsSync(a)]));`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  const [a, b, existed] = JSON.parse(r.stdout);
  assert.equal(existed, true, 'it is there while the process runs');
  assert.notEqual(a, b);
  assert.equal(fs.existsSync(a), false, `${a} is removed at exit`);
  assert.equal(fs.existsSync(b), false, `${b} is removed at exit`);
  assert.equal(r.stderr, '', 'no listener warning for several calls');
});

test('hjx.1.1.2: with no argument it clears a role session\'s variables from process.env itself', () => {
  const old = { DELIVERY_ROLE: process.env.DELIVERY_ROLE, BEADS_ACTOR: process.env.BEADS_ACTOR };
  process.env.DELIVERY_ROLE = 'reality-checker';
  process.env.BEADS_ACTOR = 'dev@pc/reality-checker';
  try {
    clearRoleEnv();
    assert.equal(process.env.DELIVERY_ROLE, undefined);
    assert.equal(process.env.BEADS_ACTOR, undefined);
  } finally {
    for (const [k, v] of Object.entries(old)) if (v !== undefined) process.env[k] = v;
  }
});

// hjx.1.1.3, the class fix of a3-reality-checker-16 and -17: the sealed runner clears the role's
// variables once for the suite, so a file that does not clear them itself passes in CI and sees the
// role when a reality check runs it straight from its session. Every test file the runner runs clears
// them as its first statement; this names each one that does not.
test('hjx.1.1.3: every test file the suite runs clears the role\'s variables as its first statement', () => {
  const fs = require('fs');
  const path = require('path');
  const { testFiles } = require('./run-tests.js');
  const { firstStatementClears } = require('./role-env.js');
  const root = path.join(__dirname, '..', '..');
  const files = testFiles(root);
  assert.ok(files.length > 50, `the suite's test files were found (${files.length})`);
  const missing = files.filter((f) => !firstStatementClears(fs.readFileSync(f, 'utf8'), path.dirname(f))).map((f) => path.relative(root, f));
  assert.deepEqual(missing, [], `these test files do not call require('<path>/testing/role-env.js').clearRoleEnv() first: ${missing.join(', ')}`);
});

test('hjx.1.1.3: the guard takes the call only first, and only from role-env.js', () => {
  const { firstStatementClears } = require('./role-env.js');
  const dir = __dirname;
  const call = "require('./role-env.js').clearRoleEnv();";
  assert.equal(firstStatementClears(`${call}\nconst test = require('node:test');`, dir), true);
  assert.equal(firstStatementClears(`#!/usr/bin/env node\n'use strict';\n// why\n/* more\n   why */\n\n${call}\n`, dir), true, 'after a header');
  assert.equal(firstStatementClears(`const test = require('node:test');\n${call}`, dir), false, 'a require ahead of it');
  assert.equal(firstStatementClears(`process.env.TZ = 'UTC';\n${call}`, dir), false, 'any statement ahead of it');
  // built at run time: a literal would read as a require of a file that is not there (self-contained.test.js)
  const other = ['require(', "'./other", "-env.js')", '.clearRoleEnv();'].join('');
  assert.equal(firstStatementClears(other, dir), false, 'another file\'s clearRoleEnv');
  assert.equal(firstStatementClears("require('../testing/role-env.js').clearRoleEnv();", path.join(dir, '..', 'lib')), true, 'from another directory');
  assert.equal(firstStatementClears("// require('./role-env.js').clearRoleEnv();\nconst x = 1;", dir), false, 'a call in a comment');
});

test('hjx.1.1.3: every BD_ variable is cleared, by prefix, not only BD_ACTOR', () => {
  const env = clearRoleEnv({ BD_ACTOR: 'a', BD_NON_INTERACTIVE: '1', BD_SOMETHING_NEW: 'x', BEADS_NEW: 'y', DELIVERY_NEW: 'z', BDX: 'kept', HOME: '/h' });
  assert.deepEqual(Object.keys(env).filter((k) => k !== 'CLAUDE_CONFIG_DIR').sort(), ['BDX', 'HOME']);
});
