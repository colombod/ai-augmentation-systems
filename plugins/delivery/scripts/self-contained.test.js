// scripts/self-contained.test.js — the plugin works when installed from its own directory alone:
// nothing it ships points outside plugins/delivery. The plugin's own dogfood records
// (.delivery/ and .superpowers/, the repository's engineering record for this plugin) are the
// documented exception: they are history, not something a skill, hook or script reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const DOGFOOD = new Set(['.delivery', '.superpowers', 'node_modules', '.git']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (DOGFOOD.has(e.name) && dir === PLUGIN_ROOT) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(PLUGIN_ROOT).filter((f) => /\.(md|js|json)$/.test(f));
const inside = (p) => p === PLUGIN_ROOT || p.startsWith(PLUGIN_ROOT + path.sep);

test('self-contained: no shipped file names another plugin, the repository layout, or the dogfood records', () => {
  for (const f of files) {
    if (f === __filename) continue;
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(PLUGIN_ROOT, f);
    assert.doesNotMatch(text, /\bplugins\/(?:delivery|attractor|claim-guard)\//, `${rel} names a repository path`);
    assert.doesNotMatch(text, /\.superpowers\/(?:specs|plans)\//, `${rel} reads this plugin's own engineering record`);
    assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z][a-z0-9_-]*\//, `${rel} carries a local path`);
  }
});

test('self-contained: every relative markdown link and every relative require stays inside the plugin and exists', () => {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(PLUGIN_ROOT, f);
    const targets = f.endsWith('.md')
      ? [...text.matchAll(/\]\(((?!https?:|mailto:|#)[^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1])
      : [...text.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)].map((m) => m[1]);
    for (const t of targets) {
      const abs = path.resolve(path.dirname(f), t);
      assert.ok(inside(abs), `${rel} points outside the plugin: ${t}`);
      assert.ok(fs.existsSync(abs) || fs.existsSync(abs + '.js'), `${rel} points to ${t}, which does not exist`);
    }
  }
});
