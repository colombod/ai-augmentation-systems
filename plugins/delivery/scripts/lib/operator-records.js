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
const { loadManifest, expandInstances } = require('./manifest.js');

class OperatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OperatorError';
    this.code = code;
  }
}

const PREFIX_KIND = { dec: 'decision', del: 'delegation', ans: 'answer', q: 'question', rev: 'revocation', rat: 'ratification', ack: 'ack', wd: 'withdrawal', rh: 'rehost' };
const KIND_PREFIX = Object.fromEntries(Object.entries(PREFIX_KIND).map(([p, k]) => [k, p]));
const SCOPE_KEYS = ['beads', 'labels', 'initiatives'];
const MIN_QUOTE_WORDS = 3;
const MIN_QUOTE_CHARS = 12;
const MAX_ANSWER_DEPTH = 2;
const DELEGATORS = new Set(['chief-of-staff', 'product-manager']);
const MIN_RATIONALE = 20;
const MAX_DEPTH = 25;
const INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const pad = (n) => String(n).padStart(6, '0');
const recordsDir = (root) => path.join(log.opDir(root), 'records');
const recordsFile = (root, instance) => path.join(recordsDir(root), `${instance}.ndjson`);
const ledgerFile = (root) => path.join(log.opDir(root), 'LEDGER.md');

function parseRecordId(id) {
  const m = /^(dec|del|ans|q|rev|rat|ack|wd|rh)-(.+)-(\d{6,})$/.exec(String(id || ''));
  if (!m) return null;
  return { prefix: m[1], kind: PREFIX_KIND[m[1]], instance: m[2], seq: Number(m[3]) };
}

// Normalised comparison form of `text` plus, for each normalised character, its offset in the
// NFKC form of the input (so an excerpt can be cut from the operator's own words).
function normMap(text) {
  const base = String(text === undefined || text === null ? '' : text).normalize('NFKC');
  let norm = '';
  const map = [];
  let prevSpace = true;
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) { norm += ' '; map.push(i); prevSpace = true; }
    } else {
      const l = ch.toLowerCase().replace(/[\u2019\u02BC]/g, "'");
      for (const c of l) { norm += c; map.push(i); }
      prevSpace = false;
    }
  }
  if (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
  return { base, norm, map };
}

function normalizeWs(s) { return normMap(s).norm; }

// Negation lexicon (single tokens, plus n't contractions) and phrases. A negation counts when it
// sits in the same SENTENCE as the quote: within 6 tokens before it, or anywhere after it.
const NEG_TOKENS = new Set(['not', 'never', 'no', 'nope', 'without', 'stop', 'cannot', 'dont', 'wont', 'cant', 'nobody', 'nothing', 'refuse', 'avoid', 'wait']);
const NEG_PHRASES = ['hold off', 'no longer', 'not yet', 'not now', "don't think", 'do not want'];
const NEG_EXCEPTIONS = ["don't forget to", 'no problem', 'not a problem', 'no need to wait', 'stop waiting', 'without delay', 'no worries', 'no rush', 'never mind', 'no doubt', 'no big deal'];
const NEG_WINDOW = 6;

function hasNegation(segment, { before }) {
  let text = ` ${segment.replace(/[,;:()"“”.!?]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const e of NEG_EXCEPTIONS) text = text.split(` ${e} `).join(' ');
  let toks = text.split(' ').filter(Boolean);
  if (before) toks = toks.slice(-NEG_WINDOW);
  const joined = ` ${toks.join(' ')} `;
  if (NEG_PHRASES.some((ph) => joined.includes(` ${ph} `))) return true;
  return toks.some((t) => NEG_TOKENS.has(t) || /n't$/.test(t));
}

// The input words that carry a quote: every occurrence of the normalised quote in the input.
// Returns { ok:false, code, message } or { ok:true, excerpt, attributed, question } where excerpt is
// the containing sentence with the quoted span as «...».
function quoteCheck(inputText, quote) {
  const q = normMap(quote).norm;
  const words = q.split(' ').filter(Boolean).length;
  if (words < MIN_QUOTE_WORDS && q.length < MIN_QUOTE_CHARS) {
    return { ok: false, code: 'quote_mismatch', message: `quote must be at least ${MIN_QUOTE_WORDS} words or ${MIN_QUOTE_CHARS} characters of the operator's exact words` };
  }
  const t = normMap(inputText);
  const hits = [];
  for (let at = t.norm.indexOf(q); at !== -1 && q.length; at = t.norm.indexOf(q, at + 1)) hits.push(at);
  if (!hits.length) return { ok: false, code: 'quote_mismatch', message: 'quote is not a substring of the input (whitespace and case are ignored)' };
  const sentenceOf = (start, end) => {
    let s0 = 0;
    for (let k = start - 1; k >= 0; k--) { if ('.!?\n'.includes(t.base[k])) { s0 = k + 1; break; } }
    let e0 = t.base.length;
    let term = '';
    for (let k = end; k < t.base.length; k++) { if ('.!?\n'.includes(t.base[k])) { e0 = k + 1; term = t.base[k]; break; } }
    return { s0, e0, term };
  };
  // the negation context of the span [start, end) of the NFKC text: the sentence before it (within
  // the look-back window) and the rest of its sentence plus the sentence that follows it (heuristic,
  // documented: a hold or a negation right after an instruction usually qualifies it)
  const context = (start, end) => {
    const sn = sentenceOf(start, end);
    const pre = normMap(t.base.slice(sn.s0, start)).norm;
    let nextEnd = sn.e0;
    if (sn.term) { for (let k = sn.e0; k < t.base.length; k++) { if ('.!?\n'.includes(t.base[k]) && t.base.slice(sn.e0, k).trim()) { nextEnd = k + 1; break; } if (k === t.base.length - 1) nextEnd = t.base.length; } }
    const post = normMap(t.base.slice(end, nextEnd)).norm;
    return { s0: sn.s0, nextEnd, preNeg: hasNegation(pre, { before: true }), postNeg: hasNegation(post, { before: false }) };
  };
  const clean = [];
  for (const at of hits) {
    const c = context(t.map[at], t.map[at + q.length - 1] + 1);
    if (!c.preNeg && !c.postNeg) clean.push(at);
  }
  if (!clean.length) {
    // the smallest span around the first occurrence that carries its negation with it
    let start = t.map[hits[0]];
    let end = t.map[hits[0] + q.length - 1] + 1;
    for (let i = 0; i < 20; i++) {
      const c = context(start, end);
      if (!c.preNeg && !c.postNeg) break;
      if (c.preNeg) start = c.s0;
      if (c.postNeg) end = c.nextEnd;
    }
    const minimal = t.base.slice(start, end).replace(/\s+/g, ' ').trim();
    return { ok: false, code: 'quote_negated', minimal,
      message: `in the input the quoted words sit next to a negation or a hold (not, never, no, stop, wait, ...) that the quote leaves out; quote at least: «${minimal}»` };
  }
  const at = clean[0];
  const start = t.map[at];
  const end = t.map[at + q.length - 1] + 1;
  const before = t.base.slice(0, start);
  const attributed = ((before.match(/"/g) || []).length % 2 === 1) || ((before.match(/“/g) || []).length > (before.match(/”/g) || []).length);
  let { s0, e0, term } = sentenceOf(start, end);
  const question = term === '?' || t.base[end - 1] === '?';
  let cutStart = false;
  let cutEnd = false;
  if (start - s0 > 60) { s0 = start - 60; cutStart = true; }
  if (e0 - end > 60) { e0 = end + 60; cutEnd = true; }
  const flat = (x) => x.replace(/\s+/g, ' ');
  const excerpt = `${cutStart ? '…' : ''}${flat(t.base.slice(s0, start)).trimStart()}«${flat(t.base.slice(start, end))}»${flat(t.base.slice(end, e0)).trimEnd()}${cutEnd ? '…' : ''}`;
  return { ok: true, excerpt, attributed, question };
}

function excerptFor(inputText, quote) {
  const r = quoteCheck(inputText, quote);
  return r.ok ? r.excerpt : null;
}

const DEFAULT_HIGH_STAKES = ['security', 'auth', 'money', 'billing', 'payments', 'irreversible', 'data-deletion', 'release', 'production', 'legal', 'privacy'];
function machineId() { return require('crypto').createHash('sha256').update(require('os').hostname()).digest('hex').slice(0, 12); }

function highStakesLabels(root) {
  try {
    const { team } = loadManifest(root);
    const l = team && team.operator && team.operator.high_stakes_labels;
    if (Array.isArray(l)) return l.map(String);
  } catch (e) { /* default */ }
  return DEFAULT_HIGH_STAKES;
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

// ---- the view: only records that pass validateRecord, in processing order ----

class View {
  constructor() {
    this.byId = new Map();
    this.list = [];
    this.revokedBy = new Map();
    this.supersededBy = new Map();
    this.ratifiedBy = new Map();
    this.answersByQ = new Map();
    this.withdrawnQ = new Map();
    this.underBy = new Map();
    this.acks = [];
    this.inst = new Map(); // instance -> { host, machine } expected from its valid records and rehosts
    this.stamped = new Set(); // instances with at least one valid stamped record
  }

  add(r) {
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    this.byId.set(r.id, r);
    this.list.push(r);
    if (r.kind === 'revocation' && r.target) push(this.revokedBy, r.target, r);
    if (r.supersedes && ((r.kind === 'decision' && !r.under) || r.kind === 'answer')) push(this.supersededBy, r.supersedes, r);
    if (r.kind === 'ratification' && r.target) push(this.ratifiedBy, r.target, r);
    if (r.kind === 'withdrawal' && r.target) push(this.withdrawnQ, r.target, r);
    if (r.kind === 'ack') this.acks.push(r);
    if (r.under && r.kind === 'decision') push(this.underBy, r.under, r);
    if (Array.isArray(r.answers) && ['decision', 'delegation', 'answer'].includes(r.kind)) for (const q of r.answers) push(this.answersByQ, q, r);
    const by = r.by || {};
    if (r.kind === 'rehost' && r.instance && r.to) {
      this.inst.set(r.instance, { host: r.to.host, machine: r.to.machine || null });
      if (r.instance === by.instance && by.host && by.machine) this.stamped.add(by.instance);
      return;
    }
    if (by.host && by.machine) {
      this.stamped.add(by.instance);
      const e = this.inst.get(by.instance);
      if (!e) this.inst.set(by.instance, { host: by.host, machine: by.machine });
      else if (!e.machine && e.host === by.host) e.machine = by.machine;
    }
  }
}

// records a record leans on, as ids (the predecessor in its own chain is added by the scan)
function depsOf(rec) {
  const out = [];
  for (const c of Array.isArray(rec.cites) ? rec.cites : []) if (typeof c === 'string' && !c.startsWith('in-')) out.push(c);
  for (const k of ['under', 'target', 'supersedes']) if (typeof rec[k] === 'string') out.push(rec[k]);
  for (const q of Array.isArray(rec.answers) ? rec.answers : []) out.push(q);
  return out;
}

function bad(code, message, extra) { return { code, message, ...(extra || {}) }; }

function scopeShapeError(scope, what) {
  if (scope === undefined || scope === null) return null;
  if (typeof scope !== 'object' || Array.isArray(scope)) return bad('invalid_scope', `${what} must be an object of beads, labels and initiatives`);
  for (const k of Object.keys(scope)) if (!SCOPE_KEYS.includes(k)) return bad('invalid_scope', `${what} carries the key "${k}"; a scope has only beads, labels and initiatives`);
  for (const k of SCOPE_KEYS) {
    const a = scope[k];
    if (a === undefined) continue;
    if (!Array.isArray(a)) return bad('invalid_scope', `${what}.${k} must be an array`);
    for (const v of a) {
      if (typeof v !== 'string' || !v.trim()) return bad('invalid_scope', `${what}.${k} holds a non-string entry`);
      if (v.includes('*')) return bad('invalid_scope', `${what} entry "${v}" is a wildcard; a scope names beads, labels and initiatives explicitly (--scope bead:ID,label:L,initiative:I)`);
    }
  }
  return null;
}

function scopeTerms(scope) {
  const out = [];
  for (const k of SCOPE_KEYS) for (const v of (scope && scope[k]) || []) out.push(String(v).toLowerCase());
  return out;
}

function questionStatus(view, q) {
  const answering = (view.answersByQ.get(q.id) || []).filter((r) => !(view.revokedBy.get(r.id) || []).length);
  if (answering.length) return 'answered';
  if ((view.withdrawnQ.get(q.id) || []).length) return 'withdrawn';
  return 'open';
}

function isRatified(view, rec, atRec) {
  const list = view.ratifiedBy.get(rec.id) || [];
  return (atRec ? list.filter((x) => before(x, atRec)) : list).length > 0;
}

// answer-to-answer links below an answer (0 when it cites no answer), over valid records
function answerDepth(view, rec, seen = new Set()) {
  if (!rec || seen.has(rec.id)) return 0;
  seen.add(rec.id);
  let max = -1;
  for (const cid of rec.cites || []) {
    const c = view.byId.get(cid);
    if (c && c.kind === 'answer') max = Math.max(max, answerDepth(view, c, seen));
  }
  return max < 0 ? 0 : max + 1;
}

const MANIFEST_HINT = '.delivery/team/team.json cannot be loaded or lists no instances (restore .delivery/team/team.json)';
const REHOST_HINT = (inst) => `run operator.js rehost --instance ${inst} --reason "<why this instance moved>" from the new place first`;

// THE rules. Called before a record is appended (mode 'write') and again for every record on read
// (mode 'read'), against the records that were already valid. Returns null or { code, message }.
function validateCore(st, rec, view, mode) {
  const W = mode === 'write';
  const p = parseRecordId(rec.id);
  if (!p) return bad('chain_invalid', `${rec.id} is not a record id`);
  if (p.kind !== rec.kind) return bad('chain_invalid', `${rec.id} claims kind ${rec.kind}`);
  const by = rec.by;
  if (!by || typeof by !== 'object' || by.instance !== p.instance) return bad('chain_invalid', `${rec.id} has no author matching its chain`);
  const author = p.instance;
  const missingCode = W ? 'not_found' : 'cited_entry_missing';

  // host and machine stamp: one instance, one place, until a rehost record says otherwise
  const selfRehost = rec.kind === 'rehost' && rec.instance === author;
  const stamped = !!(by.host && by.machine);
  if (!stamped) {
    return bad('host_missing', `${rec.id} carries no host and machine stamp (by.host, by.machine); records are written by operator.js from a delivery role session`);
  } else if (!selfRehost) {
    const e = view.inst.get(author);
    if (e && e.host !== by.host) return bad('host_changed', `instance ${author} wrote from host ${e.host} before and from ${by.host} now; ${REHOST_HINT(author)}`);
    if (e && e.machine && e.machine !== by.machine) return bad('machine_mismatch', `instance ${author} wrote from machine ${e.machine} before and from ${by.machine} now, so two sessions share one instance id; give each its own instance in team.json, or ${REHOST_HINT(author)}`);
  }

  const get = (id) => view.byId.get(id) || null;
  const dep = (id, what) => {
    const r = get(id);
    if (r) return { r };
    const why = st.invalid.get(id);
    if (why) return { err: bad(why.code, `${what} ${id} is not valid: ${why.message}`) };
    return { err: bad(missingCode, `${what} ${id} was not found among valid records (operator.js find lists records; operator.js refresh pulls other hosts)`) };
  };
  const headOf = (cid) => (Array.isArray(rec.cites_head) ? rec.cites_head : []).find((h) => h && h.id === cid);
  const hashCheck = (cid, actual) => {
    const h = headOf(cid);
    if (!h) return bad('history_rewritten', `record ${rec.id} carries no cites_head for ${cid}; its citation cannot be checked`);
    if (h.hash !== actual) return bad('history_rewritten', `${cid} no longer matches the hash recorded when ${rec.id} cited it (history rewritten)`);
    return null;
  };
  const stakes = () => new Set(highStakesLabels(st.root).map((x) => String(x).toLowerCase()));
  const tooEarly = (list) => (list || []).filter((x) => before(x, rec));

  // an operator input cited with words: present, intact, human, covered, entitled
  const humanInput = (cid, { delegation = false } = {}) => {
    if (typeof cid !== 'string' || !cid.startsWith('in-')) return { err: bad('chain_invalid', `${rec.id} cites no operator input`) };
    const input = st.localInput(cid);
    if (!input) return { err: bad(missingCode, `input ${cid} cited by ${rec.id} is missing from the inputs log (deleted or not yet pulled: operator.js refresh)`) };
    const hc = hashCheck(cid, input.hash);
    if (hc) return { err: hc };
    const hv = st.inputHost(input.host);
    if (!hv.ok) return { err: bad(hv.code, hv.error, { at: hv.at }) };
    const hd = headOf(cid);
    const ip = log.parseId(cid);
    if (hd.seq && hv.count < hd.seq) return { err: bad('cited_entry_missing', `host ${input.host} chain has ${hv.count} entries but ${rec.id} cited entry ${hd.seq}`) };
    if (ip && hd.seq && ip.seq !== hd.seq) return { err: bad('history_rewritten', `${cid} does not match the sequence recorded by ${rec.id}`) };
    if (input.source !== 'human') return { err: bad('not_human', `input ${cid} is a ${input.source} message, not the operator's own words; only human inputs can be cited (operator.js pending lists them)`) };
    const qc = quoteCheck(input.text, rec.quote);
    if (!qc.ok) return { err: bad(qc.code, `${qc.message} (operator.js show ${cid} prints the operator's words)`) };
    if (!ownsInput(by, input)) return { err: bad('not_allowed', `only the chief of staff or the instance and session that captured ${cid} may record it; send the input id ${cid} to the chief of staff`) };
    if (delegation && !DELEGATORS.has(by.role)) return { err: bad('not_allowed', `only the chief of staff or the product manager records a delegation; send the operator's input id to the chief of staff`) };
    if (W && qc.attributed) st.warn(`quote_may_be_attributed: the quoted words sit inside quotation marks in ${cid}; check the operator is not quoting someone else (operator.js show ${cid})`);
    if (qc.question) return { err: bad('quote_is_question', `the sentence containing the quote is a question, not an instruction; cite the operator's answer to it (operator.js pending lists inputs)`) };
    return { input, qc };
  };

  const text = (v, name) => (typeof v === 'string' && v.trim() ? null : bad('empty', `${name} must not be empty`));
  const sErr = scopeShapeError(rec.scope, 'scope');
  if (sErr) return sErr;
  const sc = { beads: [], labels: [], initiatives: [], ...(rec.scope || {}) };

  const checkAnswersField = (kindOfRec) => {
    if (rec.answers === undefined) return null;
    if (!Array.isArray(rec.answers)) return bad('invalid_answers', 'answers must be an array of question ids');
    for (const qid of rec.answers) {
      const d = dep(qid, 'question');
      if (d.err) return d.err;
      const q = d.r;
      if (q.kind !== 'question') return bad(missingCode, `question ${qid} was not found (operator.js ledger lists questions)`);
      if (questionStatus(view, q) === 'withdrawn') return bad('question_withdrawn', `question ${qid} was withdrawn and cannot be answered (operator.js ledger shows its status)`);
      if (!scopeIsEmpty(q.scope)) {
        if (kindOfRec === 'answer') {
          if (!scopeContained(q.scope, sc)) return bad('scope_not_covered', `the answer's scope does not cover question ${qid} (${missingFrom(q.scope, sc).join(', ')} missing); add it to --scope or answer a narrower question (operator.js ledger shows the question's scope)`);
        } else if (!scopeIntersects(sc, q.scope)) {
          return bad('scope_mismatch', `the scope of this ${kindOfRec} does not overlap the scope of question ${qid}; add --scope with the beads, labels or initiatives it concerns (operator.js ledger shows the question's scope)`);
        }
      }
    }
    return null;
  };

  const checkSupersedesField = (superseder) => {
    if (rec.supersedes === undefined || rec.supersedes === null) return null;
    if (rec.under) return bad('supersede_not_allowed', 'a decision under a delegation cannot supersede anything');
    const d = dep(rec.supersedes, 'superseded record');
    if (d.err) return W ? bad('not_found', `cannot supersede ${rec.supersedes}: no such valid record (operator.js find lists records)`) : d.err;
    const t = d.r;
    if (!['decision', 'delegation', 'answer'].includes(t.kind)) return bad('supersede_not_allowed', `${t.id} is a ${t.kind}; only decisions, delegations and answers can be superseded`);
    if (superseder === 'answer' && t.kind !== 'answer') return bad('supersede_not_allowed', `an answer cannot supersede the operator's ${t.kind} ${t.id}; record the operator's override with operator.js record --supersedes ${t.id}`);
    if (tooEarly(view.supersededBy.get(t.id)).length) return bad('already_superseded', `${t.id} is already superseded; supersede the current record (operator.js find shows it)`);
    return null;
  };

  const sign = [text(rec.statement, 'statement')];
  const citesAre = (list) => Array.isArray(rec.cites) && rec.cites.length === list.length && rec.cites.every((c, i) => c === list[i]);
  const oneCite = () => (Array.isArray(rec.cites) && rec.cites.length === 1 && typeof rec.cites[0] === 'string' && rec.cites[0].startsWith('in-')
    ? null : bad('bad_cites', `${rec.id} must cite exactly one operator input; extra citations are not validated and are refused`));

  switch (rec.kind) {
    case 'decision': {
      if (rec.under) {
        if (!citesAre([rec.under])) return bad('bad_cites', `${rec.id} decides under ${rec.under} and must cite exactly it`);
        const e0 = text(rec.statement, 'statement'); if (e0) return e0;
        const d = dep(rec.under, 'delegation');
        if (d.err) return W ? bad('not_found', `delegation ${rec.under} was not found (operator.js find lists delegations)`) : d.err;
        const del = d.r;
        if (del.kind !== 'delegation') return bad('not_delegation', `${rec.under} is a ${del.kind}, not a delegation; decide --under takes a del- id`);
        const hc = hashCheck(del.id, del.hash);
        if (hc) return hc;
        if (by.role !== 'chief-of-staff' && by.instance !== (del.by && del.by.instance)) {
          return bad('not_allowed', `only the chief of staff or the author of ${del.id} may decide under it; send the question to the chief of staff`);
        }
        const rv = tooEarly(view.revokedBy.get(del.id))[0];
        if (rv) return bad('revoked', `delegation ${del.id} had been revoked by ${rv.id} (${rv.ts}) when ${rec.id} was decided; ask the chief of staff for a fresh decision (operator.js find)`);
        const sp = tooEarly(view.supersededBy.get(del.id))[0];
        if (sp) return bad('superseded', `delegation ${del.id} had been superseded by ${sp.id}; decide under that one (operator.js find)`);
        const lim = del.limits || {};
        if (lim.until && Date.parse(rec.ts) > Date.parse(lim.until)) return bad('expired', `delegation ${del.id} expired at ${lim.until}; ${rec.id} was decided at ${rec.ts}`);
        if (scopeIsEmpty(sc)) return bad('invalid_scope', 'decision scope is empty; name at least one bead, label or initiative explicitly (--scope bead:ID,label:L,initiative:I)');
        if (!scopeContained(sc, del.scope || emptyScope())) return bad('scope_not_covered', `${missingFrom(sc, del.scope || emptyScope()).join(', ')} lies outside delegation ${del.id}; narrow --scope or ask the chief of staff to take it to the operator`);
        if (lim.max_uses) {
          const uses = (view.underBy.get(del.id) || []).filter((x) => x.id !== rec.id && before(x, rec)).length + 1;
          if (uses > lim.max_uses) return bad('max_uses_exceeded', `delegation ${del.id} allows ${lim.max_uses} decisions; ${rec.id} would be number ${uses}; ask the chief of staff for a fresh decision`);
        }
        return checkAnswersField('decision');
      }
      for (const e of sign) if (e) return e;
      const oc = oneCite(); if (oc) return oc;
      const r = humanInput(Array.isArray(rec.cites) ? rec.cites[0] : null);
      if (r.err) return r.err;
      return checkAnswersField('decision') || checkSupersedesField('decision');
    }
    case 'delegation': {
      for (const e of [text(rec.statement, 'statement'), text(rec.grant, 'grant (one sentence stating what is delegated)')]) if (e) return e;
      const oc = oneCite(); if (oc) return oc;
      const r = humanInput(Array.isArray(rec.cites) ? rec.cites[0] : null, { delegation: true });
      if (r.err) return r.err;
      if (scopeIsEmpty(sc)) return bad('invalid_scope', 'delegation scope is empty; name at least one bead, label or initiative explicitly (--scope bead:ID,label:L,initiative:I)');
      const lim = rec.limits || {};
      if (lim.until !== null && lim.until !== undefined && (Number.isNaN(Date.parse(lim.until)) || Date.parse(lim.until) <= Date.parse(rec.ts))) {
        return bad('invalid_limits', `until "${lim.until}" must be a date after the delegation`);
      }
      if (lim.max_uses !== null && lim.max_uses !== undefined && (!Number.isInteger(lim.max_uses) || lim.max_uses < 1)) return bad('invalid_limits', `max_uses "${lim.max_uses}" must be a positive integer`);
      return checkAnswersField('delegation');
    }
    case 'revocation':
    case 'ratification': {
      const oc = oneCite(); if (oc) return oc;
      const r = humanInput(Array.isArray(rec.cites) ? rec.cites[0] : null);
      if (r.err) return r.err;
      const d = dep(rec.target, 'target');
      if (d.err) return W ? bad('not_found', `${rec.target} was not found among valid records (operator.js find lists them)`) : d.err;
      const t = d.r;
      const hc = hashCheck(t.id, t.hash);
      if (hc) return hc;
      if (rec.kind === 'revocation') {
        if (!['delegation', 'decision'].includes(t.kind)) return bad('invalid_target', `${t.id} is a ${t.kind}; only delegations and decisions can be revoked`);
        if (tooEarly(view.revokedBy.get(t.id)).length) return bad('already_revoked', `${t.id} is already revoked`);
      } else {
        if (!((t.kind === 'answer' && t.confidence === 'inferred') || t.kind === 'delegation')) {
          return bad('not_inferred', `${t.id} is not an inferred answer or a delegation; only those are ratified (operator.js pending lists them)`);
        }
        if (tooEarly(view.ratifiedBy.get(t.id)).length) return bad('already_ratified', `${t.id} is already ratified`);
      }
      if (!(Date.parse(r.input.ts) > Date.parse(t.ts))) {
        const c = W ? 'predates_target' : (rec.kind === 'ratification' ? 'ratification_predates_answer' : 'revocation_predates_target');
        return bad(c, `${r.input.id} (${r.input.ts}) was said before ${t.id} existed (${t.ts}); only a later operator input can ${rec.kind === 'ratification' ? 'ratify' : 'revoke'} it. Ask the operator again (the chief of staff asks once, with the record shown)`);
      }
      return null;
    }
    case 'answer': {
      if (by.role !== 'chief-of-staff') return bad('not_allowed', "only the chief of staff answers on the operator's behalf; send the question to the chief of staff (SendMessage) and it answers with a record id");
      for (const e of [text(rec.question, 'question'), text(rec.answer, 'answer')]) if (e) return e;
      if (!Array.isArray(rec.cites) || !rec.cites.length) return bad('empty', 'an answer must cite at least one decision, delegation or earlier answer (--cite dec-N; operator.js find lists them)');
      if (rec.confidence !== 'settled' && rec.confidence !== 'inferred') return bad('invalid_confidence', 'confidence must be settled or inferred');
      const rationale = typeof rec.rationale === 'string' ? rec.rationale.trim() : '';
      if (rec.confidence === 'inferred' && rationale.length < MIN_RATIONALE) {
        return bad('rationale_required', `an inferred answer needs a rationale of at least ${MIN_RATIONALE} characters saying why the cited record extends to this case (--rationale)`);
      }
      const hs = stakes();
      const qs = (Array.isArray(rec.answers) ? rec.answers : []).map((q) => get(q)).filter(Boolean);
      const touched = [...new Set([...scopeTerms(sc), ...qs.flatMap((q) => scopeTerms(q.scope))])];
      const hit = touched.filter((l) => hs.has(l));
      if (rec.confidence === 'inferred' && hit.length) {
        return bad('high_stakes_inferred', `${hit.join(', ')} is high-stakes; an answer touching it is never inferred. Take the question to the operator once, batched in the briefing (operator.js ask)`);
      }
      const cited = [];
      for (const cid of rec.cites) {
        const cp = parseRecordId(cid);
        if (!cp || !['decision', 'delegation', 'answer'].includes(cp.kind)) return bad('invalid_cite', `${cid} cannot be cited by an answer; cite a dec-, del- or ans- record (operator.js find lists them)`);
        const d = dep(cid, 'record');
        if (d.err) return d.err;
        const c = d.r;
        const hc = hashCheck(cid, c.hash);
        if (hc) return hc;
        const rv = tooEarly(view.revokedBy.get(cid))[0];
        if (rv) return bad('revoked', `${cid} had been revoked by ${rv.id} (${rv.ts}) when ${rec.id} cited it; find the current record with operator.js find`);
        const sp = tooEarly(view.supersededBy.get(cid))[0];
        if (sp) return bad('superseded', `${cid} had been superseded by ${sp.id} (${sp.ts}); cite that one (operator.js find)`);
        if (c.kind === 'answer' && c.confidence === 'inferred' && !isRatified(view, c, rec)) {
          if (rec.confidence === 'settled') return bad('not_settled', `${cid} is an inferred answer the operator has not ratified; a settled answer cannot rest on it (answer with --confidence inferred, or cite the underlying decision)`);
          return bad('inferred_chain', `${cid} is an inferred answer the operator has not ratified; an inference cannot rest on another inference. Cite the underlying decision, or have the operator ratify ${cid}`);
        }
        cited.push(c);
      }
      const ansCited = cited.filter((c) => c.kind === 'answer');
      const depth = ansCited.length ? 1 + Math.max(...ansCited.map((c) => answerDepth(view, c))) : 0;
      if (depth > MAX_ANSWER_DEPTH) return bad('answer_depth_exceeded', `this answer would sit ${depth} answers deep (limit ${MAX_ANSWER_DEPTH}); cite the underlying decision instead (operator.js verify shows the path)`);
      if (rec.confidence === 'settled') {
        const union = scopeUnion(cited.map((c) => c.scope));
        if (scopeIsEmpty(sc) && !scopeIsEmpty(union)) return bad('settled_needs_scope', 'a settled answer must name what it touches; give --scope with the beads, labels or initiatives the cited records cover');
        if (!scopeContained(sc, union)) return bad('scope_not_covered', `${missingFrom(sc, union).join(', ')} is not covered by the cited records; narrow --scope, cite a record that covers it, or answer --confidence inferred with a rationale`);
        const unionTerms = new Set(scopeTerms(union));
        const unnamed = touched.filter((l) => hs.has(l) && !unionTerms.has(l));
        if (unnamed.length) return bad('high_stakes_not_named', `${unnamed.join(', ')} is high-stakes; a settled answer must cite a record whose scope names it explicitly`);
      }
      return checkAnswersField('answer') || checkSupersedesField('answer');
    }
    case 'ack': {
      const e0 = text(rec.reason, 'reason'); if (e0) return e0;
      const cid = rec.input;
      if (typeof cid !== 'string' || !citesAre([cid])) return bad('bad_cites', `${rec.id} must cite exactly the input it acknowledges`);
      const input = st.localInput(cid);
      if (!input) return bad(missingCode, `input ${cid} was not found (operator.js pending lists inputs; operator.js sync captures new ones)`);
      const hc = hashCheck(cid, input.hash);
      if (hc) return hc;
      const hv = st.inputHost(input.host);
      if (!hv.ok) return bad(hv.code, hv.error, { at: hv.at });
      if (!ownsInput(by, input)) return bad('not_allowed', `only the chief of staff or the instance and session that captured ${cid} may acknowledge it; send the input id to the chief of staff`);
      return null;
    }
    case 'question': {
      if (!citesAre([])) return bad('bad_cites', `${rec.id} cites nothing and carries no citation`);
      if (by.role !== 'chief-of-staff') return bad('not_allowed', 'only the chief of staff escalates questions to the operator; message the chief of staff with the one question (SendMessage)');
      const e0 = text(rec.text, 'text'); if (e0) return e0;
      const roles = st.roles() || new Map();
      const want = roles.get(rec.asker.instance);
      if (want === undefined) {
        // on read an asker that has since left the manifest keeps its history (its role cannot be re-checked)
        if (W) return bad('unknown_instance', `asker ${rec.asker.instance} is not in team.json; --asker names the instance whose question this is`);
      } else if (rec.asker.role !== want) {
        return bad('role_mismatch', `${rec.id} names asker ${rec.asker.instance} with role ${rec.asker.role}, but team.json gives it the role ${want}`);
      }
      return null;
    }
    case 'withdrawal': {
      if (!citesAre([])) return bad('bad_cites', `${rec.id} carries no citation`);
      if (by.role !== 'chief-of-staff') return bad('not_allowed', 'only the chief of staff withdraws questions');
      const e0 = text(rec.reason, 'reason'); if (e0) return e0;
      const d = dep(rec.target, 'question');
      if (d.err) return W ? bad('not_found', `question ${rec.target} was not found (operator.js ledger lists questions)`) : d.err;
      if (d.r.kind !== 'question') return bad('not_found', `${rec.target} is not a question`);
      const hc = hashCheck(d.r.id, d.r.hash);
      if (hc) return hc;
      const status = questionStatus(view, d.r);
      if (status !== 'open') return bad('not_open', `question ${d.r.id} is ${status}; only open questions are withdrawn (operator.js ledger)`);
      return null;
    }
    case 'rehost': {
      if (!citesAre([])) return bad('bad_cites', `${rec.id} carries no citation`);
      const e0 = text(rec.reason, 'reason'); if (e0) return e0;
      if (typeof rec.instance !== 'string' || !INSTANCE_RE.test(rec.instance)) return bad('invalid_target', 'rehost names no valid instance');
      if (by.role !== 'chief-of-staff' && by.instance !== rec.instance) return bad('not_allowed', 'only the chief of staff or the instance itself records a rehost');
      if (!rec.to || typeof rec.to.host !== 'string' || !rec.to.host) return bad('empty', 'rehost needs the new host');
      const e = view.inst.get(rec.instance);
      if (e) {
        const f = rec.from || {};
        if (f.host !== e.host || (e.machine && f.machine !== e.machine)) return bad('rehost_from_mismatch', `rehost says ${rec.instance} moved from ${f.host}/${f.machine} but its records show ${e.host}/${e.machine}`);
        if (rec.to.host === e.host && (!rec.to.machine || rec.to.machine === e.machine)) return bad('rehost_noop', `${rec.instance} is already on ${e.host}${e.machine ? '/' + e.machine : ''}`);
      }
      if (selfRehost && (rec.to.host !== by.host || (rec.to.machine && rec.to.machine !== by.machine))) return bad('machine_mismatch', 'a rehost recorded by the instance itself must name the place it is written from');
      return null;
    }
    default:
      return bad('chain_invalid', `${rec.id} has unknown kind ${rec.kind}`);
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const COMMON_FIELDS = ['id', 'kind', 'by', 'ts', 'prev', 'hash', 'scope', 'cites', 'cites_head', 'supersedes'];
const KIND_FIELDS = {
  decision: ['statement', 'quote', 'under', 'answers'],
  delegation: ['statement', 'grant', 'quote', 'limits', 'answers'],
  answer: ['question', 'answer', 'confidence', 'rationale', 'ratified', 'answers'],
  revocation: ['target', 'quote'],
  ratification: ['target', 'quote'],
  ack: ['input', 'reason'],
  question: ['text', 'asker', 'options', 'recommendation'],
  withdrawal: ['target', 'reason'],
  rehost: ['instance', 'from', 'to', 'reason'],
};
const ALL_FIELDS = new Set([...COMMON_FIELDS, ...Object.values(KIND_FIELDS).flat()]);

const BY_FIELDS = ['instance', 'role', 'session_id', 'host', 'machine'];
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
// a place an instance writes from: exactly { host, machine } with a host string and a machine string or null
function placeError(v, what, id) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('invalid_rehost', `${id}: ${what} must be { host, machine }`);
  const keys = Object.keys(v).sort();
  if (keys.length !== 2 || keys[0] !== 'host' || keys[1] !== 'machine') return bad('invalid_rehost', `${id}: ${what} must have exactly the keys host and machine`);
  if (!nonEmpty(v.host)) return bad('invalid_rehost', `${id}: ${what}.host must be a non-empty string`);
  if (v.machine !== null && !nonEmpty(v.machine)) return bad('invalid_rehost', `${id}: ${what}.machine must be a non-empty string or null`);
  return null;
}

// A record carries only the fields its kind has; View.add applies fields and nothing else may.
function shapeError(rec) {
  const allowed = new Set([...COMMON_FIELDS, ...(KIND_FIELDS[rec.kind] || [])]);
  for (const k of Object.keys(rec)) {
    if (allowed.has(k)) continue;
    if (!ALL_FIELDS.has(k)) return bad('unknown_field', `${rec.id} carries the field "${k}", which no record kind has`);
    return bad('misplaced_field', `${rec.id} is a ${rec.kind} and may not carry "${k}"`);
  }
  if (rec.supersedes !== null && rec.supersedes !== undefined) {
    if (!((rec.kind === 'decision' && !rec.under) || rec.kind === 'answer')) return bad('misplaced_field', `${rec.id} is a ${rec.kind}${rec.under ? ' under a delegation' : ''} and may not supersede anything`);
  }
  // a quote is the operator's words only where the validator checks it against a cited input: a
  // decision under a delegation cites the delegation, so it carries no quote of its own
  if (rec.kind === 'decision' && rec.under !== undefined && rec.under !== null && rec.quote !== undefined && rec.quote !== null) {
    return bad('misplaced_field', `${rec.id} decides under ${rec.under} and may not carry a quote; the operator's words are the delegation's (operator.js verify ${rec.under})`);
  }
  if (rec.kind === 'question') {
    const a = rec.asker;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return bad('invalid_question', `${rec.id}: asker must be { instance, role, bead }`);
    for (const k of Object.keys(a)) if (!['instance', 'role', 'bead'].includes(k)) return bad('invalid_question', `${rec.id}: asker carries the field "${k}"`);
    if (typeof a.instance !== 'string' || !INSTANCE_RE.test(a.instance)) return bad('invalid_question', `${rec.id}: asker.instance must be an instance id`);
    if (a.role !== null && a.role !== undefined && typeof a.role !== 'string') return bad('invalid_question', `${rec.id}: asker.role must be a string`);
    if (a.bead !== null && a.bead !== undefined && (typeof a.bead !== 'string' || !a.bead.trim())) return bad('invalid_question', `${rec.id}: asker.bead must be a bead id or null`);
    if (rec.options !== undefined && (!Array.isArray(rec.options) || rec.options.some((o) => typeof o !== 'string' || !o.trim()))) return bad('invalid_question', `${rec.id}: options must be an array of non-empty strings`);
    if (rec.recommendation !== undefined && rec.recommendation !== null && (typeof rec.recommendation !== 'string' || !rec.recommendation.trim())) return bad('invalid_question', `${rec.id}: recommendation must be a non-empty string or null`);
  }
  const by = rec.by;
  if (!by || typeof by !== 'object' || Array.isArray(by)) return bad('invalid_by', `${rec.id} has no author object (by)`);
  for (const k of Object.keys(by)) if (!BY_FIELDS.includes(k)) return bad('invalid_by', `${rec.id}: by carries the field "${k}"; an author is { instance, role, session_id, host, machine }`);
  for (const k of ['instance', 'role', 'session_id']) if (!nonEmpty(by[k])) return bad('invalid_by', `${rec.id}: by.${k} must be a non-empty string`);
  // a missing stamp is host_missing (checked with the stamp rules); a present one must be a string
  for (const k of ['host', 'machine']) if (by[k] !== undefined && by[k] !== null && !nonEmpty(by[k])) return bad('invalid_by', `${rec.id}: by.${k} must be a non-empty string`);
  if (rec.kind === 'rehost') {
    const te = placeError(rec.to, 'to', rec.id); if (te) return te;
    if (rec.from !== null) { const fe = placeError(rec.from, 'from', rec.id); if (fe) return fe; }
  }
  if (rec.limits !== undefined) {
    const l = rec.limits;
    if (!l || typeof l !== 'object' || Array.isArray(l)) return bad('invalid_limits', `${rec.id}: limits must be { until, max_uses }`);
    for (const k of Object.keys(l)) if (!['until', 'max_uses'].includes(k)) return bad('invalid_limits', `${rec.id}: limits carries the field "${k}"`);
    if (l.until !== null && l.until !== undefined && !nonEmpty(l.until)) return bad('invalid_limits', `${rec.id}: limits.until must be an ISO date string or null`);
  }
  if (rec.ratified !== undefined && !(rec.kind === 'answer' && rec.confidence === 'inferred' && rec.ratified === null)) {
    return bad('misplaced_field', `${rec.id}: ratified is null on an inferred answer and absent otherwise (ratification is its own record)`);
  }
  return null;
}

// Shape, timestamp, role and the rules of the kind; then the chain's time order.
function validateRecord(st, rec, view, mode) {
  const W = mode === 'write';
  const p = parseRecordId(rec.id);
  if (p && rec.kind === p.kind) {
    const se = shapeError(rec);
    if (se) return se;
    if (typeof rec.ts !== 'string' || !ISO_RE.test(rec.ts) || Number.isNaN(Date.parse(rec.ts))) {
      return bad('bad_timestamp', `${rec.id} has no ISO-8601 UTC timestamp`);
    }
    const by = rec.by;
    if (by && typeof by === 'object' && by.instance === p.instance) {
      const roles = st.roles();
      if (!roles) return bad('manifest_unavailable', `${MANIFEST_HINT}, so the author role cannot be checked`);
      const want = roles.get(p.instance);
      if (want === undefined) {
        if (W) return bad('unknown_instance', `instance ${p.instance} is not in team.json; records are written by instances the manifest lists`);
        // an instance that left the manifest keeps only the history this host recorded while it was
        // listed, judged against the role the manifest gave it then (stored in its head), never the
        // role the record claims
        const h = st.recordedHead(p.instance);
        if (!h || p.seq > h.count) {
          return bad('unknown_instance', `${rec.id} was appended after instance ${p.instance} left team.json (this host recorded ${h ? h.count : 0} of its entries); its role cannot be checked, so it is not trusted`);
        }
        if (typeof h.role !== 'string' || !h.role) {
          return bad('unknown_instance', `instance ${p.instance} left team.json and this host's head for it records no role (an older head), so ${rec.id} cannot be tied to a role and is not trusted; restore the instance in .delivery/team/team.json to re-check it`);
        }
        if (by.role !== h.role) {
          return bad('role_mismatch', `${rec.id} claims role ${by.role}, but instance ${p.instance} had the role ${h.role} when this host last saw it in team.json`);
        }
      } else if (by.role !== want) {
        return bad('role_mismatch', `${rec.id} claims role ${by.role}, but team.json gives instance ${p.instance} the role ${want}`);
      }
    }
  }
  const res = validateCore(st, rec, view, mode);
  if (res) return res;
  const t = Date.parse(rec.ts);
  const prev = p && p.seq > 1 ? st.entries(p.instance)[p.seq - 2] : null;
  // Read: a record dated ahead of this reader's clock is not trusted YET; nothing about that verdict
  // is stored, so it becomes valid once the clock reaches it. Write: a writer whose clock fell behind
  // its own previous record (a clock correction) stamps the previous record's time (see commit), and
  // that record is written: a chain never locks up.
  const clamped = W && prev && rec.ts === prev.ts;
  if (!clamped && t > Date.now() + FUTURE_TOLERANCE_MS) return bad('bad_timestamp', `${rec.id} is dated ${rec.ts}, more than ten minutes ahead of this clock; it is trusted once the clock reaches it`);
  if (prev && Date.parse(prev.ts) > t) return bad('bad_timestamp', `${rec.id} (${rec.ts}) is older than the record before it in its chain (${prev.ts})`);
  return null;
}
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

// ---- store: per-call cache with one refresh on a miss ----

function makeStore(root, opts = {}) {
  const st = {
    root,
    now: opts.now ? new Date(opts.now) : new Date(),
    refreshed: false,
    refreshResult: null,
    files: new Map(),
    _inputs: null,
    _scan: null,
    verified: new Map(),
    inputHosts: new Map(),
    invalid: new Map(),
    warn: typeof opts.onWarning === 'function' ? opts.onWarning : () => {},
    invalidate() { st._roles = undefined; st._heads = null; st.files.clear(); st._inputs = null; st._scan = null; st.verified.clear(); st.inputHosts.clear(); st.invalid = new Map(); },
    miss() {
      if (st.refreshed || typeof opts.refresh !== 'function') return false;
      st.refreshed = true;
      try { st.refreshResult = opts.refresh() || null; } catch (e) { st.refreshResult = { ok: false, reason: String(e && e.message || e) }; }
      st.invalidate();
      return true;
    },
    refreshFailure() {
      const r = st.refreshResult;
      return r && r.ok === false && !r.no_remote ? r : null;
    },
    // the error for an id that could not be found: a failed refresh is the likelier cause
    missing(code, msg) {
      const r = st.refreshFailure();
      if (r) return new OperatorError('refresh_failed', `could not refresh from ${r.remote || 'the upstream'}: ${String(r.reason || 'unknown').split('\n')[0]}; the record may exist on another host`);
      return new OperatorError(code, msg);
    },
    entries(instance) {
      if (!st.files.has(instance)) st.files.set(instance, readEntries(recordsFile(root, instance)));
      return st.files.get(instance);
    },
    // raw lookup (verification walks it and reports chain failures itself)
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
    localInput(id) {
      if (!st._inputs) st._inputs = new Map(log.listInputs(root).map((e) => [e.id, e]));
      return st._inputs.get(id) || null;
    },
    input(id) {
      let e = st.localInput(id);
      if (!e && st.miss()) e = st.localInput(id);
      return e;
    },
    inputHost(host) { return verifyInputHostCached(st, host); },
    // the head this host recorded for a records chain (read once per scan)
    recordedHead(instance) {
      if (!st._heads) st._heads = log.readHeads(root);
      return st._heads[headsKey('records', instance)] || null;
    },
    // instance -> role id from team.json, or null when the manifest cannot be loaded
    roles() {
      if (st._roles === undefined) {
        // a manifest that lists no instance attributes nothing: fail closed exactly as if it were missing
        try { st._roles = new Map(expandInstances(loadManifest(root).team).map((i) => [i.instance, i.role.id])); } catch (e) { st._roles = null; }
        if (st._roles && st._roles.size === 0) st._roles = null;
      }
      return st._roles;
    },

    // Every view reads only chains that verify and, within them, only records that pass the validator.
    scan() {
      if (st._scan) return st._scan;
      const insts = listInstances(root);
      const roles = st.roles();
      const manifest = roles ? new Set(roles.keys()) : null;
      const problems = [];
      const entries = [];
      const heads = log.readHeads(root);
      st._heads = heads;
      if (!manifest) {
        // fail closed: with no manifest nothing is trusted and no head is recorded
        for (const inst of insts) st.verified.set(inst, verifyRecordsFile(root, inst, { setHead: false }));
        if (insts.length) problems.push({ file: '.delivery/team/team.json', code: 'manifest_unavailable', error: `${MANIFEST_HINT}, so no records chain can be attributed to a role and none is trusted` });
      }
      for (const inst of manifest ? insts : []) {
        if (manifest && !manifest.has(inst) && !heads[headsKey('records', inst)]) {
          const peek = verifyRecordsFile(root, inst, { setHead: false });
          st.verified.set(inst, peek);
          problems.push({ file: `records/${inst}`, code: 'unknown_instance', error: `records/${inst}: instance ${inst} is not in team.json and this host has no recorded head for it; its records are not trusted (operator.js quarantine --file records/${inst}.ndjson --reason "<why>" sets it aside)` });
          continue;
        }
        // a remembered instance (recorded head) that left the manifest stays valid history; its head
        // is never advanced by a read
        const v = manifest.has(inst) ? verifyRecordsFileCached(st, inst) : (st.verified.get(inst) || st.verified.set(inst, verifyRecordsFile(root, inst, { setHead: false })).get(inst));
        if (v.ok) {
          for (const e of st.entries(inst)) entries.push(e);
          if (v.torn) problems.push({ file: `records/${inst}`, code: 'torn_tail', error: `records/${inst}: the last line is incomplete (a crash while writing); the valid ${v.count} entries are used. The writer repairs it on its next write, or run operator.js repair --instance ${inst}` });
        } else problems.push({ file: `records/${inst}`, error: v.error, code: v.code });
      }
      for (const [k, h] of Object.entries(heads)) {
        if (!k.startsWith('records/')) continue;
        if (!insts.includes(k.slice('records/'.length)) && h && h.count > 0) {
          problems.push({ file: k, error: `${k}: chain file is missing but ${h.count} entries were recorded`, code: 'truncated' });
        }
      }
      entries.sort(byOrder);
      const all = new Map(entries.map((e) => [e.id, e]));
      const bySeq = new Map(entries.map((e) => [`${parseRecordId(e.id).instance}#${parseRecordId(e.id).seq}`, e]));
      const lines = new Map();
      for (const inst of insts) st.entries(inst).forEach((e, i) => lines.set(e.id, i + 1));
      const view = new View();
      const state = new Set();
      st.invalid = new Map();
      const visit = (rec) => {
        if (state.has(rec.id)) return;
        state.add(rec.id);
        const p = parseRecordId(rec.id);
        if (p.seq > 1) { const prev = bySeq.get(`${p.instance}#${p.seq - 1}`); if (prev) visit(prev); }
        for (const d of depsOf(rec)) { const dr = all.get(d); if (dr) visit(dr); }
        const res = validateRecord(st, rec, view, 'read');
        if (res) {
          st.invalid.set(rec.id, res);
          problems.push({ id: rec.id, file: `records/${p.instance}`, line: lines.get(rec.id), code: 'record_invalid', detail: res.code,
            reason: `${res.code}: ${res.message}`, error: `${res.code}: ${res.message}` });
        } else view.add(rec);
      };
      for (const e of entries) visit(e);
      view.list.sort(byOrder);
      st._scan = { view, problems };
      return st._scan;
    },
    view() { return st.scan().view; },
    all() { return st.scan().view.list; },
    problems() { return st.scan().problems; },
    findV(id) { return st.scan().view.byId.get(id) || null; },
    vrecord(id) {
      let r = st.findV(id);
      if (!r && st.miss()) r = st.findV(id);
      return r;
    },
    index() { return st.scan().view; },
  };
  return st;
}

// ---- chain verification ----

function headsKey(kind, name) { return kind === 'records' ? `records/${name}` : name; }

function chainFail(code, error, extra = {}) { return { ok: false, code, error, ...extra }; }

// Chain, id sequence and head checks for one records file. Advances (never lowers) the local head
// unless opts.setHead is false.
function verifyRecordsFile(root, instance, opts = {}) {
  const file = recordsFile(root, instance);
  if (!fs.existsSync(file)) return chainFail('not_found', `records/${instance}: no such chain file`);
  let raw = fs.readFileSync(file, 'utf8');
  let torn = false;
  let v;
  if (raw.length && !raw.endsWith('\n')) {
    const cut = raw.lastIndexOf('\n') + 1;
    let whole = true;
    try { JSON.parse(raw.slice(cut)); } catch (e) { whole = false; }
    if (!whole) { torn = true; raw = raw.slice(0, cut); }
  }
  if (torn) {
    const tmp = path.join(require('os').tmpdir(), `operator-prefix-${process.pid}-${Date.now()}.ndjson`);
    fs.writeFileSync(tmp, raw);
    try { v = chain.verifyChain(tmp); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* gone */ } }
  } else v = chain.verifyChain(file);
  if (!v.ok) return chainFail('chain_invalid', `records/${instance}: ${v.error}`, { at: v.at });
  const hashes = [];
  let lastSeq = 0;
  const lines = raw.split('\n');
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
  // a listed reader (opts.role: the manifest role of the instance) stores that role with the head, so
  // the instance's history is judged by it if the instance later leaves team.json
  const role = typeof opts.role === 'string' && opts.role ? opts.role : null;
  if (opts.setHead !== false && (!head || hashes.length > head.count)) {
    log.setHead(root, key, { count: hashes.length, last_hash: v.last_hash, ...(role ? { role } : (head && head.role ? { role: head.role } : {})) });
  } else if (opts.setHead !== false && head && role && head.role !== role) {
    log.setHead(root, key, { ...head, role });
  }
  return { ok: true, count: hashes.length, last_hash: v.last_hash, heads: state, torn };
}

function verifyRecordsFileCached(st, instance) {
  if (!st.verified.has(instance)) {
    const roles = st.roles();
    const role = roles ? roles.get(instance) : undefined;
    // only a listed instance's head is advanced (and stamped with its manifest role) by a read
    st.verified.set(instance, verifyRecordsFile(st.root, instance, role === undefined ? { setHead: false } : { role }));
  }
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

// ---- argument shaping ----

function needText(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new OperatorError('empty', `${name} must not be empty`);
  return v;
}

function needBy(by) {
  if (!by || typeof by !== 'object' || typeof by.instance !== 'string' || !INSTANCE_RE.test(by.instance)) {
    throw new OperatorError('not_allowed', 'the author instance is unknown; run operator.js from a delivery role session (prepare-role writes the marker it reads)');
  }
  const out = { instance: by.instance, role: typeof by.role === 'string' ? by.role : 'unknown', session_id: by.session_id || 'unknown' };
  if (by.host) out.host = String(by.host);
  out.machine = by.machine ? String(by.machine) : machineId();
  return out;
}

function inputHead(input) {
  const p = log.parseId(input.id) || {};
  return { id: input.id, host: input.host, seq: p.seq, hash: input.hash };
}

// The chief of staff, or the session that captured the input. The session id is self-asserted, so it
// counts only together with the instance the input was captured under (an input's instance is part
// of its hash-chained entry): copying another session's id is not enough.
function ownsInput(by, input) {
  if (by.role === 'chief-of-staff') return true;
  return !!(by.session_id && by.session_id !== 'unknown' && by.session_id === input.session_id
    && typeof input.instance === 'string' && input.instance === by.instance);
}

// ---- writing: build the record, run the same validator the readers run, append ----

function commit(st, by, fields, ids = []) {
  const root = st.root;
  const inst = by.instance;
  const file = recordsFile(root, inst);
  const roles = st.roles();
  if (!roles) throw new OperatorError('manifest_unavailable', `${MANIFEST_HINT}; nothing can be recorded or trusted until it loads`);
  if (!roles.has(inst)) throw new OperatorError('unknown_instance', `instance ${inst} is not in team.json; records are written by instances the manifest lists`);
  if (fs.existsSync(file)) {
    // writers repair their OWN torn tail (the partial line is kept as evidence); readers only report it
    try { chain.withLock(file + '.lock', () => chain.repairTail(file)); } catch (e) { /* the verification below reports it */ }
  }
  st.invalidate();
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    const v = verifyRecordsFile(root, inst, { role: roles.get(inst) });
    if (!v.ok) throw new OperatorError(['truncated', 'history_rewritten'].includes(v.code) ? v.code : 'chain_invalid', `${v.error}; this chain no longer verifies, so nothing can be appended to it (tell the chief of staff; the project repository history holds the last good copy)`);
  }
  for (const id of ids) if (typeof id === 'string' && id) st.record(id); // pulls once when something is missing
  const view = st.view();
  const last = chain.lastEntryOf(file);
  const lp = last ? parseRecordId(last.id) : null;
  const seq = lp ? lp.seq + 1 : 1;
  const id = `${KIND_PREFIX[fields.kind]}-${inst}-${pad(seq)}`;
  // timestamps never go backwards within a chain: max(now, previous record's ts)
  const stamp = (l) => {
    const now = st.now.toISOString();
    return l && typeof l.ts === 'string' && ISO_RE.test(l.ts) && Date.parse(l.ts) > Date.parse(now) ? l.ts : now;
  };
  const cand = { id, ...fields, by, ts: stamp(last) };
  if (cand.ts !== st.now.toISOString() && Date.parse(cand.ts) > Date.now() + FUTURE_TOLERANCE_MS) {
    st.warn(`clock_behind_chain: this clock (${st.now.toISOString()}) is behind the previous record of records/${inst} (${cand.ts}); the record carries that time and readers trust it once their clocks reach it`);
  }
  const bad1 = validateRecord(st, cand, view, 'write');
  if (bad1) {
    if (bad1.code === 'not_found') throw st.missing('not_found', bad1.message);
    throw new OperatorError(bad1.code, bad1.message);
  }
  const stored = chain.appendEntry(file, (l) => {
    const lp2 = l ? parseRecordId(l.id) : null;
    return { id: `${KIND_PREFIX[fields.kind]}-${inst}-${pad(lp2 ? lp2.seq + 1 : 1)}`, ...fields, by, ts: stamp(l) };
  });
  st.invalidate();
  verifyRecordsFile(root, inst, { role: roles.get(inst) }); // advances the head
  return stored;
}

function afterWrite(o) { if (!o.noLedger) { try { writeLedger(o.projectRoot); } catch (e) { /* best effort */ } } }

function needInput(st, cite) {
  const input = st.input(cite);
  if (!input) throw st.missing('not_found', `input ${cite} was not found; list inputs with operator.js pending, or run operator.js sync and operator.js refresh`);
  return input;
}

function recordDecision(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.statement, 'statement');
  const input = st.input(o.cite);
  const scope = normScope(o.scope);
  const fields = { kind: 'decision', statement: o.statement.trim(), quote: o.quote, cites: [o.cite], cites_head: input ? [inputHead(input)] : [], scope, supersedes: o.supersedes || null };
  const answers = Array.isArray(o.answers) ? o.answers : [];
  if (answers.length) fields.answers = answers;
  const rec = commit(st, by, fields, [...answers, o.supersedes]);
  afterWrite(o);
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
  if (!DELEGATORS.has(by.role)) throw new OperatorError('not_allowed', "only the chief of staff or the product manager records a delegation; send the operator's input id to the chief of staff");
  needText(o.statement, 'statement');
  needText(o.grant, 'grant (one sentence stating what is delegated)');
  const input = st.input(o.cite);
  const scope = normScope(o.scope, { requireNonEmpty: true, what: 'delegation scope' });
  const lim = o.limits || {};
  const until = parseUntil(lim.until, st.now);
  let maxUses = null;
  if (lim.max_uses !== undefined && lim.max_uses !== null && lim.max_uses !== '') {
    maxUses = Number(lim.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new OperatorError('invalid_limits', `max_uses "${lim.max_uses}" must be a positive integer (--max-uses N)`);
  }
  const fields = { kind: 'delegation', statement: o.statement.trim(), grant: o.grant.trim(), quote: o.quote, cites: [o.cite],
    cites_head: input ? [inputHead(input)] : [], scope, limits: { until, max_uses: maxUses }, supersedes: null };
  const answers = Array.isArray(o.answers) ? o.answers : [];
  if (answers.length) fields.answers = answers;
  const rec = commit(st, by, fields, answers);
  afterWrite(o);
  return rec;
}

function decideUnder(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.statement, 'statement');
  const d = st.record(o.under);
  if (!d) throw st.missing('not_found', `delegation ${o.under} was not found (operator.js find lists delegations)`);
  const scope = normScope(o.scope);
  const fields = { kind: 'decision', statement: o.statement.trim(), quote: null, cites: [d.id], cites_head: [{ id: d.id, hash: d.hash }], under: d.id, scope, supersedes: null };
  const answers = Array.isArray(o.answers) ? o.answers : [];
  if (answers.length) fields.answers = answers;
  const rec = commit(st, by, fields, answers);
  afterWrite(o);
  return rec;
}

function revoke(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  const input = st.input(o.cite);
  const t = st.record(o.target);
  const rec = commit(st, by, { kind: 'revocation', target: o.target, quote: o.quote, cites: [o.cite],
    cites_head: [...(input ? [inputHead(input)] : []), ...(t ? [{ id: t.id, hash: t.hash }] : [])], scope: (t && t.scope) || emptyScope(), supersedes: null }, [o.target]);
  afterWrite(o);
  return rec;
}

function ratify(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  const input = st.input(o.cite);
  const t = st.record(o.target);
  const rec = commit(st, by, { kind: 'ratification', target: o.target, quote: o.quote, cites: [o.cite],
    cites_head: [...(input ? [inputHead(input)] : []), ...(t ? [{ id: t.id, hash: t.hash }] : [])], scope: (t && t.scope) || emptyScope(), supersedes: null }, [o.target]);
  afterWrite(o);
  return rec;
}

function recordAnswer(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') throw new OperatorError('not_allowed', "only the chief of staff answers on the operator's behalf; send the question to the chief of staff (SendMessage) and it answers with a record id");
  needText(o.question, 'question');
  needText(o.answer, 'answer');
  if (!Array.isArray(o.cites) || !o.cites.length) throw new OperatorError('empty', 'an answer must cite at least one decision, delegation or earlier answer (--cite dec-N; operator.js find lists them)');
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  const heads = [];
  for (const cid of o.cites) {
    const p = parseRecordId(cid);
    if (!p || !['decision', 'delegation', 'answer'].includes(p.kind)) throw new OperatorError('invalid_cite', `${cid} cannot be cited by an answer; cite a dec-, del- or ans- record (operator.js find lists them)`);
    const c = st.record(cid);
    if (!c) throw st.missing('not_found', `record ${cid} was not found (operator.js find lists records; operator.js refresh pulls other hosts)`);
    heads.push({ id: c.id, hash: c.hash });
  }
  const fields = { kind: 'answer', question: o.question.trim(), answer: o.answer.trim(), confidence: o.confidence, rationale: rationale || null,
    cites: [...o.cites], cites_head: heads, scope: normScope(o.scope), supersedes: o.supersedes || null };
  if (o.confidence === 'inferred') fields.ratified = null;
  const answers = Array.isArray(o.answers) ? o.answers : [];
  if (answers.length) fields.answers = answers;
  const rec = commit(st, by, fields, [...answers, o.supersedes]);
  afterWrite(o);
  return rec;
}

function ack(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.reason, 'reason');
  const input = needInput(st, o.input);
  const rec = commit(st, by, { kind: 'ack', input: input.id, reason: o.reason.trim(), cites: [input.id], cites_head: [inputHead(input)], scope: emptyScope(), supersedes: null });
  afterWrite(o);
  return rec;
}

function recordQuestion(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') throw new OperatorError('not_allowed', 'only the chief of staff escalates questions to the operator; message the chief of staff with the one question (SendMessage)');
  needText(o.text, 'text');
  const a = o.asker === undefined || o.asker === null ? {} : o.asker;
  if (typeof a !== 'object' || Array.isArray(a)) throw new OperatorError('invalid_question', 'asker must be { instance, role, bead }');
  const instance = a.instance === undefined || a.instance === null ? by.instance : a.instance;
  if (typeof instance !== 'string' || !INSTANCE_RE.test(instance)) throw new OperatorError('invalid_question', 'asker.instance must be an instance id (--asker <instance>)');
  if (a.bead !== undefined && a.bead !== null && (typeof a.bead !== 'string' || !a.bead.trim())) throw new OperatorError('invalid_question', 'asker.bead must be a bead id (--bead ID)');
  if (a.role !== undefined && a.role !== null && typeof a.role !== 'string') throw new OperatorError('invalid_question', 'asker.role must be a string');
  // the asker's role comes from the manifest; a stated role must agree with it (checked by the validator)
  const roles = st.roles();
  const derived = roles ? roles.get(instance) : undefined;
  const asker = { instance, role: a.role === undefined || a.role === null ? (derived === undefined ? null : derived) : a.role, bead: a.bead ? a.bead.trim() : null };
  if (o.options !== undefined && o.options !== null && (!Array.isArray(o.options) || o.options.some((x) => typeof x !== 'string'))) throw new OperatorError('invalid_question', 'options must be an array of strings (--options "A|B|C")');
  const options = (o.options || []).map((x) => x.trim()).filter(Boolean);
  if (o.recommendation !== undefined && o.recommendation !== null && typeof o.recommendation !== 'string') throw new OperatorError('invalid_question', 'recommendation must be a string');
  const rec = commit(st, by, { kind: 'question', text: o.text.trim(), asker, scope: normScope(o.scope), options,
    recommendation: o.recommendation && o.recommendation.trim() ? o.recommendation.trim() : null, cites: [], cites_head: [], supersedes: null });
  afterWrite(o);
  return rec;
}

function withdraw(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  if (by.role !== 'chief-of-staff') throw new OperatorError('not_allowed', 'only the chief of staff withdraws questions');
  needText(o.reason, 'reason');
  const q = st.record(o.question);
  if (!q) throw st.missing('not_found', `question ${o.question} was not found (operator.js ledger lists questions)`);
  const rec = commit(st, by, { kind: 'withdrawal', target: q.id, reason: o.reason.trim(), cites: [], cites_head: [{ id: q.id, hash: q.hash }], scope: q.scope || emptyScope(), supersedes: null }, [q.id]);
  afterWrite(o);
  return rec;
}

// An instance moved (host or machine): recorded by the chief of staff or by the instance itself.
function recordRehost(o) {
  const st = makeStore(o.projectRoot, o);
  const by = needBy(o.by);
  needText(o.reason, 'reason');
  if (typeof o.instance !== 'string' || !INSTANCE_RE.test(o.instance)) throw new OperatorError('invalid_target', 'rehost needs --instance <instance>');
  const view = st.view();
  const cur = view.inst.get(o.instance) || null;
  const self = o.instance === by.instance;
  const to = o.to && o.to.host ? { host: String(o.to.host), machine: o.to.machine ? String(o.to.machine) : null } : (self ? { host: by.host, machine: by.machine } : null);
  if (!to || !to.host) throw new OperatorError('empty', 'rehost needs the new host (run it from the new place, or pass --to-host)');
  const rec = commit(st, by, { kind: 'rehost', instance: o.instance, from: cur ? { host: cur.host, machine: cur.machine } : null, to, reason: o.reason.trim(),
    cites: [], cites_head: [], scope: emptyScope(), supersedes: null });
  afterWrite(o);
  return rec;
}

// Local evidence handling; neither records anything in a chain.
function quarantine(o) {
  const root = o.projectRoot;
  if (!o.by || o.by.role !== 'chief-of-staff') throw new OperatorError('not_allowed', 'only the chief of staff quarantines a chain file');
  needText(o.reason, 'reason');
  const im = /^inputs\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d{4}-\d{2})\.ndjson$/.exec(String(o.file || ''));
  if (im) {
    const src = path.join(log.opDir(root), 'inputs', im[1], `${im[2]}.ndjson`);
    if (!fs.existsSync(src)) throw new OperatorError('not_found', `inputs/${im[1]}/${im[2]}.ndjson does not exist here`);
    const dir = path.join(log.opDir(root), 'quarantine');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `inputs-${im[1]}-${im[2]}.ndjson.${Date.now()}`);
    fs.renameSync(src, dest);
    fs.writeFileSync(`${dest}.reason.txt`, `${o.reason.trim()}\nby ${o.by.instance} at ${new Date().toISOString()}\n`);
    try { fs.unlinkSync(`${src}.lock`); } catch (e) { /* none */ }
    log.dropHead(root, log.safeHost(im[1]));
    return { moved_to: path.relative(root, dest) };
  }
  const m = /^(?:records\/)?([A-Za-z0-9][A-Za-z0-9._-]*)\.ndjson$/.exec(String(o.file || ''));
  if (!m) throw new OperatorError('invalid_target', 'quarantine takes --file records/<instance>.ndjson or inputs/<host>/<YYYY-MM>.ndjson');
  const src = recordsFile(root, m[1]);
  if (!fs.existsSync(src)) throw new OperatorError('not_found', `records/${m[1]}.ndjson does not exist here`);
  const dir = path.join(log.opDir(root), 'quarantine');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${m[1]}.ndjson.${Date.now()}`);
  fs.renameSync(src, dest);
  fs.writeFileSync(`${dest}.reason.txt`, `${o.reason.trim()}\nby ${o.by.instance} at ${new Date().toISOString()}\n`);
  try { fs.unlinkSync(`${src}.lock`); } catch (e) { /* none */ }
  log.dropHead(root, headsKey('records', m[1]));
  return { moved_to: path.relative(root, dest) };
}

function repairChain(o) {
  if (typeof o.instance !== 'string' || !INSTANCE_RE.test(o.instance)) throw new OperatorError('invalid_target', 'repair takes --instance <instance>');
  if (!o.by || (o.by.role !== 'chief-of-staff' && o.by.instance !== o.instance)) throw new OperatorError('not_allowed', 'only the chief of staff or the instance itself repairs its chain');
  const file = recordsFile(o.projectRoot, o.instance);
  if (!fs.existsSync(file)) throw new OperatorError('not_found', `records/${o.instance}.ndjson does not exist here`);
  const before0 = fs.readFileSync(file, 'utf8');
  const last = chain.withLock(file + '.lock', () => chain.repairTail(file));
  const after0 = fs.readFileSync(file, 'utf8');
  return { repaired: before0 !== after0, entries: after0.split('\n').filter(Boolean).length, last: last ? last.id : null };
}

// ---- verification ----

function verifyRecord(projectRoot, id, opts = {}) {
  const st = opts.store || makeStore(projectRoot, opts);
  const result = { ok: true, id, chain: [], notes: [], chains: [] };
  const seenChains = new Set();
  const noteChain = (name, v) => {
    if (!v || seenChains.has(name)) return;
    seenChains.add(name);
    result.chains.push({ chain: name, heads: v.heads || 'recorded', count: v.count });
  };
  const fail = (code, error, extra = {}) => {
    const r = (code === 'not_found' || code === 'cited_entry_missing') ? st.refreshFailure() : null;
    result.ok = false;
    if (r) {
      result.code = 'refresh_failed';
      result.error = `could not refresh from ${r.remote || 'the upstream'}: ${String(r.reason || 'unknown').split('\n')[0]}; the record may exist on another host (${error})`;
    } else { result.code = code; result.error = error; }
    Object.assign(result, extra);
    return result;
  };
  const finish = () => {
    result.heads = result.chains.some((c) => c.heads === 'absent') ? 'absent' : 'recorded';
    return result;
  };
  const inputHop = (input, rec, excerpt) => ({ id: input.id, kind: 'input', source: input.source, text: input.text, host: input.host,
    session_id: input.session_id, ts: input.ts, transcript_ref: input.transcript_ref, truncated: input.truncated || undefined,
    excerpt: excerpt || undefined, cited_by: rec ? rec.id : undefined });

  if (String(id).startsWith('in-')) {
    const e = st.input(id);
    if (!e) { fail('not_found', `input ${id} was not found (operator.js refresh pulls other hosts)`); return finish(); }
    const v = verifyInputHostCached(st, e.host);
    if (!v.ok) { fail(v.code, v.error, { at: v.at }); return finish(); }
    noteChain(`inputs/${e.host}`, v);
    result.chain.push(inputHop(e, null));
    return finish();
  }

  const p = parseRecordId(id);
  if (!p) { fail('not_found', `${id} is not a record or input id`); return finish(); }
  if (!st.roles()) { fail('manifest_unavailable', `${MANIFEST_HINT}; no record can be attributed to a role, so none verifies`); return finish(); }
  let rec = st.record(id);
  if (!rec) { fail('not_found', `record ${id} was not found (operator.js refresh pulls other hosts)`); return finish(); }
  // pull once when anything it leans on is missing locally
  const missingDeps = () => {
    const seen = new Set();
    const stack = [rec];
    while (stack.length) {
      const r = stack.pop();
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      for (const c of Array.isArray(r.cites) ? r.cites : []) {
        if (String(c).startsWith('in-')) { if (!st.localInput(c)) return true; } else { const d = st.findRecord(c); if (!d) return true; stack.push(d); }
      }
      for (const k of ['target', 'under']) if (r[k]) { const d = st.findRecord(r[k]); if (!d) return true; stack.push(d); }
    }
    return false;
  };
  if (missingDeps() && st.miss()) rec = st.findRecord(id) || rec;

  // display walk: the path from the record to the operator's words
  const IXV = st.view();
  const walk = (rid, depth, citer) => {
    if (depth > MAX_DEPTH) return;
    if (String(rid).startsWith('in-')) {
      const input = st.localInput(rid);
      if (!input) return;
      const hv = verifyInputHostCached(st, input.host);
      noteChain(`inputs/${input.host}`, hv);
      // the operator's words are shown only through a citation the validator accepted
      const qc = citer && citer.quote && IXV.byId.has(citer.id) ? quoteCheck(input.text, citer.quote) : null;
      if (qc && qc.ok && qc.attributed) result.notes.push(`quote_may_be_attributed: the words cited by ${citer.id} sit inside quotation marks in ${rid}`);
      result.chain.push(inputHop(input, citer, qc && qc.ok ? qc.excerpt : null));
      return;
    }
    const r = st.findRecord(rid);
    if (!r) return;
    const pr = parseRecordId(rid);
    noteChain(`records/${pr.instance}`, verifyRecordsFileCached(st, pr.instance));
    const h = { id: r.id, kind: r.kind, by: r.by, ts: r.ts, scope: r.scope, valid: IXV.byId.has(r.id) };
    if (r.statement !== undefined) h.statement = r.statement;
    if (r.quote && h.valid) h.quote = r.quote;
    if (r.grant) h.grant = r.grant;
    if (r.kind === 'answer') {
      Object.assign(h, { question: r.question, answer: r.answer, confidence: r.confidence, rationale: r.rationale });
      if (r.confidence === 'inferred') {
        const rat = (IXV.ratifiedBy.get(r.id) || [])[0];
        let said = null;
        if (rat) { const ri = st.localInput((rat.cites || [])[0]); said = ri ? (excerptFor(ri.text, rat.quote) || rat.quote) : rat.quote; }
        h.ratified_by = rat ? { id: rat.id, said } : null;
      }
    }
    if (r.kind === 'question') Object.assign(h, { text: r.text, asker: r.asker });
    if (r.kind === 'rehost') Object.assign(h, { instance: r.instance, from: r.from, to: r.to });
    if (r.under) h.under = r.under;
    if (r.target) h.target = r.target;
    if (r.reason) h.reason = r.reason;
    if (r.limits) h.limits = r.limits;
    result.chain.push(h);
    for (const s of IXV.supersededBy.get(r.id) || []) result.notes.push(`${r.id} was superseded by ${s.id} at ${s.ts}`);
    for (const rv of IXV.revokedBy.get(r.id) || []) result.notes.push(`${r.id} was revoked by ${rv.id} at ${rv.ts}${before(rv, citer || r) ? '' : ' (after it was used; it was valid when made)'}`);
    if (r.under) walk(r.under, depth + 1, r);
    else if (r.kind === 'answer') for (const c of r.cites || []) walk(c, depth + 1, r);
    else if (['decision', 'delegation', 'revocation', 'ratification', 'ack'].includes(r.kind)) {
      const c = r.input || (r.cites || [])[0];
      if (c) walk(c, depth + 1, r);
    }
  };
  walk(id, 0, null);

  // validity: the chain it sits in, then the same validator the writer ran
  const cv = verifyRecordsFileCached(st, p.instance);
  if (!cv.ok) { fail(cv.code, cv.error, { at: cv.at }); return finish(); }
  if (IXV.byId.has(id)) return finish();
  const why = st.invalid.get(id);
  if (why) { fail(why.code, why.message, { at: why.at }); return finish(); }
  const chainProblem = st.problems().find((x) => x.file === `records/${p.instance}`);
  fail(chainProblem ? chainProblem.code : 'record_invalid', chainProblem ? chainProblem.error : `${id} is not valid`);
  return finish();
}

// ---- reading ----

function listRecords(projectRoot) { return makeStore(projectRoot).all().slice(); }
function getRecord(projectRoot, id) { return makeStore(projectRoot).findRecord(id); }
// Chains and records excluded from every view, as [{ file, id?, line?, code, reason|error }].
function viewProblems(projectRoot) { return makeStore(projectRoot).problems().slice(); }

function haystack(r) {
  return normalizeWs([r.statement, r.grant, r.answer, r.question, r.quote, r.text].filter((x) => typeof x === 'string').join(' '));
}
function wordsOf(text) { return normalizeWs(text).split(' ').filter(Boolean); }

function normScopeLoose(scope) {
  if (!scope || typeof scope !== 'object') return emptyScope();
  const out = emptyScope();
  for (const k of SCOPE_KEYS) out[k] = Array.isArray(scope[k]) ? scope[k].map(String) : [];
  return out;
}

function find(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const view = st.view();
  const want = normScopeLoose(o.scope);
  const words = o.text ? wordsOf(o.text) : [];
  const kinds = Array.isArray(o.kinds) && o.kinds.length ? o.kinds : null;
  const scoped = !scopeIsEmpty(want);
  const out = [];
  for (const r of st.all()) {
    if (!['decision', 'delegation', 'answer'].includes(r.kind)) continue;
    if (kinds && !kinds.includes(r.kind)) continue;
    if ((view.revokedBy.get(r.id) || [])[0]) continue;
    const superseded = (view.supersededBy.get(r.id) || [])[0];
    if (superseded && !o.all) continue;
    if (scoped && !scopeIntersects(r.scope || emptyScope(), want)) continue;
    if (words.length) { const h = haystack(r); if (!words.every((w) => h.includes(w))) continue; }
    const exactBead = scoped && (r.scope.beads || []).some((b) => (want.beads || []).includes(b));
    out.push({
      id: r.id, kind: r.kind, statement: r.kind === 'answer' ? r.answer : r.statement, question: r.question, quote: r.quote || null,
      grant: r.grant || undefined, scope: r.scope, confidence: r.kind === 'answer' ? r.confidence : undefined,
      ratified: (r.kind === 'answer' && r.confidence === 'inferred') || r.kind === 'delegation' ? isRatified(view, r) : undefined,
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
  out.problems = st.problems().slice();
  return out;
}

function pending(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const view = st.view();
  const handled = new Set();
  for (const r of st.all()) {
    if (!['decision', 'delegation', 'revocation', 'ratification', 'ack'].includes(r.kind)) continue;
    // validation guarantees exactly one cite (an ack: exactly its input); nothing else counts
    const c = r.kind === 'ack' ? r.input : (Array.isArray(r.cites) ? r.cites[0] : null);
    if (typeof c === 'string' && c.startsWith('in-')) handled.add(c);
  }
  const inputs = log.listInputs(projectRoot, { source: 'human', since: o.since || undefined, sessionId: o.sessionId || undefined })
    .filter((e) => !handled.has(e.id));
  const open = st.all().filter((r) => r.kind === 'question' && questionStatus(view, r) === 'open')
    .sort((a, b) => -byOrder(a, b))
    .map((q) => ({ id: q.id, text: q.text, asker: q.asker, scope: q.scope, options: q.options, recommendation: q.recommendation, ts: q.ts }));
  const unratified = st.all().filter((r) => r.kind === 'answer' && r.confidence === 'inferred'
    && !isRatified(view, r) && !(view.supersededBy.get(r.id) || []).length)
    .sort((a, b) => -byOrder(a, b));
  // a delegation stays on the list until the operator's next input is acknowledged or it is ratified
  const glance = st.all().filter((r) => r.kind === 'delegation' && !(view.revokedBy.get(r.id) || []).length
    && !(view.supersededBy.get(r.id) || []).length && !isRatified(view, r)).filter((d) => {
    const own = st.localInput((d.cites || [])[0]);
    const ownTs = own ? Date.parse(own.ts) : Date.parse(d.ts);
    return !view.acks.some((a) => {
      const ai = st.localInput(a.input);
      return ai && Date.parse(ai.ts) > ownTs && Date.parse(a.ts) >= Date.parse(d.ts);
    });
  }).sort((a, b) => -byOrder(a, b));
  const res = { inputs, open_questions: open, unratified_answers: unratified, delegations_awaiting_glance: glance, problems: st.problems().slice() };
  if (o.all) res.acked = view.acks.map((a) => ({ input: a.input, reason: a.reason, by: a.by, ts: a.ts, id: a.id })).reverse();
  return res;
}

// ---- ledger ----

function resolveHuman(st, rec, depth = 0) {
  if (!rec || depth > MAX_DEPTH) return null;
  if (rec.under) return resolveHuman(st, st.findV(rec.under), depth + 1);
  if (rec.kind === 'answer') {
    for (const cid of rec.cites || []) {
      const r = resolveHuman(st, st.findV(cid), depth + 1);
      if (r) return r;
    }
    return null;
  }
  const cid = (rec.cites || []).find((c) => typeof c === 'string' && c.startsWith('in-'));
  if (cid && rec.quote) return { quote: rec.quote, input: cid };
  return null;
}

function grantOf(st, rec, depth = 0) {
  if (!rec || depth > MAX_DEPTH) return null;
  if (rec.grant) return rec.grant;
  if (rec.under) return grantOf(st, st.findV(rec.under), depth + 1);
  return null;
}

function ledger(projectRoot, o = {}) {
  const st = makeStore(projectRoot, o);
  const view = st.view();
  const sinceMs = o.since ? Date.parse(o.since) : null;
  const rows = [];
  for (const q of st.all().filter((r) => r.kind === 'question')) {
    const status = questionStatus(view, q);
    if (o.status && o.status !== status) continue;
    if (o.bead && !((q.asker && q.asker.bead === o.bead) || ((q.scope && q.scope.beads) || []).includes(o.bead))) continue;
    if (sinceMs !== null && !(Date.parse(q.ts) >= sinceMs)) continue;
    const answers = [];
    for (const r of view.answersByQ.get(q.id) || []) {
      if ((view.revokedBy.get(r.id) || []).length) continue;
      const h = resolveHuman(st, r);
      let excerpt = null;
      if (h) { const inp = st.localInput(h.input); if (inp) excerpt = excerptFor(inp.text, h.quote); }
      answers.push({
        id: r.id, kind: r.kind, statement: r.kind === 'answer' ? r.answer : r.statement,
        confidence: r.kind === 'answer' ? r.confidence : 'settled',
        ratified: r.kind === 'answer' && r.confidence === 'inferred' ? isRatified(view, r) : undefined,
        by: r.by, at: r.ts, quote: h ? h.quote : null, excerpt, input: h ? h.input : null, grant: grantOf(st, r) || undefined,
        superseded_by: ((view.supersededBy.get(r.id) || [])[0] || {}).id,
      });
    }
    answers.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id < b.id ? -1 : 1));
    rows.push({
      question: { id: q.id, text: q.text, scope: q.scope, options: q.options || [], recommendation: q.recommendation || null, by: q.by },
      asker: q.asker, asked_at: q.ts, status, answers,
    });
  }
  rows.sort((a, b) => (Date.parse(b.asked_at) - Date.parse(a.asked_at)) || (a.question.id < b.question.id ? 1 : -1));
  rows.problems = st.problems().slice();
  return rows;
}

function cell(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/<!--/g, '&lt;!--')
    .replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

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
    const words = a ? (a.excerpt || (a.quote ? a.quote : '')) : '';
    const answer = a ? `${a.statement}${a.grant ? ` GRANT: ${a.grant}` : ''}` : '';
    lines.push(`| ${[r.question.id, qtext, asker, bead, String(r.asked_at).slice(0, 16).replace('T', ' '), r.status,
      answer, a ? `${a.id}${earlier}` : '', words ? `"${words}"` : '', conf].map(cell).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// Regenerates LEDGER.md; leaves the previous file alone while any chain or record fails validation.
function writeLedger(projectRoot) {
  if (makeStore(projectRoot).problems().length) return false;
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
  OperatorError, normalizeWs, quoteCheck, excerptFor, highStakesLabels, machineId,
  recordDecision, recordAnswer, ratify, recordDelegation, decideUnder, revoke, recordQuestion, withdraw, ack, recordRehost,
  quarantine, repairChain,
  verifyRecord, find, pending, ledger, renderLedger, writeLedger, listRecords, getRecord, viewProblems,
  parseRecordId,
};
