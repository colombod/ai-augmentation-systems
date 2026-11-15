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

// 8l1.5: the marketplace beside the plugins directory carries the version an install reads
const MK = '.claude-plugin/marketplace.json';
const market = (v, extra = []) => JSON.stringify({ name: 'm', plugins: [{ name: 'other', version: '9.0.0' }, ...extra, ...(v === undefined ? [] : [{ name: 'app', source: './plugins/app', ...(v === null ? {} : { version: v }) }])] });
const both = (head, base) => ({ h1: { [M]: manifest(head[0]), [MK]: market(head[1]) }, main: { [M]: manifest(base[0]), [MK]: market(base[1]) } });
const check = (files) => checkVersions({ paths: ['plugins/app/a.js'], headRef: 'h1', baseRef: 'main', read: reader(files) });

test('8l1.5: the marketplace entry must name the same version as plugin.json at the head, and be above main', () => {
  // the case behind the bead: plugin.json raised, the marketplace entry left at main's
  const left = check(both(['0.43.121', '0.43.120'], ['0.43.120', '0.43.120']));
  assert.equal(left.ok, false);
  assert.match(left.why, /^\.claude-plugin\/marketplace\.json lists app at 0\.43\.120 at the head while plugins\/app\/\.claude-plugin\/plugin\.json is at 0\.43\.121: the two must name the same version$/);
  // the two files disagree the other way
  assert.match(check(both(['0.43.121', '0.43.122'], ['0.43.120', '0.43.120'])).why, /lists app at 0\.43\.122 at the head while .* is at 0\.43\.121/);
  // main's marketplace ahead of its own plugin.json: the head must clear the marketplace too
  const behind = check(both(['0.43.121', '0.43.121'], ['0.43.120', '0.43.125']));
  assert.equal(behind.ok, false);
  assert.match(behind.why, /lists app at 0\.43\.121 at the head, not above 0\.43\.125 on main, so the merged change would never install/);
  // the other direction: both raised to one version above main passes
  assert.deepEqual(check(both(['0.43.121', '0.43.121'], ['0.43.120', '0.43.120'])), { ok: true, checked: [{ dir: 'plugins/app', base: '0.43.120', head: '0.43.121' }] });
});

test('8l1.5: no marketplace, no entry or an entry without a version asks nothing more; an unreadable one is refused', () => {
  const noMarket = { h1: { [M]: manifest('1.0.1') }, main: { [M]: manifest('1.0.0') } };
  assert.equal(check(noMarket).ok, true, 'a repository with no marketplace');
  assert.equal(check(both(['1.0.1', undefined], ['1.0.0', undefined])).ok, true, 'a marketplace that does not list the plugin');
  assert.equal(check(both(['1.0.1', null], ['1.0.0', null])).ok, true, 'an entry with no version');
  const down = { h1: { [M]: manifest('1.0.1'), [MK]: market('1.0.1') }, main: { [M]: manifest('1.0.0') } };
  const r = checkVersions({ paths: ['plugins/app/a.js'], headRef: 'h1', baseRef: 'main', read: (p, ref) => (p === MK && ref === 'main' ? { unavailable: 'HTTP 502' } : reader(down)(p, ref)) });
  assert.match(r.why, /marketplace\.json on main could not be read \(HTTP 502\)/);
  assert.match(check({ h1: { [M]: manifest('1.0.1') }, main: { [M]: manifest('1.0.0'), [MK]: market('1.0.0') } }).why, /marketplace\.json is gone at the head, while main lists app at 1\.0\.0/);
  assert.match(check({ h1: { [M]: manifest('1.0.1'), [MK]: market(undefined) }, main: { [M]: manifest('1.0.0'), [MK]: market('1.0.0') } }).why, /at the head lists no valid version for app/);
  assert.match(check({ h1: { [M]: manifest('1.0.1'), [MK]: market('1.0.1') }, main: { [M]: manifest('1.0.0'), [MK]: 'not json' } }).why, /on main is not a readable marketplace/);
});

test('8l1.5: the marketplace is the one beside the plugins directory, at any depth', () => {
  const { marketplaceOf } = require('./version-gate.js');
  assert.equal(marketplaceOf('plugins/app'), '.claude-plugin/marketplace.json');
  assert.equal(marketplaceOf('vendor/plugins/b'), 'vendor/.claude-plugin/marketplace.json');
});
