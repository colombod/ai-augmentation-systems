// scripts/outage-drill.test.js — the outage drill: the lane gives run to the Reality Checker only, the
// consent record must verify and is spent by one drill, the restore and the restart are scheduled in
// system timers before the cut, and plan starts nothing. Every command is a stub: no test cuts the
// network, schedules a timer or restarts the host.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('./outage-drill.js');
const L = require('./lib/outage-drill.js');

const REC = 'dec-chief-of-staff-91';
const NOW = '2026-11-07T10:00:00.000Z';
const verifyRecord = require('./testing/gate-fixture.js').ownerVerify(REC);
const scratchDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function setup() {
  const dir = scratchDir('drill-');
  const events = [];
  const exec = (args) => {
    const kind = args.includes('systemd-run') ? `schedule ${(/--unit=delivery-drill-(\w+)-/.exec(args.join(' ')) || [])[1]}` : args.includes('stop') ? 'stop' : args.includes('off') ? 'cut' : 'other';
    events.push({ kind, args, rowWritten: L.drillOf(dir, REC) !== null });
    return { status: 0, stdout: '', stderr: '' };
  };
  const run = (argv, extra = {}) => D.main(argv, { cwd: dir, env: {}, now: NOW, exec, ps: () => '', verifyRecord: (r, id, opts) => { events.push({ kind: 'verify', id, opts }); return verifyRecord(r, id); }, who: { root: dir, roleId: 'reality-checker', actor: 'dev@pc/reality-checker' }, ...extra });
  return { root: dir, events, run };
}
const RUN = ['run', '--record', REC, '--cut-minutes', '30', '--restart'];

test('run verifies the record, then schedules the restore, then the restart, then writes the row, and only then cuts', () => {
  const t = setup();
  const r = t.run(RUN);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(t.events.map((e) => e.kind), ['verify', 'schedule restore', 'schedule restart', 'cut']);
  assert.deepEqual(t.events[0].opts, { noLedger: true }, 'read as operator.js verify reads it');
  const [, restore, restart, cut] = t.events;
  // system timers (no --user): they belong to PID 1 and outlive the session the cut drops
  assert.deepEqual(restore.args, ['sudo', '-n', 'systemd-run', '--on-active=1800s', '--timer-property=AccuracySec=1s', `--unit=delivery-drill-restore-${REC}`, `--description=delivery outage drill restore (${REC})`, 'nmcli', 'networking', 'on']);
  assert.deepEqual(restart.args, ['sudo', '-n', 'systemd-run', '--on-active=1860s', '--timer-property=AccuracySec=1s', `--unit=delivery-drill-restart-${REC}`, `--description=delivery outage drill restart (${REC})`, 'systemctl', 'reboot']);
  assert.ok(!restore.args.includes('--user') && !restart.args.includes('--user'));
  assert.deepEqual(cut.args, ['sudo', '-n', 'nmcli', 'networking', 'off']);
  assert.equal(restore.rowWritten, false);
  assert.equal(restart.rowWritten, false);
  assert.equal(cut.rowWritten, true, 'the row is on disk before the cut');
  const row = L.drillOf(t.root, REC);
  assert.deepEqual(row, { type: 'drill', record: REC, started_at: NOW, restore_at: '2026-11-07T10:30:00.000Z', restart_at: '2026-11-07T10:31:00.000Z', cut_minutes: 30, restart_after_minutes: 1, units: [`delivery-drill-restore-${REC}.timer`, `delivery-drill-restart-${REC}.timer`], by: 'dev@pc/reality-checker' });
  assert.equal(L.ledgerFile(t.root), path.join(t.root, '.delivery', 'watchdog', 'drills.ndjson'));
  // the restart comes a minute after the network is back; the privilege is configurable
  const u = setup();
  assert.equal(u.run(['run', '--record', REC, '--cut-minutes', '5', '--restart'], { env: { DELIVERY_DRILL_PRIVILEGE: 'pkexec' } }).code, 0);
  assert.deepEqual(u.events[2].args.slice(0, 3), ['pkexec', 'systemd-run', '--on-active=360s']);
});

test('a second run on the same record is refused before anything is scheduled', () => {
  const t = setup();
  assert.equal(t.run(RUN).code, 0);
  t.events.length = 0;
  const again = t.run(RUN);
  assert.equal(again.code, 1);
  assert.match(again.out, /already used for a drill started 2026-11-07T10:00:00.000Z; one drill per consent/);
  assert.deepEqual(t.events.map((e) => e.kind), ['verify']);
});

test('a record that does not verify, or is not the owner\'s word, is refused and nothing runs', () => {
  for (const vr of [() => ({ ok: false, error: 'not found' }), () => ({ ok: true, chain: [{ kind: 'decision' }, { kind: 'input', source: 'agent' }] }), () => { throw new Error('store unreadable'); }]) {
    const t = setup();
    const r = t.run(RUN, { verifyRecord: vr });
    assert.equal(r.code, 1);
    assert.match(r.out, /refused: .* nothing scheduled or cut/);
    assert.deepEqual(t.events, []);
    assert.equal(fs.existsSync(L.ledgerFile(t.root)), false);
  }
});

test('run refuses a cut outside 1..30 minutes, a run without --restart, and any role but the Reality Checker', () => {
  const t = setup();
  for (const n of ['0', '31', '2.5', 'ten']) assert.equal(t.run(['run', '--record', REC, '--cut-minutes', n, '--restart']).code, 2, n);
  assert.match(t.run(['run', '--record', REC, '--restart']).out, /--cut-minutes must be a whole number from 1 to 30/);
  // the consent covers one cut of up to 30 minutes and one restart; no option stretches the gap
  assert.equal(t.run(['run', '--record', REC, '--cut-minutes', '10', '--restart', '--restart-after-minutes', '90']).code, 2);
  assert.match(t.run(['run', '--record', REC, '--cut-minutes', '10']).out, /run needs --restart/);
  assert.match(t.run(['run', '--cut-minutes', '10', '--restart']).out, /run needs --record/);
  for (const roleId of ['builder', 'spike-researcher', 'chief-of-staff', null]) {
    const r = t.run(RUN, { who: { root: t.root, roleId } });
    assert.equal(r.code, 1);
    assert.match(r.out, /run is the Reality Checker's/);
  }
  assert.deepEqual(t.events, []);
});

test('a schedule that fails never cuts and undoes the timer made before it; a failed cut stops both timers', () => {
  for (const failOn of ['restore', 'restart']) {
    const t = setup();
    const calls = [];
    const exec = (args) => { calls.push(args.join(' ')); return { status: args.join(' ').includes(`drill-${failOn}-`) && args.includes('systemd-run') ? 1 : 0, stderr: 'Interactive authentication required.' }; };
    const r = t.run(RUN, { exec });
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`could not schedule the ${failOn} \\(Interactive authentication required.\\); nothing cut`));
    assert.ok(!calls.some((c) => / networking off$/.test(c)), 'never cut');
    assert.equal(calls.some((c) => c.endsWith(`systemctl stop delivery-drill-restore-${REC}.timer`)), failOn === 'restart');
    assert.equal(L.drillOf(t.root, REC), null, 'the consent is not spent');
  }
  const t = setup();
  const calls = [];
  const r = t.run(RUN, { exec: (args) => { calls.push(args.join(' ')); return { status: args.includes('off') ? 1 : 0, stderr: 'no' }; } });
  assert.equal(r.code, 1);
  assert.match(r.out, /the cut failed .* the host does not restart/);
  assert.ok(calls.some((c) => c.endsWith(`stop delivery-drill-restart-${REC}.timer`)));
  assert.ok(calls.some((c) => c.endsWith(`stop delivery-drill-restore-${REC}.timer`)));
});

test('plan prints the times, the consent and its use, and the leftover-child pre-flight, and starts and writes nothing', () => {
  const t = setup();
  const before = fs.readdirSync(t.root);
  const ps = () => ['  PID COMMAND', '  101 /usr/bin/claude --print --sdk-url wss://x --verbose', '  102 claude --print hello', '  103 node /opt/claude/cli.js', '  104 bash -c echo claude --print --sdk-url'].join('\n');
  const r = t.run(['plan', '--record', REC, '--cut-minutes', '20'], { ps });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /network cut: 20 minutes/);
  assert.match(r.out, /network back: 2026-11-07T10:20:00.000Z/);
  assert.match(r.out, /host restart: 2026-11-07T10:21:00.000Z \(1 minute after/);
  assert.match(r.out, /not covered: an offline gap longer than the cut/);
  assert.match(r.out, new RegExp(`consent: ${REC} verifies as the owner's word`));
  assert.match(r.out, /used: no drill on it yet/);
  assert.match(r.out, /pre-flight: 1 leftover claude child with --print and --sdk-url running \(pid 101\)/);
  assert.deepEqual(t.events.map((e) => e.kind), ['verify'], 'no command is run');
  assert.deepEqual(fs.readdirSync(t.root), before, 'nothing written');
  assert.match(t.run(['plan'], { ps: () => '1 init' }).out, /network cut: 30 minutes[\s\S]*consent: no record named[\s\S]*pre-flight: no leftover/);
  assert.match(t.run(['plan'], { ps: () => { throw new Error('no ps'); } }).out, /process list could not be read/);
  assert.deepEqual(t.events.filter((e) => e.kind !== 'verify'), []);
  // after a run, plan says the record is spent
  assert.equal(t.run(RUN).code, 0);
  assert.match(t.run(['plan', '--record', REC]).out, /used: yes, a drill on it started 2026-11-07T10:00:00.000Z; run is refused/);
  assert.match(t.run(['plan', '--record', 'dec-x-1']).out, /consent: dec-x-1 refused: dec-x-1 does not verify/);
});

test('the lane gives outage-drill.js run to the Reality Checker only; a role whose lane runs anything meets the script\'s refusal', () => {
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const PLUGIN_ROOT = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const laneDir = scratchDir('drill-lane-');
  const command = `node ${PLUGIN_ROOT}/scripts/outage-drill.js run --record ${REC} --cut-minutes 30 --restart`;
  const roles = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).map((f) => f.replace(/\.md$/, ''));
  const brief = (role) => fs.readFileSync(path.join(PLUGIN_ROOT, 'roles', `${role}.md`), 'utf8');
  const open = [];
  for (const role of roles) {
    const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` });
    const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy, roleDir: laneDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
    if (role === 'reality-checker') assert.equal(d.allow, true, d.reason);
    else if (/^lane_bash: any$/m.test(brief(role))) { open.push(role); assert.equal(d.allow, true, role); }
    else assert.equal(d.allow, false, `${role} may not run the drill`);
  }
  assert.deepEqual(open.sort(), ['builder', 'spike-researcher']);
  // only the Reality Checker's brief holds the group
  for (const role of roles) assert.equal(/^lane_bash:.*\boutage-drill\b/m.test(brief(role)), role === 'reality-checker', role);
  // the open lanes run it in their role session, and the script refuses before any read, schedule or cut
  const { harness } = require('./testing/role-harness.js');
  const h = harness();
  const cmd = `node ${path.join(__dirname, 'outage-drill.js')} run --record ${REC} --cut-minutes 30 --restart`;
  for (const inst of ['builder-1', 'spike-researcher']) {
    const b = h.bash(inst, cmd);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /run is the Reality Checker's \(role (builder|spike-researcher)\)/);
  }
  assert.ok(h.bash('product-manager', cmd, { run: false }).deny);
  assert.equal(h.bash('reality-checker', cmd, { run: false }).deny, null);
  assert.equal(h.bash('reality-checker', `node ${path.join(__dirname, 'outage-drill.js')} plan`, { run: false }).deny, null);
});
