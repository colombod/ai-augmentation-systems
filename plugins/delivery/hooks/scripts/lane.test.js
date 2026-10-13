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
  ['git branch --list "feat*"', COS, false], // fix round 3 (R1): a glob is expansion
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
  ['cat "~/x"', COS, false],
  ['bd update x --append-notes "done? yes!"', COS, false],
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
