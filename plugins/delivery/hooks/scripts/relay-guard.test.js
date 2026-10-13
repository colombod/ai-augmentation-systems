// hooks/scripts/relay-guard.test.js — run with: node --test hooks/scripts/relay-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRelayRequest, decideStopForOperator, operatorChecks, RELAY_REASON, RELAY_REASON_NO_RECORD } = require('./relay-guard.js');
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
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: 'The builder asks whether to use Redis. Can you tell the builder session A or B?' })), { reason: RELAY_REASON_NO_RECORD });
  assert.equal(RELAY_REASON_NO_RECORD, 'You carry answers; the operator does not. Ask the operator here yourself, record the answer, then SendMessage the record id to the session, and remove the request from your message.');
  assert.equal(RELAY_REASON, 'You carry answers; the operator does not. Send the record id to the session yourself with SendMessage, and remove the request from your message.');
  assert.equal(decideStopForOperator(stopArgs(p, { last_assistant_message: 'I will tell the Delivery Lead.' })), null);
});

test('allows when the operator directory is missing, the manifest fails, or the transcript format is unrecognised', () => {
  const p = preparedRole('chief-of-staff');
  fs.writeFileSync(path.join(p.roleDir, '.delivery-session'), `${SID}\n`);
  assert.ok(!fs.existsSync(log.opDir(p.projectRoot)));
  assert.equal(decideStopForOperator(stopArgs(p)), null, 'no operator directory: the input check is skipped');
  const warned = [];
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: BRIEF_POSITIVES[1] }, { deps: { warn: (m) => warned.push(m) } })), { reason: RELAY_REASON_NO_RECORD }, 'the relay check needs no records');
  assert.match(warned.join(''), /\.delivery\/operator does not exist yet/, 'a marker without an operator directory says so on stderr');

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

// ---- the review corpus (round 1): 40 natural relay requests, 12 questions about the operator's own
// decisions, 14 status messages and 29 extra negatives. Recall must stay >= 95%, false positives 0.
const CORPUS_RELAY = [...BRIEF_POSITIVES.slice(0, 4), ...[
  "Reply 'go' in the builder's session.",
  "Reply \"go\" in the builder's session.",
  "Please reply go in the builder-1 session when you have a sec.",
  "Answer the question in session abc123.",
  "Could you answer the builder's question in its tab?",
  "Type \"yes\" in the delivery lead session.",
  "Please go to the delivery lead tab and confirm.",
  "Can you hop over to the builder window and approve the plan?",
  "Head to the infra session and click approve.",
  "Could you switch to the PM tab and confirm the scope?",
  "Can you let the infra session know we are going with Postgres?",
  "Please let the builder know the answer is B.",
  "Just tell them yes.",
  "When you get a moment, tell the builder to go ahead with option A.",
  "Tell the builder session to proceed.",
  "Could you tell builder-2 to use the staging DB?",
  "Can you give the delivery lead the go-ahead?",
  "Please give builder-1 a yes on the migration.",
  "Ask the PM session to approve the scope change.",
  "Could you ask the product manager to sign off?",
  "Press approve in the builder window.",
  "Please click Allow in the builder-1 session so it can push.",
  "You will need to approve the permission prompt in the spike researcher session.",
  "Could you accept the permission request on the observer tab?",
  "Forward this to the delivery lead.",
  "Please forward my summary to the builder.",
  "Copy/paste this into the builder session.",
  "Copy and paste the following into builder-1:",
  "Can you paste the decision into the delivery lead chat?",
  "Please approve in the other session.",
  "Please confirm over in the builder session.",
  "The builder is waiting on you - please answer it there.",
  "The delivery lead needs your answer in its session.",
  "**Action for you:**\n- Tell the builder to use option B\n- Reply `go` in the infra session",
  "Next steps:\n1. **Please tell the delivery lead** to proceed.\n2. Nothing else.",
  "- **You:** forward dec-12 to builder-1",
]];
const CORPUS_OWN_DECISION = [
  "Do you want option A (Postgres) or option B (SQLite)? I recommend A.",
  "Should the builder use Postgres or SQLite? Your call.",
  "Can you confirm the budget cap of 3 builders?",
  "Would you approve shipping v1 without the export feature?",
  "Do you want me to tell the builder to pause?",
  "Should I ask the delivery lead to re-plan phase 2?",
  "Which session should I prioritise, the builder or the infra one?",
  "Can you tell me whether the infra role should own DNS?",
  "Are you happy for the builders to work on the payment story next?",
  "Would you like the researcher to spike the queue options first?",
  "Please decide: should the agent retry failed deploys automatically?",
  "Could you tell us which customers to prioritise?",
];
const CORPUS_STATUS = [
  "Briefing: builder-1 merged the auth PR. The delivery lead asked about scope; I answered with dec-14 and sent it to its session.",
  "I sent the record id dec-000007 to the builder session with SendMessage. Nothing needs you.",
  "Status: 3 sessions active. The infra session is idle. The observer flagged one failing test.",
  "You asked me to tell the builder to stop; done, the builder acknowledged dec-9.",
  "You told me yesterday to send updates to the delivery lead; I have done so.",
  "Once you choose, I will message the builder and the delivery lead with the record id.",
  "The builder wants to know whether to use Redis. Please tell me A or B.",
  "Please message me if anything changes.",
  "You can ask any session for status yourself, but you do not need to.",
  "Thanks. Recorded as dec-21; the builders have it.",
  "Please send me the API key name (not the value) you want the agent to use.",
  "Please review the PR the builder opened: https://github.com/x/y/pull/3",
  "Could you ping me when the staging deploy is done on your side?",
  "If you want, you can watch the builder session; no action needed.",
];
const CORPUS_EXTRA_NEGATIVES = [
  "Let me know which option you prefer.",
  "Tell me whether the infra role should own DNS.",
  "Ask me anything about the plan.",
  "Approve the plan for the builder-1 story? I recommend yes.",
  "Confirm the budget cap of 3 builders?",
  "Should I give the builder the go-ahead?",
  "Do you want to give the builders more budget?",
  "The builder will answer in its session once dec-3 lands.",
  "I answered in the builder session with dec-3.",
  "Go ahead and pick A or B.",
  "Go to the dashboard link if you want details; nothing is needed.",
  "Let the record show the builder finished.",
  "The delivery lead is waiting on dec-4; I sent it.",
  "You said to tell the builder to wait; I did that.",
  "Answer in this chat: A or B?",
  "Please reply here with A or B.",
  "If you prefer, I can ask the PM session to approve.",
  "I will let the infra session know.",
  "Builder-1 asked whether to use Redis. Options: A) Redis B) in-memory. Recommendation: A. Which do you want?",
  "**Decision needed:** should the agent auto-retry deploys? A) yes B) no.",
  "Tell me if you want the researcher to spike first.",
  "Approve shipping v1 without export? Recommended: yes.",
  "Press on with the current plan, or pause the builders?",
  "Click the PR link to review if you like: https://x/y/1",
  "Once you answer, I will give the builder the go-ahead.",
  "Then I will tell the delivery lead to proceed.",
  "Next: I message the builder with dec-5.",
  "Send me your pick, A or B.",
  "Remind me tomorrow to check the observer report.",
];

test('round 1 corpus: recall >= 95% on 40 relay requests, no false positive on 55 negatives', () => {
  assert.equal(CORPUS_RELAY.length, 40);
  const missed = CORPUS_RELAY.filter((t) => !findRelayRequest(t));
  assert.ok((CORPUS_RELAY.length - missed.length) / CORPUS_RELAY.length >= 0.95, `missed: ${JSON.stringify(missed)}`);
  assert.equal(CORPUS_OWN_DECISION.length, 12);
  assert.equal(CORPUS_STATUS.length, 14);
  for (const t of [...CORPUS_OWN_DECISION, ...CORPUS_STATUS, ...CORPUS_EXTRA_NEGATIVES]) {
    const r = findRelayRequest(t);
    assert.equal(r, null, `false positive: ${JSON.stringify(t)} => ${r && r.phrase}`);
  }
});

test("the user's own example and the bare imperatives are flagged", () => {
  for (const t of ["Reply 'go' in the builder's session.", 'Tell the builder session to proceed.', 'Just tell them yes.']) assert.ok(findRelayRequest(t), t);
});

test('every applicable operator reason is returned, not only the first', () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  const found = operatorChecks(stopArgs(p, { stop_hook_active: true, last_assistant_message: 'Please tell the builder session to use postgres.' }));
  assert.deepEqual(found.map((f) => f.kind), ['unrecorded', 'relay'], 'operatorChecks ignores stop_hook_active; claim-stop limits repeats');
  const joined = decideStopForOperator(stopArgs(p, { last_assistant_message: 'Please tell the builder session to use postgres.' }));
  assert.match(joined.reason, /^You have an operator input with no record: in-pc-000001/);
  assert.ok(joined.reason.endsWith(RELAY_REASON_NO_RECORD));
  assert.deepEqual(operatorChecks(stopArgs(p, {}, { role: 'builder' })), []);
});

test("I3: a chain problem on the chief of staff's own records file replaces the unrecorded check with the repair path", () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  const inputs = [{ id: 'in-pc-000001', session_id: SID, instance: 'chief-of-staff', text: 'use postgres' }];
  const torn = () => ({ inputs, problems: [{ file: 'records/chief-of-staff', code: 'truncated', error: 'records/chief-of-staff: truncated 4 entries but 5 recorded' }] });
  const found = operatorChecks(stopArgs(p, {}, { deps: { pending: torn } }));
  assert.deepEqual(found.map((f) => f.kind), ['integrity']);
  assert.equal(found[0].reason, 'Your own operator records chain (records/chief-of-staff.ndjson) fails verification (truncated: records/chief-of-staff: truncated 4 entries but 5 recorded). Nothing can be recorded or acknowledged until it is repaired: run operator.js problems, then operator.js repair --instance chief-of-staff for a torn tail, or restore the file from repository history for a truncated or rewritten chain. Do not ask the operator to relay anything meanwhile.');
  // another instance's chain, or one invalid record, does not stop the chief of staff from recording
  for (const problem of [{ file: 'records/builder-1', code: 'truncated', error: 'x' }, { file: 'records/chief-of-staff', code: 'record_invalid', error: 'x', id: 'dec-x' }]) {
    assert.deepEqual(operatorChecks(stopArgs(p, {}, { deps: { pending: () => ({ inputs, problems: [problem] }) } })).map((f) => f.kind), ['unrecorded']);
  }
});
