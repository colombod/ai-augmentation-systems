// scripts/lib/gates.test.js — the ready and done gates, the surface schema and the warnings ledger,
// replayed on Vault moments. Pure: no bd, no judge (the judge's answer is passed in).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./gates.js');
const W = require('./warnings.js');
const { validateSurface } = require('./surface.js');
const { SURFACES, STORY, storyBead } = require('../testing/gate-fixture.js');

const S1 = SURFACES.surfaces[0];
const story = G.parseStory(STORY);
const codes = (f, level) => f.filter((x) => !level || x.level === level).map((x) => x.code);
const row = (over) => ({ type: 'row', id: 'ev-x-1', criterion: 1, result: 'pass', surface: 'S1', tuple: { host: S1.host, app: S1.app, mode: S1.mode, install_artifact: S1.install_artifact }, sha: 'd478', by: 'delivery-lead', actor: 'lead@pc/delivery-lead', arm: 'main', ...over });

test('ready: a story written to the template has no findings', () => {
  assert.equal(story.criteria.length, 2);
  assert.equal(story.criteria[0].probe.by, 'reality-check');
  assert.deepEqual(G.readyFindings({ story, surfaces: SURFACES.surfaces }), []);
});

test('ready, vault-wxy.6: "gets a link" names a mechanism: a warning, never a block', () => {
  const wxy6 = G.parseStory(STORY.replace(/1\. A player in ChatGPT[^\n]*/, '1. The player gets a link to the deck.'));
  const f = G.readyFindings({ story: wxy6, surfaces: SURFACES.surfaces });
  assert.deepEqual(codes(f), ['mechanism']);
  assert.equal(f[0].level, 'warn');
  assert.match(f[0].detail, /criterion 1 names a mechanism \(link\); say what the customer sees on ChatGPT web/);
});

test('ready, vault-0n9.3 before R-19: no measurement plan, no probe, no owner quote, no shippable unit: warnings only', () => {
  const bare = G.parseStory(STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, '').replace(/   - Probe:[^\n]*\n/g, '').replace(/> "drop[^\n]*/, '').replace(/## Shippable unit[\s\S]*$/, ''));
  const f = G.readyFindings({ story: bare, surfaces: SURFACES.surfaces });
  assert.deepEqual(codes(f, 'block'), []);
  assert.deepEqual(codes(f).sort(), ['measurement-plan', 'owners-ask', 'probe', 'probe', 'shippable-unit']);
  // a plan whose threshold is not a number does not count
  const vague = G.parseStory(STORY.replace('1 of 1 runs receives the file', 'it works'));
  assert.deepEqual(codes(G.readyFindings({ story: vague, surfaces: SURFACES.surfaces })), ['measurement-plan']);
});

test('ready: a test probe on a surface that is not scriptable needs a reality check; an undeclared surface is D2', () => {
  const t = G.parseStory(STORY.replace('where: S1; by: reality-check', 'where: S1; by: test'));
  assert.deepEqual(codes(G.readyFindings({ story: t, surfaces: SURFACES.surfaces })), ['reality-check-required']);
  const s9 = G.parseStory(STORY.replace('surface: S1', 'surface: S9'));
  assert.deepEqual(codes(G.readyFindings({ story: s9, surfaces: SURFACES.surfaces }), 'block'), ['surface-unknown']);
  assert.deepEqual(codes(G.readyFindings({ story, surfaces: [], surfaceMissing: true })), ['surface-missing']);
});

test('ready: the judge\'s shippable_unit "partial" or "no" is a warning; skipped or "yes" adds nothing', () => {
  const f = (judged) => codes(G.readyFindings({ story, surfaces: SURFACES.surfaces, judged }));
  assert.deepEqual(f({ answer: 'partial', confidence: 0.9 }), ['shippable-judge']);
  assert.deepEqual(f({ answer: 'yes', confidence: 0.9 }), []);
  assert.deepEqual(f({ skipped: true, reason: 'judge_off' }), []);
  assert.deepEqual(Object.keys(G.shippableState(story, S1)), ['story', 'customer_surface', 'description']);
});

test('claim: criteria changed since ready is D1; a child naming a criterion its story lacks is D1; none recorded is a warning', () => {
  const hash = G.criteriaHash(story.criteria);
  assert.deepEqual(G.claimDivergence({ story, bead: storyBead({ metadata: { ready_hash: hash } }) }), []);
  assert.deepEqual(codes(G.claimDivergence({ story, bead: storyBead() })), ['not-ready']);
  const weakened = G.parseStory(STORY.replace('sees the import summary with the card count', 'sees a reply'));
  assert.deepEqual(codes(G.claimDivergence({ story: weakened, bead: storyBead({ metadata: { ready_hash: hash } }) }), 'block'), ['criteria-changed']);
  const parent = storyBead();
  const child = (criterion) => ({ id: 'c', labels: [], parent: parent.id, metadata: criterion === undefined ? {} : { criterion } });
  assert.deepEqual(codes(G.claimDivergence({ bead: child(2), parent, parentStory: story })), []);
  assert.deepEqual(codes(G.claimDivergence({ bead: child(5), parent, parentStory: story }), 'block'), ['child-scope']);
  assert.deepEqual(codes(G.claimDivergence({ bead: child(), parent, parentStory: story }), 'warn'), ['child-scope']);
});

test('unverified cap, 10-13: #469, #470, #471 and #478 merged and unverified; a new story in the area is D5, a fix is not', () => {
  const merged = ['469', '470', '471', '478'].map((n) => storyBead({ id: `ex-${n}`, labels: ['story', n === '478' ? G.STATE.deployed : G.STATE.merged] }));
  const wxy2 = storyBead({ id: 'ex-vault-wxy-2' });
  const over = G.unverifiedOver([...merged, wxy2], wxy2, 2);
  assert.deepEqual([over.count, over.cap], [4, 2]);
  assert.deepEqual(codes(G.claimDivergence({ bead: wxy2, overCap: over }), 'block'), ['unverified-cap']);
  assert.deepEqual(codes(G.claimDivergence({ bead: { ...wxy2, labels: ['story', 'bug'] }, overCap: over })), []);
  assert.equal(G.unverifiedOver([...merged, wxy2], storyBead({ id: 'z', metadata: { area: 'billing' } }), 2), null);
  const counts = G.stateCounts([...merged, storyBead({ id: 'v', labels: ['story', G.STATE.verified] })], 2);
  assert.deepEqual([counts.merged, counts.deployed, counts.verified, counts.overCap.length], [3, 1, 1, 1]);
});

test('done, #478: no pass row on the declared surface refuses; the author, Codex mode, another sha or a fail do not count', () => {
  const bead = storyBead({ metadata: { deployed_sha: 'd478', deployed_at: '2026-10-13T08:00:00Z' } });
  const check = (rows) => G.doneCheck({ story, bead, rows, surface: S1 });
  const none = check([]);
  assert.equal(none.ok, false);
  assert.deepEqual(none.criteria.map((c) => c.why), ['no pass row', 'no pass row']);
  assert.match(check([row({ by: 'builder', actor: 'dev@pc/builder-1' })]).criteria[0].why, /recorded by the author/);
  assert.match(check([row({ surface: 'S2', tuple: { ...row().tuple, mode: 'codex' } })]).criteria[0].why, /ran on S2 \(ChatGPT web, codex\), not S1/);
  assert.match(check([row({ tuple: { ...row().tuple, mode: 'codex' } })]).criteria[0].why, /not S1/);
  assert.match(check([row({ sha: 'e0' })]).criteria[0].why, /not the deployed d478/);
  assert.match(check([row({ result: 'fail' })]).criteria[0].why, /is a fail/);
  assert.equal(check([row(), row({ id: 'ev-x-2', criterion: 2 })]).ok, true);
  assert.match(G.doneCheck({ story, bead: storyBead(), rows: [row()], surface: S1 }).criteria[0].why, /no deployed sha/);
  assert.deepEqual(G.doneCheck({ story: G.parseStory('# no criteria'), bead, rows: [], surface: S1 }), { ok: true, migrate: true, criteria: [] });
});

test('done: a waiver counts only when recorded before the deploy (D3b)', () => {
  const bead = storyBead({ metadata: { deployed_sha: 'd478', deployed_at: '2026-10-13T08:00:00Z' } });
  const waiver = (at) => ({ type: 'waiver', id: 'ev-x-9', criterion: 2, at });
  assert.equal(G.doneCheck({ story, bead, rows: [row(), waiver('2026-10-12T08:00:00Z')], surface: S1 }).ok, true);
  assert.equal(G.doneCheck({ story, bead, rows: [row(), waiver('2026-10-14T08:00:00Z')], surface: S1 }).ok, false);
});

test('surface.json: the tuple, scriptable and numeric budgets are required; budgets and owner record missing are warnings', () => {
  assert.deepEqual(validateSurface(SURFACES), { problems: [], warnings: [] });
  assert.match(validateSurface({ surfaces: [] }).problems[0], /non-empty list/);
  const bad = validateSurface({ surfaces: [{ id: 'S1', host: 'x', app: '', mode: 'm', install_artifact: 'z', scriptable: 'no', size_budgets: { n: 'many' } }, { id: 'S1', host: 'x', app: 'a', mode: 'm', install_artifact: 'z', scriptable: true }] });
  assert.equal(bad.problems.length, 4, bad.problems.join('\n'));
  assert.equal(bad.warnings.length, 2);
});

test('warnings ledger: append-only rows per instance, no repeat while open, ack once, overdue after 24 h', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-'));
  const a = W.record(root, { kind: 'mechanism', rule: 'R-10', bead: 'ex-1', detail: 'gets a link', instance: 'builder-1', now: '2026-10-11T08:01:00Z' });
  assert.equal(a.id, 'w-builder-1-1');
  assert.equal(W.record(root, { kind: 'mechanism', bead: 'ex-1', instance: 'builder-1' }).id, a.id, 'an open warning is not repeated');
  W.record(root, { kind: 'probe', bead: 'ex-1', instance: 'builder-2', now: '2026-10-12T07:00:00Z' });
  assert.equal(W.summary(W.list(root), '2026-10-12T09:00:00Z').overdue.map((w) => w.id).join(), 'w-builder-1-1');
  assert.equal(W.ack(root, { id: a.id, by: 'delivery-lead', instance: 'delivery-lead' }).ok, false, 'a reason is required');
  assert.equal(W.ack(root, { id: a.id, reason: 'reworded', by: 'delivery-lead', instance: 'delivery-lead' }).ok, true);
  assert.match(W.ack(root, { id: a.id, reason: 'again', by: 'delivery-lead', instance: 'delivery-lead' }).error, /was acknowledged/);
  const s = W.summary(W.list(root), '2026-10-12T09:00:00Z');
  assert.deepEqual([s.open, s.acked, s.overdue.length], [1, 1, 0]);
  assert.deepEqual(fs.readdirSync(W.dirOf(root)).sort(), ['builder-1.ndjson', 'builder-2.ndjson', 'delivery-lead.ndjson']);
});
