// scripts/team-revive.test.js — the team's missing role sessions come back on the owner's Remote Control
// links while work is in flight (dec-chief-of-staff-000279): the rules with injected sessions, beads, pull
// requests and spawn (never a real claude), the guards both ways, the roster's remote id, the lane, and
// the watchdog run that calls it.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TR = require('./team-revive.js');
const R = require('./lib/team-revive.js');
const RO = require('./lib/roster.js');
const watchdog = require('./watchdog.js');

const T0 = '2026-11-04T09:00:00Z';
const H = 3600e3;
const iso = (t) => new Date(t).toISOString();

// a project with three roles: two on this host (pc), one on another (cloud); role directories prepared
function project({ mode, roles } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'revive-'));
  const root = path.join(base, 'ex');
  const teamDir = path.join(base, 'ex-team');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  const team = { project: 'ex', prefix: 'ex', bd_host: 'pc', ...(mode !== undefined ? { permission_mode: mode } : {}),
    roles: roles || [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }, { id: 'tech-writer', host: 'cloud' }] };
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify(team));
  for (const r of team.roles) fs.mkdirSync(path.join(teamDir, r.id), { recursive: true });
  const config = path.join(base, 'claude-config');
  fs.mkdirSync(config, { recursive: true });
  return { root, team, dir: (i) => path.join(teamDir, i), config };
}
const store = (beads) => ({ list: ({ status } = {}) => beads.filter((b) => !status || b.status === status) });
const failing = { list: () => { throw new Error('bd list: database unreachable'); } };
const BUSY = [{ id: 'ex-1', status: 'in_progress' }];
// a spawn that records its calls and hands out pids
function spawner() {
  const calls = [];
  const fn = (bin, args, opts) => { calls.push({ bin, args, ...opts }); return 4000 + calls.length; };
  return { calls, fn };
}
function run(p, argv, { beads = BUSY, live = [], prs = [], now = T0, spawn = spawner(), env = {}, who, alive = () => false, bd, pause } = {}) {
  const r = TR.main(argv, { cwd: p.root, env: { DELIVERY_HOST: 'pc', ...env }, now, bd: bd || store(beads), live, prs, alive, configDir: p.config, spawn: spawn.fn, pause, who: who || { root: p.root, team: p.team, roleId: null } });
  return { ...r, calls: spawn.calls };
}
const register = (p, instance, extra = {}) => RO.registerInstance(p.root, { instance, session_id: `sess-${instance}`, host: 'pc', model: 'opus', role_dir: p.dir(instance), now: extra.now || '2026-11-04T08:00:00Z', ...extra });
const pointer = (p, dir, sessionId) => {
  const d = path.join(p.config, 'projects', R.projectKey(dir));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'bridge-pointer.json'), JSON.stringify({ sessionId, environmentId: 'env_1', source: 'standalone', pid: 1 }));
};

test('a missing role session with work in flight is started on a new Remote Control link, in its role directory, in the team mode', () => {
  const p = project({ mode: 'acceptEdits' });
  const r = run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff'), sessionId: 's-cos', name: 'chief-of-staff@ex' }], env: { BEADS_ACTOR: 'dev@pc/chief-of-staff', DELIVERY_ROLE_ID: 'chief-of-staff', CLAUDE_CODE_BRIDGE_OWNER_ORG_UUID: 'x', CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'x', CLAUDE_CODE_SESSION_ID: 'parent' }, who: { root: p.root, team: p.team, roleId: 'chief-of-staff' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 1, 'only the missing builder on this host: the chief runs, tech-writer is on another host');
  const c = r.calls[0];
  assert.equal(c.bin, 'claude');
  assert.deepEqual(c.args, ['remote-control', '--name', 'builder@ex', '--spawn', 'session', '--permission-mode', 'acceptEdits']);
  assert.equal(c.cwd, p.dir('builder'));
  // the new session answers as its own role, never as the session that started it
  assert.equal(c.env.DELIVERY_ROLE, 'builder');
  for (const k of ['BEADS_ACTOR', 'DELIVERY_ROLE_ID', 'CLAUDE_CODE_BRIDGE_OWNER_ORG_UUID', 'CLAUDE_CODE_SESSION_ACCESS_TOKEN', 'CLAUDE_CODE_SESSION_ID']) assert.equal(c.env[k], undefined, k);
  assert.match(c.logPath, /revive-builder-/);
  const rows = R.ledger(p.root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instance, 'builder');
  assert.equal(rows[0].pid, 4001);
  assert.deepEqual(rows[0].args, c.args);
  assert.match(r.out, /Started: builder \(pid 4001\)/);
  assert.match(r.out, /Running: chief-of-staff/);
  assert.doesNotMatch(r.out, /tech-writer/);
});

test('a role session with a recorded Remote Control session is reattached to it with --session-id; claude\'s own pointer wins over the roster and is copied into it', () => {
  const p = project();
  register(p, 'builder', { remote_session_id: 'session_roster' });
  register(p, 'chief-of-staff');
  const a = run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }] });
  assert.deepEqual(a.calls[0].args, ['remote-control', '--name', 'builder@ex', '--session-id', 'session_roster', '--permission-mode', 'auto']);
  assert.match(a.out, /reattaching Remote Control session session_roster/);
  // an hour later (past the cap) claude's pointer for the directory names a newer link
  pointer(p, p.dir('builder'), 'session_pointer');
  RO.touchInstance(p.root, { instance: 'builder', now: iso(Date.parse(T0) + 30 * 60e3) });
  const b = run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }], now: iso(Date.parse(T0) + H) });
  assert.deepEqual(b.calls[0].args.slice(3, 5), ['--session-id', 'session_pointer']);
  assert.equal(RO.readRoster(p.root).instances.builder.remote_session_id, 'session_pointer');
  // a check reads it and writes nothing
  pointer(p, p.dir('builder'), 'session_newer');
  run(p, ['check'], { live: [{ cwd: p.dir('chief-of-staff') }] });
  assert.equal(RO.readRoster(p.root).instances.builder.remote_session_id, 'session_pointer');
});

test('a reattach whose session never joined is not tried again: the next start makes a new link', () => {
  const p = project();
  register(p, 'builder', { remote_session_id: 'session_gone' });
  run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }] });
  const later = iso(Date.parse(T0) + H);
  const b = run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }], now: later });
  assert.deepEqual(b.calls[0].args.slice(3, 5), ['--spawn', 'session']);
  assert.match(b.out, /its reattach to session_gone never joined/);
  // the other direction: a reattach that joined (its SessionStart moved last_seen past it) is tried again
  const q = project();
  register(q, 'builder', { remote_session_id: 'session_ok' });
  run(q, ['start'], { live: [{ cwd: q.dir('chief-of-staff') }] });
  RO.touchInstance(q.root, { instance: 'builder', now: iso(Date.parse(T0) + 60e3) });
  const c = run(q, ['start'], { live: [{ cwd: q.dir('chief-of-staff') }], now: later });
  assert.deepEqual(c.calls[0].args.slice(3, 5), ['--session-id', 'session_ok']);
});

test('a role session already open, or whose started server still runs, is not started', () => {
  const p = project();
  const open = [{ cwd: p.dir('chief-of-staff') }, { cwd: `${p.dir('builder')}/` }];
  const r = run(p, ['start'], { live: open });
  assert.equal(r.calls.length, 0);
  assert.match(r.out, /All 2 role sessions of ex on pc are running\./);
  // the builder's server started an hour and a half ago, still alive, its session not listed yet
  R.record(p.root, { type: 'start', at: iso(Date.parse(T0) - 1.5 * H), instance: 'builder', pid: 777, args: [] });
  const s = run(p, ['start'], { live: [open[0]], alive: (pid) => pid === 777 });
  assert.equal(s.calls.length, 0);
  assert.match(s.out, /All 2 role sessions of ex on pc are running\./);
  assert.match(JSON.parse(run(p, ['check', '--json'], { live: [open[0]], alive: (pid) => pid === 777 }).out).instances[1].running, /Remote Control server started .* \(pid 777\) still runs/);
  // the same server gone: started
  const g = run(p, ['start'], { live: [open[0]], alive: () => false });
  assert.equal(g.calls.length, 1);
});

test('no work in flight: nothing is started and the check says so; each kind of work in flight starts the team', () => {
  const p = project();
  const none = run(p, ['start'], { beads: [{ id: 'ex-2', status: 'open' }], prs: [{ number: 9, headRefName: 'feature/x' }] });
  assert.equal(none.calls.length, 0);
  assert.match(none.out, /No work in flight \(no bead in progress, no open pull request from a team branch, no message or handoff waiting\): no role session is started\./);
  assert.match(none.out, /Missing: chief-of-staff .*not started now \(no work in flight\)/);
  const pr = run(project(), ['start'], { beads: [], prs: [{ number: 12, headRefName: 'team/builder' }] });
  assert.equal(pr.calls.length, 2);
  assert.match(pr.out, /pull request #12 open from team\/builder/);
  const q = project();
  require('./lib/inbox.js').queue(q.root, { to: 'builder', from: 'chief-of-staff', message: 'review is back' });
  const msg = run(q, ['start'], { beads: [] });
  assert.equal(msg.calls.length, 2);
  assert.match(msg.out, /1 message waiting for builder/);
  const h = project();
  require('./lib/handoff.js').queue(h.root, { bead: 'ex-3', step: 'deploy', to: 'delivery-lead', pr: 3 });
  assert.equal(run(h, ['start'], { beads: [] }).calls.length, 2);
});

test('the cap holds: one start per instance an hour, six a day', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  assert.equal(run(p, ['start']).calls.length, 1);
  const soon = run(p, ['start'], { now: iso(Date.parse(T0) + 59 * 60e3) });
  assert.equal(soon.calls.length, 0);
  assert.match(soon.out, /held: started 2026-11-04 09:00 UTC; the next start is after 2026-11-04 10:00 UTC/);
  let t = Date.parse(T0);
  for (let i = 0; i < 5; i++) { t += H; assert.equal(run(p, ['start'], { now: iso(t) }).calls.length, 1, `start ${i + 2}`); }
  t += H;
  const seventh = run(p, ['start'], { now: iso(t) });
  assert.equal(seventh.calls.length, 0);
  assert.match(seventh.out, /started 6 times in the last day/);
  assert.equal(run(p, ['start'], { now: iso(Date.parse(T0) + 24 * H + 60e3) }).calls.length, 1, 'a day after the first start, one more');
});

test('an unreadable source is said, never "all running"; an unknown session list starts nothing', () => {
  const p = project();
  const bd = run(p, ['check'], { bd: failing, live: [{ cwd: p.dir('chief-of-staff') }, { cwd: p.dir('builder') }], prs: { unreadable: 'gh is signed out' } });
  assert.match(bd.out, /Unreadable: beads in progress \(bd list: database unreachable\)\./);
  assert.match(bd.out, /Unreadable: open pull requests \(gh is signed out\)\./);
  assert.doesNotMatch(bd.out, /All \d+ role sessions/);
  assert.match(bd.out, /Running: chief-of-staff, builder/);
  // what was read still counts: a message waiting starts the team although bd could not be read
  require('./lib/inbox.js').queue(p.root, { to: 'builder', from: 'chief-of-staff', message: 'x' });
  assert.equal(run(p, ['start'], { bd: failing }).calls.length, 2);
  const q = project();
  const blind = run(q, ['start'], { live: null });
  assert.equal(blind.calls.length, 0);
  assert.match(blind.out, /Unreadable: the open sessions \(`claude agents --json` failed\)/);
  assert.match(blind.out, /Not known whether running: chief-of-staff, builder/);
  assert.doesNotMatch(blind.out, /All \d+ role sessions/);
  assert.equal(JSON.parse(run(q, ['check', '--json'], { live: null }).out).go, false, 'the facts say no start either');
});

test('the owner\'s pause, or a pause that cannot be read, starts nothing; no pause starts the team', () => {
  const paused = run(project(), ['start'], { pause: () => ({ paused: true }) });
  assert.equal(paused.calls.length, 0);
  assert.match(paused.out, /Paused by the owner: no role session is started\./);
  const unknown = run(project(), ['start'], { pause: () => { throw new Error('goal sheet damaged'); } });
  assert.equal(unknown.calls.length, 0);
  assert.match(unknown.out, /Unreadable: the owner's pause \(goal sheet damaged\)\./);
  assert.equal(run(project(), ['start'], { pause: () => ({ paused: false }) }).calls.length, 2);
});

test('a team mode Remote Control does not take starts nothing, with the reason; default and manual send no mode flag (claude\'s own default)', () => {
  const m = run(project({ mode: 'bogus' }), ['start']);
  assert.equal(m.calls.length, 0);
  assert.match(m.out, /not started: team.json permission_mode "bogus" is not one Remote Control takes/);
  for (const mode of ['default', 'manual']) {
    const d = run(project({ mode }), ['start']);
    assert.equal(d.calls.length, 2, `${mode}: ${d.out}`);
    for (const c of d.calls) assert.ok(!c.args.includes('--permission-mode'), `${mode}: ${c.args.join(' ')}`);
  }
});

test('start is refused in a builder\'s role session and allowed in the Chief of Staff\'s and outside any role; check runs in any', () => {
  const p = project();
  const builder = { DELIVERY_ROLE: 'builder', DELIVERY_ROLE_ID: 'builder', DELIVERY_ROLE_DIR: p.dir('builder') };
  const refused = run(p, ['start'], { env: builder, who: { root: p.root, team: p.team, roleId: 'builder' } });
  assert.equal(refused.code, 1);
  assert.match(refused.out, /start is the Chief of Staff's and the host job's .*role builder/);
  assert.equal(refused.calls.length, 0);
  assert.equal(run(p, ['check'], { env: builder, who: { root: p.root, team: p.team, roleId: 'builder' } }).code, 0);
  // the marker says builder: a chief-of-staff variable does not make it the chief
  assert.equal(run(p, ['start'], { env: { ...builder, DELIVERY_ROLE_ID: 'chief-of-staff' }, who: { root: p.root, team: p.team, roleId: 'builder' } }).code, 1);
  const chief = run(p, ['start'], { env: { DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_ID: 'chief-of-staff' }, who: { root: p.root, team: p.team, roleId: 'chief-of-staff' } });
  assert.equal(chief.code, 0, chief.out);
  assert.equal(chief.calls.length, 2);
  const job = run(project(), ['start']);
  assert.equal(job.code, 0);
  assert.equal(job.calls.length, 2);
});

test('--dry-run says what it would start and starts nothing; --json gives the facts', () => {
  const p = project();
  const d = run(p, ['start', '--dry-run']);
  assert.equal(d.calls.length, 0);
  assert.match(d.out, /Missing: builder .*would start: claude remote-control --name builder@ex --spawn session --permission-mode auto/);
  assert.equal(R.ledger(p.root).length, 0);
  const j = JSON.parse(run(p, ['check', '--json']).out);
  assert.equal(j.go, true);
  assert.deepEqual(j.missing.map((i) => i.instance), ['chief-of-staff', 'builder']);
  assert.equal(run(p, ['wake']).code, 2);
});

test('a Remote Control session records its link in the roster at its start; any other session keeps the last one', () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-config-'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-role-'));
  fs.mkdirSync(path.join(config, 'sessions'));
  fs.writeFileSync(path.join(config, 'sessions', '123.json'), JSON.stringify({ pid: 123, sessionId: 'uuid-1', cwd: roleDir, bridgeSessionId: 'session_own' }));
  assert.equal(R.remoteSessionOf({ env: { CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge' }, sessionId: 'uuid-1', roleDir, configDir: config }), 'session_own');
  assert.equal(R.remoteSessionOf({ env: {}, sessionId: 'uuid-1', roleDir, configDir: config }), null, 'not under Remote Control');
  const d = path.join(config, 'projects', R.projectKey(roleDir));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'bridge-pointer.json'), JSON.stringify({ sessionId: 'session_pointer', pid: 5 }));
  assert.equal(R.remoteSessionOf({ env: { CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge' }, sessionId: 'uuid-2', roleDir, configDir: config }), 'session_pointer', 'its own file not written yet: the pointer');
  assert.equal(R.projectKey('/srv/w/ex-team/chief-of-staff'), '-srv-w-ex-team-chief-of-staff');
  const p = project();
  register(p, 'builder', { remote_session_id: 'session_a' });
  register(p, 'builder', { session_id: 'sess-2' });
  assert.equal(RO.readRoster(p.root).instances.builder.remote_session_id, 'session_a');
  register(p, 'builder', { remote_session_id: 'session_b' });
  assert.equal(RO.readRoster(p.root).instances.builder.remote_session_id, 'session_b');
});

test('the role-context hook passes a Remote Control session\'s link to the roster at its start', () => {
  const { prepareRole } = require('./prepare-role.js');
  const { sessionStartText } = require('../hooks/scripts/role-context.js');
  // a project repository with the test manifest, as role-context.test.js makes it (prepare-role clones it)
  const { execFileSync } = require('child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-project-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, '.delivery', 'team'), { recursive: true });
  for (const f of ['team.json', 'hosts.json']) fs.copyFileSync(path.join(__dirname, 'testing', 'manifest', f), path.join(repo, '.delivery', 'team', f));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const root = repo;
  const { roleDir } = prepareRole({ projectRoot: root, instance: 'staffing', teamDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rc-team-')), pluginRoot: path.join(__dirname, '..'), user: 'tester' });
  const prev = process.env.DELIVERY_ROLE;
  process.env.DELIVERY_ROLE = 'staffing';
  try {
    sessionStartText({ cwd: roleDir, session_id: 'sess-rc' }, path.join(__dirname, '..'), { now: T0, claim: () => null, remoteSession: ({ sessionId, roleDir: d }) => (sessionId === 'sess-rc' && d === roleDir ? 'session_hook' : null) });
    assert.equal(RO.readRoster(root).instances.staffing.remote_session_id, 'session_hook');
    sessionStartText({ cwd: roleDir, session_id: 'sess-plain' }, path.join(__dirname, '..'), { now: T0, claim: () => null, remoteSession: () => null });
    assert.equal(RO.readRoster(root).instances.staffing.remote_session_id, 'session_hook', 'kept by a session not under Remote Control');
  } finally { if (prev === undefined) delete process.env.DELIVERY_ROLE; else process.env.DELIVERY_ROLE = prev; }
});

test('the lane lets the Chief of Staff run check and start and refuses them to a role without the group; a builder\'s open lane meets the script\'s own refusal', () => {
  const { harness } = require('./testing/role-harness.js');
  const h = harness();
  const cmd = (sub) => `node ${path.join(__dirname, 'team-revive.js')} ${sub}`;
  assert.equal(h.bash('chief-of-staff', cmd('check'), { run: false }).deny, null);
  assert.equal(h.bash('chief-of-staff', cmd('start'), { run: false }).deny, null);
  assert.ok(h.bash('product-manager', cmd('start'), { run: false }).deny, 'the product manager may not start sessions');
  // the builder's lane runs any command: the script refuses it in the builder's role directory, before any read
  const b = h.bash('builder-1', cmd('start'));
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /start is the Chief of Staff's and the host job's/);
});

test('the watchdog\'s host-job run starts the missing role sessions after its wakes; check does not', () => {
  const p = project();
  const seen = [];
  const revive = (root, o) => { seen.push({ root, ...o }); return ['Started: builder (pid 1): x.']; };
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '' };
  const deps = { cwd: p.root, env, now: T0, live: [], bd: store(BUSY), spawn: () => 1, sweep: () => ({ removed: [], failed: [] }), userGuard: () => null, update: { configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'no-install-')) }, revive };
  const r = watchdog.main(['run', '--project', p.root], deps);
  assert.equal(seen.length, 1, r.out);
  assert.equal(seen[0].root, p.root);
  assert.equal(seen[0].dryRun, false);
  assert.match(r.out, /Team: Started: builder \(pid 1\): x\./);
  watchdog.main(['check', '--project', p.root], deps);
  assert.equal(seen.length, 1, 'check starts nothing');
  // the default in the sealed test runner starts nothing, whatever the record says
  assert.equal(watchdog.main(['run', '--project', p.root], { ...deps, revive: undefined, env: { ...env, DELIVERY_SEALED_RUN: '1' } }).code, 0);
});

// the facts a start reads, injected, for revive() called directly (as the watchdog's host job does)
const reviveDeps = (p, spawn) => ({ start: true, env: { DELIVERY_HOST: 'pc' }, now: T0, bd: store(BUSY), live: [], prs: [], alive: () => false, configDir: p.config, spawn });
const lockFile = (p) => path.join(p.root, '.delivery', 'watchdog', 'revive.lock');

test('two start passes at once (the Chief of Staff\'s and the host job\'s) open one link per instance: the second finds the start lock held', () => {
  const p = project();
  const calls = [];
  let inner = null;
  let entered = false;
  const spawn = (bin, args, opts) => {
    calls.push(opts.cwd);
    // a second pass starts while the first is spawning, before it recorded anything
    if (!entered) { entered = true; inner = TR.revive(p.root, p.team, reviveDeps(p, spawn)); }
    return 4000 + calls.length;
  };
  const outer = TR.revive(p.root, p.team, reviveDeps(p, spawn));
  assert.deepEqual(calls, [p.dir('chief-of-staff'), p.dir('builder')], 'one spawn per instance');
  assert.deepEqual(inner.started, {});
  assert.match(inner.lines.join('\n'), new RegExp(`another start pass holds the start lock \\(pid ${process.pid}\\b`));
  assert.deepEqual(Object.keys(outer.started), ['chief-of-staff', 'builder']);
  assert.equal(fs.existsSync(lockFile(p)), false, 'the lock is released after the pass');
  // check and --dry-run never take the lock
  fs.mkdirSync(path.dirname(lockFile(p)), { recursive: true });
  fs.writeFileSync(lockFile(p), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  assert.equal(run(p, ['check']).code, 0);
  assert.match(run(p, ['start', '--dry-run'], { now: iso(Date.parse(T0) + 2 * H) }).out, /would start/);
});

test('a fresh start lock held by a live pass starts nothing; a stale lock (old, or its pid gone) is broken', () => {
  const p = project();
  fs.mkdirSync(path.dirname(lockFile(p)), { recursive: true });
  fs.writeFileSync(lockFile(p), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const held = run(p, ['start']);
  assert.equal(held.calls.length, 0);
  assert.match(held.out, new RegExp(`another start pass holds the start lock \\(pid ${process.pid}\\b`));
  assert.ok(fs.existsSync(lockFile(p)), 'a lock that is not ours is left in place');
  // the same lock, older than the stale limit: broken, and the start runs
  const old = (Date.now() - 10 * 60e3) / 1000;
  fs.utimesSync(lockFile(p), old, old);
  assert.equal(run(p, ['start']).calls.length, 2);
  // a fresh lock whose pid no longer runs: broken
  const q = project();
  fs.mkdirSync(path.dirname(lockFile(q)), { recursive: true });
  fs.writeFileSync(lockFile(q), JSON.stringify({ pid: 2 ** 30, at: new Date().toISOString() }));
  assert.equal(run(q, ['start']).calls.length, 2);
  assert.equal(fs.existsSync(lockFile(q)), false);
});

// `claude remote-control --help` on claude 2.1.318 (wintermute, 2026-11-07), the flags team-revive uses, verbatim
const RC_HELP_2_1_318 = `
  --session-id <id>                Reattach to a specific session by ID (cannot be
                                   used with spawn flags or --continue)
  --permission-mode <mode>         Permission mode for spawned sessions
                                   (acceptEdits, auto, bypassPermissions, default, dontAsk, plan)
  --spawn <mode>                   Spawn mode: same-dir, worktree, session
                                   (default: same-dir)
  --name <name>                    Name for the session (shown in claude.ai/code)
`;
// what the same claude's parser said to `--permission-mode bogus` (it says "manual" where the help says "default")
const RC_PARSER_MODES = 'Error: Invalid permission mode \'bogus\'. Valid modes: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan';
// and to `--session-id x --spawn session`: the flags a reattach never takes
const RC_SESSION_ID_EXCLUDES = ['--spawn', '--capacity', '--create-session-in-dir', '--continue'];

function helpFacts(text) {
  const flat = text.replace(/\s+/g, ' ');
  const flags = new Set((text.match(/(?:^|\s)(--[a-z][a-z-]*)/g) || []).map((x) => x.trim()));
  const spawn = (flat.match(/--spawn <[^>]*> Spawn mode: ([a-z-]+(?:, [a-z-]+)*)/) || [])[1];
  const modes = (flat.match(/--permission-mode <[^>]*> Permission mode for spawned sessions \(([^)]*)\)/) || [])[1];
  return { flags, spawn: spawn ? spawn.split(', ') : [], modes: modes ? modes.split(/,\s*/) : [] };
}
// the argv a start builds, for every mode team.json may hold, with a reattach id and without
function builtArgs() {
  const out = [];
  for (const mode of [undefined, 'default', 'manual', ...R.RC_MODES]) {
    for (const remote of [null, 'session_abc']) {
      const p = project({ mode, roles: [{ id: 'builder', host: 'pc' }] });
      if (remote) register(p, 'builder', { remote_session_id: remote });
      const it = JSON.parse(run(p, ['check', '--json']).out).instances[0];
      assert.ok(!it.skip, `${mode}: ${it.skip}`);
      out.push({ mode, remote, args: it.args });
    }
  }
  return out;
}
function assertArgsMatchHelp(text) {
  const h = helpFacts(text);
  const parser = RC_PARSER_MODES.split('Valid modes: ')[1].split(/,\s*/);
  assert.ok(h.spawn.length && h.modes.length, 'the help names the spawn modes and the permission modes');
  for (const { mode, remote, args } of builtArgs()) {
    const at = `${mode || 'no mode'}${remote ? ', reattach' : ''}: ${args.join(' ')}`;
    assert.equal(args[0], 'remote-control', at);
    const used = args.filter((a) => a.startsWith('--'));
    for (const f of used) assert.ok(h.flags.has(f), `${f} is not in the help (${at})`);
    const val = (f) => args[args.indexOf(f) + 1];
    if (used.includes('--spawn')) assert.ok(h.spawn.includes(val('--spawn')), `--spawn ${val('--spawn')} (${at})`);
    if (used.includes('--permission-mode')) {
      assert.ok(h.modes.includes(val('--permission-mode')), `--permission-mode ${val('--permission-mode')} is not in the help (${at})`);
      assert.ok(parser.includes(val('--permission-mode')), `--permission-mode ${val('--permission-mode')} is refused by the parser (${at})`);
    }
    if (used.includes('--session-id')) for (const f of RC_SESSION_ID_EXCLUDES) assert.ok(!used.includes(f), `--session-id with ${f} (${at})`);
    assert.equal(used.includes('--session-id'), Boolean(remote), at);
  }
}

test('the argv a start builds is one claude remote-control 2.1.318 takes: flags in its help, --spawn and --permission-mode values it lists, --session-id never with spawn flags', () => {
  assertArgsMatchHelp(RC_HELP_2_1_318);
});

// never `claude remote-control` without --help: that starts a server
test('the argv matches the live `claude remote-control --help` on this host (DELIVERY_CLAUDE_HELP_LIVE=1 only)', (t) => {
  if (process.env.DELIVERY_CLAUDE_HELP_LIVE !== '1') { t.skip('set DELIVERY_CLAUDE_HELP_LIVE=1 to read the host claude'); return; }
  const r = require('child_process').spawnSync('claude', ['remote-control', '--help'], { encoding: 'utf8', timeout: 30000 });
  if (r.error && r.error.code === 'ENOENT') { t.skip('claude is not on PATH'); return; }
  assert.equal(r.status, 0, String(r.stderr || r.error || ''));
  assertArgsMatchHelp(`${r.stdout}\n${r.stderr}`);
});
