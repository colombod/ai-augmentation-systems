// scripts/lib/budget.test.js — R-34 and R-42: the budget exists only on the owner's Yes; estimates
// from size and model with the reserve; the levels the gates and selection read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('./budget.js');
const Goal = require('./goal.js');
const { goalProject, ownerSets } = require('../testing/goal-fixture.js');

const story = (id, { labels = [], metadata = {}, ...rest } = {}) => ({ id, status: 'open', ...rest, labels: ['story', ...labels], metadata: { story_file: `${id}.md`, ...metadata } });
const unitsOf = (n, t = B.table(null)) => n * t.unitTokens;

test('R-42: no owner-set budget, no budget: a figure written by hand is ignored and every check only warns', () => {
  const t = goalProject();
  assert.equal(B.state(t.root, { usedTokens: 0 }).set, false);
  fs.writeFileSync(path.join(t.root, '.delivery', 'goal.json'), JSON.stringify({ fields: { 'budget.weekly_units': { value: 100, by: 'chief-of-staff', at: '2026-10-17T21:13:00Z' } }, history: [] }));
  const st = B.state(t.root, { usedTokens: unitsOf(99) });
  assert.equal(st.set, false);
  assert.match(st.note, /only warn/);
});

test('R-34: on the owner\'s weekly units, remaining is what the transcripts leave, with in-flight work and its reserve set aside', () => {
  const t = goalProject();
  for (const [f, v] of [['budget.weekly_units', 100], ['budget.lean_at', 70]]) assert.equal(ownerSets(t, f, v).ok, true, f);
  const beads = [
    story('wxy-12', { status: 'in_progress', labels: ['size-M'] }), // 3 units + 30%
    story('0n9-3', { status: 'closed', labels: ['size-L', 'state-merged'] }), // merged: only the reserve, 8 x 0.3
    story('wxy-2', { labels: ['size-S', 'state-verified'] }),
  ];
  const plenty = B.state(t.root, { beads, usedTokens: unitsOf(40), snapshot: null });
  assert.deepEqual([plenty.set, plenty.total, Math.round(plenty.remaining), plenty.half, plenty.lean, plenty.nearLimit], [true, 100, 60, false, false, false]);
  // size-L is dispatched on the large model, opus by default: 8 x 1.7 x 0.3 once merged
  assert.equal(Math.round(plenty.inflightNeed * 100) / 100, 3.9 + 4.08);
  assert.equal(plenty.level, 'more than half left');
  // 10-12 23:00, about 85% of the week used: lean, and half or less left
  const late = B.state(t.root, { beads, usedTokens: unitsOf(85), snapshot: null });
  assert.deepEqual([late.half, late.lean, late.nearLimit, late.level], [true, true, false, 'lean']);
  // 97%: once in-flight work is paid for, not even a small story fits
  const limit = B.state(t.root, { beads, usedTokens: unitsOf(97), snapshot: null });
  assert.deepEqual([limit.nearLimit, limit.level], [true, 'near the limit']);
  // the status line's weekly reading binds when it leaves less room than the transcripts say
  const snap = B.state(t.root, { beads, usedTokens: unitsOf(10), snapshot: { usedPct: 92, periodStart: '2026-10-06T12:00:00Z' } });
  assert.equal(Math.round(snap.remaining), 8);
  assert.match(snap.source, /status line/);
});

test('R-34 estimates: size and model with the seed table; the owner overrides an entry through its goal field', () => {
  const team = { roles: [{ id: 'builder', model: 'sonnet' }] };
  assert.deepEqual(B.estimate(story('a', { labels: ['size-L'], metadata: { model: 'opus' } }), { team }), { units: 8 * 1.7, hours: 16, size: 'L', model: 'opus', unsized: false });
  assert.equal(B.estimate(story('b'), { team }).unsized, true, 'no size label: estimated as M and said so');
  assert.equal(B.estimate(story('c', { labels: ['size-S'] }), { team: { roles: [{ id: 'builder', model: 'haiku' }] } }).units, 0.35);
  const t = goalProject();
  assert.equal(ownerSets(t, 'budget.estimate_s', 2).ok, true);
  assert.equal(ownerSets(t, 'budget.reserve', 40).ok, true);
  const tab = B.table(t.root);
  assert.deepEqual([tab.units.S, tab.units.M, tab.reserve, tab.overridden], [2, 3, 0.4, ['estimate_s', 'reserve']]);
  assert.equal(Goal.questionText('budget.estimate_l', '10'), 'Estimate a large story at 10 units?');
});
