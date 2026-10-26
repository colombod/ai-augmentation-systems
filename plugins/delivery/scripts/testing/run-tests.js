#!/usr/bin/env node
// The plugin's whole test suite, run with the team's role settings cleared.
//
// Why: the plugin is reviewed and built by its own role sessions, and a role session carries
// DELIVERY_* (and beads) variables that the hooks and scripts under test read. Inherited, they make
// about 70 tests fail that pass in CI. A reviewer's lane cannot prefix a command with `env -u`, so
// the clearing lives here, and this one command is what CI, builders and reviewers all run.
// Extra arguments go to `node --test` (for example --test-name-pattern).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROLE_VARS = /^(DELIVERY_|BEADS_|BD_ACTOR$)/;
function cleanEnv(from) {
  const env = {};
  for (const [k, v] of Object.entries(from)) if (!ROLE_VARS.test(k)) env[k] = v;
  return env;
}

// every scripts/**/*.test.js and hooks/scripts/*.test.js, the set CI ran before this runner existed
function testFiles(root) {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.test.js')) files.push(p);
    }
  })(path.join(root, 'scripts'));
  for (const e of fs.readdirSync(path.join(root, 'hooks', 'scripts'))) if (e.endsWith('.test.js')) files.push(path.join(root, 'hooks', 'scripts', e));
  return files.sort();
}

module.exports = { cleanEnv, testFiles };

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  // the tests make their fixtures with mkdtemp and leave them: thousands of directories with git
  // repositories in them each run, which filled a 39 GB disk over a day of runs. The suite gets a
  // temporary directory of its own, removed when it ends.
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-tests-'));
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...testFiles(root)], { env: { ...cleanEnv(process.env), TMPDIR: tmp, TMP: tmp, TEMP: tmp }, stdio: 'inherit' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(r && r.status !== null ? r.status : 1);
}
