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
const FIELDS = {
  'budget.weekly_units': { kind: 'number', unit: /^units?$/, words: /^(?:weekly|budget|allowance|units?)$/ },
  'budget.usage_envelope': { kind: 'percent', words: /^(?:usage|budget|envelope|allowance|ceiling)$/ },
  'budget.lean_at': { kind: 'percent', words: /^lean$/ },
  idle_minutes: { kind: 'number', unit: /^(?:minutes?|mins?)$/, words: /^idle$/, default: 30 },
  briefing_lines: { kind: 'number', unit: /^lines?$/, words: /^(?:briefings?|messages?|updates?)$/, default: 12 },
  pause: { kind: 'pause', default: 'off' },
  // the scope is what the team builds toward; it changes by explicit adds and removes, never wholesale
  scope_add: { kind: 'list', op: 'add' },
  scope_remove: { kind: 'list', op: 'remove' },
  approvals: { kind: 'text', words: /\b(?:approv\w*|permission|allow\w*|sign[- ]off|consent)\b/i },
};
const PAUSE_VALUES = ['paused', 'stopped', 'off'];
// a pause or a resume is a verb addressed to the work or the team ("freeze the design" is not one)
const WORK = String.raw`(?:all|everything|the team|the work|work(?:ing)?|the builders?|the sessions?|all sessions|the project)`;
const SAY = {
  paused: new RegExp(String.raw`\b(?:pause|halt|stop) ${WORK}\b`, 'i'),
  stopped: new RegExp(String.raw`\bstop ${WORK}\b`, 'i'),
  off: new RegExp(String.raw`\b(?:resume ${WORK}|unpause|start again|back to work|(?:the team|everyone|the builders|all sessions) (?:can|may|should) (?:continue|resume|carry on))\b`, 'i'),
};
// a resume tied to a time or another task is about something else: refused
const LATER = /\b(?:tomorrow|tonight|later|next (?:week|month)|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|with the)\b/i;
// a conditional instruction is not a decision to change the goal now
const CONDITIONAL = /\b(?:only if|if|unless|when|whenever|in case|provided|as long as)\b/i;
const SCOPE_ADD = /\b(?:add|include|build|cover|scope is|in scope|into (?:the )?scope|to (?:the )?scope)\b/i;
const SCOPE_REMOVE = /\b(?:remove|drop|cut|exclude|out of (?:the )?scope|from (?:the )?scope|no longer in (?:the )?scope)\b/i;
// the quote must be English for the rule to read it (the typed judge may confirm another language)
const FOREIGN = new Set('pas ne nicht kein keine non nunca jamais nie niemals le la les des du et en une un est die der das und bitte ist el los las por para todo toda hasta que una ein eine mit'.split(' '));
const ENGLISH = new Set('the to of and a an is are for at on all our my your until every each after keep set under with it this that we i be go call can now work team scope approval approvals merges need needs'.split(' '));
// the role that records each field on the owner's word: the Product Manager owns scope changes only
const WRITERS = { scope_add: ['chief-of-staff', 'product-manager'], scope_remove: ['chief-of-staff', 'product-manager'] };
const writersOf = (field) => WRITERS[field] || ['chief-of-staff'];
const TRIGGER_WRITERS = ['chief-of-staff', 'delivery-lead'];
const EVIDENCE_WRITERS = ['delivery-lead', 'reality-checker'];
const JUDGE_MIN = 0.8;

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

// The figure is the object of the field word in the same clause: the field word up to four words
// before it ("budget of 30%", "set the weekly units to 5") or right after its unit ("30 minutes idle").
// The figure matches in full: 30 is not 300, 30.5 or 130.
function figureTied(field, value, q) {
  const f = FIELDS[field];
  for (const clause of q.toLowerCase().split(/[.;!?]|,\s*(?:but|and|so|yet)\b|\bbut\b/)) {
    const t = clause.match(/\d+(?:[.,]\d+)?%?|[\p{L}'-]+|%/gu) || [];
    for (let i = 0; i < t.length; i++) {
      if (t[i].replace(/%$/, '') !== String(value)) continue;
      const before = t.slice(Math.max(0, i - 4), i);
      let after = i + 1;
      let unit;
      if (f.kind === 'percent') {
        unit = t[i].endsWith('%') || t[i + 1] === '%' || t[i + 1] === 'percent' || (t[i + 1] === 'per' && t[i + 2] === 'cent');
        after += t[i].endsWith('%') ? 0 : (t[i + 1] === 'per' ? 2 : 1);
      } else {
        unit = f.unit.test(t[i + 1] || '') || before.some((w) => f.unit.test(w));
        if (f.unit.test(t[i + 1] || '')) after += 1;
      }
      if (unit && (before.some((w) => f.words.test(w)) || f.words.test(t[after] || ''))) return true;
    }
  }
  return false;
}

function isEnglish(q) {
  const w = q.toLowerCase().match(/[\p{L}']+/gu) || [];
  return !w.some((x) => FOREIGN.has(x)) && w.some((x) => ENGLISH.has(x));
}

// null when the owner's quote states the value; else the reason, with language: true when only the
// language check failed (the typed judge may then confirm it). A negation or a conditional refuses it.
function quoteProblem(field, value, quote) {
  // typographic apostrophes as operator-records reads them: Don’t is Don't (Copilot)
  const q = String(quote || '').normalize('NFKC').replace(/[\u2018\u2019\u02BC]/g, "'");
  if (!q.trim()) return { why: 'there is no quote' };
  const f = FIELDS[field];
  let hasNegation = null;
  try { ({ hasNegation } = require('./operator-records.js')); } catch (err) { hasNegation = null; }
  // the rule reads English only: another language needs the typed judge's confirmation instead
  if (!isEnglish(q)) return { why: 'the owner\'s words are not in English; the typed judge must confirm them', language: true };
  if (CONDITIONAL.test(q)) return { why: 'the owner\'s words are conditional, not a decision to change it now' };
  // the pause and removal words are themselves in the negation lexicon (stop, no longer): judge the rest
  const rest = q.replace(SAY.paused, ' ').replace(SAY.stopped, ' ').replace(f.op === 'remove' ? SCOPE_REMOVE : /$^/, ' ');
  if (!hasNegation || hasNegation(rest.toLowerCase(), { before: false })) return { why: 'the owner\'s words carry a negation' };
  let ok;
  if (f.kind === 'number' || f.kind === 'percent') ok = figureTied(field, value, q);
  else if (f.kind === 'pause') ok = SAY[value].test(q) && !(value === 'off' && LATER.test(q));
  else if (f.kind === 'list') ok = value.length > 0 && value.every((item) => wholeWord(q, item)) && (f.op === 'add' ? SCOPE_ADD.test(q) && !SCOPE_REMOVE.test(q) : SCOPE_REMOVE.test(q));
  else ok = f.words.test(q) && wholeWord(q, value);
  if (!ok) return { why: `the owner's words do not state ${field} = ${shown(value)}` };
  return null;
}
const covers = (field, value, quote) => !quoteProblem(field, value, quote);

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
// judge: the typed judge's goal_instruction answer kept with the entry ({ p, model }) or null.
function recordProblem(root, field, value, record, verifyRecord, judge) {
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
  // the primary path: a yes to the question goal.js worded for exactly this change
  const asked = Array.isArray(head.answers_questions) ? head.answers_questions : [];
  if (asked.length) {
    if (asked.length !== 1 || asked[0].text !== questionText(field, value)) return `${record} answers a question that is not goal.js's question for ${field} = ${shown(value)} (goal.js ask ${field} <value>)`;
    const said = ((v.chain || []).find((h) => h.kind === 'input') || {}).text;
    if (!affirmative(said)) return `the owner's answer in ${record} is not a yes`;
    return null;
  }
  // the secondary path, free text: the word rule as pre-filter and the typed judge's yes; with the judge
  // off, free text never sets a constraint
  if (!judge) return `${record} is free text: with the typed judge off, only a yes to goal.js's question sets ${field} (goal.js ask ${field} <value>)`;
  const qp = quoteProblem(field, value, head.quote);
  if (qp) return `${record}: ${qp.why}`;
  if (!(typeof judge.p === 'number' && judge.p >= JUDGE_MIN)) return `the typed judge does not read the owner's words in ${record} as this instruction (p ${Number(judge.p).toFixed(2)})`;
  return null;
}

// The canonical question for a change, in plain words. The owner's whole answer must be a yes.
function questionText(field, value) {
  const p = parseValue(field, value);
  if (!FIELDS[field] || p.error) return null;
  const v = p.value;
  const items = Array.isArray(v) ? (v.length > 1 ? `${v.slice(0, -1).join(', ')} and ${v[v.length - 1]}` : v[0]) : v;
  return {
    'budget.weekly_units': `Set the weekly budget to ${v} units?`,
    'budget.usage_envelope': `Set the usage envelope to ${v}% of the weekly allowance?`,
    'budget.lean_at': `Switch to lean mode at ${v}% of the weekly allowance?`,
    idle_minutes: `Call the team idle after ${v} minutes with ready work and nothing in progress?`,
    briefing_lines: `Keep routine briefings to ${v} lines?`,
    pause: { paused: "Pause the team's work now?", stopped: "Stop the team's work now?", off: "Resume the team's work now?" }[v],
    scope_add: `Add ${items} to the scope?`,
    scope_remove: `Remove ${items} from the scope?`,
    approvals: `Set the approval policy to: ${v}?`,
  }[field];
}
const YES = new Set(['yes', 'y', 'ok', 'okay', 'do it', 'go', 'go ahead', 'confirmed', 'agreed', 'approve', 'approved']);
// the whole input, ignoring case, spaces and closing punctuation
const affirmative = (text) => YES.has(String(text || '').normalize('NFKC').toLowerCase().replace(/[\s.!]+$/u, '').replace(/^\s+/, '').replace(/\s+/g, ' '));

// the quote of a record, for the CLI to ask the judge before set
function recordQuote(root, record, verifyRecord) {
  try { const v = (verifyRecord || require('./operator-records.js').verifyRecord)(root, record); return v && v.ok ? ((v.chain || [])[0] || {}).quote || null : null; } catch (err) { return null; }
}
const shown = (v) => (Array.isArray(v) ? v.join(', ') : String(v));

// ---- the mechanical trigger: an andon is a failed check row written by evidence.js ----
// andon:<ev-row-id>. The row must be a fail, written by the Delivery Manager or a Reality Checker, in an
// evidence chain that is intact (and, when the bead is at hand, matches the head recorded in it); it
// closes when a pass row for the same criterion follows. A hand-written file is not an andon.
// At pause time (atPause) the file must match the head recorded in the bead exactly. At read time,
// with the bead at hand, only the rows up to its recorded head count: a pass appended by hand does not
// lift the andon, and an edited chain keeps it open. Without the bead, the chain alone is checked.
function andonState(root, rowId, { bead, atPause } = {}) {
  const m = /^ev-(.+)-(\d+)$/.exec(String(rowId || ''));
  if (!m) return { open: false, why: `andon:${rowId} is not an evidence row id (ev-<bead>-<n>)` };
  const G = require('./gates.js');
  const ev = G.readEvidenceChecked(root, m[1]);
  let rows = ev.rows;
  if (atPause || !bead) {
    const problem = bead ? G.headProblem(ev, bead) : ev.problem;
    if (problem) return { open: false, why: `the evidence of ${m[1]} does not verify: ${problem}` };
  } else {
    const want = bead.metadata && bead.metadata.evidence_head;
    const n = want ? want.seq : 0;
    const hashAt = n === ev.rows.length ? ev.head && ev.head.hash : (ev.rows[n] && ev.rows[n].prev);
    if (!want || !Number.isInteger(n) || hashAt !== want.hash) return { open: true, bead: m[1], held: 'the evidence no longer matches its recorded head' };
    rows = ev.rows.slice(0, n);
  }
  const row = rows.find((r) => r.id === rowId);
  if (!row || row.type !== 'row' || row.result !== 'fail') return { open: false, why: `${rowId} is not a failed check row` };
  if (!EVIDENCE_WRITERS.includes(row.by)) return { open: false, why: `${rowId} was not recorded by the Delivery Manager or a Reality Checker` };
  if (rows.some((r) => r.seq > row.seq && r.type === 'row' && r.criterion === row.criterion && r.result === 'pass' && r.arm !== 'side' && EVIDENCE_WRITERS.includes(r.by))) return { open: false, why: `${rowId} was followed by a pass` };
  return { open: true, bead: m[1] };
}

function triggerState(root, trigger, opts = {}) {
  const m = /^([a-z]+):(.+)$/.exec(String(trigger || ''));
  if (m && m[1] === 'andon') return andonState(root, m[2], opts);
  if (m && m[1] === 'ci') return { open: false, why: 'the red-CI trigger is not readable yet' };
  return { open: false, why: `unknown trigger ${trigger}; use andon:<failed evidence row id>` };
}
const beadOfTrigger = (trigger) => { const m = /^andon:ev-(.+)-\d+$/.exec(String(trigger || '')); return m ? m[1] : null; };

function commit(root, key, entry, { append = false } = {}) {
  return withLock(path.join(root, '.delivery', '.goal.lock'), () => {
    const g = read(root);
    if (append) g.fields[key] = [...(Array.isArray(g.fields[key]) ? g.fields[key] : []), entry];
    else g.fields[key] = entry;
    g.history.push({ field: key, ...entry });
    write(root, g);
    return entry;
  }, { strict: true });
}

// { ok, entry } or { ok: false, error }. who: { root, roleId, instance }. judged: the typed judge's
// goal_instruction answer ({ p, model }) when the judge is on, else undefined: then the rule alone decides.
function set({ root, who, field, value: raw, record, verifyRecord, judged, now }) {
  if (!FIELDS[field]) return { ok: false, error: `unknown field ${field}; fields: ${Object.keys(FIELDS).join(', ')}` };
  if (!who || !writersOf(field).includes(who.roleId)) return { ok: false, error: `${field} is recorded by the ${writersOf(field).length > 1 ? 'Chief of Staff or Product Manager' : 'Chief of Staff'}`, notWriter: true };
  const p = parseValue(field, raw);
  if (p.error) return { ok: false, error: p.error };
  const judge = judged && typeof judged.p === 'number' ? { p: judged.p, model: judged.model || null } : null;
  const why = recordProblem(root, field, p.value, record, verifyRecord, judge);
  if (why) return { ok: false, error: why };
  const entry = { value: p.value, record, by: who.instance, at: now || new Date().toISOString(), ...(judge ? { judge } : {}) };
  if (FIELDS[field].op) return { ok: true, entry: commit(root, 'scope_log', { op: FIELDS[field].op, ...entry }, { append: true }) };
  return { ok: true, entry: commit(root, field, entry) };
}

// A trigger pause is kept apart from the owner's pause: closing the andon never lifts an owner pause.
function pauseOnTrigger({ root, who, trigger, bead, now }) {
  if (!who || !TRIGGER_WRITERS.includes(who.roleId)) return { ok: false, error: 'a trigger pause is recorded by the Delivery Manager or Chief of Staff', notWriter: true };
  const t = triggerState(root, trigger, { bead, atPause: true });
  if (!t.open) return { ok: false, error: t.why };
  // every open andon is kept: passing one never lifts another (Copilot)
  return { ok: true, entry: commit(root, 'pause_triggers', { value: 'paused', trigger, by: who.instance, at: now || new Date().toISOString() }, { append: true }) };
}

// Unverified entries: a record that no longer holds, or a value written with no record. Each is
// reported once in the warnings ledger (the detail names the field and why).
function warnUnverified(root, field, why) {
  try { require('./warnings.js').record(root, { kind: 'goal-unverified', rule: 'R-42', detail: `${field} is ignored: ${why}` }); } catch (err) { /* best effort */ }
}

// The scope: the adds and removes whose records still hold, in order.
function resolveScope(root, { g, verifyRecord, warn }) {
  const log = Array.isArray(g.fields.scope_log) ? g.fields.scope_log : [];
  const items = [];
  const ignored = [];
  for (const e of log) {
    const field = e.op === 'remove' ? 'scope_remove' : 'scope_add';
    const why = e.record ? recordProblem(root, field, e.value, e.record, verifyRecord, e.judge || null) : 'no owner record';
    if (why) { ignored.push(why); if (warn) warnUnverified(root, field, why); continue; }
    for (const it of e.value || []) {
      const at = items.findIndex((x) => x.toLowerCase() === String(it).toLowerCase());
      if (e.op === 'remove') { if (at >= 0) items.splice(at, 1); } else if (at < 0) items.push(it);
    }
  }
  return { value: log.length ? items : null, from: log.length ? 'scope changes' : 'default', ...(ignored.length ? { ignored: ignored.join('; ') } : {}) };
}

// { value, from, ignored? } — the owner-set value only while its record holds; else the default or null.
function resolve(root, field, { g = read(root), verifyRecord, warn = true } = {}) {
  if (field === 'scope') return resolveScope(root, { g, verifyRecord, warn });
  const e = g.fields[field];
  const fallback = FIELDS[field] && FIELDS[field].default !== undefined ? FIELDS[field].default : null;
  if (!e || e.value === undefined) return { value: fallback, from: 'default' };
  const why = e.record ? recordProblem(root, field, e.value, e.record, verifyRecord, e.judge || null) : 'no owner record';
  if (!why) return { value: e.value, from: e.record };
  if (warn) warnUnverified(root, field, why);
  return { value: fallback, from: 'default', ignored: why };
}
const value = (root, field, opts = {}) => resolve(root, field, opts).value;

// { paused, by } — an owner pause while its record holds, or a trigger pause while its andon is open.
// beadOf(id) gives the bead (from bd) so the andon is read against its recorded evidence head.
function activePause(root, { verifyRecord, g = read(root), warn = true, beadOf } = {}) {
  const owner = resolve(root, 'pause', { g, verifyRecord, warn });
  if (['paused', 'stopped'].includes(owner.value)) return { paused: true, by: owner.from };
  const triggers = [...(Array.isArray(g.fields.pause_triggers) ? g.fields.pause_triggers : []), ...(g.fields.pause_trigger ? [g.fields.pause_trigger] : [])].filter((t) => t && t.trigger);
  for (const t of triggers) {
    let bead = null;
    if (beadOf) { try { bead = beadOf(beadOfTrigger(t.trigger)); } catch (err) { bead = null; } }
    if (triggerState(root, t.trigger, { bead }).open) return { paused: true, by: t.trigger };
  }
  return { paused: false, ...(owner.ignored ? { lapsed: owner.ignored } : {}), ...(triggers.length ? { lapsed: `${triggers.map((t) => t.trigger).join(', ')} closed` } : {}) };
}

const SHOWN = [...Object.keys(FIELDS).filter((f) => !FIELDS[f].op), 'scope'];
function showLines(root, opts = {}) {
  const g = read(root);
  const lines = [];
  for (const field of SHOWN) {
    const r = resolve(root, field, { ...opts, g });
    const e = field === 'scope' ? null : g.fields[field];
    let s;
    if (r.ignored) s = `${r.value === null ? 'not set' : `${shown(r.value)}${field === 'scope' ? '' : ' (default)'}`}; the written value is ignored: ${r.ignored}`;
    else if (e) s = `${shown(r.value)} (${r.from}, ${e.at})`;
    else if (r.value === null) s = field.startsWith('budget.') ? 'not set by the owner (budget checks only warn)' : 'not set';
    else s = `${shown(r.value)} (${r.from === 'default' ? 'default' : r.from})`;
    lines.push(`${field}: ${s}`);
  }
  const p = activePause(root, { ...opts, g, warn: false });
  lines.push(`work: ${p.paused ? `paused (${p.by})` : 'not paused'}`);
  return lines;
}

module.exports = { questionText, affirmative, FIELDS, GOAL_REL, read, set, pauseOnTrigger, value, resolve, activePause, covers, quoteProblem, showLines, triggerState, recordedGoal, recordQuote, writersOf, TRIGGER_WRITERS, JUDGE_MIN };
