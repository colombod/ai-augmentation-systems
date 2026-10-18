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

// A project whose owner said each of `words`; decide(n, quote, label) records a decision citing word n.
function ownerSaid(words, { early = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'x', prefix: 'x', bd_host: 'pc', roles: [
    { id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus' }, { id: 'product-manager', brief: 'delivery/product-manager', host: 'pc', model: 'opus' }] }));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
  const human = (t, n) => ({ type: 'user', origin: { kind: 'human' }, promptId: `p${n}`, uuid: `u${n}`, timestamp: early.includes(n) ? `2020-01-01T00:00:${String(n).padStart(2, '0')}.000Z` : `2099-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID, message: { role: 'user', content: t } });
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tr-')), 't.jsonl');
  fs.writeFileSync(tr, `${words.map((w, i) => JSON.stringify(human(w, i + 1))).join('\n')}\n`);
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc', now: new Date('2026-10-13T12:00:00Z') });
  const decide = (n, quote, label, answers) => R.recordDecision({ projectRoot: root, cite: `in-pc-${String(n).padStart(6, '0')}`, quote, statement: 'owner decision',
    scope: { beads: [], labels: label ? [label] : [], initiatives: [] }, by: COS, ...(answers ? { answers } : {}) }).id;
  // the question goal.js asks, recorded the way goal.js ask records it (text given to override it)
  const ask = (field, value, { text, now } = {}) => R.recordQuestion({ projectRoot: root, text: text || Goal.questionText(field, value), asker: { instance: 'chief-of-staff' },
    options: ['Yes', 'No'], scope: { beads: [], labels: [`goal:${field}=${value}`], initiatives: [] }, by: COS, ...(now ? { now } : {}) }).id;
  // the owner's input n answers question q; the record is made for that change
  const confirm = (n, field, value, q) => decide(n, words[n - 1], `goal:${field}=${value}`, [q]);
  return { root, decide, ask, confirm };
}
const set = (root, field, value, record, roleId = 'chief-of-staff') => Goal.set({ root, who: who(root, roleId), field, value, record });

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
  const { root, decide } = ownerSaid(cases.map((c) => c[0]));
  cases.forEach(([quote, field, v], i) => {
    const id = decide(i + 1, quote, `goal:${field}=${v}`);
    assert.equal(set(root, field, v, id).ok, false, `${quote} -> ${field}`);
    // the word rule stays the pre-filter when the judge says yes
    assert.equal(Goal.set({ root, who: who(root, 'chief-of-staff'), field, value: v, record: id, judged: { p: 0.95 } }).ok, false, `${quote} -> ${field} (judge yes)`);
  });
  assert.equal(set(root, 'scope_add', ',', decide(11, 'we only build the bulk importer', 'goal:scope_add=,')).ok, false, 'an empty scope is refused');
  assert.deepEqual(Goal.read(root).fields, {});
});

const FIELDS_AND_VALUES = [
  ['budget.usage_envelope', '30'], ['budget.weekly_units', '120'], ['budget.lean_at', '70'], ['idle_minutes', '45'], ['briefing_lines', '8'],
  ['pause', 'paused'], ['scope_add', 'CSV import,UI'], ['approvals', 'merges need an independent review'],
];

test('R-42 confirmed question: each field is set by a yes to the question goal.js words for it', () => {
  const { root, ask, confirm } = ownerSaid(FIELDS_AND_VALUES.map(() => 'yes'));
  FIELDS_AND_VALUES.forEach(([field, v], i) => {
    const r = set(root, field, v, confirm(i + 1, field, v, ask(field, v)));
    assert.equal(r.ok, true, `${field}: ${r.error}`);
  });
  assert.equal(Goal.value(root, 'budget.usage_envelope'), 30);
  assert.deepEqual(Goal.value(root, 'scope'), ['CSV import', 'UI']);
  assert.equal(Goal.activePause(root).paused, true);
  assert.equal(Goal.questionText('pause', 'paused'), "Pause the team's work now?");
  assert.equal(Goal.questionText('budget.weekly_units', '5'), 'Set the weekly budget to 5 units?');
  assert.equal(Goal.questionText('scope_add', 'billing'), 'Add billing to the scope?');
  assert.equal(Goal.questionText('pause', 'off'), "Resume the team's work now?");
});

test('R-42 confirmed question: other answers, a yes to another question, a loosely worded question, a yes before the question are refused', () => {
  const words = ['no', 'not now', 'later', 'why?', 'yes but only on Monday', 'yes', 'yes', 'Yes', 'ok'];
  const { root, ask, confirm, decide } = ownerSaid(words, { early: [8] });
  // refused at goal.js set, or already at operator.js record (a question back cannot be recorded as a decision)
  const refused = (f) => { try { return f().ok === false; } catch (err) { return true; } };
  for (let n = 1; n <= 5; n++) assert.ok(refused(() => set(root, 'pause', 'paused', decide(n, words[n - 1], 'goal:pause=paused', [ask('pause', 'paused')]))), words[n - 1]);
  // a yes to the question about another value or field
  assert.ok(refused(() => set(root, 'budget.weekly_units', '5', confirm(6, 'budget.weekly_units', '5', ask('budget.weekly_units', '6')))));
  // the same, with the question asked without a scope (as goal.js ask records it): refused at goal.js set
  const bare = R.recordQuestion({ projectRoot: root, text: Goal.questionText('budget.weekly_units', '6'), asker: { instance: 'chief-of-staff' }, options: ['Yes', 'No'], by: COS }).id;
  assert.match(set(root, 'budget.weekly_units', '5', confirm(6, 'budget.weekly_units', '5', bare)).error, /not goal\.js's question/);
  // a question worded by hand, not by goal.js
  assert.equal(set(root, 'pause', 'paused', confirm(7, 'pause', 'paused', ask('pause', 'paused', { text: 'Shall we take a break from the notifications?' }))).ok, false);
  // a yes said before the question was asked cannot answer it
  assert.throws(() => confirm(8, 'pause', 'paused', ask('pause', 'paused')), /before question/);
  // the option the question offered for yes counts
  assert.equal(set(root, 'pause', 'paused', confirm(9, 'pause', 'paused', ask('pause', 'paused'))).ok, true);
});

test('R-42 final check: free text never sets a constraint with the judge off, whatever it says', () => {
  const quotes = [
    ['stop the team from asking me questions', 'pause', 'paused'], ['halt the team chatter', 'pause', 'paused'],
    ["Pause the team's notifications", 'pause', 'paused'], ['Last week I told you to pause the team', 'pause', 'paused'],
    ['They asked whether to pause the team', 'pause', 'paused'], ['I said earlier to pause the team; forget that', 'pause', 'paused'],
    ['The budget was 30% last week', 'budget.usage_envelope', '30'], ['the message about line 40 of the briefing', 'briefing_lines', '40'],
    ['Pause the team now.', 'pause', 'paused'], ['Set the weekly budget to 5 units.', 'budget.weekly_units', '5'],
  ];
  const { root, decide } = ownerSaid(quotes.map((c) => c[0]));
  quotes.forEach(([quote, field, v], i) => assert.equal(set(root, field, v, decide(i + 1, quote, `goal:${field}=${v}`)).ok, false, quote));
});

test('R-42 free text with the judge: the word rule as pre-filter and goal_instruction p >= 0.8; 0.5 or an error refused', () => {
  const words = ['Pause the team now.', 'Pausa todo el trabajo hasta el lunes.', 'Do not stop the builders, keep going'];
  const { root, decide } = ownerSaid(words);
  const id = decide(1, words[0], 'goal:pause=paused');
  const viaJudge = (record, judged, field = 'pause', v = 'paused') => Goal.set({ root, who: who(root, 'chief-of-staff'), field, value: v, record, judged });
  assert.equal(viaJudge(id, { p: 0.5 }).ok, false);
  assert.equal(viaJudge(id, { p: 0 }).ok, false, 'a failed call counts as no');
  assert.equal(viaJudge(decide(3, words[2], 'goal:pause=paused'), { p: 0.95 }).ok, false, 'the word rule still filters');
  assert.equal(viaJudge(id, { p: 0.9 }).ok, true);
  assert.equal(viaJudge(decide(2, words[1], 'goal:pause=paused'), { p: 0.95 }).ok, false, 'another language goes through the confirmed question');
  assert.equal(Goal.activePause(root).paused, true, 'the stored judge answer keeps it valid on read');
});

test('R-42 free text through goal.js with a fake judge: 0.9 sets it, 0.5 and an error refuse', async () => {
  const http = require('http');
  let reply = { type: 'noul', noul: 0.9 };
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { if (reply === 'error') { res.statusCode = 500; res.end('{}'); return; } res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { goal_instruction: reply } })); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { root, decide } = ownerSaid(['Pause the team now.']);
    const f = path.join(root, '.delivery', 'team', 'team.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), judge: { provider: 'typesafe', model: 'jev-latest' } }));
    const id = decide(1, 'Pause the team now.', 'goal:pause=paused');
    const env = { ...process.env, TYPESAFE_API_KEY: 'test-key-not-real', DELIVERY_JUDGE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` };
    const argv = ['set', 'pause', 'paused', '--record', id, '--project', root];
    const run = async () => goal.main(argv, { who: { ...who(root, 'chief-of-staff'), team: JSON.parse(fs.readFileSync(f, 'utf8')) }, judged: await goal.judgeFor(argv, { env, cwd: root }) });
    reply = 'error';
    assert.equal((await run()).code, 1);
    reply = { type: 'noul', noul: 0.5 };
    assert.equal((await run()).code, 1);
    reply = { type: 'noul', noul: 0.9 };
    assert.equal((await run()).code, 0);
  } finally { server.closeAllConnections(); server.close(); }
});

test('R-42 goal.js ask prints the canonical question and records it through operator.js ask', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  const calls = [];
  const r = goal.main(['ask', 'budget.weekly_units', '5'], { who: who(root, 'chief-of-staff'), recordQuestion: (args) => { calls.push(args); return 'q-chief-of-staff-3'; } });
  assert.equal(r.code, 0);
  assert.match(r.out, /^Ask the owner exactly: "Set the weekly budget to 5 units\?" \(Yes \/ No\)\. Question q-chief-of-staff-3/);
  assert.deepEqual(calls, [{ text: 'Set the weekly budget to 5 units?', field: 'budget.weekly_units', value: '5' }]);
  assert.equal(goal.main(['ask', 'budget.weekly_units', 'lots'], { who: who(root, 'chief-of-staff'), recordQuestion: () => 'q' }).code, 1);
  assert.equal(goal.main(['ask', 'budget.weekly_units', '5'], { who: who(root, 'builder'), recordQuestion: () => 'q' }).code, 1);
});

test('R-42 I6: every field is re-checked when read: a revoked record or a hand-written value falls back with a warning', () => {
  const { root, ask, confirm } = ownerSaid(['yes', 'forget the envelope']);
  const id = confirm(1, 'budget.usage_envelope', '30', ask('budget.usage_envelope', '30'));
  assert.equal(set(root, 'budget.usage_envelope', '30', id).ok, true);
  R.revoke({ projectRoot: root, target: id, cite: 'in-pc-000002', quote: 'forget the envelope', statement: 'revoked', by: COS });
  assert.equal(Goal.value(root, 'budget.usage_envelope'), null);
  assert.match(goal.main(['show'], { who: who(root, null), bd: { show: () => null } }).out, /budget\.usage_envelope: not set; the written value is ignored: .*revoked/);
  const g = Goal.read(root);
  g.fields.idle_minutes = { value: 999999 };
  fs.writeFileSync(path.join(root, '.delivery', 'goal.json'), JSON.stringify(g));
  assert.equal(Goal.value(root, 'idle_minutes'), 30, 'a value written by hand is inert');
  assert.deepEqual(W.list(root).map((w) => w.kind), ['goal-unverified', 'goal-unverified']);
});

test('R-42: only the Chief of Staff records a constraint (the PM records scope changes only); a builder is told to message it', () => {
  const { root, ask, confirm } = ownerSaid(['yes', 'yes']);
  const id = confirm(1, 'budget.usage_envelope', '30', ask('budget.usage_envelope', '30'));
  for (const role of ['product-manager', 'delivery-lead', 'builder', null]) assert.equal(set(root, 'budget.usage_envelope', '30', id, role).ok, false, String(role));
  assert.equal(set(root, 'scope_add', 'CSV import', confirm(2, 'scope_add', 'CSV import', ask('scope_add', 'CSV import')), 'product-manager').ok, true);
  assert.match(goal.main(['set', 'budget.usage_envelope', '30', '--record', id], { who: who(root, 'builder') }).out, /\nMessage the Chief of Staff\.$/);
  assert.match(goal.main(['set', 'budget.usage_envelope', '30'], { who: who(root, 'chief-of-staff') }).out, /goal\.js ask budget\.usage_envelope 30/);
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
  const { root, ask, confirm } = ownerSaid(['yes']);
  assert.equal(set(root, 'pause', 'paused', confirm(1, 'pause', 'paused', ask('pause', 'paused'))).ok, true);
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
  const { root, decide } = ownerSaid(cases.map((c) => c[0]));
  cases.forEach(([quote, field, v], i) => {
    assert.equal(set(root, field, v, decide(i + 1, quote, `goal:${field}=${v}`)).ok, false, `${quote} -> ${field}=${v}`);
  });
});

test('R-42 re-review: scope changes are adds or removes; a removal can only remove', () => {
  const { root, ask, confirm } = ownerSaid(['yes', 'yes', 'yes']);
  assert.equal(set(root, 'scope_add', 'CSV import,login page', confirm(1, 'scope_add', 'CSV import,login page', ask('scope_add', 'CSV import,login page'))).ok, true);
  assert.equal(set(root, 'scope_remove', 'login page', confirm(2, 'scope_remove', 'login page', ask('scope_remove', 'login page'))).ok, true);
  assert.deepEqual(Goal.value(root, 'scope'), ['CSV import']);
  assert.equal(Goal.questionText('scope_remove', 'login page'), 'Remove login page from the scope?');
  assert.equal(set(root, 'pause', 'off', confirm(3, 'pause', 'off', ask('pause', 'off'))).ok, true);
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
  const { root, decide } = ownerSaid(['Don’t pause the team']);
  assert.equal(Goal.set({ root, who: who(root, 'chief-of-staff'), field: 'pause', value: 'paused', record: decide(1, 'Don’t pause the team', 'goal:pause=paused'), judged: { p: 0.95 } }).ok, false);
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
