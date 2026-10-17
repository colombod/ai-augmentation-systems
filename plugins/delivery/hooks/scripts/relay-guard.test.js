// hooks/scripts/relay-guard.test.js — run with: node --test hooks/scripts/relay-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRelayRequest, operatorChecks, relayReason, RELAY_REASON, RELAY_REASON_NO_RECORD } = require('./relay-guard.js');
const { operatorCommand } = require('../../scripts/lib/plugin-root.js');
const { captureFromHookInput } = require('./operator-capture.js');
const { prepareRole } = require('../../scripts/prepare-role.js');
const R = require('../../scripts/lib/operator-records.js');
const log = require('../../scripts/lib/operator-log.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const SID = 'sess-relay-1';
const OP = operatorCommand(PLUGIN_ROOT);
// stateless view of the operator checks: null on a continuation, else every reason joined
function decideStopForOperator(args = {}) {
  const inp = args && args.input && typeof args.input === 'object' ? args.input : {};
  if (inp.stop_hook_active) return null;
  const found = operatorChecks(args);
  return found.length ? { reason: found.map((f) => f.reason).join('\n\n') } : null;
}

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
  timestamp: `2099-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: sid, message: { role: 'user', content: text },
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
  assert.equal(d.reason, `You have an operator input with no record: in-pc-000001 ("use postgres for the store, it is what ops already runs"). Record the decision (\`${OP} record --cite in-pc-000001 --quote '<exact words>' --statement '<what was decided>' --scope bead:<id>\`) or acknowledge it (\`${OP} ack --input in-pc-000001 --reason '<why this is not a decision>'\`; 'conversational' for chat), then send the record id to the sessions that need it with SendMessage. Do not ask the operator to relay it.`);
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
  // round 4: the first block already quotes the flagged clause, in its own casing
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: 'Recorded dec-1.\n\ncan you paste this answer to the builder?' })),
    { reason: 'You carry answers; the operator does not. You wrote: "can you paste this answer to the builder". Rewrite only that clause: send the record id yourself with SendMessage; keep any real decision question to the operator.' });
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: 'The builder asks whether to use Redis. Can you tell the builder session A or B?' })),
    { reason: 'You carry answers; the operator does not. You wrote: "Can you tell the builder session A or B". Rewrite only that clause: a decision only the operator can make goes into your next batched briefing (if it blocks work now, ask it once here yourself); record the answer, then send the record id yourself with SendMessage.' });
  assert.equal(RELAY_REASON_NO_RECORD, 'You carry answers; the operator does not. Rewrite only that clause: a decision only the operator can make goes into your next batched briefing (if it blocks work now, ask it once here yourself); record the answer, then send the record id yourself with SendMessage.');
  assert.equal(RELAY_REASON, 'You carry answers; the operator does not. Rewrite only that clause: send the record id yourself with SendMessage; keep any real decision question to the operator.');
  assert.equal(relayReason('dec-1', null), RELAY_REASON, 'no clause: the base reason');
  assert.equal(decideStopForOperator(stopArgs(p, { last_assistant_message: 'I will tell the Delivery Lead.' })), null);
});

test('allows when the operator directory is missing, the manifest fails, or the transcript format is unrecognised', () => {
  const p = preparedRole('chief-of-staff');
  fs.writeFileSync(path.join(p.roleDir, '.delivery-session'), `${SID}\n`);
  assert.ok(!fs.existsSync(log.opDir(p.projectRoot)));
  assert.equal(decideStopForOperator(stopArgs(p)), null, 'no operator directory: the input check is skipped');
  const warned = [];
  assert.deepEqual(decideStopForOperator(stopArgs(p, { last_assistant_message: BRIEF_POSITIVES[1] }, { deps: { warn: (m) => warned.push(m) } })), { reason: relayReason(BRIEF_POSITIVES[1], 'can you paste this answer to the builder') }, 'the relay check needs no records');
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
  assert.ok(joined.reason.endsWith(relayReason('', 'Please tell the builder session to use postgres')), joined.reason);
  assert.deepEqual(operatorChecks(stopArgs(p, {}, { role: 'builder' })), []);
});

test("I3: a chain problem on the chief of staff's own records file replaces the unrecorded check with the repair path", () => {
  const p = captured('chief-of-staff', [human('use postgres', 1)]);
  const inputs = [{ id: 'in-pc-000001', session_id: SID, instance: 'chief-of-staff', text: 'use postgres' }];
  const torn = () => ({ inputs, problems: [{ file: 'records/chief-of-staff', code: 'truncated', error: 'records/chief-of-staff: truncated 4 entries but 5 recorded' }] });
  const found = operatorChecks(stopArgs(p, {}, { deps: { pending: torn } }));
  assert.deepEqual(found.map((f) => f.kind), ['integrity']);
  assert.equal(found[0].reason, `Your own operator records chain (records/chief-of-staff.ndjson) fails verification (truncated: records/chief-of-staff: truncated 4 entries but 5 recorded). Nothing can be recorded or acknowledged on it, and no lane can write the operator directory: run \`${OP} problems\` to see it, then set it aside with \`${OP} quarantine --file records/chief-of-staff.ndjson --reason '<what failed>'\` (the file is kept as evidence) and keep recording, and put "restore .delivery/operator/records/chief-of-staff.ndjson from repository history" in your next briefing as one owner-side line. Do not ask the operator to relay anything meanwhile.`);
  // the Product Manager cannot quarantine: it is told to ask the Chief of Staff
  const pm = operatorChecks(stopArgs(p, {}, { role: 'product-manager', instance: 'chief-of-staff', deps: { pending: torn } }));
  assert.match(pm[0].reason, /SendMessage the Chief of Staff with the problem/);
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

// ---- round 4 ----
// The independent reviewer's verbatim cases after round 3 (training data now). Every false positive
// must pass and every miss must be flagged.
const REVIEW4_LEGIT = [
  "staffing hired a stripe specialist yesterday, who is now reading the payments story",
  "sessions running: [a1b2c3] builder-1 on s-50, [b2c3d4] builder-2 on s-51, [c3d4e5] the spike researcher on spike-7, [d4e5f6] the delivery lead planning sprint 6",
  "there's one decision for you: do you want us to add a mandatory staging soak of one hour before every production deploy",
  "builder-3 has been hired as a third builder via staffing, onboarded in [abc123], and picked up s-80",
  "recap of today's work across sessions",
  "Staffing hired a Vercel expert.",
  "Spike researcher reported back to the delivery lead.",
  "Progress observer flagged builder-2's session.",
  "Builder-1 has been rebased onto the session from builder-2.",
  "Highlights from builder-1: export done.",
  "Meanwhile the delivery lead re-cut the sprint.",
  "Earlier today builder-1 messaged the delivery lead.",
  "Summary for you: the delivery lead re-cut the sprint.",
  "Good news for you: builder-2 and the design lead closed all accessibility findings",
  "Recap for you: builder-1 done, builder-2 rebasing.",
  "As you said, builder-1 is done",
  "Per your note, the PM session will wait.",
];
const REVIEW4_RELAY = [
  "Forward ans-4 to the spike researcher so they can close the spike.",
  "Nothing else is blocked. One ask \u2014 go to session [9f8e7d] and tell builder-3 to rebase on main.",
  "btw can u tell the builder to stop touching the migrations folder",
  "ok last thing - shoot the delivery lead a msg saying S-20 is cut.",
  "FYI \u2192 ask builder-2 (sess [77aa11]) to re-run e2e w/ the new seed.",
  "Here's a message you can send to the delivery lead: \"Sprint 4 scope is final; drop S-22.\"",
  "The builder is blocked until you confirm the schema change with them.",
  "Builder-1 won't move until it hears from you about the auth choice.",
  "The Vercel expert is waiting on your word in [b2c3d4] before deploying.",
  "It's probably best if the answer to dec-11 reaches builder-2 from you directly.",
  "A quick word from you to the delivery lead would unblock the whole sprint.",
  "The product manager should hear about the scope cut from you, ideally today.",
];

test('round 4: the reviewer\'s false positives pass and its misses are flagged', () => {
  for (const t of REVIEW4_LEGIT) { const r = findRelayRequest(t); assert.equal(r, null, `false positive: ${JSON.stringify(t)} => ${r && r.phrase}`); }
  for (const t of REVIEW4_RELAY) assert.ok(findRelayRequest(t), `missed: ${JSON.stringify(t)}`);
});

test('round 4 fixes, one by one', () => {
  const no = (t, why) => assert.equal(findRelayRequest(t), null, `${why}: ${t}`);
  const yes = (t, why) => assert.ok(findRelayRequest(t), `${why}: ${t}`);
  // 1. a clause that starts with a party is not an imperative (builder-3 with its digit, <word> lead, staffing)
  no('Builder-3 has been rebased onto the session from builder-2.', 'party start');
  no('Platform lead reported back to the delivery lead.', 'party start');
  yes('Ping builder-3 in its session.', 'an imperative that names a party');
  // 2. -s words of four or more letters and the new openers are not imperatives; pass/press/... are
  no('Updates from builder-1 arrived overnight in its session.', '-s opener');
  // known limit: a noun-led status after a short colon label still reads as an imperative when it
  // names a place ("Updates from builder-1: export done in its session"); see the round 4 report
  no('Lastly the delivery lead re-cut the sprint in its session.', 'opener');
  yes('Press approve in the builder window.', '-ss verb');
  yes('Discuss the scope with the delivery lead in its session.', 'listed -s verb');
  // 3. "there's" and "there is" are not a place
  no("There's a note for you in the bead; builder-2 is done.", "there's");
  yes('Please answer it over there.', 'over there');
  // 4. "<label> for you:" is an address only when an imperative or a mark follows the colon
  no('Summary for you: the delivery lead re-cut the sprint.', 'label');
  yes('Quick one for you: approve the permission prompt that builder-1 is showing.', 'label + imperative');
  no('Decision for you: approve the migration for builder-2?', 'label + decision question');
  // 5. recall additions
  yes('btw can u tell the builder to stop', 'can u');
  yes('Here is a draft you can send to the delivery lead.', 'you can send');
  yes('The infra expert is waiting on your word in [b2c3d4].', 'waiting on your');
  yes('One ask \u2014 go to session [9f8e7d] and tell builder-3 to rebase.', 'em-dash split');
  yes('FYI \u2192 ask builder-2 to re-run e2e.', 'arrow split');
  yes('ok last thing - shoot the delivery lead a msg.', 'spaced hyphen split');
  yes('The builder is blocked until you confirm the schema change with them.', 'blocked until you');
  yes('The product manager should hear about the cut from you.', 'hear from you');
  no('The builder keeps going until you say stop; which scope do you want, A or B?', 'a bare until you, then a decision question');
  no('Builder-2 is waiting on your answer. Which do you prefer, A or B?', 'the decision is asked in the next clause');
  no('Builder-2 was blocked on you until dec-4 landed.', 'past tense');
  no('I recorded the answer from you as dec-5 and sent it to builder-2.', 'first person');
  // 6. the plan-line cancel needs a plan or first-person context and no "you"
  yes('Forward ans-4 to the spike researcher so they can close the spike.', 'no plan context');
  no('Plan:\n1. Record your answer.\n2. Send dec-8 to builder-2.', 'plan list');
  no("I'll finish the briefing. Forward dec-9 to builder-2 after that.", 'first-person context');
  yes('Next steps for you:\n- Forward dec-9 to builder-2.', 'a list addressed to the operator');
  // "Pass dec-21 to the release owner after this." (round 3 legit row) is now flagged by design (rule 6)
  yes('Pass dec-21 to the release owner after this.', 'rule 6 reclassification');
});

test('round 4: the relay reason quotes the flagged clause on the first block, in its own casing', () => {
  const r = findRelayRequest('All good. Could you Tell the Delivery Lead to proceed?');
  assert.equal(r.clause, 'Could you Tell the Delivery Lead to proceed');
  assert.equal(relayReason('', r.clause), 'You carry answers; the operator does not. You wrote: "Could you Tell the Delivery Lead to proceed". Rewrite only that clause: a decision only the operator can make goes into your next batched briefing (if it blocks work now, ask it once here yourself); record the answer, then send the record id yourself with SendMessage.');
  assert.equal(relayReason('dec-3', r.clause), 'You carry answers; the operator does not. You wrote: "Could you Tell the Delivery Lead to proceed". Rewrite only that clause: send the record id yourself with SendMessage; keep any real decision question to the operator.');
});

// Round 4 sets. DEV4 was written for tuning. HELDOUT4A was written after the first round 4 rule and
// measured once (recall 14/20, long briefings flagged 3/8, short 0/12); its misses then shaped the
// next changes, so it is training data now. HELDOUT4B was written after those changes and measured
// once (recall 15/20, long 0/8, short 0/12), then also used. HELDOUT4C was written after the last
// change and measured once, with no change after it: recall 18/20, long 1/8, short 0/12. All are kept
// as regression rows; the asserted floors are the measured numbers.
const DEV4_RELAY = [
  "The payments expert is stuck until you okay the sandbox spend.",
  "Builder-4 still needs your go-ahead before it can merge.",
  "The mobile lead should get the iOS answer from you, not from me.",
  "Honestly it would help if you pinged the design lead about the icons.",
  "Quick favour \u2014 hop into [8c9d0e] and approve the pod install.",
  "Last bit: let the release owner know Thursday is fine.",
];
const DEV4_LONG_LEGIT = [
  "Evening briefing. Five sessions are live: [0a1b2c] builder-1 on s-31 (search filters), [1b2c3d] builder-2 on s-32 (CSV import), [2c3d4e] the design lead reviewing tokens, [3d4e5f] the delivery lead re-planning sprint 4, and [4e5f60] the progress observer.\n\n- builder-1: filters merged behind a flag; e2e green; waiting on QA sign-off from the qa reviewer, which I chased.\n- builder-2: import parser done, rebasing onto main after builder-1's merge; no blockers.\n- Design lead: closed 6 of 8 contrast findings; the remaining two need a token rename, tracked in s-35.\n- Delivery lead: proposes moving s-34 (bulk export) to sprint 5 because the import took longer.\n- Observer: no stalls in the last 3 hours.\n\nRecords: dec-40 (keep Postgres), dec-41 (flag naming) are sent to every session that needs them.\n\nDecision for you: should bulk export slip to sprint 5 as the delivery lead proposes, or do we cut the import's XLSX support to keep it? I recommend the slip.",
  "Status at 14:00. Builder-3 finished the onboarding flow (s-60) and the reviewer approved it; the release manager has it queued for Thursday. Builder-4 is mid-way through s-61 and reports the payment sandbox is flaky; the payments expert is investigating in [9e8d7c]. Staffing onboarded a second QA reviewer this morning. The spike researcher closed spike-9: websockets are fine at our scale, so dec-52 stands and I sent it to builder-4.\n\nTwo things need you:\n1. Approve the Thursday release window, yes or no?\n2. Do you want the second QA reviewer on the payments story or on accessibility?\n\nEverything else is moving; nothing else is blocked on you.",
  "Weekly summary. Sprint 3 closed with 9 of 11 stories done. The two misses (s-27, s-29) are carried over; builder-1 owns both. The delivery lead re-cut sprint 4 to 10 stories. The infra manager rotated the staging keys after the audit; dec-44 records the rotation policy, and every builder has it. The design lead shipped the dark theme tokens; builder-2 already consumes them in [5f6a7b].\n\nRisks: the vercel specialist warns that preview deploys exceed the free tier at our pace. Options are A) pay for the pro tier ($20/month) or B) limit previews to main. My recommendation is A.\n\nWhich do you prefer, A or B?",
  "Quick update while you were away: builder-2 was blocked on you for the auth choice, but dec-47 answered it (you picked passkeys) and I forwarded it. The PM session asked about the beta cohort size; dec-48 covers that. Builder-1 is now on s-40. The observer flagged a stalled session ([6a7b8c], the old spike) which I closed. Separately, the accessibility reviewer wants a decision on focus rings: always visible, or keyboard-only? That one is yours.",
  "Overview of the day. Morning: the delivery lead and the product owner finished story mapping for the reporting epic; 14 stories are in the backlog, s-70 to s-83. Midday: builder-1 and builder-2 paired on the shared chart component in [7b8c9d]; it landed with tests. Afternoon: the spike researcher compared three PDF libraries and recommends pdf-lib (spike-11, findings in the bead). The infra manager set up the nightly backup job; it ran once successfully.\n\nOpen items: none blocked. The release owner plans the next cut for Monday. Highlights from the observer: average time-to-review dropped to 40 minutes.\n\nOne decision, when you have a moment: should reporting ship with PDF export in v1, or CSV only? The PDF path adds roughly two days.",
  "Here's where things stand. Builder-5 has been hired via staffing for the mobile work and onboarded in [8c9d0e]; it picked up s-90. The mobile lead asked whether we target iOS 16 or 17; I answered from dec-30 (iOS 16) and sent the record id. Builder-1 is on s-88, builder-2 on s-89, both green. The design lead is waiting for the icon set from the brand agency, which is outside our team. The progress observer reports nothing stalled. Per your note yesterday, the PM session is holding the pricing page until legal replies.\n\nNo action needed from you today.",
];
const HELDOUT4A_RELAY = [
  "Could you loop in the billing specialist on the refund cap?",
  "Drop a line to builder-6 saying the cache flag stays on.",
  "When you're back, fire off a note to the docs agent about the API rename.",
  "Mind giving the content lead a heads-up that the launch post moves to Friday?",
  "Please brief the observability engineer on the alert thresholds you chose.",
  "Hop across to [c0ffee] and hit continue for the migration owner.",
  "You can copy my summary straight into the QA engineer's tab.",
  "Tip off the security reviewer that dec-77 changes the token TTL.",
  "u could ping builder-7 and say the schema is frozen",
  "Can you give the docs agent the thumbs-up in its pane?",
  "Last step \u2014 tell the test researcher to stop the benchmark run.",
  "Would you clue the migration owner in about the rollback plan?",
  "Please update the product owner on the pricing call yourself.",
  "Radio the infra role that the DNS change is approved.",
  "The billing specialist can't continue until you sign off on the refund cap.",
  "Builder-6 is holding the release for your yes.",
  "The docs agent would really like to hear from you about the tone.",
  "It'd be quickest if the content lead got the launch date from you directly.",
  "The migration owner is stalled on you \u2014 it needs your approval to drop the old table.",
  "The QA engineer still needs a word from you before it closes the bug bash.",
];
const HELDOUT4A_SHORT_LEGIT = [
  "I looped in the billing specialist; dec-80 is in its session now.",
  "Would you prefer the docs agent to write in British or American English?",
  "Builder-6 dropped the cache flag after dec-81.",
  "Should the content lead own the launch post, or the product owner?",
  "Once you pick a TTL, I'll brief the security reviewer.",
  "Heads-up: the observability engineer paused alerts for the maintenance window.",
  "Tests are green across all sessions.",
  "Can you clarify what 'soft launch' means for the pricing page?",
  "Do you want builder-7 to take the schema story or the billing one?",
  "Nothing for you to relay; every session already has dec-82.",
  "The migration owner confirmed the rollback plan with me.",
  "Please pick the launch date: 3 or 10 March.",
];
const HELDOUT4A_LONG_LEGIT = [
  "Morning roll-up. Seven sessions are open: [aa01bb] builder-6 on s-101 (invoice PDFs), [bb02cc] builder-7 on s-102 (dunning emails), [cc03dd] the billing specialist reviewing tax rules, [dd04ee] the docs agent rewriting the API guide, [ee05ff] the content lead drafting the launch post, [ff0600] the observability engineer tuning alerts, and [0607aa] the progress observer.\n\nBuilder-6 merged the PDF renderer overnight; the reviewer passed it with two nits that are already fixed. Builder-7 is waiting on the email provider's sandbox approval, which is outside our team; ETA tomorrow. The billing specialist found that EU VAT rounding differs from our spec; dec-90 records the rounding rule and both builders have it. The docs agent finished sections 1 to 4. The content lead's draft is in the bead for s-105. Alerts: the observability engineer cut paging noise by half, and the progress observer saw no stalls overnight.\n\nThere's one thing for you: do we announce the launch on the blog and in-app, or in-app only? I recommend both, because the blog reaches the trial users who have not logged in this month.",
  "Recap for you \u2014 sprint 7, day 3.\n\n- Builder-6 \u2014 s-110 done, s-111 started.\n- Builder-7 \u2014 rebasing after the provider SDK bump; tests pass locally.\n- Security reviewer \u2014 finished the threat model for webhooks; three findings, two closed, one open (replay protection), tracked as s-114.\n- Migration owner \u2014 dry-run of the ledger migration succeeded on a staging copy in [1a2b3c]; real run scheduled Saturday.\n- Test researcher \u2014 spike-14 shows contract tests catch 80% of the regressions we had last quarter; write-up in the bead.\n- Observer \u2014 flagged [2b3c4d] as idle for two hours; it was the docs agent waiting for review, now unblocked.\n\nRecords sent this morning: dec-93 (webhook retries), dec-94 (ledger cutover window). Every session that needs them has them.\n\nDecisions waiting on you:\n1. Saturday cutover at 02:00 UTC or 06:00 UTC?\n2. Should replay protection block the release, or ship as a fast follow?\n\nMy recommendation: 06:00, and block the release, since the open finding is exploitable from outside.",
  "Since your last check-in a lot moved. Builder-7 was blocked on you about the retry limit until dec-95 came through; it picked the work back up within minutes. The billing specialist and the security reviewer agreed the webhook signature scheme between themselves, and the solution is written into s-114. The content lead asked whether the launch post may mention pricing; dec-88 already says no, so I answered from the record. The docs agent is now on the migration guide, with input from the migration owner in [3c4d5e]. The release manager has a draft checklist for Saturday. Builder-6 is idle; I asked staffing whether we should release it or keep it for the reporting epic, and staffing suggested keeping it one more day. Progress observer: no stalls, no loops.\n\nSeparately, the observability engineer proposes paging only on customer-facing errors after 22:00. That changes the on-call agreement you set in dec-61, so it is your call: accept the change, or keep paging on everything?",
  "Status by session:\n[4d5e6f] builder-6 \u2014 invoice PDFs shipped to staging; waiting for the billing specialist's final read.\n[5e6f70] builder-7 \u2014 dunning emails in review; the reviewer wants one more test for the third reminder.\n[6f7081] docs agent \u2014 API guide at 70%; screenshots pending the new theme.\n[708192] content lead \u2014 launch post approved by the product owner.\n[8192a3] migration owner \u2014 rehearsal two finished in 11 minutes; rollback rehearsed too.\n[92a3b4] observability engineer \u2014 dashboards for the ledger in place.\n[a3b4c5] progress observer \u2014 nothing stalled since yesterday evening.\n\nNumbers: 14 of 18 sprint stories done, 2 in review, 2 not started. Cycle time is 1.6 days, down from 2.1. No session is stuck. Records from today: dec-97, dec-98, both delivered to the sessions that asked.\n\nQuestion for you: the product owner wants to add a referral banner to the launch, which would push s-120 into next sprint and delay the docs agent's screenshots by a day. Do you want the banner in this launch, yes or no?",
  "Good afternoon. Summary first, then one decision.\n\nSummary: builder-7 finished dunning emails and the reviewer signed off; builder-6 is pairing with the billing specialist on the VAT edge cases in [a3b4c5]; the docs agent and the content lead are aligning terminology so the guide and the launch post use the same words; the migration owner has the Saturday runbook ready, and the release manager reviewed it; the security reviewer closed the replay finding with a nonce store (dec-101). The test researcher's contract-test harness is now in CI and caught one real break in the PDF renderer, which builder-6 fixed within the hour. Staffing reports the team is at the agreed budget of seven sessions.\n\nDecision for you: choose the launch day \u2014 Tuesday the 14th or Thursday the 16th? Tuesday gives us a buffer before the weekend; Thursday gives the docs agent two more days to finish the screenshots. I lean Tuesday.",
  "Thanks for the quick answers earlier; they are recorded as dec-102 and dec-103 and the builders have them. A few notes: builder-6 moved to the reporting epic as staffing suggested, and builder-7 is finishing the last dunning template. The migration owner ran the final rehearsal in [b4c5d6] and the observability engineer watched the dashboards during it; no alarms. The content lead wants the launch post reviewed by a human before Tuesday, so please read the draft linked in s-105 when you can \u2014 the content lead is not waiting on it today, Monday is fine. The docs agent will publish the guide on launch day. The security reviewer has nothing open, and the test researcher is extending contract tests to the webhooks.\n\nLast, the product owner raised whether we keep the free tier at 3 seats or move to 1. That is a pricing decision, so it is yours: 3 seats or 1?",
  "Plan for the next hour, so you know what I am doing:\n1. Record your answer on the seat count as dec-104.\n2. Send dec-104 to the product owner and the content lead.\n3. Forward dec-102 to builder-6, which missed it after the move.\n4. Check with the release manager that the Saturday runbook references dec-94.\n\nCurrent state: builder-7 is in review, builder-6 is on s-130, the migration owner is on standby, the docs agent is proofreading, the observability engineer is off until Saturday, and the progress observer reports nothing stalled. The test researcher wants to extend contract tests to the webhooks; I think that is a good use of the spare day and it does not need you. The billing specialist is writing the VAT notes for the help centre.\n\nThe only open question for you: do you want a status message on launch morning, or just the post-launch summary at noon?",
  "Incident note, now resolved. At 09:40 the observability engineer saw error rates climb on the invoice endpoint; builder-6 traced it to the PDF font cache, and the fix shipped at 10:05 (s-133). The billing specialist checked that no invoices were sent twice; none were. The security reviewer confirmed no data was exposed. There's a short write-up in the s-133 bead, and the progress observer has added a stall check for that worker.\n\nKnock-on effects: the migration owner wants to move Saturday's cutover by a week to keep risk low; the release manager agrees; builder-7 and the docs agent are unaffected. dec-94 fixed the cutover window, so moving it changes a recorded decision.\n\nDo you approve moving the ledger cutover to the following Saturday, same time? If yes I will record it and send the new record to the migration owner and the release manager.",
];
const HELDOUT4B_RELAY = [
  "Could you get back to the pricing specialist with the discount ceiling?",
  "Touch base with the delivery lead about dropping s-140, please.",
  "Poke builder-2 and tell it the lint rule is waived.",
  "Would you warn the kubernetes expert that the node pool shrinks tonight?",
  "Can you circle back with staffing on whether we keep the third builder?",
  "Tap approve in [d00d42] so the SEO specialist can publish.",
  "Before lunch, write back to the product manager confirming the beta list.",
  "Inform the spike researcher that the benchmark budget is two hours.",
  "plz buzz the QA lead and say the regression pass can start",
  "Go over to the platform owner's terminal and accept the key rotation.",
  "One favour: reassure builder-1 that the API contract will not change.",
  "You might text the progress observer to stand down for the night.",
  "Can you notify the delivery lead in its session that sprint 9 starts Monday?",
  "Let the pricing specialist have your answer on annual billing directly.",
  "The kubernetes expert is parked until you confirm the region.",
  "Builder-2 can't merge until it gets the nod from you.",
  "The product manager would rather get the verdict from you than from me.",
  "Staffing needs your okay before it can hire the second designer.",
  "It'd help a lot if you nudged the SEO specialist about the sitemap.",
  "The QA lead is sitting on the release until you give it the green light.",
];
const HELDOUT4B_SHORT_LEGIT = [
  "I got back to the pricing specialist; dec-150 caps discounts at 20%.",
  "Do you want the kubernetes expert to shrink the node pool tonight or next week?",
  "The SEO specialist published the sitemap after dec-151.",
  "Would you rather the QA lead run the regression pass now or after the freeze?",
  "When you decide, I'll write back to the product manager.",
  "FYI the platform owner rotated the keys at noon.",
  "All four builders' suites are green.",
  "Could you say more about what 'enterprise-ready' means to you?",
  "Which story should builder-2 pick up next: s-141 or s-142?",
  "Nothing to pass along; the delivery lead already holds dec-152.",
  "The spike researcher told me the benchmark finished early.",
  "Please choose the beta size: 50 or 200 users.",
];
const HELDOUT4B_LONG_LEGIT = [
  "## Where we are\n\nSprint 9 is halfway. [e1f2a3] builder-1 closed s-141 (saved searches) and s-143 (search analytics); [f2a3b4] builder-2 is on s-142 (typo tolerance), which turned out bigger than estimated. The delivery lead re-estimated it at five points and moved s-146 out to keep the sprint honest. The spike researcher finished spike-18 on vector search: promising, but it needs a managed index we do not run yet, so the recommendation is to defer it to the next quarter. Staffing kept the third builder slot open, as dec-149 says.\n\n## Risks\n\nThe kubernetes expert reports that the search cluster runs at 78% memory during the nightly reindex. The platform owner can add a node for about $90 a month. Without it, a reindex failure would take search down for roughly an hour, and the progress observer would page the on-call builder.\n\n## For you\n\nShould we add the node now, or accept the risk until the next budget review? I recommend adding it.",
  "Afternoon check-in.\n\nBuilder-2 \u2014 typo tolerance merged behind a flag; perf within budget.\nBuilder-1 \u2014 on s-144 (search filters for mobile), pairing with the mobile specialist.\nPricing specialist \u2014 drafted three discount tiers; waiting for your call on the ceiling.\nSEO specialist \u2014 sitemap live, crawl errors down to zero.\nProgress observer \u2014 quiet afternoon, no loops.\n\nThe pricing specialist is waiting on your decision before it writes the checkout copy. Which ceiling do you want: 15%, 20% or 25%? My recommendation is 20%, which matches what the product manager modelled in dec-147 and keeps the margin above target.\n\nEverything else is unblocked. The delivery lead plans to close the sprint on Friday as scheduled, and the QA lead booked the regression window for Thursday morning. dec-153 (crawl budget) went to the SEO specialist an hour ago.",
  "Overnight summary. The kubernetes expert was waiting on you for the region choice until dec-154 landed at 07:10; it has since moved the staging cluster to eu-west. Builder-1 heard from you through me (dec-155, mobile filters ship in v2) and re-planned its afternoon. Builder-2 finished the typo-tolerance tuning and handed it to the QA lead, who found two edge cases with accented characters; both are fixed in [a4b5c6]. Staffing interviewed two candidates for the designer slot and prefers the second; it will share notes in its bead. The platform owner rotated the database credentials on schedule. The spike researcher started spike-19 on query caching and expects results tomorrow. The progress observer flagged a long-running test in builder-2's session, which turned out to be a fixture download and was fixed.\n\nOne question for you today: do you want the designer hire to start before or after the launch? Starting before costs two weeks of onboarding during the busiest period.",
  "Thanks, both answers are recorded: dec-156 (designer starts after launch) and dec-157 (keep the 20% ceiling).\n\nNext steps on my side:\n- Send dec-156 to staffing and the product manager.\n- Send dec-157 to the pricing specialist.\n- Ask the delivery lead whether the launch checklist needs a hiring item.\n- Check that builder-2's flag defaults match dec-145.\n\nMeanwhile the team is steady. Builder-1 is finishing mobile filters, the SEO specialist is writing structured data for the product pages, and the QA lead is preparing Thursday's regression run in [b5c6d7]. The kubernetes expert has nothing open after the region move. The platform owner wants to schedule the next credential rotation for the 1st of each month, which is consistent with the security policy you approved earlier, so I treated it as covered.\n\nNothing else needs a decision from you right now. I will send the evening summary at 18:00 as usual.",
  "Please take a look at the launch announcement when you have ten minutes; the content is final from our side and the product manager signed off on the wording. The SEO specialist added the meta descriptions, and builder-1 wired the announcement banner behind a flag, so nothing ships until you say so. Builder-2 is idle for the afternoon; staffing suggests lending it to the QA lead for exploratory testing, which I think is sensible and within dec-149's budget. The spike researcher's caching spike shows a 40% latency cut on repeated queries; the delivery lead wants to slot it in sprint 10 as s-150. The progress observer reports a calm day with no stalled sessions. The platform owner finished the dashboard for search latency, linked in s-148.\n\nTwo decisions for you: first, may the banner go live on Tuesday at 09:00? Second, do you agree with lending builder-2 to the QA lead for the rest of the week?",
  "Live sessions right now:\n[c6d7e8] builder-1, mobile filters, 80% done\n[d7e8f9] builder-2, exploratory testing with the QA lead\n[e8f90a] the SEO specialist, structured data\n[f90a1b] the kubernetes expert, idle\n[0a1b2c] the progress observer, watching\n[1b2c3d] the delivery lead, drafting sprint 10\n\nClosed today: s-144, s-148, spike-19. Opened: s-150 (query cache), s-151 (accent folding follow-up). Records issued: dec-158 (cache TTL of ten minutes), dec-159 (accent folding in v1), both sent to builder-1, builder-2 and the delivery lead.\n\nLooking ahead, sprint 10 has room for about 21 points. The delivery lead's draft holds 24, so three points must go. The candidates are s-151 (3 points), or the last part of s-150 (3 points). Which would you rather defer: the accent-folding follow-up or the cache warm-up? I lean towards deferring the warm-up, since accent folding fixes complaints we already have.",
  "Short one today. The launch is on track for Tuesday. Builder-1 merged mobile filters; builder-2 returned from exploratory testing with four minor bugs, all fixed in [2c3d4e]. The QA lead's regression run passed on the second attempt after a flaky checkout test was quarantined (s-152 tracks the real fix). The SEO specialist's structured data validates in the search console. The kubernetes expert scaled the search cluster per dec-160, and memory now peaks at 61%. Staffing has the designer starting on the 3rd, after the launch, as dec-156 says. The delivery lead finalised sprint 10 at 21 points with the warm-up deferred.\n\nThe product manager needs your sign-off on the launch email before it is scheduled. Do you approve the draft linked in s-153, or would you like changes first? If you approve, I will record it and the product manager schedules the send for Tuesday 08:30.",
  "Retro notes from sprint 9, as you asked. What went well: builder-1 and builder-2 shipped every committed search story; the spike researcher's two spikes saved us from building a vector index we did not need; the QA lead caught the accent bug before users did. What did not: typo tolerance was underestimated by three points, and the delivery lead wants story sizing to include a perf check from now on. The progress observer measured an average wait of 25 minutes for answers from you through me, down from 70 last sprint, mostly because the briefings now batch questions. Staffing notes we stayed within the three-builder cap all sprint.\n\nProposed changes for sprint 10: a perf check in every story's definition of done, and a mid-sprint review on Wednesdays. The first is a team practice and I have asked the delivery lead to adopt it. The second changes your calendar, so it is your call: do you want a Wednesday mid-sprint review, yes or no?",
];
const HELDOUT4C_RELAY = [
  "Could you give the GDPR specialist a shout about the retention clause?",
  "Reach out to builder-4 and let it know the feature flag can go.",
  "Kindly run the new copy by the copy reviewer before Friday.",
  "Square the font licence with the iOS expert, would you?",
  "Nip over to [beef01] and confirm the cert renewal for the perf engineer.",
  "Follow up with the analytics lead on the event names, please.",
  "Mention to the onboarding owner that the welcome email is cut.",
  "If you get a minute, escalate the outage to the search engineer.",
  "can u prod the Android specialist re the crash logs",
  "You'll want to settle the naming question with builder-3 directly.",
  "Ok so \u2014 flag the billing bug to the support agent in its chat.",
  "Pass on to the delivery lead that the demo moves to 3pm.",
  "Would you mind OK-ing the schema change with the perf engineer?",
  "First thing tomorrow, chase the copy reviewer for the final sign-off.",
  "The GDPR specialist is stuck on you for the consent wording.",
  "Builder-3 won't ship the patch until it has your go-ahead.",
  "The analytics lead should really hear the decision from you.",
  "The search engineer needs to hear from you before it reindexes.",
  "It'd be cleanest if the onboarding owner got the copy approval from you.",
  "The support agent is on hold until you reply about the refund.",
];
const HELDOUT4C_SHORT_LEGIT = [
  "I gave the GDPR specialist a shout; dec-170 settles the retention clause.",
  "Do you want builder-4 to remove the flag now or after the audit?",
  "The copy reviewer approved the new onboarding copy this morning.",
  "Should the iOS expert or the Android specialist own the shared font work?",
  "As soon as you choose, I'll follow up with the analytics lead.",
  "The perf engineer's cert renewal went through at 11:00.",
  "Every session is idle except the search engineer's.",
  "Could you explain what 'lightweight consent' should look like for you?",
  "Which name do you prefer for the event: signup_completed or account_created?",
  "No need to chase anyone; the support agent already has dec-171.",
  "The onboarding owner checked the welcome email with me.",
  "Please decide on the demo slot: 3pm or 5pm.",
];
const HELDOUT4C_LONG_LEGIT = [
  "Daily digest, Wednesday.\n\nBuilder-3 shipped the crash fix for the Android login loop (s-201) and the Android specialist verified it on four devices. Builder-4 is halfway through s-202, the consent banner; it depends on the wording the GDPR specialist is drafting, which should land this afternoon. The iOS expert finished the font licence review: the current typeface is fine for apps but not for marketing pages, so the copy reviewer is collecting alternatives. The analytics lead renamed eleven events to the new convention, recorded in dec-172, and every session that emits events has the record. The perf engineer measured cold start at 1.9 seconds on mid-range phones, down from 2.6. The search engineer's reindex ran overnight in [ca11ab] without errors. The progress observer saw no stalled sessions and one long review queue, which the delivery lead has already rebalanced.\n\nOne decision for you: do we keep the marketing pages on the current typeface until a licence is bought, or switch them to a free alternative this week? I recommend switching, because the purchase needs legal review and could take a month.",
  "Status board:\n\n- [d1e2f3] builder-3 \u2014 s-205 (offline mode) started; spike notes from the spike researcher attached.\n- [e2f3a4] builder-4 \u2014 s-202 consent banner in review with the copy reviewer.\n- [f3a4b5] support agent \u2014 triaged 31 tickets; 4 are bugs, now s-206 to s-209.\n- [a4b5c6] analytics lead \u2014 dashboards updated for the renamed events.\n- [b5c6d7] onboarding owner \u2014 welcome email variant B live for 10% of signups.\n- [c6d7e8] progress observer \u2014 all sessions healthy.\n\nHighlights: variant B lifts day-one activation from 31% to 36% so far, on about 800 signups. Concerns: the search engineer warns that the index grows faster than planned and will hit the current disk in about six weeks.\n\nRecords today: dec-173 (offline mode scope: read-only), dec-174 (bug triage owner), both delivered.\n\nFor you: should we roll variant B out to everyone now, or wait for a full week of data as the analytics lead suggests? The difference is roughly 400 extra activated users if we roll out today and the effect holds.",
  "Since yesterday's briefing: the GDPR specialist delivered the consent wording, builder-4 wired it into the banner, and the copy reviewer approved the final text, so s-202 is done. The perf engineer was waiting on you for the cold-start budget until dec-175 set it at two seconds; that is now met on every device class we test. The iOS expert and the Android specialist agreed on a shared component for the offline indicator, which builder-3 is building as part of s-205. The support agent noticed a spike in password-reset tickets after the email provider changed its template; the onboarding owner reverted the template, and the tickets dropped back to normal within two hours. Staffing asked whether we still need the second analytics session; the analytics lead says the event rename is finished, so I expect to release it on Friday unless something new comes up. The delivery lead updated the sprint board and the burn-down is on track.\n\nA question for you: are you comfortable with offline mode shipping read-only in v1, as dec-173 says, or do you want offline edits back in scope, which adds roughly a sprint?",
  "Here is my plan for the rest of today, so you can see what I am handling:\n1. Send dec-176 to builder-3 and the iOS expert.\n2. Forward dec-175 to the search engineer, which joined after it was recorded.\n3. Ask the analytics lead for the variant B numbers at 17:00.\n4. Remind the support agent to tag reset tickets with the template version.\n\nTeam state: builder-3 is on s-205, builder-4 is idle after finishing the banner and will pick up s-206, the perf engineer is profiling the image cache, the GDPR specialist is reviewing the data-retention job, and the onboarding owner is drafting variant C. The copy reviewer is out until Monday, and the delivery lead has moved two copy-dependent stories accordingly. The progress observer reports nothing stalled and one session close to its budget, which I am watching.\n\nNothing in this plan needs you. The only open item that is yours is the typeface question from this morning: switch the marketing pages to a free alternative this week, or wait for the licence?",
  "Weekly summary for the leadership update.\n\nDelivered this week: crash fix for the Android login loop, the consent banner, renamed analytics events, variant B of the welcome email, and the first half of offline mode. Velocity was 26 points against a plan of 24. Quality: two escaped bugs, both minor, both fixed within a day by builder-3 and builder-4. The support agent's ticket volume is down 12% week over week, mostly thanks to the reverted email template.\n\nPeople and sessions: staffing released the second analytics session as planned; the team is now eight sessions, within the budget of ten. The GDPR specialist's engagement ends next Friday; the retention job review is the last item, and it is on track. The perf engineer stays through the next sprint to finish the image cache work. The spike researcher has no open spikes.\n\nNext week: finish offline mode, start the image cache, and run variant C if variant B's results hold. The delivery lead has the sprint drafted.\n\nOne decision before Monday: do you want the leadership update to include the activation numbers from variant B, given that the sample is still small?",
  "Quick heads-up on a risk, then a question. The search engineer projects that the index outgrows the current disk in about six weeks, earlier than the twelve weeks we planned for. There are two options. Option A: the perf engineer and the search engineer prune old tokens and compress the index; about four days of work, buys roughly three months, no cost. Option B: the platform team adds a larger disk; about $60 a month, an hour of work, and no engineering time taken from the roadmap. The delivery lead notes that option A would push s-210 (saved filters) to the next sprint, and the onboarding owner has promised saved filters to two pilot customers. Builder-3 and builder-4 are not affected either way. The analytics lead has no view. The spike researcher looked at both and thinks A is technically cleaner but agrees that B is the safer choice for the pilot.\n\nMy recommendation is option B now, with option A scheduled for the quarter after the pilot. Which do you prefer, A or B, or a different split between them?",
  "Evening wrap-up. It was a calm day. Builder-3 merged the offline indicator component; the iOS expert and the Android specialist both reviewed it, and it now ships behind the offline flag. Builder-4 picked up s-206 (duplicate notifications) and found the cause in the retry logic of the push service; the fix is in review in [aa11bb]. The GDPR specialist approved the data-retention job, with one change: logs are kept for 30 days instead of 45. That matches the policy you set in dec-160, so I treated it as covered and recorded nothing new. The support agent closed 19 tickets; none were new bugs. The onboarding owner launched variant C for 10% of signups at 15:00. The analytics lead set up the comparison dashboard and will share the first numbers tomorrow. The perf engineer's image cache prototype cuts gallery load time by 40% on slow networks. The progress observer recorded no stalls and no loops.\n\nTomorrow I will brief you at 09:00 as usual. There is nothing for you to do tonight and no decision pending.",
  "Answer recorded as dec-177: the leadership update leaves out the variant B numbers until the sample reaches 5,000 signups. I have sent dec-177 to the analytics lead, who owns the update draft, and to the onboarding owner, who asked about it this morning.\n\nElsewhere: builder-4's notification fix passed review and is deployed; duplicate pushes dropped to zero in the last two hours. Builder-3 started on offline caching of the message list. The search engineer and the perf engineer agreed on the pruning approach for later in the quarter, as dec-176 says. The copy reviewer returns on Monday and has six items waiting, which the delivery lead has ordered by priority. Staffing confirmed the GDPR specialist's last day is Friday and has arranged a handover note in the bead for the data-retention work. The support agent flagged that a pilot customer asked about an Android tablet layout; the Android specialist thinks it is a two-day job.\n\nThat brings up the last question for today: should the tablet layout go into the next sprint for the pilot customer, or wait until after the pilot ends?",
];

const MANIFEST_PARTIES = ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder-1', 'builder', 'builder-2'];

test('round 4 sets: recall, long-briefing and short false positives stay at or better than measured', () => {
  for (const parties of [undefined, MANIFEST_PARTIES]) {
    const f = (t) => findRelayRequest(t, { parties });
    const sets = [
      ['dev', DEV4_RELAY, [], DEV4_LONG_LEGIT, DEV4_RELAY.length, 0],
      ['4a', HELDOUT4A_RELAY, HELDOUT4A_SHORT_LEGIT, HELDOUT4A_LONG_LEGIT, 20, 0],
      ['4b', HELDOUT4B_RELAY, HELDOUT4B_SHORT_LEGIT, HELDOUT4B_LONG_LEGIT, 20, 0],
      ['4c', HELDOUT4C_RELAY, HELDOUT4C_SHORT_LEGIT, HELDOUT4C_LONG_LEGIT, 18, 1],
    ];
    for (const [name, relay, short, long, minRecall, maxLong] of sets) {
      const missed = relay.filter((t) => !f(t));
      assert.ok(relay.length - missed.length >= minRecall, `${name} missed: ${JSON.stringify(missed)}`);
      const sfp = short.filter((t) => f(t));
      assert.equal(sfp.length, 0, `${name} short flagged: ${JSON.stringify(sfp)}`);
      const lfp = long.map(f).filter(Boolean);
      assert.ok(lfp.length <= maxLong, `${name} long flagged: ${JSON.stringify(lfp.map((r) => r.phrase))}`);
    }
  }
});

test('I3: the Product Manager gets the unrecorded-input and relay checks for its own session; other roles get none', () => {
  const p = captured('product-manager', [human('drop the export feature from the beta', 1)]);
  const args = stopArgs(p, { last_assistant_message: 'Please tell the builder session to drop it.' }, { role: 'product-manager', instance: 'product-manager' });
  assert.deepEqual(operatorChecks(args).map((f) => f.kind), ['unrecorded', 'relay']);
  R.ack({ projectRoot: p.projectRoot, input: 'in-pc-000001', reason: 'conversational', by: { instance: 'product-manager', role: 'product-manager', session_id: SID, host: 'pc' } });
  assert.deepEqual(operatorChecks(args).map((f) => f.kind), ['relay']);
  for (const role of ['delivery-lead', 'staffing', 'progress-observer', 'builder', 'spike-researcher']) {
    assert.deepEqual(operatorChecks({ ...args, role }), [], role);
  }
});

test('I2: every command named in a Stop block reason passes the Chief of Staff\'s and the Product Manager\'s lane', () => {
  const { loadPolicy, decideLane } = require('./lane.js');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const p = captured('chief-of-staff', [human('use postgres for the store', 1)]);
  const inputs = [{ id: 'in-pc-000001', session_id: SID, instance: 'chief-of-staff', text: 'use postgres' }];
  const reasons = [
    ...operatorChecks(stopArgs(p)).map((f) => f.reason),
    ...operatorChecks(stopArgs(p, {}, { deps: { pending: () => ({ inputs, problems: [{ file: 'records/chief-of-staff', code: 'truncated', error: 'x' }] }) } })).map((f) => f.reason),
    ...operatorChecks(stopArgs(p, {}, { deps: { pending: () => ({ inputs, problems: [{ file: 'records/chief-of-staff', code: 'torn_tail', error: 'x' }] }) } })).map((f) => f.reason),
  ];
  const commands = reasons.flatMap((r) => r.split('`').filter((x, k) => k % 2 === 1));
  assert.ok(commands.length >= 5, commands.join('\n'));
  for (const role of ['chief-of-staff', 'product-manager']) {
    const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + role });
    for (const c of commands) {
      assert.ok(c.startsWith(`${OP} `), c);
      const command = c.replace(/'<[^>]*>'/g, "'the operator said: don'\\''t, ok?'").replace(/<[^>]*>/g, 'x1');
      const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy, roleDir: p.roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
      assert.equal(d.allow, true, `${role}: ${command}\n${d.reason || ''}`);
    }
  }
});

test('I5: asking the operator to clear another session\'s permission prompt is a relay request', () => {
  for (const m of [
    'The builder has a permission prompt open; please approve it.',
    'builder-2 is stuck on a permission prompt pending in its session, can you approve it?',
    'There is a permission dialog showing in the spike session. Just accept it when you get a moment.',
  ]) assert.ok(findRelayRequest(m), m);
  for (const m of [
    'The builder had a permission prompt pending; I approved it from the lane allow list.',
    'Permission prompts are pre-allowed for in-lane commands now.',
    'No permission prompt is open anywhere.',
  ]) assert.equal(findRelayRequest(m), null, m);
});

test('M5: a retired Chief of Staff or Product Manager instance gets no operator stop checks', () => {
  const p = captured('chief-of-staff', [human('use postgres for the store', 1)]);
  const args = stopArgs(p, { last_assistant_message: 'Please tell the builder session to use postgres.' });
  assert.ok(operatorChecks(args).length >= 1);
  assert.deepEqual(operatorChecks({ ...args, retired: true }), []);
  assert.deepEqual(operatorChecks({ ...args, role: 'product-manager', instance: 'product-manager', retired: true }), []);
});
