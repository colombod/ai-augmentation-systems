// scripts/assumptions.test.js — the assumption register, D4 and the spike gate (R-14, R-15, R-16, R-18),
// replayed on Vault moments: the #478 intake built on the documentation's reading of the ChatGPT file
// hand-off, the R1 probe (10-12 14:09) that showed a local path, the cancelled probe, and #478's twin
// that was not a recording. Real code paths: materialise's planner, assumptions.js, ready.js and the
// bd guard's claim and close checks.
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
const { gateChecks } = require('../hooks/scripts/bd-guard.js');
const { STORY, makeProject, storyBead, memBd, ownerVerify } = require('./testing/gate-fixture.js');

const FILE_HANDOFF = 'The ChatGPT app passes an attached file to the tool as an https download link';
const row = (id, statement, kind, criteria, status = 'assumed', evidence = '', owner = 'PM') => `| ${id} | ${statement} | ${kind} | ${criteria} | ${status} | ${evidence} | ${owner} |`;
const register = (...rows) => `# Assumptions: vault\n\n## Register\n\n${A.HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n${rows.join('\n')}\n`;
const ARCH = `# Architecture\n\n## Spikes\n\n| # | Question to answer | Decision it informs | Decision rule | Decision owner | Time box | Blocks | Assumption |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n| 1 | What does the tool receive when a player attaches a CSV in ChatGPT plain chat? | how the intake reads the file | an https link: build the download intake; a local path or nothing: change the design to paste-in; no answer in the box: stop | PM | 1 hour | | A-8 |\n`;
const OTHER = STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4').replace('Import a collection by dropping a CSV in the chat', 'Show the collection summary');

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
  const who = (roleId, n = '') => ({ root, team, roleId, instance: `${roleId}${n}`, actor: `dev@pc/${roleId}${n}` });
  const run = (role, argv, over = {}) => assumptions(argv, { bd, who: { ...who(role), ...over }, verifyRecord: ownerVerify('dec-chief-of-staff-30') });
  const claim = (id, over = {}) => gateChecks({ command: `bd update ${id} --claim`, roleId: 'builder', actor: 'dev@pc/builder-1', instance: 'builder-1', bd, root, team, verifyRecord: ownerVerify('dec-chief-of-staff-30'), ...over });
  const capture = (name, text) => { const f = path.join(root, '.delivery', 'evidence', 'artifacts', 'ex-vault-spike-a-8', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  return { root, team, plan, bd, who, run, claim, capture };
}

const A8 = (status = 'assumed', evidence = '') => row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3#1 vault-0n9-3#2', status, evidence);

test('R-14: the register is read by materialise: the file hand-off becomes spike-a-8 with its decision rule, blocking the intake', () => {
  const t = setup([A8()]);
  const spike = t.plan.beads.find((b) => b.id === 'ex-vault-spike-a-8');
  assert.ok(spike, 'one spike bead per assumed external-host assumption');
  assert.equal(spike.metadata.assumption, 'A-8');
  assert.match(spike.metadata.decision_rule, /local path or nothing: change the design/);
  assert.equal(spike.metadata.decision_owner, 'PM');
  assert.ok(t.plan.deps.some((d) => d.id === 'ex-vault-0n9-3' && d.blockedBy === 'ex-vault-spike-a-8'));
  assert.ok(!t.plan.deps.some((d) => d.id === 'ex-vault-0n9-4' && d.blockedBy === 'ex-vault-spike-a-8'), 'only the stories it sits on');
  // with no Spikes row for it, the spike is still made, and the missing rule is a materialise warning
  const bare = setup([A8()], { arch: '' });
  assert.ok(bare.plan.beads.some((b) => b.id === 'ex-vault-spike-a-8'));
  assert.ok(bare.plan.warnings.some((w) => /spike a-8 for A-8: no decision rule/.test(w)));
  // an internal assumption gets no spike of its own
  assert.ok(!setup([row('A-1', 'Sixty seconds is enough refresh window', 'internal', 'vault-0n9-3#1')], { arch: '' }).plan.beads.some((b) => b.labels.includes('spike')));
});

test('R-14: add is the Product or Delivery Manager\'s, numbers the next A-n and starts it assumed', () => {
  const t = setup([A8()]);
  assert.equal(t.run('builder', ['add', '--statement', 'x', '--kind', 'internal', '--criteria', 'vault-0n9-3#1', '--owner', 'DM']).code, 1);
  const r = t.run('product-manager', ['add', '--statement', 'ChatGPT shows all 81 tools of the connector', '--kind', 'external-host', '--criteria', 'vault-0n9-4', '--owner', 'PM']);
  assert.equal(r.code, 0, r.out);
  const a = A.loadRegister(t.root, 'vault').rows.find((x) => x.id === 'A-9');
  assert.deepEqual([a.kind, a.status, a.criteria], ['external-host', 'assumed', [{ story: 'vault-0n9-4', ns: [] }]]);
  assert.equal(t.run('product-manager', ['add', '--statement', 'x', '--kind', 'guess', '--criteria', 'vault-0n9-3', '--owner', 'PM']).code, 2);
  assert.match(t.run('chief-of-staff', ['list', '--plain']).out, /Show the collection summary: blocked until we check whether ChatGPT shows all 81 tools/);
});

test('R-15 replay: the #478 intake is claimed while the file hand-off is only assumed: refused (D4) naming the spike, in two lines', async () => {
  const t = setup([A8()]);
  const g = await t.claim('ex-vault-0n9-3');
  assert.ok(g.deny, 'the claim is refused');
  assert.match(g.deny, /D4: criterion 1, 2 rests on A-8, not yet observed in the real host: run spike ex-vault-spike-a-8 first/);
  assert.match(g.deny.split('\n')[1], /Message the Delivery Manager: ex-vault-0n9-3 cannot start, it waits on spike ex-vault-spike-a-8/);
  assert.deepEqual(reasonProblems(g.deny), []);
  // the story that does not rest on it is not held
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null);
  // not ready either, so the Delivery Manager cannot stamp it ready
  const r = await ready(['ex-vault-0n9-3', '--record'], { bd: t.bd, who: t.who('delivery-lead') });
  assert.equal(r.code, 1);
  assert.match(r.out, /block D4 assumption-unobserved/);
  assert.equal(t.bd.show('ex-vault-0n9-3').metadata.ready_hash, undefined);
  // the Chief of Staff says it in plain words
  assert.equal(t.run('chief-of-staff', ['list', '--plain']).out.split('\n')[0], 'Import a collection by dropping a CSV in the chat: blocked until we check whether the ChatGPT app passes an attached file to the tool as an https download link');
});

test('R-15: an assumption of another kind (the manifest extensions block) only warns at the claim', async () => {
  const t = setup([row('A-3', 'The connector manifest accepts an extensions block', 'platform', 'vault-0n9-3#1', 'assumed', '', 'DM')]);
  const g = await t.claim('ex-vault-0n9-3');
  assert.equal(g.deny, null);
  assert.ok(g.warnings.some((w) => w.kind === 'assumption-unobserved' && w.rule === 'R-15' && /A-3 \(platform\)/.test(w.detail)));
});

test('R-16/R-15 replay: R1 shows a local path; the assumption is refuted; the intake stops and its area pauses until the design changes and ready is re-recorded', async () => {
  const t = setup([A8()]);
  // a builder cannot probe an external host from its own machine; the Reality Checker probes the real app
  const cap = t.capture('r1-1409.txt', 'tool input: {"file": "C:\\\\fakepath\\\\collection.csv"} (a local Windows path, no https link)');
  t.bd.beads.get('ex-vault-spike-a-8').assignee = 'dev@pc/builder';
  assert.match(t.run('builder', ['probe', 'ex-vault-spike-a-8', '--host', 'localhost', '--observed', 'x', '--artifact', cap]).out, /Reality Checker probes it in the real host/);
  const p = t.run('reality-checker', ['probe', 'ex-vault-spike-a-8', '--host', 'chatgpt.com plain chat', '--observed', 'the tool got a local Windows path, not an https link', '--artifact', cap]);
  assert.equal(p.code, 0, p.out);
  const r = t.run('product-manager', ['refute', 'A-8', '--evidence', p.row.id]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /andon on ex-vault-0n9-3/);
  assert.equal(A.loadRegister(t.root, 'vault').rows[0].status, 'refuted');
  assert.ok(W.list(t.root).some((w) => w.kind === 'assumption-refuted' && w.bead === 'ex-vault-0n9-3'), 'the Delivery Manager sees it in the ledger');
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /D4: criterion 1, 2 rests on A-8, refuted by ev-ex-vault-spike-a-8-1/);
  assert.deepEqual(reasonProblems(g.deny), []);
  // the area pauses: other work in collection waits, a fix goes on
  assert.match((await t.claim('ex-vault-0n9-4')).deny, /area collection is paused: ex-vault-0n9-3 rests on refuted A-8/);
  t.bd.update('ex-vault-0n9-4', { addLabels: ['bug'] });
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null, 'a fix story goes on in a paused area');
  t.bd.update('ex-vault-0n9-4', { removeLabels: ['bug'] });
  // the design changes: the intake asks the player to paste the CSV, resting on an internal choice
  fs.writeFileSync(A.fileOf(t.root, 'vault'), register(row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-9', 'refuted', p.row.id),
    row('A-10', 'Players paste a CSV of up to 5,000 lines in one message', 'internal', 'vault-0n9-3#1')));
  assert.equal((await t.claim('ex-vault-0n9-4')).deny, null, 'the area resumes once no story rests on the refuted assumption');
  const rr = await ready(['ex-vault-0n9-3', '--record'], { bd: t.bd, who: t.who('delivery-lead') });
  assert.equal(rr.code, 0, rr.out);
  assert.deepEqual(t.bd.show('ex-vault-0n9-3').metadata.ready_assumptions, ['A-10']);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
});

test('D4 andon: a story made ready on an assumption that is refuted later stays held until ready is re-recorded on the new design', async () => {
  const t = setup([row('A-1', 'The loader can refresh the token every 10 s', 'internal', 'vault-0n9-3#1', 'assumed', '', 'DM')]);
  const dm = t.who('delivery-lead');
  assert.equal((await ready(['ex-vault-0n9-3', '--record'], { bd: t.bd, who: dm })).code, 0);
  assert.deepEqual(t.bd.show('ex-vault-0n9-3').metadata.ready_assumptions, ['A-1']);
  // refuted; then the register drops the link, but ready was recorded on it
  fs.writeFileSync(A.fileOf(t.root, 'vault'), register(row('A-1', 'The loader can refresh the token every 10 s', 'internal', 'vault-0n9-9', 'refuted', 'ev-ex-vault-spike-1-1', 'DM')));
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /ready was recorded on A-1, since refuted/);
  assert.match((await t.claim('ex-vault-0n9-4')).deny, /area collection is paused/);
  assert.equal((await ready(['ex-vault-0n9-3', '--record'], { bd: t.bd, who: dm })).code, 0);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
});

test('R-16 replay: an observed result waits for the decision owner; acknowledging it unlocks the story', async () => {
  const t = setup([A8()]);
  const cap = t.capture('probe.txt', 'tool input: {"file": "https://files.oaiusercontent.com/..."}');
  const p = t.run('reality-checker', ['probe', 'ex-vault-spike-a-8', '--host', 'chatgpt.com plain chat', '--observed', 'an https download link', '--artifact', cap]);
  assert.equal(t.run('reality-checker', ['observe', 'A-8', '--evidence', p.row.id]).code, 1, 'the Reality Checker records, it does not settle');
  assert.equal(t.run('spike-researcher', ['observe', 'A-8', '--evidence', p.row.id]).code, 0);
  const g = await t.claim('ex-vault-0n9-3');
  assert.match(g.deny, /D4: spike ex-vault-spike-a-8 for A-8 has no acknowledgement from its decision owner \(PM\)/);
  assert.match(g.deny, /cannot start, spike ex-vault-spike-a-8 needs its decision owner's acknowledgement/);
  assert.equal(t.run('builder', ['ack', 'ex-vault-spike-a-8', '--decision', 'build the download intake']).code, 1);
  const k = t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--decision', 'build the download intake']);
  assert.equal(k.code, 0, k.out);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
});

test('R-16: a spike that decides scope is acknowledged only on the owner\'s record, re-verified at the claim', async () => {
  const t = setup([row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3', 'assumed', '', 'owner')], { arch: '' });
  assert.equal(t.bd.show('ex-vault-spike-a-8').metadata.decision_owner, 'owner');
  const p = t.run('reality-checker', ['probe', 'ex-vault-spike-a-8', '--host', 'chatgpt.com', '--observed', 'an https link', '--artifact', t.capture('a.txt', 'x')]);
  assert.equal(t.run('product-manager', ['observe', 'A-8', '--evidence', p.row.id]).code, 0);
  assert.match(t.run('delivery-lead', ['ack', 'ex-vault-spike-a-8', '--decision', 'cut the intake']).out, /cite the owner's record/);
  assert.match(t.run('delivery-lead', ['ack', 'ex-vault-spike-a-8', '--decision', 'cut the intake', '--record', 'dec-x-1']).out, /dec-x-1 does not verify/);
  assert.equal(t.run('delivery-lead', ['ack', 'ex-vault-spike-a-8', '--decision', 'cut the intake', '--record', 'dec-chief-of-staff-30']).code, 0);
  assert.equal((await t.claim('ex-vault-0n9-3')).deny, null);
  // the owner's record no longer verifies (revoked): the acknowledgement no longer counts
  assert.match((await t.claim('ex-vault-0n9-3', { verifyRecord: ownerVerify() })).deny, /no acknowledgement from its decision owner \(owner\)/);
});

test('R-16 replay: "prove before building" overruled: the probe cancelled, the spike cannot close without a result and an acknowledgement', async () => {
  const t = setup([A8()]);
  const close = () => gateChecks({ command: 'bd close ex-vault-spike-a-8 --reason "cancelled: build on the docs"', roleId: 'delivery-lead', actor: 'dm@pc/delivery-lead', instance: 'delivery-lead', bd: t.bd, root: t.root, team: t.team, verifyRecord: ownerVerify() });
  let g = await close();
  assert.match(g.deny, /Close of ex-vault-spike-a-8 refused \(D4\): it has no result row, and it answers A-8, an external host/);
  assert.deepEqual(reasonProblems(g.deny), []);
  const p = t.run('reality-checker', ['probe', 'ex-vault-spike-a-8', '--host', 'chatgpt.com', '--observed', 'a local path', '--artifact', t.capture('b.txt', 'x')]);
  assert.match((await close()).deny, /its decision owner has not acknowledged the result/);
  t.run('product-manager', ['ack', 'ex-vault-spike-a-8', '--decision', 'change the design to paste-in']);
  g = await close();
  assert.equal(g.deny, null);
  assert.ok(p.row);
  // a spike claimed without its decision fields is a warning
  t.bd.beads.set('ex-vault-spike-9', { id: 'ex-vault-spike-9', title: 'Spike 9', status: 'open', labels: ['spike'], metadata: { question: 'q' } });
  assert.ok((await t.claim('ex-vault-spike-9')).warnings.some((w) => w.kind === 'spike-fields' && /decision, decision rule/.test(w.detail)));
});

test('R-18 replay: #478\'s twin built from the docs is not evidence; a twin from a recording is', async () => {
  const t = setup([A8()]);
  t.bd.beads.get('ex-vault-spike-a-8').assignee = 'dev@pc/builder';
  const docs = path.join(t.root, 'scratch-twin-docs.json');
  fs.writeFileSync(docs, JSON.stringify({ note: 'written from the Apps SDK docs', exchanges: [{ request: { file: 'https://example' }, response: { ok: true } }] }));
  const tests = t.capture('twin-tests.txt', '14 passing');
  const p = t.run('builder', ['probe', 'ex-vault-spike-a-8', '--host', 'twin', '--observed', 'the twin passes an https link', '--artifact', tests, '--twin', docs]);
  assert.equal(p.code, 0);
  assert.match(p.out, /does not count: the recording names no source/);
  assert.ok(W.list(t.root).some((w) => w.kind === 'twin-unrecorded' && w.rule === 'R-18'));
  const o = t.run('builder', ['observe', 'A-8', '--evidence', p.row.id]);
  assert.equal(o.code, 1);
  assert.match(o.out, /an assumption, not evidence \(R-18\)/);
  assert.match((await t.claim('ex-vault-0n9-3')).deny, /not yet observed in the real host/);
  // a twin rebuilt from a recording of the real app counts
  const rec = path.join(t.root, 'recorded.json');
  fs.writeFileSync(rec, JSON.stringify({ source: 'chatgpt.com plain chat', recorded_at: '2026-10-12T14:09:00Z', exchanges: [{ request: { tool: 'import' }, response: { file: 'https://files.example/x.csv' } }] }));
  const q = t.run('builder', ['probe', 'ex-vault-spike-a-8', '--host', 'twin', '--observed', 'an https link', '--artifact', t.capture('c.txt', 'x'), '--twin', rec]);
  assert.equal(t.run('builder', ['observe', 'A-8', '--evidence', q.row.id]).code, 0);
  // a row read off the documentation by hand is not an observation
  assert.equal(A.observationProblem({ id: 'ev-x-1', type: 'row', by: 'delivery-lead', via: null }, { id: 'A-8', kind: 'external-host' }), 'ev-x-1 is not an observation in the real host (a probe row, or a Reality Checker\'s run)');
});

test('register parsing: criteria lists, malformed rows as problems, HAR recordings', () => {
  assert.deepEqual(A.criteriaOf('s-1#1 s-1#3, s-2'), [{ story: 's-1', ns: [1, 3] }, { story: 's-2', ns: [] }]);
  const reg = A.parseRegister(register(row('B-1', 'x', 'vibes', '', 'observed')));
  assert.deepEqual(reg.problems.length, 4);
  const har = path.join(makeProject(), 'h.har');
  fs.writeFileSync(har, JSON.stringify({ log: { entries: [{ startedDateTime: '2026-10-12T14:09:00Z', request: { url: 'https://chatgpt.com/x' }, response: { status: 200 } }] } }));
  assert.equal(A.recordingProblem(har), null);
  // a builder's probe on its own machine settles an internal choice, never an external host
  const local = { id: 'ev-s-1', type: 'probe', assumption: 'A-8', by: 'builder', via: 'host', counts: true };
  assert.match(A.observationProblem(local, { id: 'A-8', kind: 'external-host' }), /a local probe: an external host is observed by the Reality Checker/);
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
});
