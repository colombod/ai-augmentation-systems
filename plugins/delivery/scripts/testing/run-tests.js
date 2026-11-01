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
// stops the suite past the inode cap. Without bubblewrap (macOS, a host without it), or with
// DELIVERY_TEST_UNSEALED=1, the run is refused: an unsealed run killed before its cleanup leaves its
// directory in the host's /tmp, which the owner ruled out. Two cases still run unsealed, in a private
// directory removed at the end: inside a proven seal (the suite's own tests of this runner, whose /tmp
// is the outer run's tmpfs), and an opt-out the owner recorded (DELIVERY_TEST_UNSEALED_RECORD=<id>,
// checked with operator.js verify).
//
// A seal is proven, never taken from a flag: a stray DELIVERY_SEAL_ACTIVE=1 or DELIVERY_SEALED_RUN=1
// once turned sealing off silently. The sealed child checks that /tmp is a tmpfs mounted apart from the
// host's /tmp (the parent passes its /tmp mount id), then writes a random token to /tmp/.delivery-seal
// and gives the suite DELIVERY_SEAL_ACTIVE=<token>; a nested run trusts its flag only when that file in
// a tmpfs /tmp holds the same token. Anything else that claims a seal is refused with the reason.
const MB = 1024 * 1024;
const SEAL_FILE = '.delivery-seal';
// the mount over a path in /proc/self/mountinfo, { id, fstype }, or null (no /proc: macOS); the last
// line for that mount point wins, as a later mount covers an earlier one
function mountAt(dir, mountinfo) {
  let text = mountinfo;
  if (text === undefined) { try { text = fs.readFileSync('/proc/self/mountinfo', 'utf8'); } catch (e) { return null; } }
  let found = null;
  for (const line of String(text).split('\n')) {
    const [pre, post] = line.split(' - ');
    if (!post) continue;
    const f = pre.split(' ');
    if (f[4] === dir) found = { id: f[0], fstype: post.split(' ')[0] };
  }
  return found;
}
// null when this process runs in a proven seal, else why not. claim is DELIVERY_SEALED_RUN (the sealed
// child: host-tmp:<the host /tmp mount id, or none>) or DELIVERY_SEAL_ACTIVE (a nested run: the token)
function sealProblem({ sealedRun, sealActive, tmpDir = '/tmp', mountinfo } = {}) {
  const m = mountAt(tmpDir, mountinfo);
  if (!m || m.fstype !== 'tmpfs') return `${tmpDir} is not a tmpfs mount`;
  if (sealedRun !== undefined) {
    const host = /^host-tmp:(\S+)$/.exec(String(sealedRun));
    if (!host) return `DELIVERY_SEALED_RUN=${sealedRun} is not one the runner set`;
    if (host[1] === m.id) return `${tmpDir} is the host's own mount`;
    return null;
  }
  let token = null;
  try { token = fs.readFileSync(path.join(tmpDir, SEAL_FILE), 'utf8').trim(); } catch (e) { /* none */ }
  if (!token || token !== String(sealActive)) return `no seal token in ${tmpDir} matches DELIVERY_SEAL_ACTIVE`;
  return null;
}
// a seal flag counts as set unless it is empty or 0
const claimed = (v) => v !== undefined && v !== '' && v !== '0';
// null when the owner's record id verifies (operator.js verify, run from here), else why not
function ownerOptOut(id, { operatorJs = path.join(__dirname, '..', 'operator.js'), cwd = process.cwd(), env = process.env } = {}) {
  if (!id) return 'no owner record allows an unsealed run (DELIVERY_TEST_UNSEALED_RECORD=<record id>)';
  const r = spawnSync(process.execPath, [operatorJs, 'verify', String(id), '--json'], { cwd, env, encoding: 'utf8', timeout: 30000 });
  let v = null;
  try { v = JSON.parse(r.stdout); } catch (e) { /* not json */ }
  return v && v.ok === true ? null : `the owner record ${id} does not verify (${(v && v.code) || (r.stderr || '').trim().split('\n')[0] || 'no answer'})`;
}
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
  try { const s = fs.statfsSync(dir); return s.files - s.ffree; } catch (e) { return null; } // statfsSync missing throws too
}
// entries under one directory, stopping once past `limit`: an unsealed run's private directory sits on
// a shared filesystem, whose mount-wide count says nothing about this run
function entriesUnder(dir, limit) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n <= limit) {
    // joined against the directory read, not Dirent.parentPath, which early Node 18 lacks (Copilot on #111)
    const d = stack.pop();
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of list) { n += 1; if (e.isDirectory()) stack.push(path.join(d, e.name)); }
  }
  return n;
}

// what the guard compares with the cap: a sealed run reads its tmpfs's own counters; where statfs is
// missing (Node 18 before 18.15) or fails, it walks the directory instead, so the cap still holds
// (Copilot on #111)
function guardCount(dir, sealed, limit) {
  const used = sealed ? inodesUsed(dir) : null;
  return used !== null ? used : entriesUnder(dir, limit);
}
module.exports.guardCount = guardCount;
module.exports.sealArgs = sealArgs;
module.exports.caps = caps;
module.exports.bwrapPath = bwrapPath;
module.exports.inodesUsed = inodesUsed;
module.exports.entriesUnder = entriesUnder;
module.exports.mountAt = mountAt;
module.exports.sealProblem = sealProblem;
module.exports.ownerOptOut = ownerOptOut;
module.exports.SEAL_FILE = SEAL_FILE;

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
  const refuse = (why) => { process.stderr.write(`run-tests: refused: ${why}. Nothing was run.\n`); process.exit(2); };
  const sealedRun = process.env.DELIVERY_SEALED_RUN;
  const sealActive = process.env.DELIVERY_SEAL_ACTIVE;
  // the sealed child proves its own seal; a nested run proves the one it is in
  let sealed = false;
  let inSeal = false;
  if (sealedRun !== undefined) {
    const p = sealProblem({ sealedRun });
    if (p) refuse(`this run claims a seal it is not in (${p})`);
    sealed = true;
  } else if (claimed(sealActive)) {
    const p = sealProblem({ sealActive });
    if (p) refuse(`DELIVERY_SEAL_ACTIVE is set, but this run is not in a seal (${p}); unset it, or run inside a sealed run`);
    inSeal = true;
  }
  if (!sealed && !inSeal) {
    const optedOut = process.env.DELIVERY_TEST_UNSEALED === '1';
    const bwrap = optedOut ? null : bwrapPath(process.env);
    if (bwrap) {
      // re-run this runner inside the seal; the sealed child does the rest
      const host = mountAt('/tmp');
      const [cmd, args] = sealArgs(bwrap, cap, [process.execPath, __filename, ...process.argv.slice(2)]);
      const childEnv = { ...process.env, DELIVERY_SEALED_RUN: `host-tmp:${host ? host.id : 'none'}` };
      delete childEnv.DELIVERY_SEAL_ACTIVE;
      const r = spawnSync(cmd, args, { env: childEnv, stdio: 'inherit' });
      if (r.error) { process.stderr.write(`run-tests: could not start the sealed run (${r.error.message})\n`); process.exit(1); }
      process.exit(r.status !== null ? r.status : 1);
    }
    const why = optedOut ? 'DELIVERY_TEST_UNSEALED is set' : 'bubblewrap (bwrap) is not installed';
    const p = ownerOptOut(process.env.DELIVERY_TEST_UNSEALED_RECORD);
    if (p) refuse(`${why}, so this run would not be sealed, and a run that is not sealed can leave files in the host's /tmp; ${p}. ${optedOut ? 'Unset DELIVERY_TEST_UNSEALED' : 'Install bubblewrap'}`);
    process.stderr.write(`run-tests: ${why}: this run is NOT sealed (owner record ${process.env.DELIVERY_TEST_UNSEALED_RECORD}); it uses a private directory under the system temp dir, removed at the end\n`);
  }
  // sealed: /tmp is the run's own capped tmpfs, and the token in it proves the seal to nested runs;
  // otherwise a private directory, removed at the end
  let token = inSeal ? sealActive : null;
  if (sealed) {
    token = require('crypto').randomBytes(16).toString('hex');
    fs.writeFileSync(path.join('/tmp', SEAL_FILE), token);
  }
  const tmp = sealed ? '/tmp' : fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-tests-'));
  const { spawn } = require('child_process');
  const env = { ...cleanEnv(process.env), ...clockEnv(clock, process.env), TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...(token ? { DELIVERY_SEAL_ACTIVE: token } : {}) };
  const child = spawn(process.execPath, ['--test', ...rest, ...files], { env, stdio: 'inherit', detached: true });
  let over = null;
  const guard = setInterval(() => {
    const used = guardCount(tmp, sealed, cap.inodes);
    if (used !== null && used > cap.inodes) {
      over = `run-tests: the run's /tmp passed its inode cap (${used} > ${cap.inodes}); stopping the suite`;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ }
    }
  }, 1000);
  // Ctrl+C or a kill of the runner stops the suite's whole process group too, then cleans up: the
  // suite runs detached so the inode guard can stop it as a group, which also keeps it from getting
  // the terminal's signal on its own. The runner lives until the group is gone, not only its leader
  // (Copilot on #111): a descendant that ignores SIGTERM still gets the SIGKILL five seconds on, and
  // the unsealed run's directory is removed only once nothing in the group can write to it. The wait
  // ends two seconds after the SIGKILL whatever signal 0 says (Copilot on #111): a killed process runs
  // no more code, but in a container whose PID 1 does not reap, it stays a zombie that keeps its group
  // answering signal 0 for ever.
  const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let stopping = false;
  let killedAt = 0;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    try { process.kill(-child.pid, sig); } catch (e) { /* gone */ }
    setTimeout(() => { killedAt = Date.now(); try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // a suite that cannot start (EAGAIN under process pressure) emits 'error' and no 'exit': clean up
  // and fail here rather than crash and leave the run's directory (Copilot on #111)
  child.on('error', (err) => {
    clearInterval(guard);
    if (!sealed) fs.rmSync(tmp, { recursive: true, force: true });
    process.stderr.write(`run-tests: could not start the suite (${err.message})\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    clearInterval(guard);
    const finish = () => {
      if (!sealed) fs.rmSync(tmp, { recursive: true, force: true });
      if (over) process.stderr.write(`${over}\n`);
      process.exit(over ? 1 : code !== null ? code : 1);
    };
    if (!groupAlive()) return finish();
    stop('SIGTERM');
    const wait = setInterval(() => { if (!groupAlive() || (killedAt && Date.now() - killedAt > 2000)) { clearInterval(wait); finish(); } }, 100);
  });
}
