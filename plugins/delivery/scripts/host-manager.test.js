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
  const spawn = (bin, args, opts) => { const pid = 5000 + spawned.length; spawned.push({ args, cwd: opts.cwd }); if (!machine.dies) alive.add(pid); return pid; };
  const config = path.join(base, 'claude-config');
  fs.mkdirSync(config, { recursive: true });
  const m = {
    base, home, alpha, beta, sd, spawned, alive, config,
    beads: { [alpha.root]: beads.alpha || [], [beta.root]: beads.beta || [] },
    live: live !== undefined ? live : [],
    now: T0,
  };
  m.deps = () => ({
    env: { DELIVERY_HOST: 'pc', PATH: '/usr/bin', USER: 'dev' },
    home, exec: sd.exec, has: () => true, live: m.live, spawn, cwd: base, who: { roleId: null }, now: m.now,
    teamDeps: (root) => ({ bd: bd[root] || store(m.beads[root]), prs: [], alive: (pid) => alive.has(pid), pause: () => ({ paused: false }), configDir: config, now: m.now, hostname: 'pc' }),
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
  for (const l of [`Back: delivery-watchdog-${a}.timer is running.`, 'Back: alpha chief-of-staff is running.', 'Back: alpha builder is running.', 'Left down (no work held): alpha tech-writer.']) assert.ok(lines.includes(l), `${l}\n${r.out}`);
  assert.doesNotMatch(r.out, /Not back/);
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
    assert.match(r.out, /^Not back: alpha builder\.$/m, r.out);
    assert.doesNotMatch(r.out, /Back: alpha builder/);
  } finally { machine.dies = false; }
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
    assert.match(alert.text, /^The team on this machine went silent: alpha builder \(holding al-1; no note or wake since .*\)\. I restarted what was down\. Came back: nothing\. Not back: alpha builder\.$/);
    // it reaches the host manager's own session through its team's inbox
    const inbox = require('./lib/inbox.js').pending(m.alpha.root).find((x) => x.to === 'host-manager');
    assert.ok(inbox, first.out);
    assert.equal(inbox.entries.length, 1);
    assert.equal(inbox.entries[0].message, alert.text);
    assert.deepEqual(alert.delivered_to, ['alpha host-manager']);
    // five minutes on, still down (the session died again, and a cap holds the next start): no second alert
    m.now = iso(Date.parse(T0) + 5 * MIN);
    const second = m.run(['tick'], { lastPass });
    assert.match(second.out, /still silent, in the outage open since/);
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
  assert.deepEqual(HM.readLedger(HM.outageFile({}, m.home)).map((x) => x.type), ['open', 'alert']);
  assert.match(j.out, /No host manager instance is in any team on this host: the alert is in .*outages\.ndjson only\./);
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
    /^ExecStart=\/usr\/bin\/env "claude" "remote-control" "--name" "host-manager@pc" "--spawn" "session" "--permission-mode" "auto"$/m, /^Environment="DELIVERY_ROLE=host-manager"$/m]) assert.match(svc, re, svc);
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
  assert.match(fs.readFileSync(unit(HM.UNIT), 'utf8'), /"--session-id" "session_hm1"/);
  assert.deepEqual(HM.readHostTeams(HM.hostFile({}, m.home)).teams, [m.alpha.root], 'the host file lists the team once');
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
