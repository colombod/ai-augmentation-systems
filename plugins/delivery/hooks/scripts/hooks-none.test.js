// hooks/scripts/hooks-none.test.js — the plugin ships no hooks (sprint 0a, D0.2a).
// Why: a plugin's hooks run in the customer's own sessions, and the customer who installs this plugin
// expects those sessions to be left alone. The scripts under hooks/scripts/ stay for the team runtime
// (retired in 0b), but nothing may register them, and no script may put one into a user's settings.
// Run with: scripts/testing/run-tests.js.
require('../../scripts/testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');

test('hooks.json is valid JSON and registers no hook at all', () => {
  const j = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  // the shape Claude Code loads: a top-level "hooks" object; empty, it registers nothing
  assert.deepEqual(j, { hooks: {} });
});

test('no shipped script names the deleted user-level guard installer, and its files are gone', () => {
  // the installer is gone and nothing names it: a require of it would fail at run time, so check the text
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const offenders = walk(PLUGIN_ROOT).filter((f) => /ensureUserGuard|lib\/user-guard/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(PLUGIN_ROOT, f)), []);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'user-guard.js')), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', 'setup-guard.js')), false);
});
