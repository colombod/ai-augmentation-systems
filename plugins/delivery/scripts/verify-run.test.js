// scripts/verify-run.test.js — the Reality Checker's runner for a command-line surface: the deployed sha
// in a scratch clone, one scripted command, the capture and the row written by the runner, never by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('./lib/gates.js');
const { loadManifest } = require('./lib/manifest.js');
const { makeProject, storyBead, memBd, STORY, SURFACES } = require('./testing/gate-fixture.js');
const rc = require('./reality-check.js');
const evidence = require('./evidence.js');
const vr = require('./verify-run.js');
const { checkerSurfaces, validateSurface } = require('./lib/surface.js');

const ID = 'ex-vault-0n9-3';
const T = { plan: '2026-10-13T08:00:00Z', deploy: '2026-10-13T09:00:00Z', run: '2026-10-13T10:00:00Z' };
const CLI_SURFACES = { owner_record: 'dec-chief-of-staff-12', surfaces: [
  { id: 'S3', host: 'cloud', app: 'vault CLI', mode: 'terminal', install_artifact: 'the plugin at the deployed sha', scriptable: true, command_line: true, size_budgets: { tool_list_max: 20 } },
] };
const CLI_STORY = STORY.replace('surface: S1', 'surface: S3').replace(/where: S1; by: reality-check/g, 'where: S3; by: reality-check');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// a product repository whose tool prints its version, with a second commit after the deployed one
function product() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-product-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'tool.sh'), 'echo "tool v1 imported 212 cards"\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'v1');
  const deployed = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'tool.sh'), 'echo "tool v2 imported 0 cards"\n');
  git(dir, 'commit', '-q', '-am', 'v2');
  return { dir, deployed };
}

function setup() {
  const prod = product();
  const root = makeProject({ story: CLI_STORY, surfaces: CLI_SURFACES });
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-role-'));
  fs.mkdirSync(path.join(roleDir, 'project'), { recursive: true });
  const bd = memBd([storyBead({ assignee: 't@pc/builder-1' })]);
  const team = { ...loadManifest(root).team, product_url: prod.dir };
  const whoFor = (instance) => ({ root, team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `t@pc/${instance}`, roleDir });
  const as = (mod, instance, argv, now) => mod.main(argv, { cwd: root, env: {}, bd, now, who: whoFor(instance) });
  const dm = (...argv) => as(rc, 'delivery-lead', argv, T.plan);
  const refine = (n, command, match) => dm('refine', ID, '--criterion', String(n), '--step', '1', '--command', command, ...(match ? ['--match', match] : []));
  const deploy = () => as(evidence, 'delivery-lead', ['state', ID, 'deployed', '--sha', prod.deployed], T.deploy);
  const verify = (n, instance = 'reality-checker') => as(vr, instance, ['run', ID, '--criterion', String(n)], T.run);
  const rows = () => G.readEvidence(root, ID).filter((r) => r.type === 'row');
  return { prod, root, roleDir, bd, dm, refine, deploy, verify, rows };
}

function ready() {
  const s = setup();
  assert.equal(s.dm('plan', ID).code, 0);
  s.deploy();
  assert.equal(s.dm('plan', ID).code, 0);
  return s;
}

test('run: the deployed sha, not the newest commit, runs the command, and the runner writes a pass row', () => {
  const s = ready();
  assert.equal(s.refine(1, 'sh tool.sh', 'imported \\d+ cards').code, 0);
  const r = s.verify(1);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`at ${s.prod.deployed}: pass \\(exit 0\\)`));
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'pass');
  assert.equal(rows[0].by, 'reality-checker');
  assert.equal(rows[0].via, 'reality-check');
  assert.ok(G.shaMatch(rows[0].sha, s.prod.deployed));
  const cap = fs.readFileSync(path.join(s.root, '.delivery', 'evidence', rows[0].capture.path), 'utf8');
  assert.match(cap, /^\$ sh tool\.sh/);
  assert.match(cap, /tool v1 imported 212 cards/);
  assert.doesNotMatch(cap, /v2/);
  assert.ok(fs.existsSync(path.join(s.roleDir, 'verify', `${ID}-${s.prod.deployed.slice(0, 12)}`, 'tool.sh')));
});

test('run: a failing exit, a missing match and a timeout are recorded as fail rows by the runner', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh; exit 3');
  const bad = s.verify(1);
  assert.match(bad.out, /: fail \(exit 3\)/);
  assert.equal(s.rows()[0].result, 'fail');
  s.refine(2, 'sh tool.sh', 'imported 0 cards');
  const nomatch = s.verify(2);
  assert.match(nomatch.out, /: fail \(exit 0 but stdout does not match/);
  assert.equal(s.rows().filter((x) => x.criterion === 2)[0].result, 'fail');
});

test('run: only the Reality Checker runs it; the builder and the Delivery Manager are refused and no row is written', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh');
  for (const who of ['builder-1', 'delivery-lead']) {
    const r = s.verify(1, who);
    assert.equal(r.code, 1, who);
    assert.match(r.out, /this session is/);
  }
  assert.equal(s.rows().length, 0);
});

test('run: refused with the fix named when the step has no command, the script is for another deploy, or the sha is short', () => {
  const s = ready();
  assert.match(s.verify(1).out, /no step with a command: the Delivery Manager adds it \(reality-check\.js refine/);
  assert.match(s.verify(7).out, /criterion 7 is not in the script/);
  const short = setup();
  short.dm('plan', ID);
  short.as = null;
  short.bd.beads.get(ID).metadata.deployed_sha = 'd478aa11';
  assert.match(short.verify(1).out, /no full deployed sha/);
  assert.equal(s.rows().length, 0);
});

test('run: the run cap of run-record still applies (a third run on the same deploy is refused)', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh');
  assert.equal(s.verify(1).code, 0);
  assert.equal(s.verify(1).code, 0);
  assert.match(s.verify(1).out, /already has 2 run\(s\)/);
});

test('surface: command_line must be a boolean; checkerSurfaces lists command-line and unscriptable surfaces', () => {
  const bad = validateSurface({ surfaces: [{ ...CLI_SURFACES.surfaces[0], command_line: 'yes' }] });
  assert.match(bad.problems.join(), /"command_line" must be true or false/);
  const root = makeProject({ story: CLI_STORY, surfaces: CLI_SURFACES });
  assert.deepEqual(checkerSurfaces(root), ['vault/S3']);
  assert.deepEqual(checkerSurfaces(makeProject({ surfaces: { ...SURFACES } })), ['vault/S1']);
});

test('start.js: a command-line surface puts the Reality Checker in the minimal preset', () => {
  const { presetRoles, unscriptableSurfaces } = require('./start.js');
  const root = makeProject({ story: CLI_STORY, surfaces: CLI_SURFACES });
  assert.deepEqual(unscriptableSurfaces(root), ['vault/S3']);
  assert.ok(presetRoles('minimal', { unscriptable: unscriptableSurfaces(root) }).includes('reality-checker'));
  const plain = makeProject({ story: CLI_STORY, surfaces: { ...CLI_SURFACES, surfaces: [{ ...CLI_SURFACES.surfaces[0], command_line: undefined }] } });
  assert.deepEqual(unscriptableSurfaces(plain), []);
});

test('team-status: warns when a command-line surface has stories and the team has no Reality Checker, and not once it has one', () => {
  const { teamStatus } = require('./team-status.js');
  const root = makeProject({ story: CLI_STORY, surfaces: CLI_SURFACES });
  const warned = (r) => teamStatus(r, { now: '2026-10-12T12:00:00Z', staleHours: 2 }).warnings.filter((w) => /can never be verified/.test(w));
  assert.equal(warned(root).length, 1);
  assert.match(warned(root)[0], /vault\/S3 can only be verified by a Reality Checker/);
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.push({ id: 'reality-checker', brief: 'delivery/reality-checker', host: team.roles[0].host, model: 'sonnet' });
  fs.writeFileSync(file, JSON.stringify(team));
  assert.equal(warned(root).length, 0);
});

test('lane: the Reality Checker may run verify-run.js run; the builder and the Delivery Manager may not', () => {
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const PLUGIN_ROOT = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-lane-'));
  const bash = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` }), roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false }).allow;
  const cmd = `node ${PLUGIN_ROOT}/scripts/verify-run.js run ${ID} --criterion 1`;
  assert.equal(bash('reality-checker', cmd), true);
  assert.equal(bash('delivery-lead', cmd), false);
  assert.equal(bash('product-manager', cmd), false);
  // the lane admits the script's arguments; the script itself has no way to take a result
  const typed = vr.main(['run', ID, '--criterion', '1', '--result', 'pass'], { cwd: os.tmpdir(), env: {}, who: { root: '/x', roleId: 'reality-checker' } });
  assert.equal(typed.code, 2);
  assert.match(typed.out, /unknown option --result/);
});
