// hooks/scripts/message-checks.test.js — what the CoS and PM tell the owner, replayed on Vault moments
// (R-03, R-44, R-45). Pure: the judge's answers are passed in.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./message-checks.js');

const COS = 'chief-of-staff';
const kinds = (r) => r.warnings.map((w) => w.kind);
const find = (message, over = {}) => M.messageFindings({ message, role: COS, ordersMode: null, ...over });

// 10-12 19:03 and 00:28: the owner sent to another session to type
const OPEN_AND_TYPE = 'This is the one thing the test needs from you.\n\nOpen the Progress Observer session and type exactly: go for R2.\n\nOr tell me here to drop the test.';
// 10-12 19:01: homework in the owner's settings
const PASTE_RULE = 'Two changes fix most of it. Add one permission rule for the session tool in your Claude settings. Then I switch all of them in one go.';
// 10-12 19:50: a plain decision question
const DECISION = 'The sign-in fix is waiting on one choice: how long should a second refresh be tolerated, 60 seconds or 10? I recommend 60.';
// 10-17 22:51: a real owner step, queued
const SIGN_IN = 'One step only you can do: sign in to the Vault website in Edge, any method you like. Tell me when it is done.';
const SIGN_IN_STEP = { id: 'o-cos-1', kind: 'signin', what: 'Sign in to the Vault website in Edge', where: 'Edge', steps: 'open the site, sign in with any method' };

test('R-44: "open session X and type" is an order to the owner; a decision question and a plan are not', () => {
  assert.ok(M.ownerImperatives(OPEN_AND_TYPE).some((c) => /Open the Progress Observer session and type/.test(c)));
  assert.ok(M.ownerImperatives(PASTE_RULE).some((c) => /Add one permission rule/.test(c)));
  assert.deepEqual(M.ownerImperatives(DECISION), []);
  assert.deepEqual(M.ownerImperatives('Merged the sign-in fix. Next: the Delivery Manager starts the import. Ask for details on any item.'), []);
  assert.deepEqual(M.ownerImperatives('Should I restart the import now?'), []);
});

test('R-44: judge off, an out-of-queue order warns and never blocks; a queued owner step is not an order', () => {
  const off = find(OPEN_AND_TYPE);
  assert.deepEqual(off.candidates, []);
  assert.deepEqual(kinds(off), ['orders-owner']);
  assert.deepEqual(find(SIGN_IN).warnings.map((w) => w.kind), ['orders-owner'], 'not queued yet: warned');
  assert.deepEqual(find(SIGN_IN, { openSteps: [SIGN_IN_STEP] }).warnings, [], 'queued: the owner gets the step');
});

test('R-44: judge on, p >= 0.8 with an out-of-queue order blocks once with a two-line reason; 0.5 warns; below passes', () => {
  const judged = (p) => ({ orders_owner: { p }, block_threshold: 0.8 });
  const block = find(OPEN_AND_TYPE, { judged: judged(0.93) });
  assert.equal(block.candidates.length, 1);
  assert.equal(block.candidates[0].kind, 'orders');
  assert.ok(block.candidates[0].reason.split('\n').length <= 2);
  assert.match(block.candidates[0].reason, /owner-queue\.js add --kind/);
  assert.deepEqual(kinds(find(OPEN_AND_TYPE, { judged: judged(0.6) })), ['orders-owner']);
  assert.deepEqual(find(OPEN_AND_TYPE, { judged: judged(0.2) }).warnings, []);
  // a high score with no imperative to the owner (a decision question) does not block
  assert.deepEqual(find(DECISION, { judged: judged(0.9) }).candidates, []);
  // the catalogue can hold the question to warn-only
  assert.deepEqual(find(OPEN_AND_TYPE, { judged: judged(0.93), ordersMode: 'warn-only' }).candidates, []);
  assert.deepEqual(M.messageFindings({ message: OPEN_AND_TYPE, role: 'builder', judged: judged(0.99) }), { candidates: [], warnings: [] });
});

test('R-45 ruling 10: a jargon-heavy status line warns; the plain rewrite does not; ids the owner asked for are fine', () => {
  const jargon = 'vault-wxy.12 blocked on R-34 D5, lane bd-claim refused; see dec-chief-of-staff-4 and .delivery/goal.json.';
  const r = find(jargon);
  assert.deepEqual(kinds(r), ['jargon']);
  for (const id of ['vault-wxy.12', 'R-34', 'D5', 'bd-claim', 'dec-chief-of-staff-4']) assert.ok(r.warnings[0].detail.includes(id), id);
  const plain = 'The sign-in fix is waiting: there is not enough budget left to start it safely. Next: it starts after the reset. Ask for details on any item.';
  assert.deepEqual(find(plain).warnings, []);
  assert.deepEqual(find(jargon, { owner: 'which bead is that?' }).warnings, []);
  assert.deepEqual(find('Merged and live: [the pull request](https://example.com/pr/478).').warnings.filter((w) => w.kind === 'jargon'), []);
  // the project's own bead prefix counts too, and commit shas
  assert.deepEqual(M.idTokens('ex-12 is merged at 5f92993', { prefix: 'ex' }).sort(), ['5f92993', 'ex-12']);
  // the judge's jargon answer warns when the rule finds nothing
  assert.deepEqual(kinds(find('The lane refused the claim so the wave is parked.', { judged: { jargon: { p: 0.85 } } })), ['jargon']);
  assert.deepEqual(find('The lane refused the claim so the wave is parked.', { judged: { jargon: { p: 0.62 } } }).warnings, [], 'below the measured 0.8');
});

test('R-45 10-17 23:07: a 30-line justification briefing warns on length and tone; a 12-line one and a decision brief do not', () => {
  const apology = Array.from({ length: 30 }, (_, i) => `I take responsibility for point ${i + 1}, and I should have seen it earlier.`).join('\n');
  const r = find(apology, { judged: { tone_violation: { answer: 'justifying', confidence: 0.91 } } });
  assert.deepEqual(kinds(r).sort(), ['briefing-length', 'tone']);
  assert.match(r.warnings.find((w) => w.kind === 'briefing-length').detail, /30 lines \(limit 12\)/);
  const twelve = Array.from({ length: 12 }, (_, i) => `Item ${i + 1} merged.`).join('\n');
  assert.deepEqual(find(twelve).warnings, []);
  assert.deepEqual(find(`${twelve}\nWhich do you want first, A or B?`).warnings, [], 'a question to the owner may run longer');
  assert.deepEqual(kinds(find(twelve, { briefingLines: 10 })), ['briefing-length'], 'the owner-set limit applies');
  assert.deepEqual(find('Merged.', { judged: { tone_violation: { answer: 'none', confidence: 0.99 } } }).warnings, []);
});

test('R-03 10-13 08:07: "live" without an evidence read this turn warns; with the read or "not checked yet" it does not', () => {
  const live = 'The import is live in production. Ask for details on any item.';
  assert.deepEqual(kinds(find(live)), ['claim-unchecked']);
  assert.deepEqual(find(live, { commands: ['git status', 'node /p/scripts/evidence.js check vault-0n9-3'] }).warnings, []);
  assert.deepEqual(find('The import is merged, not checked yet.').warnings, []);
  assert.deepEqual(find('The import is not live yet.').warnings, []);
});

test('the next-prompt reminder is two lines and ends with the plain-words instruction', () => {
  const text = M.reminderText(find(`${'x\n'.repeat(20)}vault-wxy.12 is live`).warnings);
  assert.equal(text.split('\n').length, 2);
  assert.match(text.split('\n')[1], /Ask for details on any item"/);
  assert.equal(M.reminderText([]), '');
});
