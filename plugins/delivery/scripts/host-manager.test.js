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
  // a prepared host manager's directory holds its role marker, as prepare-role.js writes it
  for (const r of roles.filter((x) => x.id === 'host-manager')) fs.writeFileSync(path.join(base, `${name}-team`, r.id, '.delivery-role.json'), JSON.stringify({ role: 'host-manager', instance: 'host-manager' }));
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
    if (sub === 'start' || sub === 'restart') {
      for (const n of operands) { if (!units[n] || units[n].LoadState === 'not-found') throw new Error(`Failed to ${sub} ${n}: Unit ${n} not found.`); units[n].ActiveState = 'active'; if (sub === 'restart' && r.onRestart) r.onRestart(n); }
      return '';
    }
    return '';
  };
  const r = { exec, calls, units, onRestart: null };
  return r;
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
    m.events.push(`spawn ${path.basename(opts.cwd)}`);
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
    // session pid -> its Remote Control server's pid (team-revive's serverOf); none by default
    servers: {},
    // stops and spawns in the order they happened
    events: [],
  };
  m.deps = () => ({
    env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev' },
    home, exec: sd.exec, has: () => true, live: () => m.live, spawn, cwd: base, who: { roleId: null }, now: m.now,
    sleep: (msec) => { m.sleeps.push(msec); m.clockMs += msec; }, clock: () => m.clockMs,
    // a stopped server's session leaves the list, as a real one does
    stop: (server, pid) => { stops.push({ server, pid }); m.events.push(`stop ${server}`); if (Array.isArray(m.live)) m.live = m.live.filter((x) => !(pid && x.pid === pid)); return true; },
    // each team's host job ran a pass five minutes ago unless a test says otherwise
    lastPass: () => Date.parse(m.now) - 5 * MIN,
    teamDeps: (root) => ({ bd: bd[root] || store(m.beads[root]), prs: [], alive: (pid) => alive.has(pid), pause: () => ({ paused: false }), configDir: config, now: m.now, hostname: 'pc', installed: m.installed, server: (pid) => (m.servers[pid] ? { pid: m.servers[pid], self: false } : null) }),
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
  assert.ok(m.sd.calls.includes(`systemctl --user restart delivery-watchdog-${a}.timer`), m.sd.calls.join('\n'));
  assert.ok(m.sd.calls.includes(`systemctl --user start --no-block delivery-watchdog-${a}.service`), 'one run of its service at once');
  // the owner's restart restarts every installed job, a running one included
  assert.ok(m.sd.calls.includes(`systemctl --user restart delivery-watchdog-${tag(m.beta.root)}.timer`), m.sd.calls.join('\n'));
  assert.deepEqual(m.spawned.map((s) => s.cwd).sort(), [m.alpha.dir('builder'), m.alpha.dir('chief-of-staff')].sort());
  for (const s of m.spawned) assert.deepEqual(s.args.slice(0, 2), ['remote-control', '--name']);
  const lines = r.out.split('\n');
  for (const l of [`Restarted: alpha's host job (delivery-watchdog-${a}.timer, delivery-watchdog-${a}.path, then one run of delivery-watchdog-${a}.service): delivery-watchdog-${a}.timer is running.`, 'Back: alpha chief-of-staff is running, listed, on the installed plugin 1.2.0.', 'Back: alpha builder is running, listed, on the installed plugin 1.2.0.', 'Left down (no work held): alpha tech-writer.']) assert.ok(lines.includes(l), `${l}\n${r.out}`);
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
  assert.match(r.out, /^Busy, not restarted now: alpha builder \(it ran the older plugin 1\.1\.0, installed 1\.2\.0\): it became busy just before the stop\.$/m, r.out);
  // idle on both reads: stopped once and restarted, and the reply names it
  const idle = stale();
  idle.m.liveStatus = () => 'idle';
  const r2 = idle.m.run(['restart'], idle.more);
  assert.deepEqual(idle.m.stops, [{ server: 99, pid: 77 }]);
  assert.equal(idle.m.spawned.length, 1);
  assert.match(r2.out, /^Restarted: alpha builder \(pid 5000\): it ran the older plugin 1\.1\.0, installed 1\.2\.0\.$/m, r2.out);
  assert.deepEqual(R.ledger(idle.m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.from, x.to]), [['builder', '1.1.0', '1.2.0']]);
});

// ---- the owner's restart (hjx.1.6.11.5): every installed host job, and every running role that holds work ----

// a role session open in its role directory on the installed plugin (or version), the roster naming that
// very session, its Remote Control id in its session file, under the Remote Control server serverPid
function runningRole(m, p, instance, { pid, serverPid = pid + 1000, version = '1.2.0', status = 'idle', bridge = `session_${instance}`, server = true } = {}) {
  const dir = p.dir(instance);
  const sessionId = `open-${instance}-${pid}`;
  require('./lib/roster.js').registerInstance(p.root, { instance, session_id: sessionId, host: 'pc', role_dir: dir, now: ago(90), plugin_version: version });
  if (bridge) {
    fs.mkdirSync(path.join(m.config, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(m.config, 'sessions', `${pid}.json`), JSON.stringify({ sessionId, cwd: dir, bridgeSessionId: bridge, pid }));
  }
  if (server) m.servers[pid] = serverPid;
  m.live = [...(Array.isArray(m.live) ? m.live : []), { cwd: dir, sessionId, pid, status }];
  return { dir, sessionId, pid, serverPid };
}
const allJobsRunning = (m) => Object.fromEntries([m.alpha.root, m.beta.root].flatMap((root) => [[`delivery-watchdog-${tag(root)}.timer`, loaded(true)], [`delivery-watchdog-${tag(root)}.path`, loaded(true)], [`delivery-watchdog-${tag(root)}.service`, loaded(false)]]));
const WORK = { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'dev@pc/builder', updated_at: ago(10) }, { id: 'al-2', status: 'in_progress', assignee: 'dev@pc/chief-of-staff', updated_at: ago(10) }] };
// only the builder holds work
const WORK_B = { alpha: [WORK.alpha[0]] };
// a user unit that serves a role: its WorkingDirectory the role directory, its ExecStart claude remote-control
function roleUnit(m, dir, name, execStart = `/opt/tools/bin/claude remote-control --name builder@alpha --spawn same-dir --capacity 1`) {
  fs.writeFileSync(path.join(HM.unitDir(m.home), name), `[Unit]\nDescription=a role\n\n[Service]\nWorkingDirectory=${dir.replace(/%/g, '%%')}\nExecStart=${execStart}\nRestart=always\n`);
}

test('the owner\'s restart with nothing down: every running role holding work is stopped and started again with --session-id, one at a time, and every installed host job is restarted', () => {
  const m = machine({ beads: WORK });
  const cos = runningRole(m, m.alpha, 'chief-of-staff', { pid: 71 });
  const b = runningRole(m, m.alpha, 'builder', { pid: 72 });
  runningRole(m, m.alpha, 'tech-writer', { pid: 73 });
  const bc = runningRole(m, m.beta, 'chief-of-staff', { pid: 81 });
  const bb = runningRole(m, m.beta, 'builder', { pid: 82 });
  const r = m.run(['restart']);
  assert.equal(r.code, 0, r.out);
  // the two holding work, stopped then started, one at a time, each only after the second read
  assert.deepEqual(m.stops, [{ server: cos.serverPid, pid: 71 }, { server: b.serverPid, pid: 72 }]);
  assert.deepEqual(m.events, [`stop ${cos.serverPid}`, 'spawn chief-of-staff', `stop ${b.serverPid}`, 'spawn builder']);
  assert.deepEqual(m.spawned.map((s) => [path.basename(s.cwd), s.args.slice(s.args.indexOf('--session-id'), s.args.indexOf('--session-id') + 2)]), [['chief-of-staff', ['--session-id', 'session_chief-of-staff']], ['builder', ['--session-id', 'session_builder']]]);
  // an idle role in a team with no work, and one with no work in a team with work, are not restarted
  for (const x of [bc, bb]) assert.ok(!m.stops.some((s) => s.pid === x.pid));
  assert.ok(!m.stops.some((s) => s.pid === 73));
  // every action a ledger row, counted by the caps
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.forced, x.from, x.to, x.session_id]), [['chief-of-staff', true, '1.2.0', '1.2.0', 'session_chief-of-staff'], ['builder', true, '1.2.0', '1.2.0', 'session_builder']]);
  assert.deepEqual(R.ledger(m.beta.root).filter((x) => x.type === 'restart'), []);
  // every installed host job: its timer and path restarted, then one run of its service
  for (const root of [m.alpha.root, m.beta.root]) {
    const t = tag(root);
    for (const c of [`systemctl --user restart delivery-watchdog-${t}.timer`, `systemctl --user restart delivery-watchdog-${t}.path`, `systemctl --user start --no-block delivery-watchdog-${t}.service`]) assert.ok(m.sd.calls.includes(c), `${c}\n${m.sd.calls.join('\n')}`);
    assert.ok(m.sd.calls.indexOf(`systemctl --user restart delivery-watchdog-${t}.timer`) < m.sd.calls.indexOf(`systemctl --user start --no-block delivery-watchdog-${t}.service`));
  }
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'Installed delivery plugin: 1.2.0.', r.out);
  for (const l of [
    `Restarted: alpha's host job (delivery-watchdog-${tag(m.alpha.root)}.timer, delivery-watchdog-${tag(m.alpha.root)}.path, then one run of delivery-watchdog-${tag(m.alpha.root)}.service): delivery-watchdog-${tag(m.alpha.root)}.timer is running.`,
    `Restarted: beta's host job (delivery-watchdog-${tag(m.beta.root)}.timer, delivery-watchdog-${tag(m.beta.root)}.path, then one run of delivery-watchdog-${tag(m.beta.root)}.service): delivery-watchdog-${tag(m.beta.root)}.timer is running.`,
    'Back: alpha chief-of-staff is back on 1.2.0: restarted (pid 5000), listed in its role directory.',
    'Back: alpha builder is back on 1.2.0: restarted (pid 5001), listed in its role directory.',
    'Not restarted (no work held): alpha tech-writer.',
    'Not restarted (no work held): beta chief-of-staff, builder.',
  ]) assert.ok(lines.includes(l), `${l}\n${r.out}`);
  assert.doesNotMatch(r.out, /nothing was restarted|Nothing to restart/i);
});

test('the owner\'s restart reads after the restart: a restarted role whose new session is not listed is not back, and the stopped session is never taken for it', () => {
  const m = machine({ beads: WORK_B });
  runningRole(m, m.alpha, 'builder', { pid: 72 });
  m.join = null;
  // the stop does not take the old session out of the list here: it must still not count as back
  const r = m.run(['restart'], { stop: (server, pid) => { m.stops.push({ server, pid }); return true; } });
  assert.equal(m.stops.length, 1);
  assert.match(r.out, /^Not back: alpha builder: restarted \(pid 5000\) but its new session is not listed after 5 min\.$/m, r.out);
  assert.doesNotMatch(r.out, /^Back: alpha builder/m);
  assert.equal(m.sleeps.reduce((x, y) => x + y, 0), 5 * MIN, 'it waited the whole window, no more');
});

test('the owner\'s restart does not stop a busy role: on the first read, or on the second just before the stop; it names it busy, not restarted now, with the reason', () => {
  const m = machine({ beads: WORK_B });
  runningRole(m, m.alpha, 'builder', { pid: 72, status: 'busy' });
  const r = m.run(['restart']);
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0);
  assert.match(r.out, /^Busy, not restarted now: alpha builder \(it is busy; it is restarted only when idle between turns\)\.$/m, r.out);
  // idle on the first read, busy on the second
  const n = machine({ beads: WORK_B });
  runningRole(n, n.alpha, 'builder', { pid: 72 });
  let reads = 0;
  const r2 = n.run(['restart'], { live: () => { reads += 1; return n.live.map((x) => ({ ...x, status: reads >= 2 ? 'busy' : 'idle' })); } });
  assert.ok(reads >= 2);
  assert.deepEqual(n.stops, []);
  assert.equal(n.spawned.length, 0);
  assert.match(r2.out, /^Busy, not restarted now: alpha builder: it became busy just before the stop\.$/m, r2.out);
});

test('the owner\'s restart skips a role with no recorded Remote Control session id, or with no Remote Control server, and says why', () => {
  const m = machine({ beads: WORK });
  runningRole(m, m.alpha, 'builder', { pid: 72, bridge: null });
  runningRole(m, m.alpha, 'chief-of-staff', { pid: 71, server: false });
  const r = m.run(['restart']);
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0);
  assert.match(r.out, /^Not restarted: alpha builder: no Remote Control session id is recorded for it, so a restart would give the owner a new link\.$/m, r.out);
  assert.match(r.out, /^Not restarted: alpha chief-of-staff: it does not run under a Remote Control server this host started, so it is not stopped here; it runs the installed plugin from its next start\.$/m, r.out);
});

test('the start caps hold the owner\'s restart of a running role and say when it can run', () => {
  const m = machine({ beads: WORK_B });
  runningRole(m, m.alpha, 'builder', { pid: 72 });
  R.record(m.alpha.root, { type: 'restart', at: ago(10), instance: 'builder', pid: 4, args: [], to: '1.2.0' });
  const r = m.run(['restart']);
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0);
  assert.match(r.out, /^Not restarted now: alpha builder \(held: started .*; the next start is after .* \(one start an hour\)\)\.$/m, r.out);
});

test('a role served by a user unit is restarted through systemctl --user restart <unit> when idle, never stopped or spawned in a scope; busy, it is not restarted', () => {
  const m = machine({ beads: WORK_B });
  const b = runningRole(m, m.alpha, 'builder', { pid: 72, server: false, bridge: null });
  roleUnit(m, b.dir, 'claude-alpha-builder.service');
  // the unit's restart brings a new session up in the role directory on the installed plugin
  m.sd.onRestart = (unit) => {
    if (unit !== 'claude-alpha-builder.service') return;
    m.live = m.live.filter((x) => x.pid !== 72).concat([{ cwd: b.dir, sessionId: 'new-b', pid: 7200, status: 'idle' }]);
    require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'builder', session_id: 'new-b', host: 'pc', role_dir: b.dir, now: T0, plugin_version: '1.2.0' });
  };
  m.sd.units['claude-alpha-builder.service'] = loaded(true);
  const r = m.run(['restart']);
  assert.ok(m.sd.calls.includes('systemctl --user restart claude-alpha-builder.service'), m.sd.calls.join('\n'));
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0, 'never in a scope');
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.unit, x.forced]), [['builder', 'claude-alpha-builder.service', true]]);
  assert.match(r.out, /^Back: alpha builder is back on 1\.2\.0: restarted through its user unit claude-alpha-builder\.service, listed in its role directory\.$/m, r.out);
  // busy: no restart of its unit
  const n = machine({ beads: WORK_B });
  const nb = runningRole(n, n.alpha, 'builder', { pid: 72, server: false, bridge: null, status: 'busy' });
  roleUnit(n, nb.dir, 'claude-alpha-builder.service');
  const r2 = n.run(['restart']);
  assert.ok(!n.sd.calls.some((c) => c.includes('claude-alpha-builder.service')), n.sd.calls.join('\n'));
  assert.match(r2.out, /^Busy, not restarted now: alpha builder \(it is busy; it is restarted only when idle between turns\)\.$/m, r2.out);
});

test('a role served by a user unit that is down is never started in a scope: the reply names its unit', () => {
  const m = machine({ beads: WORK });
  roleUnit(m, m.alpha.dir('builder'), 'claude-alpha-builder.service');
  const r = m.run(['restart']);
  assert.ok(!m.spawned.some((s) => s.cwd === m.alpha.dir('builder')), 'not spawned');
  assert.ok(m.spawned.some((s) => s.cwd === m.alpha.dir('chief-of-staff')), 'a role with no unit still starts');
  assert.match(r.out, /^Not back: alpha builder \(not started: it is served by the user unit claude-alpha-builder\.service, which is its start path; no scope is started for it\)\.$/m, r.out);
  // a unit whose ExecStart is not claude remote-control, or whose WorkingDirectory is another directory, serves no role
  const n = machine({ beads: WORK });
  roleUnit(n, n.alpha.dir('builder'), 'other.service', '/usr/bin/node server.js');
  roleUnit(n, n.alpha.dir('tech-writer'), 'tw.service');
  n.run(['restart']);
  assert.ok(n.spawned.some((s) => s.cwd === n.alpha.dir('builder')));
});

test('the owner\'s restart with nothing to restart (no host job installed, no role holding work) says so, with the version', () => {
  const m = machine({ units: {} });
  runningRole(m, m.alpha, 'builder', { pid: 72 });
  const r = m.run(['restart']);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'Installed delivery plugin: 1.2.0.', r.out);
  assert.ok(lines.includes('Nothing to restart: no watchdog host job is installed and no role session holds work.'), r.out);
  assert.deepEqual(m.stops, []);
  assert.doesNotMatch(r.out, /Nothing was down that holds work/);
});

test('a host job restart that fails is named with why', () => {
  const m = machine({ beads: {} });
  const a = tag(m.alpha.root);
  const r = m.run(['restart'], { exec: (cmd, args) => { if (args[1] === 'restart' && args[2] === `delivery-watchdog-${a}.timer`) throw new Error('Failed to restart: Unit is masked.'); return m.sd.exec(cmd, args); } });
  assert.match(r.out, new RegExp(`^Not restarted: alpha's host job: restarting delivery-watchdog-${a}\\.timer failed \\(Failed to restart: Unit is masked\\.\\)\\.$`, 'm'), r.out);
  assert.ok(!m.sd.calls.includes(`systemctl --user start --no-block delivery-watchdog-${a}.service`), 'no run of a job whose timer did not restart');
});

test('tick with every role running keeps its rule: it restarts no running session, current or holding work, and restarts no running host job', () => {
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'builder', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const m = machine({ alphaRoles: roles, beads: { alpha: [{ id: 'al-1', status: 'in_progress', assignee: 'builder', updated_at: ago(45) }, { id: 'al-2', status: 'in_progress', assignee: 'chief-of-staff', updated_at: ago(5) }] } });
  runningRole(m, m.alpha, 'chief-of-staff', { pid: 71 });
  const b = runningRole(m, m.alpha, 'builder', { pid: 72 });
  roleUnit(m, b.dir, 'claude-alpha-builder.service');
  runningRole(m, m.beta, 'chief-of-staff', { pid: 81 });
  runningRole(m, m.beta, 'builder', { pid: 82 });
  const r = m.run(['tick']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /silent: alpha builder is running but silent/, 'the tick ran its restart');
  assert.deepEqual(m.stops, []);
  assert.equal(m.spawned.length, 0);
  assert.ok(!m.sd.calls.some((c) => / restart /.test(c)), m.sd.calls.join('\n'));
  assert.ok(!m.sd.calls.some((c) => / start /.test(c)), m.sd.calls.join('\n'));
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => /restart/.test(x.type)), []);
  assert.doesNotMatch(r.out, /^Installed delivery plugin/m);
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
  // run-session's exit 3 (a host manager already live) is a success the unit does not restart, so a live
  // one never runs the unit into its start limit and the watchdog's reset-and-start (rv-198)
  for (const re of [/^SuccessExitStatus=3$/m, /^RestartPreventExitStatus=3$/m]) assert.match(svc.split('[Service]')[1], re, svc);
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
  assert.equal(inDir.code, 3, `a live host manager is a success the unit does not restart: ${inDir.out}`);
  assert.match(inDir.out, /host-manager already runs as host-manager@pc \(idle\) in .*host-manager; no second session started/);
  const byName = run([{ sessionId: 'hm-x', cwd: '/elsewhere', name: 'host-manager@pc', status: 'busy' }]);
  assert.equal(byName.code, 3, byName.out);
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
  assert.equal(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, live: [] }), null);
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
  assert.match(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: failingStart, now: T0, live: [] }), /was inactive and did not start \(Job failed\)/);
  assert.equal(rows()[1].error, 'Job failed');
  // a unit that hit its start limit is failed: its failed state is reset, then it is started, that unit only
  m.sd.units[HM.UNIT] = { LoadState: 'loaded', ActiveState: 'failed' };
  const before = m.sd.calls.length;
  assert.match(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, live: [] }), /was failed; reset its failed state and started it/);
  assert.deepEqual(m.sd.calls.slice(before), [`systemctl --user is-active ${HM.UNIT}`, `systemctl --user reset-failed ${HM.UNIT}`, `systemctl --user start ${HM.UNIT}`]);
  assert.equal(rows()[2].reset, true);
  // an inactive unit is started with no reset
  m.sd.units[HM.UNIT] = loaded(false);
  const b2 = m.sd.calls.length;
  watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, live: [] });
  assert.ok(!m.sd.calls.slice(b2).some((c) => c.includes('reset-failed')));
});

// rv-198 at 65a1abd: beside a hand-started host manager, every separate watchdog run started the unit
// again (7 starts in 13 min, then reset-failed and start again), each a host-manager-start row
test('the watchdog pass neither resets nor starts the host manager\'s unit while a host-manager session is live, and writes no row; an unreadable list starts nothing', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const svc = path.join(HM.unitDir(m.home), HM.UNIT);
  const roleDir = m.alpha.dir('host-manager');
  fs.writeFileSync(svc, `[Service]\nWorkingDirectory=${roleDir}\n`);
  const env = { ...process.env, DELIVERY_HOST: 'pc' };
  const rows = () => R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-start');
  const startsAndResets = () => m.sd.calls.filter((c) => / (?:start|reset-failed) /.test(`${c} `) && c.includes(HM.UNIT));
  for (const [state, unit] of [['inactive', loaded(false)], ['failed', { LoadState: 'loaded', ActiveState: 'failed' }]]) {
    for (const live of [
      [{ sessionId: 'hand', cwd: roleDir, name: 'Host manager', status: 'idle' }],
      [{ sessionId: 'named', cwd: '/elsewhere', name: 'host-manager@pc', status: 'busy' }],
    ]) {
      m.sd.units[HM.UNIT] = unit;
      const before = startsAndResets().length;
      const line = watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, env, live });
      assert.match(line, new RegExp(`is ${state}, and the host manager already runs as .*; not started beside it`), line);
      assert.equal(startsAndResets().length, before, `${state}: no reset and no start beside a live host manager`);
    }
  }
  // a list that cannot be read starts nothing
  m.sd.units[HM.UNIT] = loaded(false);
  const b = startsAndResets().length;
  assert.match(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, env, live: null }), /could not be listed, so it is not started now/);
  assert.equal(startsAndResets().length, b);
  assert.equal(rows().length, 0, 'no row while a host manager is live or unknown');
  // with none live, the unit is started as before; another role's session is no reason to hold it
  const line = watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, env, live: [{ sessionId: 'cos', cwd: m.alpha.dir('chief-of-staff'), name: 'chief-of-staff@alpha' }] });
  assert.match(line, /was inactive; started it/);
  assert.equal(rows().length, 1);
});

test('watchdog install --apply adds the project to the host file and installs the host manager when its units are missing', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  fs.rmSync(HM.hostFile({}, m.home));
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '', DELIVERY_HOST: 'pc', USER: 'dev', XDG_CONFIG_HOME: '', DELIVERY_CLAUDE_BIN: NO_CLAUDE };
  delete env.XDG_CONFIG_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  const r = watchdog.main(['install', '--apply'], { cwd: m.alpha.root, env, home: m.home, exec: m.sd.exec, platform: 'linux', has: () => true, live: [] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(HM.readHostTeams(HM.hostFile({}, m.home)).teams, [m.alpha.root]);
  assert.ok(fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)), r.out);
  assert.match(r.out, /^Host manager: Installed\. /m);
  assert.ok(m.sd.calls.includes(`systemctl --user enable --now ${HM.UNIT}`));
  // installed already: a second install leaves the host manager's units as they are
  const before = m.sd.calls.filter((c) => c.includes(HM.UNIT)).length;
  watchdog.main(['install', '--apply'], { cwd: m.alpha.root, env, home: m.home, exec: m.sd.exec, platform: 'linux', has: () => true, live: [] });
  assert.equal(m.sd.calls.filter((c) => c.includes(HM.UNIT)).length, before);
  // a team with no host manager: the watchdog installs, and says why the host manager did not
  const b = watchdog.main(['install', '--apply'], { cwd: m.beta.root, env, home: fs.mkdtempSync(path.join(os.tmpdir(), 'home2-')), exec: m.sd.exec, platform: 'linux', has: () => true, live: [] });
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

// Staffing prepares a host-manager instance (team.json names it, its role directory exists) and no role
// session may install units: each watchdog run, which runs outside any role session, installs them when
// they are missing, through host-manager.js install itself, and records one row. An installed unit is
// never rewritten; a team with no host manager, or an unprepared role directory, is left alone.
const NO_CLAUDE = '/nonexistent/delivery-test/claude';
const runEnv = () => {
  // no test reads this host's sessions: a claude that does not exist makes a missing live an unreadable
  // list here as on a CI runner, where there is no claude at all
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '', DELIVERY_HOST: 'pc', USER: 'dev', DELIVERY_CLAUDE_BIN: NO_CLAUDE };
  for (const k of ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR']) delete env[k];
  return env;
};
const hmRoles = (host = 'pc') => [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host }];

test('each watchdog run installs the host manager\'s units when they are missing and its role directory is prepared: once, one row, then the start check', () => {
  const m = machine({ alphaRoles: hmRoles() });
  const svc = path.join(HM.unitDir(m.home), HM.UNIT);
  const env = runEnv();
  // enable --now leaves the fake unit inactive, so the start check after the install starts it
  m.sd.units[HM.UNIT] = loaded(false);
  const deps = { cwd: m.alpha.root, env, now: T0, live: [], bd: store([]), spawn: () => 1, sweep: () => ({ removed: [], failed: [] }), userGuard: () => null, update: { configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'no-install-')) }, revive: () => [], home: m.home, hostUnit: { exec: m.sd.exec, home: m.home, has: () => true } };
  const r = watchdog.main(['run', '--project', m.alpha.root], deps);
  assert.match(r.out, /host manager: installed its units \(.*delivery-host-manager\.service/, r.out);
  assert.ok(fs.existsSync(svc), r.out);
  for (const f of [HM.TICK_SERVICE, HM.TICK_TIMER]) assert.ok(fs.existsSync(path.join(HM.unitDir(m.home), f)), f);
  // the same commands host-manager.js install runs, then the start check
  const sys = m.sd.calls.filter((c) => c.startsWith('systemctl'));
  assert.deepEqual(sys, ['systemctl --user daemon-reload', `systemctl --user enable --now ${HM.UNIT}`, `systemctl --user enable --now ${HM.TICK_TIMER}`, `systemctl --user is-active ${HM.UNIT}`, `systemctl --user start ${HM.UNIT}`]);
  const rows = (type) => R.ledger(m.alpha.root).filter((x) => x.type === type);
  assert.equal(rows('host-manager-install').length, 1);
  const row = rows('host-manager-install')[0];
  assert.equal(row.instance, 'host-manager');
  assert.equal(row.at, T0);
  assert.deepEqual(row.wrote.map((f) => path.basename(f)).sort(), [HM.UNIT, HM.TICK_SERVICE, HM.TICK_TIMER].sort());
  assert.equal(rows('host-manager-start').length, 1, 'then started');
  // the units are those host-manager.js install writes, byte for byte
  const u = HMS.unitFiles(m.alpha.root, m.alpha.team, 'host-manager', { env, home: m.home, host: 'pc', roleDir: m.alpha.dir('host-manager') });
  for (const f of u.files) assert.equal(fs.readFileSync(f.file, 'utf8'), f.body, f.file);
  // a second run: installed already, so no second install and no second row; the unit is never rewritten
  const body = fs.readFileSync(svc, 'utf8');
  fs.writeFileSync(svc, `${body}# kept\n`);
  const before = m.sd.calls.length;
  watchdog.main(['run', '--project', m.alpha.root], { ...deps, now: iso(Date.parse(T0) + 15 * MIN) });
  assert.equal(rows('host-manager-install').length, 1);
  assert.ok(!m.sd.calls.slice(before).some((c) => /daemon-reload|enable/.test(c)), m.sd.calls.slice(before).join('\n'));
  assert.equal(fs.readFileSync(svc, 'utf8'), `${body}# kept\n`, 'an installed unit is never rewritten');
});

test('the watchdog run leaves the host manager alone with no instance, an unprepared role directory, an installed unit or no systemctl', () => {
  const env = runEnv();
  const quiet = (m, more = {}) => {
    const o = { home: m.home, exec: m.sd.exec, now: T0, env, has: () => true, ...more };
    assert.equal(watchdog.ensureHostManager(m.alpha.root, o), null);
    assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)));
    assert.deepEqual(m.sd.calls, []);
    assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-install'), []);
  };
  // no host-manager instance in the team
  quiet(machine());
  // an instance on another host
  quiet(machine({ alphaRoles: hmRoles('mac') }));
  // its role directory not prepared
  const bare = machine({ alphaRoles: hmRoles() });
  fs.rmSync(bare.alpha.dir('host-manager'), { recursive: true });
  quiet(bare);
  // a host without systemctl
  quiet(machine({ alphaRoles: hmRoles() }), { has: () => false });
  // installed already: nothing written, no install row; only the start check reads its state
  const there = machine({ alphaRoles: hmRoles() });
  const svc = path.join(HM.unitDir(there.home), HM.UNIT);
  fs.writeFileSync(svc, '[Service]\n');
  there.sd.units[HM.UNIT] = loaded(true);
  assert.equal(watchdog.ensureHostManager(there.alpha.root, { home: there.home, exec: there.sd.exec, now: T0, env, has: () => true }), null);
  assert.equal(fs.readFileSync(svc, 'utf8'), '[Service]\n');
  assert.deepEqual(there.sd.calls, [`systemctl --user is-active ${HM.UNIT}`]);
  assert.deepEqual(R.ledger(there.alpha.root).filter((x) => x.type === 'host-manager-install'), []);
});

test('the per-run install is still refused from a role session: nothing written, no row', () => {
  const m = machine({ alphaRoles: hmRoles() });
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', DELIVERY_ROLE: 'builder', DELIVERY_ROLE_ID: 'builder' };
  const out = watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, env, has: () => true });
  assert.match(String(out), /install writes this machine's user units and runs from a shell outside any role session/);
  assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)));
  assert.equal(m.sd.calls.filter((c) => c.startsWith('systemctl')).length, 0);
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-install'), []);
  // a role directory as this process's directory is refused the same way
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-caller-'));
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), '{}');
  const here = process.cwd();
  process.chdir(roleDir);
  try {
    const env2 = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev' };
    assert.match(String(watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, env: env2, has: () => true })), /install writes this machine's user units/);
  } finally { process.chdir(here); }
  assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), HM.UNIT)));
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-install'), []);
  // and the watchdog's run itself is the host job's, refused in a role session
  const r = watchdog.main(['run', '--project', m.alpha.root], { cwd: m.alpha.root, env, home: m.home, hostUnit: { exec: m.sd.exec, home: m.home, has: () => true } });
  assert.equal(r.code, 1);
  assert.match(r.out, /run is the host job's/);
});

// rv-200: the per-run install found missing by the service file alone; the review's five findings
const hmUnit = (m, n) => path.join(HM.unitDir(m.home), n);
const installRows = (m) => R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-install');
const runOpts = (m, more = {}) => ({ home: m.home, exec: m.sd.exec, now: T0, env: runEnv(), has: () => true, live: [], ...more });
const ENABLES = ['systemctl --user daemon-reload', `systemctl --user enable --now ${HM.UNIT}`, `systemctl --user enable --now ${HM.TICK_TIMER}`];

test('the per-run install writes only the unit files that are missing: a tick service and tick timer already there are kept byte for byte', () => {
  const m = machine({ alphaRoles: hmRoles() });
  m.sd.units[HM.UNIT] = loaded(true);
  const own = { [HM.TICK_SERVICE]: '[Service]\n# the owner\'s own tick service\n', [HM.TICK_TIMER]: '[Timer]\n# the owner\'s own timer\nOnUnitActiveSec=1h\n' };
  for (const [n, body] of Object.entries(own)) fs.writeFileSync(hmUnit(m, n), body);
  const out = watchdog.ensureHostManager(m.alpha.root, runOpts(m));
  assert.match(String(out), /host manager: installed its units/, out);
  assert.ok(fs.existsSync(hmUnit(m, HM.UNIT)), 'the missing service is written');
  for (const [n, body] of Object.entries(own)) assert.equal(fs.readFileSync(hmUnit(m, n), 'utf8'), body, `${n} is never rewritten`);
  const rows = installRows(m);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].wrote, [hmUnit(m, HM.UNIT)]);
  assert.equal(rows[0].error, undefined);
  for (const c of ENABLES) assert.ok(m.sd.calls.includes(c), c);
  // watchdog install --apply runs the same install and keeps them too
  const m2 = machine({ alphaRoles: hmRoles() });
  for (const [n, body] of Object.entries(own)) fs.writeFileSync(hmUnit(m2, n), body);
  const r = watchdog.main(['install', '--apply'], { cwd: m2.alpha.root, env: runEnv(), home: m2.home, exec: m2.sd.exec, platform: 'linux', has: () => true, live: [] });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(hmUnit(m2, HM.UNIT)), r.out);
  for (const [n, body] of Object.entries(own)) assert.equal(fs.readFileSync(hmUnit(m2, n), 'utf8'), body, `install --apply: ${n} is never rewritten`);
});

test('a per-run install whose enable failed is enabled again at the next run, without writing the units again, until a run succeeds', () => {
  const m = machine({ alphaRoles: hmRoles() });
  m.sd.units[HM.UNIT] = loaded(true);
  const failTimer = (cmd, args) => { if (args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) { m.sd.calls.push(`${cmd} ${args.join(' ')} (failed)`); throw new Error('Failed to enable unit: Access denied'); } return m.sd.exec(cmd, args); };
  const first = watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer }));
  assert.match(String(first), /did not finish \(not installed \(Failed to enable unit: Access denied\)\)/, first);
  assert.equal(installRows(m).length, 1);
  assert.match(installRows(m)[0].error, /Access denied/);
  // the service is edited in the meantime: the retry repeats the enable steps, not the writes
  fs.appendFileSync(hmUnit(m, HM.UNIT), '# edited\n');
  const bodies = () => [HM.UNIT, HM.TICK_SERVICE, HM.TICK_TIMER].map((n) => fs.readFileSync(hmUnit(m, n), 'utf8'));
  const before = bodies();
  const b = m.sd.calls.length;
  const second = watchdog.ensureHostManager(m.alpha.root, runOpts(m, { now: iso(Date.parse(T0) + 15 * MIN) }));
  assert.match(String(second), /host manager: enabled its units again/, second);
  assert.deepEqual(bodies(), before, 'no unit is written again');
  assert.deepEqual(m.sd.calls.slice(b).filter((c) => /daemon-reload|enable/.test(c)), ENABLES);
  assert.equal(installRows(m).length, 2);
  assert.deepEqual(installRows(m)[1].wrote, []);
  assert.equal(installRows(m)[1].error, undefined);
  // enabled now: the run after neither enables nor records
  const c = m.sd.calls.length;
  watchdog.ensureHostManager(m.alpha.root, runOpts(m, { now: iso(Date.parse(T0) + 30 * MIN) }));
  assert.ok(!m.sd.calls.slice(c).some((x) => /daemon-reload|enable/.test(x)), m.sd.calls.slice(c).join('\n'));
  assert.equal(installRows(m).length, 2);
});

test('a per-run install whose first unit-file write fails writes one row with the error, and the next run tries again', () => {
  const m = machine({ alphaRoles: hmRoles() });
  const writeFile = () => { const e = new Error('EACCES: permission denied, open delivery-host-manager.service'); e.code = 'EACCES'; throw e; };
  const out = watchdog.ensureHostManager(m.alpha.root, runOpts(m, { writeFile }));
  assert.match(String(out), /host manager: its units were not installed \(not installed \(EACCES: permission denied/, out);
  assert.ok(!fs.existsSync(hmUnit(m, HM.UNIT)));
  const rows = installRows(m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instance, 'host-manager');
  assert.deepEqual(rows[0].wrote, []);
  assert.match(rows[0].error, /EACCES/);
  assert.ok(!m.sd.calls.some((c) => /daemon-reload|enable/.test(c)), 'nothing enabled after a failed write');
  // the next run writes them
  m.sd.units[HM.UNIT] = loaded(true);
  watchdog.ensureHostManager(m.alpha.root, runOpts(m));
  assert.ok(fs.existsSync(hmUnit(m, HM.UNIT)));
  assert.equal(installRows(m).length, 2);
  assert.equal(installRows(m)[1].error, undefined);
});

test('a missing or malformed team.json: the install does not throw, installs nothing and says the team could not be read', () => {
  const team = (m) => path.join(m.alpha.root, '.delivery', 'team', 'team.json');
  for (const [what, spoil] of [['missing', (f) => fs.rmSync(f)], ['not JSON', (f) => fs.writeFileSync(f, '{ nope')], ['no roles', (f) => fs.writeFileSync(f, JSON.stringify({ project: 'alpha' }))], ['null', (f) => fs.writeFileSync(f, 'null')]]) {
    const m = machine({ alphaRoles: hmRoles() });
    spoil(team(m));
    let out;
    assert.doesNotThrow(() => { out = watchdog.ensureHostManager(m.alpha.root, runOpts(m)); }, what);
    assert.match(String(out), /host manager: its units were not installed \(the team at .* could not be read \(.+\); nothing was installed\.\)/, `${what}: ${out}`);
    let r;
    assert.doesNotThrow(() => { r = HMS.install(m.alpha.root, {}, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live: [] }); }, what);
    assert.equal(r.code, 1, what);
    assert.match(r.out, /could not be read .*nothing was installed/, what);
    assert.ok(!fs.existsSync(hmUnit(m, HM.UNIT)), what);
    assert.deepEqual(m.sd.calls, [], what);
    assert.deepEqual(installRows(m), [], what);
  }
});

test('a role directory without its role marker is not prepared: nothing installed, by the run or by install, the roster\'s role_dir included', () => {
  const m = machine({ alphaRoles: hmRoles() });
  fs.rmSync(path.join(m.alpha.dir('host-manager'), '.delivery-role.json'));
  assert.equal(watchdog.ensureHostManager(m.alpha.root, runOpts(m)), null);
  const r = HMS.install(m.alpha.root, {}, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live: [] });
  assert.equal(r.code, 1);
  assert.match(r.out, /role directory .* is not prepared on this host \(it holds no \.delivery-role\.json/);
  // a role_dir a role session wrote into the roster: a directory that exists but holds no marker
  const m2 = machine({ alphaRoles: hmRoles() });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-role-'));
  require('./lib/roster.js').registerInstance(m2.alpha.root, { instance: 'host-manager', session_id: 's1', host: 'pc', role_dir: elsewhere, now: T0 });
  assert.equal(watchdog.ensureHostManager(m2.alpha.root, runOpts(m2)), null);
  for (const x of [m, m2]) {
    assert.ok(!fs.existsSync(hmUnit(x, HM.UNIT)));
    assert.deepEqual(x.sd.calls, []);
    assert.deepEqual(installRows(x), []);
  }
  // with the marker there, the roster's directory is the one installed
  fs.writeFileSync(path.join(elsewhere, '.delivery-role.json'), JSON.stringify({ role: 'host-manager', instance: 'host-manager' }));
  m2.sd.units[HM.UNIT] = loaded(true);
  assert.match(String(watchdog.ensureHostManager(m2.alpha.root, runOpts(m2))), /installed its units/);
  assert.match(fs.readFileSync(hmUnit(m2, HM.UNIT), 'utf8'), new RegExp(`^WorkingDirectory=${elsewhere.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('a run that repeats a failed install still starts a stopped host manager when its role directory is no longer prepared', () => {
  const m = machine({ alphaRoles: hmRoles() });
  m.sd.units[HM.UNIT] = loaded(true);
  const failTimer = (cmd, args) => { if (args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) throw new Error('Failed to enable unit: Access denied'); return m.sd.exec(cmd, args); };
  watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer }));
  assert.match(String(installRows(m).pop().error), /Access denied/);
  // the marker goes and the unit stops: the install is not repeated, but the unit is still started
  fs.rmSync(path.join(m.alpha.dir('host-manager'), '.delivery-role.json'));
  m.sd.units[HM.UNIT] = loaded(false);
  const b = m.sd.calls.length;
  const out = watchdog.ensureHostManager(m.alpha.root, runOpts(m, { now: iso(Date.parse(T0) + 15 * MIN) }));
  assert.ok(m.sd.calls.slice(b).includes(`systemctl --user start ${HM.UNIT}`), m.sd.calls.slice(b).join('\n'));
  assert.equal(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-start').length, 1, String(out));
  assert.ok(!m.sd.calls.slice(b).some((c) => /daemon-reload|enable/.test(c)), 'the install is not repeated');
});

test('an enable that keeps failing the same way is repeated each run but recorded once; a different error or a success is a new row', () => {
  const m = machine({ alphaRoles: hmRoles() });
  m.sd.units[HM.UNIT] = loaded(true);
  let msg = 'Failed to enable unit: Access denied';
  const failTimer = (cmd, args) => { if (msg && args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) throw new Error(msg); return m.sd.exec(cmd, args); };
  for (let i = 0; i < 4; i++) watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer, now: iso(Date.parse(T0) + i * 15 * MIN) }));
  assert.equal(installRows(m).length, 1, JSON.stringify(installRows(m)));
  assert.equal(m.sd.calls.filter((c) => c === 'systemctl --user daemon-reload').length, 4, 'the enable steps are repeated each run');
  msg = 'Failed to enable unit: Unit file is masked';
  watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer, now: iso(Date.parse(T0) + 60 * MIN) }));
  assert.equal(installRows(m).length, 2);
  assert.match(installRows(m)[1].error, /masked/);
  msg = null;
  watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer, now: iso(Date.parse(T0) + 75 * MIN) }));
  assert.equal(installRows(m).length, 3);
  assert.equal(installRows(m)[2].error, undefined);
});

test('a role marker that names another role or another instance is not a prepared host manager', () => {
  for (const marker of [{ role: 'builder', instance: 'host-manager' }, { role: 'host-manager', instance: 'host-manager-2' }, {}]) {
    const m = machine({ alphaRoles: hmRoles() });
    fs.writeFileSync(path.join(m.alpha.dir('host-manager'), '.delivery-role.json'), JSON.stringify(marker));
    assert.equal(watchdog.ensureHostManager(m.alpha.root, runOpts(m)), null, JSON.stringify(marker));
    assert.ok(!fs.existsSync(hmUnit(m, HM.UNIT)), JSON.stringify(marker));
    const r = HMS.install(m.alpha.root, {}, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live: [] });
    assert.equal(r.code, 1);
    assert.match(r.out, /role marker .* is not the host manager's/, r.out);
  }
});

test('a repeated install that can no longer go ahead still starts the stopped unit: the instance moved to another host, or team.json unreadable', () => {
  const teamFile = (m) => path.join(m.alpha.root, '.delivery', 'team', 'team.json');
  const cases = [
    ['instance on another host', (m) => { const t = JSON.parse(fs.readFileSync(teamFile(m), 'utf8')); t.roles = t.roles.map((r) => (r.id === 'host-manager' ? { ...r, host: 'elsewhere' } : r)); fs.writeFileSync(teamFile(m), JSON.stringify(t)); }, null],
    ['team.json unreadable', (m) => fs.writeFileSync(teamFile(m), '{ nope'), /its units were not installed \(the team at .* could not be read/],
  ];
  for (const [what, spoil, said] of cases) {
    const m = machine({ alphaRoles: hmRoles() });
    m.sd.units[HM.UNIT] = loaded(true);
    const failTimer = (cmd, args) => { if (args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) throw new Error('Failed to enable unit: Access denied'); return m.sd.exec(cmd, args); };
    watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer }));
    assert.match(String(installRows(m).pop().error), /Access denied/, what);
    spoil(m);
    m.sd.units[HM.UNIT] = loaded(false);
    const b = m.sd.calls.length;
    const out = String(watchdog.ensureHostManager(m.alpha.root, runOpts(m, { now: iso(Date.parse(T0) + 15 * MIN) })));
    assert.ok(m.sd.calls.slice(b).includes(`systemctl --user start ${HM.UNIT}`), `${what}: ${m.sd.calls.slice(b).join('\n')}`);
    assert.equal(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-start').length, 1, `${what}: ${out}`);
    assert.ok(!m.sd.calls.slice(b).some((c) => /daemon-reload|enable/.test(c)), `${what}: the install is not repeated`);
    assert.equal(installRows(m).length, 1, `${what}: no install row for a skipped retry`);
    if (said) assert.match(out, said, what);
  }
});

// rv-200: the install's own enable must not start the unit beside a live host manager (the rv-198 symptom)
test('while a host manager is live, the per-run install never starts its unit: tick enable failing, unit inactive, three passes, no start', () => {
  const m = machine({ alphaRoles: hmRoles() });
  m.sd.units[HM.UNIT] = loaded(false);
  const live = [{ sessionId: 'hm-live', cwd: m.alpha.dir('host-manager'), name: 'host-manager@pc', status: 'idle' }];
  const failTimer = (cmd, args) => { if (args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) throw new Error('Failed to enable unit: Access denied'); return m.sd.exec(cmd, args); };
  for (let i = 0; i < 3; i++) watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer, live, now: iso(Date.parse(T0) + i * 15 * MIN) }));
  const starts = m.sd.calls.filter((c) => c === `systemctl --user start ${HM.UNIT}` || c === `systemctl --user enable --now ${HM.UNIT}`);
  assert.deepEqual(starts, [], m.sd.calls.join('\n'));
  assert.ok(m.sd.calls.includes(`systemctl --user enable ${HM.UNIT}`), 'the service is still enabled, for the next boot');
  assert.equal(R.ledger(m.alpha.root).filter((x) => x.type === 'host-manager-start').length, 0);
});

test('the install enables the service with --now only when no host manager is live and the open sessions could be read', () => {
  const run = (live) => {
    const m = machine({ alphaRoles: hmRoles() });
    m.sd.units[HM.UNIT] = loaded(false);
    const r = HMS.install(m.alpha.root, {}, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live });
    assert.equal(r.code, 0, r.out);
    return m.sd.calls;
  };
  assert.ok(run([]).includes(`systemctl --user enable --now ${HM.UNIT}`), 'none live: started at once');
  for (const [what, live] of [['sessions unreadable', null], ['one live', (m) => m]]) {
    const calls = what === 'one live'
      ? (() => { const m = machine({ alphaRoles: hmRoles() }); m.sd.units[HM.UNIT] = loaded(false); HMS.install(m.alpha.root, {}, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live: [{ sessionId: 'x', cwd: m.alpha.dir('host-manager'), name: 'host-manager@pc', status: 'busy' }] }); return m.sd.calls; })()
      : run(live);
    assert.ok(!calls.includes(`systemctl --user enable --now ${HM.UNIT}`), `${what}: ${calls.join(' | ')}`);
    assert.ok(calls.includes(`systemctl --user enable ${HM.UNIT}`), what);
    assert.ok(calls.includes(`systemctl --user enable --now ${HM.TICK_TIMER}`), `${what}: the tick timer still starts`);
  }
});

test('a repeated install that is skipped says why: the instance on another host, its directory not prepared, or no systemctl', () => {
  const teamFile = (m) => path.join(m.alpha.root, '.delivery', 'team', 'team.json');
  const cases = [
    ['another host', (m) => { const t = JSON.parse(fs.readFileSync(teamFile(m), 'utf8')); t.roles = t.roles.map((r) => (r.id === 'host-manager' ? { ...r, host: 'elsewhere' } : r)); fs.writeFileSync(teamFile(m), JSON.stringify(t)); }, {}, /install not repeated \(.*has no host manager on host "pc"/],
    ['not prepared', (m) => fs.rmSync(path.join(m.alpha.dir('host-manager'), '.delivery-role.json')), {}, /install not repeated \(.*not prepared on this host/],
    ['no systemctl', () => {}, { has: (b) => b !== 'systemctl' }, /install not repeated \(this host has no systemctl\)/],
  ];
  for (const [what, spoil, more, said] of cases) {
    const m = machine({ alphaRoles: hmRoles() });
    m.sd.units[HM.UNIT] = loaded(true);
    const failTimer = (cmd, args) => { if (args.join(' ') === `--user enable --now ${HM.TICK_TIMER}`) throw new Error('Failed to enable unit: Access denied'); return m.sd.exec(cmd, args); };
    watchdog.ensureHostManager(m.alpha.root, runOpts(m, { exec: failTimer }));
    spoil(m);
    const out = String(watchdog.ensureHostManager(m.alpha.root, runOpts(m, { now: iso(Date.parse(T0) + 15 * MIN), ...more })));
    assert.match(out, said, `${what}: ${out}`);
  }
});

test('the dry run prints what the install would run: --now for the service only when no host manager is live and the sessions could be read', () => {
  const dry = (live) => {
    const m = machine({ alphaRoles: hmRoles() });
    const at = typeof live === 'function' ? live(m) : live;
    return HMS.install(m.alpha.root, { dryRun: true }, { env: runEnv(), home: m.home, exec: m.sd.exec, has: () => true, cwd: m.alpha.root, live: at }).out;
  };
  const nowLine = `Would run: systemctl --user enable --now ${HM.UNIT}`;
  const plainLine = `Would run: systemctl --user enable ${HM.UNIT}`;
  assert.ok(dry([]).split('\n').includes(nowLine), dry([]));
  for (const [what, live] of [['unreadable', null], ['one live', (m) => [{ sessionId: 'x', cwd: m.alpha.dir('host-manager'), name: 'host-manager@pc', status: 'idle' }]]]) {
    const out = dry(live).split('\n');
    assert.ok(!out.includes(nowLine), `${what}: ${out.join(' | ')}`);
    assert.ok(out.includes(plainLine), what);
    assert.ok(out.some((l) => /^Would not start it now:/.test(l)), `${what}: the dry run says why`);
  }
});

// ---- the Chief of Staff's own unit (hjx.1.6.10.1.2.1) ----

const SL = require('./lib/service-limits.js');
const cosMarker = (m, root = m.alpha.root, dir = m.alpha.dir('chief-of-staff')) => fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ role: 'chief-of-staff', instance: 'chief-of-staff', project_root: root }));
const cosUnit = (m) => `delivery-role-chief-of-staff-${tag(m.alpha.root)}.service`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('install-role writes the Chief of Staff\'s own unit: run-session in its role directory, bounded restarts, KillMode=process and the one-session task limit', () => {
  const m = machine();
  cosMarker(m);
  const file = path.join(HM.unitDir(m.home), cosUnit(m));
  const dry = m.run(['install-role', '--dry-run', '--project', m.alpha.root]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, new RegExp(`^Would write ${esc(file)}:$`, 'm'));
  assert.ok(!fs.existsSync(file), 'a dry run writes nothing');
  assert.equal(m.sd.calls.filter((c) => c.startsWith('systemctl')).length, 0);
  const r = m.run(['install-role', '--project', m.alpha.root]);
  assert.equal(r.code, 0, r.out);
  const svc = fs.readFileSync(file, 'utf8');
  for (const re of [/^Restart=always$/m, /^RestartSec=30$/m, /^KillMode=process$/m, /^WantedBy=default\.target$/m, new RegExp(`^WorkingDirectory=${esc(m.alpha.dir('chief-of-staff'))}$`, 'm'),
    /^ExecStart=\/usr\/bin\/env "node" ".*\/alpha\/\.delivery\/bin\/delivery\.js" "host-manager\.js" "run-session" "--project" ".*\/alpha" "--instance" "chief-of-staff"$/m, /^Environment="DELIVERY_ROLE=chief-of-staff"$/m,
    /^SuccessExitStatus=3$/m, /^RestartPreventExitStatus=3$/m]) assert.match(svc, re, svc);
  for (const re of [/^RestartSteps=5$/m, /^RestartMaxDelaySec=30min$/m]) assert.match(svc.split('[Service]')[1], re, svc);
  for (const re of [/^StartLimitIntervalSec=15min$/m, /^StartLimitBurst=5$/m]) assert.match(svc.split('[Service]')[0], re, svc);
  // its task limit is the one --check asks of a unit that holds one role session
  assert.match(svc, new RegExp(`^TasksMax=${SL.needOf(cosUnit(m), 0)}$`, 'm'));
  assert.doesNotMatch(svc, /remote-control|--session-id/, 'the session it reattaches to is read when it starts');
  for (const c of ['systemctl --user daemon-reload', `systemctl --user enable --now ${cosUnit(m)}`]) assert.ok(m.sd.calls.includes(c), `${c}: ${m.sd.calls.join(' | ')}`);
  // the shared helper takes it as the plugin's own start path for that directory
  assert.deepEqual(R.servingUnits(m.alpha.dir('chief-of-staff'), { home: m.home }), [{ unit: cosUnit(m), written: true }]);
  // with its session live, it is enabled only: started now it would be a second session
  const calls = m.sd.calls.length;
  const again = m.run(['install-role', '--project', m.alpha.root], { live: [{ sessionId: 'c1', cwd: m.alpha.dir('chief-of-staff'), name: 'chief-of-staff@alpha', status: 'idle' }] });
  assert.equal(again.code, 0, again.out);
  assert.ok(m.sd.calls.slice(calls).includes(`systemctl --user enable ${cosUnit(m)}`), m.sd.calls.slice(calls).join(' | '));
  assert.ok(!m.sd.calls.slice(calls).some((c) => /--now/.test(c)));
  assert.match(again.out, /^Not started now: chief-of-staff already runs/m);
});

test('install-role installs nothing while a unit the plugin did not write serves the Chief of Staff\'s directory, and never touches that unit', () => {
  const m = machine();
  cosMarker(m);
  const hand = path.join(HM.unitDir(m.home), 'claude-rc-chief-of-staff.service');
  const body = `[Unit]\nDescription=mine\n\n[Service]\nWorkingDirectory=${m.alpha.dir('chief-of-staff')}\nExecStart=/opt/tools/bin/claude remote-control --name cos\nRestart=always\nTasksMax=300\n`;
  fs.writeFileSync(hand, body);
  const r = m.run(['install-role', '--project', m.alpha.root]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-rc-chief-of-staff\.service serves .*chief-of-staff with claude remote-control, and the delivery plugin did not write it/);
  assert.match(r.out, /stop and disable claude-rc-chief-of-staff\.service .*then run install-role again/);
  assert.equal(fs.readFileSync(hand, 'utf8'), body, 'the owner\'s unit is left byte for byte');
  assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), cosUnit(m))), 'the plugin\'s own unit is not written beside it');
  assert.deepEqual(m.sd.calls.filter((c) => c.startsWith('systemctl')), [], 'no systemctl call at all');
  // never from a role session, and not without a prepared Chief of Staff directory
  const inRole = m.run(['install-role', '--project', m.alpha.root], { env: { DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_ID: 'chief-of-staff' }, who: { roleId: 'chief-of-staff' } });
  assert.equal(inRole.code, 1);
  assert.match(inRole.out, /outside any role session/);
  const none = m.run(['install-role', '--project', m.beta.root]);
  assert.equal(none.code, 1);
  assert.match(none.out, /role marker|not prepared/);
});

test('run-session starts the Chief of Staff by the same rules as the host manager: its own name, its own ledger rows, never beside a live session', () => {
  const m = machine();
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', CLAUDE_CONFIG_DIR: m.config, DELIVERY_ROLE: 'chief-of-staff' };
  const calls = [];
  const execve = (file, argv, e) => { calls.push({ file, argv, env: e }); };
  const run = (more = {}) => m.run(['run-session', '--project', m.alpha.root, '--instance', 'chief-of-staff'], { env, who: { roleId: 'chief-of-staff' }, execve, resolveBin: (b) => `/opt/bin/${b}`, now: T0, ...more });
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(calls[0].argv, ['claude', 'remote-control', '--name', 'chief-of-staff@alpha', '--spawn', 'same-dir', '--capacity', '1', '--permission-mode', 'auto']);
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'role-unit-session').map((x) => x.instance), ['chief-of-staff']);
  const live = run({ live: [{ sessionId: 'c1', cwd: m.alpha.dir('chief-of-staff'), name: 'x', status: 'idle' }] });
  assert.equal(live.code, 3, live.out);
  assert.equal(calls.length, 1);
  // a builder's session does not run it for itself or for the Chief of Staff
  const no = m.run(['run-session', '--project', m.alpha.root, '--instance', 'builder'], { env: { ...env, DELIVERY_ROLE: 'builder' }, who: { roleId: 'builder' }, execve, resolveBin: (b) => `/opt/bin/${b}` });
  assert.equal(no.code, 1);
  assert.equal(calls.length, 1);
});
