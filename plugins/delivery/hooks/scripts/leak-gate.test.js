// hooks/scripts/leak-gate.test.js — the strategy leak gate: plan passages, the product diff, branch names,
// the Delivery Manager's writes to the product repository, the allowlist and the Refs exemption.
// Run with: node --test hooks/scripts/leak-gate.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { decideLeak, refNames, nameHit, withoutRefs, stagedAdds } = require('./leak.js');
const PP = require('../../scripts/lib/plan-print.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
// a sentence from the private plan, and the same eight words reworded in the public text
const SECRET = 'We will undercut the incumbent on price before the spring launch to win their largest accounts.';
const COPIED = 'This change helps us undercut the incumbent on price before the spring launch.';
const OWN_WORDS = 'Lower the default plan price shown on the pricing page.';

function planRoot({ prd = SECRET, extras = '', allow = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-plan-'));
  fs.mkdirSync(path.join(root, '.delivery', 'initiatives', 'x'), { recursive: true });
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'x', 'prd.md'), `# PRD\n\n${prd}\n`);
  if (extras) fs.writeFileSync(path.join(root, PP.EXTRAS), extras);
  if (allow) fs.writeFileSync(path.join(root, PP.ALLOW), allow);
  return root;
}

const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-role-'));
const product = path.join(roleDir, 'product');
const project = path.join(roleDir, 'project');
fs.mkdirSync(product, { recursive: true });
fs.mkdirSync(project, { recursive: true });
const print = PP.load(planRoot({ extras: 'Project Falcon\n' }));
const noDiff = () => [];
const ask = (over) => decideLeak({ toolName: 'Bash', cwd: product, roleDir, denylist: ['Casual Carl', 'gate-slug'], print, diffOf: noDiff, ...over });
const bash = (command, over = {}) => ask({ toolInput: { command }, ...over });

// ---------- the fingerprint ----------

test('plan-print: an 8-word copied passage is found with its private source; own words are not', () => {
  assert.deepEqual(PP.passage(COPIED, print), { words: 'undercut the incumbent on price before the spring', source: '.delivery/initiatives/x/prd.md' });
  assert.equal(PP.passage(OWN_WORDS, print), null);
  // seven words is under the passage length: not claimed
  assert.equal(PP.passage('undercut the incumbent on price before the', print), null);
  // case, punctuation and line breaks do not hide a passage
  assert.ok(PP.passage('UNDERCUT the incumbent,\non price -- before the SPRING launch', print));
});

test('plan-print: runs of numbers, ids and short words are not passages (the spike\'s false positives)', () => {
  const runs = '1 2 3 4 5 6 7 8 9 10 and a to b c d e f g h of v1 2 0 x y';
  const fp = PP.load(planRoot({ prd: `${SECRET}\n\n${runs}\n` }));
  assert.equal(PP.passage(runs, fp), null);
  assert.ok(PP.passage(COPIED, fp));
});

test('plan-print: the cache is git-ignored, the salt is private, and nothing is built without a plan', () => {
  const root = planRoot();
  const fp = PP.load(root);
  assert.equal(fs.readFileSync(path.join(root, '.delivery', 'cache', 'leak', '.gitignore'), 'utf8'), '*\n');
  assert.ok(fs.existsSync(path.join(root, PP.FILE)));
  assert.ok(!JSON.stringify(fp.shingles).includes('incumbent'), 'the cache holds hashes, not plan text');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-bare-'));
  assert.deepEqual(PP.load(bare).shingles, {});
  assert.deepEqual(fs.readdirSync(bare), [], 'a project without a plan is left untouched');
});

test('plan-print: the fingerprint rebuilds itself when a plan file changes', () => {
  const root = planRoot({ prd: 'nothing secret here at all' });
  assert.equal(PP.passage(COPIED, PP.load(root)), null);
  const f = path.join(root, '.delivery', 'initiatives', 'x', 'prd.md');
  fs.writeFileSync(f, SECRET);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(f, later, later);
  assert.ok(PP.passage(COPIED, PP.load(root)), 'a passage added to the plan is caught without a rebuild command');
});

test('plan-print: fenced code in a Markdown plan is not fingerprinted; the prose around it is', () => {
  const code = 'const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);';
  const fp = PP.load(planRoot({ prd: `${SECRET}\n\n\`\`\`js\n${code}\n\`\`\`\n` }));
  assert.equal(PP.passage(code, fp), null);
  assert.ok(PP.passage(COPIED, fp));
});

test('plan-print: the allowlist removes its passages and terms, and only those', () => {
  const fp = PP.load(planRoot({ extras: 'Project Falcon\nAcme Corp\n', allow: 'Acme Corp\nWe will undercut the incumbent on price before the spring launch\n' }));
  assert.equal(PP.passage(COPIED, fp), null);
  assert.ok(PP.passage('before the spring launch to win their largest accounts', fp), 'the rest of the sentence is still private');
  assert.deepEqual(fp.terms, ['Project Falcon']);
  // an allowed term leaves the denylist's matches too; an unlisted one is still refused
  const run = (body) => decideLeak({ toolName: 'Bash', toolInput: { command: `gh pr comment 1 --body '${body}'` }, cwd: product, roleDir, denylist: ['Acme Corp', 'Casual Carl'], print: fp, diffOf: noDiff });
  assert.equal(run('Thanks to Acme Corp for the report'), null);
  assert.match(run('Built for Casual Carl').reason, /Casual Carl/);
});

// ---------- one canary per channel ----------

test('canary: commit message, PR title/body, PR comment, merge subject, release notes', () => {
  for (const cmd of [
    `git commit -m 'fix' -m '${COPIED}'`,
    `gh pr create --title 'x' --body '${COPIED}'`,
    `gh pr comment 4 --body '${COPIED}'`,
    `gh pr merge 4 --squash --subject '${COPIED}'`,
    `gh release create v1 --notes '${COPIED}'`,
    `gh pr create --title 'Ship Project Falcon' --body 'x'`,
  ]) {
    const d = bash(cmd);
    assert.ok(d, cmd);
    assert.match(d.reason, /undercut the incumbent|Project Falcon/, cmd);
  }
  assert.match(bash(`git commit -m 'fix' -m '${COPIED}'`).reason, /prd\.md[\s\S]*Product Manager/, 'names the private source and the way out');
  assert.equal(bash(`git commit -m '${OWN_WORDS}'`), null);
  assert.equal(bash(`gh pr comment 4 --body '${OWN_WORDS}'`), null);
});

test('canary: MCP text and a Write or Edit into the product', () => {
  assert.match(ask({ toolName: 'mcp__github__add_issue_comment', toolInput: { body: COPIED } }).reason, /undercut/);
  assert.equal(ask({ toolName: 'mcp__github__add_issue_comment', toolInput: { body: OWN_WORDS } }), null);
  assert.match(ask({ toolName: 'Write', toolInput: { file_path: path.join(product, 'src', 'a.js'), content: `// ${COPIED}\n` } }).reason, /Writing .*a\.js[\s\S]*undercut/);
  assert.match(ask({ toolName: 'Edit', toolInput: { file_path: path.join(product, 'README.md'), old_string: 'a', new_string: 'Built for Project Falcon' } }).reason, /Project Falcon/);
  assert.match(ask({ toolName: 'MultiEdit', toolInput: { file_path: path.join(product, 'b.md'), edits: [{ old_string: 'a', new_string: COPIED }] } }).reason, /undercut/);
  assert.equal(ask({ toolName: 'Write', toolInput: { file_path: path.join(product, 'src', 'a.js'), content: `// ${OWN_WORDS}\n` } }), null);
  // a file that already carried the sentence before the gate existed can still be edited; new copies cannot
  const old = path.join(product, 'tests', 'old.py');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, `# ${COPIED}\nx = 1\n`);
  assert.equal(ask({ toolName: 'Write', toolInput: { file_path: old, content: `# ${COPIED}\nx = 2\n` } }), null);
  assert.equal(ask({ toolName: 'Edit', toolInput: { file_path: old, old_string: 'x = 1', new_string: `# ${COPIED}\nx = 2` } }), null);
  assert.match(ask({ toolName: 'Write', toolInput: { file_path: old, content: `# ${COPIED}\n# also: before the spring launch to win their largest accounts\n` } }).reason, /spring launch/);
  // the same text written outside the product (a plan note in the project) is the plan's own business
  assert.equal(ask({ toolName: 'Write', toolInput: { file_path: path.join(project, 'notes.md'), content: COPIED } }), null);
});

test('canary: a plan passage in the staged change is refused, a clean change commits', () => {
  const diff = (text) => () => [{ file: 'src/pricing.js', text }];
  assert.match(bash(`git commit -m 'fix pricing'`, { diffOf: diff(`// ${COPIED}`) }).reason, /src\/pricing\.js[\s\S]*undercut/);
  assert.match(bash(`git commit -m 'fix pricing'`, { diffOf: diff('const name = "Project Falcon";') }).reason, /Project Falcon/);
  assert.equal(bash(`git commit -m 'fix pricing'`, { diffOf: diff(`// ${OWN_WORDS}`) }), null);
  // -a commits the working tree, so the guard reads the diff against HEAD
  let seen = null;
  bash(`git commit -am 'fix pricing'`, { diffOf: (dir, all) => { seen = all; return []; } });
  assert.equal(seen, true);
  bash(`git commit -m 'fix pricing'`, { diffOf: (dir, all) => { seen = all; return []; } });
  assert.equal(seen, false);
  // a diff the guard cannot read inside a repository is refused, not passed
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-repo-'));
  fs.mkdirSync(path.join(rd, 'product', '.git'), { recursive: true });
  const broken = { toolName: 'Bash', toolInput: { command: 'git commit -m x' }, cwd: path.join(rd, 'product'), roleDir: rd, denylist: [], print, diffOf: () => { throw new Error('boom'); } };
  assert.match(decideLeak(broken).reason, /could not read the change[\s\S]*boom/);
  // outside a git work tree the commit fails by itself: nothing to refuse
  assert.equal(bash('git commit -m x', { diffOf: () => { throw new Error('boom'); } }), null);
});

test('stagedAdds reads the added lines of a real staged change, per file', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-git-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'old line\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'a.txt'), `old line\n${COPIED}\n`);
  git('add', 'a.txt');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'not staged\n');
  assert.deepEqual(stagedAdds(repo, false), [{ file: 'a.txt', text: COPIED }]);
  fs.writeFileSync(path.join(repo, 'a.txt'), `old line\n${COPIED}\nworking tree only\n`);
  assert.deepEqual(stagedAdds(repo, true), [{ file: 'a.txt', text: `${COPIED}\nworking tree only` }]);
  // a line that was already there, moved or re-indented, is not new text
  git('add', '-A'); git('commit', '-q', '-m', 'old leak');
  fs.writeFileSync(path.join(repo, 'a.txt'), `  ${COPIED}\nold line\nworking tree only\n`);
  git('add', 'a.txt');
  assert.deepEqual(stagedAdds(repo, false), [{ file: 'a.txt', text: '' }]);
});

test('canary: branch and tag names carrying a plan term are refused; ordinary names pass', () => {
  for (const cmd of ['git push origin project-falcon-pricing', 'git checkout -b feat/project_falcon', 'git switch -c Project-Falcon', 'git tag project.falcon', 'git branch casual-carl-fix', 'git push origin HEAD:refs/heads/project-falcon']) {
    const d = bash(cmd);
    assert.ok(d, cmd);
    assert.match(d.reason, /branch or tag name/, cmd);
  }
  for (const cmd of ['git push origin team/builder-1', 'git checkout -b fix-login', 'git tag -m "release" v1.2.0', 'git push -u origin HEAD', 'git branch falconry', 'git branch -D project-falcon', 'git tag -d project-falcon', 'git push origin --delete project-falcon']) assert.equal(bash(cmd), null, cmd);
  assert.deepEqual(refNames({ sub: 'push', args: ['-u', 'origin', '+a:refs/heads/b'] }), ['a', 'b']);
  assert.equal(nameHit('falconry-ui', ['Project Falcon']), null);
});

// ---------- the Delivery Manager, outside the product worktree ----------

test('gh writes to the product repository are scanned from the project directory; other repos are not', () => {
  const dm = (command) => decideLeak({ toolName: 'Bash', toolInput: { command }, cwd: project, roleDir, denylist: [], print, productRepo: 'Acme/Shop', diffOf: noDiff });
  assert.match(dm(`gh pr merge 7 -R acme/shop --squash --subject '${COPIED}'`).reason, /product repository \(Acme\/Shop\)[\s\S]*undercut/);
  assert.match(dm(`gh -R https://github.com/acme/shop.git pr comment 7 --body '${COPIED}'`).reason, /undercut/);
  assert.match(dm(`gh api -X PUT repos/acme/shop/pulls/7/merge -f merge_method=squash -f commit_title='${COPIED}'`).reason, /undercut/);
  assert.match(dm(`gh issue create -R acme/shop --title 'Ship Project Falcon'`).reason, /Project Falcon/);
  const body = path.join(project, 'body.md');
  fs.writeFileSync(body, COPIED);
  assert.match(dm(`gh pr comment 7 -R acme/shop --body-file ${body}`).reason, /undercut/);
  assert.equal(dm(`gh pr merge 7 -R acme/shop --squash --subject '${OWN_WORDS}'`), null);
  assert.equal(dm(`gh pr comment 7 -R acme/planning --body '${COPIED}'`), null, 'the private planning repo is where the plan belongs');
  assert.equal(dm(`gh pr comment 7 --body '${COPIED}'`), null, 'no -R from the project directory: it targets the project repo');
  assert.equal(decideLeak({ toolName: 'Bash', toolInput: { command: `gh pr comment 7 -R acme/shop --body '${COPIED}'` }, cwd: project, roleDir, denylist: [], print, diffOf: noDiff }), null, 'no product_github recorded: nothing to compare with');
});

// ---------- the review binding's own line ----------

test('a Refs line of bead ids is not refused for the initiative slug; the slug elsewhere still is', () => {
  assert.equal(bash(`git commit -m 'fix login' -m 'Refs gate-slug-s1'`), null);
  assert.equal(bash(`gh pr create --title 'Fix login' --body 'Fixes the redirect.\n\nRefs dlv-4oj, gate-slug-s1'`), null);
  assert.match(bash(`git commit -m 'fix login for gate-slug' -m 'Refs dlv-4oj'`).reason, /gate-slug/);
  assert.match(bash(`git commit -m 'Refs gate-slug'`).reason, /gate-slug/, 'a bare slug is not a bead id');
  assert.equal(withoutRefs('a\nRefs dlv-1\nb'), 'a\n\nb');
});

// ---------- end to end, through the real hook ----------

function runHook(input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, 'leak-guard.js')], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('the leak-guard hook refuses a commit whose staged change copies the plan, and the DM\'s comment to the product', () => {
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
  const prodRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-prod-'));
  git(prodRepo, 'init', '-q'); git(prodRepo, 'config', 'user.email', 't@t'); git(prodRepo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(prodRepo, 'README.md'), 'shop\n');
  git(prodRepo, 'add', '-A'); git(prodRepo, 'commit', '-q', '-m', 'init');
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-proj-'));
  git(projectRoot, 'init', '-q'); git(projectRoot, 'config', 'user.email', 't@t'); git(projectRoot, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'initiatives', 'x'), { recursive: true });
  const team = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), 'utf8'));
  team.product_github = 'acme/shop';
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'team', 'team.json'), JSON.stringify(team, null, 2));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'initiatives', 'x', 'prd.md'), `# PRD\n\n${SECRET}\n`);
  git(projectRoot, 'add', '-A'); git(projectRoot, 'commit', '-q', '-m', 'init');
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-team-'));
  const b = prepareRole({ projectRoot, instance: 'builder-1', teamDir, pluginRoot: PLUGIN_ROOT, productRepo: prodRepo, user: 'tester' }).roleDir;
  const prod = path.join(b, 'product');
  assert.ok(fs.existsSync(prod), 'the builder has a product worktree');
  fs.writeFileSync(path.join(prod, 'pricing.js'), `// ${COPIED}\n`);
  git(prod, 'add', 'pricing.js');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const commit = { cwd: prod, session_id: 's', tool_name: 'Bash', tool_input: { command: "git commit -m 'adjust pricing'" } };
  const json = JSON.parse(runHook(commit, env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /pricing\.js[\s\S]*undercut the incumbent[\s\S]*prd\.md/);
  fs.writeFileSync(path.join(prod, 'pricing.js'), `// ${OWN_WORDS}\n`);
  git(prod, 'add', 'pricing.js');
  assert.equal(runHook(commit, env), '', 'rewritten in its own words, the commit passes');
  const comment = (body) => ({ cwd: path.join(b, 'project'), session_id: 's', tool_name: 'Bash', tool_input: { command: `gh pr comment 3 -R acme/shop --body '${body}'` } });
  assert.equal(JSON.parse(runHook(comment(COPIED), env)).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHook(comment(OWN_WORDS), env), '');
  assert.ok(!git(projectRoot, 'status', '--porcelain').includes('cache'), 'the fingerprint cache never shows up as a change in the plan repo');
});

// delivery-plugin-planning-a1v: concluding a conflicted merge of the default branch, the staged change
// against HEAD holds the default branch's own files; only lines new against both parents are the
// builder's text, so main's .delivery files no longer read as plan text the builder wrote.
test('stagedAdds while concluding a merge counts only lines new against both parents', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-merge-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'base\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'team/builder');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'builder side\n');
  git('commit', '-q', '-am', 'builder');
  git('checkout', '-q', 'main');
  fs.mkdirSync(path.join(repo, 'plugins', 'p', '.delivery', 'x'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugins', 'p', '.delivery', 'x', 'brief.md'), `${COPIED}\n`);
  fs.writeFileSync(path.join(repo, 'c.txt'), 'main side\n');
  git('add', '-A'); git('commit', '-q', '-m', 'main moves on');
  git('checkout', '-q', 'team/builder');
  assert.throws(() => git('merge', '-q', 'main'), 'the merge conflicts on c.txt');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'builder side\nmain side\nresolved by the builder\n');
  git('add', '-A');
  const adds = stagedAdds(repo, false);
  assert.deepEqual(adds.map((f) => f.file), ['c.txt'], 'main\'s own .delivery file is not this commit\'s text');
  assert.equal(adds[0].text, 'resolved by the builder', 'only the builder\'s own resolution line is new against both parents');
  // without a merge in progress, the same staged file reads whole, as before
  git('commit', '-q', '-m', 'merge main');
  fs.writeFileSync(path.join(repo, 'd.txt'), `${COPIED}\n`);
  git('add', 'd.txt');
  assert.deepEqual(stagedAdds(repo, false), [{ file: 'd.txt', text: COPIED }]);
});

// Copilot on #107: lines are matched by their place in the result, not their text, and a comparison
// cut short at the size limit never counts as proof that a line is inherited.
test('stagedAdds in a merge: the same sentence at two places is matched by position; a cut-short diff reads the whole change', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-merge2-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.md'), 'anchor\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'team/builder');
  fs.writeFileSync(path.join(repo, 'a.md'), `anchor\n${COPIED}\n`);
  git('commit', '-q', '-am', 'builder: after the anchor');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'a.md'), `${COPIED}\nanchor\n`);
  git('commit', '-q', '-am', 'main: before the anchor');
  git('checkout', '-q', 'team/builder');
  // keep the merge open whether or not git resolves it alone, as a conflicted merge would be
  try { git('merge', '-q', '--no-commit', '--no-ff', 'main'); } catch (err) { /* conflicted: the result is staged below */ }
  // keep both copies: each is inherited from one parent, neither is new against both
  fs.writeFileSync(path.join(repo, 'a.md'), `${COPIED}\nanchor\n${COPIED}\n`);
  git('add', '-A');
  assert.deepEqual(stagedAdds(repo, false).map((f) => f.file), [], 'no line is new against both parents');
  // a line truly new against both parents is still read
  fs.writeFileSync(path.join(repo, 'a.md'), `${COPIED}\nanchor\n${COPIED}\nnew in the resolution\n`);
  git('add', '-A');
  assert.deepEqual(stagedAdds(repo, false), [{ file: 'a.md', text: 'new in the resolution' }]);
});

test('stagedAdds in a merge: when the second comparison is cut short by earlier builder work, the resolution is still read', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-merge3-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'base\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'team/builder');
  // earlier builder work, sorted before c.txt: it fills the comparison against MERGE_HEAD first
  fs.writeFileSync(path.join(repo, 'aaa.txt'), Array.from({ length: 60 }, (_, i) => `builder line ${i} of earlier work`).join('\n') + '\n');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'builder side\n');
  git('add', '-A'); git('commit', '-q', '-m', 'builder');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'main side\n');
  git('commit', '-q', '-am', 'main');
  git('checkout', '-q', 'team/builder');
  assert.throws(() => git('merge', '-q', 'main'));
  fs.writeFileSync(path.join(repo, 'c.txt'), `builder side\nmain side\n${COPIED}\n`);
  git('add', '-A');
  assert.deepEqual(stagedAdds(repo, false).map((f) => f.text), [COPIED], 'the full read: only the resolution is new');
  // a limit the change against HEAD fits in, but the comparison against MERGE_HEAD (with aaa.txt) does not
  const cut = stagedAdds(repo, false, 400);
  assert.ok(cut.some((f) => f.file === 'c.txt' && f.text.includes(COPIED)), `a cut-short comparison never hides the resolution: ${JSON.stringify(cut)}`);
});

// Copilot on #107, round 2: with diff.interHunkContext set, git puts unchanged lines between nearby
// hunks even at -U0; they are lines of the result, so they move the destination line count too.
test('stagedAdds in a merge: context lines between hunks keep the positions of the merge\'s own lines', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-merge4-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'diff.interHunkContext', '10');
  const lines = (xs) => `${xs.join('\n')}\n`;
  fs.writeFileSync(path.join(repo, 'a.md'), lines(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']));
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'team/builder');
  fs.writeFileSync(path.join(repo, 'a.md'), lines(['l1', 'builder top', 'l2', 'l3', 'l4', 'l5', 'l6']));
  git('commit', '-q', '-am', 'builder');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'a.md'), lines(['l1', 'l2', 'l3', 'l4', 'l5', 'main bottom', 'l6']));
  git('commit', '-q', '-am', 'main');
  git('checkout', '-q', 'team/builder');
  try { git('merge', '-q', '--no-commit', '--no-ff', 'main'); } catch (err) { /* staged below */ }
  fs.writeFileSync(path.join(repo, 'a.md'), lines(['l1', 'builder top', 'l2', 'l3', COPIED, 'l4', 'l5', 'main bottom', 'l6']));
  git('add', '-A');
  assert.deepEqual(stagedAdds(repo, false), [{ file: 'a.md', text: COPIED }], 'the copied line, new against both parents, is read');
});

// Copilot on #107, round 3: a binary-looking parent, an added line that looks like a header, and a
// sentence from main the resolution only re-indents.
function mergeRepo(baseText, builderText, mainText) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-merge5-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), baseText);
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'team/builder');
  fs.writeFileSync(path.join(repo, 'a.txt'), builderText);
  git('commit', '-q', '-am', 'builder');
  git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), mainText);
  git('commit', '-q', '-am', 'main');
  git('checkout', '-q', 'team/builder');
  try { git('merge', '-q', '--no-commit', '--no-ff', 'main'); } catch (err) { /* staged below */ }
  return { repo, stage: (text) => { fs.writeFileSync(path.join(repo, 'a.txt'), text); git('add', '-A'); } };
}

test('stagedAdds in a merge: a parent copy with a NUL byte still yields the resolution\'s new lines', () => {
  const m = mergeRepo('a\nb\n', 'a\nbuilder\nb\n', 'a\0main\nb\n');
  m.stage(`a\nbuilder\nb\n${COPIED}\n`);
  assert.ok(stagedAdds(m.repo, false).some((f) => f.text.includes(COPIED)), 'the new line is read, not lost to a binary comparison');
});

test('stagedAdds in a merge: an added line starting with "++" is content, not a file header, from either parent', () => {
  for (const [builder, main] of [['x\n++ counter;\ny\n', 'x\ny\nmain\n'], ['x\ny\nbuilder\n', 'x\n++ counter;\ny\n']]) {
    const m = mergeRepo('x\ny\n', builder, main);
    const kept = builder.includes('++') ? `x\n++ counter;\ny\nmain\n${COPIED}\n` : `x\n++ counter;\ny\nbuilder\n${COPIED}\n`;
    m.stage(kept);
    const adds = stagedAdds(m.repo, false);
    assert.deepEqual(adds.map((f) => f.file), ['a.txt'], JSON.stringify(adds));
    assert.ok(adds[0].text.includes(COPIED), `the copied line is read: ${JSON.stringify(adds)}`);
    assert.ok(!adds[0].text.includes('++ counter;'), 'the inherited "++" line is not the merge\'s own');
  }
});

test('stagedAdds in a merge: a sentence from main that the resolution only re-indents is not new text', () => {
  const m = mergeRepo('top\n', 'top\nbuilder\n', `top\n${COPIED}\n`);
  m.stage(`top\nbuilder\n    ${COPIED}\n`);
  assert.deepEqual(stagedAdds(m.repo, false).map((f) => f.text).filter(Boolean), [], 'a re-indent of main\'s line is exempt, as a moved line is');
});
