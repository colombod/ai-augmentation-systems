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
  assert.deepEqual(Object.keys(env).sort(), ['DELIVERY_SEALED_RUN', 'DELIVERY_SEAL_ACTIVE', 'DELIVERY_TMP_REGISTRY', 'PATH', 'TZ']);
});

test('hjx.1.1.2: it clears exactly what the sealed runner clears, apart from the seal\'s own variables', () => {
  const env = { DELIVERY_X: '1', DELIVERY_SEAL_ACTIVE: 't', BEADS_Y: '2', BD_ACTOR: 'a', BD_OTHER: 'b', HOME: '/h' };
  const runner = Object.keys(cleanEnv(env));
  const here = Object.keys(clearRoleEnv({ ...env })).filter((k) => !SEAL_VARS.includes(k));
  assert.deepEqual(here.sort(), runner.sort());
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
