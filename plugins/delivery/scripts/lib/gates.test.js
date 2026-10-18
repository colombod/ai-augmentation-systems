// scripts/lib/gates.test.js — the ready and done gates, the surface schema and the warnings ledger,
// replayed on Vault moments. Pure: no bd, no judge (the judge's answer is passed in).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const G = require('./gates.js');
const W = require('./warnings.js');
const { validateSurface } = require('./surface.js');
const { SURFACES, STORY, storyBead } = require('../testing/gate-fixture.js');

const S1 = SURFACES.surfaces[0];
const story = G.parseStory(STORY);
const [C1, C2] = story.criteria;
const codes = (f, level) => f.filter((x) => !level || x.level === level).map((x) => x.code);
const TUPLE = { host: S1.host, app: S1.app, mode: S1.mode, install_artifact: S1.install_artifact };
const row = (over = {}) => {
  const c = Number(over.criterion || 1) === 2 ? C2 : C1;
  return { type: 'row', id: 'ev-x-1', criterion: c.n, criterion_hash: G.criterionHash(c), result: 'pass', surface: 'S1', tuple: TUPLE, sha: 'd478aa11', by: 'reality-checker', via: 'reality-check', actor: 'rc@pc/reality-checker', arm: 'main', at: '2026-10-13T09:00:00Z', ...over };
};
const deployed = (over = {}) => storyBead({ ...over, metadata: { ready_hash: G.storyHash(story), deployed_sha: 'd478aa11', deployed_at: '2026-10-13T08:00:00Z', ...(over.metadata || {}) } });

test('ready: a story written to the template has no findings; the template placeholder is not a criterion', () => {
  assert.equal(story.criteria.length, 2);
  assert.equal(C1.probe.by, 'reality-check');
  assert.deepEqual(G.readyFindings({ story, surfaces: SURFACES.surfaces }), []);
  const template = G.parseStory(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'story.md'), 'utf8'));
  assert.equal(template.criteria.length, 0);
  assert.ok(codes(G.readyFindings({ story: template, surfaces: SURFACES.surfaces })).includes('placeholder'));
});

test('ready, vault-wxy.6: "gets a link" names a mechanism: a warning, never a block', () => {
  const wxy6 = G.parseStory(STORY.replace(/1\. A player in ChatGPT[^\n]*/, '1. The player gets a link to the deck.'));
  const f = G.readyFindings({ story: wxy6, surfaces: SURFACES.surfaces });
  assert.deepEqual(codes(f), ['mechanism']);
  assert.equal(f[0].level, 'warn');
  assert.match(f[0].detail, /criterion 1 names a mechanism \(link\); say what the customer sees on ChatGPT web/);
});

test('ready, vault-0n9.3 before R-19: no measurement plan, no probe, no owner quote, no shippable unit: warnings only, one per criterion', () => {
  const bare = G.parseStory(STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, '').replace(/   - Probe:[^\n]*\n/g, '').replace(/> "drop[^\n]*/, '').replace(/## Shippable unit[\s\S]*$/, ''));
  const f = G.readyFindings({ story: bare, surfaces: SURFACES.surfaces });
  assert.deepEqual(codes(f, 'block'), []);
  assert.deepEqual(codes(f).sort(), ['measurement-plan', 'owners-ask', 'probe', 'probe', 'shippable-unit']);
  assert.deepEqual(f.filter((x) => x.code === 'probe').map((x) => x.detail.slice(0, 11)), ['criterion 1', 'criterion 2']);
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

test('D1: the agreed scope hash covers criteria and requirements, ignores whitespace, and catches deleted criteria', () => {
  const hash = G.storyHash(story);
  assert.equal(G.storyHash(G.parseStory(STORY.replace('drops a collection CSV', 'drops  a collection\tCSV'))), hash);
  assert.notEqual(G.storyHash(G.parseStory(STORY.replace('size: M', 'size: M\nrequirements: [FR-1]'))), hash);
  const bead = storyBead({ metadata: { ready_hash: hash } });
  assert.equal(G.scopeDrift(story, bead), null);
  assert.equal(G.scopeDrift(G.parseStory(STORY.replace(/## Acceptance criteria[\s\S]*?(?=## Measurement)/, '')), bead).rule, 'D1');
  assert.equal(G.scopeDrift(null, bead).rule, 'D1', 'a repointed or missing story file is drift');
  assert.equal(G.scopeDrift(story, storyBead()), null, 'never made ready: nothing to compare');
});

test('claim: D1 on changed criteria and on a child naming a criterion its story lacks; not-ready only warns', () => {
  const hash = G.storyHash(story);
  assert.deepEqual(G.claimDivergence({ story, bead: storyBead({ metadata: { ready_hash: hash } }) }), []);
  assert.deepEqual(codes(G.claimDivergence({ story, bead: storyBead() })), ['not-ready']);
  const weakened = G.parseStory(STORY.replace('sees the import summary with the card count', 'sees a reply'));
  assert.deepEqual(codes(G.claimDivergence({ story: weakened, bead: storyBead({ metadata: { ready_hash: hash } }) }), 'block'), ['criteria-changed']);
  const parent = storyBead();
  const child = (criterion) => ({ id: 'c', labels: [], parent: parent.id, metadata: criterion === undefined ? {} : { criterion } });
  assert.deepEqual(codes(G.claimDivergence({ bead: child('02'), parent, parentStory: story })), []);
  assert.deepEqual(codes(G.claimDivergence({ bead: child(5), parent, parentStory: story }), 'block'), ['child-scope']);
  assert.deepEqual(codes(G.claimDivergence({ bead: child(), parent, parentStory: story }), 'warn'), ['child-scope']);
});

test('unverified cap, R-12 (10-13: #469-#471 merged, unverified): a warning on claim, never a refusal; closed stories count by their labels', () => {
  const merged = ['469', '470', '471'].map((n) => storyBead({ id: `ex-${n}`, labels: ['story', G.STATE.merged], status: n === '469' ? 'closed' : 'open' }));
  const wxy2 = storyBead({ id: 'ex-vault-wxy-2' });
  const over = G.unverifiedOver([...merged, wxy2], wxy2, 2);
  assert.deepEqual([over.count, over.cap], [3, 2]);
  assert.deepEqual(G.claimDivergence({ bead: wxy2, overCap: over }).map((x) => [x.code, x.level]), [['unverified-cap', 'warn']]);
  assert.deepEqual(codes(G.claimDivergence({ bead: { ...wxy2, labels: ['story', 'bug'] }, overCap: over })), []);
  const counts = G.stateCounts([...merged, storyBead({ id: 'v', status: 'closed', labels: ['story', G.STATE.verified] })], 2);
  assert.deepEqual([counts.merged, counts.verified, counts.overCap.length], [3, 1, 1]);
});

test('done, #478: no pass row refuses; the author or another session of the author\'s role, another surface id or mode, sha, wording or a fail do not count', () => {
  const bead = deployed({ metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] }, assignee: '' });
  const check = (rows) => G.doneCheck({ story, bead, rows, surface: S1 });
  assert.deepEqual(check([]).criteria.map((c) => c.why), ['no pass row', 'no pass row']);
  const why = (over) => check([row(over)]).criteria[0].why;
  assert.match(why({ by: 'builder', actor: 'dev@pc/builder-1' }), /recorded by the author/);
  assert.match(why({ by: 'builder', actor: 'dev2@pc/builder-2' }), /recorded by the author \(builder\)/, 'builder-2 shares the author role');
  assert.match(why({ surface: 'S2' }), /ran on S2 \(ChatGPT web, plain chat\), not S1/);
  assert.match(why({ tuple: { ...TUPLE, mode: 'codex' } }), /\(ChatGPT web, codex\), not S1/);
  assert.match(why({ sha: 'e0e0e0e0' }), /not the deployed d478aa11/);
  assert.match(why({ result: 'fail' }), /is a fail/);
  assert.match(why({ criterion_hash: 'old' }), /another wording of criterion 1/);
  assert.match(why({ at: '2026-10-13T07:00:00Z' }), /recorded before the deploy/);
  assert.equal(check([row({ sha: 'D478AA1' }), row({ id: 'ev-x-2', criterion: 2 })]).ok, true, 'a 7-character prefix in another case matches');
  assert.equal(check([row({ sha: 'd478' }), row({ id: 'ev-x-2', criterion: 2 })]).ok, false, 'a 4-character prefix does not');
  assert.match(G.doneCheck({ story, bead: storyBead(), rows: [row()], surface: S1 }).criteria[0].why, /no deployed sha/);
});

test('done: with no declared surface rows count unchecked; a waiver counts only before the deploy; a cut closes', () => {
  const bead = deployed();
  const rows = [row({ tuple: null }), row({ id: 'ev-x-2', criterion: 2, tuple: null })];
  assert.equal(G.doneCheck({ story, bead, rows, surface: null }).ok, false);
  assert.deepEqual(G.doneCheck({ story, bead, rows, surface: null, noSurface: true }), { ok: true, criteria: [{ n: 1, row: 'ev-x-1' }, { n: 2, row: 'ev-x-2' }], noSurface: true });
  const waiver = (at) => ({ type: 'waiver', id: 'ev-x-9', criterion: 2, criterion_hash: G.criterionHash(C2), at });
  assert.equal(G.doneCheck({ story, bead, rows: [row(), waiver('2026-10-12T08:00:00Z')], surface: S1 }).ok, true);
  assert.equal(G.doneCheck({ story, bead, rows: [row(), waiver('2026-10-14T08:00:00Z')], surface: S1 }).ok, false);
  assert.deepEqual(G.doneCheck({ story, bead, rows: [{ type: 'cut', id: 'ev-x-3' }], surface: S1 }), { ok: true, cut: 'ev-x-3', criteria: [] });
});

test('evidence file: rows are hash-chained; an edited or deleted line is detected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-'));
  for (const n of [1, 2, 2]) G.appendEvidence(root, 'b', row({ criterion: n }));
  assert.equal(G.readEvidenceChecked(root, 'b').problem, null);
  const file = G.evidenceFile(root, 'b');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, `${lines[0]}\n${lines[2]}\n`);
  assert.match(G.readEvidenceChecked(root, 'b').problem, /breaks the chain/);
  fs.writeFileSync(file, `${lines[0].replace('d478aa11', 'cafe1234')}\n${lines[1]}\n`);
  assert.match(G.readEvidenceChecked(root, 'b').problem, /breaks the chain/);
});

test('surface.json: the tuple, scriptable and numeric budgets are required; budgets and owner record missing are warnings', () => {
  assert.deepEqual(validateSurface(SURFACES), { problems: [], warnings: [] });
  assert.match(validateSurface({ surfaces: [] }).problems[0], /non-empty list/);
  const bad = validateSurface({ surfaces: [{ id: 'S1', host: 'x', app: '', mode: 'm', install_artifact: 'z', scriptable: 'no', size_budgets: { n: 'many' } }, { id: 'S1', host: 'x', app: 'a', mode: 'm', install_artifact: 'z', scriptable: true }] });
  assert.equal(bad.problems.length, 4, bad.problems.join('\n'));
  assert.equal(bad.warnings.length, 2);
});

test('warnings ledger: unique ids, no repeat of an open finding, ack once, resolve, overdue after 24 h', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-'));
  const a = W.record(root, { kind: 'mechanism', rule: 'R-10', bead: 'ex-1', detail: 'criterion 1', instance: 'builder-1', now: '2026-10-11T08:01:00Z' });
  assert.match(a.id, /^w-builder-1-[a-z0-9]+$/);
  assert.equal(W.record(root, { kind: 'mechanism', bead: 'ex-1', detail: 'criterion 1', instance: 'builder-1' }).id, a.id, 'an open finding is not repeated');
  assert.notEqual(W.record(root, { kind: 'mechanism', bead: 'ex-1', detail: 'criterion 2', instance: 'builder-1', now: '2026-10-12T08:30:00Z' }).id, a.id, 'another criterion keeps its own detail');
  W.record(root, { kind: 'probe', bead: 'ex-2', instance: 'builder-2', now: '2026-10-12T07:00:00Z' });
  assert.equal(W.summary(W.list(root), '2026-10-12T09:00:00Z').overdue.map((w) => w.id).join(), a.id);
  assert.equal(W.ack(root, { id: a.id, by: 'delivery-lead', instance: 'delivery-lead' }).ok, false, 'a reason is required');
  assert.equal(W.ack(root, { id: a.id, reason: 'reworded', by: 'delivery-lead', instance: 'delivery-lead' }).ok, true);
  assert.match(W.ack(root, { id: a.id, reason: 'again', by: 'delivery-lead', instance: 'delivery-lead' }).error, /was acknowledged/);
  assert.equal(W.resolve(root, { bead: 'ex-1', kinds: ['mechanism'], still: [], by: 'delivery-lead', instance: 'delivery-lead', reason: 'fixed' }).length, 1);
  assert.equal(W.summary(W.list(root)).open, 1);
  assert.match(W.instanceOf(undefined), /^local-[0-9a-f]{8}$/, 'a session with no role writes a per-host file');
});

test('warnings ledger under parallel hooks: every id distinct, one row for one finding', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-par-'));
  const lib = path.join(__dirname, 'warnings.js');
  const run = (detail) => new Promise((resolve) => spawn(process.execPath, ['-e', `require(${JSON.stringify(lib)}).record(${JSON.stringify(root)}, { kind: 'k', bead: 'b', detail: ${JSON.stringify(detail)}, instance: 'builder-1' })`]).on('exit', resolve));
  await Promise.all([...Array.from({ length: 8 }, (x, i) => run(`d${i}`)), ...Array.from({ length: 6 }, () => run('same'))]);
  const all = W.list(root);
  assert.equal(new Set(all.map((w) => w.id)).size, all.length);
  assert.equal(all.filter((w) => w.detail === 'same').length, 1);
  assert.equal(all.length, 9);
});

test('criteria: an indented continuation line is part of the criterion and its hash; the probe stays apart', () => {
  const wrapped = G.parseStory(STORY.replace('sees the import summary with the card count.', 'sees the import summary\n   with the card count.'));
  assert.equal(wrapped.criteria[0].text, C1.text.replace('summary with', 'summary with'));
  assert.equal(wrapped.criteria[0].probe.by, 'reality-check');
  const reworded = G.parseStory(STORY.replace('sees the import summary with the card count.', 'sees the import summary\n   with nothing.'));
  assert.notEqual(G.criterionHash(reworded.criteria[0]), G.criterionHash(wrapped.criteria[0]));
  assert.notEqual(G.storyHash(reworded), G.storyHash(story));
});

test('evidence file under parallel writers: one chain, every seq once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-par-'));
  const lib = path.join(__dirname, 'gates.js');
  const run = (n) => new Promise((resolve) => spawn(process.execPath, ['-e', `require(${JSON.stringify(lib)}).appendEvidence(${JSON.stringify(root)}, 'b', { type: 'row', criterion: 1, n: ${n} })`]).on('exit', resolve));
  await Promise.all(Array.from({ length: 10 }, (x, i) => run(i)));
  const c = G.readEvidenceChecked(root, 'b');
  assert.equal(c.problem, null);
  assert.equal(c.rows.length, 10);
});
