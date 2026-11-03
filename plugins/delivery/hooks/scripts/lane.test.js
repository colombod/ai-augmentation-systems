// hooks/scripts/lane.test.js — run with: node --test hooks/scripts/lane.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPolicy, splitCommand, classifySegment, pathAllowed, decideLane } = require('./lane.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
const ctx = (over) => ({ roleDir, groups: GROUPS, pluginRoot: PLUGIN_ROOT, hostHeadless: false, ...over });

test('loadPolicy reads lane keys from a delivery role file', () => {
  const p = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
  assert.deepEqual(p.writes, []);
  assert.ok(p.bash.includes('bd-notes'));
  assert.ok(!p.bash.includes('any'));
  const b = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/builder' });
  assert.deepEqual(b.writes, ['product/**', 'scratch/**', 'project/.delivery/decisions/**']);
  assert.deepEqual(b.bash, ['any']);
});

test('splitCommand splits on operators outside quotes and keeps env assignments', () => {
  assert.deepEqual(splitCommand('git status && bd list --json | jq ".[0]"'), ['git status', 'bd list --json', 'jq ".[0]"']);
  assert.deepEqual(splitCommand('echo "a && b"; ls'), ['echo "a && b"', 'ls']);
  assert.deepEqual(splitCommand('FOO=1 bd prime'), ['FOO=1 bd prime']);
  assert.deepEqual(splitCommand('env FOO=1 bd prime'), ['env FOO=1 bd prime']);
});

test('classifySegment matches groups by first token, subcommand and flags', () => {
  assert.ok(classifySegment('git log --oneline -3', GROUPS, ctx()).includes('git-read'));
  assert.ok(classifySegment('bd update ex-1 --append-notes "x"', GROUPS, ctx()).includes('bd-notes'));
  assert.ok(!classifySegment('bd update ex-1 --append-notes "x" --parent ex-2', GROUPS, ctx()).includes('bd-notes'));
  assert.ok(classifySegment('bd update ex-1 --parent ex-2', GROUPS, ctx()).includes('bd-structure'));
  assert.ok(classifySegment('bd create "t" --parent ex-1', GROUPS, ctx()).includes('bd-create-child'));
  assert.ok(!classifySegment('bd create "t" --parent ex-1 --id ex-9', GROUPS, ctx()).includes('bd-create-child'));
  assert.ok(classifySegment('bd dep add ex-1 --blocked-by ex-2', GROUPS, ctx()).includes('bd-structure'));
  assert.deepEqual(classifySegment('rm -rf /tmp/x', GROUPS, ctx()), []);
  assert.deepEqual(classifySegment('cat a > b', GROUPS, ctx()), []);
  assert.deepEqual(classifySegment('sed -i s/a/b/ f', GROUPS, ctx()), []);
  assert.ok(classifySegment(`node ${PLUGIN_ROOT}/scripts/team-status.js`, GROUPS, ctx()).includes('read'));
  assert.ok(!classifySegment('node --test x.test.js', GROUPS, ctx()).includes('read'));
  assert.ok(classifySegment('anything at all', GROUPS, ctx()).includes('any'));
});

test('classifySegment scopes git writes by directory', () => {
  const cwdProject = path.join(roleDir, 'project');
  const cwdProduct = path.join(roleDir, 'product');
  assert.ok(classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProject })).includes('git-write-project'));
  assert.ok(!classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProject })).includes('git-write-product'));
  assert.ok(classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProduct })).includes('git-write-product'));
  assert.ok(classifySegment(`git -C ${cwdProduct} push`, GROUPS, ctx({ cwd: cwdProject })).includes('git-write-product'));
  // a role that owns plan documents can remove and move them in git, not only add them (a moved story
  // left a duplicate no role could remove, measured 2026-10-25)
  for (const c of ['git rm .delivery/initiatives/x/stories/s.md', 'git mv a.md b.md']) {
    assert.ok(classifySegment(c, GROUPS, ctx({ cwd: cwdProject })).includes('git-write-project'), c);
    assert.ok(!classifySegment(c, GROUPS, ctx({ cwd: cwdProduct })).includes('git-write-project'), `${c} in the product repo`);
  }
});

test('pathAllowed honours globs, exact files and tmp', () => {
  const writes = ['project/.delivery/stories/**', 'project/.delivery/team/denylist.txt', 'scratch/**'];
  assert.ok(pathAllowed(path.join(roleDir, 'project', '.delivery', 'stories', 'a', 'b.md'), { roleDir, writes }));
  assert.ok(pathAllowed(path.join(roleDir, 'project', '.delivery', 'team', 'denylist.txt'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'project', '.delivery', 'team', 'team.json'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'product', 'src', 'x.js'), { roleDir, writes }));
  assert.ok(pathAllowed(path.join(os.tmpdir(), 'x'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'project', '.delivery', 'stories'), { roleDir, writes: ['project/.delivery/stories/*.md'] }));
});

test('decideLane refuses with the sanctioned path and allows within lane', () => {
  const policy = { roleId: 'chief-of-staff', writes: [], bash: ['read', 'git-read', 'gh-read', 'bd-read', 'bd-notes', 'bd-create-child'] };
  const d1 = decideLane({ toolName: 'Edit', toolInput: { file_path: path.join(roleDir, 'product', 'a.js') }, policy, ...ctx() });
  assert.equal(d1.allow, false);
  assert.match(d1.reason, /chief-of-staff/);
  assert.match(d1.reason, /bd create --parent <id>/);
  const d2 = decideLane({ toolName: 'Bash', toolInput: { command: 'git status && bd list --json' }, policy, ...ctx() });
  assert.equal(d2.allow, true);
  const d3 = decideLane({ toolName: 'Bash', toolInput: { command: 'bd list && npm test' }, policy, ...ctx() });
  assert.equal(d3.allow, false);
  assert.match(d3.reason, /npm test/);
  const builder = { roleId: 'builder', writes: ['product/**', 'scratch/**'], bash: ['any'] };
  assert.equal(decideLane({ toolName: 'Bash', toolInput: { command: 'npm test' }, policy: builder, ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'Write', toolInput: { file_path: path.join(roleDir, 'project', '.delivery', 'stories', 'x.md') }, policy: builder, ...ctx() }).allow, false);
});

test('decideLane denies browser and computer tools on a headless host, even in a reach lane', () => {
  const policy = { roleId: 'reality-checker', writes: [], bash: ['read'], reach: true };
  const d = decideLane({ toolName: 'mcp__Claude_Browser__navigate', toolInput: {}, policy, ...ctx({ hostHeadless: true, hostName: 'wintermute', desktopHosts: ['alien51'] }) });
  assert.equal(d.allow, false);
  assert.match(d.reason, /alien51/);
  assert.equal(decideLane({ toolName: 'mcp__Claude_Browser__navigate', toolInput: {}, policy, ...ctx() }).allow, true);
});

test('manager lanes: no materialise via read, git-read non-mutating, stream redirects allowed', () => {
  const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy, ...ctx() });
  for (const command of [
    `node ${PLUGIN_ROOT}/scripts/materialise.js --project x --initiative y`,
    'git branch -D main',
  ]) assert.equal(run(command).allow, false, command);
  for (const command of [
    `node ${PLUGIN_ROOT}/scripts/team-status.js`,
    'git branch --show-current',
    'git remote -v',
    'bd list --json 2>/dev/null',
    'git status 2>&1 | head',
  ]) assert.equal(run(command).allow, true, command);
  assert.deepEqual(classifySegment('ls >/tmp/out', GROUPS, ctx()), []);
  assert.deepEqual(classifySegment('ls 2>/dev/nullx', GROUPS, ctx()), []);
  assert.ok(classifySegment('ls &>/dev/null', GROUPS, ctx()).includes('read'));
});

// Fix round 2: escapes found by adversarial review. Each row: [command, role, expectAllowed, cwd under roleDir].
const POLICIES = Object.fromEntries(['chief-of-staff', 'product-manager', 'progress-observer', 'delivery-lead', 'builder']
  .map((id) => [id, loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + id })]));
const COS = 'chief-of-staff', PM = 'product-manager', PO = 'progress-observer', DL = 'delivery-lead', BUILDER = 'builder';
const PROBES = [
  // C1 cd tracking: unknown targets, failed or skipped cd, export
  ['cd $P && git commit -m x', PM, false],
  ['cd ~/x && git commit -m x', PM, false],
  ['cd "$X" && git commit -m x', PM, false],
  ['cd && git commit -m x', PM, false],
  ['cd - && git commit -m x', PM, false],
  ['cd `pwd` && git commit -m x', PM, false],
  ['cd ../product && git commit -m x', PM, false, 'project'],
  ['cd ../product; cd ../project/nonexistent; git commit -m x', PM, false, 'project'],
  ['true || cd ../project && git commit -m x', PM, false, 'product'],
  ['cd ../project && git commit -m x', PM, true, 'product'],
  ['cd ../project && git add . && git commit -m x', PM, true, 'product'],
  ['git -C "$X" commit -m x', PM, false, 'project'],
  ['git -C ~/p commit -m x', PM, false, 'project'],
  ['export FOO=1', COS, false],
  // C2 env prefixes classify only as any
  ['FOO=1 bd prime', COS, false],
  ['env FOO=1 bd prime', COS, false],
  ['GIT_DIR=../product/.git git commit -m x', PM, false, 'project'],
  ['FOO=1 npm test', BUILDER, true],
  // C3 git option escapes; fetch is a write
  ['git log --output=/tmp/x', COS, false],
  ['git diff -o /tmp/x', COS, false],
  ['git diff --ext-diff', COS, false],
  ['git cat-file --textconv HEAD:x', COS, false],
  ['git fetch', COS, false],
  ['git fetch --upload-pack=evil', PM, false, 'project'],
  ['git pull --upload-pack=evil', PM, false, 'project'],
  ['git push --receive-pack=evil', PM, false, 'project'],
  ['git fetch', PM, true, 'project'],
  ['git log --oneline -5', COS, true],
  // C4 write-capable read tools
  ['sed -n 1,5p f', COS, false],
  ['uniq a b', COS, false],
  ['tree -o out', COS, false],
  ['file -C -m x', COS, false],
  ['sort -o out in', COS, false],
  ['sort -uo out in', COS, false],
  ['sort --output=out in', COS, false],
  ['sort in', COS, false], // fix round 3 (R2): sort left read
  ['rg --pre cat x', COS, false],
  ['rg --pre=cat x', COS, false],
  ['rg --pre-glob "*" x', COS, false],
  ['rg foo', COS, true],
  ['find . -fprint out', COS, false],
  ['find . -okdir rm {} +', COS, false],
  ['find . -name x', COS, true],
  // C5 stream-only redirects
  ['ls >&1x', COS, false],
  ['ls 2>&1x', COS, false],
  ['ls >/dev/nullx', COS, false],
  ['ls >& out', COS, false],
  ['ls >&2', COS, true],
  ['ls 2>&-', COS, true],
  ['ls > /dev/null', COS, true],
  ['ls 2>&1|head', COS, true],
  ['ls >&2;ls', COS, true],
  ['ls >>/dev/null&&ls', COS, true],
  // C6 worktree is not a project write
  ['git worktree add ../x', PM, false, 'project'],
  ['git worktree remove x', DL, false, 'project'],
  ['git worktree list', PM, true, 'project'],
  // I1 bd short flags and --id=
  ['bd update ex-1 --append-notes y -s closed', COS, false],
  ['bd update ex-1 --append-notes y -a bob', COS, false],
  ['bd update ex-1 --append-notes y -p 0', COS, false],
  ['bd update ex-1 --append-notes y -t bug', COS, false],
  ['bd update ex-1 --append-notes y -d desc', COS, false],
  ['bd update ex-1 --append-notes y -l foo', COS, false],
  ['bd update ex-1 --append-notes y', COS, true],
  ['bd create t --parent ex-1 --id=ex-9', COS, false],
  ['bd create t --parent=ex-1', COS, true],
  ['bd update ex-1 --claim --parent ex-2', PO, false],
  ['bd update ex-1 -s in_progress -p 0', PO, false],
  ['bd update ex-1 -s in_progress', PO, true],
  // I4 legitimate forms
  ['git --no-pager log -3', COS, true],
  ['git -P diff', COS, true],
  ['git --no-color status', COS, true],
  ['bd --json list', COS, true],
  ['node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js', COS, true],
  ['node "$CLAUDE_PLUGIN_ROOT/scripts/team-status.js"', COS, true],
  ['node $CLAUDE_PLUGIN_ROOT/scripts/materialise.js', COS, false],
  ['node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project x', DL, true],
  ['git commit -c abc123 -m x', PM, true, 'project'],
  ['git -c core.pager=x log', COS, false],
  // minor: git branch listing forms only
  ['git branch', COS, false],
  ['git branch new', COS, false],
  ['git branch -v new', COS, false],
  ['git branch -f main HEAD~1', COS, false],
  ['git branch -vd old', COS, false],
  ['git branch --list "feat*"', COS, true], // operator round 1 (F2): inside double quotes * is literal; git matches the pattern itself
  ['git branch --list feat*', COS, false], // fix round 3 (R1): an unquoted glob is expansion
  ['git branch --list main', COS, true],
  ['git branch --contains abc123', COS, true],
  ['git branch -a', COS, true],
  ['git branch -vv', COS, true],
  ['git branch --show-current', COS, true],
];

test('probe table: lane escapes stay closed, legitimate forms stay open', () => {
  const failures = [];
  for (const [command, role, expected, sub] of PROBES) {
    const cwd = path.join(roleDir, sub || 'project');
    const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], cwd, ...ctx() });
    if (d.allow !== expected) failures.push(role + ': ' + command + ' -> ' + d.allow);
  }
  assert.deepEqual(failures, []);
});

test('pathAllowed follows symlinks and real tmp paths; plugin root is not tmp', () => {
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-real-'));
  fs.mkdirSync(path.join(rd, 'product', 'src'), { recursive: true });
  fs.mkdirSync(path.join(rd, 'project', '.delivery', 'stories'), { recursive: true });
  fs.symlinkSync(path.join(rd, 'product'), path.join(rd, 'project', '.delivery', 'stories', 'link'));
  const writes = ['project/.delivery/stories/**'];
  assert.ok(pathAllowed(path.join(rd, 'project', '.delivery', 'stories', 'a.md'), { roleDir: rd, writes }));
  assert.ok(!pathAllowed(path.join(rd, 'project', '.delivery', 'stories', 'link', 'src', 'x.js'), { roleDir: rd, writes }));
  assert.ok(!pathAllowed([rd, 'project', '.delivery', 'stories', 'link', '..', 'x.js'].join(path.sep), { roleDir: rd, writes })); // physical `..`: rd/x.js
  // the same role dir reached through /private on macOS, or any other real-path spelling
  assert.ok(pathAllowed(path.join(fs.realpathSync(rd), 'project', '.delivery', 'stories', 'b.md'), { roleDir: rd, writes }));
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-plugin-'));
  assert.ok(pathAllowed(path.join(os.tmpdir(), 'scratch.txt'), { roleDir: rd, writes, pluginRoot: fakeRoot }));
  assert.ok(!pathAllowed(path.join(fakeRoot, 'hooks', 'x.js'), { roleDir: rd, writes, pluginRoot: fakeRoot }));
  const cos = POLICIES[COS];
  const viaLink = decideLane({ toolName: 'Write', toolInput: { file_path: 'link/src/x.js' }, policy: { ...cos, writes }, cwd: path.join(rd, 'project', '.delivery', 'stories'), ...ctx({ roleDir: rd }) });
  assert.equal(viaLink.allow, false);
});

test('decideLane: MultiEdit and write-capable MCP tools are denied outside the lane', () => {
  const cos = POLICIES[COS];
  const target = path.join(roleDir, 'product', 'a.js');
  assert.equal(decideLane({ toolName: 'MultiEdit', toolInput: { file_path: target, edits: [] }, policy: cos, ...ctx() }).allow, false);
  assert.equal(decideLane({ toolName: 'MultiEdit', toolInput: { edits: [{ file_path: target, old_string: 'a', new_string: 'b' }] }, policy: cos, ...ctx() }).allow, false);
  assert.equal(decideLane({ toolName: 'mcp__files__write_file', toolInput: { path: target }, policy: cos, ...ctx() }).allow, false);
  assert.equal(decideLane({ toolName: 'mcp__docs__create_document', toolInput: {}, policy: cos, ...ctx() }).allow, false);
  assert.equal(decideLane({ toolName: 'mcp__files__write_file', toolInput: { path: target }, policy: POLICIES[BUILDER], ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'mcp__files__read_file', toolInput: {}, policy: cos, ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'Agent', toolInput: { prompt: 'x' }, policy: cos, ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'Task', toolInput: { prompt: 'x' }, policy: cos, ...ctx() }).allow, true);
});

test('classifySegment: env prefixes are any-only; ctx.pluginRoot beats the environment', () => {
  assert.deepEqual(classifySegment('FOO=1 git status', GROUPS, ctx()), ['any']);
  assert.deepEqual(classifySegment('env git status', GROUPS, ctx()), ['any']);
  const { any, ...noAny } = GROUPS;
  assert.deepEqual(classifySegment('FOO=1 git status', noAny, ctx()), []);
  const saved = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = '/elsewhere';
  try {
    assert.ok(classifySegment('node ' + PLUGIN_ROOT + '/scripts/team-status.js', GROUPS, ctx()).includes('read'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = saved;
  }
});

// Fix round 3: root-cause remedies. Rows: [command, role, expectAllowed, cwd under roleDir].
const ROUND3 = [
  // R1 expansion is forbidden for allowlist roles
  ['git log -1 {--output=x,-1}', COS, false],
  ["git log $'--output=x'", COS, false],
  ['git log $"--output=x"', COS, false],
  ['git log ${X}', COS, false],
  ['cd {../product,} && git commit -m x', PM, false, 'project'],
  ['git -C {../product,.} commit -m x', PM, false, 'project'],
  ['echo "a$b"', COS, false],
  ['cat ~/x', COS, false],
  ['ls *.md', COS, false],
  ['ls file?.md', COS, false],
  ['ls [ab].md', COS, false],
  ['echo hi!', COS, false],
  ['cat <<EOF', COS, false],
  ['diff <(ls) x', COS, false],
  ['git log -1\\\n--oneline', COS, false], // a real backslash-newline continuation
  ['git log -1 --oneline', COS, true],
  ['bd update x --append-notes "note with spaces"', COS, true],
  ["bd update x --append-notes 'single quoted note'", COS, true],
  ['cat .delivery/team/team.json', COS, true],
  ['git log --format="%h %s" HEAD~3..HEAD', COS, true],
  ['FOO=1 npm test', BUILDER, true],
  ['ls *.md', BUILDER, true],
  // R2 printf and sort left read
  ['printf -v X %s y', COS, false],
  ['printf hello', COS, false],
  ['sort --compress-program=sh x', COS, false],
  // R3 prefix-abbreviated options
  ['git fetch --upload=evil', PM, false, 'project'],
  ['git fetch --upl=evil', PM, false, 'project'],
  ['git log --outp=x', COS, false],
  ['git diff --ext-d', COS, false],
  ['git push --rec=evil', PM, false, 'project'],
  ['git rebase -x "make" main', PM, false, 'project'],
  ['git rebase --exec=make main', PM, false, 'project'],
  ['git rebase --exe make main', PM, false, 'project'],
  ['git rebase main', PM, true, 'project'],
  ['git cherry-pick -x abc123', PM, true, 'project'],
  ['bd update x --append-notes y --par ex-2', COS, false],
  ['git log --oneline', COS, true],
  // R6 value-carrying short options are not clusters
  ['git log -Sfoo', COS, true],
  ['git log -Gpattern', COS, true],
  ['git ls-files -o', COS, true],
  ['git commit -mfoo', PM, true, 'project'],
  ['git commit -amfix', PM, true, 'project'],
  ['git branch -vd old', COS, false],
];

test('round 3 probe table: expansion, abbreviation and value-carrying options', () => {
  const failures = [];
  for (const [command, role, expected, sub] of ROUND3) {
    const cwd = path.join(roleDir, sub || 'project');
    const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], cwd, ...ctx() });
    if (d.allow !== expected) failures.push(role + ': ' + JSON.stringify(command) + ' -> ' + d.allow);
  }
  assert.deepEqual(failures, []);
  for (const seg of ['git log -1 {--output=x,-1}', "git log $'--output=x'", 'echo "a$b"', 'cat ~/x', 'ls *.md']) {
    assert.deepEqual(classifySegment(seg, GROUPS, ctx()).filter((n) => n !== 'any'), [], seg);
  }
});

test('R4: scope uses real paths for cd, -C and the role dir', () => {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-scope-')));
  fs.mkdirSync(path.join(real, 'project'), { recursive: true });
  fs.mkdirSync(path.join(real, 'product'), { recursive: true });
  fs.symlinkSync(path.join('..', 'product'), path.join(real, 'project', 'link'));
  const alias = real + '-alias';
  fs.symlinkSync(real, alias);
  const pm = POLICIES[PM];
  const run = (command, roleDirGiven, cwd) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: pm, ...ctx({ roleDir: roleDirGiven }), cwd }).allow;
  assert.equal(run('cd link && git commit -m x', real, path.join(real, 'project')), false);
  assert.equal(run('git -C link commit -m x', real, path.join(real, 'project')), false);
  assert.equal(run('git -C link/.. commit -m x', real, path.join(real, 'project')), false); // physical: real/
  assert.equal(run('git commit -m x', real, path.join(real, 'project', 'link')), false);
  // role dir given through a symlink, cwd given as the real path: still the project
  assert.equal(run('git commit -m x', alias, path.join(real, 'project')), true);
  assert.equal(run('git commit -m x', real, path.join(alias, 'project')), true);
  assert.equal(run('git commit -m x', alias, path.join(alias, 'product')), false);
});

test('R5: MCP tools are read-only for allowlist roles', () => {
  const pm = POLICIES[PM];
  const allow = (toolName, policy = pm) => decideLane({ toolName, toolInput: {}, policy, ...ctx() }).allow;
  assert.equal(allow('mcp__x__update_file'), false);
  assert.equal(allow('mcp__x__read_file_content'), true);
  assert.equal(allow('mcp__x__trash_file'), false);
  assert.equal(allow('mcp__x__search_and_replace'), false);
  assert.equal(allow('mcp__x__get_or_create'), false);
  assert.equal(allow('mcp__x__set_setting'), false);
  assert.equal(allow('mcp__x__send_message'), false);
  assert.equal(allow('mcp__x__spawn_task'), false);
  assert.equal(allow('mcp__x__list_sessions'), true);
  assert.equal(allow('mcp__x__get_page_text'), true);
  assert.equal(allow('mcp__x__update_file', POLICIES[BUILDER]), true);
  // browser and computer tools: only a reach lane, and never on a headless host
  assert.equal(allow('mcp__Claude_Browser__navigate'), false);
  assert.equal(decideLane({ toolName: 'mcp__Claude_Browser__navigate', toolInput: {}, policy: pm, ...ctx({ hostHeadless: true }) }).allow, false);
});

// Fix round 3b: single-quoted text is never expanded by bash, so it is exempt from the expansion check;
// a quoted command word is not, and a single-quoted flag still counts as that flag.
const ROUND3B = [
  ["grep -n 'phase [0-9]*' roadmap.md", COS, true],
  ["jq -r '.[] | .id' x.json", COS, true],
  ["bd update x --append-notes 'done? yes! $5 [ok]'", COS, true],
  ["git log -1 '{--output=x,-1}'", COS, true],
  ["cat '~/x'", COS, true],
  ['git log -1 {--output=x,-1}', COS, false],
  ["'cat' x", COS, false],
  ['"cat" x', COS, false],
  ['c\\at x', COS, false],
  ["git log -1 '--output=x'", COS, false],
  ['echo "it\'s $X"', COS, false],
  ["echo $'a'", COS, false],
  ["echo 'a'$X", COS, false],
  ["echo 'a\\'$(id)'", COS, false],
  // operator round 1 (F2): inside double quotes bash expands only $ and backticks; ~ ? ! are literal
  ['cat "~/x"', COS, true],
  ['bd update x --append-notes "done? yes!"', COS, true],
  ['bd update x --append-notes "done? $X"', COS, false],
  ['bd update x --append-notes "done `id`"', COS, false],
];

test('round 3b: single-quoted text is exempt from the expansion check, not from argv0 or flag rules', () => {
  const failures = [];
  for (const [command, role, expected] of ROUND3B) {
    const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], cwd: path.join(roleDir, 'project'), ...ctx() });
    if (d.allow !== expected) failures.push(role + ': ' + JSON.stringify(command) + ' -> ' + d.allow);
  }
  assert.deepEqual(failures, []);
});

// Fix round 4: per-subcommand git value letters, exact options that prefix denied ones, no `open` MCP verb.
const ROUND4 = [
  ['git rebase -mx make main', PM, false, 'project'],
  ['git rebase -Sx x main', PM, false, 'project'],
  ['git log -Sfoo', COS, true],
  ['git ls-files -o', COS, true],
  ['git commit -mfoo', PM, true, 'project'],
  ['git diff --text', COS, true],
  ['git diff --stat', COS, true],
  ['git log --oneline --name-only', COS, true],
  ['git log --out=x', COS, false],
  ['git diff --textc', COS, false],
];

test('round 4: git value letters per subcommand, exact-option exemption', () => {
  const failures = [];
  for (const [command, role, expected, sub] of ROUND4) {
    const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], cwd: path.join(roleDir, sub || 'project'), ...ctx() });
    if (d.allow !== expected) failures.push(role + ': ' + JSON.stringify(command) + ' -> ' + d.allow);
  }
  assert.deepEqual(failures, []);
});

test('round 4: open is not an MCP read verb', () => {
  const allow = (toolName) => decideLane({ toolName, toolInput: {}, policy: POLICIES[PM], ...ctx() }).allow;
  assert.equal(allow('mcp__x__open_terminal_tab'), false);
  assert.equal(allow('mcp__x__fetch_page'), true);
});

const { execFileSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

function runHook(script, input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('role-lane hook denies an out-of-lane edit for chief-of-staff and allows for builder', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Edit', tool_input: { file_path: path.join(roleDir, 'product', 'a.js') } }, { DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const json = JSON.parse(out);
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /chief-of-staff/);
  assert.ok(fs.readFileSync(path.join(roleDir, '.delivery-lane.log'), 'utf8').includes('DENIED'));
  const b = preparedRole('builder-1');
  const out2 = runHook('role-lane.js', { cwd: b.roleDir, session_id: 's', tool_name: 'Edit', tool_input: { file_path: path.join(b.roleDir, 'product', 'a.js') } }, { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  assert.equal(out2, '');
});

test('role-lane hook is inert without a role, with a mismatched DELIVERY_ROLE, and on garbage stdin', () => {
  assert.equal(runHook('role-lane.js', { cwd: os.tmpdir(), tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, {}), '');
  const { roleDir } = preparedRole('staffing');
  assert.equal(runHook('role-lane.js', { cwd: roleDir, tool_name: 'Bash', tool_input: { command: 'npm test' } }, { DELIVERY_ROLE: 'other' }), '');
  const raw = execFileSync(process.execPath, [path.join(__dirname, 'role-lane.js')], { input: 'not json', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  assert.equal(raw, '');
});

// Final wave A: shell channels other than Bash.
test('A: Monitor is judged like Bash, PowerShell needs any, an unknown tool with a command is a shell', () => {
  const d = (toolName, toolInput, role) => decideLane({ toolName, toolInput, policy: POLICIES[role], ...ctx() });
  const m = d('Monitor', { command: 'npm test' }, COS);
  assert.equal(m.allow, false);
  assert.match(m.reason, /npm test/);
  assert.match(m.reason, /bd create --parent <id>/);
  assert.equal(d('Monitor', { command: 'git status && bd list --json' }, COS).allow, true);
  assert.equal(d('Monitor', { command: 'npm test' }, BUILDER).allow, true);
  const ps = d('PowerShell', { command: 'Get-ChildItem' }, DL);
  assert.equal(ps.allow, false);
  assert.match(ps.reason, /PowerShell/);
  assert.match(ps.reason, /Building goes to a builder bead/);
  assert.equal(d('PowerShell', { command: 'Get-ChildItem' }, BUILDER).allow, true);
  const u = d('ShellRunner', { command: 'npm test' }, DL);
  assert.equal(u.allow, false);
  assert.match(u.reason, /npm test/);
  assert.equal(d('ShellRunner', { command: 'git status' }, DL).allow, true);
  assert.equal(d('ShellRunner', { command: 'npm test' }, BUILDER).allow, true);
  assert.equal(d('TodoWrite', { todos: [] }, DL).allow, true);
});

test('A: hooks.json routes Monitor and PowerShell to the lane, leak and bd guards', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const matcherFor = (event, script) => {
    const entry = hooks[event].find((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith(script))));
    return new RegExp(`^(?:${entry.matcher})$`);
  };
  for (const script of ['role-lane.js', 'leak-guard.js', 'bd-guard-hook.js']) {
    for (const tool of ['Bash', 'Monitor', 'PowerShell']) assert.ok(matcherFor('PreToolUse', script).test(tool), `${script} ${tool}`);
  }
});

// Final wave B: a per-role MCP allowlist (lane_mcp) beats the read-verb rule; headless still first.
test('B: lane_mcp allows named MCP tools regardless of verb', () => {
  const cos = POLICIES[COS];
  assert.ok(cos.mcp.includes('mcp__ccd_session_mgmt__send_message'));
  const allow = (toolName, policy = cos, over = {}) => decideLane({ toolName, toolInput: {}, policy, ...ctx(over) }).allow;
  assert.equal(allow('mcp__ccd_session_mgmt__send_message'), true);
  assert.equal(allow('mcp__ccd_session_mgmt__list_sessions'), true);
  assert.equal(allow('mcp__ccd_session_mgmt__get_session'), true);
  assert.equal(allow('mcp__ccd_session_mgmt__search_session_transcripts'), true);
  assert.equal(allow('mcp__ccd_session_mgmt__stop_session'), false);
  assert.equal(allow('mcp__ccd_session_mgmt__delete_session'), false);
  assert.equal(allow('mcp__x__update_file'), false);
  assert.equal(allow('mcp__x__send_message'), false);
  for (const id of ['delivery-lead', 'product-manager', 'staffing', 'progress-observer']) {
    const p = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + id });
    assert.equal(allow('mcp__ccd_session_mgmt__send_message', p), true, id);
    assert.equal(allow('mcp__x__update_file', p), false, id);
  }
  // A pattern matches the whole name; * is the only wildcard.
  const custom = { roleId: 'x', writes: [], bash: ['read'], mcp: ['mcp__a__do_*'] };
  assert.equal(allow('mcp__a__do_thing', custom), true);
  assert.equal(allow('mcp__a__do_thing_x', custom), true);
  assert.equal(allow('mcp__ab__do_thing', custom), false);
  // The headless rule still comes first.
  const reach = { roleId: 'x', writes: [], bash: ['read'], mcp: ['mcp__Claude_Browser__*'] };
  assert.equal(allow('mcp__Claude_Browser__navigate', reach, { hostHeadless: true }), false);
});

// Final wave H.1: a role file without lane keys gets read-only groups, not a full lockout and no writes.
test('H.1: missing or empty lane_bash defaults to read, bd-read, git-read, operator-read, judge', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-brief-'));
  const briefs = path.join(projectRoot, '.delivery', 'team', 'briefs');
  fs.mkdirSync(briefs, { recursive: true });
  fs.writeFileSync(path.join(briefs, 'specialist.md'), '---\nid: specialist\n---\n\nA hired specialist.\n');
  fs.writeFileSync(path.join(briefs, 'empty.md'), '---\nid: empty\nlane_bash:\nlane_writes:\n---\n\nEmpty keys.\n');
  for (const id of ['specialist', 'empty']) {
    const p = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot, briefRef: `project/${id}` });
    assert.deepEqual(p.bash, ['read', 'bd-read', 'git-read', 'operator-read', 'judge'], id);
    assert.deepEqual(p.writes, [], id);
    assert.deepEqual(p.mcp, [], id);
    const d = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: p, ...ctx() }).allow;
    assert.equal(d('git status && bd list --json && ls'), true);
    assert.equal(d('bd update ex-1 --append-notes x'), false);
    assert.equal(d('npm test'), false);
    assert.equal(decideLane({ toolName: 'Write', toolInput: { file_path: path.join(roleDir, 'project', 'x.md') }, policy: p, ...ctx() }).allow, false);
  }
});

// Final wave H.5: the harness's own plan and memory files are writable for every role.
test('H.5: Write/Edit/NotebookEdit/MultiEdit are allowed under ~/.claude/plans and ~/.claude/projects/*/memory', () => {
  const home = os.homedir();
  const allow = (toolName, file_path, role = COS) => decideLane({ toolName, toolInput: toolName === 'NotebookEdit' ? { notebook_path: file_path } : { file_path }, policy: POLICIES[role], ...ctx() }).allow;
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'MultiEdit']) {
    assert.equal(allow(tool, path.join(home, '.claude', 'plans', 'my-plan.md')), true, tool);
    assert.equal(allow(tool, path.join(home, '.claude', 'projects', '-Users-x-proj', 'memory', 'MEMORY.md')), true, tool);
  }
  assert.equal(allow('Write', path.join(home, '.claude', 'plans', 'sub', 'p.md'), PM), true);
  assert.equal(allow('Write', path.join(home, '.claude', 'settings.json')), false);
  assert.equal(allow('Write', path.join(home, '.claude', 'projects', '-Users-x-proj', 'transcript.jsonl')), false);
  assert.equal(allow('Write', path.join(home, '.claude', 'plans', '..', 'settings.json')), false);
  assert.equal(allow('Write', path.join(home, '.claude', 'projects', 'p', 'memory', '..', '..', '..', 'CLAUDE.md')), false);
  assert.equal(allow('Write', path.join(home, '.claude', 'plansx', 'p.md')), false);
  assert.equal(decideLane({ toolName: 'MultiEdit', toolInput: { file_path: path.join(home, '.claude', 'plans', 'p.md'), edits: [{ file_path: path.join(roleDir, 'product', 'a.js') }] }, policy: POLICIES[COS], ...ctx() }).allow, false);
});

// Final wave H.5 and H.6: lane hook through a subprocess.
test('H.6: role-lane hook fails open on a thrown error, denies Bash and headless browser tools, logs without control characters', () => {
  const env = (instance) => ({ DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  // M1: a corrupt team manifest with this session's own marker present fails CLOSED with the way out;
  // restoring the manifest stays allowed, and a session that is not this role stays inert.
  const broken = preparedRole('chief-of-staff');
  fs.writeFileSync(path.join(broken.projectRoot, '.delivery', 'team', 'team.json'), '{ not json');
  const closed = JSON.parse(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }, env('chief-of-staff')));
  assert.equal(closed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(closed.hookSpecificOutput.permissionDecisionReason, /the lane cannot be checked [\s\S]*checkout -- \.delivery\/team\/team\.json/);
  assert.equal(JSON.parse(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Write', tool_input: { file_path: path.join(broken.roleDir, 'x') } }, env('chief-of-staff'))).hookSpecificOutput.permissionDecision, 'deny');
  const restore = `git -C '${broken.projectRoot}' checkout -- .delivery/team/team.json`;
  assert.equal(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: restore } }, env('chief-of-staff')), '');
  for (const command of [
    `git -C $(id) checkout -- .delivery/team/team.json`,
    `git -C ${broken.projectRoot} checkout -- $(id).delivery/team/team.json`,
    `git -C ${broken.projectRoot} checkout -- x;id;#.delivery/team/team.json`,
    `git -C /tmp/other checkout -- .delivery/team/team.json`,
  ]) {
    const denied = JSON.parse(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command } }, env('chief-of-staff')));
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny', command);
  }
  assert.equal(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }, env('someone-else')), '');
  // Copilot 1: only ONE literal restore of the manifest is let through; any shell syntax is denied
  const pr = broken.projectRoot;
  for (const ok of [`git -C ${pr} checkout -- .delivery/team/team.json`, `git -C ${pr} restore -- .delivery/team/hosts.json`]) {
    assert.equal(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: ok } }, env('chief-of-staff')), '', ok);
  }
  for (const bad of [
    'git checkout -- $(id).delivery/team/team.json',
    'git checkout -- x;id;#.delivery/team/team.json',
    `git -C ${pr} checkout -- .delivery/team/team.json && id`,
    `git -C ${pr} checkout -- .delivery/team/team.json | sh`,
    `git -C ${pr} checkout -- \`id\`.delivery/team/team.json`,
    `git -C ${pr} checkout -- .delivery/team/team.json\nid`,
    `git -C ${pr} checkout -- .delivery/team/team.json; id`,
    `git -C ${pr} checkout -- .delivery/team/team.json > /tmp/x`,
    `git -C /tmp checkout -- .delivery/team/team.json`,
    `git -C ${pr} checkout HEAD~3 -- .delivery/team/team.json`,
    `git -C ${pr} checkout -- .delivery/team/team.json .delivery/operator/records/x.ndjson`,
    `git -C ${pr} checkout -- ../other/.delivery/team/team.json`,
    `git -C '${pr}' checkout -- .delivery/team/*.json`,
  ]) {
    const out = runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: bad } }, env('chief-of-staff'));
    assert.equal(out && JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny', bad);
  }
  // A corrupt role marker: inert.
  const marker = preparedRole('chief-of-staff');
  fs.writeFileSync(path.join(marker.roleDir, '.delivery-role.json'), '{ not json');
  assert.equal(runHook('role-lane.js', { cwd: marker.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }, env('chief-of-staff')), '');
  // A Bash deny through the hook, logged on one line with control characters stripped.
  const { roleDir: cos } = preparedRole('chief-of-staff');
  const out = runHook('role-lane.js', { cwd: cos, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test\r\x1b[2Kfake\tline' } }, env('chief-of-staff'));
  const json = JSON.parse(out);
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /npm test/);
  const log = fs.readFileSync(path.join(cos, '.delivery-lane.log'), 'utf8');
  assert.equal(log.split('\n').filter(Boolean).length, 1);
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f]/.test(log));
  assert.match(log, / Bash npm test/);
  // A browser tool on a headless host (progress-observer runs on buildbox).
  const { roleDir: po } = preparedRole('progress-observer');
  const b = JSON.parse(runHook('role-lane.js', { cwd: po, session_id: 's', tool_name: 'mcp__Claude_Browser__navigate', tool_input: { url: 'http://x' } }, env('progress-observer')));
  assert.equal(b.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(b.hookSpecificOutput.permissionDecisionReason, /real-surface runs belong to the Reality Checker/);
});

// Operator decisions: operator-read / operator-write groups and the protected operator directory.
test('operator groups: subcommand is the word after the exact script path', () => {
  const op = `${PLUGIN_ROOT}/scripts/operator.js`;
  assert.ok(classifySegment(`node ${op} verify dec-000001`, GROUPS, ctx()).includes('operator-read'));
  assert.ok(!classifySegment(`node ${op} verify dec-000001`, GROUPS, ctx()).includes('operator-write'));
  assert.ok(classifySegment('node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js pending --json', GROUPS, ctx()).includes('operator-read'));
  for (const sub of ['show dec-1', 'sync', 'ledger', 'find --text x', 'problems', 'refresh']) {
    assert.ok(classifySegment(`node ${op} ${sub}`, GROUPS, ctx()).includes('operator-read'), sub);
  }
  for (const sub of ['record --cite in-pc-000001 --quote "use postgres now" --statement "db"', 'delegate', 'decide', 'revoke', 'ack --input in-pc-000001 --reason "chat"', 'answer', 'ask', 'ratify', 'withdraw']) {
    const names = classifySegment(`node ${op} ${sub}`, GROUPS, ctx());
    assert.ok(names.includes('operator-write'), sub);
    assert.ok(!names.includes('operator-read'), sub);
  }
  // another script, a copy elsewhere, or the subcommand in the wrong place: no operator group
  assert.deepEqual(classifySegment(`node ${PLUGIN_ROOT}/scripts/team-status.js verify`, GROUPS, ctx()).filter((x) => x.startsWith('operator')), []);
  assert.deepEqual(classifySegment('node /tmp/operator.js verify dec-1', GROUPS, ctx()).filter((x) => x.startsWith('operator')), []);
  assert.deepEqual(classifySegment(`node ${op} --json verify dec-1`, GROUPS, ctx()).filter((x) => x.startsWith('operator')), []);
  assert.deepEqual(classifySegment(`node ${op} verify dec-1 > /tmp/x`, GROUPS, ctx()), []);
});

test('operator groups per role: managers read and write, a lane without operator-write cannot record, builder has any', () => {
  const op = `${PLUGIN_ROOT}/scripts/operator.js`;
  const run = (policy, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy, ...ctx() });
  for (const role of [COS, PM, PO, DL]) {
    assert.ok(POLICIES[role].bash.includes('operator-read'), role);
    assert.ok(POLICIES[role].bash.includes('operator-write'), role);
    assert.equal(run(POLICIES[role], `node ${op} verify dec-000001`).allow, true, role);
    assert.equal(run(POLICIES[role], `node ${op} record --cite in-pc-000001 --quote "use postgres now" --statement "db"`).allow, true, role);
  }
  assert.equal(run(POLICIES[BUILDER], `node ${op} record --cite in-pc-000001 --quote "use postgres now" --statement "db"`).allow, true);
  const readOnly = { roleId: 'reader', writes: [], bash: ['read', 'operator-read'] };
  assert.equal(run(readOnly, `node ${op} verify dec-000001`).allow, true);
  const d = run(readOnly, `node ${op} record --cite in-pc-000001 --quote "use postgres now" --statement "db"`);
  assert.equal(d.allow, false);
  assert.match(d.reason, /allowed groups: read, operator-read/);
  const staffing = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/staffing' });
  assert.ok(staffing.bash.includes('operator-read') && staffing.bash.includes('operator-write'));
});

test('judge group: every role may ask, list and read stats; another script or subcommand is not the judge', () => {
  const j = `${PLUGIN_ROOT}/scripts/judge.js`;
  for (const role of Object.keys(POLICIES)) {
    for (const command of [`node ${j} ask relay_request --state s.json`, `cat s.json | node ${j} ask divergence --state -`, `node ${j} questions`, `node ${j} stats`]) {
      assert.equal(decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() }).allow, true, `${role}: ${command}`);
    }
  }
  assert.ok(!classifySegment(`node ${j} purge`, GROUPS, ctx()).includes('judge'));
  assert.ok(!classifySegment('node /tmp/judge.js ask x', GROUPS, ctx()).includes('judge'));
});

test('the operator directory is never written with file tools, by any role', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-op-proj-'));
  const inputs = path.join(projectRoot, '.delivery', 'operator', 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  const target = path.join(inputs, '2026-10.ndjson');
  const deny = (role, toolName, toolInput, over = {}) => decideLane({ toolName, toolInput, policy: POLICIES[role], projectRoot, ...ctx(), ...over });
  for (const role of [COS, BUILDER, DL]) {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      const d = deny(role, tool, tool === 'MultiEdit' ? { file_path: target, edits: [] } : { file_path: target });
      assert.equal(d.allow, false, `${role} ${tool}`);
      assert.match(d.reason, /operator records are written by `operator\.js` only; read them with `operator\.js show`/);
    }
    assert.equal(deny(role, 'NotebookEdit', { notebook_path: path.join(projectRoot, '.delivery', 'operator', 'x.ipynb') }).allow, false, role);
  }
  // relative paths, `..` and symlinks resolve to the real directory
  assert.equal(deny(BUILDER, 'Write', { file_path: '.delivery/operator/records/builder-1.ndjson' }, { cwd: projectRoot }).allow, false);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.delivery', 'x', '..', 'operator', 'heads.json') }).allow, false);
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-op-link-')), 'op');
  fs.symlinkSync(path.join(projectRoot, '.delivery', 'operator'), link);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(link, 'inputs', 'x.ndjson') }).allow, false);
  // the role's own clone of the project is protected too
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(roleDir, 'project', '.delivery', 'operator', 'records', 'b.ndjson') }).allow, false);
  // neighbours stay as they were: builder's product lane, and tmp outside any project; a neighbour in
  // the project is the lane patterns' to decide, not the tmp exemption's (PR 58 I3)
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(roleDir, 'product', 'a.js') }).allow, true);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-scratch-')), 'operator-notes.md') }).allow, true);
  assert.match(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.delivery', 'operator-notes.md') }).reason, /^Role builder does not edit /);
});

test('shell writes into the operator directory are denied; reads are not', () => {
  const run = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() });
  for (const cmd of [
    'echo x >> .delivery/operator/records/chain.ndjson',
    'echo x > ./.delivery/operator/inputs/pc/2026-10.ndjson',
    'cat evil | tee -a .delivery/operator/records/b.ndjson',
    'cp /tmp/forged .delivery/operator/records/b.ndjson',
    'mv /tmp/forged .delivery//operator/records/b.ndjson',
    "sed -i '' s/a/b/ .delivery/operator/records/b.ndjson",
    'rm -rf .delivery/operator',
    'truncate -s 0 .delivery/operator/inputs/pc/2026-10.ndjson',
    'dd if=/dev/zero of=.delivery/operator/heads.json',
    'cd .delivery/operator && echo x >> records/b.ndjson',
    'git checkout HEAD~3 -- .delivery/operator/records/b.ndjson',
  ]) {
    for (const role of [BUILDER, COS]) {
      const d = run(role, cmd);
      assert.equal(d.allow, false, `${role}: ${cmd}`);
      if (role === BUILDER) assert.match(d.reason, /operator\.js/, cmd);
    }
  }
  assert.equal(run(BUILDER, 'cat .delivery/operator/records/b.ndjson | jq .id').allow, true);
  assert.equal(run(BUILDER, 'grep -c human .delivery/operator/inputs/pc/2026-10.ndjson 2>&1').allow, true);
  // a write elsewhere is not the operator rule's; the host's /tmp is refused on its own (7zz), so scratch/
  assert.equal(run(BUILDER, `echo x > ${path.join(roleDir, 'scratch', 'other.txt')}`).allow, true);
  assert.equal(run(BUILDER, `node ${PLUGIN_ROOT}/scripts/operator.js ack --input in-pc-000001 --reason "chat" 2>&1`).allow, true);
  assert.equal(run(COS, 'ls .delivery/operator/records').allow, true);
});

test('role-lane hook denies an operator-directory write for chief-of-staff and builder through the real manifest', () => {
  for (const instance of ['chief-of-staff', 'builder-1']) {
    const { projectRoot, roleDir } = preparedRole(instance);
    const file = path.join(projectRoot, '.delivery', 'operator', 'inputs', '2026-10.ndjson');
    const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Write', tool_input: { file_path: file, content: '{}' } }, { DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
    const json = JSON.parse(out);
    assert.equal(json.hookSpecificOutput.permissionDecision, 'deny', instance);
    assert.match(json.hookSpecificOutput.permissionDecisionReason, /operator\.js/);
  }
});

// The private operator store (<git-common-dir>/delivery-operator) gets the protection the old
// .delivery/operator directory had, and that directory keeps it.
test('the private operator store is never written with file tools, by any role', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-store-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  const records = path.join(projectRoot, '.git', 'delivery-operator', 'operator', 'records');
  fs.mkdirSync(records, { recursive: true });
  const target = path.join(records, 'chief-of-staff.ndjson');
  const deny = (role, toolName, toolInput, over = {}) => decideLane({ toolName, toolInput, policy: POLICIES[role], projectRoot, ...ctx(), ...over });
  for (const role of [COS, BUILDER, DL]) {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      const d = deny(role, tool, tool === 'MultiEdit' ? { file_path: target, edits: [] } : { file_path: target });
      assert.equal(d.allow, false, `${role} ${tool}`);
      assert.match(d.reason, /operator records are written by `operator\.js` only/);
    }
    assert.equal(deny(role, 'NotebookEdit', { notebook_path: path.join(projectRoot, '.git', 'delivery-operator', 'x.ipynb') }).allow, false, role);
    // the store's own git metadata too (refs, objects, config)
    assert.equal(deny(role, 'Write', { file_path: path.join(projectRoot, '.git', 'delivery-operator', '.git', 'refs', 'heads', 'delivery-operator') }).allow, false, role);
  }
  // relative, `..`, case-folded and symlinked spellings resolve to the store
  assert.equal(deny(BUILDER, 'Write', { file_path: '.git/delivery-operator/operator/records/b.ndjson' }, { cwd: projectRoot }).allow, false);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.git', 'x', '..', 'delivery-operator', 'operator', 'LEDGER.md') }).allow, false);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.GIT', 'Delivery-Operator', 'operator', 'b.ndjson') }).allow, false);
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-store-link-')), 'st');
  fs.symlinkSync(path.join(projectRoot, '.git', 'delivery-operator'), link);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(link, 'operator', 'records', 'x.ndjson') }).allow, false);
  // a shell write through that symlink, which never names the store, resolves into it too
  for (const cmd of [`echo x >> ${link}/operator/records/x.ndjson`, `cp /tmp/forged ${link}/operator/records/x.ndjson`, `echo x | tee -a ${link}/operator/LEDGER.md`]) {
    assert.equal(deny(BUILDER, 'Bash', { command: cmd }).allow, false, cmd);
  }
  assert.equal(deny(BUILDER, 'Bash', { command: `cat ${link}/operator/records/x.ndjson` }).allow, true, 'reading through it is fine');
  // the role's own clone of the project
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(roleDir, 'project', '.git', 'delivery-operator', 'operator', 'records', 'b.ndjson') }).allow, false);
  // a project that is a linked worktree: its store is in the main repository's .git
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: projectRoot });
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-store-wt-')), 'wt');
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: projectRoot });
  assert.equal(deny(BUILDER, 'Write', { file_path: target }, { projectRoot: wt }).allow, false);
  // the legacy directory stays protected: a stray copy there is no back door
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.delivery', 'operator', 'records', 'b.ndjson') }).allow, false);
  // neighbours stay as they were
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(roleDir, 'product', 'a.js') }).allow, true);
  const nb = deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.git', 'delivery-operator-notes.md') });
  assert.ok(nb.allow || !/operator\.js/.test(nb.reason), 'a neighbour of the store is not treated as the store');
});

test('shell writes into the private operator store or its branch are denied; reads are not', () => {
  const run = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() });
  for (const cmd of [
    'echo x >> .git/delivery-operator/operator/records/chain.ndjson',
    'echo x > ./.git//delivery-operator/operator/inputs/pc/2026-10.ndjson',
    'cat evil | tee -a .git/delivery-operator/operator/records/b.ndjson',
    'cp /tmp/forged .git/delivery-operator/operator/records/b.ndjson',
    "sed -i '' s/a/b/ .git/delivery-operator/operator/records/b.ndjson",
    'rm -rf .git/delivery-operator',
    'truncate -s 0 .GIT/Delivery-Operator/operator/inputs/pc/2026-10.ndjson',
    'git -C .git/delivery-operator reset --hard HEAD~1',
    'git -C .git/delivery-operator commit -qam forged',
    'cd .git/delivery-operator && git checkout HEAD~3 -- operator/records/b.ndjson',
    'GIT_DIR=.git/delivery-operator/.git git update-ref refs/heads/delivery-operator HEAD~1',
    'git push --force origin HEAD:delivery-operator',
    'git push origin :delivery-operator',
    'git push origin refs/heads/main:refs/heads/delivery-operator',
    'cd .git && git -C delivery-operator update-ref -d refs/heads/delivery-operator',
    'git --git-dir=.git/delivery-operator/.git reset --hard',
  ]) {
    for (const role of [BUILDER, COS]) {
      const d = run(role, cmd);
      assert.equal(d.allow, false, `${role}: ${cmd}`);
      if (role === BUILDER) assert.match(d.reason, /operator\.js/, cmd);
    }
  }
  assert.equal(run(BUILDER, 'cat .git/delivery-operator/operator/records/b.ndjson | jq .id').allow, true);
  assert.equal(run(BUILDER, 'grep -c human .git/delivery-operator/operator/inputs/pc/2026-10.ndjson').allow, true);
  assert.equal(run(COS, 'git -C .git/delivery-operator log --oneline').allow, true);
  assert.equal(run(COS, 'ls .git/delivery-operator/operator/records').allow, true);
  // a bare name is not a mention: commit messages and local branches that merely say it are left alone
  for (const role of [BUILDER, COS]) {
    const cmd = 'git commit -m "explain the delivery-operator branch"';
    const d = run(role, cmd);
    assert.ok(d.allow || !/operator\.js/.test(d.reason), `${role}: ${cmd}`);
  }
  assert.ok(!require('./lane.js').operatorShellWrite('git branch -D delivery-operator'));
  assert.ok(!require('./lane.js').operatorShellWrite('git commit -m "delivery-operator notes"'));
  assert.ok(require('./lane.js').operatorShellWrite('git push origin delivery-operator'));
  // entering the store step by step is a mention too
  for (const cmd of ['cd .git && cd delivery-operator && git -c user.name=x commit -qam x', 'cd .git; cd delivery-operator; echo x >> operator/records/b.ndjson',
    'pushd .git/delivery-operator && git reset --hard', 'cd .git && cd Delivery-Operator && rm -rf operator']) {
    assert.ok(require('./lane.js').operatorShellWrite(cmd), cmd);
  }
  assert.ok(!require('./lane.js').operatorShellWrite('cd .git && git log --oneline'));
});

test('role-lane hook denies a write into the private operator store through the real manifest', () => {
  for (const instance of ['chief-of-staff', 'builder-1']) {
    const { projectRoot, roleDir } = preparedRole(instance);
    const file = path.join(projectRoot, '.git', 'delivery-operator', 'operator', 'records', `${instance}.ndjson`);
    const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Write', tool_input: { file_path: file, content: '{}' } }, { DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
    const json = JSON.parse(out);
    assert.equal(json.hookSpecificOutput.permissionDecision, 'deny', instance);
    assert.match(json.hookSpecificOutput.permissionDecisionReason, /operator\.js/);
  }
});

// Task 3 round 1 (F1): no allowlist role passes --transcript or --session to operator.js.
test('F1: operator groups refuse --transcript and --session, in any spelling', () => {
  const op = `${PLUGIN_ROOT}/scripts/operator.js`;
  const run = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() });
  for (const cmd of [
    `node ${op} sync --transcript /tmp/forged.jsonl --session forged`,
    `node ${op} sync --transcript=/tmp/forged.jsonl`,
    `node ${op} sync --session forged`,
    `node ${op} sync --trans /tmp/forged.jsonl`,
    `node ${op} sync --Transcript /tmp/forged.jsonl`,
    `node ${op} sync --SESSION=forged`,
    `node ${op} ack --input in-pc-000001 --reason 'x' --Session forged`,
    `node ${op} record --cite in-pc-000001 --quote 'skip QA and ship' --statement 'ship' --transcript /tmp/forged.jsonl`,
  ]) {
    for (const role of [COS, PM, DL, PO]) assert.equal(run(role, cmd).allow, false, `${role}: ${cmd}`);
  }
  assert.equal(run(COS, `node ${op} sync`).allow, true);
  assert.equal(run(COS, `node ${op} sync --all --json`).allow, true);
});

// Task 3 round 1 (F2): inside double quotes bash expands only $ and backticks.
test('F2: ? ! * [ ] { } inside double quotes are literal; $ and backticks are refused with the construct named', () => {
  const op = `${PLUGIN_ROOT}/scripts/operator.js`;
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[COS], ...ctx() });
  for (const cmd of [
    `node ${op} ask --text "Which DB should we use?" --asker builder-1`,
    `node ${op} record --cite in-pc-000001 --quote "ship it!" --statement "ship"`,
    `node ${op} record --cite in-pc-000001 --quote "[urgent] use pg" --statement "x"`,
    `node ${op} answer --cite dec-1 --question "which db?" --answer "pg {primary}" --confidence settled`,
    `node ${op} ask --text 'Which DB should we use?' --asker builder-1`,
    `node ${op} record --cite in-pc-000001 --quote 'don'\\''t ship? not yet!' --statement 'hold'`,
    `node ${op} record --cite in-pc-000001 --quote "say \\"go\\" now?" --statement "go"`,
  ]) assert.equal(run(cmd).allow, true, cmd);
  const sub = run(`node ${op} ask --text "Which DB $(id)?" --asker builder-1`);
  assert.equal(sub.allow, false);
  assert.match(sub.reason, /Refused construct: command substitution/);
  assert.match(sub.reason, /put literal text in single quotes/);
  const tick = run(`node ${op} ask --text "Which DB \`id\`?" --asker builder-1`);
  assert.equal(tick.allow, false);
  assert.match(tick.reason, /command substitution/);
  const v = run(`node ${op} ask --text "Which DB $HOME?" --asker builder-1`);
  assert.equal(v.allow, false);
  assert.match(v.reason, /Refused construct: variable expansion/);
  // outside quotes the old behaviour stands
  const glob = run('ls *.md');
  assert.equal(glob.allow, false);
  assert.match(glob.reason, /Refused construct: an unquoted glob/);
  assert.equal(run('ls {a,b}').allow, false);
  // a refusal that is not about expansion says nothing about quoting
  assert.doesNotMatch(run('npm test').reason, /Refused construct/);
});

// Task 3 round 1 (M3): case variants name the same directory on case-insensitive file systems.
test('M3: .delivery/OPERATOR is protected like .delivery/operator', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-op-case-'));
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'operator', 'records'), { recursive: true });
  const d = (role, toolName, toolInput) => decideLane({ toolName, toolInput, policy: POLICIES[role], projectRoot, ...ctx() });
  for (const role of [COS, BUILDER]) {
    assert.equal(d(role, 'Write', { file_path: path.join(projectRoot, '.delivery', 'OPERATOR', 'records', 'b.ndjson') }).allow, false, role);
    assert.equal(d(role, 'Write', { file_path: path.join(projectRoot, '.Delivery', 'Operator', 'x') }).allow, false, role);
    assert.equal(d(role, 'Bash', { command: 'echo x >> .delivery/OPERATOR/records/c.ndjson' }).allow, false, role);
  }
});

test('F2: the new bd verbs classify into the lane groups the guard expects', () => {
  for (const c of ['bd assign ex-1 me', 'bd tag ex-1 x', 'bd todo add "x"', 'bd import f.jsonl', 'bd reopen ex-1', 'bd duplicates --merge', 'bd link ex-1 ex-2']) {
    assert.ok(classifySegment(c, GROUPS, ctx()).includes('bd-structure'), c);
  }
  for (const c of ['bd assign ex-1 me', 'bd reopen ex-1']) assert.ok(classifySegment(c, GROUPS, ctx()).includes('bd-claim'), c);
  assert.ok(!classifySegment('bd tag ex-1 x', GROUPS, ctx()).includes('bd-claim'));
});

// A1: the minimal team (Chief of Staff, Product Manager, Delivery Manager, builder) can carry the whole
// pipeline: every artifact a pipeline skill writes is in at least one of their lanes.
test('A1: every pipeline output path is writable by at least one role of the minimal team', () => {
  const minimal = ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder'];
  const policies = Object.fromEntries(minimal.map((id) => [id, loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + id })]));
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-a1-'));
  const outputs = {
    'initiatives/checkout/brief.md': 'product-manager', 'initiatives/checkout/research.md': 'product-manager',
    'initiatives/checkout/prd.md': 'product-manager', 'initiatives/checkout/prioritization.md': 'product-manager',
    'initiatives/checkout/design-system.md': 'product-manager', 'initiatives/checkout/architecture.md': 'product-manager',
    'initiatives/checkout/roadmap.md': 'product-manager', 'initiatives/checkout/notes.md': 'product-manager',
    'glossary.md': 'product-manager', 'personas/casual-carl.md': 'product-manager', 'interviews/casual-carl-01.md': 'product-manager',
    'simulations/checkout-journey.md': 'product-manager', 'decisions/ADR-007-queue.md': 'product-manager',
    'stories/checkout-01-cart.md': 'delivery-lead', 'stories/README.md': 'delivery-lead',
    'sprints/1-checkout.md': 'delivery-lead', 'sprints/1-checkout-handoff.md': 'delivery-lead', 'sprints/1-checkout-review.md': 'delivery-lead',
    'sprints/1-realign.md': 'product-manager', 'reviews/checkout-prd-01.md': 'product-manager', 'reviews/checkout-sprint-1-01.md': 'delivery-lead',
    'team/denylist.txt': 'delivery-lead',
  };
  for (const [rel, owner] of Object.entries(outputs)) {
    const file = path.join(rd, 'project', '.delivery', ...rel.split('/'));
    const writers = minimal.filter((id) => pathAllowed(file, { roleDir: rd, writes: policies[id].writes }));
    assert.ok(writers.length >= 1, `${rel}: no role of the minimal team may write it`);
    assert.ok(writers.includes(owner), `${rel}: expected ${owner}, writable by ${writers.join(', ')}`);
  }
  // the builder's product worktree, scratch area and spike-mode ADRs
  for (const rel of ['product/src/cart.js', 'scratch/spike/notes.md', 'project/.delivery/decisions/ADR-008-spike.md']) {
    assert.ok(pathAllowed(path.join(rd, ...rel.split('/')), { roleDir: rd, writes: policies.builder.writes }), rel);
  }
  // nobody in the minimal team but the Product Manager rewrites the roadmap, and no one writes the operator directory
  assert.ok(!pathAllowed(path.join(rd, 'project/.delivery/initiatives/checkout/roadmap.md'), { roleDir: rd, writes: policies['delivery-lead'].writes }));
  assert.ok(!pathAllowed(path.join(rd, 'project/.delivery/sprints/1-checkout.md'), { roleDir: rd, writes: policies['product-manager'].writes }), 'the PM writes only the realign record under sprints/');
});

test('a role with gh-write opens a pull request through REST, and only that', () => {
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[DL], ...ctx(), cwd: os.tmpdir() });
  const open = 'gh api -X POST repos/o/r/pulls -f title=\'Fix x\' -f head=team/builder -f base=main -f body=\'Refs dlv-1\'';
  assert.equal(run(open).allow, true, open);
  assert.equal(run('gh api repos/o/r/pulls -f title=x -f head=team/builder -f base=main').allow, true, 'POST implied by fields');
  for (const bad of [
    'gh api -X POST repos/o/r/pulls --input body.json',
    'gh api -X POST repos/o/r/pulls -f title=x -f head=h -f base=main -F body=@body.md',
    'gh api -X POST repos/o/r/pulls -f title=x -f head=h',
    'gh api -X POST repos/o/r/pulls -f title=x -f head=h -f base=main -f state=closed',
    'gh api -X POST repos/o/r/issues -f title=x -f head=h -f base=main',
    'gh api -X PATCH repos/o/r/pulls/3 -f title=x -f head=h -f base=main',
    'gh api -X POST repos/o/r/pulls/3/comments -f title=x -f head=h -f base=main',
  ]) assert.equal(run(bad).allow, false, bad);
});

// Owner ruling 2026-10-18: builders cannot merge; the Delivery Manager merges after independent review.
test('merging is the Delivery Manager\'s: builder and spike researcher lanes are refused every form of merge', () => {
  const SPIKE = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/spike-researcher' });
  const product = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-merge-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: product, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'init'); g('checkout', '-q', '-b', 'team/builder-1');
  const run = (policy, command, cwd = product) => decideLane({ toolName: 'Bash', toolInput: { command }, policy, ...ctx(), cwd });
  const refused = [
    'gh pr merge 12 --squash',
    'gh pr merge --auto --merge',
    'gh -R org/repo pr merge 12',
    'gh api -X PUT repos/org/repo/pulls/12/merge',
    'gh api repos/org/repo/merges -f base=main -f head=team/builder-1',
    'git push origin HEAD:main',
    'git push origin team/builder-1:refs/heads/main',
    'git push --force origin +HEAD:master',
  ];
  for (const policy of [POLICIES[BUILDER], SPIKE]) {
    for (const cmd of refused) {
      const d = run(policy, cmd);
      assert.equal(d.allow, false, `${policy.roleId}: ${cmd}`);
      assert.match(d.reason, /merging is the Delivery Manager's/, cmd);
    }
    // on the default branch, a bare push or a merge is a merge into it
    g('checkout', '-q', 'main');
    assert.equal(run(policy, 'git push').allow, false, `${policy.roleId}: git push on main`);
    assert.equal(run(policy, 'git merge team/builder-1').allow, false, `${policy.roleId}: git merge on main`);
    g('checkout', '-q', 'team/builder-1');
    // their own branch is theirs to push, and merging main into it (to resolve a conflict) is fine
    for (const ok of ['git push origin team/builder-1', 'git push -u origin HEAD', 'git push', 'git merge main', 'gh pr create --fill', 'gh pr view 12']) {
      assert.equal(run(policy, ok).allow, true, `${policy.roleId}: ${ok}`);
    }
    assert.equal(decideLane({ toolName: 'mcp__github__merge_pull_request', toolInput: {}, policy, ...ctx() }).allow, false);
  }
  // the delivery lead merges
  assert.equal(run(POLICIES[DL], 'gh pr merge 12 --squash').allow, true);
  assert.equal(run(POLICIES[COS], 'gh pr merge 12').allow, false);
});

// Copilot review of PR 49
test('Copilot: the fail-closed path still sees the role marker when lane.js itself fails to load', () => {
  const { roleDir } = preparedRole('builder-1');
  const pre = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lane-preload-')), 'break-lane.js');
  fs.writeFileSync(pre, `const M = require('module'); const load = M._load; M._load = function (req, ...a) { if (/[\\\\/]lane\\.js$|^\\.\\/lane\\.js$/.test(req)) throw new Error('simulated load failure'); return load.call(this, req, ...a); };`);
  const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } },
    { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, NODE_OPTIONS: `--require ${pre}` });
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /simulated load failure/);
});

test('Copilot: with the manifest unreadable, messaging the Chief of Staff stays allowed; other MCP writes do not', () => {
  const broken = preparedRole('builder-1');
  fs.writeFileSync(path.join(broken.projectRoot, '.delivery', 'team', 'team.json'), '{ not json');
  const e = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  for (const tool of ['mcp__ccd_session_mgmt__send_message', 'SendMessage']) {
    assert.equal(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: tool, tool_input: { to: 'chief-of-staff', message: 'the manifest is broken' } }, e), '', tool);
  }
  const other = runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'mcp__github__create_issue', tool_input: {} }, e);
  assert.equal(JSON.parse(other).hookSpecificOutput.permissionDecision, 'deny');
});

test('Copilot: the Delivery Manager can close the phase-review bead it owns', () => {
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[DL], ...ctx() });
  assert.equal(run('bd close ex-demo-ph1-review --reason "EVIDENCE: accepted, see .delivery/sprints/1-review.md"').allow, true);
});

test('1a acceptance group: every role reads warnings, surfaces, ready checks and evidence; only the Delivery Manager acks, records ready and writes evidence', () => {
  const s = (f) => `${PLUGIN_ROOT}/scripts/${f}`;
  const allow = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() }).allow;
  for (const role of [COS, PM, PO, DL]) {
    for (const command of [`node ${s('warnings.js')} list --open`, `node ${s('surface.js')} check vault`, `node ${s('ready.js')} ex-1`, `node ${s('evidence.js')} list ex-1`]) assert.equal(allow(role, command), true, `${role}: ${command}`);
  }
  for (const command of [`node ${s('warnings.js')} ack w-x-1 --reason ok`, `node ${s('ready.js')} ex-1 --record`, `node ${s('evidence.js')} add ex-1 --criterion 1 --result pass --surface S1 --sha d1`, `node ${s('evidence.js')} state ex-1 deployed --sha d1`, `node ${s('evidence.js')} cut ex-1 --record dec-x-1 --reason r`]) {
    assert.equal(allow(DL, command), true, command);
    for (const role of [COS, PM, PO]) assert.equal(allow(role, command), false, `${role}: ${command}`);
  }
  // `Bash(node ready.js:*)` would also allow --record, so the read rule gets no native allow
  const { laneAllowRules } = require('./lane.js');
  assert.ok(!laneAllowRules(POLICIES[COS], GROUPS, PLUGIN_ROOT).some((r) => r.includes('ready.js')));
  assert.ok(laneAllowRules(POLICIES[COS], GROUPS, PLUGIN_ROOT).some((r) => r.includes('evidence.js check')));
});

// R-05, 1b: a builder trying computer use on the owner's app is denied by the hook and natively; the
// manifest's "reach": true is the documented opt-in, and re-preparing takes the native deny out again.
test('1b: computer use on the owner\'s app is denied to a builder until its manifest entry opts in', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const call = () => runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'mcp__computer-use__app_click', tool_input: { app: 'ChatGPT' } }, env);
  const denied = JSON.parse(call());
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /Role builder does not drive browsers, desktop apps or computer use/);
  const settings = () => JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).permissions.deny;
  assert.ok(settings().includes('mcp__computer-use'));
  const file = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.find((r) => r.id === 'builder').reach = true;
  fs.writeFileSync(file, JSON.stringify(team));
  // the opt-in is local reach: its own UI on a local development host, never the owner's desktop
  assert.equal(runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'mcp__Claude_Browser__navigate', tool_input: { url: 'http://localhost:5173/' } }, env), '');
  assert.match(JSON.parse(call()).hookSpecificOutput.permissionDecisionReason, /not the owner's Chrome or desktop/);
  prepareRole({ projectRoot, instance: 'builder-1', teamDir: path.dirname(roleDir), pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.ok(!settings().includes('mcp__Claude_Browser'));
  assert.ok(settings().includes('mcp__computer-use'));
  // a hand edit that gives the Chief of Staff reach after prepare is ignored by the hook
  const cos = preparedRole('chief-of-staff');
  const tf = path.join(cos.projectRoot, '.delivery', 'team', 'team.json');
  const t2 = JSON.parse(fs.readFileSync(tf, 'utf8'));
  t2.roles.find((r) => r.id === 'chief-of-staff').reach = true;
  fs.writeFileSync(tf, JSON.stringify(t2));
  const c = JSON.parse(runHook('role-lane.js', { cwd: cos.roleDir, session_id: 's', tool_name: 'mcp__claude-in-chrome__navigate', tool_input: { url: 'https://chatgpt.com' } }, { DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }));
  assert.equal(c.hookSpecificOutput.permissionDecision, 'deny');
});

// The plugin's reviewer subagent (agents/pr-reviewer.md) gets a review lane whoever dispatches it:
// the Delivery Manager's lane runs no product code, and a reviewer inheriting it could not run the
// tests it must quote (found on a real pull request, the first one a single-builder team produced).
test('pr-reviewer lane: clones into review/, runs tests and edits there; refuses every write elsewhere', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const scratch = path.join(roleDir, 'review', 'pr-1');
  fs.mkdirSync(scratch, { recursive: true });
  fs.symlinkSync(PLUGIN_ROOT, path.join(roleDir, 'review', 'plug'));
  const env = { DELIVERY_ROLE: 'delivery-lead', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const call = (tool_input, { tool = 'Bash', agent = 'delivery:pr-reviewer', cwd = roleDir } = {}) => {
    const input = { cwd, session_id: 's', tool_name: tool, tool_input };
    if (agent) { input.agent_type = agent; input.agent_id = 'a1'; }
    const out = runHook('role-lane.js', input, env);
    return out === '' ? 'allow' : JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
  };
  const allowed = [
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js checkout 1 0123456789abcdef0123456789abcdef01234567',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js test 1',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js test 1 2>&1 | tail -5',
    `node ${PLUGIN_ROOT}/scripts/review-run.js test 1`,
    'git log --oneline -3',
    'git -C review/pr-1 diff HEAD~1',
    'gh pr diff 1',
    'bd show dlv-1',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review.js show 1',
  ];
  for (const c of allowed) assert.equal(call({ command: c }), 'allow', c);
  assert.equal(call({ file_path: path.join(scratch, 'a.js'), old_string: 'a', new_string: 'b' }, { tool: 'Edit' }), 'allow');
  const denied = [
    'git clone https://github.com/o/r /tmp/elsewhere',
    'git clone https://github.com/o/r',
    'git clone https://github.com/o/r review/../product',
    'mkdir -p project/x',
    'node --test',
    'npm test',
    'cd review/pr-1 && git push origin HEAD:main',
    'cd review/pr-1 && gh pr merge 1',
    'cd review/pr-1 && bd update dlv-1 --claim',
    'cd review/pr-1 && node ${CLAUDE_PLUGIN_ROOT}/scripts/review.js record 1 --head abc --result pass',
    `cd review/pr-1 && node ${PLUGIN_ROOT}/scripts/evidence.js add dlv-1`,
    'bd update dlv-1 --append-notes x',
    'cd review/pr-1 && env -u DELIVERY_ROLE node --test',
    // the independent review of this lane (PR 72) got past the first version with each of these
    'cd review/pr-1 && /usr/bin/git push origin HEAD:feature',
    'cd review/pr-1 && command git push origin HEAD:feature',
    'cd review/pr-1 && timeout 60 git push origin HEAD:feature',
    'cd review/pr-1 && nice git push origin HEAD:feature',
    'cd review/pr-1 && xargs git push < /dev/null',
    "cd review/pr-1 && sh -c 'git push origin HEAD:feature'",
    "cd review/pr-1 && bash -c 'gh pr merge 1 --squash'",
    'cd review/pr-1 && command gh pr review 1 --approve',
    'cd review/pr-1 && /usr/bin/bd update x --claim',
    'cd review/pr-1 && exec bd update x --claim',
    'cd review/pr-1 && npx bd update x',
    `cd review/pr-1 && node ${path.relative(path.join(roleDir, 'review', 'pr-1'), PLUGIN_ROOT)}/scripts/review.js record 1 --head a --result pass`,
    'cd review/pr-1 && node ../plug/scripts/review.js record 1 --head a --result pass',
    "cd review/pr-1 && node -e 'require(process.env.CLAUDE_PLUGIN_ROOT)'",
    'cd review && ln -s / plug',
    'git -C /tmp clone https://github.com/o/r review/pr-9',
    'git clone https://github.com/o/r /tmp/evil --server-option review/x',
    'git clone https://github.com/o/r /tmp/evil --bundle-uri review/x',
    'cd review/pr-1 && (cd / && npm test)',
    'cd review/pr-1 && pushd / && npm test',
    'cd review/pr-1 && npm --prefix / test',
    'cd review/pr-1 && npm test --prefix /',
    'cd review/pr-1 && make -C / test',
    'cd review/pr-1 && node --test /',
    'cd review && mkdir /tmp/evil-dir',
    'cd review && touch /tmp/evil',
    'cd review && tee /tmp/evil < /dev/null',
    'cd review && dd if=/dev/null of=/tmp/evil',
    'cd review && tar -xf a.tar -C /tmp',
    'cd review && perl -pi -e s/a/b/ /tmp/x',
    'git -C review/pr-1 apply --unsafe-paths p.patch',
    // the second review: runners named directly took options that point outside (attached values)
    'cd review/pr-1 && node --test',
    'cd review/pr-1 && npm test',
    'cd review/pr-1 && make test',
    'cd review/pr-1 && pytest --basetemp=/tmp/x',
    'cd review/pr-1 && make -C/ test',
    'cd review/pr-1 && node --test --test-reporter-destination=/tmp/out.txt',
    "cd review/pr-1 && echo 'x' | node",
    'cd review/pr-1 && dotnet test',
    'cd review/pr-1 && cargo test',
    // the third review: git run by the reviewer acted outside review/ through a fake bare repository
    // (core.worktree), so the reviewer runs no git writes and makes no directories itself
    'mkdir -p review',
    'mkdir -p review/pr-1/evil/objects review/pr-1/evil/refs',
    'git clone https://github.com/o/r review/pr-1',
    'git -C review/pr-1 fetch origin abc123',
    'git -C review/pr-1 checkout --detach abc123',
    'git -C review/pr-1/evil clean -fdx',
    'git -C review/pr-1 reset --hard',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js install 1',
  ];
  for (const c of denied) assert.notEqual(call({ command: c }), 'allow', c);
  assert.match(call({ file_path: path.join(roleDir, 'product', 'a.js'), old_string: 'a', new_string: 'b' }, { tool: 'Edit' }), /only under review\//);
  assert.notEqual(call({ file_path: path.join(roleDir, 'review', '..', 'project', 'a.md'), content: 'x' }, { tool: 'Write' }), 'allow');
  // a clone's .git config or hooks would make the allowed git commands act outside review/
  for (const f of ['.git/config', '.git/hooks/post-checkout', 'sub/.git/config', '.GIT/config', '.Git/HEAD', 'GIT~1/config', '.delivery-role.json', 'fake/.delivery/team/team.json', '.DELIVERY/team/team.json',
    // the fourth review: spellings Windows (trailing dot or space, NTFS streams) and HFS+ (zero-width) read as .git
    '.git./config', '.git /config', '.git::$INDEX_ALLOCATION/config', '.g\u200cit/config', '.delivery-role.json.', '.delivery-role.json::$DATA']) {
    assert.notEqual(call({ file_path: path.join(scratch, f), content: 'x' }, { tool: 'Write' }), 'allow', f);
  }
});

test('pr-reviewer lane: only when the Delivery Manager dispatches it; a role that runs no code does not gain it', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  fs.mkdirSync(path.join(roleDir, 'review', 'pr-1'), { recursive: true });
  const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Bash', agent_type: 'delivery:pr-reviewer', tool_input: { command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js test 1' } }, { DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('pr-reviewer lane: only the plugin\'s own reviewer gets it; the dispatching role keeps its lane', () => {
  const { roleDir } = preparedRole('delivery-lead');
  fs.mkdirSync(path.join(roleDir, 'review', 'pr-1'), { recursive: true });
  const env = { DELIVERY_ROLE: 'delivery-lead', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const run = (agent) => {
    const input = { cwd: roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js test 1' } };
    if (agent) input.agent_type = agent;
    return runHook('role-lane.js', input, env);
  };
  assert.equal(run('delivery:pr-reviewer'), '');
  for (const agent of [null, 'pr-reviewer', 'superpowers:code-reviewer', 'other:pr-reviewer']) {
    assert.equal(JSON.parse(run(agent)).hookSpecificOutput.permissionDecision, 'deny', String(agent));
  }
});

// fwa: the allow rules prepare-role writes pin the plugin's path of that day; after an update they no
// longer match and the decision loop stopped on a permission prompt. The hook approves the lane's own
// pre-allowable commands against the plugin root it runs from, and nothing else.
test('role-lane hook approves the lane\'s own commands at the running plugin root, and only those', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const env = { DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const decide = (command, cwd = roleDir) => {
    const out = runHook('role-lane.js', { cwd, session_id: 's', tool_name: 'Bash', tool_input: { command } }, env);
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : '';
  };
  const op = path.join(PLUGIN_ROOT, 'scripts', 'operator.js');
  assert.equal(decide(`node ${op} record --kind decision --text 'ship it'`), 'allow');
  assert.equal(decide(`node ${op} ack in-cos-000001`), 'allow');
  assert.equal(decide("bd comments add x-1 'seen'"), 'allow');
  assert.equal(decide("bd update x-1 --append-notes 'n'"), 'allow');
  assert.equal(decide(`cd ${roleDir} && node ${op} record --kind decision --text 'a'`), 'allow');
  // the rule's own flag limits still hold: the lane refuses, and nothing is approved
  assert.equal(decide(`node ${op} record --transcript x`), 'deny');
  assert.equal(decide("bd update x-1 --notes 'n' --status closed"), 'deny');
  // a stale plugin path is not this plugin: out of lane
  assert.equal(decide("node /old/delivery/0.41.2/scripts/operator.js record --kind decision --text 'a'"), 'deny');
  // in the lane but not pre-allowable (its rule says native_allow: false): left to the harness
  assert.equal(decide(`node ${path.join(PLUGIN_ROOT, 'scripts', 'ready.js')} x-1`), '');
  // a redirect makes it no lane command at all
  assert.equal(decide(`node ${op} record --kind decision --text 'a' > out.txt`), 'deny');
  // one out-of-lane segment denies the whole command
  assert.equal(decide(`node ${op} ack in-cos-000001 && rm -rf product`), 'deny');
  // an unrestricted lane is never approved by the hook: the harness decides
  const b = preparedRole('builder-1');
  assert.equal(runHook('role-lane.js', { cwd: b.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'bd comments add x-1 hi' } }, { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }), '');
});

test('nativeApproval approves nothing for a non-Bash tool, an any lane or the reviewer lane', () => {
  const { nativeApproval, reviewerPolicy } = require('./lane.js');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const pol = { roleId: 'chief-of-staff', bash: ['bd-notes'], writes: [], mcp: [] };
  const ctx = { roleDir: os.tmpdir(), pluginRoot: PLUGIN_ROOT, cwd: os.tmpdir() };
  const input = (tool_name) => ({ tool_name, tool_input: { command: 'bd comments add x-1 hi' } });
  assert.ok(nativeApproval(input('Bash'), pol, groups, ctx).allow);
  assert.equal(nativeApproval(input('PowerShell'), pol, groups, ctx), null);
  assert.equal(nativeApproval(input('Bash'), { ...pol, bash: ['bd-notes', 'any'] }, groups, ctx), null);
  const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  assert.ok(nativeApproval(ls, { ...pol, bash: ['read'] }, groups, ctx).allow);
  assert.equal(nativeApproval(ls, reviewerPolicy(pol), groups, ctx), null);
  assert.equal(nativeApproval({ tool_name: 'Bash', tool_input: { command: '' } }, pol, groups, ctx), null);
  // a quote inside a comment hides a second command from the lane's split; a symbolic plugin root
  // the lane expands is literal to bash: neither is approved (Copilot 4436789914, 4436789928)
  const cmd = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  const reads = { ...pol, bash: ['read', 'operator-read', 'bd-notes'] };
  assert.ok(nativeApproval(cmd("ls # x"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("ls # '\nrm -- product/a.js # '"), reads, groups, ctx) === null);
  // conservative: a quoted `#` is left to the harness as well; without it the same note is approved
  assert.ok(nativeApproval(cmd("bd comments add x-1 'see #12'"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("bd comments add x-1 'see 12'"), reads, groups, ctx).allow);
  assert.ok(nativeApproval(cmd("node '${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js'"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd('node $CLAUDE_PLUGIN_ROOT/scripts/team-status.js'), reads, groups, ctx) === null);
  // a redirect glued to a refused flag hides it from flags_none; bash strips it (Copilot 4436827075)
  assert.ok(nativeApproval(cmd("bd update x-1 --append-notes n --status</dev/null closed"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("bd update x-1 --append-notes n --status>/dev/null closed"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("bd update x-1 --append-notes n"), reads, groups, ctx).allow);
  // a backslash-newline inside quotes is removed by bash and kept by the lane (Copilot 4436886860)
  assert.ok(nativeApproval(cmd('bd update x-1 --append-notes n "--sta\\\ntus" closed'), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("bd update x-1 --append-notes 'a\\b'"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("ls; ls"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd("ls && ls"), reads, groups, ctx).allow);
  assert.ok(nativeApproval(cmd("ls *"), reads, groups, ctx) === null);
  assert.ok(nativeApproval(cmd(`node ${path.join(PLUGIN_ROOT, 'scripts', 'team-status.js')}`), reads, groups, ctx).allow);
});

// the Technical Writer edits documentation in its product worktree, never product code; Staffing adds a
// shipped role through team-role.js, never by a free-form edit of team.json
test('lane: the Technical Writer edits product docs only; Staffing runs team-role.js add', () => {
  const tw = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/tech-writer' });
  const edit = (rel) => decideLane({ toolName: 'Edit', toolInput: { file_path: path.join(roleDir, rel) }, policy: tw, ...ctx() }).allow;
  assert.equal(edit('product/README.md'), true);
  assert.equal(edit('product/plugins/x/docs/quickstart.md'), true);
  assert.equal(edit('product/src/app.js'), false);
  assert.equal(edit(path.join('project', '.delivery', 'team', 'team.json')), false);
  const bash = (policy, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy, ...ctx() }).allow;
  assert.equal(bash(tw, 'gh pr create --title docs --body x'), true);
  assert.equal(bash(tw, 'gh pr merge 1 --squash'), false);
  const staffing = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/staffing' });
  assert.equal(bash(staffing, `node ${path.join(PLUGIN_ROOT, 'scripts', 'team-role.js')} add tech-writer`), true);
  assert.equal(bash(POLICIES[COS], `node ${path.join(PLUGIN_ROOT, 'scripts', 'team-role.js')} add tech-writer`), false);
  assert.equal(bash(staffing, `node ${path.join(PLUGIN_ROOT, 'scripts', 'team-role.js')} add builder --count 2`), true);
  assert.equal(bash(staffing, `node ${path.join(PLUGIN_ROOT, 'scripts', 'team-role.js')} set-cap builders 2 --record dec-x-1`), true);
  assert.equal(bash(POLICIES[COS], `node ${path.join(PLUGIN_ROOT, 'scripts', 'team-role.js')} set-cap builders 2 --record dec-x-1`), false);
});

// Copilot on #118 (4437630044): the writer's git writes only what its lane writes; a form whose writes
// cannot be confined to documentation (another source, the whole tree, a glob) is refused
test('lane: the Technical Writer\'s git (git-write-docs) takes only documentation path operands', () => {
  const tw = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/tech-writer' });
  const sh = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: tw, ...ctx({ cwd: roleDir }) }).allow;
  const base = path.join(roleDir, 'product', 'tw-pkg');
  fs.mkdirSync(path.join(base, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'notes.md'), { recursive: true });
  try {
    // documentation, named: staged, restored from the index, removed, committed
    assert.equal(sh('git -C product add README.md docs/guide.md tw-pkg/docs'), true);
    assert.equal(sh('git -C product restore README.md'), true);
    assert.equal(sh('git -C product restore --staged -- docs/guide.md'), true);
    assert.equal(sh('git -C product rm docs/old.md'), true);
    assert.equal(sh('git -C product commit -m "Refs ex-1 document the import"'), true);
    assert.equal(sh('git -C product commit -m "Refs ex-1" -- README.md'), true);
    assert.equal(sh('git -C product push origin HEAD:team/tech-writer'), true);
    assert.equal(sh('git -C product fetch origin'), true);
    assert.equal(sh('git -C product switch -C team/tech-writer origin/main'), true);
    // Copilot's own case, and every other way to put source into the worktree
    assert.equal(sh('git -C product restore --source=HEAD~1 -- src/app.js'), false);
    assert.equal(sh('git -C product restore --source=HEAD~1 -- README.md'), false, 'another source is refused outright');
    assert.equal(sh('git -C product restore -s HEAD~1 README.md'), false);
    assert.equal(sh('git -C product restore -- src/app.js'), false);
    assert.equal(sh('git -C product checkout HEAD~1 -- src/app.js'), false);
    assert.equal(sh('git -C product reset --hard HEAD~1'), false);
    assert.equal(sh('git -C product merge origin/feature'), false);
    assert.equal(sh('git -C product pull'), false);
    assert.equal(sh('git -C product cherry-pick abc123'), false);
    assert.equal(sh('git -C product stash pop'), false);
    assert.equal(sh('git -C product add src/app.js'), false);
    assert.equal(sh('git -C product add README.md src/app.js'), false, 'one path outside the lane refuses the command');
    assert.equal(sh('git -C product add .'), false);
    assert.equal(sh('git -C product add -A'), false);
    assert.equal(sh('git -C product add *.md'), false);
    assert.equal(sh("git -C product add ':(glob)**'"), false);
    // a pathspec that reads as a Markdown path but that git expands to the whole tree
    assert.equal(sh("git -C product add ':(exclude)notes.md'"), false);
    assert.equal(sh("git -C product restore ':!README.md'"), false);
    assert.equal(sh('git -C product add --pathspec-from-file=list.txt'), false);
    assert.equal(sh('git -C product add tw-pkg/notes.md'), false, 'a directory named like a Markdown file holds more than Markdown');
    assert.equal(sh('git -C product mv README.md src/app.js'), false);
    assert.equal(sh('git -C product mv src/app.js docs/app.md'), false, 'moving source into the docs writes the source path too');
    assert.equal(sh('git -C product commit -m x -- src/app.js'), false);
    assert.equal(sh('git -C product commit -am x src/app.js'), false, 'the message is the value of -m; the path after it is a path');
    // -a stages every tracked change, source included, before the commit records the index
    assert.equal(sh('git -C product commit -am "Refs ex-1 document the import"'), false);
    assert.equal(sh('git -C product commit -a -m "Refs ex-1"'), false);
    assert.equal(sh('git -C product commit --all -m "Refs ex-1"'), false);
    assert.equal(sh('git -C product commit -a -m "Refs ex-1" -- README.md'), false);
    assert.equal(sh('git add product/README.md'), false, 'outside the product worktree the scope refuses');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// Copilot on #118 (4437630078): the writer files a docs bead under the story it documents
test('lane: the Technical Writer runs its documented bd create --parent, and only that create', () => {
  const tw = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/tech-writer' });
  const sh = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: tw, ...ctx({ cwd: roleDir }) }).allow;
  assert.equal(sh('bd create --parent ex-12 --type task --labels docs --title "Document the import command"'), true);
  assert.equal(sh('bd create --type task --labels docs --title "Document the import command"'), false);
  assert.equal(sh('bd dep add ex-1 ex-2'), false);
});

// hjx item 2: a suite run straight with node's test runner leaves its fixtures in the host's /tmp;
// every role, the any-lane builder included, runs tests only through the sealed runner
test('lane: node --test and a test file run directly are refused for every role; the sealed runner is not', () => {
  const run = (command, role = BUILDER) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[role], ...ctx() });
  for (const command of ['node --test', 'node --test hooks/scripts/lane.test.js', 'cd .. && node --test hooks/scripts/*.test.js',
    'node --test-name-pattern=x --test a.test.js', 'node scripts/watch.test.js', 'FOO=1 node --test', "bash -c 'node --test'", 'nodejs --test=a']) {
    const d = run(command);
    assert.equal(d.allow, false, command);
    assert.match(d.reason, /sealed runner/, command);
  }
  assert.match(run('node --test', COS).reason, /sealed runner/);
  for (const command of ['node scripts/testing/run-tests.js', 'DELIVERY_TEST_FILES=a.test.js node scripts/testing/run-tests.js',
    'node scripts/test-helper.js', 'npm test', 'grep -- --test lane.js']) assert.equal(run(command).allow, true, command);
});

// Copilot on #117: node's options that take a value are skipped with it, and only node's own options
// count: a --test after the script is the script's argument
test('lane: a value-taking node option does not hide a test file; --test after the script is not node\'s', () => {
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[BUILDER], ...ctx() });
  for (const command of ['node --conditions development hooks/scripts/lane.test.js', 'node -C development x.test.js',
    'node --test-reporter spec --test', 'node --env-file .env --test-name-pattern x a.test.js', 'node -- x.test.js', 'node --input-type module --test',
    // redirections are the shell's, apart or attached, never node's script (Copilot on #117)
    'node 2>/dev/null --test', 'node 2>/dev/null x.test.js', 'node x.test.js>/dev/null', 'node > out x.test.js', 'node &>/dev/null --test',
    'node x.test.js 2>&1', 'node 2>&1 x.test.js',
    // -i is node's interactive switch and takes no value (Copilot on #117)
    'node -i hooks/scripts/lane.test.js']) {
    assert.equal(run(command).allow, false, command);
  }
  for (const command of ['node --conditions development scripts/build.js', "node scripts/testing/run-tests.js -- 'node --test a.test.js'"]) {
    assert.equal(run(command).allow, true, command);
  }
});

// Copilot on #117, after each round found another spelling (redirections, -i, backslash-newline): a
// fail-safe reads the whole command with continuations joined and quotes and backslashes dropped, and
// refuses node or nodejs followed anywhere by --test or a test file, unless the command is the sealed
// runner alone. It over-refuses on purpose: the reason's sealed form runs any command.
test('lane: the fail-safe refuses every spelling of node with --test or a test file, the sealed runner alone excepted', () => {
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[BUILDER], ...ctx() });
  for (const command of [
    // backslash-newline continuations, unquoted and double-quoted
    'node \\\n--test', 'node \\\n  hooks/scripts/lane.test.js', 'node hooks/scripts/lane.te\\\nst.js', 'bash -c "node \\\n--test"', 'sh -c "node --te\\\nst"',
    // other spellings of the command word
    'n\\ode --test', '"node" --test', "'node' x.test.js", 'nodejs --test', '/usr/bin/node a.test.mjs',
    // over-refused on purpose: --test or a test file after node, wherever it sits
    'node scripts/test-helper.js --test', 'node tool.js --test=x', "node '2>tool.js' --test", 'node tool.js > a.test.js', 'node tool.js 2>&1 --test',
    // the runner, but not in its exact form (Copilot on #117): an operator, a substitution or a process
    // substitution outside the quotes runs outside the seal; an unquoted -- command is the outer shell's
    'node scripts/testing/run-tests.js -- npm test && node --test', 'node scripts/testing/run-tests.js $(node --test)',
    'node scripts/testing/run-tests.js > >(node --test)', 'node scripts/testing/run-tests.js -- node --test',
    "node scripts/testing/run-tests.js -- 'node --test a.test.js'; x", "node scripts/testing/run-tests.js -- 'node --test' 'x.test.js'"]) {
    const d = run(command);
    assert.equal(d.allow, false, command);
    assert.match(d.reason, /run-tests\.js -- '/, command);
  }
  // the exact form: whatever is inside the single quotes, substitutions and newlines included, runs sealed
  for (const command of ['node scripts/testing/run-tests.js', 'DELIVERY_TEST_FILES=a.test.js node scripts/testing/run-tests.js', 'npm test',
    'grep -- --test lane.js', 'git diff -- x.test.js', 'node-gyp --test', 'node scripts/build.js',
    "node scripts/testing/run-tests.js -- 'node \\\n--test'", 'node scripts/testing/run-tests.js -- \'node --test $(find . -name "*.test.js")\'',
    "node scripts/testing/run-tests.js -- 'cd x\nnode --test'", "/usr/local/bin/node /opt/delivery/scripts/testing/run-tests.js --clock 2027-03-15T12:00:00Z -- 'node --test'",
    'DELIVERY_TEST_FILES=a.test.js:b.test.js node scripts/testing/run-tests.js']) {
    assert.equal(run(command).allow, true, command);
  }
});

// Copilot on #117: any product's test command still runs, sealed; the reason names the command refused
// in the runner's -- form, with this plugin's runner path
test('lane: the tests reason names the refused command in the sealed runner\'s -- form', () => {
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[BUILDER], ...ctx() });
  const runner = path.join(PLUGIN_ROOT, 'scripts', 'testing', 'run-tests.js');
  // exactly the single-quoted form the lane admits, so it runs as given
  const d = run('node --test $(ls *.test.js)');
  assert.equal(d.allow, false);
  const form = `node ${runner} -- 'node --test $(ls *.test.js)'`;
  assert.ok(d.reason.includes(`\`${form}\``), d.reason);
  assert.equal(run(form).allow, true, form);
  // a command with a single quote cannot go in those quotes: a script file, run with sh
  const q = run("node --test it\\'s.test.js");
  assert.equal(q.allow, false);
  assert.ok(q.reason.includes(`put it in a script file and run \`node ${runner} -- 'sh <file>'\``), q.reason);
  assert.equal(run(`node ${runner} -- 'sh tests.sh'`).allow, true);
});

// Copilot on #117: a plugin under a path with spaces: the reason single-quotes the runner path, and the
// exemption admits a node or runner path given as one single-quoted literal, nothing outside it
test('lane: a runner path with spaces is suggested quoted and admitted quoted, and nothing may follow it', () => {
  const root = '/opt/Claude Plugins/delivery';
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: POLICIES[BUILDER], ...ctx({ pluginRoot: root }) });
  const quoted = `'${root}/scripts/testing/run-tests.js'`;
  const d = run('node --test');
  assert.equal(d.allow, false);
  const form = `node ${quoted} -- 'node --test'`;
  assert.ok(d.reason.includes(`\`${form}\``), d.reason);
  assert.equal(run(form).allow, true, form);
  assert.equal(run(`'/opt/Node Runtime/bin/node' ${quoted} -- 'node --test a.test.js'`).allow, true);
  for (const command of [`${form}; x`, `node ${quoted} $(node --test)`, `node ${quoted} -- 'node --test' $(x)`, `node '${root}/scripts/testing/run-tests.js'x -- 'node --test'`,
    `node ${root}/scripts/testing/run-tests.js -- 'node --test'`]) {
    assert.equal(run(command).allow, false, command);
  }
});

// delivery-plugin-planning-8wz.1: `node <project>/.delivery/bin/delivery.js <x>.js ...` (the launcher,
// which survives plugin installs) is judged exactly as `node <plugin root>/scripts/<x>.js ...`, and only
// for this project's unedited launcher.
test('the project launcher is judged as the script it runs, only when it is this project\'s and unedited', () => {
  const L = require('../../scripts/lib/launcher.js');
  const { nativeApproval, reviewerPolicy } = require('./lane.js');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-launch-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-launch-other-'));
  assert.equal(L.ensureLauncher(proj, PLUGIN_ROOT), null);
  assert.equal(L.ensureLauncher(other, PLUGIN_ROOT), null);
  const lp = L.launcherPath(proj);
  const cos = { roleId: 'chief-of-staff', writes: [], bash: ['operator-read', 'operator-write'] };
  const run = (command, over = {}) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: over.policy || cos, ...ctx({ projectRoot: proj, cwd: os.tmpdir(), ...over }) });
  // accepted: the same verdict as the absolute form
  for (const sub of ['verify dec-1', 'record --cite in-1 --quote x --statement y']) {
    assert.equal(run(`node ${PLUGIN_ROOT}/scripts/operator.js ${sub}`).allow, true, `absolute: ${sub}`);
    assert.equal(run(`node ${lp} operator.js ${sub}`).allow, true, `launcher: ${sub}`);
    assert.equal(run(`node '${lp}' operator.js ${sub}`).allow, true, `quoted launcher: ${sub}`);
  }
  // refused: what the absolute form refuses, a bad script name, another directory's launcher, no project
  for (const [command, over] of [
    [`node ${lp} operator.js verify dec-1 --transcript /x`],
    [`node ${lp} evidence.js add x --criterion 1 --result pass`],
    [`node ${lp} ../scripts/operator.js verify dec-1`],
    [`node ${lp} testing/run-tests.js`],
    [`node ${lp} missing-script.js verify dec-1`],
    [`node ${L.launcherPath(other)} operator.js verify dec-1`],
    [`node ${lp} operator.js verify dec-1`, { projectRoot: undefined }],
    [`node ${lp} operator.js verify dec-1`, { projectRoot: other }],
  ]) assert.equal(run(command, over || {}).allow, false, command);
  // an edited launcher is never trusted
  fs.appendFileSync(lp, '// edited\n');
  assert.equal(run(`node ${lp} operator.js verify dec-1`).allow, false, 'edited');
  assert.equal(L.ensureLauncher(proj, PLUGIN_ROOT), null);
  assert.equal(run(`node ${lp} operator.js verify dec-1`).allow, true, 'restored');
  // the watchdog refusal holds through the launcher, even in an any lane; its read-only check does not
  const any = { roleId: 'builder', writes: [], bash: ['any'] };
  const wd = run(`node ${lp} watchdog.js run`, { policy: any });
  assert.equal(wd.allow, false);
  assert.match(wd.reason, /watchdog/);
  assert.equal(run(`node ${lp} watchdog.js check --json`, { policy: any }).allow, true);
  // a reviewer is told the reviewer's rule, not just the groups
  const rv = run(`node ${lp} review.js record 1 --head abc --result pass --summary x`, { policy: reviewerPolicy(cos) });
  assert.equal(rv.allow, false);
  assert.match(rv.reason, /a reviewer reads/);
  // the hook's own approval (no permission prompt) covers the launcher form too, only with the project known
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  const nctx = { roleDir, pluginRoot: PLUGIN_ROOT, cwd: os.tmpdir(), projectRoot: proj };
  assert.ok(nativeApproval(bash(`node ${lp} operator.js verify dec-1`), cos, GROUPS, nctx));
  assert.equal(nativeApproval(bash(`node ${lp} operator.js verify dec-1`), cos, GROUPS, { ...nctx, projectRoot: undefined }), null);
});

// After an install the hook can still run from the old root while the launcher resolves the new one: the
// command is judged by the script's name, and only when the plugin the launcher runs has that script.
test('the project launcher is judged only when the plugin it resolves to has the script', () => {
  const L = require('../../scripts/lib/launcher.js');
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-launch-cfg-'));
  const cache = path.join(cfg, 'plugins', 'cache', 'm', 'delivery');
  fs.mkdirSync(cache, { recursive: true });
  // the hook runs this plugin as a cache install (a link to it); the launcher resolves to the newer one listed
  const running = path.join(cache, '1.0.0');
  fs.symlinkSync(PLUGIN_ROOT, running);
  const newer = path.join(cache, '1.0.1');
  fs.mkdirSync(path.join(newer, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(newer, 'scripts', 'watchdog.js'), '');
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'delivery@m': [{ installPath: newer, version: '1.0.1', scope: 'user' }] } }));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-launch-new-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    assert.equal(L.ensureLauncher(proj, running), null);
    const cos = { roleId: 'chief-of-staff', writes: [], bash: ['operator-read'] };
    const run = () => decideLane({ toolName: 'Bash', toolInput: { command: `node ${L.launcherPath(proj)} operator.js verify dec-1` }, policy: cos, ...ctx({ pluginRoot: running, projectRoot: proj, cwd: os.tmpdir() }) });
    assert.equal(run().allow, false, 'the newer plugin has no operator.js: the launcher would fail, nothing is judged');
    fs.writeFileSync(path.join(newer, 'scripts', 'operator.js'), '');
    assert.equal(run().allow, true, 'it has one now');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// 7zz: the team leaves no files in the host's temporary directory. An any-lane builder had written its
// logs and mutation backups there; its shell writes into os.tmpdir() or $TMPDIR are refused, pointing
// to its scratch/, while writes in its role directory, stream redirects and reads from /tmp still run.
test('an any-lane shell write into the host temporary directory is refused; scratch, worktree, streams and reads are not', () => {
  const builder = { roleId: 'builder', writes: ['product/**', 'scratch/**'], bash: ['any'] };
  const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-7zz-'));
  const wt = path.join(rd, 'scratch', 'wt-1');
  fs.mkdirSync(wt, { recursive: true });
  // a TMPDIR outside /tmp (it need not exist: paths are judged lexically past the first missing part)
  const envTmp = path.join(path.parse(rd).root, 'nonexistent-7zz', 'tmp');
  const run = (command, cwd = wt) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: builder, ...ctx({ roleDir: rd, cwd }) });
  const prev = process.env.TMPDIR;
  // os.tmpdir() held apart from both, so each of the three is shown to count on its own
  const hostTmp = path.join(path.parse(rd).root, 'nonexistent-7zz', 'os-tmpdir');
  // both the host's /tmp and $TMPDIR count, by real path, also when TMPDIR points somewhere else; on
  // POSIX os.tmpdir() follows TMPDIR, on Windows it does not (TEMP)
  process.env.TMPDIR = envTmp;
  const tmpdir = os.tmpdir;
  os.tmpdir = () => hostTmp;
  try {
    for (const tmp of [hostTmp, '/tmp', envTmp]) {
      for (const command of [
        `npm test > ${tmp}/b2-full.log`,
        `npm test >> ${tmp}/b2-full.log 2>&1`,
        `npm test &> ${tmp}/b2-full.log`,
        `echo x >| ${tmp}/x.txt`,
        `npm test 2> ${tmp}/err.txt`,
        `npm test 2>&1 | tee ${tmp}/wd-test.txt`,
        `echo x | tee -a ${tmp}/wd-test.txt`,
        `cp lane.js ${tmp}/riv.bak`,
        `cp -t ${tmp} lane.js`,
        `mv lane.js ${tmp}/riv.bak`,
        `mkdir -p ${tmp}/vrp-mut`,
        `touch ${tmp}/x`,
        `mktemp -p ${tmp}`,
        `cd ${tmp} && echo x > out.log`,
        // a variable or substitution is judged by the literal directory before it (rv-152)
        `npm test > ${tmp}/suite-$ID.log`,
        `npm test > ${tmp}/suite-$(date +%s).log`,
        `for f in a b; do echo x > ${tmp}/$f.log; done`,
        `cp --target-directory ${tmp} lane.js`,
        `install -d ${tmp}/x`,
        `(cd ${tmp} && echo x > out.log)`,
        `(cd ${tmp}; npm test > out.log); ls`,
      ]) {
        const d = run(command);
        assert.equal(d.allow, false, command);
        assert.match(d.reason, /temporary directory/, command);
        assert.ok(d.reason.includes(`${path.join(fs.realpathSync(rd), 'scratch')}${path.sep}`), `the reason names scratch/: ${d.reason}`);
      }
    }
    // mktemp creates in $TMPDIR unless told otherwise; $TMPDIR in a word is the host's tmp too
    for (const command of ['mktemp', 'mktemp -d', 'mktemp -t run.XXXX', 'x=$(mktemp)', 'echo x > "$TMPDIR/k.log"', 'echo x > ${TMPDIR:-/tmp}/k.log']) {
      assert.equal(run(command).allow, false, command);
    }
    const scratch = path.join(rd, 'scratch');
    for (const command of [
      `npm test > ${scratch}/b2-full.log 2>&1`,
      `npm test >> ${scratch}/b2-full.log`,
      `npm test 2>&1 | tee ${scratch}/wd-test.txt`,
      `cp lane.js ${scratch}/riv.bak`,
      `mv lane.js ${scratch}/riv.bak`,
      `mkdir -p ${scratch}/vrp-mut`,
      `mktemp -p ${scratch}`,
      `mktemp -d ${scratch}/mut.XXXX`,
      'cp lane.js lane.js.bak',
      'npm test > test.log 2>&1',
      'mkdir -p mut',
      'npm test 2>/dev/null',
      'npm test >/dev/null 2>&1',
      'npm test 2>&1 | head',
      'cat /tmp/x',
      `cat ${envTmp}/x | grep y`,
      // the cd ends with its subshell; a heredoc body is input, not commands; an unseen directory is not judged
      '(cd /tmp && ls); echo x > out.log',
      `cat > ${scratch}/notes.sh <<'EOF'\necho hi > /tmp/x.log\nEOF`,
      `cat > ${scratch}/notes.sh <<-EOF\n\tnpm test > /tmp/x.log\n\tEOF\nls`,
      'echo x > out-$ID.log',
      'echo x > $D/a.log',
      'cp /tmp/x lane.js',
      'rm -rf /tmp/old-run',
      'git commit -m "logs no longer go to /tmp > anywhere"',
      `node ${PLUGIN_ROOT}/scripts/testing/run-tests.js`,
      `DELIVERY_TEST_FILES=hooks/scripts/lane.test.js node ${PLUGIN_ROOT}/scripts/testing/run-tests.js`,
      `node ${PLUGIN_ROOT}/scripts/testing/run-tests.js -- 'sh x.sh > /tmp/in-seal.log'`,
    ]) assert.equal(run(command).allow, true, command);
  } finally {
    os.tmpdir = tmpdir;
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev;
  }
});
