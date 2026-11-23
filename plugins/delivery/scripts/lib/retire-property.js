// scripts/lib/retire-property.js — property P1 of the feature map, checked against the real code with
// no proof tool: "retiring a feature leaves every other feature's reach unchanged".
// The owner's ask: validate properties of features against the code, with Lean where it fits and
// without it where it does not. This is the arm that needs nothing installed. It has two checks:
//   retirePreservesReach  random graphs from a seeded generator: retire each feature with the real
//                         features.retirement, delete what it lists, recompute every other feature's
//                         reach with the real codemap.reach, and compare.
//   examplesAgree         fixed graphs whose expected reach and exclusive sets are written once in
//                         proofs/feature-map/examples.json. The same numbers are checked in Lean against
//                         the model (Model/Examples.lean, generated here), so a Lean proof about the
//                         model is never mistaken for a proof about the code: if the two drift, one fails.
// Graphs are built in memory in the shape codemap.buildMap returns, so a case costs microseconds and
// needs no git. What that skips (how edges are found in real files) is stated as the check's limit.
const fs = require('fs');
const path = require('path');
const C = require('./codemap.js');
const F = require('./features.js');

const PROJECT = path.join(__dirname, '..', '..', 'proofs', 'feature-map');
const EXAMPLES = path.join(PROJECT, 'examples.json');
const EXAMPLES_LEAN = path.join(PROJECT, 'Model', 'Examples.lean');

// a file number -> the path the real code sees; a document gets a document's extension, because the
// real document rule reads the extension
const nameOf = (i, docs) => `f${i}.${docs.has(i) ? 'md' : 'js'}`;
const numOf = (p) => Number(/^f(\d+)\./.exec(p)[1]);
const nums = (paths) => [...paths].map(numOf).sort((a, b) => a - b);

// { files: n, docs: [i], edges: [[from, to]], features: [{ id, anchors: [i] }] } -> { map, feats }
function build(g) {
  const docs = new Set(g.docs);
  const files = [];
  for (let i = 0; i < g.files; i++) files.push(nameOf(i, docs));
  const edges = new Map(files.map((f) => [f, []]));
  for (const [a, b] of g.edges) edges.get(nameOf(a, docs)).push({ to: nameOf(b, docs), line: 1, kind: 'import' });
  const map = { sha: 'in-memory', files, analysed: files, blind: [], edges, texts: {}, pluginRoots: [] };
  const feats = g.features.map((f) => ({ id: f.id, kind: 'declared', source: 'declared', anchors: f.anchors.map((i) => nameOf(i, docs)) }));
  return { map, feats };
}

// the same graph with some files deleted: they leave the file list, every edge that touches them goes,
// and a feature no longer anchors them (what a rebuild of the map after the deletion would see)
function without(map, feats, gone) {
  const dead = new Set(gone);
  const files = map.files.filter((f) => !dead.has(f));
  const edges = new Map(files.map((f) => [f, (map.edges.get(f) || []).filter((e) => !dead.has(e.to))]));
  return {
    map: { ...map, files, analysed: files, edges },
    feats: feats.map((f) => ({ ...f, anchors: f.anchors.filter((a) => !dead.has(a)) })),
  };
}

// mulberry32: a small seeded generator, so a failing case is named by its seed and replays exactly
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGraph(seed) {
  const r = rng(seed);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const files = int(3, 12);
  const docs = [];
  for (let i = 0; i < files; i++) if (r() < 0.3) docs.push(i);
  const edges = [];
  const density = 0.08 + r() * 0.25;
  for (let a = 0; a < files; a++) for (let b = 0; b < files; b++) if (a !== b && r() < density) edges.push([a, b]);
  const features = [];
  const count = int(2, 4);
  for (let k = 0; k < count; k++) {
    const anchors = new Set();
    for (let j = int(1, 2); j > 0; j--) anchors.add(int(0, files - 1));
    features.push({ id: `F${k}`, anchors: [...anchors] });
  }
  return { files, docs, edges, features };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// P1 on one graph, for every feature in turn. Returns the violations found, each replayable.
function checkGraph(g) {
  const { map, feats } = build(g);
  const out = { retirements: 0, deletions: 0, violations: [] };
  for (const f of feats) {
    const r = F.retirement(map, feats, f.id);
    // everything the retirement lists as only this feature's: the deletable files and the ones held
    // back because something else names them. P1 must hold for both.
    const gone = [...r.exclusive, ...r.named.map((n) => n.path)];
    out.retirements += 1;
    if (gone.length) out.deletions += 1;
    const after = without(map, feats, gone);
    for (const o of feats) {
      if (o === f) continue;
      const before = nums(C.reach(map, o.anchors).keys());
      const now = nums(C.reach(after.map, after.feats.find((x) => x.id === o.id).anchors).keys());
      if (!same(before, now)) out.violations.push({ retired: f.id, deleted: nums(gone), other: o.id, before, after: now });
    }
  }
  return out;
}

// { ok, detail, cases, retirements, deletions, failures } — the property test over `cases` seeded graphs
function retirePreservesReach({ cases = 300, seed = 1 } = {}) {
  const res = { cases, seed, retirements: 0, deletions: 0, failures: [] };
  for (let i = 0; i < cases; i++) {
    const g = randomGraph(seed + i);
    const r = checkGraph(g);
    res.retirements += r.retirements;
    res.deletions += r.deletions;
    for (const v of r.violations) res.failures.push({ seed: seed + i, graph: g, ...v });
  }
  // a run where nothing was ever deleted would pass while checking nothing
  const vacuous = res.deletions < cases / 4;
  res.ok = !res.failures.length && !vacuous;
  const first = res.failures[0];
  res.detail = first
    ? `seed ${first.seed}: retiring ${first.retired} deletes [${first.deleted}] and ${first.other} then reaches [${first.after}], was [${first.before}] (${res.failures.length} violations in ${cases} graphs)`
    : vacuous ? `only ${res.deletions} of ${res.retirements} retirements deleted anything: the generator is not exercising the property`
      : `${cases} seeded graphs, ${res.retirements} retirements, ${res.deletions} of them deleting files, no other feature's reach changed`;
  return res;
}

function loadExamples(file = EXAMPLES) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).examples;
}

// The Lean side of the examples, generated so the numbers are written once. Each expected reach list is
// certified against the model's `Reach` (the relation P1 is proved about), each exclusive list is
// recomputed, and P1 itself is evaluated on the example.
function toLean(examples) {
  const list = (xs) => `[${xs.join(', ')}]`;
  const L = [
    '/- Generated from ../examples.json by scripts/lib/retire-property.js (toLean). Do not edit:',
    '   change examples.json and regenerate with `node scripts/verify-property.js --write-examples`.',
    '   The same numbers are checked against the real code by scripts/retire-property.test.js. -/',
    'import Model.FeatureMap',
    '',
    'namespace FeatureMap.Examples',
    'open FeatureMap',
  ];
  for (const ex of examples) {
    if (!/^[A-Za-z]\w*$/.test(ex.name) || ex.features.some((f) => !/^[A-Za-z]\w*$/.test(f.id))) throw new Error(`example ${ex.name}: names must be plain identifiers`);
    L.push('', `/- ${ex.note} -/`, `namespace ${ex.name}`);
    L.push(`def g : Graph := { edges := ${list(ex.edges.map(([a, b]) => `(${a}, ${b})`))}, docs := ${list(ex.docs)} }`);
    for (const f of ex.features) {
      L.push(`def anchors${f.id} : List File := ${list(f.anchors)}`);
      L.push(`def reach${f.id} : List File := ${list(f.reach)}`);
      L.push(`def exclusive${f.id} : List File := ${list(f.exclusive)}`);
    }
    for (const f of ex.features) {
      const others = ex.features.filter((o) => o !== f);
      L.push(`theorem reach${f.id}_cert : certB g anchors${f.id} reach${f.id} = true := by decide`);
      L.push(`theorem reach${f.id}_is_model_reach (x : File) : Reach g anchors${f.id} x ↔ x ∈ reach${f.id} :=`);
      L.push(`  reach_iff_of_cert g anchors${f.id} reach${f.id} reach${f.id}_cert x`);
      L.push(`theorem exclusive${f.id}_ok : exclusiveList reach${f.id} ${list(others.map((o) => `reach${o.id}`))} = exclusive${f.id} := by decide`);
      for (const o of others) {
        L.push(`theorem retire${f.id}_keeps${o.id} : certB (g.remove exclusive${f.id}) (removeFiles exclusive${f.id} anchors${o.id}) reach${o.id} = true := by decide`);
      }
    }
    L.push(`end ${ex.name}`);
  }
  // the audit the runner reads: an example that rested on `sorry` or an extra axiom would show here
  L.push('');
  for (const ex of examples) for (const f of ex.features) L.push(`#print axioms ${ex.name}.reach${f.id}_is_model_reach`);
  L.push('', 'end FeatureMap.Examples', '');
  return L.join('\n');
}

// { ok, detail, examples, failures } — the fixed examples against the real code, and the generated Lean
// file against the examples it must have been generated from
function examplesAgree({ file = EXAMPLES, leanFile = EXAMPLES_LEAN } = {}) {
  const examples = loadExamples(file);
  const failures = [];
  for (const ex of examples) {
    const { map, feats } = build(ex);
    for (const f of ex.features) {
      const reached = nums(C.reach(map, feats.find((x) => x.id === f.id).anchors).keys());
      if (!same(reached, f.reach)) failures.push(`${ex.name}/${f.id}: the code reaches [${reached}], the example says [${f.reach}]`);
      const r = F.retirement(map, feats, f.id);
      const exclusive = nums([...r.exclusive, ...r.named.map((n) => n.path)]);
      if (!same(exclusive, f.exclusive)) failures.push(`${ex.name}/${f.id}: the code lists [${exclusive}] as exclusive, the example says [${f.exclusive}]`);
    }
  }
  let lean = null;
  try { lean = fs.readFileSync(leanFile, 'utf8'); } catch (err) { lean = null; }
  if (lean !== toLean(examples)) failures.push(`${path.basename(leanFile)} is not what examples.json generates: the Lean side checks other numbers`);
  return {
    ok: !failures.length,
    examples: examples.length,
    failures,
    detail: failures.length ? failures[0] + (failures.length > 1 ? ` (and ${failures.length - 1} more)` : '') : `${examples.length} fixed graphs: the real reach and exclusive sets equal the written ones, and Examples.lean carries the same numbers`,
  };
}

module.exports = { retirePreservesReach, examplesAgree, toLean, loadExamples, build, without, randomGraph, checkGraph, EXAMPLES, EXAMPLES_LEAN, PROJECT };
