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

// The guard (testing/role-spawns.js), from the files outward (rv-202-delivery-lead-8): every file in
// scripts/ and hooks/ whose code requires child_process is listed here with the reason it runs processes;
// those whose code names a session are listed again; and in those, every session start goes through
// lib/role-scope.js or is allowed by name with its reason.
const RSP = require('./testing/role-spawns.js');
const PROCESS_FILES = {
  'hooks/scripts/lane.js': 'git, to read a worktree\'s branch for the lane; it names claude only to judge commands',
  'hooks/scripts/leak.js': 'git, to list the staged files it checks',
  'hooks/scripts/role-context.js': 'bd, to read the session\'s claim for its context line',
  'scripts/amplifier.js': 'the amplifier command line it hands a machine problem to',
  'scripts/goal.js': 'operator.js ask, through node',
  'scripts/host-manager.js': 'systemctl and which; it reads the sessions through the watchdog',
  'scripts/lib/andon.js': 'gh, to read CI runs',
  'scripts/lib/bd.js': 'bd, for every bead read and write',
  'scripts/lib/codemap.js': 'git, for the feature map',
  'scripts/lib/gate-context.js': 'git, to find the project root',
  'scripts/lib/gh-pr.js': 'gh, to read pull requests',
  'scripts/lib/launcher.js': 'the installed plugin script it launches, through node',
  'scripts/lib/operator-store.js': 'git, for the operator records',
  'scripts/lib/plan-sync.js': 'git, to sync the plan',
  'scripts/lib/product-view.js': 'git and gh, to read the product repository',
  'scripts/lib/publish-records.js': 'git, to publish records',
  'scripts/lib/role-scope.js': 'the role-session start itself: systemd-run, or the plain start',
  'scripts/lib/self-update.js': 'git, gh and `claude plugin`, which start no role session',
  'scripts/lib/session-message.js': 'the socket client that delivers a message to a running session',
  'scripts/lib/team-revive.js': 'systemctl --user is-enabled and is-active, the reads that tell whether a unit the plugin did not write still serves a role directory',
  'scripts/lib/user-guard.js': 'a hook script, through node',
  'scripts/lib/wake-run.js': 'the supervisor: runs the command startRole gives it, in its own process group',
  'scripts/lib/watch.js': 'git, to name a worktree\'s branch',
  'scripts/lib/watchdog.js': 'git and bd reads for the watchdog\'s plan',
  'scripts/map.js': 'git, for the files a change touches',
  'scripts/materialise.js': 'git and bd, to write the bead graph',
  'scripts/prepare-role.js': 'git, to prepare role worktrees',
  'scripts/ready.js': 'git, to tell a repository',
  'scripts/review-run.js': 'git, for the reviewer\'s scratch clone',
  'scripts/start.js': 'the prerequisite checks (claude --version, git, bd); --launch starts through startRole',
  'scripts/team-revive.js': 'ps, and the revive\'s Remote Control starts through roleCommand',
  'scripts/team-role.js': 'git, for a role\'s worktree',
  'scripts/team-status.js': 'bd and git, for the roster',
  'scripts/testing/fake-bd.js': 'git, as the stand-in bd reads its origin',
  'scripts/testing/role-harness.js': 'the hook scripts under test, through node',
  'scripts/testing/run-tests.js': 'bwrap and node --test, the sealed runner',
  'scripts/testing/seal-check.js': 'run-tests.js, to check the seal',
  'scripts/verify-run.js': 'git and the story\'s check script',
  'scripts/watch.js': 'gh and the command it waits on',
  'scripts/watchdog.js': 'claude agents (a read), and the wake through startRole',
};
const SESSION_FILES = {
  'hooks/scripts/lane.js': 'names claude and remote-control to judge a command; it runs only git',
  'scripts/host-manager.js': 'reads the sessions (claude agents) through the watchdog; runs systemctl',
  'scripts/lib/self-update.js': 'runs `claude plugin` to update the install; no session',
  'scripts/start.js': '--launch starts each role through startRole',
  'scripts/team-revive.js': 'starts Remote Control sessions through roleCommand',
  'scripts/watchdog.js': 'reads claude agents and wakes a session through startRole',
  'scripts/lib/team-revive.js': 'names claude remote-control to recognise a role unit; it runs only systemctl is-enabled and is-active',
};
// The starts that go through a user unit, not a scope (hjx.1.6.10.1.2.1): the unit is the role's start
// path and holds its own TasksMax, so these are allowed by name, each with its reason, and each is checked
// to still be what its reason says.
const UNIT_STARTS = {
  'scripts/team-revive.js#startOwnUnit': 'a unit start through systemctl: reset-failed, then start of the plugin\'s own role unit; it starts no session itself, the unit does',
  'scripts/host-manager.js#installRole': 'a unit start through systemctl: daemon-reload, then enable (with --now only when no session of the role is live) of the plugin\'s own role unit',
  'scripts/host-manager.js#execve': 'the unit\'s own session: run-session replaces itself with claude (process.execve), so the session is the unit\'s main process in the unit\'s cgroup, under its TasksMax',
  'scripts/watchdog.js#defaultRevive': 'a unit restart through systemctl: restart of the plugin\'s own unit (the host manager\'s, on an older plugin and idle on a fresh read), handed to the start pass as restartUnit; it starts no session itself, the unit does',
  'scripts/lib/launcher.js#execve': 'the launcher replaces itself with the plugin script it was asked to run (node, never claude), so a unit that runs run-session through it holds that script and the claude it execs as its main process',
};
const ALLOWED = {
  'scripts/host-manager.js#execFileSync(cmd, args': 'the host manager\'s systemctl runner: its cmd is a parameter, only systemctl and which; the file names claude elsewhere',
  'scripts/lib/self-update.js#execFileSync(bin, args': 'self-update\'s exec of gh and `claude plugin`, which start no role session',
  'scripts/team-revive.js#spawn(bin, args': 'spawnRemote, the primitive every revive start calls with a roleCommand result',
  'scripts/team-revive.js#spawn(bin, was.args': 'the plain start after systemd-run refused the scope, taken once the sessions are listed again (PR 189)',
  'scripts/watchdog.js#spawn(bin, c.args': 'wake()\'s injected spawner, whose default is spawnWake, which starts through startRole',
};
const keyOf = (c) => `${c.rel}#${c.fn}(${c.text}`;
const allowedKey = (c) => Object.keys(ALLOWED).find((k) => keyOf(c).startsWith(k)) || null;

// what the guard refuses in a scan, as lines naming the file (and the call)
function guardProblems(found, { processFiles = PROCESS_FILES, sessionFiles = SESSION_FILES } = {}) {
  const out = [];
  for (const f of found.processFiles) if (!processFiles[f]) out.push(`${f} requires child_process and is not listed with its reason`);
  for (const f of Object.keys(processFiles)) if (!found.processFiles.includes(f)) out.push(`${f} is listed but no longer requires child_process`);
  for (const f of found.sessionFiles) if (!sessionFiles[f]) out.push(`${f} requires child_process and names a session, and is not listed as a session file`);
  for (const f of Object.keys(sessionFiles)) if (!found.sessionFiles.includes(f)) out.push(`${f} is listed as a session file but names no session`);
  for (const c of found.calls) if (!c.sanctioned && !allowedKey(c)) out.push(`${c.rel}:${c.line} ${c.fn}(${c.text.slice(0, 60)} starts a role session outside role-scope`);
  return out;
}

test('every file in scripts/ and hooks/ that requires child_process is listed with its reason, and every session start in them goes through role-scope', () => {
  const found = RSP.scan(path.resolve(__dirname, '..'));
  assert.deepEqual(guardProblems(found), []);
  for (const [k, why] of Object.entries({ ...PROCESS_FILES, ...SESSION_FILES, ...ALLOWED })) assert.ok(why.length > 10, `${k} has a reason`);
  // the sanctioned starts: the helper's own calls, each found and each sanctioned as the helper (it names no
  // session itself, so it is a process file only and its calls are read here directly), and team-revive's
  // roleCommand results
  const helper = RSP.sessionCalls(fs.readFileSync(path.join(__dirname, 'lib', 'role-scope.js'), 'utf8'), 'scripts/lib/role-scope.js');
  assert.ok(helper.length >= 1, 'the spawn startRole runs both its scoped and its plain start through is found');
  assert.deepEqual(helper.filter((c) => c.why !== 'the helper itself (startRole)'), []);
  assert.ok(found.processFiles.includes('scripts/lib/role-scope.js') && !found.sessionFiles.includes('scripts/lib/role-scope.js'));
  assert.ok(found.calls.filter((c) => c.rel === 'scripts/team-revive.js' && c.why === 'cmd is a roleCommand result').length >= 2);
  // every allowed entry still matches a call: an entry left after its call went would hide a new one
  for (const k of Object.keys(ALLOWED)) assert.ok(found.calls.some((c) => keyOf(c).startsWith(k)), `allowed entry ${k} matches no call`);
});

test('a new file that requires child_process, in any form, is named until it is listed; one that names a session is named until it is a session file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks', 'scripts'), { recursive: true });
  const plant = (rel, src) => fs.writeFileSync(path.join(root, rel), src);
  plant('scripts/a.js', "const cp = require('child_process');\ncp.spawnSync('git', ['status']);\n");
  plant('scripts/lib/b.js', "const { spawn: go } = require('node:child_process');\n");
  plant('hooks/scripts/c.js', "import { execFile } from 'child_process';\n");
  plant('scripts/d.js', "// require('child_process') in a comment is no require\nconst x = 1;\n");
  plant('scripts/f.js', "const kids = require ('child_process');\n");
  plant('scripts/g.js', "async function f() { return import('child_process'); }\n");
  plant('scripts/e.js', "const run = require('child_process').spawn;\nrun('/opt/bin/claude', ['-p', 'go']);\n");
  const found = RSP.scan(root);
  assert.deepEqual(found.processFiles, ['hooks/scripts/c.js', 'scripts/a.js', 'scripts/e.js', 'scripts/f.js', 'scripts/g.js', 'scripts/lib/b.js']);
  assert.deepEqual(found.sessionFiles, ['scripts/e.js']);
  const lists = { processFiles: { 'scripts/a.js': 'git status', 'hooks/scripts/c.js': 'x', 'scripts/lib/b.js': 'x', 'scripts/e.js': 'x', 'scripts/f.js': 'x', 'scripts/g.js': 'x' }, sessionFiles: {} };
  const p = guardProblems(found, lists);
  assert.ok(p.includes('scripts/e.js requires child_process and names a session, and is not listed as a session file'), p.join('\n'));
  assert.ok(p.some((l) => /^scripts\/e\.js:2 spawn\(/.test(l)), p.join('\n'));
  assert.deepEqual(guardProblems(found, { processFiles: {}, sessionFiles: {} }).filter((l) => /is not listed with its reason/.test(l)).length, 6);
  // the other direction: every file listed and the start sanctioned, nothing is named
  plant('scripts/e.js', "const RS = require('./lib/role-scope.js');\nconst run = require('child_process').spawn;\nconst cmd = RS.roleCommand('/opt/bin/claude', ['-p', 'go'], { instance });\nrun(cmd.bin, cmd.args);\n");
  assert.deepEqual(guardProblems(RSP.scan(root), { ...lists, sessionFiles: { 'scripts/e.js': 'x' } }), []);
});

test('the guard finds each bypassing form, each fixture holding only its own form, and passes the sanctioned and the read-only ones (rv-202)', () => {
  const flagged = (src) => RSP.sessionCalls(src, 'scripts/planted.js').filter((c) => !c.sanctioned);
  const bypasses = {
    'a literal claude': "const cp = require('child_process');\ncp.spawn('claude', ['-p', 'go'], { detached: true });",
    'an absolute path to claude': "const { spawn } = require('child_process');\nspawn('/usr/local/bin/claude', ['-p', 'go']);",
    'a relative path to claude': "const { spawn } = require('child_process');\nspawn('./node_modules/.bin/claude', ['--resume', 's']);",
    'execFile of a claude bin': "const bin = env.DELIVERY_CLAUDE_BIN || 'claude';\nrequire('child_process').execFile(bin, ['--resume', 's', '-p', 'go']);",
    'exec of a claude shell string': "const { exec } = require('child_process');\nexec('claude --resume s -p go');",
    'an alias of require(child_process).spawn': "const sup = path.join(__dirname, 'lib', 'wake-run.js');\nconst runIt = require('child_process').spawn;\nrunIt(process.execPath, [sup, '7200000', 'x']);",
    'a destructured rename': "const { spawn: go } = require('child_process');\ngo('claude', ['-p', 'go']);",
    'an alias of an alias': "const cp = require('child_process');\nconst proc = cp;\nconst start = proc.spawn;\nstart('claude', ['-p', 'go']);",
    'spawn on another variable name': "proc.spawn('claude', ['-p', 'go']);",
    'execSync on a child_process alias': "const kids = require('child_process');\nkids.execSync('claude -p go');",
    'a command object that is no roleCommand result': "const cmd = makeCommand(bin);\nspawn(cmd.bin, cmd.args);",
    'fork of the supervisor': "fork(path.join(__dirname, 'lib', 'wake-run.js'), ['1', 'claude']);",
    'execSync of claude': "require('child_process').execSync(`claude -p ${prompt}`);",
    'an alias in a default parameter': "function go({ run = require('child_process').spawn } = {}) {\n  run('claude', ['-p', 'go']);\n}",
    'an alias by plain assignment': "let run;\nrun = require('child_process').spawnSync;\nrun('claude', ['-p', 'go']);",
    'an object by plain assignment': "let kids;\nkids = require('child_process');\nkids.execSync('claude -p go');",
    'require with a space': "const { spawn: go } = require ('child_process');\ngo('claude', ['-p', 'go']);",
    'import() of child_process': "const kids = await import('node:child_process');\nkids.execSync('claude -p go');",
    'a destructured await import()': "const { spawn: go } = await import('child_process');\ngo('claude', ['-p', 'go']);",
    'a member of a bracketed await import(), declared': "const go = (await import('child_process')).spawn;\ngo('claude', ['-p', 'go']);",
    'a member of a bracketed await import(), assigned': "let go;\ngo = (await import('node:child_process')).execSync;\ngo('claude -p go');",
  };
  for (const [what, src] of Object.entries(bypasses)) assert.equal(flagged(src).length, 1, `${what} is not found once:\n${src}`);
  const clean = {
    'a read of the sessions': "const bin = env.DELIVERY_CLAUDE_BIN || 'claude';\nexecFileSync(bin, ['agents', '--json']);",
    'a claude version check': "spawnSync('claude', ['--version']);",
    'git': "spawnSync('git', ['status']);",
    'a regexp exec': "const m = /claude/.exec(text);",
    'a regexp exec on a variable': "const re = /x/;\nre.exec('claude -p go');",
    'claude named in a comment': "// spawn('claude', ['-p', 'go'])\nspawnSync('git', ['log']);",
    'a word that only ends in claude': "spawn('myclaude', ['-p', 'go']);",
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

test('the starts through a user unit are listed with their reasons, and each is still only what its reason says', () => {
  for (const [k, why] of Object.entries(UNIT_STARTS)) assert.ok(why.length > 10, `${k} has a reason`);
  const src = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const body = (rel, name) => { const t = src(rel); const i = t.indexOf(`function ${name}(`); assert.ok(i >= 0, `${rel} has ${name}`); return t.slice(i, t.indexOf('\n}\n', i)); };
  // startOwnUnit runs systemctl --user reset-failed and start of the unit it is given, and nothing else
  const own = body('scripts/team-revive.js', 'startOwnUnit');
  assert.deepEqual([...own.matchAll(/\bexec\(([^;]*)\)/g)].map((m) => m[1]), ["'systemctl', ['--user', 'reset-failed', unit]", "'systemctl', ['--user', 'start', unit]"]);
  // installRole's commands are a reload and an enable of the unit it wrote; it never stops, disables or restarts one
  const ins = body('scripts/host-manager.js', 'installRole');
  assert.match(ins, /\['systemctl', \['--user', 'daemon-reload'\]\], \['systemctl', \['--user', 'enable', \.\.\.\(startNow \? \['--now'\] : \[\]\), u\.unit\]\]/);
  assert.doesNotMatch(ins, /'(stop|disable|restart|kill|mask)'/);
  // run-session's exec is the one claude start of the host manager's and the Chief of Staff's units
  const rs = body('scripts/host-manager.js', 'runSession');
  assert.equal([...rs.matchAll(/\bex\(/g)].length, 1);
  assert.match(rs, /process\.execve/);
  // the watchdog's start pass restarts a unit only as systemctl --user restart of the unit it is given
  const dr = body('scripts/watchdog.js', 'defaultRevive');
  assert.deepEqual([...dr.matchAll(/runner\(exec\)\(([^;]*)\);/g)].map((m) => m[1]), ["'systemctl', ['--user', 'restart', unit]"]);
  // the launcher's exec runs node on a plugin script, never claude or a command it was handed
  const lb = require('./lib/launcher.js').launcherBody('/p', null, null);
  assert.deepEqual([...lb.matchAll(/process\.execve\(([^\n]*)\);\n/g)].map((m) => m[1]), ['process.execPath, [process.execPath, script, ...process.argv.slice(3)], process.env']);
  assert.match(lb, /const script = path\.join\(root, 'scripts', name\);/);
  // and the role unit carries the task limit a unit that holds one session needs
  const HMS = require('./host-manager.js');
  const SL = require('./lib/service-limits.js');
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-unit-'));
  const u = HMS.roleUnitFiles(where, { project: 'acme', prefix: 'acme', roles: [] }, 'chief-of-staff', { env: { PATH: '/usr/bin' }, home: where, host: 'pc', roleDir: path.join(where, 'cos') });
  assert.match(u.body, new RegExp(`^TasksMax=${SL.needOf(u.unit, 0)}$`, 'm'));
  assert.match(u.body, /"host-manager\.js" "run-session"/);
});
