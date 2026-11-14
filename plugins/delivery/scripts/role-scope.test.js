// scripts/role-scope.test.js — hjx.1.6.10.1.2: every path that starts a role session starts it in a
// scope of its own (lib/role-scope.js). The reality check on a8b06e2 found builder-4 inside the watchdog's
// service: the wake spawned claude straight from the job.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RS = require('./lib/role-scope.js');

test('the watchdog wake runs its supervisor and session in a scope of its own where systemd runs, and as a plain child where it does not', () => {
  const { spawnWake } = require('./watchdog.js');
  const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wake-')), 'w.log');
  const calls = [];
  const spawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { pid: 4242, on() {}, unref() {} }; };
  const env = { DELIVERY_ROLE: 'builder-4', PATH: process.env.PATH };
  assert.equal(spawnWake('claude', ['--resume', 's', '-p', 'go'], { cwd: os.tmpdir(), env, logPath, systemdRun: '/usr/bin/systemd-run', spawn }), 4242);
  const c = calls[0];
  assert.equal(c.bin, '/usr/bin/systemd-run');
  assert.deepEqual(c.args.slice(0, 4), ['--user', '--scope', '--quiet', '--collect']);
  assert.match(c.args[4], /^--unit=delivery-role-builder-4-\d+$/);
  const run = c.args.slice(c.args.indexOf('--') + 1);
  assert.equal(run[0], process.execPath);
  assert.match(run[1], /lib[/\\]wake-run\.js$/);
  assert.deepEqual(run.slice(3), ['claude', '--resume', 's', '-p', 'go'], 'the session after the supervisor and its limit');
  assert.equal(c.opts.detached, true);
  // no user manager: the supervisor runs as before
  spawnWake('claude', ['-c', '-p', 'go'], { cwd: os.tmpdir(), env, logPath, systemdRun: null, spawn });
  assert.equal(calls[1].bin, process.execPath);
  assert.match(calls[1].args[0], /wake-run\.js$/);
});

test('roleCommand finds systemd-run from the environment, as a start does', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  fs.writeFileSync(path.join(bin, 'systemd-run'), '');
  fs.mkdirSync(path.join(rt, 'systemd'));
  fs.writeFileSync(path.join(rt, 'systemd', 'private'), '');
  const env = { XDG_RUNTIME_DIR: rt, PATH: bin };
  const c = RS.roleCommand('node', ['x'], { instance: 'chief-of-staff', at: '2026-11-10T07:00:00Z', env });
  if (process.platform === 'linux') {
    assert.equal(c.bin, path.join(bin, 'systemd-run'));
    assert.equal(c.unit, `delivery-role-chief-of-staff-${Date.parse('2026-11-10T07:00:00Z')}`);
  } else assert.equal(c.bin, 'node');
  assert.deepEqual(RS.roleCommand('node', ['x'], { instance: 'a', env: {} }), { bin: 'node', args: ['x'], unit: null });
});

// The spawns the plugin's scripts make that start a role session, each through roleCommand. A spawn of the
// session supervisor (lib/wake-run.js) or of claude named any other way is named here.
const SCRIPTS = path.join(__dirname);
function scripts(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['testing', 'node_modules'].includes(e.name) && !e.name.startsWith('.')) out.push(...scripts(p)); continue; }
    if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}
// spawns that are allowed by name, with why
const ALLOWED = {
  'lib/wake-run.js': 'the supervisor\'s own child: it runs inside the scope the supervisor was started in',
  'team-revive.js#spawn(bin, args, { cwd, env, detached': 'spawnRemote, the primitive every revive start calls with a roleCommand result',
  'team-revive.js#spawn(bin, was.args': 'the plain fallback after systemd-run refused the scope (PR 189)',
  'watchdog.js#spawn(bin, c.args': 'wake()\'s injected spawner, whose default is spawnWake, which spawns through roleCommand (checked below)',
};
function roleSpawns() {
  const found = [];
  for (const file of scripts(SCRIPTS)) {
    const rel = path.relative(SCRIPTS, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    const re = /\bspawn\(\s*([^,]+),\s*([^\n]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const first = m[1].trim();
      const rest = m[2];
      const session = /wake-run\.js/.test(rest) || /^(?:bin|cmd\.bin|claudeBin)$/.test(first) || /remote-control/.test(rest);
      if (!session) continue;
      found.push({ rel, first, at: `${rel}#spawn(${first}, ${rest.slice(0, 40)}`.trim() });
    }
  }
  return found;
}

test('every spawn of a role session in the scripts of this plugin goes through roleCommand, or is allowed by name with its reason', () => {
  const found = roleSpawns();
  assert.ok(found.length >= 4, `found ${found.length} session spawns`);
  const bad = found.filter((s) => s.first !== 'cmd.bin' && !ALLOWED[s.rel] && !Object.keys(ALLOWED).some((k) => k.includes('#') && s.at.startsWith(k)));
  assert.deepEqual(bad.map((s) => s.at), [], 'each of these starts a role session outside roleCommand');
  // the two this bead found are among those that now go through it
  for (const rel of ['watchdog.js', 'start.js']) assert.ok(found.some((s) => s.rel === rel && s.first === 'cmd.bin'), `${rel} spawns through roleCommand`);
});
