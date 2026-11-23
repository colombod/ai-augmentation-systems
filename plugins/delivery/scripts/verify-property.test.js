// scripts/verify-property.test.js — run through scripts/testing/run-tests.js
// The property runner in both modes: with Lean and without. CI has no Lean, so the Lean branch is
// exercised with a stand-in elan that answers as the real one does; the one test that wants the real
// proof says out loud when Lean is absent and asserts the no-Lean report instead of passing silently.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const V = require('./verify-property.js');

const SCRIPT = path.join(__dirname, 'verify-property.js');
const REGISTER = path.join(__dirname, '..', '.delivery', 'properties.json');
const P1 = JSON.parse(fs.readFileSync(REGISTER, 'utf8')).properties.find((p) => p.id === 'P1');
const THEOREMS = P1.methods.find((m) => m.kind === 'lean').theorems;

// a stand-in elan: `run <toolchain> lake build` and `run <toolchain> lake env lean <file>`
function fakeElan({ build = 0, axioms = '[propext, Quot.sound]', theorems = THEOREMS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-elan-'));
  const file = path.join(dir, 'elan');
  const lines = theorems.map((t) => `echo "info: Model/Audit.lean:1:0: '${t}' depends on axioms: ${axioms}"`).join('\n');
  fs.writeFileSync(file, `#!/bin/sh\nif [ "$4" = "build" ]; then\n  [ ${build} -ne 0 ] && echo "error: Model/FeatureMap.lean:1:1: unsolved goals"\n  exit ${build}\nfi\nif [ "$6" = "Model/Audit.lean" ]; then\n${lines}\nfi\nexit 0\n`, { mode: 0o755 });
  return file;
}
const run = (elan, extra = {}) => V.verify(P1, { env: { ...process.env, DELIVERY_ELAN: elan }, ...extra });
const lean = (rec) => rec.methods.find((m) => m.id === 'lean');

test('the register names the feature, the statement and each method with its files', () => {
  const features = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.delivery', 'features.json'), 'utf8')).features.map((f) => f.id);
  assert.ok(features.includes(P1.feature));
  assert.match(P1.statement, /leaves every other feature's reach unchanged/);
  assert.deepEqual(P1.methods.map((m) => m.id), ['property-test', 'examples', 'lean']);
  for (const m of P1.methods) for (const f of m.files) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${m.id} names ${f}, which does not exist`);
});

test('--without-lean: one line per method, met by property test only, never called proven', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--without-lean'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}property-test: met \(300 seeded graphs/m);
  assert.match(r.stdout, /^ {2}examples: met \(4 fixed graphs/m);
  assert.match(r.stdout, /^ {2}lean: not run \(--without-lean\)$/m);
  assert.match(r.stdout, /^ {2}P1: met, checked by property-test and examples only; not proven/m);
  assert.match(r.stdout, /^ {2}ran: property-test, examples; not run: lean$/m);
  assert.doesNotMatch(r.stdout, /proven in the Lean model/);
});

test('no elan on the machine: "lean: unavailable, not run", and the property is not proven', () => {
  const rec = run('');
  assert.equal(lean(rec).ran, false);
  assert.match(V.report(rec), /^ {2}lean: unavailable, not run/m);
  assert.equal(rec.state, 'met');
  assert.equal(rec.proven, false);
  assert.deepEqual(rec.notRun, ['lean']);
  assert.match(rec.basis, /only; not proven/);
});

test('with Lean: a proof that builds and audits clean makes the property proven, tied to the code', () => {
  const rec = run(fakeElan());
  assert.equal(lean(rec).verdict, 'met');
  assert.equal(rec.state, 'met');
  assert.equal(rec.proven, true);
  assert.deepEqual(rec.ran, ['property-test', 'examples', 'lean']);
  assert.match(rec.basis, /^proven in the Lean model, and tied to the code by property-test and examples$/);
});

test('with Lean: a proof that does not build disagrees with the tests, is said so, and exits 1', () => {
  const elan = fakeElan({ build: 1 });
  const rec = run(elan);
  assert.equal(lean(rec).verdict, 'contradicted');
  assert.equal(rec.state, 'contradicted');
  assert.equal(rec.disagree, true);
  assert.match(rec.basis, /^methods disagree: property-test, examples say met, lean says contradicted$/);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, DELIVERY_ELAN: elan } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /P1: contradicted, methods disagree/);
});

test('with Lean: an unfinished proof (sorry) or an extra axiom is refused', () => {
  assert.match(lean(run(fakeElan({ axioms: '[propext, sorryAx]' }))).detail, /rests on sorryAx \(an unfinished proof\)/);
  const rec = run(fakeElan({ axioms: '[myAxiom]' }));
  assert.equal(lean(rec).verdict, 'contradicted');
  assert.equal(rec.proven, false);
});

test('with Lean: a named theorem the audit never printed is not counted as proved', () => {
  const rec = run(fakeElan({ theorems: THEOREMS.slice(1) }));
  assert.equal(lean(rec).verdict, 'contradicted');
  assert.match(lean(rec).detail, /the audit does not cover FeatureMap\.retire_preserves_reach/);
});

test('a failing check contradicts the property even when the proof passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-'));
  const mod = path.join(dir, 'bad.js');
  fs.writeFileSync(mod, 'module.exports = { check: () => ({ ok: false, detail: "seed 3 breaks it" }) };\n');
  const prop = { ...P1, methods: [{ id: 'property-test', kind: 'check', module: mod, export: 'check' }, P1.methods.find((m) => m.kind === 'lean')] };
  const rec = V.verify(prop, { env: { ...process.env, DELIVERY_ELAN: fakeElan() } });
  assert.equal(rec.state, 'contradicted');
  assert.equal(rec.disagree, true);
  assert.equal(rec.proven, false);
  assert.match(rec.basis, /lean say met, property-test says contradicted/);
});

test('no method ran: unverified, not met', () => {
  const rec = V.verify({ ...P1, methods: [P1.methods.find((m) => m.kind === 'lean')] }, { withoutLean: true });
  assert.equal(rec.state, 'unverified');
  assert.equal(rec.proven, false);
});

test('an unknown property id is a usage error', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'P99', '--without-lean'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no property P99 \(known: P1\)/);
});

test('the real proof, where Lean is installed; where it is not, the no-Lean report, said out loud', (t) => {
  const env = { ...process.env };
  delete env.DELIVERY_ELAN;
  const elan = V.findElan(env);
  const rec = V.verify(P1, { env });
  if (!elan) {
    t.diagnostic('Lean (elan) is not installed here: the Lean proof of P1 was NOT run. Asserting the no-Lean report instead.');
    assert.match(V.report(rec), /^ {2}lean: unavailable, not run/m);
    assert.equal(rec.proven, false);
    assert.equal(rec.state, 'met');
    return;
  }
  t.diagnostic(`Lean found at ${elan}: the real proof of P1 was built and audited (${lean(rec).ms} ms).`);
  assert.equal(lean(rec).verdict, 'met', lean(rec).detail);
  assert.equal(rec.proven, true);
});
