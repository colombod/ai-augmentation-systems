// scripts/impact-decisions.test.js — the Impact decisions table against what a story reaches.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ID = require('./lib/impact-decisions.js');

const reach = { features: [{ id: 'billing', hops: 0 }, { id: 'tax', hops: 1 }] };
const table = (...rows) => `## Impact decisions\n\n| Feature | Decision | Relation | Evidence |\n| - | - | - | - |\n${rows.join('\n')}\n\n## Next\n`;
const ok = (rid) => ({ ok: /^dec-/.test(rid), why: `${rid} does not verify` });
const codes = (text, r = reach, extra = {}) => ID.check({ text, reach: r, root: os.tmpdir(), ownerRecord: ok, ...extra }).map((f) => `${f.level}:${f.code}`);

test('impact: no table blocks a story that reaches features; unknown reach warns; nothing reached needs nothing', () => {
  assert.deepEqual(codes('# story'), ['block:impact-undecided']);
  assert.match(ID.check({ text: '# story', reach, root: os.tmpdir() })[0].detail, /billing, tax are reached/);
  assert.deepEqual(codes('# story', { error: 'no map' }), ['warn:impact-undecided']);
  assert.deepEqual(codes('# story', { features: [] }), []);
});

test('impact: the share of live features is said, and 50% or more is a warning for the owner', () => {
  const of = (n, total) => ID.share({ features: [], live: { reached: ['a', 'b', 'c'].slice(0, n), total } });
  assert.equal(of(1, 3).line, 'Impact: 1/3 live features affected: a');
  assert.deepEqual(of(1, 3).findings, []);
  assert.equal(of(0, 2).line, 'Impact: 0/2 live features affected');
  for (const [n, total] of [[1, 2], [2, 3], [3, 3]]) assert.deepEqual(of(n, total).findings.map((f) => `${f.level}:${f.code}`), ['warn:impact-large'], `${n}/${total}`);
  assert.match(of(1, 2).findings[0].detail, /1\/2 live features affected: a\. That is 50% or more: the owner decides/);
  assert.match(of(0, 0).line, /no live feature is declared/);
  assert.deepEqual(of(0, 0).findings, []);
  assert.deepEqual(ID.share({ error: 'no map' }), { line: '', findings: [] });
});

test('impact: every reached feature needs one decision with evidence', () => {
  assert.deepEqual(codes(table('| billing | accept | extends | src/bill.js:12 reads only |', '| tax | accept | none | src/tax.js:3 untouched |')), []);
  assert.deepEqual(codes(table('| billing | accept | extends | src/bill.js:12 |')), ['block:impact-missing']);
  assert.deepEqual(codes(table('| billing, tax | accept | none | src/x.js:1 |')), []);
  assert.deepEqual(codes(table('| billing | accept | none | src/x.js:1 |', '| billing | accept | none | src/x.js:1 |', '| tax | accept | none | a.js:1 |')), ['block:impact-duplicate']);
});

test('impact: evidence must resolve: accept needs file:line, decommission an owner record, guard a real property or test', () => {
  assert.deepEqual(codes(table('| billing | accept | none | looked fine |', '| tax | accept | none | a.js:1 |')), ['block:impact-evidence']);
  assert.deepEqual(codes(table('| billing | decommission | supersedes | dec-owner-1 |', '| tax | accept | none | a.js:1 |')), []);
  assert.deepEqual(codes(table('| billing | decommission | supersedes | the team agreed |', '| tax | accept | none | a.js:1 |')), ['block:impact-evidence']);
  assert.deepEqual(codes(table('| billing | guard | extends | tests/missing.test.js |', '| tax | accept | none | a.js:1 |')), ['block:impact-evidence']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-'));
  fs.writeFileSync(path.join(root, 'bill.test.js'), '');
  assert.deepEqual(codes(table('| billing | guard | extends | bill.test.js |', '| tax | accept | none | a.js:1 |'), reach, { root }), []);
});

test('impact: a feature id with spaces, or starting with "feature", can be decided', () => {
  const r = { features: [{ id: 'User login', hops: 0 }, { id: 'feature-dev:go', hops: 1 }, { id: 'features', hops: 1 }] };
  const rows = (first) => table(`| ${first} | accept | none | a.js:1 |`, '| feature-dev:go | accept | none | a.js:1 |', '| features | accept | none | a.js:1 |');
  assert.deepEqual(codes(rows('User login'), r), []);
  assert.deepEqual(codes(rows('`User login`'), r), []);
  assert.deepEqual(codes(table('| User login, feature-dev:go features | accept | none | a.js:1 |'), r), []);
  assert.deepEqual(codes(table('| `User login`, `feature-dev:go`, features | accept | none | a.js:1 |'), r), []);
  // an id that is no longer reached stays one id when backticked
  assert.deepEqual(codes(table('| `Old thing` | guard | none | P-none |'), { features: [] }, { storyText: '' }).filter((c) => c.includes('shared-row')), []);
  assert.deepEqual(codes(table('| Feature(s) | Decision | Relation | Evidence |'), { features: [] }), []);
});

test('impact: a known conflict is never accepted; a missing reach blocks a table; an old reach row only warns', () => {
  assert.deepEqual(codes(table('| billing | accept | conflicts | a.js:1 |', '| tax | accept | none | a.js:1 |')), ['block:impact-conflict-accepted']);
  assert.deepEqual(codes(table('| billing | accept | none | a.js:1 |'), { error: 'no map' }), ['block:impact-reach']);
  assert.deepEqual(codes(table('| billing | accept | none | a.js:1 |', '| tax | accept | none | a.js:1 |', '| gone | accept | none | a.js:1 |')), ['warn:impact-unreached']);
  assert.deepEqual(codes(table('| billing | maybe | none | a.js:1 |', '| tax | accept | none | a.js:1 |')), ['block:impact-decision']);
});
