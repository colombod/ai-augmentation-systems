// scripts/lib/launcher.test.js — run through scripts/testing/run-tests.js
// The project's script launcher (delivery-plugin-planning-8wz.1): it finds the installed plugin when it
// runs, so a command naming it survives plugin installs, and only an unedited launcher is trusted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./launcher.js');

// A fake Claude configuration: plugins/cache/m/delivery/<v>/scripts/{watchdog,echo}.js, listed in
// plugins/installed_plugins.json as the test says.
function fakeConfig() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-cfg-'));
  const cache = path.join(cfg, 'plugins', 'cache', 'm', 'delivery');
  const plugin = (v) => {
    const d = path.join(cache, v);
    fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(d, 'scripts', 'watchdog.js'), '');
    // prints what it was given and where it ran, then exits with the code its first argument names
    fs.writeFileSync(path.join(d, 'scripts', 'echo.js'), `console.log(JSON.stringify({ v: ${JSON.stringify(v)}, args: process.argv.slice(2), cwd: process.cwd() })); process.exit(Number(process.argv[2]) || 0);\n`);
    // decoys a launcher without its name check would run: a file outside scripts/, one in a subfolder,
    // and names that differ from a script only in case or extension
    fs.mkdirSync(path.join(d, 'scripts', 'testing'), { recursive: true });
    for (const f of ['echo.js', 'scripts/testing/run-tests.js', 'scripts/Echo.js', 'scripts/echo']) fs.writeFileSync(path.join(d, f), 'console.log("decoy ran");\n');
    return d;
  };
  const list = (entries) => fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'delivery@m': entries.map(([v, more]) => ({ installPath: plugin(v), version: v, ...more })) } }));
  return { cfg, cache, plugin, list };
}
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-proj-')));

test('resolveInstalledRoot: a checkout wins; else the project-local install, then the user\'s, then the newest', () => {
  const f = fakeConfig();
  const proj = project();
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-checkout-'));
  fs.mkdirSync(path.join(checkout, 'scripts'));
  fs.writeFileSync(path.join(checkout, 'scripts', 'watchdog.js'), '');
  const r = (atInstall) => L.resolveInstalledRoot({ project: proj, atInstall, configDir: f.cfg });
  f.list([['0.43.9', { scope: 'local', projectPath: '/a' }], ['0.43.10', { scope: 'local', projectPath: '/b' }]]);
  assert.equal(r(checkout), checkout);
  assert.equal(r(null), path.join(f.cache, '0.43.10'), 'newest by version, not by order');
  f.list([['0.43.10', { scope: 'local', projectPath: '/b' }], ['0.43.3', { scope: 'user' }]]);
  assert.equal(r(null), path.join(f.cache, '0.43.3'), 'the user install before a newer one local elsewhere');
  f.list([['0.43.3', { scope: 'user' }], ['0.42.0', { scope: 'local', projectPath: proj }]]);
  assert.equal(r(null), path.join(f.cache, '0.42.0'), 'an install local to the project first');
  // a cache install named at write time is used only when nothing is listed
  fs.writeFileSync(path.join(f.cfg, 'plugins', 'installed_plugins.json'), '{}');
  assert.equal(r(path.join(f.cache, '0.42.0')), path.join(f.cache, '0.42.0'));
  assert.equal(r(null), null);
});

test('the launcher\'s bytes do not depend on the cache version; a checkout is embedded', () => {
  const f = fakeConfig();
  const proj = project();
  const a = L.launcherBody(proj, path.join(f.cache, '0.43.21'), f.cfg);
  assert.equal(a, L.launcherBody(proj, path.join(f.cache, '0.43.22'), f.cfg));
  assert.doesNotMatch(a, /0\.43\.2/);
  assert.match(a, /const AT_INSTALL = null;/);
  const checkout = path.join(__dirname, '..', '..');
  assert.match(L.launcherBody(proj, checkout, f.cfg), new RegExp(`const AT_INSTALL = ${JSON.stringify(path.resolve(checkout)).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')};`));
});

test('the launcher runs scripts/<name>.js of the plugin installed now, with the arguments, the cwd and the exit code', () => {
  const f = fakeConfig();
  const proj = project();
  f.list([['0.43.21', { scope: 'user' }]]);
  assert.equal(L.ensureLauncher(proj, path.join(f.cache, '0.43.21'), f.cfg), null);
  const file = L.launcherPath(proj);
  assert.equal(file, path.join(proj, '.delivery', 'bin', 'delivery.js'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(proj, '.delivery', 'bin', '.gitignore'), 'utf8'), '*\n', 'it holds absolute paths of this machine: never committed');
  const where = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-cwd-')));
  const run = (...args) => spawnSync(process.execPath, [file, ...args], { cwd: where, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: f.cfg } });
  let r = run('echo.js', '0', 'a b', '--x');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { v: '0.43.21', args: ['0', 'a b', '--x'], cwd: where });
  assert.equal(run('echo.js', '7').status, 7, 'the exit code passes through');
  // an install moves the plugin: the same launcher, unchanged, runs the new one
  f.list([['0.43.21', { scope: 'user' }], ['0.43.22', { scope: 'user' }]]);
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(L.ensureLauncher(proj, path.join(f.cache, '0.43.22'), f.cfg), null);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a new version writes the same bytes');
  assert.equal(JSON.parse(run('echo.js').stdout).v, '0.43.22');
  // with no CLAUDE_CONFIG_DIR, the writer's configuration is used
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  assert.equal(JSON.parse(spawnSync(process.execPath, [file, 'echo.js'], { cwd: where, encoding: 'utf8', env }).stdout).v, '0.43.22');
  // a name that is not one script directly under scripts/, or a script the plugin lacks, runs nothing
  for (const bad of [[], ['../echo.js'], ['testing/run-tests.js'], ['Echo.js'], ['echo'], ['missing.js']]) {
    r = run(...bad);
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.equal(r.stdout, '', JSON.stringify(bad));
    assert.match(r.stderr, /delivery launcher:/);
  }
});

test('ensureLauncher writes only on a change and never throws', () => {
  const f = fakeConfig();
  const proj = project();
  const file = L.launcherPath(proj);
  assert.equal(L.ensureLauncher(proj, path.join(f.cache, '1.0.0'), f.cfg), null);
  const old = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600e3);
  fs.utimesSync(file, old, old);
  assert.equal(L.ensureLauncher(proj, path.join(f.cache, '1.0.1'), f.cfg), null);
  assert.equal(Math.round(fs.statSync(file).mtimeMs), old.getTime(), 'unchanged content is not rewritten');
  fs.appendFileSync(file, '// edited\n');
  assert.equal(L.ensureLauncher(proj, path.join(f.cache, '1.0.1'), f.cfg), null);
  assert.equal(fs.readFileSync(file, 'utf8'), L.launcherBody(proj, path.join(f.cache, '1.0.1'), f.cfg), 'an edited one is put back');
  const blocked = project();
  fs.mkdirSync(path.join(blocked, '.delivery'));
  fs.writeFileSync(path.join(blocked, '.delivery', 'bin'), 'a file where the directory goes');
  assert.match(L.ensureLauncher(blocked, path.join(f.cache, '1.0.1'), f.cfg), /cannot write the script launcher/);
  assert.match(L.ensureLauncher('relative/dir', null, f.cfg), /no absolute project root/);
});

test('resolveLauncher trusts only this project\'s unedited launcher', () => {
  const f = fakeConfig();
  f.list([['2.0.0', { scope: 'user' }]]);
  const proj = project();
  const root = path.join(f.cache, '2.0.0');
  assert.equal(L.resolveLauncher(proj, root, f.cfg), null, 'no launcher yet');
  L.ensureLauncher(proj, root, f.cfg);
  assert.equal(L.resolveLauncher(proj, root, f.cfg), root);
  // another project's launcher copied here names that project: refused
  const other = project();
  L.ensureLauncher(other, root, f.cfg);
  fs.copyFileSync(L.launcherPath(other), L.launcherPath(proj));
  assert.equal(L.resolveLauncher(proj, root, f.cfg), null);
  L.ensureLauncher(proj, root, f.cfg);
  // one edited byte: refused
  const body = fs.readFileSync(L.launcherPath(proj), 'utf8');
  fs.writeFileSync(L.launcherPath(proj), body.replace("'scripts', name", "'scripts', 'evil.js'"));
  assert.equal(L.resolveLauncher(proj, root, f.cfg), null);
  assert.equal(L.launcherCommand('/p q', 'operator.js'), "node '/p q/.delivery/bin/delivery.js' operator.js");
});

test('the watchdog job shim ranks installs with the launcher\'s own function, so the two cannot drift', () => {
  const shim = require('../watchdog.js').shimBody('/p', '/x', null);
  assert.ok(shim.includes(L.resolveInstalledRoot.toString()));
});
