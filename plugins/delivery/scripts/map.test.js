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

// Found running the map on the Vault (2026-10-30): each case below is one of its wrong answers
test('Vault: a doc reached from elsewhere ends its chain; a feature\'s own doc still counts', () => {
  const fx = fixture({
    'p/.claude-plugin/plugin.json': '{"name":"p"}',
    'p/skills/a/SKILL.md': 'See [the notes](../../docs/notes.md).\n',
    'p/skills/b/SKILL.md': 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/b.js`.\n',
    'p/docs/notes.md': 'The build uses `p/scripts/b.js`.\n',
    'p/scripts/b.js': '',
  });
  const r = run(['impact', '--repo', fx.dir, '--json', 'p/scripts/b.js']).json();
  assert.deepEqual(r.reached.map((f) => f.id), ['p:b'], 'a: SKILL.md -> notes.md -> b.js is not a dependency');
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'p/docs/notes.md']).json().reached.map((f) => f.id), ['p:a']);
});

test('Vault: a product\'s own entry points are features: web routes, MCP tools, functions, workflows, console scripts', () => {
  const fx = fixture({
    'vercel.json': '{"functions": {"api/index.py": {"maxDuration": 60}}}',
    'api/index.py': 'from app.main import app\n',
    'app/__init__.py': '',
    'app/main.py': 'from app import oauth\n@app.get("/health")\ndef health(): pass\n@router.post("/decks/{id}/restore")\ndef restore(): pass\n',
    'app/oauth.py': 'def refresh(): pass\n',
    'app/mcp.py': 'TOOLS = [\n    Tool("save_deck", "Saves a deck"),\n    Tool("restore_deck", "Restores a deck"),\n]\n',
    'web/server.js': "app.get('/consent', (req, res) => res.send('ok'));\n",
    '.github/workflows/tests.yml': 'name: Tests\non: push\njobs:\n  t:\n    steps:\n      - run: python scripts/check.py\n',
    'scripts/check.py': '',
    'pyproject.toml': '[project]\nname = "app"\n\n[project.scripts]\nvault-sync = "app.main:sync"\n',
    'tests/test_x.py': 'TOOLS = [Tool("fake_tool")]\n',
    'tests/fakes.py': 'TOOLS = [Tool("twin_tool")]\n',
    'web/app.test.js': "server.tool('spec_tool', {});\n",
    'tests/test_twins.py': 'from app import oauth\n@app.get("/twin/token")\ndef token(): pass\n',
    'web/consent.spec.ts': "app.get('/spec-only', (req, res) => res.send('ok'));\n",
    'web/__tests__/routes.js': "app.get('/jest-only', (req, res) => res.send('ok'));\n",
    'app/oauth_test.py': '@app.get("/go-style")\ndef t(): pass\n',
    'conftest.py': '@app.get("/fixture")\ndef f(): pass\n',
    'web/server.test.mjs': "app.get('/mjs-only', (req, res) => res.send('ok'));\n",
    // near misses: product files whose names contain "test" stay features
    'app/contest.py': '@app.get("/contest")\ndef c(): pass\n',
    'latest/feed.py': '@app.get("/latest")\ndef l(): pass\n',
    'web/attestation.ts': "app.post('/attest', (req, res) => res.send('ok'));\n",
  });
  const f = Object.fromEntries(run(['features', '--repo', fx.dir, '--json']).json().features.map((x) => [x.id, x]));
  assert.deepEqual(f['http:app/main'].entries, ['GET /health', 'POST /decks/{id}/restore']);
  assert.deepEqual(f['http:web/server'].entries, ['GET /consent']);
  assert.deepEqual(f['tools:app/mcp'].entries, ['save_deck', 'restore_deck']);
  for (const t of ['tools:tests/test_x', 'tools:tests/fakes', 'tools:web/app.test']) assert.equal(f[t], undefined, `${t}: a test file's tools are not the product's`);
  // nor its routes (the Vault's tests/test_twins.py, reached by every sign-in change)
  for (const t of ['http:tests/test_twins', 'http:web/consent.spec', 'http:web/__tests__/routes', 'http:app/oauth_test', 'http:conftest', 'http:web/server.test']) assert.equal(f[t], undefined, `${t}: a test file's routes are not the product's`);
  for (const t of ['http:app/contest', 'http:latest/feed', 'http:web/attestation']) assert.ok(f[t], `${t}: a product file with "test" in its name is still a feature`);
  assert.deepEqual(f['function:api/index'].anchors, ['api/index.py']);
  assert.deepEqual(f['ci:tests'].entries, ['Tests']);
  assert.deepEqual(f['script:vault-sync'].anchors, ['app/main.py']);
  // the sign-in change reaches the function and the routes that serve it
  const r = run(['impact', '--repo', fx.dir, '--json', 'app/oauth.py']).json();
  assert.deepEqual(r.reached.map((x) => x.id).sort(), ['function:api/index', 'http:app/main', 'script:vault-sync']);
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'scripts/check.py']).json().reached.map((x) => x.id), ['ci:tests'], 'a workflow runs its script');
});

test('Vault: two plugins with one name keep their features apart', () => {
  const fx = fixture({
    'plugins/v/.claude-plugin/plugin.json': '{"name":"the-vault"}',
    'plugins/v/skills/s/SKILL.md': 'x\n',
    'plugins/v-openai/.claude-plugin/plugin.json': '{"name":"the-vault"}',
    'plugins/v-openai/skills/s/SKILL.md': 'x\n',
  });
  const ids = run(['features', '--repo', fx.dir, '--json']).json().features.map((x) => x.id).sort();
  assert.deepEqual(ids, ['the-vault@plugins/v-openai:s', 'the-vault@plugins/v:s']);
});

test('Vault: a file the change adds is mapped at the head, not reported as missing', () => {
  const fx = fixture(FILES);
  fs.writeFileSync(path.join(fx.dir, 'plug/scripts/receipt.js'), '');
  fs.writeFileSync(path.join(fx.dir, 'plug/scripts/pay.js'), `const t = ${REQ}('./lib/tax');\n${REQ}('./receipt');\nmodule.exports = t;\n`);
  fx.g('add', '-A'); fx.g('commit', '-qm', 'receipts');
  const r = run(['impact', '--repo', fx.dir, '--json', '--diff', fx.sha, 'HEAD']).json();
  assert.deepEqual(r.added, ['plug/scripts/receipt.js']);
  assert.deepEqual(r.unknown, []);
  assert.ok(r.reached.find((f) => f.id === 'shop:checkout').via.some((v) => v.path === 'plug/scripts/receipt.js'));
});

test('Vault: a source file named in another file\'s comment is not a dependency; a script it runs is', () => {
  const fx = fixture({
    'pkg/package.json': '{"name":"t","bin":{"t":"bin/t.js"}}',
    'pkg/bin/t.js': "// see pkg/tests/t.test.js for the cases\nspawn('node pkg/lib/worker.js')\n",
    'pkg/tests/t.test.js': '',
    'pkg/lib/worker.js': '',
  });
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'pkg/tests/t.test.js']).json().reached, []);
  assert.deepEqual(run(['impact', '--repo', fx.dir, '--json', 'pkg/lib/worker.js']).json().reached.map((f) => f.id), ['t:bin:t']);
});

test('a large answer reaches a pipe whole, and a reader that stops early is not an error', () => {
  const many = { features: Array.from({ length: 1500 }, (_, i) => ({ id: `feature-${i}`, name: `A feature with a long name ${i}`, anchors: ['a.js'] })) };
  const fx = fixture({ 'a.js': '', '.delivery/features.json': JSON.stringify(many) });
  const MAP = path.join(__dirname, 'map.js');
  const { spawnSync } = require('child_process');
  // a reader slower than the writer fills the pipe (64 KB), as jq did: what is still queued must not be lost
  const out = spawnSync('sh', ['-c', `node '${MAP}' features --repo '${fx.dir}' --json | (sleep 1; cat)`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.ok(out.stdout.length > 65536);
  assert.equal(JSON.parse(out.stdout).features.length, 1500);
  const early = spawnSync('sh', ['-c', `node '${MAP}' features --repo '${fx.dir}' | head -1`], { encoding: 'utf8' });
  assert.doesNotMatch(early.stderr, /EPIPE/);
});

// Found putting a real story (team-runtime-01) through the map with the team on Wintermute, 2026-10-31
test('real story: a route or tool written in a comment is not an entry point; real ones still are', () => {
  const fx = fixture({
    'lib/scan.js': '// detects web routes like @app.get("/x") and MCP tools like Tool("name", ...)\n/* router.post("/y") */\nconst re = 1;\n',
    'py/notes.py': '# @app.get("/x") is how a FastAPI route looks\nx = 1\n',
    'srv/app.py': '@app.get("/health")\ndef health(): pass\nTOOLS = [Tool("save_deck")]  # Tool("not_this")\n',
    'web/s.js': "const url = 'http://example.com'; app.get('/consent', h); // app.get('/fake', h)\n",
  });
  const f = Object.fromEntries(run(['features', '--repo', fx.dir, '--json']).json().features.map((x) => [x.id, x]));
  assert.equal(f['http:lib/scan'], undefined);
  assert.equal(f['tools:lib/scan'], undefined);
  assert.equal(f['http:py/notes'], undefined);
  assert.deepEqual(f['http:srv/app'].entries, ['GET /health']);
  assert.deepEqual(f['tools:srv/app'].entries, ['save_deck']);
  assert.deepEqual(f['http:web/s'].entries, ['GET /consent'], 'a URL\'s // inside quotes does not cut the line');
});

test('real story: impact --story leaves out the files a story only reads', () => {
  const s = M.storyPaths('# S\n\n## Files and modules\n\n| Path | What to do |\n| :-- | :-- |\n| `a.js` | modify: add the check |\n| `b.js` | read only, for the format |\n| `c.md` | reference |\n| `d.js` | create |\n| `e.js` | read the shape, then update its caller |\n| `f.js` | |\n');
  assert.deepEqual(s, ['a.js', 'd.js', 'e.js', 'f.js']);
});
