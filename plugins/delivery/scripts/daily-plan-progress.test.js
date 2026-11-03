// scripts/daily-plan-progress.test.js — the owner asked for progress and read the briefing as "issues
// and blocked work" (dec-chief-of-staff-000221): it printed stalls, a blocked story and "10 decisions",
// 8 of them stale, and one count line about what shipped. The briefing now leads with what shipped,
// one line per change marked merged, live or checked from the record, then the open problems, and it
// counts only the questions still waiting on the owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DP = require('./lib/daily-plan.js');
const G = require('./lib/gates.js');
const R = require('./lib/operator-records.js');
const log = require('./lib/operator-log.js');
const { makeProject, memBd } = require('./testing/gate-fixture.js');
const plan = require('./plan.js');

const COS = 'chief-of-staff';
const meta = (story) => ({ roadmap_ref: 'vault/roadmap.md@abc1234 phase 1', surface: 'S1', area: 'collection', story, story_file: `${story}.md` });
const storyOf = (id, title, labels = []) => ({ id: `ex-${id}`, title, status: 'open', parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story', 'wave-1', ...labels], metadata: meta(id) });
const fixOf = (id, title, labels = [], status = 'open') => ({ id: `ex-${id}`, title, status, labels: ['bug', ...labels], metadata: {} });
const teamOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'team.json'), 'utf8'));
const deps = (root, beads, extra = {}) => ({ who: { root, team: teamOf(root), roleId: COS, instance: COS }, bd: memBd(beads), budget: { set: false }, ci: { red: false }, ...extra });

// yesterday's plan with every bead open, then today's states on the beads
async function sinceYesterday(root, beads, raise) {
  const d = deps(root, beads);
  assert.equal((await plan.main(['today'], { ...d, now: '2026-10-18T08:00:00Z' })).code, 0);
  for (const [id, labels] of Object.entries(raise)) d.bd.beads.get(id).labels.push(...labels);
  return d;
}

test('2ys (1, 2): what shipped since yesterday leads, one plain line per change marked from the record, then the open problems', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-3', 'Build vault-0n9-3: Import a collection'), storyOf('vault-0n9-4', 'Build vault-0n9-4: Show the collection summary'),
    storyOf('vault-0n9-5', 'Build vault-0n9-5: Search the collection'), fixOf('bug-1', '[bug] A handoff waits for the next watchdog pass')];
  const d = await sinceYesterday(root, beads, { 'ex-vault-0n9-3': [G.STATE.merged], 'ex-vault-0n9-4': [G.STATE.merged, G.STATE.deployed], 'ex-bug-1': [G.STATE.merged] });
  // an open problem: a step only the owner can take
  require('./lib/owner-queue.js').add(root, { kind: 'signin', what: 'Sign in to the provider', where: 'the browser', steps: 'open the page and sign in' }, { instance: COS });
  const b = await plan.main(['brief'], { ...d, now: '2026-10-19T08:00:00Z' });
  assert.equal(b.code, 0, b.out);
  const lines = b.out.split('\n');
  assert.deepEqual(lines.slice(0, 4), [
    "Since yesterday: 3 changes merged, 1 live, 0 checked on the customer's app.",
    'Show the collection summary: live.',
    'Import a collection by dropping a CSV in the chat: merged.',
    'A handoff waits for the next watchdog pass: merged.',
  ]);
  // the open problems follow what shipped, never before it
  const wait = lines.findIndex((l) => l === 'Waiting on you: 1 step only you can take, in one list.');
  assert.ok(wait > 3, b.out);
  assert.ok(!lines.some((l) => /Search the collection/.test(l)), 'a story that did not move is not news');
  assert.equal(lines[lines.length - 1], 'Ask for details on any item');
  // the plan row records the fix's state, so tomorrow's briefing reads it back
  const row = await plan.main(['today'], { ...d, now: '2026-10-19T09:00:00Z' });
  assert.equal(row.code, 0, row.out);
  const rec = DP.latest(root, '2026-10-19');
  assert.equal(rec.states['ex-bug-1'], 'merged');
  assert.deepEqual(rec.tracks, ['story', 'fix']);
  const next = await plan.main(['brief'], { ...d, now: '2026-10-20T08:00:00Z' });
  assert.match(next.out, /^Since yesterday: nothing new merged, live or checked on the customer's app\.$/m);
});

test('2ys (1): a story checked only by the done gate\'s rule; past four changes the rest is counted, and the shortest briefing is the shipped line', async () => {
  const root = makeProject();
  const beads = Array.from({ length: 6 }, (_, i) => storyOf(`vault-s${i}`, `Build vault-s${i}: Story number ${i}`));
  // state-verified with no evidence rows: the record does not say checked, so the line says live
  const raise = Object.fromEntries(beads.map((b, i) => [b.id, i === 0 ? [G.STATE.merged, G.STATE.deployed, G.STATE.verified] : [G.STATE.merged]]));
  const d = await sinceYesterday(root, beads, raise);
  const lines = (await plan.main(['brief'], { ...d, now: '2026-10-19T08:00:00Z' })).out.split('\n');
  assert.equal(lines[0], "Since yesterday: 6 changes merged, 1 live, 0 checked on the customer's app.");
  assert.equal(lines[1], 'Story number 0: live.');
  assert.equal(lines.filter((l) => /^Story number \d: merged\.$/.test(l)).length, 3);
  assert.equal(lines[5], 'And 2 more changes.');
  const one = DP.brief(DP.facts(root, { bd: d.bd, team: teamOf(root), budget: { set: false }, now: '2026-10-19T08:00:00Z' }), { prev: DP.previous(root, '2026-10-19'), limit: 1 });
  assert.deepEqual(one, ["Since yesterday: 6 changes merged, 1 live, 0 checked on the customer's app. Ask for details on any item"]);
});

test('2ys (1): against a plan row from before fixes were tracked, no old fix is reported as shipped since then', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-4', 'Build vault-0n9-4: Show the collection summary'), fixOf('bug-old', '[bug] Merged weeks ago', [G.STATE.merged, G.STATE.deployed], 'closed')];
  // yesterday's row as an earlier release wrote it: story states only, no tracks
  fs.mkdirSync(path.join(root, DP.REL), { recursive: true });
  fs.writeFileSync(path.join(root, DP.REL, '2026-10-18.ndjson'), `${JSON.stringify({ seq: 1, type: 'plan', at: '2026-10-18T08:00:00Z', by: COS, items: [], states: { 'ex-vault-0n9-4': 'open' } })}\n`);
  const d = deps(root, beads);
  const b = await plan.main(['brief'], { ...d, now: '2026-10-19T08:00:00Z' });
  assert.match(b.out, /^Since yesterday: nothing new merged, live or checked on the customer's app\.$/m);
  assert.ok(!/Merged weeks ago/.test(b.out), b.out);
  // with no plan at all, so far counts every fix on the record
  const fresh = makeProject();
  assert.match((await plan.main(['brief'], deps(fresh, beads))).out, /^Merged weeks ago: live\.$/m);
});

// the operator records as the Chief of Staff writes them: one input, one decision answering a question,
// a withdrawn question, a question about finished work and one still waiting
function records(root) {
  const SID = 'sess-cos';
  // the owner's reply comes after the question it answers
  const said = new Date(Date.now() + 60e3).toISOString();
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brief-tr-')), 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p0', uuid: 'u0', timestamp: said, sessionId: SID, message: { role: 'user', content: 'Use Postgres for the orders service.' } })}\n`);
  const by = { instance: COS, role: COS, session_id: SID, host: 'pc', machine: R.machineId() };
  const scope = (beads) => ({ beads, labels: [], initiatives: [] });
  const ask = (text, beads) => R.recordQuestion({ projectRoot: root, text, asker: { instance: COS, role: COS, bead: null }, scope: scope(beads), by });
  const answered = ask('Which database do orders use?', ['ex-1']);
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: COS, role: COS, host: 'pc' });
  const input = log.listInputs(root, { source: 'human' })[0].id;
  R.recordDecision({ projectRoot: root, cite: input, quote: 'use postgres for the orders service', statement: 'Orders use Postgres', scope: scope(['ex-1']), answers: [answered.id], by });
  const withdrawn = ask('Retire the old queue?', ['ex-1']);
  R.withdraw({ projectRoot: root, question: withdrawn.id, reason: 'the builder found it in the docs', by });
  ask('Open the old import area again?', ['ex-done']);
  return { live: ask('Open feature-map as a new product area?', ['ex-1']) };
}

test('2ys (3): withdrawn, answered and stale questions are not counted as waiting on the owner', async () => {
  const root = makeProject();
  const { live } = records(root);
  const beads = [storyOf('vault-0n9-4', 'Build vault-0n9-4: Show the collection summary'), { id: 'ex-1', title: 'Orders', status: 'open', labels: [], metadata: {} },
    { id: 'ex-done', title: 'Old import', status: 'closed', labels: [], metadata: {} }];
  const d = deps(root, beads);
  // the records hold four questions; one is still the owner's
  assert.equal(R.ledger(root, {}).length, 4);
  const f = DP.facts(root, { bd: d.bd, team: teamOf(root), budget: { set: false } });
  assert.deepEqual(f.questions.map((q) => q.id), [live.id]);
  assert.match((await plan.main(['brief'], d)).out, /^Waiting on you: 1 decision for you\.$/m);
  // once its work closes, that question is stale too
  d.bd.beads.get('ex-1').status = 'closed';
  assert.match((await plan.main(['brief'], d)).out, /^Nothing is waiting on you\.$/m);
});

test('2ys (1, 2): on a busy day what shipped gives way to a count, so the line on what waits on the owner stays in the briefing', async () => {
  const root = makeProject();
  const beads = Array.from({ length: 6 }, (_, i) => storyOf(`vault-s${i}`, `Build vault-s${i}: Story number ${i}`));
  const d = await sinceYesterday(root, beads, Object.fromEntries(beads.map((b) => [b.id, [G.STATE.merged]])));
  require('./lib/owner-queue.js').add(root, { kind: 'signin', what: 'Sign in to the provider', where: 'the browser', steps: 'open the page and sign in' }, { instance: COS });
  const f = DP.facts(root, { bd: d.bd, team: teamOf(root), budget: { set: false }, now: '2026-10-19T08:00:00Z' });
  const lines = DP.brief(f, { prev: DP.previous(root, '2026-10-19'), limit: 5 });
  assert.deepEqual(lines, [
    "Since yesterday: 6 changes merged, 0 live, 0 checked on the customer's app.",
    'Story number 0: merged.',
    'And 5 more changes.',
    'Waiting on you: 1 step only you can take, in one list.',
    'Ask for details on any item',
  ]);
});

test('2ys (1, 2): with room for one change line and several changes, the count line stands alone, so the line on what waits on the owner stays', async () => {
  const root = makeProject();
  const beads = Array.from({ length: 6 }, (_, i) => storyOf(`vault-s${i}`, `Build vault-s${i}: Story number ${i}`));
  const d = await sinceYesterday(root, beads, Object.fromEntries(beads.map((b) => [b.id, [G.STATE.merged]])));
  require('./lib/owner-queue.js').add(root, { kind: 'signin', what: 'Sign in to the provider', where: 'the browser', steps: 'open the page and sign in' }, { instance: COS });
  const f = DP.facts(root, { bd: d.bd, team: teamOf(root), budget: { set: false }, now: '2026-10-19T08:00:00Z' });
  const lines = DP.brief(f, { prev: DP.previous(root, '2026-10-19'), limit: 4 });
  assert.deepEqual(lines, [
    "Since yesterday: 6 changes merged, 0 live, 0 checked on the customer's app.",
    'Waiting on you: 1 step only you can take, in one list.',
    'Today the team works on: Build vault-s0: Story number 0; Build vault-s1: Story number 1, and 1 more.',
    'Ask for details on any item',
  ]);
});
