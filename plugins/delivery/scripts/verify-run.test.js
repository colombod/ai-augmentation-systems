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
  // the newest commit's output, not any "v2": the capture also carries a random temp path, which once
  // read delivery-tests-2zv2TU and failed the test on an unrelated pull request
  assert.doesNotMatch(cap, /tool v2 imported/);
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

// verify-run.main with an injected spawn, as the Reality Checker
function verifyWith(s, spawn) {
  const who = { root: s.root, team: { ...loadManifest(s.root).team, product_url: s.prod.dir }, instance: 'reality-checker', roleId: 'reality-checker', actor: 't@pc/reality-checker', roleDir: s.roleDir };
  return vr.main(['run', ID, '--criterion', '1'], { cwd: s.root, env: {}, bd: s.bd, now: T.run, who, spawn });
}

test('run: a timed-out command is a fail row naming the minutes', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh');
  const r = verifyWith(s, (cmd, args, opts) => (cmd === '/bin/sh' ? { status: null, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' } : spawnSync(cmd, args, opts)));
  assert.match(r.out, /: fail \(stopped after \d+ minutes\)/);
  assert.equal(s.rows()[0].result, 'fail');
});

test('run: an over-cap run executes nothing and writes no capture', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh');
  assert.equal(s.verify(1).code, 0);
  assert.equal(s.verify(1).code, 0);
  const dir = path.join(s.roleDir, 'project', '.delivery', 'evidence', 'artifacts', ID);
  const before = fs.readdirSync(dir).length;
  let ran = 0;
  const r = verifyWith(s, (...a) => { ran++; return spawnSync(...a); });
  assert.equal(r.code, 1);
  assert.match(r.out, /already has 2 run\(s\)/);
  assert.equal(ran, 0);
  assert.equal(fs.readdirSync(dir).length, before);
});

test('run: a criterion with two command steps is refused, none silently ignored', () => {
  const s = ready();
  s.refine(1, 'sh tool.sh');
  const f = path.join(s.root, rc.scriptRel(ID));
  const script = JSON.parse(fs.readFileSync(f, 'utf8'));
  const g = script.criteria.find((x) => x.criterion === 1);
  g.steps.push({ ...g.steps[0], n: 2, command: 'echo second' });
  fs.writeFileSync(f, JSON.stringify(script));
  const r = s.verify(1);
  assert.equal(r.code, 1);
  assert.match(r.out, /2 steps with a command/);
  assert.equal(s.rows().length, 0);
});

test('run: a capture over the size cap is truncated and says so', () => {
  const s = ready();
  s.refine(1, 'head -c 400000 /dev/zero | tr "\\0" x');
  const r = s.verify(1);
  assert.equal(r.code, 0, r.out);
  const cap = fs.readFileSync(path.join(s.root, '.delivery', 'evidence', s.rows()[0].capture.path), 'utf8');
  assert.match(cap, /\[truncated: \d+ more characters not kept\]/);
  assert.ok(cap.length < 300000);
});

test('plan: a command-line surface covers every criterion even when the probes say by: test', () => {
  const story = CLI_STORY.replace(/by: reality-check/g, 'by: test');
  const root = makeProject({ story, surfaces: CLI_SURFACES });
  const store = memBd([storyBead({ assignee: 't@pc/builder-1' })]);
  const who = { root, team: loadManifest(root).team, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 't@pc/delivery-lead' };
  const r = rc.main(['plan', ID], { cwd: root, env: {}, bd: store, now: T.plan, who });
  assert.equal(r.code, 0, r.out);
  assert.ok(rc.readScript(root, ID).criteria.length >= 2);
  // a scriptable surface that is not a command line still leaves by: test probes to the tests
  const plain = makeProject({ story: story.replace('surface: S3', 'surface: S2').replace(/where: S3/g, 'where: S2') });
  const r2 = rc.main(['plan', ID], { cwd: plain, env: {}, bd: store, now: T.plan, who: { ...who, root: plain, team: loadManifest(plain).team } });
  assert.equal(r2.code, 1);
  assert.match(r2.out, /its probes run as tests/);
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

// A writer such as operator.js sync finds its role only through DELIVERY_ROLE and the role marker. The
// runner clears the role's variables by default; a step marked --as-role runs as the Reality Checker.
test('run: operator.js sync in the role directory is refused not_allowed without --as-role, and passes with it', () => {
  const s = ready();
  const tj = path.join(s.root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(tj, 'utf8'));
  if (!team.roles.some((r) => r.id === 'reality-checker')) team.roles.push({ id: 'reality-checker', brief: 'delivery/reality-checker', host: 'pc', model: 'sonnet' });
  fs.writeFileSync(tj, JSON.stringify(team, null, 2));
  fs.writeFileSync(path.join(s.roleDir, '.delivery-role.json'), JSON.stringify({ instance: 'reality-checker', role: 'reality-checker', host: 'pc', project_root: s.root, actor: 't@pc/reality-checker' }));
  fs.writeFileSync(path.join(s.roleDir, '.delivery-session'), 'sess-rc');
  const tr = path.join(s.roleDir, 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p1', uuid: 'u1', timestamp: '2099-10-13T10:00:01.000Z', sessionId: 'sess-rc', message: { role: 'user', content: 'ship it' } })}\n`);
  fs.writeFileSync(path.join(s.roleDir, '.delivery-transcript'), tr);
  const env = { ...process.env, DELIVERY_ROLE: 'reality-checker', DELIVERY_ROLE_DIR: s.roleDir, BEADS_ACTOR: 't@pc/reality-checker' };
  delete env.DELIVERY_PROJECT_ROOT;
  const who = { root: s.root, team: { ...loadManifest(s.root).team, product_url: s.prod.dir }, instance: 'reality-checker', roleId: 'reality-checker', actor: 't@pc/reality-checker', roleDir: s.roleDir };
  const verify = () => vr.main(['run', ID, '--criterion', '1'], { cwd: s.root, env, bd: s.bd, now: T.run, who });
  const command = `cd '${s.roleDir}' && node '${path.join(__dirname, 'operator.js')}' sync --format-check`;
  assert.equal(s.refine(1, command).code, 0);
  const without = verify();
  assert.equal(without.code, 0, without.out);
  assert.match(without.out, /: fail \(exit 1\)/);
  assert.match(without.out, /--step 1 --as-role/);
  assert.equal(s.dm('refine', ID, '--criterion', '1', '--step', '1', '--as-role').code, 0);
  assert.equal(rc.readScript(s.root, ID).criteria.find((g) => g.criterion === 1).steps[0].as_role, true);
  const withRole = verify();
  assert.equal(withRole.code, 0, withRole.out);
  assert.match(withRole.out, /: pass \(exit 0\)/);
  const rows = s.rows();
  assert.deepEqual(rows.map((r) => r.result), ['fail', 'pass']);
  const cap = fs.readFileSync(path.join(s.root, '.delivery', 'evidence', rows[1].capture.path), 'utf8');
  assert.match(cap, /as role: reality-checker/);
  assert.match(cap, /added 1 \(ok\)/);
  // a re-plan keeps the refined step, its mark included
  assert.equal(s.dm('plan', ID).code, 0);
  assert.equal(rc.readScript(s.root, ID).criteria.find((g) => g.criterion === 1).steps[0].as_role, true);
  // --no-as-role takes it back
  assert.equal(s.dm('refine', ID, '--criterion', '1', '--step', '1', '--no-as-role').code, 0);
  assert.equal(rc.readScript(s.root, ID).criteria.find((g) => g.criterion === 1).steps[0].as_role, undefined);
});

// The checker's identity in a step is outside its lane hook, so only operator.js sync may run with it:
// a writer of rows, reviews or beads there would write the done gate in the checker's name.
test('refine: --as-role is refused for any command but operator.js sync, and the runner refuses a hand-edited one', () => {
  const s = ready();
  const step = () => rc.readScript(s.root, ID).criteria.find((g) => g.criterion === 1).steps[0];
  const op = `'${path.join(__dirname, 'operator.js')}'`;
  for (const ok of [`node ${op} sync`, `cd '/r d/rc' && node ${op} sync --format-check`, `'${process.execPath}' ${op} sync --all --json`]) {
    assert.equal(rc.asRoleProblem(ok), null, ok);
  }
  for (const bad of [
    `node /p/reality-check.js run-record ${ID} --criterion 1 --result pass`,
    `node /p/evidence.js add ${ID} --criterion 1 --result pass`,
    'bd update x --append-notes y', 'node /p/review.js record 1 --result pass',
    `node ${op} record --cite x --quote y --statement z`,
    `node ${op} sync; node /p/evidence.js add x`, `node ${op} sync && bd close x`, `node ${op} sync | sh`,
    `node ${op} sync $(bd close x)`, `node ${op} sync \`bd close x\``, `FOO=1 node ${op} sync`, `node -r /x.js ${op} sync`,
    `node ${op} sync > /p/rows.ndjson`, `node "${op}$X" sync`, `node ${op}'' sync`, 'sh tool.sh', '',
  ]) {
    assert.ok(rc.asRoleProblem(bad), `not refused: ${bad}`);
    assert.equal(s.refine(1, bad).code, 0);
    const r = s.dm('refine', ID, '--criterion', '1', '--step', '1', '--as-role');
    assert.equal(r.code, 1, bad);
    assert.match(r.out, /--as-role is only for the form/);
    assert.equal(step().as_role, undefined, bad);
  }
  // a command changed under an existing mark is refused too
  assert.equal(s.refine(1, `node ${op} sync`).code, 0);
  assert.equal(s.dm('refine', ID, '--criterion', '1', '--step', '1', '--as-role').code, 0);
  assert.equal(s.refine(1, 'node /p/evidence.js add x').code, 1);
  assert.equal(step().command, `node ${op} sync`);
  // a script edited by hand: the runner refuses before any checkout or spawn, and writes no row
  const file = path.join(s.root, rc.scriptRel(ID));
  const script = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(script.criteria.find((g) => g.criterion === 1).steps[0], { command: 'node /p/evidence.js add x', as_role: true });
  fs.writeFileSync(file, JSON.stringify(script));
  const r = s.verify(1);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--as-role is only for the form/);
  assert.equal(s.rows().length, 0);
  assert.ok(!fs.existsSync(path.join(s.roleDir, 'verify')));
});

// The allowlist compares real paths, the exact program and the checker's own role directory, never a
// basename: each refused form below once passed a basename check, and two of them ran as the checker.
test('as-role: only the real operator.js, run by node, from the checker\'s role directory; each bypass is refused', () => {
  const OP = path.join(__dirname, 'operator.js');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-asrole-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-asrole-other-'));
  // a file named operator.js that is not this plugin's, and a link that resolves to the real one
  const evil = path.join(elsewhere, 'operator.js');
  fs.writeFileSync(evil, 'process.exit(0)\n');
  const link = path.join(elsewhere, 'linked.js');
  fs.symlinkSync(OP, link);
  const ctx = { roleDir };
  for (const ok of [
    `node '${OP}' sync`, `node '${link}' sync --json`, `'${process.execPath}' '${OP}' sync --format-check`,
    `cd '${roleDir}' && node '${OP}' sync --all`,
  ]) assert.equal(rc.asRoleProblem(ok, ctx), null, ok);
  for (const [bad, why] of [
    [`node '${evil}' sync`, /is not this plugin's operator\.js/],
    [`node ../../../evil/operator.js sync`, /absolute path/],
    [`cd '${elsewhere}' && node ./operator.js sync`, /role directory|absolute path/],
    [`cd '${elsewhere}' && node '${OP}' sync`, /not the Reality Checker's role directory/],
    [`cd /nonexistent-dir && node '${OP}' sync`, /not the Reality Checker's role directory/],
    [`cd rel && node '${OP}' sync`, /cd target must be an absolute path/],
    [`cd '${roleDir}' && ./node '${OP}' sync`, /program must be node/],
    [`/usr/local/bin/not-node '${OP}' sync`, /program must be node/],
    [`node ~/operator.js sync`, /absolute path/],
    [`cd\n/evil/payload.sh && node '${OP}' sync`, /control character/],
    [`node '${OP}' sync\nbd close x`, /control character/],
    [`node '${OP}' sync\rbd close x`, /control character/],
    [`node\t'${OP}' sync`, /control character/],
    [`node '${OP}' sync`, /plain command/],
    [`node '${OP}' record --cite x`, /only subcommand allowed is sync/],
    [`node '${OP}' sync --project /x`, /sync takes only/],
  ]) {
    const p = rc.asRoleProblem(bad, ctx);
    assert.ok(p, `not refused: ${JSON.stringify(bad)}`);
    assert.match(p, why, JSON.stringify(bad));
  }
  // refine does not know the checker's directory: an absolute cd target passes there, and the runner refuses it
  assert.equal(rc.asRoleProblem(`cd '${elsewhere}' && node '${OP}' sync`), null);
  assert.ok(rc.asRoleProblem(`cd '${elsewhere}' && node '${OP}' sync`, { roleDir: null }));
  const s = ready();
  assert.equal(s.refine(1, `cd '${elsewhere}' && node '${OP}' sync`).code, 0);
  assert.equal(s.dm('refine', ID, '--criterion', '1', '--step', '1', '--as-role').code, 0);
  const r = s.verify(1);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not the Reality Checker's role directory/);
  assert.equal(s.rows().length, 0);
  assert.ok(!fs.existsSync(path.join(s.roleDir, 'verify')));
  // and the same step with a cd into the checker's own role directory gets past the check to the run
  assert.equal(s.refine(1, `cd '${s.roleDir}' && node '${OP}' sync --format-check`).code, 0);
  assert.doesNotMatch(s.verify(1).out, /--as-role is only for the form/);
});

// operator.js names its refusal two ways (the code not_allowed, and the words "no valid role marker");
// either one, alone, makes the runner name the --as-role fix, and other failures do not.
test('run: the hint names --as-role on either wording of the role refusal, and not on another failure', () => {
  const OP = path.join(__dirname, 'operator.js');
  const hinted = (stderr) => {
    const s = ready();
    assert.equal(s.refine(1, `node '${OP}' sync`).code, 0);
    const r = verifyWith(s, (cmd, args, opts) => (cmd === '/bin/sh' ? { status: 1, stdout: '', stderr } : spawnSync(cmd, args, opts)));
    assert.match(r.out, /: fail \(exit 1\)/);
    return /--step 1 --as-role/.test(r.out);
  };
  assert.equal(hinted('operator.js: no valid role marker for this session\n'), true);
  assert.equal(hinted('operator.js: not_allowed\n'), true);
  assert.equal(hinted('operator.js: disk full\n'), false);
});
