// hooks/scripts/relay-guard.test.js — run with: node --test hooks/scripts/relay-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRelayRequest, decideStopForOperator, RELAY_REASON } = require('./relay-guard.js');
const { captureFromHookInput } = require('./operator-capture.js');
const { prepareRole } = require('../../scripts/prepare-role.js');
const R = require('../../scripts/lib/operator-records.js');
const log = require('../../scripts/lib/operator-log.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const SID = 'sess-relay-1';

// ---- the relay detector ----

const BRIEF_POSITIVES = [
  'Please tell the Delivery Lead session to proceed with the migration',
  'can you paste this answer to the builder?',
  "Could you reply in the infra manager's session with option B",
  'I need you to confirm to [dfd9f8]',
  'please send the builder the answer yourself',
];
const EXTRA_POSITIVES = [
  'Could you please tell the\nbuilder session to proceed',
  'Done. Now, could you pass dec-12 along to\nthe infra session?',
  'Go ahead and forward dec-000012 to the product manager.',
  'Paste this into the builder-2 terminal: proceed with B.',
  'Type this into the other window and press enter.',
  'Forward the record to the spike researcher.',
  "Say it in the delivery lead's session so it counts.",
  'Can you ping them with the answer?',
  'Would you relay option B to the staffing role?',
  'You could message the progress observer directly.',
  'Do you want to ask the researcher yourself?',
  'Recorded as dec-000003.\n\n- Please copy the record id to the builder-1 agent',
];
const BRIEF_NEGATIVES = [
  'I will tell the Delivery Lead',
  'The builder asked; I answered with dec-000004',
  'Here is what I would do:\n```\nplease tell the builder session to proceed\n```\nWhich option?',
  'Which option do you prefer, A or B?',
];
const EXTRA_NEGATIVES = [
  "I'll ask the builder to confirm",
  'Should I tell the builder?',
  '> please tell the builder session to stop\n> and paste this into the infra session\n\nI recorded that as dec-000007 and sent it to the builder.',
  'Do you want me to tell the builder session?',
  'Would you like me to ping the infra role?',
  'Did you see the message from the builder session?',
  'Do you want the builder to ask the researcher first?',
  'Please answer in this session: A or B?',
  'Please tell me which role should own the migration.',
  'When you approve, I will send the builder session the record.',
  "I'll reply in the builder's session with dec-000009.",
  'You said "please tell the builder session to stop", so I recorded dec-000010 and sent it.',
  'Thank you. I sent the record id to the delivery lead.',
  'Did you tell the builder already, or should I?',
  'Can you confirm option B? I will message the builder once you do.',
  'Use `tell the builder session` as the search phrase.',
];

test('flags the brief\'s relay requests and the extra ones, naming the phrase', () => {
  for (const t of [...BRIEF_POSITIVES, ...EXTRA_POSITIVES]) {
    const r = findRelayRequest(t);
    assert.ok(r && typeof r.phrase === 'string' && r.phrase.length > 0, `should flag: ${JSON.stringify(t)}`);
  }
  assert.match(findRelayRequest(BRIEF_POSITIVES[0]).phrase, /^please tell the delivery lead/);
  assert.ok(EXTRA_POSITIVES.length >= 8);
});

test('does not flag the chief of staff carrying answers, questions about the operator\'s own decision, code or quotes', () => {
  for (const t of [...BRIEF_NEGATIVES, ...EXTRA_NEGATIVES]) assert.equal(findRelayRequest(t), null, `should pass: ${JSON.stringify(t)}`);
  assert.ok(EXTRA_NEGATIVES.length >= 8);
  for (const t of [undefined, null, 42, '', '   ']) assert.equal(findRelayRequest(t), null);
});

// ---- the stop decision ----

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const human = (text, n, sid = SID) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: `${sid}-u${n}`,
  timestamp: `2026-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: sid, message: { role: 'user', content: text },
});
function transcript(records, sid = SID) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-tr-')), `${sid}.jsonl`);
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}
function captured(instance, records, sid = SID) {
  const p = preparedRole(instance);
  const tr = transcript(records, sid);
  const cap = withEnv({ DELIVERY_ROLE: instance, DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput({ cwd: p.roleDir, session_id: sid, transcript_path: tr }, PLUGIN_ROOT));
  return { ...p, tr, cap };
}
const COS_BY = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };
const stopArgs = (p, input = {}, extra = {}) => ({ input: { session_id: SID, stop_hook_active: false, ...input }, roleDir: p.roleDir, projectRoot: p.projectRoot, role: 'chief-of-staff', instance: 'chief-of-staff', now: '2026-10-13T10:05:00Z', ...extra });

test('blocks the chief of staff with an unrecorded input of its own session, and passes after ack', () => {
  const p = captured('chief-of-staff', [human('use postgres for the store, it is what ops already runs', 1)]);
  assert.equal(p.cap.status, 'ok');
  const d = decideStopForOperator(stopArgs(p));
  assert.equal(d.reason, 'You have an operator input with no record: in-pc-000001 ("use postgres for the store, it is what ops already runs"). Record the decision (operator.js record --cite in-pc-000001 --quote "<exact words>" --statement "<what was decided>" --scope bead:ID) or acknowledge it (operator.js ack --input in-pc-000001 --reason "<why this is not a decision>"), then send the record id to the sessions that need it with SendMessage. Do not ask the operator to relay it.');
  R.ack({ projectRoot: p.projectRoot, input: 'in-pc-000001', reason: 'a preference, recorded elsewhere', by: COS_BY });
  assert.equal(decideStopForOperator(stopArgs(p)), null);
});

test('several pending inputs: names the first, counts the rest, cuts the excerpt at 80 characters', () => {
  const long = `ship it ${'x'.repeat(120)}`;
  const p = captured('chief-of-staff', [human(long, 1), human('second', 2), human('third', 3)]);
  const d = decideStopForOperator(stopArgs(p));
  assert.ok(d.reason.startsWith(`You have an operator input with no record: in-pc-000001 ("${long.slice(0, 80)}") and 2 more. Record the decision`), d.reason);
});

test('passes when stop_hook_active, for any other role, and on inputs of other sessions', () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  assert.equal(decideStopForOperator(stopArgs(p, { stop_hook_active: true, last_assistant_message: BRIEF_POSITIVES[0] })), null);
  assert.equal(decideStopForOperator(stopArgs(p, { last_assistant_message: BRIEF_POSITIVES[0] }, { role: 'delivery-lead' })), null);
  // a fresh chief-of-staff session: the earlier session's input is not this session's to record
  fs.writeFileSync(path.join(p.roleDir, '.delivery-session'), 'sess-relay-2\n');
  assert.equal(decideStopForOperator(stopArgs(p, { session_id: 'sess-relay-2' })), null);
  // an input another instance captured in a session with the same id is not this instance's
  assert.equal(decideStopForOperator(stopArgs(p, {}, { instance: 'chief-of-staff', deps: { pending: () => ({ inputs: [{ id: 'in-pc-000009', session_id: 'sess-relay-2', instance: 'builder-1', text: 'x' }], problems: [] }) } })), null);
});

test('the session comes from .delivery-session; the hook input session id is only a fallback', () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  assert.match(decideStopForOperator(stopArgs(p, { session_id: 'something-else' })).reason, /in-pc-000001/);
  fs.rmSync(path.join(p.roleDir, '.delivery-session'));
  assert.match(decideStopForOperator(stopArgs(p)).reason, /in-pc-000001/);
  assert.equal(decideStopForOperator(stopArgs(p, { session_id: undefined })), null, 'no session known: no check');
});

test('blocks a relay request with the carry reason once nothing is pending', () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  R.ack({ projectRoot: p.projectRoot, input: 'in-pc-000001', reason: 'noted', by: COS_BY });
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: 'Recorded dec-1.\n\ncan you paste this answer to the builder?' })), { reason: RELAY_REASON });
  assert.equal(RELAY_REASON, 'You carry answers; the operator does not. Send the record id to the session yourself with SendMessage, and remove the request from your message.');
  assert.equal(decideStopForOperator(stopArgs(p, { last_assistant_message: 'I will tell the Delivery Lead.' })), null);
});

test('allows when the operator directory is missing, the manifest fails, or the transcript format is unrecognised', () => {
  const p = preparedRole('chief-of-staff');
  fs.writeFileSync(path.join(p.roleDir, '.delivery-session'), `${SID}\n`);
  assert.ok(!fs.existsSync(log.opDir(p.projectRoot)));
  assert.equal(decideStopForOperator(stopArgs(p)), null, 'no operator directory: the input check is skipped');
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: BRIEF_POSITIVES[1] })), { reason: RELAY_REASON }, 'the relay check needs no records');

  const q = captured('chief-of-staff', [human('use postgres', 1)]);
  const warnings = [];
  const warn = (m) => warnings.push(m);
  // manifest_unavailable makes every input look unrecorded: fail open, say so
  const manifestDown = () => ({ inputs: [{ id: 'in-pc-000001', session_id: SID, instance: 'chief-of-staff', text: 'use postgres' }], problems: [{ code: 'manifest_unavailable', error: '.delivery/team/team.json cannot be loaded' }] });
  assert.equal(decideStopForOperator(stopArgs(q, {}, { deps: { pending: manifestDown, warn } })), null);
  assert.match(warnings.pop(), /unrecorded-input check was skipped: .*team\.json/);
  assert.equal(decideStopForOperator(stopArgs(q, {}, { deps: { pending: () => { throw new Error('disk on fire'); }, warn } })), null);
  assert.match(warnings.pop(), /disk on fire/);
  // an unrecognised transcript format: neither check runs
  assert.equal(decideStopForOperator(stopArgs(q, { last_assistant_message: BRIEF_POSITIVES[0] }, { captureStatus: 'format_unrecognised', deps: { warn } })), null);
  assert.match(warnings.pop(), /format was not recognised/);
  const cursors = path.join(log.opDir(q.projectRoot), 'cursors');
  fs.mkdirSync(cursors, { recursive: true });
  fs.writeFileSync(path.join(cursors, `${SID}.json`), JSON.stringify({ total_user_records: 5, with_origin: 0 }));
  assert.equal(decideStopForOperator(stopArgs(q, { last_assistant_message: BRIEF_POSITIVES[0] }, { deps: { warn } })), null);
  // bad arguments never throw
  assert.equal(decideStopForOperator(), null);
  assert.equal(decideStopForOperator({ role: 'chief-of-staff', projectRoot: 'relative' }), null);
});
