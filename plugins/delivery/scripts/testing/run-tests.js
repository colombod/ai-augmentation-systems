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

// ---- the sealed run (hjx, dec-chief-of-staff-000014) ----
// A run leaves nothing in the host's /tmp, whatever happens to it. The suite runs inside bubblewrap
// with a private /tmp (a fresh tmpfs capped in size) that the kernel destroys when the run ends, also
// when it is killed or crashes (--die-with-parent): leftover fixtures filled wintermute's /tmp on
// 2026-11-01 when runs were killed before their cleanup ran. Temp files are not relocated anywhere.
// tmpfs inodes cannot be capped from an unprivileged sandbox, so the sealed run polls its own /tmp and
// stops the suite past the inode cap. Without bubblewrap (macOS, a host without it) the run falls back
// to a private directory under the system temp dir, removed at the end, and says it is not sealed.
const MB = 1024 * 1024;
const caps = (env) => ({
  bytes: (Number(env.DELIVERY_TEST_TMP_MB) || 2048) * MB,
  inodes: Number(env.DELIVERY_TEST_TMP_INODES) || 200000,
});
function bwrapPath(env) {
  for (const d of String(env.PATH || '').split(path.delimiter).concat(['/usr/bin', '/bin'])) {
    const p = path.join(d, 'bwrap');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* next */ }
  }
  return null;
}
// the bwrap argv that seals a run: the host as it is, a private capped /tmp, gone with the parent
function sealArgs(bwrap, cap, argv) {
  return [bwrap, ['--dev-bind', '/', '/', '--size', String(cap.bytes), '--tmpfs', '/tmp', '--proc', '/proc', '--die-with-parent', '--unshare-pid', '--', ...argv]];
}
// inodes in use on a mount, or null when it cannot be read: the sealed run's /tmp is its own tmpfs,
// so the mount's count is the run's count
function inodesUsed(dir) {
  try { const s = fs.statfsSync(dir); return s.files - s.ffree; } catch (e) { return null; }
}
// entries under one directory, stopping once past `limit`: an unsealed run's private directory sits on
// a shared filesystem, whose mount-wide count says nothing about this run
function entriesUnder(dir, limit) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n <= limit) {
    let list;
    try { list = fs.readdirSync(stack.pop(), { withFileTypes: true }); } catch (e) { continue; }
    for (const e of list) { n += 1; if (e.isDirectory()) stack.push(path.join(e.parentPath || e.path, e.name)); }
  }
  return n;
}

module.exports.sealArgs = sealArgs;
module.exports.caps = caps;
module.exports.bwrapPath = bwrapPath;
module.exports.inodesUsed = inodesUsed;
module.exports.entriesUnder = entriesUnder;

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  // the tests make their fixtures with mkdtemp and leave them: thousands of directories with git
  // repositories in them each run, which filled a 39 GB disk over a day of runs. The suite gets a
  // temporary directory of its own, removed when it ends.
  const os = require('os');
  const { clock, rest } = splitArgs(process.argv.slice(2));
  const cap = caps(process.env);
  const files = process.env.DELIVERY_TEST_FILES ? process.env.DELIVERY_TEST_FILES.split(path.delimiter) : testFiles(root);
  // already inside a seal (the suite's own tests run this runner): no nested sandbox, which the host
  // refuses; a private directory inside the sealed /tmp instead
  const inSeal = process.env.DELIVERY_SEAL_ACTIVE === '1' && process.env.DELIVERY_SEALED_RUN !== '1';
  if (process.env.DELIVERY_SEALED_RUN !== '1' && !inSeal) {
    const bwrap = process.env.DELIVERY_TEST_UNSEALED === '1' ? null : bwrapPath(process.env);
    if (bwrap) {
      // re-run this runner inside the seal; the sealed child does the rest
      const [cmd, args] = sealArgs(bwrap, cap, [process.execPath, __filename, ...process.argv.slice(2)]);
      const r = spawnSync(cmd, args, { env: { ...process.env, DELIVERY_SEALED_RUN: '1', DELIVERY_SEAL_ACTIVE: '1' }, stdio: 'inherit' });
      if (r.error) { process.stderr.write(`run-tests: could not start the sealed run (${r.error.message})\n`); process.exit(1); }
      process.exit(r.status !== null ? r.status : 1);
    }
    process.stderr.write(`run-tests: ${process.env.DELIVERY_TEST_UNSEALED === '1' ? 'DELIVERY_TEST_UNSEALED is set' : 'bubblewrap (bwrap) not found'}: this run is NOT sealed; it uses a private directory under the system temp dir, removed at the end\n`);
  }
  // sealed: /tmp is the run's own capped tmpfs; unsealed: a private directory, removed at the end
  const sealed = process.env.DELIVERY_SEALED_RUN === '1';
  const tmp = sealed ? '/tmp' : fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-tests-'));
  const { spawn } = require('child_process');
  const env = { ...cleanEnv(process.env), ...clockEnv(clock, process.env), TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...(sealed || inSeal ? { DELIVERY_SEAL_ACTIVE: '1' } : {}) };
  delete env.DELIVERY_SEALED_RUN;
  const child = spawn(process.execPath, ['--test', ...rest, ...files], { env, stdio: 'inherit', detached: true });
  let over = null;
  const guard = setInterval(() => {
    const used = sealed ? inodesUsed(tmp) : entriesUnder(tmp, cap.inodes);
    if (used !== null && used > cap.inodes) {
      over = `run-tests: the run's /tmp passed its inode cap (${used} > ${cap.inodes}); stopping the suite`;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ }
    }
  }, 1000);
  // Ctrl+C or a kill of the runner stops the suite's whole process group too, then cleans up: the
  // suite runs detached so the inode guard can stop it as a group, which also keeps it from getting
  // the terminal's signal on its own. The runner lives until the group is gone, not only its leader
  // (Copilot on #111): a descendant that ignores SIGTERM still gets the SIGKILL five seconds on, and
  // the unsealed run's directory is removed only once nothing in the group can write to it.
  const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    try { process.kill(-child.pid, sig); } catch (e) { /* gone */ }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  child.on('exit', (code, signal) => {
    clearInterval(guard);
    const finish = () => {
      if (!sealed) fs.rmSync(tmp, { recursive: true, force: true });
      if (over) process.stderr.write(`${over}\n`);
      process.exit(over ? 1 : code !== null ? code : 1);
    };
    if (!groupAlive()) return finish();
    stop('SIGTERM');
    const wait = setInterval(() => { if (!groupAlive()) { clearInterval(wait); finish(); } }, 100);
  });
}
