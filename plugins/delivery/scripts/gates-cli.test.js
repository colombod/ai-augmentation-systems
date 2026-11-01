// scripts/gates-cli.test.js — ready.js, evidence.js, warnings.js and surface.js on a Vault project with an
// in-memory bd. The session's role is passed as `who` (in a real session it comes from the role
// marker); one test runs the script with no role session and expects writes to be refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { loadManifest } = require('./lib/manifest.js');
const { STORY, makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const ready = require('./ready.js');
const evidence = require('./evidence.js');
const warnings = require('./warnings.js');
const surface = require('./surface.js');

const env = {};
const NOW = '2026-10-13T09:00:00Z';
const ID = 'ex-vault-0n9-3';
const whoFor = (root, instance) => ({ root, team: loadManifest(root).team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `t@pc/${instance}` });
const setup = ({ story, over, dm = 'delivery-lead' } = {}) => {
  const root = makeProject(story ? { story } : {});
  const bd = memBd([storyBead({ assignee: 't@pc/builder-1', ...over })]);
  const run = (instance, argv, now = NOW) => evidence.main([...argv], { cwd: root, env, bd, now, who: whoFor(root, instance), verifyRecord: require('./testing/gate-fixture.js').ownerVerify('dec-chief-of-staff-41') });
  const ev = (...argv) => run(dm, argv);
  // S1 is not scriptable: a DM row counts only on the owner's record (R-33); reality-check.test.js covers the checker's rows
  const add = (n, extra = []) => ev('add', ID, '--criterion', String(n), '--result', 'pass', '--surface', 'S1', '--sha', 'd478aa11', '--run', 'rc-1', '--record', 'dec-chief-of-staff-41', ...extra);
  return { root, bd, ev, run, add, bead: () => bd.show(ID) };
};

test('ready.js, vault-0n9.3 without a measurement plan: the pre-check only reports; --record stamps the hash and records what is still wrong', async () => {
  const { root, bd, bead } = setup({ story: STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, '') });
  const dm = whoFor(root, 'delivery-lead');
  const pre = await ready.main([ID], { cwd: root, env, bd, now: NOW, who: dm });
  assert.equal(pre.code, 0);
  assert.match(pre.out, /warn R-19 measurement-plan/);
  assert.doesNotMatch(pre.out, /not-ready/);
  assert.deepEqual(W.list(root), [], 'the pre-check writes nothing');
  assert.equal((await ready.main([ID, '--record'], { cwd: root, env, bd, now: NOW, who: whoFor(root, 'builder-1') })).code, 1, 'only the Delivery Manager records');
  assert.equal((await ready.main([ID, '--record'], { cwd: root, env, bd, now: NOW, who: dm })).code, 0);
  assert.equal(bead().metadata.ready_hash, G.storyHash(G.parseStory(STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, ''))));
  assert.deepEqual(W.list(root).map((w) => w.kind), ['measurement-plan']);
  // fixed and re-recorded with an owner record: the warning resolves itself
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), STORY.replace('with the card count', 'with the card count and the deck name'));
  const again = (extra) => ready.main([ID, '--record', ...extra], { cwd: root, env, bd, who: dm, verifyRecord: require('./testing/gate-fixture.js').ownerVerify('dec-chief-of-staff-50') });
  assert.match((await again([])).out, /changed since they were made ready \(D1\)\.\nRe-record with an owner record/);
  assert.match((await again(['--owner-record', 'dec-x-1'])).out, /dec-x-1 does not verify \(not found\)/);
  assert.equal((await again(['--owner-record', 'dec-chief-of-staff-50'])).code, 0);
  assert.equal(W.summary(W.list(root)).open, 0);
});

test('ready.js --story checks a story file before it has a bead; an undeclared surface is a block', async () => {
  const root = makeProject({ story: STORY.replace('surface: S1', 'surface: S7') });
  const r = await ready.main(['--story', path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), '--initiative', 'vault', '--project', root], { cwd: root, env });
  assert.equal(r.code, 1);
  assert.match(r.out, /block D2 surface-unknown/);
});

// the feature map at the ready gate: what the story's files reach, as information only
test('ready.js --story prints the story\'s reach from the feature map; where it cannot, it says so and the verdict is unchanged', async () => {
  const story = `${STORY}\n## Files and modules\n\n| Path | What to do |\n| :-- | :-- |\n| \`p/scripts/run.js\` | modify |\n`;
  const root = makeProject({ story });
  const file = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  const before = await ready.main(['--story', file, '--initiative', 'vault', '--project', root], { cwd: root, env });
  assert.match(before.out, /\nReach: reach-not-computed \(/, 'not a git repository: said, not hidden');
  const { execFileSync } = require('child_process');
  fs.mkdirSync(path.join(root, 'p', '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'p', 'skills', 'go'), { recursive: true });
  fs.mkdirSync(path.join(root, 'p', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p', '.claude-plugin', 'plugin.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(root, 'p', 'skills', 'go', 'SKILL.md'), 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.js`.\n');
  fs.writeFileSync(path.join(root, 'p', 'scripts', 'run.js'), '');
  const g = (...x) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...x], { cwd: root, stdio: 'ignore' });
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'x');
  const after = await ready.main(['--story', file, '--initiative', 'vault', '--project', root], { cwd: root, env });
  assert.equal(after.code, before.code, 'reach never changes the verdict');
  assert.match(after.out, /\nReach at [0-9a-f]{12}: p:go \(1 hop\)/);
  const json = JSON.parse((await ready.main(['--story', file, '--initiative', 'vault', '--project', root, '--json'], { cwd: root, env })).out);
  assert.deepEqual(json.reach.features, [{ id: 'p:go', hops: 1 }]);
});

// a team whose code lives apart from the planning repository: the role's product checkout is mapped
test('ready.js --story maps the role\'s product checkout, not the planning repository', async () => {
  const story = `${STORY}\n## Files and modules\n\n| Path | What to do |\n| :-- | :-- |\n| \`p/scripts/run.js\` | modify |\n`;
  const root = makeProject({ story });
  const { execFileSync } = require('child_process');
  const g = (cwd, ...x) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...x], { cwd, stdio: 'ignore' });
  g(root, 'init', '-q'); g(root, 'add', '-A'); g(root, 'commit', '-qm', 'plans only');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-role-'));
  const product = path.join(roleDir, 'product');
  fs.mkdirSync(path.join(product, 'p', '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(product, 'p', 'skills', 'go'), { recursive: true });
  fs.mkdirSync(path.join(product, 'p', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(product, 'p', '.claude-plugin', 'plugin.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(product, 'p', 'skills', 'go', 'SKILL.md'), 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.js`.\n');
  fs.writeFileSync(path.join(product, 'p', 'scripts', 'run.js'), '');
  g(product, 'init', '-q'); g(product, 'add', '-A'); g(product, 'commit', '-qm', 'code');
  const file = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  const who = { root, team: null, roleId: 'delivery-lead', instance: 'delivery-lead', actor: 'x', roleDir };
  const r = await ready.main(['--story', file, '--initiative', 'vault', '--project', root], { cwd: root, env, who });
  assert.match(r.out, /\nReach at [0-9a-f]{12}: p:go \(1 hop\)/, 'mapped in the product checkout');
});

test('evidence.js, 10-11 05:40: the author, a builder, a spike researcher and a session with no role cannot write a row', () => {
  const { root, run, add } = setup();
  const argv = ['add', ID, '--criterion', '1', '--result', 'pass', '--surface', 'S1', '--sha', 'd478aa11'];
  assert.match(run('builder-1', argv).out, /the Delivery Manager's to do/);
  assert.match(run('spike-researcher', argv).out, /the Delivery Manager's to do/);
  assert.match(evidence.main([...argv, '--project', root], { cwd: root, env: {}, bd: memBd([]) }).out, /needs the Delivery Manager's role session/);
  assert.match(add(1).out, /no deployed sha/);
  assert.deepEqual(G.readEvidence(root, ID), []);
});

test('evidence.js: a Delivery Manager who claimed the story is an author too and is refused', () => {
  const { add, ev } = setup({ over: { metadata: { authors: [{ actor: 't@pc/delivery-lead', role: 'delivery-lead' }] } } });
  ev('state', ID, 'deployed', '--sha', 'd478aa11');
  assert.match(add(1).out, /among the authors of ex-vault-0n9-3/);
});

test('evidence.js, 10-17: a pass from Codex mode when the surface is ChatGPT plain chat is refused and kept as a side arm', () => {
  const { root, ev, add } = setup();
  ev('state', ID, 'deployed', '--sha', 'd478aa11');
  assert.match(add(1, ['--mode', 'codex']).out, /not verification of ex-vault-0n9-3 \(D2\): observed on ChatGPT web, codex/);
  assert.match(ev('add', ID, '--criterion', '1', '--result', 'pass', '--surface', 'S2', '--sha', 'd478aa11').out, /\(D2\)/);
  assert.match(ev('add', ID, '--criterion', '1', '--result', 'pass', '--surface', 'S1', '--sha', 'beefbeef').out, /\(D3\): on beefbeef, not the deployed/);
  assert.deepEqual(G.readEvidence(root, ID).map((x) => x.arm), ['side', 'side', 'side']);
});

test('evidence.js: deploy, then a pass per criterion verifies; a re-deploy of the same sha keeps it, a new sha unverifies it', () => {
  const { ev, add, bead } = setup();
  assert.equal(ev('state', ID, 'merged', '--pr', '478').code, 0);
  assert.equal(G.stateOf(bead()), 'merged');
  assert.equal(ev('state', ID, 'deployed', '--sha', 'd478aa11').code, 0);
  assert.equal(add('01').code, 0, '--criterion 01 is criterion 1');
  assert.match(add(2).out, /all criteria verified/);
  assert.equal(G.stateOf(bead()), 'verified');
  assert.equal(add(3).code, 1, 'no criterion 3');
  ev('state', ID, 'deployed', '--sha', 'D478AA1');
  assert.equal(G.stateOf(bead()), 'verified');
  ev('state', ID, 'deployed', '--sha', 'd479bb22');
  assert.equal(G.stateOf(bead()), 'deployed');
  assert.equal(ev('check', ID).code, 1);
});

test('evidence.js: rows recorded before the deploy do not count; the deploy re-evaluates', () => {
  const { ev, add, bead } = setup({ over: { metadata: { deployed_sha: 'd478aa11', deployed_at: '2026-10-13T10:00:00Z' } } });
  add(1); add(2);
  assert.equal(G.stateOf(bead()), null, 'rows at 09:00 for a deploy at 10:00');
  assert.match(ev('check', ID).out, /recorded before the deploy/);
});

test('evidence.js waive and cut, #41: a waiver before the gate with a verified record counts; after the deploy it is refused; a cut closes', () => {
  const { ev, bead, root } = setup();
  assert.equal(ev('waive', ID, '--criterion', '2', '--record', 'dec-x-1', '--risk', 'r').code, 1, 'an unverified record');
  assert.equal(ev('waive', ID, '--criterion', '2', '--record', 'dec-chief-of-staff-41', '--risk', 'skipped columns stay silent').code, 0);
  ev('state', ID, 'deployed', '--sha', 'd478aa11');
  assert.match(ev('waive', ID, '--criterion', '1', '--record', 'dec-chief-of-staff-41', '--risk', 'r').out, /past its gate \(D3\)/);
  assert.equal(ev('cut', ID, '--record', 'dec-chief-of-staff-41', '--reason', 'dropped from the release').code, 0);
  assert.equal(G.stateOf(bead()), 'cut');
  assert.match(ev('check', ID).out, /^cut/);
  assert.equal(G.readEvidenceChecked(root, ID).problem, null);
});

test('warnings.js: list shows counts; ack only from the Delivery Manager\'s role session', () => {
  const { root } = setup();
  const w = W.record(root, { kind: 'probe', bead: 'ex-1', detail: 'no probe', instance: 'builder-1', now: '2026-10-10T08:00:00Z' });
  const run = (argv, who) => warnings.main([...argv, '--project', root], { cwd: root, env, now: NOW, who });
  assert.match(run(['list']).out, /1 open, 0 acknowledged; 1 open over 24 h/);
  assert.match(run(['ack', w.id, '--reason', 'x'], whoFor(root, 'builder-1')).out, /Delivery Manager's to do/);
  assert.match(run(['ack', w.id, '--reason', 'x']).out, /needs the Delivery Manager's role session/);
  assert.equal(run(['ack', w.id, '--reason', 'probe added'], whoFor(root, 'delivery-lead')).code, 0);
  assert.equal(W.list(root)[0].acked_by, 'delivery-lead');
});

test('surface.js check: finds the project from the working directory; a problem exits 1', () => {
  const root = makeProject();
  const out = execFileSync(process.execPath, [path.join(__dirname, 'surface.js'), 'check', 'vault'], { cwd: root, env: { PATH: process.env.PATH } }).toString();
  assert.match(out, /^ok: S1 \(ChatGPT web, plain chat/);
  fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'vault', 'surface.json'), '{"surfaces":[{"id":"S1"}]}');
  assert.equal(surface.main(['check', 'vault', '--project', root], { cwd: root, env }).code, 1);
});

test('evidence.js: a story naming a surface not in surface.json is refused clearly (D2); a hand-appended row breaks the recorded head', () => {
  const { ev, add, root } = setup({ story: STORY.replace('surface: S1', 'surface: S9'), over: { metadata: { surface: 'S9' } } });
  ev('state', ID, 'deployed', '--sha', 'd478aa11');
  assert.match(add(1).out, /names surface S9, which is not in surface\.json \(D2\)/);
  const ok = setup();
  ok.ev('state', ID, 'deployed', '--sha', 'd478aa11');
  ok.add(1);
  const file = G.evidenceFile(ok.root, ID);
  const last = fs.readFileSync(file, 'utf8').trim().split('\n').pop();
  const forged = { ...JSON.parse(last), id: `ev-${ID}-2`, seq: 2, prev: require('crypto').createHash('sha256').update(last).digest('hex').slice(0, 12), criterion: 2 };
  fs.appendFileSync(file, `${JSON.stringify(forged)}\n`);
  assert.match(ok.ev('check', ID).out, /not the recorded row 1/);
});

// Copilot round 2 on #86: the merge records when it was recorded, so a deploy before it (a follow-up
// PR on a story already deployed) is told from the deploy of this merge; a retry keeps the first time.
test('evidence.js: state merged records merged_at; a retry of the same PR keeps it; a new PR moves it', () => {
  const { ev, bead, bd, run } = setup();
  assert.equal(ev('state', ID, 'merged', '--pr', '478').code, 0);
  const first = bead().metadata.merged_at;
  assert.ok(first && !Number.isNaN(Date.parse(first)), 'merged_at is a time');
  ev('state', ID, 'deployed', '--sha', 'd478aa11');
  const later = new Date(Date.parse(first) + 3600e3).toISOString();
  assert.equal(run('delivery-lead', ['state', ID, 'merged', '--pr', '478'], later).code, 0);
  assert.equal(bead().metadata.merged_at, first, 'a retry of the same PR, an hour later, keeps the first time');
  bd.update(ID, { metadata: { ...bead().metadata, merged_at: '2000-01-01T00:00:00.000Z' } });
  assert.equal(bead().metadata.merged_at, '2000-01-01T00:00:00.000Z');
  assert.equal(ev('state', ID, 'merged', '--pr', '479').code, 0);
  assert.notEqual(bead().metadata.merged_at, '2000-01-01T00:00:00.000Z', 'a follow-up PR records its own time');
  assert.equal(bead().metadata.merged_pr, '479');
});
