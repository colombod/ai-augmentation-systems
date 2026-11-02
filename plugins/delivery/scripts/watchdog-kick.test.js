// scripts/watchdog-kick.test.js — hjx.1.3: a handoff or a message wakes its role at once, on an event,
// not at the next timer pass. The check at a65637c: handoffs queued at 07:25:25, 07:25:34 and 07:25:57
// were delivered at 07:39:39, by the next 15-minute pass. Each writer now drops a kick (lib/kick.js) that
// the host job watches; a wake that ends drops one too; the run takes them before it reads the record.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WD = require('./lib/watchdog.js');
const KICK = require('./lib/kick.js');
const HO = require('./lib/handoff.js');
const IB = require('./lib/inbox.js');
const { registerInstance } = require('./lib/roster.js');
const { harness } = require('./testing/role-harness.js');
const watchdog = require('./watchdog.js');

const DM = 'delivery-lead';
const H = 3600e3;
const iso = (t) => new Date(t).toISOString();
const SHA = 'a65637c2569c4b6f23d095d0faec58918c7e642f';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// as in watchdog.test.js: a role session on the roster, a fake spawn, the beads in memory
const session = (h, instance, seen) => registerInstance(h.root, { instance, session_id: `sess-${instance}`, host: 'pc', model: 'sonnet', role_dir: h.roleDir(instance), now: seen });
const memStore = (h) => { const b = Object.values(h.db().issues); return { list: () => b, ready: () => b.filter((x) => x.status === 'open'), show: (id) => b.find((x) => x.id === id) || null }; };
const spawner = () => { const list = []; const fn = (bin, args, o) => { list.push({ args, role: o.env.DELIVERY_ROLE, kick: o.env.DELIVERY_WAKE_KICK }); return 999999999; }; fn.list = list; return fn; };
const fakeEnv = (h) => ({ ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}` });
const at = (h, now, argv, deps = {}) => watchdog.main(argv, { cwd: h.root, env: fakeEnv(h), now, live: [], sweep: () => ({ removed: [], failed: [] }), ...deps });
const deployed = (id) => ({ id, status: 'in_progress', assignee: 'dev@pc/builder-1', labels: ['state-merged', 'state-deployed'], metadata: { deployed_sha: SHA }, updated_at: '2026-11-02T07:25:00Z' });

test('a queued message or handoff drops a kick; the run takes it before reading the record and wakes at once; check takes none', () => {
  const t0 = '2026-11-02T07:25:25Z';
  const h = harness({ beads: { 'ex-s': deployed('ex-s') } });
  session(h, DM, iso(Date.parse(t0) - 30 * 60e3));
  assert.equal(KICK.waiting(h.root), 0);
  HO.queue(h.root, { bead: 'ex-s', step: 'check', to: DM, from: DM, sha: SHA, at: t0 });
  IB.queue(h.root, { to: DM, from: 'builder-1', message: 'PR ready', at: t0 });
  assert.equal(KICK.waiting(h.root), 2, 'one kick per handover');
  assert.match(fs.readFileSync(path.join(h.root, WD.REL, '.gitignore'), 'utf8'), /\*/, 'host-local: the kicks stay out of git');
  const spawn = spawner();
  at(h, t0, ['check'], { spawn, bd: memStore(h) });
  assert.equal(KICK.waiting(h.root), 2, 'a check (a role session may run it) takes no kick');
  const r = at(h, iso(Date.parse(t0) + 2e3), ['run'], { spawn, bd: memStore(h) });
  assert.equal(KICK.waiting(h.root), 0, 'taken, so the watched directory empties');
  assert.match(r.out, /^Kicked: 2 \((a check handoff; a message|a message; a check handoff)\)$/m);
  assert.equal(spawn.list.length, 1, r.out);
  assert.equal(spawn.list[0].role, DM);
  assert.match(spawn.list[0].args.join(' '), /PR ready.*Dispatch its reality check now/);
  assert.equal(HO.pending(h.root).length, 0, 'handed over with its wake');
  // a kick that cannot be written never throws into the writer; the timer pass still finds the handover
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kick-')), 'a-file');
  fs.writeFileSync(file, '');
  assert.equal(KICK.kickIn(path.join(file, 'kicks'), 'x'), false);
});

test('a kick that lands while a run goes is taken by another pass of the same run', () => {
  const t0 = '2026-11-02T07:25:25Z';
  const h = harness({});
  session(h, DM, iso(Date.parse(t0) - 30 * 60e3));
  session(h, 'reality-checker', iso(Date.parse(t0) - 30 * 60e3));
  IB.queue(h.root, { to: DM, from: 'builder-1', message: 'first', at: t0 });
  const base = spawner();
  // while the run is still going, a message arrives for the Reality Checker
  const spawn = (bin, args, o) => { const pid = base(bin, args, o); if (o.env.DELIVERY_ROLE === DM) IB.queue(h.root, { to: 'reality-checker', from: DM, message: 'check hjx.1', at: t0 }); return pid; };
  const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
  assert.deepEqual(base.list.map((x) => x.role), [DM, 'reality-checker'], r.out);
  assert.equal(KICK.waiting(h.root), 0);
  assert.equal((r.out.match(/ watchdog$/gm) || []).length, 2, 'two passes, each with its own header');
});

test('a kicked run waits for another run\'s lock and leaves its kicks when it gives up; an unkicked run does not wait', () => {
  const h = harness({});
  WD.ensureDir(h.root);
  const lock = path.join(h.root, WD.REL, 'run.lock');
  fs.writeFileSync(lock, '1');
  let t = Date.now();
  assert.match(at(h, iso(t), ['run'], { spawn: spawner(), bd: memStore(h), lockWaitMs: 3000 }).out, /holds the lock/);
  assert.ok(Date.now() - t < 1500, 'no kick: no wait');
  KICK.kick(h.root, 'a message');
  t = Date.now();
  assert.match(at(h, iso(t), ['run'], { spawn: spawner(), bd: memStore(h), lockWaitMs: 600 }).out, /holds the lock/);
  assert.ok(Date.now() - t >= 500, 'kicked: it waited');
  assert.equal(KICK.waiting(h.root), 1, 'the kick stays for the run that gets the lock');
  // the lock released by another process while a kicked run waits: it runs and takes the kick
  const child = require('child_process').spawn(process.execPath, ['-e', `setTimeout(() => require('fs').unlinkSync(${JSON.stringify(lock)}), 400)`], { stdio: 'ignore' });
  const out = at(h, iso(Date.now()), ['run'], { spawn: spawner(), bd: memStore(h), lockWaitMs: 10000 }).out;
  assert.match(out, /^Kicked: 1 \(a message\)$/m, out);
  assert.equal(KICK.waiting(h.root), 0);
  return new Promise((resolve) => child.on('exit', resolve));
});

test('a wake that ends kicks the next run; the session it starts does not carry the kick directory; every wake names it', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kick-')), 'kicks');
  const run = (extra, code) => spawnSync(process.execPath, [path.join(__dirname, 'lib', 'wake-run.js'), '60000', process.execPath, '-e', code], { encoding: 'utf8', env: { ...process.env, ...extra } });
  const r = run({ DELIVERY_WAKE_KICK: dir }, 'process.stdout.write(process.env.DELIVERY_WAKE_KICK || "none"); process.exit(3)');
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.stdout, 'none');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1, 'one kick, whatever the exit code');
  assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /a wake ended/);
  assert.equal(run({ DELIVERY_WAKE_KICK: '' }, '0').status, 0, 'no directory named: nothing written');
  const h = harness({});
  session(h, DM, iso(Date.now() - H));
  IB.queue(h.root, { to: DM, from: 'builder-1', message: 'x' });
  const spawn = spawner();
  at(h, iso(Date.now()), ['run'], { spawn, bd: memStore(h) });
  assert.deepEqual(spawn.list.map((x) => x.kick), [KICK.dirOf(h.root)]);
});

test('a wake that ends names its own pid in its kick', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kick-')), 'kicks');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'lib', 'wake-run.js'), '60000', process.execPath, '-e', '0'], { encoding: 'utf8', env: { ...process.env, DELIVERY_WAKE_KICK: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'), new RegExp(`a wake ended \\(pid ${r.pid}\\)`));
});

test('a run kicked by a wake that ended reads that wake as gone, though its supervisor still answers; another running wake still holds', async () => {
  // the supervisor drops its kick from its exit handler, so its pid still answers when the kicked run
  // reads it (review of 73307bf): a process named wake-run.js stands in for it
  const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kick-')), 'wake-run.js');
  fs.writeFileSync(fake, 'setTimeout(() => {}, 60000);\n');
  const sup = require('child_process').spawn(process.execPath, [fake], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    assert.equal(WD.pidAlive(sup.pid), true, 'the stand-in reads as a live wake');
    const t0 = '2026-11-02T08:00:00Z';
    const h = harness({});
    session(h, DM, iso(Date.parse(t0) - H));
    WD.log(h.root, { type: 'wake', at: iso(Date.parse(t0) - 20 * 60e3), keys: ['message:x'], instance: DM, pid: sup.pid });
    IB.queue(h.root, { to: DM, from: 'builder-1', message: 'PR ready', at: t0 });
    KICK.take(h.root);
    const spawn = spawner();
    // no kick names it: the wake is running, the message is held
    let r = at(h, iso(Date.parse(t0) + 1e3), ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 0, r.out);
    assert.match(r.out, /Alarm only: delivery-lead: its last wake is still running/);
    // another wake's end names another pid: still held
    KICK.kick(h.root, 'a wake ended (pid 1)');
    r = at(h, iso(Date.parse(t0) + 2e3), ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 0, r.out);
    // its own end kicks the run: the message goes at once
    KICK.kick(h.root, `a wake ended (pid ${sup.pid})`);
    r = at(h, iso(Date.parse(t0) + 3e3), ['run'], { spawn, bd: memStore(h) });
    assert.match(r.out, /^Kicked: 1 \(a wake ended\)$/m, r.out);
    assert.equal(spawn.list.length, 1, r.out);
    assert.equal(spawn.list[0].role, DM);
  } finally { sup.kill(); }
});

test('the host job watches the kick directory: a systemd path unit, launchd QueueDirectories; cron says it waits for the pass', () => {
  const h = harness({});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const ran = [];
  let tab = '';
  const exec = (cmd, args, input) => { ran.push([cmd, ...args].join(' ')); if (cmd === 'crontab' && args[0] === '-l') return tab; if (cmd === 'crontab' && args[0] === '-') tab = input; return ''; };
  const env = { ...process.env, DELIVERY_ROLE: '', PATH: '/usr/bin' };
  const main = (argv, more) => watchdog.main(argv, { cwd: h.root, env, home, exec, ...more });
  const kicks = KICK.dirOf(h.root);
  const linux = main(['install', '--apply'], { platform: 'linux', has: () => true });
  assert.equal(linux.code, 0, linux.out);
  assert.match(linux.out, /It also runs at once when a handoff or a message drops a kick in /);
  const unit = path.join(home, '.config', 'systemd', 'user');
  const pathUnit = fs.readdirSync(unit).find((f) => f.endsWith('.path'));
  assert.ok(pathUnit, fs.readdirSync(unit).join());
  const body = fs.readFileSync(path.join(unit, pathUnit), 'utf8');
  assert.match(body, new RegExp(`^DirectoryNotEmpty=${esc(kicks)}$`, 'm'));
  assert.match(body, /^MakeDirectory=yes$/m);
  assert.match(body, new RegExp(`^Unit=${esc(pathUnit.replace(/\.path$/, '.service'))}$`, 'm'), 'it starts the job\'s own service');
  assert.ok(ran.includes(`systemctl --user enable --now ${pathUnit}`), ran.join('\n'));
  ran.length = 0;
  main(['uninstall'], { platform: 'linux', has: () => true });
  assert.ok(ran.includes(`systemctl --user disable --now ${pathUnit}`), ran.join('\n'));
  assert.deepEqual(fs.readdirSync(unit), []);
  assert.equal(main(['install', '--apply'], { platform: 'darwin' }).code, 0);
  const agents = path.join(home, 'Library', 'LaunchAgents');
  const plist = fs.readFileSync(path.join(agents, fs.readdirSync(agents)[0]), 'utf8');
  assert.ok(plist.includes(`<key>QueueDirectories</key>\n  <array><string>${kicks}</string></array>`), plist);
  assert.ok(fs.statSync(kicks).isDirectory(), 'launchd watches only a directory that exists');
  main(['uninstall'], { platform: 'darwin' });
  assert.match(main(['install'], { platform: 'linux', has: (c) => c === 'crontab' }).out, /cron cannot watch a directory, so a handoff or a message waits for the next pass/);
});

test('a systemd job installed before the kick watch gets its path unit from its own run, once; no other job is touched', () => {
  const h = harness({});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const unit = watchdog.kickWatchUnit(h.root, home);
  const timer = unit.file.replace(/\.path$/, '.timer');
  fs.mkdirSync(path.dirname(timer), { recursive: true });
  fs.writeFileSync(timer, '[Timer]\n');
  WD.ensureDir(h.root);
  fs.writeFileSync(WD.installedFile(h.root), JSON.stringify({ kind: 'systemd', file: timer, every_s: 900 }));
  const ran = [];
  const exec = (cmd, args) => { ran.push([cmd, ...args].join(' ')); return ''; };
  const deps = (more) => ({ spawn: spawner(), bd: memStore(h), exec, ...more });
  const r = at(h, iso(Date.now()), ['run'], deps({ home }));
  assert.match(r.out, /^kick watch: installed .*\.path; a handoff or a message now starts a run at once$/m, r.out);
  assert.equal(fs.readFileSync(unit.file, 'utf8'), unit.body);
  assert.deepEqual(ran, ['systemctl --user daemon-reload', `systemctl --user enable --now ${path.basename(unit.file)}`]);
  ran.length = 0;
  assert.doesNotMatch(at(h, iso(Date.now()), ['run'], deps({ home })).out, /kick watch/, 'once: the unit is current');
  assert.deepEqual(ran, []);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  at(h, iso(Date.now()), ['run'], deps({ home: other }));
  assert.equal(fs.existsSync(path.join(other, '.config')), false, 'a job recorded at another home is not this one');
  assert.doesNotMatch(at(h, iso(Date.now()), ['run', '--dry-run'], deps({ home: other })).out, /kick watch/);
});

test('a handoff the record closes says what showed its step taken; one it does not close is woken for, never marked done', () => {
  const t0 = '2026-11-02T07:25:28Z';
  const h = harness({ beads: { 'ex-a': deployed('ex-a'), 'ex-a-rc-a65637c': { id: 'ex-a-rc-a65637c', status: 'open', created_at: t0 }, 'ex-b': deployed('ex-b') } });
  session(h, DM, iso(Date.parse(t0) - 30 * 60e3));
  HO.queue(h.root, { bead: 'ex-a', step: 'check', to: DM, from: DM, sha: SHA, at: t0 });
  HO.queue(h.root, { bead: 'ex-b', step: 'check', to: DM, from: DM, sha: SHA, at: t0 });
  const spawn = spawner();
  at(h, iso(Date.parse(t0) + 1e3), ['run'], { spawn, bd: memStore(h) });
  const rows = Object.fromEntries(HO.rows(h.root).map((r) => [r.bead, r]));
  assert.equal(rows['ex-a'].done_why, 'its reality check ex-a-rc-a65637c exists');
  assert.ok(rows['ex-a'].done_at);
  assert.equal(rows['ex-a'].delivered_at, undefined);
  assert.ok(rows['ex-b'].delivered_at, 'ex-b has no check yet: it is woken for');
  assert.equal(rows['ex-b'].done_at, undefined);
  assert.equal(spawn.list.length, 1);
  assert.match(spawn.list[0].args.join(' '), /ex-b is deployed/);
  assert.doesNotMatch(spawn.list[0].args.join(' '), /ex-a is deployed/);
  assert.equal(HO.doneWhy({ bead: 'gone', step: 'deploy' }, null), 'gone is not in the record');
  assert.equal(HO.doneWhy({ bead: 'x', step: 'deploy' }, { id: 'x', status: 'closed' }), 'x is closed');
  assert.equal(HO.doneWhy({ bead: 'x', step: 'deploy' }, { id: 'x', status: 'in_progress', labels: ['state-merged', 'state-deployed'], metadata: { deployed_sha: SHA } }), 'x is deployed at a65637c');
  assert.equal(HO.doneWhy({ bead: 'x', step: 'deploy' }, { id: 'x', status: 'in_progress', labels: ['state-merged'] }), null);
});

test('hjx.1 c1 isolated: assigned work with no waiting message wakes its idle holder with the assigned key alone', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const h = harness({ beads: { 'ex-p': { id: 'ex-p', status: 'in_progress', assignee: 'dev@pc/builder-2', updated_at: iso(now - 20 * 60e3) } } });
  session(h, 'builder-2', iso(now - 20 * 60e3));
  assert.deepEqual(IB.pending(h.root), [], 'no message waits');
  const spawn = spawner();
  at(h, iso(now), ['run'], { spawn, bd: memStore(h) });
  assert.deepEqual(spawn.list.map((x) => x.role), ['builder-2']);
  assert.deepEqual(WD.logRows(h.root).filter((r) => r.type === 'wake').map((r) => r.keys), [['assigned:ex-p']]);
});
