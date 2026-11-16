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
const { fakeDirectory } = require('./testing/fake-service-directory.js');
const SD = require('./lib/service-directory.js');

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
    // is-enabled: a unit given Enabled is enabled, one listed without it disabled, an unknown one unknown
    if (sub === 'is-enabled') {
      const u = units[operands[0]];
      if (u && u.Enabled) return 'enabled\n';
      const e = new Error('Command failed: systemctl'); e.stdout = u ? 'disabled\n' : ''; throw e;
    }
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
    // the owner's service directory, a fake: every request the plugin makes to it, and its entries
    dir: fakeDirectory(),
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
    home, exec: sd.exec, has: () => true, live: () => m.live, spawn, cwd: base, who: { roleId: null }, now: m.now, sdFetch: m.dir.fetch,
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

// Read before change (dec-chief-of-staff-000485): the owner's restart reads a plugin unit's entry in the
// service directory before it restarts or starts it.
test('the owner\'s restart reads the unit\'s directory entry first: the plugin\'s own is restarted, a missing one is registered and read again, another owner\'s is refused; unreachable, a running unit is refused and a down one is started with a row and a warning', () => {
  const ownExec = (m) => `/usr/bin/env "node" "${path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')}" "host-manager.js" "run-session" "--project" "${m.alpha.root}" "--instance" "chief-of-staff"`;
  const own = (m) => `delivery-role-chief-of-staff-${tag(m.alpha.root)}.service`;
  const running = (dir) => {
    const m = machine({ beads: WORK });
    if (dir) m.dir = dir;
    const c = runningRole(m, m.alpha, 'chief-of-staff', { pid: 72, server: false, bridge: null });
    roleUnit(m, c.dir, own(m), ownExec(m));
    m.sd.units[own(m)] = loaded(true);
    return m;
  };
  const restarts = (m) => m.sd.calls.filter((x) => x === `systemctl --user restart ${own(m)}`).length;
  // its own entry: read, then restarted
  const a = running();
  a.dir.entries.push(SD.entryFor(own(a)), ...Object.keys(a.sd.units).filter((u) => /^delivery-watchdog-/.test(u)).map((u) => SD.entryFor(u)), ...Object.keys(a.sd.units).filter((u) => /^delivery-watchdog-.*\.timer$/.test(u)).map((u) => SD.entryFor(u.replace(/\.timer$/, '.service'))));
  a.run(['restart']);
  assert.equal(restarts(a), 1);
  assert.ok(a.dir.calls.includes('GET /api/services/local'));
  assert.ok(!a.dir.calls.includes('POST /api/services'), 'nothing to register');
  // missing: registered, read again, restarted
  const b = running();
  b.run(['restart']);
  assert.equal(restarts(b), 1);
  assert.deepEqual(b.dir.calls.slice(0, 3), ['GET /api/services/local', 'POST /api/services', 'GET /api/services/local']);
  assert.equal(b.dir.entry(own(b)).owner, 'delivery plugin');
  // another owner: refused with the reason, no restart, no cap counted
  const c = running();
  c.dir.entries.push({ ...SD.entryFor(own(c)), owner: 'colombod' });
  const rc = c.run(['restart']);
  assert.equal(restarts(c), 0, c.sd.calls.join('\n'));
  assert.match(rc.out, new RegExp(`${esc(own(c))} was not restarted: the service directory lists ${esc(own(c))} as owned by "colombod", not by the delivery plugin`), rc.out);
  assert.deepEqual(R.ledger(c.alpha.root).filter((x) => x.instance === 'chief-of-staff').map((x) => x.type), ['restart-refused']);
  // unreachable: the running unit is not restarted, and the reply says the directory could not be read
  const d = running(fakeDirectory({ down: true }));
  const rd = d.run(['restart']);
  assert.equal(restarts(d), 0);
  assert.match(rd.out, /was not restarted: the service directory at http:\/\/127\.0\.0\.1:8085 could not be reached .*a restart of a running unit is not made/, rd.out);
  // unreachable, the role down: its plugin unit is started, with a row and a warning, and registered on the next pass that reaches the directory
  const e = machine({ beads: WORK });
  e.dir = fakeDirectory({ down: true });
  roleUnit(e, e.alpha.dir('chief-of-staff'), own(e), ownExec(e));
  e.sd.units[own(e)] = loaded(false);
  e.run(['restart']);
  assert.ok(e.sd.calls.includes(`systemctl --user start ${own(e)}`), e.sd.calls.join('\n'));
  assert.deepEqual(R.ledger(e.alpha.root).filter((x) => x.type === 'directory-unreachable').map((x) => [x.unit, x.action]), [[own(e), 'start']]);
  assert.deepEqual(require('./lib/warnings.js').list(e.alpha.root).map((w) => w.kind), ['service-directory-unreachable']);
  e.dir.down = false;
  watchdog.directoryPass(e.alpha.root, { home: e.home, exec: e.sd.exec, sdFetch: e.dir.fetch });
  assert.equal(e.dir.entry(own(e)).owner, 'delivery plugin', 'registered once the directory is back');
});

test('the owner\'s restart restarts a role through the plugin\'s own unit when idle, never in a scope; a unit the plugin did not write is named with the fix and never restarted, and with both on one directory neither is', () => {
  const ownExec = (m) => `/usr/bin/env "node" "${path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')}" "host-manager.js" "run-session" "--project" "${m.alpha.root}" "--instance" "chief-of-staff"`;
  const own = (m) => `delivery-role-chief-of-staff-${tag(m.alpha.root)}.service`;
  // the plugin's own unit: restarted through it
  const m = machine({ beads: WORK });
  const c = runningRole(m, m.alpha, 'chief-of-staff', { pid: 72, server: false, bridge: null });
  roleUnit(m, c.dir, own(m), ownExec(m));
  // the unit's restart brings a new session up in the role directory on the installed plugin
  m.sd.onRestart = (unit) => {
    if (unit !== own(m)) return;
    m.live = m.live.filter((x) => x.pid !== 72).concat([{ cwd: c.dir, sessionId: 'new-c', pid: 7200, status: 'idle' }]);
    require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'chief-of-staff', session_id: 'new-c', host: 'pc', role_dir: c.dir, now: T0, plugin_version: '1.2.0' });
  };
  m.sd.units[own(m)] = loaded(true);
  const r = m.run(['restart']);
  assert.ok(m.sd.calls.includes(`systemctl --user restart ${own(m)}`), m.sd.calls.join('\n'));
  assert.deepEqual(m.stops.filter((x) => x.pid === 72), []);
  assert.ok(!m.spawned.some((x) => x.cwd === c.dir), 'never in a scope');
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart' && x.instance === 'chief-of-staff').map((x) => [x.unit, x.forced]), [[own(m), true]]);
  assert.match(r.out, new RegExp(`^Back: alpha chief-of-staff is back on 1\\.2\\.0: restarted through its user unit ${esc(own(m))}, listed in its role directory\\.$`, 'm'), r.out);
  // busy: no restart of its unit
  const n = machine({ beads: WORK });
  const nc = runningRole(n, n.alpha, 'chief-of-staff', { pid: 72, server: false, bridge: null, status: 'busy' });
  roleUnit(n, nc.dir, own(n), ownExec(n));
  const r2 = n.run(['restart']);
  assert.ok(!n.sd.calls.some((x) => x.includes(own(n))), n.sd.calls.join('\n'));
  assert.match(r2.out, /^Busy, not restarted now: alpha chief-of-staff \(it is busy; it is restarted only when idle between turns\)\.$/m, r2.out);
  // a unit the plugin did not write, idle: named with the fix, never restarted, stopped or spawned beside
  const h = machine({ beads: WORK_B });
  const hb = runningRole(h, h.alpha, 'builder', { pid: 73, server: false, bridge: null });
  roleUnit(h, hb.dir, 'claude-alpha-builder.service');
  h.sd.units['claude-alpha-builder.service'] = loaded(true);
  const r3 = h.run(['restart']);
  assert.ok(!h.sd.calls.some((x) => x.includes('claude-alpha-builder.service')), h.sd.calls.join('\n'));
  assert.deepEqual(h.stops, []);
  assert.equal(h.spawned.length, 0);
  assert.deepEqual(R.ledger(h.alpha.root).filter((x) => /restart/.test(x.type)), []);
  assert.match(r3.out, /^Not restarted: alpha builder: served by claude-alpha-builder\.service, which the plugin did not write; not restarted: stop and disable claude-alpha-builder\.service \(systemctl --user disable --now claude-alpha-builder\.service; the plugin never changes it\), then the team's start pass starts the role in a scope of its own\.$/m, r3.out);
  // both units on the Chief of Staff's directory: neither is restarted
  const b = machine({ beads: WORK });
  const bc = runningRole(b, b.alpha, 'chief-of-staff', { pid: 74, server: false, bridge: null });
  roleUnit(b, bc.dir, own(b), ownExec(b));
  roleUnit(b, bc.dir, 'claude-rc-chief-of-staff.service', '%h/.local/bin/claude remote-control --name "Chief of Staff"');
  const r4 = b.run(['restart']);
  assert.ok(!b.sd.calls.some((x) => x.includes(own(b)) || x.includes('claude-rc-chief-of-staff.service')), b.sd.calls.join('\n'));
  assert.ok(!b.spawned.some((x) => x.cwd === bc.dir));
  assert.match(r4.out, /^Not restarted: alpha chief-of-staff: served by claude-rc-chief-of-staff\.service, which the plugin did not write; not restarted: .*the plugin's own delivery-role-chief-of-staff-[0-9a-f]{8}\.service serves it too: two start paths for one role directory, so neither is restarted/m, r4.out);
});

// The host manager's session is its own unit's (delivery-host-manager.service). On an older plugin it is
// moved onto the installed one by team-revive's stale-session restart (the watchdog's start pass and the
// owner's restart) only through that unit, only when idle on a fresh read; never stopped and spawned in a
// scope, and never started by a start pass when it is down.
const HM_ROLES = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
function hostManagerUnit(m) { fs.writeFileSync(path.join(HM.unitDir(m.home), HM.UNIT), `[Unit]\nDescription=x\n\n[Service]\nWorkingDirectory=${m.alpha.dir('host-manager')}\nExecStart=/usr/bin/env node /x/delivery.js host-manager.js run-session\n`); m.sd.units[HM.UNIT] = loaded(true); }
test('a host manager on an older plugin is restarted through its own unit by the owner\'s restart when idle, never stopped or spawned in a scope; busy, it is named and left', () => {
  const m = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(m);
  const hm = runningRole(m, m.alpha, 'host-manager', { pid: 90, version: '1.1.0' });
  m.sd.onRestart = (unit) => {
    if (unit !== HM.UNIT) return;
    m.live = m.live.filter((x) => x.pid !== 90).concat([{ cwd: hm.dir, sessionId: 'new-hm', pid: 9000, status: 'idle' }]);
    require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'host-manager', session_id: 'new-hm', host: 'pc', role_dir: hm.dir, now: T0, plugin_version: '1.2.0' });
  };
  const r = m.run(['restart']);
  assert.equal(r.code, 0, r.out);
  assert.equal(m.sd.calls.filter((c) => c === `systemctl --user restart ${HM.UNIT}`).length, 1, m.sd.calls.join('\n'));
  assert.deepEqual(m.stops, [], 'its server is never stopped here');
  assert.ok(!m.spawned.some((s) => s.cwd === hm.dir), 'never spawned in a scope');
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.unit, x.via, x.from, x.to]), [['host-manager', HM.UNIT, 'unit', '1.1.0', '1.2.0']]);
  assert.match(r.out, /^Back: alpha host-manager is back on 1\.2\.0: restarted through its user unit delivery-host-manager\.service, listed in its role directory\.$/m, r.out);
  // busy: its unit is not restarted, and the reply names it
  const n = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(n);
  runningRole(n, n.alpha, 'host-manager', { pid: 90, version: '1.1.0', status: 'busy' });
  const r2 = n.run(['restart']);
  assert.ok(!n.sd.calls.includes(`systemctl --user restart ${HM.UNIT}`), n.sd.calls.join('\n'));
  assert.deepEqual(n.stops, []);
  assert.equal(n.spawned.length, 0);
  assert.match(r2.out, /^Busy, not restarted now: alpha host-manager \(it is busy; it is restarted only when idle between turns\)\.$/m, r2.out);
});

test('the start pass (the watchdog\'s) restarts an older, idle host manager through its unit only after a fresh read; busy on that read, current, or with no unit installed, nothing is restarted', () => {
  const TR = require('./team-revive.js');
  const pass = (m, { relist, version = '1.1.0', status = 'idle' } = {}) => {
    const hm = runningRole(m, m.alpha, 'host-manager', { pid: 90, version, status });
    const units = [];
    const spawned = [];
    const stopped = [];
    const r = TR.revive(m.alpha.root, m.alpha.team, { start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: m.live, relist: relist ? () => relist(hm) : () => m.live, restartUnit: (u) => units.push(u), spawn: (...a) => { spawned.push(a); return 1; }, stop: (...a) => { stopped.push(a); return true; }, systemdRun: null, ...m.deps().teamDeps(m.alpha.root) });
    return { r, units, spawned, stopped, hm };
  };
  // older and idle on the fresh read: one restart of its unit, a row, no stop and no spawn
  const m = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(m);
  const a = pass(m);
  assert.deepEqual(a.units, [HM.UNIT]);
  assert.deepEqual([a.spawned, a.stopped], [[], []]);
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart').map((x) => [x.instance, x.unit, x.from, x.to]), [['host-manager', HM.UNIT, '1.1.0', '1.2.0']]);
  assert.ok(a.r.lines.includes(`Restarted: host-manager on 1.2.0: systemctl --user restart ${HM.UNIT}, the user unit that serves ${a.hm.dir}.`), a.r.lines.join('\n'));
  // idle on the first read, busy on the fresh one: named, left
  const b = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(b);
  const bb = pass(b, { relist: (hm) => b.live.map((x) => (x.pid === hm.pid ? { ...x, status: 'busy' } : x)) });
  assert.deepEqual([bb.units, bb.spawned, bb.stopped], [[], [], []]);
  assert.ok(bb.r.lines.some((l) => /^Stale: host-manager runs the delivery plugin 1\.1\.0 and 1\.2\.0 is installed; not restarted: it became busy just before the stop\.$/.test(l)), bb.r.lines.join('\n'));
  // busy on the first read: held, named
  const c = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(c);
  const cc = pass(c, { status: 'busy' });
  assert.deepEqual([cc.units, cc.spawned, cc.stopped], [[], [], []]);
  assert.ok(cc.r.lines.some((l) => /^Stale: host-manager .*; held: it is busy; it is restarted only when idle between turns\.$/.test(l)), cc.r.lines.join('\n'));
  // on the installed plugin: not a restart target at all
  const d = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(d);
  const dd = pass(d, { version: '1.2.0' });
  assert.deepEqual([dd.units, dd.spawned, dd.stopped], [[], [], []]);
  assert.ok(!dd.r.lines.some((l) => /host-manager/.test(l)), dd.r.lines.join('\n'));
  // no unit installed: named, nothing stopped or spawned in its place
  const e = machine({ alphaRoles: HM_ROLES });
  const ee = pass(e);
  assert.deepEqual([ee.units, ee.spawned, ee.stopped], [[], [], []]);
  assert.ok(ee.r.lines.some((l) => /^Stale: host-manager .*; not restarted: its unit delivery-host-manager\.service is not installed on this host/.test(l)), ee.r.lines.join('\n'));
  // a unit the plugin did not write on its directory: named with its fix, and no unit is restarted
  const g = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(g);
  roleUnit(g, g.alpha.dir('host-manager'), 'my-hm.service', '/opt/tools/bin/claude remote-control --name host-manager@pc');
  const gg = pass(g);
  assert.deepEqual([gg.units, gg.spawned, gg.stopped], [[], [], []]);
  assert.ok(gg.r.lines.some((l) => /^Stale: host-manager .*; not restarted: served by my-hm\.service, which the plugin did not write; not restarted: stop and disable my-hm\.service/.test(l)), gg.r.lines.join('\n'));
  // a host manager that is down is never started by a start pass: its unit is its start path
  const f = machine({ alphaRoles: HM_ROLES, beads: WORK });
  hostManagerUnit(f);
  const spawned = [];
  TR.revive(f.alpha.root, f.alpha.team, { start: true, cwd: f.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: f.home, live: [], relist: () => [], restartUnit: () => { throw new Error('no unit restart'); }, spawn: (bin, args, o) => { spawned.push(o.cwd); return 1; }, systemdRun: null, ...f.deps().teamDeps(f.alpha.root) });
  assert.ok(!spawned.includes(f.alpha.dir('host-manager')), spawned.join('\n'));
});

// A unit restart that did not take (run-session found the old session still live and exited 3, so the same
// session runs on) is not a restart onto the installed plugin: the next pass, after the hourly cap, tries
// again. One that took (a new session came up, still recording the older version) is held as before.
test('a host manager\'s unit restart that left the same old session running is tried again after the cap; one that brought a new session is held', () => {
  const TR = require('./team-revive.js');
  const m = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(m);
  const hm = runningRole(m, m.alpha, 'host-manager', { pid: 90, version: '1.1.0' });
  const units = [];
  const pass = () => TR.revive(m.alpha.root, m.alpha.team, { start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: m.live, relist: () => m.live, restartUnit: (u) => units.push(u), spawn: () => { throw new Error('no spawn'); }, stop: () => { throw new Error('no stop'); }, systemdRun: null, ...m.deps().teamDeps(m.alpha.root) });
  pass();
  assert.deepEqual(units, [HM.UNIT]);
  // the restart did not take: the same session, seen again since, still on 1.1.0
  m.now = iso(Date.parse(T0) + 61 * MIN);
  require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'host-manager', session_id: hm.sessionId, host: 'pc', role_dir: hm.dir, now: iso(Date.parse(T0) + 30 * MIN), plugin_version: '1.1.0' });
  const again = pass();
  assert.deepEqual(units, [HM.UNIT, HM.UNIT], again.lines.join('\n'));
  // within the hour after that, the cap holds it
  m.now = iso(Date.parse(T0) + 70 * MIN);
  const capped = pass();
  assert.equal(units.length, 2);
  assert.ok(capped.lines.some((l) => /^Stale: host-manager .*; held: started .* \(one start an hour\)\.$/.test(l)), capped.lines.join('\n'));
  // the restart took: a new session came up, and it still records 1.1.0: not tried again
  m.live = [{ cwd: hm.dir, sessionId: 'hm-new', pid: 91, status: 'idle' }];
  require('./lib/roster.js').registerInstance(m.alpha.root, { instance: 'host-manager', session_id: 'hm-new', host: 'pc', role_dir: hm.dir, now: iso(Date.parse(T0) + 75 * MIN), plugin_version: '1.1.0' });
  m.now = iso(Date.parse(T0) + 200 * MIN);
  const took = pass();
  assert.equal(units.length, 2, took.lines.join('\n'));
  assert.ok(took.lines.some((l) => /^Stale: host-manager .*; held: restarted .* onto 1\.2\.0, and its session still records 1\.1\.0; not tried again\.$/.test(l)), took.lines.join('\n'));
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'restart').map((x) => x.from_session), [hm.sessionId, hm.sessionId]);
});

// A unit restart whose unit is not active after the settle window (its session exited within seconds, as
// run-session's exit 3 did on a real host) is a failed start: a `failed` row names it, the hourly cap does
// not hold the next try, and the daily cap still counts it, so a crash loop stays bounded. One whose unit
// stayed up is held for the hour as before. The same rule as a spawned start that exits within SETTLE_MS.
test('a host manager unit restart whose unit is down after the settle is retried at the next pass, not held for the hour; one that stayed up is held; the daily cap still bounds it', () => {
  const TR = require('./team-revive.js');
  const m = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(m);
  runningRole(m, m.alpha, 'host-manager', { pid: 90, version: '1.1.0' });
  const units = [];
  let up = false;
  const settled = [];
  const pass = () => TR.revive(m.alpha.root, m.alpha.team, { start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: m.live, relist: () => m.live, restartUnit: (u) => units.push(u), unitSettle: (u) => { settled.push(u); return up; }, spawn: () => { throw new Error('no spawn'); }, stop: () => { throw new Error('no stop'); }, systemdRun: null, ...m.deps().teamDeps(m.alpha.root) });
  const at = (min) => { m.now = iso(Date.parse(T0) + min * MIN); };
  const first = pass();
  assert.deepEqual([units, settled], [[HM.UNIT], [HM.UNIT]]);
  const fail = R.ledger(m.alpha.root).filter((x) => x.type === 'failed');
  assert.deepEqual(fail.map((x) => [x.instance, x.unit, x.start_at]), [['host-manager', HM.UNIT, T0]]);
  assert.ok(first.lines.some((l) => /^Stale: host-manager .*; not restarted: its unit delivery-host-manager\.service was not active 60s after the restart/.test(l)), first.lines.join('\n'));
  // five minutes later: tried again, not held for the hour
  at(5);
  pass();
  assert.equal(units.length, 2);
  // this one stays up: the next pass within the hour is held as before
  up = true;
  at(10);
  pass();
  assert.equal(units.length, 3);
  at(15);
  const held = pass();
  assert.equal(units.length, 3);
  assert.ok(held.lines.some((l) => /^Stale: host-manager .*; held: started .* \(one start an hour\)\.$/.test(l)), held.lines.join('\n'));
  // a crash loop: every failed restart still counts against the daily cap
  const n = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(n);
  runningRole(n, n.alpha, 'host-manager', { pid: 90, version: '1.1.0' });
  const nu = [];
  for (let k = 0; k < 8; k++) {
    n.now = iso(Date.parse(T0) + k * 5 * MIN);
    TR.revive(n.alpha.root, n.alpha.team, { start: true, cwd: n.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: n.home, live: n.live, relist: () => n.live, restartUnit: (u) => nu.push(u), unitSettle: () => false, spawn: () => { throw new Error('no spawn'); }, systemdRun: null, ...n.deps().teamDeps(n.alpha.root) });
  }
  assert.equal(nu.length, R.DAILY_CAP, 'bounded by the daily cap');
});

test('a missing role started through the plugin\'s own unit whose unit is down after the settle is a failed start, retried at the next pass; one that stayed up holds the hour', () => {
  const TR = require('./team-revive.js');
  const m = machine({ beads: WORK });
  const unit = `delivery-role-chief-of-staff-${tag(m.alpha.root)}.service`;
  roleUnit(m, m.alpha.dir('chief-of-staff'), unit, `/usr/bin/env "node" "${path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')}" "host-manager.js" "run-session" "--project" "${m.alpha.root}" "--instance" "chief-of-staff"`);
  const starts = [];
  let up = false;
  const pass = () => TR.revive(m.alpha.root, m.alpha.team, { start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: [], relist: () => [], only: ['chief-of-staff'], startUnit: (u) => starts.push(u), unitSettle: () => up, spawn: () => { throw new Error('no spawn'); }, settle: null, systemdRun: null, ...m.deps().teamDeps(m.alpha.root) });
  const first = pass();
  assert.deepEqual(starts, [unit]);
  assert.deepEqual(R.ledger(m.alpha.root).filter((x) => x.type === 'failed').map((x) => [x.instance, x.unit, x.start_at]), [['chief-of-staff', unit, T0]]);
  assert.ok(first.lines.some((l) => l.startsWith(`Failed: chief-of-staff through its user unit ${unit}: its unit ${unit} was not active 60s after the start`)), first.lines.join('\n'));
  m.now = iso(Date.parse(T0) + 5 * MIN);
  pass();
  assert.equal(starts.length, 2, 'retried at the next pass');
  up = true;
  m.now = iso(Date.parse(T0) + 10 * MIN);
  pass();
  assert.equal(starts.length, 3);
  m.now = iso(Date.parse(T0) + 15 * MIN);
  pass();
  assert.equal(starts.length, 3, 'a start that stayed up holds the hour');
});

test('the unit settle check waits the settle window, then reads systemctl --user is-active: active is up, inactive, failed or activating is down, an unknown answer is not judged', () => {
  const TR = require('./team-revive.js');
  for (const [state, want] of [['active', true], ['inactive', false], ['failed', false], ['activating', false], ['', null]]) {
    const calls = [];
    const sleeps = [];
    const check = TR.unitSettleOf((cmd, args) => { calls.push([cmd, ...args].join(' ')); if (state === 'active') return 'active\n'; const e = new Error('Command failed'); e.stdout = `${state}\n`; throw e; }, (ms) => sleeps.push(ms));
    assert.equal(check(HM.UNIT), want, state);
    assert.deepEqual(sleeps, [R.SETTLE_MS]);
    assert.deepEqual(calls, [`systemctl --user is-active ${HM.UNIT}`]);
  }
});

// The two real callers wire the settle check in: the owner's restart (host-manager.js restart) and the
// watchdog's start pass (watchdog.js defaultRevive). Each restarts an older host manager through its unit,
// the unit is down when the settle reads it, and a 'failed' row names the restart; the wait is the caller's
// injected sleep, never a real 60 s one.
const hmUnitDiesOnRestart = () => {
  const m = machine({ alphaRoles: HM_ROLES });
  hostManagerUnit(m);
  runningRole(m, m.alpha, 'host-manager', { pid: 90, version: '1.1.0' });
  // the restarted unit's session exits at once: is-active answers inactive after the restart
  m.sd.onRestart = (unit) => { if (unit === HM.UNIT) m.sd.units[HM.UNIT].ActiveState = 'inactive'; };
  return m;
};
const failedRows = (m) => R.ledger(m.alpha.root).filter((x) => x.type === 'failed').map((x) => [x.instance, x.unit, x.via]);

// A start pass with unit settles runs for minutes (each settle waits SETTLE_MS): two units started through
// their own unit settle for over two minutes, past what the start lock once allowed. The pass keeps its
// lock all the same: a second pass started during the second settle finds it held and starts nothing.
test('a start pass whose unit settles run past the old two-minute lock limit keeps its start lock: a second pass started during it is refused as held', () => {
  const TR = require('./team-revive.js');
  const m = machine({ beads: WORK });
  const ownUnit = (i) => `delivery-role-${i}-${tag(m.alpha.root)}.service`;
  for (const i of ['chief-of-staff', 'builder']) roleUnit(m, m.alpha.dir(i), ownUnit(i), `/usr/bin/env "node" "${path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')}" "host-manager.js" "run-session" "--project" "${m.alpha.root}" "--instance" "${i}"`);
  const t0 = Date.now();
  let t = t0;
  const clock = () => t;
  const starts = [];
  let reads = 0;
  let inner = null;
  const opts = () => ({ start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: [], relist: () => [], only: ['chief-of-staff', 'builder'], startUnit: (u) => starts.push(u), unitSettle, clock, spawn: () => { throw new Error('no spawn'); }, settle: null, systemdRun: null, ...m.deps().teamDeps(m.alpha.root) });
  // each settle waits the window and a second for its read, on the injected clock; the second settle's
  // read is when another pass starts
  const unitSettle = TR.unitSettleOf(() => { reads++; if (reads === 2) inner = TR.revive(m.alpha.root, m.alpha.team, opts()); return 'active\n'; }, (ms) => { t += ms + 1000; });
  const outer = TR.revive(m.alpha.root, m.alpha.team, opts());
  assert.equal(reads, 2);
  assert.ok(t - t0 > 2 * 60e3, `the pass ran ${t - t0} ms`);
  assert.deepEqual(starts.length, 2, 'only the first pass started the units');
  assert.ok(inner, 'a second pass ran during the second settle');
  assert.deepEqual(inner.started, {});
  assert.match(inner.lines.join('\n'), new RegExp(`another start pass holds the start lock \\(pid ${process.pid}\\b`));
  assert.deepEqual(Object.keys(outer.started).sort(), ['builder', 'chief-of-staff']);
  assert.equal(fs.existsSync(R.lockFile(m.alpha.root)), false, 'released after the pass');
});

test('the owner\'s restart settles its host manager unit restart: a unit inactive after the settle window is a failed start', () => {
  const m = hmUnitDiesOnRestart();
  m.run(['restart']);
  assert.ok(m.sd.calls.includes(`systemctl --user restart ${HM.UNIT}`), m.sd.calls.join('\n'));
  assert.ok(m.sd.calls.includes(`systemctl --user is-active ${HM.UNIT}`), m.sd.calls.join('\n'));
  assert.ok(m.sleeps.includes(R.SETTLE_MS), `the restart's own sleep waits the settle: ${m.sleeps.join(', ')}`);
  assert.deepEqual(failedRows(m), [['host-manager', HM.UNIT, 'unit']]);
});

test('the watchdog\'s start pass settles its host manager unit restart through its injected sleep: a unit inactive after the settle window is a failed start', () => {
  const m = hmUnitDiesOnRestart();
  const sleeps = [];
  const lines = watchdog.defaultRevive(m.alpha.root, {
    team: m.alpha.team, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, now: m.now, bd: store([]), live: m.live, exec: m.sd.exec,
    sleep: (ms) => sleeps.push(ms), relist: () => m.live,
    deps: { home: m.home, spawn: () => { throw new Error('no spawn'); }, stop: () => { throw new Error('no stop'); }, systemdRun: null, sdFetch: m.dir.fetch, ...m.deps().teamDeps(m.alpha.root) },
  });
  assert.ok(m.sd.calls.includes(`systemctl --user restart ${HM.UNIT}`), `${m.sd.calls.join('\n')}\n${lines.join('\n')}`);
  assert.deepEqual(sleeps, [R.SETTLE_MS]);
  assert.deepEqual(failedRows(m), [['host-manager', HM.UNIT, 'unit']]);
  assert.ok(lines.some((l) => /was not active 60s after the restart/.test(l)), lines.join('\n'));
});

test('a role served by a user unit that is down is never started in a scope: the reply names its unit', () => {
  const m = machine({ beads: WORK });
  roleUnit(m, m.alpha.dir('builder'), 'claude-alpha-builder.service');
  const r = m.run(['restart']);
  assert.ok(!m.spawned.some((s) => s.cwd === m.alpha.dir('builder')), 'not spawned');
  assert.ok(m.spawned.some((s) => s.cwd === m.alpha.dir('chief-of-staff')), 'a role with no unit still starts');
  assert.match(r.out, /^Not back: alpha builder \(not started: it is served by the user unit claude-alpha-builder\.service, which is its start path, so no scope is started beside it; the plugin does not start a unit it did not write: start that unit, or replace it with the plugin's own\)\.$/m, r.out);
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
  // the session unit's ExecStart goes through that launcher, which replaces itself with run-session, which
  // replaces itself with claude: the unit's main process is the session (lib/launcher.test.js runs it)
  assert.match(fs.readFileSync(path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js'), 'utf8'), /^if \(typeof process\.execve === 'function'\) process\.execve\(process\.execPath, \[process\.execPath, script, \.\.\.process\.argv\.slice\(3\)\], process\.env\);$/m);
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

// A host-manager session whose `claude remote-control` server runs outside the unit's cgroup (started by
// hand, or left behind by a unit whose main process was not claude) is replaced when the unit starts: its
// server stopped through team-revive's stopServer once a fresh read finds it idle, then the unit's own
// session. Busy, unreadable, or inside the unit: exit 3, nothing changed.
test('run-session replaces an idle host-manager session running outside its unit; busy, unreadable or inside the unit, it exits 3 and changes nothing', () => {
  const env = { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', DELIVERY_ROLE: 'host-manager' };
  const UNIT_CG = `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${HM.UNIT}\n`;
  const OTHER_CG = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-term-1.scope\n';
  const setup = ({ status = 'idle', again, serverCg = OTHER_CG, selfCg = UNIT_CG, server = { pid: 3531014, self: false }, stopOk = true, handUnit = false, mainPid = 'unread', show, dir } = {}) => {
    const m = machine({ alphaRoles: HM_ROLES });
    if (dir) m.dir = dir;
    m.env = { ...env, CLAUDE_CONFIG_DIR: m.config };
    if (handUnit) roleUnit(m, m.alpha.dir('host-manager'), 'claude-rc-hm.service', '/opt/tools/bin/claude remote-control --name host-manager@pc');
    const old = { sessionId: 'hm-old', pid: 3531100, cwd: m.alpha.dir('host-manager'), name: 'host-manager@pc', status };
    const reads = [[old], again === undefined ? [old] : again];
    let k = 0;
    const calls = { execve: [], stop: [], reads: 0, cgroup: [], show: 0 };
    // the unit's MainPID, read through systemctl show -p MainPID --value; 'unread': the read fails
    const exec = (cmd, args) => { if (cmd === 'systemctl' && args.includes('MainPID')) { calls.show++; if (show) return show; if (mainPid === 'unread') throw new Error('Failed to connect to bus'); return `${mainPid}\n`; } return m.sd.exec(cmd, args); };
    const r = m.run(['run-session', '--project', m.alpha.root, '--instance', 'host-manager'], {
      env: m.env, who: { roleId: 'host-manager' }, resolveBin: (b) => `/opt/bin/${b}`, now: T0,
      live: () => { calls.reads++; return reads[Math.min(k++, reads.length - 1)]; },
      execve: (file, argv) => calls.execve.push({ file, argv }),
      server: (pid) => (pid === old.pid ? server : null),
      cgroupOf: (pid) => { calls.cgroup.push(pid); return pid === 'self' ? selfCg : pid === (server && server.pid) ? serverCg : null; },
      stop: (srv, pid) => { calls.stop.push([srv, pid]); return stopOk; },
      exec,
    });
    return { m, r, calls, old };
  };
  // outside and idle on the fresh read: its server stopped through stopServer, then the unit's session
  const a = setup();
  assert.equal(a.r.code, 0, a.r.out);
  assert.deepEqual(a.calls.stop, [[3531014, 3531100]]);
  assert.equal(a.calls.reads, 2, 'a fresh second read before the stop');
  assert.equal(a.calls.execve.length, 1);
  assert.equal(a.calls.execve[0].file, '/opt/bin/claude');
  assert.deepEqual(a.calls.execve[0].argv.slice(0, 4), ['claude', 'remote-control', '--name', 'host-manager@pc']);
  assert.deepEqual(R.ledger(a.m.alpha.root).filter((x) => x.type === 'host-manager-replaced').map((x) => [x.server, x.pid, x.session]), [[3531014, 3531100, 'hm-old']]);
  assert.equal(R.ledger(a.m.alpha.root).filter((x) => x.type === 'host-manager-session').length, 1);
  assert.match(a.r.out, /replaced the host-manager session hm-old, whose Remote Control server \(pid 3531014\) ran in no unit/);
  // outside but busy, on the first read or the fresh one; or the fresh read unreadable: exit 3, nothing changed
  for (const [label, o] of [['busy', { status: 'busy' }], ['busy on the fresh read', { again: [{ sessionId: 'hm-old', pid: 3531100, status: 'busy' }] }], ['fresh read unreadable', { again: null }]]) {
    const b = setup(o);
    assert.equal(b.r.code, 3, `${label}: ${b.r.out}`);
    assert.deepEqual([b.calls.stop, b.calls.execve], [[], []], label);
    assert.deepEqual(R.ledger(b.m.alpha.root).filter((x) => /^host-manager-/.test(x.type)), [], label);
  }
  // its server inside the unit, its cgroup unreadable, no Remote Control server, or run-session itself not in the unit: exit 3
  for (const [label, o] of [['inside the unit, its MainPID', { serverCg: UNIT_CG, mainPid: 3531014 }], ['inside the unit, MainPID unreadable', { serverCg: UNIT_CG }], ['inside the unit, MainPID not a number', { serverCg: UNIT_CG, show: 'garbage\n' }], ['inside the unit, MainPID empty', { serverCg: UNIT_CG, show: ' \n' }], ['server cgroup unreadable', { serverCg: null }], ['no server', { server: null }], ['ps unreadable', { server: { unreadable: 'ps failed' } }], ['not run by the unit', { selfCg: OTHER_CG }]]) {
    const c = setup(o);
    assert.equal(c.r.code, 3, `${label}: ${c.r.out}`);
    assert.match(c.r.out, /already runs as host-manager@pc/, label);
    assert.deepEqual([c.calls.stop, c.calls.execve], [[], []], label);
  }
  // a server in any other .service is a unit's (one the plugin did not write, say): never stopped, exit 3.
  // A unit the plugin did not write that serves the host manager's directory holds it too, wherever the
  // server runs. The user manager's own user@<uid>.service above the scopes is no unit of a server's.
  for (const [label, o] of [['in a hand-written unit', { serverCg: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/claude-rc-x.service\n' }], ['in a unit, v1 lines', { serverCg: '12:pids:/user.slice/user-1000.slice/user@1000.service/claude-rc-x.service\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/claude-rc-x.service\n' }], ['a hand-written unit serves its directory', { handUnit: true }]]) {
    const c = setup(o);
    assert.equal(c.r.code, 3, `${label}: ${c.r.out}`);
    assert.deepEqual([c.calls.stop, c.calls.execve], [[], []], label);
  }
  // a server in a scope (a role scope, a terminal's) or a login session's scope is in no unit: replaced, idle only
  for (const cg of ['0::/user.slice/user-1000.slice/user@1000.service/app.slice/delivery-role-host-manager-123.scope\n', '0::/user.slice/user-1000.slice/session-2.scope\n']) {
    const c = setup({ serverCg: cg });
    assert.equal(c.r.code, 0, `${cg}: ${c.r.out}`);
    assert.deepEqual(c.calls.stop, [[3531014, 3531100]], cg);
    const busy = setup({ serverCg: cg, status: 'busy' });
    assert.equal(busy.r.code, 3, busy.r.out);
    assert.deepEqual(busy.calls.stop, [], cg);
  }
  // a leftover: a server in delivery-host-manager.service's cgroup that is not the unit's MainPID (the unit
  // stopped with KillMode=process and left it there, MainPID 0, or the unit's MainPID is another process)
  // is replaced exactly like one outside every unit: idle on a fresh read only, never beside a hand-written unit
  for (const mp of [0, 4242]) {
    const l = setup({ serverCg: UNIT_CG, mainPid: mp });
    assert.equal(l.r.code, 0, `MainPID ${mp}: ${l.r.out}`);
    assert.deepEqual(l.calls.stop, [[3531014, 3531100]], `MainPID ${mp}`);
    assert.equal(l.calls.show, 1);
    assert.equal(l.calls.execve.length, 1);
    assert.deepEqual(R.ledger(l.m.alpha.root).filter((x) => x.type === 'host-manager-replaced').map((x) => [x.server, x.leftover]), [[3531014, true]]);
    assert.match(l.r.out, /ran in delivery-host-manager\.service's cgroup as a leftover, not its main process/);
    for (const [label, o] of [['busy', { status: 'busy' }], ['busy on the fresh read', { again: [{ sessionId: 'hm-old', pid: 3531100, status: 'busy' }] }], ['a hand-written unit on its directory', { handUnit: true }]]) {
      const b = setup({ serverCg: UNIT_CG, mainPid: mp, ...o });
      assert.equal(b.r.code, 3, `${label}, MainPID ${mp}: ${b.r.out}`);
      assert.deepEqual([b.calls.stop, b.calls.execve], [[], []], label);
    }
  }
  // a server in the unit's cgroup and in another service too is not a leftover of this unit alone
  const two = setup({ serverCg: `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${HM.UNIT}/claude-rc-x.service\n`, mainPid: 0 });
  assert.equal(two.r.code, 3, two.r.out);
  assert.deepEqual(two.calls.stop, []);
  // the replace stops a running session, so the unit's directory entry is read first: unreachable, or
  // owned by another, nothing is stopped (exit 3, the reason in the reply); its own entry, it goes ahead
  const unreach = setup({ dir: fakeDirectory({ down: true }) });
  assert.equal(unreach.r.code, 3, unreach.r.out);
  assert.deepEqual([unreach.calls.stop, unreach.calls.execve], [[], []]);
  assert.match(unreach.r.out, /It is not replaced: the service directory at http:\/\/127\.0\.0\.1:8085 could not be reached .*a replace of a running unit is not made/);
  const other = setup({ dir: fakeDirectory({ entries: [{ ...SD.entryFor(HM.UNIT), owner: 'colombod' }] }) });
  assert.equal(other.r.code, 3, other.r.out);
  assert.deepEqual(other.calls.stop, []);
  assert.match(other.r.out, /not by the delivery plugin, so the plugin does not replace it/);
  const listed = setup({ dir: fakeDirectory({ entries: [SD.entryFor(HM.UNIT)] }) });
  assert.equal(listed.r.code, 0, listed.r.out);
  assert.deepEqual(listed.calls.stop, [[3531014, 3531100]]);
  // a server that does not stop: no session is started beside it
  const d = setup({ stopOk: false });
  assert.equal(d.r.code, 1, d.r.out);
  assert.deepEqual(d.calls.execve, []);
  assert.match(d.r.out, /did not stop; no session started/);
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

test('the watchdog\'s start check reads the host manager unit\'s directory entry before the start: its own is started, another owner\'s is refused; unreachable, the down unit is started with a row and a warning, and registered on the next pass', () => {
  const env = { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_ID: '', DELIVERY_ROLE_DIR: '' };
  const check = (dir) => {
    const m = machine();
    fs.writeFileSync(path.join(HM.unitDir(m.home), HM.UNIT), '[Service]\nExecStart=/usr/bin/env node /x/delivery.js host-manager.js run-session\n');
    m.sd.units[HM.UNIT] = loaded(false);
    const out = watchdog.ensureHostManager(m.alpha.root, { home: m.home, exec: m.sd.exec, now: T0, live: [], env, sdFetch: dir.fetch });
    return { m, out, started: m.sd.calls.includes(`systemctl --user start ${HM.UNIT}`) };
  };
  const own = check(fakeDirectory({ entries: [SD.entryFor(HM.UNIT)] }));
  assert.ok(own.started, own.out);
  const other = check(fakeDirectory({ entries: [{ ...SD.entryFor(HM.UNIT), owner: 'colombod' }] }));
  assert.ok(!other.started);
  assert.match(other.out, /^host manager: delivery-host-manager\.service is inactive and is not started: the service directory lists delivery-host-manager\.service as owned by "colombod"/);
  assert.deepEqual(R.ledger(other.m.alpha.root).filter((x) => x.type === 'host-manager-start'), [], 'no start row');
  const down = fakeDirectory({ down: true });
  const u = check(down);
  assert.ok(u.started, u.out);
  assert.deepEqual(R.ledger(u.m.alpha.root).filter((x) => x.type === 'directory-unreachable').map((x) => [x.unit, x.action]), [[HM.UNIT, 'start']]);
  assert.deepEqual(require('./lib/warnings.js').list(u.m.alpha.root).map((w) => w.kind), ['service-directory-unreachable']);
  down.down = false;
  watchdog.directoryPass(u.m.alpha.root, { home: u.m.home, exec: u.m.sd.exec, sdFetch: down.fetch });
  assert.equal(down.entry(HM.UNIT).owner, 'delivery plugin');
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
  const deps = { cwd: m.alpha.root, env, now: T0, live: [], bd: store([]), spawn: () => 1, sweep: () => ({ removed: [], failed: [] }), userGuard: () => null, update: { configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'no-install-')) }, revive: () => [], home: m.home, hostUnit: { exec: m.sd.exec, home: m.home, has: () => true, sdFetch: m.dir.fetch } };
  const r = watchdog.main(['run', '--project', m.alpha.root], deps);
  // each unit it wrote is registered with the service directory, read again before the start
  for (const u of [HM.UNIT, HM.TICK_SERVICE, HM.TICK_TIMER]) assert.equal((m.dir.entry(u) || {}).owner, 'delivery plugin', u);
  assert.match(r.out, /host manager: installed its units \(.*delivery-host-manager\.service/, r.out);
  assert.ok(fs.existsSync(svc), r.out);
  for (const f of [HM.TICK_SERVICE, HM.TICK_TIMER]) assert.ok(fs.existsSync(path.join(HM.unitDir(m.home), f)), f);
  // the same commands host-manager.js install runs, then the start check
  // (the is-active reads before each start, and the directory pass's reads, are left out)
  const sys = m.sd.calls.filter((c) => c.startsWith('systemctl') && !/ is-active | list-units /.test(c));
  assert.deepEqual(sys, ['systemctl --user daemon-reload', `systemctl --user enable --now ${HM.UNIT}`, `systemctl --user enable --now ${HM.TICK_TIMER}`, `systemctl --user start ${HM.UNIT}`]);
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

// the forced restart is the owner's alone; another agent's request gets the tick's rule
test('restart --down-only follows the tick\'s rule: no running role is stopped and no host job restarted; a down role holding work is started', () => {
  const m = machine({ beads: WORK });
  runningRole(m, m.alpha, 'chief-of-staff', { pid: 71 });
  // the builder holds work and is down
  const r = m.run(['restart', '--down-only']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(m.stops, [], 'a running role is never stopped');
  assert.ok(!m.sd.calls.some((c) => /--user restart delivery-watchdog-/.test(c)), m.sd.calls.join('\n'));
  assert.deepEqual(m.spawned.map((s) => path.basename(s.cwd)), ['builder']);
  assert.doesNotMatch(r.out, /^Installed delivery plugin:/m, 'the forced reply is the owner restart\'s');
  // the same machine state, the owner's restart: the running role holding work is restarted
  const o = machine({ beads: WORK });
  runningRole(o, o.alpha, 'chief-of-staff', { pid: 71 });
  assert.equal(o.run(['restart']).code, 0);
  assert.equal(o.stops.length, 1, 'the owner restart stops and starts the running role holding work');
  assert.equal(m.run(['restart', '--everything']).code, 2, 'an unknown option is refused');
});

// ---- the Chief of Staff's own unit (hjx.1.6.10.1.2.1) ----

const SL = require('./lib/service-limits.js');
const cosMarker = (m, root = m.alpha.root, dir = m.alpha.dir('chief-of-staff')) => fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ role: 'chief-of-staff', instance: 'chief-of-staff', project_root: root }));
const cosUnit = (m) => `delivery-role-chief-of-staff-${tag(m.alpha.root)}.service`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every unit the plugin writes is registered with the owner's service directory when it is written; a
// directory that cannot be reached never fails the install: the units go in, a line says they were not
// registered, and the next pass registers them.
test('install and install-role register each unit they write with the service directory; unreachable, the install still goes ahead, says so, and the next pass registers them', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  const r = m.run(['install', '--project', m.alpha.root]);
  assert.equal(r.code, 0, r.out);
  for (const u of [HM.UNIT, HM.TICK_SERVICE, HM.TICK_TIMER]) {
    const e = m.dir.entry(u);
    assert.ok(e, u);
    assert.deepEqual([e.owner, e.url, e.category, e.ttl], ['delivery plugin', `systemd-user://${u}`, 'delivery', 3600], u);
  }
  assert.match(r.out, /^Registered with the service directory: delivery-host-manager\.service, delivery-host-manager-tick\.service, delivery-host-manager-tick\.timer$/m, r.out);
  assert.ok(m.sd.calls.includes(`systemctl --user enable --now ${HM.UNIT}`), 'started at once');
  cosMarker(m);
  const role = m.run(['install-role', '--project', m.alpha.root]);
  assert.equal(role.code, 0, role.out);
  assert.equal(m.dir.entry(cosUnit(m)).owner, 'delivery plugin');
  // the directory down: the units are written and enabled, and started (they are down, so the start goes
  // ahead with a row and a warning), and the reply says they are not registered
  const n = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  n.dir = fakeDirectory({ down: true });
  const d = n.run(['install', '--project', n.alpha.root]);
  assert.equal(d.code, 0, d.out);
  assert.ok(fs.existsSync(path.join(HM.unitDir(n.home), HM.UNIT)));
  assert.ok(n.sd.calls.includes(`systemctl --user enable --now ${HM.UNIT}`), n.sd.calls.join('\n'));
  assert.match(d.out, /^Not registered with the service directory: .*could not be reached.*; the watchdog's next pass registers them$/m, d.out);
  assert.deepEqual(R.ledger(n.alpha.root).filter((x) => x.type === 'directory-unreachable').map((x) => x.unit), [HM.UNIT, HM.TICK_TIMER]);
  assert.ok(require('./lib/warnings.js').list(n.alpha.root).some((w) => w.kind === 'service-directory-unreachable'));
  // the directory back: the next pass registers all three
  n.dir.down = false;
  const line = watchdog.directoryPass(n.alpha.root, { home: n.home, exec: n.sd.exec, sdFetch: n.dir.fetch });
  assert.match(line, /^service directory: registered delivery-host-manager-tick\.service, delivery-host-manager-tick\.timer, delivery-host-manager\.service, delivery-watchdog-[0-9a-f]+\.service$/, line);
  for (const u of [HM.UNIT, HM.TICK_SERVICE, HM.TICK_TIMER]) assert.ok(n.dir.entry(u), u);
});

// POST upserts by name: an install reads the directory first and never posts a name another owner holds
test('an install registers a free name and never posts one another owner holds: that entry is left unchanged and the reply names it', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  m.dir = fakeDirectory({ entries: [{ name: HM.UNIT, url: 'systemd-user://owners-own', owner: 'colombod' }] });
  const r = m.run(['install', '--project', m.alpha.root]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([m.dir.entry(HM.UNIT).owner, m.dir.entry(HM.UNIT).url], ['colombod', 'systemd-user://owners-own'], 'the owner\'s entry is unchanged');
  assert.equal(m.dir.calls.filter((c) => c === 'POST /api/services').length, 2, 'only the two free names are posted');
  assert.match(r.out, /^Registered with the service directory: delivery-host-manager-tick\.service, delivery-host-manager-tick\.timer$/m, r.out);
  assert.match(r.out, /^Not registered with the service directory, held by another owner: delivery-host-manager\.service \(the service directory lists delivery-host-manager\.service as owned by "colombod", not by the delivery plugin, so the plugin leaves that entry as it is\)$/m, r.out);
  assert.ok(!(HM.UNIT in m.dir.names()), 'not on the plugin\'s list');
  // and its start is refused, so it is enabled only
  assert.match(r.out, /Not started now: the service directory lists delivery-host-manager\.service as owned by "colombod".*; delivery-host-manager\.service is enabled only\./, r.out);
  // install-role the same: the Chief of Staff's unit held by the owner is not posted
  cosMarker(m);
  m.dir.entries.push({ name: cosUnit(m), url: 'systemd-user://x', owner: 'colombod' });
  const before = m.dir.calls.filter((c) => c === 'POST /api/services').length;
  const role = m.run(['install-role', '--project', m.alpha.root]);
  assert.equal(role.code, 0, role.out);
  assert.equal(m.dir.calls.filter((c) => c === 'POST /api/services').length, before, 'no POST for it');
  assert.equal(m.dir.entry(cosUnit(m)).owner, 'colombod');
  assert.match(role.out, new RegExp(`^Not registered with the service directory, held by another owner: ${esc(cosUnit(m))} `, 'm'), role.out);
});

// The host jobs' units are the plugin's (watchdog.js jobFiles): host-manager.js restart and the tick read
// each one's entry in the service directory before a start or restart, as for every other plugin unit;
// a refused one is named and the rest of the restart goes ahead.
test('the owner\'s restart reads each host job unit\'s directory entry first: a free one is restarted; one another owner holds, or one the plugin registered that someone removed, is not, is named, and the rest goes ahead', () => {
  const m = machine({ beads: WORK });
  const a = tag(m.alpha.root);
  const b = tag(m.beta.root);
  const SC = 'systemctl --user';
  m.sd.units[`delivery-watchdog-${a}.timer`] = loaded(true);
  m.dir.entries.push({ name: `delivery-watchdog-${a}.timer`, url: 'http://x', owner: 'colombod' });
  const r = m.run(['restart']);
  assert.equal(r.code, 0, r.out);
  assert.ok(!m.sd.calls.includes(`${SC} restart delivery-watchdog-${a}.timer`), m.sd.calls.join('\n'));
  assert.ok(!m.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${a}.service`), 'no run of a job whose timer is refused');
  assert.equal(m.dir.entry(`delivery-watchdog-${a}.timer`).owner, 'colombod', 'left as it is');
  assert.match(r.out, new RegExp(`^Not restarted: alpha's host job: delivery-watchdog-${a}\\.timer is not restarted: the service directory lists delivery-watchdog-${a}\\.timer as owned by "colombod", not by the delivery plugin, so the plugin does not restart it\\.$`, 'm'), r.out);
  // the rest goes ahead: beta's free job is registered, restarted and run once; the roles still come back
  assert.ok(m.sd.calls.includes(`${SC} restart delivery-watchdog-${b}.timer`), m.sd.calls.join('\n'));
  assert.ok(m.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${b}.service`));
  assert.equal(m.dir.entry(`delivery-watchdog-${b}.timer`).owner, 'delivery plugin');
  assert.ok(m.spawned.length > 0, 'the team\'s start pass still runs');
  // an entry the plugin registered that someone removed: not registered again, not restarted, named
  const n = machine({ beads: WORK });
  const nb = tag(n.beta.root);
  SD.remember(`delivery-watchdog-${nb}.timer`, { fetch: n.dir.fetch });
  const rn = n.run(['restart']);
  assert.ok(!n.sd.calls.includes(`${SC} restart delivery-watchdog-${nb}.timer`), n.sd.calls.join('\n'));
  assert.equal(n.dir.entry(`delivery-watchdog-${nb}.timer`), null, 'not registered again');
  assert.match(rn.out, new RegExp(`^Not restarted: beta's host job: delivery-watchdog-${nb}\\.timer is not restarted: the entry the delivery plugin registered for delivery-watchdog-${nb}\\.timer was removed from the service directory`, 'm'), rn.out);
  assert.ok(n.sd.calls.includes(`${SC} restart delivery-watchdog-${tag(n.alpha.root)}.timer`), 'alpha\'s job is restarted');
  // its service held by another owner while its timer is the plugin's: the timer restarts, the run is refused and named
  const s2 = machine({ beads: WORK });
  const sa = tag(s2.alpha.root);
  s2.dir.entries.push({ name: `delivery-watchdog-${sa}.service`, url: 'http://x', owner: 'colombod' });
  const rs = s2.run(['restart']);
  assert.ok(s2.sd.calls.includes(`${SC} restart delivery-watchdog-${sa}.timer`));
  assert.ok(!s2.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${sa}.service`), s2.sd.calls.join('\n'));
  assert.match(rs.out, new RegExp(`^Not restarted: alpha's host job: its timer restarted, but delivery-watchdog-${sa}\\.service is not run: the service directory lists delivery-watchdog-${sa}\\.service as owned by "colombod"`, 'm'), rs.out);
});

test('restart --down-only and the tick read a host job unit\'s directory entry before starting it: a free down timer is started; one another owner holds is not, and is named', () => {
  const SC = 'systemctl --user';
  const free = machine();
  const a = tag(free.alpha.root);
  free.sd.units[`delivery-watchdog-${a}.timer`] = loaded(false, 'Sun 2026-11-08 09:00:00 UTC');
  free.run(['restart', '--down-only']);
  assert.ok(free.sd.calls.includes(`${SC} start delivery-watchdog-${a}.timer`), free.sd.calls.join('\n'));
  assert.equal(free.dir.entry(`delivery-watchdog-${a}.timer`).owner, 'delivery plugin');
  assert.ok(free.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${a}.service`), 'and one run of its service');
  // its timer the plugin's, its service held by another owner: the timer starts, the service is not run
  const svc = machine();
  const v = tag(svc.alpha.root);
  svc.sd.units[`delivery-watchdog-${v}.timer`] = loaded(false, 'Sun 2026-11-08 09:00:00 UTC');
  svc.dir.entries.push({ name: `delivery-watchdog-${v}.service`, url: 'http://x', owner: 'colombod' });
  svc.run(['restart', '--down-only']);
  assert.ok(svc.sd.calls.includes(`${SC} start delivery-watchdog-${v}.timer`), svc.sd.calls.join('\n'));
  assert.ok(!svc.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${v}.service`), svc.sd.calls.join('\n'));
  const held = machine();
  const h = tag(held.alpha.root);
  held.sd.units[`delivery-watchdog-${h}.timer`] = loaded(false, 'Sun 2026-11-08 09:00:00 UTC');
  held.dir.entries.push({ name: `delivery-watchdog-${h}.timer`, url: 'http://x', owner: 'colombod' });
  const r = held.run(['restart', '--down-only']);
  assert.ok(!held.sd.calls.some((c) => c.includes(`start delivery-watchdog-${h}.timer`) || c.includes(`start --no-block delivery-watchdog-${h}.service`)), held.sd.calls.join('\n'));
  assert.match(r.out, new RegExp(`^Not back: delivery-watchdog-${h}\\.timer \\(not started: the service directory lists delivery-watchdog-${h}\\.timer as owned by "colombod", not by the delivery plugin, so the plugin does not start it\\);`, 'm'), r.out);
  // the tick's one run of a silent job's service: refused the same way when another owner holds it
  const roles = [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }];
  const k = machine({ alphaRoles: roles });
  k.live = [{ cwd: k.alpha.dir('chief-of-staff') }, { cwd: k.beta.dir('chief-of-staff') }, { cwd: k.beta.dir('builder') }];
  const ka = tag(k.alpha.root);
  k.dir.entries.push({ name: `delivery-watchdog-${ka}.service`, url: 'http://x', owner: 'colombod' });
  const passes = { [k.alpha.root]: Date.parse(T0) - 40 * MIN, [k.beta.root]: Date.parse(T0) - 5 * MIN };
  const t = k.run(['tick'], { lastPass: (root) => passes[root] });
  assert.ok(!k.sd.calls.includes(`${SC} start --no-block delivery-watchdog-${ka}.service`), k.sd.calls.join('\n'));
  assert.match(t.out, new RegExp(`^Not back: alpha's host job, still silent: its timer runs but no pass since .*, and delivery-watchdog-${ka}\\.service was not started: the service directory lists delivery-watchdog-${ka}\\.service as owned by "colombod"`, 'm'), t.out);
});

// the watchdog's own install registers the job's units, which are the plugin's
test('watchdog.js install registers the job\'s service, timer and path units with the service directory, and not a name another owner holds', () => {
  const m = machine();
  const d = fakeDirectory();
  const t = watchdog.tagOf(m.alpha.root);
  d.entries.push({ name: `delivery-watchdog-${t}.path`, url: 'http://x', owner: 'colombod' });
  const r = watchdog.main(['install', '--apply', '--project', m.alpha.root], { cwd: m.alpha.root, env: { PATH: '/usr/bin', DELIVERY_HOST: 'pc' }, home: m.home, platform: 'linux', exec: m.sd.exec, has: () => true, live: [], hostUnit: { sdFetch: d.fetch } });
  assert.equal(r.code, 0, r.out);
  for (const x of ['service', 'timer']) assert.equal(d.entry(`delivery-watchdog-${t}.${x}`).owner, 'delivery plugin', x);
  assert.equal(d.entry(`delivery-watchdog-${t}.path`).owner, 'colombod', 'left as it is');
  assert.match(r.out, new RegExp(`^Registered with the service directory: delivery-watchdog-${t}\\.service, delivery-watchdog-${t}\\.timer$`, 'm'), r.out);
  assert.match(r.out, new RegExp(`^Not registered with the service directory, held by another owner: delivery-watchdog-${t}\\.path `, 'm'), r.out);
});

// Each pass keeps the directory current: an active plugin unit gets a heartbeat (the directory's health
// reads it, not a TCP probe), a unit with no entry is registered, an entry whose unit is gone is removed,
// an entry under another owner is left, and a directory that cannot be reached is said once.
test('the watchdog pass sends a heartbeat for each active plugin unit and scope, registers one missing, removes the entry of a unit gone, and leaves another owner\'s entry', () => {
  const m = machine({ alphaRoles: [{ id: 'chief-of-staff', host: 'pc' }, { id: 'host-manager', host: 'pc' }] });
  m.run(['install', '--project', m.alpha.root]);
  const scope = 'delivery-role-builder-1763287200000.scope';
  m.dir.entries.push(SD.entryFor(scope), SD.entryFor('delivery-role-reviewer-1.scope'), { ...SD.entryFor('delivery-role-other-2.scope'), owner: 'colombod' }, { name: 'muxplex', url: 'http://x', owner: 'colombod' });
  m.sd.units[HM.UNIT] = loaded(true);
  m.sd.units[HM.TICK_TIMER] = loaded(true);
  m.sd.units[HM.TICK_SERVICE] = loaded(false);
  m.sd.units[scope] = loaded(true);
  const exec = (cmd, args) => (args[1] === 'list-units' ? `${scope} loaded active running a role\n` : m.sd.exec(cmd, args));
  // the tick service's entry expired with its ttl (registered over an hour ago, no heartbeat since: it is not active)
  m.dir.entries = m.dir.entries.filter((e) => e.name !== HM.TICK_SERVICE);
  SD.remember(HM.TICK_SERVICE, { fetch: m.dir.fetch, now: Date.now() - 2 * 3600e3 });
  // the gone scope was registered from here; an entry of the plugin's another host or user wrote is not on the list
  SD.remember('delivery-role-reviewer-1.scope', { fetch: m.dir.fetch });
  m.dir.entries.push(SD.entryFor('delivery-role-elsewhere-3.scope'));
  const line = watchdog.directoryPass(m.alpha.root, { home: m.home, exec, sdFetch: m.dir.fetch });
  assert.equal(m.dir.beats[HM.UNIT], 1);
  assert.equal(m.dir.beats[HM.TICK_TIMER], 1);
  assert.equal(m.dir.beats[scope], 1, 'an active scope');
  assert.ok(!m.dir.beats[HM.TICK_SERVICE], 'an inactive unit gets no heartbeat');
  assert.ok(m.dir.entry(HM.TICK_SERVICE), 'a unit with no entry is registered');
  assert.equal(m.dir.entry('delivery-role-reviewer-1.scope'), null, 'a scope gone: removed');
  assert.ok(!('delivery-role-reviewer-1.scope' in m.dir.names()), 'and forgotten');
  assert.ok(m.dir.entry('delivery-role-elsewhere-3.scope'), 'an entry not on this list is not removed');
  assert.ok(m.dir.entry('delivery-role-other-2.scope') && m.dir.entry('muxplex'), 'another owner\'s entries are left');
  assert.match(line, /^service directory: registered delivery-host-manager-tick\.service, delivery-watchdog-[0-9a-f]+\.service; refreshed .*; removed delivery-role-reviewer-1\.scope$/, line);
  assert.equal(m.dir.entries.filter((e) => /^delivery-watchdog-[0-9a-f]+\.service$/.test(e.name) && e.owner === 'delivery plugin').length, 1, 'the watchdog job\'s unit file is registered too');
  const down = fakeDirectory({ down: true });
  // an entry the plugin registered that someone removed (within its ttl): not registered again, said
  m.dir.entries = m.dir.entries.filter((e) => e.name !== HM.TICK_TIMER);
  const posts = m.dir.calls.filter((c) => c === 'POST /api/services').length;
  const again = watchdog.directoryPass(m.alpha.root, { home: m.home, exec, sdFetch: m.dir.fetch });
  assert.equal(m.dir.entry(HM.TICK_TIMER), null, 'not registered again');
  assert.equal(m.dir.calls.filter((c) => c === 'POST /api/services').length, posts, 'no POST');
  assert.match(again, /not registered again, its entry was removed since the plugin registered it \(the owner may have taken it out of the plugin's hands\) delivery-host-manager-tick\.timer/, again);
  assert.match(watchdog.directoryPass(m.alpha.root, { home: m.home, exec, sdFetch: down.fetch }), /^service directory: 5 plugin units not registered or refreshed \(the service directory at http:\/\/127\.0\.0\.1:8085 could not be reached .*\); the next pass that reaches it does$/);
});

test('a role scope a start path creates is registered with the service directory: the start pass\'s start and the wake\'s scoped start; a directory down never holds the start back', () => {
  const TR = require('./team-revive.js');
  const m = machine({ beads: WORK });
  const spawned = [];
  TR.revive(m.alpha.root, m.alpha.team, { start: true, cwd: m.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: m.home, live: [], relist: () => [], only: ['chief-of-staff'], spawn: (bin, args) => { spawned.push(args); return 4242; }, settle: null, systemdRun: '/usr/bin/systemd-run', sdFetch: m.dir.fetch, ...m.deps().teamDeps(m.alpha.root) });
  const unit = R.ledger(m.alpha.root).find((x) => x.type === 'start').unit;
  assert.match(unit, /^delivery-role-chief-of-staff-\d+$/);
  assert.equal(m.dir.entry(`${unit}.scope`).owner, 'delivery plugin', 'under the name systemctl lists it by');
  assert.equal(m.dir.entry(`${unit}.scope`).ttl, 3600, 'a scope that ends expires by itself');
  // the wake's and --launch's scoped start (lib/role-scope.js startRole)
  const RS = require('./lib/role-scope.js');
  const d = fakeDirectory();
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')), 'w.log');
  const fake = () => ({ pid: 77, on() {}, unref() {} });
  const r = RS.startRole('claude', ['-p', 'go'], { instance: 'builder', env: {}, cwd: m.base, logPath: log, systemdRun: '/usr/bin/systemd-run', spawn: fake, settle: () => new Set(), sdFetch: d.fetch });
  assert.equal(r.pid, 77);
  assert.equal(d.entry(`${r.unit}.scope`).owner, 'delivery plugin');
  // down: started all the same
  const r2 = RS.startRole('claude', ['-p', 'go'], { instance: 'builder', env: {}, cwd: m.base, logPath: log, systemdRun: '/usr/bin/systemd-run', spawn: fake, settle: () => new Set(), sdFetch: fakeDirectory({ down: true }).fetch });
  assert.equal(r2.pid, 77);
  // a scope name another owner holds: not posted, left as it is, and said (a ledger row; startRole's result)
  const o = machine({ beads: WORK });
  const held = fakeDirectory({ entries: [{ name: `${unit}.scope`, url: 'http://x', owner: 'colombod' }] });
  TR.revive(o.alpha.root, o.alpha.team, { start: true, cwd: o.base, env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', DELIVERY_CLAUDE_BIN: NO_CLAUDE }, home: o.home, live: [], relist: () => [], only: ['chief-of-staff'], spawn: () => 4243, settle: null, systemdRun: '/usr/bin/systemd-run', sdFetch: held.fetch, ...o.deps().teamDeps(o.alpha.root) });
  assert.equal(R.ledger(o.alpha.root).find((x) => x.type === 'start').unit, unit, 'the same start, so the same scope name');
  assert.ok(!held.calls.includes('POST /api/services'), 'no POST for it');
  assert.equal(held.entry(`${unit}.scope`).owner, 'colombod');
  const row = R.ledger(o.alpha.root).find((x) => x.type === 'directory-held');
  assert.deepEqual([row.unit, row.owner], [`${unit}.scope`, 'colombod']);
  const RSheld = { pid: 0 };
  const hf = (method, p, body) => (method === 'GET' ? { status: 200, body: [{ name: RSheld.unit, owner: 'colombod' }] } : { status: 200, body });
  const realSpawn = (bin, args) => { RSheld.unit = `${args.find((a) => a.startsWith('--unit=')).slice(7)}.scope`; return fake(); };
  const r3 = RS.startRole('claude', ['-p', 'go'], { instance: 'builder', env: {}, cwd: m.base, logPath: log, systemdRun: '/usr/bin/systemd-run', spawn: realSpawn, settle: () => new Set(), sdFetch: (mth, p, b) => { if (mth === 'POST') RSheld.posted = true; return hf(mth, p, b); } });
  assert.equal(r3.pid, 77, 'the start runs all the same');
  assert.ok(!RSheld.posted, 'no POST for a scope name another owner holds');
  assert.match(r3.directoryHeld, /owned by "colombod", not by the delivery plugin/);
});

test('host-manager.js directory lists this node\'s entries and their health, the plugin\'s own first, in any role session; it writes nothing', () => {
  const m = machine();
  m.dir.entries.push({ ...SD.entryFor(HM.UNIT), source: 'dynamic' }, { name: 'muxplex', owner: 'colombod', source: 'static', links: [{ url: 'http://127.0.0.1:8090' }] });
  m.dir.beats[HM.UNIT] = 1;
  const r = m.run(['directory'], { env: { DELIVERY_ROLE: 'builder', DELIVERY_ROLE_ID: 'builder' }, who: { roleId: 'builder' } });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.out.split('\n'), [
    'Service directory http://127.0.0.1:8085: 2 entries on this node, 1 the delivery plugin\'s.',
    `Plugin: ${HM.UNIT}, up, dynamic, systemd-user://${HM.UNIT}`,
    'Other: muxplex, down, owner colombod, static, http://127.0.0.1:8090',
  ]);
  assert.deepEqual(m.dir.calls, ['GET /api/services/local', 'GET /api/health'], 'reads only');
  const j = JSON.parse(m.run(['directory', '--json']).out);
  assert.deepEqual(j.entries.map((e) => [e.name, e.ours, e.health]), [[HM.UNIT, true, 'up'], ['muxplex', false, 'down']]);
  m.dir.down = true;
  const d = m.run(['directory']);
  assert.equal(d.code, 1);
  assert.match(d.out, /service directory at http:\/\/127\.0\.0\.1:8085 could not be reached/);
  // in the host manager's lane, as a read
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'lane-groups.json'), 'utf8'));
  assert.ok(groups['host-manager'].some((g) => /host-manager\.js$/.test(g.arg_prefix || '') && g.sub.includes('directory')));
});

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
  // and start.js --check's service row passes it, whatever the team's size
  const max = Number(/^TasksMax=(\d+)$/m.exec(svc)[1]);
  assert.deepEqual(SL.serviceRows([{ unit: cosUnit(m), tasksMax: max, tasksCurrent: null }], 12).map((x) => x.status), ['pass']);
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
  assert.deepEqual(m.sd.calls.filter((c) => c.startsWith('systemctl') && !/^systemctl --user is-(enabled|active) claude-rc-chief-of-staff\.service$/.test(c)), [], 'only reads of its state, nothing that changes it');
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
  // the replacement of a session outside the unit is the host manager's alone: an idle Chief of Staff whose
  // server runs outside its unit is left, exit 3, nothing stopped
  const stops = [];
  const outside = run({ live: [{ sessionId: 'c1', pid: 41, cwd: m.alpha.dir('chief-of-staff'), name: 'x', status: 'idle' }], server: () => ({ pid: 40, self: false }), cgroupOf: (pid) => (pid === 'self' ? '0::/app.slice/delivery-role-chief-of-staff-x.service\n' : '0::/app.slice/app-term.scope\n'), stop: (...a) => { stops.push(a); return true; } });
  assert.equal(outside.code, 3, outside.out);
  assert.deepEqual([stops, calls.length], [[], 1]);
  // a builder's session does not run it for itself or for the Chief of Staff
  const no = m.run(['run-session', '--project', m.alpha.root, '--instance', 'builder'], { env: { ...env, DELIVERY_ROLE: 'builder' }, who: { roleId: 'builder' }, execve, resolveBin: (b) => `/opt/bin/${b}` });
  assert.equal(no.code, 1);
  assert.equal(calls.length, 1);
});

// The guard: two start paths never serve one role directory. For a unit the plugin wrote and for one it
// did not, every path that starts or restarts a role (the owner's restart of a down role and of a running
// one, the unattended tick, team-revive's start pass with its stale-session restart, the watchdog's wake)
// starts nothing in a scope or a wake beside the unit; only the unit starts it.
test('guard: a role a user unit serves is never spawned in a scope, stopped, or woken by any start path; the plugin\'s own unit is started through systemctl alone', () => {
  const TR = require('./team-revive.js');
  const WDL = require('./lib/watchdog.js');
  for (const kind of ['hand', 'own']) {
    const unitOf = (m) => (kind === 'own' ? cosUnit(m) : 'claude-rc-chief-of-staff.service');
    const exec = (m) => (kind === 'own' ? `/usr/bin/env "node" "${path.join(m.alpha.root, '.delivery', 'bin', 'delivery.js')}" "host-manager.js" "run-session" "--project" "${m.alpha.root}" "--instance" "chief-of-staff"` : '/opt/tools/bin/claude remote-control --name cos');
    const served = (m) => { roleUnit(m, m.alpha.dir('chief-of-staff'), unitOf(m), exec(m)); m.sd.units[unitOf(m)] = loaded(false); };
    const noCos = (m, what) => {
      assert.ok(!m.spawned.some((s) => s.cwd === m.alpha.dir('chief-of-staff')), `${kind}, ${what}: spawned beside its unit`);
      assert.ok(!m.stops.some((s) => s.pid === 61), `${kind}, ${what}: stopped`);
      const starts = m.sd.calls.filter((c) => / (start|restart|reset-failed|stop|disable) /.test(` ${c} `) && c.includes(unitOf(m)));
      if (kind === 'hand') assert.deepEqual(starts, [], `${kind}, ${what}: the plugin started, restarted or stopped a unit it did not write`);
      return starts;
    };
    // the owner's restart, the Chief of Staff down and holding work
    const down = machine({ beads: WORK });
    served(down);
    const r1 = down.run(['restart']);
    const s1 = noCos(down, 'owner\'s restart, down');
    assert.ok(down.spawned.some((s) => s.cwd === down.alpha.dir('builder')), 'a role with no unit still starts');
    if (kind === 'own') {
      assert.ok(s1.includes(`systemctl --user start ${cosUnit(down)}`), `${s1.join(" | ")} ${r1.out} ${down.sd.calls.join(" ; ")}`);
      assert.match(r1.out, new RegExp(`alpha chief-of-staff: started through its user unit ${esc(cosUnit(down))}`), r1.out);
    } else assert.match(r1.out, /alpha chief-of-staff \(not started: it is served by the user unit claude-rc-chief-of-staff\.service/, r1.out);
    // the owner's restart, the Chief of Staff running and idle: only through its unit
    const up = machine({ beads: WORK });
    served(up);
    runningRole(up, up.alpha, 'chief-of-staff', { pid: 61, server: false, bridge: null });
    const r2 = up.run(['restart']);
    const s2 = noCos(up, 'owner\'s restart, running');
    // the plugin restarts only a unit it wrote; one it did not write is named with the fix
    if (kind === 'own') assert.ok(s2.includes(`systemctl --user restart ${unitOf(up)}`), s2.join(' | '));
    else {
      assert.deepEqual(s2, [], `${kind}: a unit the plugin did not write was restarted`);
      assert.match(r2.out, /Not restarted: alpha chief-of-staff: served by claude-rc-chief-of-staff\.service, which the plugin did not write; not restarted: stop and disable claude-rc-chief-of-staff\.service/, r2.out);
    }
    // the unattended tick, the Chief of Staff down
    const tick = machine({ beads: WORK });
    served(tick);
    tick.run(['tick'], { env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev', DELIVERY_ROLE: 'host-manager', DELIVERY_ROLE_ID: 'host-manager' }, who: { roleId: 'host-manager' } });
    noCos(tick, 'tick');
    // team-revive's own pass: the Chief of Staff on an older plugin, idle (the stale-session restart)
    const st = machine({ beads: WORK });
    served(st);
    runningRole(st, st.alpha, 'chief-of-staff', { pid: 61, version: '1.0.0' });
    const units = [];
    TR.revive(st.alpha.root, st.alpha.team, { start: true, env: { DELIVERY_HOST: 'pc' }, home: st.home, live: st.live, spawn: (b, a, o) => { st.spawned.push({ args: a, cwd: o.cwd }); return 1; }, stop: (s, p) => { st.stops.push({ server: s, pid: p }); return true; }, startUnit: (u) => units.push(u), settle: null, ...st.deps().teamDeps(st.alpha.root) });
    noCos(st, 'team-revive stale restart');
    assert.deepEqual(units, []);
    // the watchdog's wake: no session is started for it
    const c = WDL.wakeCommand({ instance: 'chief-of-staff', role: 'chief-of-staff', session: 's', roleDir: down.alpha.dir('chief-of-staff') }, 'go', [], 'auto', { unit: R.remoteControlUnitFor(down.alpha.dir('chief-of-staff'), { home: down.home }) });
    assert.equal(c.args, undefined, `${kind}: the wake starts a session beside the unit`);
  }
});

test('after the fix --check prints (the hand-written unit stopped and disabled, its file left on disk), install-role goes ahead; while it runs or is enabled, it does not', () => {
  const hand = 'claude-rc-chief-of-staff.service';
  const setup = (state) => {
    const m = machine();
    cosMarker(m);
    fs.writeFileSync(path.join(HM.unitDir(m.home), hand), `[Unit]\nDescription=mine\n\n[Service]\nWorkingDirectory=%h/../alpha-team/chief-of-staff\nExecStart=%h/.local/bin/claude remote-control --name "Chief of Staff" --permission-mode auto\n`);
    if (state) m.sd.units[hand] = state;
    return m;
  };
  // the fixture's role directory, written as the real host's unit writes it: relative to %h
  const done = setup(loaded(false));
  const r = done.run(['install-role', '--project', done.alpha.root]);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(HM.unitDir(done.home), cosUnit(done))));
  assert.ok(fs.existsSync(path.join(HM.unitDir(done.home), hand)), 'the owner\'s file is left where it is');
  assert.ok(!done.sd.calls.some((c) => c.includes(hand) && !/ is-(enabled|active) /.test(c)), done.sd.calls.join(' | '));
  for (const [what, state] of [['running', loaded(true)], ['enabled', { ...loaded(false), Enabled: true }], ['state unknown', null]]) {
    const m = setup(state);
    const no = m.run(['install-role', '--project', m.alpha.root]);
    assert.equal(no.code, 1, `${what}: ${no.out}`);
    assert.match(no.out, /claude-rc-chief-of-staff\.service serves .* stop and disable claude-rc-chief-of-staff\.service/, what);
    assert.ok(!fs.existsSync(path.join(HM.unitDir(m.home), cosUnit(m))), what);
  }
});
