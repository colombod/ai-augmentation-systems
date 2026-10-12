// scripts/lib/plan-docs.test.js — run with: node --test scripts/lib/plan-docs.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { phaseNumber, parseRoadmap, parseStories, parseSpikes } = require('./plan-docs.js');

const ROADMAP = `# Delivery roadmap: Example

## Phases

### Phase 1: Foundations

**Entry criteria:** none

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Manifest library | S | high | |
| Prepare role | M | med | Manifest library |

### Phase 2: Beads (done)

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Materialise | L | low | Prepare role |

### Phase 7b: Parallel thing

No table here.

## Critical path
`;

const ARCH = `# Architecture

## Spikes — what must be proven before committing

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| CoS-1 | Does env reach hooks? | 1 day | Phase 1 |
| 2 | Is bd --id stable? | 2 hours | ex-01 |

## Something else
`;

test('phaseNumber extracts the phase token', () => {
  assert.equal(phaseNumber('Phase 7b: Parallel'), '7b');
  assert.equal(phaseNumber('phase 1'), '1');
  assert.equal(phaseNumber('Phase 1'), '1');
  assert.equal(phaseNumber('nothing'), null);
  assert.equal(phaseNumber(''), null);
});

test('parseRoadmap finds phases, done markers and work items in order', () => {
  const { phases } = parseRoadmap(ROADMAP);
  assert.deepEqual(phases.map((p) => [p.number, p.name, p.done]), [['1', 'Foundations', false], ['2', 'Beads', true], ['7b', 'Parallel thing', false]]);
  assert.deepEqual(phases[0].items.map((i) => i.title), ['Manifest library', 'Prepare role']);
  assert.equal(phases[0].items[1].dependsOn, 'Manifest library');
  assert.equal(phases[0].items[1].size, 'M');
  assert.deepEqual(phases[2].items, []);
});

test('parseStories reads frontmatter and resolves the phase number', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# index\n');
  fs.writeFileSync(path.join(dir, 'ex-01-first.md'), '---\nid: ex-01\ntitle: First thing\nstatus: ready\nepic: ex\nphase: Phase 1\ndepends_on: []\nsize: S\n---\n# First\n');
  fs.writeFileSync(path.join(dir, 'ex-02-second.md'), '---\nid: ex-02\ntitle: Second thing\nstatus: draft\nepic: ex\nphase: Phase 2\ndepends_on: [ex-01, ex-00]\nsize: M\n---\n# Second\n');
  const stories = parseStories(dir);
  assert.deepEqual(stories.map((s) => s.id), ['ex-01', 'ex-02']);
  assert.equal(stories[0].phase, '1');
  assert.deepEqual(stories[0].dependsOn, []);
  assert.deepEqual(stories[1].dependsOn, ['ex-01', 'ex-00']);
  assert.equal(stories[1].file, path.join(dir, 'ex-02-second.md'));
});

test('parseSpikes reads the spikes table and derives keys', () => {
  const spikes = parseSpikes(ARCH);
  assert.deepEqual(spikes.map((s) => s.key), ['cos-1', '2']);
  assert.equal(spikes[0].question, 'Does env reach hooks?');
  assert.equal(spikes[0].timeBox, '1 day');
  assert.equal(spikes[1].blocks, 'ex-01');
});

test('parseSpikes returns an empty list when there is no spikes section', () => {
  assert.deepEqual(parseSpikes('# Arch\n\n## Components\n'), []);
});

test('table cells are pipe-safe for escaped pipes and code spans', () => {
  const md = '### Phase 1: X\n\n| Work item | Size | Confidence | Depends on |\n| :-- | :-- | :-- | :-- |\n| Run `a | b` | S | high | x \\| y |\n';
  const it = parseRoadmap(md).phases[0].items[0];
  assert.deepEqual([it.title, it.size, it.confidence, it.dependsOn], ['Run `a | b`', 'S', 'high', 'x | y']);
  const arch = '## Spikes\n\n| # | Q | Box | Blocks |\n| :-- | :-- | :-- | :-- |\n| s1 | Does `a | b` work? | 1 day | ex-01 |\n';
  const sp = parseSpikes(arch)[0];
  assert.equal(sp.question, 'Does `a | b` work?');
  assert.equal(sp.blocks, 'ex-01');
});

test('listValue strips surrounding quotes', () => {
  const { listValue } = require('./plan-docs.js');
  assert.deepEqual(listValue('["a", \'b\']'), ['a', 'b']);
});
