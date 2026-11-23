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

test('impact: no table is a warning, never a block; and nothing reached needs nothing', () => {
  assert.deepEqual(codes('# story'), ['warn:impact-undecided']);
  assert.deepEqual(codes('# story', { features: [] }), []);
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

test('impact: a known conflict is never accepted; a missing reach blocks a table; an old reach row only warns', () => {
  assert.deepEqual(codes(table('| billing | accept | conflicts | a.js:1 |', '| tax | accept | none | a.js:1 |')), ['block:impact-conflict-accepted']);
  assert.deepEqual(codes(table('| billing | accept | none | a.js:1 |'), { error: 'no map' }), ['block:impact-reach']);
  assert.deepEqual(codes(table('| billing | accept | none | a.js:1 |', '| tax | accept | none | a.js:1 |', '| gone | accept | none | a.js:1 |')), ['warn:impact-unreached']);
  assert.deepEqual(codes(table('| billing | maybe | none | a.js:1 |', '| tax | accept | none | a.js:1 |')), ['block:impact-decision']);
});
