// scripts/testing/role-env.js — clears a role session's own variables from a test file's process.env.
//
// Why: run-tests.js clears DELIVERY_*, BEADS_* and BD_ACTOR before it starts the suite, because the
// scripts under test read them (the watchdog takes the caller's role, project root and wake from them).
// A reality check runs a story's test files straight from its role session instead, with that role's
// variables set, and the watchdog tests then fail there while passing in CI (hjx.1.1.2: four not ok on
// 27b7b86). A test file that requires this first sees the environment CI sees, however it is started.
// The seal's own variables are kept: run-tests.js sets them for the run, and the sweep and the
// watchdog's sealed-run check read them.
const { cleanEnv } = require('./run-tests.js');

const SEAL_VARS = ['DELIVERY_SEAL_ACTIVE', 'DELIVERY_SEALED_RUN', 'DELIVERY_TMP_REGISTRY'];

function clearRoleEnv(env = process.env) {
  const keep = new Set(Object.keys(cleanEnv(env)));
  for (const k of Object.keys(env)) if (!keep.has(k) && !SEAL_VARS.includes(k)) delete env[k];
  // No test reaches the host's own systemd user manager (hjx.1.6.10.1.2): a wake or a start would put
  // its process in a real scope, and under the sealed runner's own process namespace systemd cannot see
  // the process, so the scope fails and the test's fake session never runs. A test that means a manager
  // gives one of its own (a runtime directory and a fake systemd-run).
  delete env.XDG_RUNTIME_DIR;
  return env;
}

module.exports = { clearRoleEnv, SEAL_VARS };
