// scripts/testing/clock-guard.test.js — run with: node scripts/testing/run-tests.js
// hjx.1.6.8.3: CI runs the suite a second time with the clock 45 days ahead, so a test that depends on
// today's date fails there and nowhere a builder looks first. This guard brings that check into the normal
// suite for the tests that touch the calendar or the process clock: every test file whose source does
// (found by the pattern below, so a new one is picked up without a list to keep), or that says so with a
// line "// clock-sensitive" (for a test whose dependence sits in the code it calls, such as one reading a
// process start time from the kernel), runs again under two moved clocks, 45 days ahead at noon as CI
// does and 30 seconds before a year ends, and must not fail.
// run-tests.test.js is left out: it tests --clock itself, and this file runs through it.
require('./role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = path.join(__dirname, '..', '..');
const RUNNER = path.join(__dirname, 'run-tests.js');
// a month or day key cut from a date, the calendar getters, a clock fake-clock.js cannot move (the kernel's
// boot time and process start times), month boundaries named in a test, or the marker; a sha cut to seven
// characters is not a date
const CLOCK_SENSITIVE = /toISOString\(\)\.slice\(0, ?(7|10)\)|\bget(UTC)?(Month|Date|Day)\(|\bos\.uptime\(|\/proc\/(stat|self|uptime)\b|\bbtime\b|\blstart\b|\betimes\b|month (rollover|boundary)|^\s*\/\/ clock-sensitive\b/m;
const SKIP = new Set(['run-tests.test.js', 'clock-guard.test.js']);

// every *.test.js under scripts/ and hooks/ whose source touches the calendar or the process clock
function clockSensitiveFiles(root = PLUGIN) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p); continue; }
      if (!e.name.endsWith('.test.js') || SKIP.has(e.name)) continue;
      if (CLOCK_SENSITIVE.test(fs.readFileSync(p, 'utf8'))) out.push(p);
    }
  };
  for (const sub of ['scripts', 'hooks']) walk(path.join(root, sub));
  return out.sort();
}

// the two moved clocks: 45 days ahead at noon UTC (the CI step), and 30 seconds before this year ends
function clocks(now = Date.now()) {
  const ahead = new Date(now + 45 * 24 * 3600e3);
  const year = new Date(now).getUTCFullYear();
  return [`${ahead.toISOString().slice(0, 10)}T12:00:00Z`, `${year}-12-31T23:59:30Z`];
}

module.exports = { clockSensitiveFiles, clocks, CLOCK_SENSITIVE };

test('the guard finds a test file that slices a month, and leaves out one that does not touch the calendar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-guard-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'month.test.js'), "const m = new Date().toISOString().slice(0, 7);\n");
  fs.writeFileSync(path.join(root, 'hooks', 'plain.test.js'), "const x = 1;\n");
  // marked by its author: its clock dependence is in the code it calls
  fs.writeFileSync(path.join(root, 'hooks', 'marked.test.js'), "// clock-sensitive: reads process start times\nconst y = 2;\n");
  // a sha cut to seven characters and the word midnight in prose are not the calendar
  fs.writeFileSync(path.join(root, 'scripts', 'sha.test.js'), "const short = sha.slice(0, 7); // broke at midnight\n");
  fs.writeFileSync(path.join(root, 'scripts', 'run-tests.test.js'), "// rollover\n");
  assert.deepEqual(clockSensitiveFiles(root).map((p) => path.relative(root, p)), [path.join('hooks', 'marked.test.js'), path.join('scripts', 'lib', 'month.test.js')]);
  // the real plugin has some, among them the inputs log, which files its entries by month
  assert.ok(clockSensitiveFiles().some((p) => p.endsWith(path.join('lib', 'operator-log.test.js'))));
});

test('the two clocks are 45 days ahead and the last half minute of a year', () => {
  const [ahead, yearEnd] = clocks(Date.parse('2026-11-15T09:00:00Z'));
  assert.equal(ahead, '2026-12-30T12:00:00Z');
  assert.equal(yearEnd, '2026-12-31T23:59:30Z');
});

for (const clock of clocks()) {
  test(`the clock-sensitive test files pass with the clock at ${clock}`, () => {
    const files = clockSensitiveFiles();
    assert.ok(files.length > 0, 'nothing to check');
    // NODE_TEST_CONTEXT, which this test process carries, would make the nested node --test skip its files
    // and exit 0 having run nothing: so it goes, and the run must show tests counted
    const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
    const r = spawnSync(process.execPath, [RUNNER, '--clock', clock], { env: { ...env, DELIVERY_TEST_FILES: files.join(path.delimiter) }, encoding: 'utf8', timeout: 600e3, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const failing = (out.match(/^not ok .*$/gm) || []).slice(0, 10).join('\n');
    assert.equal(r.status, 0, `under --clock ${clock}:\n${failing || out.slice(-2000)}`);
    assert.match(out, /^# tests [1-9]\d*$/m, 'the files ran');
    assert.match(out, /^# fail 0$/m);
  });
}
