// scripts/lib/goal.js — the goal sheet's constraint fields, changed only on the owner's word (R-42).
//
// In the Vault the Chief of Staff set a usage ceiling nobody asked for and paused the team for hours.
// A field that constrains the work (a budget figure or threshold, a pause or stop, the scope list, the
// approval policy, the idle and briefing limits) lives in <project>/.delivery/goal.json and changes only
// when an owner decision record verifies and its quote covers the change, or through a mechanical
// trigger (an open andon). A file rather than a goal bead: the Stop hooks read it on every turn without
// a bd call, and bd metadata is already reserved to the Delivery Manager; the goal bead (phase 6) can
// point here. Every change is appended to the file's history with its record or trigger.
//
// The plugin ships no budget figure: a budget field is null until the owner sets one, and every budget
// check only warns until then. idle_minutes (30) and briefing_lines (12) have defaults the owner can change.
const fs = require('fs');
const path = require('path');
const { withLock } = require('./lock.js');

const GOAL_REL = path.join('.delivery', 'goal.json');
const BUDGET_WORDS = ['budget', 'usage', 'unit', 'weekly', 'week', 'allowance', 'limit', 'ceiling', 'envelope', 'spend', 'cap'];
const FIELDS = {
  'budget.weekly_units': { kind: 'number', words: BUDGET_WORDS },
  'budget.usage_envelope': { kind: 'percent', words: BUDGET_WORDS },
  'budget.lean_at': { kind: 'percent', words: ['lean', ...BUDGET_WORDS] },
  idle_minutes: { kind: 'number', words: ['idle', 'minute', 'wait', 'quiet'], default: 30 },
  briefing_lines: { kind: 'number', words: ['line', 'briefing', 'short', 'long', 'message'], default: 12 },
  pause: { kind: 'pause', default: 'off' },
  scope: { kind: 'list' },
  approvals: { kind: 'text', words: ['approv', 'permission', 'allow', 'sign-off', 'sign off', 'consent'] },
};
const PAUSE_VALUES = ['paused', 'stopped', 'off'];
const PAUSE_WORDS = /\b(?:pause|paused|stop|stopped|halt|hold|freeze|idle|wait)\b/i;
const RESUME_WORDS = /\b(?:resume|continue|restart|unpause|go ahead|carry on|start again|back to work)\b/i;
// who may change a field on an owner record, and who may pause on a trigger
const RECORD_WRITERS = ['chief-of-staff', 'product-manager'];
const TRIGGER_WRITERS = ['chief-of-staff', 'delivery-lead'];
const STOP = new Set('the and for with that this from into only then than when what which will would should could have has are was were not but you your our its all any each'.split(' '));

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
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, fields: g.fields, history: g.history }, null, 2)}\n`);
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
  if (f.kind === 'list') return { value: s.split(',').map((x) => x.trim()).filter(Boolean) };
  return { value: s };
}

const wordsOf = (s) => String(s).toLowerCase().split(/[^a-z0-9%-]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const hasWord = (quote, words) => words.some((w) => quote.includes(w));

// Does the owner's quote cover this change? A deterministic rule, deliberately strict: the CoS writes
// the value in the owner's own words. Numbers must appear in the quote with a word of the field.
function covers(field, value, quote) {
  const q = String(quote || '').toLowerCase();
  if (!q) return false;
  const f = FIELDS[field];
  if (f.kind === 'number' || f.kind === 'percent') return new RegExp(`(?:^|[^0-9.])${String(value).replace('.', '\\.')}(?![0-9])`).test(q) && hasWord(q, f.words);
  if (f.kind === 'pause') return value === 'off' ? RESUME_WORDS.test(q) : PAUSE_WORDS.test(q);
  if (f.kind === 'list') return value.every((item) => wordsOf(item).every((w) => q.includes(w)));
  const need = wordsOf(value).filter((w) => w.length >= 4);
  return hasWord(q, f.words) && need.filter((w) => q.includes(w)).length * 2 >= need.length;
}

// null when the record is an owner decision that verifies, is neither revoked nor superseded, and
// whose quote covers the change; else the reason.
function recordProblem(root, field, value, record, verifyRecord) {
  if (!/^dec-/.test(String(record || ''))) return 'it needs an owner decision record (dec-...)';
  let v;
  try { v = (verifyRecord || require('./operator-records.js').verifyRecord)(root, record); } catch (err) { v = null; }
  if (!v || !v.ok) return `${record} does not verify (${v ? v.code || v.error : 'no result'})`;
  if ((v.notes || []).some((n) => /revoked|superseded/.test(n))) return `${record} was revoked or superseded`;
  const head = (v.chain || [])[0] || {};
  if (head.kind && head.kind !== 'decision') return `${record} is a ${head.kind}, not an owner decision`;
  if (!covers(field, value, head.quote)) return `the owner's words in ${record} do not cover ${field} = ${Array.isArray(value) ? value.join(', ') : value}`;
  return null;
}

// The mechanical triggers that may pause work without an owner record. A hook point: andon.js (phase 5)
// writes .delivery/andon/<id>.json; red CI on an area is not readable yet, so it is refused.
const TRIGGERS = {
  andon(root, id) {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return { open: false, why: 'bad andon id' };
    try {
      const a = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'andon', `${id}.json`), 'utf8'));
      return a && a.status === 'open' ? { open: true } : { open: false, why: `andon ${id} is not open` };
    } catch (err) { return { open: false, why: `no andon ${id}` }; }
  },
  ci() { return { open: false, why: 'the red-CI trigger is not readable yet' }; },
};

function triggerState(root, trigger) {
  const m = /^([a-z]+):(.+)$/.exec(String(trigger || ''));
  if (!m || !TRIGGERS[m[1]]) return { open: false, why: `unknown trigger ${trigger}; use andon:<id>` };
  return TRIGGERS[m[1]](root, m[2]);
}

function commit(root, field, entry) {
  return withLock(path.join(root, '.delivery', '.goal.lock'), () => {
    const g = read(root);
    g.fields[field] = entry;
    g.history.push({ field, ...entry });
    write(root, g);
    return entry;
  }, { strict: true });
}

// { ok, entry } or { ok: false, error }. who: { root, roleId, instance }.
function set({ root, who, field, value: raw, record, verifyRecord, now }) {
  if (!FIELDS[field]) return { ok: false, error: `unknown field ${field}; fields: ${Object.keys(FIELDS).join(', ')}` };
  if (!who || !RECORD_WRITERS.includes(who.roleId)) return { ok: false, error: 'only the Chief of Staff or Product Manager session records an owner decision here' };
  const p = parseValue(field, raw);
  if (p.error) return { ok: false, error: p.error };
  const why = recordProblem(root, field, p.value, record, verifyRecord);
  if (why) return { ok: false, error: why };
  return { ok: true, entry: commit(root, field, { value: p.value, record, by: who.instance, at: now || new Date().toISOString() }) };
}

function pauseOnTrigger({ root, who, trigger, now }) {
  if (!who || !TRIGGER_WRITERS.includes(who.roleId)) return { ok: false, error: 'a trigger pause is recorded by the Delivery Manager or Chief of Staff session' };
  const t = triggerState(root, trigger);
  if (!t.open) return { ok: false, error: t.why };
  return { ok: true, entry: commit(root, 'pause', { value: 'paused', trigger, by: who.instance, at: now || new Date().toISOString() }) };
}

// The owner-set value, the default, or null (a budget field the owner never set).
function value(root, field, g = read(root)) {
  const e = g.fields[field];
  if (e && e.value !== undefined) return e.value;
  return FIELDS[field] && FIELDS[field].default !== undefined ? FIELDS[field].default : null;
}

// A pause counts only while its record still verifies or its trigger is still open.
// { paused, by } — by is the record or trigger.
function activePause(root, { verifyRecord, g = read(root) } = {}) {
  const e = g.fields.pause;
  if (!e || !['paused', 'stopped'].includes(e.value)) return { paused: false };
  if (e.trigger) return triggerState(root, e.trigger).open ? { paused: true, by: e.trigger } : { paused: false, lapsed: e.trigger };
  return recordProblem(root, 'pause', e.value, e.record, verifyRecord) ? { paused: false, lapsed: e.record } : { paused: true, by: e.record };
}

function showLines(root, opts = {}) {
  const g = read(root);
  const lines = [];
  for (const [field, f] of Object.entries(FIELDS)) {
    const e = g.fields[field];
    const v = value(root, field, g);
    let shown;
    if (e) shown = `${Array.isArray(e.value) ? e.value.join(', ') : e.value} (${e.record || e.trigger}, ${e.at})`;
    else if (v === null) shown = field.startsWith('budget.') ? 'not set by the owner (budget checks only warn)' : 'not set';
    else shown = `${v} (default)`;
    lines.push(`${field}: ${shown}`);
  }
  const p = activePause(root, { ...opts, g });
  if (p.lapsed) lines.push(`pause lapsed: ${p.lapsed} no longer holds, so work is not paused`);
  return lines;
}

module.exports = { FIELDS, GOAL_REL, read, set, pauseOnTrigger, value, activePause, covers, showLines, triggerState, TRIGGERS, RECORD_WRITERS, TRIGGER_WRITERS };
