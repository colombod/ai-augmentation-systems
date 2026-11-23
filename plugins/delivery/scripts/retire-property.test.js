// scripts/retire-property.test.js — run through scripts/testing/run-tests.js
// Property P1 of the feature map, against the real code and with no proof tool: retiring a feature
// leaves every other feature's reach unchanged. This is the arm of the property check that runs
// everywhere (CI has no Lean). The Lean proof of the same property is about a model
// (proofs/feature-map); the fixed examples below are what both sides are held to.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('./lib/retire-property.js');
const C = require('./lib/codemap.js');
const F = require('./lib/features.js');

// fixture bodies are another project's code; spelled so this repository's own link check skips them
const REQ = ['req', 'uire'].join('');
const ROOTVAR = ['${CLAUDE', 'PLUGIN', 'ROOT}'].join('_');

// run `fn` with features.retirement replaced, and put the real one back whatever happens
function withRetirement(broken, fn) {
  const real = F.retirement;
  F.retirement = broken;
  try { return fn(); } finally { F.retirement = real; }
}

test('P1: over 300 seeded graphs, deleting what a retirement lists changes no other feature\'s reach', () => {
  const r = P.retirePreservesReach({ cases: 300, seed: 1 });
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true, r.detail);
  // not vacuous: most graphs had at least one retirement that deleted something
  assert.ok(r.deletions >= 200, `only ${r.deletions} retirements deleted files`);
});

test('P1 is the same run for the same seed, and a different one for another', () => {
  assert.deepEqual(P.randomGraph(7), P.randomGraph(7));
  assert.notDeepEqual(P.randomGraph(7), P.randomGraph(8));
});

test('P1 fails when retirement looks at only the first other feature', () => {
  // the seeded violation: a file a third feature reaches is listed as exclusive
  const real = F.retirement;
  const r = withRetirement((map, feats, id) => {
    const f = feats.find((x) => x.id === id);
    return real(map, [f, ...feats.filter((x) => x !== f).slice(0, 1)], id);
  }, () => P.retirePreservesReach({ cases: 300, seed: 1 }));
  assert.equal(r.ok, false);
  assert.ok(r.failures.length > 0);
  assert.match(r.detail, /^seed \d+: retiring F\d deletes \[/);
});

test('P1 fails when a run deletes nothing, instead of passing while checking nothing', () => {
  const real = F.retirement;
  const r = withRetirement((map, feats, id) => ({ ...real(map, feats, id), exclusive: [], named: [] }), () => P.retirePreservesReach({ cases: 50, seed: 1 }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /not exercising the property/);
});

test('the fixed examples: the real reach and exclusive sets are the written ones', () => {
  const r = P.examplesAgree();
  assert.deepEqual(r.failures, []);
  assert.equal(r.examples, 4);
});

test('the fixed examples fail when a written number is not what the code computes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-ex-'));
  const doc = JSON.parse(fs.readFileSync(P.EXAMPLES, 'utf8'));
  // docEndsChain, feature A: claim the walk goes on through the document at 1 to file 2
  doc.examples[0].features[0].reach = [0, 1, 2, 3, 4];
  const file = path.join(dir, 'examples.json');
  const leanFile = path.join(dir, 'Examples.lean');
  fs.writeFileSync(file, JSON.stringify(doc));
  fs.writeFileSync(leanFile, P.toLean(doc.examples));
  const r = P.examplesAgree({ file, leanFile });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /docEndsChain\/A: the code reaches \[0,1,3,4\], the example says \[0,1,2,3,4\]/);
});

test('the fixed examples fail when Examples.lean was not generated from examples.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-ex-'));
  const leanFile = path.join(dir, 'Examples.lean');
  fs.writeFileSync(leanFile, P.toLean(P.loadExamples()).replace('[0, 1, 3, 4]', '[0, 1, 3]'));
  const r = P.examplesAgree({ leanFile });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /Examples\.lean is not what examples\.json generates/);
  // and the committed file is the generated one
  assert.equal(fs.readFileSync(P.EXAMPLES_LEAN, 'utf8'), P.toLean(P.loadExamples()));
});

test('P1 on a real repository: delete a retired skill\'s exclusive files, rebuild the map, the other skill reaches the same', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-fx-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const files = {
    'plug/.claude-plugin/plugin.json': '{"name":"shop"}',
    'plug/skills/pay/SKILL.md': `# Pay\nRun \`node ${ROOTVAR}/scripts/pay.js\`.\n`,
    'plug/skills/refund/SKILL.md': `# Refund\nRun \`node ${ROOTVAR}/scripts/refund.js\`.\n`,
    'plug/scripts/pay.js': `${REQ}('./lib/money');\n${REQ}('./lib/card');\n`,
    'plug/scripts/refund.js': `${REQ}('./lib/money');\n`,
    'plug/scripts/lib/money.js': 'module.exports = 1;\n',
    'plug/scripts/lib/card.js': 'module.exports = 2;\n',
  };
  g('init', '-q', '-b', 'main');
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const before = C.buildMap(dir, 'HEAD');
  const feats = F.featuresOf(before);
  const r = F.retirement(before, feats, 'shop:pay');
  assert.deepEqual(r.exclusive, ['plug/scripts/lib/card.js', 'plug/scripts/pay.js', 'plug/skills/pay/SKILL.md']);
  const refund = feats.find((x) => x.id === 'shop:refund');
  const reachedBefore = [...C.reach(before, refund.anchors).keys()].sort();
  assert.deepEqual(reachedBefore, ['plug/scripts/lib/money.js', 'plug/scripts/refund.js', 'plug/skills/refund/SKILL.md']);
  for (const p of r.exclusive) fs.rmSync(path.join(dir, p));
  g('add', '-A');
  g('commit', '-q', '-m', 'retire pay');
  const after = C.buildMap(dir, 'HEAD');
  const refundAfter = F.featuresOf(after).find((x) => x.id === 'shop:refund');
  assert.deepEqual([...C.reach(after, refundAfter.anchors).keys()].sort(), reachedBefore);
});
