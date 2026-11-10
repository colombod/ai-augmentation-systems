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
  // a server that stays up (same-dir, one session at a time), never --spawn session, which exits when its one session completes
  assert.deepEqual(c.args, ['remote-control', '--name', 'builder@ex', '--spawn', 'same-dir', '--capacity', '1', '--permission-mode', 'acceptEdits']);
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
  // claude's pointer for the directory names a newer link than the roster's
  const q = project();
  register(q, 'builder', { remote_session_id: 'session_roster' });
  pointer(q, q.dir('builder'), 'session_pointer');
  const b = run(q, ['start'], { live: [{ cwd: q.dir('chief-of-staff') }] });
  assert.deepEqual(b.calls[0].args.slice(3, 5), ['--session-id', 'session_pointer']);
  assert.equal(RO.readRoster(q.root).instances.builder.remote_session_id, 'session_pointer');
  // a check reads it and writes nothing
  pointer(q, q.dir('builder'), 'session_newer');
  run(q, ['check'], { live: [{ cwd: q.dir('chief-of-staff') }] });
  assert.equal(RO.readRoster(q.root).instances.builder.remote_session_id, 'session_pointer');
});

test('a reattach whose session never joined is not tried again: the next start makes a new link', () => {
  const p = project();
  register(p, 'builder', { remote_session_id: 'session_gone' });
  run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }] });
  const later = iso(Date.parse(T0) + H);
  const b = run(p, ['start'], { live: [{ cwd: p.dir('chief-of-staff') }], now: later });
  assert.deepEqual(b.calls[0].args.slice(3, 7), ['--spawn', 'same-dir', '--capacity', '1']);
  assert.match(b.out, /its reattach to session_gone never joined/);
});

// hjx.1.6.12: a reattach (--session-id) is claude's single-session mode, "exits when complete", so a role
// started that way ended after one task and waited an hour for the next start with its work left
test('a role whose server ended after its session ran is started again at once, on a server that stays up', () => {
  const live = (p) => [{ cwd: p.dir('chief-of-staff') }];
  const at = (min) => iso(Date.parse(T0) + min * 60e3);
  const p = project();
  register(p, 'builder', { remote_session_id: 'session_ok' });
  assert.deepEqual(run(p, ['start'], { live: live(p) }).calls[0].args.slice(3, 5), ['--session-id', 'session_ok']);
  // its session joined, did its task, and the single-session server exited: ten minutes on, not an hour
  RO.touchInstance(p.root, { instance: 'builder', now: at(1) });
  const again = run(p, ['start'], { live: live(p), now: at(10) });
  assert.equal(again.calls.length, 1, again.out);
  assert.deepEqual(again.calls[0].args.slice(3, 7), ['--spawn', 'same-dir', '--capacity', '1'], 'never a second reattach, which would end the same way');
  assert.match(again.out, /its reattach to session_ok ran and ended/);
  // a server that stays up but was stopped after its session ran is started again too, still not a reattach
  RO.touchInstance(p.root, { instance: 'builder', now: at(12) });
  const third = run(p, ['start'], { live: live(p), now: at(20) });
  assert.equal(third.calls.length, 1, third.out);
  assert.deepEqual(third.calls[0].args.slice(3, 7), ['--spawn', 'same-dir', '--capacity', '1']);
  // the other direction: a start whose session never joined is held for the hour
  const q = project();
  run(q, ['start'], { live: live(q) });
  const held = run(q, ['start'], { live: live(q), now: at(10) });
  assert.equal(held.calls.length, 0);
  assert.match(held.out, /Missing: builder .*held: started 2026-11-04 09:00 UTC/);
  // and the daily cap still bounds a server that runs and ends over and over
  const c = project({ roles: [{ id: 'builder', host: 'pc' }] });
  register(c, 'builder');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    n += run(c, ['start'], { now: at(i * 10) }).calls.length;
    RO.touchInstance(c.root, { instance: 'builder', now: at(i * 10 + 1) });
  }
  assert.equal(n, 6, 'six starts a day');
});

// rv-190 with PR 186: a restart onto the installed plugin reattaches with --session-id, so the owner keeps
// the link and the conversation; that is claude's single-session mode, which ends after the task. The
// restart row is a reattach of that link, so the next start is a server that stays up, at once.
test('a session restarted onto the installed plugin that ran and ended is started again at once, on a server that stays up', () => {
  const at = (min) => iso(Date.parse(T0) + min * 60e3);
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  register(p, 'builder', { remote_session_id: 'session_x' });
  R.record(p.root, { type: 'restart', at: at(0), instance: 'builder', pid: 901, args: ['remote-control', '--name', 'builder@ex', '--session-id', 'session_x'], session_id: 'session_x', from: '0.1.0', to: '0.2.0', stopped: 900 });
  RO.touchInstance(p.root, { instance: 'builder', now: at(2) });
  const r = run(p, ['start'], { now: at(15) });
  assert.equal(r.calls.length, 1, r.out);
  assert.deepEqual(r.calls[0].args.slice(3, 7), ['--spawn', 'same-dir', '--capacity', '1']);
  assert.match(r.out, /its reattach to session_x ran and ended/);
  // the other direction: a restart whose session never came up is held for the hour, as a start is
  const q = project({ roles: [{ id: 'builder', host: 'pc' }] });
  register(q, 'builder', { remote_session_id: 'session_x' });
  R.record(q.root, { type: 'restart', at: at(0), instance: 'builder', pid: 901, session_id: 'session_x', from: '0.1.0', to: '0.2.0', stopped: 900 });
  const held = run(q, ['start'], { now: at(15) });
  assert.equal(held.calls.length, 0);
  assert.match(held.out, /held: started 2026-11-04 09:00 UTC/);
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
  assert.match(d.out, /Missing: builder .*would start: claude remote-control --name builder@ex --spawn same-dir --capacity 1 --permission-mode auto/);
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

test('a process list that cannot be read is not a running server: the instance is not started, and the check says why', () => {
  // serverAlive: ps failing is unknown (null), never running
  const kill = () => true;
  assert.equal(TR.serverAlive(4242, { kill, exec: () => { throw new Error('ps: timed out'); } }), null);
  assert.equal(TR.serverAlive(4242, { kill, exec: () => '/usr/bin/vim notes.txt\n' }), false);
  assert.equal(TR.serverAlive(4242, { kill, exec: () => 'claude remote-control --name builder@ex\n' }), true);
  assert.equal(TR.serverAlive(4242, { kill: () => { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; }, exec: () => 'claude remote-control' }), false);
  // its last started server's liveness unknown: not running, not started, named
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  R.record(p.root, { type: 'start', at: iso(Date.parse(T0) - 2 * H), instance: 'builder', pid: 777, args: [] });
  const r = run(p, ['start'], { alive: () => null });
  assert.equal(r.calls.length, 0, r.out);
  assert.match(r.out, /Missing: builder .*held: the process list could not be read, so whether its Remote Control server started .* \(pid 777\) still runs is not known/);
  assert.doesNotMatch(r.out, /All \d+ role sessions/);
  const j = JSON.parse(run(p, ['check', '--json'], { alive: () => null }).out).instances[0];
  assert.equal(j.running, null);
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
  --capacity <N>                   Max concurrent sessions in worktree or
                                   same-dir mode (default: 32)
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

// ---- a role session still open on an older plugin than the installed one (delivery-plugin-planning-hjx.1.6.7) ----
// The chief-of-staff session on a real host ran 0.43.55 hooks three days after 0.43.74 was installed: Claude
// Code loads a plugin's hooks at a session's start, so only a restart moves its lane onto the new version.
const COS_DIR = (p) => p.dir('chief-of-staff');
const bridgeFile = (p, { pid = 5100, sessionId = 'sess-chief-of-staff', cwd, bridgeSessionId = 'session_cos' } = {}) => {
  fs.mkdirSync(path.join(p.config, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(p.config, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd, bridgeSessionId }));
};
// the chief on 0.43.55, open and idle under a Remote Control server (pid 5000); builder open and current
function staleTeam({ version = '0.43.55', status = 'idle', rosterSession = 'sess-chief-of-staff' } = {}) {
  const p = project();
  register(p, 'chief-of-staff', { plugin_version: version, session_id: rosterSession });
  register(p, 'builder', { plugin_version: '0.43.74' });
  bridgeFile(p, { cwd: COS_DIR(p) });
  const live = [
    { cwd: COS_DIR(p), sessionId: 'sess-chief-of-staff', pid: 5100, name: 'Chief of Staff', status },
    { cwd: p.dir('builder'), sessionId: 'sess-builder', pid: 5200, name: 'builder@ex', status: 'idle' },
  ];
  return { p, live };
}
const RC_OF_CHIEF = (pid) => (pid === 5100 ? { pid: 5000, self: false } : null);
function restartRun(p, argv, { live, server = RC_OF_CHIEF, stop = () => true, relist, pause, installed = '0.43.74', spawnThrows } = {}) {
  const spawn = spawner();
  if (spawnThrows) spawn.fn = () => { throw new Error(spawnThrows); };
  const stops = [];
  const r = TR.main(argv, { cwd: p.root, env: { DELIVERY_HOST: 'pc' }, now: T0, bd: store(BUSY), live, prs: [], alive: () => false, configDir: p.config, spawn: spawn.fn, installed, server, stop: (s, c) => { stops.push([s, c]); return stop(s, c); }, relist, pause, who: { root: p.root, team: p.team, roleId: null } });
  return { ...r, calls: spawn.calls, stops };
}

test('an idle role session on an older plugin is restarted on the installed one: its Remote Control server stops, and a new one reattaches the same link', () => {
  const { p, live } = staleTeam();
  const r = restartRun(p, ['start'], { live });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.stops, [[5000, 5100]], 'the server of the chief session is stopped, nothing else');
  assert.equal(r.calls.length, 1, r.out);
  assert.deepEqual(r.calls[0].args, ['remote-control', '--name', 'chief-of-staff@ex', '--session-id', 'session_cos', '--permission-mode', 'auto']);
  assert.equal(r.calls[0].cwd, COS_DIR(p));
  assert.equal(r.calls[0].env.DELIVERY_ROLE, 'chief-of-staff');
  const row = R.ledger(p.root).find((x) => x.type === 'restart');
  assert.ok(row, 'the restart is a ledger row');
  assert.equal(row.instance, 'chief-of-staff');
  assert.equal(row.from, '0.43.55');
  assert.equal(row.to, '0.43.74');
  assert.equal(row.stopped, 5000);
  assert.equal(row.session_id, 'session_cos');
  assert.match(r.out, /Restarted: chief-of-staff on 0\.43\.74 \(pid 4001\)/);
  assert.doesNotMatch(r.out, /Stale: builder/, 'a session on the installed version is left alone');
});

test('check and start --dry-run name the stale session and stop nothing', () => {
  for (const argv of [['check'], ['start', '--dry-run']]) {
    const { p, live } = staleTeam();
    const r = restartRun(p, argv, { live });
    assert.equal(r.stops.length, 0, argv.join(' '));
    assert.equal(r.calls.length, 0, argv.join(' '));
    assert.match(r.out, /Stale: chief-of-staff runs the delivery plugin 0\.43\.55 and 0\.43\.74 is installed; (restart runs|would restart): stop its Remote Control server \(pid 5000\)/, argv.join(' '));
    assert.equal(R.ledger(p.root).length, 0);
  }
});

test('a session on the installed version, a newer one, or with no version known is not restarted', () => {
  for (const version of ['0.43.74', '0.43.80', null]) {
    const { p, live } = staleTeam({ version });
    const r = restartRun(p, ['start'], { live });
    assert.equal(r.stops.length, 0, String(version));
    assert.doesNotMatch(r.out, /Stale:/, String(version));
  }
});

test('the roster version of another session says nothing about the one open now: not restarted', () => {
  const { p, live } = staleTeam({ rosterSession: 'sess-older' });
  const r = restartRun(p, ['start'], { live });
  assert.equal(r.stops.length, 0);
  assert.doesNotMatch(r.out, /Stale:/);
});

test('a stale session that is working is held until it is idle between turns, read twice', () => {
  const { p, live } = staleTeam({ status: 'busy' });
  const r = restartRun(p, ['start'], { live });
  assert.equal(r.stops.length, 0);
  assert.match(r.out, /Stale: chief-of-staff .*held: it is busy; it is restarted only when idle between turns/);
  // idle at the first read, busy at the read just before the stop
  const t2 = staleTeam();
  const r2 = restartRun(t2.p, ['start'], { live: t2.live, relist: () => t2.live.map((s) => ({ ...s, status: 'busy' })) });
  assert.equal(r2.stops.length, 0);
  assert.equal(r2.calls.length, 0);
  assert.match(r2.out, /not restarted: it became busy just before the stop/);
});

test('a stale session not under a Remote Control server, or one this pass runs inside, is not stopped', () => {
  const a = staleTeam();
  const r = restartRun(a.p, ['start'], { live: a.live, server: () => null });
  assert.equal(r.stops.length, 0);
  assert.match(r.out, /not restarted: it does not run under a Remote Control server/);
  const b = staleTeam();
  const r2 = restartRun(b.p, ['start'], { live: b.live, server: () => ({ pid: 5000, self: true }) });
  assert.equal(r2.stops.length, 0);
  assert.match(r2.out, /not restarted: this pass runs inside it/);
  const c = staleTeam();
  const r3 = restartRun(c.p, ['start'], { live: c.live, server: () => ({ unreadable: 'ps failed' }) });
  assert.equal(r3.stops.length, 0);
  assert.match(r3.out, /held: the process list could not be read/);
});

test('a stale session with no Remote Control id recorded is not stopped: the owner would get a new link', () => {
  const { p, live } = staleTeam();
  fs.rmSync(path.join(p.config, 'sessions'), { recursive: true });
  const r = restartRun(p, ['start'], { live });
  assert.equal(r.stops.length, 0);
  assert.match(r.out, /not restarted: no Remote Control session id is recorded for it/);
});

test('a server that does not stop is never doubled: no start, a restart-failed row', () => {
  const { p, live } = staleTeam();
  const r = restartRun(p, ['start'], { live, stop: () => false });
  assert.equal(r.calls.length, 0);
  assert.match(r.out, /not restarted: its Remote Control server \(pid 5000\) did not stop/);
  assert.equal(R.ledger(p.root)[0].type, 'restart-failed');
});

test('a restart whose new server does not start leaves a restart-failed row, and the hourly cap counts it', () => {
  const { p, live } = staleTeam();
  const r = restartRun(p, ['start'], { live, spawnThrows: 'spawn EAGAIN' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /its Remote Control server stopped, and the new one did not start: spawn EAGAIN/);
  const row = R.ledger(p.root).find((x) => x.type === 'restart-failed');
  assert.ok(row, r.out);
  assert.equal(row.stopped, 5000);
  assert.equal(row.error, 'spawn EAGAIN');
  const again = restartRun(p, ['start'], { live: [] });
  assert.ok(!again.calls.some((c) => c.env.DELIVERY_ROLE === 'chief-of-staff'), again.out);
  assert.match(again.out, /chief-of-staff \(no session in [^)]*\); held: started .* \(one start an hour\)/);
});

test('the owner pause holds a restart; a restart onto a version that did not take is not tried again; the hourly cap holds', () => {
  const a = staleTeam();
  const r = restartRun(a.p, ['start'], { live: a.live, pause: () => ({ paused: true }) });
  assert.equal(r.stops.length, 0, r.out);
  assert.match(r.out, /not restarted now \(paused\)/);
  // restarted two hours ago onto 0.43.74, and the session seen since still records 0.43.55
  const b = staleTeam();
  R.record(b.p.root, { type: 'restart', at: iso(Date.parse(T0) - 2 * H), instance: 'chief-of-staff', pid: 1, session_id: 'session_cos', from: '0.43.55', to: '0.43.74' });
  register(b.p, 'chief-of-staff', { plugin_version: '0.43.55', now: iso(Date.parse(T0) - H) });
  const r2 = restartRun(b.p, ['start'], { live: b.live });
  assert.equal(r2.stops.length, 0, r2.out);
  assert.match(r2.out, /held: restarted .* onto 0\.43\.74, and its session still records 0\.43\.55; not tried again/);
  // within the hour of any start, the hourly cap holds it
  const c = staleTeam();
  R.record(c.p.root, { type: 'start', at: iso(Date.parse(T0) - 10 * 60e3), instance: 'chief-of-staff', pid: 1 });
  const r3 = restartRun(c.p, ['start'], { live: c.live });
  assert.equal(r3.stops.length, 0, r3.out);
  assert.match(r3.out, /held: started .*one start an hour/);
});

test('serverOf finds the claude remote-control parent of a session, and knows when this process runs inside it', () => {
  const ps = { 5100: '5000 /opt/claude/versions/2.1.318 --print --sdk-url https://x', 5000: '1456 /opt/claude/bin/claude remote-control --name Chief of Staff --permission-mode auto', 1456: '1 /lib/systemd/systemd --user', 7000: '6999 node watchdog.js run', 6999: '1456 bash', 8000: '5100 node team-revive.js start' };
  const exec = (pid) => { if (!ps[pid]) throw new Error('no such pid'); return `${ps[pid]}\n`; };
  assert.deepEqual(TR.serverOf(5100, { exec, self: 7000 }), { pid: 5000, self: false });
  assert.deepEqual(TR.serverOf(5100, { exec, self: 8000 }), { pid: 5000, self: true });
  // a session whose parent is a terminal shell is no Remote Control session
  ps[5300] = '6999 claude --name x';
  assert.equal(TR.serverOf(5300, { exec, self: 7000 }), null);
  assert.equal(TR.serverOf(0, { exec }), null);
  assert.ok(TR.serverOf(5100, { exec: () => { throw new Error('ps: not found'); }, self: 7000 }).unreadable);
});

test('stopServer sends SIGTERM to the server and reports whether the server and its session are gone', () => {
  const alive = new Set([5000, 5100]);
  const sent = [];
  const kill = (pid, sig) => {
    if (sig !== 0) { sent.push([pid, sig]); alive.clear(); return; }
    if (!alive.has(pid)) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
  };
  assert.equal(TR.stopServer(5000, 5100, { kill, waitMs: 50, stepMs: 10 }), true);
  assert.deepEqual(sent, [[5000, 'SIGTERM']]);
  assert.equal(TR.stopServer(5000, 5100, { kill: () => {}, waitMs: 30, stepMs: 10 }), false);
});

// hjx.1.6.10.1: a role session started by the host job's service ran in that service's cgroup and shared
// its TasksMax with every role (eight starts aborted at once), and kept the oneshot from ending.
const startDeps = (p, extra) => ({ start: true, env: { DELIVERY_HOST: 'pc' }, now: T0, bd: store(BUSY), live: [], prs: [], alive: () => false, configDir: p.config, systemdRun: null, ...extra });

test('each start runs in its own systemd user scope with its own limits where systemd runs, and as a plain child where it does not', () => {
  const c = R.scopedCommand('claude', ['remote-control', '--name', 'builder@ex'], { instance: 'builder-2', at: T0, systemdRun: '/usr/bin/systemd-run' });
  assert.equal(c.bin, '/usr/bin/systemd-run');
  assert.equal(c.unit, `delivery-role-builder-2-${Date.parse(T0)}`);
  assert.deepEqual(c.args, ['--user', '--scope', '--quiet', '--collect', `--unit=${c.unit}`, '-p', 'TasksMax=1000', '-p', 'MemoryMax=3G', '--', 'claude', 'remote-control', '--name', 'builder@ex']);
  assert.deepEqual(R.scopedCommand('claude', ['x'], { instance: 'builder', at: T0, systemdRun: null }), { bin: 'claude', args: ['x'], unit: null });
  // the start pass hands the scope command to spawn and records the unit
  const p = project({ roles: [{ id: 'builder', host: 'pc' }, { id: 'reality-checker', host: 'pc' }] });
  const calls = [];
  const r = TR.revive(p.root, p.team, startDeps(p, { systemdRun: '/usr/bin/systemd-run', spawn: (bin, args, opts) => { calls.push({ bin, args, cwd: opts.cwd }); return 7000 + calls.length; } }));
  assert.equal(calls.length, 2);
  for (const k of calls) { assert.equal(k.bin, '/usr/bin/systemd-run'); assert.equal(k.args[k.args.indexOf('--') + 1], 'claude'); }
  assert.notEqual(calls[0].args[4], calls[1].args[4], 'one unit per role');
  assert.match(calls[0].args[4], /^--unit=delivery-role-builder-\d+$/);
  const rows = R.ledger(p.root).filter((x) => x.type === 'start');
  assert.deepEqual(rows.map((x) => x.unit), [`delivery-role-builder-${Date.parse(T0)}`, `delivery-role-reality-checker-${Date.parse(T0)}`]);
  assert.equal(rows[0].args[0], 'remote-control', 'the ledger keeps the claude argv');
  assert.match(r.lines.join('\n'), /Started: builder \(pid 7001, scope delivery-role-builder-\d+\)/);
});

test('systemd-run is used only on Linux with a reachable user manager and systemd-run on PATH', () => {
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  fs.writeFileSync(path.join(bin, 'systemd-run'), '');
  const env = { XDG_RUNTIME_DIR: rt, PATH: `/nonexistent${path.delimiter}${bin}` };
  assert.equal(TR.systemdRunOf(env, { platform: 'linux' }), null, 'no user manager socket');
  fs.mkdirSync(path.join(rt, 'systemd'));
  fs.writeFileSync(path.join(rt, 'systemd', 'private'), '');
  assert.equal(TR.systemdRunOf(env, { platform: 'linux' }), path.join(bin, 'systemd-run'));
  assert.equal(TR.systemdRunOf(env, { platform: 'darwin' }), null);
  assert.equal(TR.systemdRunOf({ PATH: env.PATH }, { platform: 'linux' }), null, 'no XDG_RUNTIME_DIR');
  assert.equal(TR.systemdRunOf({ ...env, PATH: '/nonexistent' }, { platform: 'linux' }), null, 'no systemd-run');
});

test('a start whose process exits within a minute is recorded failed, not started, and is retried at the next pass; a start that lived is held for the hour', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }, { id: 'reality-checker', host: 'pc' }] });
  const spawn = (bin, args, opts) => (opts.cwd.endsWith('builder') ? 501 : 502);
  const first = TR.revive(p.root, p.team, startDeps(p, { spawn, settle: (pids) => { assert.deepEqual(pids, [501, 502]); return new Set([501]); } }));
  const out = first.lines.join('\n');
  assert.match(out, /Failed: builder \(pid 501\): its process exited within 60s of the start, so it is not counted as started/);
  assert.match(out, /Started: reality-checker \(pid 502\)/);
  const failed = R.ledger(p.root).filter((x) => x.type === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].instance, 'builder');
  assert.equal(failed[0].start_at, T0);
  const calls = [];
  const next = TR.revive(p.root, p.team, startDeps(p, { now: iso(Date.parse(T0) + 5 * 60e3), settle: () => new Set(), spawn: (bin, args, opts) => { calls.push(path.basename(opts.cwd)); return 503; } }));
  assert.deepEqual(calls, ['builder'], 'the failed start is retried five minutes later; the one that lived is held');
  assert.match(next.lines.join('\n'), /Started: builder \(pid 503\): retry after a failed start \(its start 2026-11-04 09:00 UTC \(pid 501\) exited within 60s\)/);
  assert.match(next.lines.join('\n'), /Missing: reality-checker .*held: started 2026-11-04 09:00 UTC/);
});

test('the daily cap counts failed starts: a role that crashes at every start is tried six times a day, never in a loop', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  let t = Date.parse(T0);
  let n = 0;
  for (let i = 0; i < 8; i++) {
    TR.revive(p.root, p.team, startDeps(p, { now: iso(t), spawn: () => { n += 1; return 600 + i; }, settle: (pids) => new Set(pids) }));
    t += 5 * 60e3;
  }
  assert.equal(n, 6);
});

test('settle waits for exits up to its limit and returns early once every start has exited; a real child that exits is seen exited', () => {
  let slept = 0;
  const gone = TR.settleStarts([11, 12], { waitMs: 10e3, stepMs: 2e3, sleep: (t) => { slept += t; }, isExited: (pid) => pid === 11 && slept >= 4e3 });
  assert.deepEqual([...gone], [11]);
  assert.equal(slept, 10e3, 'a start still running is watched for the whole wait');
  slept = 0;
  assert.deepEqual([...TR.settleStarts([11], { waitMs: 60e3, stepMs: 2e3, sleep: (t) => { slept += t; }, isExited: () => true })], [11]);
  assert.equal(slept, 0);
  const cp = require('child_process');
  const child = cp.spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'ignore' });
  child.unref();
  assert.ok(TR.settleStarts([child.pid], { waitMs: 10e3, stepMs: 100 }).has(child.pid), 'an exited detached child (a zombie until reaped) counts as exited');
  const live = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { detached: true, stdio: 'ignore' });
  live.unref();
  try { assert.equal(TR.exited(live.pid), false); } finally { live.kill(); }
});

// The production wiring, with nothing injected but the commands: the real spawn and its real exit
// check, and systemd-run found from the environment (rv-189 findings 1 to 3).
function fakeBin(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}
const realDeps = (p, env) => ({ start: true, env: { DELIVERY_HOST: 'pc', PATH: process.env.PATH, ...env }, now: T0, bd: store(BUSY), live: [], prs: [], alive: () => false, configDir: p.config });

test('with the real spawn and no settle given, a start whose process exits at once is recorded failed', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  const bin = fakeBin(path.join(p.root, '..', 'bin'), 'claude', 'echo crashed at start; exit 3');
  const r = TR.revive(p.root, p.team, { ...realDeps(p, { DELIVERY_CLAUDE_BIN: bin }), systemdRun: null });
  assert.match(r.lines.join('\n'), /Failed: builder \(pid \d+\): its process exited within 60s/);
  const rows = R.ledger(p.root);
  assert.deepEqual(rows.map((x) => x.type), ['start', 'failed']);
  assert.equal(rows[1].start_at, rows[0].at);
  assert.match(fs.readFileSync(path.join(p.root, rows[0].log), 'utf8'), /crashed at start/);
});

test('with systemdRun not given, systemd-run is found from the environment: a reachable user manager and systemd-run on PATH scope the start; without them it is a plain start', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  const rt = path.join(p.root, '..', 'run');
  fs.mkdirSync(path.join(rt, 'systemd'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'systemd', 'private'), '');
  const sd = fakeBin(path.join(p.root, '..', 'sbin'), 'systemd-run', 'exit 0');
  const calls = [];
  const spawn = (bin, args) => { calls.push({ bin, args }); return 900 + calls.length; };
  const linux = process.platform === 'linux';
  TR.revive(p.root, p.team, { ...realDeps(p, { XDG_RUNTIME_DIR: rt, PATH: `${path.dirname(sd)}${path.delimiter}${process.env.PATH}` }), spawn, settle: () => new Set() });
  assert.equal(calls[0].bin, linux ? sd : 'claude', 'scoped on Linux only');
  if (linux) assert.deepEqual(calls[0].args.slice(0, 2), ['--user', '--scope']);
  const q = project({ roles: [{ id: 'builder', host: 'pc' }] });
  TR.revive(q.root, q.team, { ...realDeps(q, { PATH: `${path.dirname(sd)}${path.delimiter}${process.env.PATH}` }), spawn, settle: () => new Set() });
  assert.equal(calls[1].bin, 'claude', 'no XDG_RUNTIME_DIR: no user manager to reach, a plain start');
});

test('when systemd-run itself refuses the scope, the role is started again at once as a plain child, and the lines say so', () => {
  const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
  const dir = path.join(p.root, '..', 'bin');
  const sd = fakeBin(dir, 'systemd-run', 'echo "Failed to start transient scope unit: Unit delivery-role-x.scope already exists." >&2; exit 1');
  const bin = fakeBin(dir, 'claude', 'exit 4');
  const r = TR.revive(p.root, p.team, { ...realDeps(p, { DELIVERY_CLAUDE_BIN: bin }), systemdRun: sd });
  const rows = R.ledger(p.root);
  assert.deepEqual(rows.map((x) => x.type), ['start', 'failed', 'start', 'failed']);
  assert.match(rows[0].unit, /^delivery-role-builder-/);
  assert.equal(rows[2].fallback_from, rows[0].unit, 'the plain start names the scope systemd-run refused');
  assert.equal(rows[2].unit, undefined);
  assert.match(r.lines.join('\n'), /Failed: builder \(pid \d+, a plain start: systemd-run refused scope delivery-role-builder-\d+\)/);
  // a claude that crashes under a scope that systemd-run did create is not started again plain
  const q = project({ roles: [{ id: 'builder', host: 'pc' }] });
  const ok = fakeBin(path.join(q.root, '..', 'bin'), 'systemd-run', 'shift 9; exec "$@"');
  TR.revive(q.root, q.team, { ...realDeps(q, { DELIVERY_CLAUDE_BIN: bin }), systemdRun: ok });
  assert.deepEqual(R.ledger(q.root).map((x) => x.type), ['start', 'failed']);
  assert.equal(TR.systemdRunRefused(path.join(q.root, 'nope.log')), false);
});

// hjx.1.6.17: one live session per role instance (lib/one-session.js), on every path that starts one
test('hjx.1.6.17: a role whose session runs inside its role directory (its worktree) is running, not missing, and is not started again', () => {
  const p = project();
  const live = [{ cwd: p.dir('chief-of-staff'), sessionId: 's-cos', name: 'chief-of-staff@ex', status: 'idle' }, { cwd: path.join(p.dir('builder'), 'product'), sessionId: 'unit-b', name: 'builder (unit)', status: 'busy' }];
  const r = run(p, ['start'], { live });
  assert.equal(r.calls.length, 0, r.out);
  assert.match(r.out, /All 2 role sessions of ex on pc are running\./);
  // a session found only by its name, elsewhere, counts too
  const q = project();
  const byName = run(q, ['start'], { live: [{ cwd: q.dir('chief-of-staff'), sessionId: 's', status: 'idle' }, { cwd: '/somewhere/else', sessionId: 'n', name: 'builder@ex', status: 'idle' }] });
  assert.equal(byName.calls.length, 0, byName.out);
});

test('hjx.1.6.17: check names a role running twice, and start adds no third session', () => {
  const p = project();
  const live = [
    { cwd: p.dir('chief-of-staff'), sessionId: 's-cos', name: 'chief-of-staff@ex', status: 'idle' },
    { cwd: p.dir('builder'), sessionId: 'b-1', name: 'builder@ex', status: 'idle' },
    { cwd: path.join(p.dir('builder'), 'product'), sessionId: 'b-2', name: 'builder-x', status: 'busy' },
  ];
  const c = run(p, ['check'], { live });
  assert.match(c.out, /^Running twice: builder: builder@ex \(idle\) in .*builder, builder-x \(busy\) in .*product\. One session per role: Staffing is told \(on a start pass\) and names the one that stays; nothing more is started for it\.$/m);
  assert.equal(run(p, ['start'], { live }).calls.length, 0);
});

test('hjx.1.6.17: a stale restart is refused when another session of the role is live, read before the stop and again just before it', () => {
  // two sessions already in the first read: no stop at all
  const { p, live } = staleTeam();
  const twice = [...live, { cwd: path.join(COS_DIR(p), 'product'), sessionId: 'cos-2', pid: 5300, name: 'cos-2', status: 'idle' }];
  const r = restartRun(p, ['start'], { live: twice });
  assert.deepEqual(r.stops, [], 'nothing is stopped');
  assert.equal(r.calls.length, 0, r.out);
  assert.match(r.out, /runs twice/);
  // a second session that came up between the reads: still no stop, and the reason names it
  const s = staleTeam();
  const late = restartRun(s.p, ['start'], { live: s.live, relist: () => [...s.live, { cwd: COS_DIR(s.p), sessionId: 'cos-late', pid: 5400, name: 'cos-late', status: 'idle' }] });
  assert.deepEqual(late.stops, []);
  assert.equal(late.calls.length, 0, late.out);
  assert.match(late.out, /another session of it is live \(cos-late \(idle\)/);
});

test('hjx.1.6.17: after systemd-run refuses a scope, no plain start follows when the role is live by then, or when the sessions cannot be listed again', () => {
  for (const [relisted, why] of [[(p) => [{ cwd: p.dir('builder'), sessionId: 'came-up', name: 'builder@ex', status: 'idle' }], /no plain start followed: it is live now \(builder@ex \(idle\)/], [() => null, /no plain start followed: the open sessions could not be listed again/]]) {
    const p = project({ roles: [{ id: 'builder', host: 'pc' }] });
    const dir = path.join(p.root, '..', 'bin');
    const sd = fakeBin(dir, 'systemd-run', 'echo "Failed to start transient scope unit: refused" >&2; exit 1');
    const bin = fakeBin(dir, 'claude', 'exit 4');
    const r = TR.revive(p.root, p.team, { ...realDeps(p, { DELIVERY_CLAUDE_BIN: bin }), systemdRun: sd, relist: () => relisted(p) });
    assert.deepEqual(R.ledger(p.root).map((x) => x.type), ['start', 'failed'], 'one start, its failure, and no plain start');
    assert.match(r.lines.join('\n'), why);
  }
});

test('hjx.1.6.17 (rv-198): a role running twice is told to Staffing once per occurrence, with both sessions named, on a start pass only', () => {
  const IB = require('./lib/inbox.js');
  const p = project({ roles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'staffing', host: 'pc' }, { id: 'builder', host: 'pc' }] });
  const twice = [
    { cwd: p.dir('chief-of-staff'), sessionId: 's-cos', name: 'chief-of-staff@ex', status: 'idle' },
    { cwd: p.dir('staffing'), sessionId: 's-st', name: 'staffing@ex', status: 'idle' },
    { cwd: p.dir('builder'), sessionId: 'b-1', name: 'builder@ex', status: 'idle' },
    { cwd: path.join(p.dir('builder'), 'product'), sessionId: 'b-2', name: 'builder-x', status: 'busy' },
  ];
  run(p, ['check'], { live: twice });
  assert.deepEqual(IB.pending(p.root), [], 'a check tells nobody');
  run(p, ['start'], { live: twice });
  const told = IB.pending(p.root);
  assert.deepEqual(told.map((x) => x.to), ['staffing']);
  assert.match(told[0].entries[0].message, /^builder has two live sessions: builder@ex \(idle\) in .*builder, builder-x \(busy\) in .*product\. One session per role/);
  run(p, ['start'], { live: twice, now: iso(Date.parse(T0) + 15 * 60e3) });
  assert.equal(IB.pending(p.root)[0].entries.length, 1, 'the same pair is told once');
  const again = twice.map((x) => (x.sessionId === 'b-2' ? { ...x, sessionId: 'b-3', name: 'builder-y' } : x));
  run(p, ['start'], { live: again, now: iso(Date.parse(T0) + 30 * 60e3) });
  assert.equal(IB.pending(p.root)[0].entries.length, 2, 'a new pair is told');
  // a team with no Staffing tells its Chief of Staff
  const q = project({ roles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }] });
  run(q, ['start'], { live: [twice[0], twice[2], twice[3]].map((x) => ({ ...x, cwd: x.cwd.replace(p.dir(''), q.dir('')) })) });
  assert.deepEqual(IB.pending(q.root).map((x) => x.to), ['chief-of-staff']);
});
