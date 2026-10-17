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
  assert.deepEqual(b.writes, ['product/**', 'scratch/**']);
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
  assert.match(d1.reason, /create a child bead/);
  const d2 = decideLane({ toolName: 'Bash', toolInput: { command: 'git status && bd list --json' }, policy, ...ctx() });
  assert.equal(d2.allow, true);
  const d3 = decideLane({ toolName: 'Bash', toolInput: { command: 'bd list && npm test' }, policy, ...ctx() });
  assert.equal(d3.allow, false);
  assert.match(d3.reason, /npm test/);
  const builder = { roleId: 'builder', writes: ['product/**', 'scratch/**'], bash: ['any'] };
  assert.equal(decideLane({ toolName: 'Bash', toolInput: { command: 'npm test' }, policy: builder, ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'Write', toolInput: { file_path: path.join(roleDir, 'project', '.delivery', 'stories', 'x.md') }, policy: builder, ...ctx() }).allow, false);
});

test('decideLane denies browser and computer tools on a headless host', () => {
  const policy = { roleId: 'progress-observer', writes: [], bash: ['read'] };
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
  // browser and computer tools: the headless rule decides
  assert.equal(allow('mcp__Claude_Browser__navigate'), true);
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
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
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
  assert.match(m.reason, /create a child bead/);
  assert.equal(d('Monitor', { command: 'git status && bd list --json' }, COS).allow, true);
  assert.equal(d('Monitor', { command: 'npm test' }, BUILDER).allow, true);
  const ps = d('PowerShell', { command: 'Get-ChildItem' }, DL);
  assert.equal(ps.allow, false);
  assert.match(ps.reason, /PowerShell/);
  assert.match(ps.reason, /Sanctioned path for delivery-lead/);
  assert.equal(d('PowerShell', { command: 'Get-ChildItem' }, BUILDER).allow, true);
  const u = d('ShellRunner', { command: 'npm test' }, DL);
  assert.equal(u.allow, false);
  assert.match(u.reason, /npm test/);
  assert.equal(d('ShellRunner', { command: 'git status' }, DL).allow, true);
  assert.equal(d('ShellRunner', { command: 'npm test' }, BUILDER).allow, true);
  assert.equal(d('TodoWrite', { todos: [] }, DL).allow, true);
});

test('A: hooks.json routes Monitor and PowerShell to the lane, leak and bd guards, Monitor to the post-push scan', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const matcherFor = (event, script) => {
    const entry = hooks[event].find((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith(script))));
    return new RegExp(`^(?:${entry.matcher})$`);
  };
  for (const script of ['role-lane.js', 'leak-guard.js', 'bd-guard-hook.js']) {
    for (const tool of ['Bash', 'Monitor', 'PowerShell']) assert.ok(matcherFor('PreToolUse', script).test(tool), `${script} ${tool}`);
  }
  assert.ok(matcherFor('PostToolUse', 'leak-post-push.js').test('Monitor'));
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
test('H.1: missing or empty lane_bash defaults to read, bd-read, git-read, operator-read', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-brief-'));
  const briefs = path.join(projectRoot, '.delivery', 'team', 'briefs');
  fs.mkdirSync(briefs, { recursive: true });
  fs.writeFileSync(path.join(briefs, 'specialist.md'), '---\nid: specialist\n---\n\nA hired specialist.\n');
  fs.writeFileSync(path.join(briefs, 'empty.md'), '---\nid: empty\nlane_bash:\nlane_writes:\n---\n\nEmpty keys.\n');
  for (const id of ['specialist', 'empty']) {
    const p = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot, briefRef: `project/${id}` });
    assert.deepEqual(p.bash, ['read', 'bd-read', 'git-read', 'operator-read'], id);
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
  assert.match(closed.hookSpecificOutput.permissionDecisionReason, /the lane cannot be checked .*checkout -- \.delivery\/team\/team\.json/);
  assert.equal(JSON.parse(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Write', tool_input: { file_path: path.join(broken.roleDir, 'x') } }, env('chief-of-staff'))).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHook('role-lane.js', { cwd: broken.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: `git -C ${broken.projectRoot} checkout -- .delivery/team/team.json` } }, env('chief-of-staff')), '');
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
  assert.match(b.hookSpecificOutput.permissionDecisionReason, /buildbox is headless/);
  assert.match(b.hookSpecificOutput.permissionDecisionReason, /a session on pc/);
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
  // neighbours stay as they were: builder's product lane, and tmp
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(roleDir, 'product', 'a.js') }).allow, true);
  assert.equal(deny(BUILDER, 'Write', { file_path: path.join(projectRoot, '.delivery', 'operator-notes.md') }).allow, true);
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
  assert.equal(run(BUILDER, 'echo x > /tmp/other.txt').allow, true);
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
  assert.match(sub.reason, /put it in single quotes/);
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
