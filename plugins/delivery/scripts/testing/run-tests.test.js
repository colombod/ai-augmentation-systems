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
