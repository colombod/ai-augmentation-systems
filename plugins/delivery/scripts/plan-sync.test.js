// scripts/plan-sync.test.js — the planning repository stays true to what shipped (lib/plan-sync.js):
// story statuses follow their beads, the feature map follows the product at its default branch, the
// plan is pushed to origin, and the merge gate refuses the next merge while any of that is behind.
// Run with: node --test scripts/plan-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const PS = require('./lib/plan-sync.js');
const R = require('./lib/reviews.js');
const planSync = require('./plan-sync.js');
const { harness } = require('./testing/role-harness.js');
const { makeProject, storyBead } = require('./testing/gate-fixture.js');

const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const story = (id, status, files = '') => `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n\n# ${id}\n\n## Files and modules\n\n| Path | Action |\n| :-- | :-- |\n${files}\n`;
const bead = (id, file, over = {}) => ({ id, status: 'open', labels: ['story'], metadata: { story_file: file }, ...over });

// a project root with an origin, two stories, and a product repo shipping one plugin skill
function world() {
  const origin = tmp('ps-origin-');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const root = tmp('ps-proj-');
  git(root, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(root, '.delivery', 'stories'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'a-01.md'), story('a-01', 'ready', '| `skills/search/SKILL.md` | modify |'));
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'a-02.md'), story('a-02', 'ready', '| `skills/export/SKILL.md` | create |'));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'plan');
  git(root, 'remote', 'add', 'origin', origin); git(root, 'push', '-q', '-u', 'origin', 'main');
  const product = tmp('ps-prod-');
  git(product, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(product, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(product, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'shop' }));
  fs.mkdirSync(path.join(product, 'skills', 'search'), { recursive: true });
  fs.writeFileSync(path.join(product, 'skills', 'search', 'SKILL.md'), '# search\n');
  git(product, 'add', '-A'); git(product, 'commit', '-q', '-m', 'v1');
  return { root, origin, product, source: { repo: product, ref: 'HEAD' } };
}
const onOrigin = (w, rel) => { try { return execFileSync('git', ['--git-dir', w.origin, 'show', `main:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (err) { return null; } };
const merged = (root, pr, at) => R.append(root, pr, { type: 'merged', repo: 'acme/shop', head: 'a'.repeat(40), beads: [], gated: true, by: 'delivery-lead', actor: 'dl', at }, 'delivery-lead');

test('story statuses follow their beads, only forward; a reopened done story is reported, not rewritten', () => {
  const w = world();
  const s = (f) => PS.statusOf(fs.readFileSync(path.join(w.root, '.delivery', 'stories', f), 'utf8'));
  const beads = [bead('x-a-01', 'a-01.md', { status: 'closed' }), bead('x-a-02', 'a-02.md', { status: 'in_progress' })];
  assert.deepEqual(PS.storyDrift(w.root, beads).map((d) => [d.file, d.from, d.to]), [['a-01.md', 'ready', 'done'], ['a-02.md', 'ready', 'in-progress']]);
  const r = PS.apply(w.root, { beads, source: w.source, now: '2026-10-31T10:00:00Z' });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(s('a-01.md'), 'done');
  assert.equal(s('a-02.md'), 'in-progress');
  // a merged-but-open story is in progress; a cut one and an untouched one say nothing
  fs.writeFileSync(path.join(w.root, '.delivery', 'stories', 'a-04.md'), story('a-04', 'ready'));
  assert.deepEqual(PS.storyDrift(w.root, [bead('x-a-04', 'a-04.md', { labels: ['story', 'state-merged'] })]).map((d) => d.to), ['in-progress']);
  assert.equal(PS.storyDrift(w.root, [bead('x-a-02', 'a-02.md', { labels: ['story', 'state-merged'] })]).length, 0);
  assert.equal(PS.storyDrift(w.root, [bead('x-a-02', 'a-02.md', { status: 'closed', labels: ['story', 'state-cut'] })]).length, 0);
  // never backwards: an open bead on an in-progress story changes nothing; on a done story it is reported
  assert.equal(PS.storyDrift(w.root, [bead('x-a-02', 'a-02.md')]).length, 0);
  const back = PS.apply(w.root, { beads: [bead('x-a-01', 'a-01.md', { status: 'in_progress' })], source: w.source });
  assert.equal(s('a-01.md'), 'done');
  assert.match(back.problems.join('\n'), /a-01\.md says done, but its bead x-a-01 is open again/);
});

test('the feature map: what ships, what each open story reaches, and a shipped log across merges', () => {
  const w = world();
  PS.apply(w.root, { beads: [], source: w.source, now: '2026-10-31T10:00:00Z', pr: 7 });
  const m1 = JSON.parse(fs.readFileSync(path.join(w.root, PS.MAP_JSON), 'utf8'));
  assert.deepEqual(m1.features.map((f) => f.id), ['shop:search']);
  assert.deepEqual(m1.planned.map((p) => [p.story, p.features]), [['a-01', ['shop:search']], ['a-02', []]]);
  assert.deepEqual(m1.history.map((h) => [h.pr, h.added, h.removed]), [[7, ['shop:search'], []]]);
  // the product ships export and drops search: the next sync logs both
  fs.mkdirSync(path.join(w.product, 'skills', 'export'), { recursive: true });
  fs.writeFileSync(path.join(w.product, 'skills', 'export', 'SKILL.md'), '# export\n');
  git(w.product, 'rm', '-q', 'skills/search/SKILL.md'); git(w.product, 'add', '-A'); git(w.product, 'commit', '-q', '-m', 'v2');
  PS.apply(w.root, { beads: [], source: w.source, now: '2026-10-31T11:00:00Z', pr: 8 });
  const m2 = JSON.parse(fs.readFileSync(path.join(w.root, PS.MAP_JSON), 'utf8'));
  assert.deepEqual(m2.history.map((h) => [h.pr, h.added, h.removed]), [[7, ['shop:search'], []], [8, ['shop:export'], ['shop:search']]]);
  assert.deepEqual(m2.planned.find((p) => p.story === 'a-02').features, ['shop:export']);
  // a story that is done is shipped, not planned
  PS.apply(w.root, { beads: [bead('x-a-01', 'a-01.md', { status: 'closed' })], source: w.source, now: '2026-10-31T11:30:00Z' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.root, PS.MAP_JSON), 'utf8')).planned.map((p) => p.story), ['a-02']);
  // the same commit again adds no history row
  PS.apply(w.root, { beads: [], source: w.source, now: '2026-10-31T12:00:00Z' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, PS.MAP_JSON), 'utf8')).history.length, 2);
  const md = fs.readFileSync(path.join(w.root, PS.MAP_MD), 'utf8');
  assert.match(md, /\| shop:export \| skill \| derived \| skills\/export\/SKILL\.md \|/);
  assert.match(md, /\| a-02 \| ready \| shop:export \|/);
  assert.match(md, /\| 8 \| `[0-9a-f]{12}` \| shop:export \| shop:search \|/);
});

test('apply pushes the plan to origin; check sees unpublished files and unpushed commits', () => {
  const w = world();
  assert.deepEqual(PS.drift(w.root, { beads: [] }), []);
  fs.writeFileSync(path.join(w.root, '.delivery', 'stories', 'a-03.md'), story('a-03', 'draft'));
  assert.deepEqual(PS.drift(w.root, { beads: [] }).map((d) => d.kind), ['unpublished']);
  git(w.root, 'add', '-A'); git(w.root, 'commit', '-q', '-m', 'local only');
  assert.deepEqual(PS.drift(w.root, { beads: [] }).map((d) => d.kind), ['unpushed']);
  const r = PS.apply(w.root, { beads: [bead('x-a-01', 'a-01.md', { status: 'closed' })], source: w.source, now: '2026-10-31T10:00:00Z' });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.match(onOrigin(w, '.delivery/stories/a-01.md'), /^status: done$/m);
  assert.ok(onOrigin(w, '.delivery/stories/a-03.md'));
  assert.ok(JSON.parse(onOrigin(w, '.delivery/feature-map.json')).features.length);
  assert.deepEqual(PS.drift(w.root, { beads: [bead('x-a-01', 'a-01.md', { status: 'closed' })] }), []);
});

test('a merge newer than the feature map is drift until the map is rebuilt', () => {
  const w = world();
  merged(w.root, 7, '2026-10-31T09:00:00Z');
  git(w.root, 'add', '-A'); git(w.root, 'commit', '-q', '-m', 'r'); git(w.root, 'push', '-q');
  assert.match(PS.drift(w.root, {}).map((d) => d.detail).join('\n'), /there is no feature map, and PR 7 has merged/);
  PS.apply(w.root, { beads: [], source: w.source, now: '2026-10-31T09:30:00Z' });
  assert.deepEqual(PS.drift(w.root, {}), []);
  merged(w.root, 8, '2026-10-31T10:00:00Z');
  assert.match(PS.drift(w.root, {}).find((d) => d.kind === 'feature-map').detail, /from 2026-10-31T09:30:00Z, before PR 8 merged/);
});

test('the automatic sync never clones; the explicit apply does, from a local or remote product', () => {
  const w = world();
  const noCopy = PS.productSource(w.root, { team: { product_github: 'acme/shop' }, clone: false });
  assert.match(noCopy.error, /no local copy of the product yet: run .*plan-sync\.js apply/);
  const src = PS.productSource(w.root, { team: { product_url: w.product } });
  assert.equal(src.repo, w.product, 'a local product without a remote maps its own HEAD');
  const remote = PS.productSource(w.root, { team: { product_url: `file://${w.product}` } });
  assert.ok(!remote.error, remote.error);
  assert.equal(remote.repo, path.join(w.root, '.delivery', 'cache', 'product.git'));
  assert.equal(fs.readFileSync(path.join(w.root, '.delivery', 'cache', '.gitignore'), 'utf8'), '*\n', 'the copy is never committed');
  assert.ok(PS.productSource(w.root, { team: { product_url: `file://${w.product}` }, clone: false }).repo, 'once copied, the automatic sync uses it');
});

test('plan-sync.js check exits 1 on drift and names the fix; apply brings it to 0', () => {
  const w = world();
  const who = { root: w.root, team: { product_url: w.product }, roleDir: null };
  const bd = { list: () => [bead('x-a-01', 'a-01.md', { status: 'closed' })] };
  const c = planSync.main(['check'], { who, bd });
  assert.equal(c.code, 1);
  assert.match(c.out, /a-01\.md says ready, its bead x-a-01 says done\nBring it up to date: `node .*plan-sync\.js apply`/);
  const a = planSync.main(['apply'], { who, bd });
  assert.equal(a.code, 0, a.out);
  assert.match(a.out, /a-01\.md: ready -> done/);
  assert.equal(planSync.main(['check'], { who, bd }).code, 0);
  assert.equal(planSync.main(['nope'], { who, bd }).code, 2);
});

// ---------- through the real lane: the Delivery Manager cannot merge past a stale plan ----------

const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const BEAD = 'ex-vault-0n9-3';

test('the merge gate refuses while the plan is behind, and the merge itself brings it up to date', () => {
  const pr = (n, over = {}) => ({ headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'src/a.js', additions: 10, deletions: 0 }], body: `x\n\nRefs ${BEAD}`, title: `change ${n}`, ...over });
  const root = makeProject();
  const sf = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('size: M\n', 'size: M\nstatus: ready\n'));
  const h = harness({ root, beads: { [BEAD]: storyBead({ metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } }) }, prs: { 478: pr(478), 479: pr(479) } });
  const gate = (args) => h.bash('delivery-lead', `${h.script('merge-gate.js')} ${args}`);
  const pass = (n) => { h.bash('delivery-lead', `${h.script('review.js')} request ${n} --reviewer agent-1`); h.bash('delivery-lead', `${h.script('review.js')} record ${n} --head ${H1} --result pass --by agent-1 --summary 'criteria hold'`); };
  // the story is claimed (in progress) and its file still says ready: the plan is behind before any merge
  pass(478);
  const refused = h.bash('delivery-lead', `gh pr merge 478 -R example/example --match-head-commit ${H1} --squash`, { run: false });
  assert.match(refused.deny || '', /the plan is behind what shipped: vault-0n9-3\.md says ready, its bead ex-vault-0n9-3 says in-progress\.\nBring it up to date: `node .*plan-sync\.js apply`/);
  const ap = h.bash('delivery-lead', `${h.script('plan-sync.js')} apply`);
  assert.equal(ap.deny, null, ap.deny);
  assert.match(ap.out, /vault-0n9-3\.md: ready -> in-progress/);
  assert.equal(gate('check 478').code, 0, gate('check 478').out);
  // the merge happens; merged records it and maps the product (the role's product checkout) without being asked
  h.setPr(478, (p) => { p.state = 'MERGED'; });
  const m = gate('merged 478');
  assert.match(m.out, /plan: feature map at [0-9a-f]{12}/, m.out);
  assert.ok(fs.existsSync(path.join(root, PS.MAP_JSON)));
  // the story closes later: the next merge is refused until the plan says done
  h.setBead(BEAD, (b) => { b.status = 'closed'; });
  pass(479);
  assert.match(gate('check 479').out, /says in-progress, its bead ex-vault-0n9-3 says done/);
  h.bash('delivery-lead', `${h.script('plan-sync.js')} apply`);
  assert.equal(gate('check 479').code, 0);
  assert.match(fs.readFileSync(sf, 'utf8'), /^status: done$/m);
});

test('the Delivery Manager starts its session told the plan is behind; a builder is not', () => {
  const root = makeProject();
  const sf = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('size: M\n', 'size: M\nstatus: ready\n'));
  const h = harness({ root, beads: { [BEAD]: storyBead() } });
  const start = (inst) => {
    const env = { ...process.env, DELIVERY_ROLE: inst, DELIVERY_ROLE_DIR: h.roleDir(inst), BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..') };
    return execFileSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'scripts', 'role-session-start.js')], { input: JSON.stringify({ cwd: h.roleDir(inst), session_id: 's', hook_event_name: 'SessionStart', source: 'startup' }), env, encoding: 'utf8' });
  };
  assert.match(start('delivery-lead'), /The plan is behind what shipped \(1: vault-0n9-3\.md says ready, its bead ex-vault-0n9-3 says in-progress\)\. Bring it up to date first: `node .*plan-sync\.js apply`/);
  assert.doesNotMatch(start('builder-1'), /The plan is behind/);
  h.bash('delivery-lead', `${h.script('plan-sync.js')} apply`);
  assert.doesNotMatch(start('delivery-lead'), /The plan is behind/);
});
