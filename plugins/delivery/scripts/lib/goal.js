// scripts/lib/goal.js — the goal sheet's constraint fields, changed only on the owner's word (R-42).
//
// In the Vault the Chief of Staff set a usage ceiling nobody asked for and paused the team for hours.
// A field that constrains the work (a budget figure or threshold, a pause or stop, the scope list, the
// approval policy, the idle and briefing limits) lives in <project>/.delivery/goal.json and changes only
// on an owner decision made for that change: the record carries the field and value it decides
// (`operator.js record --goal <field>=<value>`), and the owner's quote states that value itself, with its
// unit, and without a negation. A keyword match is not enough: "Do not stop the builders" is no pause.
// The mechanical path is a failed reality-check row (an andon), which lapses when a pass row follows.
// A file rather than a goal bead: the Stop hooks read it on every turn without a bd call, and bd
// metadata is already reserved to the Delivery Manager; the goal bead (phase 6) can point here.
//
// Every read re-checks the record: a revoked record, or a value written by hand with no record, falls
// back to unset (or the default) with a warning. The plugin ships no budget figure.
const fs = require('fs');
const path = require('path');
const { withLock } = require('./lock.js');

const GOAL_REL = path.join('.delivery', 'goal.json');
const NUM = (unit) => (v) => new RegExp(`(?<![0-9.,])${String(v).replace('.', '\\.')}(?![0-9]|[.,][0-9])\\s*${unit}`, 'iu');
const PCT = String.raw`(?:%|\s?per ?cent\b)`;
const FIELDS = {
  'budget.weekly_units': { kind: 'number', unit: NUM(String.raw`units?\b`), words: /\b(?:week|weekly|budget|allowance)\b/i },
  'budget.usage_envelope': { kind: 'percent', unit: NUM(PCT), words: /\b(?:usage|budget|envelope|allowance|ceiling)\b/i },
  'budget.lean_at': { kind: 'percent', unit: NUM(PCT), words: /\blean\b/i },
  idle_minutes: { kind: 'number', unit: NUM(String.raw`(?:minutes?|mins?)\b`), words: /\bidle\b/i, default: 30 },
  briefing_lines: { kind: 'number', unit: NUM(String.raw`lines?\b`), words: /\b(?:briefings?|messages?|updates?)\b/i, default: 12 },
  pause: { kind: 'pause', default: 'off' },
  scope: { kind: 'list' },
  approvals: { kind: 'text', words: /\b(?:approv\w*|permission|allow\w*|sign[- ]off|consent)\b/i },
};
const PAUSE_VALUES = ['paused', 'stopped', 'off'];
const SAY = {
  paused: /\b(?:pause[sd]?|halt|freeze|stop (?:all|everything|the team|the work|work(?:ing)?|the builders?|the sessions?))\b/i,
  stopped: /\bstop (?:all|everything|the team|the work|work(?:ing)?|the project)\b/i,
  off: /\b(?:resume|unpause|restart|continue|carry on|start again|back to work)\b/i,
};
// the role that records each field on the owner's word: the Product Manager owns scope only
const WRITERS = { scope: ['chief-of-staff', 'product-manager'] };
const writersOf = (field) => WRITERS[field] || ['chief-of-staff'];
const TRIGGER_WRITERS = ['chief-of-staff', 'delivery-lead'];
const EVIDENCE_WRITERS = ['delivery-lead', 'reality-checker'];

const fileOf = (root) => path.join(root, GOAL_REL);

function read(root) {
  try {
    const g = JSON.parse(fs.readFileSync(fileOf(root), 'utf8'));
    return g && typeof g === 'object' ? { fields: g.fields || {}, history: Array.isArray(g.history) ? g.history : [] } : { fields: {}, history: [] };
  } catch (err) { return { fields: {}, history: [] }; }
}

function write(root, g) {
  fs.mkdirSync(path.dirname(fileOf(root)), { recursive: true });
  const tmp = `${fileOf(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 2, fields: g.fields, history: g.history }, null, 2)}\n`);
  fs.renameSync(tmp, fileOf(root));
}

// { value } or { error }
function parseValue(field, raw) {
  const f = FIELDS[field];
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { error: `${field} needs a value` };
  if (f.kind === 'number' || f.kind === 'percent') {
    const n = Number(s.replace(/%$/, ''));
    if (!Number.isFinite(n) || n <= 0 || (f.kind === 'percent' && n > 100)) return { error: `${field} must be a positive number${f.kind === 'percent' ? ' up to 100 (a percentage)' : ''}` };
    return { value: n };
  }
  if (f.kind === 'pause') return PAUSE_VALUES.includes(s) ? { value: s } : { error: `pause is one of ${PAUSE_VALUES.join(', ')}` };
  if (f.kind === 'list') {
    const items = s.split(',').map((x) => x.trim()).filter(Boolean);
    return items.length ? { value: items } : { error: 'scope needs at least one item' };
  }
  return { value: s };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a whole word or phrase, in any script, ignoring case ("UI" is not inside "build")
const wholeWord = (text, w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(text);

// The quote states the value: the figure in full with its unit and a word of the field; the pause or
// resume itself; every scope item as a whole word; the approval policy word for word. A negation in
// the quote (not, never, no, don't, ...) refuses it, whatever else it says.
function covers(field, value, quote) {
  const q = String(quote || '').normalize('NFKC');
  if (!q.trim()) return false;
  const f = FIELDS[field];
  let { hasNegation } = {};
  try { ({ hasNegation } = require('./operator-records.js')); } catch (err) { hasNegation = null; }
  // the pause words are themselves in the negation lexicon (stop, wait): judge the rest of the quote
  const rest = f.kind === 'pause' ? q.replace(SAY.paused, ' ').replace(SAY.stopped, ' ') : q;
  if (!hasNegation || hasNegation(rest.toLowerCase(), { before: false })) return false;
  if (f.kind === 'number' || f.kind === 'percent') return f.unit(value).test(q) && f.words.test(q);
  if (f.kind === 'pause') return SAY[value].test(q);
  if (f.kind === 'list') return value.length > 0 && value.every((item) => wholeWord(q, item));
  return f.words.test(q) && wholeWord(q, value);
}

// The structured decision the record carries: a scope label goal:<field>=<value>.
const GOAL_LABEL = /^goal:([a-z_.]+)=(.*)$/s;
function recordedGoal(rec) {
  for (const l of ((rec && rec.scope && rec.scope.labels) || [])) {
    const m = GOAL_LABEL.exec(String(l));
    if (m) return { field: m[1], raw: m[2] };
  }
  return null;
}

// null when the record is an owner decision made for this change (its goal label names this field and
// value), it verifies, is neither revoked nor superseded, and its quote states the value; else the reason.
function recordProblem(root, field, value, record, verifyRecord) {
  if (!/^dec-/.test(String(record || ''))) return 'it needs an owner decision record (dec-...)';
  let v;
  try { v = (verifyRecord || require('./operator-records.js').verifyRecord)(root, record); } catch (err) { v = null; }
  if (!v || !v.ok) return `${record} does not verify (${v ? v.code || v.error : 'no result'})`;
  if ((v.notes || []).some((n) => /revoked|superseded/.test(n))) return `${record} was revoked or superseded`;
  const head = (v.chain || [])[0] || {};
  if (head.kind !== 'decision') return `${record} is not an owner decision`;
  const g = recordedGoal(head);
  const want = parseValue(field, g && g.raw);
  if (!g || g.field !== field || want.error || !same(want.value, value)) return `${record} was not recorded for ${field} = ${shown(value)} (operator.js record --goal ${field}=<value>)`;
  if (!covers(field, value, head.quote)) return `the owner's words in ${record} do not state ${field} = ${shown(value)}`;
  return null;
}
const shown = (v) => (Array.isArray(v) ? v.join(', ') : String(v));

// ---- the mechanical trigger: an andon is a failed check row written by evidence.js ----
// andon:<ev-row-id>. The row must be a fail, written by the Delivery Manager or a Reality Checker, in an
// evidence chain that is intact (and, when the bead is at hand, matches the head recorded in it); it
// closes when a pass row for the same criterion follows. A hand-written file is not an andon.
function andonState(root, rowId, { bead } = {}) {
  const m = /^ev-(.+)-(\d+)$/.exec(String(rowId || ''));
  if (!m) return { open: false, why: `andon:${rowId} is not an evidence row id (ev-<bead>-<n>)` };
  const G = require('./gates.js');
  const ev = G.readEvidenceChecked(root, m[1]);
  const problem = bead ? G.headProblem(ev, bead) : ev.problem;
  if (problem) return { open: false, why: `the evidence of ${m[1]} does not verify: ${problem}` };
  const row = ev.rows.find((r) => r.id === rowId);
  if (!row || row.type !== 'row' || row.result !== 'fail') return { open: false, why: `${rowId} is not a failed check row` };
  if (!EVIDENCE_WRITERS.includes(row.by)) return { open: false, why: `${rowId} was not recorded by the Delivery Manager or a Reality Checker` };
  if (ev.rows.some((r) => r.seq > row.seq && r.type === 'row' && r.criterion === row.criterion && r.result === 'pass' && EVIDENCE_WRITERS.includes(r.by))) return { open: false, why: `${rowId} was followed by a pass` };
  return { open: true, bead: m[1] };
}

function triggerState(root, trigger, opts = {}) {
  const m = /^([a-z]+):(.+)$/.exec(String(trigger || ''));
  if (m && m[1] === 'andon') return andonState(root, m[2], opts);
  if (m && m[1] === 'ci') return { open: false, why: 'the red-CI trigger is not readable yet' };
  return { open: false, why: `unknown trigger ${trigger}; use andon:<failed evidence row id>` };
}

function commit(root, key, entry) {
  return withLock(path.join(root, '.delivery', '.goal.lock'), () => {
    const g = read(root);
    g.fields[key] = entry;
    g.history.push({ field: key, ...entry });
    write(root, g);
    return entry;
  }, { strict: true });
}

// { ok, entry } or { ok: false, error }. who: { root, roleId, instance }.
function set({ root, who, field, value: raw, record, verifyRecord, now }) {
  if (!FIELDS[field]) return { ok: false, error: `unknown field ${field}; fields: ${Object.keys(FIELDS).join(', ')}` };
  if (!who || !writersOf(field).includes(who.roleId)) return { ok: false, error: `${field} is recorded by the ${writersOf(field).length > 1 ? 'Chief of Staff or Product Manager' : 'Chief of Staff'}`, notWriter: true };
  const p = parseValue(field, raw);
  if (p.error) return { ok: false, error: p.error };
  const why = recordProblem(root, field, p.value, record, verifyRecord);
  if (why) return { ok: false, error: why };
  return { ok: true, entry: commit(root, field, { value: p.value, record, by: who.instance, at: now || new Date().toISOString() }) };
}

// A trigger pause is kept apart from the owner's pause: closing the andon never lifts an owner pause.
function pauseOnTrigger({ root, who, trigger, bead, now }) {
  if (!who || !TRIGGER_WRITERS.includes(who.roleId)) return { ok: false, error: 'a trigger pause is recorded by the Delivery Manager or Chief of Staff', notWriter: true };
  const t = triggerState(root, trigger, { bead });
  if (!t.open) return { ok: false, error: t.why };
  return { ok: true, entry: commit(root, 'pause_trigger', { value: 'paused', trigger, by: who.instance, at: now || new Date().toISOString() }) };
}

// Unverified entries: a record that no longer holds, or a value written with no record. Each is
// reported once in the warnings ledger (the detail names the field and why).
function warnUnverified(root, field, why) {
  try { require('./warnings.js').record(root, { kind: 'goal-unverified', rule: 'R-42', detail: `${field} is ignored: ${why}` }); } catch (err) { /* best effort */ }
}

// { value, from, ignored? } — the owner-set value only while its record holds; else the default or null.
function resolve(root, field, { g = read(root), verifyRecord, warn = true } = {}) {
  const e = g.fields[field];
  const fallback = FIELDS[field] && FIELDS[field].default !== undefined ? FIELDS[field].default : null;
  if (!e || e.value === undefined) return { value: fallback, from: 'default' };
  const why = e.record ? recordProblem(root, field, e.value, e.record, verifyRecord) : 'no owner record';
  if (!why) return { value: e.value, from: e.record };
  if (warn) warnUnverified(root, field, why);
  return { value: fallback, from: 'default', ignored: why };
}
const value = (root, field, opts = {}) => resolve(root, field, opts).value;

// { paused, by } — an owner pause while its record holds, or a trigger pause while its andon is open.
function activePause(root, { verifyRecord, g = read(root), warn = true } = {}) {
  const owner = resolve(root, 'pause', { g, verifyRecord, warn });
  if (['paused', 'stopped'].includes(owner.value)) return { paused: true, by: owner.from };
  const t = g.fields.pause_trigger;
  if (t && t.trigger && triggerState(root, t.trigger).open) return { paused: true, by: t.trigger };
  return { paused: false, ...(owner.ignored ? { lapsed: owner.ignored } : {}), ...(t && t.trigger ? { lapsed: `${t.trigger} closed` } : {}) };
}

function showLines(root, opts = {}) {
  const g = read(root);
  const lines = [];
  for (const field of Object.keys(FIELDS)) {
    const r = resolve(root, field, { ...opts, g });
    const e = g.fields[field];
    let s;
    if (r.ignored) s = `${r.value === null ? 'not set' : `${shown(r.value)} (default)`}; the written value is ignored: ${r.ignored}`;
    else if (e) s = `${shown(r.value)} (${r.from}, ${e.at})`;
    else if (r.value === null) s = field.startsWith('budget.') ? 'not set by the owner (budget checks only warn)' : 'not set';
    else s = `${shown(r.value)} (default)`;
    lines.push(`${field}: ${s}`);
  }
  const p = activePause(root, { ...opts, g, warn: false });
  lines.push(`work: ${p.paused ? `paused (${p.by})` : 'not paused'}`);
  return lines;
}

module.exports = { FIELDS, GOAL_REL, read, set, pauseOnTrigger, value, resolve, activePause, covers, showLines, triggerState, recordedGoal, writersOf, TRIGGER_WRITERS };
