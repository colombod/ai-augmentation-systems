// hooks/scripts/relay-guard.js — the Chief of Staff carries answers; the operator never relays them.
//
// Two checks for the Chief of Staff's Stop hook (claim-stop.js calls decideStopForOperator):
//   1. an operator input captured in this session that has neither a record nor an ack blocks the
//      turn: record it (or ack it), then send the record id to the sessions that need it;
//   2. a final message that asks the operator to carry something to another session (tell, send,
//      forward, paste, reply in ... session) blocks the turn: send the record id yourself.
// The relay check is a heuristic backstop, not a boundary: it prefers missing a relay request over
// flagging a question about the operator's own decision. Everything here fails open (returns null).
const fs = require('fs');
const path = require('path');

// ---- the relay detector ----
//
// A structural rule over clauses, not a phrase list. A clause is a relay request when it has
//   (a) an operator-address mark: please, kindly, can/could/would/will you, would you mind, you'll
//       need to, your turn, "for you:", when you get a moment, ... or an operator-action verb at
//       the start of the clause (an imperative: the Chief of Staff's final message has no other
//       audience than the operator);
//   (b) an operator-action verb (approve, confirm, reply, tell, ping, DM, let ... know, give ...
//       the go-ahead, forward, paste, drop a note, open, head over, ...) in base, -s or -ing form;
//   (c) a reference to another party tied to that verb: a role or instance (builder-2, the
//       delivery lead, any "<word> specialist|expert|..."), a [hex] session ref, a session, tab,
//       window, terminal, pane or chat that is not this one, "the other ...", "there", or it/them
//       as the one who is told or answered;
// minus cancels: a first-person or third-person subject nearer the verb than the address mark
// ("once you answer, I will tell the builder", "the builder will answer in its session"), offers
// ("should I tell ...?", "do you want me to ..."), reported speech ("you said to tell ..."),
// "no need to", notes to self, and the Chief of Staff's own plan lines that send a record id
// ("Send dec-8 to builder-2.") with no explicit address mark.
// Code blocks, inline code, quoted lines (>) and double-quoted spans are ignored. Windows are
// bounded so the scan is linear in the message length. A heuristic backstop, not a boundary.

const DEFAULT_PARTIES = ['builder', 'builders', 'worker', 'workers', 'agent', 'agents', 'pm', 'product manager', 'product owner',
  'delivery lead', 'delivery manager', 'staffing', 'progress observer', 'observer', 'spike researcher', 'researcher',
  'infra', 'infra manager', 'role'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function partySource(extra) {
  const names = new Set(DEFAULT_PARTIES);
  for (const x of extra || []) {
    if (typeof x !== 'string' || !x.trim() || /^chief[- ]of[- ]staff/i.test(x)) continue;
    names.add(x.toLowerCase());
    names.add(x.toLowerCase().replace(/-/g, ' '));
  }
  const list = [...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  // a counted noun ("3 builders") is a quantity, not a party
  return String.raw`(?<!\d\s)\b(?:builder-\d+|(?:${list})(?:-\d+)?|[a-z]+ (?:specialist|expert|engineer|reviewer|researcher|observer|lead|manager|owner)s?)\b|\[[a-z0-9-]{4,16}\]`;
}

const PLACE = String.raw`(?:session|tab|window|terminal|pane|chat)s?`;
const NOT_OURS = String.raw`(?<!\b(?:this|my|our|your own|the current|chief of staff'?s?|here in the)\s)`;
const PLACE_REF = new RegExp(String.raw`${NOT_OURS}\b${PLACE}\b|\[[a-z0-9-]{4,16}\]|\b(?:the )?other (?:one|session|tab|window|side)\b|\bthere\b`);

const EXPLICIT = /\b(?:please|kindly|(?:can|could|would|will) you|would you mind|would you be able to|(?:you'll|you will|you) need to|need you to|you should|you must|you have to|you could|you can|you may want to|you might want to|do you want to|go ahead and|your turn|action (?:needed|required)|when you (?:have|get) a (?:moment|sec|second|chance|minute)|needs? your|waiting (?:on|for) you|blocked on you)\b|\b(?:for you|you):/;
const EXPLICIT_G = new RegExp(EXPLICIT.source, 'g');

const COMM = 'tell|telling|tells|ask|asking|asks|ping|pinging|pings|message|messaging|messages|dm|dming|remind|reminding|nudge|nudging|let|letting|give|giving';
const XFER = 'forward|forwarding|send|sending|copy|copying|paste|pasting|relay|relaying|pass|passing|post|posting|say|saying|type|typing|enter|entering|reply|replying|replies|respond|responding|answer|answering|drop|dropping|share|sharing';
const UI = 'approve|approving|accept|accepting|allow|allowing|click|clicking|press|pressing|hit|hitting|confirm|confirming|open|opening|switch|switching|head|heading|hop|hopping|go|going|jump|pop';
const VERB_G = new RegExp(String.raw`\b(?:${COMM}|${XFER}|${UI})\b`, 'g');
const COMM_SET = new Set(COMM.split('|'));
const UI_SET = new Set(UI.split('|'));
const RECIPIENT_VERBS = new Set([...COMM_SET, 'answer', 'answering', 'reply', 'replying', 'respond', 'responding']);
const ANSWERISH = /^\s+(?:\S+\s+){0,4}?(?:the go-ahead|the green light|a (?:quick |clear )?(?:yes|no|nod)|an? (?:answer|ok|okay)|the (?:answer|ok|okay|nod)|(?:your|the) (?:decision|answer|choice)|(?:a |the )?thumbs up|the record|(?:dec|del|ans)-[a-z0-9-]*\d)\b/;

const OFFER = /\b(?:should i|shall i|do you want me to|would you like me to|want me to|is it ok if i|can i|may i|happy for me to)\b/;
const REPORTED = /\byou (?:said|asked|wanted|told|mentioned|decided|chose)\b/;
const NO_NEED = /\b(?:do not need to|don't need to|no need to|no action|no reply needed|nothing (?:is )?needed|note to self)\b/;
const FIRST_G = /\b(?:i|we|i'll|i've|i'm|i'd|we'll|we've|let me)\b/g;
const RECORD_ID = /\b(?:dec|del|ans|rec|in)-[a-z0-9-]*\d\b/i;
const SOFT = String.raw`(?:(?:just|then|now|also|quickly|simply|first|kindly|please),?\s+)*`;
const SUBORDINATE = String.raw`(?:(?:once|when|if|after|as soon as|before) you[^,]{0,60},\s*)?`;
const IMPERATIVE = new RegExp(String.raw`^(?:[-*+]\s+|\d+[.)]\s+)?${SUBORDINATE}${SOFT}(?:${COMM}|${XFER}|${UI})\b`);

function strip(text) {
  return String(text)
    .replace(/(^|\n)[ \t]*(```|~~~)[\s\S]*?(\n[ \t]*\2[^\n]*|$)/g, '$1\n')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n').filter((l) => !/^\s*>/.test(l)).join('\n')
    .replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”/g, ' ')
    .replace(/\*\*|__/g, '');
}

// Clauses: sentence ends, semicolons, blank lines and list items separate. A single line break
// does not, so a request wrapped across two lines is still one clause.
function clauses(text) {
  return strip(text).toLowerCase()
    .replace(/\n\s*\n/g, ' \u0000 ')
    .replace(/\n(?=\s*(?:[-*+]\s|\d+[.)]\s))/g, ' \u0000 ')
    .replace(/\s+/g, ' ')
    .split(/[.!?;]+(?=\s|$)|\u0000/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function lastMatchEnd(reG, s) {
  reG.lastIndex = 0;
  let m;
  let at = -1;
  while ((m = reG.exec(s))) { at = m.index + m[0].length; if (m[0].length === 0) reG.lastIndex++; }
  return at;
}

// Does the verb at [vs, ve) point at another party?
function pointsAtParty(c, verb, ve, partyRe) {
  const after = c.slice(ve, ve + 80);
  if (/^\s+(?:me|us)\b/.test(after)) return false;
  if (verb === 'let' || verb === 'letting') return /^\s+(?!me\b|us\b)[^,]{0,40}?\bknow\b/.test(after) && (partyRe.test(after.slice(0, 50)) || /^\s+(?:it|them|him|her)\s+know\b/.test(after) || PLACE_REF.test(after.slice(0, 50)));
  if ((verb === 'give' || verb === 'giving') && !ANSWERISH.test(after)) return false;
  if (PLACE_REF.test(after)) return true;
  // the one who is told or answered: tell it, answer them, respond to it, give builder-1 a yes
  if (RECIPIENT_VERBS.has(verb) && /^\s+(?:(?:back )?to\s+)?(?:it|them|him|her)\b/.test(after)) return true;
  const direct = new RegExp(String.raw`^\s+(?:(?:back |along |over )?(?:to|with)\s+)?(?:the |that |your |our )?(?:[a-z]+ ){0,2}?(?:${partyRe.source})`);
  if (!UI_SET.has(verb) && direct.test(after)) return true;
  // a party behind a preposition (up to two modifiers: "the support agent"), as a possessive, or as the
  // subject of a relative clause
  const behind = new RegExp(String.raw`\b(?:to|in|into|on|at|with|over to|over in|that|which)\s+(?:the |that |its |their )?(?:[a-z]+ ){0,2}?(?:${partyRe.source})|(?:${partyRe.source})'s\b`);
  return behind.test(after);
}

// null, or { phrase } with the clause that asks the operator to carry something to another party.
function findRelayRequest(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const partyRe = new RegExp(partySource(opts.parties));
    const thirdRe = new RegExp(String.raw`(?:${partyRe.source}|\b(?:he|she|it|they))\s+(?:will|can|should|would|must|may|might|'ll|is going to|are going to)\b`, 'g');
    for (const c of clauses(text)) {
      if (OFFER.test(c) || REPORTED.test(c) || NO_NEED.test(c)) continue;
      const explicit = EXPLICIT.test(c);
      const imperative = IMPERATIVE.test(c);
      if (!explicit && !imperative) continue;
      VERB_G.lastIndex = 0;
      let v;
      while ((v = VERB_G.exec(c))) {
        const verb = v[0];
        const ve = v.index + verb.length;
        const prefix = c.slice(Math.max(0, v.index - 160), v.index);
        // the nearest subject before the verb decides who acts
        const addr = Math.max(lastMatchEnd(EXPLICIT_G, prefix), imperative && v.index <= 120 ? 0 : -1);
        const other = Math.max(lastMatchEnd(FIRST_G, prefix), lastMatchEnd(thirdRe, prefix));
        if (addr < 0 || other > addr) continue;
        if (!pointsAtParty(c, verb, ve, partyRe)) continue;
        // the Chief of Staff's own plan line: send a record id, nobody addressed
        if (!explicit && /^(?:send|sending|forward|forwarding|give|giving|pass|passing)$/.test(verb) && RECORD_ID.test(c)) continue;
        return { phrase: c.slice(0, 200) };
      }
    }
  } catch (err) { /* a heuristic never blocks on its own failure */ }
  return null;
}

const RELAY_REASON = 'You carry answers; the operator does not. Send the record id to the session yourself with SendMessage, and remove the request from your message.';
// the relayed thing has no record yet (a question to pass on, an answer not recorded)
const RELAY_REASON_NO_RECORD = 'You carry answers; the operator does not. Ask the operator here yourself, record the answer, then SendMessage the record id to the session, and remove the request from your message.';
const RELAY_RECORD_ID = /\b(?:dec|del|ans)-[a-z0-9-]*\d\b/i;

function relayReason(message) {
  return RELAY_RECORD_ID.test(String(message || '')) ? RELAY_REASON : RELAY_REASON_NO_RECORD;
}

function unrecordedReason(list) {
  const first = list[0];
  const n = first.id;
  const excerpt = String(first.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const more = list.length > 1 ? ` and ${list.length - 1} more` : '';
  return `You have an operator input with no record: ${n} ("${excerpt}")${more}. Record the decision (operator.js record --cite ${n} --quote "<exact words>" --statement "<what was decided>" --scope bead:ID) or acknowledge it (operator.js ack --input ${n} --reason "<why this is not a decision>"), then send the record id to the sessions that need it with SendMessage. Do not ask the operator to relay it.`;
}

function integrityReason(instance, problem) {
  const what = `${problem.code || 'chain_invalid'}: ${String(problem.error || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  return `Your own operator records chain (records/${instance}.ndjson) fails verification (${what}). Nothing can be recorded or acknowledged until it is repaired: run operator.js problems, then operator.js repair --instance ${instance} for a torn tail, or restore the file from repository history for a truncated or rewritten chain. Do not ask the operator to relay anything meanwhile.`;
}

function readTrim(file) {
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch (err) { return null; }
}

function sessionIdOf(roleDir, input) {
  return (roleDir && readTrim(path.join(roleDir, '.delivery-session'))) || (input && typeof input.session_id === 'string' && input.session_id) || null;
}

function formatUnrecognised(projectRoot, sessionId) {
  if (!sessionId) return false;
  try {
    const log = require('../../scripts/lib/operator-log.js');
    const f = path.join(log.opDir(projectRoot), 'cursors', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    if (!fs.existsSync(f)) return false;
    return require('../../scripts/lib/transcript.js').formatStatus(JSON.parse(fs.readFileSync(f, 'utf8'))) === 'format_unrecognised';
  } catch (err) { return false; }
}

// Problems on the Chief of Staff's own records file. truncated, history_rewritten and chain_invalid
// (and any unknown chain code) make record and ack fail; a torn tail does not: the valid entries are
// used and the next write repairs it. A single invalid record is excluded and the rest verifies.
const REPAIRABLE_BY_WRITE = 'torn_tail';
function ownChainProblem(problems, instance) {
  if (!instance) return null;
  return problems.find((p) => p && p.file === `records/${instance}` && !['record_invalid', 'unknown_instance'].includes(p.code)) || null;
}

function tornTailReason(instance, problem) {
  return `Your own operator records chain (records/${instance}.ndjson) has an incomplete last line (torn_tail: ${String(problem.error || '').replace(/\s+/g, ' ').slice(0, 120)}). The valid entries are used and your next record or ack repairs it; operator.js repair --instance ${instance} repairs it now.`;
}

// [{ kind: 'unrecorded' | 'integrity', reason }] for the Chief of Staff's own inputs ([] or null when nothing applies).
function inputCheck({ projectRoot, sessionId, instance, deps, warn }) {
  if (!sessionId) return null;
  if (!fs.existsSync(path.join(projectRoot, '.delivery', 'operator'))) {
    warn('delivery: .delivery/operator does not exist yet, so the unrecorded-input check had nothing to read; operator capture creates it on the first captured input\n');
    return null;
  }
  let res;
  try {
    res = (deps.pending || require('../../scripts/lib/operator-records.js').pending)(projectRoot, { sessionId });
  } catch (err) {
    warn(`delivery: the unrecorded-input check was skipped (${err && err.message ? err.message : err}); run operator.js pending\n`);
    return null;
  }
  const problems = (res && Array.isArray(res.problems)) ? res.problems : [];
  const untrusted = problems.find((p) => p && (p.code === 'manifest_unavailable' || p.code === 'format_unrecognised'));
  if (untrusted) {
    warn(`delivery: the unrecorded-input check was skipped: ${untrusted.error || untrusted.code}; run operator.js pending\n`);
    return null;
  }
  const out = [];
  const broken = ownChainProblem(problems, instance);
  if (broken && broken.code !== REPAIRABLE_BY_WRITE) return [{ kind: 'integrity', reason: integrityReason(instance, broken) }];
  if (broken) out.push({ kind: 'integrity', reason: tornTailReason(instance, broken) });
  const mine = ((res && res.inputs) || []).filter((e) => e && e.id && e.session_id === sessionId && (!instance || e.instance === instance));
  if (mine.length) out.push({ kind: 'unrecorded', reason: unrecordedReason(mine) });
  return out;
}

// Every operator check that applies to this stop, ignoring stop_hook_active (claim-stop.js limits
// repeats per turn). [] for any role but the Chief of Staff, and on any failure.
function operatorChecks({ input, roleDir, projectRoot, role, instance, captureStatus, parties, deps = {} } = {}) {
  try {
    if (role !== 'chief-of-staff') return [];
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return [];
    const inp = input && typeof input === 'object' ? input : {};
    const warn = deps.warn || (() => {});
    const sessionId = sessionIdOf(roleDir, inp);
    if (captureStatus === 'format_unrecognised' || formatUnrecognised(projectRoot, sessionId)) {
      warn('delivery: the transcript format was not recognised, so the operator stop checks were skipped; tell the Chief of Staff\n');
      return [];
    }
    const out = [];
    out.push(...(inputCheck({ projectRoot, sessionId, instance, deps, warn }) || []));
    const relay = findRelayRequest(inp.last_assistant_message, { parties });
    if (relay) out.push({ kind: 'relay', reason: relayReason(inp.last_assistant_message), detail: relay.phrase });
    return out;
  } catch (err) {
    return [];
  }
}

// Stateless form: null, or { reason } joining every applicable operator reason. Null on a
// continuation (stop_hook_active). Never throws.
function decideStopForOperator(args = {}) {
  const inp = args && args.input && typeof args.input === 'object' ? args.input : {};
  if (inp.stop_hook_active) return null;
  const found = operatorChecks(args);
  return found.length ? { reason: found.map((f) => f.reason).join('\n\n') } : null;
}

module.exports = { findRelayRequest, operatorChecks, decideStopForOperator, sessionIdOf, RELAY_REASON, RELAY_REASON_NO_RECORD };
