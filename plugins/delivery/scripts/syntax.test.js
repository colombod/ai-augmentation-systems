// scripts/syntax.test.js — reach by syntax tree: who uses what a change touches, and never narrower
// than the code can show.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./lib/codemap.js');
const F = require('./lib/features.js');

// fixtures say req('x') for a relative require, so this file names no path that is not there
const code = (text) => text.replace(/\breq\('(\w+)'\)/g, (m, f) => `${'require'}('./${f}.js')`);
function product(files, features) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' }).trim();
  const put = (set) => { for (const [f, text] of Object.entries(set)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), code(text)); } g('add', '-A'); g('commit', '-qm', 'x'); return g('rev-parse', 'HEAD'); };
  g('init', '-q');
  const base = put({ ...files, '.delivery/features.json': JSON.stringify({ features: features.map(([id, a]) => ({ id, name: id, anchors: [a] })) }) });
  // the declared features that reach `paths`; with a change, only by the definitions it touched
  const ids = (paths, change) => {
    const head = change ? put(change) : base;
    const map = C.buildMap(root, head);
    const r = F.impact(map, F.featuresOf(map), paths || Object.keys(change), change ? { from: base, to: head } : {});
    assert.equal(r.syntaxError, undefined);
    return r.reached.filter((x) => x.kind === 'declared').map((x) => x.id).sort();
  };
  return { root, base, put, ids };
}

const LIB = "const RATE = 2;\nfunction buy() { return RATE; }\nfunction sell() { return 1; }\nmodule.exports = { buy, sell };\n";
const SHOP = { 'src/lib.js': LIB, 'src/buy.js': "const L = req('lib');\nL.buy();\n", 'src/sell.js': "const { sell } = req('lib');\nsell();\n" };
const BOTH = [['buyer', 'src/buy.js'], ['seller', 'src/sell.js']];

test('syntax: a changed function counts only for the features that use it, directly or through another', () => {
  const at = (change) => product(SHOP, BOTH).ids(null, { 'src/lib.js': change });
  assert.deepEqual(at(LIB.replace('return 1', 'return 3')), ['seller']);
  assert.deepEqual(at(LIB.replace('return RATE', 'return RATE + 1')), ['buyer']);
  assert.deepEqual(at(LIB.replace('RATE = 2', 'RATE = 5')), ['buyer'], 'a value used by one function');
  assert.deepEqual(at(`// a note\n${LIB}`), [], 'a comment changes nothing');
  assert.deepEqual(at(`${LIB}process.title = 'x';\n`), ['buyer', 'seller'], 'code that runs on load reaches every user');
});

test('syntax: with only the file known, every user of any of it counts, and a file only linked does not', () => {
  const p = product({ ...SHOP, 'src/deep.js': 'module.exports = {};\n', 'src/lib.js': LIB.replace('function sell() { return 1; }', "function sell() { return req('deep'); }") }, BOTH);
  assert.deepEqual(p.ids(['src/lib.js']), ['buyer', 'seller']);
  assert.deepEqual(p.ids(['src/deep.js']), ['seller'], 'buy() never gets to the require inside sell()');
});

test('syntax: where a use cannot be followed the whole file counts, and what runs on load always does', () => {
  const run = (lib, user, change) => product({ 'src/lib.js': lib, 'src/u.js': user }, [['u', 'src/u.js']]).ids(null, { 'src/lib.js': change });
  const other = LIB.replace('return 1', 'return 3');
  assert.deepEqual(run(LIB, "const L = req('lib');\nObject.keys(L);\n", other), ['u'], 'passed around as a value');
  assert.deepEqual(run(LIB, "const L = req('lib');\nL[process.argv[2]]();\n", other), ['u'], 'a computed member');
  assert.deepEqual(run(LIB, "function go() { return req('lib').buy(); }\ngo();\n", other), [], 'an inline require uses one member');
  const eager = "const pick = (x) => x;\nconst ALL = [1].map(pick);\nfunction f() {}\nmodule.exports = { f };\n";
  assert.deepEqual(run(eager, "req('lib').f();\n", eager.replace('(x) => x', '(x) => x + 1')), ['u'], 'an initializer that runs on load');
  const seam = "function ok() { return 1; }\nfunction f() { return module.exports.ok(); }\nmodule.exports = { f, ok };\n";
  assert.deepEqual(run(seam, "req('lib').f();\n", seam.replace('return 1', 'return 2')), ['u'], 'its own export, called by name');
});

test('syntax: when the parser cannot answer, the file links stand and it is said', () => {
  const p = product(SHOP, BOTH);
  const map = C.buildMap(p.root, p.base);
  const r = F.impact(map, F.featuresOf(map), ['src/lib.js'], { syntax: { narrow: () => ({ error: 'no parser' }) } });
  assert.equal(r.syntaxError, 'no parser');
  assert.deepEqual(r.reached.map((x) => x.id).sort(), ['buyer', 'seller']);
  assert.deepEqual(r.narrowed, []);
  assert.match(require('./lib/syntax.js').narrow({ repo: path.join(p.root, 'nowhere'), sha: p.base, paths: [], features: [] }).error, /git/);
});
