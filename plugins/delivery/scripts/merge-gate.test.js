// scripts/merge-gate.test.js — review records and the merge gate (R-32, R-24), through the real lane
// and bd-guard hook processes with real role markers (testing/role-harness.js) and a fake gh, replayed
// on the Vault: #478 (the chat-drop import, vault-0n9.3), #471 merged before its verdict existed
// (10-12 23:32), #393 whose conflict resolution reached main on an older review, #272 at 3,790 lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { harness } = require('./testing/role-harness.js');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { loadManifest } = require('./lib/manifest.js');
const R = require('./lib/reviews.js');
const review = require('./review.js');
const mergeGate = require('./merge-gate.js');

const BEAD = 'ex-vault-0n9-3';
const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const pr478 = (over = {}) => ({ headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'src/import.js', additions: 120, deletions: 30 }],
  body: `Imports a dropped CSV in plain chat.\n\nRefs ${BEAD}`, title: 'Import a dropped CSV', ...over });

function setup(prs = { 478: pr478() }) {
  const bead = storyBead({ metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } });
  const h = harness({ beads: { [BEAD]: bead }, prs });
  h.review = (inst, args) => h.bash(inst, `${h.script('review.js')} ${args}`);
  h.gate = (inst, args) => h.bash(inst, `${h.script('merge-gate.js')} ${args}`);
  h.merge = (inst, args) => h.bash(inst, `gh pr merge ${args} -R example/example`);
  h.pass = (inst, head = H1, by = '') => h.review(inst, `record 478 --head ${head} --result pass --summary 'criteria 1 and 2 hold; tests 41 passed'${by ? ` --by ${by}` : ''}`);
  return h;
}

test('R-32 #471: a builder\'s gh pr merge is refused by the lane, whatever the review says', () => {
  const h = setup();
  for (const inst of ['builder-1', 'builder-2', 'chief-of-staff']) {
    const r = h.merge(inst, `478 --match-head-commit ${H1} --squash`, { run: false });
    assert.match(r.deny || '', /merging is the Delivery Manager's/, inst);
  }
  assert.equal(h.gh()[478].state, undefined, 'nothing merged');
});

test('R-32: the Delivery Manager\'s merge without a review is refused with the exact command to run', () => {
  const h = setup();
  const r = h.merge('delivery-lead', `478 --match-head-commit ${H1} --squash`);
  assert.match(r.deny, /merge of PR 478 refused: PR 478 has no independent review\.\nAsk for one: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js request 478 --reviewer <reviewer>`$/);
  assert.equal(r.deny.split('\n').length, 2, 'two lines');
  assert.match(h.gate('delivery-lead', 'check 478').out, /refused: PR 478 has no independent review/);
});

test('R-32: the author never reviews: not as the requested reviewer, not from its own session, not by a subagent it dispatched', () => {
  const h = setup();
  assert.match(h.review('delivery-lead', 'request 478 --reviewer builder-1').out, /builder-1 is an author of PR 478 \(ex-vault-0n9-3\)/);
  assert.equal(h.review('delivery-lead', 'request 478 --reviewer builder-2').code, 0);
  assert.match(h.pass('builder-1').out, /builder-1 is an author of PR 478/);
  assert.match(h.pass('builder-1', H1, 'agent-7f3a').out, /this session \(builder-1\) is an author of PR 478/);
  assert.match(h.pass('delivery-lead', H1, 'dev@pc/builder-1').out, /is an author of PR 478/, 'the author by actor too');
  assert.match(h.pass('builder-2', H1, 'agent-7f3a').out, /a session records only its own review/);
  assert.match(h.pass('delivery-lead').out, /does not review its own merge/);
  assert.equal(R.read(h.root, '478').rows.filter((r) => r.type === 'review').length, 0, 'nothing recorded');
  // the records are protected: no hand-written pass row, from any lane
  const file = path.join(h.root, R.REL, '478.ndjson');
  assert.match(h.bash('builder-1', `echo '{"type":"review","result":"pass"}' >> ${file}`, { run: false }).deny, /written only by `review\.js`/);
  assert.match(h.tool('delivery-lead', 'Write', { file_path: file, content: '{}' }).deny, /written only by `review\.js`/);
  assert.match(h.bash('product-manager', `cp /dev/null ${file}`, { run: false }).deny || '', /written only by `review\.js`|may not run/);
});

test('R-32 #393: a review of an older head does not count after a new commit; the merge waits for re-review', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  assert.equal(h.pass('builder-2').code, 0);
  h.setPr(478, (p) => { p.headRefOid = H2; });
  const old = h.merge('delivery-lead', `478 --match-head-commit ${H1} --squash`);
  assert.match(old.deny, /PR 478 is now at b2c3d4e5f607, not a1b2c3d4e5f6: new commits arrived after the review\.\nAsk for review of b2c3d4e5f607: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js request 478 --reviewer builder-2`/);
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H2} --squash`).deny, /the review is for an older head \(a1b2c3d4e5f6\); PR 478 is now at b2c3d4e5f607/);
  assert.match(h.pass('builder-2').out, /will not count for the merge: review b2c3d4e5f607/, 'a late review of the old head says it will not count');
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.pass('builder-2', H2);
  const ok = h.merge('delivery-lead', `478 --match-head-commit ${H2} --squash`);
  assert.equal(ok.deny, null, ok.deny);
  assert.equal(h.gh()[478].state, 'MERGED');
});

test('R-32: "changes" blocks until a newer pass on the head; CI red blocks; a Copilot pass alone is advisory', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer agent-7f3a');
  h.review('delivery-lead', 'request 478 --reviewer copilot-pull-request-reviewer');
  assert.match(h.review('delivery-lead', `record 478 --head ${H1} --result pass --by copilot-pull-request-reviewer --summary 'LGTM'`).out, /advisory: does not satisfy the gate alone/);
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H1}`).deny, /only advisory reviews \(copilot-pull-request-reviewer\)/);
  h.pass('delivery-lead', H1, 'agent-7f3a');
  assert.equal(h.review('delivery-lead', `record 478 --head ${H1} --result changes --by agent-7f3a --summary 'criterion 2: skipped column not named'`).code, 0);
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H1}`).deny, /asked for changes on a1b2c3d4e5f6: criterion 2: skipped column not named\.\nSend it back to its owner: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js send-back 478 --reason changes`/);
  h.pass('delivery-lead', H1, 'agent-7f3a');
  h.setPr(478, (p) => { p.statusCheckRollup = [...GREEN, { __typename: 'CheckRun', name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }]; });
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H1}`).deny, /CI is red on a1b2c3d4e5f6 \(e2e\)\.\nSend it back/);
  h.setPr(478, (p) => { p.statusCheckRollup = [{ __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS' }]; });
  assert.match(h.gate('delivery-lead', 'check 478').out, /CI is still running/);
  h.setPr(478, (p) => { p.statusCheckRollup = GREEN; });
  assert.match(h.gate('delivery-lead', 'check 478').out, /passes at a1b2c3d4e5f6: review rv-478-\d+ by agent-7f3a, CI green/);
});

test('R-32: a conflict goes back to its owner (bead note and message); after the fix only a new review counts', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.pass('builder-2');
  h.setPr(478, (p) => { p.mergeable = 'CONFLICTING'; });
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H1}`).deny, /has conflicts with its base: its owner resolves them, never the Delivery Manager\.\nSend it back: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js send-back 478 --reason conflict`/);
  const sb = h.review('delivery-lead', 'send-back 478 --reason conflict');
  assert.match(sb.out, /PR 478 sent back to builder-1; noted in ex-vault-0n9-3\nMessage builder-1: "PR 478: it has conflicts with the default branch: merge or rebase the default branch into your branch and resolve them\. Fix it on your branch, push, and tell me; I will ask for a new review\."/);
  assert.match(h.db().issues[BEAD].notes, /PR 478 sent back at a1b2c3d4e5f6: it has conflicts .*a new review is needed after the fix/);
  // the owner resolves the conflict and pushes: the earlier pass no longer counts
  h.setPr(478, (p) => { p.mergeable = 'MERGEABLE'; p.headRefOid = H2; });
  assert.match(h.merge('delivery-lead', `478 --match-head-commit ${H2}`).deny, /PR 478 was sent back, so its earlier reviews no longer count\.\nAsk for one: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js request 478 --reviewer builder-2`/);
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.pass('builder-2', H2);
  assert.equal(h.gate('delivery-lead', 'check 478').code, 0);
  assert.match(h.gate('delivery-lead', 'check 478').out, /Merge: `gh pr merge 478 -R example\/example --match-head-commit b2c3d4e5f60718293a4b5c6d7e8f901234567890 --squash`/);
});

test('R-24 #272: a 1,000-line pull request across two stories warns at request and at the gate, and never blocks', () => {
  const two = storyBead({ id: 'ex-vault-0n9-4', metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } });
  const h = setup({ 272: pr478({ files: [{ path: 'src/a.js', additions: 700, deletions: 300 }, { path: 'package-lock.json', additions: 2790, deletions: 0 }], body: `Refs ${BEAD}\nRefs ex-vault-0n9-4` }) });
  h.setBead(BEAD, () => {});
  const s = h.db(); s.issues[two.id] = { ...s.issues[BEAD], ...two, notes: '' }; fs.writeFileSync(h.store, JSON.stringify(s));
  const req = h.review('delivery-lead', 'request 272 --reviewer builder-2');
  assert.equal(req.code, 0, req.out);
  assert.match(req.out, /warning w-.*: PR 272 changes 1000 lines, over 600: split it/, 'the lock file does not count');
  assert.match(req.out, /warning w-.*: PR 272 touches 2 stories \(ex-vault-0n9-3, ex-vault-0n9-4\): one story per pull request/);
  assert.match(req.out, /Reviewer brief .*\n.*Review pull request 272 of example\/example at head a1b2c3d4e5f6\S* only.*\n.*Do not modify code, push, approve on GitHub or merge/);
  h.review('builder-2', `record 272 --head ${H1} --result pass --summary 'ok'`);
  const g = h.gate('delivery-lead', 'check 272');
  assert.equal(g.code, 0);
  assert.match(g.out, /warning: PR 272 changes 1000 lines, over 600/);
  // the threshold is the owner's: a goal field, asked as a yes/no question
  assert.equal(require('./lib/goal.js').questionText('pr_size_lines', '800'), 'Warn when a pull request changes more than 800 lines?');
  assert.equal(require('./lib/goal.js').value(h.root, 'pr_size_lines'), 600);
});

test('R-32 R-12: the normal path: request, a pass on the current head, CI green, the merge, state-merged; status and plain words follow', () => {
  const h = setup();
  const gh = (pr) => ({ number: Number(pr), state: 'OPEN', ...h.gh()[pr] });
  const status = () => require('./team-status.js').renderStatus(require('./team-status.js').teamStatus(h.root, { bdCheck: () => false, gh }), null);
  assert.match(h.review('delivery-lead', 'request 478 --reviewer builder-2').out, /rv-478-1: review of PR 478 at a1b2c3d4e5f6 requested from builder-2/);
  assert.match(status(), /Pull requests: waiting for review 1 \(#478\)\n/);
  assert.match(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /^The change "Import a collection" is waiting for review$/);
  assert.match(h.pass('builder-2').out, /rv-478-2: pass by builder-2 on a1b2c3d4e5f6 \(independent\)/);
  assert.match(status(), /ready to merge 1 \(#478\)/);
  assert.match(h.merge('delivery-lead', '478 --squash').deny, /name the reviewed head, so GitHub merges exactly that commit\.\nRun: `gh pr merge 478 -R example\/example --match-head-commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 --squash`$/);
  const m = h.merge('delivery-lead', `478 --match-head-commit ${H1} --squash`);
  assert.equal(m.deny, null, m.deny);
  assert.match(m.out, /Merged pull request #478/);
  const done = h.gate('delivery-lead', 'merged 478');
  assert.match(done.out, /rv-478-3: PR 478 merged at a1b2c3d4e5f6\nex-vault-0n9-3: merged \(478\), not verified/);
  assert.ok(h.db().issues[BEAD].labels.includes('state-merged'));
  assert.equal(h.db().issues[BEAD].metadata.merged_pr, '478');
  assert.match(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /^The change "Import a collection" is reviewed and merged; checking it on the customer's app next$/);
  assert.doesNotMatch(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /478|ex-vault/, 'no ids in the plain words');
});

test('R-32 without gh: the head comes from the merge command and CI from the Delivery Manager\'s recorded run', () => {
  const root = makeProject();
  const bd = memBd([storyBead({ metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } })]);
  const team = { ...loadManifest(root).team, product_github: 'example/example' };
  const who = (instance) => ({ root, team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `dev@pc/${instance}` });
  const gh = () => ({ unavailable: 'gh is not installed' });
  const call = (mod, inst, argv) => mod.main(argv, { bd, gh, who: who(inst) });
  assert.match(call(review, 'delivery-lead', ['request', '478', '--reviewer', 'agent-1']).out, /head is not known \(gh: gh is not installed\)/);
  assert.match(call(review, 'delivery-lead', ['request', '478', '--reviewer', 'agent-1', '--head', H1]).out, /names no bead/);
  assert.equal(call(review, 'delivery-lead', ['request', '478', '--reviewer', 'agent-1', '--head', H1, '--branch', 'team/builder-1', '--bead', BEAD, '--lines', '120']).code, 0);
  assert.equal(call(review, 'delivery-lead', ['record', '478', '--head', H1, '--result', 'pass', '--by', 'agent-1', '--summary', 'ok']).code, 0);
  const problem = (c) => mergeGate.mergeCommandProblem(c, { root, team, gh });
  assert.match(problem('gh pr merge 478 -R example/example --squash'), /current head is not known.*\nName it: `gh pr merge 478 -R example\/example --match-head-commit <full head sha>`/);
  assert.match(problem(`gh pr merge 478 -R example/example --match-head-commit ${H1}`), /no CI result for a1b2c3d4e5f6 \(gh could not read the checks\)\.\nRecord the run: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js ci 478 --head a1b2/);
  assert.match(call(review, 'builder-2', ['ci', '478', '--head', H1, '--result', 'pass', '--run', 'r1']).out, /the Delivery Manager's to do/);
  call(review, 'delivery-lead', ['ci', '478', '--head', H1, '--result', 'pass', '--run', 'https://ci.example/run/9']);
  assert.equal(problem(`gh pr merge 478 -R example/example --match-head-commit ${H1} --squash`), null);
  assert.match(problem(`gh pr merge 478 -R example/example --match-head-commit ${H1} --admin`), /merges outside the gate \(it bypasses the branch rules\)/);
  assert.match(problem('gh pr merge https://github.com/example/example/pull/478 --auto'), /merges outside the gate/);
  assert.match(problem('gh pr merge --squash'), /needs the pull request's number/);
  assert.equal(problem('gh pr view 478 && git status'), null, 'only merges are gated');
  // a tampered record stops the gate
  const file = R.fileOf(root, '478');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"summary":"ok"', '"summary":"ok, edited"'));
  assert.match(problem(`gh pr merge 478 -R example/example --match-head-commit ${H1}`), /breaks PR 478's review chain/);
});

test('briefs: the Delivery Manager\'s loop with exact commands; builders never merge or review their own; the Chief of Staff in plain words', () => {
  const read = (r) => fs.readFileSync(path.join(__dirname, '..', 'roles', `${r}.md`), 'utf8');
  const dm = read('delivery-lead');
  for (const step of ['review.js request <pr> --reviewer', '--by <subagent id>', 'merge-gate.js check <pr>', 'gh pr merge <pr> -R <owner/name> --match-head-commit <full sha> --squash', 'merge-gate.js merged <pr>', 'review.js send-back <pr> --reason conflict|changes|ci']) assert.ok(dm.includes(step), step);
  assert.match(read('builder'), /You never merge[\s\S]*never review or record a review of your own pull request/);
  assert.match(read('chief-of-staff'), /review\.js list --plain[\s\S]*reviewed and merged; checking it on the customer's app next/);
  // every review.js and merge-gate.js subcommand the briefs name is one the scripts accept
  const subs = { 'review.js': ['request', 'record', 'ci', 'send-back', 'show', 'list'], 'merge-gate.js': ['check', 'merged'] };
  for (const r of ['delivery-lead', 'builder', 'chief-of-staff']) {
    for (const m of read(r).matchAll(/(review\.js|merge-gate\.js) ([a-z-]+)/g)) assert.ok(subs[m[1]].includes(m[2]), `${r}: ${m[0]}`);
  }
  assert.equal(review.main(['bogus', '1'], { who: { root: makeProject() } }).code, 2);
});
