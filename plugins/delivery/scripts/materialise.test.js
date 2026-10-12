// scripts/materialise.test.js — run with: node --test scripts/materialise.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeBd } = require('./lib/bd.js');
const { loadInputs, applyPlan, reconcile, writeDenylist, renderDrift } = require('./materialise.js');
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
  const first = applyPlan({ plan, bd, initiative: 'demo' });
  assert.equal(first.created.length, 7);
  assert.ok(first.depsAdded.some((d) => d.id === 'ex-demo-02' && d.blockedBy === 'ex-demo-ph1-review'));
  assert.equal(bd.show('ex-demo-01').parent, 'ex-demo-ph1');
  assert.deepEqual(bd.depsOf('ex-demo-02').sort(), ['ex-demo-01', 'ex-demo-ph1-review']);
  const second = applyPlan({ plan, bd, initiative: 'demo' });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.depsAdded, []);
  bd.exec(['close', 'ex-demo-01', '--reason', 'EVIDENCE: shipped']);
  const renamed = { ...plan, beads: plan.beads.map((b) => (b.id === 'ex-demo-01' ? { ...b, title: 'Renamed' } : b)) };
  const third = applyPlan({ plan: renamed, bd, initiative: 'demo' });
  assert.deepEqual(third.skippedClosed, ['ex-demo-01']);
  assert.equal(bd.show('ex-demo-01').title, 'First story');
});

test('applyPlan updates title and roadmap_ref when the document changed', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd, initiative: 'demo' });
  const plan2 = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'newsha1', roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan: plan2, bd, initiative: 'demo' });
  assert.ok(r.updated.includes('ex-demo-ph1'));
  assert.equal(bd.show('ex-demo-ph1').metadata.roadmap_ref, 'demo/roadmap.md@newsha1 phase 1');
});

test('applyPlan dryRun writes nothing and lists commands', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan, bd, dryRun: true, initiative: 'demo' });
  assert.equal(bd.show('ex-demo-ph1'), null);
  assert.ok(r.commands.some((c) => c.startsWith('create ex-demo-ph1')));
  assert.ok(r.commands.some((c) => c.startsWith('dep ex-demo-02 blocked-by ex-demo-ph1-review')));
});

test('reconcile reports each drift class', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd, initiative: 'demo' });
  assert.deepEqual(reconcile({ plan, bd, roadmap: inputs.roadmap }), { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [], depDrift: [] });
  // drift: a new story without a bead, a stale ref, a closed review, a stray roadmap bead
  const planB = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'zzz', roadmap: inputs.roadmap, stories: [...inputs.stories, { id: 'demo-03', title: 'Third', status: 'ready', phase: '2', dependsOn: [], file: '/x/demo-03.md' }], spikes: inputs.spikes });
  bd.exec(['close', 'ex-demo-ph1-review', '--reason', 'EVIDENCE: reviewed']);
  bd.create({ id: 'ex-stray', title: 'stray', labels: ['roadmap'], metadata: { materialised_by: 'delivery', roadmap_ref: 'demo/roadmap.md@x phase 1' } });
  const d = reconcile({ plan: planB, bd, roadmap: inputs.roadmap });
  assert.deepEqual(d.storiesWithoutBead, ['ex-demo-03']);
  assert.ok(d.staleRef.some((x) => x.id === 'ex-demo-ph2' && x.expected.includes('@zzz')));
  assert.deepEqual(d.closedNotRealigned, ['ex-demo-ph1-review']);
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

const planOf = (inputs, sha, stories) => planGraph({ prefix: 'ex', initiative: 'demo', sha: sha || inputs.sha, roadmap: inputs.roadmap, stories: stories || inputs.stories, spikes: inputs.spikes });
const extraStory = { id: 'demo-03', title: 'Third', status: 'ready', phase: '1', dependsOn: [], file: '/x/demo-03.md' };

test('applyPlan never adds deps to a closed bead and reports them as skippedDeps', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' });
  bd.exec(['close', 'ex-demo-ph1-review', '--reason', 'EVIDENCE: reviewed']);
  const before = bd.depsOf('ex-demo-ph1-review').sort();
  const r = applyPlan({ plan: planOf(inputs, null, [...inputs.stories, extraStory]), bd, initiative: 'demo' });
  assert.deepEqual(r.created, ['ex-demo-03']);
  assert.deepEqual(bd.depsOf('ex-demo-ph1-review').sort(), before);
  assert.ok(r.skippedDeps.some((d) => d.id === 'ex-demo-ph1-review' && d.blockedBy === 'ex-demo-03'));
  assert.ok(!r.depsAdded.some((d) => d.id === 'ex-demo-ph1-review'));
});

test('a story moved to another phase gets the new parent and only the new phase label', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' });
  const moved = inputs.stories.map((x) => (x.id === 'demo-02' ? { ...x, phase: '1' } : x));
  const r = applyPlan({ plan: planOf(inputs, null, moved), bd, initiative: 'demo' });
  assert.ok(r.updated.includes('ex-demo-02'));
  const b = bd.show('ex-demo-02');
  assert.equal(b.parent, 'ex-demo-ph1');
  assert.ok(b.labels.includes('phase-1'));
  assert.ok(!b.labels.includes('phase-2'));
  // re-threaded: the old phase-2 chain dep is gone (it would have made a cycle), the new phase-1 review dep exists
  assert.ok(!bd.depsOf('ex-demo-02').includes('ex-demo-ph1-review'));
  assert.ok(bd.depsOf('ex-demo-ph1-review').includes('ex-demo-02'));
  assert.ok(!bd.depsOf('ex-demo-ph2-review').includes('ex-demo-02'));
  assert.ok(r.depsRemoved.some((d) => d.id === 'ex-demo-02' && d.blockedBy === 'ex-demo-ph1-review'));
  assert.deepEqual(reconcile({ plan: planOf(inputs, null, moved), bd, roadmap: inputs.roadmap, initiative: 'demo' }).depDrift, []);
});

const threePhases = (inputs) => ({ phases: [...inputs.roadmap.phases, { number: '3', name: 'Polish', done: false, items: [] }] });
const plan3 = (inputs, stories) => planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: threePhases(inputs), stories, spikes: inputs.spikes });

test('a story moved from phase 1 to phase 3 is re-threaded: old review dep removed, new chain dep added', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  const stories = [...inputs.stories, extraStory];
  applyPlan({ plan: plan3(inputs, stories), bd, initiative: 'demo' });
  assert.ok(bd.depsOf('ex-demo-ph1-review').includes('ex-demo-03'));
  const moved = stories.map((x) => (x.id === 'demo-03' ? { ...x, phase: '3' } : x));
  const r = applyPlan({ plan: plan3(inputs, moved), bd, initiative: 'demo' });
  assert.ok(!bd.depsOf('ex-demo-ph1-review').includes('ex-demo-03'));
  assert.ok(bd.depsOf('ex-demo-03').includes('ex-demo-ph2-review'));
  assert.ok(!bd.depsOf('ex-demo-03').includes('ex-demo-spike-1'));
  assert.ok(r.depsRemoved.some((d) => d.id === 'ex-demo-ph1-review' && d.blockedBy === 'ex-demo-03'));
  assert.ok(r.depsAdded.some((d) => d.id === 'ex-demo-03' && d.blockedBy === 'ex-demo-ph2-review'));
});

test('a plan that would cycle through a stale dep applies cleanly because the stale dep goes first', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' });
  // demo-01 moves to phase 2: it must now wait for ph1-review, which still waits for demo-01
  assert.throws(() => bd.depAdd('ex-demo-01', 'ex-demo-ph1-review'), /would create a cycle/);
  const moved = inputs.stories.map((x) => (x.id === 'demo-01' ? { ...x, phase: '2' } : x));
  const r = applyPlan({ plan: planOf(inputs, null, moved), bd, initiative: 'demo' });
  assert.ok(r.depsRemoved.some((d) => d.id === 'ex-demo-ph1-review' && d.blockedBy === 'ex-demo-01'));
  assert.ok(bd.depsOf('ex-demo-01').includes('ex-demo-ph1-review'));
  assert.deepEqual(applyPlan({ plan: planOf(inputs, null, moved), bd, initiative: 'demo' }).depsAdded, []);
});

test('human-added and other-initiative blockers survive a re-apply', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' });
  bd.create({ id: 'ex-human', title: 'found while building' });
  bd.create({ id: 'ex-other-ph1-review', title: 'other', labels: ['roadmap'], metadata: { materialised_by: 'delivery', roadmap_ref: 'other/roadmap.md@abc phase 1' } });
  bd.depAdd('ex-demo-02', 'ex-human');
  bd.depAdd('ex-demo-02', 'ex-other-ph1-review');
  const moved = inputs.stories.map((x) => (x.id === 'demo-02' ? { ...x, phase: '1' } : x));
  for (const plan of [planOf(inputs), planOf(inputs, null, moved)]) {
    const r = applyPlan({ plan, bd, initiative: 'demo' });
    assert.ok(!r.depsRemoved.some((d) => d.blockedBy === 'ex-human' || d.blockedBy === 'ex-other-ph1-review'));
    assert.ok(bd.depsOf('ex-demo-02').includes('ex-human'));
    assert.ok(bd.depsOf('ex-demo-02').includes('ex-other-ph1-review'));
    assert.deepEqual(reconcile({ plan, bd, roadmap: inputs.roadmap, initiative: 'demo' }).depDrift, []);
  }
});

test('dry run lists dep-remove commands and removes nothing', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' });
  const moved = inputs.stories.map((x) => (x.id === 'demo-02' ? { ...x, phase: '1' } : x));
  const r = applyPlan({ plan: planOf(inputs, null, moved), bd, dryRun: true, initiative: 'demo' });
  assert.ok(r.commands.includes('dep-remove ex-demo-02 blocked-by ex-demo-ph1-review'));
  assert.ok(bd.depsOf('ex-demo-02').includes('ex-demo-ph1-review'));
  assert.ok(!bd.depsOf('ex-demo-ph1-review').includes('ex-demo-02'));
});

test('reconcile reports dependency drift on materialised blockers only', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  const plan = planOf(inputs);
  applyPlan({ plan, bd, initiative: 'demo' });
  bd.depRemove('ex-demo-02', 'ex-demo-01');
  bd.depAdd('ex-demo-02', 'ex-demo-spike-1');
  bd.create({ id: 'ex-human', title: 'h' });
  bd.depAdd('ex-demo-02', 'ex-human');
  const d = reconcile({ plan, bd, roadmap: inputs.roadmap, initiative: 'demo' });
  assert.deepEqual(d.depDrift, [{ id: 'ex-demo-02', missing: ['ex-demo-01'], extra: ['ex-demo-spike-1'] }]);
  assert.match(renderDrift(d), /Dependency drift: ex-demo-02 missing \[ex-demo-01\] extra \[ex-demo-spike-1\]/);
});

test('roadmap_ref follows the roadmap file, not unrelated commits', () => {
  const root = scratchProject();
  const script = path.join(PLUGIN, 'scripts', 'materialise.js');
  const env = fakeEnv();
  execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo'], { env });
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'x');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'unrelated'], { cwd: root });
  const bd = makeBd({ env });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  assert.deepEqual(applyPlan({ plan: planOf(inputs), bd, initiative: 'demo' }).updated, []);
  assert.match(execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--check'], { env }).toString(), /No plan drift/);
});

test('an uncommitted roadmap gets a content-hash sha', () => {
  const root = scratchProject();
  const dir = path.join(root, '.delivery', 'initiatives', 'fresh');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root, '.delivery', 'initiatives', 'demo', 'roadmap.md'), path.join(dir, 'roadmap.md'));
  assert.match(loadInputs({ projectRoot: root, initiative: 'fresh' }).sha, /^h[0-9a-f]{7}$/);
});

test('CLI --dry-run writes no beads and no denylist', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const script = path.join(PLUGIN, 'scripts', 'materialise.js');
  const out = execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--dry-run'], { env }).toString();
  assert.match(out, /denylist would have \d+ entries/);
  assert.ok(!fs.existsSync(path.join(root, '.delivery', 'team', 'denylist.txt')));
  assert.equal(makeBd({ env }).list({ all: true }).length, 0);
});

test('CLI rejects unknown flags and --check with --dry-run', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const script = path.join(PLUGIN, 'scripts', 'materialise.js');
  for (const extra of [['--bogus'], ['--check', '--dry-run']]) {
    assert.throws(() => execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', ...extra], { env, stdio: 'pipe' }), (err) => err.status === 2);
  }
});

test('applyPlan never issues a second create for a duplicated id', () => {
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: scratchProject(), initiative: 'demo' });
  const plan = planOf(inputs);
  const dup = { ...plan, beads: [...plan.beads, { ...plan.beads.find((b) => b.id === 'ex-demo-01'), title: 'Second copy' }] };
  const r = applyPlan({ plan: dup, bd, initiative: 'demo' });
  assert.equal(r.created.filter((id) => id === 'ex-demo-01').length, 1);
  assert.ok(!r.commands.some((c) => c.startsWith('create ex-demo-01 "Second copy"')));
  const dry = applyPlan({ plan: dup, bd: makeBd({ env: fakeEnv() }), dryRun: true, initiative: 'demo' });
  assert.equal(dry.commands.filter((c) => c.startsWith('create ex-demo-01 ')).length, 1);
});
