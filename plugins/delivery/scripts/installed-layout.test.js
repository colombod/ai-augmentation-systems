// scripts/installed-layout.test.js — the as-role and reality-check suites run from a copy of the plugin laid
// out as Claude Code installs it (.../plugins/cache/<marketplace>/delivery/<version>/). There __dirname names
// one version, which refine refuses or rewrites in a stored command, so a test that builds a step from it
// passes in a checkout and fails installed (delivery-plugin-planning-8wz.6: 5 such tests failed from the
// 0.43.53 cache while the checkout suite was green).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');
const FILES = ['verify-run.test.js', 'reality-check.test.js'];
// what the cache never holds: the tracked engineering records
const SKIP = new Set(['.delivery', '.superpowers', 'node_modules', '.git']);

function installedCopy() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-'));
  const dest = path.join(base, '.claude', 'plugins', 'cache', 'ai-augmentation-systems', 'delivery', '0.0.1');
  fs.cpSync(PLUGIN_ROOT, dest, { recursive: true, filter: (src) => !path.relative(PLUGIN_ROOT, src).split(path.sep).some((part) => SKIP.has(part)) });
  return { base, dest };
}

test('8wz.6: verify-run and reality-check pass from an installed-layout copy of the plugin', () => {
  const { base, dest } = installedCopy();
  assert.ok(require('./lib/launcher.js').VERSIONED.test(dest), `the copy is laid out as an install: ${dest}`);
  const env = { ...process.env };
  // run as a top-level test process, not as a child reporting to this one
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', ...FILES.map((f) => path.join(dest, 'scripts', f))], { cwd: base, env, encoding: 'utf8', timeout: 300e3, maxBuffer: 64 * 1024 * 1024 });
  const failed = (r.stdout.match(/^not ok \d+ - .*$/gm) || []).join('\n');
  assert.equal(r.status, 0, `failed from the installed layout:\n${failed || String(r.stderr).slice(-2000)}`);
  assert.match(r.stdout, /^# fail 0$/m);
});
