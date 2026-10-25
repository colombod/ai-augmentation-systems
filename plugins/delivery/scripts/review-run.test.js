// scripts/review-run.test.js — the reviewer's one runner: the product's own test command, in any
// language, only inside review/, with the role's variables cleared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('./review-run.js');
const { testCommandOf } = require('./lib/test-command.js');

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  return d;
}

test('test command: one per ecosystem, from the repository\'s own build files', () => {
  const cases = [
    [{ 'App.sln': '' }, 'dotnet test'],
    [{ 'src/x.csproj': '', 'Api.csproj': '' }, 'dotnet test'],
    [{ 'Cargo.toml': '' }, 'cargo test'],
    [{ 'go.mod': '' }, 'go test ./...'],
    [{ 'pom.xml': '' }, 'mvn test'],
    [{ 'pom.xml': '', mvnw: '' }, './mvnw test'],
    [{ Gemfile: '' }, 'bundle install && bundle exec rake test'],
    [{ 'package.json': '{"scripts":{"test":"jest"}}', 'package-lock.json': '{}' }, 'npm ci && npm test'],
    [{ 'package.json': '{"scripts":{"test":"vitest"}}', 'bun.lock': '' }, 'bun install --frozen-lockfile && bun run test'],
    [{ 'CMakeLists.txt': '' }, 'cmake -S . -B build && cmake --build build && ctest --test-dir build --no-tests=error'],
    [{ 'build.gradle.kts': '', gradlew: '' }, './gradlew test'],
    [{ 'build.sbt': '' }, 'sbt test'],
    [{ 'pyproject.toml': '' }, 'python -m pip install -e . && python -m pytest'],
    [{ 'pyproject.toml': '', 'poetry.lock': '' }, 'poetry install && poetry run pytest'],
    [{ 'setup.cfg': '', 'requirements.txt': '' }, 'python -m pip install -r requirements.txt && python -m pytest'],
    [{ 'pyproject.toml': '', 'uv.lock': '' }, 'uv run pytest'],
    [{ 'tox.ini': '' }, 'tox'],
    [{ Gemfile: '', '.rspec': '' }, 'bundle install && bundle exec rspec'],
    [{ 'mix.exs': '' }, 'mix deps.get && mix test'],
    [{ 'composer.json': '{"scripts":{"test":"phpunit"}}' }, 'composer install && composer test'],
    [{ 'Package.swift': '' }, 'swift test'],
    [{ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' }, 'flutter pub get && flutter test'],
    [{ 'stack.yaml': '' }, 'stack test'],
    [{ 'build.zig': '' }, 'zig build test'],
    [{ 'package.json': '{"scripts":{"test":"vitest"}}', 'pnpm-lock.yaml': '' }, 'pnpm install --frozen-lockfile && pnpm test'],
    [{ 'deno.json': '{}' }, 'deno test'],
    [{ Makefile: 'test:\n\techo ok\n' }, 'make test'],
    // a Makefile test target is the project's own entry point (build tags, integration setup): it wins
    [{ 'go.mod': '', Makefile: 'test:\n\tgo test -tags integration ./...\n' }, 'make test'],
    // a polyglot repository with a make test target: the project's own entry point wins
    [{ 'go.mod': '', 'package.json': '{"scripts":{"test":"jest"}}', Makefile: 'build:\n\ttrue\ntest: build\n\tgo test ./...\n' }, 'make test'],
  ];
  for (const [files, want] of cases) assert.equal(testCommandOf(repo(files), null, { platform: 'linux' }).command, want, JSON.stringify(files));
  // Windows runs the wrappers' .cmd and .bat
  assert.equal(testCommandOf(repo({ 'pom.xml': '', mvnw: '' }), null, { platform: 'win32' }).command, 'mvnw.cmd test');
  assert.equal(testCommandOf(repo({ 'build.gradle': '', gradlew: '' }), null, { platform: 'win32' }).command, 'gradlew.bat test');
});

test('test command: the owner\'s test_command wins; several setups without one is refused, never guessed', () => {
  const d = repo({ 'go.mod': '', 'Cargo.toml': '' });
  const t = testCommandOf(d, null);
  assert.match(t.problem, /several test setups found \(Rust: cargo test; Go: go test \.\/\.\.\.\)/);
  assert.equal(testCommandOf(d, { test_command: 'make ci' }).command, 'make ci');
  assert.equal(testCommandOf(d, { test_command: 'make ci' }).source, 'team.json test_command');
  assert.match(testCommandOf(repo({ 'README.md': '' }), null).problem, /no test setup found/);
  // a package.json with no test script is not a test setup
  assert.match(testCommandOf(repo({ 'package.json': '{"name":"x"}' }), null).problem, /no test setup/);
});

const G = (cwd, ...a) => require('child_process').execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

// a product repository with two commits, and a role directory whose team names it
function setup(makefile = 'test:\n\t@echo "role=$${DELIVERY_ROLE:-unset}" > result.txt\n') {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-src-'));
  G(src, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(src, 'Makefile'), makefile);
  fs.writeFileSync(path.join(src, 'a.txt'), 'one\n');
  G(src, 'add', '-A'); G(src, 'commit', '-q', '-m', 'one');
  const first = G(src, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(src, 'a.txt'), 'two\n');
  G(src, 'commit', '-qam', 'two');
  const second = G(src, 'rev-parse', 'HEAD');
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-role-'));
  return { src, first, second, roleDir, team: { product_url: src } };
}
const capture = () => { const lines = []; return { lines, out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)) }; };

test('review-run checkout: clones the product into review/pr-<n> at exactly the head, and a second checkout undoes local edits', () => {
  const { roleDir, team, first, second } = setup();
  const c = capture();
  assert.equal(main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, ...c }), 0, c.lines.join('\n'));
  const clone = path.join(roleDir, 'review', 'pr-7');
  assert.equal(G(clone, 'rev-parse', 'HEAD'), first);
  assert.equal(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'one\n');
  assert.match(c.lines.join('\n'), new RegExp(`review/pr-7 at ${first} .*clean`));
  // a mutation and a stray file, undone by checking out again (the second head)
  fs.writeFileSync(path.join(clone, 'a.txt'), 'mutated\n');
  fs.writeFileSync(path.join(clone, 'stray.txt'), 'x');
  assert.equal(main(['checkout', '7', second], { env: process.env, cwd: roleDir, roleDir, team, ...capture() }), 0);
  assert.equal(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8'), 'two\n');
  assert.ok(!fs.existsSync(path.join(clone, 'stray.txt')));
});

test('review-run test: runs the project command in the clone with the role variables cleared, and returns its exit code', () => {
  const { roleDir, team, first } = setup();
  main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, ...capture() });
  const c = capture();
  const code = main(['test', '7'], { env: { ...process.env, DELIVERY_ROLE: 'delivery-lead', GIT_DIR: '/elsewhere' }, cwd: roleDir, roleDir, team, ...c });
  assert.equal(code, 0, c.lines.join('\n'));
  assert.equal(fs.readFileSync(path.join(roleDir, 'review', 'pr-7', 'result.txt'), 'utf8').trim(), 'role=unset');
  assert.match(c.lines[0], /^review-run: make test \(detected: Makefile test target\) in review\/pr-7$/);
  assert.match(c.lines[c.lines.length - 1], /^review-run: exit 0 after \d+s$/);
  // git variables that would point a test's git at another repository are cleared too
  assert.equal(main(['test', '7'], { env: { ...process.env, GIT_DIR: '/elsewhere', GIT_WORK_TREE: '/elsewhere' }, cwd: roleDir, roleDir, team: { ...team, test_command: 'test -z "$GIT_DIR$GIT_WORK_TREE"' }, ...capture() }), 0);
  const failing = capture();
  assert.equal(main(['test', '7'], { env: process.env, cwd: roleDir, roleDir, team: { ...team, test_command: 'exit 3' }, ...failing }), 3);
  assert.match(failing.lines.join('\n'), /review-run: exit 3/);
});

// the fourth review: a tag named like an abbreviated head checked out other code under that head
test('review-run checkout: only a full head; a tag named like the head does not redirect it', () => {
  const { roleDir, team, src, first, second } = setup();
  G(src, 'tag', first.slice(0, 7), second);
  G(src, 'tag', first, second);
  const c = capture();
  assert.equal(main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, ...c }), 0, c.lines.join('\n'));
  assert.equal(G(path.join(roleDir, 'review', 'pr-7'), 'rev-parse', 'HEAD'), first);
  assert.equal(main(['checkout', '7', first.slice(0, 7)], { env: process.env, cwd: roleDir, roleDir, team, ...capture() }), 2);
  // and whatever git does, a clone that does not end at the head is refused, never reported clean
  const lying = (cmd, args, opts) => (args.includes('rev-parse') ? { status: 0, stdout: `${second}\n` } : require('child_process').spawnSync(cmd, args, opts));
  const l = capture();
  assert.equal(main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, spawn: lying, ...l }), 1);
  assert.match(l.lines.join('\n'), new RegExp(`refused: the clone is at ${second}, not ${first}`));
});

test('review-run: a fake bare repository planted in the clone cannot point its git outside review/', () => {
  const { roleDir, team, first } = setup();
  assert.equal(main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, ...capture() }), 0);
  const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-victim-'));
  fs.writeFileSync(path.join(victim, 'important.txt'), 'keep');
  // the reviewer may edit files in its clone: it plants a bare repository whose work tree is the victim
  const clone = path.join(roleDir, 'review', 'pr-7');
  fs.mkdirSync(path.join(clone, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(clone, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(clone, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(clone, 'config'), `[core]\n\tbare = false\n\tworktree = ${victim}\n`);
  assert.equal(main(['checkout', '7', first], { env: process.env, cwd: roleDir, roleDir, team, ...capture() }), 0);
  assert.equal(fs.readFileSync(path.join(victim, 'important.txt'), 'utf8'), 'keep');
  // and a clone whose .git was replaced by a file or symlink is refused, not used
  fs.rmSync(path.join(clone, '.git'), { recursive: true, force: true });
  fs.symlinkSync(victim, path.join(clone, '.git'));
  const c = capture();
  assert.equal(main(['test', '7'], { env: process.env, cwd: roleDir, roleDir, team: { ...team, test_command: 'true' }, ...c }), 2);
  assert.match(c.lines.join('\n'), /holds no clone/);
});

test('review-run: refuses anything but its two forms; a missing clone or product and an unknown setup say how to fix them', () => {
  const { roleDir, team } = setup();
  const spawn = () => { throw new Error('must not run'); };
  for (const argv of [[], ['test'], ['test', '0'], ['test', '7', 'x'], ['test', '../7'], ['checkout', '7'], ['checkout', '7', 'HEAD'], ['checkout', '7', 'abc1234', 'x'], ['checkout', '-7', 'abc1234'], ['checkout', '7', 'abc1234'], ['checkout', '7', 'a'.repeat(39)], ['install', '7'], ['--help']]) {
    assert.equal(main(argv, { env: {}, cwd: roleDir, roleDir, team, spawn, ...capture() }), 2, argv.join(' '));
  }
  const c = capture();
  assert.equal(main(['test', '7'], { env: {}, cwd: roleDir, roleDir, team, spawn, ...c }), 2);
  assert.match(c.lines.join('\n'), /no clone yet\. Run: review-run\.js checkout 7 <head sha>/);
  const u = capture();
  assert.equal(main(['checkout', '7', 'a'.repeat(40)], { env: {}, cwd: path.join(os.tmpdir()), roleDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rr-none-')), team: {}, spawn, ...u }), 2);
  assert.match(u.lines.join('\n'), /product repository is not known/);
  // a repository with no test setup, after a real checkout
  const bare = setup('');
  fs.rmSync(path.join(bare.src, 'Makefile'));
  G(bare.src, 'commit', '-qam', 'no makefile');
  main(['checkout', '8', G(bare.src, 'rev-parse', 'HEAD')], { env: process.env, cwd: bare.roleDir, roleDir: bare.roleDir, team: bare.team, ...capture() });
  const n = capture();
  assert.equal(main(['test', '8'], { env: process.env, cwd: bare.roleDir, roleDir: bare.roleDir, team: bare.team, ...n }), 2);
  assert.match(n.lines.join('\n'), /no test setup found[\s\S]*"test_command" in \.delivery\/team\/team\.json/);
});
