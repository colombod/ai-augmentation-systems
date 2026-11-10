// scripts/host-manager.test.js — the host manager over two product teams in temporary directories: the
// health read, the restart and its reply from the read after it, the unattended pass and its one alert per
// outage, the units it installs, and the watchdog pass that starts it again. systemctl, `claude agents`,
// bd, the spawn of a session and the clock are fakes: no test touches the machine's own units or sessions.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HMS = require('./host-manager.js');
const HM = require('./lib/host-manager.js');
const R = require('./lib/team-revive.js');
const watchdog = require('./watchdog.js');

// The guards read the process this runs in as well as what a caller passes: the tests run from a
// directory that is no role directory, with no role in the environment, and put both back after.
const ROLE_VARS = ['DELIVERY_ROLE', 'DELIVERY_ROLE_ID', 'DELIVERY_ROLE_DIR'];
const savedCwd = process.cwd();
const savedRole = Object.fromEntries(ROLE_VARS.map((k) => [k, process.env[k]]));
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-cwd-')));
for (const k of ROLE_VARS) delete process.env[k];
test.after(() => { process.chdir(savedCwd); for (const k of ROLE_VARS) { if (savedRole[k] === undefined) delete process.env[k]; else process.env[k] = savedRole[k]; } });

const T0 = '2026-11-08T10:00:00Z';
const MIN = 60e3;
const iso = (t) => new Date(t).toISOString();
const ago = (m) => iso(Date.parse(T0) - m * MIN);
const tag = (root) => watchdog.tagOf(root);

// a product team: its manifest, and a prepared role directory per instance in <name>-team/
function product(base, name, roles) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  const team = { project: name, prefix: name, bd_host: 'pc', roles };
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify(team));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
  for (const r of roles) fs.mkdirSync(path.join(base, `${name}-team`, r.id), { recursive: true });
  return { root, team, dir: (i) => path.join(base, `${name}-team`, i) };
}
const store = (beads) => ({ list: ({ status } = {}) => beads.filter((b) => !status || b.status === status) });
const failing = { list: () => { throw new Error('bd list: database unreachable'); } };

// systemctl as a map of unit -> its show fields; start makes a unit active, and every call is kept
function systemd(units) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'loginctl') return 'Linger=no\n';
    if (cmd !== 'systemctl') throw new Error(`${cmd}: not faked`);
    const [, sub, ...rest] = args;
    const operands = rest.filter((a, k) => !a.startsWith('-') && rest[k - 1] !== '-p');
    if (sub === 'show') { const u = units[operands[0]] || { LoadState: 'not-found', ActiveState: 'inactive' }; return Object.entries(u).map(([k, v]) => `${k}=${v}`).join('\n'); }
    if (sub === 'is-active') {
      const u = units[operands[0]];
      if (u && u.ActiveState === 'active') return 'active\n';
      const e = new Error('Command failed: systemctl'); e.stdout = `${u ? u.ActiveState : 'inactive'}\n`; throw e;
    }
    if (sub === 'start') {
      for (const n of operands) { if (!units[n] || units[n].LoadState === 'not-found') throw new Error(`Failed to start ${n}: Unit ${n} not found.`); units[n].ActiveState = 'active'; }
      return '';
    }
    return '';
  };
  return { exec, calls, units };
}
const loaded = (active, since) => ({ LoadState: 'loaded', ActiveState: active ? 'active' : 'inactive', ...(since ? { InactiveEnterTimestamp: since } : {}) });

// the machine: a home with the host file and the unit directory, two teams, the fakes wired together
function machine({ alphaRoles, betaRoles, beads = {}, live, units, bd = {}, hostFileTeams } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'host-mgr-'));
  const home = path.join(base, 'home');
  const alpha = product(base, 'alpha', alphaRoles || [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }, { id: 'tech-writer', host: 'pc' }]);
  const beta = product(base, 'beta', betaRoles || [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }]);
  // alpha is in the host file; beta only has its watchdog unit installed
  const unitDir = HM.unitDir(home);
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(path.join(unitDir, `delivery-watchdog-${tag(beta.root)}.service`), `[Unit]\nDescription=x\n\n[Service]\nType=oneshot\nWorkingDirectory=${beta.root}\n`);
  HM.addHostTeam(HM.hostFile({}, home), alpha.root);
  for (const t of hostFileTeams || []) HM.addHostTeam(HM.hostFile({}, home), t);
  const sd = systemd(units || {
    [`delivery-watchdog-${tag(alpha.root)}.timer`]: loaded(true), [`delivery-watchdog-${tag(alpha.root)}.path`]: loaded(true), [`delivery-watchdog-${tag(alpha.root)}.service`]: loaded(false),
    [`delivery-watchdog-${tag(beta.root)}.timer`]: loaded(true), [`delivery-watchdog-${tag(beta.root)}.path`]: loaded(true), [`delivery-watchdog-${tag(beta.root)}.service`]: loaded(false),
  });
  const alive = new Set();
  const spawned = [];
  const stops = [];
  // a started server: alive unless machine.dies; with m.join set (a plugin version) its session also
  // joins, as a real one does: it is listed in its role directory and records its version in the roster
  const spawn = (bin, args, opts) => {
    const pid = 5000 + spawned.length;
    spawned.push({ args, cwd: opts.cwd });
    if (!machine.dies) alive.add(pid);
    if (m.join && !machine.dies) {
      const sessionId = `s-${pid}`;
      m.live = [...(m.live || []), { cwd: opts.cwd, sessionId, pid, status: 'idle' }];
      const root = path.join(path.dirname(path.dirname(opts.cwd)), path.basename(path.dirname(opts.cwd)).replace(/-team$/, ''));
      require('./lib/roster.js').registerInstance(root, { instance: path.basename(opts.cwd), session_id: sessionId, host: 'pc', role_dir: opts.cwd, now: m.now, plugin_version: m.join });
    }
    return pid;
  };
  const config = path.join(base, 'claude-config');
  fs.mkdirSync(config, { recursive: true });
  const m = {
    base, home, alpha, beta, sd, spawned, alive, config, stops,
    beads: { [alpha.root]: beads.alpha || [], [beta.root]: beads.beta || [] },
    live: live !== undefined ? live : [],
    now: T0,
    installed: '1.2.0',
    join: '1.2.0',
    // the restart's wait: a clock that moves only when the restart sleeps
    clockMs: Date.parse(T0),
    sleeps: [],
  };
  m.deps = () => ({
    env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev' },
    home, exec: sd.exec, has: () => true, live: () => m.live, spawn, cwd: base, who: { roleId: null }, now: m.now,
    sleep: (msec) => { m.sleeps.push(msec); m.clockMs += msec; }, clock: () => m.clockMs,
    stop: (server, pid) => { stops.push({ server, pid }); return true; },
    // each team's host job ran a pass five minutes ago unless a test says otherwise
    lastPass: () => Date.parse(m.now) - 5 * MIN,
    teamDeps: (root) => ({ bd: bd[root] || store(m.beads[root]), prs: [], alive: (pid) => alive.has(pid), pause: () => ({ paused: false }), configDir: config, now: m.now, hostname: 'pc', installed: m.installed, server: () => null }),
  });
  m.run = (argv, more = {}) => HMS.main(argv, { ...m.deps(), ...more });
  return m;
}
machine.dies = false;

test('status: per team who runs, who is down and who holds work; per host job unit running or stopped since when', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'dev@pc/builder', updated_at: ago(10) }, { id: 'al-2', status: 'in_progress', assignee: 'dev@pc/chief-of-staff', updated_at: ago(10) }] } });
  m.live = [{ cwd: m.beta.dir('chief-of-staff'), sessionId: 'b1' }, { cwd: m.beta.dir('builder'), sessionId: 'b2' }];
  const a = tag(m.alpha.root);
  m.sd.units[`delivery-watchdog-${a}.timer`] = loaded(false, 'Sun 2026-11-08 09:00:00 UTC');
  m.sd.units[`delivery-watchdog-${a}.path`] = loaded(false, 'Sun 2026-11-08 09:00:01 UTC');
  const r = m.run(['status']);
  assert.equal(r.code, 0, r.out);
  const lines = r.out.split('\n');
  assert.ok(lines.includes('alpha: 0 of 3 sessions running; down: chief-of-staff, builder, tech-writer; holding work: chief-of-staff, builder'), r.out);
  assert.ok(lines.includes('beta: 2 of 2 sessions running; down: none; holding work: none'), r.out);
  assert.ok(lines.includes(`delivery-watchdog-${a}.timer: stopped since Sun 2026-11-08 09:00:00 UTC`), r.out);
  assert.ok(lines.includes(`delivery-watchdog-${a}.path: stopped since Sun 2026-11-08 09:00:01 UTC`), r.out);
  assert.ok(lines.includes(`delivery-watchdog-${tag(m.beta.root)}.timer: running`), r.out);
  assert.doesNotMatch(r.out, /SOURCE UNAVAILABLE/);
  // beta came from its installed unit alone: the host file lists only alpha
  assert.deepEqual(HM.readHostTeams(HM.hostFile({}, m.home)).teams, [m.alpha.root]);
  const j = JSON.parse(m.run(['status', '--json']).out);
  assert.deepEqual(j.teams.map((t) => [t.name, t.down, t.holding]), [['alpha', ['chief-of-staff', 'builder', 'tech-writer'], ['chief-of-staff', 'builder']], ['beta', [], []]]);
  assert.equal(m.sd.calls.filter((c) => / start /.test(c)).length, 0, 'status starts nothing');
  assert.equal(m.spawned.length, 0);
});

test('restart: the stopped host job and the two working instances come back; the idle one is listed and left down; the reply is the read after', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'dev@pc/builder', updated_at: ago(10) }, { id: 'al-2', status: 'in_progress', assignee: 'dev@pc/chief-of-staff', updated_at: ago(10) }] } });
  m.live = [{ cwd: m.beta.dir('chief-of-staff'), sessionId: 'b1' }, { cwd: m.beta.dir('builder'), sessionId: 'b2' }];
  const a = tag(m.alpha.root);
  m.sd.units[`delivery-watchdog-${a}.timer`] = loaded(false, 'Sun 2026-11-08 09:00:00 UTC');
  const r = m.run(['restart']);
  assert.equal(r.code, 0, r.out);
  assert.ok(m.sd.calls.includes(`systemctl --user start delivery-watchdog-${a}.timer`), m.sd.calls.join('\n'));
  assert.ok(m.sd.calls.includes(`systemctl --user start --no-block delivery-watchdog-${a}.service`), 'one run of its service at once');
  assert.ok(!m.sd.calls.some((c) => c.includes(`start delivery-watchdog-${tag(m.beta.root)}`)), 'a running job is not started');
  assert.deepEqual(m.spawned.map((s) => s.cwd).sort(), [m.alpha.dir('builder'), m.alpha.dir('chief-of-staff')].sort());
  for (const s of m.spawned) assert.deepEqual(s.args.slice(0, 2), ['remote-control', '--name']);
  const lines = r.out.split('\n');
  for (const l of [`Back: delivery-watchdog-${a}.timer is running.`, 'Back: alpha chief-of-staff is running, listed, on the installed plugin 1.2.0.', 'Back: alpha builder is running, listed, on the installed plugin 1.2.0.', 'Left down (no work held): alpha tech-writer.']) assert.ok(lines.includes(l), `${l}\n${r.out}`);
  assert.doesNotMatch(r.out, /Not back/);
  // listed at once: no wait
  assert.deepEqual(m.sleeps, []);
  // each start is a row of the team's own revive ledger, as team-revive.js writes it
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'start').map((x) => x.instance).sort(), ['builder', 'chief-of-staff']);
  // nothing down holding work: nothing restarted
  const again = m.run(['restart']);
  assert.match(again.out, /Left down \(no work held\): alpha tech-writer\./);
  assert.equal(m.spawned.length, 2, 'the started ones run now; nothing is started twice');
});

test('a session that did not come back is named as not back, from the read after the restart', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
  machine.dies = true;
  try {
    const r = m.run(['restart']);
    assert.match(r.out, /^Not back: alpha builder: started \(pid 5000\) but not listed after 5 min\.$/m, r.out);
    assert.doesNotMatch(r.out, /Back: alpha builder/);
  } finally { machine.dies = false; }
});

test('restart says Back only for a session the fresh session list shows on the installed plugin: a live pid is not enough', () => {
  const work = { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] };
  // the server runs (its pid is alive) but its session never joins: polled every 10 s for 5 min, then not back
  const m = machine({ beads: work });
  m.join = null;
  const r = m.run(['restart']);
  assert.ok(m.alive.has(5000), 'the server it started is alive');
  assert.match(r.out, /^Not back: alpha builder: started \(pid 5000\) but not listed after 5 min\.$/m, r.out);
  assert.doesNotMatch(r.out, /^Back: alpha builder/m);
  assert.equal(m.sleeps.length, 30, 'a read every 10 s for 5 min');
  assert.ok(m.sleeps.every((x) => x === 10e3));
  // listed, on an older plugin than the installed one
  const old = machine({ beads: work });
  old.join = '1.1.0';
  const o = old.run(['restart']);
  assert.match(o.out, /^Not back: alpha builder: running an older plugin \(1\.1\.0, installed 1\.2\.0\)\.$/m, o.out);
  assert.doesNotMatch(o.out, /^Back: alpha builder/m);
  // listed only after 30 s: the restart waits for it, then says Back
  const slow = machine({ beads: work });
  slow.join = null;
  const live = slow.deps().live;
  const r2 = slow.run(['restart'], {
    live: () => {
      if (slow.clockMs - Date.parse(T0) >= 30e3 && !(slow.live || []).some((x) => x.sessionId === 's-5000')) {
        slow.live = [...slow.live, { cwd: slow.alpha.dir('builder'), sessionId: 's-5000', status: 'idle' }];
        require('./lib/roster.js').registerInstance(slow.alpha.root, { instance: 'builder', session_id: 's-5000', host: 'pc', role_dir: slow.alpha.dir('builder'), now: T0, plugin_version: '1.2.0' });
      }
      return live();
    },
  });
  assert.match(r2.out, /^Back: alpha builder is running, listed, on the installed plugin 1\.2\.0\.$/m, r2.out);
  assert.equal(slow.sleeps.length, 3);
});

test('a team whose beads cannot be read is SOURCE UNAVAILABLE, and a session list that cannot be read counts nobody running', () => {
  const m = machine({ bd: {} });
  const mm = machine({ beads: { alpha: [] } });
  mm.live = [{ cwd: mm.beta.dir('chief-of-staff') }, { cwd: mm.beta.dir('builder') }];
  const r = mm.run(['status'], { teamDeps: (root) => ({ bd: root === mm.beta.root ? failing : store([]), prs: [], alive: () => false, pause: () => ({ paused: false }), configDir: mm.config, now: T0, hostname: 'pc' }) });
  assert.match(r.out, /^SOURCE UNAVAILABLE: beta: beads in progress \(bd list: database unreachable\)$/m, r.out);
  assert.match(r.out, /^beta: 2 of 2 sessions running; down: none; holding work: the rest not known \(beads unreadable\)$/m);
  assert.match(r.out, /^alpha: 0 of 3 sessions running; down: chief-of-staff, builder, tech-writer; holding work: none$/m);
  // no session list: every instance is not known, none running, none down
  m.live = null;
  const blind = m.run(['status']);
  assert.match(blind.out, /^alpha: 0 of 3 sessions running; down: none; holding work: none; not known whether running: chief-of-staff, builder, tech-writer$/m, blind.out);
  assert.match(blind.out, /^SOURCE UNAVAILABLE: alpha: the open sessions/m);
  assert.doesNotMatch(blind.out, /\b[1-9] of \d sessions running/);
  // a team.json that cannot be read
  fs.writeFileSync(path.join(m.alpha.root, '.delivery', 'team', 'team.json'), '{ not json');
  assert.match(m.run(['status']).out, new RegExp(`^SOURCE UNAVAILABLE: the team at ${m.alpha.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(manifest: team.json: invalid JSON`, 'm'));
  // no systemctl: the units are a source that cannot be read, never running
  const none = mm.run(['status'], { has: () => false });
  assert.match(none.out, /^SOURCE UNAVAILABLE: the host job units \(no systemctl on this host\)$/m);
  assert.doesNotMatch(none.out, /\.timer: running/);
  // systemctl failing on one unit
  const broken = mm.run(['status'], { exec: (cmd, args) => { if (args.includes('show') && /\.timer$/.test(args[2]) && args[2].includes(tag(mm.alpha.root))) throw new Error('Failed to connect to bus'); return mm.sd.exec(cmd, args); } });
  assert.match(broken.out, new RegExp(`^SOURCE UNAVAILABLE: the state of delivery-watchdog-${tag(mm.alpha.root)}\\.timer \\(systemctl --user show failed: Failed to connect to bus\\)$`, 'm'), broken.out);
  assert.doesNotMatch(broken.out, new RegExp(`delivery-watchdog-${tag(mm.alpha.root)}\\.timer: running`));
});

test('a restart refused by a start cap is named, with when it can run', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
  R.record(m.alpha.root, { type: 'start', at: ago(10), instance: 'builder', pid: 1, args: [] });
  const r = m.run(['restart']);
  assert.match(r.out, /^Not back: alpha builder \(held by the start caps: started .*; the next start is after .* \(one start an hour\)\)\.$/m, r.out);
  assert.equal(m.spawned.filter((s) => s.cwd === m.alpha.dir('builder')).length, 0);
});

test('restart waits for every team inside one deadline: 5 minutes in all, counted from its start, each team\'s settle included', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }], beta: [{ id: 'be-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
  m.join = null;
  const base = m.deps().teamDeps;
  const settles = [];
  // each team's start pass waits 60 s for a start that exits at once, on the restart's own clock
  const teamDeps = (root) => ({ ...base(root), settle: (pids) => { settles.push(pids); m.clockMs += 60e3; return new Set(); } });
  const t0 = m.clockMs;
  const r = m.run(['restart'], { teamDeps });
  assert.equal(settles.length, 2, 'both teams started something');
  assert.equal(m.spawned.length, 2);
  assert.equal(m.clockMs - t0, 5 * MIN, 'one 5 minute window for the whole restart');
  assert.equal(m.sleeps.reduce((x, y) => x + y, 0), 3 * MIN, 'the two settles came out of it');
  assert.match(r.out, /^Not back: alpha builder: started \(pid 5000\) but not listed after 5 min\.$/m, r.out);
  assert.match(r.out, /^Not back: beta builder: started \(pid 5001\) but not listed after 5 min\.$/m, r.out);
});

test('a host job pass that lands while restart waits is reported back; a start that exits at once is not waited for', () => {
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const m = machine({ alphaRoles: roles });
  m.live = [{ cwd: m.alpha.dir('chief-of-staff') }, { cwd: m.beta.dir('chief-of-staff') }, { cwd: m.beta.dir('builder') }];
  const a = tag(m.alpha.root);
  const t0 = m.clockMs;
  // the run of its service started by the restart writes its pass 40 s later
  const lastPass = (root) => (root === m.alpha.root ? (m.clockMs - t0 >= 40e3 ? t0 + 40e3 : Date.parse(T0) - 40 * MIN) : Date.parse(T0) - 5 * MIN);
  const r = m.run(['restart'], { lastPass });
  assert.ok(m.sd.calls.includes(`systemctl --user start --no-block delivery-watchdog-${a}.service`), m.sd.calls.join('\n'));
  assert.match(r.out, /^Back: alpha's host job ran a pass at 2026-11-08T10:00:40\.000Z\.$/m, r.out);
  assert.doesNotMatch(r.out, /alpha's host job, still silent/);
  assert.deepEqual(m.sleeps, [10e3, 10e3, 10e3, 10e3], 'it waited until the pass, not the whole window');
  // a start that exited within its settle is named, and the restart does not wait for it to be listed
  const d = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
  d.join = null;
  const base = d.deps().teamDeps;
  const out = d.run(['restart'], { teamDeps: (root) => ({ ...base(root), settle: (pids) => new Set(pids) }) });
  assert.match(out.out, /^Not back: alpha builder \(its start exited at once, recorded failed; the next pass retries it\)\.$/m, out.out);
  assert.deepEqual(d.sleeps, []);
});

test('restart reads the sessions again just before stopping a session on an older plugin: busy on that read, it is not stopped and the reply says why; idle, it is restarted and the reply says so', () => {
  const stale = () => {
    const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
    const dir = m.alpha.dir('builder');
    require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'builder', session_id: 's-old', host: 'pc', role_dir: dir, now: ago(60), plugin_version: '1.1.0' });
    fs.mkdirSync(path.join(m.config, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(m.config, 'sessions', '77.json'), JSON.stringify({ sessionId: 's-old', cwd: dir, bridgeSessionId: 'session_b1', pid: 77 }));
    const base = m.deps().teamDeps;
    const reads = [];
    const more = {
      teamDeps: (root) => ({ ...base(root), server: (pid) => (pid === 77 ? { pid: 99, self: false } : null) }),
      live: () => { reads.push(m.liveStatus(reads.length)); return [{ cwd: dir, sessionId: 's-old', pid: 77, status: reads[reads.length - 1] }]; },
    };
    return { m, more, reads };
  };
  // the first read finds it idle; the second, just before the stop, finds it busy
  const busy = stale();
  busy.m.liveStatus = (n) => (n === 0 ? 'idle' : 'busy');
  const r = busy.m.run(['restart'], busy.more);
  assert.equal(r.code, 0, r.out);
  assert.ok(busy.reads.length >= 2, 'a second read of the sessions was made');
  assert.equal(busy.reads[1], 'busy');
  assert.deepEqual(busy.m.stops, [], 'not stopped');
  assert.equal(busy.m.spawned.length, 0);
  assert.match(r.out, /^Not restarted: alpha builder \(it ran the older plugin 1\.1\.0, installed 1\.2\.0\): it became busy just before the stop\.$/m, r.out);
  // idle on both reads: stopped once and restarted, and the reply names it
  const idle = stale();
  idle.m.liveStatus = () => 'idle';
  const r2 = idle.m.run(['restart'], idle.more);
  assert.deepEqual(idle.m.stops, [{ server: 99, pid: 77 }]);
  assert.equal(idle.m.spawned.length, 1);
  assert.match(r2.out, /^Restarted: alpha builder \(pid 5000\): it ran the older plugin 1\.1\.0, installed 1\.2\.0\.$/m, r2.out);
  assert.deepEqual(R.ledger(idle.m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.from, x.to]), [['builder', '1.1.0', '1.2.0']]);
});

test('tick: 30 minutes silent with work in flight is a restart and one alert; a second tick in the same outage sends none; a new outage alerts again', () => {
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const bead = { id: 'al-1', status: 'in_progress', assignee: 'dev@pc/builder', updated_at: ago(40) };
  const m = machine({ alphaRoles: roles, beads: { alpha: [bead] } });
  m.live = [{ cwd: m.alpha.dir('chief-of-staff') }, { cwd: m.beta.dir('chief-of-staff') }, { cwd: m.beta.dir('builder') }];
  const lastPass = () => Date.parse(m.now) - 5 * MIN;
  machine.dies = true;
  try {
    const first = m.run(['tick'], { lastPass });
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /silent: alpha builder \(holding al-1/);
    assert.equal(m.spawned.length, 1, first.out);
    assert.equal(m.spawned[0].cwd, m.alpha.dir('builder'));
    const rows = () => HM.readLedger(HM.outageFile({}, m.home));
    assert.deepEqual(rows().map((r) => r.type), ['open', 'alert']);
    const alert = rows()[1];
    assert.match(alert.text, /^The team on this machine went silent: alpha builder \(holding al-1; no note or wake since .*\)\. I restarted what was down\. Not back: alpha builder: started \(pid 5000\) but not listed after 5 min\.$/);
    assert.doesNotMatch(alert.text, /Came back: nothing/);
    // it reaches the host manager's own session through its team's inbox
    const inbox = require('./lib/inbox.js').pending(m.alpha.root).find((x) => x.to === 'host-manager');
    assert.ok(inbox, first.out);
    assert.equal(inbox.entries.length, 1);
    assert.equal(inbox.entries[0].message, alert.text);
    assert.deepEqual(alert.delivered_to, ['alpha host-manager']);
    // five minutes on, still down (the session died again, and a cap holds the next start): no second alert
    m.now = iso(Date.parse(T0) + 5 * MIN);
    const second = m.run(['tick'], { lastPass });
    assert.match(second.out, /^Still silent, in an open outage: alpha builder \(holding al-1.*\(open since 2026-11-08T10:00:00Z, the owner was alerted then\)\.$/m, second.out);
    assert.deepEqual(rows().map((r) => r.type), ['open', 'alert']);
    assert.equal(require('./lib/inbox.js').pending(m.alpha.root).find((x) => x.to === 'host-manager').entries.length, 1, 'no second message');
    // the bead moves: the outage closes
    bead.updated_at = iso(Date.parse(m.now) - MIN);
    assert.match(m.run(['tick'], { lastPass }).out, /nothing silent; the outage open since .* is over/);
    assert.deepEqual(rows().map((r) => r.type), ['open', 'alert', 'close']);
    // silent again later: a new outage, a new alert
    m.now = iso(Date.parse(T0) + 3 * 3600e3);
    m.run(['tick'], { lastPass });
    assert.deepEqual(rows().map((r) => r.type), ['open', 'alert', 'close', 'open', 'alert']);
  } finally { machine.dies = false; }
});

test('tick: work noted within 30 minutes, or a wake, is no silence; a host job with no pass for 30 minutes is one', () => {
  const m = machine({ beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(10) }] } });
  const recent = () => Date.parse(T0) - 5 * MIN;
  const r = m.run(['tick'], { lastPass: recent });
  assert.match(r.out, /nothing silent/);
  assert.equal(m.spawned.length, 0, 'the tick restarts nothing while nothing is silent');
  assert.deepEqual(HM.readLedger(HM.outageFile({}, m.home)), []);
  // silent bead, but a watchdog wake 10 minutes ago
  m.beads[m.alpha.root][0].updated_at = ago(50);
  require('./lib/watchdog.js').log(m.alpha.root, { type: 'wake', at: ago(10), instance: 'builder', keys: ['assigned:al-1'], pid: 0 });
  assert.match(m.run(['tick'], { lastPass: recent }).out, /nothing silent/);
  // the host job: no pass for 40 minutes
  const old = () => Date.parse(T0) - 40 * MIN;
  const j = m.run(['tick'], { lastPass: old });
  assert.match(j.out, /silent: alpha's host job \(no pass since 2026-11-08T09:20:00\.000Z\); beta's host job/, j.out);
  // two silences first seen on one pass: two outages, one alert
  assert.deepEqual(HM.readLedger(HM.outageFile({}, m.home)).map((x) => x.type), ['open', 'open', 'alert']);
  assert.match(j.out, /No host manager instance is in any team on this host: the alert is in .*outages\.ndjson only\./);
});

test('tick: an outage per silence; a new silence while another is open alerts once more; each closes when its own silence clears', () => {
  const beads = [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(40) }, { id: 'al-2', status: 'in_progress', assignee: 'chief-of-staff', updated_at: ago(10) }];
  const m = machine({ beads: { alpha: beads } });
  m.live = [{ cwd: m.beta.dir('chief-of-staff') }, { cwd: m.beta.dir('builder') }];
  const at = (min) => iso(Date.parse(T0) + min * MIN);
  const rows = () => HM.readLedger(HM.outageFile({}, m.home));
  const alerts = () => rows().filter((r) => r.type === 'alert');
  machine.dies = true;
  try {
    // A (alpha builder) goes silent: one alert
    m.run(['tick']);
    assert.equal(alerts().length, 1);
    assert.deepEqual(alerts()[0].keys, [`${m.alpha.root}#instance:builder`]);
    // B (alpha chief-of-staff) goes silent while A is still open: one more alert, for B alone
    m.now = at(25);
    m.run(['tick']);
    assert.equal(alerts().length, 2);
    assert.deepEqual(alerts()[1].keys, [`${m.alpha.root}#instance:chief-of-staff`]);
    assert.match(alerts()[1].text, /alpha chief-of-staff/);
    assert.doesNotMatch(alerts()[1].text, /alpha builder \(holding/);
    // the next tick, both still silent: no alert
    m.now = at(30);
    m.run(['tick']);
    assert.equal(alerts().length, 2);
    // A clears: A's outage closes, B's stays open
    beads[0].updated_at = iso(Date.parse(m.now) - MIN);
    const c = m.run(['tick']);
    assert.match(c.out, /^Closed: the outage open since 2026-11-08T10:00:00Z is over \(alpha builder/m, c.out);
    assert.deepEqual(rows().filter((r) => r.type === 'close').map((r) => r.key), [`${m.alpha.root}#instance:builder`]);
    assert.equal(alerts().length, 2);
    // A goes silent again later: a new alert
    m.now = at(200);
    beads[1].updated_at = iso(Date.parse(m.now) - MIN);
    m.run(['tick']);
    assert.equal(alerts().length, 3);
    assert.deepEqual(alerts()[2].keys, [`${m.alpha.root}#instance:builder`]);
    assert.deepEqual(rows().filter((r) => r.type === 'close').map((r) => r.key), [`${m.alpha.root}#instance:builder`, `${m.alpha.root}#instance:chief-of-staff`]);
  } finally { machine.dies = false; }
});

test('tick: an instance listed as running but silent for 30 minutes with work in flight gets one alert in plain words, and is neither stopped nor started', () => {
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const m = machine({ alphaRoles: roles, beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(45) }] } });
  m.live = [{ cwd: m.alpha.dir('chief-of-staff'), sessionId: 'c1', status: 'idle' }, { cwd: m.alpha.dir('builder'), sessionId: 'b1', status: 'idle' }, { cwd: m.beta.dir('chief-of-staff') }, { cwd: m.beta.dir('builder') }];
  const r = m.run(['tick']);
  assert.equal(r.code, 0, r.out);
  assert.equal(m.spawned.length, 0, 'nothing started');
  assert.deepEqual(m.stops, [], 'nothing stopped');
  assert.ok(!m.sd.calls.some((c) => / start /.test(c)), m.sd.calls.join('\n'));
  const alerts = () => HM.readLedger(HM.outageFile({}, m.home)).filter((x) => x.type === 'alert');
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].text, 'Alpha builder is running but silent (holding al-1; no bead note and no watchdog wake since 2026-11-08T09:15:00.000Z). I did not stop it: it may be in the middle of a turn. You can ask the host manager to restart the team.');
  assert.doesNotMatch(alerts()[0].text, /Came back|nothing failed/);
  assert.match(r.out, /^Silent while running: alpha builder is running but silent .*Not stopped/m);
  // the next tick: still silent, no second alert, still nothing stopped
  m.now = iso(Date.parse(T0) + 5 * MIN);
  m.run(['tick']);
  assert.equal(alerts().length, 1);
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0);
});

test('a host job silent while its timer runs: restart starts its service once, and the reply and the alert name it as still silent until a read shows a new pass', () => {
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const m = machine({ alphaRoles: roles });
  m.live = [{ cwd: m.alpha.dir('chief-of-staff') }, { cwd: m.beta.dir('chief-of-staff') }, { cwd: m.beta.dir('builder') }];
  const a = tag(m.alpha.root);
  const passes = { [m.alpha.root]: Date.parse(T0) - 40 * MIN, [m.beta.root]: Date.parse(T0) - 5 * MIN };
  const lastPass = (root) => passes[root];
  const t = m.run(['tick'], { lastPass });
  const kicks = m.sd.calls.filter((c) => c === `systemctl --user start --no-block delivery-watchdog-${a}.service`);
  assert.equal(kicks.length, 1, m.sd.calls.join('\n'));
  assert.ok(!m.sd.calls.some((c) => c.includes(`start delivery-watchdog-${a}.timer`)), 'its timer runs: not started');
  assert.ok(!m.sd.calls.some((c) => c.includes(tag(m.beta.root)) && / start /.test(c)), 'a job with a recent pass is left alone');
  assert.match(t.out, new RegExp(`^Not back: alpha's host job, still silent: its timer runs but no pass since 2026-11-08T09:20:00\\.000Z; delivery-watchdog-${a}\\.service was started once and the read after it shows no new pass\\.$`, 'm'), t.out);
  const alert = HM.readLedger(HM.outageFile({}, m.home)).find((x) => x.type === 'alert');
  assert.match(alert.text, /Not back: alpha's host job, still silent: its timer runs but no pass since/);
  assert.doesNotMatch(alert.text, /Came back: nothing|Not back: nothing/);
  // the owner's restart, with the service running a pass at once: the read after shows it, and the job is back
  let ran = false;
  const r = m.run(['restart'], {
    exec: (cmd, args) => { if (args.includes('--no-block') && args.includes(`delivery-watchdog-${a}.service`)) ran = true; return m.sd.exec(cmd, args); },
    lastPass: (root) => (ran && root === m.alpha.root ? Date.parse(T0) : passes[root]),
  });
  assert.match(r.out, /^Back: alpha's host job ran a pass at 2026-11-08T10:00:00\.000Z\.$/m, r.out);
  // a start of its service that fails is named
  const f = m.run(['restart'], { lastPass, exec: (cmd, args) => { if (args.includes('--no-block')) throw new Error('Failed to start: Unit is masked.'); return m.sd.exec(cmd, args); } });
  assert.match(f.out, /^Not back: alpha's host job, still silent: .*starting delivery-watchdog-\w+\.service once failed \(Failed to start: Unit is masked\.\)\.$/m, f.out);
});

test('install writes the host manager\'s session unit and its tick timer, enables them, and reports lingering without running it', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const unit = (n) => path.join(HM.unitDir(m.home), n);
  const dry = m.run(['install', '--dry-run', '--project', m.alpha.root]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /^Would write .*delivery-host-manager\.service:$/m);
  assert.ok(!fs.existsSync(unit(HM.UNIT)), 'a dry run writes nothing');
  assert.equal(m.sd.calls.filter((c) => c.startsWith('systemctl')).length, 0);
  const r = m.run(['install', '--project', m.alpha.root]);
  assert.equal(r.code, 0, r.out);
  const svc = fs.readFileSync(unit(HM.UNIT), 'utf8');
  for (const re of [/^Restart=always$/m, /^RestartSec=30$/m, /^TasksMax=4096$/m, /^KillMode=process$/m, /^WantedBy=default\.target$/m, new RegExp(`^WorkingDirectory=${m.alpha.dir('host-manager').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    /^ExecStart=\/usr\/bin\/env "node" ".*\/alpha\/\.delivery\/bin\/delivery\.js" "host-manager\.js" "run-session" "--project" ".*\/alpha" "--instance" "host-manager"$/m, /^Environment="DELIVERY_ROLE=host-manager"$/m]) assert.match(svc, re, svc);
  // the session it reattaches to is read when the unit starts, never frozen into the unit
  assert.doesNotMatch(svc, /remote-control|--spawn|--session-id/);
  // restarts are bounded: a growing delay up to 30 minutes, and at most 5 starts in 15 minutes, in [Unit]
  for (const re of [/^RestartSteps=5$/m, /^RestartMaxDelaySec=30min$/m]) assert.match(svc.split('[Service]')[1], re, svc);
  for (const re of [/^StartLimitIntervalSec=15min$/m, /^StartLimitBurst=5$/m]) assert.match(svc.split('[Service]')[0], re, svc);
  assert.doesNotMatch(svc, /^StartLimitIntervalSec=0$/m);
  const timer = fs.readFileSync(unit(HM.TICK_TIMER), 'utf8');
  for (const re of [/^OnBootSec=2min$/m, /^OnUnitActiveSec=5min$/m, /^WantedBy=timers\.target$/m]) assert.match(timer, re);
  assert.match(fs.readFileSync(unit(HM.TICK_SERVICE), 'utf8'), /^ExecStart=\/usr\/bin\/env "node" ".*\/alpha\/\.delivery\/bin\/delivery\.js" "host-manager\.js" "tick"$/m);
  assert.ok(fs.existsSync(path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')), 'the launcher the tick runs through');
  for (const c of ['systemctl --user daemon-reload', `systemctl --user enable --now ${HM.UNIT}`, `systemctl --user enable --now ${HM.TICK_TIMER}`]) assert.ok(m.sd.calls.includes(c), c);
  assert.match(r.out, /Lingering is off for dev: .*loginctl enable-linger dev$/m);
  assert.ok(!m.sd.calls.some((c) => /enable-linger/.test(c)), 'lingering is reported, never enabled');
  // a Remote Control session recorded for the directory is reattached
  const d = path.join(m.config, 'projects', R.projectKey(m.alpha.dir('host-manager')));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'bridge-pointer.json'), JSON.stringify({ sessionId: 'session_hm1', pid: 1 }));
  m.run(['install', '--project', m.alpha.root], { env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', CLAUDE_CONFIG_DIR: m.config } });
  assert.doesNotMatch(fs.readFileSync(unit(HM.UNIT), 'utf8'), /session_hm1|--session-id/, 'a recorded session is not frozen into the unit either');
  assert.deepEqual(HM.readHostTeams(HM.hostFile({}, m.home)).teams, [m.alpha.root], 'the host file lists the team once');
});

test('install creates the tick\'s state directory before it enables the units, and carries XDG_STATE_HOME and XDG_CONFIG_HOME into the units only when set', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const unit = (n) => fs.readFileSync(path.join(HM.unitDir(m.home), n), 'utf8');
  const dir = HM.stateDir({}, m.home);
  let seenAtEnable = null;
  const exec = (cmd, args) => { if (args.includes('enable')) seenAtEnable = seenAtEnable === null ? fs.existsSync(dir) : seenAtEnable && fs.existsSync(dir); return m.sd.exec(cmd, args); };
  const plain = m.run(['install', '--project', m.alpha.root], { exec });
  assert.equal(plain.code, 0, plain.out);
  assert.ok(fs.statSync(dir).isDirectory(), 'the tick log\'s directory exists after install');
  assert.equal(seenAtEnable, true, 'and existed before the units were enabled');
  for (const n of [HM.UNIT, HM.TICK_SERVICE]) assert.doesNotMatch(unit(n), /XDG_(STATE|CONFIG)_HOME/, n);
  const state = path.join(m.base, 'state');
  const conf = path.join(m.base, 'conf');
  HM.addHostTeam(HM.hostFile({ XDG_CONFIG_HOME: conf }, m.home), m.alpha.root);
  const r = m.run(['install', '--project', m.alpha.root], { env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', XDG_STATE_HOME: state, XDG_CONFIG_HOME: conf } });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.statSync(HM.stateDir({ XDG_STATE_HOME: state }, m.home)).isDirectory());
  for (const n of [HM.UNIT, HM.TICK_SERVICE]) {
    assert.ok(unit(n).includes(`Environment="XDG_STATE_HOME=${state}"\n`), unit(n));
    assert.ok(unit(n).includes(`Environment="XDG_CONFIG_HOME=${conf}"\n`), unit(n));
  }
  assert.match(unit(HM.TICK_SERVICE), new RegExp(`^StandardOutput=append:${path.join(state, 'delivery', 'host-manager', 'tick.log').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('run-session, which the unit runs, starts by team-revive\'s rules: a server that stays up when nothing is recorded, a recorded session reattached once, and a server that stays up again once that session never joined or already ran', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', CLAUDE_CONFIG_DIR: m.config, DELIVERY_ROLE: 'host-manager' };
  const calls = [];
  const execve = (file, argv, e) => { calls.push({ file, argv, env: e }); };
  const resolve = (bin) => `/opt/bin/${bin}`;
  let now = T0;
  const run = (more = {}) => m.run(['run-session', '--project', m.alpha.root, '--instance', 'host-manager'], { env, who: { roleId: 'host-manager' }, execve, resolveBin: resolve, now, ...more });
  const STAY_UP = ['claude', 'remote-control', '--name', 'host-manager@pc', '--spawn', 'same-dir', '--capacity', '1', '--permission-mode', 'auto'];
  const reattach = (id) => ['claude', 'remote-control', '--name', 'host-manager@pc', '--session-id', id, '--permission-mode', 'auto'];
  const rows = () => R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-session');
  const joined = (at) => require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'host-manager', session_id: `s-${at}`, host: 'pc', role_dir: m.alpha.dir('host-manager'), now: at });
  // no session recorded: a server that stays up after a task, not single-session mode
  const fresh = run();
  assert.equal(fresh.code, 0, fresh.out);
  assert.equal(calls[0].file, '/opt/bin/claude');
  assert.deepEqual(calls[0].argv, STAY_UP);
  assert.equal(calls[0].env.DELIVERY_ROLE, 'host-manager');
  assert.equal(rows().length, 1, 'each start is a row of the revive ledger, which outlives the unit\'s restarts');
  // a session recorded since and not yet tried: reattached
  const d = path.join(m.config, 'projects', R.projectKey(m.alpha.dir('host-manager')));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'bridge-pointer.json'), JSON.stringify({ sessionId: 'session_hm1', pid: 1 }));
  now = iso(Date.parse(T0) + MIN);
  run();
  assert.deepEqual(calls[1].argv, reattach('session_hm1'));
  assert.equal(rows()[1].session_id, 'session_hm1');
  // the same id again, and its session never joined (the roster saw nothing since that start): dropped, a server that stays up
  now = iso(Date.parse(T0) + 2 * MIN);
  const again = run();
  assert.deepEqual(calls[2].argv, STAY_UP);
  assert.equal(rows()[2].dropped, 'session_hm1');
  assert.match(again.out, /session_hm1 never joined/);
  // a new id that was reattached, joined and ran its task: not reattached again
  fs.writeFileSync(path.join(d, 'bridge-pointer.json'), JSON.stringify({ sessionId: 'session_hm2', pid: 1 }));
  now = iso(Date.parse(T0) + 3 * MIN);
  run();
  assert.deepEqual(calls[3].argv, reattach('session_hm2'));
  joined(iso(Date.parse(T0) + 4 * MIN));
  now = iso(Date.parse(T0) + 5 * MIN);
  const ran = run();
  assert.deepEqual(calls[4].argv, STAY_UP);
  assert.equal(rows()[4].dropped, 'session_hm2');
  assert.match(ran.out, /session_hm2 already ran/);
  // no pointer, but the roster records an id not yet tried: that one
  fs.rmSync(path.join(d, 'bridge-pointer.json'));
  require('./lib/roster.js').setRemoteSession(m.alpha.root, { instance: 'host-manager', remote_session_id: 'session_hm3' });
  run();
  assert.deepEqual(calls[5].argv, reattach('session_hm3'));
  // only the host manager's own unit runs it
  const no = m.run(['run-session', '--project', m.alpha.root, '--instance', 'host-manager'], { env: { DELIVERY_ROLE: 'builder', DELIVERY_ROLE_ID: 'builder' }, who: { roleId: 'builder' }, execve, resolveBin: resolve });
  assert.equal(no.code, 1);
  assert.match(no.out, /run-session is the host manager's/);
  assert.equal(calls.length, 6);
});

// hjx.1.6.17 / hjx.1.6.17.1: the unit's restart, or a wake for a queued alert, must not start a second
// host manager beside the live one
test('run-session starts no host-manager session beside a live one, by its role directory or its name, and none when the open sessions cannot be listed', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', CLAUDE_CONFIG_DIR: m.config, DELIVERY_ROLE: 'host-manager' };
  const calls = [];
  const execve = (file, argv) => { calls.push({ file, argv }); };
  const run = (live) => m.run(['run-session', '--project', m.alpha.root, '--instance', 'host-manager'], { env, who: { roleId: 'host-manager' }, execve, resolveBin: (b) => `/opt/bin/${b}`, now: T0, live });
  const inDir = run([{ sessionId: 'hm-live', cwd: m.alpha.dir('host-manager'), name: 'host-manager@pc', status: 'idle' }]);
  assert.equal(inDir.code, 1, inDir.out);
  assert.match(inDir.out, /host-manager already runs as host-manager@pc \(idle\) in .*host-manager; no second session started/);
  const byName = run([{ sessionId: 'hm-x', cwd: '/elsewhere', name: 'host-manager@pc', status: 'busy' }]);
  assert.equal(byName.code, 1, byName.out);
  const unknown = run(null);
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /open sessions could not be listed/);
  assert.deepEqual(calls, [], 'claude was never started');
  assert.equal(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-session').length, 0, 'no start row');
  // another role's session, or another host's host manager, is no reason to hold it
  const ok = run([{ sessionId: 'cos', cwd: m.alpha.dir('chief-of-staff'), name: 'chief-of-staff@alpha', status: 'idle' }, { sessionId: 'hm-other', cwd: '/x', name: 'host-manager@laptop', status: 'idle' }]);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(calls.length, 1);
});

test('run-session on a node without process.execve starts nothing and says it needs node 22.15 or later', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', CLAUDE_CONFIG_DIR: m.config, DELIVERY_ROLE: 'host-manager' };
  const r = m.run(['run-session', '--project', m.alpha.root, '--instance', 'host-manager'], { env, who: { roleId: 'host-manager' }, execve: null, resolveBin: (b) => `/opt/bin/${b}` });
  assert.equal(r.code, 1);
  assert.match(r.out, /needs node 22\.15 or later/);
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-session'), [], 'no start recorded');
});

test('install installs nothing without systemctl, without a host manager in the team, or without its role directory', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const no = m.run(['install', '--project', m.alpha.root], { has: () => false });
  assert.equal(no.code, 1);
  assert.match(no.out, /no systemctl.*nothing was installed/);
  assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)));
  const none = m.run(['install', '--project', m.beta.root]);
  assert.equal(none.code, 1);
  assert.match(none.out, /has no host manager on host "pc" \(Staffing adds it: team-role\.js add host-manager\)/);
  fs.rmSync(m.alpha.dir('host-manager'), { recursive: true });
  const bare = m.run(['install', '--project', m.alpha.root]);
  assert.equal(bare.code, 1);
  assert.match(bare.out, /role directory .* is not prepared/);
  assert.equal(m.sd.calls.filter((c) => c.startsWith('systemctl')).length, 0);
});

test('restart and tick are the host manager\'s in a role session; status reads in any; install never runs in a role session', () => {
  const m = machine();
  const builder = { env: { DELIVERY_ROLE: 'builder', DELIVERY_ROLE_ID: 'builder' }, who: { roleId: 'builder' } };
  for (const cmd of ['restart', 'tick']) {
    const r = m.run([cmd], builder);
    assert.equal(r.code, 1, cmd);
    assert.match(r.out, new RegExp(`${cmd} is the host manager's .*role builder`));
  }
  assert.equal(m.run(['status'], builder).code, 0);
  const hm = { env: { DELIVERY_ROLE: 'host-manager', DELIVERY_ROLE_ID: 'host-manager', DELIVERY_HOST: 'pc' }, who: { roleId: 'host-manager' } };
  assert.equal(m.run(['restart'], hm).code, 0);
  assert.match(m.run(['install', '--project', m.alpha.root], hm).out, /install writes this machine's user units and runs from a shell outside any role session/);
  assert.equal(m.run(['bogus']).code, 2);
  assert.equal(m.run(['install']).code, 2, 'install needs --project');
});

test('in a builder role directory, a caller passing cwd / and an empty env, or who host-manager, does not get past the guards of restart, tick, install and the start pass', () => {
  const m = machine({ alphaRoles: [{ id: 'builder', host: 'pc' }, { id: 'host-manager', host: 'pc' }], beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(40) }] } });
  const dir = m.alpha.dir('builder');
  fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ instance: 'builder', project_root: m.alpha.root }));
  const TR = require('./team-revive.js');
  const here = process.cwd();
  const attempts = (label) => {
    for (const more of [{ cwd: '/', env: {}, who: undefined }, { who: { roleId: 'host-manager' } }, { cwd: '/', env: { DELIVERY_ROLE: 'host-manager', DELIVERY_ROLE_ID: 'host-manager' }, who: { roleId: 'host-manager' } }]) {
      const deps = { ...m.deps(), ...more };
      const tag = `${label} ${JSON.stringify(more)}`;
      assert.throws(() => HMS.restart(deps), /restart is the host manager's/, `restart ${tag}`);
      assert.throws(() => HMS.tick(deps), /tick is the host manager's/, `tick ${tag}`);
      assert.match(HMS.install(m.alpha.root, {}, deps).out, /install writes this machine's user units/, `install ${tag}`);
      assert.throws(() => TR.revive(m.alpha.root, m.alpha.team, { start: true, ...deps, ...m.deps().teamDeps(m.alpha.root) }), /start is the Chief of Staff's/, `revive ${tag}`);
    }
  };
  process.chdir(dir);
  try {
    // the marker alone makes this process a role session
    attempts('marker');
    // and so does the role in the process's own environment, from any directory
    process.chdir(here);
    process.env.DELIVERY_ROLE = 'builder';
    attempts('env');
  } finally { process.chdir(here); delete process.env.DELIVERY_ROLE; }
  assert.equal(m.spawned.length, 0);
  assert.equal(m.sd.calls.filter((c) => / start |enable/.test(c)).length, 0);
  // the same calls from a process that is no role session run
  assert.doesNotThrow(() => HMS.restart({ ...m.deps(), who: { roleId: 'host-manager' } }));
});

test('the team list: the host file and the installed watchdog units together, each root once, sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'units-'));
  fs.writeFileSync(path.join(dir, 'delivery-watchdog-0a1b2c3d.service'), '[Service]\nWorkingDirectory=/srv/100%% done\n');
  fs.writeFileSync(path.join(dir, 'delivery-watchdog-0a1b2c3d.timer'), '[Timer]\n');
  fs.writeFileSync(path.join(dir, 'other.service'), '[Service]\nWorkingDirectory=/elsewhere\n');
  assert.deepEqual(HM.unitRoots(dir), ['/srv/100% done']);
  assert.deepEqual(HM.teamRoots(['/b', '/a'], ['/srv/100% done', '/a']), ['/a', '/b', '/srv/100% done']);
  const file = path.join(dir, 'conf', 'delivery', 'host-teams.json');
  assert.deepEqual(HM.readHostTeams(file), { teams: [] });
  assert.equal(HM.addHostTeam(file, '/z'), true);
  assert.equal(HM.addHostTeam(file, '/a'), true);
  assert.equal(HM.addHostTeam(file, '/z'), false, 'twice is once');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { teams: ['/a', '/z'] });
  fs.writeFileSync(file, 'nope');
  assert.match(HM.readHostTeams(file).unreadable, /is not JSON/);
  assert.throws(() => HM.addHostTeam(file, '/q'), /left as it is/);
  assert.equal(HM.hostFile({ XDG_CONFIG_HOME: '/x' }, '/h'), path.join('/x', 'delivery', 'host-teams.json'));
  assert.equal(HM.hostFile({}, '/h'), path.join('/h', '.config', 'delivery', 'host-teams.json'));
  assert.equal(HM.stateDir({ XDG_STATE_HOME: '/s' }, '/h'), path.join('/s', 'delivery', 'host-manager'));
});

test('the watchdog pass starts the host manager\'s unit when it is installed and stopped, one row; a running or absent unit is left alone', () => {
  const m = machine();
  const svc = path.join(HM.unitDir(m.home), HM.UNIT);
  // not installed: nothing asked, nothing written
  assert.equal(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0 }), null);
  assert.equal(m.sd.calls.length, 0);
  fs.writeFileSync(svc, '[Service]\n');
  m.sd.units[HM.UNIT] = loaded(false);
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '' };
  const deps = { cwd: m.alpha.root, env, now: T0, live: [], bd: store([]), spawn: () => 1, sweep: () => ({ removed: [], failed: [] }), userGuard: () => null, update: { configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'no-install-')) }, revive: () => [], home: m.home, hostUnit: { exec: m.sd.exec, home: m.home } };
  const r = watchdog.main(['run', '--project', m.alpha.root], deps);
  assert.match(r.out, /host manager: delivery-host-manager\.service was inactive; started it/, r.out);
  assert.ok(m.sd.calls.includes(`systemctl --user start ${HM.UNIT}`));
  const rows = () => R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-start');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].unit, HM.UNIT);
  // running now: the next pass leaves it alone
  watchdog.main(['run', '--project', m.alpha.root], { ...deps, now: iso(Date.parse(T0) + 15 * MIN) });
  assert.equal(rows().length, 1);
  assert.equal(m.sd.calls.filter((c) => c === `systemctl --user start ${HM.UNIT}`).length, 1);
  // a start that fails is a row with the error
  m.sd.units[HM.UNIT] = loaded(false);
  const failingStart = (cmd, args) => { if (args[1] === 'start') throw new Error('Job failed'); return m.sd.exec(cmd, args); };
  assert.match(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: failingStart, now: T0 }), /was inactive and did not start \(Job failed\)/);
  assert.equal(rows()[1].error, 'Job failed');
  // a unit that hit its start limit is failed: its failed state is reset, then it is started, that unit only
  m.sd.units[HM.UNIT] = { LoadState: 'loaded', ActiveState: 'failed' };
  const before = m.sd.calls.length;
  assert.match(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0 }), /was failed; reset its failed state and started it/);
  assert.deepEqual(m.sd.calls.slice(before), [`systemctl --user is-active ${HM.UNIT}`, `systemctl --user reset-failed ${HM.UNIT}`, `systemctl --user start ${HM.UNIT}`]);
  assert.equal(rows()[2].reset, true);
  // an inactive unit is started with no reset
  m.sd.units[HM.UNIT] = loaded(false);
  const b2 = m.sd.calls.length;
  watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0 });
  assert.ok(!m.sd.calls.slice(b2).some((c) => c.includes('reset-failed')));
});

test('watchdog install --apply adds the project to the host file and installs the host manager when its units are missing', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  fs.rmSync(HM.hostFile({}, m.home));
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '', DELIVERY_HOST: 'pc', USER: 'dev', XDG_CONFIG_HOME: '' };
  delete env.XDG_CONFIG_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  const r = watchdog.main(['install', '--apply'], { cwd: m.alpha.root, env, home: m.home, exec: m.sd.exec, platform: 'linux', has: () => true });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(HM.readHostTeams(HM.hostFile({}, m.home)).teams, [m.alpha.root]);
  assert.ok(fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)), r.out);
  assert.match(r.out, /^Host manager: Installed\. /m);
  assert.ok(m.sd.calls.includes(`systemctl --user enable --now ${HM.UNIT}`));
  // installed already: a second install leaves the host manager's units as they are
  const before = m.sd.calls.filter((c) => c.includes(HM.UNIT)).length;
  watchdog.main(['install', '--apply'], { cwd: m.alpha.root, env, home: m.home, exec: m.sd.exec, platform: 'linux', has: () => true });
  assert.equal(m.sd.calls.filter((c) => c.includes(HM.UNIT)).length, before);
  // a team with no host manager: the watchdog installs, and says why the host manager did not
  const b = watchdog.main(['install', '--apply'], { cwd: m.beta.root, env, home: fs.mkdtempSync(path.join(os.tmpdir(), 'home2-')), exec: m.sd.exec, platform: 'linux', has: () => true });
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /^Host manager: team\.json of .* has no host manager/m);
});

test('restart, tick and install refuse a caller in another role session even when loaded as a module', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }], beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'chief-of-staff', updated_at: ago(40) }] } });
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-caller-'));
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), '{}');
  const deps = { ...m.deps(), cwd: roleDir, who: undefined, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin' } };
  assert.throws(() => HMS.restart(deps), /restart is the host manager's/);
  assert.throws(() => HMS.tick(deps), /tick is the host manager's/);
  assert.match(HMS.install(m.alpha.root, {}, deps).out, /install writes this machine's user units/);
  assert.equal(m.spawned.length, 0);
  assert.equal(m.sd.calls.filter((c) => / start /.test(c)).length, 0);
  // the host manager's own session, and no role session at all (the timer, the watchdog), run them
  assert.doesNotThrow(() => HMS.restart({ ...m.deps(), env: { DELIVERY_HOST: 'pc', DELIVERY_ROLE: 'host-manager', DELIVERY_ROLE_ID: 'host-manager' } }));
  assert.doesNotThrow(() => HMS.restart(m.deps()));
});
