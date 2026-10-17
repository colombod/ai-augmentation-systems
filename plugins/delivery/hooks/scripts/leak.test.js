// hooks/scripts/leak.test.js — run with: node --test hooks/scripts/leak.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak } = require('./leak.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
const product = path.join(roleDir, 'product');
fs.mkdirSync(product, { recursive: true });
const denylist = ['Sell duplicates faster', 'Casual Carl', 'Phase 2: Beads over Dolt'];

test('loadDenylist reads lines and tolerates a missing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  assert.deepEqual(loadDenylist(root), []);
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'denylist.txt'), 'A b c\n\n D e f \n');
  assert.deepEqual(loadDenylist(root), ['A b c', 'D e f']);
});

test('extractMessages pulls commit and PR text', () => {
  assert.deepEqual(extractMessages('git commit -m "fix login" -m "Refs ex-1"'), ['fix login', 'Refs ex-1']);
  assert.deepEqual(extractMessages('gh pr create --title "Login fix" --body "Refs ex-1"'), ['Login fix', 'Refs ex-1']);
  assert.deepEqual(extractMessages('git commit -F msg.txt'), ['<file: msg.txt>']);
  assert.deepEqual(extractMessages('git status'), []);
  assert.deepEqual(extractMessages('gh pr create --title="x y" --body-file b.md'), ['x y', '<file: b.md>']);
});

test('scanText is a case-insensitive literal match and catches .delivery paths', () => {
  assert.deepEqual(scanText('we sell DUPLICATES faster now', denylist), { phrase: 'Sell duplicates faster' });
  assert.equal(scanText('fix login (Refs ex-1)', denylist), null);
  assert.deepEqual(scanText('see .delivery/stories/x.md', denylist), { phrase: '.delivery/' });
  assert.deepEqual(scanText('from .git/delivery-operator/operator/records/pm.ndjson', denylist), { phrase: 'delivery-operator/' });
  assert.equal(scanText('phase 2: beads over dolt', ['Phase 2: Beads over Dolt']).phrase, 'Phase 2: Beads over Dolt');
  assert.equal(scanText('anything', ['.*']), null);
});

test('decideLeak acts only in the product worktree', () => {
  const bad = { toolName: 'Bash', toolInput: { command: 'git commit -m "Sell duplicates faster"' }, roleDir, denylist };
  assert.equal(decideLeak({ ...bad, cwd: path.join(roleDir, 'project') }), null);
  const d = decideLeak({ ...bad, cwd: product });
  assert.match(d.reason, /Sell duplicates faster/);
  assert.match(d.reason, /Refs <bead id>/);
  assert.equal(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -m "fix login" -m "Refs ex-1"' }, cwd: product, roleDir, denylist }), null);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'gh issue create --title x' }, cwd: product, roleDir, denylist }).reason, /for users/);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -F m.txt' }, cwd: product, roleDir, denylist }).reason, /inline/);
  assert.match(decideLeak({ toolName: 'Write', toolInput: { file_path: '.delivery/team/team.json' }, cwd: product, roleDir, denylist }).reason, /\.delivery/);
  assert.equal(decideLeak({ toolName: 'Write', toolInput: { file_path: 'src/a.js' }, cwd: product, roleDir, denylist }), null);
});

// ---- subprocess test ----
const PLUGIN_ROOT = path.join(__dirname, '..', '..');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  fs.writeFileSync(path.join(projectRoot, '.delivery', 'team', 'denylist.txt'), 'Casual Carl\n');
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-team-'));
  const { roleDir: rd } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir: rd };
}

function runHook(script, input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('leak-guard hook denies a leaking commit from product and is silent from project', () => {
  const b = preparedRole('builder-1');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const input = (cwd) => ({ cwd, session_id: 's', tool_name: 'Bash', tool_input: { command: 'git commit -m "for Casual Carl"' } });
  const json = JSON.parse(runHook('leak-guard.js', input(path.join(b.roleDir, 'product')), env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /Casual Carl/);
  assert.equal(runHook('leak-guard.js', input(path.join(b.roleDir, 'project')), env), '');
});

// ---- probe table: [command | tool descriptor, cwd (relative to roleDir), expectDenied] ----
const P = 'Sell duplicates faster';
const PU = String.fromCharCode(0xE010);
const PU2 = String.fromCharCode(0xE011);
const CTRL = String.fromCharCode(1);
const ZW = String.fromCharCode(0x200B);
const RLO = String.fromCharCode(0x202E);
const probes = [
  [`cd product && git commit -m "${P}"`, '.', true],
  [`git -C product commit -m "${P}"`, '.', true],
  [`git -C ../product commit -m "${P}"`, 'project', true],
  [`git -C ../project commit -m "${P}"`, 'product', false],
  [`cd ../product; git commit -m "${P}"`, 'project', true],
  [`git commit -m "${P}"`, 'project', false],
  [`cd ../project && git commit -m "${P}"`, 'product', false],
  [`git commit -am "${P}"`, 'product', true],
  [`git commit -qm "${P}"`, 'product', true],
  [`git commit -m"${P}"`, 'product', true],
  [`git commit -m${P.replace(/ /g, '')}`, 'product', false],
  [`git commit -mCasualCarl`, 'product', false],
  [`git commit -m "ok" -m "casual   carl"`, 'product', true],
  [`git commit -m "Sell\nduplicates  faster"`, 'product', true],
  [`git commit -m "Sell\u00a0duplicates faster"`, 'product', true],
  [`git commit -m "see .Delivery/x"`, 'product', true],
  [`git commit -F m.txt`, 'product', true],
  [`git commit -qF m.txt`, 'product', true],
  [`git commit -t tpl.txt`, 'product', true],
  [`git commit --template=tpl.txt`, 'product', true],
  [`git commit --mess "${P}"`, 'product', true],
  [`git commit --message="${P}"`, 'product', true],
  [`git --no-pager -c user.name=x commit -m "${P}"`, 'product', true],
  [`git --git-dir=.git commit -m "${P}"`, 'product', true],
  [`/usr/bin/git commit -m "${P}"`, 'product', true],
  [`env GIT_AUTHOR_NAME=x git commit -m "${P}"`, 'product', true],
  [`FOO=1 command git commit -m "${P}"`, 'product', true],
  [`bash -c 'git commit -m x'`, 'product', true],
  [`sh -c "gh pr create --title x"`, 'product', true],
  [`bash -c 'ls'`, 'product', false],
  [`git merge feature -m "${P}"`, 'product', true],
  [`git merge feature -F m.txt`, 'product', true],
  [`git tag -a v1 -m "${P}"`, 'product', true],
  [`git notes add -m "${P}"`, 'product', true],
  [`gh pr create --title="${P}" --body ok`, 'product', true],
  [`gh -R org/repo pr create --body "${P}"`, 'product', true],
  [`gh --repo=org/repo pr comment 3 -b "${P}"`, 'product', true],
  [`gh pr merge 3 --subject "${P}"`, 'product', true],
  [`gh pr merge 3 -t "${P}"`, 'product', true],
  [`gh pr review 3 --body "${P}"`, 'product', true],
  [`gh pr close 3 -c "${P}"`, 'product', true],
  [`gh issue close 3 --comment "${P}"`, 'product', true],
  [`gh issue edit 3 -b "${P}"`, 'product', true],
  [`gh issue comment 3 --body-file b.md`, 'product', true],
  [`gh release create v1 --notes "${P}"`, 'product', true],
  [`gh release create v1 -n "${P}"`, 'product', true],
  [`gh release edit v1 --notes-file n.md`, 'product', true],
  [`gh pr create -t "fine" -b "Refs ex-1"`, 'product', false],
  [`gh api repos/o/r/issues/3/comments`, 'product', true],
  [`gh api -X POST repos/o/r/x`, 'product', true],
  [`gh api --method PATCH repos/o/r/x`, 'product', true],
  [`gh api -f body=x repos/o/r/x`, 'product', true],
  [`gh api --input b.json repos/o/r/x`, 'product', true],
  [`gh api repos/o/r/pulls`, 'product', false],
  [`gh issue create --title x`, 'product', true],
  [`git status && git log`, 'product', false],
  [`if true; then git commit -m "${P}"; fi`, 'product', true],
  [`for x in y; do git commit -m "${P}"; done`, 'product', true],
  [`while true; do git commit -m "${P}"; done`, 'product', true],
  [`! git commit -m "${P}"`, 'product', true],
  [`case $x in a) git commit -m "${P}";; b) true;; esac`, 'product', true],
  [`{ git commit -m "${P}"; }`, 'product', true],
  [`(git commit -m "${P}")`, 'product', true],
  [`if true; then git commit -m "fine Refs ex-1"; fi`, 'product', false],
  [`echo $(git commit -m x)`, 'product', true],
  [`echo \`git log\``, 'product', false],
  [`echo \`git commit -m x\``, 'product', true],
  [`x=$(cd product && git commit -m "${P}")`, '.', true],
  [`echo "$(cd ../product; git commit -m '${P}')"`, 'project', true],
  [`echo $(echo $(cd ../product; git commit -m "${P}"))`, 'project', true],
  [`x=$(cd ../product; git log)`, 'project', false],
  [`x=$(git rev-parse HEAD)`, 'product', false],
  [`echo "$(git status --short)"`, 'product', false],
  [`git log --format="%H"`, 'product', false],
  [`git $(echo commit) -m P`, 'product', true],
  [`x=$(git commit -m P)`, 'product', true],
  [`gh $(echo pr) create --title x`, 'product', true],
  [`f() { git commit -m "${P}"; }; f`, 'product', true],
  [`function f { git commit -m "${P}"; }; f`, 'product', true],
  [`function f() { git commit -m "${P}"; }`, 'product', true],
  [`f () { git commit -m "${P}"; }`, 'product', true],
  [`git commit -m 'handle $HOME'`, 'product', false],
  [`git commit -m "fix $5"`, 'product', true],
  [`git commit -m '${P} $x'`, 'product', true],
  [`timeout 5 git commit -m "${P}"`, 'product', true],
  [`timeout -s KILL 5 git commit -m "${P}"`, 'product', true],
  [`nice -n 5 git commit -m "${P}"`, 'product', true],
  [`xargs -n 1 git commit -m "${P}"`, 'product', true],
  [`stdbuf -oL git commit -m "${P}"`, 'product', true],
  [`echo $(date)`, 'product', false],
  [`git commit -m "$(cat msg)"`, 'product', true],
  [`git commit -m "fix \`id\`"`, 'product', true],
  [`git commit -m "line\\tbreak"`, 'product', true],
  [`gh pr create --body "$BODY"`, 'product', true],
  [`gh pr comment 3 -b "$(cat b)"`, 'product', true],
  [`git commit --trailer "Note: ${P}"`, 'product', true],
  [`git commit -m ok --trailer "Refs: ex-1"`, 'product', false],
  [`git --git-dir ../product/.git commit -m "${P}"`, 'project', true],
  [`git --git-dir=../product/.git commit -m "${P}"`, 'project', true],
  [`GIT_DIR=../product/.git git commit -m "${P}"`, 'project', true],
  [`GIT_WORK_TREE=../product git commit -m "${P}"`, 'project', true],
  [`export GIT_DIR=../product/.git; git commit -m "${P}"`, 'project', true],
  [`env GIT_WORK_TREE=../product git commit -m "${P}"`, 'project', true],
  [`pushd ../product; git commit -m "${P}"`, 'project', true],
  [`pushd ../product && popd && git commit -m "${P}"`, 'project', false],
  [`cd "$HOME/proj" && git commit -m "add .delivery/stories/x.md"`, 'project', false],
  [`cd $D && git commit -m "${P}"`, 'product', true],
  [`cd product && git log; cd ..; git commit -m "update .delivery/x"`, '.', true],
  // round 4: quote-aware substitution scan and fail-closed parsing
  [`x=$(echo ')'; git commit -m "${P}")`, 'product', true],
  [`x=$(echo ")"; git commit -m "${P}")`, 'product', true],
  [`x=$(echo \`echo ')'\`; git commit -m "${P}")`, 'product', true],
  [`x=$(case a in a) git commit -m "${P}";; esac)`, 'product', true],
  [`x=$(case a in a) echo hi;; esac)`, 'product', false],
  [`echo ')'`, 'product', false],
  [`echo $((1 + 2))`, 'product', false],
  [`git commit -m "ok`, 'product', true],
  [`git commit -m 'ok`, 'product', true],
  [`echo $(echo ')'`, 'product', true],
  [`(git status`, 'product', true],
  [`git status)`, 'product', true],
  [`git commit -m "ok`, 'project', false],
  [`git commit -m "x${PU}0${PU2}"`, 'product', true],
  [`echo ${PU}`, 'product', true],
  [`echo ${PU}`, 'project', false],
  [`git commit -m "a${CTRL}S0${CTRL}"`, 'product', true],
  [`git commit -m $'Sell\\x20duplicates faster'`, 'product', true],
  [`echo $"hello"`, 'product', true],
  [`echo $'x'`, 'project', false],
  [`echo $'it\\'s' ; git commit -m "${P}" #'`, 'product', true],
  [`echo $'it\\'s' ; cd ../product && git commit -m "${P}" #'`, 'project', true],
  [`echo "\${x:-'a'}"`, 'product', true],
  [`echo "\${HOME}/x"`, 'product', false],
  [`echo \${x:-'a'}; cd ../product && git commit -m "${P}"`, 'project', true],
  [`f(){ git commit -m "${P}";}; f`, 'product', true],
  [`f() (git commit -m "${P}")`, 'product', true],
  [`f()(git commit -m "${P}")`, 'product', true],
  [`function f() (git commit -m "${P}")`, 'product', true],
  [`function f()(git commit -m "${P}")`, 'product', true],
  [`function f () { git commit -m "${P}"; }`, 'product', true],
  [`if (git commit -m "${P}"); then true; fi`, 'product', true],
  [`coproc { git commit -m "${P}"; }`, 'product', true],
  [`coproc NAME { git commit -m "${P}"; }`, 'product', true],
  [`coproc NAME (git commit -m "${P}")`, 'product', true],
  [`xargs --max-args 1 git commit -m "${P}"`, 'product', true],
  [`xargs -I {} git commit -m "${P}"`, 'product', true],
  [`nice --adjustment 5 git commit -m "${P}"`, 'product', true],
  [`stdbuf --output L git commit -m "${P}"`, 'product', true],
  [`timeout --signal KILL 5 git commit -m "${P}"`, 'product', true],
  [`eval "git commit -m x"`, 'product', true],
  [`eval "$cmd"`, 'product', true],
  [`exec git commit -m "${P}"`, 'product', true],
  [`sudo git commit -m "${P}"`, 'product', true],
  [`sudo -u bob git commit -m "${P}"`, 'product', true],
  [`time -p git commit -m "${P}"`, 'product', true],
  [`env -C ../product git commit -m "${P}"`, 'project', true],
  [`env -S 'git commit -m x'`, 'product', true],
  [`git commit -m ok # it's\ngit commit -m "${P}"`, 'product', true],
  [`git status # it's fine`, 'product', false],
  [`git log --format="%H" # comment`, 'product', false],
  [`git -c alias.x='commit -m P' x`, 'product', true],
  [`git -c user.name=x status`, 'product', false],
  [`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0=commit git x -m P`, 'product', true],
  [`$g commit -m x`, 'product', true],
  [`\`echo git\` commit -m x`, 'product', true],
  [`git \\\ncommit -m "${P}"`, 'product', true],
  [`cat <<EOF\nit's\nEOF\ngit commit -m "${P}"`, 'product', true],
  [`cd ../product && cat <<EOF\nit's\nEOF\ngit commit -m "${P}"`, 'project', true],
  [`cat > notes.txt <<'EOF'\nit's here; (really\nEOF`, 'product', false],
  [`cat <<EOF\n$(git commit -m x)\nEOF`, 'product', true],
  [`cat <<-EOF\n\thello $(date)\n\tEOF\ngit status`, 'product', false],
  [`diff <(git commit -m x) y`, 'product', true],
  [`cat <(git log)`, 'product', false],
  [`git log --grep commit`, 'product', false],
  [`echo '$(git commit -m P)'`, 'product', false],
  // round 5: redirections, argument injection, xargs/parallel, config aliases, format characters
  [`>/dev/null git commit -m "${P}"`, 'product', true],
  [`2>/dev/null git commit -m "${P}"`, 'product', true],
  [`<<<x git commit -m "${P}"`, 'product', true],
  [`FOO=1 >x git commit -m "${P}"`, 'product', true],
  [`git >/dev/null commit -m "${P}"`, 'product', true],
  [`git 2>&1 commit -m "${P}"`, 'product', true],
  [`git commit -m >x '${P}'`, 'product', true],
  [`> /dev/null git commit -m "${P}"`, 'product', true],
  [`cd ../product && >/dev/null git commit -m "${P}"`, 'project', true],
  [`git commit -m "fine" >/dev/null 2>&1`, 'product', false],
  [`git commit -m '>x'`, 'product', false],
  [`cat <<EOF > notes.txt\nhello\nEOF\ngit status`, 'product', false],
  [`set -- -m "${P}"; git commit "$@"`, 'product', true],
  [`A='-mP'; git commit "$A"`, 'product', true],
  [`f(){ git commit "$@"; }; f -m P`, 'product', true],
  [`echo "-m 'P'" | xargs git commit`, 'product', true],
  [`echo x | parallel gh pr comment 3 -b {}`, 'product', true],
  [`git push origin "$BRANCH"`, 'product', false], // refspec words are exempt (final patch, ruling 7)
  [`git -c "$A" x`, 'product', true],
  [`echo a b | xargs rm`, 'product', false],
  [`git log "$REV"`, 'product', false],
  [`git commit -m "Se${ZW}ll duplicates faster"`, 'product', true],
  [`git commit -m "Sell duplicates fas${ZW}ter"`, 'product', true],
  [`git commit -m "fix ${RLO}login"`, 'product', true],
  [`export GIT_CONFIG_COUNT=1`, 'product', true],
  [`export GIT_CONFIG_PARAMETERS="'alias.x=commit'"; git x`, 'product', true],
  [`git config alias.x 'commit -m P'`, 'product', true],
  [`git config --global alias.x status`, 'product', true],
  [`git config user.name x`, 'product', false],
  // final patch
  [`git commit -F <(echo 'Casual Carl')`, 'product', true],
  [`git commit --file <(echo 'Casual Carl')`, 'product', true],
  [`git tag -a v1 -F <(echo 'Casual Carl')`, 'product', true],
  [`gh pr create --body-file <(echo 'Casual Carl')`, 'product', true],
  [`gh issue comment 1 -F <(echo 'Casual Carl')`, 'product', true],
  [`git commit >| x -m 'Casual Carl'`, 'product', true],
  [`git commit >|/dev/null -m 'Casual Carl'`, 'product', true],
  [`git commit <&0 -m 'Casual Carl'`, 'product', true],
  [`git commit 0<&- -m 'Casual Carl'`, 'product', true],
  [`gh pr create >|x --title 'Casual Carl'`, 'product', true],
  [`git commit -m fix >|log`, 'product', false],
  [`ls | wc`, 'product', false],
  [`gh issue reopen 1 -c 'Casual Carl'`, 'product', true],
  [`gh pr reopen 1 --comment 'Casual Carl'`, 'product', true],
  ['time ! '.repeat(101) + "git commit -m 'Casual Carl'", 'product', true],
  [`env --chdir=../product git commit -m 'Casual Carl'`, 'project', true],
  [`git commit -m 'Cas${ZW}ual Carl'`, 'product', true],
  [`git commit -m 'Casual${ZW}Carl'`, 'product', true],
  [`git push -u origin "$(git branch --show-current)"`, 'product', false],
  [`git push -o "$X" origin main`, 'product', true],
  [`git push --push-option="$X" origin main`, 'product', true],
  [{ tool: 'Write', path: 'product/.delivery/x.md' }, '.', true],
  [{ tool: 'Write', path: 'product/.Delivery/x.md' }, 'project', true],
  [{ tool: 'Edit', path: '../product/.beads/a' }, 'project', true],
  [{ tool: 'Write', path: 'product/config/team.json' }, '.', true],
  [{ tool: 'Write', path: 'product/config/steam.json' }, '.', false],
  [{ tool: 'Write', path: 'product/src/a.js' }, '.', false],
  [{ tool: 'Write', path: 'project/.delivery/x.md' }, '.', false],
  [{ tool: 'MultiEdit', path: 'product/src/a.js', edits: [{ file_path: 'product/.beads/z' }] }, '.', true],
  [{ tool: 'NotebookEdit', path: 'product/.delivery/n.ipynb' }, '.', true],
];

test('probe table: commands and tools are gated by effective directory and resolved path', () => {
  fs.mkdirSync(path.join(roleDir, 'project'), { recursive: true });
  const list = [...denylist];
  for (const [probe, where, expectDenied] of probes) {
    const cwd = path.join(roleDir, where);
    const call = typeof probe === 'string'
      ? { toolName: 'Bash', toolInput: { command: probe.replace(/\\n/g, '\n').replace(/\\u00a0/g, '\u00a0') } }
      : { toolName: probe.tool, toolInput: { file_path: path.join(roleDir, probe.path.replace(/^\.\.\//, '')), edits: probe.edits && probe.edits.map((e) => ({ file_path: path.join(roleDir, e.file_path) })) } };
    if (typeof probe !== 'string' && probe.path.startsWith('..')) call.toolInput.file_path = path.relative(cwd, path.join(roleDir, probe.path.replace(/^\.\.\//, '')));
    const d = decideLeak({ ...call, cwd, roleDir, denylist: list });
    assert.equal(!!d, expectDenied, `${JSON.stringify(probe)} from ${where}: ${d ? d.reason : 'allowed'}`);
  }
});

test('leak-guard fails closed in product when the guard itself errors, and stays inert elsewhere', () => {
  const b = preparedRole('builder-1');
  // A denylist path that is a directory makes the guard throw (EISDIR) while loading it.
  const dl = path.join(b.projectRoot, '.delivery', 'team', 'denylist.txt');
  fs.rmSync(dl);
  fs.mkdirSync(dl);
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const input = (cwd) => ({ cwd, session_id: 's', tool_name: 'Bash', tool_input: { command: 'git status' } });
  const json = JSON.parse(runHook('leak-guard.js', input(path.join(b.roleDir, 'product')), env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(json.hookSpecificOutput.permissionDecisionReason, 'leak guard could not analyse this command; run git and gh as plain commands with inline text');
  assert.equal(runHook('leak-guard.js', input(path.join(b.roleDir, 'project')), env), '');
});

test('unparseable commands in product name the reason', () => {
  const d = decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -m "ok' }, cwd: product, roleDir, denylist });
  assert.match(d.reason, /^leak guard could not analyse this command; run git and gh as plain commands with inline text \(unbalanced double quote\)\.$/);
});

test('bounded analysis: oversized or deeply nested commands are refused quickly and fail closed', () => {
  fs.mkdirSync(path.join(roleDir, 'project'), { recursive: true });
  const nested = (n) => `${'$('.repeat(n)}x${')'.repeat(n)}`;
  const run = (command, where) => decideLeak({ toolName: 'Bash', toolInput: { command }, cwd: path.join(roleDir, where), roleDir, denylist });
  // A 60 KB payload (20,000 deep) after a leaking commit into product: denied from project and from roleDir.
  const big = `cd ../product && git commit -m '${P}'; echo ${nested(20000)}`;
  assert.ok(big.length > 60000);
  assert.ok(run(big, 'project'));
  assert.ok(run(big.replace('../product', 'product'), '.'));
  // Under the size bound but deeper than 32: refused in product.
  assert.match(run(`echo ${nested(33)}`, 'product').reason, /nesting deeper than 32/);
  assert.equal(run(`echo ${'$(echo '.repeat(30)}x${')'.repeat(30)}`, 'product'), null);
  assert.ok(run(`echo ${'$(echo '.repeat(33)}x${')'.repeat(33)}`, 'product'));
  for (const payload of [nested(16500), 'case '.repeat(50000), `${'( '.repeat(5000)}`, `${'{ '.repeat(8000)}`, 'case x in '.repeat(1600)]) {
    const t0 = process.hrtime.bigint();
    run(payload, 'product');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `${payload.slice(0, 12)}... (${payload.length} chars) took ${ms} ms`);
  }
  assert.ok(run(nested(16500), 'product'));
  assert.ok(run('case '.repeat(50000), 'product'));
});

test('leak-guard entry fails closed from the role directory and for git with a directory change', () => {
  const b = preparedRole('builder-1');
  const dl = path.join(b.projectRoot, '.delivery', 'team', 'denylist.txt');
  fs.rmSync(dl);
  fs.mkdirSync(dl);
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const input = (cwd, command) => ({ cwd, session_id: 's', tool_name: 'Bash', tool_input: { command } });
  const denied = (out) => JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny';
  assert.ok(denied(runHook('leak-guard.js', input(b.roleDir, 'ls'), env)));
  fs.mkdirSync(path.join(b.roleDir, 'project'), { recursive: true });
  assert.ok(denied(runHook('leak-guard.js', input(path.join(b.roleDir, 'project'), 'cd ../product && git commit -m x'), env)));
  assert.equal(runHook('leak-guard.js', input(path.join(b.roleDir, 'project'), 'ls'), env), '');
});

test('the shared matcher ignores format characters', () => {
  assert.deepEqual(scanText(`we sell dupli${ZW}cates faster`, denylist), { phrase: 'Sell duplicates faster' });
  assert.deepEqual(scanText(`for Casual${ZW} Carl`, denylist), { phrase: 'Casual Carl' });
});

// Final wave A: Monitor (and PowerShell, best effort) carry a shell command like Bash.
test('A: a Monitor or PowerShell commit with a plan phrase is refused in product', () => {
  const bad = { toolInput: { command: 'git commit -m "Sell duplicates faster"' }, cwd: product, roleDir, denylist };
  assert.match(decideLeak({ ...bad, toolName: 'Monitor' }).reason, /Sell duplicates faster/);
  assert.match(decideLeak({ ...bad, toolName: 'PowerShell' }).reason, /Sell duplicates faster/);
  assert.equal(decideLeak({ ...bad, toolName: 'Monitor', cwd: path.join(roleDir, 'project') }), null);
  assert.equal(decideLeak({ toolName: 'Monitor', toolInput: { command: 'git commit -m "fix login"' }, cwd: product, roleDir, denylist }), null);
  const b = preparedRole('builder-1');
  fs.mkdirSync(path.join(b.roleDir, 'product'), { recursive: true });
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const json = JSON.parse(runHook('leak-guard.js', { cwd: path.join(b.roleDir, 'product'), session_id: 's', tool_name: 'Monitor', tool_input: { command: 'git commit -m "for Casual Carl"' } }, env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /Casual Carl/);
});

// Final wave E: GitHub-style MCP tools are scanned like gh for roles that touch product.
test('E: MCP GitHub-style tool inputs are scanned for plan phrases; issue creation is refused', () => {
  const run = (toolName, toolInput, over = {}) => decideLeak({ toolName, toolInput, cwd: path.join(roleDir, 'project'), roleDir, denylist, ...over });
  const d = run('mcp__github__create_pull_request', { owner: 'o', repo: 'r', title: 'Login fix', body: 'Refs ex-1. Sell duplicates faster' });
  assert.match(d.reason, /Sell duplicates faster/);
  assert.equal(run('mcp__github__create_pull_request', { owner: 'o', repo: 'r', title: 'Login fix', body: 'Refs ex-1' }), null);
  assert.match(run('mcp__gitlab__update_merge_request', { a: { b: { c: ['see .delivery/stories/x.md'] } } }).reason, /\.delivery\//);
  assert.match(run('mcp__github__push_files', { files: [{ path: 'a', content: 'for Casual Carl' }], message: 'x' }).reason, /Casual Carl/);
  assert.match(run('mcp__github__create_issue', { title: 'clean' }).reason, /GitHub issues in the product repo are for users/);
  assert.match(run('mcp__x__add_issue', { title: 'clean' }).reason, /for users/);
  // issue_write creates only with method create; an update, and a comment, are scanned like gh instead.
  assert.match(run('mcp__github__issue_write', { method: 'create', title: 'clean' }).reason, /for users/);
  assert.equal(run('mcp__github__issue_write', { method: 'update', issue_number: 3, title: 'clean' }), null);
  assert.match(run('mcp__github__issue_write', { method: 'update', issue_number: 3, body: 'Sell duplicates faster' }).reason, /Sell duplicates faster/);
  assert.equal(run('mcp__github__add_issue_comment', { body: 'Refs ex-1' }), null);
  assert.match(run('mcp__github__add_issue_comment', { body: 'Sell duplicates faster' }).reason, /Sell duplicates faster/);
  // Whole tool names only: a name that merely contains the words is not an issue creator.
  assert.equal(run('mcp__github__list_issue_types', { title: 'clean' }), null);
  assert.equal(run('mcp__x__addIssue', { title: 'clean' }), null);
  // Depth and size are bounded: a phrase deeper than four levels or past 20 KB is not reached.
  assert.equal(run('mcp__github__create_pull_request', { a: { b: { c: { d: { e: { f: 'Sell duplicates faster' } } } } } }), null);
  assert.equal(run('mcp__github__create_pull_request', { pad: 'x'.repeat(21000), body: 'Sell duplicates faster' }), null);
  // Not a public-text tool, or a role that does not touch product: nothing to check.
  assert.equal(run('mcp__files__read_file', { body: 'Sell duplicates faster' }), null);
  const thinker = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-thinker-'));
  assert.equal(run('mcp__github__create_issue', { body: 'Sell duplicates faster' }, { roleDir: thinker, roleId: 'product-manager' }), null);
  assert.match(run('mcp__github__create_pull_request', { body: 'Sell duplicates faster' }, { roleDir: thinker, roleId: 'builder' }).reason, /Sell duplicates faster/);
});

test('E: the leak-guard hook scans a GitHub MCP call for a builder', () => {
  const b = preparedRole('builder-1');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const input = (body) => ({ cwd: b.roleDir, session_id: 's', tool_name: 'mcp__github__create_pull_request', tool_input: { title: 'x', body } });
  const json = JSON.parse(runHook('leak-guard.js', input('for Casual Carl'), env));
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /Casual Carl/);
  assert.equal(runHook('leak-guard.js', input('Refs ex-1'), env), '');
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entry = hooks.PreToolUse.find((e) => e.hooks.some((h) => h.args.some((a) => a.endsWith('leak-guard.js'))));
  const re = new RegExp(`^(?:${entry.matcher})$`);
  assert.ok(re.test('mcp__github__create_pull_request'));
  assert.ok(re.test('mcp__gitlab__create_merge_request'));
  assert.ok(!re.test('mcp__files__read_file'));
});
