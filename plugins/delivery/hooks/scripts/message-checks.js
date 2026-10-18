// hooks/scripts/message-checks.js — what the Chief of Staff and Product Manager tell the owner (R-03, R-44, R-45).
//
// The owner runs the enterprise; the Chief of Staff is not its operator. In the Vault 78% of the Chief of
// Staff's owner messages drew a correction: orders ("open session X and type"), justification, apology,
// internal ids the owner had to decode, "live" with nothing checked. Owner: "The delivery plugin helps
// users shipping working products, it is not a wannabe therapist."
//
// Checks on a final message of an operator-facing role, run by the Stop hook (claim-stop.js):
//   orders   the message tells the owner to do something that is not in the owner queue. The typed judge's
//            orders_owner p >= 0.5 warns; p >= block_threshold together with such an imperative blocks once
//            per turn (only while the catalogue does not mark the question warn-only). Judge off: warn only.
//   length   a routine briefing (no question to the owner) longer than briefing_lines (12; the owner may
//            change it on the goal sheet): warn.
//   ids      internal ids and codes (R-34, D5, bead ids, dec-/ev-/q- ids, paths, script and hook names,
//            commit shas), except in links and when the owner's last message asked for them: warn.
//   tone     the judge's tone_violation (justifying, condescending, therapeutic) and jargon: warn.
//   claim    live, shipped or verified without an evidence read (evidence.js check or list) in this turn's
//            commands, unless the message says "not checked yet": warn.
// Every warning goes to the ledger and is said once on the next prompt. Nothing here throws.
const RG = require('./relay-guard.js');

const ORDER_VERBS = new Set(('open type paste click run go sign log approve press enter copy restart reboot install set add create configure '
  + 'grant accept update delete push merge review test try unlock switch reply send tell forward check drop upload download change turn '
  + 'enable disable remove rotate generate visit start stop kill pick choose').split(' '));
const OFFER = /\b(?:should i|shall i|do you want me to|would you like me to|want me to|is it ok if i|can i|may i)\b/;
const SPLIT = /\s*(?:—|–|\s-\s|→|:(?=\s|$))\s*/;
const DECISION_Q = /\bor\b|\bwhich\b|\bdo you want\b|\bwould you (?:prefer|rather)\b/;
const NO_ASK = /\b(?:no need to|nothing (?:is )?needed|nothing for you|no action)\b/;
// asked back to the sender ("tell me when it is done", "ask for details"): not an order
const BACK_TO_ME = /^(?:(?:then|and|just|please|so),?\s+)*(?:tell|ask|let|show|send|give|message|ping)\s+(?:me|us)\b|^ask for (?:details|more)\b/;

// Clauses that tell the owner to do something: an address mark ("please", "you need to", "can you")
// or a bare imperative with an action verb. A decision question ("A or B?") and an offer are not orders.
function ownerImperatives(text, { parties } = {}) {
  const out = [];
  try {
    const re = RG.compile(parties || []);
    for (const { raw, c, q } of RG.clauses(text)) {
      if (OFFER.test(c) || NO_ASK.test(c) || BACK_TO_ME.test(c)) continue;
      // "One step for you: sign in ..." — after a short lead, the rest is a clause of its own
      const sp = SPLIT.exec(c);
      const parts = [c, ...(sp && sp.index <= 60 ? [c.slice(sp.index + sp[0].length)] : [])];
      const hit = parts.some((x) => {
        const a = RG.addressOf(x, re);
        const marked = a.explicit || a.strong;
        if (q && (!marked || DECISION_Q.test(x))) return false;
        return marked || (a.imperative && ORDER_VERBS.has(a.verb));
      });
      if (hit) out.push(raw.replace(/\s+/g, ' ').slice(0, 200));
    }
  } catch (err) { /* a heuristic never fails the stop */ }
  return out;
}

// ---- id-like tokens (owner ruling 10) ----
const ID_PATTERNS = [
  /\b[A-Z]{1,5}-\d+(?:\.\d+)*\b/g, // R-34, OD-01, J-2
  /\bD[1-5]\b/g, // divergence codes
  /\b(?:dec|ev|q|ans|in|del|w|o)-[a-z0-9-]*\d[a-z0-9-]*\b/g, // record, evidence, question, warning ids
  /(?:^|[\s(`'"])(?:~|\.{1,2})?\/?(?:[\w.@-]+\/)+[\w.@-]+\.\w{1,8}\b/g, // file paths
  /\b[A-Za-z]:\\[^\s]+/g, // windows paths
  /\b[\w-]+\.(?:js|ts|py|sh|json|ndjson|toml|ya?ml|md|ps1)\b/g, // script, config and doc names
  /\b(?:bd|git|gh|operator|goal)-(?:read|write|claim|notes|structure|create-child|write-project|write-product)\b/g, // lane groups
  /\b[a-z]+-guard\b|\b(?:Stop|PreToolUse|PostToolUse|UserPromptSubmit) hook\b/g, // hook names
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, // commit shas
];
const ASKED_FOR_IDS = /\b(?:ids?|bead|beads|record|records|pr|prs|pull requests?|commit|sha|links?|path|paths|file|files|evidence|proof|details?|which one)\b/i;

function idTokens(text, { prefix, owner } = {}) {
  if (owner && ASKED_FOR_IDS.test(owner)) return [];
  const body = String(text || '').replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\bhttps?:\/\/\S+/g, ' ');
  const p = String(prefix || '').replace(/[^a-z0-9]/gi, '');
  const pats = [new RegExp(`\\b(?:vault${p ? `|${p}` : ''})-[a-z0-9]+(?:\\.[a-z0-9]+)*\\b`, 'g'), ...ID_PATTERNS];
  const found = new Set();
  for (const re of pats) for (const m of body.match(re) || []) found.add(m.trim());
  return [...found];
}

// ---- routine briefing length ----
function lineCount(text) { return String(text || '').split('\n').filter((l) => l.trim()).length; }
// a briefing asks the owner nothing (a question to the owner may run longer, with its options)
function isBriefing(text) { return !RG.clauses(text).some((x) => x.q); }

// ---- acceptance words need an evidence read this turn (R-03) ----
const LIVE = /\b(?:is|are|now|it'?s|went|goes|been)\s+(?:live|shipped|verified)\b|\blive (?:in|on) (?:production|prod|the customer'?s?|your)\b|\bchecked on (?:the|your) (?:customer'?s?|real)\b|\bworks? (?:now )?(?:in|on) (?:your|the customer'?s?|the real)\b/i;
const NOT_LIVE = /\bnot (?:yet )?(?:live|shipped|verified|checked)\b|\bnot checked yet\b|\bunverified\b/i;
const EVIDENCE_READ = /\bevidence\.js\s+(?:check|list)\b/;

function unbackedClaim(text, commands) {
  for (const { raw } of RG.clauses(text)) {
    if (LIVE.test(raw) && !NOT_LIVE.test(raw)) return (commands || []).some((c) => EVIDENCE_READ.test(c)) ? null : raw.replace(/\s+/g, ' ').slice(0, 120);
  }
  return null;
}

// ---- the typed judge on the message ----
const ROLE_NAMES = { 'chief-of-staff': 'Chief of Staff', 'product-manager': 'Product Manager' };
const MESSAGE_QUESTIONS = ['orders_owner', 'tone_violation', 'jargon'];

// { orders_owner, tone_violation, jargon } — each a typed result, or null when the judge is off.
async function judgeMessage({ input, team, role, retired, projectRoot, deps = {} } = {}) {
  const none = { orders_owner: null, tone_violation: null, jargon: null };
  try {
    if (!RG.OPERATOR_FACING.has(role) || retired) return none;
    const judge = require('../../scripts/lib/judge.js');
    const env = deps.env || process.env;
    const cfg = judge.judgeConfig(team, env);
    if (!cfg.enabled) return none;
    const message = RG.strip(String((input && input.last_assistant_message) || '')).trim();
    if (!message) return none;
    const state = { sender_role: ROLE_NAMES[role], message };
    const answers = await Promise.all(MESSAGE_QUESTIONS.map((q) => judge.ask(q, state, { config: cfg, env, projectRoot, gate: 'message-checks', timeoutMs: deps.timeoutMs || 2000 })));
    const out = { ...none, block_threshold: cfg.block_threshold, warn_threshold: cfg.warn_threshold };
    MESSAGE_QUESTIONS.forEach((q, i) => { out[q] = answers[i] && !answers[i].skipped && !answers[i].error ? answers[i] : null; });
    return out;
  } catch (err) { return none; }
}

function catalogueField(q, k) {
  try { return require('../../scripts/lib/judge.js').loadCatalogue().questions[q][k]; } catch (err) { return undefined; }
}
// a question blocks only while the catalogue does not hold it to warn-only (the labelled check decides)
const catalogueMode = (q) => catalogueField(q, 'mode') || 'warn-only';

// { candidates: [{ kind: 'orders', reason }], warnings: [{ kind, rule, detail }] }
function messageFindings({ message, owner, commands, role, judged = {}, openSteps = [], briefingLines = 12, prefix, parties, queueCmd = 'owner-queue.js', ordersMode }) {
  const candidates = [];
  const warnings = [];
  if (!RG.OPERATOR_FACING.has(role) || typeof message !== 'string' || !message.trim()) return { candidates, warnings };
  const Q = require('../../scripts/lib/owner-queue.js');
  const orders = ownerImperatives(message, { parties }).filter((c) => !Q.inQueue(c, openSteps));
  const o = judged.orders_owner;
  const p = o && typeof o.p === 'number' ? o.p : null;
  const block = judged.block_threshold || 0.8;
  if (p !== null && p >= block && orders.length && (ordersMode === undefined ? catalogueMode('orders_owner') : ordersMode) !== 'warn-only') {
    candidates.push({ kind: 'orders', reason: `You told the owner to do something: "${orders[0].slice(0, 80)}". Do it through the team, or queue a real owner step:\n\`${queueCmd} add --kind <signin|consent|payment|secret|account|decision> --what '...' --where '...' --steps '...'\``, detail: orders[0] });
  } else if (p !== null ? p >= 0.5 : orders.length) {
    warnings.push({ kind: 'orders-owner', rule: 'R-44', detail: `told the owner to act outside the owner queue${orders[0] ? `: "${orders[0].slice(0, 120)}"` : ''}${p !== null ? ` (judge p ${p.toFixed(2)})` : ''}` });
  }
  const n = lineCount(message);
  if (n > briefingLines && isBriefing(message)) warnings.push({ kind: 'briefing-length', rule: 'R-45', detail: `a routine briefing of ${n} lines (limit ${briefingLines})` });
  const ids = idTokens(message, { prefix, owner });
  if (ids.length) warnings.push({ kind: 'jargon', rule: 'R-45', detail: `internal ids or names in an owner message: ${ids.slice(0, 8).join(', ')}` });
  const j = judged.jargon;
  if (!ids.length && j && typeof j.p === 'number' && j.p >= (catalogueField('jargon', 'warn_at') || 0.5)) warnings.push({ kind: 'jargon', rule: 'R-45', detail: `the judge rates the owner message as jargon (p ${j.p.toFixed(2)})` });
  const t = judged.tone_violation;
  if (t && t.answer && t.answer !== 'none' && (t.confidence || 0) >= 0.5) warnings.push({ kind: 'tone', rule: 'R-45', detail: `the owner message reads as ${t.answer} (judge ${Number(t.confidence).toFixed(2)})` });
  const claim = unbackedClaim(message, commands);
  if (claim) warnings.push({ kind: 'claim-unchecked', rule: 'R-03', detail: `"${claim}" with no evidence read this turn` });
  return { candidates, warnings };
}

// One line for the next prompt from the warnings of this stop (R-46: short, ends with what to do).
function reminderText(warnings) {
  if (!warnings.length) return '';
  const what = [...new Set(warnings.map((w) => ({ 'orders-owner': 'an order to the owner outside the queue', 'briefing-length': 'a long briefing', jargon: 'internal ids or jargon', tone: 'justifying or condescending tone', 'claim-unchecked': 'live or checked with no evidence read' }[w.kind] || w.kind)))];
  return `Your last owner message had ${what.join('; ')} (recorded as warnings).\nNext time: outcome first in plain words, no ids, end with "Ask for details on any item"; owner steps go through \`owner-queue.js add\`.`;
}

module.exports = { ownerImperatives, idTokens, lineCount, isBriefing, unbackedClaim, judgeMessage, messageFindings, reminderText, MESSAGE_QUESTIONS };
