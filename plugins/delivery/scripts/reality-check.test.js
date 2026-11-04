// scripts/reality-check.test.js — the Reality Checker (R-33, R-05, R-07) replayed on Vault moments:
// vault-0n9.3 (the chat-drop import, #478) on S1, ChatGPT web in plain chat, which no test reaches.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const Goal = require('./lib/goal.js');
const { loadManifest, validateManifest } = require('./lib/manifest.js');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const rc = require('./reality-check.js');
const evidence = require('./evidence.js');
const ownerQueue = require('./owner-queue.js');
const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const ID = 'ex-vault-0n9-3';
const SHA = 'd478aa11';
const T = { plan: '2026-10-13T08:00:00Z', deploy: '2026-10-13T09:00:00Z', run: '2026-10-13T10:00:00Z' };
const whoFor = (root, instance) => ({ root, team: loadManifest(root).team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `t@pc/${instance}` });

function setup(project = {}) {
  const root = makeProject(project);
  const bd = memBd([storyBead({ assignee: 't@pc/builder-1' })]);
  const call = (mod, instance, argv, now) => mod.main(argv, { cwd: root, env: {}, bd, now, who: whoFor(root, instance) });
  const dm = (...argv) => call(rc, 'delivery-lead', argv, T.plan);
  const deploy = (version) => call(evidence, 'delivery-lead', ['state', ID, 'deployed', '--sha', SHA, ...(version ? ['--version', version] : [])], T.deploy);
  let k = 0;
  // every capture is a distinct file (a reused capture is refused)
  const capture = (name = 'c1.txt', base = root) => {
    const dir = path.join(base, '.delivery', 'evidence', 'artifacts', ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `Imported 212 cards from collection.csv (v1.4.2), run ${++k}\n`);
    return path.join(dir, name);
  };
  const record = (n, result, extra = [], now = T.run) => call(rc, 'reality-checker', ['run-record', ID, '--criterion', String(n), '--result', result, '--artifact', capture(`c${n}-${k + 1}.txt`), '--observed-version', 'v1.4.2', ...extra], now);
  return { root, bd, call, dm, deploy, record, capture, bead: () => bd.show(ID) };
}

test('plan: the Delivery Manager writes the script from the story; after the deploy it dispatches one check bead per sha', () => {
  const { root, bd, call, dm, deploy } = setup();
  assert.match(call(rc, 'builder-1', ['plan', ID]).out, /the Delivery Manager's to do/);
  const before = dm('plan', ID);
  assert.equal(before.code, 0, before.out);
  assert.match(before.out, /2 criterion group\(s\) on S1, cap 2 attempts and 30 minutes\nnot deployed yet/);
  const s = JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8'));
  assert.deepEqual(s.surface, { id: 'S1', host: 'chatgpt.com', app: 'ChatGPT web', mode: 'plain chat', install_artifact: 'connector from the shipped plugin' });
  assert.deepEqual(s.criteria.map((g) => g.criterion), [1, 2]);
  assert.match(s.criteria[0].steps[0].expect, /^the chat shows the summary and the server log shows the file argument$/);
  assert.match(s.account.signin, /owner queue \(kind signin, consent or payment\)/);
  assert.ok(!JSON.stringify(s).match(/password"\s*:/i), 'no secret field');
  // the Delivery Manager refines a step; the deploy dispatches the check and stamps the sha, keeping it
  s.criteria[0].steps[0].action = 'Drop collection.csv into a new plain chat';
  fs.writeFileSync(path.join(root, rc.scriptRel(ID)), JSON.stringify(s));
  const deployed = deploy('v1.4.2');
  assert.equal(deployed.code, 0, deployed.out);
  assert.match(deployed.out, /ex-vault-0n9-3-rc-d478aa1: created for the Reality Checker/);
  assert.match(deployed.out, /warning: the team has no Reality Checker/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8')).artifact.deployed_sha, SHA);
  const after = dm('plan', ID, '--attempts', '3');
  assert.match(after.out, /ex-vault-0n9-3-rc-d478aa1: already dispatched/);
  const again = JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8'));
  assert.equal(again.criteria[0].steps[0].action, 'Drop collection.csv into a new plain chat');
  assert.deepEqual([again.artifact.deployed_sha, again.artifact.version, again.cap.attempts], [SHA, 'v1.4.2', 3]);
  const child = bd.show(`${ID}-rc-d478aa1`);
  assert.deepEqual([child.parent, child.labels, child.metadata.reality_check_for], [ID, ['reality-check'], ID]);
  assert.ok(!G.isStoryBead(child), 'the check bead is not a story: it has no done gate of its own');
  const parentStory = G.parseStory(fs.readFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), 'utf8'));
  assert.deepEqual(G.claimDivergence({ story: null, isStory: false, bead: child, parent: bd.show(ID), parentStory }), [], 'claiming it adds no scope warning');
  assert.match(dm('plan', ID).out, /already dispatched/);
});

test('7k3.1.1: a story the Reality Checker verifies is neither ready nor deployed without its script; once planned, the deploy dispatches the check', async () => {
  const { root, bd, call, dm, deploy, bead } = setup({ checkScript: false });
  const readyNow = () => require('./ready.js').main([ID], { cwd: root, env: {}, bd, now: T.plan, who: whoFor(root, 'delivery-lead') });
  const pre = await readyNow();
  assert.equal(pre.code, 1, pre.out);
  assert.match(pre.out, /block R-33 reality-check-script: criteria 1, 2 are checked on S1 by the Reality Checker, and no reality-check script is planned/);
  const refused = deploy('v1.4.2');
  assert.equal(refused.code, 1);
  assert.match(refused.out, /ex-vault-0n9-3 is not marked deployed: criteria 1, 2 are checked on S1 by the Reality Checker and no reality-check script is planned/);
  assert.equal(G.stateOf(bead()), null, 'nothing recorded');
  assert.equal(bead().metadata.deployed_sha, undefined);
  assert.equal(bd.show(`${ID}-rc-d478aa1`), null, 'no check bead');
  // planned: ready, and the deploy creates the check bead with the script stamped with its sha
  assert.equal(dm('plan', ID).code, 0);
  const post = await readyNow();
  assert.equal(post.code, 0, post.out);
  assert.doesNotMatch(post.out, /reality-check-script/);
  const ok = deploy('v1.4.2');
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /ex-vault-0n9-3-rc-d478aa1: created for the Reality Checker/);
  assert.equal(bd.show(`${ID}-rc-d478aa1`).metadata.deployed_sha, SHA);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8')).artifact.deployed_sha, SHA);
  // a reworded criterion is a step group the script lacks: a new deploy is refused until it is planned again
  const story = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace('with the card count', 'with the card count and the deck name'));
  const stale = call(evidence, 'delivery-lead', ['state', ID, 'deployed', '--sha', 'e5f6a7b8'], T.run);
  assert.match(stale.out, /criteria 1 are checked on S1 by the Reality Checker and its script has no step group for their current wording/);
  assert.equal(bead().metadata.deployed_sha, SHA, 'the earlier deploy stands');
});

// 7k3.1.1 review: a bug checked on a surface has no story to plan a script from; its deploy says so
test('7k3.1.1: a deploy of a bead that names a surface but has no story file warns that its check cannot run', () => {
  const root = makeProject();
  const fix = storyBead({ id: 'ex-fix-1', labels: ['bug'], metadata: { story_file: undefined } });
  const bd = memBd([fix, storyBead({ assignee: 't@pc/builder-1' })]);
  const deploy = (id) => evidence.main(['state', id, 'deployed', '--sha', SHA], { cwd: root, env: {}, bd, now: T.deploy, who: whoFor(root, 'delivery-lead') });
  const r = deploy('ex-fix-1');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^warning: ex-fix-1 names surface S1 but has no readable story file and states no criteria of its own \(a "Done when:" paragraph in its description\), so no reality-check script can be planned for it and its check on the customer's app cannot run/m);
  // a story with its script planned gets its check bead, and no such warning
  const ok = deploy(ID);
  assert.equal(ok.code, 0, ok.out);
  assert.doesNotMatch(ok.out, /no readable story file/);
});

// 7k3.1.1.1.5: a deployed fix states its criteria in its description; its check is planned from them
test('7k3.1.1.1.5: a fix with no story file is planned from the criteria in its description, on its parent\'s surface, and its deploy dispatches the check', () => {
  const root = makeProject();
  const DESC = 'Reported on the chat.\n\nDone when: (1) the chat shows the summary; (2) the server log shows the file argument; and (3) tests cover each.\n\nRelated: ex-other.';
  const fix = storyBead({ id: 'ex-fix-2', title: 'The summary is missing', labels: ['bug'], parent: ID, description: DESC, metadata: { story_file: undefined, roadmap_ref: undefined, surface: undefined } });
  const bare = storyBead({ id: 'ex-fix-3', labels: ['bug'], parent: null, description: 'Done when: the chat shows the summary.', metadata: { story_file: undefined, roadmap_ref: undefined, surface: undefined } });
  const vague = storyBead({ id: 'ex-fix-4', labels: ['bug'], description: 'Fix the summary. Proof: it shows.', metadata: { story_file: undefined } });
  const bd = memBd([fix, bare, vague, storyBead({ assignee: 't@pc/builder-1' })]);
  const call = (mod, argv, now) => mod.main(argv, { cwd: root, env: {}, bd, now, who: whoFor(root, 'delivery-lead') });
  const planned = call(rc, ['plan', 'ex-fix-2'], T.plan);
  assert.equal(planned.code, 0, planned.out);
  assert.match(planned.out, /3 criterion group\(s\) on S1/);
  const s = JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel('ex-fix-2')), 'utf8'));
  assert.deepEqual(s.criteria.map((g) => g.text), ['the chat shows the summary', 'the server log shows the file argument', 'tests cover each.']);
  assert.equal(s.story_file, null);
  // the deploy dispatches the check bead for its sha, and the Reality Checker's row binds to criterion 1
  const d = call(evidence, ['state', 'ex-fix-2', 'deployed', '--sha', SHA], T.deploy);
  assert.equal(d.code, 0, d.out);
  assert.match(d.out, /ex-fix-2-rc-d478aa1: created for the Reality Checker/);
  assert.doesNotMatch(d.out, /no readable story file/);
  assert.match(bd.show('ex-fix-2-rc-d478aa1').title, /^Reality check: The summary is missing on S1 at d478aa1$/);
  assert.match(call(evidence, ['add', 'ex-fix-2', '--criterion', '9', '--result', 'pass'], T.run).out, /has no criterion 9 \(criteria: 1, 2, 3\)/);
  // no parent and no initiative of its own: no surface, and the refusal says how to name one
  assert.match(call(rc, ['plan', 'ex-fix-3'], T.plan).out, /names no declared customer surface .*metadata initiative=<slug> and surface=<id>/);
  bd.update('ex-fix-3', { metadata: { initiative: 'vault', surface: 'S1' } });
  const named = call(rc, ['plan', 'ex-fix-3'], T.plan);
  assert.equal(named.code, 0, named.out);
  assert.match(named.out, /1 criterion group\(s\) on S1/);
  // its child takes the initiative and surface the parent names in metadata
  bd.beads.set('ex-fix-3.1', storyBead({ id: 'ex-fix-3.1', labels: ['bug'], parent: 'ex-fix-3', description: 'Done when: the log shows it.', metadata: { story_file: undefined, roadmap_ref: undefined, surface: undefined } }));
  assert.match(call(rc, ['plan', 'ex-fix-3.1'], T.plan).out, /1 criterion group\(s\) on S1/);
  // a bead that states no criteria is still refused, and says where they go
  assert.match(call(rc, ['plan', 'ex-fix-4'], T.plan).out, /has no readable story file .* and states no criteria of its own \(a "Done when:" paragraph in its description, or metadata.criteria\)/);
});

// 7k3.1.1.1.5 review: criteria stated on the bead are pinned, so cutting one after deploy cannot verify it
test('7k3.1.1.1.5: a criterion cut from the bead after deploy does not let it verify, from the description or metadata.criteria; with the criteria intact it verifies', () => {
  const root = makeProject();
  const DESC = 'Done when: (1) the chat shows the summary; (2) the log shows the file; and (3) the card count shows.';
  const mk = (id, meta = {}) => storyBead({ id, title: 'Fix', labels: ['bug'], parent: ID, description: DESC, metadata: { story_file: undefined, roadmap_ref: undefined, surface: undefined, ...meta } });
  const store = memBd([mk('ex-pin-1'), mk('ex-pin-2'), mk('ex-pin-3', { criteria: ['the chat shows the summary', 'the log shows the file', 'the card count shows'] }), mk('ex-pin-4'), storyBead({ assignee: 't@pc/builder-1' })]);
  const call = (mod, instance, argv, now) => mod.main(argv, { cwd: root, env: {}, bd: store, now, who: whoFor(root, instance) });
  let k = 0;
  const pass = (id, n) => {
    const dir = path.join(root, '.delivery', 'evidence', 'artifacts', id);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `c${n}-${++k}.txt`);
    fs.writeFileSync(f, `Imported 212 cards (v1.4.2), run ${k}\n`);
    return call(rc, 'reality-checker', ['run-record', id, '--criterion', String(n), '--result', 'pass', '--artifact', f, '--observed-version', 'v1.4.2'], T.run);
  };
  const ship = (id) => {
    const p = call(rc, 'delivery-lead', ['plan', id], T.plan);
    assert.equal(p.code, 0, p.out);
    const d = call(evidence, 'delivery-lead', ['state', id, 'deployed', '--sha', SHA, '--version', 'v1.4.2'], T.deploy);
    assert.equal(d.code, 0, d.out);
  };
  const check = (id) => call(evidence, 'delivery-lead', ['check', id], T.run);
  const verified = (id) => (store.show(id).labels || []).includes(G.STATE.verified);
  // the reviewer's probe: three criteria, one pass row, not verified; the description cut to one: still not
  ship('ex-pin-1');
  assert.ok(store.show('ex-pin-1').metadata.criteria_hash, 'pinned when planned');
  const one = pass('ex-pin-1', 1);
  assert.equal(one.code, 0, one.out);
  assert.equal(check('ex-pin-1').code, 1);
  store.beads.get('ex-pin-1').description = 'Done when: (1) the chat shows the summary.';
  const cut = check('ex-pin-1');
  assert.equal(cut.code, 1, cut.out);
  assert.match(cut.out, /criteria stated on the bead changed since its check was pinned .* \(D1\)/);
  assert.ok(!verified('ex-pin-1'));
  // planning again after the deploy does not re-pin the cut list
  call(rc, 'delivery-lead', ['plan', 'ex-pin-1'], T.run);
  assert.equal(check('ex-pin-1').code, 1);
  // metadata.criteria cut to one: the same
  ship('ex-pin-3');
  assert.equal(pass('ex-pin-3', 1).code, 0);
  store.update('ex-pin-3', { metadata: { ...store.show('ex-pin-3').metadata, criteria: ['the chat shows the summary'] } });
  assert.match(check('ex-pin-3').out, /changed since its check was pinned/);
  // a bead deployed with no stamp (before the pin existed) is held by its planned script's criteria
  ship('ex-pin-4');
  store.update('ex-pin-4', { metadata: { ...store.show('ex-pin-4').metadata, criteria_hash: undefined } });
  store.beads.get('ex-pin-4').description = 'Done when: (1) the chat shows the summary';
  assert.match(check('ex-pin-4').out, /no longer include planned criteria 2, 3 of its check script \(D1\)/);
  // the other direction: every criterion intact and passed verifies
  ship('ex-pin-2');
  for (const n of [1, 2, 3]) { const r = pass('ex-pin-2', n); assert.equal(r.code, 0, r.out); }
  const all = check('ex-pin-2');
  assert.equal(all.code, 0, all.out);
  assert.ok(verified('ex-pin-2'));
});

// 7k3.1.1.1.5 re-review: a bead deployed with no stamp (the beads deployed before the stamp existed) is
// held by what was recorded for it, its check script and its evidence rows; a plan or a deploy never
// pins a cut list after the deploy
function unstamped() {
  const root = makeProject();
  const DESC = 'Done when: (1) the chat shows the summary; (2) the log shows the file; and (3) the card count shows.';
  const mk = (id) => storyBead({ id, title: 'Fix', labels: ['bug'], parent: ID, description: DESC, metadata: { story_file: undefined, roadmap_ref: undefined, surface: undefined } });
  const store = memBd([mk('ex-un-1'), mk('ex-un-2'), mk('ex-un-3'), mk('ex-un-4'), mk('ex-un-5'), storyBead({ assignee: 't@pc/builder-1' })]);
  const verifyRecord = require('./testing/gate-fixture.js').ownerVerify('dec-chief-of-staff-77');
  const call = (mod, instance, argv, now) => mod.main(argv, { cwd: root, env: {}, bd: store, now, verifyRecord, who: whoFor(root, instance) });
  let k = 0;
  const pass = (id, n, now = T.run) => {
    const dir = path.join(root, '.delivery', 'evidence', 'artifacts', id);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `c${n}-${++k}.txt`);
    fs.writeFileSync(f, `Imported 212 cards (v1.4.2), run ${k}\n`);
    return call(rc, 'reality-checker', ['run-record', id, '--criterion', String(n), '--result', 'pass', '--artifact', f, '--observed-version', 'v1.4.2'], now);
  };
  const plan = (id, extra = [], now = T.run) => call(rc, 'delivery-lead', ['plan', id, ...extra], now);
  const deploy = (id, sha = SHA, now = T.deploy) => call(evidence, 'delivery-lead', ['state', id, 'deployed', '--sha', sha, '--version', 'v1.4.2'], now);
  const check = (id, now = T.run) => call(evidence, 'delivery-lead', ['check', id], now);
  const unstamp = (id) => store.update(id, { metadata: { ...store.show(id).metadata, criteria_hash: undefined } });
  const cut = (id) => { store.beads.get(id).description = 'Done when: (1) the chat shows the summary'; };
  const groups = (id) => { try { return JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(id)), 'utf8')).criteria.map((g) => g.criterion); } catch (err) { return null; } };
  return { root, store, call, pass, plan, deploy, check, unstamp, cut, groups };
}

test('7k3.1.1.1.5: an unstamped deployed bead cut to fewer criteria: a plan keeps its script and refuses, and it does not verify (probe a)', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-1', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-1').code, 0);
  t.unstamp('ex-un-1');
  assert.equal(t.pass('ex-un-1', 1).code, 0);
  t.cut('ex-un-1');
  const p = t.plan('ex-un-1');
  assert.equal(p.code, 1, p.out);
  assert.match(p.out, /no longer include planned criteria 2, 3 of its check script \(D1\).*--owner-record/s);
  assert.deepEqual(t.groups('ex-un-1'), [1, 2, 3], 'the script keeps its groups');
  assert.equal(t.store.show('ex-un-1').metadata.criteria_hash, undefined, 'the cut list is not pinned');
  const c = t.check('ex-un-1');
  assert.equal(c.code, 1, c.out);
  assert.match(c.out, /\(D1\)/);
  // the other direction: deployed, unstamped, criteria intact: the first plan pins them and keeps the groups
  assert.equal(t.plan('ex-un-4', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-4').code, 0);
  const pinned = t.store.show('ex-un-4').metadata.criteria_hash;
  t.unstamp('ex-un-4');
  const again = t.plan('ex-un-4');
  assert.equal(again.code, 0, again.out);
  assert.equal(t.store.show('ex-un-4').metadata.criteria_hash, pinned, 'the first plan after the deploy stamps what the bead states');
  assert.deepEqual(t.groups('ex-un-4'), [1, 2, 3]);
});

test('7k3.1.1.1.5: an unstamped deployed bead with no script, cut to fewer criteria than its evidence names: the first plan refuses (probe b)', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-2', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-2').code, 0);
  assert.equal(t.pass('ex-un-2', 1).code, 0);
  assert.equal(t.pass('ex-un-2', 2).code, 0);
  // deployed before the stamp and the script existed: neither is recorded, only the evidence rows
  t.unstamp('ex-un-2');
  fs.rmSync(path.join(t.root, rc.scriptRel('ex-un-2')));
  t.cut('ex-un-2');
  const c = t.check('ex-un-2');
  assert.equal(c.code, 1, c.out);
  assert.match(c.out, /evidence rows .*criteria 2 .*no longer states.*\(D1\)/);
  const p = t.plan('ex-un-2');
  assert.equal(p.code, 1, p.out);
  assert.equal(t.store.show('ex-un-2').metadata.criteria_hash, undefined);
  assert.equal(t.groups('ex-un-2'), null, 'no script is written for the cut list');
  assert.equal(t.check('ex-un-2').code, 1);
  // nothing recorded beyond what the bead states: the first plan stamps what it states then
  assert.equal(t.plan('ex-un-5', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-5').code, 0);
  t.unstamp('ex-un-5');
  fs.rmSync(path.join(t.root, rc.scriptRel('ex-un-5')));
  const first = t.plan('ex-un-5');
  assert.equal(first.code, 0, first.out);
  assert.ok(t.store.show('ex-un-5').metadata.criteria_hash);
  assert.deepEqual(t.groups('ex-un-5'), [1, 2, 3]);
});

test('7k3.1.1.1.5: an unstamped bead whose script names more criteria than it now states is not deployed again, so the deploy never pins the cut list (probe c)', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-3', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-3').code, 0);
  t.unstamp('ex-un-3');
  t.cut('ex-un-3');
  const d = t.deploy('ex-un-3', 'e5f6a7b8', T.run);
  assert.equal(d.code, 1, d.out);
  assert.match(d.out, /not marked deployed: .*no longer include planned criteria 2, 3/);
  const m = t.store.show('ex-un-3').metadata;
  assert.deepEqual([m.deployed_sha, m.criteria_hash], [SHA, undefined], 'the earlier deploy stands, unpinned');
  assert.deepEqual(t.groups('ex-un-3'), [1, 2, 3]);
  assert.equal(t.pass('ex-un-3', 1, '2026-10-13T11:00:00Z').code, 0);
  assert.equal(t.check('ex-un-3', '2026-10-13T11:00:00Z').code, 1);
});

test('7k3.1.1.1.5: criteria changed on purpose after the deploy are re-pinned only under a verifying owner record, which voids the evidence before it', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-1', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-1').code, 0);
  for (const n of [1, 2, 3]) assert.equal(t.pass('ex-un-1', n).code, 0);
  assert.equal(t.check('ex-un-1').code, 0);
  assert.ok((t.store.show('ex-un-1').labels || []).includes(G.STATE.verified));
  const before = t.store.show('ex-un-1').metadata.criteria_hash;
  t.store.beads.get('ex-un-1').description = 'Done when: (1) the chat shows the summary; (2) the log shows the file.';
  assert.match(t.check('ex-un-1').out, /changed since its check was pinned/);
  const bare = t.plan('ex-un-1');
  assert.equal(bare.code, 1, bare.out);
  assert.match(bare.out, /reality-check\.js plan ex-un-1 --owner-record <dec-\.\.\.>/);
  const bad = t.plan('ex-un-1', ['--owner-record', 'dec-nobody-1']);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /dec-nobody-1 does not verify/);
  assert.equal(t.store.show('ex-un-1').metadata.criteria_hash, before, 'nothing re-pinned without the owner');
  assert.deepEqual(t.groups('ex-un-1'), [1, 2, 3]);
  const RESTAMP = '2026-10-13T11:00:00Z';
  const ok = t.plan('ex-un-1', ['--owner-record', 'dec-chief-of-staff-77'], RESTAMP);
  assert.equal(ok.code, 0, ok.out);
  const m = t.store.show('ex-un-1').metadata;
  assert.notEqual(m.criteria_hash, before);
  assert.deepEqual([m.criteria_record, m.criteria_restamped_at], ['dec-chief-of-staff-77', RESTAMP]);
  assert.deepEqual(t.groups('ex-un-1'), [1, 2]);
  assert.ok(!(t.store.show('ex-un-1').labels || []).includes(G.STATE.verified), 'the earlier verification no longer stands');
  // the rows recorded before the re-pin are void, even for the criteria that did not change
  const voided = t.check('ex-un-1', RESTAMP);
  assert.equal(voided.code, 1, voided.out);
  assert.match(voided.out, /recorded before the criteria were re-pinned under dec-chief-of-staff-77/);
  const LATER = '2026-10-13T12:00:00Z';
  for (const n of [1, 2]) { const r = t.pass('ex-un-1', n, LATER); assert.equal(r.code, 0, r.out); }
  const done = t.check('ex-un-1', LATER);
  assert.equal(done.code, 0, done.out);
  // a story bead's criteria are re-recorded through ready.js, not here
  assert.match(t.call(rc, 'delivery-lead', ['plan', ID, '--owner-record', 'dec-chief-of-staff-77'], T.plan).out, /ready\.js/);
});

// 7k3.1.1.1.5 second re-review: a stamped bead cut and deployed again, a pinned bead that is given a
// shorter story file, and a re-pin whose owner record no longer verifies
test('7k3.1.1.1.5: a stamped bead cut to fewer criteria is not deployed again, and no script is written or dispatched from the cut list', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-1', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-1').code, 0);
  const pinned = t.store.show('ex-un-1').metadata.criteria_hash;
  assert.ok(pinned);
  const checks = () => [...t.store.beads.values()].filter((b) => b.parent === 'ex-un-1').length;
  const before = checks();
  t.cut('ex-un-1');
  const d = t.deploy('ex-un-1', 'e5f6a7b8', T.run);
  assert.equal(d.code, 1, d.out);
  assert.match(d.out, /not marked deployed: the criteria stated on the bead changed since its check was pinned .*\(D1\).*--owner-record/s);
  assert.deepEqual(t.groups('ex-un-1'), [1, 2, 3], 'the script keeps its groups');
  assert.equal(checks(), before, 'no check is dispatched for the cut list');
  const m = t.store.show('ex-un-1').metadata;
  assert.deepEqual([m.deployed_sha, m.criteria_hash], [SHA, pinned], 'the earlier deploy and its pin stand');
  // the reviewer's follow-on: the pin cleared and one pass still does not verify 1 of 3
  t.unstamp('ex-un-1');
  assert.equal(t.pass('ex-un-1', 1).code, 0);
  assert.equal(t.check('ex-un-1').code, 1);
  assert.ok(!(t.store.show('ex-un-1').labels || []).includes(G.STATE.verified));
  // the other direction: criteria intact, the same bead deploys again at a new sha
  assert.equal(t.plan('ex-un-4', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-4').code, 0);
  const again = t.deploy('ex-un-4', 'e5f6a7b8', T.run);
  assert.equal(again.code, 0, again.out);
  assert.equal(t.store.show('ex-un-4').metadata.deployed_sha, 'e5f6a7b8');
});

test('7k3.1.1.1.5: a pinned bead given a story file keeps its pin until the story is made ready under the owner\'s record after the pin', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-1', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-1').code, 0);
  // the bead now names the two-criterion story
  t.store.update('ex-un-1', { metadata: { ...t.store.show('ex-un-1').metadata, story_file: 'vault-0n9-3.md', roadmap_ref: 'vault/roadmap.md@abc1234 phase 1' } });
  // the reviewer's probe: two passes on the story's criteria, recorded under the owner's record
  for (const n of [1, 2]) {
    const r = t.call(evidence, 'delivery-lead', ['add', 'ex-un-1', '--criterion', String(n), '--result', 'pass', '--surface', 'S1', '--sha', SHA, '--record', 'dec-chief-of-staff-77'], T.run);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /own criteria were pinned .*\(D1\)/);
  }
  const c = t.check('ex-un-1');
  assert.equal(c.code, 1, c.out);
  assert.match(c.out, /own criteria were pinned .* names story file vault-0n9-3\.md, which was not made ready under the owner's record after the pin \(D1\)/);
  assert.ok(!(t.store.show('ex-un-1').labels || []).includes(G.STATE.verified));
  const p = t.plan('ex-un-1');
  assert.equal(p.code, 1, p.out);
  assert.match(p.out, /ready\.js ex-un-1 --record --owner-record/);
  assert.deepEqual(t.groups('ex-un-1'), [1, 2, 3], 'the script keeps the pinned groups');
  const d = t.deploy('ex-un-1', 'e5f6a7b8', T.run);
  assert.equal(d.code, 1, d.out);
  assert.match(d.out, /not marked deployed: .*ready\.js ex-un-1 --record --owner-record/s);
  // made ready before the pin, or under a record that does not verify: still held
  const ready = (record, at) => t.store.update('ex-un-1', { metadata: { ...t.store.show('ex-un-1').metadata, ready_hash: G.storyHash(G.parseStory(fs.readFileSync(path.join(t.root, '.delivery', 'stories', 'vault-0n9-3.md'), 'utf8'))), ready_at: at, ready_record: record } });
  ready('dec-chief-of-staff-77', '2026-10-13T07:00:00Z');
  assert.match(t.check('ex-un-1').out, /not made ready under the owner's record after the pin/);
  ready('dec-nobody-1', '2026-10-13T11:00:00Z');
  assert.match(t.check('ex-un-1').out, /not made ready under the owner's record after the pin/);
  // the other direction: made ready under the owner's record after the pin, the story's criteria count,
  // and only rows recorded after it
  const READY = '2026-10-13T11:00:00Z';
  ready('dec-chief-of-staff-77', READY);
  const stale = t.check('ex-un-1', READY);
  assert.equal(stale.code, 1, stale.out);
  assert.match(stale.out, /recorded before the criteria were re-pinned under dec-chief-of-staff-77/);
  const LATER = '2026-10-13T12:00:00Z';
  const replan = t.plan('ex-un-1', [], LATER);
  assert.equal(replan.code, 0, replan.out);
  assert.deepEqual(t.groups('ex-un-1'), [1, 2]);
  for (const n of [1, 2]) { const r = t.pass('ex-un-1', n, LATER); assert.equal(r.code, 0, r.out); }
  const done = t.check('ex-un-1', LATER);
  assert.equal(done.code, 0, done.out);
});

test('7k3.1.1.1.5: a re-pin whose owner record no longer verifies does not let the bead verify', () => {
  const t = unstamped();
  assert.equal(t.plan('ex-un-1', [], T.plan).code, 0);
  assert.equal(t.deploy('ex-un-1').code, 0);
  t.store.beads.get('ex-un-1').description = 'Done when: (1) the chat shows the summary; (2) the log shows the file.';
  const RESTAMP = '2026-10-13T11:00:00Z';
  assert.equal(t.plan('ex-un-1', ['--owner-record', 'dec-chief-of-staff-77'], RESTAMP).code, 0);
  const LATER = '2026-10-13T12:00:00Z';
  for (const n of [1, 2]) assert.equal(t.pass('ex-un-1', n, LATER).code, 0);
  assert.equal(t.check('ex-un-1', LATER).code, 0, 'verifies while the record verifies');
  // the record is withdrawn: the gate re-checks it
  const withdrawn = evidence.main(['check', 'ex-un-1'], { cwd: t.root, env: {}, bd: t.store, now: LATER, verifyRecord: require('./testing/gate-fixture.js').ownerVerify(), who: whoFor(t.root, 'delivery-lead') });
  assert.equal(withdrawn.code, 1, withdrawn.out);
  assert.match(withdrawn.out, /re-pinned under dec-chief-of-staff-77, which no longer verifies as the owner's record \(D1\)/);
});

test('7k3.1.1.1.5: a bead with a story file uses the story only, and an unreadable story file does not fall back to the description', () => {
  const root = makeProject();
  const DESC = 'Done when: (1) one; (2) two; (3) three; (4) four.';
  const missing = path.join('.delivery', 'stories', 'missing.md');
  const store = memBd([storyBead({ id: 'ex-sf-1', description: DESC }), storyBead({ id: 'ex-sf-2', description: DESC, metadata: { story_file: missing } }), storyBead({ assignee: 't@pc/builder-1' })]);
  const call = (argv) => rc.main(argv, { cwd: root, env: {}, bd: store, now: T.plan, who: whoFor(root, 'delivery-lead') });
  const ok = call(['plan', 'ex-sf-1']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /2 criterion group\(s\) on S1/, 'the story\'s two criteria, not the description\'s four');
  assert.equal(store.show('ex-sf-1').metadata.criteria_hash, undefined, 'a story is pinned by ready, not here');
  const no = call(['plan', 'ex-sf-2']);
  assert.equal(no.code, 1, no.out);
  assert.match(no.out, /has no readable story file/);
});

test('7k3.1.1: materialise plans the script of every open story that needs one, keeps refined steps, and skips a closed or test-checked story', () => {
  const { planChecks } = require('./materialise.js');
  const root = makeProject({ checkScript: false });
  const S2 = 'ex-vault-0n9-5';
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-5.md'), require('./testing/gate-fixture.js').STORY.replace('surface: S1', 'surface: S2').replace(/by: reality-check/g, 'by: test'));
  const shut = 'ex-vault-0n9-6';
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-6.md'), require('./testing/gate-fixture.js').STORY);
  const bd = memBd([storyBead({ status: 'open' }), storyBead({ id: S2, status: 'open', metadata: { story_file: 'vault-0n9-5.md', surface: 'S2' } }), storyBead({ id: shut, status: 'closed', metadata: { story_file: 'vault-0n9-6.md' } })]);
  const plan = { beads: [ID, S2, shut].map((id) => ({ id, labels: ['roadmap', 'phase-1', 'story'] })).concat([{ id: 'ex-vault-ph1', labels: ['roadmap', 'phase-1'] }]) };
  assert.deepEqual(planChecks({ projectRoot: root, plan, bd, by: 'materialise', at: T.plan }), [ID]);
  const file = path.join(root, rc.scriptRel(ID));
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([s.planned_by, s.criteria.map((g) => g.criterion)], ['materialise', [1, 2]]);
  assert.ok(!fs.existsSync(path.join(root, rc.scriptRel(S2))), 'a scriptable surface checked by tests needs no script');
  assert.ok(!fs.existsSync(path.join(root, rc.scriptRel(shut))), 'a closed story is left alone');
  s.criteria[0].steps[0].action = 'Drop collection.csv into a new plain chat';
  fs.writeFileSync(file, JSON.stringify(s));
  assert.deepEqual(planChecks({ projectRoot: root, plan, bd, by: 'materialise', at: T.plan }), [], 'a covering script is left as it is');
  const story = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace('sees which column was skipped', 'sees which column was skipped and why'));
  assert.deepEqual(planChecks({ projectRoot: root, plan, bd, by: 'materialise', at: T.plan }), [ID], 'a reworded criterion is planned again');
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(again.criteria[0].steps[0].action, 'Drop collection.csv into a new plain chat', 'the unchanged criterion keeps its refined step');
  assert.match(again.criteria[1].text, /and why\.$/);
});

test('10-17: a Reality Checker row on the wrong tuple (Codex mode for ChatGPT plain chat) does not count; the right one does', () => {
  const { root, dm, deploy, record, bead, call } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const wrong = record(1, 'pass', ['--mode', 'codex']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /not verification of ex-vault-0n9-3 \(D2\): observed on ChatGPT web, codex/);
  assert.equal(G.readEvidence(root, ID)[0].arm, 'side');
  assert.equal(record(1, 'pass').code, 0);
  const done = record(2, 'pass');
  assert.match(done.out, /all criteria verified: state-verified/);
  assert.equal(G.stateOf(bead()), 'verified');
  const row = G.readEvidence(root, ID).pop();
  assert.equal(row.via, 'reality-check');
  assert.equal(row.by, 'reality-checker');
  assert.equal(row.observed_version, 'v1.4.2');
  assert.match(row.capture.path, /^artifacts\/ex-vault-0n9-3\/c2-\d+\.txt$/);
  assert.match(row.capture.sha256, /^[0-9a-f]{16}$/);
  assert.equal(call(evidence, 'delivery-lead', ['check', ID]).code, 0, 'the done gate counts the pass rows');
});

test('a pass whose observed version differs from the deployed sha is refused, and nothing is recorded', () => {
  const { root, dm, deploy, call, capture } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const run = (version) => call(rc, 'reality-checker', ['run-record', ID, '--criterion', '1', '--result', 'pass', '--artifact', capture(), '--observed-version', version], T.run);
  const r = run('v1.4.1');
  assert.equal(r.code, 1);
  assert.match(r.out, /the surface shows v1\.4\.1, not the deployed v1\.4\.2 \(d478aa11\): that run checked another build/);
  assert.match(run('d477ffee').out, /not the deployed/);
  assert.deepEqual(G.readEvidence(root, ID), []);
  assert.equal(run('D478AA1').code, 0, 'the sha as the surface shows it counts too');
});

test('run-record refuses a capture outside the artifacts directory, a missing one, a criterion not in the script, and a stale script', () => {
  const { root, dm, deploy, call, capture, bd } = setup();
  dm('plan', ID);
  deploy();
  const run = (artifact, n = '1') => call(rc, 'reality-checker', ['run-record', ID, '--criterion', n, '--result', 'pass', '--artifact', artifact, '--observed-version', SHA], T.run).out;
  const stray = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')), 'shot.png');
  fs.writeFileSync(stray, 'x');
  assert.match(run(stray), /must be under \.delivery\/evidence\/artifacts\/ex-vault-0n9-3\//);
  assert.match(run(path.join(root, '.delivery', 'evidence', 'artifacts', ID, 'none.png')), /no capture at/);
  assert.match(run(capture(), '3'), /criterion 3 is not in the script/);
  bd.update(ID, { metadata: { ...bd.show(ID).metadata, deployed_sha: 'e5550000' } });
  assert.match(run(capture()), /the script is for d478aa11, not the deployed e5550000/);
  assert.deepEqual(G.readEvidence(root, ID), []);
});

test('#478 on 10-13: a fail row raises the andon with no owner involvement; a blind retry is a warning; the cap stops a third run', () => {
  const { root, dm, deploy, record, bead } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const fail = record(1, 'fail');
  assert.equal(fail.code, 0, fail.out);
  assert.match(fail.out, /andon:ev-ex-vault-0n9-3-1 raised: area collection stops \(fixes only\) until its A3 closes on a proved fix; draft its problem: a3\.js new --trigger andon:ev-ex-vault-0n9-3-1/);
  assert.deepEqual(Goal.activePause(root, { beadOf: () => bead() }).stops, [{ trigger: 'andon:ev-ex-vault-0n9-3-1', area: 'collection' }], 'its area stops; the team is not paused');
  assert.deepEqual(fs.readdirSync(path.join(root, '.delivery')).filter((f) => f === 'owner-queue'), [], 'the owner is asked for nothing');
  const retry = record(1, 'pass');
  assert.match(retry.out, /warning w-.*a second run after a fail on the same sha/);
  assert.deepEqual(W.list(root).map((w) => w.kind), ['reality-retry']);
  assert.equal(Goal.activePause(root, { beadOf: () => bead() }).stops.length, 1, 'a pass alone does not lift the andon: its A3 is not closed (R-22)');
  assert.match(record(1, 'pass').out, /already has 2 run\(s\) on d478aa11, the script's cap/);
});

test('a Reality Checker cannot write a row around the script, and a builder cannot record a run at all', () => {
  const { dm, deploy, call, capture } = setup();
  dm('plan', ID);
  deploy();
  assert.match(call(evidence, 'reality-checker', ['add', ID, '--criterion', '1', '--result', 'pass', '--surface', 'S1', '--sha', SHA], T.run).out, /records through the script/);
  assert.match(call(rc, 'builder-1', ['run-record', ID, '--criterion', '1', '--result', 'pass', '--artifact', capture(), '--observed-version', SHA], T.run).out, /the Delivery Manager's to do/);
});

test('10-17 21:00: the owner queue refuses a verification step and routes it to the Reality Checker', () => {
  const root = makeProject();
  const add = (extra) => ownerQueue.main(['add', '--where', 'ChatGPT web', '--steps', 'open a plain chat and drop the file', ...extra], { cwd: root, env: {}, who: whoFor(root, 'chief-of-staff') });
  for (const r of [add(['--kind', 'signin', '--what', 'Run the CSV drop in ChatGPT and tell me what you see']), add(['--kind', 'verification', '--what', 'Import the collection'])]) {
    assert.equal(r.code, 1);
    assert.match(r.out, /it plans a reality check \(`reality-check\.js plan <bead>`\) and the Reality Checker runs it/);
  }
  assert.equal(add(['--kind', 'signin', '--what', 'Sign in to the test account in ChatGPT web']).code, 0, 'a sign-in the check needs is an owner step');
});

test('R-05: a builder, the Chief of Staff and the Product Manager cannot drive computer use or a browser; the Reality Checker can, on a desktop host', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lane-'));
  const lane = (role, toolName, over = {}) => decideLane({ toolName, toolInput: {}, policy: { ...loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` }), ...over }, roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
  for (const role of ['builder', 'chief-of-staff', 'product-manager', 'delivery-lead']) {
    for (const tool of ['mcp__computer-use__app_click', 'mcp__claude-in-chrome__navigate', 'mcp__Claude_Browser__computer']) {
      const d = lane(role, tool);
      assert.equal(d.allow, false, `${role} ${tool}`);
      assert.match(d.reason, /real-surface runs belong to the Reality Checker, with a script/);
    }
  }
  assert.equal(lane('builder', 'mcp__Claude_Browser__navigate', { reach: true }).allow, true, 'a manifest opt-in (reach) lets a builder check its own UI');
  assert.equal(lane('reality-checker', 'mcp__computer-use__app_screenshot').allow, true);
  const bash = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/reality-checker' }), roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false }).allow;
  assert.equal(bash(`node ${PLUGIN_ROOT}/scripts/reality-check.js run-record ${ID} --criterion 1 --result pass --artifact a --observed-version v`), true);
  assert.equal(bash(`node ${PLUGIN_ROOT}/scripts/evidence.js add ${ID} --criterion 1`), false, 'no row around the script');
  assert.equal(bash('git push origin main'), false);
  assert.equal(decideLane({ toolName: 'Write', toolInput: { file_path: path.join(roleDir, 'product', 'src', 'x.js') }, policy: loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/reality-checker' }), roleDir, groups, pluginRoot: PLUGIN_ROOT }).allow, false, 'never code');
  // the manifest cannot hand the owner's desktop back to a manager
  const { team, hosts } = loadManifest(makeProject());
  const withReach = (id) => ({ ...team, roles: team.roles.map((r) => (r.id === id ? { ...r, reach: true } : r)) });
  assert.ok(validateManifest(withReach('chief-of-staff'), hosts).some((p) => /"chief-of-staff" cannot have "reach"/.test(p)));
  assert.ok(validateManifest(withReach('product-manager'), hosts).some((p) => /cannot have "reach"/.test(p)));
  assert.deepEqual(validateManifest(withReach('builder'), hosts), []);
});

test('start.js: the Reality Checker is on by default when a declared surface is not scriptable, and in full; opt-in otherwise', () => {
  const { presetRoles, unscriptableSurfaces } = require('./start.js');
  const root = makeProject();
  assert.deepEqual(unscriptableSurfaces(root), ['vault/S1']);
  assert.ok(presetRoles('minimal', { unscriptable: unscriptableSurfaces(root) }).includes('reality-checker'));
  assert.ok(!presetRoles('minimal').includes('reality-checker'));
  assert.ok(presetRoles('minimal', { realityChecker: true }).includes('reality-checker'));
  assert.equal(presetRoles('full').filter((r) => r === 'reality-checker').length, 1);
});

test('/delivery:team lists the reality checks still open', () => {
  const { gateStatus } = require('./team-status.js');
  const root = makeProject();
  const s = gateStatus(root, loadManifest(root).team, { storyBeads: () => [], checkBeads: () => [
    { id: `${ID}-rc-d478aa1`, labels: ['reality-check'], status: 'open', assignee: 't@pc/reality-checker' },
    { id: 'ex-vault-wxy-6-rc-abc1234', labels: ['reality-check'], status: 'closed' }] });
  assert.deepEqual(s.realityChecks, [{ id: `${ID}-rc-d478aa1`, assignee: 't@pc/reality-checker' }]);
});

test('the Reality Checker brief renders with the plugin path and tells it to stop at a sign-in wall, never to ask the owner to check', () => {
  const { loadRoleBrief, composeBrief } = require('./lib/compose-brief.js');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'testing', 'manifest', f), 'utf8'));
  const team = read('team.json');
  const role = { id: 'reality-checker', brief: 'delivery/reality-checker', host: 'pc', model: 'sonnet' };
  team.roles.push(role);
  const text = composeBrief({ team, hosts: read('hosts.json'), instance: 'reality-checker', role, brief: loadRoleBrief(PLUGIN_ROOT, '/nonexistent', role.brief), rules: fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'team-rules.md'), 'utf8'), pluginRoot: PLUGIN_ROOT });
  assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(text.includes(`node ${path.join(PLUGIN_ROOT, 'scripts', 'reality-check.js')} run-record`));
  assert.match(text, /If a run hits a sign-in, consent or payment wall, stop/);
  assert.match(text, /Asking the owner to check, try or look at anything is never an owner step/);
});

// ---- fix round (PR 53 review) ----

test('R-11: a Delivery Manager pass on a reality-check criterion is a side arm unless it cites a verified owner record', () => {
  const { root, bd, dm, deploy, call } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const add = (n, extra = []) => evidence.main(['add', ID, '--criterion', String(n), '--result', 'pass', '--surface', 'S1', '--sha', SHA, ...extra], { cwd: root, env: {}, bd, now: T.run, who: whoFor(root, 'delivery-lead'), verifyRecord: require('./testing/gate-fixture.js').ownerVerify('dec-chief-of-staff-41') });
  const r = add(1);
  assert.equal(r.code, 1);
  assert.match(r.out, /criterion 1 is verified by a reality check \(R-33\)/);
  assert.match(add(1, ['--record', 'dec-x-9']).out, /dec-x-9 does not verify/);
  assert.equal(add(1, ['--record', 'dec-chief-of-staff-41']).code, 0, "the owner's record lets a DM row count");
  // a row written by hand as the DM's does not count at the gate either
  const G2 = require('./lib/gates.js');
  const story = G2.parseStory(fs.readFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), 'utf8'));
  const c2 = story.criteria[1];
  const row = { id: 'ev-x-9', type: 'row', criterion: 2, criterion_hash: G2.criterionHash(c2), result: 'pass', arm: 'main', surface: 'S1', tuple: { host: 'chatgpt.com', app: 'ChatGPT web', mode: 'plain chat', install_artifact: 'connector from the shipped plugin' }, sha: SHA, by: 'delivery-lead', actor: 't@pc/delivery-lead', at: T.run };
  const surface = require('./lib/surface.js').loadSurface(root, 'vault').surfaces[0];
  assert.match(G2.rowProblem(row, { c: c2, surface, sha: SHA, authors: { actors: [], roles: [] } }), /not a reality check/);
  assert.equal(call(evidence, 'delivery-lead', ['check', ID]).code, 1);
});

test('the done gate counts the latest main-arm row per criterion on the deployed sha: a fail after a pass un-verifies', () => {
  const { dm, deploy, record, bead, call } = setup();
  dm('plan', ID, '--attempts', '3');
  deploy('v1.4.2');
  record(1, 'pass');
  record(2, 'pass');
  assert.equal(G.stateOf(bead()), 'verified');
  record(1, 'fail');
  assert.equal(G.stateOf(bead()), 'deployed');
  assert.match(call(evidence, 'delivery-lead', ['check', ID]).out, /criterion 1: .*is a fail/);
});

test('capture: real-path containment in the shared checkout or the checker\'s own project clone; no symlink escape; published into the shared store', () => {
  const { root, bd, dm, deploy, capture } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-role-'));
  const who = { ...whoFor(root, 'reality-checker'), roleDir };
  const out = (artifact) => rc.main(['run-record', ID, '--criterion', '1', '--result', 'pass', '--artifact', artifact, '--observed-version', 'v1.4.2'], { cwd: roleDir, env: {}, now: T.run, who, bd }).out;
  // an outside directory that merely contains the artifacts suffix
  assert.match(out(capture('s.txt', fs.mkdtempSync(path.join(os.tmpdir(), 'evil-')))), /must be under/);
  // a symlink in the bead's own directory pointing outside
  const link = path.join(root, '.delivery', 'evidence', 'artifacts', ID, 'hosts.txt');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync('/etc/hosts', link);
  assert.match(out(link), /must be under/);
  // a capture in the checker's project clone, given relative to its role directory, is copied into the shared store
  capture('clone.txt', path.join(roleDir, 'project'));
  assert.match(out(`project/.delivery/evidence/artifacts/${ID}/clone.txt`), /criterion 1 pass/);
  const row = G.readEvidence(root, ID).pop();
  assert.equal(row.capture.path, `artifacts/${ID}/clone.txt`);
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'evidence', row.capture.path)), 'the row names a file in the shared store');
});

test('capture reuse: a capture already cited for another bead, criterion or sha is refused', () => {
  const { root, dm, deploy, call, capture } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  const file = capture('one.txt');
  const run = (n, artifact) => call(rc, 'reality-checker', ['run-record', ID, '--criterion', String(n), '--result', 'pass', '--artifact', artifact, '--observed-version', 'v1.4.2'], T.run);
  assert.equal(run(1, file).code, 0);
  const copy = path.join(path.dirname(file), 'copy.txt');
  fs.copyFileSync(file, copy);
  assert.match(run(2, copy).out, /already backs ev-ex-vault-0n9-3-1 \(criterion 1/);
});

test('Copilot: the script\'s criterion hash and tuple are what count; deployed_version and evidence_head are protected bead fields', () => {
  const { root, bd, dm, deploy, record } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  // the surface declaration changes after planning: a run that followed the old script is a side arm
  const file = path.join(root, '.delivery', 'initiatives', 'vault', 'surface.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.surfaces[0].install_artifact = 'connector from the 1.5 zip';
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.match(record(1, 'pass').out, /\(D2\)/);
  doc.surfaces[0].install_artifact = 'connector from the shipped plugin';
  fs.writeFileSync(file, JSON.stringify(doc));
  // a reworded criterion: the old script group no longer matches
  const story = path.join(root, '.delivery', 'stories', 'vault-0n9-3.md');
  fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace('with the card count', 'with the card count and deck name'));
  assert.match(record(1, 'pass').out, /criterion 1 changed since the script was planned/);
  void bd;
  const { decideBd } = require('../hooks/scripts/bd-guard.js');
  const fake = { show: () => ({ id: 'mine', status: 'in_progress', assignee: 'me@pc/builder-1', labels: ['story'], metadata: { story_file: 'x.md' } }) };
  for (const k of ['deployed_version', 'evidence_head']) {
    const r = decideBd({ command: `bd update mine --metadata '{"${k}":"x"}'`, actor: 'me@pc/builder-1', roleId: 'builder', staleHours: 2, bd: fake, now: T.run });
    assert.ok(r && r.reason, k);
  }
});

test('Copilot 470: the Delivery Manager refines the shared script through reality-check.js refine; others cannot', () => {
  const { root, dm, call } = setup();
  dm('plan', ID);
  const r = dm('refine', ID, '--criterion', '1', '--step', '1', '--action', 'Drop collection.csv into a new plain chat', '--capture', 'screenshot,page-text');
  assert.equal(r.code, 0, r.out);
  dm('refine', ID, '--criterion', '1', '--add-step', '--action', 'Ask for the deck count', '--expect', 'the chat answers 3 decks');
  dm('refine', ID, '--read-on-screen', 'the connector about line', '--account', 'vault-test-1');
  const s = JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8'));
  assert.equal(s.criteria[0].steps[0].action, 'Drop collection.csv into a new plain chat');
  assert.deepEqual(s.criteria[0].steps[0].capture, ['screenshot', 'page-text']);
  assert.equal(s.criteria[0].steps[1].expect, 'the chat answers 3 decks');
  assert.deepEqual([s.artifact.read_on_screen, s.account.name], ['the connector about line', 'vault-test-1']);
  assert.match(call(rc, 'reality-checker', ['refine', ID, '--criterion', '1', '--step', '1', '--action', 'x']).out, /the Delivery Manager's to do/);
  assert.match(dm('refine', ID, '--account', 'hunter2-password').out, /a name, never a secret/);
});

// 7k3.1.1.1.4: drafted step commands hold single quotes, which a lane that refuses quote-escaping
// cannot pass as --command; --from reads them from a file, checked whole before anything is written
test('refine --from applies a file of criterion -> command and match, all or nothing', () => {
  const { root, dm } = setup();
  dm('plan', ID);
  const script = () => fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8');
  const write = (name, body) => { const f = path.join(root, name); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
  const quoted = "node -e 'console.log(\"ok\")'";
  const good = write('commands.json', { 1: { command: quoted, match: 'ok\\n' }, 2: { command: 'echo two', match: '^two', step: 1 } });
  const r = dm('refine', ID, '--from', 'commands.json');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /criterion 1 step 1, criterion 2 step 1/);
  const s = JSON.parse(script());
  assert.deepEqual([s.criteria[0].steps[0].command, s.criteria[0].steps[0].match], [quoted, 'ok\\n']);
  assert.deepEqual([s.criteria[1].steps[0].command, s.criteria[1].steps[0].match], ['echo two', '^two']);
  assert.ok(good);
  const before = script();
  for (const [body, why] of [
    [{ 1: { command: 'echo a', match: 'a' }, 9: { command: 'echo b', match: 'b' } }, /criterion 9 is not in the script/],
    [{ 1: { command: 'echo a', match: '(' } }, /criterion 1: match is not a valid regular expression/],
    [{ 1: { command: 'echo a' } }, /criterion 1: command and match must both be non-empty strings/],
    [{ 1: { command: 'echo a', match: 'a', shell: 'x' } }, /criterion 1: unknown key shell/],
    [{ 1: { command: 'echo a', match: 'a', step: 5 } }, /criterion 1 has no step 5/],
    [{ x: { command: 'echo a', match: 'a' } }, /"x" is not a criterion number/],
    [[], /an object of criterion number -> \{command, match\}/],
    ['{not json', /is not JSON/],
  ]) {
    const out = dm('refine', ID, '--from', write('bad.json', body));
    assert.equal(out.code, 1, out.out);
    assert.match(out.out, why);
    assert.equal(script(), before, `nothing written: ${why}`);
  }
  assert.match(dm('refine', ID, '--from', 'missing.json').out, /cannot read missing\.json/);
  assert.match(dm('refine', ID, '--from', 'commands.json', '--criterion', '1').out, /--from takes no other option/);
  for (const flag of [['--account', 'vault-test-1'], ['--read-on-screen', 'the about line'], ['--precondition', 'signed in']]) {
    const out = dm('refine', ID, '--from', 'commands.json', ...flag);
    assert.equal(out.code, 2, flag[0]);
    assert.ok(out.out.includes(`--from takes no other option (got ${flag[0]})`), out.out);
  }
  assert.equal(script(), before, 'a refused option writes nothing');
  for (const [body, why] of [
    [{ 1: { command: 'echo a', match: '   ' } }, /criterion 1: command and match must both be non-empty strings/],
    [{}, /names no criterion/],
  ]) {
    const out = dm('refine', ID, '--from', write('bad.json', body));
    assert.equal(out.code, 1, out.out);
    assert.match(out.out, why);
    assert.equal(script(), before, `nothing written: ${why}`);
  }
});

// --from carries as_role like --as-role: only the operator.js sync form may be marked, and false clears it
test('refine --from sets and clears as_role, and refuses it on any command but operator.js sync', () => {
  const { root, dm } = setup();
  dm('plan', ID);
  const script = () => fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8');
  const step = () => JSON.parse(script()).criteria.find((g) => g.criterion === 1).steps[0];
  const write = (body) => { const f = path.join(root, 'as-role.json'); fs.writeFileSync(f, JSON.stringify(body)); return f; };
  // through the project's launcher: an absolute path inside an installed plugin names its version, which
  // refine refuses inside single quotes (8wz.6: this passed only from a checkout)
  const L = require('./lib/launcher.js');
  assert.equal(L.ensureLauncher(root, PLUGIN_ROOT), null);
  const sync = `${L.launcherCommand(root, 'operator.js')} sync --format-check`;
  let r = dm('refine', ID, '--from', write({ 1: { command: sync, match: 'ok', as_role: true } }));
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([step().command, step().as_role], [sync, true]);
  // a later file that changes only the command of a marked step is checked against the mark it keeps
  const marked = script();
  r = dm('refine', ID, '--from', write({ 1: { command: 'node /p/evidence.js add x --result pass', match: 'x' } }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /criterion 1: --as-role is only for the form/);
  assert.equal(script(), marked, 'a refused command under a kept mark writes nothing');
  r = dm('refine', ID, '--from', write({ 1: { command: `${sync} --json`, match: 'ok' } }));
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([step().command, step().as_role], [`${sync} --json`, true]);
  r = dm('refine', ID, '--from', write({ 1: { command: 'echo plain', match: 'plain', as_role: false } }));
  assert.equal(r.code, 0, r.out);
  assert.equal(step().command, 'echo plain');
  assert.equal(step().as_role, undefined);
  const before = script();
  for (const [body, why] of [
    [{ 1: { command: 'node /p/evidence.js add x --result pass', match: 'x', as_role: true } }, /criterion 1: --as-role is only for the form/],
    [{ 1: { command: sync, match: 'ok', as_role: 'yes' } }, /criterion 1: as_role must be true or false/],
  ]) {
    const out = dm('refine', ID, '--from', write(body));
    assert.equal(out.code, 1, out.out);
    assert.match(out.out, why);
    assert.equal(script(), before, `nothing written: ${why}`);
  }
});

test('a side-arm run does not use up the cap', () => {
  const { dm, deploy, record } = setup();
  dm('plan', ID);
  deploy('v1.4.2');
  record(1, 'pass', ['--mode', 'codex']);
  record(1, 'pass', ['--mode', 'codex']);
  assert.equal(record(1, 'fail').code, 0);
  assert.equal(record(1, 'pass').code, 0);
});

test('reach: refused by manager brief as well as id; the hook ignores reach on a manager even after a hand edit', () => {
  const { team, hosts } = loadManifest(makeProject());
  const cos2 = { ...team, roles: [...team.roles, { id: 'cos2', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus', reach: true }] };
  assert.ok(validateManifest(cos2, hosts).some((p) => /"cos2" cannot have "reach"/.test(p)));
  const { reachOf } = require('./lib/manifest.js');
  assert.equal(reachOf({ id: 'chief-of-staff', brief: 'delivery/chief-of-staff', reach: true }), null);
  assert.equal(reachOf({ id: 'x', brief: 'delivery/product-manager', reach: true }), null);
  assert.equal(reachOf({ id: 'builder', brief: 'delivery/builder', reach: true }), 'local');
  assert.equal(reachOf({ id: 'builder', brief: 'delivery/builder' }), null);
});

test('R-05: a builder\'s opted-in reach is local only: localhost URLs and the preview browser, never the owner\'s Chrome or desktop', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lane-'));
  const policy = { ...loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/builder' }), reach: 'local' };
  const d = (toolName, toolInput = {}) => decideLane({ toolName, toolInput, policy, roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1:8080/x', 'https://app.localhost/', 'http://shop.test/', 'http://[::1]:5173/']) assert.equal(d('mcp__Claude_Browser__navigate', { url }).allow, true, url);
  assert.equal(d('mcp__playwright__browser_navigate', { url: 'http://localhost:3000' }).allow, true);
  const out = d('mcp__Claude_Browser__navigate', { url: 'https://chatgpt.com/' });
  assert.equal(out.allow, false);
  assert.match(out.reason, /local development hosts/);
  assert.equal(d('mcp__playwright__browser_navigate', { url: 'https://localhost.evil.com/' }).allow, false);
  assert.equal(d('mcp__Claude_Browser__computer', { action: 'screenshot' }).allow, true, 'acting in the preview browser');
  assert.equal(d('mcp__claude-in-chrome__navigate', { url: 'http://localhost:3000' }).allow, false, "the owner's own Chrome");
  assert.equal(d('mcp__computer-use__app_click', {}).allow, false, "the owner's desktop");
  // other browser servers are reach tools too, for the hook and the native deny
  const pm = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/product-manager' });
  for (const t of ['mcp__playwright__browser_navigate', 'mcp__chrome-devtools__list_pages', 'mcp__puppeteer__puppeteer_navigate', 'mcp__plugin_x_playwright__browser_snapshot']) {
    assert.equal(decideLane({ toolName: t, toolInput: {}, policy: pm, roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false }).allow, false, t);
  }
  assert.ok(require('./prepare-role.js').REACH_DENY.includes('mcp__playwright'));
});

test('the Reality Checker never handles credentials or the clipboard, and never takes full control: sign-in is an owner-queue step', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/reality-checker' });
  const d = (toolName) => decideLane({ toolName, toolInput: {}, policy, roleDir: os.tmpdir(), groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
  for (const t of ['mcp__claude-in-chrome__request_credentials', 'mcp__computer-use__read_clipboard', 'mcp__computer-use__write_clipboard', 'mcp__computer-use__request_full_control', 'mcp__computer-use__request_teach_access']) {
    const r = d(t);
    assert.equal(r.allow, false, t);
    assert.match(r.reason, /owner queue/);
  }
  assert.equal(d('mcp__computer-use__request_access').allow, true, 'per-app access is how computer use starts');
  const { reachDeny } = require('./prepare-role.js');
  assert.ok(reachDeny(true).includes('mcp__claude-in-chrome__request_credentials'), 'natively too');
  assert.deepEqual(reachDeny('local'), ['mcp__claude-in-chrome', 'mcp__computer-use']);
});

test('/delivery:team warns when the Reality Checker sits on a headless host', () => {
  const { teamStatus, renderStatus } = require('./team-status.js');
  const root = makeProject();
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.push({ id: 'reality-checker', brief: 'delivery/reality-checker', host: 'buildbox', model: 'sonnet' });
  fs.writeFileSync(file, JSON.stringify(team));
  const text = renderStatus(teamStatus(root, { bdCheck: () => true, storyBeads: () => [], checkBeads: () => [], idleBd: { ready: () => [], list: () => [] } }));
  assert.match(text, /Warning: the Reality Checker is on buildbox, a headless host: it cannot drive a browser or desktop app there/);
});

test('R-07: the owner queue refuses paraphrases that ask the owner to check the product, and literal secrets', () => {
  const Q = require('./lib/owner-queue.js');
  const step = (kind, what, steps = 'open a plain chat') => Q.stepProblem({ kind, what, where: 'ChatGPT web', steps });
  for (const [kind, what] of [
    ['signin', 'Look at the chat and tell me if the summary appears'],
    ['account', 'Drop the CSV and confirm the summary shows 212 cards'],
    ['consent', 'Make sure the import works after you approve the connector'],
    ['account', 'Open the app and check the version number'],
    ['signin', 'Sign in, then see whether the deck list loads'],
  ]) assert.equal(step(kind, what).team, 'check', what);
  // real owner steps still pass
  for (const [kind, what, steps] of [
    ['signin', 'Sign in to the test account in ChatGPT web', 'Open chatgpt.com, choose Log in, use the vault-test-1 account'],
    ['consent', 'Approve the connector permissions', 'Click Allow on the consent screen'],
    ['payment', 'Confirm the plan purchase', 'Click Subscribe and confirm the card on file'],
    ['secret', 'Paste the Microsoft client secret into the vault', 'Run `op item edit vault-ms --field secret` and paste it at the prompt'],
  ]) assert.deepEqual(step(kind, what, steps), {}, what);
  // a secret step names where the secret goes, never the secret itself
  assert.match(step('secret', 'Set the API key', 'export API_KEY=sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c').problem, /never the secret itself/);
  assert.match(step('signin', 'Sign in', 'use password: hunter2hunter2').problem, /never the secret itself/);
});
