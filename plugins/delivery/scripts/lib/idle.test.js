// scripts/lib/idle.test.js — R-43: idle with ready work is a defect, replayed on the Vault's 4 idle days.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const I = require('./idle.js');
const W = require('./warnings.js');
const { teamStatus, renderStatus } = require('../team-status.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
// 10-13 12:06: the weekly limit hit; the last bead moved then. 10-17 15:01: the owner came back.
const LAST = '2026-10-13T12:06:00Z';
const BACK = '2026-10-17T15:01:00Z';
const BEADS = [
  { id: 'vault-wxy.12', status: 'open', updated_at: LAST },
  { id: 'vault-wxy.2', status: 'open', updated_at: '2026-10-13T11:40:00Z' },
  { id: 'vault-0n9.3', status: 'closed', closed_at: '2026-10-13T10:00:00Z' },
];
const READY = BEADS.filter((b) => b.status === 'open');
const at = (minutes) => new Date(Date.parse(LAST) + minutes * 60e3).toISOString();

test('R-43 10-13 to 10-17: ready work and nothing in progress for 4 days is idle; 30 minutes is the line', () => {
  const s = I.idleState({ beads: BEADS, ready: READY, now: BACK });
  assert.equal(s.idle, true);
  assert.equal(s.since, '2026-10-13T12:06:00.000Z');
  assert.deepEqual(s.ready, ['vault-wxy.12', 'vault-wxy.2']);
  assert.match(I.idleLine(s), /^Idle: 2 ready items and nothing in progress for 98\.9 h, with no owner pause\.\nThe Delivery Manager starts the next one now: bd ready\.$/);
  assert.equal(I.idleState({ beads: BEADS, ready: READY, now: at(30) }).idle, false);
  assert.equal(I.idleState({ beads: BEADS, ready: READY, now: at(31) }).idle, true);
  assert.equal(I.idleState({ beads: BEADS, ready: READY, now: at(31), idleMinutes: 600 }).idle, false, 'the owner-set limit applies');
});

test('R-43: work in progress, no ready work, or an owner pause is not idle; "IDLE NOW" with no record is', () => {
  assert.equal(I.idleState({ beads: [...BEADS, { id: 'vault-x', status: 'in_progress', updated_at: LAST }], ready: READY, now: BACK }).why, 'in-progress');
  assert.equal(I.idleState({ beads: BEADS, ready: [], now: BACK }).why, 'no-ready-work');
  assert.equal(I.idleState({ beads: BEADS, ready: READY, now: BACK, pause: { paused: true, by: 'dec-chief-of-staff-9' } }).why, 'paused');
  // the CoS told every session to idle (10-12 19:48): no owner pause is recorded, so it is idle
  assert.equal(I.idleState({ beads: BEADS, ready: READY, now: BACK, pause: { paused: false } }).idle, true);
});

test('R-43: "waiting for the owner" counts only for a bead an open owner-queue step names', () => {
  const step = { id: 'o-1', bead: 'vault-wxy.12', kind: 'signin' };
  const one = I.idleState({ beads: BEADS, ready: READY, now: BACK, openSteps: [step] });
  assert.deepEqual(one.ready, ['vault-wxy.2'], 'the other ready bead still counts');
  assert.equal(I.idleState({ beads: BEADS, ready: READY.slice(0, 1), now: BACK, openSteps: [step] }).why, 'waiting-owner');
  // a label or a note that says "owner" without a queue step does not excuse it
  assert.equal(I.idleState({ beads: BEADS, ready: [{ ...READY[0], labels: ['owner'] }], now: BACK }).idle, true);
});

const memBd = (beads, ready) => ({ list: () => beads, ready: () => ready });
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  for (const f of ['team.json', 'hosts.json']) fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', f), path.join(root, '.delivery', 'team', f));
  return root;
}

test('R-43 team status: idle heads the status and is recorded once per idle stretch; an open andon pause silences it', () => {
  const root = project();
  const st = () => teamStatus(root, { now: BACK, idleBd: memBd(BEADS, READY) });
  const text = renderStatus(st());
  assert.match(text.split('\n')[0], /^Idle: 2 ready items and nothing in progress/);
  st();
  assert.deepEqual(W.list(root).map((w) => [w.kind, w.rule]), [['idle', 'R-43']]);
  // an andon: a failed check row from evidence.js, then the trigger pause
  require('./gates.js').appendEvidence(root, 'vault-wxy-12', { type: 'row', criterion: 1, result: 'fail', by: 'reality-checker', at: BACK });
  fs.writeFileSync(path.join(root, '.delivery', 'goal.json'), JSON.stringify({ fields: { pause_trigger: { value: 'paused', trigger: 'andon:ev-vault-wxy-12-1' } }, history: [] }));
  assert.doesNotMatch(renderStatus(st()), /^Idle:/);
});

test('R-43 Stop hook: the Delivery Manager\'s stop records the idle warning and says it on the next prompt', () => {
  const { prepareRole } = require('../prepare-role.js');
  const projectRoot = project();
  const git = (...a) => spawnSync('git', a, { cwd: projectRoot, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q'); git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  const { roleDir } = prepareRole({ projectRoot, instance: 'delivery-lead', teamDir: fs.mkdtempSync(path.join(os.tmpdir(), 'idle-team-')), pluginRoot: PLUGIN_ROOT, user: 'tester' });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-bd-'));
  fs.writeFileSync(path.join(bin, 'beads.json'), JSON.stringify(BEADS));
  fs.writeFileSync(path.join(bin, 'ready.json'), JSON.stringify(READY));
  fs.writeFileSync(path.join(bin, 'bd'), `#!/bin/sh\nif [ "$1" = ready ]; then cat '${bin}/ready.json'; else cat '${bin}/beads.json'; fi\n`, { mode: 0o755 });
  const env = { ...process.env, DELIVERY_ROLE: 'delivery-lead', PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  delete env.DELIVERY_ROLE_DIR;
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'claim-stop.js')], { input: JSON.stringify({ session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false, cwd: roleDir, last_assistant_message: 'Done for now.' }), env, encoding: 'utf8' });
  assert.equal(r.stdout, '', 'idle never blocks');
  assert.deepEqual(W.list(projectRoot).map((w) => w.kind), ['idle']);
  assert.match(fs.readFileSync(path.join(roleDir, '.delivery-message-reminder'), 'utf8'), /^Idle: 2 ready items/);
});

test('R-43 I1: with bd hanging, the Delivery Manager\'s stop with the idle check stays under 12 s', () => {
  const { prepareRole } = require('../prepare-role.js');
  const projectRoot = project();
  const git = (...a) => spawnSync('git', a, { cwd: projectRoot, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q'); git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  const { roleDir } = prepareRole({ projectRoot, instance: 'delivery-lead', teamDir: fs.mkdtempSync(path.join(os.tmpdir(), 'idle-team-')), pluginRoot: PLUGIN_ROOT, user: 'tester' });
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-18T00:00:00Z\n');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-slow-'));
  fs.writeFileSync(path.join(bin, 'bd'), '#!/bin/sh\nexec sleep 20\n', { mode: 0o755 });
  const env = { ...process.env, DELIVERY_ROLE: 'delivery-lead', PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  delete env.DELIVERY_ROLE_DIR;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'claim-stop.js')], { input: JSON.stringify({ session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false, cwd: roleDir, last_assistant_message: 'Done.' }), env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(Date.now() - t0 < 12000, `the stop took ${Date.now() - t0} ms`);
});
