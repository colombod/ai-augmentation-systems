// hooks/scripts/message-checks.test.js — what the CoS and PM tell the owner, replayed on Vault moments
// (R-03, R-44, R-45). Pure: the judge's answers are passed in.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./message-checks.js');

const COS = 'chief-of-staff';
const kinds = (r) => r.warnings.map((w) => w.kind);
const find = (message, over = {}) => M.messageFindings({ message, role: COS, ordersMode: null, prefix: 'vault', ...over });

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
  assert.deepEqual(M.ownerImperatives('I recommend 60. Reply 60 or 10.'), [], 'answering here is deciding, not homework');
  assert.deepEqual(M.ownerImperatives('Merged the sign-in fix. Next: the Delivery Manager starts the import. Ask for details on any item.'), []);
  assert.deepEqual(M.ownerImperatives('Should I restart the import now?'), []);
});

// review I3: ordinary briefings and decision questions, none of them an order to the owner
const ORDINARY = [
  "The sign-in fix is merged and live on the customer's app. Next: the import screen starts today. Ask for details on any item.",
  'Two things shipped today: the export button and the faster search. Nothing needs you. Ask for details on any item.',
  'The payment page is merged, not checked yet. The Reality Checker runs it this afternoon. Ask for details on any item.',
  'Should the free plan keep the 50-card limit or move to 100? I would keep 50: it protects the paid plan. Reply 50 or 100.',
  "Which do you want first: the import screen or the sharing link? I'd take the import screen. Ask for details on any item.",
  'Do you want the beta opened to the waiting list this week, or after the payment fix lands?',
  'I recommend 60. Reply 60 or 10.',
  'Choose one: ship the export now with CSV only, or wait two days for Excel too.',
  'Pick A or B. A: keep the old login for a week. B: switch everyone today.',
  'Good morning. Overnight the team finished the search speed-up and started the import fix. Next: review this afternoon. Ask for details on any item.',
  'The deploy failed on a missing setting; the Delivery Manager is fixing it now. Next update in an hour. Ask for details on any item.',
  'Search is faster for every user. Next: test the export on staging, then merge. Ask for details on any item.',
  'Plan for today: start the import story, open the pull request for search, and merge the export once reviewed.',
  'Approve the price change to 9 dollars, or keep 7? I would approve 9.',
  'Plan for today:\n- start the import story\n- open the pull request for search\n\nAsk for details on any item.',
];

test('R-44 I3: 15 ordinary briefings and decision questions give no order warning with the judge off', () => {
  assert.deepEqual(ORDINARY.filter((m) => find(m).warnings.some((w) => w.kind === 'orders-owner')), []);
  // and the orders still count, plan label or not, when addressed to the owner
  assert.ok(M.ownerImperatives('Your action: open the Progress Observer session and approve it.').length);
  assert.ok(M.ownerImperatives('Type this:\n\n> go for R2').length);
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
  for (const id of ['vault-wxy.12', 'bd-claim', 'dec-chief-of-staff-4', '.delivery/goal.json']) assert.ok(r.warnings[0].detail.includes(id), id);
  const plain = 'The sign-in fix is waiting: there is not enough budget left to start it safely. Next: it starts after the reset. Ask for details on any item.';
  assert.deepEqual(find(plain).warnings, []);
  assert.deepEqual(find(jargon, { owner: 'which bead is that?' }).warnings, []);
  assert.deepEqual(kinds(find(jargon, { owner: 'ok, I will file my taxes later, how is it going' })), ['jargon'], 'only an explicit ask for ids skips the check');
  assert.deepEqual(find('Merged and live: [the pull request](https://example.com/pr/478).').warnings.filter((w) => w.kind === 'jargon'), []);
  // only the shapes the plugin produces: the project's bead ids and the plugin's own script names count
  assert.deepEqual(M.idTokens('ex-12 is merged; owner-queue.js has it', { prefix: 'ex' }).sort(), ['ex-12', 'owner-queue.js']);
  for (const plainWords of ['The COVID-19 banner is gone and the iPhone 15 layout is fixed.', 'Sales went up 12% in the UK-1 region.',
    'We moved to Node.js 22 and the config.yaml issue is fixed.', 'Part D2 of the order arrives Tuesday.', 'The w-2 form import works; the in-app tour is new.',
    'The F-150 fleet page is live.', 'The add-on decaf00 colour is on the shop page.']) assert.deepEqual(M.idTokens(plainWords, { prefix: 'vault' }), [], plainWords);
  // the judge's jargon answer warns when the rule finds nothing
  assert.deepEqual(kinds(find('The lane refused the claim so the wave is parked.', { judged: { jargon: { p: 0.85 } } })), ['jargon']);
  assert.deepEqual(find('The lane refused the claim so the wave is parked.', { judged: { jargon: { p: 0.62 } } }).warnings, [], 'below the measured 0.8');
  // Copilot 710: an owner who asked for ids is not warned by the judge either
  assert.deepEqual(find('That is vault-wxy.12.', { owner: 'which bead is that?', judged: { jargon: { p: 0.95 } } }).warnings, []);
});

test('R-45 10-17 23:07: a 30-line justification briefing warns on length and tone; a 12-line one and a decision brief do not', () => {
  const apology = Array.from({ length: 30 }, (_, i) => `I take responsibility for point ${i + 1}, and I should have seen it earlier.`).join('\n');
  const r = find(apology, { judged: { tone_violation: { answer: 'justifying', confidence: 0.91 } } });
  assert.deepEqual(kinds(r).sort(), ['briefing-length', 'tone']);
  assert.match(r.warnings.find((w) => w.kind === 'briefing-length').detail, /30 lines \(limit 12\)/);
  const twelve = Array.from({ length: 12 }, (_, i) => `Item ${i + 1} merged.`).join('\n');
  assert.deepEqual(find(twelve).warnings, []);
  assert.deepEqual(find(`${twelve}\nWhich do you want first, A or B?`).warnings, [], 'a question to the owner may run longer');
  assert.deepEqual(kinds(find(`Why did it fail? Because I rushed it.\n${apology}`)), ['briefing-length'], 'a rhetorical question does not make it a decision');
  assert.deepEqual(kinds(find(twelve, { briefingLines: 10 })), ['briefing-length'], 'the owner-set limit applies');
  assert.deepEqual(find('Merged.', { judged: { tone_violation: { answer: 'none', confidence: 0.99 } } }).warnings, []);
});

test('R-03 10-13 08:07: "live" without an evidence read this turn warns; with the read or "not checked yet" it does not', () => {
  const live = 'The import is live in production. Ask for details on any item.';
  assert.deepEqual(kinds(find(live)), ['claim-unchecked']);
  assert.deepEqual(find(live, { commands: ['git status', 'node /p/scripts/evidence.js check vault-0n9-3'] }).warnings, []);
  assert.deepEqual(find('The import is merged, not checked yet.').warnings, []);
  assert.deepEqual(find('The import is not live yet.').warnings, []);
  // Copilot 697: a quoted script path is still a read
  assert.deepEqual(find(live, { commands: ["node '/plugin cache/scripts/evidence.js' check vault-0n9-3"] }).warnings, []);
  // a named bead needs a read of that bead; a question is no claim
  assert.deepEqual(kinds(find('vault-0n9-3 is live in production.', { commands: ['node /p/scripts/evidence.js list vault-wxy-2'] })), ['jargon', 'claim-unchecked']);
  assert.deepEqual(kinds(find('vault-0n9-3 is live in production.', { commands: ['node /p/scripts/evidence.js list vault-0n9-3'] })), ['jargon']);
  assert.deepEqual(find('Can you check whether the import works on your phone?').warnings.filter((w) => w.kind === 'claim-unchecked'), []);
});

test('the next-prompt reminder is two lines and ends with the plain-words instruction', () => {
  const text = M.reminderText(find(`${'x\n'.repeat(20)}vault-wxy.12 is live`).warnings);
  assert.equal(text.split('\n').length, 2);
  assert.match(text.split('\n')[1], /Ask for details on any item"/);
  assert.equal(M.reminderText([]), '');
});

test('R-44 I2: an order carrying a path, a command or a link reaches the judge redacted, so it can block', async () => {
  const http = require('http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { const body = JSON.parse(b); const q = Object.keys(body.questions)[0]; seen.push(body.state.message); res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { [q]: q === 'tone_violation' ? { type: 'choice', choice: 'none', confidence: 0.9 } : { type: 'noul', noul: 0.9 } } })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const message = 'Please run this on the build server: node scripts/probe.js --host buildbox. Then open https://example.com/admin and click Deploy.';
    const judged = await M.judgeMessage({ input: { last_assistant_message: message }, team: { judge: { provider: 'typesafe' } }, role: COS, projectRoot: null,
      deps: { env: { TYPESAFE_API_KEY: 'test-key-not-real', DELIVERY_JUDGE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` } } });
    assert.equal(judged.orders_owner.p, 0.9);
    assert.ok(seen.every((m) => !m.includes('scripts/probe.js') && !m.includes('example.com')), seen.join('\n'));
    assert.equal(find(message, { judged }).candidates[0].kind, 'orders');
  } finally { server.closeAllConnections(); server.close(); }
});

test('R-44 re-review I-c: an order written as a plan line still counts when it names a session, typing, pasting or the owner', () => {
  for (const m of ['Then: open the builder session and type continue.', 'Next step: run node scripts/probe.js on the build server and paste me the output.',
    'Plan for today:\nopen the Progress Observer session and type: approve']) assert.ok(M.ownerImperatives(m).length, m);
  assert.deepEqual(ORDINARY.filter((m) => M.ownerImperatives(m).length), []);
});

test('Copilot round 2: only evidence.js invocations in command position count, all of them', () => {
  const live = 'vault-ex-1 is live in production. vault-ex-2 is live in production.';
  assert.deepEqual(kinds(find(live, { commands: ["echo 'node evidence.js check vault-ex-1 vault-ex-2'"] })).filter((k) => k === 'claim-unchecked'), ['claim-unchecked']);
  assert.deepEqual(kinds(find('vault-ex-1 is live in production.', { commands: ['echo done evidence.js check vault-ex-1'] })).filter((k) => k === 'claim-unchecked'), ['claim-unchecked']);
  assert.deepEqual(kinds(find(live, { commands: ['node /p/scripts/evidence.js list vault-ex-1 && node /p/scripts/evidence.js list vault-ex-2'] })).filter((k) => k === 'claim-unchecked'), []);
});

test('final check: "type up the release notes" in a plan line is no order; typing into a session is', () => {
  assert.deepEqual(M.ownerImperatives('Next: type up the release notes and send them round.'), []);
  assert.ok(M.ownerImperatives('Next: type it in the builder session.').length);
});
