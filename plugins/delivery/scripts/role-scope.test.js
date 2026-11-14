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
  assert.equal(spawnWake('claude', ['--resume', 's', '-p', 'go'], { cwd: os.tmpdir(), env, logPath, systemdRun: '/usr/bin/systemd-run', spawn, settle: () => new Set() }), 4242);
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
  spawnWake('claude', ['-c', '-p', 'go'], { cwd: os.tmpdir(), env, logPath, systemdRun: null, spawn, settle: () => new Set() });
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

// The guard (testing/role-spawns.js): every call in scripts/ and hooks/ that starts a role session goes
// through lib/role-scope.js, or is allowed here by name with its reason.
const RSP = require('./testing/role-spawns.js');
const ALLOWED = {
  'scripts/host-manager.js#execFileSync(cmd, args': 'the host manager\'s systemctl runner: its cmd is a parameter, only systemctl and which; the file names claude elsewhere',
  'scripts/lib/self-update.js#execFileSync(bin, args': 'self-update\'s exec of gh and `claude plugin`, which start no role session',
  'scripts/team-revive.js#spawn(bin, args': 'spawnRemote, the primitive every revive start calls with a roleCommand result',
  'scripts/team-revive.js#spawn(bin, was.args': 'the plain start after systemd-run refused the scope, taken once the sessions are listed again (PR 189)',
  'scripts/watchdog.js#spawn(bin, c.args': 'wake()\'s injected spawner, whose default is spawnWake, which starts through startRole',
};
const keyOf = (c) => `${c.rel}#${c.fn}(${c.text}`;
const allowedKey = (c) => Object.keys(ALLOWED).find((k) => keyOf(c).startsWith(k)) || null;

test('every call in the scripts and hooks of this plugin that starts a role session goes through role-scope, or is allowed by name with its reason', () => {
  const found = RSP.scan(path.resolve(__dirname, '..'));
  const bad = found.filter((c) => !c.sanctioned && !allowedKey(c));
  assert.deepEqual(bad.map((c) => `${c.rel}:${c.line} ${c.fn}(${c.text.slice(0, 60)}`), [], 'each of these starts a role session outside role-scope');
  // the sanctioned starts: the helper itself, and team-revive's roleCommand results
  assert.ok(found.some((c) => c.rel === 'scripts/lib/role-scope.js' && c.sanctioned), 'startRole is found');
  assert.ok(found.filter((c) => c.rel === 'scripts/team-revive.js' && c.why === 'cmd is a roleCommand result').length >= 2);
  // every allowed entry still matches a call: an entry left after its call went would hide a new one
  for (const k of Object.keys(ALLOWED)) assert.ok(found.some((c) => keyOf(c).startsWith(k)), `allowed entry ${k} matches no call`);
});

test('the guard finds each bypassing form and passes the sanctioned and the read-only ones (rv-202)', () => {
  const calls = (src) => RSP.sessionCalls(src, 'scripts/planted.js');
  const flagged = (src) => calls(src).filter((c) => !c.sanctioned);
  // the four forms review planted, each found
  const bypasses = {
    'a literal claude': "const cp = require('child_process');\ncp.spawn('claude', ['-p', 'go'], { detached: true });",
    'execFile of a claude bin': "const bin = env.DELIVERY_CLAUDE_BIN || 'claude';\nrequire('child_process').execFile(bin, ['--resume', 's', '-p', 'go']);",
    'exec of a claude shell string': "const { exec } = require('child_process');\nexec('claude --resume s -p go');",
    'wake-run.js through a variable': "const sup = path.join(__dirname, 'lib', 'wake-run.js');\nconst runIt = require('child_process').spawn;\nrunIt(process.execPath, [sup, '7200000', 'x']);\nspawn(process.execPath, [sup, '7200000', 'x']);",
    'a command object that is no roleCommand result': "const cmd = makeCommand(bin);\nspawn(cmd.bin, cmd.args);",
    'fork of the supervisor': "fork(path.join(__dirname, 'lib', 'wake-run.js'), ['1', 'claude']);",
    'execSync of claude': "require('child_process').execSync(`claude -p ${prompt}`);",
  };
  for (const [what, src] of Object.entries(bypasses)) assert.ok(flagged(src).length >= 1, `${what} is not found:\n${src}`);
  // the other direction: what is no role session, or is one through roleCommand, is not flagged
  const clean = {
    'a read of the sessions': "const bin = env.DELIVERY_CLAUDE_BIN || 'claude';\nexecFileSync(bin, ['agents', '--json']);",
    'a claude version check': "spawnSync('claude', ['--version']);",
    'git': "spawnSync('git', ['status']);",
    'a regexp exec': "const m = /claude/.exec(text);",
    'a roleCommand result': "const cmd = RS.roleCommand(bin, args, { instance });\nconst child = spawn(cmd.bin, cmd.args, { detached: true });",
  };
  for (const [what, src] of Object.entries(clean)) assert.deepEqual(flagged(src), [], `${what} is flagged:\n${src}`);
});

test('a wake with no role in its environment still gets a scope of its own, named for no role', () => {
  const { spawnWake } = require('./watchdog.js');
  const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wake-')), 'w.log');
  const calls = [];
  const spawn = (bin, args) => { calls.push({ bin, args }); return { pid: 77, on() {}, unref() {} }; };
  spawnWake('claude', ['-p', 'go'], { cwd: os.tmpdir(), env: { PATH: process.env.PATH }, logPath, systemdRun: '/usr/bin/systemd-run', spawn, settle: () => new Set() });
  assert.match(calls[0].args[4], /^--unit=delivery-role-role-\d+$/);
});

// rv-202: a scope systemd-run refused left the wake logged as woken and --launch saying started, with
// nothing running
function refusingBin(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

test('startRole: a refused scope is started plain once, only while the role still has no live session; a crash in a working scope is not retried', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-start-'));
  const logPath = path.join(dir, 'start.log');
  const calls = [];
  const spawn = (bin, args) => { calls.push({ bin, args }); if (bin === '/x/systemd-run') fs.appendFileSync(logPath, 'Failed to start transient scope unit: Unit x.scope already exists.\n'); return { pid: 100 + calls.length, on() {}, unref() {} }; };
  const go = (stillMissing) => { calls.length = 0; fs.writeFileSync(logPath, ''); return RS.startRole('node', ['wake-run.js', 'claude'], { instance: 'b', env: {}, cwd: dir, logPath, systemdRun: '/x/systemd-run', spawn, settle: (pids) => new Set(pids), stillMissing }); };
  const plain = go(() => true);
  assert.deepEqual(calls.map((c) => c.bin), ['/x/systemd-run', 'node'], 'the scope, then plain');
  assert.equal(plain.pid, 102);
  assert.match(plain.fallbackFrom, /^delivery-role-b-\d+$/);
  const live = go(() => false);
  assert.deepEqual(calls.map((c) => c.bin), ['/x/systemd-run'], 'no plain start beside a live session');
  assert.equal(live.pid, null);
  assert.equal(live.why, 'it has a live session by now');
  const unknown = go(() => null);
  assert.equal(unknown.pid, null);
  assert.equal(unknown.why, 'the open sessions could not be listed again');
  // a scope that systemd-run made, whose command then exited: not a refusal, so no plain retry
  calls.length = 0;
  fs.writeFileSync(logPath, '');
  const crash = RS.startRole('node', ['x'], { instance: 'b', env: {}, cwd: dir, logPath, systemdRun: '/x/ok-run', spawn: (bin, args) => { calls.push({ bin, args }); return { pid: 9, on() {}, unref() {} }; }, settle: (pids) => new Set(pids), stillMissing: () => true });
  assert.equal(crash.pid, 9);
  assert.equal(calls.length, 1);
});

test('the wake with a real systemd-run that refuses: the session starts plain while the role has no live session, and nothing starts beside one', () => {
  const { spawnWake } = require('./watchdog.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-refuse-'));
  const sd = refusingBin(path.join(dir, 'bin'), 'systemd-run', 'echo "Failed to start transient scope unit: refused" >&2; exit 1');
  const mark = path.join(dir, 'claude-ran');
  const claude = refusingBin(path.join(dir, 'bin'), 'claude', `echo "$@" > ${JSON.stringify(mark)}`);
  const env = { PATH: process.env.PATH, DELIVERY_ROLE: 'builder-2' };
  const pid = spawnWake(claude, ['-p', 'go'], { cwd: dir, env, logPath: path.join(dir, 'a.log'), systemdRun: sd, stillMissing: () => true });
  assert.ok(Number.isInteger(pid), 'a pid: the plain start');
  for (let i = 0; i < 100 && !fs.existsSync(mark); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  assert.equal(fs.readFileSync(mark, 'utf8').trim(), '-p go', 'the session ran');
  fs.rmSync(mark);
  const none = spawnWake(claude, ['-p', 'go'], { cwd: dir, env, logPath: path.join(dir, 'b.log'), systemdRun: sd, stillMissing: () => false });
  assert.equal(none, null, 'nothing started');
  assert.match(fs.readFileSync(path.join(dir, 'b.log'), 'utf8'), /refused scope delivery-role-builder-2-\d+, and no plain start followed: it has a live session by now/);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  assert.ok(!fs.existsSync(mark), 'the session never ran');
});
