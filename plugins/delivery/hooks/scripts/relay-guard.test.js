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

// ---- round 2 corpus (training data for the structural rule): 30 relay requests and 30 legitimate
// messages in vocabulary unlike the round 1 corpus. Targets: recall >= 90%, false positives <= 3%.
const CORPUS2_RELAY = [
  "Kindly let builder-2 know that we're going with Postgres.",
  "When you have a sec, could you give the infra expert the thumbs up on the migration?",
  "Would you mind telling the vercel specialist to redeploy?",
  "Hit approve in the builder-2 session when you get a chance.",
  "Reply 'yes' to that session so it can continue.",
  "The researcher has a question. Answer them in chat over there.",
  "Could you give builder-1 the thumbs up?",
  "**Action needed:** approve the PR prompt in [a1b2c3].",
  "- Tell builder-2 the API key is in the vault\n- Then ask the infra expert to rotate it",
  "Please pass along to the delivery lead that the scope is cut.",
  "Can you hop into the vercel specialist's window and click Allow?",
  "I've drafted the answer below. Copy it over to the builder session:\n\nUse option B.",
  "The infra expert is waiting on you. Please respond to it directly.",
  "Once you've decided, just drop a note in builder-2's terminal.",
  "Would you mind confirming with the spike researcher that the spike is closed?",
  "Quick one for you: approve the permission prompt that builder-1 is showing.",
  "Please say \"go\" in the [f00dba] session.",
  "Could you forward dec-12 to the vercel specialist?",
  "You'll need to answer the delivery lead directly; it's blocked on you.",
  "Next step for you: open the builder-2 tab and accept the plan.",
  "Ping the infra expert with your decision, please.",
  "Can you let the PM know option A is fine?",
  "Give the delivery lead a quick yes so it can start.",
  "Builder-2 asked whether to use Redis. Can you tell it yes or no?",
  "Would you be able to answer builder-1's question in its own session?",
  "Please DM the vercel specialist the domain name.",
  "Head over to [a1b2c3] and type `continue`.",
  "Your turn: reply to the staffing session with the headcount.",
  "Can you approve builder-2's request there? It's been waiting an hour.",
  "If you agree, please relay that to the product owner.",
];
const CORPUS2_LEGIT = [
  "Decision needed: Postgres or SQLite for the event store? I recommend Postgres (dec-3 pending your answer).",
  "I will tell the builder once you choose.",
  "I've told the builder session to proceed with option B (dec-4).",
  "builder-1 asked whether to cache tokens; decision dec-3 says no, and I sent it the record id.",
  "Next: tell the delivery lead to proceed.",
  "Briefing: 3 sessions active. builder-2 finished the migration; the infra expert is blocked on DNS.",
  "Should we ship Friday or wait for the security review?",
  "Do you want the vercel specialist to redeploy now, or after the review?",
  "Which of these two approaches do you prefer: A (faster) or B (safer)?",
  "I'll let builder-2 know as soon as you decide.",
  "Recorded dec-7. I sent it to the builder session with SendMessage.",
  "Can you confirm the budget ceiling is $500/month?",
  "Nothing is needed from you right now; the team is unblocked.",
  "The infra expert will answer in its own session; no action for you.",
  "Plan:\n1. Record your answer.\n2. Send dec-8 to builder-2.\n3. Check back in an hour.",
  "You said to tell the builder to wait; I did that (dec-2).",
  "Is it OK if I ask the researcher to drop the spike?",
  "Would you like me to ping the delivery lead for an ETA?",
  "Status: builder-1 is on bead bd-42, builder-2 on bd-43. No questions pending.",
  "Do you approve the plan as written? If yes I'll record it and message the delivery lead.",
  "The vercel specialist sent a message asking about the domain; I answered from dec-5.",
  "Here is the summary you asked for. The team voted for option A.",
  "What should the retention period be: 30 or 90 days?",
  "Once you answer, I'll send the record id to every session that needs it.",
  "I'm going to tell builder-2 to pause until the review lands.",
  "Note to self: forward dec-9 to the infra expert after the operator confirms.",
  "You can see the builder's progress in the dashboard if you want; no reply needed.",
  "Please decide whether the PM may delegate stories directly.",
  "Thanks — recorded as dec-11 and relayed to the product owner by me.",
  "Two open questions for you:\n- Ship behind a flag?\n- Who owns on-call?",
];

test('round 2 corpus: recall >= 90% and false positives <= 3% on both corpora', () => {
  const rate = (list, want) => list.filter((t) => !!findRelayRequest(t) === want).length / list.length;
  assert.ok(rate(CORPUS2_RELAY, true) >= 0.9, `round 2 missed: ${JSON.stringify(CORPUS2_RELAY.filter((t) => !findRelayRequest(t)))}`);
  assert.ok(rate(CORPUS2_LEGIT, true) <= 0.03, `round 2 flagged: ${JSON.stringify(CORPUS2_LEGIT.filter((t) => findRelayRequest(t)))}`);
  const oldNeg = [...CORPUS_OWN_DECISION, ...CORPUS_STATUS, ...CORPUS_EXTRA_NEGATIVES, ...BRIEF_NEGATIVES, ...EXTRA_NEGATIVES];
  assert.ok(rate(CORPUS_RELAY, true) >= 0.9);
  assert.ok(rate(oldNeg, true) <= 0.03);
});

test('roles and instances from the manifest are parties; the chief of staff is not', () => {
  assert.equal(findRelayRequest('Please ping the copywriter about the headline.'), null);
  assert.ok(findRelayRequest('Please ping the copywriter about the headline.', { parties: ['copywriter'] }));
  assert.ok(findRelayRequest('Could you message data-wrangler-2 with the decision?', { parties: ['data-wrangler-2'] }));
  assert.equal(findRelayRequest('Please message the chief of staff if anything changes.', { parties: ['chief-of-staff'] }), null);
});

test('the scan is linear: a 50 KB adversarial message stays under 100 ms', () => {
  for (const g of ['please the send ', 'you the tell ', 'reply in on at into ', 'give a b c d e f ', 'you please tell send in the session tab window i me ', '- you tell\n']) {
    const s = g.repeat(Math.ceil(50000 / g.length)).slice(0, 50000);
    const t = process.hrtime.bigint();
    findRelayRequest(s);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 100, `${JSON.stringify(g)}: ${ms} ms`);
  }
});

// ---- round 2 held-out set (written after the round 2 rule; 11/20 then) and the round 3 held-out set
// (written after the round 3 rule, measured once: 19/20 recall, 0/30 false positives). Kept as
// regression rows; the round 3 targets are recall >= 85% and false positives <= 8%.
const HELDOUT2_RELAY = [
  "Could you nudge the QA reviewer to rerun the suite?",
  "Mind letting the data engineer know the schema is frozen?",
  "Would you hit the green button over in builder-3?",
  "Please let them know in the release channel tab that we slip a day.",
  "Can you okay the deploy in the ops terminal?",
  "Do me a favour and remind the design lead about the token rename.",
  "Shoot builder-2 a message saying the flag stays off.",
  "Could you sign off in the reviewer pane?",
  "When you are free, please tell the support agent the refund policy stands.",
  "Kindly paste the stack trace into the debugging session.",
  "Your move: give the security expert the nod on the key rotation.",
  "You should reply to the frontend specialist with your pick.",
  "Can you pass the word to the release manager?",
  "Would you mind pinging builder-4 about the flaky test?",
  "Pop over to the [9c1e77] window and approve the push.",
  "Please answer the analytics expert; it has asked twice.",
  "Could you send the staffing session a quick yes?",
  "Swing by the infra tab and confirm the region.",
  "Tell the observer it can close the incident.",
  "Can you get the delivery lead to start phase 3?",
];
const HELDOUT2_LEGIT = [
  "I pinged the QA reviewer; it is rerunning the suite now.",
  "Do you prefer weekly or fortnightly briefings?",
  "The data engineer will confirm the schema in its own session.",
  "Shall I remind the design lead about the token rename?",
  "Builder-3 approved its own plan after the review.",
  "You wanted the support agent to hold refunds; I told it (dec-15).",
  "Please choose a launch date: the 20th or the 27th.",
  "Could you clarify what you meant by \"lean MVP\"?",
  "Next I will send dec-16 to the frontend specialist.",
  "The release manager says phase 3 can start Monday.",
  "Would you rather cut scope or move the date?",
  "Please confirm you are fine with a $200 monthly cap.",
  "Nothing to forward; every session already has dec-17.",
  "Can you review the attached roadmap when you have time?",
  "I have asked the analytics expert to stop retrying.",
  "Is it acceptable to drop Safari 15 support?",
  "The security expert gave the key rotation the nod yesterday.",
  "Let me know if the briefing format works for you.",
  "Builder-4 will ping me when the flaky test is fixed.",
  "Please approve or reject the budget increase to five builders.",
];
const HELDOUT3_RELAY = [
  "okay, sign off on it in the builder's session",
  "Shoot the delivery lead a yes.",
  "Swing by the infra tab and approve.",
  "Get the builder to proceed by answering there.",
  "Mind replying to the PM?",
  "Do me a favour and confirm with staffing.",
  "Your move: answer the spike researcher.",
  "Could you wave the migration through on the deployment specialist's pane?",
  "Pick option two over in [7aa31c] when it prompts you.",
  "Would you vouch for the cache change with the platform engineer?",
  "Let the accessibility reviewer hear it from you directly.",
  "Can you bless the schema change in builder-5?",
  "Hand the go/no-go to the release owner yourself, please.",
  "Point the localisation agent at the new glossary, please.",
  "Please unblock builder-1 by choosing a font in its window.",
  "Fill in the env name over there so the build continues.",
  "Can you tick the checkbox the payments expert is showing?",
  "Kindly sort out the merge conflict question with the infra manager.",
  "Walk the observer through your reasoning in its chat.",
  "You must settle the naming dispute with the delivery manager.",
];
const HELDOUT3_LEGIT = [
  "I will tell the builder.",
  "I told the PM session; it answered with dec-5.",
  "Briefing: builder-5 shipped the cache; the platform engineer is profiling.",
  "Do you want dark mode in the first release?",
  "Status: two builders idle, one reviewing, no blockers.",
  "Plan: 1. record your choice 2. pass dec-20 to builder-1 3. close the bead.",
  "Pass dec-21 to the release owner after this.",
  "The deployment specialist will wave the migration through once dec-22 lands.",
  "Which font family should we standardise on?",
  "Would you rather pay for hosted search or self-host?",
  "Earlier you asked me to keep the observer quiet; it has been.",
  "I am about to hand the go/no-go record to the release owner.",
  "The localisation agent finished the glossary pass overnight.",
  "Can you clarify whether \"beta\" means invite-only?",
  "Please pick a name for the project: Atlas or Beacon.",
  "Your answer is recorded as dec-23 and every session has it.",
  "The payments expert asked about refunds; dec-9 already covers it.",
  "Nothing for you to do; the infra manager resolved the conflict.",
  "Would you be comfortable with a two-week freeze?",
  "Once you decide, I will brief the accessibility reviewer.",
  "Approve the new budget of five builders?",
  "Should builder-1 or builder-2 take the font story?",
  "Let me check with the delivery manager and come back to you.",
  "The observer says the error rate dropped after the fix.",
  "Quick summary of the week: three stories done, one slipped.",
  "Thanks, that settles it; I have recorded dec-24.",
  "Are you okay with the spike researcher taking another day?",
  "Tell me if you want the platform engineer to profile first.",
  "Can you share your thoughts on pricing when you have a moment?",
  "Choose between a weekly or monthly release train.",
];

test('round 3: recall >= 85% and false positives <= 8% on the held-out sets', () => {
  for (const [relay, legit] of [[HELDOUT2_RELAY, HELDOUT2_LEGIT], [HELDOUT3_RELAY, HELDOUT3_LEGIT]]) {
    const missed = relay.filter((t) => !findRelayRequest(t));
    const flagged = legit.filter((t) => findRelayRequest(t));
    assert.ok(1 - missed.length / relay.length >= 0.85, `missed: ${JSON.stringify(missed)}`);
    assert.ok(flagged.length / legit.length <= 0.08, `flagged: ${JSON.stringify(flagged)}`);
  }
});

test('round 3: any imperative-looking verb counts when another party is addressed; decision questions and asks back do not', () => {
  for (const t of ['Shoot the delivery lead a yes.', 'Swing by the infra tab and approve.', 'Mind replying to the PM?', 'Do you want to ask the researcher yourself?',
    'Please tell the builder session yes; otherwise no action needed.']) assert.ok(findRelayRequest(t), t);
  for (const t of ['Approve the plan for the builder-1 story?', 'Remind me tomorrow to check the observer report.',
    'Please decide: should the agent retry failed deploys automatically?', 'Please review the PR the builder opened.']) assert.equal(findRelayRequest(t), null, t);
});
