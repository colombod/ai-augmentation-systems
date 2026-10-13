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
// Biased to recall: a missed relay request puts the operator to work as a messenger, a false alarm
// costs the Chief of Staff one rewrite. A clause (split at sentence ends, semicolons, blank lines and
// list items) is a relay request when
//   (a) it addresses the operator: an address mark (please, kindly, can/could/would/will you, would
//       you mind, mind <-ing>, you'll need to, you should, your turn/move, do me a favour, when you
//       have a moment, go ahead, ...) or it starts with an imperative-looking word (any base-form
//       word that is not a pronoun, auxiliary, determiner, question word, conjunction, preposition,
//       label or common opener), after bullets, softeners (just, then, okay, ...) and an
//       "once/when/if you ...," lead-in;
//   (b) it refers to another party: a role or instance from the manifest, builder-N, any "<word>
//       specialist|expert|engineer|reviewer|researcher|observer|lead|manager|owner|agent", a [hex]
//       session ref, a session/tab/window/terminal/pane/chat that is not this one, "the other ...",
//       "(over) there", or it/them as the one told or answered;
//   (c) nothing cancels it: a first-person or third-person subject nearer the party than the address
//       ("once you answer, I will tell the builder", "the builder will answer"), offers ("should I
//       ...?"), reported speech ("you said ..."), "no need to", notes to self, a party that is only
//       the subject of the question ("whether the PM may ...", "do you want the builder to ..."),
//       a counted noun ("five builders"), and the Chief of Staff's plan lines that send a record id.
// The weakest case, a bare imperative with no address mark, also needs a verb from the operator-
// action list, a place or session ref, or the party as the verb's direct object ("Shoot the
// delivery lead a yes"). Code blocks, inline code, quoted lines (>) and double-quoted spans are
// ignored. Windows are bounded, so the scan is linear. A heuristic backstop, not a boundary.

const DEFAULT_PARTIES = ['builder', 'builders', 'worker', 'workers', 'agent', 'agents', 'pm', 'product manager', 'product owner',
  'delivery lead', 'delivery manager', 'staffing', 'progress observer', 'observer', 'spike researcher', 'researcher',
  'infra', 'infra manager', 'role'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBER_WORDS = 'two|three|four|five|six|seven|eight|nine|ten|several|many|all|both|more|fewer';

function partySource(extra) {
  const names = new Set(DEFAULT_PARTIES);
  for (const x of extra || []) {
    if (typeof x !== 'string' || !x.trim() || /^chief[- ]of[- ]staff/i.test(x)) continue;
    names.add(x.toLowerCase());
    names.add(x.toLowerCase().replace(/-/g, ' '));
  }
  const list = [...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  // a counted noun ("3 builders", "five builders") is a quantity, not a party
  return String.raw`(?<!(?:\d|\b(?:${NUMBER_WORDS}))\s)\b(?:builder-\d+|(?:${list})(?:-\d+)?|[a-z]+ (?:specialist|expert|engineer|reviewer|researcher|observer|lead|manager|owner|agent)s?)\b|\[[a-z0-9-]{4,16}\]`;
}

const PLACE = String.raw`(?:session|tab|window|terminal|pane|chat)s?`;
const NOT_OURS = String.raw`(?<!\b(?:this|my|our|your own|the current|chief of staff'?s?|here in the)\s)`;
// a place where the operator would go: another session, a ref, the other one, (over) there
const PLACE_SRC = String.raw`${NOT_OURS}\b${PLACE}\b|\[[a-z0-9-]{4,16}\]|\bthe other (?:one|session|tab|window|side)\b|(?<!\b(?:is|are|was|were)\s)\b(?:over )?there\b(?!\s+(?:is|are|was|were|'s|will|should|may|might|has|have)\b)`;

const EXPLICIT = /\b(?:please|kindly|(?:can|could|would|will) you|would you mind|would you be able to|(?:you'll|you will|you) need to|need you to|you should|you must|you have to|you could|you may want to|you might want to|yourself|go ahead|your (?:turn|move)|do me a (?:favour|favor)|action (?:needed|required)|when you (?:have|get) a (?:moment|sec|second|chance|minute)|needs? your|waiting (?:on|for) you|blocked on you)\b|\b(?:for you|you):|^(?:[-*+]\s+|\d+[.)]\s+)?mind \w+ing\b/;
const EXPLICIT_G = new RegExp(EXPLICIT.source.replace('^(?:[-*+]', '(?:^|\\u0001)(?:[-*+]'), 'g');

// the operator-action verbs, for the weakest case only
const ACTION_VERBS = new Set(('tell ask ping message dm remind nudge give forward send copy paste relay pass post say type enter reply respond answer '
  + 'drop share approve accept allow click press hit confirm open switch head hop go jump pop sign okay ok shoot swing get loop check run nod greenlight').split(' '));
// first words that do not start an imperative
const NOT_IMPERATIVE = new Set(('i we you he she it they me us this that these those the a an my your our their its his her there here '
  + 'is are was were be been am do does did have has had can could would will should shall may might must what which who whom whose when where why how '
  + 'if once as and but or so because since while although though yes no not thanks thank nothing everything everyone nobody every all both each some any none '
  + 'one two three four five six seven eight nine ten next then now also still already done status briefing note plan summary update today tomorrow '
  + 'yesterday great good fine sure sorry hi hello hey welcome per after before with for from in on at to by of about over under without until '
  + 'recommendation recommended options option decision question questions answer: fyi heads re only maybe perhaps').split(' '));
const SOFT = String.raw`(?:(?:just|then|now|also|quickly|simply|first|kindly|please|okay|ok|alright|right|so),?\s+)*`;
const LEAD = String.raw`^(?:[-*+]\s+|\d+[.)]\s+)?(?:(?:once|when|if|after|as soon as|before) you[^,]{0,60},\s*)?${SOFT}`;
const FIRST_WORD = new RegExp(String.raw`${LEAD}([a-z][a-z'-]*)(:?)`);

const OFFER = /\b(?:should i|shall i|do you want me to|would you like me to|want me to|is it ok if i|can i|may i|happy for me to)\b/;
const REPORTED = /\byou (?:said|asked|wanted|told|mentioned|decided|chose)\b/;
const NO_NEED = /\b(?:do not need to|don't need to|no need to|no action|no reply needed|nothing (?:is )?needed)\b/;
const NOTE_TO_SELF = /\bnote to self\b/;
// asked back to the Chief of Staff ("tell me", "remind me"): the operator is not sent elsewhere
const BACK_TO_ME = /\b(?:tell|ask|ping|message|send|remind|let|give|show|update|notify|email|dm|call|text)\s+(?:me|us)\b/;
const ADVERB_LY = /ly$/;
const LY_VERBS = new Set(['reply', 'apply', 'supply', 'rely']);
const FIRST_G = /\b(?:i|we|i'll|i've|i'm|i'd|we'll|we've|let me)\b/g;
const RECORD_ID = /\b(?:dec|del|ans|rec|in)-[a-z0-9-]*\d\b/i;
const PLAN_VERBS = new Set(['send', 'forward', 'give', 'pass', 'share', 'post', 'copy', 'paste', 'relay']);
const MODAL = String.raw`(?:will|can|should|would|must|may|might|'ll|is going to|are going to)`;

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
// Each clause carries q: true when it ended with a question mark.
function clauses(text) {
  const parts = strip(text).toLowerCase()
    .replace(/\n\s*\n/g, ' \u0000 ')
    .replace(/\n(?=\s*(?:[-*+]\s|\d+[.)]\s))/g, ' \u0000 ')
    .replace(/\s+/g, ' ')
    .split(/([.!?;]+)(?=\s|$)|\u0000/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const c = (parts[i] || '').trim();
    if (c) out.push({ c, q: /\?/.test(parts[i + 1] || '') });
  }
  return out;
}

function lastMatchEnd(reG, s) {
  reG.lastIndex = 0;
  let m;
  let at = -1;
  while ((m = reG.exec(s))) { at = m.index + m[0].length; if (m[0].length === 0) reG.lastIndex++; }
  return at;
}

function compile(parties) {
  const party = partySource(parties);
  return {
    party,
    // a party, a place, or it/them right after a verb of telling or answering
    ref: new RegExp(String.raw`(?:${party})|${PLACE_SRC}|\b(?:tell|ask|answer|ping|message|remind|nudge|give|shoot|reply to|respond to|let)\s+(?:it|them)\b`, 'g'),
    place: new RegExp(PLACE_SRC),
    third: new RegExp(String.raw`(?:${party}|\b(?:he|she|it|they))\s+${MODAL}\b`, 'g'),
    // the party is only the subject of a decision ("whether the pm may", "want the builder to")
    // or the party did or does something itself ("the builder opened", "the builder is")
    subjectAfter: new RegExp(String.raw`^(?:'s)?\s+(?:${MODAL}|[a-z]+ed|is|was|has|had|says|said|sent|made|did|does|wants|needs|thinks|knows)\b`),
    // a decision about the party or an inverted question: the party follows directly
    subjectBefore: /\b(?:want|wants|like|prefer|rather|happy for|ok with|fine with|whether|if|should|would|could|can|will|does|do|did|is|are|was|were)\s+(?:the |that |your |our )?(?:(?!you\b|to\b)[a-z-]+ )?$/,
    relative: /\b(?:that|which|who)\s+(?:the )?$/,
  };
}

function addressOf(c) {
  const explicit = EXPLICIT.test(c);
  const fw = FIRST_WORD.exec(c);
  let imperative = false;
  let verb = null;
  if (fw && !fw[2]) {
    const w = fw[1];
    if (!NOT_IMPERATIVE.has(w) && !/ed$/.test(w) && !(ADVERB_LY.test(w) && !LY_VERBS.has(w)) && !/^builder-\d/.test(w)) { imperative = true; verb = w; }
  }
  return { explicit, imperative, verb, verbEnd: fw ? fw[0].length : 0 };
}

// null, or { phrase } with the clause that asks the operator to carry something to another party.
function findRelayRequest(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const re = compile(opts.parties);
    const partyRe = new RegExp(re.party);
    for (const { c, q } of clauses(text)) {
      if (OFFER.test(c) || REPORTED.test(c) || NO_NEED.test(c) || NOTE_TO_SELF.test(c) || BACK_TO_ME.test(c)) continue;
      const a = addressOf(c);
      if (!a.explicit && !a.imperative) continue;
      // a bare imperative asked as a question is a decision question ("Approve the plan for builder-1?")
      if (!a.explicit && q) continue;
      if (!a.explicit && a.verb && PLAN_VERBS.has(a.verb) && RECORD_ID.test(c)) continue;
      re.ref.lastIndex = 0;
      let m;
      let found = false;
      let n = 0;
      while ((m = re.ref.exec(c)) && n++ < 200) {
        const at = m.index;
        const before = c.slice(Math.max(0, at - 160), at);
        const after = c.slice(at + m[0].length, at + m[0].length + 30);
        if (partyRe.test(m[0]) && !re.relative.test(before) && (re.subjectAfter.test(after) || re.subjectBefore.test(before))) continue;
        // an address mark after the party ("..., please", "... yourself") addresses the whole clause
        const addr = Math.max(lastMatchEnd(EXPLICIT_G, before), (a.imperative && at <= 160) || a.explicit ? 0 : -1);
        const other = Math.max(lastMatchEnd(FIRST_G, before), lastMatchEnd(re.third, before));
        if (addr < 0 || other > addr) continue;
        if (!a.explicit) {
          // the weakest case: a bare imperative needs an action verb, a place, or the party as its object
          const direct = new RegExp(String.raw`^\s*(?:the |that |your |our )?(?:[a-z]+ ){0,2}?(?:${re.party})`).test(c.slice(a.verbEnd, a.verbEnd + 60));
          if (!ACTION_VERBS.has(a.verb) && !re.place.test(m[0]) && !direct) continue;
        }
        found = true;
        break;
      }
      if (found) return { phrase: c.slice(0, 200) };
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
