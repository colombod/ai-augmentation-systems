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
//            commands, unless the message says "not checked yet" or plan.js brief printed that clause in
//            this turn: warn.
// Every warning goes to the ledger and is said once on the next prompt. Nothing here throws.
const RG = require('./relay-guard.js');

// verbs of doing something somewhere; answering in this chat (reply, say, choose) is how the owner decides
const ORDER_VERBS = new Set(('open type paste click run go sign log approve press enter copy restart reboot install set add create configure '
  + 'grant accept update delete push merge review test try unlock switch send tell forward check drop upload download change turn '
  + 'enable disable remove rotate generate visit start stop kill').split(' '));
const OFFER = /\b(?:should i|shall i|do you want me to|would you like me to|want me to|is it ok if i|can i|may i)\b/;
const SPLIT = /\s*(?:—|–|\s-\s|→|:(?=\s|$))\s*/;
const DECISION_Q = /\bor\b|\bwhich\b|\bdo you want\b|\bwould you (?:prefer|rather)\b/;
const NO_ASK = /\b(?:no need to|nothing (?:is )?needed|nothing for you|no action)\b/;
// asked back to the sender ("tell me when it is done", "ask for details"): not an order
const BACK_TO_ME = /^(?:(?:then|and|just|please|so),?\s+)*(?:tell|ask|let|show|send|give|message|ping)\s+(?:me|us)\b|^ask for (?:details|more)\b/;

// Clauses that tell the owner to do something (review I3: only what is addressed to the owner):
// - an address mark ("please", "you need to", "can you") or second person with an action verb;
// - a bare imperative with an action verb that starts its own sentence ("Open the X session and type");
// - after a short lead that addresses the owner ("Your action: open ...", "For you: sign in ...").
// Not orders: plan lines ("Next: review ...", "Plan for today: start ...") and the list under them,
// options ("A: keep ... B: switch ..."), decision questions, offers, and asks back to the sender.
const OWNER_LEAD = /\b(?:you|your|yours|for you)\b/;
// an order in a plan line still counts when it sends someone into a session, to type or paste, or
// names the owner ("Then: open the builder session and type continue"; review I-c)
// ("type" only as typing something in somewhere: "type up the release notes" is writing, not an order)
const OWNER_MARK = /\b(?:session|sessions|paste|me|you|your)\b|\btype\b(?=[^.;]{0,40}\b(?:in|into)\b|\s*:|\s+["'`>])/;
const PLAN_LABEL = /\b(?:plan|plans|next|next steps?|then|todo|to-do|later|today|tonight|tomorrow|this week|steps|options?|meanwhile)\b[^.:]{0,40}:\s*$/;
function ownerImperatives(text, { parties } = {}) {
  const out = [];
  try {
    const re = RG.compile(parties || []);
    let underPlan = false;
    for (const { raw, c, q, ctx } of RG.clauses(text)) {
      if (!ctx) underPlan = false; // a new paragraph ends a plan list
      const planHere = PLAN_LABEL.test(c);
      if (OFFER.test(c) || NO_ASK.test(c) || BACK_TO_ME.test(c)) { if (planHere) underPlan = true; continue; }
      const sp = SPLIT.exec(c);
      const lead = sp && sp.index <= 60 ? c.slice(0, sp.index).trim() : null;
      const rest = lead !== null ? c.slice(sp.index + sp[0].length).trim() : c;
      let label = lead !== null && lead.split(/\s+/).length <= 7;
      let x = label ? rest : c;
      if (label && !OWNER_LEAD.test(lead)) {
        // "Type this:" is an order of its own; "Next:", "A:" and "Plan for today:" are not, unless what
        // follows them carries an owner mark
        const l = RG.addressOf(lead, re);
        const r = RG.addressOf(rest, re);
        if (rest && OWNER_MARK.test(rest) && r.imperative && ORDER_VERBS.has(r.verb)) { out.push(raw.replace(/\s+/g, ' ').slice(0, 200)); continue; }
        if (!(l.imperative && ORDER_VERBS.has(l.verb)) || PLAN_LABEL.test(`${lead}:`)) { if (!rest) underPlan = PLAN_LABEL.test(`${lead}:`); continue; }
        label = false;
        x = lead;
      }
      const a = RG.addressOf(x, re);
      const marked = a.explicit || a.strong;
      const second = /\b(?:you|your)\b/.test(x);
      let hit;
      if (q) hit = marked && !DECISION_Q.test(x);
      else if (marked) hit = true;
      else hit = a.imperative && ORDER_VERBS.has(a.verb) && (second || label || !underPlan || OWNER_MARK.test(x));
      if (hit) out.push(raw.replace(/\s+/g, ' ').slice(0, 200));
    }
  } catch (err) { /* a heuristic never fails the stop */ }
  return out;
}

// ---- id-like tokens (owner ruling 10) ----
// Only the shapes the plugin itself produces: record, evidence, question and input ids, the project's
// bead ids, the plugin's script and hook names, lane groups and the .delivery and .beads paths. Product
// words (COVID-19, F-150, Node.js, config.yaml) are not internal ids.
const PLUGIN_NAMES = (() => {
  const out = new Set();
  const fs = require('fs');
  const path = require('path');
  for (const d of [path.join(__dirname), path.join(__dirname, '..', '..', 'scripts')]) {
    try { for (const f of fs.readdirSync(d)) if (/\.js$/.test(f) && !/\.test\.js$/.test(f)) out.add(f); } catch (err) { /* none */ }
  }
  return [...out];
})();
const ID_PATTERNS = [
  /\b(?:dec|ev|q|ans|in|del)-[a-z0-9-]*\d[a-z0-9-]*\b/g, // record, evidence, question and input ids
  /(?:^|[\s(`'"])\.(?:delivery|beads)\/[\w./-]*/g, // the plugin's own paths
  /\b(?:bd|git|gh|operator|goal)-(?:read|write|claim|notes|structure|create-child|write-project|write-product)\b/g, // lane groups
  /\b(?:Stop|PreToolUse|PostToolUse|UserPromptSubmit) hook\b/g, // hook events
];
// the owner asked for ids: an id, bead, record or link named in a question or a request for them
const ASKED_FOR_IDS = /\b(?:ids?|bead ids?|beads?|record ids?|records|links?|pull requests?)\b/i;
const ASKS = /\?|^\s*(?:give|send|show|list|share|paste|which|what)\b/i;
const ownerAskedIds = (owner) => Boolean(owner && ASKED_FOR_IDS.test(owner) && ASKS.test(owner));

function idTokens(text, { prefix, owner } = {}) {
  if (ownerAskedIds(owner)) return [];
  const body = String(text || '').replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\bhttps?:\/\/\S+/g, ' ');
  const p = String(prefix || '').replace(/[^a-z0-9]/gi, '');
  const pats = [...(p ? [new RegExp(`\\b${p}-[a-z0-9]+(?:\\.[a-z0-9]+)*\\b`, 'g')] : []), ...ID_PATTERNS,
    new RegExp(`(?<![\\w.-])(?:${PLUGIN_NAMES.map((n) => n.replace(/[.-]/g, (ch) => `\\${ch}`)).join('|')})(?![\\w-])`, 'g')];
  const found = new Set();
  for (const re of pats) for (const m of body.match(re) || []) found.add(m.trim());
  return [...found];
}

// ---- routine briefing length ----
function lineCount(text) { return String(text || '').split('\n').filter((l) => l.trim()).length; }
// a briefing asks the owner nothing: a message is a decision only when it ends with a question to the
// owner (a rhetorical "?" inside a long justification does not make it one)
function isBriefing(text) {
  const list = RG.clauses(text).filter((x) => !/^ask for (?:details|more)\b/.test(x.c));
  return !(list.length && list[list.length - 1].q);
}

// ---- acceptance words need an evidence read this turn (R-03) ----
const LIVE = /\b(?:is|are|now|it'?s|went|goes|been)\s+(?:live|shipped|verified)\b|\blive (?:in|on) (?:production|prod|the customer'?s?|your)\b|\bchecked on (?:the|your) (?:customer'?s?|real)\b|\bworks? (?:now )?(?:in|on) (?:your|the customer'?s?|the real)\b/i;
const NOT_LIVE = /\bnot (?:yet )?(?:live|shipped|verified|checked)\b|\bnot checked yet\b|\bunverified\b/i;
// The beads read by evidence.js check|list in command position, every segment of the command: a
// quoted script path counts (Copilot 697); the text of an echo or a comment does not.
function evidenceReads(command) {
  const L = require('./lane.js');
  const out = [];
  try {
    for (const seg of L.splitCommand(String(command || ''))) {
      const t = L.tokens(seg).filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env');
      if (!t.length || !/(?:^|\/)node$/.test(t[0])) continue;
      const i = t.findIndex((x, k) => k > 0 && /(?:^|\/)evidence\.js$/.test(x));
      if (i > 0 && ['check', 'list'].includes(t[i + 1])) out.push(t[i + 2] || '');
    }
  } catch (err) { /* nothing counts */ }
  return out;
}

// The text plan.js brief printed in this turn: it says checked only on the done gate's verdict, so a
// claim it printed is backed; one the session wrote itself is not (PR 58 I4)
function briefTexts(outputs) {
  const L = require('./lane.js');
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  return (outputs || []).filter((o) => {
    try {
      return L.splitCommand(String(o.command || '')).some((seg) => {
        const t = L.tokens(seg);
        const k = t.findIndex((x, n) => n > 0 && /(?:^|\/)plan\.js$/.test(x));
        return /(?:^|\/)node$/.test(t[0] || '') && k > 0 && t[k + 1] === 'brief';
      });
    } catch (err) { return false; }
  }).map((o) => norm(o.text));
}

// A clause that says live, shipped or checked (not a question) needs an evidence read in this turn's
// tool calls, or must appear in what plan.js brief printed in this turn; when the clause names a bead,
// the read must be of that bead.
function unbackedClaim(text, commands, { prefix, outputs } = {}) {
  const briefs = briefTexts(outputs);
  const reads = (commands || []).flatMap(evidenceReads);
  const p = String(prefix || '').replace(/[^a-z0-9]/gi, '');
  const beadRe = p ? new RegExp(`\\b${p}-[a-z0-9]+(?:[.-][a-z0-9]+)*\\b`, 'gi') : null;
  for (const { raw, q } of RG.clauses(text)) {
    if (q || !LIVE.test(raw) || NOT_LIVE.test(raw)) continue;
    if (briefs.some((b) => b.includes(raw.replace(/\s+/g, ' ').trim()))) continue;
    const named = beadRe ? (raw.match(beadRe) || []) : [];
    const ok = named.length ? named.every((b) => reads.some((r) => r.toLowerCase() === b.toLowerCase())) : reads.length > 0;
    if (!ok) return raw.replace(/\s+/g, ' ').slice(0, 120);
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
    // paths, commands, links and tokens become placeholders, so the concrete orders ("run node x.js",
    // "open https://...") reach the judge instead of being refused by its state filter (review I2)
    const message = judge.redact(RG.strip(String((input && input.last_assistant_message) || ''))).trim();
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
function messageFindings({ message, owner, commands, outputs, role, judged = {}, openSteps = [], briefingLines = 12, prefix, parties, queueCmd = 'owner-queue.js', ordersMode }) {
  const candidates = [];
  const warnings = [];
  if (!RG.OPERATOR_FACING.has(role) || typeof message !== 'string' || !message.trim()) return { candidates, warnings };
  const Q = require('../../scripts/lib/owner-queue.js');
  const orders = ownerImperatives(message, { parties }).filter((c) => !Q.allQueued(c, openSteps));
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
  if (!ids.length && !ownerAskedIds(owner) && j && typeof j.p === 'number' && j.p >= (catalogueField('jargon', 'warn_at') || 0.5)) warnings.push({ kind: 'jargon', rule: 'R-45', detail: `the judge rates the owner message as jargon (p ${j.p.toFixed(2)})` });
  const t = judged.tone_violation;
  if (t && t.answer && t.answer !== 'none' && (t.confidence || 0) >= 0.5) warnings.push({ kind: 'tone', rule: 'R-45', detail: `the owner message reads as ${t.answer} (judge ${Number(t.confidence).toFixed(2)})` });
  const claim = unbackedClaim(message, commands, { prefix, outputs });
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
