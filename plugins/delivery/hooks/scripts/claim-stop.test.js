// hooks/scripts/claim-stop.test.js — run with: node --test hooks/scripts/claim-stop.test.js
// The Stop hook composes: capture, then the chief of staff's operator checks, then the claim note.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');
const R = require('../../scripts/lib/operator-records.js');
const { RELAY_REASON, RELAY_REASON_NO_RECORD } = require('./relay-guard.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const SID = 'sess-stop-1';

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const human = (text, n) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID, message: { role: 'user', content: text },
});
function transcript(records) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-tr-')), `${SID}.jsonl`);
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}

// bd is kept off PATH so the claim-note check allows: only the operator checks can block here,
// unless binDir supplies a fake bd.
function runStop(instance, input, binDir) {
  const env = { ...process.env, DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PATH: `${binDir || fs.mkdtempSync(path.join(os.tmpdir(), 'stop-nobd-'))}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  delete env.DELIVERY_ROLE_DIR;
  return spawnSync(process.execPath, [path.join(__dirname, 'claim-stop.js')], { input: JSON.stringify({ session_id: SID, hook_event_name: 'Stop', stop_hook_active: false, ...input }), env, encoding: 'utf8' });
}
const reasonOf = (r) => (r.stdout ? JSON.parse(r.stdout) : null);

const COS_BY = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };
// a fake bd whose answer is read from a file, so a test can make the claim check fire or not
function fakeBd() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-bd-'));
  const answer = path.join(bin, 'answer.json');
  fs.writeFileSync(answer, '[]');
  fs.writeFileSync(path.join(bin, 'bd'), `#!/bin/sh\ncat '${answer}'\n`, { mode: 0o755 });
  return { bin, stale: () => fs.writeFileSync(answer, '[{"id":"ex-7","updated_at":"2020-01-01T00:00:00Z"}]'), none: () => fs.writeFileSync(answer, '[]') };
}
const UNRECORDED = /You have an operator input with no record: in-pc-000001/;
const CLAIM = /You hold ex-7 and this turn left no note in it/;

test('the chief of staff\'s stop captures the operator\'s words, then blocks until the input is recorded or acked', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B for the importer', 1)]);
  const first = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' });
  assert.equal(first.status, 0);
  const out = reasonOf(first);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^You have an operator input with no record: in-pc-000001 \("go with option B for the importer"\)\. Record the decision/);
  // the continuation is not blocked again for the same kind
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Noted.' }).stdout, '');
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'recorded as a decision in another way', by: COS_BY });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Recorded and sent dec-1 to the builder.' }).stdout, '');
  // a relay request in the final message blocks with the carry reason; with no record id, ask here first
  const relay = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(relay.status, 0);
  assert.deepEqual(reasonOf(relay), { decision: 'block', reason: RELAY_REASON_NO_RECORD });
  const withId = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: "Recorded as dec-000002. Reply 'go' in the builder's session." });
  assert.deepEqual(reasonOf(withId), { decision: 'block', reason: RELAY_REASON });
});

test('C1: a pending input does not mask a relay request: both reasons arrive in the first block', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B', 1)]);
  const msg = 'Recorded as dec-1. Please tell the builder session to proceed with option B.';
  const first = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }));
  assert.match(first.reason, UNRECORDED);
  assert.ok(first.reason.includes(RELAY_REASON), first.reason);
});

test('C1: a relay request first written on the continuation still blocks once (the turn\'s second block)', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B', 1)]);
  assert.match(reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' })).reason, UNRECORDED);
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'x', by: COS_BY });
  const second = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Acked. Please tell the builder session to proceed with option B.' }));
  assert.deepEqual(second, { decision: 'block', reason: RELAY_REASON_NO_RECORD });
  // the same kind never blocks twice in a turn
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session to proceed.' }).stdout, '');
});

test('termination, worst case: all three kinds block at stop 1, relay once more with the clause, stop 3 passes', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  bd.stale();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const msg = 'Could you forward this to the builder session?';
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }, bd.bin));
  assert.match(s1.reason, UNRECORDED);
  assert.ok(s1.reason.includes(RELAY_REASON_NO_RECORD));
  assert.match(s1.reason, CLAIM);
  const s2 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: msg }, bd.bin));
  assert.equal(s2.reason, `${RELAY_REASON_NO_RECORD} You wrote: "could you forward this to the builder session".`);
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: msg }, bd.bin).stdout, '');
  // the next turn (a first stop) evaluates afresh
  assert.match(reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }, bd.bin)).reason, CLAIM);
});

test('B1: a second chief-of-staff session in the same role directory cannot reset the first one (conc.js)', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1)]);
  const trB = path.join(path.dirname(tr), 'sess-B.jsonl');
  fs.writeFileSync(trB, '');
  const M = 'Please tell the builder session to proceed.';
  const A = (active) => runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: active, last_assistant_message: M }).stdout !== '';
  const B = () => runStop('chief-of-staff', { session_id: 'sess-B', cwd: roleDir, transcript_path: trB, last_assistant_message: 'hi' });
  let blocks = 0;
  if (A(false)) blocks++;
  if (A(true)) blocks++;
  for (let i = 0; i < 3; i++) { B(); if (A(true)) blocks++; }
  assert.equal(blocks, 2);
});

test('torn tail: the repair note joins the unrecorded check instead of replacing it', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1)]);
  runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'ok' });
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'a', by: COS_BY });
  fs.appendFileSync(path.join(projectRoot, '.delivery', 'operator', 'records', 'chief-of-staff.ndjson'), '{"id":"partial');
  const tr2 = transcript([human('use postgres', 1), human('ship friday', 2)]);
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr2, last_assistant_message: 'ok' }));
  assert.match(s1.reason, /has an incomplete last line \(torn_tail/);
  assert.match(s1.reason, /no record: in-pc-000002/);
  assert.doesNotMatch(s1.reason, /Nothing can be recorded/);
  // and it is true: an ack still works and repairs the tail
  R.ack({ projectRoot, input: 'in-pc-000002', reason: 'b', by: COS_BY });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr2, last_assistant_message: 'ok' }).stdout, '');
});

test('termination, staggered worst case: kinds appearing one per stop still end by the third stop', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' }, bd.bin));
  assert.match(s1.reason, UNRECORDED);
  assert.doesNotMatch(s1.reason, CLAIM);
  const s2 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session yes.' }, bd.bin));
  assert.equal(s2.reason, RELAY_REASON_NO_RECORD);
  bd.stale();
  const s3 = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session yes.' }, bd.bin);
  assert.equal(s3.status, 0);
  assert.equal(s3.stdout, '', 'a third stop in a turn always passes');
  // a new prompt resets the turn: UserPromptSubmit rewrites .delivery-turn and clears the state
  require('./turn.js').markTurnStart(roleDir, '2026-10-13T10:10:00Z');
  assert.ok(!fs.existsSync(path.join(roleDir, '.delivery-stop-state.json')));
});

test('order: the claim-note check still runs once the operator checks pass', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  bd.stale();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const first = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' }, bd.bin));
  assert.ok(first.reason.indexOf('You have an operator input') < first.reason.indexOf('You hold ex-7'), 'operator reasons come first');
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'an instruction already in the plan', by: COS_BY });
  const claim = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Sent dec-1 to the builder.' }, bd.bin));
  assert.match(claim.reason, /^You hold ex-7 and this turn left no note in it/);
});

test('I3: a broken own records chain blocks once per turn with the repair path, not with an ack it cannot write', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1), human('and ship friday', 2)]);
  runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true });
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'a', by: COS_BY });
  R.ack({ projectRoot, input: 'in-pc-000002', reason: 'b', by: COS_BY });
  const rf = path.join(projectRoot, '.delivery', 'operator', 'records', 'chief-of-staff.ndjson');
  const txt = fs.readFileSync(rf, 'utf8');
  fs.writeFileSync(rf, txt.slice(0, txt.length - 40));
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'ok' }));
  assert.match(s1.reason, /^Your own operator records chain \(records\/chief-of-staff\.ndjson\) fails verification/);
  assert.match(s1.reason, /operator\.js repair --instance chief-of-staff/);
  assert.doesNotMatch(s1.reason, /no record: in-pc/);
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'ok' }).stdout, '');
});

test('other roles are not subject to the operator stop checks', () => {
  const { roleDir } = preparedRole('builder-1');
  const tr = transcript([human('just a note', 1)]);
  const r = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('without a role, an unloadable manifest or garbage input, the stop hook allows and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-none-'));
  assert.equal(runStop('chief-of-staff', { cwd: dir, last_assistant_message: 'Please tell the builder session to stop' }).stdout, '');
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  fs.rmSync(path.join(projectRoot, '.delivery', 'team', 'team.json'));
  const r = runStop('chief-of-staff', { cwd: roleDir, last_assistant_message: 'Please tell the builder session to stop' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const env = { ...process.env, DELIVERY_ROLE: 'chief-of-staff' };
  const g = spawnSync(process.execPath, [path.join(__dirname, 'claim-stop.js')], { input: 'not json', env, encoding: 'utf8' });
  assert.equal(g.status, 0);
  assert.equal(g.stdout, '');
});
