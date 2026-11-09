// scripts/testing/role-env.test.js — hjx.1.1.2: a test file run straight from a role session (a reality
// check runs the watchdog tests this way) clears the role's own variables, as run-tests.js does, and
// keeps the seal's, so it sees what CI sees and the seal still holds.
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
