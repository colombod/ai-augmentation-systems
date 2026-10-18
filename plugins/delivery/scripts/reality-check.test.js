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

function setup() {
  const root = makeProject();
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
  // the Delivery Manager refines a step; a re-plan after the deploy keeps it and stamps the sha
  s.criteria[0].steps[0].action = 'Drop collection.csv into a new plain chat';
  fs.writeFileSync(path.join(root, rc.scriptRel(ID)), JSON.stringify(s));
  deploy('v1.4.2');
  const after = dm('plan', ID, '--attempts', '3');
  assert.match(after.out, /ex-vault-0n9-3-rc-d478aa1: created for the Reality Checker/);
  assert.match(after.out, /warning: the team has no Reality Checker/);
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

test('10-17: a Reality Checker row on the wrong tuple (Codex mode for ChatGPT plain chat) does not count; the right one does', () => {
  const { root, dm, deploy, record, bead, call } = setup();
  deploy('v1.4.2');
  dm('plan', ID);
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
  deploy('v1.4.2');
  dm('plan', ID);
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
  deploy();
  dm('plan', ID);
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
  deploy('v1.4.2');
  dm('plan', ID);
  const fail = record(1, 'fail');
  assert.equal(fail.code, 0, fail.out);
  assert.match(fail.out, /andon:ev-ex-vault-0n9-3-1 raised: area collection stops \(fixes only\) until a pass on the deployed version and a closed A3; draft its problem: a3\.js new --trigger andon:ev-ex-vault-0n9-3-1/);
  assert.equal(Goal.activePause(root, { beadOf: () => bead() }).paused, true);
  assert.deepEqual(fs.readdirSync(path.join(root, '.delivery')).filter((f) => f === 'owner-queue'), [], 'the owner is asked for nothing');
  const retry = record(1, 'pass');
  assert.match(retry.out, /warning w-.*a second run after a fail on the same sha/);
  assert.deepEqual(W.list(root).map((w) => w.kind), ['reality-retry']);
  assert.equal(Goal.activePause(root, { beadOf: () => bead() }).paused, true, 'a pass alone does not lift the andon: its A3 is not closed (R-22)');
  assert.match(record(1, 'pass').out, /already has 2 run\(s\) on d478aa11, the script's cap/);
});

test('a Reality Checker cannot write a row around the script, and a builder cannot record a run at all', () => {
  const { dm, deploy, call, capture } = setup();
  deploy();
  dm('plan', ID);
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
  const { root, bd, deploy, call } = setup();
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
  deploy('v1.4.2');
  dm('plan', ID, '--attempts', '3');
  record(1, 'pass');
  record(2, 'pass');
  assert.equal(G.stateOf(bead()), 'verified');
  record(1, 'fail');
  assert.equal(G.stateOf(bead()), 'deployed');
  assert.match(call(evidence, 'delivery-lead', ['check', ID]).out, /criterion 1: .*is a fail/);
});

test('capture: real-path containment in the shared checkout or the checker\'s own project clone; no symlink escape; published into the shared store', () => {
  const { root, bd, dm, deploy, capture } = setup();
  deploy('v1.4.2');
  dm('plan', ID);
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
  deploy('v1.4.2');
  dm('plan', ID);
  const file = capture('one.txt');
  const run = (n, artifact) => call(rc, 'reality-checker', ['run-record', ID, '--criterion', String(n), '--result', 'pass', '--artifact', artifact, '--observed-version', 'v1.4.2'], T.run);
  assert.equal(run(1, file).code, 0);
  const copy = path.join(path.dirname(file), 'copy.txt');
  fs.copyFileSync(file, copy);
  assert.match(run(2, copy).out, /already backs ev-ex-vault-0n9-3-1 \(criterion 1/);
});

test('Copilot: the script\'s criterion hash and tuple are what count; deployed_version and evidence_head are protected bead fields', () => {
  const { root, bd, dm, deploy, record } = setup();
  deploy('v1.4.2');
  dm('plan', ID);
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

test('a side-arm run does not use up the cap', () => {
  const { dm, deploy, record } = setup();
  deploy('v1.4.2');
  dm('plan', ID);
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
