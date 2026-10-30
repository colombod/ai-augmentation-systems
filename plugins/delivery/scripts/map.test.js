// scripts/map.test.js — run with: node --test scripts/map.test.js
// The feature map (owner's ask, 2026-10-24): what a repository ships and what a change reaches, from the
// feature's side, before code. Any project, any language: the fixture mixes a Claude plugin, JS, Python,
// Go, a declared feature and files no rule reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('./map.js');

// fixture bodies are another project's code; spelled so this repository's own link check skips them
const REQ = ['req', 'uire'].join('');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-fx-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  return { dir, g, sha: g('rev-parse', 'HEAD') };
}

const FILES = {
  // a Claude Code plugin: a skill that runs a script, a hook that runs another
  'plug/.claude-plugin/plugin.json': '{"name":"shop"}',
  'plug/skills/checkout/SKILL.md': '# Checkout\nRun `node ${CLAUDE_PLUGIN_ROOT}/scripts/pay.js` to charge.\n',
  'plug/skills/help/SKILL.md': '# Help\nRead the [guide](../../../docs/guide.md).\n',
  'plug/scripts/pay.js': `const t = ${REQ}('./lib/tax');\nmodule.exports = t;\n`,
  'plug/scripts/lib/tax.js': `const r = ${REQ}('./rates.json');\nmodule.exports = r;\n`,
  'plug/scripts/lib/rates.json': '{"vat": 20}',
  'plug/hooks/hooks.json': '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/start.js"}]}]}}',
  'plug/hooks/start.js': `const p = ${REQ}('path');\n${REQ}(p.join(__dirname, '..', 'scripts', 'lib', 'tax.js'));\n`,
  'docs/guide.md': '# Guide\n',
  // Python
  'svc/pyproject.toml': '[project]\nname = "svc"\n',
  'svc/src/svc/__init__.py': '',
  'svc/src/svc/api.py': 'from svc import db\nfrom .auth import check\n',
  'svc/src/svc/db.py': 'import os\n',
  'svc/src/svc/auth.py': 'def check(): pass\n',
  // Go
  'go.mod': 'module example.com/app\n\ngo 1.22\n',
  'cmd/app/main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/internal/store"\n)\n',
  'internal/store/store.go': 'package store\n',
  // a package with a command-line entry point
  'cli/package.json': '{"name":"tool","bin":{"tool":"bin/tool.js"}}',
  'cli/bin/tool.js': `${REQ}('../lib/run.js');\n`,
  'cli/lib/run.js': '',
  // the team names features in any language
  '.delivery/features.json': JSON.stringify({ features: [
    { id: 'api', name: 'Public API', anchors: ['svc/src/svc/api.py'] },
    { id: 'app', name: 'The app', anchors: ['cmd/app/main.go'] },
    { id: 'gone', name: 'Removed', anchors: ['nowhere/*.py'] },
  ] }),
  'assets/logo.bin': '\u0000\u0001binary',
  'orphan.js': '',
};

const run = (args) => { let out = ''; const code = M.main(args, { write: (s) => { out += s; } }); return { code, out, json: () => JSON.parse(out) }; };

test('features: derived from the plugin and the package, declared from the register, at a named commit', () => {
  const fx = fixture(FILES);
  const r = run(['features', '--repo', fx.dir, '--json']).json();
  assert.equal(r.sha, fx.sha, 'the answer names the 40-hex commit');
  const ids = r.features.map((f) => `${f.id}/${f.source}`).sort();
  assert.deepEqual(ids, ['api/declared', 'app/declared', 'gone/declared', 'shop:checkout/derived', 'shop:help/derived', 'shop:hook:SessionStart/derived', 'tool:bin:tool/derived']);
  assert.deepEqual(r.features.find((f) => f.id === 'shop:hook:SessionStart').anchors, ['plug/hooks/start.js'], 'a hook is anchored at the script it runs');
  assert.deepEqual(r.features.find((f) => f.id === 'gone').dangling, ['nowhere/*.py'], 'an anchor that matches nothing is dangling, not dropped');
});

test('impact: the features a change reaches, with the chain and file:line evidence, across languages', () => {
  const fx = fixture(FILES);
  const tax = run(['impact', '--repo', fx.dir, '--json', 'plug/scripts/lib/rates.json']).json();
  const reached = Object.fromEntries(tax.reached.map((f) => [f.id, f.hops]));
  assert.deepEqual(reached, { 'shop:hook:SessionStart': 2, 'shop:checkout': 3 }, 'reached through require, path.join and a skill mention; help is not');
  const chain = tax.reached.find((f) => f.id === 'shop:checkout').via[0].chain;
  assert.deepEqual(chain.map((s) => `${s.from}:${s.line}->${s.to}`), [
    'plug/skills/checkout/SKILL.md:2->plug/scripts/pay.js',
    'plug/scripts/pay.js:1->plug/scripts/lib/tax.js',
    'plug/scripts/lib/tax.js:1->plug/scripts/lib/rates.json',
  ]);
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'svc/src/svc/auth.py']).json().reached.map((f) => f.id), ['api'], 'Python relative import');
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'svc/src/svc/db.py']).json().reached.map((f) => f.id), ['api'], 'Python absolute import under src/');
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'internal/store/store.go']).json().reached.map((f) => f.id), ['app'], 'Go package import');
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'cli/lib/run.js']).json().reached.map((f) => f.id), ['tool:bin:tool']);
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'docs/guide.md']).json().reached.map((f) => f.id), ['shop:help'], 'a markdown link');
});

test('impact names what it cannot see: unreached files, blind files, unknown and ambiguous paths', () => {
  const fx = fixture({ ...FILES, 'a/x.js': '', 'b/x.js': '' });
  const r = run(['impact', '--repo', fx.dir, '--json', 'orphan.js', 'assets/logo.bin', 'nope.js', 'x.js']).json();
  assert.deepEqual(r.unreached, [{ path: 'orphan.js', blind: false }, { path: 'assets/logo.bin', blind: true }]);
  assert.deepEqual(r.unknown, ['nope.js']);
  assert.deepEqual(r.ambiguous, [{ path: 'x.js', candidates: ['a/x.js', 'b/x.js'] }]);
  assert.ok(r.blind >= 1);
  const text = run(['impact', '--repo', fx.dir, 'orphan.js']).out;
  assert.match(text, /^Impact at [0-9a-f]{40} of 1 changed file: 0 of 7 features reached/);
  assert.match(text, /Unreached: orphan\.js: no feature reaches it/);
  assert.match(text, /Blind spots: \d+ of \d+ files are read by no rule/);
});

test('one file, one path: ./x, a unique suffix and the full path are the same file', () => {
  const fx = fixture(FILES);
  for (const p of ['./plug/scripts/pay.js', 'scripts/pay.js', 'plug/scripts/pay.js']) {
    assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', p]).json().changed, ['plug/scripts/pay.js'], p);
  }
});

test('impact --diff maps at the base what base..head changed; --story reads a story\'s Files and modules', () => {
  const fx = fixture(FILES);
  fs.writeFileSync(path.join(fx.dir, 'svc/src/svc/auth.py'), 'def check(): return True\n');
  fx.g('commit', '-qam', 'change auth');
  const d = run(['impact', '--repo', fx.dir, '--json', '--diff', fx.sha, 'HEAD']).json();
  assert.equal(d.sha, fx.sha, 'mapped at the base the change lands on');
  assert.deepEqual(d.changed, ['svc/src/svc/auth.py']);
  assert.deepEqual(d.reached.map((f) => f.id), ['api']);
  const story = path.join(fx.dir, 'story.md');
  fs.writeFileSync(story, '# S\n\n## Files and modules\n\n| Path | What to do |\n| :-- | :-- |\n| `cli/lib/run.js` | modify |\n| `cli/lib/new.js` | create |\n| `src/...` | modify |\n\n## Next\n| `plug/scripts/pay.js` | not this section |\n');
  const s = run(['impact', '--repo', fx.dir, '--json', '--story', story]).json();
  assert.deepEqual(s.changed, ['cli/lib/run.js']);
  assert.deepEqual(s.unknown, ['cli/lib/new.js'], 'a file the story creates is not in the commit yet');
  assert.deepEqual(s.reached.map((f) => f.id), ['tool:bin:tool']);
});

test('a ref that is not a commit is refused; usage errors exit 2', () => {
  const fx = fixture(FILES);
  const r = run(['features', '--repo', fx.dir, '--at', 'no-such-branch']);
  assert.equal(r.code, 1);
  assert.match(r.out, /refused/);
  assert.equal(run(['impact', '--repo', fx.dir]).code, 2);
  assert.equal(run(['nope']).code, 2);
});

test('a hub: a file most features reach is named as one', () => {
  const files = { 'p/.claude-plugin/plugin.json': '{"name":"p"}', 'p/lib/core.js': '' };
  for (const n of ['a', 'b', 'c', 'd']) {
    files[`p/skills/${n}/SKILL.md`] = `Run \`node \${CLAUDE_PLUGIN_ROOT}/scripts/${n}.js\`.\n`;
    files[`p/scripts/${n}.js`] = n === 'd' ? '' : `${REQ}('../lib/core.js');\n`;
  }
  const fx = fixture(files);
  const r = run(['impact', '--repo', fx.dir, '--json', 'p/lib/core.js']).json();
  assert.deepEqual(r.hubs, [{ path: 'p/lib/core.js', features: 3 }]);
  assert.equal(r.reached.length, 3);
});

// a role session runs the map through its lane, without a permission prompt
test('the Delivery Manager and the other restricted lanes may run map.js; nothing else under its name', () => {
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const ROOT = path.join(__dirname, '..');
  const policy = loadPolicy({ pluginRoot: ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/delivery-lead' });
  const groups = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const run = (command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy, groups, pluginRoot: ROOT, roleDir: os.tmpdir(), cwd: os.tmpdir(), hostHeadless: false });
  for (const sub of ['features', 'impact --story s.md', 'blind --json']) assert.equal(run(`node ${ROOT}/scripts/map.js ${sub}`).allow, true, sub);
  assert.equal(run(`node ${ROOT}/scripts/map.js rm -rf /`).allow, false, 'only its three read-only verbs');
});

// Retirement (MJ's Market Fit and Worth Using): what deleting a feature frees, never a verdict on use
test('retire: files only the feature reaches are deletable; shared ones name the features that keep them', () => {
  const fx = fixture(FILES);
  const r = run(['retire', 'shop:checkout', '--repo', fx.dir, '--json']).json();
  assert.equal(r.sha, fx.sha);
  assert.deepEqual(r.exclusive, ['plug/scripts/pay.js', 'plug/skills/checkout/SKILL.md']);
  assert.deepEqual(r.shared, [
    { path: 'plug/scripts/lib/rates.json', features: ['shop:hook:SessionStart'] },
    { path: 'plug/scripts/lib/tax.js', features: ['shop:hook:SessionStart'] },
  ]);
  const text = run(['retire', 'shop:checkout', '--repo', fx.dir]).out;
  assert.match(text, /Deletable with it/);
  assert.match(text, /plug\/scripts\/lib\/tax\.js {2}also reached by shop:hook:SessionStart/);
  assert.match(text, /reach, not use/);
  assert.match(text, /the owner's decision, recorded/);
  const none = run(['retire', 'no-such', '--repo', fx.dir]);
  assert.equal(none.code, 1);
  assert.match(none.out, /no feature "no-such"/);
  assert.equal(run(['retire', '--repo', fx.dir]).code, 2);
});
