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
// The owner's record of this drill: verified, scoped to a drill on this host, and in the owner's own words
// naming the cut and the restart. Each part can be changed to show the consent refused without it.
const QUOTE = 'Yes, cut the network for 30 minutes and restart the machine once';
const drillRecord = ({ labels = ['outage-drill:pc'], quote = QUOTE, text, asked } = {}) => (root, id) => (id === REC
  ? { ok: true, chain: [{ kind: 'decision', scope: { beads: [], labels }, quote }, { kind: 'input', source: 'human', text: text === undefined ? quote : text, ...(asked ? { asked } : {}) }], notes: [] }
  : { ok: false, error: 'not found' });
const verifyRecord = drillRecord();
const scratchDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function setup() {
  const dir = scratchDir('drill-');
  const events = [];
  const exec = (args) => {
    const kind = args.includes('systemd-run') ? `schedule ${(/--unit=delivery-drill-(\w+)-/.exec(args.join(' ')) || [])[1]}` : args.includes('stop') ? 'stop' : args.includes('off') ? 'cut' : 'other';
    events.push({ kind, args, rowWritten: L.drillOf(dir, REC) !== null });
    return { status: 0, stdout: '', stderr: '' };
  };
  const run = (argv, extra = {}) => D.main(argv, { cwd: dir, env: { DELIVERY_HOST: 'pc' }, now: NOW, exec, ps: () => '', verifyRecord: (r, id, opts) => { events.push({ kind: 'verify', id, opts }); return verifyRecord(r, id); }, who: { root: dir, roleId: 'reality-checker', actor: 'dev@pc/reality-checker' }, ...extra });
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
  assert.equal(u.run(['run', '--record', REC, '--cut-minutes', '5', '--restart'], { env: { DELIVERY_HOST: 'pc', DELIVERY_DRILL_PRIVILEGE: 'pkexec' } }).code, 0);
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

// Two runs at once: both would find no drill row yet and both would schedule a restart. The record is
// claimed before anything is scheduled, so the second run started while the first is still scheduling
// is refused; a run that fails before its row is written gives the claim back for a retry.
test('a run started while another run on the record is still scheduling is refused; a run that failed before its row gives the record back', () => {
  const t = setup();
  let inner = null;
  const exec = (args) => {
    if (!inner && args.includes('systemd-run')) inner = t.run(RUN, { exec: () => ({ status: 0 }) });
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.equal(t.run(RUN, { exec }).code, 0);
  assert.equal(inner.code, 1);
  assert.match(inner.out, /another run on .* is under way or done; one drill per consent, nothing scheduled or cut/);
  // a schedule that fails: nothing is cut, and the record can be used by a retry
  const u = setup();
  const failing = u.run(RUN, { exec: () => ({ status: 1, stderr: 'no system manager' }) });
  assert.equal(failing.code, 1);
  assert.match(failing.out, /could not schedule the restore/);
  assert.equal(u.run(RUN).code, 0, 'the retry runs');
});

// The claim must be one exclusive create, not a check and then a write: two runs that both check before
// either writes would both find the record free. A forced interleave through an injected fs runs the
// second run in the gap, right after the first run's first look at the claim file (any read, stat or
// existence check returns first, then the other run goes), or right before its write. Exactly one run may
// schedule and cut.
test('two runs racing on one record: the exclusive claim lets exactly one schedule and cut', () => {
  const t = setup();
  const claimPath = L.claimFile(t.root, REC);
  const cuts = [];
  const execOf = (who) => (args) => { if (args.includes('off')) cuts.push(who); return { status: 0, stdout: '', stderr: '' }; };
  let raced = null;
  const race = () => { if (!raced) { raced = { pending: true }; raced = t.run(RUN, { exec: execOf('second'), fs }); } };
  const READS = ['existsSync', 'statSync', 'lstatSync', 'accessSync', 'readFileSync', 'readdirSync'];
  const racing = new Proxy(fs, {
    get(target, prop) {
      const real = target[prop];
      if (typeof real !== 'function') return real;
      return (...args) => {
        const onClaim = args.some((a) => typeof a === 'string' && path.resolve(a) === claimPath);
        if (!onClaim) return real.apply(target, args);
        if (READS.includes(prop)) {
          let out; let err = null;
          try { out = real.apply(target, args); } catch (e) { err = e; }
          race();
          if (err) throw err;
          return out;
        }
        race();
        return real.apply(target, args);
      };
    },
  });
  const first = t.run(RUN, { exec: execOf('first'), fs: racing });
  assert.ok(raced && !raced.pending, 'the second run ran in the gap');
  const codes = [first.code, raced.code].sort();
  assert.deepEqual(codes, [0, 1], `${first.out}\n${raced.out}`);
  assert.equal(cuts.length, 1, 'one cut');
  assert.match([first.out, raced.out].join('\n'), /another run on .* is under way or done; one drill per consent, nothing scheduled or cut/);
  assert.equal(L.drills(t.root).filter((x) => x.type === 'drill').length, 1, 'one drill row');
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

// A verified owner record is not consent to this drill unless it is for this drill on this host and the
// owner's own words name the cut and the restart: any other verified owner record (an approval of a
// pull request, a budget) would otherwise cut the network and restart the machine.
test('only a record scoped to a drill on this host, whose owner words name the cut and the restart with no negation, is consent', () => {
  const refused = (vr, why, env) => {
    const t = setup();
    const r = t.run(RUN, { verifyRecord: vr, ...(env ? { env } : {}) });
    assert.equal(r.code, 1, why);
    assert.match(r.out, why);
    assert.deepEqual(t.events.filter((e) => e.kind !== 'verify'), [], 'nothing scheduled or cut');
    assert.equal(fs.existsSync(L.ledgerFile(t.root)), false);
  };
  // an unrelated verified owner record: the owner's word, but about something else
  refused(drillRecord({ labels: ['permission:builder=gh pr close'], quote: 'Yes, let builders close their own pull requests' }), /not scoped to a drill on this host \(its scope needs the label outage-drill:pc\)/);
  // scoped to a drill on another host
  refused(drillRecord({ labels: ['outage-drill:other'] }), /needs the label outage-drill:pc/);
  refused(drillRecord(), /needs the label outage-drill:elsewhere/, { DELIVERY_HOST: 'elsewhere' });
  // scoped right, but the owner's words do not name both
  refused(drillRecord({ quote: 'Yes, restart the machine once' }), /do not name the network cut/);
  refused(drillRecord({ quote: 'Yes, cut the network for 30 minutes' }), /do not name the restart/);
  // the owner said no
  refused(drillRecord({ quote: 'Do not cut the network or restart the machine' }), /carry a negation/);
  // the owner answered a confirmation: the question shown names the cut and the restart, the answer picked is the record
  const asked = (answer, question = 'May the team cut the network on pc for 30 minutes and restart the machine once?') => ({ contract: 'delivery.confirmation/1', question, choices: ['Yes, once (Recommended)', 'No'], multi_select: false, answer });
  const ok = setup();
  assert.equal(ok.run(RUN, { verifyRecord: drillRecord({ quote: 'Yes, once (Recommended)', asked: asked('Yes, once (Recommended)') }) }).code, 0, 'a yes to a confirmation that names both is consent');
  refused(drillRecord({ quote: 'No', asked: asked('No') }), /carry a negation/);
  refused(drillRecord({ quote: 'Yes, once (Recommended)', asked: asked('Yes, once (Recommended)', 'May the team restart the machine once?') }), /do not name the network cut/);
  // a yes to a question that negates the cut or the restart is no consent to the drill, as negated owner words are not
  for (const q of ['May the team cut the network on pc for 30 minutes, but do not restart the machine?', 'May the team restart the machine once, without cutting the network?',
    'May the team cut the network for 30 minutes and restart the machine? Never on a weekday.']) {
    refused(drillRecord({ quote: 'Yes, once (Recommended)', asked: asked('Yes, once (Recommended)', q) }), /the question the owner answered in .* carries a negation/);
  }
  // the captured answer must be the input itself: a confirmation whose answer is not what the owner sent does not count
  refused(drillRecord({ quote: 'Yes, once (Recommended)', text: 'Yes, once (Recommended)', asked: asked('No') }), /do not name the network cut/);
  // the record still verifies as before, and plan says why a record is refused
  const p = setup();
  assert.match(p.run(['plan', '--record', REC], { verifyRecord: drillRecord({ labels: [] }), ps: () => '' }).out, new RegExp(`consent: ${REC} refused: ${REC} is not scoped to a drill on this host`));
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

// A schedule reported as failed (a non-zero exit, a timeout, a throw) may still have made its unit: the
// undo stops the unit of the kind that failed as well as the ones made before it, the restart first, so no
// restart stays scheduled after an abort.
test('a schedule that fails never cuts, and undoes the timer made before it and the one that failed', () => {
  for (const failOn of ['restore', 'restart']) {
    for (const how of ['exit', 'throw']) {
      const t = setup();
      const calls = [];
      const exec = (args) => {
        calls.push(args.join(' '));
        const failing = args.join(' ').includes(`drill-${failOn}-`) && args.includes('systemd-run');
        if (failing && how === 'throw') throw new Error('Interactive authentication required.');
        return { status: failing ? 1 : 0, stderr: 'Interactive authentication required.' };
      };
      const r = t.run(RUN, { exec });
      assert.equal(r.code, 1);
      assert.match(r.out, new RegExp(`could not schedule the ${failOn} \\(.*Interactive authentication required.\\); nothing cut`));
      assert.ok(!calls.some((c) => / networking off$/.test(c)), 'never cut');
      const stops = calls.filter((c) => / systemctl stop /.test(c));
      const unit = (k) => ['sudo', '-n', 'systemctl', 'stop', `delivery-drill-${k}-${REC}.timer`].join(' ');
      assert.deepEqual(stops, failOn === 'restart' ? [unit('restart'), unit('restore')] : [unit('restore')], `${failOn} ${how}: the failed kind's unit is stopped too, the restart first`);
      assert.equal(L.drillOf(t.root, REC), null, 'the consent is not spent');
    }
  }
});

// A cut that exits non-zero, or is killed at the 30-second limit, may still have taken the network down.
// The restart is stopped (the consent is a restart after a drill, not after a failed one), but the restore
// is not: it runs at once, through the same privilege, and its timer stays as the backstop in case the
// network went down after the restore ran or the restore itself failed.
test('a cut that fails or times out stops the restart timer, runs the restore at once and keeps the restore timer', () => {
  const timedOut = () => ({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync sudo ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  const cases = [['exits non-zero', () => ({ status: 1, stderr: 'Error: NetworkManager is not running.' })], ['times out', timedOut], ['throws', () => { throw new Error('spawn failed'); }]];
  for (const [label, cutResult] of cases) {
    for (const restoreOk of [true, false]) {
      const t = setup();
      const calls = [];
      const exec = (args) => {
        const c = args.join(' ');
        calls.push(c);
        if (/ networking off$/.test(c)) return cutResult();
        if (/^sudo -n nmcli networking on$/.test(c)) return restoreOk ? { status: 0 } : { status: 1, stderr: 'restore refused' };
        return { status: 0, stderr: '' };
      };
      const r = t.run(RUN, { exec });
      assert.equal(r.code, 1, label);
      const cutAt = calls.findIndex((c) => / networking off$/.test(c));
      const after = calls.slice(cutAt + 1);
      assert.ok(after.includes(`sudo -n systemctl stop delivery-drill-restart-${REC}.timer`), `${label}: the restart timer is stopped`);
      assert.ok(!after.some((c) => c.includes(`stop delivery-drill-restore-${REC}`)), `${label}: the restore timer is kept`);
      assert.ok(after.includes('sudo -n nmcli networking on'), `${label}: the restore runs at once`);
      assert.ok(after.indexOf(`sudo -n systemctl stop delivery-drill-restart-${REC}.timer`) < after.indexOf('sudo -n nmcli networking on'), `${label}: the restart is stopped first`);
      assert.match(r.out, /the cut failed .* the restart timer is stopped and the host does not restart/, label);
      assert.match(r.out, restoreOk ? /The network restore ran at once/ : /The network restore at once failed \(restore refused\)/, label);
      assert.match(r.out, new RegExp(`the restore timer stays: the network comes back by 2026-11-07T10:30:00.000Z \\(delivery-drill-restore-${REC}.timer\\)`), label);
      const rows = L.drills(t.root);
      assert.deepEqual(rows.map((x) => x.type), ['drill', 'cut_failed'], label);
      assert.equal(rows[1].restore_now, restoreOk ? 'ok' : 'failed', label);
    }
  }
});

// A run killed between its claim and its row (the session dropped, the host lost power) leaves the claim,
// and every later run on the record is refused. plan shows each claim, its age and the run that made it,
// and how to clear it, and says when a drill row spends the record anyway.
test('plan shows a claim left on a record: its age, the run that made it, and how to clear it', () => {
  const t = setup();
  assert.match(t.run(['plan']).out, /claims: none/);
  const file = L.claimFile(t.root, REC);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ record: REC, at: '2026-11-07T08:00:00.000Z', by: 'dev@pc/reality-checker', pid: 4242 })}\n`);
  const other = L.claimFile(t.root, 'dec-x-2');
  fs.writeFileSync(other, 'not json\n');
  const before = fs.readdirSync(path.dirname(file)).sort();
  for (const argv of [['plan'], ['plan', '--record', REC]]) {
    const out = t.run(argv).out;
    assert.match(out, new RegExp(`claim: ${REC} claimed 120 minutes ago \\(2026-11-07T08:00:00.000Z\\) by dev@pc/reality-checker, pid 4242; a run on it is refused while the claim is there`), out);
    assert.ok(out.includes(`to clear it when no run on it is under way: rm ${file}`), out);
    assert.match(out, /claim: dec-x-2 claimed .* by an unknown run/, out);
    assert.ok(out.includes(`rm ${other}`), out);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), before, 'plan removes nothing');
  // a run is refused while the claim is there; plan says a drill row spends the record whatever the claim
  assert.match(t.run(RUN).out, /another run on .* is under way or done/);
  fs.unlinkSync(file);
  assert.equal(t.run(RUN).code, 0, 'cleared, the record runs');
  const out = t.run(['plan']).out;
  assert.match(out, new RegExp(`claim: ${REC} claimed 0 minutes ago .*; its drill row spends the record, so clearing the claim does not free it`), out);
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
