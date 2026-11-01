const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { cleanEnv, testFiles } = require('./run-tests.js');

// A role session's variables make the hooks under test act as that role; the runner must drop them
// and nothing else (PATH, HOME and the rest are what the tests need).
test('run-tests: clears the role and beads variables, keeps the rest', () => {
  const env = cleanEnv({ PATH: '/bin', HOME: '/h', DELIVERY_ROLE: 'x', DELIVERY_ROLE_DIR: '/r', BEADS_DIR: '/b', BEADS_ACTOR: 'a', BD_ACTOR: 'a', BD_NON_INTERACTIVE: '1', CLAUDE_PLUGIN_ROOT: '/p' });
  assert.deepStrictEqual(env, { PATH: '/bin', HOME: '/h', BD_NON_INTERACTIVE: '1', CLAUDE_PLUGIN_ROOT: '/p' });
});

test('run-tests: finds the suite CI ran (scripts/**, hooks/scripts), itself included', () => {
  const root = path.join(__dirname, '..', '..');
  const rel = testFiles(root).map((f) => path.relative(root, f));
  for (const f of ['scripts/start.test.js', 'scripts/lib/gate-context.test.js', 'scripts/testing/run-tests.test.js', 'hooks/scripts/lane.test.js']) assert.ok(rel.includes(f), f);
  assert.ok(rel.every((f) => f.endsWith('.test.js')));
  assert.ok(rel.length > 50);
});

// A day of suite runs left 245,000 fixture directories in /tmp and filled the disk: the runner gives
// the suite a temporary directory of its own and removes it, whatever the run's result.
test('run-tests: the suite runs in a temporary directory of its own, removed afterwards', () => {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-outer-'));
  try {
    // a pattern no test has: every file loads, no test body runs (so this test does not run itself)
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-tests.js'), '--test-name-pattern=^no test has this name$'], { env: { ...process.env, TMPDIR: outer }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr.slice(-500));
    assert.deepEqual(fs.readdirSync(outer).filter((f) => f.startsWith('delivery-tests-')), [], 'its directory is gone');
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

// A test that named the current month in a path passed all month and failed everywhere on the 1st.
// --clock runs the suite in another month so that class fails the day it is written.
test('run-tests: --clock is the runner\'s own argument; a bad date is refused', () => {
  const { splitArgs } = require('./run-tests.js');
  assert.deepStrictEqual(splitArgs(['--clock', '2027-03-15T12:00:00Z', '--test-name-pattern=x']), { clock: '2027-03-15T12:00:00Z', rest: ['--test-name-pattern=x'] });
  assert.deepStrictEqual(splitArgs(['--clock=2027-03-15']), { clock: '2027-03-15', rest: [] });
  assert.deepStrictEqual(splitArgs(['--test-name-pattern=x']), { clock: null, rest: ['--test-name-pattern=x'] });
  assert.throws(() => splitArgs(['--clock', 'soon']), /--clock needs a date/);
});

test('run-tests: under --clock, node children share one moved clock that runs on, and file times move with it', () => {
  const { spawnSync } = require('child_process');
  const { clockEnv } = require('./run-tests.js');
  const fs = require('fs');
  const os = require('os');
  const env = { ...process.env, ...clockEnv('2027-03-15T12:00:00Z', process.env) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-clock-'));
  try {
    // a child prints its clock, a file's age as it sees it, and the clock of a node process it spawns
    const f = path.join(dir, 'f');
    // (it waits 1.5 s first: a child whose clock restarted at the moved instant would read earlier)
    const script = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(f)},'x');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500);const t=Date.now();
      const kid=Number(require('child_process').execFileSync(process.execPath,['-e','process.stdout.write(String(Date.now()))'],{encoding:'utf8'}));
      fs.utimesSync(${JSON.stringify(f)},new Date(t-60000),new Date(t-60000));
      console.log(JSON.stringify({iso:new Date(t).toISOString(),call:Date(),kid:kid-t,age:t-fs.statSync(${JSON.stringify(f)}).mtimeMs}));`;
    const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.match(o.iso, /^2027-03-15T12:0/);
    assert.match(o.call, /Mar 15 2027/);
    assert.ok(o.kid >= 0 && o.kid < 10000, `the spawned process's clock runs on from its parent's: ${o.kid} ms`);
    assert.ok(Math.abs(o.age - 60000) < 2000, `a time set on the moved clock reads back on it: ${o.age} ms`);
    // without --clock nothing is preloaded
    assert.deepStrictEqual(clockEnv(null, {}), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// hjx (dec-chief-of-staff-000014): a run seals itself in a private, capped /tmp the kernel removes
// when the run ends, even killed; seal-check.js proves the killed case from outside the suite (CI step).
test('run-tests: the seal is a private /tmp tmpfs, capped, gone with its parent, nothing relocated', () => {
  const R = require('./run-tests.js');
  const [cmd, args] = R.sealArgs('/usr/bin/bwrap', { bytes: 1024, inodes: 10 }, ['node', 'x.js']);
  assert.equal(cmd, '/usr/bin/bwrap');
  assert.deepEqual(args.slice(0, 5), ['--dev-bind', '/', '/', '--size', '1024']);
  assert.deepEqual(args.slice(5, 7), ['--tmpfs', '/tmp']);
  for (const f of ['--die-with-parent', '--unshare-pid']) assert.ok(args.includes(f), f);
  assert.equal(args[args.indexOf('--proc') + 1], '/proc', 'its own /proc, so process lookups see the run\'s own pid namespace');
  assert.deepEqual(args.slice(-3), ['--', 'node', 'x.js']);
  assert.deepEqual(R.caps({}), { bytes: 2048 * 1024 * 1024, inodes: 200000 });
  assert.deepEqual(R.caps({ DELIVERY_TEST_TMP_MB: '64', DELIVERY_TEST_TMP_INODES: '500' }), { bytes: 64 * 1024 * 1024, inodes: 500 });
});

test('run-tests: a run that passes its inode cap is stopped and says why', () => {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(__dirname, '.inode-cap-'));
  try {
    const fixture = path.join(dir, 'many-files.test.js');
    fs.writeFileSync(fixture, "const test = require('node:test'); const fs = require('fs'); const path = require('path'); const os = require('os');\n" +
      "test('makes files', async () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'many-')); for (let i = 0; i < 6000; i++) fs.writeFileSync(path.join(d, String(i)), ''); await new Promise((r) => setTimeout(r, 8000)); });\n");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // a node:test child of a test would otherwise skip its files
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-tests.js')], { env: { ...env, DELIVERY_SEAL_ACTIVE: process.env.DELIVERY_SEAL_ACTIVE || '0', DELIVERY_TEST_UNSEALED: '1', DELIVERY_TEST_FILES: fixture, DELIVERY_TEST_TMP_INODES: '2000' }, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1, r.stdout.slice(-300) + r.stderr.slice(-300));
    assert.match(r.stderr, /passed its inode cap \(\d+ > \d+\); stopping the suite/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a pid that still runs code. Signal 0 answers for a zombie too, which an unsealed container whose PID 1
// does not reap keeps for ever (Copilot on #111), so where /proc exists its state is read; elsewhere
// (macOS) signal 0 alone.
function running(pid) {
  const fs = require('fs');
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^[^]*\) /, '')[0] !== 'Z'; } catch (e) { return !fs.existsSync('/proc/self/stat'); }
}

// Ctrl+C or a kill of the runner stops the whole suite and cleans up (Copilot on #111): the suite runs
// detached, so it would not get the terminal's signal on its own.
test('run-tests: SIGINT to the runner stops the suite\'s processes and removes the run\'s directory', async () => {
  const fs = require('fs');
  const os = require('os');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(__dirname, '.sigint-'));
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sig-'));
  try {
    const fixture = path.join(dir, 'waits.test.js');
    fs.writeFileSync(fixture, "const test = require('node:test'); test('waits', async () => { require('fs').writeFileSync(" + JSON.stringify(path.join(dir, 'ready')) + ", String(process.pid)); await new Promise((r) => setTimeout(r, 60000)); });\n");
    const env = { ...process.env, TMPDIR: outer, DELIVERY_TEST_UNSEALED: '1', DELIVERY_TEST_FILES: fixture };
    delete env.NODE_TEST_CONTEXT;
    const runner = spawn(process.execPath, [path.join(__dirname, 'run-tests.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'ready')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(path.join(dir, 'ready')), 'the fixture started');
    // the fixture's own pid, checked with running(): it needs no /proc, so it holds on macOS's unsealed run too
    const pid = Number(fs.readFileSync(path.join(dir, 'ready'), 'utf8'));
    const alive = () => (running(pid) ? [pid] : []);
    assert.ok(pid > 0 && alive().length > 0);
    const exited = new Promise((r) => runner.on('exit', r));
    runner.kill('SIGINT');
    await exited;
    for (let i = 0; i < 60 && alive().length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(alive(), [], 'no process still runs the suite');
    assert.deepEqual(fs.readdirSync(outer).filter((f) => f.startsWith('delivery-tests-')), [], 'the run\'s directory is removed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outer, { recursive: true, force: true }); }
});

// Copilot on #111: the runner outlives the suite's leader until its whole group is gone, so a
// descendant that ignores SIGTERM still gets the SIGKILL, before the run's directory is removed.
test('run-tests: a suite process that ignores SIGTERM is killed before the runner exits', async () => {
  const fs = require('fs');
  const os = require('os');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(__dirname, '.sigterm-'));
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-term-'));
  const pidFile = path.join(dir, 'stubborn');
  let pid = 0;
  const alive = () => running(pid);
  try {
    const fixture = path.join(dir, 'stubborn.test.js');
    // the child writes its pid only after its SIGTERM handler is in place
    const stubborn = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    fs.writeFileSync(fixture, "const test = require('node:test'); test('leaves a stubborn child', async () => { require('child_process').spawn(process.execPath, ['-e', " + JSON.stringify(stubborn) + "], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 60000)); });\n");
    const env = { ...process.env, TMPDIR: outer, DELIVERY_TEST_UNSEALED: '1', DELIVERY_TEST_FILES: fixture };
    delete env.NODE_TEST_CONTEXT;
    const runner = spawn(process.execPath, [path.join(__dirname, 'run-tests.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 100)); // the pid is fully written
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(pid > 0 && alive(), 'the stubborn child started');
    const exited = new Promise((r) => runner.on('exit', r));
    runner.kill('SIGTERM');
    await exited;
    for (let i = 0; i < 10 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(), false, 'the child that ignored SIGTERM is gone when the runner exits');
    assert.deepEqual(fs.readdirSync(outer).filter((f) => f.startsWith('delivery-tests-')), [], 'the run\'s directory is removed');
  } finally {
    if (pid && alive()) try { process.kill(pid, 'SIGKILL'); } catch (e) { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outer, { recursive: true, force: true });
  }
});

// Copilot on #111: a zombie left in the suite's group (its parent outside the group never reaps it, as
// under a container PID 1 that does not reap) answers signal 0 for ever; the runner still exits.
const perl = ['/usr/bin/perl', '/bin/perl'].find((p) => require('fs').existsSync(p));
test('run-tests: a zombie left in the suite\'s group does not keep the runner waiting', { skip: !perl && 'no perl to make a zombie' }, async () => {
  const fs = require('fs');
  const os = require('os');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(__dirname, '.zombie-'));
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-zombie-'));
  const pidFile = path.join(dir, 'pids');
  let parent = 0;
  let runner;
  try {
    const fixture = path.join(dir, 'zombie.test.js');
    // the forked child exits at once and stays a zombie in the suite's group; its parent moves to a
    // group of its own, out of the runner's reach, and never waits for it
    const script = `my $z = fork(); exit 0 unless $z; setpgrp(0, 0); open(my $f, '>', '${pidFile}.part') or die; print $f "$$ $z"; close $f; rename('${pidFile}.part', '${pidFile}'); sleep 60;`;
    fs.writeFileSync(fixture, "const test = require('node:test'); test('leaves a zombie', async () => { require('child_process').spawn(" + JSON.stringify(perl) + ", ['-e', " + JSON.stringify(script) + "], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 60000)); });\n");
    const env = { ...process.env, TMPDIR: outer, DELIVERY_TEST_UNSEALED: '1', DELIVERY_TEST_FILES: fixture };
    delete env.NODE_TEST_CONTEXT;
    runner = spawn(process.execPath, [path.join(__dirname, 'run-tests.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    const [p, zombie] = fs.readFileSync(pidFile, 'utf8').split(' ').map(Number);
    parent = p;
    assert.ok(parent > 0 && zombie > 0, 'the zombie\'s parent started');
    // the liveness check the other tests use: signal 0 answers for the zombie, running() does not
    for (let i = 0; i < 20 && running(zombie); i++) await new Promise((r) => setTimeout(r, 50)); // it has exited
    assert.doesNotThrow(() => process.kill(zombie, 0));
    if (fs.existsSync('/proc/self/stat')) assert.equal(running(zombie), false, 'a zombie does not count as running');
    assert.equal(running(parent), true);
    const exited = new Promise((r) => runner.on('exit', () => r(true)));
    runner.kill('SIGTERM');
    const done = await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 15000))]);
    assert.equal(done, true, 'the runner exits with a zombie still in its group');
    assert.deepEqual(fs.readdirSync(outer).filter((f) => f.startsWith('delivery-tests-')), [], 'the run\'s directory is removed');
  } finally {
    if (runner && runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
    if (parent) try { process.kill(parent, 'SIGKILL'); } catch (e) { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outer, { recursive: true, force: true });
  }
});

// Copilot on #111: an unsealed run counts its own directory, not the shared filesystem's inodes, so a
// small run on a busy filesystem is not stopped.
test('run-tests: an unsealed run on a filesystem already past the cap is not stopped for others\' files', () => {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const R = require('./run-tests.js');
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-busy-'));
  const dir = fs.mkdtempSync(path.join(__dirname, '.busy-'));
  try {
    // others' files on the same filesystem, more than the cap below
    for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(outer, `other-${i}`), '');
    const used = R.inodesUsed(outer);
    assert.ok(used > 300, `the filesystem already holds more than the cap (${used})`);
    const fixture = path.join(dir, 'small.test.js');
    fs.writeFileSync(fixture, "const test = require('node:test'); const fs = require('fs'); const path = require('path'); const os = require('os');\n" +
      "test('a few files', async () => { for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(os.tmpdir(), 'f' + i), ''); await new Promise((r) => setTimeout(r, 2500)); });\n");
    const env = { ...process.env, TMPDIR: outer, DELIVERY_TEST_UNSEALED: '1', DELIVERY_TEST_FILES: fixture, DELIVERY_TEST_TMP_INODES: '300' };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-tests.js')], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr.slice(-400));
    assert.doesNotMatch(r.stderr, /inode cap/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
