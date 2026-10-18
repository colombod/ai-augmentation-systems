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
  const capture = (name = 'c1.txt') => {
    const dir = path.join(root, '.delivery', 'evidence', 'artifacts', ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), 'Imported 212 cards from collection.csv (v1.4.2)\n');
    return path.join(dir, name);
  };
  const record = (n, result, extra = [], now = T.run) => call(rc, 'reality-checker', ['run-record', ID, '--criterion', String(n), '--result', result, '--artifact', capture(), '--observed-version', 'v1.4.2', ...extra], now);
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
  assert.match(row.capture.path, /^artifacts\/ex-vault-0n9-3\/c1\.txt$/);
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
  assert.match(fail.out, /andon:ev-ex-vault-0n9-3-1 raised: work pauses until a pass follows/);
  assert.equal(Goal.activePause(root, { beadOf: () => bead() }).paused, true);
  assert.deepEqual(fs.readdirSync(path.join(root, '.delivery')).filter((f) => f === 'owner-queue'), [], 'the owner is asked for nothing');
  const retry = record(1, 'pass');
  assert.match(retry.out, /warning w-.*a second run after a fail on the same sha/);
  assert.deepEqual(W.list(root).map((w) => w.kind), ['reality-retry']);
  assert.equal(Goal.activePause(root, { beadOf: () => bead() }).paused, false, 'the pass lifts the andon');
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
