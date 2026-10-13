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

const OPENER = /\b(?:you|please|go ahead and)\b/g;
const VERB = /\b(?:tell|send|forward|paste|relay|pass|copy|reply to|answer in|confirm to|message|ping|ask)\b/g;
const PLACE = String.raw`(?:sessions?|tabs?|windows?|panes?|chats?|terminals?)`;
const TARGET_SRC = String.raw`\b(?:sessions?|workers?|builders?|agents?|roles?|product managers?|product owners?|pm|delivery leads?|delivery managers?|infra\w*|observers?|researchers?|staffing|them|tabs?|windows?)\b|\[[a-z0-9-]{4,16}\]`;
// the operator's own session, or the Chief of Staff's, is not "another session"
const OWN_SESSION = /\b(?:this|my|our|your own|the current|the chief of staff's|chief of staff)\s+$/;
const OWN_PLACE = String.raw`(?!(?:this|my|our|your own|the current|chief of staff'?s?)\b)`;
// first person: the Chief of Staff is the one doing the carrying ("do you want me to tell ...")
const FIRST_PERSON = /\b(?:i|me|my|we|us|our)\b/;
const FIRST_PERSON_G = /\b(?:i|me|my|we|us|our)\b/g;
const ADDRESSEE_G = /\b(?:you|please)\b/g;
// a target followed by "to" in the gap is the subject of the verb ("do you want the builder to ask ...")
const TARGET_SUBJECT = new RegExp(String.raw`(?:${TARGET_SRC})\s+to\b`);
// a third-person subject with a modal before the verb: someone else acts ("the builder will answer in its session")
const THIRD_PERSON = new RegExp(String.raw`(?:${TARGET_SRC}|\b(?:he|she|it|they|builder-\d+))\s+(?:will|can|should|would|must|may|might|'ll)\b`);
// a determiner before the verb makes it a noun ("did you see the message from the builder")
const DETERMINER = /\b(?:the|a|an|this|that|your|his|her|their|its|any|no)\s+$/;
// "did you tell the builder?" asks what happened, not for a relay
const PAST_QUESTION = /\b(?:did|have|had)\s+$/;
// reported speech: "you said to tell the builder to wait" reports the operator, it asks nothing
const REPORTED = /^\s+(?:said|asked|wanted|told|decided|chose|mentioned)\b/;
// "you can ask any session yourself, but you do not need to": no request
const NO_NEED = /\b(?:do not need to|don't need to|no need to|no action (?:is )?needed|nothing (?:is )?needed)\b/;
// clause openings that make the clause a statement, not an instruction to the operator
const STATEMENT_START = /^(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?(?:i|we|the|it|they|he|she|builder(?:-\d+)?|you said|you told|you asked)\b/;
const REQUEST_MARK = /\b(?:please|can you|could you|would you|you need to|you will need to|i need you to)\b/;
const SOFTENER = String.raw`(?:(?:then|now|just|also|please|kindly|when you get a (?:moment|chance|sec),?|once you can,?)\s+)*`;
const LEAD = String.raw`^(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?(?:you:\*\*\s+|action for you:\*\*\s+)?`;
// sentence-initial imperatives: the Chief of Staff's final message has no audience but the operator
const IMPERATIVE_CARRY = new RegExp(String.raw`${LEAD}(?:\*\*)?(?:paste|forward|relay)\b`);
const IMPERATIVE_TELL = new RegExp(String.raw`${LEAD}${SOFTENER}(?:tell|ask|ping|message|send|nudge|remind|answer|reply to)\s+(?!me\b|us\b)`);
const PHRASES = [
  // reply 'go' in the builder's session / confirm over in the builder session / answer in [dfd9f8]'s session
  new RegExp(String.raw`\b(?:reply|respond|answer|say|type|write|post|enter|confirm|approve|click|press|accept|allow)\b[^.!?;]{0,40}?\b(?:in|on|over in|into|at)\s+${OWN_PLACE}[^.!?;]{0,48}?\b${PLACE}\b`),
  // type this into / paste this into / copy the following into
  /\b(?:type|paste|copy|enter)\s+(?:this|that|it|these|the following)(?:\s+\S+){0,3}?\s+into\b/,
  // go to the delivery lead tab / hop over to the builder window
  new RegExp(String.raw`\b(?:go|head|switch|hop|jump|pop)(?:\s+over)?\s+(?:back\s+)?(?:to|into)\s+${OWN_PLACE}[^.!?;]{0,48}?\b${PLACE}\b`),
  /\b(?:in|on|to)\s+(?:the\s+)?other\s+(?:session|tab|window)\b/,
  /\bsession\s+[a-f0-9]{6,}\b/,
  /\blet\s+(?!me\b|us\b|the record\b)[^.!?;]{0,40}?\bknow\b/,
  /\bgive\s+(?!me\b|us\b)[^.!?;]{0,40}?\b(?:the go-ahead|the green light|a yes|a no|an answer|the answer|your answer|the ok|the okay|a thumbs up)\b/,
  // "please answer it there": there is somewhere else
  /\b(?:answer|reply|respond|confirm|approve)\b(?:\s+(?:to\s+)?(?:it|them|him|her|that))?\s+(?:over\s+)?there\b/,
];

function strip(text) {
  return String(text)
    .replace(/(^|\n)[ \t]*(```|~~~)[\s\S]*?(\n[ \t]*\2[^\n]*|$)/g, '$1\n')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n').filter((l) => !/^\s*>/.test(l)).join('\n')
    .replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”/g, ' ');
}

// Clauses: sentence ends, semicolons, blank lines and list items separate; a single line break does
// not, so a request split across lines is still one clause.
function clauses(text) {
  return strip(text).toLowerCase()
    .replace(/\n\s*\n/g, ' \u0000 ')
    .replace(/\n(?=\s*(?:[-*+]\s|\d+[.)]\s))/g, ' \u0000 ')
    .replace(/\s+/g, ' ')
    .split(/[.!?;]+(?=\s|$)|\u0000/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function findTarget(s) {
  const re = new RegExp(TARGET_SRC, 'g');
  let m;
  while ((m = re.exec(s))) {
    if (/^sessions?$/.test(m[0]) && OWN_SESSION.test(s.slice(0, m.index))) continue;
    return { index: m.index, end: m.index + m[0].length };
  }
  return null;
}

function lastIndex(re, s) {
  re.lastIndex = 0;
  let m;
  let at = -1;
  while ((m = re.exec(s))) at = m.index;
  return at;
}

// The nearest subject before a match is the Chief of Staff ("once you answer, I will give ..."), or
// someone else with a modal ("the builder will answer in its session").
function someoneElseActs(prefix) {
  if (lastIndex(FIRST_PERSON_G, prefix) > lastIndex(ADDRESSEE_G, prefix)) return true;
  return THIRD_PERSON.test(prefix);
}

function openerRequest(c) {
  OPENER.lastIndex = 0;
  let o;
  while ((o = OPENER.exec(c))) {
    const start = o.index;
    const after = start + o[0].length;
    if (o[0] === 'you' && (PAST_QUESTION.test(c.slice(0, start)) || REPORTED.test(c.slice(after)))) continue;
    const window = c.slice(after, after + 80);
    VERB.lastIndex = 0;
    let v;
    while ((v = VERB.exec(window))) {
      const gap = window.slice(0, v.index);
      if (FIRST_PERSON.test(gap) || TARGET_SUBJECT.test(gap)) break;
      if (DETERMINER.test(c.slice(0, after + v.index))) continue;
      const verbEnd = after + v.index + v[0].length;
      if (/^\s+(?:me|us)\b/.test(c.slice(verbEnd))) continue;
      const scope = c.slice(after, verbEnd + 80);
      const t = findTarget(scope);
      if (t) return c.slice(start, Math.max(verbEnd, after + t.end)).trim();
    }
  }
  return null;
}

function imperativeRequest(c) {
  for (const re of [IMPERATIVE_CARRY, IMPERATIVE_TELL]) {
    const m = re.exec(c);
    if (!m) continue;
    const t = findTarget(c.slice(m[0].length, m[0].length + 80));
    if (t) return c.slice(0, m[0].length + t.end).trim();
  }
  return null;
}

// "the delivery lead needs your answer in its session": a statement that still sends the operator elsewhere
const NEEDS_YOU_THERE = new RegExp(String.raw`\b(?:needs?|wants?|is waiting for|waits for)\s+your\s+(?:answer|reply|ok|okay|approval|go-ahead|confirmation|decision)\s+(?:in|on|over in)\s+${OWN_PLACE}[^.!?;]{0,48}?\b${PLACE}\b`);

function phraseRequest(c) {
  const needs = NEEDS_YOU_THERE.exec(c);
  if (needs) return needs[0].trim();
  if (STATEMENT_START.test(c) && !REQUEST_MARK.test(c)) return null;
  for (const re of PHRASES) {
    const m = re.exec(c);
    if (!m) continue;
    // "I'll reply in the builder's session" is the Chief of Staff doing its job
    if (someoneElseActs(c.slice(0, m.index))) continue;
    return m[0].trim();
  }
  return null;
}

// null, or { phrase } naming the first request that the human carry something to another session.
// A heuristic backstop, not a boundary: the structural fix is that nothing needs the operator to relay.
function findRelayRequest(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    for (const c of clauses(text)) {
      if (NO_NEED.test(c)) continue;
      const phrase = openerRequest(c) || imperativeRequest(c) || phraseRequest(c);
      if (phrase) return { phrase };
    }
  } catch (err) { /* a heuristic never blocks on its own failure */ }
  return null;
}

const RELAY_REASON = 'You carry answers; the operator does not. Send the record id to the session yourself with SendMessage, and remove the request from your message.';
// the relayed thing has no record yet (a question to pass on, an answer not recorded)
const RELAY_REASON_NO_RECORD = 'You carry answers; the operator does not. Ask the operator here yourself, record the answer, then SendMessage the record id to the session, and remove the request from your message.';
const RECORD_ID = /\b(?:dec|del|ans)-[a-z0-9-]*\d\b/i;

function relayReason(message) {
  return RECORD_ID.test(String(message || '')) ? RELAY_REASON : RELAY_REASON_NO_RECORD;
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

// Problems on the Chief of Staff's own records file that make record and ack fail. A single invalid
// record is excluded and the rest still verifies, so it is not one of them.
function ownChainProblem(problems, instance) {
  if (!instance) return null;
  return problems.find((p) => p && p.file === `records/${instance}` && !['record_invalid', 'unknown_instance'].includes(p.code)) || null;
}

// { kind: 'unrecorded' | 'integrity', reason } for the Chief of Staff's own inputs, or null.
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
  const broken = ownChainProblem(problems, instance);
  if (broken) return { kind: 'integrity', reason: integrityReason(instance, broken) };
  const mine = ((res && res.inputs) || []).filter((e) => e && e.id && e.session_id === sessionId && (!instance || e.instance === instance));
  return mine.length ? { kind: 'unrecorded', reason: unrecordedReason(mine) } : null;
}

// Every operator check that applies to this stop, ignoring stop_hook_active (claim-stop.js limits
// repeats per turn). [] for any role but the Chief of Staff, and on any failure.
function operatorChecks({ input, roleDir, projectRoot, role, instance, captureStatus, deps = {} } = {}) {
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
    const ic = inputCheck({ projectRoot, sessionId, instance, deps, warn });
    if (ic) out.push(ic);
    if (findRelayRequest(inp.last_assistant_message)) out.push({ kind: 'relay', reason: relayReason(inp.last_assistant_message) });
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
