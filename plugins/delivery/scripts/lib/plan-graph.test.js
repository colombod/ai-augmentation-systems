// scripts/lib/plan-graph.test.js — run with: node --test scripts/lib/plan-graph.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGraph, denylistFrom, uniqueBeads } = require('./plan-graph.js');

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
  assert.deepEqual(ids, ['ex-demo-ph1', 'ex-demo-ph2', 'ex-ex-01', 'ex-demo-spike-cos-1', 'ex-demo-spike-3', 'ex-demo-ph1-review', 'ex-ex-02', 'ex-demo-spike-2', 'ex-demo-ph2-review']);
  const epic = g.beads[0];
  assert.equal(epic.title, 'Phase 1: Foundations');
  assert.equal(epic.type, 'epic');
  assert.deepEqual(epic.labels, ['roadmap', 'phase-1']);
  assert.equal(epic.metadata.roadmap_ref, 'demo/roadmap.md@abc1234 phase 1');
  const story = g.beads.find((b) => b.id === 'ex-ex-01');
  assert.equal(story.parent, 'ex-demo-ph1');
  assert.equal(story.metadata.story, 'ex-01');
  assert.equal(story.metadata.story_file, 'ex-01-first.md');
  const spike = g.beads.find((b) => b.id === 'ex-demo-spike-2');
  assert.equal(spike.parent, 'ex-demo-ph2');
  assert.equal(spike.title, 'Spike 2: Is bd --id stable?');
});

test('planGraph chains phases, reviews, stories and spikes', () => {
  const g = planGraph(input);
  const has = (id, blockedBy) => g.deps.some((d) => d.id === id && d.blockedBy === blockedBy);
  assert.ok(has('ex-ex-02', 'ex-demo-ph1-review'));
  assert.ok(!has('ex-demo-spike-2', 'ex-demo-ph1-review'));
  assert.ok(!g.deps.some((d) => d.id.includes('-spike-') && d.blockedBy.endsWith('-review')));
  assert.ok(has('ex-ex-01', 'ex-demo-spike-cos-1'));
  assert.ok(!has('ex-ex-02', 'ex-demo-spike-cos-1'));
  assert.ok(!g.deps.some((d) => d.id === 'ex-demo-ph2'));
  assert.ok(has('ex-demo-ph1-review', 'ex-ex-01'));
  assert.ok(has('ex-demo-ph1-review', 'ex-demo-spike-cos-1'));
  assert.ok(has('ex-ex-02', 'ex-ex-01'));
  assert.ok(has('ex-ex-02', 'ex-demo-spike-2'));
  assert.ok(has('ex-demo-ph2-review', 'ex-ex-02'));
  assert.ok(!g.deps.some((d) => d.blockedBy === 'ex-demo-spike-3'));
});

test('planGraph warns on orphans and unmatched blocks, skips superseded', () => {
  const g = planGraph(input);
  assert.ok(g.warnings.some((w) => w.includes('story ex-99: phase 9 not in roadmap')));
  assert.ok(g.warnings.some((w) => w.includes('spike 3: blocks "the moon" matched nothing')));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-03'));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-99'));
});

test('a phase-blocking spike blocks the review when the phase has no stories', () => {
  const g = planGraph({ ...input, stories: [], spikes: [{ key: '9', question: 'q', timeBox: '1h', blocks: 'Phase 2' }] });
  const has = (id, blockedBy) => g.deps.some((d) => d.id === id && d.blockedBy === blockedBy);
  assert.ok(has('ex-demo-ph2-review', 'ex-demo-spike-9'));
  assert.ok(has('ex-demo-ph2-review', 'ex-demo-ph1-review'));
  assert.ok(!has('ex-demo-spike-9', 'ex-demo-ph1-review'));
  assert.equal(g.beads.find((b) => b.id === 'ex-demo-spike-9').parent, 'ex-demo-ph2');
});

test('planGraph is byte-identical on repeated runs', () => {
  assert.equal(JSON.stringify(planGraph(input)), JSON.stringify(planGraph(input)));
});

test('planGraph emits no dependency on a skipped story', () => {
  const g = planGraph({ ...input, stories: [...stories, { id: 'ex-04', title: 'Fourth', status: 'ready', phase: '2', dependsOn: ['ex-99'], file: '/x/ex-04.md' }] });
  assert.ok(!g.deps.some((d) => d.blockedBy === 'ex-ex-99' || d.id === 'ex-ex-99'));
  assert.ok(g.warnings.some((w) => w.includes('story ex-04: depends_on ex-99 unknown')));
});

test('planGraph guards duplicates and self-dependencies', () => {
  const g = planGraph({
    ...input,
    stories: [...stories, { id: 'ex-05', title: 'Fifth', status: 'ready', phase: '1', dependsOn: ['ex-05'], file: '/x/ex-05.md' }],
    spikes: [...spikes, { key: 'cos-1', question: 'Again', timeBox: '1h', blocks: 'Phase 1' }],
  });
  assert.ok(g.warnings.includes('duplicate spike key cos-1'));
  assert.ok(g.warnings.includes('story ex-05: depends_on itself'));
  assert.equal(g.beads.filter((b) => b.id === 'ex-demo-spike-cos-1').length, 1);
  assert.ok(!g.deps.some((d) => d.id === 'ex-ex-05' && d.blockedBy === 'ex-ex-05'));
  const keys = g.deps.map((d) => `${d.id}|${d.blockedBy}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('planGraph skips story ids that collide with generated ids and duplicate phases', () => {
  const g = planGraph({
    ...input,
    roadmap: { phases: [...roadmap.phases, { number: '1', name: 'Again', done: false, items: [] }] },
    stories: [...stories,
      { id: 'demo-ph1', title: 'Clash', status: 'ready', phase: '1', dependsOn: [], file: '/x/a.md' },
      { id: 'demo-spike-cos-1', title: 'Clash 2', status: 'ready', phase: '1', dependsOn: [], file: '/x/b.md' },
      { id: 'demo-phase-notes', title: 'Fine', status: 'ready', phase: '1', dependsOn: [], file: '/x/c.md' }],
  });
  assert.ok(g.warnings.includes('duplicate phase 1'));
  assert.ok(g.warnings.includes('story demo-ph1: id collides with generated ids'));
  assert.ok(g.warnings.includes('story demo-spike-cos-1: id collides with generated ids'));
  assert.equal(g.beads.filter((b) => b.id === 'ex-demo-ph1').length, 1);
  assert.equal(g.beads.find((b) => b.id === 'ex-demo-ph1').title, 'Phase 1: Foundations');
  assert.ok(g.beads.some((b) => b.id === 'ex-demo-phase-notes'));
  const ids = g.beads.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('uniqueBeads keeps the first bead per id and warns', () => {
  const warnings = [];
  const out = uniqueBeads([{ id: 'a', title: '1' }, { id: 'b' }, { id: 'a', title: '2' }], warnings);
  assert.deepEqual(out.map((b) => b.title || b.id), ['1', 'b']);
  assert.deepEqual(warnings, ['duplicate bead id a']);
});

test('denylistFrom keeps distinctive phrases, drops generic and single-word entries', () => {
  const list = denylistFrom({
    initiative: 'demo',
    roadmap: { phases: [...roadmap.phases, { number: '3', name: 'Beads over Dolt', done: false, items: [] }] },
    stories, spikes,
    briefText: '# Brief: Vault for everyone\n\n## Who it is for\n\n## Context\n\ntext\n\n```\n## Inside Fence Heading\n```\n',
    prdText: '# PRD\n\n## Scenario: Sell duplicates\n',
    personaNames: ['Casual Carl', 'casual carl', 'Pro Pat', 'Al'],
  });
  assert.ok(list.includes('demo'));
  assert.ok(!list.includes('Al'));
  assert.ok(list.includes('Does env reach hooks?'));
  assert.ok(list.includes('Brief: Vault for everyone'));
  assert.ok(list.includes('Scenario: Sell duplicates'));
  assert.ok(list.includes('Beads over Dolt'));
  assert.ok(!list.includes('Foundations'));
  assert.ok(!list.includes('Second'));
  assert.ok(!list.includes('Context'));
  assert.ok(!list.includes('Inside Fence Heading'));
  assert.equal(list.filter((x) => x.toLowerCase() === 'casual carl').length, 1);
  assert.ok(!list.includes('PRD'));
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)));
});

test('planGraph stamps the customer surface (the story\'s, else the only one declared) and the area on story beads', () => {
  const st = [{ id: 'ex-01', title: 'First', status: 'ready', phase: '1', dependsOn: [], file: '/x/ex-01.md', epic: 'import' }, { id: 'ex-02', title: 'Two', status: 'ready', phase: '1', dependsOn: [], file: '/x/ex-02.md', surface: 'S9', area: 'chat' }];
  const meta = (g, id) => g.beads.find((b) => b.id === id).metadata;
  const one = planGraph({ ...input, stories: st, spikes: [], surfaces: ['S1'] });
  assert.deepEqual([meta(one, 'ex-ex-01').surface, meta(one, 'ex-ex-01').area], ['S1', 'import']);
  assert.equal(meta(one, 'ex-ex-02').surface, undefined);
  assert.ok(one.warnings.includes('story ex-02: surface S9 is not in surface.json (S1)'));
  const two = planGraph({ ...input, stories: st.slice(0, 1), spikes: [], surfaces: ['S1', 'S2'] });
  assert.equal(meta(two, 'ex-ex-01').surface, undefined);
  assert.ok(two.warnings.includes('story ex-01: names no surface; surface.json declares S1, S2'));
});
