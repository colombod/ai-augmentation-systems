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
const TARGET_SRC = String.raw`\b(?:sessions?|workers?|builders?|agents?|roles?|product managers?|delivery leads?|delivery managers?|infra\w*|observers?|researchers?|staffing|them)\b|\[[a-z0-9-]{4,16}\]`;
// the operator's own session, or the Chief of Staff's, is not "another session"
const OWN_SESSION = /\b(?:this|my|our|your own|the current|the chief of staff's|chief of staff)\s+$/;
// first person in the gap: the Chief of Staff is the one doing the carrying ("do you want me to tell ...")
const FIRST_PERSON = /\b(?:i|me|my|we|us|our)\b/;
// a target followed by "to" in the gap is the subject of the verb ("do you want the builder to ask ...")
const TARGET_SUBJECT = new RegExp(String.raw`(?:${TARGET_SRC})\s+to\b`);
// a determiner before the verb makes it a noun ("did you see the message from the builder")
const DETERMINER = /\b(?:the|a|an|this|that|your|his|her|their|its|any|no)\s+$/;
// "did you tell the builder?" asks what happened, not for a relay
const PAST_QUESTION = /\b(?:did|have|had)\s+$/;
// sentence-initial imperatives that only make sense as instructions to carry text somewhere
const IMPERATIVE = /^(?:[-*+]\s+|\d+[.)]\s+)?(?:paste|forward|relay)\b/;
const PHRASES = [
  // reply in <name>'s session / say it in the builder session / answer in [dfd9f8]'s session
  new RegExp(String.raw`\b(?:reply|respond|answer|say (?:it|this|that)|write (?:it|this|that)|post (?:it|this|that))\s+in\s+(?!(?:this|my|our|your own|the current)\b)[^.!?;]{0,48}?\bsession\b`),
  // type this into / paste this into / copy the following into
  /\b(?:type|paste|copy|enter)\s+(?:this|that|it|these|the following)(?:\s+\S+){0,3}?\s+into\b/,
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

function openerRequest(c) {
  OPENER.lastIndex = 0;
  let o;
  while ((o = OPENER.exec(c))) {
    const start = o.index;
    const after = start + o[0].length;
    if (o[0] === 'you' && PAST_QUESTION.test(c.slice(0, start))) continue;
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
  const m = IMPERATIVE.exec(c);
  if (!m) return null;
  const t = findTarget(c.slice(m[0].length, m[0].length + 80));
  return t ? c.slice(0, m[0].length + t.end).trim() : null;
}

function phraseRequest(c) {
  for (const re of PHRASES) {
    const m = re.exec(c);
    if (!m) continue;
    // "I'll reply in the builder's session" is the Chief of Staff doing its job
    if (FIRST_PERSON.test(c.slice(0, m.index))) continue;
    return m[0].trim();
  }
  return null;
}

// null, or { phrase } naming the first request that the human carry something to another session.
function findRelayRequest(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    for (const c of clauses(text)) {
      const phrase = openerRequest(c) || imperativeRequest(c) || phraseRequest(c);
      if (phrase) return { phrase };
    }
  } catch (err) { /* a heuristic never blocks on its own failure */ }
  return null;
}

const RELAY_REASON = 'You carry answers; the operator does not. Send the record id to the session yourself with SendMessage, and remove the request from your message.';

function unrecordedReason(list) {
  const first = list[0];
  const n = first.id;
  const excerpt = String(first.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const more = list.length > 1 ? ` and ${list.length - 1} more` : '';
  return `You have an operator input with no record: ${n} ("${excerpt}")${more}. Record the decision (operator.js record --cite ${n} --quote "<exact words>" --statement "<what was decided>" --scope bead:ID) or acknowledge it (operator.js ack --input ${n} --reason "<why this is not a decision>"), then send the record id to the sessions that need it with SendMessage. Do not ask the operator to relay it.`;
}

function readTrim(file) {
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch (err) { return null; }
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

// The Chief of Staff's own unrecorded human inputs, or null when the check cannot be trusted.
function ownPending({ projectRoot, sessionId, instance, deps, warn }) {
  if (!sessionId || !fs.existsSync(path.join(projectRoot, '.delivery', 'operator'))) return null;
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
  return ((res && res.inputs) || []).filter((e) => e && e.id && e.session_id === sessionId && (!instance || e.instance === instance));
}

// null, or { reason } to block the Chief of Staff's stop. Never throws.
function decideStopForOperator({ input, roleDir, projectRoot, role, instance, captureStatus, deps = {} } = {}) {
  try {
    if (role !== 'chief-of-staff') return null;
    const inp = input && typeof input === 'object' ? input : {};
    if (inp.stop_hook_active) return null;
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return null;
    const warn = deps.warn || (() => {});
    const sessionId = (roleDir && readTrim(path.join(roleDir, '.delivery-session'))) || (typeof inp.session_id === 'string' && inp.session_id) || null;
    if (captureStatus === 'format_unrecognised' || formatUnrecognised(projectRoot, sessionId)) {
      warn('delivery: the transcript format was not recognised, so the operator stop checks were skipped; tell the Chief of Staff\n');
      return null;
    }
    const mine = ownPending({ projectRoot, sessionId, instance, deps, warn });
    if (mine && mine.length) return { reason: unrecordedReason(mine) };
    if (findRelayRequest(inp.last_assistant_message)) return { reason: RELAY_REASON };
    return null;
  } catch (err) {
    return null;
  }
}

module.exports = { findRelayRequest, decideStopForOperator, RELAY_REASON };
