// scripts/lib/gate-context.test.js — the project root a gate reads follows its origin (freshRoot).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { freshRoot } = require('./gate-context.js');

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// a project root with an origin, and a role's clone that has pushed one more commit to it
function fixture() {
  const bare = mk('fresh-origin-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const root = mk('fresh-root-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'plan.md'), 'v1\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'v1');
  git(root, 'remote', 'add', 'origin', bare); git(root, 'push', '-q', 'origin', 'main');
  const clone = mk('fresh-clone-');
  git(clone, 'clone', '-q', bare, '.');
  fs.mkdirSync(path.join(clone, '.delivery', 'stories'), { recursive: true });
  fs.writeFileSync(path.join(clone, '.delivery', 'stories', 's1.md'), '# story\n');
  git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', 'story'); git(clone, 'push', '-q', 'origin', 'main');
  return { root, clone };
}

test('freshRoot: the root fast-forwards to what a role pushed, so a gate reads the story', () => {
  const { root, clone } = fixture();
  assert.ok(!fs.existsSync(path.join(root, '.delivery', 'stories', 's1.md')));
  assert.equal(freshRoot(root, { env, everyMs: 0 }), 'updated');
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'stories', 's1.md')));
  assert.equal(git(root, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', 'HEAD'));
  assert.equal(freshRoot(root, { env, everyMs: 0 }), 'current');
});

test('freshRoot leaves a root with uncommitted changes, a diverged root, and a root with no origin as they are', () => {
  const a = fixture();
  fs.writeFileSync(path.join(a.root, 'plan.md'), 'edited, not committed\n');
  assert.equal(freshRoot(a.root, { env, everyMs: 0 }), 'dirty');
  assert.equal(fs.readFileSync(path.join(a.root, 'plan.md'), 'utf8'), 'edited, not committed\n');
  assert.ok(!fs.existsSync(path.join(a.root, '.delivery', 'stories', 's1.md')));
  const b = fixture();
  fs.writeFileSync(path.join(b.root, 'local.md'), 'x\n'); git(b.root, 'add', '-A'); git(b.root, 'commit', '-q', '-m', 'local');
  const head = git(b.root, 'rev-parse', 'HEAD');
  assert.equal(freshRoot(b.root, { env, everyMs: 0 }), 'diverged');
  assert.equal(git(b.root, 'rev-parse', 'HEAD'), head, 'never merges or rewrites');
  const c = mk('fresh-noremote-'); git(c, 'init', '-q');
  assert.equal(freshRoot(c, { env, everyMs: 0 }), 'no-remote');
});

test('freshRoot runs at most once a minute', () => {
  const { root } = fixture();
  assert.equal(freshRoot(root, { env, everyMs: 0 }), 'updated');
  assert.equal(freshRoot(root, { env }), 'recent');
});

test('whoAmI freshens the root it returns, so every gate script reads what the roles pushed', () => {
  const { root } = fixture();
  const { whoAmI } = require('./gate-context.js');
  assert.equal(whoAmI({ cwd: os.tmpdir(), env, project: root }).root, root);
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'stories', 's1.md')));
});
