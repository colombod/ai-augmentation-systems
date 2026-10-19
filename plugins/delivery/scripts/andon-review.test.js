// scripts/andon-review.test.js — the PR 57 review findings on stop the line (R-22) and flow (R-23), each
// replayed first as a failing case: through the real lane and bd-guard hooks where a claim decides it,
// on the library where a rule does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AN = require('./lib/andon.js');
const G = require('./lib/gates.js');
const Goal = require('./lib/goal.js');
const I = require('./lib/idle.js');
const { harness, evIdOf } = require('./testing/role-harness.js');
const { makeProject, storyBead } = require('./testing/gate-fixture.js');

const ID = 'ex-vault-0n9-3';
const DM = { roleId: 'delivery-lead', instance: 'delivery-lead' };
const story = (id, over = {}) => ({ id, title: `Story ${id}`, parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'], ...over, metadata: { surface: 'S1', area: 'collection', ...(over.metadata || {}) } });
const claim = (h, inst, id) => h.bash(inst, `bd update ${id} --claim`);
const SECTIONS = "--cause 'The connector read only https links; plain chat hands the tool a local path.' --class 'Every tool that takes a file assumed an https link.' --countermeasure 'All file tools take both forms; a contract test feeds each a local path.' --check 'The reality check on the deployed build passed.'";

// 10-17 through the lane: the failed run, the A3 drafted, a fix linked by the story id
function intake(extra = {}) {
  const beads = {
    [ID]: storyBead({ assignee: 'dev@pc/builder-1', metadata: { story: 'vault-0n9-3', authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } }),
    'ex-vault-0n9-4': story('ex-vault-0n9-4'),
    'ex-vault-0n9-5': story('ex-vault-0n9-5'),
    ...extra,
  };
  const h = harness({ beads });
  let k = 0;
  h.run = (n, result, version) => {
    const f = path.join(h.root, '.delivery', 'evidence', 'artifacts', ID, `run-${++k}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `run ${k}: ${result}\n`);
    return h.bash('reality-checker', `${h.script('reality-check.js')} run-record ${ID} --criterion ${n} --result ${result} --artifact ${f} --observed-version ${version}`);
  };
  h.deploy = (sha, version) => {
    assert.equal(h.bash('delivery-lead', `${h.script('evidence.js')} state ${ID} deployed --sha ${sha} --version ${version}`).code, 0);
    assert.equal(h.bash('delivery-lead', `${h.script('reality-check.js')} plan ${ID}`).code, 0);
  };
  h.a3 = (inst, args) => h.bash(inst, `${h.script('a3.js')} ${args}`);
  h.fail = () => {
    h.deploy('d478aa11', 'v1.4.2');
    const ev = evIdOf(h.run(1, 'fail', 'v1.4.2').out);
    const a3 = /^(a3-[a-z0-9-]+):/.exec(h.a3('reality-checker', `new --trigger andon:${ev} --problem 'Files dropped in plain chat did not arrive: the import never saw the CSV.'`).out)[1];
    return { ev, a3 };
  };
  // the fix merged: the merged row its pull request leaves, and state-merged on the bead
  h.merged = (bead, pr) => {
    require('./lib/reviews.js').append(h.root, String(pr), { type: 'merged', head: 'f'.repeat(40), beads: [bead], at: new Date().toISOString() }, 'delivery-lead');
    h.setBead(bead, (b) => { b.labels = [...new Set([...(b.labels || []), G.STATE.merged])]; });
  };
  return h;
}

// a failed counting row on a story in an area, and the trigger pause it raises (as reality-check.js does)
function stopIn(root, id, area, beads) {
  const bead = storyBead({ id, metadata: { area, story: id, deployed_sha: 'd478aa11' } });
  bead.metadata.evidence_head = G.appendEvidence(root, id, { type: 'row', criterion: 1, result: 'fail', by: 'reality-checker', surface: 'S1', sha: 'd478aa11', actor: 'x', at: '2026-10-17T21:04:00Z' }).head;
  beads[id] = bead;
  assert.equal(Goal.pauseOnTrigger({ root, who: DM, trigger: `andon:ev-${id}-1`, bead }).ok, true);
  return `ev-${id}-1`;
}

test('B1: once the A3 closes the lift is final: a later deploy of the story does not stop its area again', () => {
  const h = intake();
  const { a3 } = h.fail();
  // the documented story-id form of fixes: (Copilot 897)
  h.bash('delivery-lead', `bd create --id ex-fix-intake --title 'Files do not arrive in plain chat' --labels bug --metadata '{"fixes":"vault-0n9-3","area":"collection"}'`);
  assert.equal(claim(h, 'builder-1', 'ex-fix-intake').deny, null, 'fixes: <story id> is a linked fix');
  h.merged('ex-fix-intake', 501);
  h.deploy('e5550000', 'v1.4.3');
  const pass = evIdOf(h.run(1, 'pass', 'v1.4.3').out);
  assert.equal(h.a3('delivery-lead', `close ${a3} --fix ex-fix-intake --proof ${pass} ${SECTIONS}`).code, 0);
  h.deploy('f6660000', 'v1.4.4');
  assert.equal(claim(h, 'builder-2', 'ex-vault-0n9-4').deny, null, 'a deploy after the close is no new stop');
  assert.doesNotMatch(h.bash('delivery-lead', `${h.script('andon.js')} show`).out, /Stopped/);
});

test('I5: an area stop is not a product pause: goal.js show names the area, and the idle alarm still sees the other areas', () => {
  const root = makeProject();
  const beads = {};
  stopIn(root, 'ex-col-1', 'collection', beads);
  const beadOf = (id) => beads[id] || null;
  const p = Goal.activePause(root, { beadOf });
  assert.equal(p.paused, false, 'the team is not paused');
  assert.deepEqual(p.stops, [{ trigger: 'andon:ev-ex-col-1-1', area: 'collection' }]);
  assert.ok(Goal.showLines(root, { beadOf }).includes('work: not paused; area collection stopped (andon:ev-ex-col-1-1)'));
  const old = '2026-10-17T00:00:00Z';
  const ready = (id, area) => ({ id, status: 'open', updated_at: old, metadata: { area } });
  const now = '2026-10-18T00:00:00Z';
  assert.equal(I.idleState({ ready: [ready('ex-trade-1', 'trade')], now, pause: p }).idle, true, 'ready work elsewhere is idle');
  assert.deepEqual(I.idleState({ ready: [ready('ex-col-2', 'collection')], now, pause: p }), { idle: false, why: 'stopped' }, 'ready work only in the stopped area waits for its fix');
});

test('Copilot 904: two failures in one area: a fix linked to either is allowed; other work stays stopped', () => {
  const root = makeProject();
  const beads = {};
  const ev1 = stopIn(root, 'ex-col-1', 'collection', beads);
  stopIn(root, 'ex-col-2', 'collection', beads);
  const beadOf = (id) => beads[id] || null;
  const fix = { id: 'ex-fix-1', labels: ['bug'], metadata: { fixes: ev1, area: 'collection' } };
  assert.deepEqual(AN.claimFindings(fix, { root, beadOf, fix: { ok: true }, ci: { red: false } }).filter((f) => f.level === 'block'), []);
  const tagged = { id: 'ex-a3-work', metadata: { area: 'collection', a3: 'a3-delivery-lead-1' } };
  AN.append(root, { type: 'a3-open', trigger: `andon:${ev1}`, at: '2026-10-17T22:00:00Z' }, 'delivery-lead');
  assert.deepEqual(AN.claimFindings(tagged, { root, beadOf, ci: { red: false } }).filter((f) => f.level === 'block'), [], 'the A3 work of either failure');
  assert.match(AN.claimFindings(story('ex-col-3'), { root, beadOf, ci: { red: false } })[0].detail, /area collection is stopped/);
});

test('I3 I4: an A3 closes only on substance: real sections, linked and merged fixes, a pass on a later deploy of the current wording', () => {
  const h = intake({ 'ex-other': story('ex-other', { labels: ['bug'], metadata: { area: 'trade' } }) });
  const { ev, a3 } = h.fail();
  const close = (fix, proof, sections = SECTIONS) => h.a3('delivery-lead', `close ${a3} ${fix.map((x) => `--fix ${x}`).join(' ')} --proof ${proof} ${sections}`).out;
  // a re-run on the build that failed is no proof: nothing was fixed
  const rerun = evIdOf(h.run(1, 'pass', 'v1.4.2').out);
  h.bash('delivery-lead', `bd create --id ex-fix-intake --title 'Files do not arrive' --labels bug --metadata '{"fixes":"${ev}","area":"collection"}'`);
  h.merged('ex-fix-intake', 501);
  assert.match(close(['ex-fix-intake'], rerun), /ran on d478aa11, the build that failed: deploy the fix, then check it again/);
  h.deploy('e5550000', 'v1.4.3');
  const pass = evIdOf(h.run(1, 'pass', 'v1.4.3').out);
  assert.match(close(['ex-fix-intake'], pass, "--cause 'TBD' --class 'Every tool that takes a file assumed an https link.' --countermeasure 'n/a' --check 'The reality check passed.'"), /Root cause, Fix across the class are placeholders or under 4 words/);
  assert.match(close(['ex-nothing'], pass), /no bead ex-nothing/, 'the fix beads exist');
  assert.match(close(['ex-other'], pass), /ex-other is not linked to this failure \(fixes: ev-ex-vault-0n9-3-1, ex-vault-0n9-3 or vault-0n9-3, or a3: a3-reality-checker-1\)/);
  h.bash('delivery-lead', `bd create --id ex-fix-2 --title 'Second fix' --labels bug --metadata '{"fixes":"${ev}","area":"collection"}'`);
  assert.match(close(['ex-fix-intake', 'ex-fix-2'], pass), /ex-fix-2 is not merged yet/);
  // a deploy after the pass: the proof must be on what is deployed now
  h.deploy('f6660000', 'v1.4.4');
  assert.match(close(['ex-fix-intake'], pass), /is on e5550000, not the deployed f6660000/);
  const pass2 = evIdOf(h.run(1, 'pass', 'v1.4.4').out);
  // Copilot 825: a pass on an earlier wording of the criterion does not prove the current one
  const file = path.join(h.root, '.delivery', 'stories', 'vault-0n9-3.md');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('sees the import summary with the card count', 'sees the import summary with the card and set count'));
  assert.match(close(['ex-fix-intake'], pass2), /checked another wording of criterion 1/);
  fs.writeFileSync(file, text);
  assert.equal(h.a3('delivery-lead', `close ${a3} --fix ex-fix-intake --proof ${pass2} ${SECTIONS}`).code, 0);
});

test('I3: a ci:main A3 closes on a green run of main newer than the red one, read through gh', () => {
  const run = (n, conclusion, day) => ({ databaseId: n, workflowName: 'ci', event: 'push', status: 'completed', conclusion, headSha: `c${n}aa000`, createdAt: `2026-10-${day}T02:00:00Z`, updatedAt: `2026-10-${day}T02:20:00Z`, url: `u/${n}`, headBranch: 'main' });
  const h = harness({ beads: { 'ex-fix': { id: 'ex-fix', title: 'fix', labels: ['bug'] } }, runs: [run(1, 'success', '08'), run(2, 'failure', '09')] });
  const a3 = /^(a3-[a-z0-9-]+):/.exec(h.bash('delivery-lead', `${h.script('a3.js')} new --trigger ci:main`).out)[1];
  h.bash('delivery-lead', `bd update ex-fix --metadata '{"a3":"${a3}"}' --add-label state-merged`);
  const sections = "--problem 'The ci workflow fails on main.' --evidence 'Run 2 failed on main.' --expected 'Every push to main is green.' " + SECTIONS;
  const close = (proof) => h.bash('delivery-lead', `${h.script('a3.js')} close ${a3} --fix ex-fix --proof '${proof}' ${sections}`).out;
  assert.match(close('trust me'), /trust me is not a green CI run on main after the red run: name its run id \(gh run list -R example\/example --branch main\)/);
  assert.match(close('1'), /1 is not a green CI run on main after the red run/, 'an older green run proves nothing');
  h.setRuns([run(1, 'success', '08'), run(2, 'failure', '09'), run(3, 'success', '10')]);
  assert.match(close('3'), /closed/);
});

test('I3: a flaky A3 is proved by another green run of the test, not the runs that were recorded', () => {
  const root = makeProject();
  const andon = require('./andon.js');
  const a3 = require('./a3.js');
  const mem = { 'ex-fix': { id: 'ex-fix', labels: ['bug', 'state-merged'], metadata: {} } };
  const bd = { show: (id) => mem[id] || null, list: () => [] };
  andon.main(['flaky', 'import.spec', '--sha', 'c195aa00', '--fail-run', '201', '--pass-run', '202', '--area', 'collection'], { who: { root, ...DM }, bd });
  const id = a3.main(['new', '--trigger', 'flaky:import.spec'], { who: { root, ...DM }, bd }).a3;
  mem['ex-fix'].metadata.a3 = id;
  const close = (proof) => a3.main(['close', id, '--fix', 'ex-fix', '--proof', proof, '--problem', 'The import test fails at random.', '--expected', 'The test passes on every run.', '--cause', 'Two tests share one temporary folder.', '--class', 'Tests that share fixed paths on disk.', '--countermeasure', 'Every test gets its own temporary folder.', '--check', 'Fifty runs of the suite passed.'], { who: { root, ...DM }, bd }).out;
  assert.match(close('202'), /202 is one of the runs recorded for the flaky test: name a later green run of import\.spec/);
  assert.match(close('run 240, 50 of 50 green'), /closed/);
});

test('Copilot 816: two sessions opening an A3 for one failure at once make exactly one', () => {
  const h = intake();
  h.deploy('d478aa11', 'v1.4.2');
  const ev = evIdOf(h.run(1, 'fail', 'v1.4.2').out);
  const { spawn } = require('child_process');
  const env = (inst) => ({ ...process.env, DELIVERY_ROLE: inst, DELIVERY_ROLE_DIR: h.roleDir(inst), TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9' });
  const go = (inst) => new Promise((resolve) => { const p = spawn('node', [path.join(__dirname, 'a3.js'), 'new', '--trigger', `andon:${ev}`], { cwd: h.roleDir(inst), env: env(inst) }); p.on('close', resolve); });
  return Promise.all([go('delivery-lead'), go('reality-checker'), go('product-manager')]).then(() => {
    assert.equal(AN.a3s(h.root).filter((x) => x.trigger === `andon:${ev}`).length, 1);
  });
});
