// scripts/lib/operator-records.js — operator decision records and their verification.
//
// One hash chain per author instance: .delivery/operator/records/<instance>.ndjson, single writer,
// so git never merges a chain. Ids embed the instance (dec-<instance>-000012); inputs embed the host
// (in-<host>-000007). Every record stores `cites_head` (the hash of each cited entry at citation
// time) so a cited entry that is later removed or rewritten, anywhere, makes verify fail.
//
// Every function takes projectRoot first. Functions that can meet an id they do not hold locally
// accept `refresh` (a function): it is called at most once per call, when a cited id or file is
// missing, and the lookup is retried.
const fs = require('fs');
const path = require('path');
const chain = require('./chain.js');
const log = require('./operator-log.js');

class OperatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OperatorError';
    this.code = code;
  }
}

const PREFIX_KIND = { dec: 'decision', del: 'delegation', ans: 'answer', q: 'question', rev: 'revocation', rat: 'ratification', ack: 'ack', wd: 'withdrawal' };
const KIND_PREFIX = Object.fromEntries(Object.entries(PREFIX_KIND).map(([p, k]) => [k, p]));
const SCOPE_KEYS = ['beads', 'labels', 'initiatives'];
const MIN_QUOTE = 3;
const MIN_RATIONALE = 20;
const MAX_DEPTH = 25;
const INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const pad = (n) => String(n).padStart(6, '0');
const recordsDir = (root) => path.join(log.opDir(root), 'records');
const recordsFile = (root, instance) => path.join(recordsDir(root), `${instance}.ndjson`);
const ledgerFile = (root) => path.join(log.opDir(root), 'LEDGER.md');

function parseRecordId(id) {
  const m = /^(dec|del|ans|q|rev|rat|ack|wd)-(.+)-(\d{6,})$/.exec(String(id || ''));
  if (!m) return null;
  return { prefix: m[1], kind: PREFIX_KIND[m[1]], instance: m[2], seq: Number(m[3]) };
}

function normalizeWs(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function readEntries(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o && typeof o === 'object') out.push(o); } catch (e) { /* verify reports it */ }
  }
  return out;
}

function listInstances(root) {
  try {
    return fs.readdirSync(recordsDir(root)).filter((f) => /\.ndjson$/.test(f)).map((f) => f.slice(0, -'.ndjson'.length)).sort();
  } catch (e) { return []; }
}

// ---- ordering ----

// A total order that respects each instance's own chain order and otherwise goes by timestamp.
function before(a, b) {
  const pa = parseRecordId(a.id);
  const pb = parseRecordId(b.id);
  if (pa && pb && pa.instance === pb.instance) return pa.seq < pb.seq;
  const ta = Date.parse(a.ts);
  const tb = Date.parse(b.ts);
  if (ta !== tb) return ta < tb;
  return String(pa && pa.instance) < String(pb && pb.instance);
}
function byOrder(a, b) { return a.id === b.id ? 0 : (before(a, b) ? -1 : 1); }

// ---- store: per-call cache with one refresh on a miss ----

function makeStore(root, opts = {}) {
  const st = {
    root,
    now: opts.now ? new Date(opts.now) : new Date(),
    refreshed: false,
    files: new Map(),
    _all: null,
    _index: null,
    verified: new Map(),
    inputHosts: new Map(),
    invalidate() { st.files.clear(); st._all = null; st._index = null; st.verified.clear(); st.inputHosts.clear(); },
    miss() {
      if (st.refreshed || typeof opts.refresh !== 'function') return false;
      st.refreshed = true;
      try { opts.refresh(); } catch (e) { /* best effort */ }
      st.invalidate();
      return true;
    },
    entries(instance) {
      if (!st.files.has(instance)) st.files.set(instance, readEntries(recordsFile(root, instance)));
      return st.files.get(instance);
    },
    findRecord(id) {
      const p = parseRecordId(id);
      if (!p) return null;
      return st.entries(p.instance).find((e) => e.id === id) || null;
    },
    record(id) {
      let r = st.findRecord(id);
      if (!r && st.miss()) r = st.findRecord(id);
      return r;
    },
    input(id) {
      let e = log.getInput(root, id);
      if (!e && st.miss()) e = log.getInput(root, id);
      return e;
    },
    all() {
      if (!st._all) {
        const out = [];
        for (const inst of listInstances(root)) for (const e of st.entries(inst)) if (parseRecordId(e.id)) out.push(e);
        out.sort(byOrder);
        st._all = out;
      }
      return st._all;
    },
    index() {
      if (st._index) return st._index;
      const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
      const ix = { revokedBy: new Map(), supersededBy: new Map(), ratifiedBy: new Map(), answersByQ: new Map(), withdrawnQ: new Map(), underBy: new Map(), citedBy: new Map() };
      for (const r of st.all()) {
        if (r.kind === 'revocation' && r.target) push(ix.revokedBy, r.target, r);
        if (r.supersedes) push(ix.supersededBy, r.supersedes, r);
        if (r.kind === 'ratification' && r.target) push(ix.ratifiedBy, r.target, r);
        if (r.kind === 'withdrawal' && r.target) push(ix.withdrawnQ, r.target, r);
        if (r.under) push(ix.underBy, r.under, r);
        for (const c of Array.isArray(r.cites) ? r.cites : []) push(ix.citedBy, c, r);
        if (r.input) push(ix.citedBy, r.input, r);
        if (Array.isArray(r.answers) && ['decision', 'delegation', 'answer'].includes(r.kind)) for (const q of r.answers) push(ix.answersByQ, q, r);
      }
      st._index = ix;
      return ix;
    },
  };
  return st;
}

// ---- chain verification ----

function headsKey(kind, name) { return kind === 'records' ? `records/${name}` : name; }

function chainFail(code, error, extra = {}) { return { ok: false, code, error, ...extra }; }

// Chain, id sequence and head checks for one records file. Advances (never lowers) the local head.
function verifyRecordsFile(root, instance) {
  const file = recordsFile(root, instance);
  if (!fs.existsSync(file)) return chainFail('not_found', `records/${instance}: no such chain file`);
  const v = chain.verifyChain(file);
  if (!v.ok) return chainFail('chain_invalid', `records/${instance}: ${v.error}`, { at: v.at });
  const hashes = [];
  let lastSeq = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const e = JSON.parse(lines[i]);
    const p = parseRecordId(e.id);
    if (!p || p.instance !== instance || p.seq !== lastSeq + 1) {
      return chainFail('chain_invalid', `records/${instance} line ${i + 1}: unexpected id ${e.id} after seq ${lastSeq}`, { at: i + 1 });
    }
    if (e.by && e.by.instance !== undefined && e.by.instance !== instance) {
      return chainFail('chain_invalid', `records/${instance} line ${i + 1}: record ${e.id} claims author ${e.by.instance}`, { at: i + 1 });
    }
    lastSeq = p.seq;
    hashes.push(e.hash);
  }
  const key = headsKey('records', instance);
  const head = log.readHeads(root)[key];
  const state = head ? 'recorded' : 'absent';
  if (head) {
    if (hashes.length < head.count) {
      return chainFail('truncated', `records/${instance}: truncated, ${hashes.length} entries but ${head.count} were recorded`, { heads: state, count: hashes.length });
    }
    if (head.count > 0 && hashes[head.count - 1] !== head.last_hash) {
      return chainFail('history_rewritten', `records/${instance}: history rewritten, entry ${head.count} no longer matches the recorded head`, { heads: state, count: hashes.length });
    }
  }
  if (!head || hashes.length > head.count) log.setHead(root, key, { count: hashes.length, last_hash: v.last_hash });
  return { ok: true, count: hashes.length, last_hash: v.last_hash, heads: state };
}

function verifyRecordsFileCached(st, instance) {
  if (!st.verified.has(instance)) st.verified.set(instance, verifyRecordsFile(st.root, instance));
  return st.verified.get(instance);
}

function verifyInputHostCached(st, host) {
  if (!st.inputHosts.has(host)) {
    const r = log.verifyInputs(st.root, { host });
    if (r.ok) st.inputHosts.set(host, r);
    else {
      let code = 'chain_invalid';
      if (/truncated/.test(r.error || '')) code = 'truncated';
      else if (/history rewritten/.test(r.error || '')) code = 'history_rewritten';
      st.inputHosts.set(host, chainFail(code, r.error, { at: r.at, count: r.count }));
    }
  }
  return st.inputHosts.get(host);
}

// ---- scope helpers ----

function emptyScope() { return { beads: [], labels: [], initiatives: [] }; }

function normScope(scope, { requireNonEmpty = false, what = 'scope' } = {}) {
  const out = emptyScope();
  if (scope !== undefined && scope !== null && typeof scope !== 'object') throw new OperatorError('invalid_scope', `${what} must be an object of beads, labels and initiatives; name them explicitly with --scope bead:ID,label:L,initiative:I`);
  for (const k of SCOPE_KEYS) {
    const arr = scope && scope[k] !== undefined ? scope[k] : [];
    if (!Array.isArray(arr)) throw new OperatorError('invalid_scope', `${what}.${k} must be an array; name resources explicitly with --scope`);
    const seen = new Set();
    for (const v of arr) {
      const s = String(v === undefined || v === null ? '' : v).trim();
      if (!s) continue;
      if (s.includes('*')) throw new OperatorError('invalid_scope', `${what} entry "${s}" is a wildcard; a scope names beads, labels and initiatives explicitly (--scope bead:ID,label:L,initiative:I)`);
      if (!seen.has(s)) { seen.add(s); out[k].push(s); }
    }
  }
  if (requireNonEmpty && SCOPE_KEYS.every((k) => out[k].length === 0)) {
    throw new OperatorError('invalid_scope', `${what} is empty; name at least one bead, label or initiative explicitly (--scope bead:ID,label:L,initiative:I)`);
  }
  return out;
}

function scopeContained(inner, outer) {
  return SCOPE_KEYS.every((k) => (inner[k] || []).every((v) => (outer[k] || []).includes(v)));
}
function scopeUnion(scopes) {
  const out = emptyScope();
  for (const s of scopes) for (const k of SCOPE_KEYS) for (const v of (s && s[k]) || []) if (!out[k].includes(v)) out[k].push(v);
  return out;
}
function scopeIntersects(a, b) { return SCOPE_KEYS.some((k) => (a[k] || []).some((v) => (b[k] || []).includes(v))); }
function scopeIsEmpty(s) { return SCOPE_KEYS.every((k) => !(s && s[k] && s[k].length)); }
function missingFrom(inner, outer) {
  const out = [];
  for (const k of SCOPE_KEYS) for (const v of inner[k] || []) if (!(outer[k] || []).includes(v)) out.push(`${k.slice(0, -1)}:${v}`);
  return out;
}

// ---- argument checks ----

function needText(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new OperatorError('empty', `${name} must not be empty`);
  return v;
}

function needBy(by) {
  if (!by || typeof by !== 'object' || typeof by.instance !== 'string' || !INSTANCE_RE.test(by.instance)) {
    throw new OperatorError('not_allowed', 'the author instance is unknown; run operator.js from a delivery role session (prepare-role writes the marker it reads)');
  }
  return { instance: by.instance, role: typeof by.role === 'string' ? by.role : 'unknown', session_id: by.session_id || 'unknown' };
}

function inputHead(input) {
  const p = log.parseId(input.id) || {};
  return { id: input.id, host: input.host, seq: p.seq, hash: input.hash };
}

// A human input cited with an exact quote by someone entitled to cite it.
function humanCite(st, cite, quote, by, { requireOwner = true } = {}) {
  const input = st.input(cite);
  if (!input) {
    throw new OperatorError('not_found', `input ${cite} was not found; list inputs with operator.js pending, or run operator.js sync and operator.js refresh`);
  }
  if (input.source !== 'human') {
    throw new OperatorError('not_human', `input ${cite} is a ${input.source} message, not the operator's own words; only human inputs can be cited (operator.js pending lists them)`);
  }
  const nq = normalizeWs(quote);
  if (nq.length < MIN_QUOTE) {
    throw new OperatorError('quote_mismatch', `quote must be at least ${MIN_QUOTE} characters of the operator's exact words (operator.js show ${cite} prints them)`);
  }
  if (!normalizeWs(input.text).includes(nq)) {
    throw new OperatorError('quote_mismatch', `quote is not a substring of ${cite} (whitespace and case are ignored); copy the exact words (operator.js show ${cite} prints them)`);
  }
  if (requireOwner && by.role !== 'chief-of-staff' && !(by.session_id && by.session_id !== 'unknown' && by.session_id === input.session_id)) {
    throw new OperatorError('not_allowed', `only the chief of staff or the session that captured ${cite} may record it; send the input id ${cite} to the chief of staff`);
  }
  return input;
}

function checkSupersedes(st, targetId, superseder) {
  if (targetId === undefined || targetId === null || targetId === '') return null;
  const t = st.record(targetId);
  if (!t) throw new OperatorError('not_found', `cannot supersede ${targetId}: no such record (operator.js find lists records)`);
  if (!['decision', 'delegation', 'answer'].includes(t.kind)) {
    throw new OperatorError('supersede_not_allowed', `${targetId} is a ${t.kind}; only decisions, delegations and answers can be superseded`);
  }
  if (superseder === 'answer' && t.kind !== 'answer') {
    throw new OperatorError('supersede_not_allowed', `an answer cannot supersede the operator's ${t.kind} ${targetId}; record the operator's override with operator.js record --supersedes ${targetId}`);
  }
  if ((st.index().supersededBy.get(targetId) || []).length) {
    throw new OperatorError('already_superseded', `${targetId} is already superseded; supersede the current record (operator.js find shows it)`);
  }
  return targetId;
}

function questionStatus(st, q) {
  const ix = st.index();
  const answering = (ix.answersByQ.get(q.id) || []).filter((r) => !(ix.revokedBy.get(r.id) || []).length);
  if (answering.length) return 'answered';
  if ((ix.withdrawnQ.get(q.id) || []).length) return 'withdrawn';
  return 'open';
}

function checkAnswers(st, answers, scope, kind) {
  if (answers === undefined || answers === null) return [];
  if (!Array.isArray(answers)) throw new OperatorError('invalid_answers', 'answers must be an array of question ids (q-<instance>-N)');
  const out = [];
  for (const qid of answers) {
    const q = st.record(qid);
    if (!q || q.kind !== 'question') throw new OperatorError('not_found', `question ${qid} was not found (operator.js ledger lists questions)`);
    if (questionStatus(st, q) === 'withdrawn') throw new OperatorError('question_withdrawn', `question ${qid} was withdrawn and cannot be answered (operator.js ledger shows its status)`);
    if (kind !== 'answer' && !scopeIsEmpty(q.scope) && !scopeIntersects(scope, q.scope)) {
      throw new OperatorError('scope_mismatch', `the scope of this ${kind} does not overlap the scope of question ${qid}; add --scope with the beads, labels or initiatives it concerns (operator.js ledger shows the question's scope)`);
    }
    if (!out.includes(qid)) out.push(qid);
  }
  return out;
}

// ---- writing ----

function appendRecord(st, by, fields) {
  const root = st.root;
  const inst = by.instance;
  const file = recordsFile(root, inst);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    const v = verifyRecordsFile(root, inst);
    if (!v.ok) throw new OperatorError(v.code === 'truncated' || v.code === 'history_rewritten' ? v.code : 'chain_invalid', `${v.error}; this chain no longer verifies, so nothing can be appended to it (tell the chief of staff; the project repository history holds the last good copy)`);
  }
  const prefix = KIND_PREFIX[fields.kind];
  const stored = chain.appendEntry(file, (last) => {
    const lp = last ? parseRecordId(last.id) : null;
    const seq = lp ? lp.seq + 1 : 1;
    return { id: `${prefix}-${inst}-${pad(seq)}`, ...fields, by, ts: st.now.toISOString() };
  });
  st.invalidate();
  const after = verifyRecordsFile(root, inst); // advances the head
  void after;
  return stored;
}

function afterWrite(root) { try { writeLedger(root); } catch (e) { /* best effort */ } }

function recordDecision(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.statement, 'statement');
  const input = humanCite(st, o.cite, o.quote, by);
  const scope = normScope(o.scope);
  const answers = checkAnswers(st, o.answers, scope, 'decision');
  const sup = checkSupersedes(st, o.supersedes, 'decision');
  const fields = { kind: 'decision', statement: o.statement.trim(), quote: o.quote, cites: [o.cite], cites_head: [inputHead(input)], scope, supersedes: sup };
  if (answers.length) fields.answers = answers;
  const rec = appendRecord(st, by, fields);
  afterWrite(o.projectRoot);
  return rec;
}

function parseUntil(until, now) {
  if (until === undefined || until === null || until === '') return null;
  const s = String(until).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new OperatorError('invalid_limits', `until "${until}" is not an ISO date (use --until 2026-12-31 or a full timestamp)`);
  if (t <= now.getTime()) throw new OperatorError('invalid_limits', `until "${until}" is already in the past; give a future date with --until`);
  return new Date(t).toISOString();
}

function recordDelegation(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.statement, 'statement');
  const input = humanCite(st, o.cite, o.quote, by);
  const scope = normScope(o.scope, { requireNonEmpty: true, what: 'delegation scope' });
  const lim = o.limits || {};
  const until = parseUntil(lim.until, st.now);
  let maxUses = null;
  if (lim.max_uses !== undefined && lim.max_uses !== null && lim.max_uses !== '') {
    maxUses = Number(lim.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new OperatorError('invalid_limits', `max_uses "${lim.max_uses}" must be a positive integer (--max-uses N)`);
  }
  const answers = checkAnswers(st, o.answers, scope, 'delegation');
  const fields = { kind: 'delegation', statement: o.statement.trim(), quote: o.quote, cites: [o.cite], cites_head: [inputHead(input)], scope,
    limits: { until, max_uses: maxUses }, supersedes: null };
  if (answers.length) fields.answers = answers;
  const rec = appendRecord(st, by, fields);
  afterWrite(o.projectRoot);
  return rec;
}

function decideUnder(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.statement, 'statement');
  const d = st.record(o.under);
  if (!d) throw new OperatorError('not_found', `delegation ${o.under} was not found (operator.js find lists delegations)`);
  if (d.kind !== 'delegation') throw new OperatorError('not_delegation', `${o.under} is a ${d.kind}, not a delegation; decide --under takes a del- id`);
  if (by.role !== 'chief-of-staff' && by.instance !== (d.by && d.by.instance)) {
    throw new OperatorError('not_allowed', `only the chief of staff or the author of ${o.under} may decide under it; send the question to the chief of staff`);
  }
  const ix = st.index();
  const rev = (ix.revokedBy.get(d.id) || [])[0];
  if (rev) throw new OperatorError('revoked', `delegation ${d.id} was revoked by ${rev.id}; ask the chief of staff for a fresh decision (operator.js find)`);
  const sup = (ix.supersededBy.get(d.id) || [])[0];
  if (sup) throw new OperatorError('superseded', `delegation ${d.id} was superseded by ${sup.id}; decide under that one (operator.js find)`);
  const lim = d.limits || {};
  if (lim.until && st.now.getTime() > Date.parse(lim.until)) {
    throw new OperatorError('expired', `delegation ${d.id} expired at ${lim.until}; ask the chief of staff for a fresh decision`);
  }
  const scope = normScope(o.scope, { requireNonEmpty: true, what: 'decision scope' });
  if (!scopeContained(scope, d.scope)) {
    throw new OperatorError('scope_not_covered', `${missingFrom(scope, d.scope).join(', ')} lies outside delegation ${d.id}; narrow --scope or ask the chief of staff to take it to the operator`);
  }
  const used = (ix.underBy.get(d.id) || []).length;
  if (lim.max_uses && used >= lim.max_uses) {
    throw new OperatorError('max_uses_exceeded', `delegation ${d.id} allows ${lim.max_uses} decisions and ${used} were made; ask the chief of staff for a fresh decision`);
  }
  const answers = checkAnswers(st, o.answers, scope, 'decision');
  const fields = { kind: 'decision', statement: o.statement.trim(), quote: null, cites: [d.id], cites_head: [{ id: d.id, hash: d.hash }], under: d.id, scope, supersedes: null };
  if (answers.length) fields.answers = answers;
  const rec = appendRecord(st, by, fields);
  afterWrite(o.projectRoot);
  return rec;
}

function revoke(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  const input = humanCite(st, o.cite, o.quote, by);
  const t = st.record(o.target);
  if (!t) throw new OperatorError('not_found', `${o.target} was not found (operator.js find lists decisions and delegations)`);
  if (!['delegation', 'decision'].includes(t.kind)) throw new OperatorError('invalid_target', `${o.target} is a ${t.kind}; only delegations and decisions can be revoked`);
  if ((st.index().revokedBy.get(t.id) || []).length) throw new OperatorError('already_revoked', `${t.id} is already revoked`);
  const rec = appendRecord(st, by, { kind: 'revocation', target: t.id, quote: o.quote, cites: [o.cite],
    cites_head: [inputHead(input), { id: t.id, hash: t.hash }], scope: t.scope || emptyScope(), supersedes: null });
  afterWrite(o.projectRoot);
  return rec;
}

function recordAnswer(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') {
    throw new OperatorError('not_allowed', 'only the chief of staff answers on the operator\'s behalf; send the question to the chief of staff (SendMessage) and it answers with a record id');
  }
  needText(o.question, 'question');
  needText(o.answer, 'answer');
  if (!Array.isArray(o.cites) || !o.cites.length) throw new OperatorError('empty', 'an answer must cite at least one decision, delegation or earlier answer (--cite dec-N; operator.js find lists them)');
  if (o.confidence !== 'settled' && o.confidence !== 'inferred') throw new OperatorError('invalid_confidence', 'confidence must be settled or inferred');
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (o.confidence === 'inferred' && rationale.length < MIN_RATIONALE) {
    throw new OperatorError('rationale_required', `an inferred answer needs a rationale of at least ${MIN_RATIONALE} characters saying why the cited record extends to this case (--rationale)`);
  }
  const scope = normScope(o.scope);
  const cited = [];
  for (const cid of o.cites) {
    const p = parseRecordId(cid);
    if (!p || !['decision', 'delegation', 'answer'].includes(p.kind)) {
      throw new OperatorError('invalid_cite', `${cid} cannot be cited by an answer; cite a dec-, del- or ans- record (operator.js find lists them)`);
    }
    const c = st.record(cid);
    if (!c) throw new OperatorError('not_found', `record ${cid} was not found (operator.js find lists records; operator.js refresh pulls other hosts)`);
    const ix = st.index();
    if ((ix.revokedBy.get(c.id) || []).length) throw new OperatorError('revoked', `${cid} was revoked by ${ix.revokedBy.get(c.id)[0].id} and cannot be cited; find the current record with operator.js find`);
    if ((ix.supersededBy.get(c.id) || []).length) throw new OperatorError('superseded', `${cid} was superseded by ${ix.supersededBy.get(c.id)[0].id}; cite that one (operator.js find)`);
    const v = verifyRecord(o.projectRoot, cid, { store: st });
    if (!v.ok) throw new OperatorError(v.code || 'chain_invalid', `cited record ${cid} does not verify: ${v.error}`);
    if (o.confidence === 'settled' && c.kind === 'answer' && c.confidence !== 'settled' && !(ix.ratifiedBy.get(c.id) || []).length) {
      throw new OperatorError('not_settled', `${cid} is an inferred answer the operator has not ratified; a settled answer cannot rest on it (answer with --confidence inferred, or cite the underlying decision)`);
    }
    cited.push(c);
  }
  if (o.confidence === 'settled') {
    const union = scopeUnion(cited.map((c) => c.scope));
    if (!scopeContained(scope, union)) {
      throw new OperatorError('scope_not_covered', `${missingFrom(scope, union).join(', ')} is not covered by the cited records; narrow --scope, cite a record that covers it, or answer --confidence inferred with a rationale`);
    }
  }
  const answers = checkAnswers(st, o.answers, scope, 'answer');
  const sup = checkSupersedes(st, o.supersedes, 'answer');
  const fields = { kind: 'answer', question: o.question.trim(), answer: o.answer.trim(), confidence: o.confidence, rationale: rationale || null,
    cites: cited.map((c) => c.id), cites_head: cited.map((c) => ({ id: c.id, hash: c.hash })), scope, supersedes: sup };
  if (o.confidence === 'inferred') fields.ratified = null;
  if (answers.length) fields.answers = answers;
  const rec = appendRecord(st, by, fields);
  afterWrite(o.projectRoot);
  return rec;
}

function ratify(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  const input = humanCite(st, o.cite, o.quote, by);
  const t = st.record(o.target);
  if (!t) throw new OperatorError('not_found', `${o.target} was not found (operator.js pending lists answers awaiting ratification)`);
  if (t.kind !== 'answer' || t.confidence !== 'inferred') {
    throw new OperatorError('not_inferred', `${o.target} is not an inferred answer; only inferred answers are ratified (operator.js pending lists them)`);
  }
  if ((st.index().ratifiedBy.get(t.id) || []).length) throw new OperatorError('already_ratified', `${t.id} is already ratified`);
  const rec = appendRecord(st, by, { kind: 'ratification', target: t.id, quote: o.quote, cites: [o.cite],
    cites_head: [inputHead(input), { id: t.id, hash: t.hash }], scope: t.scope || emptyScope(), supersedes: null });
  afterWrite(o.projectRoot);
  return rec;
}

function ack(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.reason, 'reason');
  const input = st.input(o.input);
  if (!input) throw new OperatorError('not_found', `input ${o.input} was not found (operator.js pending lists inputs; operator.js sync captures new ones)`);
  const rec = appendRecord(st, by, { kind: 'ack', input: input.id, reason: o.reason.trim(), cites: [input.id], cites_head: [inputHead(input)], scope: emptyScope(), supersedes: null });
  afterWrite(o.projectRoot);
  return rec;
}

function recordQuestion(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') {
    throw new OperatorError('not_allowed', 'only the chief of staff escalates questions to the operator; message the chief of staff with the one question (SendMessage)');
  }
  needText(o.text, 'text');
  const a = o.asker && typeof o.asker === 'object' ? o.asker : {};
  const asker = { instance: a.instance || by.instance, role: a.role || null, bead: a.bead || null };
  const options = Array.isArray(o.options) ? o.options.map((x) => String(x).trim()).filter(Boolean) : [];
  const rec = appendRecord(st, by, { kind: 'question', text: o.text.trim(), asker, scope: normScope(o.scope), options,
    recommendation: o.recommendation ? String(o.recommendation).trim() : null, cites: [], cites_head: [], supersedes: null });
  afterWrite(o.projectRoot);
  return rec;
}

function withdraw(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') throw new OperatorError('not_allowed', 'only the chief of staff withdraws questions');
  needText(o.reason, 'reason');
  const q = st.record(o.question);
  if (!q || q.kind !== 'question') throw new OperatorError('not_found', `question ${o.question} was not found (operator.js ledger lists questions)`);
  if (questionStatus(st, q) !== 'open') throw new OperatorError('not_open', `question ${q.id} is ${questionStatus(st, q)}; only open questions are withdrawn (operator.js ledger)`);
  const rec = appendRecord(st, by, { kind: 'withdrawal', target: q.id, reason: o.reason.trim(), cites: [], cites_head: [{ id: q.id, hash: q.hash }], scope: q.scope || emptyScope(), supersedes: null });
  afterWrite(o.projectRoot);
  return rec;
}

// ---- verification ----

function verifyRecord(projectRoot, id, opts = {}) {
  const st = opts.store || makeStore(projectRoot, opts);
  const result = { ok: true, id, chain: [], notes: [], chains: [] };
  const seenChains = new Set();
  const noteChain = (name, v) => {
    if (seenChains.has(name)) return;
    seenChains.add(name);
    result.chains.push({ chain: name, heads: v.heads || 'recorded', count: v.count });
  };
  const fail = (code, error, extra = {}) => {
    result.ok = false; result.code = code; result.error = error;
    Object.assign(result, extra);
    return false;
  };
  const finish = () => {
    result.heads = result.chains.some((c) => c.heads === 'absent') ? 'absent' : 'recorded';
    return result;
  };

  // The cited input: present, same hash as at citation time, host chain intact.
  const checkInput = (rec, cid) => {
    const head = (rec.cites_head || []).find((h) => h && h.id === cid);
    if (!head) return fail('history_rewritten', `record ${rec.id} carries no cites_head for ${cid}; its citation cannot be checked`);
    const input = st.input(cid);
    if (!input) return fail('cited_entry_missing', `${cid} cited by ${rec.id} is missing from the inputs log (deleted or not yet pulled: operator.js refresh)`);
    if (input.hash !== head.hash) return fail('history_rewritten', `${cid} no longer matches the hash recorded when ${rec.id} cited it (history rewritten)`);
    const v = verifyInputHostCached(st, input.host);
    if (!v.ok) return fail(v.code, v.error, { at: v.at });
    noteChain(`inputs/${input.host}`, v);
    const p = log.parseId(cid);
    if (head.seq && v.count < head.seq) return fail('cited_entry_missing', `host ${input.host} chain has ${v.count} entries but ${rec.id} cited entry ${head.seq}`);
    if (p && head.seq && p.seq !== head.seq) return fail('history_rewritten', `${cid} does not match the sequence recorded by ${rec.id}`);
    return input;
  };

  const inputHop = (input) => ({ id: input.id, kind: 'input', source: input.source, text: input.text, host: input.host,
    session_id: input.session_id, ts: input.ts, transcript_ref: input.transcript_ref, truncated: input.truncated || undefined });

  const humanInput = (rec, cid, requireQuote) => {
    const input = checkInput(rec, cid);
    if (!input) return null;
    if (input.source !== 'human') { fail('not_human', `${cid} cited by ${rec.id} is a ${input.source} message, not the operator's words`); return null; }
    if (requireQuote) {
      const nq = normalizeWs(rec.quote);
      if (nq.length < MIN_QUOTE || !normalizeWs(input.text).includes(nq)) {
        fail('quote_mismatch', `the quote of ${rec.id} is not a substring of ${cid}`);
        return null;
      }
    }
    return input;
  };

  // the index is read lazily: a refresh triggered mid-walk rebuilds it
  const IX = () => st.index();
  const timed = (list, rec) => (list || []).filter((x) => before(x, rec));
  const later = (list, rec) => (list || []).filter((x) => !before(x, rec));

  const hop = (rid, depth, citer) => {
    if (depth > MAX_DEPTH) return fail('chain_invalid', `citation chain from ${id} is deeper than ${MAX_DEPTH} (cycle?)`);
    if (rid.startsWith('in-')) {
      const input = citer ? checkInput(citer, rid) : (() => {
        const e = st.input(rid);
        if (!e) { fail('not_found', `input ${rid} was not found (operator.js refresh pulls other hosts)`); return null; }
        const v = verifyInputHostCached(st, e.host);
        if (!v.ok) { fail(v.code, v.error, { at: v.at }); return null; }
        noteChain(`inputs/${e.host}`, v);
        return e;
      })();
      if (!input) return false;
      result.chain.push(inputHop(input));
      return true;
    }
    const p = parseRecordId(rid);
    if (!p) return fail('not_found', `${rid} is not a record or input id`);
    const rec = st.record(rid);
    if (!rec) return fail('not_found', `record ${rid} was not found (operator.js refresh pulls other hosts)`);
    const cv = verifyRecordsFileCached(st, p.instance);
    if (!cv.ok) return fail(cv.code, cv.error, { at: cv.at });
    noteChain(`records/${p.instance}`, cv);
    const hopEntry = { id: rec.id, kind: rec.kind, by: rec.by, ts: rec.ts, scope: rec.scope };
    if (rec.statement !== undefined) hopEntry.statement = rec.statement;
    if (rec.quote) hopEntry.quote = rec.quote;
    if (rec.kind === 'answer') Object.assign(hopEntry, { question: rec.question, answer: rec.answer, confidence: rec.confidence, rationale: rec.rationale });
    if (rec.kind === 'question') Object.assign(hopEntry, { text: rec.text, asker: rec.asker });
    if (rec.under) hopEntry.under = rec.under;
    if (rec.target) hopEntry.target = rec.target;
    if (rec.reason) hopEntry.reason = rec.reason;
    if (rec.limits) hopEntry.limits = rec.limits;
    result.chain.push(hopEntry);

    // supersession is authority-checked here too: only the operator's own records override
    if (rec.supersedes) {
      const t = st.record(rec.supersedes);
      if (!t) return fail('cited_entry_missing', `${rec.id} supersedes ${rec.supersedes}, which is missing`);
      if (rec.kind === 'answer' && t.kind !== 'answer') return fail('supersede_not_allowed', `answer ${rec.id} supersedes the ${t.kind} ${t.id}`);
    }
    const sups = IX().supersededBy.get(rec.id) || [];
    for (const s of sups) result.notes.push(`${rec.id} was superseded by ${s.id} at ${s.ts}`);
    const revs = IX().revokedBy.get(rec.id) || [];
    for (const r of revs) result.notes.push(`${rec.id} was revoked by ${r.id} at ${r.ts}${before(r, citer || rec) ? '' : ' (after it was used; it was valid when made)'}`);

    switch (rec.kind) {
      case 'decision':
      case 'delegation':
      case 'revocation':
      case 'ratification': {
        if (rec.under) {
          const d = st.record(rec.under);
          if (!d) return fail('cited_entry_missing', `delegation ${rec.under} cited by ${rec.id} is missing (operator.js refresh)`);
          const h = (rec.cites_head || []).find((x) => x && x.id === d.id);
          if (!h) return fail('history_rewritten', `record ${rec.id} carries no cites_head for ${d.id}`);
          if (h.hash !== d.hash) return fail('history_rewritten', `${d.id} no longer matches the hash recorded when ${rec.id} cited it (history rewritten)`);
          if (d.kind !== 'delegation') return fail('not_delegation', `${rec.id} claims authority from ${d.id}, which is a ${d.kind}`);
          if (!hop(d.id, depth + 1, rec)) return false;
          const rv = timed(IX().revokedBy.get(d.id), rec)[0];
          if (rv) return fail('revoked', `delegation ${d.id} had been revoked by ${rv.id} (${rv.ts}) when ${rec.id} was decided`);
          for (const r of later(IX().revokedBy.get(d.id), rec)) result.notes.push(`delegation ${d.id} was revoked by ${r.id} at ${r.ts}, after this decision`);
          const lim = d.limits || {};
          if (lim.until && Date.parse(rec.ts) > Date.parse(lim.until)) return fail('expired', `delegation ${d.id} expired at ${lim.until}; ${rec.id} was decided at ${rec.ts}`);
          if (!scopeContained(rec.scope || emptyScope(), d.scope || emptyScope())) {
            return fail('scope_not_covered', `${missingFrom(rec.scope || emptyScope(), d.scope || emptyScope()).join(', ')} lies outside delegation ${d.id}`);
          }
          if (lim.max_uses) {
            const uses = (IX().underBy.get(d.id) || []).filter((x) => x.id === rec.id || before(x, rec)).length;
            if (uses > lim.max_uses) return fail('max_uses_exceeded', `delegation ${d.id} allows ${lim.max_uses} decisions; ${rec.id} is number ${uses}`);
          }
          return true;
        }
        const cid = Array.isArray(rec.cites) ? rec.cites[0] : null;
        if (!cid || !cid.startsWith('in-')) return fail('chain_invalid', `${rec.id} cites no operator input`);
        const input = humanInput(rec, cid, true);
        if (!input) return false;
        result.chain.push(inputHop(input));
        if (rec.kind === 'revocation' || rec.kind === 'ratification') {
          const t = st.record(rec.target);
          if (!t) return fail('cited_entry_missing', `${rec.id} targets ${rec.target}, which is missing`);
          const h = (rec.cites_head || []).find((x) => x && x.id === t.id);
          if (!h || h.hash !== t.hash) return fail('history_rewritten', `${t.id} no longer matches the hash recorded when ${rec.id} targeted it`);
          if (rec.kind === 'ratification' && (t.kind !== 'answer' || t.confidence !== 'inferred')) return fail('not_inferred', `${rec.id} ratifies ${t.id}, which is not an inferred answer`);
        }
        return true;
      }
      case 'answer': {
        const cites = Array.isArray(rec.cites) ? rec.cites : [];
        if (!cites.length) return fail('chain_invalid', `answer ${rec.id} cites nothing`);
        if (rec.confidence !== 'settled' && rec.confidence !== 'inferred') return fail('invalid_confidence', `answer ${rec.id} has confidence ${rec.confidence}`);
        if (rec.confidence === 'inferred' && String(rec.rationale || '').trim().length < MIN_RATIONALE) return fail('rationale_required', `inferred answer ${rec.id} has no sufficient rationale`);
        const citedRecs = [];
        for (const cid of cites) {
          const c = st.record(cid);
          if (!c) return fail('cited_entry_missing', `record ${cid} cited by ${rec.id} is missing (operator.js refresh)`);
          const h = (rec.cites_head || []).find((x) => x && x.id === cid);
          if (!h) return fail('history_rewritten', `record ${rec.id} carries no cites_head for ${cid}`);
          if (h.hash !== c.hash) return fail('history_rewritten', `${cid} no longer matches the hash recorded when ${rec.id} cited it (history rewritten)`);
          if (!hop(cid, depth + 1, rec)) return false;
          const rv = timed(IX().revokedBy.get(cid), rec)[0];
          if (rv) return fail('revoked', `${cid} had been revoked by ${rv.id} (${rv.ts}) when ${rec.id} cited it`);
          const sv = timed(IX().supersededBy.get(cid), rec)[0];
          if (sv) return fail('superseded', `${cid} had been superseded by ${sv.id} (${sv.ts}) when ${rec.id} cited it`);
          citedRecs.push(c);
        }
        if (rec.confidence === 'settled') {
          const union = scopeUnion(citedRecs.map((c) => c.scope));
          if (!scopeContained(rec.scope || emptyScope(), union)) {
            return fail('scope_not_covered', `${missingFrom(rec.scope || emptyScope(), union).join(', ')} is not covered by the records ${rec.id} cites`);
          }
        }
        return true;
      }
      case 'ack': {
        const cid = rec.input || (rec.cites || [])[0];
        const input = checkInput(rec, cid);
        if (!input) return false;
        result.chain.push(inputHop(input));
        return true;
      }
      case 'withdrawal': {
        const q = st.record(rec.target);
        if (!q) return fail('cited_entry_missing', `question ${rec.target} withdrawn by ${rec.id} is missing`);
        return true;
      }
      case 'question':
        return true;
      default:
        return fail('chain_invalid', `${rec.id} has unknown kind ${rec.kind}`);
    }
  };

  hop(id, 0, null);
  return finish();
}

// ---- reading ----

function listRecords(projectRoot) { return makeStore(projectRoot).all().slice(); }
function getRecord(projectRoot, id) { return makeStore(projectRoot).findRecord(id); }

function haystack(r) {
  return normalizeWs([r.statement, r.answer, r.question, r.quote, r.text].filter((x) => typeof x === 'string').join(' '));
}
function wordsOf(text) { return normalizeWs(text).split(' ').filter(Boolean); }

function find(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const ix = st.index();
  const want = normScopeLoose(o.scope);
  const words = o.text ? wordsOf(o.text) : [];
  const kinds = Array.isArray(o.kinds) && o.kinds.length ? o.kinds : null;
  const scoped = want && !scopeIsEmpty(want);
  const out = [];
  for (const r of st.all()) {
    if (!['decision', 'delegation', 'answer'].includes(r.kind)) continue;
    if (kinds && !kinds.includes(r.kind)) continue;
    const revoked = (ix.revokedBy.get(r.id) || [])[0];
    const superseded = (ix.supersededBy.get(r.id) || [])[0];
    if (revoked) continue;
    if (superseded && !o.all) continue;
    if (scoped && !scopeIntersects(r.scope || emptyScope(), want)) continue;
    if (words.length) { const h = haystack(r); if (!words.every((w) => h.includes(w))) continue; }
    const exactBead = scoped && (r.scope.beads || []).some((b) => (want.beads || []).includes(b));
    out.push({
      id: r.id, kind: r.kind, statement: r.kind === 'answer' ? r.answer : r.statement, question: r.question, quote: r.quote || null,
      scope: r.scope, confidence: r.kind === 'answer' ? r.confidence : undefined,
      ratified: r.kind === 'answer' && r.confidence === 'inferred' ? (ix.ratifiedBy.get(r.id) || []).length > 0 : undefined,
      by: r.by, ts: r.ts, superseded_by: superseded ? superseded.id : undefined, match: exactBead ? 'bead' : 'scope', _bead: exactBead, _rec: r,
    });
  }
  out.sort((a, b) => (a._bead === b._bead ? -byOrder(a._rec, b._rec) : (a._bead ? -1 : 1)));
  for (const x of out) { delete x._bead; delete x._rec; }
  if (words.length && (!kinds || kinds.includes('input'))) {
    const inputs = log.listInputs(projectRoot, { source: 'human' })
      .filter((e) => { const h = normalizeWs(e.text); return words.every((w) => h.includes(w)); })
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    for (const e of inputs) out.push({ id: e.id, kind: 'input', statement: e.text, quote: null, scope: emptyScope(), by: { instance: e.instance, role: e.role, session_id: e.session_id }, ts: e.ts, match: 'text' });
  }
  return out;
}

function normScopeLoose(scope) {
  if (!scope || typeof scope !== 'object') return emptyScope();
  const out = emptyScope();
  for (const k of SCOPE_KEYS) out[k] = Array.isArray(scope[k]) ? scope[k].map(String) : [];
  return out;
}

function pending(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const ix = st.index();
  const handled = new Set();
  for (const r of st.all()) {
    if (!['decision', 'delegation', 'revocation', 'ratification', 'ack'].includes(r.kind)) continue;
    for (const c of Array.isArray(r.cites) ? r.cites : []) if (typeof c === 'string' && c.startsWith('in-')) handled.add(c);
    if (r.input) handled.add(r.input);
  }
  const inputs = log.listInputs(projectRoot, { source: 'human', since: o.since || undefined, sessionId: o.sessionId || undefined })
    .filter((e) => !handled.has(e.id));
  const open = st.all().filter((r) => r.kind === 'question' && questionStatus(st, r) === 'open')
    .sort((a, b) => -byOrder(a, b))
    .map((q) => ({ id: q.id, text: q.text, asker: q.asker, scope: q.scope, options: q.options, recommendation: q.recommendation, ts: q.ts }));
  const unratified = st.all().filter((r) => r.kind === 'answer' && r.confidence === 'inferred'
    && !(ix.ratifiedBy.get(r.id) || []).length && !(ix.supersededBy.get(r.id) || []).length)
    .sort((a, b) => -byOrder(a, b));
  return { inputs, open_questions: open, unratified_answers: unratified };
}

// ---- ledger ----

function resolveHuman(st, rec, depth = 0) {
  if (!rec || depth > MAX_DEPTH) return null;
  if (rec.under) return resolveHuman(st, st.findRecord(rec.under), depth + 1);
  if (rec.kind === 'answer') {
    for (const cid of rec.cites || []) {
      const r = resolveHuman(st, st.findRecord(cid), depth + 1);
      if (r) return r;
    }
    return null;
  }
  const cid = (rec.cites || []).find((c) => typeof c === 'string' && c.startsWith('in-'));
  if (cid && rec.quote) return { quote: rec.quote, input: cid };
  return null;
}

function ledger(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const ix = st.index();
  const sinceMs = o.since ? Date.parse(o.since) : null;
  const rows = [];
  for (const q of st.all().filter((r) => r.kind === 'question')) {
    const status = questionStatus(st, q);
    if (o.status && o.status !== status) continue;
    if (o.bead && !((q.asker && q.asker.bead === o.bead) || ((q.scope && q.scope.beads) || []).includes(o.bead))) continue;
    if (sinceMs !== null && !(Date.parse(q.ts) >= sinceMs)) continue;
    const answers = [];
    for (const r of ix.answersByQ.get(q.id) || []) {
      if ((ix.revokedBy.get(r.id) || []).length) continue;
      let h = resolveHuman(st, r);
      if (h && !st.input(h.input)) h = { ...h, missing: true };
      answers.push({
        id: r.id, kind: r.kind, statement: r.kind === 'answer' ? r.answer : r.statement,
        confidence: r.kind === 'answer' ? r.confidence : 'settled',
        ratified: r.kind === 'answer' && r.confidence === 'inferred' ? (ix.ratifiedBy.get(r.id) || []).length > 0 : undefined,
        by: r.by, at: r.ts, quote: h ? h.quote : null, input: h ? h.input : null,
        superseded_by: ((ix.supersededBy.get(r.id) || [])[0] || {}).id,
      });
    }
    answers.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : 1));
    rows.push({
      question: { id: q.id, text: q.text, scope: q.scope, options: q.options || [], recommendation: q.recommendation || null, by: q.by },
      asker: q.asker, asked_at: q.ts, status, answers,
    });
  }
  rows.sort((a, b) => (Date.parse(b.asked_at) - Date.parse(a.asked_at)) || (a.question.id < b.question.id ? 1 : -1));
  return rows;
}

function cell(s) { return String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim(); }

function renderLedger(projectRoot, o = {}) {
  const rows = ledger(projectRoot, o);
  const open = rows.filter((r) => r.status === 'open');
  const rest = rows.filter((r) => r.status !== 'open');
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [
    '<!-- generated: do not edit. Written by operator.js after every record write; verify any row with: operator.js verify <record id> -->',
    '# Operator question ledger',
    '',
    `${count('open')} open, ${count('answered')} answered, ${count('withdrawn')} withdrawn. Open questions first, newest first.`,
    '',
    "| Question id | Question | Asker | Bead | Asked | Status | Answer | Record | Operator's words | Confidence |",
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of [...open, ...rest]) {
    const a = r.answers.length ? r.answers[r.answers.length - 1] : null;
    const earlier = r.answers.length > 1 ? ` (+${r.answers.length - 1} earlier: ${r.answers.slice(0, -1).map((x) => x.id).join(', ')})` : '';
    const asker = r.asker ? `${r.asker.instance || ''}${r.asker.role ? ` (${r.asker.role})` : ''}` : '';
    const bead = (r.asker && r.asker.bead) || ((r.question.scope && r.question.scope.beads) || []).join(', ');
    const qtext = r.question.text + (r.status === 'open' && r.question.recommendation ? ` (recommended: ${r.question.recommendation})` : '');
    const conf = a ? `${a.confidence}${a.ratified === true ? ', ratified' : a.ratified === false ? ', unratified' : ''}${a.superseded_by ? `, superseded by ${a.superseded_by}` : ''}` : '';
    lines.push(`| ${[r.question.id, qtext, asker, bead, String(r.asked_at).slice(0, 16).replace('T', ' '), r.status,
      a ? a.statement : '', a ? `${a.id}${earlier}` : '', a && a.quote ? `"${a.quote}"` : '', conf].map(cell).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeLedger(projectRoot) {
  const text = renderLedger(projectRoot);
  const file = ledgerFile(projectRoot);
  let have = null;
  try { have = fs.readFileSync(file, 'utf8'); } catch (e) { /* new */ }
  if (have === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

module.exports = {
  OperatorError, normalizeWs,
  recordDecision, recordAnswer, ratify, recordDelegation, decideUnder, revoke, recordQuestion, withdraw, ack,
  verifyRecord, find, pending, ledger, renderLedger, writeLedger, listRecords, getRecord,
  parseRecordId,
};
