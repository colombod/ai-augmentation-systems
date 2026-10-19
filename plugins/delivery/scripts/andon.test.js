// scripts/andon.test.js — stop the line (R-22) replayed on Vault moments, through the real lane and
// bd-guard hook processes with real role markers (testing/role-harness.js): the 10-17 intake failure in
// the real app, the 2-day red nightly (#195) and the ChatGPT desktop fix chain (#453 to #480, 16 PRs in
// 7 days).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AN = require('./lib/andon.js');
const { harness, evIdOf } = require('./testing/role-harness.js');
const { makeProject, storyBead } = require('./testing/gate-fixture.js');
const { teamStatus, renderStatus } = require('./team-status.js');

const ID = 'ex-vault-0n9-3';
const story = (id, over = {}) => ({ id, title: `Story ${id}`, parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'], ...over, metadata: { surface: 'S1', area: 'collection', ...(over.metadata || {}) } });
const H = (n) => `${String(n).padStart(4, '0')}${'a'.repeat(36)}`;
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const claim = (h, inst, id) => h.bash(inst, `bd update ${id} --claim`);

// 10-17: vault-0n9.3 deployed to the real app, its Reality Checker run, the next story in the same area
function intake() {
  const beads = {
    [ID]: storyBead({ assignee: 'dev@pc/builder-1', metadata: { story: 'vault-0n9-3', authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } }),
    'ex-vault-0n9-4': story('ex-vault-0n9-4'),
    'ex-trade-1': story('ex-trade-1', { metadata: { area: 'trade' } }),
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
  return h;
}

test('R-22 10-17: the intake fails in the real app; the area stops, the fix goes on, and it lifts only on a pass and a closed A3', () => {
  const h = intake();
  h.deploy('d478aa11', 'v1.4.2');
  const fail = h.run(1, 'fail', 'v1.4.2');
  assert.equal(fail.code, 0, fail.deny || fail.out);
  const ev = evIdOf(fail.out);
  assert.match(fail.out, new RegExp(`andon:${ev} raised: area collection stops \\(fixes only\\)`));
  // 21:09: a new feature claim in the area is refused (D3); another area goes on
  const feature = claim(h, 'builder-2', 'ex-vault-0n9-4');
  assert.match(feature.deny, /^bd guard: Claim of ex-vault-0n9-4 refused \(D3: area collection is stopped: ev-ex-vault-0n9-3-1 failed criterion 1 of ex-vault-0n9-3 on the customer's app; fixes only/);
  assert.match(feature.deny, /\nMessage the Delivery Manager: ex-vault-0n9-4 cannot start, area collection is stopped until the failed check's cause is fixed and proved\.$/);
  assert.equal(claim(h, 'builder-2', 'ex-trade-1').deny, null, 'only the stopped area waits');
  // the Reality Checker drafts the problem from its evidence; the cause is not its to write
  assert.match(h.a3('reality-checker', `new --trigger andon:${ev} --cause 'x'`).out, /drafts the problem, evidence and expected sections only \(not cause\)/);
  const draft = h.a3('reality-checker', `new --trigger andon:${ev} --problem 'Files dropped in plain chat did not arrive: the import never saw the CSV.'`);
  assert.equal(draft.code, 0, draft.deny || draft.out);
  const a3 = /^(a3-[a-z0-9-]+):/.exec(draft.out)[1];
  const text = fs.readFileSync(path.join(h.root, '.delivery', 'reviews', `${a3}.md`), 'utf8');
  assert.match(text, /## Evidence row\n<!--[^\n]*-->\nev-ex-vault-0n9-3-1: criterion 1 failed on S1 at d478aa11/);
  assert.match(h.a3('builder-1', `close ${a3} --fix x --proof y`).out, /closing an A3 is the Delivery Manager's or Product Manager's/);
  // the Delivery Manager links the fix to the failed row; the fix claim proceeds
  assert.equal(h.bash('delivery-lead', `bd create --id ex-fix-intake --title 'Files do not arrive in plain chat' --labels bug --metadata '{"fixes":"${ev}","area":"collection"}'`).code, 0);
  const fix = claim(h, 'builder-1', 'ex-fix-intake');
  assert.equal(fix.deny, null, 'a linked fix is never stopped');
  assert.match(h.bash('builder-1', `bd update ex-vault-0n9-4 --metadata '{"a3":"${a3}"}'`, { run: false }).deny, /whether a bead is a fix, and what it fixes/, 'a builder cannot tag its own work as the A3\'s');
  // the CoS words it plainly
  assert.match(h.bash('chief-of-staff', `${h.script('andon.js')} show --plain`).out, /^The collection area is stopped until we fix why files dropped in plain chat did not arrive: the import never saw the CSV; the fix is being built\.$/);
  // in review: the Chief of Staff's line and the Delivery Manager's status follow the fix
  require('./lib/reviews.js').append(h.root, '501', { type: 'request', head: H(501), owner: 'builder-1', beads: ['ex-fix-intake'], at: new Date().toISOString() }, 'delivery-lead');
  assert.match(h.bash('chief-of-staff', `${h.script('andon.js')} show --plain`).out, /; the fix is in review\.$/);
  const bd = { show: (x) => h.db().issues[x] || null, list: ({ label }) => Object.values(h.db().issues).filter((b) => (b.labels || []).includes(label)) };
  assert.match(renderStatus(teamStatus(h.root, { bdCheck: () => false, bd }), null), /^Stopped: area collection \(ev-ex-vault-0n9-3-1 failed on the customer's app\); needs a fix deployed and passing its check, then a closed A3; A3 a3-reality-checker-1 open; the fix is in review\nA3 open: 1 \(a3-reality-checker-1\)/m);
  require('./lib/reviews.js').append(h.root, '501', { type: 'merged', head: H(501), beads: ['ex-fix-intake'], at: new Date().toISOString() }, 'delivery-lead');
  // no close without the proving pass; the pass alone does not lift it
  const sections = "--cause 'The connector read only https links; plain chat hands the tool a local path.' --class 'Every tool that takes a file assumed an https link.' --countermeasure 'All file tools take both forms; a contract test feeds each a local path.' --check 'The reality check on the deployed build passed.'";
  assert.match(h.a3('delivery-lead', `close ${a3} --fix ex-fix-intake --proof ${ev} ${sections}`).out, /is not a pass of criterion 1 of ex-vault-0n9-3 after ev-ex-vault-0n9-3-1/);
  h.deploy('e5550000', 'v1.4.3');
  const pass = h.run(1, 'pass', 'v1.4.3');
  assert.equal(pass.code, 0, pass.out);
  assert.match(claim(h, 'builder-2', 'ex-vault-0n9-4').deny, /area collection is stopped: .*its A3 a3-reality-checker-1 is open/, 'a pass without a closed A3 keeps the stop');
  const closed = h.a3('delivery-lead', `close ${a3} --fix ex-fix-intake --proof ${evIdOf(pass.out)} ${sections}`);
  assert.equal(closed.code, 0, closed.out);
  assert.equal(claim(h, 'builder-2', 'ex-vault-0n9-4').deny, null, 'the area resumes');
  assert.match(fs.readFileSync(path.join(h.root, '.delivery', 'reviews', `${a3}.md`), 'utf8'), /## Class of defect\n<!--[^\n]*-->\nEvery tool that takes a file assumed an https link\./);
  // the ledger is the scripts' alone
  const ledger = path.join(h.root, '.delivery', 'andon', 'delivery-lead.ndjson');
  assert.match(h.bash('delivery-lead', `echo '{}' >> ${ledger}`, { run: false }).deny, /written only by `a3\.js` and `andon\.js`/);
  assert.match(h.tool('builder-1', 'Write', { file_path: ledger, content: '{}' }).deny, /written only by `a3\.js` and `andon\.js`/);
});

test('R-22: an A3 close needs every section, the fix beads and a pass on the deployed version; one A3 per failure', () => {
  const h = intake();
  h.deploy('d478aa11', 'v1.4.2');
  const ev = evIdOf(h.run(1, 'fail', 'v1.4.2').out);
  const a3 = /^(a3-[a-z0-9-]+):/.exec(h.a3('delivery-lead', `new --trigger andon:${ev}`).out)[1];
  assert.match(h.a3('product-manager', `new --trigger andon:${ev}`).out, new RegExp(`${a3} is already open for andon:${ev}`));
  assert.match(h.a3('delivery-lead', `close ${a3} --fix ex-trade-1 --proof ${ev}`).out, /has no Problem as observed on the surface, Root cause, Class of defect, Fix across the class, Check that proves it/);
  assert.match(h.a3('delivery-lead', 'new --trigger andon:ev-ex-vault-0n9-3-9').out, /not a failed check row/);
  assert.match(h.a3('delivery-lead', 'list').out, new RegExp(`${a3} open andon:${ev} \\(area collection\\); missing: Problem`));
  assert.match(h.bash('chief-of-staff', `${h.script('a3.js')} new --trigger andon:${ev}`, { run: false }).deny, /^lane: /);
});

const RED = (day, n) => ({ databaseId: n, workflowName: 'nightly', status: 'completed', conclusion: 'failure', headSha: 'c195aa00', createdAt: `2026-10-${day}T02:00:00Z`, url: `https://github.com/example/example/actions/runs/${n}`, headBranch: 'main' });
const OK = (name, day, n) => ({ databaseId: n, workflowName: name, status: 'completed', conclusion: 'success', headSha: 'c195aa00', createdAt: `2026-10-${day}T03:00:00Z`, url: `https://github.com/example/example/actions/runs/${n}`, headBranch: 'main' });

test('R-22 #195: two days of red nightly on main stop new claims across the product until green; the A3\'s own work goes on', () => {
  const h = harness({ beads: { 'ex-a': story('ex-a'), 'ex-b': story('ex-b', { metadata: { area: 'trade' } }) }, runs: [OK('nightly', '08', 1), RED('09', 2), RED('10', 3), OK('test', '10', 4)] });
  // the nightly is scheduled: the team names it among its required workflows
  const tj = path.join(h.root, '.delivery', 'team', 'team.json');
  fs.writeFileSync(tj, JSON.stringify({ ...JSON.parse(fs.readFileSync(tj, 'utf8')), required_workflows: ['nightly', 'test'] }));
  for (const id of ['ex-a', 'ex-b']) assert.match(claim(h, 'builder-1', id).deny || '', /D3: CI on example\/example main is red since 2026-10-09T02:00 \(nightly\): fixes only/, id);
  const a3 = /^(a3-[a-z0-9-]+):/.exec(h.bash('delivery-lead', `${h.script('a3.js')} new --trigger ci:main --problem 'The nightly fails on main.'`).out)[1];
  h.bash('delivery-lead', `bd create --id ex-nightly --title 'Make the nightly green' --metadata '{"a3":"${a3}"}'`);
  assert.equal(claim(h, 'builder-2', 'ex-nightly').deny, null, 'the A3\'s own work');
  assert.match(h.bash('delivery-lead', `${h.script('andon.js')} show`).out, /Stopped: CI on example\/example main red since 2026-10-09T02:00:00Z \(gh: nightly, https:\/\/github\.com\/example\/example\/actions\/runs\/3\); fixes only until every required workflow is green \(a3-delivery-lead-1 open\)/);
  h.setRuns([OK('nightly', '11', 5), RED('09', 2), RED('10', 3)]);
  assert.equal(claim(h, 'builder-1', 'ex-a').deny, null, 'green again: the product resumes');
});

test('R-22: where gh cannot read CI, the Delivery Manager\'s `ci main red` row stops claims; the A3\'s work goes on; green lifts it', () => {
  const h = harness({ beads: { 'ex-a': story('ex-a'), 'ex-b': story('ex-b'), 'ex-fix': { id: 'ex-fix', title: 'fix' } } });
  const ci = (args) => h.bash('delivery-lead', `${h.script('andon.js')} ci ${args}`);
  assert.match(h.bash('builder-1', `${h.script('andon.js')} ci red --sha c195aa00 --run 195`).out, /the Delivery Manager's to do/);
  assert.match(ci('red --sha c195aa00 --run 195').out, /new claims across the product stop/);
  assert.match(claim(h, 'builder-1', 'ex-a').deny, /CI on main is red since/);
  const a3 = /^(a3-[a-z0-9-]+):/.exec(h.bash('delivery-lead', `${h.script('a3.js')} new --trigger ci:main`).out)[1];
  h.bash('delivery-lead', `bd update ex-fix --metadata '{"a3":"${a3}"}'`);
  assert.equal(claim(h, 'builder-2', 'ex-fix').deny, null, 'the A3\'s own work');
  h.bash('delivery-lead', 'bd update ex-fix --add-label state-merged');
  const sections = "--problem 'The nightly run fails on main every night since the 9th.' --evidence 'Run 195 failed on main at c195aa00 in the fixture step.' --expected 'Every run of every required workflow on main is green.' --cause 'A fixture read the wall clock and broke at midnight in UTC.' --class 'Tests that read the wall clock directly instead of an injected one.' --countermeasure 'One injected clock for every test that needs time, and a lint rule.' --check 'Run 196 on main passed with the injected clock in place.'";
  const close = (proof) => h.bash('delivery-lead', `${h.script('a3.js')} close ${a3} --fix ex-fix --proof '${proof}' ${sections}`);
  assert.match(close('run 196 green').out, /CI is still red on main: every required workflow must be green again/);
  const green = /^(an-[a-z0-9-]+):/.exec(ci('green --sha c196aa00 --run 196').out)[1];
  assert.match(close('run 196 green').out, /is not a green CI run on main after the red run: gh cannot read CI here/);
  assert.equal(claim(h, 'builder-1', 'ex-a').deny, null, 'green lifts it');
  assert.equal(close(green).code, 0);
  ci('red --sha c197aa00 --run 197');
  assert.match(claim(h, 'builder-2', 'ex-b').deny, /CI on main is red since/, 'a new red after the close stops again');
  ci('green --sha c198aa00 --run 198');
  assert.equal(claim(h, 'builder-2', 'ex-b').deny, null);
});

test('R-22: a flaky test warns and wants an A3 within 24 h; a confirmed one with none opened stops its area (D3)', () => {
  const root = makeProject();
  const h = harness({ root, beads: { 'ex-a': story('ex-a'), 'ex-b': story('ex-b'), 'ex-c': story('ex-c', { metadata: { area: 'trade' } }) } });
  const r = h.bash('builder-2', `${h.script('andon.js')} flaky import.spec --sha c195aa00 --fail-run 201 --pass-run 202 --area collection`);
  assert.match(r.out, /import\.spec is flaky on c195aa00; warning w-.*Its A3 is due by .*it is unconfirmed until the Delivery Manager confirms it/);
  const warned = claim(h, 'builder-1', 'ex-a');
  assert.equal(warned.deny, null);
  assert.match(warned.ctx, /import\.spec is flaky \(failed then passed on c195aa00, unconfirmed\): its A3 is due by/);
  // 25 hours later, with no A3
  const andon = require('./andon.js');
  andon.main(['flaky', 'search.spec', '--sha', 'c195aa00', '--fail-run', '1', '--pass-run', '2', '--area', 'collection'], { who: { root, roleId: 'delivery-lead', instance: 'delivery-lead' }, now: new Date(Date.now() - 25 * 3600e3).toISOString() });
  assert.match(claim(h, 'builder-2', 'ex-b').deny, /D3: search\.spec failed then passed on c195aa00, confirmed, and no A3 was opened within 24 h/);
  assert.equal(claim(h, 'builder-2', 'ex-c').deny, null, 'another area goes on');
});

const fixPr = (n) => ({ headRefOid: H(n), headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'desktop/loader.js', additions: 20, deletions: 5 }], body: `Fixes the desktop loader.\n\nRefs ex-${n}`, title: `Desktop loader fix ${n}` });
const fixBead = (n) => ({ id: `ex-${n}`, title: `Desktop app loader blank again (${n})`, labels: ['bug'], status: 'in_progress', assignee: 'dev@pc/builder-1', metadata: { fixes: 'ex-desk' } });

test('R-22 #453 to #480: the second fix on the desktop loader within 48 h requires a spike; later fixes on it warn until it is acknowledged', () => {
  const desk = story('ex-desk', { labels: ['story', 'state-merged'], metadata: { area: 'desktop' } });
  const h = harness({ beads: { 'ex-desk': desk, 'ex-453': fixBead(453), 'ex-455': fixBead(455), 'ex-457': { ...fixBead(457), status: 'open', assignee: '' }, 'ex-459': { ...fixBead(459), status: 'open', assignee: '' } }, prs: { 453: fixPr(453), 455: fixPr(455) } });
  const ship = (n) => {
    h.bash('delivery-lead', `${h.script('review.js')} request ${n} --reviewer builder-2`);
    h.bash('builder-2', `${h.script('review.js')} record ${n} --head ${H(n)} --result pass --summary 'loader test passes'`);
    const m = h.bash('delivery-lead', `gh pr merge ${n} -R example/example --match-head-commit ${H(n)} --squash`);
    assert.equal(m.deny, null, m.deny);
    return h.bash('delivery-lead', `${h.script('merge-gate.js')} merged ${n}`);
  };
  assert.doesNotMatch(ship(453).out, /fix on fix/);
  const second = ship(455);
  assert.match(second.out, /fix on fix: ex-desk was fixed in PRs 453, 455 within 48 h\. Spike ex-455-spike created: find the cause before another fix/);
  const spike = h.db().issues['ex-455-spike'];
  assert.deepEqual([spike.labels, spike.metadata.decision_rule], [['spike'], 'a cause found: fix across the class; none found: stop fixing and change the design']);
  const third = claim(h, 'builder-1', 'ex-457');
  assert.equal(third.deny, null, 'never a block');
  assert.match(third.ctx, /ex-desk already had fixes in PRs 453, 455 within 48 h: spike ex-455-spike looks for the cause first/);
  const chain = AN.chains(h.root)[0].id;
  assert.match(h.bash('builder-1', `${h.script('andon.js')} ack ${chain} --reason x`).out, /the Delivery Manager's to do/);
  assert.equal(h.bash('delivery-lead', `${h.script('andon.js')} ack ${chain} --reason 'the loader raced the window: one ready event now'`).code, 0);
  assert.doesNotMatch(claim(h, 'builder-2', 'ex-459').ctx || '', /already had fixes/);
  // after the answer, one more fix alone is no new chain
  const later = AN.fixChain(h.root, { pr: 455, bd: { show: (x) => h.db().issues[x] || null }, who: { roleId: 'delivery-lead', instance: 'delivery-lead' } });
  assert.deepEqual(later, []);
});

test('R-22: fixes on one symptom 49 h apart are no chain; the same A3 class is one symptom', () => {
  const root = makeProject();
  const R = require('./lib/reviews.js');
  const mem = new Map();
  const bd = { show: (id) => mem.get(id) || null, create: ({ id, labels, metadata }) => { mem.set(id, { id, labels, metadata, status: 'open' }); return id; } };
  const who = { root, roleId: 'delivery-lead', instance: 'delivery-lead' };
  const merge = (n, at, meta) => { mem.set(`ex-${n}`, { id: `ex-${n}`, labels: ['bug'], metadata: meta }); R.append(root, String(n), { type: 'merged', beads: [`ex-${n}`], at }, 'delivery-lead'); return AN.fixChain(root, { pr: n, bd, now: at, who }); };
  merge(1, '2026-10-10T00:00:00Z', { fixes: 'ex-desk' });
  assert.deepEqual(merge(2, '2026-10-12T01:00:00Z', { fixes: 'ex-desk' }), []);
  fs.mkdirSync(path.join(root, '.delivery', 'reviews'), { recursive: true });
  for (const id of ['a3-x-1', 'a3-x-2']) fs.writeFileSync(path.join(root, '.delivery', 'reviews', `${id}.md`), '## Class of defect\nEvery tool that takes a file assumed an https link.\n');
  merge(3, '2026-10-14T00:00:00Z', { fixes: 'ex-other', a3: 'a3-x-1' });
  const lines = merge(4, '2026-10-14T05:00:00Z', { fixes: 'ex-third', a3: 'a3-x-2' });
  assert.match(lines.join('\n'), /every tool that takes a file assumed an https link was fixed in PRs 3, 4 within 48 h/);
});

test('R-22: a hand-edited ledger line is reported and the rows after it stop counting; the stop holds', () => {
  const root = makeProject();
  AN.append(root, { type: 'ci', result: 'red', sha: 'c195aa00', run: '195', at: '2026-10-09T00:00:00Z' }, 'delivery-lead');
  AN.append(root, { type: 'ci', result: 'green', sha: 'c196aa00', run: '196', at: '2026-10-10T01:00:00Z' }, 'delivery-lead');
  assert.equal(AN.ciState(root, {}).red, false);
  const file = path.join(root, '.delivery', 'andon', 'delivery-lead.ndjson');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"run":"195"', '"run":"196"'));
  const { problem } = AN.read(root);
  assert.match(problem, /breaks the andon chain delivery-lead\.ndjson/);
  const st = AN.ciState(root, {});
  assert.equal(st.red, true, 'the green row after the edit no longer counts');
  assert.deepEqual(AN.redFromRuns([{ workflowName: 'x', status: 'in_progress', conclusion: '' }]), [], 'a run in progress is not red');
});
