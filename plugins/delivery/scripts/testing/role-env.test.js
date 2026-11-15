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

test('hjx.1.1.4: with the host\'s configuration cleared, the self-update a watchdog run starts finds no install and runs nothing', () => {
  const SU = require('../lib/self-update.js');
  const e = clearRoleEnv({ CLAUDE_CONFIG_DIR: hostCfg });
  const ran = [];
  const r = SU.selfUpdate(os.tmpdir(), { pluginRoot: path.resolve(__dirname, '..', '..'), env: e, exec: (bin, args) => { ran.push([bin, ...args]); return ''; } });
  assert.deepEqual(r, { lines: [], installed: false });
  assert.deepEqual(ran, []);
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
