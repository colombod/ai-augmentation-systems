// scripts/assumptions.test.js — the assumption register, D4 and the spike gate (R-14, R-15, R-16, R-18),
// replayed on Vault moments: the #478 intake built on the documentation's reading of the ChatGPT file
// hand-off, the R1 probe (10-12 14:09) that showed a local path, the cancelled probe, and #478's twin
// that was not a recording; and the PR 55 review's attacks on them. Real code paths: materialise's
// planner, assumptions.js, ready.js, the bd guard's claim, close and delete checks, and the lanes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('./lib/assumptions.js');
const W = require('./lib/warnings.js');
const { planGraph } = require('./lib/plan-graph.js');
const { parseSpikes } = require('./lib/plan-docs.js');
const { loadManifest } = require('./lib/manifest.js');
const { reasonProblems } = require('./lib/short-reason.js');
const { main: assumptions } = require('./assumptions.js');
const { main: ready } = require('./ready.js');
const { gateChecks, decideBd } = require('../hooks/scripts/bd-guard.js');
const { STORY, makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');

const FILE_HANDOFF = 'The ChatGPT app passes an attached file to the tool as an https download link';
const PASTE = 'A player can paste 5,000 lines of CSV in one message';
const row = (id, statement, kind, criteria, status = 'assumed', evidence = '', owner = 'PM') => `| ${id} | ${statement} | ${kind} | ${criteria} | ${status} | ${evidence} | ${owner} |`;
const register = (...rows) => `# Assumptions: vault\n\n## Register\n\n${A.HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n${rows.join('\n')}\n`;
const ARCH = `# Architecture\n\n## Spikes\n\n| # | Question to answer | Decision it informs | Decision rule | Decision owner | Time box | Blocks | Assumption |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | What does the tool receive when a player attaches a CSV in ChatGPT plain chat? | how the intake reads the file | an https link: build the download intake; a local path or nothing: change the design to paste-in; no answer in the box: stop | PM | 1 hour | | A-8 |
| 2 | Does a 5,000-line paste arrive whole? | the paste-in intake | whole: build it; cut: split the paste | DM | 1 hour | | A-10 |\n`;
const OTHER = STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4').replace('Import a collection by dropping a CSV in the chat', 'Show the collection summary');
// owner records: -30 is scoped to the file hand-off spike, -31 to nothing
const scoped = (beads) => ({ ok: true, chain: [{ kind: 'decision', scope: { beads, labels: [] } }, { kind: 'input', source: 'human', text: '' }] });
const VERIFY = (root, id) => (id === 'dec-chief-of-staff-30' ? scoped(['ex-vault-spike-a-8']) : id === 'dec-chief-of-staff-31' ? scoped([]) : { ok: false, error: 'not found' });

// the project, its register, the planner's beads for it, and one role session per actor
function setup(rows, { arch = ARCH } = {}) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), OTHER);
  fs.writeFileSync(A.fileOf(root, 'vault'), register(...rows));
  const team = loadManifest(root).team;
  const plan = planGraph({ prefix: 'ex', initiative: 'vault', sha: 'abc1234', roadmap: { phases: [{ number: '1', name: 'Collections', items: [] }] },
    stories: [{ id: 'vault-0n9-3', title: 'Import', phase: '1', dependsOn: [], file: 'vault-0n9-3.md' }, { id: 'vault-0n9-4', title: 'Summary', phase: '1', dependsOn: [], file: 'vault-0n9-4.md' }],
    spikes: parseSpikes(arch), assumptions: A.loadRegister(root, 'vault').rows });
  const spikes = plan.beads.filter((b) => b.labels.includes('spike')).map((b) => ({ ...b, status: 'open' }));
  const bd = memBd([storyBead({ status: 'open', assignee: null, metadata: { story: 'vault-0n9-3' } }),
    storyBead({ id: 'ex-vault-0n9-4', status: 'open', assignee: null, metadata: { story: 'vault-0n9-4', story_file: 'vault-0n9-4.md' } }), ...spikes]);
  const t = { root, team, plan, bd, verify: VERIFY };
  const v = (...x) => t.verify(...x);
  t.who = (roleId, n = '') => ({ root, team, roleId, instance: `${roleId}${n}`, actor: `dev@pc/${roleId}${n}` });
  t.run = (role, argv) => assumptions(argv, { bd, who: t.who(role), verifyRecord: v });
  t.claim = (id, over = {}) => gateChecks({ command: `bd update ${id} --claim`, roleId: 'builder', actor: 'dev@pc/builder-1', instance: 'builder-1', bd, root, team, verifyRecord: v, ...over });
  t.dm = (command) => gateChecks({ command, roleId: 'delivery-lead', actor: 'dm@pc/delivery-lead', instance: 'delivery-lead', bd, root, team, verifyRecord: v });
  t.ready = (id) => ready([id, '--record'], { bd, who: t.who('delivery-lead'), verifyRecord: v });
  let n = 0;
  t.capture = (text, spike = 'ex-vault-spike-a-8') => { const f = path.join(root, '.delivery', 'evidence', 'artifacts', spike, `c${++n}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  t.rcProbe = (observed, spike = 'ex-vault-spike-a-8') => t.run('reality-checker', ['probe', spike, '--host', 'chatgpt.com plain chat', '--observed', observed, '--artifact', t.capture(observed, spike)]);
  t.json = (name, obj) => { const f = path.join(root, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
  t.write = (...r) => fs.writeFileSync(A.fileOf(root, 'vault'), register(...r));
  return t;
}

const A8 = (status = 'assumed', evidence = '') => row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3#1 vault-0n9-3#2', status, evidence);
const A10 = (status = 'assumed', evidence = '', kind = 'internal') => row('A-10', PASTE, kind, 'vault-0n9-3#1', status, evidence, 'DM');
const RECORDING = { source: 'chatgpt.com plain chat', recorded_at: '2026-10-12T14:09:00Z', recorded_by: 'reality-checker', exchanges: [{ request: { tool: 'import', text: 'name,count' }, response: { lines: 5000 } }] };

// observed and acknowledged: the normal flow through the real host
function observeAndAck(t) {
  const p = t.rcProbe('an https download link');
  assert.equal(t.run('product-manager', ['observe', 'A-8', '--evidence', p.row.id]).code, 0);
  assert.equal(t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'build the download intake']).code, 0);
  return p;
}

test('R-14: materialise makes spike-a-8 with its decision rule, blocking the intake, whatever its status', () => {
  const t = setup([A8()]);
  const spike = t.plan.beads.find((b) => b.id === 'ex-vault-spike-a-8');
  assert.equal(spike.metadata.assumption, 'A-8');
  assert.match(spike.metadata.decision_rule, /local path or nothing: change the design/);
  assert.equal(spike.metadata.decision_owner, 'PM');
  assert.ok(t.plan.deps.some((d) => d.id === 'ex-vault-0n9-3' && d.blockedBy === 'ex-vault-spike-a-8'));
  assert.ok(!t.plan.deps.some((d) => d.id === 'ex-vault-0n9-4' && d.blockedBy === 'ex-vault-spike-a-8'), 'only the stories it sits on');
  const bare = setup([A8()], { arch: '' });
  assert.ok(bare.plan.warnings.some((w) => /spike a-8 for A-8: no decision rule/.test(w)));
  // observed without a Spikes row: the spike stays in the plan, since its evidence and ack live on it (Copilot 952)
  assert.ok(setup([A8('observed', 'ev-ex-vault-0n9-3-1')], { arch: '' }).plan.beads.some((b) => b.id === 'ex-vault-spike-a-8'));
  assert.ok(!setup([row('A-1', 'Sixty seconds is enough', 'internal', 'vault-0n9-3#1')], { arch: '' }).plan.beads.some((b) => b.labels.includes('spike')));
});

test('R-14: add is the Product or Delivery Manager\'s, numbers the next A-n and starts it assumed', () => {
  const t = setup([A8()]);
  const r0 = t.run('builder', ['add', '--statement', 'x', '--kind', 'internal', '--criteria', 'vault-0n9-3#1', '--owner', 'DM']);
  assert.equal(r0.code, 1);
  assert.deepEqual(reasonProblems(r0.out), []);
  assert.equal(t.run('product-manager', ['add', '--statement', 'ChatGPT shows all 81 tools of the connector', '--kind', 'external-host', '--criteria', 'vault-0n9-4', '--owner', 'PM']).code, 0);
  const a = A.loadRegister(t.root, 'vault').rows.find((x) => x.id === 'A-9');
  assert.deepEqual([a.kind, a.status, a.criteria], ['external-host', 'assumed', [{ story: 'vault-0n9-4', ns: [] }]]);
  assert.equal(t.run('product-manager', ['add', '--statement', 'x', '--kind', 'guess', '--criteria', 'vault-0n9-3', '--owner', 'PM']).code, 2);
  assert.match(t.run('chief-of-staff', ['list', '--plain']).out, /Show the collection summary: blocked until we check whether ChatGPT shows all 81 tools/);
});

test('R-15 replay: the #478 intake is claimed while the file hand-off is only assumed: refused (D4) naming the spike, in two lines', async () => {
  const t = setup([A8()]);
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /D4: criterion 1, 2 rests on A-8, not yet observed in the real host: run spike ex-vault-spike-a-8 first/);
  assert.match(g.deny.split('\n')[1], /Message the Delivery Manager: ex-vault-0n9-3 cannot start, it waits on spike ex-vault-spike-a-8/);
  assert.deepEqual(reasonProblems(g.deny), []);
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null, 'the story that does not rest on it is not held');
  const r = await t.ready('ex-vault-0n9-3');
  assert.equal(r.code, 1);
  assert.match(r.out, /block D4 assumption-unobserved/);
  assert.equal(t.bd.show('ex-vault-0n9-3').metadata.ready_hash, undefined);
  // the file pre-check the stories skill uses reads the register too (Copilot 964)
  const f = await ready(['--story', path.join(t.root, '.delivery', 'stories', 'vault-0n9-3.md'), '--initiative', 'vault'], { bd: t.bd, who: t.who('delivery-lead') });
  assert.equal(f.code, 1);
  assert.match(f.out, /D4 assumption-unobserved/);
  assert.equal(t.run('chief-of-staff', ['list', '--plain']).out.split('\n')[0], 'Import a collection by dropping a CSV in the chat: blocked until we check whether the ChatGPT app passes an attached file to the tool as an https download link');
});

test('R-15: other kinds only warn: the manifest extensions block assumed, an internal choice refuted', async () => {
  const t = setup([row('A-3', 'The connector manifest accepts an extensions block', 'platform', 'vault-0n9-3#1', 'assumed', '', 'DM')]);
  const g = await t.claim('ex-vault-0n9-3');
  assert.equal(g.deny, null);
  assert.ok(g.warnings.some((w) => w.kind === 'assumption-unobserved' && w.rule === 'R-15' && /A-3 \(platform\)/.test(w.detail)));
  // a refuted internal assumption warns, and its area is not paused
  const u = setup([A10()]);
  u.bd.beads.get('ex-vault-spike-a-10').assignee = 'dev@pc/builder';
  const p = u.run('builder', ['probe', 'ex-vault-spike-a-10', '--host', 'localhost', '--observed', 'the paste is cut at 4,096 characters', '--artifact', u.capture('cut', 'ex-vault-spike-a-10')]);
  assert.equal(u.run('builder', ['refute', 'A-10', '--evidence', p.row.id]).code, 0);
  const c = await u.claim('ex-vault-0n9-3');
  assert.equal(c.deny, null);
  assert.ok(c.warnings.some((w) => w.kind === 'assumption-refuted' && w.rule === 'R-15'));
  assert.equal((await u.claim('ex-vault-0n9-4')).deny, null);
});

test('R-16/R-15 replay: R1 shows a local path; A-8 is refuted; the intake stops and its area pauses until the design changes and ready is re-recorded', async () => {
  const t = setup([A8()]);
  t.bd.beads.get('ex-vault-spike-a-8').assignee = 'dev@pc/builder';
  const local = t.run('builder', ['probe', 'ex-vault-spike-a-8', '--host', 'localhost', '--observed', 'x', '--artifact', t.capture('x')]);
  assert.match(local.out, /only the Reality Checker's probe in the real host observes it, never a twin/);
  assert.deepEqual(reasonProblems(local.out), []);
  const p = t.rcProbe('the tool got a local Windows path (C:\\fakepath\\collection.csv), not an https link');
  assert.equal(p.code, 0, p.out);
  const r = t.run('product-manager', ['refute', 'A-8', '--evidence', p.row.id]);
  assert.match(r.out, /andon on ex-vault-0n9-3/);
  assert.ok(W.list(t.root).some((w) => w.kind === 'assumption-refuted' && w.bead === 'ex-vault-0n9-3'));
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /D4: criterion 1, 2 rests on A-8, refuted by ev-ex-vault-spike-a-8-1/);
  assert.deepEqual(reasonProblems(g.deny), []);
  assert.match((await t.claim('ex-vault-0n9-4')).deny, /area collection is paused: ex-vault-0n9-3 rests on refuted A-8/);
  t.bd.update('ex-vault-0n9-4', { addLabels: ['bug'] });
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null, 'a fix story goes on in a paused area');
  t.bd.update('ex-vault-0n9-4', { removeLabels: ['bug'] });
  // B3: a refuted assumption is not observed again by a later probe, the Reality Checker's included
  const again = t.rcProbe('an https link this time');
  const o = t.run('product-manager', ['observe', 'A-8', '--evidence', again.row.id]);
  assert.match(o.out, /A-8 was refuted; a later probe does not observe it again/);
  assert.deepEqual(reasonProblems(o.out), []);
  // the design changes: the intake asks the player to paste the CSV, resting on an internal choice
  t.write(row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-9', 'refuted', p.row.id), A10());
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null, 'the area resumes once no story rests on the refuted assumption');
  const rr = await t.ready('ex-vault-0n9-3');
  assert.equal(rr.code, 0, rr.out);
  assert.deepEqual(t.bd.show('ex-vault-0n9-3').metadata.ready_assumptions, ['A-10']);
  assert.ok(!W.list(t.root).some((w) => w.kind === 'assumption-refuted' && w.bead === 'ex-vault-0n9-3' && !w.acked_by), 'the re-recorded ready resolves the hold (Copilot 986)');
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
});

test('B3: a reopened assumption is observed only by a Reality Checker probe newer than the reopen', async () => {
  const t = setup([A8()]);
  const p = t.rcProbe('a local path');
  t.run('product-manager', ['refute', 'A-8', '--evidence', p.row.id]);
  const later = t.rcProbe('an https link');
  assert.equal(t.run('delivery-lead', ['reopen', 'A-8']).code, 1, 'reopen is the Product Manager\'s');
  assert.equal(t.run('product-manager', ['reopen', 'A-8']).code, 0);
  assert.equal(A.loadRegister(t.root, 'vault').rows[0].status, 'assumed');
  assert.match(t.run('product-manager', ['observe', 'A-8', '--evidence', later.row.id]).out, /reopened after ev-ex-vault-spike-a-8-2/);
  const fresh = t.rcProbe('an https link, after the fix on their side');
  assert.equal(t.run('product-manager', ['observe', 'A-8', '--evidence', fresh.row.id]).code, 0);
});

test('D4 andon: a story made ready on A-8, refuted later, stays held until ready is re-recorded on the new design', async () => {
  const t = setup([A8()]);
  observeAndAck(t);
  assert.equal((await t.ready('ex-vault-0n9-3')).code, 0);
  assert.deepEqual(t.bd.show('ex-vault-0n9-3').metadata.ready_assumptions, ['A-8']);
  const p2 = t.rcProbe('a local path after their update');
  assert.equal(t.run('product-manager', ['refute', 'A-8', '--evidence', p2.row.id]).code, 0);
  t.write(row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-9', 'refuted', p2.row.id), A10());
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /ready was recorded on A-8, since refuted/);
  assert.match((await t.claim('ex-vault-0n9-4')).deny, /area collection is paused/);
  assert.equal((await t.ready('ex-vault-0n9-3')).code, 0);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
});

test('R-16 replay: the result waits for its decision owner\'s acknowledgement, which names that result and post-dates it', async () => {
  const t = setup([A8()]);
  const p = t.rcProbe('an https download link');
  assert.equal(t.run('reality-checker', ['observe', 'A-8', '--evidence', p.row.id]).code, 1, 'the Reality Checker records, it does not settle');
  assert.equal(t.run('spike-researcher', ['observe', 'A-8', '--evidence', p.row.id]).code, 0);
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /D4: spike ex-vault-spike-a-8 for A-8 has no acknowledgement of its result from its decision owner \(PM\)/);
  assert.equal(t.run('builder', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'build']).code, 1);
  // the declared owner only: the Delivery Manager cannot acknowledge a PM-owned spike (Copilot 923)
  const dm = t.run('delivery-lead', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'build']);
  assert.match(dm.out, /decision owner is the Product Manager/);
  assert.deepEqual(reasonProblems(dm.out), []);
  assert.equal(t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--decision', 'build']).code, 2, 'an ack names its result');
  assert.equal(t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'build the download intake']).code, 0);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
  // a newer result settles the assumption: the old acknowledgement does not cover it (Copilot 929)
  const p2 = t.rcProbe('an https link that expires in 5 minutes');
  assert.equal(t.run('product-manager', ['observe', 'A-8', '--evidence', p2.row.id]).code, 0);
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /no acknowledgement of its result/);
  // a DM ack row written by hand for a PM spike does not count either (read side of 923)
  const rows = A.spikeState(t.root, t.bd.show('ex-vault-spike-a-8')).rows;
  assert.equal(A.ackOf(rows, p2.row, 'product-manager'), null);
  assert.ok(A.ackOf([...rows, { type: 'ack', result: p2.row.id, seq: 99, by: 'product-manager' }], p2.row, 'product-manager'));
  assert.equal(A.ackOf([...rows, { type: 'ack', result: p2.row.id, seq: 99, by: 'delivery-lead' }], p2.row, 'product-manager'), null);
});

test('R-16: a spike that decides scope is acknowledged only on the owner\'s record scoped to it, re-verified at the claim', async () => {
  const t = setup([row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3', 'assumed', '', 'owner')], { arch: '' });
  const p = t.rcProbe('an https link');
  assert.equal(t.run('product-manager', ['observe', 'A-8', '--evidence', p.row.id]).code, 0);
  const ack = (rec) => t.run('delivery-lead', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'keep the intake in scope', ...(rec ? ['--record', rec] : [])]);
  const none = ack(null);
  assert.match(none.out, /cite the owner's record/);
  assert.deepEqual(reasonProblems(none.out), []);
  assert.match(ack('dec-x-1').out, /dec-x-1 does not verify/);
  assert.match(ack('dec-chief-of-staff-31').out, /not scoped to ex-vault-spike-a-8 or A-8/);
  assert.match(t.run('chief-of-staff', ['list', '--plain']).out, /waiting for your decision: we checked whether the ChatGPT app passes/);
  assert.equal(ack('dec-chief-of-staff-30').code, 0);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
  assert.equal(t.run('chief-of-staff', ['list', '--plain']).out, 'Nothing is waiting on a check of the outside world or on a decision about one.');
  t.verify = () => ({ ok: false, error: 'revoked' });
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /no acknowledgement of its result from its decision owner \(owner\)/);
});

test('R-16 replay: "prove before building" overruled: the cancelled probe; the spike closes only with a result and its acknowledgement', async () => {
  const t = setup([A8()]);
  const close = () => t.dm('bd close ex-vault-spike-a-8 --reason "cancelled: build on the docs"');
  let g = await close();
  assert.match(g.deny, /Close of ex-vault-spike-a-8 refused \(D4\): it has no result row, and it answers A-8, an external host/);
  assert.deepEqual(reasonProblems(g.deny), []);
  const p = t.rcProbe('a local path');
  assert.match((await close()).deny, /its decision owner has not acknowledged the result/);
  // without the spike label the gate still applies: it keys on the protected assumption field (Copilot 888)
  t.bd.update('ex-vault-spike-a-8', { removeLabels: ['spike'] });
  assert.match((await close()).deny, /refused \(D4\)/);
  t.bd.beads.get('ex-vault-spike-a-8').assignee = 'dev@pc/builder';
  assert.equal(decideBd({ command: 'bd update ex-vault-spike-a-8 --remove-label spike', actor: 'dev@pc/builder', roleId: 'builder', staleHours: 2, bd: t.bd }).reason.split('\n')[0], 'Refused: removing the spike label: the spike gate keys on it, so only the Delivery Manager changes it.');
  // nor is it deleted while a story rests on it, the Delivery Manager included
  g = await t.dm('bd delete ex-vault-spike-a-8 --force');
  assert.match(g.deny, /Delete of ex-vault-spike-a-8 refused \(D4\): ex-vault-0n9-3 still rest on A-8/);
  assert.deepEqual(reasonProblems(g.deny), []);
  t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--result', p.row.id, '--decision', 'change the design to paste-in']);
  assert.equal((await close()).deny, null);
  t.bd.beads.set('ex-vault-spike-9', { id: 'ex-vault-spike-9', title: 'Spike 9', status: 'open', labels: ['spike'], metadata: { question: 'q' } });
  assert.ok((await t.claim('ex-vault-spike-9')).warnings.some((w) => w.kind === 'spike-fields' && /decision, decision rule/.test(w.detail)));
});

test('R-18 replay: #478\'s twin built from the docs is not evidence; a twin counts only for internal and platform kinds, from a recording it binds', async () => {
  const t = setup([A8(), A10()]);
  t.bd.beads.get('ex-vault-spike-a-8').assignee = 'dev@pc/builder';
  t.bd.beads.get('ex-vault-spike-a-10').assignee = 'dev@pc/builder';
  // an external host: never through a twin, however good the recording (ruling)
  const ext = t.run('builder', ['probe', 'ex-vault-spike-a-8', '--host', 'twin', '--observed', 'https', '--artifact', t.capture('14 passing'), '--twin', t.json('rec.json', RECORDING)]);
  assert.match(ext.out, /never a twin/);
  assert.match(t.run('reality-checker', ['probe', 'ex-vault-spike-a-8', '--host', 'twin', '--observed', 'https', '--artifact', t.capture('x'), '--twin', t.json('rec.json', RECORDING)]).out, /never a twin/, 'not even the Reality Checker\'s');
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /not yet observed in the real host/);
  // an internal choice: a twin written from the docs does not count, and its row cannot be acknowledged (Copilot 936)
  const probe = (twin) => t.run('builder', ['probe', 'ex-vault-spike-a-10', '--host', 'twin', '--observed', 'the paste arrives whole', '--artifact', t.capture('ok', 'ex-vault-spike-a-10'), '--twin', twin]);
  const docs = probe(t.json('docs.json', { note: 'written from the Apps SDK docs', exchanges: [{ request: { a: 1 }, response: { b: 2 } }] }));
  assert.match(docs.out, /does not count: the recording names no source/);
  assert.ok(W.list(t.root).some((w) => w.kind === 'twin-unrecorded' && w.rule === 'R-18'));
  assert.match(t.run('builder', ['observe', 'A-10', '--evidence', docs.row.id]).out, /an assumption, not evidence \(R-18\)/);
  assert.match(t.run('delivery-lead', ['ack', 'ex-vault-spike-a-10', '--result', docs.row.id, '--decision', 'build']).out, /not a counting result/);
  assert.equal(A.latestResult([docs.row]), null);
  // each part of the recording is required (I4: pairs, date, recorder), and JSON null is refused cleanly (Copilot 975)
  for (const [bad, why] of [[{ ...RECORDING, exchanges: [{}] }, /no captured request and response/], [{ ...RECORDING, exchanges: [{ request: {}, response: {} }] }, /no captured request and response/],
    [{ ...RECORDING, recorded_at: 'yesterday' }, /no capture date/], [{ ...RECORDING, recorded_by: undefined }, /names no recorder/], ['null', /not a JSON object/]]) {
    assert.match(probe(t.json('bad.json', bad)).out, why);
  }
  const good = probe(t.json('rec.json', RECORDING));
  assert.deepEqual([good.row.counts, good.row.recorded_by, good.row.recorded_at, good.row.recording_sha256.length], [true, 'reality-checker', RECORDING.recorded_at, 64]);
  // the builder settles only the spike it holds (I4)
  t.bd.beads.get('ex-vault-spike-a-10').assignee = 'dev@pc/builder-2';
  assert.match(t.run('builder', ['observe', 'A-10', '--evidence', good.row.id]).out, /a builder settles only the assumption of the spike it holds/);
  t.bd.beads.get('ex-vault-spike-a-10').assignee = 'dev@pc/builder';
  assert.equal(t.run('builder', ['observe', 'A-10', '--evidence', good.row.id]).code, 0);
  // a data assumption is not settled by a twin either
  assert.match(A.observationProblem({ ...good.row }, { id: 'A-10', kind: 'data' }), /counts only for internal and platform/);
});

test('B1: the gates re-verify the register: a status without a valid evidence row is assumed', async () => {
  const t = setup([A8('observed', 'ev-bogus-1')]);
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /not yet observed in the real host/);
  assert.ok(g.warnings.some((w) => w.kind === 'assumption-unverified' && /A-8 says observed, but/.test(w.detail)));
  // a refuted status with no row behind it is assumed too: D4 still, no area pause
  t.write(A8('refuted', 'ev-ex-vault-spike-a-8-7'));
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /not yet observed/);
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null);
  // a valid probe of another initiative's A-8 does not observe this one (Copilot 915)
  t.bd.beads.set('ex-shop-spike-a-8', { id: 'ex-shop-spike-a-8', title: 's', status: 'open', labels: ['spike'], metadata: { roadmap_ref: 'shop/roadmap.md@abc phase 1', assumption: 'A-8' } });
  const full = require('./lib/gates.js').appendEvidence(t.root, 'ex-shop-spike-a-8', { type: 'probe', assumption: 'A-8', via: 'host', counts: true, by: 'reality-checker' });
  t.bd.beads.get('ex-shop-spike-a-8').metadata.evidence_head = full.head;
  assert.match(A.evidenceOf(t.root, t.bd, 'vault', { id: 'A-8', kind: 'external-host' }, full.id).why, /on a bead of another initiative/);
  assert.equal(A.evidenceOf(t.root, t.bd, 'shop', { id: 'A-8', kind: 'external-host' }, full.id).why, null);
  // a row that is not a probe, by anyone, is not an observation
  assert.match(A.observationProblem({ id: 'ev-x-1', type: 'row', by: 'reality-checker', via: 'reality-check' }, { id: 'A-8', kind: 'external-host' }), /not a probe in the real host/);
});

test('B2: a child bead of a story resting on an assumed external host is refused for its criterion, or for all when it names none', async () => {
  const t = setup([row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3#1')]);
  const child = (criterion) => ({ id: `ex-vault-0n9-3.${criterion || 'x'}`, title: 'part', status: 'open', parent: 'ex-vault-0n9-3', labels: [], metadata: criterion ? { criterion } : {} });
  for (const c of [1, null]) t.bd.beads.set(child(c).id, child(c));
  assert.match((await t.claim('ex-vault-0n9-3.1')).deny, /its story ex-vault-0n9-3: criterion 1 rests on A-8, not yet observed/);
  assert.match((await t.claim('ex-vault-0n9-3.x')).deny, /not yet observed/);
  t.bd.beads.set('ex-vault-0n9-3.2', child(2));
  assert.equal((await t.claim('ex-vault-0n9-3.2')).deny, null, 'criterion 2 does not rest on it');
});

test('Copilot 864: each story in an area is read against its own initiative\'s register', async () => {
  const t = setup([A8()]);
  const p = t.rcProbe('a local path');
  t.run('product-manager', ['refute', 'A-8', '--evidence', p.row.id]);
  t.write(row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-9', 'refuted', p.row.id));
  // another initiative's story, ready on its own A-8 (an internal choice there), shares the area
  fs.mkdirSync(path.join(t.root, '.delivery', 'initiatives', 'shop'), { recursive: true });
  fs.writeFileSync(A.fileOf(t.root, 'shop'), register(row('A-8', 'Shop claim', 'internal', 'shop-1')));
  t.bd.beads.set('ex-shop-1', storyBead({ id: 'ex-shop-1', status: 'open', assignee: null, metadata: { roadmap_ref: 'shop/roadmap.md@abc phase 1', story: 'shop-1', ready_assumptions: ['A-8'] } }));
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null);
  assert.equal(t.run('chief-of-staff', ['list', '--plain']).code, 0, 'list --plain reads every initiative');
});

test('protected fields: a builder writes none of assumption, decision_owner, ready_assumptions (I4)', () => {
  const t = setup([A8()]);
  for (const k of ['assumption', 'decision_owner', 'ready_assumptions']) {
    const d = decideBd({ command: `bd update ex-vault-spike-a-8 --metadata '{"${k}":"x"}'`, actor: 'dev@pc/builder', roleId: 'builder', staleHours: 2, bd: t.bd });
    assert.match(d.reason, new RegExp(`the gate field ${k}`));
  }
});

test('list --plain: no register says so and exits 0; a story without a title is not named by id', () => {
  const root = makeProject();
  const r = assumptions(['list', '--plain'], { bd: memBd([]), who: { root, roleId: 'chief-of-staff' } });
  assert.deepEqual([r.code, r.out], [0, 'No assumptions recorded.']);
  const t = setup([row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-77')]);
  assert.match(t.run('chief-of-staff', ['list', '--plain']).out, /^A story not yet written up: blocked until/);
});

test('register parsing: criteria lists, malformed rows as problems, HAR recordings', () => {
  assert.deepEqual(A.criteriaOf('s-1#1 s-1#3, s-2'), [{ story: 's-1', ns: [1, 3] }, { story: 's-2', ns: [] }]);
  assert.equal(A.parseRegister(register(row('B-1', 'x', 'vibes', '', 'observed'))).problems.length, 4);
  const har = path.join(makeProject(), 'h.har');
  fs.writeFileSync(har, JSON.stringify({ log: { creator: { recorded_by: 'reality-checker' }, entries: [{ startedDateTime: '2026-10-12T14:09:00Z', request: { url: 'https://chatgpt.com/x' }, response: { status: 200 } }] } }));
  assert.equal(A.recordingProblem(har), null);
  const local = { id: 'ev-s-1', type: 'probe', assumption: 'A-8', by: 'builder', via: 'host', counts: true };
  assert.match(A.observationProblem(local, { id: 'A-8', kind: 'external-host' }), /not the Reality Checker's probe of the real host/);
  assert.equal(A.observationProblem(local, { id: 'A-8', kind: 'internal' }), null);
});

test('lanes: the register is read by every role, written by the Product and Delivery Managers, probed by the Reality Checker', () => {
  const { decideLane, loadPolicy } = require('../hooks/scripts/lane.js');
  const pluginRoot = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = makeProject();
  const allowed = (role, sub) => {
    const policy = loadPolicy({ pluginRoot, projectRoot: '/nonexistent', briefRef: `delivery/${role}` });
    const d = decideLane({ toolName: 'Bash', toolInput: { command: `node ${pluginRoot}/scripts/assumptions.js ${sub}` }, policy, roleDir, groups, pluginRoot, cwd: roleDir, projectRoot: roleDir, hostHeadless: false });
    return !d || d.allow;
  };
  assert.ok(allowed('chief-of-staff', 'list --plain'));
  assert.ok(!allowed('chief-of-staff', 'add --statement x'));
  for (const role of ['product-manager', 'delivery-lead']) assert.ok(allowed(role, 'ack ex-s --decision d') && allowed(role, 'refute A-1 --evidence ev-x-1'), role);
  assert.ok(allowed('reality-checker', 'probe ex-s --host h --observed o --artifact a'));
  assert.ok(!allowed('reality-checker', 'ack ex-s --decision d'));
  assert.ok(!allowed('progress-observer', 'observe A-1 --evidence ev-x-1'));
  // B1: nobody writes the register except through the script, the Product Manager and the any-lanes included
  const reg = path.join(roleDir, '.delivery', 'initiatives', 'vault', 'assumptions.md');
  for (const role of ['builder', 'spike-researcher', 'product-manager', 'delivery-lead']) {
    const policy = loadPolicy({ pluginRoot, projectRoot: '/nonexistent', briefRef: `delivery/${role}` });
    const d = (toolName, toolInput) => decideLane({ toolName, toolInput, policy, roleDir, groups, pluginRoot, cwd: roleDir, projectRoot: roleDir, hostHeadless: false });
    for (const [tool, input] of [['Write', { file_path: reg }], ['Edit', { file_path: reg }], ['Bash', { command: "sed -i '' 's/assumed/observed/' .delivery/initiatives/vault/assumptions.md" }],
      ['Bash', { command: 'printf x > .delivery/initiatives/vault/assumptions.md' }], ['Bash', { command: `cp /tmp/x ${reg}` }]]) {
      const r = d(tool, input);
      assert.ok(r && !r.allow && /assumption register changes only through `assumptions.js`/.test(r.reason), `${role} ${tool} ${JSON.stringify(input)}`);
      assert.deepEqual(reasonProblems(r.reason), []);
    }
    assert.ok(allowed(role, 'list') || role === 'builder' || role === 'spike-researcher');
  }
});
