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

const SEAL_VARS = ['DELIVERY_SEAL_ACTIVE', 'DELIVERY_SEALED_RUN', 'DELIVERY_TMP_REGISTRY', 'DELIVERY_UNSEALED_TEST_RUN'];

// The Claude configuration becomes a fresh empty directory too (hjx.1.1.4). Run from the installed
// plugin, as a reality check runs it, this plugin sits under the host's <config>/plugins/cache, and every
// watchdog run a test made then ran the real self-update against the host's install (lib/self-update.js
// findInstall): it fetched the host's marketplace clone and read its installed versions, so a run woke
// differently whenever the host's main was ahead, and slowly. From a checkout (CI, the sealed runner)
// the plugin is under no configuration, which is what this makes every run see.
// Each call's configuration directory, removed when the test process exits (rv-220): an unsealed run from a
// role session, as a reality check runs one, has the host's /tmp, which would keep one per test file. One
// exit handler for all of them, so a file that calls this many times adds no listener per call.
const made = new Set();
let reaping = false;
function reapOnExit() {
  if (reaping) return;
  reaping = true;
  process.once('exit', () => { for (const d of made) { try { require('fs').rmSync(d, { recursive: true, force: true }); } catch (err) { /* gone already */ } } });
}

function clearRoleEnv(env = process.env) {
  const keep = new Set(Object.keys(cleanEnv(env)));
  for (const k of Object.keys(env)) if (!keep.has(k) && !SEAL_VARS.includes(k)) delete env[k];
  // No test reaches the host's own systemd user manager (hjx.1.6.10.1.2): a wake or a start would put
  // its process in a real scope, and under the sealed runner's own process namespace systemd cannot see
  // the process, so the scope fails and the test's fake session never runs. A test that means a manager
  // gives one of its own (a runtime directory and a fake systemd-run).
  delete env.XDG_RUNTIME_DIR;
  const fs = require('fs');
  env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'claude-config-'));
  made.add(env.CLAUDE_CONFIG_DIR);
  reapOnExit();
  return env;
}

// Whether a test file's first statement is the call to clearRoleEnv() from this file (hjx.1.1.3). Every
// test file makes it, not only those whose code reads a role variable today: which of them does changes
// with any require, and one require that loads a reader ahead of the call is enough to see the role's
// variables. Leading comments, blank lines, a shebang and 'use strict' may come first.
const CALL = /^require\((['"])([^'"]+)\1\)\.clearRoleEnv\(\);/;
function firstStatementClears(text, fromDir) {
  const path = require('path');
  let rest = String(text);
  for (;;) {
    const before = rest;
    rest = rest.replace(/^\s+/, '').replace(/^#![^\n]*/, '').replace(/^\/\/[^\n]*/, '').replace(/^\/\*[\s\S]*?\*\//, '').replace(/^(['"])use strict\1;?/, '');
    if (rest === before) break;
  }
  const m = CALL.exec(rest);
  return Boolean(m) && path.resolve(fromDir, m[2]) === __filename;
}

module.exports = { clearRoleEnv, firstStatementClears, SEAL_VARS };
