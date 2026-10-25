// scripts/lib/test-command.js — the command that runs a product's tests, in any language.
//
// The reviewer (and anyone checking a head) must run the product's own tests, whatever the product is
// written in. The lane cannot know every toolchain's runner, so it does not try: it lets the reviewer
// run review-run.js, which runs this command. The owner states it once in team.json as `test_command`
// (a shell command, run from the checkout's root); without it, it is read from the repository's own
// build files. Several candidates and no `make test` is refused with the candidates named, never
// guessed: running the wrong suite and reporting it green is worse than asking once.
const fs = require('fs');
const path = require('path');

const has = (dir, f) => fs.existsSync(path.join(dir, f));
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (err) { return ''; } };
const anyFile = (dir, re) => { try { return fs.readdirSync(dir).some((f) => re.test(f)); } catch (err) { return false; } };

// One entry per ecosystem: the files that mark it, and its standard test command.
const ECOSYSTEMS = [
  { name: 'Node.js', marks: (d) => has(d, 'package.json') && /"test"\s*:/.test(read(d, 'package.json')),
    // a fresh clone has no dependencies: install from the lockfile first (`bun run test`, not `bun test`,
    // which is Bun's own runner rather than the package's test script)
    command: (d) => (has(d, 'pnpm-lock.yaml') ? 'pnpm install --frozen-lockfile && pnpm test' : has(d, 'yarn.lock') ? 'yarn install --frozen-lockfile && yarn test'
      : has(d, 'bun.lockb') || has(d, 'bun.lock') ? 'bun install --frozen-lockfile && bun run test' : has(d, 'package-lock.json') || has(d, 'npm-shrinkwrap.json') ? 'npm ci && npm test' : 'npm install && npm test') },
  { name: 'Deno', marks: (d) => has(d, 'deno.json') || has(d, 'deno.jsonc'), command: () => 'deno test' },
  { name: '.NET', marks: (d) => anyFile(d, /\.(sln|slnx|csproj|fsproj|vbproj)$/), command: () => 'dotnet test' },
  { name: 'Rust', marks: (d) => has(d, 'Cargo.toml'), command: () => 'cargo test' },
  { name: 'Go', marks: (d) => has(d, 'go.mod'), command: () => 'go test ./...' },
  { name: 'Java (Maven)', marks: (d) => has(d, 'pom.xml'), command: (d, win) => (has(d, 'mvnw') ? (win ? 'mvnw.cmd test' : './mvnw test') : 'mvn test') },
  { name: 'JVM (Gradle)', marks: (d) => has(d, 'build.gradle') || has(d, 'build.gradle.kts'), command: (d, win) => (has(d, 'gradlew') ? (win ? 'gradlew.bat test' : './gradlew test') : 'gradle test') },
  { name: 'Scala (sbt)', marks: (d) => has(d, 'build.sbt'), command: () => 'sbt test' },
  { name: 'Python', marks: (d) => has(d, 'pyproject.toml') || has(d, 'setup.py') || has(d, 'setup.cfg') || has(d, 'tox.ini') || has(d, 'pytest.ini'),
    command: (d) => (has(d, 'tox.ini') ? 'tox' : has(d, 'uv.lock') ? 'uv run pytest' : has(d, 'poetry.lock') ? 'poetry run pytest' : 'python -m pytest') },
  { name: 'Ruby', marks: (d) => has(d, 'Gemfile'), command: (d) => `bundle install && ${has(d, '.rspec') || has(d, 'spec') ? 'bundle exec rspec' : 'bundle exec rake test'}` },
  { name: 'Elixir', marks: (d) => has(d, 'mix.exs'), command: () => 'mix deps.get && mix test' },
  { name: 'PHP', marks: (d) => has(d, 'composer.json'), command: (d) => `composer install && ${/"test"\s*:/.test(read(d, 'composer.json')) ? 'composer test' : 'vendor/bin/phpunit'}` },
  { name: 'Swift', marks: (d) => has(d, 'Package.swift'), command: () => 'swift test' },
  { name: 'Dart / Flutter', marks: (d) => has(d, 'pubspec.yaml'), command: (d) => (/\bflutter\s*:/.test(read(d, 'pubspec.yaml')) ? 'flutter pub get && flutter test' : 'dart pub get && dart test') },
  { name: 'Haskell', marks: (d) => has(d, 'stack.yaml') || anyFile(d, /\.cabal$/), command: (d) => (has(d, 'stack.yaml') ? 'stack test' : 'cabal test') },
  { name: 'Zig', marks: (d) => has(d, 'build.zig'), command: () => 'zig build test' },
  { name: 'C/C++ (CMake)', marks: (d) => has(d, 'CMakeLists.txt'), command: () => 'cmake -S . -B build && cmake --build build && ctest --test-dir build --no-tests=error' },
];

// `make test` when the Makefile has a test target: the project's own entry point, which wins when
// several ecosystems are present (a polyglot repository usually has one for exactly that reason).
function makeTest(dir) {
  const mk = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => has(dir, f));
  return mk && /^test\s*:/m.test(read(dir, mk)) ? 'make test' : null;
}

// { command, source } or { problem }. team: the parsed team.json (may be null).
// The project's own `make test` wins over an ecosystem's default: a repository that names a test
// target has said how its suite runs (build tags, integration setup) where `go test ./...` would not.
function testCommandOf(dir, team, { platform = process.platform } = {}) {
  const declared = team && typeof team.test_command === 'string' ? team.test_command.trim() : '';
  if (declared) return { command: declared, source: 'team.json test_command' };
  const win = platform === 'win32';
  const found = ECOSYSTEMS.filter((e) => { try { return e.marks(dir); } catch (err) { return false; } });
  const make = makeTest(dir);
  if (make) return { command: make, source: found.length ? `detected: Makefile test target (also ${found.map((e) => e.name).join(', ')})` : 'detected: Makefile test target' };
  if (found.length === 1) return { command: found[0].command(dir, win), source: `detected: ${found[0].name}` };
  if (found.length > 1) return { problem: `several test setups found (${found.map((e) => `${e.name}: ${e.command(dir, win)}`).join('; ')}), so which one is the suite is not known` };
  return { problem: 'no test setup found in the repository root' };
}

const FIX = 'Set it once: "test_command" in .delivery/team/team.json, the command CI runs from the repository root on a fresh clone, install step included (for example "dotnet test", "./gradlew check", "npm ci && npm test", "make test")';

module.exports = { testCommandOf, ECOSYSTEMS, FIX };
