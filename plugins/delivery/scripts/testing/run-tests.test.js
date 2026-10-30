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
