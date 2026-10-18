// scripts/goal.test.js — R-42: constraints change only on an owner decision made for that change,
// replayed on Vault moments with real operator records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const goal = require('./goal.js');
const Goal = require('./lib/goal.js');
const log = require('./lib/operator-log.js');
const R = require('./lib/operator-records.js');
const W = require('./lib/warnings.js');
const G = require('./lib/gates.js');
const { decideLane, loadPolicy } = require('../hooks/scripts/lane.js');
const { manifestWarnings } = require('./lib/manifest.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
const PLUGIN_ROOT = path.join(__dirname, '..');
const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
const SID = 's1';
const COS = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };
const who = (root, roleId) => ({ root, roleId, instance: roleId });

// A project and the Chief of Staff's session transcript. Owner inputs are captured the way the hooks
// capture them (operator-log syncTranscript), timestamped a minute after now so that a question
// recorded now comes before them, one second apart.
function project({ freeText = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'x', prefix: 'x', bd_host: 'pc', roles: [
    { id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus' }, { id: 'product-manager', brief: 'delivery/product-manager', host: 'pc', model: 'opus' }],
    ...(freeText ? { goal: { free_text: true } } : {}) }));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tr-')), 't.jsonl');
  fs.writeFileSync(tr, '');
  const t0 = Date.now() + 60e3;
  let k = 0;
  const ts = (laterMin = 0) => new Date(t0 + (k++) * 1000 + laterMin * 60e3).toISOString();
  const push = (r) => fs.appendFileSync(tr, `${JSON.stringify({ sessionId: SID, ...r })}\n`);
  const sync = () => {
    log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc', now: new Date() });
    const all = log.listInputs(root, { source: 'human' });
    return all[all.length - 1].id;
  };
  const say = (text, { laterMin } = {}) => { push({ type: 'user', origin: { kind: 'human' }, promptId: `p${k}`, uuid: `u${k}`, timestamp: ts(laterMin), message: { role: 'user', content: text } }); return sync(); };
  const cos = (text) => push({ type: 'assistant', uuid: `a${k}`, timestamp: ts(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
  // the harness's AskUserQuestion: the tool_use, then its tool_result with the owner's selection
  const askUser = (question, answer, { laterMin, options = ['Yes', 'No'], multiSelect = false } = {}) => {
    const n = k;
    const questions = [{ question, header: 'Goal change', multiSelect, options: options.map((label) => ({ label, description: label })) }];
    push({ type: 'assistant', uuid: `ask${n}`, timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id: `tu${n}`, name: 'AskUserQuestion', input: { questions } }] } });
    push({ type: 'user', uuid: `res${n}`, promptId: `pr${n}`, timestamp: ts(laterMin), sourceToolAssistantUUID: `ask${n}`, toolUseResult: { questions, answers: { [question]: answer } },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: `The user answered: "${question}"="${answer}".` }] } });
    return sync();
  };
  const ask = (field, value, { text } = {}) => {
    const t = text || Goal.questionText(field, value);
    return { q: R.recordQuestion({ projectRoot: root, text: t, asker: { instance: 'chief-of-staff' }, options: ['Yes', 'No'], by: COS }).id, text: t };
  };
  const decide = (input, quote, label, answers) => R.recordDecision({ projectRoot: root, cite: input, quote, statement: 'owner decision',
    scope: { beads: [], labels: label ? [label] : [], initiatives: [] }, by: COS, ...(answers ? { answers } : {}) }).id;
  // the two proofs that the owner saw the question: AskUserQuestion, or typed after the CoS's message
  const confirmAsk = (field, value, { answer = 'Yes', laterMin, options, multiSelect } = {}) => { const { q, text } = ask(field, value); return decide(askUser(text, answer, { laterMin, options, multiSelect }), answer, `goal:${field}=${value}`, [q]); };
  const confirmTyped = (field, value, { reply = 'yes', shown, laterMin } = {}) => {
    const { q, text } = ask(field, value);
    cos(shown === undefined ? `One decision for you. ${text}` : shown);
    return decide(say(reply, { laterMin }), reply, `goal:${field}=${value}`, [q]);
  };
  return { root, say, cos, askUser, ask, decide, confirmAsk, confirmTyped };
}
// a free-text decision: the owner's own words, recorded for the change
const freeText = (t, quote, field, v) => t.decide(t.say(quote), quote, `goal:${field}=${v}`);
const set = (root, field, value, record, roleId = 'chief-of-staff', extra = {}) => Goal.set({ root, who: who(root, roleId), field, value, record, ...extra });

test('R-42 B1: unrelated or negated owner words never set a constraint, even on a record made for it', () => {
  const cases = [
    ['Do not stop the builders, keep going', 'pause', 'paused'],
    ['Stop with silver lining', 'pause', 'paused'],
    ['Set the idle limit to 30 minutes', 'budget.usage_envelope', '30'],
    ['ship the 5 fixes this week', 'budget.weekly_units', '5'],
    ['70 percent of the login tests failed this week', 'budget.lean_at', '70'],
    ['wait 600 ms before retrying', 'idle_minutes', '600'],
    ["don't touch login", 'scope_add', 'login'],
    ['builders may merge without review? no way, never allow it', 'approvals', 'builders may merge without review'],
    ['keep usage under 30.5% this week', 'budget.usage_envelope', '30'],
    ['keep the budget at 130% of last week', 'budget.usage_envelope', '30'],
    ['we only build the bulk importer', 'scope_add', 'UI'],
  ];
  const t = project({ freeText: true });
  cases.forEach(([quote, field, v]) => {
    const id = freeText(t, quote, field, v);
    assert.equal(set(t.root, field, v, id).ok, false, `${quote} -> ${field}`);
    // the word rule stays the pre-filter when the judge says yes
    assert.equal(set(t.root, field, v, id, 'chief-of-staff', { judged: { p: 0.95 } }).ok, false, `${quote} -> ${field} (judge yes)`);
  });
  assert.equal(set(t.root, 'scope_add', ',', freeText(t, 'we only build the bulk importer', 'scope_add', ',')).ok, false, 'an empty scope is refused');
  assert.deepEqual(Goal.read(t.root).fields, {});
});

const FIELDS_AND_VALUES = [
  ['budget.usage_envelope', '30'], ['budget.weekly_units', '120'], ['budget.lean_at', '70'], ['idle_minutes', '45'], ['briefing_lines', '8'],
  ['pause', 'paused'], ['scope_add', 'CSV import,UI'], ['approvals', 'merges need an independent review'],
];

test('R-42 confirmed question: each field is set by a Yes to goal.js\'s question in an AskUserQuestion box', () => {
  const t = project();
  FIELDS_AND_VALUES.forEach(([field, v], i) => {
    const r = set(t.root, field, v, t.confirmAsk(field, v));
    assert.equal(r.ok, true, `${field}: ${r.error}`);
  });
  assert.equal(Goal.value(t.root, 'budget.usage_envelope'), 30);
  assert.deepEqual(Goal.value(t.root, 'scope'), ['CSV import', 'UI']);
  assert.equal(Goal.activePause(t.root).paused, true);
  assert.equal(Goal.questionText('pause', 'paused'), "Pause the team's work now?");
  assert.equal(Goal.questionText('budget.weekly_units', '5'), 'Set the weekly budget to 5 units?');
  assert.equal(Goal.questionText('scope_add', 'billing'), 'Add billing to the scope?');
  assert.equal(Goal.questionText('pause', 'off'), "Resume the team's work now?");
});

test('R-42 B2: a yes the owner gave to something else never binds a goal question', () => {
  const t = project();
  // the CoS logs the question but shows the owner another one; the owner's "yes" answers that
  assert.match(set(t.root, 'budget.usage_envelope', '30', t.confirmTyped('budget.usage_envelope', '30', { shown: 'Shall I merge the export fix?' })).error, /question box/);
  // nothing shown at all before the yes
  const { q } = t.ask('pause', 'paused');
  assert.match(set(t.root, 'pause', 'paused', t.decide(t.say('yes'), 'yes', 'goal:pause=paused', [q])).error, /question box/);
  // AskUserQuestion with another question text, or a No
  const other = t.ask('pause', 'paused');
  assert.match(set(t.root, 'pause', 'paused', t.decide(t.askUser('Pause the notifications?', 'Yes'), 'Yes', 'goal:pause=paused', [other.q])).error, /question box/);
  assert.equal(set(t.root, 'pause', 'paused', t.confirmAsk('pause', 'paused', { answer: 'No' })).ok, false);
});

test('R-42 B1: a yes authorises one change only, a later change supersedes it, and it expires after 24 h', () => {
  const t = project();
  const pauseYes = t.confirmAsk('pause', 'paused');
  assert.equal(set(t.root, 'pause', 'paused', pauseYes).ok, true);
  assert.equal(set(t.root, 'pause', 'off', t.confirmAsk('pause', 'off')).ok, true);
  // the CoS re-applies the earlier yes, as is or re-recorded from the same input
  assert.match(set(t.root, 'pause', 'paused', pauseYes).error, /already used/);
  assert.equal(Goal.activePause(t.root).paused, false);
  // an old entry put back by hand does not re-apply: the latest change to the field wins
  const g = Goal.read(t.root);
  g.fields.pause = g.history.find((h) => h.record === pauseYes);
  fs.writeFileSync(path.join(t.root, '.delivery', 'goal.json'), JSON.stringify(g));
  assert.equal(Goal.activePause(t.root).paused, false);
  // a yes more than 24 h after its question
  assert.match(set(t.root, 'budget.weekly_units', '5', t.confirmAsk('budget.weekly_units', '5', { laterMin: 25 * 60 })).error, /24 h/);
});

test('R-42 confirmed question: other answers, a hand-worded question and a yes before the question are refused', () => {
  const t = project();
  const refused = (f) => { try { return f().ok === false; } catch (err) { return true; } };
  for (const reply of ['no', 'not now', 'later', 'why?', 'yes but only on Monday']) assert.ok(refused(() => set(t.root, 'pause', 'paused', t.confirmTyped('pause', 'paused', { reply }))), reply);
  // a question goal.js did not word
  const loose = t.ask('pause', 'paused', { text: 'Shall we take a break from the notifications?' });
  t.cos(loose.text);
  assert.ok(refused(() => set(t.root, 'pause', 'paused', t.decide(t.say('yes'), 'yes', 'goal:pause=paused', [loose.q]))));
  // the yes to the question about another value
  const six = t.ask('budget.weekly_units', '6');
  t.cos(six.text);
  assert.match(set(t.root, 'budget.weekly_units', '5', t.decide(t.say('yes'), 'yes', 'goal:budget.weekly_units=5', [six.q])).error, /not goal\.js's question/);
  // a yes said before the question was asked
  const early = t.say('yes', { laterMin: -10 });
  assert.throws(() => t.decide(early, 'yes', 'goal:pause=paused', [t.ask('pause', 'paused').q]), /before question/);
});

test('R-42 final check: free text never sets a constraint while the free-text flag is off, even with the judge saying yes', () => {
  const quotes = [
    ['stop the team from asking me questions', 'pause', 'paused'], ['halt the team chatter', 'pause', 'paused'],
    ["Pause the team's notifications", 'pause', 'paused'], ['Last week I told you to pause the team', 'pause', 'paused'],
    ['They asked whether to pause the team', 'pause', 'paused'], ['I said earlier to pause the team; forget that', 'pause', 'paused'],
    ['The budget was 30% last week', 'budget.usage_envelope', '30'], ['the message about line 40 of the briefing', 'briefing_lines', '40'],
    ['Pause the team now.', 'pause', 'paused'], ['Set the weekly budget to 5 units.', 'budget.weekly_units', '5'],
  ];
  const t = project();
  for (const [quote, field, v] of quotes) {
    const id = freeText(t, quote, field, v);
    assert.equal(set(t.root, field, v, id).ok, false, quote);
    assert.equal(set(t.root, field, v, id, 'chief-of-staff', { judged: { p: 0.99 } }).ok, false, `${quote} (judge yes, flag off)`);
  }
});

test('R-42 free text with the flag on: the word rule as pre-filter and goal_instruction p >= 0.8; 0.5 or an error refused', () => {
  const t = project({ freeText: true });
  const id = freeText(t, 'Pause the team now.', 'pause', 'paused');
  const viaJudge = (record, judged) => set(t.root, 'pause', 'paused', record, 'chief-of-staff', { judged });
  assert.equal(viaJudge(id, { p: 0.5 }).ok, false);
  assert.equal(viaJudge(id, { p: 0 }).ok, false, 'a failed call counts as no');
  assert.equal(set(t.root, 'pause', 'paused', id).ok, false, 'no judge answer: refused');
  assert.equal(viaJudge(freeText(t, 'Do not stop the builders, keep going', 'pause', 'paused'), { p: 0.95 }).ok, false, 'the word rule still filters');
  assert.equal(viaJudge(id, { p: 0.9 }).ok, true);
  assert.equal(Goal.activePause(t.root).paused, true, 'the stored judge answer keeps it valid on read');
});

test('R-42 free text through goal.js with a fake judge (flag on): 0.9 sets it, 0.5 and an error refuse', async () => {
  const http = require('http');
  let reply = { type: 'noul', noul: 0.9 };
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { if (reply === 'error') { res.statusCode = 500; res.end('{}'); return; } res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { goal_instruction: reply } })); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const t = project({ freeText: true });
    const f = path.join(t.root, '.delivery', 'team', 'team.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), judge: { provider: 'typesafe', model: 'jev-latest' } }));
    const id = freeText(t, 'Pause the team now.', 'pause', 'paused');
    const env = { ...process.env, TYPESAFE_API_KEY: 'test-key-not-real', DELIVERY_JUDGE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
    const argv = ['set', 'pause', 'paused', '--record', id, '--project', t.root];
    const run = async () => goal.main(argv, { who: { ...who(t.root, 'chief-of-staff'), team: JSON.parse(fs.readFileSync(f, 'utf8')) }, judged: await goal.judgeFor(argv, { env, cwd: t.root }) });
    reply = 'error';
    assert.equal((await run()).code, 1);
    reply = { type: 'noul', noul: 0.5 };
    assert.equal((await run()).code, 1);
    reply = { type: 'noul', noul: 0.9 };
    assert.equal((await run()).code, 0);
  } finally { server.closeAllConnections(); server.close(); }
});

test('R-42 goal.js ask prints the AskUserQuestion payload and records the question through operator.js ask', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  const calls = [];
  const r = goal.main(['ask', 'budget.weekly_units', '5'], { who: who(root, 'chief-of-staff'), recordQuestion: (args) => { calls.push(args); return 'q-chief-of-staff-3'; } });
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.out.split('\n').find((l) => l.startsWith('{')));
  assert.deepEqual(payload.questions[0].options.map((o) => o.label), ['Yes', 'No']);
  assert.equal(payload.questions[0].question, 'Set the weekly budget to 5 units?');
  assert.deepEqual(calls, [{ text: 'Set the weekly budget to 5 units?', field: 'budget.weekly_units', value: '5' }]);
  assert.equal(goal.main(['ask', 'budget.weekly_units', 'lots'], { who: who(root, 'chief-of-staff'), recordQuestion: () => 'q' }).code, 1);
  assert.equal(goal.main(['ask', 'budget.weekly_units', '5'], { who: who(root, 'builder'), recordQuestion: () => 'q' }).code, 1);
});

test('R-42 I6: every field is re-checked when read: a revoked record or a hand-written value falls back with a warning', () => {
  const t = project();
  const id = t.confirmAsk('budget.usage_envelope', '30');
  assert.equal(set(t.root, 'budget.usage_envelope', '30', id).ok, true);
  R.revoke({ projectRoot: t.root, target: id, cite: t.say('forget the envelope'), quote: 'forget the envelope', statement: 'revoked', by: COS });
  assert.equal(Goal.value(t.root, 'budget.usage_envelope'), null);
  assert.match(goal.main(['show'], { who: who(t.root, null), bd: { show: () => null } }).out, /budget\.usage_envelope: not set; the written value is ignored: .*revoked/);
  const g = Goal.read(t.root);
  g.fields.idle_minutes = { value: 999999 };
  fs.writeFileSync(path.join(t.root, '.delivery', 'goal.json'), JSON.stringify(g));
  assert.equal(Goal.value(t.root, 'idle_minutes'), 30, 'a value written by hand is inert');
  assert.deepEqual(W.list(t.root).map((w) => w.kind), ['goal-unverified', 'goal-unverified']);
});

test('R-42: only the Chief of Staff records a constraint (the PM records scope changes only); a builder is told to message it', () => {
  const t = project();
  const id = t.confirmAsk('budget.usage_envelope', '30');
  for (const role of ['product-manager', 'delivery-lead', 'builder', null]) assert.equal(set(t.root, 'budget.usage_envelope', '30', id, role).ok, false, String(role));
  assert.equal(set(t.root, 'scope_add', 'CSV import', t.confirmAsk('scope_add', 'CSV import'), 'product-manager').ok, true);
  assert.match(goal.main(['set', 'budget.usage_envelope', '30', '--record', id], { who: who(t.root, 'builder') }).out, /\nMessage the Chief of Staff\.$/);
  assert.match(goal.main(['set', 'budget.usage_envelope', '30'], { who: who(t.root, 'chief-of-staff') }).out, /goal\.js ask budget\.usage_envelope 30/);
});

// evidence rows written the way evidence.js writes them; the head is recorded in the bead
const BEAD = 'vault-0n9-3';
const row = (root, over) => G.appendEvidence(root, BEAD, { type: 'row', criterion: 1, surface: 'S1', sha: 'd478aa11', actor: 'x', at: '2026-10-17T22:54:00Z', ...over }).head;
const beadWith = (head) => ({ id: BEAD, metadata: { evidence_head: head } });
const pause = (root, roleId, trigger, bead) => goal.main(['pause', '--trigger', trigger], { who: who(root, roleId), bd: { show: () => bead } });

test('R-42 I7: an andon pause cites a failed check row from evidence.js and lapses when a check passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ev-'));
  fs.mkdirSync(path.join(root, '.delivery', 'andon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'andon', 'a-1.json'), JSON.stringify({ status: 'open' }));
  row(root, { result: 'pass', by: 'delivery-lead' });
  const bead = beadWith(row(root, { result: 'fail', by: 'delivery-lead' }));
  assert.equal(pause(root, 'delivery-lead', 'andon:a-1', bead).code, 1, 'a hand-written andon file is not an andon');
  assert.equal(pause(root, 'delivery-lead', 'ci:main', bead).code, 1);
  assert.equal(pause(root, 'builder', `andon:ev-${BEAD}-2`, bead).code, 1, 'a builder does not pause the team');
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-1`, bead).code, 1, 'a pass row is not an andon');
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-2`, { id: BEAD, metadata: {} }).code, 1, 'rows evidence.js did not record do not count');
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-2`, bead).code, 0);
  assert.deepEqual(Goal.activePause(root), { paused: true, by: `andon:ev-${BEAD}-2` });
  row(root, { result: 'pass', by: 'builder' });
  assert.equal(Goal.activePause(root).paused, true, 'a builder\'s pass does not close it');
  row(root, { result: 'pass', by: 'reality-checker' });
  assert.equal(Goal.activePause(root).paused, false);
});

test('R-42 Copilot 726: a trigger pause never overwrites or lifts the owner pause', () => {
  const t = project();
  const root = t.root;
  assert.equal(set(root, 'pause', 'paused', t.confirmAsk('pause', 'paused')).ok, true);
  const bead = beadWith(row(root, { result: 'fail', by: 'reality-checker' }));
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-1`, bead).code, 0);
  assert.match(Goal.read(root).fields.pause.record, /^dec-/, 'the owner pause is untouched');
  row(root, { result: 'pass', by: 'reality-checker' });
  const p = Goal.activePause(root);
  assert.equal(p.paused, true, 'the andon closed; the owner pause still holds');
  assert.match(p.by, /^dec-/);
});

test('R-42: no default budget; the idle and briefing limits default to 30 and 12', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  for (const f of ['budget.weekly_units', 'budget.usage_envelope', 'budget.lean_at']) assert.equal(Goal.value(root, f), null, f);
  assert.equal(Goal.value(root, 'idle_minutes'), 30);
  assert.equal(Goal.value(root, 'briefing_lines'), 12);
  assert.match(goal.main(['show'], { who: who(root, 'chief-of-staff') }).out, /budget\.weekly_units: not set by the owner/);
  assert.ok(manifestWarnings({ roles: [], budget: { usage_envelope: 30 } }).some((w) => /budget\.usage_envelope is ignored/.test(w)));
});

test('R-42 lane: no role writes the goal sheet directly; sed -i from inside .delivery is caught; committing it is fine', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  fs.mkdirSync(path.join(projectRoot, '.delivery'), { recursive: true });
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-role-'));
  const builder = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/builder' });
  const cos = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
  const lane = (policy, toolName, toolInput, cwd = projectRoot) => decideLane({ toolName, toolInput, policy, roleDir, groups: GROUPS, pluginRoot: PLUGIN_ROOT, cwd, projectRoot });
  const file = path.join(projectRoot, '.delivery', 'goal.json');
  assert.equal(lane(builder, 'Write', { file_path: file }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'echo {} > .delivery/goal.json' }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: `sed -i s/30/90/ ${file}` }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'sed -i s/30/90/ goal.json' }, path.join(projectRoot, '.delivery')).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'cd .delivery && sed -i s/30/90/ goal.json' }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'git checkout -- .delivery/goal.json' }).allow, false);
  assert.equal(lane(builder, 'Bash', { command: 'git add .delivery/goal.json' }).allow, true);
  assert.equal(lane(builder, 'Bash', { command: 'sed -n 1p goal.json' }, path.join(projectRoot, '.delivery')).allow, true);
  const script = path.join(PLUGIN_ROOT, 'scripts', 'goal.js');
  assert.equal(lane(cos, 'Bash', { command: `node ${script} set budget.usage_envelope 30 --record dec-chief-of-staff-7` }).allow, true);
  assert.equal(lane(cos, 'Bash', { command: `node ${script} show` }).allow, true);
});

test('R-42 re-review B1: resumes, conditionals, other languages, freeze and loose figures are refused', () => {
  const cases = [
    ['continue with the copy review tomorrow', 'pause', 'off'],
    ['resume work tomorrow after the demo', 'pause', 'off'],
    ['Stop work only if the build turns red.', 'pause', 'paused'],
    ['Pause the team if the tests fail.', 'pause', 'paused'],
    ["Ne mettez pas l'équipe en pause.", 'pause', 'paused'],
    ['Bitte nicht pausieren, pause nein.', 'pause', 'paused'],
    ['Pausa todo hasta el lunes.', 'pause', 'paused'],
    ['Freeze the design for now.', 'pause', 'paused'],
    ['the paused builds can be deleted', 'pause', 'paused'],
    ['30% of the tests failed, but the budget is fine.', 'budget.usage_envelope', '30'],
    ['5 units of the weekly budget went on tests.', 'budget.weekly_units', '5'],
    ['call the team idle after 300 minutes', 'idle_minutes', '30'],
    ['Remove login from scope.', 'scope_add', 'login'],
    ['Add the export to scope when the import ships.', 'scope_add', 'export'],
  ];
  const t = project({ freeText: true });
  for (const [quote, field, v] of cases) assert.equal(set(t.root, field, v, freeText(t, quote, field, v), 'chief-of-staff', { judged: { p: 0.95 } }).ok, false, `${quote} -> ${field}=${v}`);
});

test('R-42 re-review: scope changes are adds or removes; a removal can only remove', () => {
  const t = project();
  assert.equal(set(t.root, 'scope_add', 'CSV import,login page', t.confirmAsk('scope_add', 'CSV import,login page')).ok, true);
  assert.equal(set(t.root, 'scope_remove', 'login page', t.confirmAsk('scope_remove', 'login page')).ok, true);
  assert.deepEqual(Goal.value(t.root, 'scope'), ['CSV import']);
  assert.equal(Goal.questionText('scope_remove', 'login page'), 'Remove login page from the scope?');
});

test('R-42 re-review andon: a builder\'s fail row is no andon; a pass appended by hand after the recorded head does not lift it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ev-'));
  const byBuilder = beadWith(row(root, { result: 'fail', by: 'builder' }));
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-1`, byBuilder).code, 1);
  const bead = beadWith(row(root, { result: 'fail', by: 'delivery-lead' }));
  assert.equal(pause(root, 'delivery-lead', `andon:ev-${BEAD}-2`, bead).code, 0);
  row(root, { result: 'pass', by: 'delivery-lead' }); // appended, but the bead's head was not moved
  assert.equal(Goal.activePause(root, { beadOf: () => bead }).paused, true);
});

test('Copilot round 2: a typographic apostrophe still negates; side-arm passes and other andons do not lift a pause', () => {
  const t = project({ freeText: true });
  assert.equal(set(t.root, 'pause', 'paused', freeText(t, 'Don’t pause the team', 'pause', 'paused'), 'chief-of-staff', { judged: { p: 0.95 } }).ok, false);
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ev-'));
  row(r2, { result: 'fail', by: 'delivery-lead' });
  const bead = beadWith(row(r2, { result: 'fail', by: 'delivery-lead', criterion: 2 }));
  assert.equal(pause(r2, 'delivery-lead', `andon:ev-${BEAD}-1`, bead).code, 0);
  assert.equal(pause(r2, 'delivery-lead', `andon:ev-${BEAD}-2`, bead).code, 0);
  row(r2, { result: 'pass', by: 'delivery-lead', criterion: 2 });
  assert.equal(Goal.activePause(r2).paused, true, 'the first andon is still open');
  row(r2, { result: 'pass', by: 'delivery-lead', arm: 'side' });
  assert.equal(Goal.activePause(r2).paused, true, 'a side-arm pass is not a check of the failure');
  row(r2, { result: 'pass', by: 'delivery-lead' });
  assert.equal(Goal.activePause(r2).paused, false);
});

test('Copilot round 3: the word rule (now only a pre-filter for the judge) keeps decimals, start times and scope conflicts', () => {
  assert.equal(Goal.covers('budget.usage_envelope', 5, 'Set a 30.5% budget for the team.'), false);
  assert.equal(Goal.covers('budget.usage_envelope', 30.5, 'Set the usage budget to 30.5%.'), true);
  assert.equal(Goal.covers('pause', 'paused', 'Pause the team tomorrow.'), false);
  assert.equal(Goal.covers('pause', 'paused', 'Pause the team until tomorrow.'), true);
  assert.equal(Goal.covers('scope_remove', ['login'], 'Remove billing from scope; keep login in scope.'), false);
});

test('Copilot round 3: one bd lookup per bead, and at most maxLookups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ev-'));
  row(root, { result: 'fail', by: 'delivery-lead' });
  row(root, { result: 'pass', by: 'delivery-lead' });
  const g = { fields: { pause_triggers: Array.from({ length: 6 }, () => ({ value: 'paused', trigger: `andon:ev-${BEAD}-1` })) }, history: [] };
  fs.mkdirSync(path.join(root, '.delivery'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'goal.json'), JSON.stringify(g));
  g.fields.pause_triggers.push(...['a', 'b', 'c'].map((x) => ({ value: 'paused', trigger: `andon:ev-other-${x}-1` })));
  fs.writeFileSync(path.join(root, '.delivery', 'goal.json'), JSON.stringify(g));
  let lookups = 0;
  assert.equal(Goal.activePause(root, { beadOf: () => { lookups++; return null; }, maxLookups: 2 }).paused, false);
  assert.equal(lookups, 2);
});

test('Copilot round 4: a decision taken under a delegation is no owner yes to a goal question', () => {
  const t = project();
  const said = t.say('you decide the team rhythm this week');
  const del = R.recordDelegation({ projectRoot: t.root, cite: said, quote: 'you decide the team rhythm this week', statement: 'rhythm delegated', grant: 'The CoS decides the team rhythm this week.',
    scope: { beads: [], labels: ['goal:pause=paused'], initiatives: [] }, by: COS }).id;
  const { q, text } = t.ask('pause', 'paused');
  t.cos(text);
  const under = R.decideUnder({ projectRoot: t.root, under: del, statement: 'pause', scope: { beads: [], labels: ['goal:pause=paused'], initiatives: [] }, answers: [q], by: COS }).id;
  assert.equal(set(t.root, 'pause', 'paused', under).ok, false);
  // and by the guard itself: a record shaped like a confirmed yes, but taken under a delegation
  const text2 = Goal.questionText('pause', 'paused');
  const fake = () => ({ ok: true, notes: [], chain: [{ kind: 'decision', under: 'del-x-1', scope: { labels: ['goal:pause=paused'] }, answers_questions: [{ id: 'q-1', text: text2, minutes_before_answer: 1 }] },
    { kind: 'input', text: 'Yes', asked: { question: text2, options: ['Yes', 'No'], via: 'AskUserQuestion' } }] });
  assert.match(Goal.set({ root: t.root, who: who(t.root, 'chief-of-staff'), field: 'pause', value: 'paused', record: 'dec-x-9', verifyRecord: fake }).error, /delegation/);
});

test('Copilot round 4: goal.js ask quotes multi-word values in the commands it prints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  const out = goal.main(['ask', 'scope_add', 'CSV import'], { who: who(root, 'chief-of-staff'), recordQuestion: () => 'q-chief-of-staff-1' }).out;
  assert.match(out, /--goal 'scope_add=CSV import'/);
  assert.match(out, /goal\.js set scope_add 'CSV import' --record/);
});

test('R-42 last fix: only the Yes/No question box counts; a typed yes never does, however the question was shown', () => {
  const t = project();
  const text = Goal.questionText('pause', 'paused');
  for (const shown of [`Status first.\n\n\`\`\`\n${text}\n\`\`\`\n\nShall I merge the export fix?`, `> ${text}\n\nAnyway: shall I merge the export fix?`,
    `${text} And shall I merge the export fix?`, `One decision for you. ${text}`]) {
    assert.equal(set(t.root, 'pause', 'paused', t.confirmTyped('pause', 'paused', { shown })).ok, false, shown);
  }
  // the box with other options, a third option, or several choices allowed
  for (const opt of [{ options: ['Yes', 'Later'] }, { options: ['Yes', 'No', 'Later'] }, { options: ['Yes', 'No'], multiSelect: true }]) {
    assert.match(set(t.root, 'pause', 'paused', t.confirmAsk('pause', 'paused', opt)).error, /question box/, JSON.stringify(opt));
  }
  assert.equal(set(t.root, 'pause', 'paused', t.confirmAsk('pause', 'paused')).ok, true);
});
