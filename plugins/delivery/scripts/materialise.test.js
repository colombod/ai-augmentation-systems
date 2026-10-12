// scripts/materialise.test.js — run with: node --test scripts/materialise.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeBd } = require('./lib/bd.js');
const { loadInputs, applyPlan, reconcile, writeDenylist } = require('./materialise.js');
const { planGraph } = require('./lib/plan-graph.js');

const PLUGIN = path.join(__dirname, '..');
const FAKE_DIR = path.join(PLUGIN, 'scripts', 'test');

function fakeEnv() {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mat-bd-')), 'store.json');
  return { ...process.env, PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: store };
}

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'templates', 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN, 'templates', 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  const init = path.join(root, '.delivery', 'initiatives', 'demo');
  fs.mkdirSync(init, { recursive: true });
  fs.writeFileSync(path.join(init, 'roadmap.md'), '# Roadmap\n\n## Phases\n\n### Phase 1: Foundations\n\n| Work item | Size | Confidence | Depends on |\n| :-- | :-- | :-- | :-- |\n| A | S | high | |\n\n### Phase 2: Beads\n\n| Work item | Size | Confidence | Depends on |\n| :-- | :-- | :-- | :-- |\n| B | M | med | A |\n');
  fs.writeFileSync(path.join(init, 'architecture.md'), '# Arch\n\n## Spikes — what must be proven\n\n| # | Question to answer | Time box | Blocks |\n| :-- | :-- | :-- | :-- |\n| 1 | Does X hold? | 1 day | Phase 1 |\n');
  fs.writeFileSync(path.join(init, 'brief.md'), '# Brief: Demo product\n');
  fs.mkdirSync(path.join(root, '.delivery', 'stories'));
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-01-first.md'), '---\nid: demo-01\ntitle: First story\nstatus: ready\nepic: demo\nphase: Phase 1\ndepends_on: []\nsize: S\n---\n# First\n');
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-02-second.md'), '---\nid: demo-02\ntitle: Second story\nstatus: ready\nepic: demo\nphase: Phase 2\ndepends_on: [demo-01]\nsize: M\n---\n# Second\n');
  fs.mkdirSync(path.join(root, '.delivery', 'personas'));
  fs.writeFileSync(path.join(root, '.delivery', 'personas', 'carl.md'), '---\nname: Casual Carl\n---\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

test('loadInputs reads everything and the git sha', () => {
  const root = scratchProject();
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  assert.equal(inputs.team.prefix, 'ex');
  assert.equal(inputs.roadmap.phases.length, 2);
  assert.equal(inputs.stories.length, 2);
  assert.equal(inputs.spikes.length, 1);
  assert.match(inputs.sha, /^[0-9a-f]{7,}$/);
  assert.deepEqual(inputs.personaNames, ['Casual Carl']);
});

test('applyPlan creates the graph, is idempotent, and never touches closed beads', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const bd = makeBd({ env });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const first = applyPlan({ plan, bd });
  assert.equal(first.created.length, 7);
  assert.ok(first.depsAdded.some((d) => d.id === 'ex-demo-02' && d.blockedBy === 'ex-ph1-review'));
  assert.equal(bd.show('ex-demo-01').parent, 'ex-ph1');
  assert.deepEqual(bd.depsOf('ex-demo-02').sort(), ['ex-demo-01', 'ex-ph1-review']);
  const second = applyPlan({ plan, bd });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.depsAdded, []);
  bd.exec(['close', 'ex-demo-01', '--reason', 'EVIDENCE: shipped']);
  const renamed = { ...plan, beads: plan.beads.map((b) => (b.id === 'ex-demo-01' ? { ...b, title: 'Renamed' } : b)) };
  const third = applyPlan({ plan: renamed, bd });
  assert.deepEqual(third.skippedClosed, ['ex-demo-01']);
  assert.equal(bd.show('ex-demo-01').title, 'First story');
});

test('applyPlan updates title and roadmap_ref when the document changed', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd });
  const plan2 = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'newsha1', roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan: plan2, bd });
  assert.ok(r.updated.includes('ex-ph1'));
  assert.equal(bd.show('ex-ph1').metadata.roadmap_ref, 'demo/roadmap.md@newsha1 phase 1');
});

test('applyPlan dryRun writes nothing and lists commands', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan, bd, dryRun: true });
  assert.equal(bd.show('ex-ph1'), null);
  assert.ok(r.commands.some((c) => c.startsWith('create ex-ph1')));
  assert.ok(r.commands.some((c) => c.startsWith('dep ex-demo-02 blocked-by ex-ph1-review')));
});

test('reconcile reports each drift class', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd });
  assert.deepEqual(reconcile({ plan, bd, roadmap: inputs.roadmap }), { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [] });
  // drift: a new story without a bead, a stale ref, a closed review, a stray roadmap bead
  const planB = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'zzz', roadmap: inputs.roadmap, stories: [...inputs.stories, { id: 'demo-03', title: 'Third', status: 'ready', phase: '2', dependsOn: [], file: '/x/demo-03.md' }], spikes: inputs.spikes });
  bd.exec(['close', 'ex-ph1-review', '--reason', 'EVIDENCE: reviewed']);
  bd.create({ id: 'ex-stray', title: 'stray', labels: ['roadmap'], metadata: { materialised_by: 'delivery' } });
  const d = reconcile({ plan: planB, bd, roadmap: inputs.roadmap });
  assert.deepEqual(d.storiesWithoutBead, ['ex-demo-03']);
  assert.ok(d.staleRef.some((x) => x.id === 'ex-ph2' && x.expected.includes('@zzz')));
  assert.deepEqual(d.closedNotRealigned, ['ex-ph1-review']);
  assert.deepEqual(d.unknownRoadmapBeads, ['ex-stray']);
});

test('writeDenylist writes one entry per line', () => {
  const root = scratchProject();
  const p = writeDenylist(root, ['Alpha', 'Beta']);
  assert.equal(fs.readFileSync(p, 'utf8'), 'Alpha\nBeta\n');
});

test('CLI materialises then reports no drift, and exits 1 on drift', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const script = path.join(PLUGIN, 'scripts', 'materialise.js');
  const out = execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo'], { env }).toString();
  assert.match(out, /created 7/);
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'team', 'denylist.txt')));
  const check = execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--check'], { env }).toString();
  assert.match(check, /No plan drift/);
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-03-third.md'), '---\nid: demo-03\ntitle: Third\nstatus: ready\nepic: demo\nphase: Phase 2\ndepends_on: []\nsize: S\n---\n');
  assert.throws(() => execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--check'], { env, stdio: 'pipe' }), (err) => err.status === 1 && String(err.stdout).includes('ex-demo-03'));
});
