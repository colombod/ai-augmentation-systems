// scripts/review-binding.test.js — PR 56 review round: who authored a pull request comes from GitHub
// facts (its head branch), the reviewer is the one requested, identities are normalised, gh reads the
// product repository, the merge command cannot hide a flag, and status reads the live pull request.
// Through the real lane and bd-guard hook processes (testing/role-harness.js) where a session acts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { harness } = require('./testing/role-harness.js');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { loadManifest } = require('./lib/manifest.js');
const R = require('./lib/reviews.js');
const review = require('./review.js');
const mergeGate = require('./merge-gate.js');

const BEAD = 'ex-vault-0n9-3';
const OTHER = 'ex-vault-0n9-9';
const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const view = (over = {}) => ({ headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'src/import.js', additions: 50, deletions: 5 }], body: `Refs ${BEAD}`, title: 'Import', ...over });
const authored = (id, inst) => storyBead({ id, assignee: `dev@pc/${inst}`, metadata: { authors: [{ actor: `dev@pc/${inst}`, role: 'builder' }] } });

function setup(prs = { 478: view() }, beads = { [BEAD]: authored(BEAD, 'builder-1'), [OTHER]: authored(OTHER, 'builder-2'), 'ex-vault-0n9-7': storyBead({ id: 'ex-vault-0n9-7', assignee: '' }) }) {
  const h = harness({ beads, prs });
  h.review = (inst, args) => h.bash(inst, `${h.script('review.js')} ${args}`);
  h.gate = (inst, args) => h.bash(inst, `${h.script('merge-gate.js')} ${args}`);
  h.rec = (inst, extra, head = H1) => h.review(inst, `record 478 --head ${head} --result pass --summary 'ok' ${extra}`);
  return h;
}

test('B1: the pull request\'s author is the builder whose branch it is; Refs to another builder\'s bead, or to an unclaimed one, is refused', () => {
  const h = setup({ 478: view({ body: `Refs ${OTHER}` }), 479: view({ body: 'Refs ex-vault-0n9-7' }), 480: view({ headRefName: 'fix-import' }) });
  assert.match(h.review('delivery-lead', 'request 478 --reviewer agent-r1').out, /PR 478 is on builder-1's branch \(team\/builder-1\), but ex-vault-0n9-9 was built by builder-2\.\nAsk builder-1 to name its own bead in `Refs`/);
  assert.match(h.review('delivery-lead', 'request 479 --reviewer agent-r1').out, /ex-vault-0n9-7 has no recorded author/);
  assert.match(h.review('delivery-lead', 'request 480 --reviewer agent-r1').out, /PR 480 is not on a builder's branch \(fix-import\)/);
  // the author cannot review itself through a wrong Refs line, and nothing is marked merged
  assert.match(h.rec('builder-1', '').out, /no review was requested for PR 478/);
  assert.equal(h.db().issues[OTHER].labels.includes('state-merged'), false);
});

test('I1: only the reviewer requested for that pull request and head records; the Delivery Manager records only the subagent it asked', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer agent-r1');
  assert.match(h.rec('builder-2', '').out, /builder-2 was not asked to review PR 478 at a1b2c3d4e5f6\.\nAsk for it: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/review\.js request 478 --reviewer builder-2`/);
  assert.match(h.rec('delivery-lead', '--by agent-r2').out, /agent-r2 was not asked to review PR 478/);
  assert.match(h.rec('delivery-lead', '--by agent-r1', H2).out, /agent-r1 was not asked to review PR 478 at b2c3d4e5f607/);
  assert.equal(h.rec('delivery-lead', '--by agent-r1').code, 0);
});

test('I2: author and Delivery Manager variants are recognised; the Delivery Manager never records in a session\'s name', () => {
  const h = setup();
  for (const r of ['Builder-1', 'other@laptop/builder-1', 'builder-1@pc']) assert.match(h.review('delivery-lead', `request 478 --reviewer ${r}`).out, /is an author of PR 478/, r);
  for (const r of ['dev@pc/delivery-lead', 'Delivery-Lead', 'delivery-manager']) assert.match(h.review('delivery-lead', `request 478 --reviewer ${r}`).out, /does not review its own merge/, r);
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  assert.match(h.rec('delivery-lead', '--by builder-2').out, /builder-2 is a session of this team: it records its own review/);
  assert.match(h.rec('delivery-lead', '--by dev@pc/delivery-lead').out, /does not review its own merge/);
  assert.equal(h.rec('builder-2', '').code, 0);
});

test('I3 and Copilot 368: gh reads the product repository; the merge names it, and another repository is refused', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.rec('builder-2', '');
  const merge = (args) => h.bash('delivery-lead', `gh pr merge 478 ${args}`, { run: false }).deny;
  assert.match(merge(`--match-head-commit ${H1}`), /name the product repository.*\nRun: `gh pr merge 478 -R example\/example --match-head-commit a1b2/);
  assert.match(merge(`-R other/repo --match-head-commit ${H1}`), /other\/repo is not the product repository \(example\/example\)/);
  assert.match(h.bash('delivery-lead', `gh pr merge https://github.com/other/repo/pull/478 --match-head-commit ${H1}`, { run: false }).deny, /other\/repo is not the product repository/);
  assert.equal(h.bash('delivery-lead', `gh pr merge https://github.com/example/example/pull/478 --match-head-commit ${H1}`, { run: false }).deny, null);
  // a project with no product repository known refuses instead of asking the planning repository
  const root = makeProject();
  const who = { root, team: loadManifest(root).team, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 'dev@pc/delivery-lead' };
  assert.match(review.main(['request', '478', '--reviewer', 'agent-1'], { who, bd: memBd([]) }).out, /the product repository is not known.*\nSet it: start\.js --product-repo/);
});

test('I3: start.js writes product_github from the product checkout\'s origin', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'start-gh-'));
  const product = path.join(base, 'shop');
  fs.mkdirSync(product);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
  for (const a of [['init', '-q', '-b', 'main'], ['commit', '-q', '--allow-empty', '-m', 'init'], ['remote', 'add', 'origin', 'git@github.com:acme/shop.git']]) cp.execFileSync('git', a, { cwd: product, env });
  const project = path.join(base, 'acme');
  const r = cp.spawnSync('node', [path.join(__dirname, 'start.js'), '--project', project, '--host', 'laptop', '--product-repo', product, '--dry-run'], { encoding: 'utf8', env });
  assert.match(`${r.stdout}${r.stderr}`, /product repo: GitHub acme\/shop/);
  assert.equal(require('./start.js').githubOf(product), 'acme/shop');
});

test('Copilot 332, 355 and minors: no flag hides behind an option value; -a, --auto and --admin in every form; a full sha; UNKNOWN waits; no GitHub approvals', () => {
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.rec('builder-2', '');
  const merge = (args) => h.bash('delivery-lead', `gh pr merge 478 -R example/example ${args}`, { run: false }).deny;
  for (const f of [`--match-head-commit ${H1} --subject env --admin`, `--match-head-commit ${H1} --subject X=1 --auto`, `--match-head-commit ${H1} -a`, `--match-head-commit ${H1} -as`, `--match-head-commit ${H1} --auto=true`, `--match-head-commit ${H1} --admin=false`]) {
    assert.match(merge(f) || '', /merges outside the gate/, f);
  }
  assert.match(merge('--match-head-commit a1b2c3d4'), /name the full head sha.*\nRun: `gh pr merge 478 -R example\/example --match-head-commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 --squash`/);
  h.setPr(478, (p) => { p.mergeable = 'UNKNOWN'; });
  assert.match(merge(`--match-head-commit ${H1}`), /GitHub is still computing whether PR 478 merges cleanly; try again/);
  assert.match(h.bash('delivery-lead', 'gh pr review 478 --approve -R example/example', { run: false }).deny, /approvals are review rows, not GitHub approvals/);
  assert.match(h.bash('delivery-lead', 'gh pr review 478 -a', { run: false }).deny, /approvals are review rows/);
  assert.equal(h.bash('delivery-lead', 'gh pr review 478 --comment -b "see rv-478-2"', { run: false }).deny, null);
  for (const b of ['github-actions', 'dependabot', 'renovate[bot]', 'sonarcloud-bot']) assert.ok(R.isBot(b), b);
  assert.equal(R.changedLines({ files: [{ path: 'bun.lockb', additions: 900 }, { path: 'api/gen/x.pb.go', additions: 900 }, { path: 'src/__generated__/t.ts', additions: 900 }, { path: 'src/a.js', additions: 3 }] }), 3);
});

test('Copilot 402: with bots counting, a bot\'s newer "changes" blocks its own earlier pass', () => {
  const rows = [{ type: 'request', seq: 1, head: H1, reviewer: 'copilot' }, { type: 'review', seq: 2, head: H1, kind: 'advisory', reviewer: 'copilot', result: 'pass' }, { type: 'review', seq: 3, head: H1, kind: 'advisory', reviewer: 'copilot', result: 'changes', summary: 'null check' }];
  const ci = { state: 'green', names: [] };
  assert.match(R.evaluate('478', rows, { head: H1, ci, botsCount: true }).why, /asked for changes/);
  assert.match(R.evaluate('478', rows, { head: H1, ci, botsCount: false }).why, /only advisory/);
});

test('I5, Copilot 413 and 424: status follows the latest head and the live pull request; "changes" is not "sent back"', () => {
  const st = (rows, live) => R.stateOf(rows, live);
  const req = (seq, head) => ({ type: 'request', seq, head, reviewer: 'agent-1' });
  const pass = (seq, head) => ({ type: 'review', seq, head, kind: 'independent', reviewer: 'agent-1', result: 'pass' });
  assert.equal(st([req(1, H1), req(2, H2), pass(3, H1)]), 'waiting', 'a late pass of the old head is not ready');
  assert.equal(st([req(1, H1), pass(2, H1), { type: 'ci', seq: 3, head: H1, result: 'fail' }]), 'failing');
  assert.equal(st([req(1, H1), { ...pass(2, H1), result: 'changes' }]), 'changes');
  assert.equal(st([req(1, H1), pass(2, H1)]), 'passed', 'no live facts: reviewed, the gate not known');
  assert.equal(st([req(1, H1), pass(2, H1)], view()), 'ready');
  assert.equal(st([req(1, H1), pass(2, H1)], view({ headRefOid: H2 })), 'stale');
  assert.equal(st([req(1, H1), pass(2, H1)], view({ statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] })), 'failing');
  // the plain words and team-status read gh when they can
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.rec('builder-2', '');
  h.setPr(478, (p) => { p.headRefOid = H2; });
  assert.match(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /^The change "Import a collection" changed after its review and needs review again$/);
  h.setPr(478, (p) => { p.headRefOid = H1; p.statusCheckRollup = [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }]; });
  assert.match(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /is reviewed, but its build is failing$/);
  const gh = (pr) => ({ number: Number(pr), state: 'OPEN', ...h.gh()[pr] });
  const ts = require('./team-status.js');
  assert.match(ts.renderStatus(ts.teamStatus(h.root, { bdCheck: () => false, gh }), null), /Pull requests: build failing 1 \(#478\)/);
});

test('Copilot 440 and 449: a stale --head returns the refusal; merged is idempotent and retries failed bead updates', () => {
  const root = makeProject();
  const team = { ...loadManifest(root).team, product_github: 'example/example' };
  const who = { root, team, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 'dev@pc/delivery-lead' };
  const bd = memBd([authored(BEAD, 'builder-1')]);
  let pr = view();
  const gh = () => pr;
  review.main(['request', '478', '--reviewer', 'agent-1'], { who, bd, gh });
  review.main(['record', '478', '--head', H1, '--result', 'pass', '--by', 'agent-1', '--summary', 'ok'], { who, bd, gh });
  pr = view({ headRefOid: H2 });
  const stale = mergeGate.main(['check', '478', '--head', H1], { who, bd, gh });
  assert.equal(stale.code, 1);
  assert.match(stale.out, /PR 478 is now at b2c3d4e5f607, not a1b2c3d4e5f6/);
  pr = view({ state: 'MERGED' });
  const update = bd.update;
  bd.update = () => { throw new Error('bd: database locked'); };
  const first = mergeGate.main(['merged', '478'], { who, bd, gh });
  assert.equal(first.code, 1, first.out);
  assert.match(first.out, /ex-vault-0n9-3: not marked merged \(bd: database locked\)\.\nRetry: `node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/merge-gate\.js merged 478`/);
  bd.update = update;
  const again = mergeGate.main(['merged', '478'], { who, bd, gh });
  assert.equal(again.code, 0, again.out);
  assert.ok(bd.show(BEAD).labels.includes('state-merged'));
  assert.equal(mergeGate.main(['merged', '478'], { who, bd, gh }).code, 0);
  assert.equal(R.read(root, '478').rows.filter((r) => r.type === 'merged').length, 1, 'one merged row');
});

test('B1: state-merged lands only on a story whose author opened the pull request', () => {
  const root = makeProject();
  const who = { root, team: { ...loadManifest(root).team, product_github: 'example/example' }, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 'dev@pc/delivery-lead' };
  const child = { ...authored('ex-vault-0n9-3-1', 'builder-1'), parent: BEAD, labels: ['task'] };
  const bd = memBd([authored(BEAD, 'builder-2'), child]);
  let pr = view({ body: 'Refs ex-vault-0n9-3-1' });
  const gh = () => pr;
  assert.equal(review.main(['request', '478', '--reviewer', 'agent-1'], { who, bd, gh }).code, 0);
  review.main(['record', '478', '--head', H1, '--result', 'pass', '--by', 'agent-1', '--summary', 'ok'], { who, bd, gh });
  pr = view({ state: 'MERGED', body: 'Refs ex-vault-0n9-3-1' });
  const r = mergeGate.main(['merged', '478'], { who, bd, gh });
  assert.match(r.out, /ex-vault-0n9-3: not marked merged: its author is not builder-1, who opened PR 478/);
  assert.equal(bd.show(BEAD).labels.includes('state-merged'), false);
});

test('re-check: only the exact team/<instance> branch binds; no session pushes to another builder\'s branch', () => {
  const h = setup({ 478: view({ headRefName: 'team/builder-2/sneak', body: `Refs ${OTHER}` }) });
  assert.match(h.review('delivery-lead', 'request 478 --reviewer agent-r1').out, /PR 478 is not on a builder's branch \(team\/builder-2\/sneak\)/);
  for (const c of ['git push origin HEAD:team/builder-2', 'git push -f origin HEAD:refs/heads/team/builder-2', 'git push --force origin +x:team/builder-2/sneak', 'git push origin team/builder-2']) {
    assert.match(h.bash('builder-1', c, { run: false }).deny || '', /team\/builder-2 is builder-2's branch/, c);
  }
  for (const c of ['git push origin team/builder-1', 'git push -u origin HEAD:team/builder-1']) assert.equal(h.bash('builder-1', c, { run: false }).deny, null, c);
  // typed variants and more bots
  assert.equal(R.norm('builder_1'), 'builder-1');
  assert.equal(R.norm('Builder-1.'), 'builder-1');
  for (const b of ['gemini-code-assist', 'claude', 'copilot', 'gemini-code-assist[bot]']) assert.ok(R.isBot(b), b);
  assert.ok(!R.isBot('agent-claude-7'), 'a subagent id that mentions claude is not a bot');
});

test('Copilot round 2 (118, 145, 157, 170, 183, 197, 218, 231)', () => {
  const P = require('./lib/gh-pr.js');
  // 118: only github.com remotes and URLs
  assert.equal(P.repoOf('https://notgithub.com/acme/shop.git'), null);
  assert.equal(P.repoOf('git@github.com.evil.io:acme/shop.git'), null);
  assert.equal(P.repoOf('git@github.com:acme/shop.git'), 'acme/shop');
  assert.equal(P.repoOf('https://github.com/acme/shop/pull/3'), 'acme/shop');
  const h = setup();
  h.review('delivery-lead', 'request 478 --reviewer builder-2');
  h.review('delivery-lead', 'request 478 --reviewer copilot');
  h.rec('builder-2', '');
  assert.match(h.bash('delivery-lead', `gh pr merge https://notgithub.com/example/example/pull/478 --match-head-commit ${H1}`, { run: false }).deny, /name the product repository/);
  // 183: the equals form of a short boolean
  for (const f of ['-a=true', '-as=1']) assert.match(h.bash('delivery-lead', `gh pr merge 478 -R example/example --match-head-commit ${H1} ${f}`, { run: false }).deny || '', /merges outside the gate/, f);
  // 145: an alias of a bot stays a bot
  assert.match(h.rec('delivery-lead', '--by dev@pc/copilot').out, /\(advisory: does not satisfy the gate alone\)/);
  assert.ok(R.isBot('scan-bot@pc'));
  // 157: each writer appends its own chain, so checkouts on two hosts merge without forking one
  const files = fs.readdirSync(path.join(h.root, R.REL, '478')).filter((f) => f.endsWith('.ndjson')).sort();
  assert.deepEqual(files, ['builder-2.ndjson', 'delivery-lead.ndjson']);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'host-b-'));
  fs.cpSync(h.root, other, { recursive: true });
  const who = (root, instance) => ({ root, team: loadManifest(root).team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `dev@pc/${instance}` });
  const gh = () => view();
  const bd = memBd([authored(BEAD, 'builder-1')]);
  review.main(['request', '478', '--reviewer', 'pm-agent'], { who: who(other, 'delivery-lead'), bd, gh });
  review.main(['request', '478', '--reviewer', 'product-manager'], { who: who(h.root, 'delivery-lead'), bd, gh });
  review.main(['record', '478', '--head', H1, '--result', 'changes', '--summary', 'later', '--by', 'pm-agent'], { who: who(other, 'delivery-lead'), bd, gh });
  // host B's chain lands in host A's checkout (a git merge of separate files)
  fs.copyFileSync(path.join(other, R.REL, '478', 'delivery-lead.ndjson'), path.join(h.root, R.REL, '478', 'delivery-lead-hostb.ndjson'));
  const merged = R.read(h.root, '478');
  assert.equal(merged.problem, null);
  assert.ok(merged.rows.some((r) => r.summary === 'later') && merged.rows.some((r) => r.reviewer === 'builder-2' && r.type === 'review'));
  // 170: rows recorded for another repository never count
  const rows = [{ type: 'request', seq: 1, repo: 'a/one', head: H1, reviewer: 'x' }, { type: 'review', seq: 2, repo: 'a/one', head: H1, kind: 'independent', reviewer: 'x', result: 'pass' }, { type: 'request', seq: 3, repo: 'b/two', head: H1, reviewer: 'y' }];
  assert.match(R.evaluate('478', rows, { head: H1, ci: { state: 'green', names: [] }, repo: 'b/two' }).why, /has no independent review/);
  // 197: recovery commands name the product repository
  const pend = R.evaluate('478', rows.slice(0, 2), { head: H1, ci: { state: 'pending', names: ['e2e'] }, repo: 'a/one' });
  assert.match(pend.fix, /`gh pr checks 478 -R a\/one --watch`/);
  // 218: status counts bots as the gate does
  const bot = [{ type: 'request', seq: 1, repo: 'a/one', head: H1, reviewer: 'copilot' }, { type: 'review', seq: 2, repo: 'a/one', head: H1, kind: 'advisory', reviewer: 'copilot', result: 'pass' }];
  assert.equal(R.stateOf(bot, null, { botsCount: true, repo: 'a/one' }), 'passed');
  assert.equal(R.stateOf(bot, null, { botsCount: false, repo: 'a/one' }), 'waiting');
  assert.equal(R.stateOf([...rows.slice(0, 2), { ...bot[1], seq: 3, result: 'changes' }], null, { botsCount: true, repo: 'a/one' }), 'changes');
  // 231: a broken chain is reported, never its earlier prefix as ready
  fs.appendFileSync(path.join(h.root, R.REL, '478', 'builder-2.ndjson'), '{"type":"review","result":"pass"}\n');
  assert.match(h.bash('chief-of-staff', `${h.script('review.js')} list --plain`).out, /^The change "Import a collection" has a damaged review record; the Delivery Manager restores it before anything merges$/);
  const ts = require('./team-status.js');
  assert.match(ts.renderStatus(ts.teamStatus(h.root, { bdCheck: () => false, gh: () => ({ unavailable: 'x' }) }), null), /Pull requests: review record damaged 1 \(#478\)/);
});
