#!/usr/bin/env node
// The plugin's whole test suite, run with the team's role settings cleared.
//
// Why: the plugin is reviewed and built by its own role sessions, and a role session carries
// DELIVERY_* (and beads) variables that the hooks and scripts under test read. Inherited, they make
// about 70 tests fail that pass in CI. A reviewer's lane cannot prefix a command with `env -u`, so
// the clearing lives here, and this one command is what CI, builders and reviewers all run.
// Extra arguments go to `node --test` (for example --test-name-pattern), except --clock <iso>, which
// runs the suite with every node process's clock moved to that instant (fake-clock.js).
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

// --clock <iso> is the runner's own; the rest pass through to `node --test`
function splitArgs(argv) {
  const rest = [];
  let clock = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clock') clock = argv[++i];
    else if (argv[i].startsWith('--clock=')) clock = argv[i].slice('--clock='.length);
    else rest.push(argv[i]);
  }
  if (clock !== null && !Number.isFinite(Date.parse(clock))) throw new Error(`--clock needs a date, got ${JSON.stringify(clock)}`);
  return { clock, rest };
}

// The offset is from the real clock: a runner already under a moved one (the suite's own test of
// --clock, run with --clock) takes the inherited offset off first, and does not preload twice.
function clockEnv(clock, env) {
  if (!clock) return {};
  const realNow = Date.now() - (Number(env.TEST_CLOCK_OFFSET_MS) || 0);
  const preload = `--require ${JSON.stringify(path.join(__dirname, 'fake-clock.js'))}`;
  const opts = env.NODE_OPTIONS || '';
  return { TEST_CLOCK_OFFSET_MS: String(Date.parse(clock) - realNow), NODE_OPTIONS: opts.includes(preload) ? opts : `${opts} ${preload}`.trim() };
}

module.exports = { cleanEnv, testFiles, splitArgs, clockEnv };

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  // the tests make their fixtures with mkdtemp and leave them: thousands of directories with git
  // repositories in them each run, which filled a 39 GB disk over a day of runs. The suite gets a
  // temporary directory of its own, removed when it ends.
  const os = require('os');
  const { clock, rest } = splitArgs(process.argv.slice(2));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-tests-'));
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', ...rest, ...testFiles(root)], { env: { ...cleanEnv(process.env), ...clockEnv(clock, process.env), TMPDIR: tmp, TMP: tmp, TEMP: tmp }, stdio: 'inherit' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(r && r.status !== null ? r.status : 1);
}
