// scripts/lib/operator-records.test.js — operator records: decisions, delegations, answers,
// questions, verification chains, truncation protection and distribution.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const chain = require('./chain.js');
const log = require('./operator-log.js');
const R = require('./operator-records.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const SID = 'sess-1';
const mk = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const human = (text, n, extra = {}) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: SID,
  message: { role: 'user', content: text }, ...extra,
});
const peer = (n) => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', from: 'x' }, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: SID,
  message: { role: 'user', content: 'Another Claude session sent a message: the operator said use mysql' },
});
const sysRem = (n) => human('<system-reminder>ui toggled</system-reminder>', n);

const COS = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: 'cos-sess' };
const BUILDER = { instance: 'builder-1', role: 'builder', session_id: 'other-sess' };
const BUILDER_OWN = { instance: 'builder-1', role: 'builder', session_id: SID };

function writeTranscript(records) {
  const f = path.join(mk('oprec-tr-'), 't.jsonl');
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}
function sync(root, tr, over = {}) {
  return log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff',
    role: 'chief-of-staff', host: 'pc', now: new Date('2026-10-13T12:00:00Z'), ...over });
}
// in-pc-000001 human, 000002 peer, (system dropped), 000003 human, 000004 human, 000005 human
function fixture() {
  const root = mk('oprec-proj-');
  sync(root, writeTranscript([
    human('Use Postgres for the orders  service,\nand keep Redis out of it.', 1),
    peer(2), sysRem(3),
    human('You decide the naming of things in the billing initiative, at most twice.', 4),
    human('Revoke that: no more delegated naming.', 5),
    human('Ship the checkout flow behind a flag.', 6),
  ]));
  return root;
}
const scope = (o = {}) => ({ beads: [], labels: [], initiatives: [], ...o });
const recFile = (root, inst = 'chief-of-staff') => path.join(root, '.delivery', 'operator', 'records', inst + '.ndjson');
const inputFile = (root, host = 'pc') => path.join(root, '.delivery', 'operator', 'inputs', host, '2026-10.ndjson');
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code || 'NOCODE:' + e.message; } return null; };

function decide(root, over = {}) {
  return R.recordDecision({ projectRoot: root, cite: 'in-pc-000001', quote: 'use postgres for the orders service',
    statement: 'Orders service uses Postgres', scope: scope({ beads: ['ex-1'], initiatives: ['orders'] }), by: COS, ...over });
}
function delegate(root, over = {}) {
  return R.recordDelegation({ projectRoot: root, cite: 'in-pc-000003', quote: 'You decide the naming of things',
    statement: 'CoS may decide naming within billing', scope: scope({ beads: ['ex-7', 'ex-8'], initiatives: ['billing'] }),
    limits: { until: null, max_uses: null }, by: COS, ...over });
}
// Append an entry through the chain library, bypassing every check (a misbehaving writer).
function forge(root, instance, entry) {
  return chain.appendEntry(recFile(root, instance), (last) => {
    const n = last ? Number(last.id.split('-').pop()) + 1 : 1;
    return { ts: new Date().toISOString(), scope: scope(), by: { instance, role: 'chief-of-staff', session_id: 'x' }, ...entry,
      id: `${entry.idprefix || 'dec'}-${instance}-${String(n).padStart(6, '0')}` };
  });
}
// Re-hash a whole NDJSON chain after an edit (a careful forger).
function rehash(file, edit) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  edit(lines);
  let prev = '0';
  const out = lines.map((e) => { e.prev = prev; delete e.hash; e.hash = chain.hashEntry(prev, e); prev = e.hash; return JSON.stringify(e); });
  fs.writeFileSync(file, out.join('\n') + '\n');
}

// ---- quote rules ----

test('normalizeWs collapses whitespace, NFKC and lowercases', () => {
  assert.strictEqual(R.normalizeWs('  Use\n\tPOSTGRES   now ﬁx '), 'use postgres now fix');
});

test('recordDecision stores a record citing the input, whitespace and case tolerant', () => {
  const root = fixture();
  const d = decide(root);
  assert.strictEqual(d.id, 'dec-chief-of-staff-000001');
  assert.strictEqual(d.kind, 'decision');
  assert.deepStrictEqual(d.cites, ['in-pc-000001']);
  assert.deepStrictEqual(d.scope, { beads: ['ex-1'], labels: [], initiatives: ['orders'] });
  assert.strictEqual(d.supersedes, null);
  assert.strictEqual(d.by.instance, 'chief-of-staff');
  assert.strictEqual(d.cites_head[0].id, 'in-pc-000001');
  assert.strictEqual(d.cites_head[0].host, 'pc');
  assert.strictEqual(d.cites_head[0].seq, 1);
  assert.strictEqual(d.cites_head[0].hash, log.getInput(root, 'in-pc-000001').hash);
  // a quote that spans the original line break and double space
  const d2 = decide(root, { quote: 'ORDERS service, and keep redis' });
  assert.strictEqual(d2.id, 'dec-chief-of-staff-000002');
  assert.deepStrictEqual(R.getRecord(root, d.id), d);
});

test('recordDecision refuses non-human, mismatched, short and empty input, and other sessions', () => {
  const root = fixture();
  assert.strictEqual(codeOf(() => decide(root, { cite: 'in-pc-000002', quote: 'use mysql' })), 'not_human');
  assert.strictEqual(codeOf(() => decide(root, { cite: 'in-pc-009999' })), 'not_found');
  assert.strictEqual(codeOf(() => decide(root, { quote: 'use mysql for orders' })), 'quote_mismatch');
  assert.strictEqual(codeOf(() => decide(root, { quote: 'us' })), 'quote_mismatch');
  assert.strictEqual(codeOf(() => decide(root, { statement: '  ' })), 'empty');
  assert.strictEqual(codeOf(() => decide(root, { by: BUILDER })), 'not_allowed');
  const ok = decide(root, { by: BUILDER_OWN });
  assert.strictEqual(ok.id, 'dec-builder-1-000001');
  assert.ok(fs.existsSync(recFile(root, 'builder-1')));
  assert.ok(fs.existsSync(recFile(root, 'chief-of-staff')) === false, 'each instance writes its own file only');
});

test('refusal messages end with the sanctioned path', () => {
  const root = fixture();
  let msg = '';
  try { decide(root, { cite: 'in-pc-000002', quote: 'use mysql' }); } catch (e) { msg = e.message; }
  assert.match(msg, /operator\.js (pending|show|find)/);
  assert.ok(R.OperatorError.prototype instanceof Error);
});

// ---- delegations ----

test('delegation rejects wildcards and empty scope; validates limits', () => {
  const root = fixture();
  assert.strictEqual(codeOf(() => delegate(root, { scope: scope({ beads: ['*'] }) })), 'invalid_scope');
  assert.strictEqual(codeOf(() => delegate(root, { scope: scope({ labels: ['x*'] }) })), 'invalid_scope');
  assert.strictEqual(codeOf(() => delegate(root, { scope: scope() })), 'invalid_scope');
  assert.strictEqual(codeOf(() => delegate(root, { limits: { until: 'soon', max_uses: null } })), 'invalid_limits');
  assert.strictEqual(codeOf(() => delegate(root, { limits: { until: null, max_uses: 0 } })), 'invalid_limits');
  assert.strictEqual(codeOf(() => delegate(root, { limits: { until: '2001-01-01', max_uses: null } })), 'invalid_limits');
  const d = delegate(root, { limits: { until: '2999-12-31', max_uses: 2 } });
  assert.strictEqual(d.id, 'del-chief-of-staff-000001');
  assert.strictEqual(d.limits.max_uses, 2);
  assert.strictEqual(d.limits.until, '2999-12-31T23:59:59.999Z');
});

test('decideUnder: inside scope ok; outside, expired, exhausted and revoked refused', () => {
  const root = fixture();
  const until = new Date(Date.now() + 3600e3).toISOString();
  const del = delegate(root, { limits: { until, max_uses: 2 } });
  const under = (over = {}) => R.decideUnder({ projectRoot: root, under: del.id, statement: 'Name it ledger-sync',
    scope: scope({ beads: ['ex-7'] }), by: COS, ...over });
  const d = under();
  assert.strictEqual(d.kind, 'decision');
  assert.deepStrictEqual(d.cites, [del.id]);
  assert.strictEqual(d.under, del.id);
  assert.strictEqual(codeOf(() => under({ scope: scope({ beads: ['ex-99'] }) })), 'scope_not_covered');
  assert.strictEqual(codeOf(() => under({ scope: scope() })), 'invalid_scope');
  assert.strictEqual(codeOf(() => under({ scope: scope({ beads: ['*'] }) })), 'invalid_scope');
  assert.strictEqual(codeOf(() => under({ now: new Date(Date.now() + 7200e3) })), 'expired');
  under({ statement: 'Name two' });
  assert.strictEqual(codeOf(() => under({ statement: 'Name three' })), 'max_uses_exceeded');
  assert.strictEqual(codeOf(() => R.decideUnder({ projectRoot: root, under: d.id, statement: 's', scope: scope({ beads: ['ex-7'] }), by: COS })), 'not_delegation');

  const del2 = delegate(root);
  R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'no more delegated naming', target: del2.id, by: COS });
  assert.strictEqual(codeOf(() => R.decideUnder({ projectRoot: root, under: del2.id, statement: 's', scope: scope({ beads: ['ex-7'] }), by: COS })), 'revoked');
});

test('revoke targets a delegation or decision, once, and later decisions are refused', () => {
  const root = fixture();
  const d = decide(root);
  const rev = R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'Revoke that', target: d.id, by: COS });
  assert.strictEqual(rev.kind, 'revocation');
  assert.strictEqual(rev.id, 'rev-chief-of-staff-000002');
  assert.strictEqual(codeOf(() => R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'Revoke that', target: d.id, by: COS })), 'already_revoked');
  assert.strictEqual(codeOf(() => R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'Revoke that', target: 'ans-x-000001', by: COS })), 'not_found');
  assert.strictEqual(codeOf(() => R.revoke({ projectRoot: root, cite: 'in-pc-000002', quote: 'use mysql', target: d.id, by: COS })), 'not_human');
});

// ---- verification ----

test('verify walks a decision to the input and ends with its verbatim text', () => {
  const root = fixture();
  const d = decide(root);
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.deepStrictEqual(v.chain.map((h) => h.id), [d.id, 'in-pc-000001']);
  const last = v.chain[v.chain.length - 1];
  assert.strictEqual(last.text, 'Use Postgres for the orders  service,\nand keep Redis out of it.');
  assert.strictEqual(v.chain[0].quote, 'use postgres for the orders service');
  assert.strictEqual(v.heads, 'recorded');
});

test('verify walks decision to delegation to input', () => {
  const root = fixture();
  const del = delegate(root);
  const d = R.decideUnder({ projectRoot: root, under: del.id, statement: 'Name it x', scope: scope({ beads: ['ex-7'] }), by: COS });
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.deepStrictEqual(v.chain.map((h) => h.id), [d.id, del.id, 'in-pc-000003']);
  assert.match(v.chain[2].text, /^You decide the naming/);
});

test('tampering with an input text fails verify and names the host and position', () => {
  const root = fixture();
  const d = decide(root);
  const f = inputFile(root);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const e = JSON.parse(lines[0]);
  e.text = e.text.replace('Postgres', 'MySQL');
  lines[0] = JSON.stringify(e);
  fs.writeFileSync(f, lines.join('\n'));
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /host pc/);
  assert.match(v.error, /line 1/);
});

test('tampering with a record statement fails verify with the position', () => {
  const root = fixture();
  decide(root);
  const d2 = decide(root, { statement: 'second' });
  const f = recFile(root);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const e = JSON.parse(lines[0]);
  e.statement = 'Orders service uses MySQL';
  lines[0] = JSON.stringify(e);
  fs.writeFileSync(f, lines.join('\n'));
  const v = R.verifyRecord(root, d2.id);
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /records\/chief-of-staff/);
  assert.match(v.error, /line 1/);
});

test('a whole forged input chain (re-hashed) is caught by the cited hash', () => {
  const root = fixture();
  const d = decide(root);
  rehash(inputFile(root), (lines) => {
    lines[0].text = 'Use Postgres for the orders service, and keep Redis out of it. And also MongoDB.';
    lines[0].text_sha256 = require('crypto').createHash('sha256').update(lines[0].text).digest('hex');
  });
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'history_rewritten');
});

test('deleting the cited input last line fails verify of the record that cites it', () => {
  const root = fixture();
  const d = decide(root, { cite: 'in-pc-000005', quote: 'behind a flag' });
  assert.strictEqual(R.verifyRecord(root, d.id).ok, true);
  const f = inputFile(root);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  // in-pc-000005 is the 5th stored entry; stored entries: 1,2,3(=000003 human),4,5 -> keep all but the cited
  const idx = lines.findIndex((l) => JSON.parse(l).id === 'in-pc-000005');
  fs.writeFileSync(f, lines.slice(0, idx).join('\n') + '\n');
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'cited_entry_missing');
});

test('deleting the last record line is detected through the records head', () => {
  const root = fixture();
  const a = decide(root);
  decide(root, { statement: 'second' });
  const f = recFile(root);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(f, lines[0] + '\n');
  const v = R.verifyRecord(root, a.id);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'truncated');
  assert.match(v.error, /chief-of-staff/);
  const heads = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'operator', 'cursors', 'heads.json'), 'utf8'));
  assert.strictEqual(heads['records/chief-of-staff'].count, 2, 'a failed verify never lowers a head');
});

test('heads are reported as absent when heads.json lost the entry and then recorded', () => {
  const root = fixture();
  const d = decide(root);
  fs.rmSync(path.join(root, '.delivery', 'operator', 'cursors', 'heads.json'));
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.heads, 'absent');
  assert.ok(v.chains.every((c) => c.heads === 'absent'));
  assert.strictEqual(R.verifyRecord(root, d.id).heads, 'recorded');
});

test('at-time checks: a decision made after revocation, expiry or beyond max_uses fails verify', () => {
  const root = fixture();
  const until = new Date(Date.now() + 3600e3).toISOString();
  const del = delegate(root, { limits: { until, max_uses: 1 } });
  const head = (rec) => [{ id: rec.id, hash: rec.hash }];
  const under = (extra = {}) => forge(root, 'chief-of-staff', { kind: 'decision', statement: 's', quote: null,
    cites: [del.id], under: del.id, scope: scope({ beads: ['ex-7'] }), cites_head: head(del), supersedes: null, ...extra });
  const first = under();
  assert.strictEqual(R.verifyRecord(root, first.id).ok, true, JSON.stringify(R.verifyRecord(root, first.id)));
  const second = under();
  const v2 = R.verifyRecord(root, second.id);
  assert.strictEqual(v2.ok, false);
  assert.strictEqual(v2.code, 'max_uses_exceeded');
  const late = under({ ts: new Date(Date.now() + 7200e3).toISOString() });
  assert.strictEqual(R.verifyRecord(root, late.id).code, 'expired');
  const outside = under({ scope: scope({ beads: ['ex-99'] }) });
  assert.strictEqual(R.verifyRecord(root, outside.id).code, 'scope_not_covered');
});

test('a decision made before a revocation still verifies and the path shows the revocation', () => {
  const root = fixture();
  const del = delegate(root);
  const d = R.decideUnder({ projectRoot: root, under: del.id, statement: 'Name it x', scope: scope({ beads: ['ex-7'] }), by: COS });
  R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'no more delegated naming', target: del.id, by: COS });
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.ok(v.notes.some((n) => /revoked/.test(n) && n.includes(del.id)), JSON.stringify(v.notes));
});

test('a revocation made before the decision (forged order) fails verify', () => {
  const root = fixture();
  const del = delegate(root);
  R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'no more delegated naming', target: del.id, by: COS });
  const d = forge(root, 'chief-of-staff', { kind: 'decision', statement: 's', cites: [del.id], under: del.id,
    scope: scope({ beads: ['ex-7'] }), cites_head: [{ id: del.id, hash: del.hash }], supersedes: null });
  const v = R.verifyRecord(root, d.id);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'revoked');
});

test('verifyRecord of an unknown id fails with not_found; of an input verifies its host chain', () => {
  const root = fixture();
  assert.strictEqual(R.verifyRecord(root, 'dec-chief-of-staff-000042').code, 'not_found');
  const v = R.verifyRecord(root, 'in-pc-000001');
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.chain[0].id, 'in-pc-000001');
});

// ---- answers ----

function answer(root, over = {}) {
  return R.recordAnswer({ projectRoot: root, cites: [over.__d || 'dec-chief-of-staff-000001'], question: 'Which database does orders use?',
    answer: 'Postgres, per the operator.', confidence: 'settled', scope: scope({ beads: ['ex-1'] }), by: COS, ...over });
}

test('answer settled inside the cited scope is accepted; outside is scope_not_covered; empty scope allowed', () => {
  const root = fixture();
  decide(root);
  const a = answer(root);
  assert.strictEqual(a.id, 'ans-chief-of-staff-000002');
  assert.strictEqual(a.kind, 'answer');
  assert.strictEqual(a.confidence, 'settled');
  assert.strictEqual(codeOf(() => answer(root, { scope: scope({ beads: ['ex-2'] }) })), 'scope_not_covered');
  assert.strictEqual(codeOf(() => answer(root, { scope: scope({ labels: ['security'] }) })), 'scope_not_covered');
  assert.ok(answer(root, { scope: scope() }));
});

test('answer: only the chief of staff; question and answer non-empty; cites must exist', () => {
  const root = fixture();
  decide(root);
  assert.strictEqual(codeOf(() => answer(root, { by: { ...BUILDER, session_id: SID } })), 'not_allowed');
  assert.strictEqual(codeOf(() => answer(root, { question: '' })), 'empty');
  assert.strictEqual(codeOf(() => answer(root, { answer: ' ' })), 'empty');
  assert.strictEqual(codeOf(() => answer(root, { cites: [] })), 'empty');
  assert.strictEqual(codeOf(() => answer(root, { cites: ['dec-chief-of-staff-000099'] })), 'not_found');
  assert.strictEqual(codeOf(() => answer(root, { cites: ['in-pc-000001'] })), 'invalid_cite');
  assert.strictEqual(codeOf(() => answer(root, { confidence: 'sure' })), 'invalid_confidence');
});

test('inferred needs a rationale of 20+ characters, starts unratified, and is listed pending', () => {
  const root = fixture();
  decide(root);
  assert.strictEqual(codeOf(() => answer(root, { confidence: 'inferred' })), 'rationale_required');
  assert.strictEqual(codeOf(() => answer(root, { confidence: 'inferred', rationale: 'too short' })), 'rationale_required');
  const a = answer(root, { confidence: 'inferred', scope: scope({ beads: ['ex-2'] }),
    rationale: 'Same service family as ex-1, reversible config choice.' });
  assert.strictEqual(a.ratified, null);
  const p = R.pending(root, {});
  assert.deepStrictEqual(p.unratified_answers.map((x) => x.id), [a.id]);
});

test('ratify removes an inferred answer from unratified_answers; only inferred answers are targets', () => {
  const root = fixture();
  const d = decide(root);
  const settled = answer(root);
  const inf = answer(root, { confidence: 'inferred', scope: scope({ beads: ['ex-2'] }),
    rationale: 'Same service family as ex-1, reversible config choice.' });
  assert.strictEqual(codeOf(() => R.ratify({ projectRoot: root, cite: 'in-pc-000005', quote: 'behind a flag', target: settled.id, by: COS })), 'not_inferred');
  assert.strictEqual(codeOf(() => R.ratify({ projectRoot: root, cite: 'in-pc-000005', quote: 'nope nope', target: inf.id, by: COS })), 'quote_mismatch');
  assert.strictEqual(codeOf(() => R.ratify({ projectRoot: root, cite: 'in-pc-000005', quote: 'behind a flag', target: d.id, by: COS })), 'not_inferred');
  const r = R.ratify({ projectRoot: root, cite: 'in-pc-000005', quote: 'behind a flag', target: inf.id, by: COS });
  assert.strictEqual(r.kind, 'ratification');
  assert.match(r.id, /^rat-chief-of-staff-\d{6}$/);
  assert.deepStrictEqual(R.pending(root, {}).unratified_answers, []);
  assert.strictEqual(codeOf(() => R.ratify({ projectRoot: root, cite: 'in-pc-000005', quote: 'behind a flag', target: inf.id, by: COS })), 'already_ratified');
  const v = R.verifyRecord(root, r.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
});

test('verify of an answer prints answer, decision, input; fails when an upstream input is tampered', () => {
  const root = fixture();
  decide(root);
  const a = answer(root);
  const v = R.verifyRecord(root, a.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.deepStrictEqual(v.chain.map((h) => h.id), [a.id, 'dec-chief-of-staff-000001', 'in-pc-000001']);
  assert.strictEqual(v.chain[0].confidence, 'settled');
  assert.match(v.chain[2].text, /Use Postgres/);
  const f = inputFile(root);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Postgres', 'Mongres'));
  const bad = R.verifyRecord(root, a.id);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /host pc/);
});

test('answers cannot cite revoked or superseded records; settled cannot rest on an unratified inference', () => {
  const root = fixture();
  const d1 = decide(root);
  const d2 = decide(root, { statement: 'Orders uses Postgres 16', supersedes: d1.id });
  assert.strictEqual(codeOf(() => answer(root, { cites: [d1.id] })), 'superseded');
  const del = delegate(root);
  R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'no more delegated naming', target: del.id, by: COS });
  assert.strictEqual(codeOf(() => answer(root, { cites: [del.id], scope: scope() })), 'revoked');
  const inf = answer(root, { cites: [d2.id], confidence: 'inferred', scope: scope({ beads: ['ex-2'] }),
    rationale: 'Same service family as ex-1, reversible config choice.' });
  assert.strictEqual(codeOf(() => answer(root, { cites: [inf.id], scope: scope() })), 'not_settled');
  assert.ok(answer(root, { cites: [inf.id], scope: scope(), confidence: 'inferred', rationale: 'Builds on the earlier inference, still reversible.' }));
});

test('supersession after the fact: the older answer still verifies and the path notes it', () => {
  const root = fixture();
  const d1 = decide(root);
  const a = answer(root, { cites: [d1.id] });
  decide(root, { statement: 'Orders uses Postgres 16', supersedes: d1.id });
  const v = R.verifyRecord(root, a.id);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.ok(v.notes.some((n) => /superseded/.test(n) && n.includes(d1.id)), JSON.stringify(v.notes));
});

test('supersession rules: target must exist, once; an answer cannot supersede a decision', () => {
  const root = fixture();
  const d1 = decide(root);
  assert.strictEqual(codeOf(() => decide(root, { supersedes: 'dec-chief-of-staff-000099' })), 'not_found');
  const a = answer(root);
  assert.strictEqual(codeOf(() => answer(root, { supersedes: d1.id })), 'supersede_not_allowed');
  decide(root, { statement: 'v2', supersedes: d1.id });
  assert.strictEqual(codeOf(() => decide(root, { statement: 'v3', supersedes: d1.id })), 'already_superseded');
  assert.ok(answer(root, { cites: ['dec-chief-of-staff-000003'], supersedes: a.id }));
});

// ---- find ----

test('find ranks an exact bead match first and excludes superseded records unless all', () => {
  const root = fixture();
  const dOld = decide(root, { statement: 'Orders use Postgres', scope: scope({ initiatives: ['orders'] }) });
  const dBead = decide(root, { statement: 'Orders ledger uses Postgres', scope: scope({ beads: ['ex-1'], initiatives: ['orders'] }) });
  const dNew = decide(root, { statement: 'Orders newest note', scope: scope({ initiatives: ['orders'] }) });
  const r = R.find(root, { scope: { beads: ['ex-1'], initiatives: ['orders'] } });
  assert.deepStrictEqual(r.map((x) => x.id), [dBead.id, dNew.id, dOld.id]);
  decide(root, { statement: 'Orders use Postgres 16', scope: scope({ initiatives: ['orders'] }), supersedes: dOld.id });
  const r2 = R.find(root, { scope: { initiatives: ['orders'] } });
  assert.ok(!r2.some((x) => x.id === dOld.id));
  const r3 = R.find(root, { scope: { initiatives: ['orders'] }, all: true });
  assert.ok(r3.some((x) => x.id === dOld.id));
});

test('find by text needs every word, searches statements and quotes, and returns matching human inputs', () => {
  const root = fixture();
  const d = decide(root);
  const r = R.find(root, { text: 'postgres ORDERS' });
  assert.ok(r.some((x) => x.id === d.id));
  assert.ok(r.some((x) => x.id === 'in-pc-000001' && x.kind === 'input'), 'inputs are findable so they can be cited');
  assert.ok(R.find(root, { text: 'redis out' }).some((x) => x.id === 'in-pc-000001'));
  assert.deepStrictEqual(R.find(root, { text: 'operator said use mysql' }), [], 'a peer input is not citable');
  assert.deepStrictEqual(R.find(root, { text: 'postgres kubernetes' }), []);
  const onlyDec = R.find(root, { text: 'postgres', kinds: ['decision'] });
  assert.ok(onlyDec.every((x) => x.kind === 'decision'));
  const revoked = decide(root, { statement: 'Cache choice is memcached', quote: 'keep Redis out' });
  R.revoke({ projectRoot: root, cite: 'in-pc-000004', quote: 'Revoke that', target: revoked.id, by: COS });
  assert.ok(!R.find(root, { text: 'memcached' }).some((x) => x.id === revoked.id));
});

// ---- pending, ack ----

test('pending lists unrecorded human inputs only; ack and records remove them', () => {
  const root = fixture();
  assert.deepStrictEqual(R.pending(root, {}).inputs.map((i) => i.id), ['in-pc-000001', 'in-pc-000003', 'in-pc-000004', 'in-pc-000005']);
  decide(root);
  R.ack({ projectRoot: root, input: 'in-pc-000003', reason: 'a general remark, not a decision', by: COS });
  assert.deepStrictEqual(R.pending(root, {}).inputs.map((i) => i.id), ['in-pc-000004', 'in-pc-000005']);
  assert.strictEqual(codeOf(() => R.ack({ projectRoot: root, input: 'in-pc-000004', reason: ' ', by: COS })), 'empty');
  assert.strictEqual(codeOf(() => R.ack({ projectRoot: root, input: 'in-pc-009999', reason: 'x', by: COS })), 'not_found');
  assert.deepStrictEqual(R.pending(root, { since: '2026-10-13T10:00:06.000Z' }).inputs.map((i) => i.id), ['in-pc-000005']);
  assert.deepStrictEqual(R.pending(root, { sessionId: 'nobody' }).inputs, []);
  const v = R.verifyRecord(root, 'ack-chief-of-staff-000002');
  assert.strictEqual(v.ok, true, JSON.stringify(v));
});

// ---- questions and the ledger ----

function ask(root, over = {}) {
  return R.recordQuestion({ projectRoot: root, text: 'Which database should orders use?',
    asker: { instance: 'builder-1', role: 'builder', bead: 'ex-1' }, scope: scope({ beads: ['ex-1'] }),
    options: ['Postgres', 'MySQL'], recommendation: 'Postgres', by: COS, ...over });
}

test('questions: chief of staff only; status derives from answering records and withdrawals', () => {
  const root = fixture();
  assert.strictEqual(codeOf(() => ask(root, { by: BUILDER })), 'not_allowed');
  assert.strictEqual(codeOf(() => ask(root, { text: ' ' })), 'empty');
  const q = ask(root);
  assert.strictEqual(q.id, 'q-chief-of-staff-000001');
  assert.strictEqual(q.status, undefined, 'status is derived, not stored');
  assert.strictEqual(R.ledger(root, {})[0].status, 'open');
  assert.deepStrictEqual(R.pending(root, {}).open_questions.map((x) => x.id), [q.id]);
  const d = decide(root, { answers: [q.id] });
  assert.deepStrictEqual(d.answers, [q.id]);
  assert.strictEqual(R.ledger(root, {})[0].status, 'answered');
  assert.deepStrictEqual(R.pending(root, {}).open_questions, []);
  const q2 = ask(root, { text: 'Retire the old queue?' });
  assert.strictEqual(codeOf(() => R.withdraw({ projectRoot: root, question: q2.id, reason: ' ', by: COS })), 'empty');
  const w = R.withdraw({ projectRoot: root, question: q2.id, reason: 'the worker found it in the docs', by: COS });
  assert.match(w.id, /^wd-chief-of-staff-/);
  assert.strictEqual(R.ledger(root, { status: 'withdrawn' })[0].question.id, q2.id);
  assert.strictEqual(codeOf(() => decide(root, { answers: [q2.id] })), 'question_withdrawn');
  assert.strictEqual(codeOf(() => decide(root, { answers: ['q-chief-of-staff-000099'] })), 'not_found');
  assert.strictEqual(codeOf(() => R.withdraw({ projectRoot: root, question: q.id, reason: 'x y z', by: COS })), 'not_open');
});

test('a decision answering a scoped question must overlap its scope; answering twice keeps history', () => {
  const root = fixture();
  const q = ask(root);
  assert.strictEqual(codeOf(() => decide(root, { answers: [q.id], scope: scope({ beads: ['ex-5'] }) })), 'scope_mismatch');
  assert.strictEqual(codeOf(() => decide(root, { answers: [q.id], scope: scope() })), 'scope_mismatch');
  const d1 = decide(root, { answers: [q.id] });
  const a = answer(root, { cites: [d1.id], answers: [q.id] });
  const row = R.ledger(root, {})[0];
  assert.deepStrictEqual(row.answers.map((x) => x.id), [d1.id, a.id]);
  assert.strictEqual(row.answers[0].quote, 'use postgres for the orders service');
  assert.strictEqual(row.answers[1].quote, 'use postgres for the orders service', 'answers resolve to the human words through their cites');
  assert.strictEqual(row.answers[1].confidence, 'settled');
  assert.strictEqual(row.answers[0].input, 'in-pc-000001');
});

test('ledger filters by bead, status and since; rows carry asker and asked_at', () => {
  const root = fixture();
  const q1 = ask(root);
  ask(root, { text: 'Another thing?', asker: { instance: 'chief-of-staff', role: 'chief-of-staff', bead: 'ex-9' }, scope: scope({ beads: ['ex-9'] }) });
  assert.strictEqual(R.ledger(root, {}).length, 2);
  assert.deepStrictEqual(R.ledger(root, { bead: 'ex-9' }).map((r) => r.question.text), ['Another thing?']);
  const row = R.ledger(root, { bead: 'ex-1' })[0];
  assert.strictEqual(row.question.id, q1.id);
  assert.strictEqual(row.asker.instance, 'builder-1');
  assert.ok(row.asked_at);
  assert.deepStrictEqual(R.ledger(root, { since: new Date(Date.now() + 1e6).toISOString() }), []);
});

test('renderLedger lists open questions first, quotes the operator verbatim, and LEDGER.md follows writes', () => {
  const root = fixture();
  const qa = ask(root);
  const qb = ask(root, { text: 'Retire the old queue?', scope: scope({ beads: ['ex-3'] }), asker: { instance: 'chief-of-staff', role: 'chief-of-staff', bead: 'ex-3' } });
  decide(root, { answers: [qa.id] });
  const md = R.renderLedger(root);
  assert.match(md, /generated: do not edit/);
  const iOpen = md.indexOf(qb.id);
  const iAnswered = md.indexOf(qa.id);
  assert.ok(iOpen > -1 && iAnswered > -1 && iOpen < iAnswered, 'open question before the answered one');
  assert.match(md, /"use postgres for the orders service"/);
  assert.match(md, /Which database should orders use\?/);
  assert.match(md, /settled|decision/);
  const onDisk = fs.readFileSync(path.join(root, '.delivery', 'operator', 'LEDGER.md'), 'utf8');
  assert.strictEqual(onDisk, md);
});

test('verify of question, withdrawal and ack records checks only their chains', () => {
  const root = fixture();
  const q = ask(root);
  const w = R.withdraw({ projectRoot: root, question: q.id, reason: 'not needed anymore', by: COS });
  assert.strictEqual(R.verifyRecord(root, q.id).ok, true);
  assert.strictEqual(R.verifyRecord(root, w.id).ok, true);
});

test('listRecords reads every instance file', () => {
  const root = fixture();
  decide(root);
  decide(root, { by: BUILDER_OWN });
  assert.deepStrictEqual(R.listRecords(root).map((r) => r.id).sort(), ['dec-builder-1-000001', 'dec-chief-of-staff-000001']);
});

test('writing refuses to extend a chain that no longer verifies', () => {
  const root = fixture();
  decide(root);
  const f = recFile(root);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Orders service', 'Orders services'));
  assert.strictEqual(codeOf(() => decide(root, { statement: 'x' })), 'chain_invalid');
});

// ---- distribution ----

function git(cwd, ...args) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function twoHosts() {
  const base = mk('oprec-git-');
  const bare = path.join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', bare);
  const seed = path.join(base, 'seed');
  git(base, 'clone', bare, seed);
  for (const [k, v] of [['user.email', 's@example.test'], ['user.name', 'Seed'], ['commit.gpgsign', 'false']]) git(seed, 'config', k, v);
  fs.writeFileSync(path.join(seed, 'README.md'), 'project\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'init');
  git(seed, 'push', '-u', 'origin', 'HEAD:main');
  const clones = {};
  for (const host of ['hosta', 'hostb']) {
    const dir = path.join(base, host);
    git(base, 'clone', bare, dir);
    for (const [k, v] of [['user.email', host + '@example.test'], ['user.name', host], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
    clones[host] = dir;
  }
  return clones;
}
const refresher = (root, host, instance) => () => log.refresh(root, { host, instance });

test('a record written on host A verifies on host B through the automatic refresh', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, writeTranscript([human('Use Postgres for the orders service.', 1)]), { host: 'hosta' });
  const d = R.recordDecision({ projectRoot: hosta, cite: 'in-hosta-000001', quote: 'use postgres', statement: 'Postgres',
    scope: scope({ beads: ['ex-1'] }), by: COS });
  const pub = log.publish(hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' });
  assert.strictEqual(pub.published, true, JSON.stringify(pub));
  // B has not pulled: the record is missing locally, verify refreshes once and retries
  assert.strictEqual(R.getRecord(hostb, d.id), null);
  let calls = 0;
  const v = R.verifyRecord(hostb, d.id, { refresh: () => { calls++; return log.refresh(hostb, { host: 'hostb', instance: 'pm-b' }); } });
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(v.chain.map((h) => h.id), [d.id, 'in-hosta-000001']);
  assert.strictEqual(v.heads, 'absent', 'chains first seen on this host are trusted on first use');
});

test('B records into its own chain file concurrently; both publish without conflict and both verify', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, writeTranscript([human('Use Postgres for the orders service.', 1)]), { host: 'hosta', sessionId: 'sa' });
  sync(hostb, writeTranscript([human('Ship it behind a flag please.', 2)]), { host: 'hostb', sessionId: 'sb', instance: 'pm-b', role: 'product-manager' });
  const da = R.recordDecision({ projectRoot: hosta, cite: 'in-hosta-000001', quote: 'use postgres', statement: 'Postgres', scope: scope({ beads: ['ex-1'] }), by: COS });
  const db = R.recordDecision({ projectRoot: hostb, cite: 'in-hostb-000001', quote: 'behind a flag', statement: 'Flagged',
    scope: scope({ beads: ['ex-2'] }), by: { instance: 'pm-b', role: 'product-manager', session_id: SID } });
  assert.strictEqual(da.id, 'dec-chief-of-staff-000001');
  assert.strictEqual(db.id, 'dec-pm-b-000001');
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' }).published, true);
  const pb = log.publish(hostb, { force: true, host: 'hostb', instance: 'pm-b' });
  assert.strictEqual(pb.published, true, JSON.stringify(pb));
  assert.strictEqual(log.refresh(hosta, { host: 'hosta', instance: 'chief-of-staff' }).ok, true);
  for (const [root, host, inst] of [[hosta, 'hosta', 'chief-of-staff'], [hostb, 'hostb', 'pm-b']]) {
    log.refresh(root, { host, instance: inst });
    assert.strictEqual(R.verifyRecord(root, da.id).ok, true);
    assert.strictEqual(R.verifyRecord(root, db.id).ok, true);
    assert.deepStrictEqual(R.listRecords(root).map((r) => r.id).sort(), [da.id, db.id].sort());
  }
  const dirty = git(hosta, 'status', '--porcelain').split('\n').filter((l) => l && !l.includes('.delivery/operator'));
  assert.deepStrictEqual(dirty, []);
});

test('a record citing an input from a host whose chain file fails verification fails naming that host', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, writeTranscript([human('Use Postgres for the orders service.', 1), human('Second remark here.', 2)]), { host: 'hosta' });
  const d = R.recordDecision({ projectRoot: hosta, cite: 'in-hosta-000001', quote: 'use postgres', statement: 'Postgres', scope: scope({ beads: ['ex-1'] }), by: COS });
  log.publish(hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' });
  const rf = refresher(hostb, 'hostb', 'pm-b');
  assert.strictEqual(R.verifyRecord(hostb, d.id, { refresh: rf }).ok, true);
  const f = path.join(hostb, '.delivery', 'operator', 'inputs', 'hosta', '2026-10.ndjson');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const e = JSON.parse(lines[1]);
  e.text = 'Second remark, edited.';
  lines[1] = JSON.stringify(e);
  fs.writeFileSync(f, lines.join('\n'));
  const v = R.verifyRecord(hostb, d.id, { refresh: rf });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /host hosta/);
});

test('publish includes the records file and LEDGER.md, and survives a rejected push', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, writeTranscript([human('Use Postgres for the orders service.', 1)]), { host: 'hosta', sessionId: 'sa' });
  sync(hostb, writeTranscript([human('Ship it behind a flag please.', 2)]), { host: 'hostb', sessionId: 'sb' });
  R.recordQuestion({ projectRoot: hosta, text: 'Which database?', asker: { instance: 'chief-of-staff', role: 'chief-of-staff', bead: null }, scope: scope(), by: COS });
  R.recordQuestion({ projectRoot: hostb, text: 'Which flag?', asker: { instance: 'pm-b', role: 'chief-of-staff', bead: null }, scope: scope(),
    by: { instance: 'pm-b', role: 'chief-of-staff', session_id: 'sb' } });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' }).published, true);
  // both wrote a different LEDGER.md; B's push is rejected, the derived ledger conflict heals, push succeeds
  const pb = log.publish(hostb, { force: true, host: 'hostb', instance: 'pm-b' });
  assert.strictEqual(pb.published, true, JSON.stringify(pb));
  const tracked = git(hostb, 'ls-files', '.delivery/operator');
  assert.match(tracked, /records\/pm-b\.ndjson/);
  assert.match(tracked, /records\/chief-of-staff\.ndjson/);
  assert.match(tracked, /LEDGER\.md/);
  assert.ok(!/cursors/.test(tracked));
});
