// scripts/outage-drill.test.js — the outage drill: the lane gives run to the Reality Checker only, the
// consent record must verify and is spent by one drill, the restore and the restart are scheduled in
// system timers before the cut, and plan starts nothing. Every command is a stub: no test cuts the
// network, schedules a timer or restarts the host.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('./outage-drill.js');
const L = require('./lib/outage-drill.js');

const REC = 'dec-chief-of-staff-91';
const NOW = '2026-11-07T10:00:00.000Z';
// The drill bead and its direct story (hjx.1.6.6's story is hjx.1.6), and the Delivery Manager's label on
// the bead: it names the host AND the exact consent record (rv-229 B1), so the run accepts only that record.
const BEAD = 'delivery-plugin-planning-hjx.1.6.6';
const STORY = 'delivery-plugin-planning-hjx.1.6';
const DRILL_LABEL = `outage-drill:pc:${REC}`;
const beadLabelsOk = (b) => ({ labels: b === BEAD ? [DRILL_LABEL] : [] });
// The owner's record of this drill: verified, scoped to the drill bead, and in the owner's own words naming
// the cut and the restart. Each part can be changed to show the consent refused without it. The record's
// own scope labels no longer authorise the drill (rv-229 B1); the bead's exact-record label does.
const QUOTE = 'Yes, cut the network for 30 minutes and restart the machine once';
const drillRecord = ({ labels = [], beads = [BEAD], quote = QUOTE, text, asked } = {}) => (root, id) => (id === REC
  ? { ok: true, chain: [{ kind: 'decision', scope: { beads, labels }, quote }, { kind: 'input', source: 'human', text: text === undefined ? quote : text, ...(asked ? { asked } : {}) }], notes: [] }
  : { ok: false, error: 'not found' });
const verifyRecord = drillRecord();
const scratchDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// run is the Reality Checker's, read from this process's own working directory and role variables, never
// from what a caller passes. The tests that call main in this process therefore run from the Reality
// Checker's directory of a role harness, with its variables, and put the process back afterwards.
const SAVED = { cwd: process.cwd(), DELIVERY_ROLE: process.env.DELIVERY_ROLE, DELIVERY_ROLE_DIR: process.env.DELIVERY_ROLE_DIR, DELIVERY_ROLE_ID: process.env.DELIVERY_ROLE_ID };
const RC_HARNESS = require('./testing/role-harness.js').harness();
process.chdir(RC_HARNESS.roleDir('reality-checker'));
process.env.DELIVERY_ROLE = 'reality-checker';
process.env.DELIVERY_ROLE_DIR = RC_HARNESS.roleDir('reality-checker');
delete process.env.DELIVERY_ROLE_ID;
test.after(() => {
  process.chdir(SAVED.cwd);
  for (const k of ['DELIVERY_ROLE', 'DELIVERY_ROLE_DIR', 'DELIVERY_ROLE_ID']) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

function setup() {
  const dir = scratchDir('drill-');
  const events = [];
  const exec = (args) => {
    const kind = args.includes('systemd-run') ? `schedule ${(/--unit=delivery-drill-(\w+)-/.exec(args.join(' ')) || [])[1]}` : args.includes('stop') ? 'stop' : args.includes('off') ? 'cut' : 'other';
    events.push({ kind, args, rowWritten: L.drillOf(dir, REC) !== null });
    return { status: 0, stdout: '', stderr: '' };
  };
  // The drill now needs --bead and the bead's exact-record label (rv-229 B1). The default harness is the
  // happy path, so a run/plan with a record but no --bead gets the drill bead and its label injected; a test
  // that passes its own --bead (the rv-229 cases) opts out and supplies its own bead labels, or lets the
  // real bd read them.
  const run = (argv, extra = {}) => {
    const bare = (argv[0] === 'run' || argv[0] === 'plan') && argv.includes('--record') && !argv.includes('--bead');
    const finalArgv = bare ? [...argv, '--bead', BEAD] : argv;
    const base = { cwd: dir, env: { DELIVERY_HOST: 'pc' }, hostname: 'pc', now: NOW, exec, ps: () => '', verifyRecord: (r, id, opts) => { events.push({ kind: 'verify', id, opts }); return verifyRecord(r, id); }, who: { root: dir, roleId: 'reality-checker', actor: 'dev@pc/reality-checker' } };
    if (bare) base.beadLabels = beadLabelsOk;
    return D.main(finalArgv, { ...base, ...extra });
  };
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
  assert.deepEqual(restart.args, ['sudo', '-n', 'systemd-run', '--on-active=1860s', '--timer-property=AccuracySec=1s', `--unit=delivery-drill-restart-${REC}`, `--description=delivery outage drill restart (${REC})`, '/bin/sh', '-c', 'nmcli networking on; systemctl reboot']);
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
    // a DELIVERY_HOST of another host is that machine here: the host check passes and the label decides
    const r = t.run(RUN, { verifyRecord: vr, ...(env ? { env, hostname: env.DELIVERY_HOST } : {}) });
    assert.equal(r.code, 1, why);
    assert.match(r.out, why);
    assert.deepEqual(t.events.filter((e) => e.kind !== 'verify'), [], 'nothing scheduled or cut');
    assert.equal(fs.existsSync(L.ledgerFile(t.root)), false);
  };
  // an unrelated verified owner record: the owner's word, but scoped to another bead, so the drill bead's
  // exact-record label does not name it (the default harness injects the drill bead and its label)
  refused(drillRecord({ beads: ['delivery-plugin-planning-other.9'], quote: 'Yes, let builders close their own pull requests' }), /is not scoped to delivery-plugin-planning-hjx\.1\.6\.6 or its direct story/);
  // the drill is for another host: the bead's label names pc, not the running host
  refused(drillRecord(), /does not carry outage-drill:elsewhere:/, { DELIVERY_HOST: 'elsewhere' });
  // scoped right, but the owner's words do not name both (the label is the authority; the words are a second filter)
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
  assert.match(p.run(['plan', '--record', REC], { verifyRecord: drillRecord({ beads: [] }), ps: () => '' }).out, new RegExp(`consent: ${REC} refused: ${REC} is not scoped to`));
});

// hjx.1.6.6.4 / rv-229 B1: the Delivery Manager, who reads the owner's words, puts the label
// outage-drill:<host>:<record id> on the drill bead (--bead). The run accepts ONLY the record that label
// names, on this host, read from bd and never trusted from the caller; the record must still verify, not be
// revoked or superseded, and be scoped to the bead or its direct story. The wording check is a second
// filter only, never the authority (it had passed sentences that merely reported an outage).
test('hjx.1.6.6.4: the drill bead\'s outage-drill:<host>:<record> label names the exact consent, read from bd; only that record, on this host, scoped to the bead or its story, runs', () => {
  const beadRec = (beads, quote) => drillRecord({ beads, ...(quote ? { quote } : {}) });
  const labelFor = (rec, host = 'pc', want = BEAD) => (b) => ({ labels: b === want ? [`outage-drill:${host}:${rec}`] : [] });
  // the bead carries outage-drill:pc:<REC> and the record is scoped to the bead: consent
  assert.equal(setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD]), beadLabels: labelFor(REC) }).code, 0, 'the exact-record label, record scoped to the bead');
  // scoped to the direct story (one level up) is consent too
  assert.equal(setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([STORY]), beadLabels: labelFor(REC) }).code, 0, 'record scoped to the direct story');

  // a label naming ANOTHER record is refused: the run accepts only the record its label names
  const other = setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD]), beadLabels: labelFor('dec-chief-of-staff-000777') });
  assert.equal(other.code, 1, 'a label naming another record does not authorise this one');
  assert.match(other.out, new RegExp(`does not carry outage-drill:pc:${REC}`));
  // a label naming ANOTHER host is refused (this catches dropping the host from the label)
  const otherHost = setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD]), beadLabels: labelFor(REC, 'e2') });
  assert.equal(otherHost.code, 1, 'a label for another host does not authorise this one');
  assert.match(otherHost.out, new RegExp(`does not carry outage-drill:pc:${REC}`));

  // rv-229 F1/F3: the caller's --bead is not trusted. Each probe named a bead with no exact-record label,
  // so each is refused; before the fix they reached the real commands.
  const nolabel = () => ({ labels: [] });
  assert.equal(setup().run([...RUN, '--bead', 'delivery-plugin-planning-zzz.9'], { verifyRecord: beadRec(['delivery-plugin-planning-zzz.9']), beadLabels: nolabel }).code, 1, 'a1 unrelated bead');
  assert.equal(setup().run([...RUN, '--bead', 'delivery-plugin-planning-zzz.9.invented'], { verifyRecord: beadRec(['delivery-plugin-planning-zzz.9.invented']), beadLabels: nolabel }).code, 1, 'a2 invented bead');
  assert.equal(setup().run([...RUN, '--bead', 'delivery-plugin-planning-hjx'], { verifyRecord: beadRec(['delivery-plugin-planning-hjx']), beadLabels: nolabel }).code, 1, 'b3 broad bead hjx');
  assert.equal(setup().run([...RUN, '--bead', 'delivery-plugin-planning-hjx.1.x'], { verifyRecord: beadRec(['delivery-plugin-planning-hjx.1']), beadLabels: nolabel }).code, 1, 'b4 broad bead hjx.1.x');

  // the bead carries the exact-record label but the record names neither the bead nor its direct story
  assert.equal(setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec(['delivery-plugin-planning-other.9']), beadLabels: labelFor(REC) }).code, 1, 'record scoped to an unrelated bead');
  // a broader ancestor than the direct story is refused even when the bead carries the label
  for (const broad of ['delivery-plugin-planning-hjx.1', 'delivery-plugin-planning-hjx']) {
    assert.equal(setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([broad]), beadLabels: labelFor(REC) }).code, 1, `broad ancestor ${broad}`);
  }

  // without --bead there is no bead whose label could authorise the run (the harness does not inject one
  // because --bead is given here via a direct main call): refused
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-'));
  const nobead = D.main(['run', '--record', REC, '--cut-minutes', '30', '--restart'], { cwd: dir, env: { DELIVERY_HOST: 'pc' }, hostname: 'pc', now: NOW, exec: () => ({ status: 0 }), ps: () => '', verifyRecord: beadRec([BEAD]), who: { root: dir, roleId: 'reality-checker', actor: 'dev@pc/reality-checker' } });
  assert.equal(nobead.code, 1, 'no --bead, nothing authorises the run');
  assert.match(nobead.out, /needs --bead/);

  // the bead cannot be read: fail closed
  const unread = setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD]), beadLabels: () => ({ error: 'bd timed out' }) });
  assert.equal(unread.code, 1, 'an unreadable bead fails closed');
  assert.match(unread.out, /could not be read \(bd timed out\)/);

  // the wording stays a second filter: the exact-record label is present and the record is scoped, but the
  // owner's words do not name the cut, so the drill is still refused
  assert.match(setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD], 'Yes, restart the machine once'), beadLabels: labelFor(REC) }).out, /do not name the network cut/);
  // a revoked consent is refused even with the exact-record label (the withdrawal is read from verify's notes)
  const revoked = (root, id) => { const base = drillRecord({ beads: [BEAD] })(root, id); return id === REC ? { ...base, notes: [`${REC} was revoked by the owner`] } : base; };
  const rev = setup().run([...RUN, '--bead', BEAD], { verifyRecord: revoked, beadLabels: labelFor(REC) });
  assert.equal(rev.code, 1, 'a revoked consent is refused');
  assert.match(rev.out, /was revoked/);

  // the reviewer's round-3 sentences only reported an outage or asked to restart a billing job; with a label
  // that names ANOTHER record they are refused by the label gate, before the wording is ever consulted. This
  // is the point of B1: the label is the authority, the words are not.
  for (const w of ['Yes, the network was cut last night so restart the billing job', 'the network is offline, please restart the host', 'Yes, once (Recommended)']) {
    const r = setup().run([...RUN, '--bead', BEAD], { verifyRecord: beadRec([BEAD], w), beadLabels: labelFor('dec-chief-of-staff-000777') });
    assert.equal(r.code, 1, `report-only words with a label for another record: ${w}`);
    assert.match(r.out, new RegExp(`does not carry outage-drill:pc:${REC}`));
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
      assert.equal(rows[1].restart_stopped, true, label);
    }
  }
});

// A stop is checked like any other step (rv-218): one that exits non-zero, times out or throws may leave
// its timer pending, so the reply names that unit instead of saying it was stopped, and the other
// direction still says stopped.
test('a stop that fails is reported with its unit as possibly still scheduled, after a failed schedule and after a failed cut', () => {
  const timedOut = () => ({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync sudo ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  const stopFails = [['exits non-zero', () => ({ status: 5, stderr: 'Failed to stop' })], ['times out', timedOut], ['throws', () => { throw new Error('spawn failed'); }]];
  for (const [label, stopResult] of stopFails) {
    // a failed schedule of the restart: both stops fail, both units are named, the restart first
    const t = setup();
    const exec = (args) => {
      const c = args.join(' ');
      if (/ systemctl stop /.test(c)) return stopResult();
      if (c.includes('systemd-run') && c.includes(`drill-restart-${REC}`)) return { status: 1, stderr: 'Interactive authentication required.' };
      return { status: 0, stderr: '' };
    };
    const r = t.run(RUN, { exec });
    assert.equal(r.code, 1, label);
    assert.match(r.out, /could not schedule the restart .*; nothing cut/, label);
    assert.match(r.out, new RegExp(`the restart may still be scheduled: delivery-drill-restart-${REC}\\.timer, and the restore may still be scheduled: delivery-drill-restore-${REC}\\.timer\\. Run outage-drill\\.js stop --record ${REC} now\\.`), label);
    // a failed cut whose restart stop fails: the reply says the host may still restart, and when
    const c2 = setup();
    const exec2 = (args) => {
      const c = args.join(' ');
      if (/ networking off$/.test(c)) return { status: 1, stderr: 'Error: NetworkManager is not running.' };
      if (/ systemctl stop /.test(c)) return stopResult();
      return { status: 0, stderr: '' };
    };
    const r2 = c2.run(RUN, { exec: exec2 });
    assert.equal(r2.code, 1, label);
    assert.doesNotMatch(r2.out, /the restart timer is stopped/, label);
    assert.match(r2.out, new RegExp(`stopping the restart did not go through, so the restart may still be scheduled: delivery-drill-restart-${REC}\\.timer; run outage-drill\\.js stop --record ${REC} now, or the host restarts at 2026-11-07T10:31:00.000Z`), label);
    assert.equal(L.drills(c2.root)[1].restart_stopped, false, label);
  }
  // the other direction: stops that go through name no pending unit
  const t = setup();
  const r = t.run(RUN, { exec: (args) => (args.join(' ').includes(`systemd-run`) && args.join(' ').includes(`drill-restart-${REC}`) ? { status: 1, stderr: 'no' } : { status: 0, stderr: '' }) });
  assert.doesNotMatch(r.out, /may still be scheduled/);
});

// stop is the step a run that could not confirm its stop asks for: it stops that drill's restart timer
// only (the restore only brings the network back), says so, and says when the stop did not go through.
test('stop stops the restart timer only, reports a stop that fails, and needs a record', () => {
  for (const [label, result, code, out] of [
    ['goes through', () => ({ status: 0 }), 0, new RegExp(`stopped delivery-drill-restart-${REC}\\.timer; the host does not restart for this drill`)],
    ['exits non-zero', () => ({ status: 1, stderr: 'Failed to stop' }), 1, new RegExp(`could not stop delivery-drill-restart-${REC}\\.timer \\(Failed to stop\\); it may still restart the host`)],
    ['throws', () => { throw new Error('spawn failed'); }, 1, /could not stop .* \(spawn failed\)/],
    // a record whose drill never ran: the unit is not loaded (exit 5, or systemd says so), so nothing is
    // scheduled and nobody is sent to the owner (rv-218)
    ['exit 5 not loaded', () => ({ status: 5, stderr: 'Failed to stop delivery-drill-restart-x.timer: Unit delivery-drill-restart-x.timer not loaded.' }), 0, new RegExp(`no drill restart is scheduled for ${REC} \\(delivery-drill-restart-${REC}\\.timer is not loaded\\); nothing to stop`)],
    ['not found text', () => ({ status: 1, stderr: 'Unit delivery-drill-restart-x.timer not found.' }), 0, /no drill restart is scheduled/],
  ]) {
    const t = setup();
    const calls = [];
    const r = t.run(['stop', '--record', REC], { exec: (args) => { calls.push(args.join(' ')); return result(); }, who: { root: t.root, roleId: 'builder' } });
    assert.equal(r.code, code, label);
    assert.match(r.out, out, label);
    assert.deepEqual(calls, [`sudo -n systemctl stop delivery-drill-restart-${REC}.timer`], `${label}: the restart alone is stopped`);
  }
  assert.equal(setup().run(['stop']).code, 2);
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

test('the lane gives outage-drill.js run to the Reality Checker only, the open lanes included; plan stays open', () => {
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
    if (role === 'reality-checker') { assert.equal(d.allow, true, d.reason); continue; }
    assert.equal(d.allow, false, `${role} may not run the drill`);
    assert.match(d.reason, /the outage drill's run cuts this host's network and restarts it: it is the Reality Checker's/, role);
    if (/^lane_bash: any$/m.test(brief(role))) {
      open.push(role);
      const p = decideLane({ toolName: 'Bash', toolInput: { command: `node ${PLUGIN_ROOT}/scripts/outage-drill.js plan --record ${REC}` }, policy, roleDir: laneDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
      assert.equal(p.allow, true, `${role}: plan`);
    }
  }
  assert.deepEqual(open.sort(), ['builder', 'spike-researcher']);
  // only the Reality Checker's brief holds the group
  for (const role of roles) assert.equal(/^lane_bash:.*\boutage-drill\b/m.test(brief(role)), role === 'reality-checker', role);
  // in role sessions, through the real hooks: the open lanes are refused run and keep plan
  const { harness } = require('./testing/role-harness.js');
  const h = harness();
  const script = path.join(__dirname, 'outage-drill.js');
  const cmd = `node ${script} run --record ${REC} --cut-minutes 30 --restart`;
  for (const inst of ['builder-1', 'spike-researcher', 'product-manager']) assert.match(String(h.bash(inst, cmd, { run: false }).deny), /outage drill's run/, inst);
  const plan = h.bash('builder-1', `node ${script} plan`);
  assert.equal(plan.deny, null);
  assert.equal(plan.code, 0, plan.out);
  assert.match(plan.out, /Outage drill plan \(nothing is started, scheduled or written\)/);
  assert.equal(h.bash('reality-checker', cmd, { run: false }).deny, null);
  assert.equal(h.bash('reality-checker', `node ${script} plan`, { run: false }).deny, null);
});

// main takes an injected who for its tests, so code run past the lane (a file of its own, node -e) could
// name itself the Reality Checker. The script also reads the process's own role session: in a builder's
// session the run is refused whatever who says; in the Reality Checker's it runs. Every command is a stub.
test('the script refuses run in any role session but the Reality Checker\'s, whatever role the caller passes', () => {
  const { harness } = require('./testing/role-harness.js');
  const h = harness();
  const dir = scratchDir('drill-own-');
  const child = path.join(dir, 'call-main.js');
  fs.writeFileSync(child, [
    `const D = require(${JSON.stringify(path.join(__dirname, 'outage-drill.js'))});`,
    `const root = ${JSON.stringify(dir)};`,
    'const cmds = [];',
    `const BEAD = 'delivery-plugin-planning-hjx.1.6.6';`,
    `const verifyRecord = (r, id) => ({ ok: true, chain: [{ kind: 'decision', scope: { beads: [BEAD], labels: [] }, quote: ${JSON.stringify(QUOTE)} }, { kind: 'input', source: 'human', text: ${JSON.stringify(QUOTE)} }], notes: [] });`,
    `const beadLabels = (b) => ({ labels: b === BEAD ? ['outage-drill:pc:' + ${JSON.stringify(REC)}] : [] });`,
    `const r = D.main(['run', '--record', ${JSON.stringify(REC)}, '--cut-minutes', '30', '--restart', '--bead', BEAD], { env: { DELIVERY_HOST: 'pc' }, hostname: 'pc', now: ${JSON.stringify(NOW)}, verifyRecord, beadLabels, exec: (a) => { cmds.push(a.join(' ')); return { status: 0 }; }, ps: () => '', who: { root, roleId: 'reality-checker', actor: 'x' } });`,
    'process.stdout.write(JSON.stringify({ code: r.code, out: r.out, cmds }));',
  ].join('\n'));
  const { spawnSync } = require('child_process');
  const asRole = (inst) => {
    const env = { ...process.env, DELIVERY_ROLE: inst, DELIVERY_ROLE_DIR: h.roleDir(inst) };
    const r = spawnSync(process.execPath, [child], { cwd: h.roleDir(inst), env, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(r.stdout || '{}');
  };
  for (const inst of ['builder-1', 'spike-researcher']) {
    const r = asRole(inst);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /run is the Reality Checker's \(this process runs in a role (builder|spike-researcher) session\)/, inst);
    assert.deepEqual(r.cmds, [], `${inst}: nothing scheduled or cut`);
  }
  fs.rmSync(path.join(dir, '.delivery'), { recursive: true, force: true });
  const rc = asRole('reality-checker');
  assert.equal(rc.code, 0, rc.out);
  assert.equal(rc.cmds.length, 3, 'the stubs saw the two schedules and the cut');
});

// rv-206: the drill is run in every spelling only by the Reality Checker's lane; a role variable set in
// front of a script cannot make it one; plain mentions (a diff, a cat, a test run of its file) stay open
test('the lane refuses the drill run in every spelling and role variables naming the Reality Checker in front of a command; plan and mentions stay open', () => {
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const PLUGIN_ROOT = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const laneDir = scratchDir('drill-lane2-');
  const S = `${PLUGIN_ROOT}/scripts`;
  const R = `run --record ${REC} --cut-minutes 30 --restart`;
  const decide = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` }), roleDir: laneDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
  const refused = [
    `node ${S}/outage-drill ${R}`,
    `node ${S}/outage-drill.cjs ${R}`,
    `node ${S}/outage-dri*.js ${R}`,
    `node ${S}/outage-?rill.js ${R}`,
    `node ${S}/out[a]ge-drill.js ${R}`,
    `node ${S}/o*.js ${R}`,
    `DELIVERY_ROLE=reality-checker node ${laneDir}/x.js ${R}`,
    `env DELIVERY_ROLE=reality-checker DELIVERY_ROLE_DIR=/r node ${laneDir}/x.js run`,
    `DELIVERY_ROLE_DIR=/elsewhere/reality-checker node ${laneDir}/x.js`,
    `export DELIVERY_ROLE=reality-checker; node ${laneDir}/x.js run`,
  ];
  const allowed = [
    `node ${S}/outage-drill.js plan --record ${REC}`,
    `cat ${S}/outage-drill.js`,
    `DELIVERY_TEST_FILES=${S}/outage-drill.test.js node ${S}/testing/run-tests.js`,
    `git diff origin/main -- ${S}/outage-drill.js`,
    `grep -n "networking" ${S}/lib/outage-drill.js`,
    `DELIVERY_ROLE= node ${laneDir}/x.js`,
  ];
  for (const role of ['builder', 'spike-researcher']) {
    for (const c of refused) {
      const d = decide(role, c);
      assert.equal(d.allow, false, `${role}: ${c}`);
      assert.match(String(d.reason), /outage drill's run/, `${role}: ${c}`);
    }
    for (const c of allowed) assert.equal(decide(role, c).allow, true, `${role}: ${c}`);
  }
});

// rv-206: the script takes its role from the role marker found from its own working directory, never
// from DELIVERY_ROLE_DIR, the variables must agree with that marker, and outside a role session it runs
// nothing. Each run is a child process, so the process's own directory and variables are the ones read.
test('the script reads its role from its own working directory\'s marker: a spoofed role directory, disagreeing variables or no role session run nothing', () => {
  const { harness } = require('./testing/role-harness.js');
  const h = harness();
  const dir = scratchDir('drill-own2-');
  const child = path.join(dir, 'call-main.js');
  fs.writeFileSync(child, [
    `const D = require(${JSON.stringify(path.join(__dirname, 'outage-drill.js'))});`,
    `const root = ${JSON.stringify(dir)};`,
    'const cmds = [];',
    `const BEAD = 'delivery-plugin-planning-hjx.1.6.6';`,
    `const verifyRecord = (r, id) => ({ ok: true, chain: [{ kind: 'decision', scope: { beads: [BEAD], labels: [] }, quote: ${JSON.stringify(QUOTE)} }, { kind: 'input', source: 'human', text: ${JSON.stringify(QUOTE)} }] });`,
    `const beadLabels = (b) => ({ labels: b === BEAD ? ['outage-drill:pc:' + ${JSON.stringify(REC)}] : [] });`,
    `const r = D.main(['run', '--record', ${JSON.stringify(REC)}, '--cut-minutes', '30', '--restart', '--bead', BEAD], { env: { DELIVERY_HOST: 'pc' }, hostname: 'pc', now: ${JSON.stringify(NOW)}, verifyRecord, beadLabels, exec: (a) => { cmds.push(a); return { status: 0, stdout: '', stderr: '' }; }, ps: () => '', who: { root, roleId: 'reality-checker', actor: 'x' } });`,
    'process.stdout.write(JSON.stringify({ code: r.code, out: r.out, cmds }));',
  ].join('\n'));
  const { spawnSync } = require('child_process');
  const base = { ...process.env };
  for (const k of ['DELIVERY_ROLE', 'DELIVERY_ROLE_DIR', 'DELIVERY_ROLE_ID']) delete base[k];
  const call = (cwd, env) => JSON.parse(spawnSync(process.execPath, [child], { cwd, env, encoding: 'utf8', timeout: 30000 }).stdout || '{}');
  const rcDir = h.roleDir('reality-checker');
  const cases = [
    ['a builder naming the Reality Checker and its directory', h.roleDir('builder-1'), { ...base, DELIVERY_ROLE: 'reality-checker', DELIVERY_ROLE_DIR: rcDir }],
    ['outside any role session', scratchDir('drill-nowhere-'), base],
    ['the Reality Checker directory with a builder variable', rcDir, { ...base, DELIVERY_ROLE: 'builder-1' }],
    ['the Reality Checker directory with no role variable', rcDir, base],
    ['the Reality Checker directory with another role directory named', rcDir, { ...base, DELIVERY_ROLE: 'reality-checker', DELIVERY_ROLE_DIR: h.roleDir('builder-1') }],
  ];
  for (const [what, cwd, env] of cases) {
    const r = call(cwd, env);
    assert.equal(r.code, 1, `${what}: ${r.out}`);
    assert.match(String(r.out), /run is the Reality Checker's/, what);
    assert.deepEqual(r.cmds, [], `${what}: nothing scheduled or cut`);
  }
  const rc = call(rcDir, { ...base, DELIVERY_ROLE: 'reality-checker', DELIVERY_ROLE_DIR: rcDir });
  assert.equal(rc.code, 0, rc.out);
  assert.equal(rc.cmds.length, 3, 'the two schedules and the cut');
});

// rv-206: NetworkManager keeps its networking state across a reboot, so a restore that failed would leave
// the host offline after it. The restart unit brings the network back itself, then reboots.
test('the restart unit turns networking on itself before it reboots', () => {
  const t = setup();
  assert.equal(t.run(RUN).code, 0);
  const restart = t.events.find((e) => e.kind === 'schedule restart');
  const tail = restart.args.slice(restart.args.indexOf(`--description=delivery outage drill restart (${REC})`) + 1);
  assert.deepEqual(tail, ['/bin/sh', '-c', 'nmcli networking on; systemctl reboot']);
});

// rv-206: DELIVERY_HOST names the host the consent is for; it must be this machine
test('a DELIVERY_HOST that is not this machine is refused by run and named by plan', () => {
  const t = setup();
  const r = t.run(RUN, { hostname: 'other-box' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /DELIVERY_HOST is pc, but this machine is other-box/);
  assert.deepEqual(t.events.filter((e) => e.kind !== 'verify'), [], 'nothing scheduled or cut');
  const p = t.run(['plan', '--record', REC], { hostname: 'other-box' });
  assert.match(p.out, /DELIVERY_HOST is pc, but this machine is other-box/);
  assert.equal(t.run(RUN, { hostname: 'pc.example.lan' }).code, 0, 'the short name is compared');
});

// rv-229 F5/F4: readBeadLabels reads the named bead through the real bd (a bd on PATH), so a mutant that
// ignores the read and always returns the label is caught (no label refuses, the label plus a bead-scoped
// record passes), and a bd that returns a different id than --bead fails closed.
test('rv-229 F5: the drill reads the --bead bead through the real bd; no label refuses, the label plus a bead-scoped record passes, a wrong id fails closed', () => {
  const BEAD = 'delivery-plugin-planning-hjx.1.6.6';
  const onPath = (id, labels) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-bd-'));
    fs.writeFileSync(path.join(dir, 'bd'), `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ id, labels })}\nJSON\n`, { mode: 0o755 });
    return { DELIVERY_HOST: 'pc', PATH: `${dir}${path.delimiter}${process.env.PATH}` };
  };
  const rec = (beads) => drillRecord({ labels: [], beads });
  assert.equal(setup().run([...RUN, '--bead', BEAD], { verifyRecord: rec([BEAD]), env: onPath(BEAD, []), hostname: 'pc' }).code, 1, 'no label on the bead is refused');
  const yes = setup().run([...RUN, '--bead', BEAD], { verifyRecord: rec([BEAD]), env: onPath(BEAD, [`outage-drill:pc:${REC}`]), hostname: 'pc' });
  assert.equal(yes.code, 0, `the real bd shows the label: ${yes.out}`);
  const wrong = setup().run([...RUN, '--bead', BEAD], { verifyRecord: rec([BEAD]), env: onPath('delivery-plugin-planning-other.1', [`outage-drill:pc:${REC}`]), hostname: 'pc' });
  assert.equal(wrong.code, 1, 'a bd that returns another bead than --bead fails closed');
  assert.match(wrong.out, /not the bead named/);
});

// rv-229 F7: the record's scope may name the drill bead or its direct story in short or full id form.
test('rv-229 F7: a scope naming the drill bead or its story in short or full form is consent', () => {
  const BEAD = 'delivery-plugin-planning-hjx.1.6.6';
  const labels = (b) => ({ labels: b === BEAD ? [`outage-drill:pc:${REC}`] : [] });
  for (const scopeBead of ['delivery-plugin-planning-hjx.1.6.6', 'hjx.1.6.6', 'delivery-plugin-planning-hjx.1.6', 'hjx.1.6']) {
    const r = setup().run([...RUN, '--bead', BEAD], { verifyRecord: drillRecord({ labels: [], beads: [scopeBead] }), beadLabels: labels });
    assert.equal(r.code, 0, `scope ${scopeBead} names the bead: ${r.out}`);
  }
});

// rv-229 F2: a record carrying the bead label but whose words only say the network WAS down (the billing
// sentence) does not consent to a cut; the real dec-299 confirmation question does.
test('rv-229 F2: "the network was down" is not consent to a cut; the real "cut its network ..." is', () => {
  const BEAD = 'delivery-plugin-planning-hjx.1.6.6';
  const labels = (b) => ({ labels: b === BEAD ? [`outage-drill:pc:${REC}`] : [] });
  const billing = setup().run([...RUN, '--bead', BEAD], { verifyRecord: drillRecord({ labels: [], beads: [BEAD], quote: 'Yes, the network was down so restart the billing job' }), beadLabels: labels });
  assert.equal(billing.code, 1);
  assert.match(billing.out, /do not name the network cut/);
  const real = 'May the team test outage recovery on wintermute once: cut its network for 30 minutes and restart the machine once, to prove the teams come back by themselves?';
  const asked = { contract: 'delivery.confirmation/1', question: real, choices: ['Yes, once (Recommended)', 'No'], multi_select: false, answer: 'Yes, once (Recommended)' };
  const ok = setup().run([...RUN, '--bead', BEAD], { verifyRecord: drillRecord({ labels: [], beads: [BEAD], quote: 'Yes, once (Recommended)', asked }), beadLabels: labels });
  assert.equal(ok.code, 0, `the real consent words pass: ${ok.out}`);
});

// rv-229 F3: on a real operator store, a consent that was revoked or superseded no longer passes.
// verifyRecord still verifies such a record (it reports the revocation/supersession only in its notes),
// so the drill must read those notes and refuse. plan reflects the consent read-only, so it does not
// spend the record. The store is built the way operator-records.test.js builds one.
test('rv-229 F3: a revoked or a superseded consent is refused, on a real operator store', () => {
  const R = require('./lib/operator-records.js');
  const log = require('./lib/operator-log.js');
  const CUTWORDS = 'Yes, cut the network on pc for 30 minutes and restart the machine once';
  const COS = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: 'cos', host: 'pc' };
  const SCOPE = { beads: ['delivery-plugin-planning-hjx.1.6.6'], labels: ['outage-drill:pc'], initiatives: [] };
  const genv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const build = (extraInputs) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-store-'));
    fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
    fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'x', prefix: 'x', bd_host: 'pc', roles: [{ id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus' }, { id: 'builder', brief: 'delivery/builder', host: 'pc', model: 'sonnet' }] }));
    fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
    const SID = 'sess-1';
    const human = (text, n) => ({ type: 'user', origin: { kind: 'human' }, promptId: `p${n}`, uuid: `u${n}`, timestamp: `2099-10-13T10:00:0${n}.000Z`, sessionId: SID, message: { role: 'user', content: text } });
    const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'drill-tr-')), 't.jsonl');
    fs.writeFileSync(tr, [human(CUTWORDS, 1), ...extraInputs.map((t, i) => human(t, i + 2))].map((r) => JSON.stringify(r)).join('\n') + '\n');
    log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc', now: new Date('2026-11-07T12:00:00Z'), env: genv });
    return root;
  };
  // the drill bead carries the exact-record label naming this record (the Delivery Manager sets it); plan
  // reads it and the record's scope (SCOPE.beads names the bead) to decide consent, without a bd of its own.
  const BEAD = 'delivery-plugin-planning-hjx.1.6.6';
  const planOut = (root, id) => D.main(['plan', '--record', id, '--bead', BEAD], { cwd: root, env: { ...genv, DELIVERY_HOST: 'pc' }, hostname: 'pc', now: NOW, ps: () => '', beadLabels: (b) => ({ labels: b === BEAD ? [`outage-drill:pc:${id}`] : [] }), who: { root, roleId: 'reality-checker', actor: 'dev@pc/rc' } }).out;
  // revoked
  const r1 = build(['Revoke the drill consent.']);
  const dec1 = R.recordDecision({ projectRoot: r1, cite: 'in-pc-000001', quote: CUTWORDS, statement: 'one drill on pc', scope: SCOPE, by: COS });
  assert.match(planOut(r1, dec1.id), /verifies as the owner's word/, 'as recorded it is consent');
  R.revoke({ projectRoot: r1, cite: 'in-pc-000002', quote: 'Revoke the drill consent.', target: dec1.id, by: COS });
  assert.match(planOut(r1, dec1.id), /refused: .*was revoked/, 'a revoked consent is refused');
  // superseded
  const r2 = build(['The drill consent is replaced: cut the network on pc for 30 minutes and restart the machine once.']);
  const decA = R.recordDecision({ projectRoot: r2, cite: 'in-pc-000001', quote: CUTWORDS, statement: 'one drill on pc', scope: SCOPE, by: COS });
  assert.match(planOut(r2, decA.id), /verifies as the owner's word/);
  R.recordDecision({ projectRoot: r2, cite: 'in-pc-000002', quote: 'cut the network on pc for 30 minutes and restart the machine once', statement: 'one drill on pc (replacement)', scope: SCOPE, by: COS, supersedes: decA.id });
  assert.match(planOut(r2, decA.id), /refused: .*was superseded/, 'a superseded consent is refused');
});
