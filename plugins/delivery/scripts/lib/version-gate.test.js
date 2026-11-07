// scripts/lib/version-gate.test.js — a pull request that changes a plugin must raise its version
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkVersions, pluginDirs, parse, compare } = require('./version-gate.js');

const M = 'plugins/app/.claude-plugin/plugin.json';
const reader = (files) => (p, ref) => {
  const f = files[ref] || {};
  if (f === 'down') return { unavailable: 'HTTP 502' };
  return p in f ? { text: f[p] } : { missing: true };
};
const manifest = (v) => JSON.stringify({ name: 'app', version: v });

test('r7w: a plugin change whose version equals or trails the base branch is refused, naming both versions', () => {
  for (const [head, base] of [['0.43.54', '0.43.54'], ['0.43.53', '0.43.54'], ['0.43.54-rc.1', '0.43.54']]) {
    const r = checkVersions({ paths: ['plugins/app/scripts/a.js', M], headRef: 'h1', baseRef: 'main', read: reader({ h1: { [M]: manifest(head) }, main: { [M]: manifest(base) } }) });
    assert.equal(r.ok, false, `${head} vs ${base}`);
    assert.match(r.why, new RegExp(`at ${head.replace(/\./g, '\\.')} at the head, not above ${base.replace(/\./g, '\\.')} on main`));
  }
  // a change to code alone, with plugin.json untouched, leaves the head at the base version: refused too
  const same = checkVersions({ paths: ['plugins/app/scripts/a.js'], headRef: 'h1', baseRef: 'main', read: reader({ h1: { [M]: manifest('0.43.57') }, main: { [M]: manifest('0.43.57') } }) });
  assert.equal(same.ok, false);
});

test('r7w: a raised version passes; a path outside any plugin, or a new plugin, asks nothing', () => {
  const up = checkVersions({ paths: ['plugins/app/hooks/x.js'], headRef: 'h1', baseRef: 'main', read: reader({ h1: { [M]: manifest('0.43.58') }, main: { [M]: manifest('0.43.57') } }) });
  assert.deepEqual(up, { ok: true, checked: [{ dir: 'plugins/app', base: '0.43.57', head: '0.43.58' }] });
  assert.equal(checkVersions({ paths: ['plugins/app/a.js'], headRef: 'h1', baseRef: 'main', read: reader({ h1: { [M]: manifest('0.44.0') }, main: { [M]: manifest('0.43.99') } }) }).ok, true);
  let calls = 0;
  const none = checkVersions({ paths: ['src/import.js', 'README.md'], headRef: 'h1', baseRef: 'main', read: () => { calls++; return { missing: true }; } });
  assert.deepEqual(none, { ok: true, checked: [] });
  assert.equal(calls, 0, 'a product with no plugin directory is never read');
  const fresh = checkVersions({ paths: ['plugins/new/a.js'], headRef: 'h1', baseRef: 'main', read: reader({ h1: { 'plugins/new/.claude-plugin/plugin.json': manifest('0.1.0') }, main: {} }) });
  assert.equal(fresh.ok, true);
});

test('r7w: an unreadable plugin.json, a removed one or one with no valid version is refused, never passed', () => {
  const paths = ['plugins/app/a.js'];
  assert.match(checkVersions({ paths, headRef: 'h1', baseRef: 'main', read: reader({ main: 'down' }) }).why, /on main could not be read \(HTTP 502\)/);
  assert.match(checkVersions({ paths, headRef: 'h1', baseRef: 'main', read: reader({ h1: 'down', main: { [M]: manifest('1.0.0') } }) }).why, /at the head could not be read/);
  assert.match(checkVersions({ paths, headRef: 'h1', baseRef: 'main', read: reader({ h1: {}, main: { [M]: manifest('1.0.0') } }) }).why, /is gone at the head, while main has 1\.0\.0/);
  assert.match(checkVersions({ paths, headRef: 'h1', baseRef: 'main', read: reader({ h1: { [M]: '{"version": 7}' }, main: { [M]: manifest('1.0.0') } }) }).why, /no valid version/);
  // a base with no valid version is a failed read: refused, and the head is never read
  for (const bad of ['{"version": 7}', '{"name": "app"}', manifest('latest'), 'not json']) {
    let headReads = 0;
    const r = checkVersions({ paths, headRef: 'h1', baseRef: 'main', read: (p, ref) => { if (ref === 'h1') { headReads++; return { text: manifest('9.9.9') }; } return { text: bad }; } });
    assert.equal(r.ok, false, bad);
    assert.match(r.why, /on main has no valid version .*so the version step cannot be checked/, bad);
    assert.equal(headReads, 0, bad);
  }
  // every plugin the change reaches is checked, not only the first
  const two = checkVersions({ paths: ['plugins/app/a.js', 'plugins/other/b.js'], headRef: 'h1', baseRef: 'main',
    read: reader({ h1: { [M]: manifest('2.0.0'), 'plugins/other/.claude-plugin/plugin.json': manifest('0.2.0') }, main: { [M]: manifest('1.0.0'), 'plugins/other/.claude-plugin/plugin.json': manifest('0.2.0') } }) });
  assert.equal(two.ok, false);
  assert.equal(two.dir, 'plugins/other');
});

test('r7w: plugin directories and versions are read as the gate needs them', () => {
  assert.deepEqual(pluginDirs(['plugins/a/x.js', 'plugins/a/y/z.js', 'vendor/plugins/b/c.js', 'plugins.md', 'src/plugins']), ['plugins/a', 'vendor/plugins/b']);
  assert.equal(compare(parse('0.43.10'), parse('0.43.9')), 1, 'numeric, not text');
  assert.equal(compare(parse('1.0.0-rc.1'), parse('1.0.0')), -1);
  assert.equal(parse('one'), null);
});
