// scripts/lib/plan-graph.test.js — run with: node --test scripts/lib/plan-graph.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGraph, denylistFrom } = require('./plan-graph.js');

const roadmap = { phases: [
  { number: '1', name: 'Foundations', done: false, items: [] },
  { number: '2', name: 'Beads', done: false, items: [] },
] };
const stories = [
  { id: 'ex-02', title: 'Second', status: 'ready', phase: '2', dependsOn: ['ex-01'], file: '/x/ex-02-second.md' },
  { id: 'ex-01', title: 'First', status: 'ready', phase: '1', dependsOn: [], file: '/x/ex-01-first.md' },
  { id: 'ex-99', title: 'Orphan', status: 'ready', phase: '9', dependsOn: [], file: '/x/ex-99.md' },
  { id: 'ex-03', title: 'Old', status: 'superseded', phase: '1', dependsOn: [], file: '/x/ex-03.md' },
];
const spikes = [
  { key: 'cos-1', question: 'Does env reach hooks?', timeBox: '1 day', blocks: 'Phase 1' },
  { key: '2', question: 'Is bd --id stable?', timeBox: '2h', blocks: 'ex-02' },
  { key: '3', question: 'Mystery', timeBox: '1h', blocks: 'the moon' },
];
const input = { prefix: 'ex', initiative: 'demo', sha: 'abc1234', roadmap, stories, spikes };

test('planGraph emits deterministic ids, parents, labels and metadata', () => {
  const g = planGraph(input);
  const ids = g.beads.map((b) => b.id);
  assert.deepEqual(ids, ['ex-ph1', 'ex-ph2', 'ex-ex-01', 'ex-spike-cos-1', 'ex-spike-3', 'ex-ph1-review', 'ex-ex-02', 'ex-spike-2', 'ex-ph2-review']);
  const epic = g.beads[0];
  assert.equal(epic.title, 'Phase 1: Foundations');
  assert.equal(epic.type, 'epic');
  assert.deepEqual(epic.labels, ['roadmap', 'phase-1']);
  assert.equal(epic.metadata.roadmap_ref, 'demo/roadmap.md@abc1234 phase 1');
  const story = g.beads.find((b) => b.id === 'ex-ex-01');
  assert.equal(story.parent, 'ex-ph1');
  assert.equal(story.metadata.story, 'ex-01');
  assert.equal(story.metadata.story_file, 'ex-01-first.md');
  const spike = g.beads.find((b) => b.id === 'ex-spike-2');
  assert.equal(spike.parent, 'ex-ph2');
  assert.equal(spike.title, 'Spike 2: Is bd --id stable?');
});

test('planGraph chains phases, reviews, stories and spikes', () => {
  const g = planGraph(input);
  const has = (id, blockedBy) => g.deps.some((d) => d.id === id && d.blockedBy === blockedBy);
  assert.ok(has('ex-ex-02', 'ex-ph1-review'));
  assert.ok(has('ex-spike-2', 'ex-ph1-review'));
  assert.ok(!g.deps.some((d) => d.id === 'ex-ph2'));
  assert.ok(has('ex-ph1-review', 'ex-ex-01'));
  assert.ok(has('ex-ph1-review', 'ex-spike-cos-1'));
  assert.ok(has('ex-ex-02', 'ex-ex-01'));
  assert.ok(has('ex-ex-02', 'ex-spike-2'));
  assert.ok(has('ex-ph2-review', 'ex-ex-02'));
  assert.ok(!g.deps.some((d) => d.blockedBy === 'ex-spike-3'));
});

test('planGraph warns on orphans and unmatched blocks, skips superseded', () => {
  const g = planGraph(input);
  assert.ok(g.warnings.some((w) => w.includes('story ex-99: phase 9 not in roadmap')));
  assert.ok(g.warnings.some((w) => w.includes('spike 3: blocks "the moon" matched nothing')));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-03'));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-99'));
});

test('planGraph is byte-identical on repeated runs', () => {
  assert.equal(JSON.stringify(planGraph(input)), JSON.stringify(planGraph(input)));
});

test('denylistFrom collects titles, names and headings, deduplicated', () => {
  const list = denylistFrom({
    initiative: 'demo', roadmap, stories, spikes,
    briefText: '# Brief: Vault for everyone\n\n## Who it is for\n\ntext\n',
    prdText: '# PRD\n\n## Scenario: Sell duplicates\n',
    personaNames: ['Casual Carl', 'casual carl', 'Pro Pat'],
  });
  assert.ok(list.includes('demo'));
  assert.ok(list.includes('Foundations'));
  assert.ok(list.includes('Second'));
  assert.ok(list.includes('Does env reach hooks?'));
  assert.ok(list.includes('Brief: Vault for everyone'));
  assert.ok(list.includes('Scenario: Sell duplicates'));
  assert.equal(list.filter((x) => x.toLowerCase() === 'casual carl').length, 1);
  assert.ok(!list.includes('PRD'));
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)));
});
