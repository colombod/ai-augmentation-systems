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
    [{ 'build.gradle.kts': '', gradlew: '' }, './gradlew test'],
    [{ 'build.sbt': '' }, 'sbt test'],
    [{ 'pyproject.toml': '' }, 'python -m pytest'],
    [{ 'pyproject.toml': '', 'uv.lock': '' }, 'uv run pytest'],
    [{ 'tox.ini': '' }, 'tox'],
    [{ Gemfile: '', '.rspec': '' }, 'bundle exec rspec'],
    [{ 'mix.exs': '' }, 'mix test'],
    [{ 'composer.json': '{"scripts":{"test":"phpunit"}}' }, 'composer test'],
    [{ 'Package.swift': '' }, 'swift test'],
    [{ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' }, 'flutter test'],
    [{ 'stack.yaml': '' }, 'stack test'],
    [{ 'build.zig': '' }, 'zig build test'],
    [{ 'package.json': '{"scripts":{"test":"vitest"}}', 'pnpm-lock.yaml': '' }, 'pnpm test'],
    [{ 'deno.json': '{}' }, 'deno test'],
    [{ Makefile: 'test:\n\techo ok\n' }, 'make test'],
    // one ecosystem and a Makefile: the ecosystem's own runner, which is what CI usually calls
    [{ 'Cargo.toml': '', Makefile: 'test:\n\tcargo test\n' }, 'cargo test'],
    // a polyglot repository with a make test target: the project's own entry point wins
    [{ 'go.mod': '', 'package.json': '{"scripts":{"test":"jest"}}', Makefile: 'build:\n\ttrue\ntest: build\n\tgo test ./...\n' }, 'make test'],
  ];
  for (const [files, want] of cases) assert.equal(testCommandOf(repo(files), null).command, want, JSON.stringify(files));
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

function role() {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-role-'));
  const clone = path.join(roleDir, 'review', 'pr-1');
  fs.mkdirSync(clone, { recursive: true });
  return { roleDir, clone };
}
const capture = () => { const lines = []; return { lines, out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)) }; };

test('review-run: runs the command in the clone with the role variables cleared, and returns its exit code', () => {
  const { roleDir, clone } = role();
  const c = capture();
  let seen = null;
  const spawn = (cmd, args, opts) => { seen = { cmd, args, opts }; return { status: 3 }; };
  const env = { PATH: '/bin', HOME: '/h', DELIVERY_ROLE: 'delivery-lead', DELIVERY_ROLE_DIR: roleDir, BEADS_DIR: '/b', BD_ACTOR: 'a', LANG: 'C' };
  const code = main(['review/pr-1'], { env, cwd: roleDir, roleDir, team: { test_command: 'dotnet test --no-restore' }, spawn, ...c });
  assert.equal(code, 3);
  assert.equal(seen.opts.cwd, fs.realpathSync(clone));
  assert.deepEqual(seen.opts.env, { PATH: '/bin', HOME: '/h', LANG: 'C' });
  assert.equal(seen.args[seen.args.length - 1], 'dotnet test --no-restore');
  assert.match(c.lines[0], /^review-run: dotnet test --no-restore \(team\.json test_command\) in pr-1$/);
  assert.match(c.lines[c.lines.length - 1], /^review-run: exit 3 after \d+s$/);
});

test('review-run: refuses a directory outside review/ (also through a symlink), extra arguments, and an unknown setup', () => {
  const { roleDir } = role();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-out-'));
  fs.symlinkSync(outside, path.join(roleDir, 'review', 'link'));
  const spawn = () => { throw new Error('must not run'); };
  for (const target of [outside, 'review', 'review/link', 'review/../', 'review/missing']) {
    const c = capture();
    assert.equal(main([target], { env: {}, cwd: roleDir, roleDir, team: { test_command: 'true' }, spawn, ...c }), 2, target);
    assert.match(c.lines.join('\n'), /refused/, target);
  }
  for (const argv of [['review/pr-1', '--', '--basetemp=/tmp'], ['review/pr-1', 'x'], ['--help'], []]) {
    assert.equal(main(argv, { env: {}, cwd: roleDir, roleDir, team: { test_command: 'true' }, spawn, ...capture() }), 2, argv.join(' '));
  }
  const c = capture();
  assert.equal(main(['review/pr-1'], { env: {}, cwd: roleDir, roleDir, team: {}, spawn, ...c }), 2);
  assert.match(c.lines.join('\n'), /no test setup found[\s\S]*"test_command" in \.delivery\/team\/team\.json/);
});

test('review-run: a real run, with a test setup detected from the clone', () => {
  const { roleDir, clone } = role();
  fs.writeFileSync(path.join(clone, 'Makefile'), 'test:\n\t@echo "role=$${DELIVERY_ROLE:-unset}" > result.txt\n');
  const c = capture();
  const code = main(['review/pr-1'], { env: { ...process.env, DELIVERY_ROLE: 'delivery-lead' }, cwd: roleDir, roleDir, team: {}, ...c });
  assert.equal(code, 0, c.lines.join('\n'));
  assert.equal(fs.readFileSync(path.join(clone, 'result.txt'), 'utf8').trim(), 'role=unset');
});
