// hooks/scripts/relay-guard.js — the operator-facing roles carry answers; the operator never relays them.
//
// Two checks for the Stop hook of the Chief of Staff and the Product Manager, the two roles that
// address the operator (claim-stop.js calls operatorChecks and bounds repeats per turn with turn.js):
//   1. an operator input captured in this session that has neither a record nor an ack blocks the
//      turn: record it (or ack it), then send the record id to the sessions that need it;
//   2. a final message that asks the operator to carry something to another session (tell, send,
//      forward, paste, reply in ... session) blocks the turn: send the record id yourself.
// The relay check is a heuristic backstop, not a boundary: it prefers missing a relay request over
// flagging a question about the operator's own decision. With the typed judge on (scripts/lib/judge.js),
// its relay_request answer decides and the regex is the fallback. Everything here fails open.
const fs = require('fs');
const path = require('path');
const { operatorCommand } = require('../../scripts/lib/plugin-root.js');

// the roles whose sessions the operator addresses, so whose inputs must be recorded
const OPERATOR_FACING = new Set(['chief-of-staff', 'product-manager']);
const DEFAULT_PLUGIN_ROOT = path.join(__dirname, '..', '..');

// ---- the relay detector ----
//
// Biased to recall: a missed relay request puts the operator to work as a messenger, a false alarm
// costs the Chief of Staff one rewrite. A clause (split at sentence ends, semicolons, blank lines and
// list items; a dash, an arrow or a colon after a short lead of at most four words also opens a new
// clause, unless the lead is a plan label such as "Next:" or a party, as in "builder-2 - rebasing")
// is a relay request when
//   (a) it addresses the operator: an address mark (please, kindly, can/could/would/will you or u,
//       would you mind, mind <-ing>, you'll need to, you should, you might, you can send|paste|
//       forward|copy|give|post, your turn/move, do me a favour, waiting on your, when you have a
//       moment, go ahead, ...), a "<label> for you:" whose text after the colon itself starts with
//       an imperative or an address mark, or it starts with an imperative-looking word. That word is
//       not a pronoun, auxiliary, determiner, question word, conjunction, preposition, label, day or
//       month, or common opener (meanwhile, recap, summary, ...); not a contraction or an id with a
//       digit (dec-40); not -ed, -ly or -ing; not a word of four or more letters ending in -s
//       (sessions, news; pass, press, discuss, ... are verbs); not followed by an auxiliary or an -s
//       verb ("thursday gives"); and not the start of a party ("staffing hired", "builder-3 has").
//       Bullets, softeners (just, then, okay, btw, ...), chat shorthand (u, ur, pls) and a lead-in
//       ("once you ...,", "before lunch,", "tomorrow morning,") are skipped first;
//   (b) it refers to another party: a role or instance from the manifest, builder-N, any "<word>
//       specialist|expert|engineer|reviewer|researcher|observer|lead|manager|owner|agent", a [hex]
//       session ref, a session/tab/window/terminal/pane/chat that is not this one, "the other ...",
//       "(over) there" (not "there is" or "there's"), or it/them as the one told or answered;
//   (c) nothing cancels it: a first-person or third-person subject nearer the party than the address
//       ("once you answer, I will tell the builder", "the builder will answer"), offers ("should I
//       ...?"), reported speech before the request ("you said to tell ..."), "no need to", notes to
//       self, a party that is only the subject of the question ("whether the PM may ...", "do you
//       want the builder to ..."), a counted noun ("five builders"), and the Chief of Staff's own
//       plan lines: a bare imperative with no "you" in a list under a plan label ("Plan:", "Next steps
//       on my side:"; not "Next steps for you:"), or a bare send/forward/pass/... of a record id with
//       no "you" after "I will" or "I'll".
// The weakest case, a bare imperative with no address mark, is dropped when it is a question (a
// decision question) and otherwise needs a verb from the operator-action list, a place or session
// ref, or the party within the verb's phrase ("Shoot the delivery lead a yes").
// Indirect requests are flagged too, with the party as their subject: "<party> is blocked until /
// waiting on / stalled on / parked until you", "<party> can't merge until you", "<party> needs your
// ok", "<party> should hear it from you", "a word from you to <party>", "best if the answer reaches
// <party> from you", "it'd help if you ...". A bare "until you" is not enough. They are dropped when
// the clause has a first-person word, is past tense, is a question, or the next clause asks the
// operator the decision itself. Code blocks, inline code, quoted lines (>) and double-quoted spans
// are ignored. Windows are bounded, so the scan is linear. A heuristic backstop, not a boundary.

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
const PLACE_SRC = String.raw`${NOT_OURS}\b${PLACE}\b|\[[a-z0-9-]{4,16}\]|\bthe other (?:one|session|tab|window|side)\b|(?<!\b(?:is|are|was|were)\s)\b(?:over )?there\b(?!['’]s\b|\s+(?:is|are|was|were|'s|will|should|may|might|has|have)\b)`;

const MARKS = String.raw`please|kindly|(?:can|could|would|will) (?:you|u)|would you mind|would you be able to|(?:you'll|you will|you) need to|need you to|you should|you must|you have to|you could|you can (?:send|paste|forward|copy|give|post)|you may want to|you might want to|you (?:might|may)(?! (?:see|notice|find|hear|have|be|recall|remember|know|like|want|wish|prefer|already)\b)|yourself|go ahead|your (?:turn|move)|do me a (?:favour|favor)|action (?:needed|required)|when you (?:have|get) a (?:moment|sec|second|chance|minute)|needs? your|waiting (?:on|for) your?|blocked on you`;
const EXPLICIT = new RegExp(String.raw`\b(?:${MARKS})\b|^(?:[-*+]\s+|\d+[.)]\s+)?mind \w+ing\b`);
const EXPLICIT_G = new RegExp(String.raw`\b(?:${MARKS})\b`, 'g');
// "<label> for you:" or "You:": an address only when what follows starts with an imperative or a mark
const LABEL = /\b(?:for you|you)\s*:\s*/;

// the operator-action verbs, for the weakest case only
const ACTION_VERBS = new Set(('tell ask ping message dm remind nudge give forward send copy paste relay pass post say type enter reply respond answer '
  + 'drop share approve accept allow click press hit confirm open switch head hop go jump pop sign okay ok shoot swing get loop check run nod greenlight').split(' '));
// first words that do not start an imperative
const NOT_IMPERATIVE = new Set(('i we you he she it they me us this that these those the a an my your our their its his her there here '
  + 'is are was were be been am do does did have has had can could would will should shall may might must what which who whom whose when where why how '
  + 'if once as and but or so because since while although though yes no not thanks thank nothing everything everyone nobody every all both each some any none '
  + 'one two three four five six seven eight nine ten next then now also still already done status briefing note plan summary update today tomorrow '
  + 'yesterday great good fine sure sorry hi hello hey welcome per after before with for from in on at to by of about over under without until '
  + 'recommendation recommended options option decision question questions answer: fyi heads re only maybe perhaps '
  + 'meanwhile earlier later recap overview highlights elsewhere separately overall finally lastly currently however '
  + 'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december').split(' '));
// a second word that shows the first word is a subject ("thursday gives", "staging is")
const SUBJECT_NEXT = /^\s+(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|does|did|isn't|wasn't|won't|can't|(?!(?:this|thus|plus|yes|ours|yours|hers|theirs|always|perhaps)\b)[a-z]{2,}[^su\s]s)\b/;
// words of four or more letters ending in -s are nouns or third-person verbs, except these verbs
const S_VERBS = new Set('pass press discuss access dismiss address process bless focus toss cross guess express assess bypass'.split(' '));
const SOFT = String.raw`(?:(?:just|then|now|also|quickly|simply|first|kindly|please|okay|ok|alright|right|so|btw|oh|and|ps),?\s+)*`;
// a lead-in before the verb: "once you have decided,", "before lunch,", "tomorrow morning,"
const LEAD = String.raw`^(?:[-*+]\s+|\d+[.)]\s+)?(?:(?:once|when|if|after|as soon as|before) you[^,]{0,60},\s*|(?:before|after|by|during|tomorrow|today|tonight|this|first thing|whenever)\b[^,]{0,30},\s*)?${SOFT}`;
const FIRST_WORD = new RegExp(String.raw`${LEAD}([a-z][a-z0-9'’-]*)(:?)`);
const MARK_START = new RegExp(String.raw`^${SOFT}(?:${MARKS})\b`);
// a dash, an arrow or a colon after a short lead opens a new clause ("One ask — go to ...")
const SPLIT = /\s*(?:—|–|\s-\s|→|:(?=\s|$))\s*/;
const PLAN_LEAD = /^(?:[-*+]\s+|\d+[.)]\s+)?(?:my |our |the )?(?:plan|next|next steps?|then|todo|to-do|to do|later|afterwards|note to self|notes?|steps?|i will|i'll)$/;
// a plan label ("Plan:", "Next steps:", "Plan for the next hour:"; not "Next steps for you:")
const PLAN_LABEL = /\b(?:plan|next|next steps?|todo|to-do|steps)\b[^.:]{0,60}:/g;
const FIRST_CTX = /\b(?:i will|i'll|i am going to|i'm going to|i am doing|i'm doing|i am about to|i'm about to|we will|we'll|i plan to|i intend to)\b/;
function planLabelled(ctx) {
  PLAN_LABEL.lastIndex = 0;
  let m;
  let ok = false;
  while ((m = PLAN_LABEL.exec(ctx))) ok = !/\b(?:for you|you:)/.test(m[0]);
  return ok;
}
const SECOND = /\b(?:you|your|yours|yourself|u)\b/;

const OFFER = /\b(?:should i|shall i|do you want me to|would you like me to|want me to|is it ok if i|can i|may i|happy for me to)\b/;
const REPORTED = /\byou (?:said|asked|wanted|told|mentioned|decided|chose)\b/;
const NO_NEED = /\b(?:do not need to|don't need to|no need to|no action|no reply needed|nothing (?:is )?needed)\b/;
const NOTE_TO_SELF = /\bnote to self\b/;
// asked back to the Chief of Staff ("tell me", "remind me"): the operator is not sent elsewhere
const BACK_TO_ME = /\b(?:tell|ask|ping|message|send|remind|let|give|show|update|notify|email|dm|call|text)\s+(?:me|us)\b/;
const ADVERB_LY = /ly$/;
const LY_VERBS = new Set(['reply', 'apply', 'supply', 'rely']);
const FIRST_G = /\b(?:i|we|i'll|i've|i'm|i'd|we'll|we've|let me)\b/g;
const FIRST = /\b(?:i|we|i'll|i've|i'm|i'd|we'll|we've|let me|via me|through me)\b/;
const RECORD_ID = /\b(?:dec|del|ans|rec|in)-[a-z0-9-]*\d\b/i;
const PLAN_VERBS = new Set(['send', 'forward', 'give', 'pass', 'share', 'post', 'copy', 'paste', 'relay']);
const MODAL = String.raw`(?:will|can|should|would|must|may|might|'ll|is going to|are going to)`;
// indirect requests: the party waits on the operator, or should hear it from the operator
const INDIRECT = /\b(?:blocked|waiting|stalled|stuck|held up) (?:until|on|for) you\b|\b(?:waiting|holding|blocked|paused|stalled|stuck|parked)\b[^,;]{0,40}\b(?:on|for) your\b|\bfor your (?:yes|ok|okay|go-ahead|word|nod|sign-off|green light)\b|\b(?:can't|cannot|can not|won't|will not)\b[^,;]{0,30}\buntil you\b|\bneeds? (?:to hear from you|a (?:quick )?word from you|an answer from you|your (?:word|answer|ok|okay|approval|yes|go-ahead|sign-off|nod))\b|\bit(?:'d| would)(?: really| greatly| a lot)? help(?: a lot)? if you\b|\b(?:is|are|stays|remains|sits|sitting|parked|holding|paused|idle|waits)\b[^,;]{0,40}\buntil you\b/;
const INDIRECT_PAST = /\b(?:was|were|had)\b/;
const FROM_YOU = /\b(?:word|yes|ok|okay|go-ahead|nod|answer|reply|confirmation|approval|sign-off|hear|hears|hearing|reach|reaches|come|comes|goes|get|gets|receive|receives|learn|learns)\b[^;]{0,50}?\bfrom you\b/;
// "it is best if the answer reaches the builder from you": a wish, whatever the tense
const BEST_IF = /\b(?:best|better|quickest|fastest|easiest|simplest|cleanest|ideal)\s+if\b[^;]{0,80}\bfrom you\b/;
const PAST = /\b(?:[a-z]+ed|got|had|was|were|came|gave|sent|heard|said|told|took|made|did)\b/;
// the operator is asked the decision itself in the next clause
const DECISION_NEXT = /\byou\b|^(?:which|what|should|shall|do|does|would|is|are|a or b|option)\b/;

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
// Each clause carries raw (its own casing), c (lowercased), q (it ended with a question mark) and
// ctx (the earlier clauses of its paragraph, at most 400 characters).
function clauses(text) {
  const parts = strip(text)
    .replace(/\n\s*\n/g, ' \u0000 ')
    .replace(/\n(?=\s*(?:[-*+]\s|\d+[.)]\s))/g, ' \u0002 ')
    .replace(/\s+/g, ' ')
    .split(/([.!?;]+)(?=\s|$)|(\u0000|\u0002)/);
  const out = [];
  let ctx = '';
  for (let i = 0; i < parts.length; i += 3) {
    const raw = (parts[i] || '').trim();
    if (raw) {
      // chat shorthand: u, ur, pls
      const c = raw.toLowerCase().replace(/\bu\b/g, 'you').replace(/\bur\b/g, 'your').replace(/\b(?:pls|plz)\b/g, 'please');
      out.push({ raw, c, q: /\?/.test(parts[i + 1] || ''), ctx });
      ctx = `${ctx} ${c}`.slice(-400);
    }
    if (parts[i + 2] === '\u0000') ctx = '';
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
    partyRe: new RegExp(party),
    partyStart: new RegExp(String.raw`^(?:${party})`),
    // a party, a place, or it/them right after a verb of telling or answering
    ref: new RegExp(String.raw`(?:${party})|${PLACE_SRC}|\b(?:tell|ask|answer|ping|message|remind|nudge|give|shoot|reply to|respond to|let)\s+(?:it|them)\b`, 'g'),
    place: new RegExp(PLACE_SRC),
    third: new RegExp(String.raw`(?:${party}|\b(?:he|she|it|they))\s+${MODAL}\b`, 'g'),
    // the party is only the subject of a decision ("whether the pm may", "want the builder to")
    // or the party did or does something itself ("the builder opened", "the builder is")
    subjectAfter: new RegExp(String.raw`^(?:'s)?\s+(?:${MODAL}|[a-z]+ed|is|was|has|had|says|said|sent|made|did|does|wants|needs|thinks|knows)\b`),
    // ("you could ping builder-7" is not inverted: the party is the object)
    subjectBefore: /(?:\b(?:want|wants|like|prefer|rather|happy for|ok with|fine with|whether|if)|(?<!\byou\s)\b(?:should|would|could|can|will|does|do|did|is|are|was|were))\s+(?:the |that |your |our )?(?:(?!you\b|to\b)[a-z-]+ )?$/,
    relative: /\b(?:that|which|who)\s+(?:the )?$/,
  };
}

// { imperative, verb, verbEnd } for the start of a clause
function startOf(c, re) {
  const fw = FIRST_WORD.exec(c);
  if (!fw || fw[2]) return { imperative: false, verb: null, verbEnd: fw ? fw[0].length : 0 };
  const w = fw[1];
  const at = fw[0].length - w.length;
  const not = NOT_IMPERATIVE.has(w) || /ed$/.test(w) || (ADVERB_LY.test(w) && !LY_VERBS.has(w)) || /^builder-/.test(w) || /['’\d]/.test(w)
    || (w.length > 3 && /s$/.test(w) && !S_VERBS.has(w)) || (w.length > 5 && /ing$/.test(w))
    || (!ACTION_VERBS.has(w) && re.partyStart.test(c.slice(at)))
    || (SUBJECT_NEXT.test(c.slice(fw[0].length, fw[0].length + 30)) && !re.partyStart.test(c.slice(fw[0].length).trimStart()));
  return not ? { imperative: false, verb: null, verbEnd: fw[0].length } : { imperative: true, verb: w, verbEnd: fw[0].length };
}

function addressOf(c, re) {
  const s = startOf(c, re);
  const explicit = EXPLICIT.test(c);
  let labelled = false;
  const lab = LABEL.exec(c);
  if (lab) {
    const rest = c.slice(lab.index + lab[0].length);
    labelled = startOf(rest, re).imperative || MARK_START.test(rest);
  }
  return { ...s, explicit, strong: explicit || labelled };
}

// where the request starts: the first address mark, or the imperative verb
function addressAt(c, re) {
  const m = EXPLICIT.exec(c);
  const s = startOf(c, re);
  return Math.min(m ? m.index : Infinity, s.imperative ? s.verbEnd - s.verb.length : Infinity);
}

// a direct (marked or imperative) request in clause c
function direct(c, q, ctx, re) {
  const a = addressOf(c, re);
  if (!a.strong && !a.imperative) return false;
  // a bare imperative asked as a question is a decision question ("Approve the plan for builder-1?")
  if (!a.explicit && q) return false;
  // the Chief of Staff's own plan line: send a record id, inside a plan or first-person context
  // any bare imperative in a list under a plan label is a plan line too
  if (!a.strong && a.verb && !SECOND.test(c)) {
    const plan = planLabelled(ctx);
    if (plan || (PLAN_VERBS.has(a.verb) && RECORD_ID.test(c) && FIRST_CTX.test(ctx))) return false;
  }
  re.ref.lastIndex = 0;
  let m;
  let n = 0;
  while ((m = re.ref.exec(c)) && n++ < 200) {
    const at = m.index;
    const before = c.slice(Math.max(0, at - 160), at);
    const after = c.slice(at + m[0].length, at + m[0].length + 30);
    if (re.partyRe.test(m[0]) && !re.relative.test(before) && (re.subjectAfter.test(after) || re.subjectBefore.test(before))) continue;
    // an address mark after the party ("..., please", "... yourself") addresses the whole clause
    const addr = Math.max(lastMatchEnd(EXPLICIT_G, before), (a.imperative && at <= 160) || a.strong ? 0 : -1);
    const other = Math.max(lastMatchEnd(FIRST_G, before), lastMatchEnd(re.third, before));
    if (addr < 0 || other > addr) continue;
    if (!a.strong) {
      // the weakest case: a bare imperative needs an action verb, a place, or the party as its object
      const obj = new RegExp(String.raw`^\s*(?:the |that |your |our )?(?:[a-z'-]+ ){0,5}?(?:${re.party})`).test(c.slice(a.verbEnd, a.verbEnd + 60));
      if (!ACTION_VERBS.has(a.verb) && !re.place.test(m[0]) && !obj) continue;
    }
    return true;
  }
  return false;
}

// an indirect request: the party (often the subject) waits on the operator or should hear from them
function indirect(c, q, next) {
  if (q || FIRST.test(c)) return false;
  const hit = (INDIRECT.test(c) && !INDIRECT_PAST.test(c)) || (FROM_YOU.test(c) && !PAST.test(c)) || BEST_IF.test(c);
  if (!hit) return false;
  // "the builder is waiting on you. Which do you prefer, A or B?" asks the decision here
  if (next && next.q && DECISION_NEXT.test(next.c)) return false;
  return true;
}

// null, or { phrase, clause }: the clause (lowercased, and in its own casing) that asks the operator
// to carry something to another party.
// "the builder has a permission prompt open, please approve it": asking the operator to press a
// button in another session's harness is a relay too (spec 8.6, permission prompts)
const PERMISSION_PROMPT = /\bpermission (?:prompt|dialog|request|popup|pop-up)s?\b/i;
const PROMPT_STATE = /\b(?:open|opened|showing|shown|pending|waiting|up|stuck)\b/i;
const APPROVE_IT = /\b(?:approve|allow|accept|click|press|confirm|ok)\b[^.?!;]{0,40}?\b(?:it|that|them|the prompt|the dialog|the request|yes)\b/i;
const SELF_APPROVE = /\b(?:i|we)(?:'ll| will| have| had| already)?\s+(?:\w+\s+)?(?:approve|allow|accept|click|press|confirm)/i;

function permissionPromptRelay(list, i) {
  const { c } = list[i];
  if (!PERMISSION_PROMPT.test(c) || !PROMPT_STATE.test(c)) return false;
  for (const x of [c, list[i + 1] && list[i + 1].c].filter(Boolean)) {
    if (APPROVE_IT.test(x) && !SELF_APPROVE.test(x)) return true;
  }
  return false;
}

function findRelayRequest(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const re = compile(opts.parties);
    const list = clauses(text);
    for (let i = 0; i < list.length; i++) {
      const { raw, c, q, ctx } = list[i];
      if (permissionPromptRelay(list, i)) return { phrase: c.slice(0, 200), clause: raw.slice(0, 200) };
      if (OFFER.test(c) || NO_NEED.test(c) || NOTE_TO_SELF.test(c) || BACK_TO_ME.test(c)) continue;
      // reported speech cancels when it comes before the request ("you said to tell ..."), not
      // when it qualifies the object ("brief the engineer on the thresholds you chose")
      const rep = REPORTED.exec(c);
      if (rep && rep.index <= addressAt(c, re)) continue;
      let found = direct(c, q, ctx, re);
      if (!found) {
        const sp = SPLIT.exec(c);
        if (sp && sp.index <= 60) {
          const lead = c.slice(0, sp.index).trim();
          const rest = c.slice(sp.index + sp[0].length).trim();
          // "<party> — <status>" is a status line, "Next: ..." a plan line
          const bare = lead.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
          const status = re.partyStart.test(bare) || re.partyStart.test(bare.replace(/^(?:the|a|an|our)\s+/, ''));
          if (rest && (lead ? lead.split(/\s+/).length : 0) <= 4 && !PLAN_LEAD.test(lead) && !status) found = direct(rest, q, `${ctx} ${lead}`, re);
        }
      }
      if (!found && re.partyRe.test(c)) found = indirect(c, q, list[i + 1]);
      if (found) return { phrase: c.slice(0, 200), clause: raw.slice(0, 200) };
    }
  } catch (err) { /* a heuristic never blocks on its own failure */ }
  return null;
}

// The relay reasons quote the flagged clause from the first block on.
const RELAY_REASON = 'You carry answers; the operator does not.\nRewrite only that clause: send the record id yourself with SendMessage.';
// the relayed thing has no record yet (a question to pass on, an answer not recorded)
const RELAY_REASON_NO_RECORD = 'You carry answers; the operator does not.\nRewrite only that clause: ask an owner-only decision here yourself, record the answer, then send the record id with SendMessage.';
const RELAY_RECORD_ID = /\b(?:dec|del|ans)-[a-z0-9-]*\d\b/i;

// extra (the typed judge's rating) joins the first line, so the second stays the way out
function relayReason(message, clause, extra) {
  const base = RELAY_RECORD_ID.test(String(message || '')) ? RELAY_REASON : RELAY_REASON_NO_RECORD;
  const [head, tail] = base.split('\n');
  const said = clause ? ` You wrote: "${String(clause).replace(/\s+/g, ' ').slice(0, 160)}".` : '';
  return `${head}${said}${extra ? ` ${extra}` : ''}\n${tail}`;
}

// Commands in block reasons are the exact form the session can run (absolute path, single quotes).
function unrecordedReason(list, op) {
  const first = list[0];
  const n = first.id;
  const excerpt = String(first.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const more = list.length > 1 ? ` and ${list.length - 1} more` : '';
  return `You have an operator input with no record: ${n} ("${excerpt}")${more}. Record the decision or ack it (operator.js ack --input ${n}; for chat, ack --pending), then SendMessage the record id.\n\`${op} record --cite ${n} --quote '<exact words>' --statement '<what was decided>' --scope bead:<id>\``;
}

// What the session CAN do: no lane may write the operator records, so restoring the file from the
// private operator store's history is an owner-side task for the briefing; the Chief of Staff can set the broken chain aside (the file
// is kept as evidence) and keep recording; the Product Manager asks the Chief of Staff to.
function integrityReason(instance, problem, op, role) {
  const what = `${problem.code || 'chain_invalid'}: ${String(problem.error || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  const quarantine = `\`${op} quarantine --file records/${instance}.ndjson --reason '<what failed>'\``;
  const act = role === 'chief-of-staff'
    ? `Set it aside (kept as evidence) and keep recording: ${quarantine}`
    : 'SendMessage the Chief of Staff with the problem; it sets the chain aside';
  return `Your own operator records chain (records/${instance}.ndjson) fails verification (${what}); nothing can be recorded on it (\`${op} problems\` shows it).\n${act}.`;
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

function tornTailReason(instance, problem, op) {
  return `Your own operator records chain (records/${instance}.ndjson) has an incomplete last line (torn_tail: ${String(problem.error || '').replace(/\s+/g, ' ').slice(0, 120)}); your next record or ack repairs it.\nTo repair it now: \`${op} repair --instance ${instance}\``;
}

// [{ kind: 'unrecorded' | 'integrity', reason }] for the Chief of Staff's own inputs ([] or null when nothing applies).
function inputCheck({ projectRoot, sessionId, instance, deps, warn, op, role }) {
  if (!sessionId) return null;
  let opDir = null;
  try { opDir = require('../../scripts/lib/operator-log.js').opDir(projectRoot); } catch (err) { opDir = null; }
  if (!opDir || !fs.existsSync(opDir)) {
    warn('delivery: the operator records directory does not exist yet, so the unrecorded-input check had nothing to read; operator capture creates it on the first captured input\n');
    return null;
  }
  let res;
  try {
    res = (deps.pending || require('../../scripts/lib/operator-records.js').pending)(projectRoot, { sessionId });
  } catch (err) {
    warn(`delivery: the unrecorded-input check was skipped (${err && err.message ? err.message : err}); run ${op} pending\n`);
    return null;
  }
  const problems = (res && Array.isArray(res.problems)) ? res.problems : [];
  const untrusted = problems.find((p) => p && (p.code === 'manifest_unavailable' || p.code === 'format_unrecognised'));
  if (untrusted) {
    warn(`delivery: the unrecorded-input check was skipped: ${untrusted.error || untrusted.code}; run ${op} pending\n`);
    return null;
  }
  const out = [];
  const broken = ownChainProblem(problems, instance);
  if (broken && broken.code !== REPAIRABLE_BY_WRITE) return [{ kind: 'integrity', reason: integrityReason(instance, broken, op, role) }];
  if (broken) out.push({ kind: 'integrity', reason: tornTailReason(instance, broken, op) });
  const mine = ((res && res.inputs) || []).filter((e) => e && e.id && e.session_id === sessionId && (!instance || e.instance === instance));
  if (mine.length) out.push({ kind: 'unrecorded', reason: unrecordedReason(mine, op) });
  return out;
}

// ---- the typed judge on the relay check (R-37) ----
// The judge confirms or overrules the regex; it never lets a regex hit through unless it is clearly
// negative. With an answer p:
//   regex hit:  p >= min(warn_threshold, 0.5) blocks (the regex clause and p quoted); below it passes,
//               recorded as an overruled hit (advisory, kind relay-overruled);
//   no hit:     p >= block_threshold blocks (the message's start and p quoted); warn_threshold <= p <
//               block_threshold leaves a one-time reminder (advisory, kind relay-warn); below passes.
// With the judge off, or on any skip, local refusal, error or timeout, the regex decides exactly as before.
const ROLE_NAMES = { 'chief-of-staff': 'Chief of Staff', 'product-manager': 'Product Manager' };

// null when the judge is off or the role does not address the operator; else the typed result,
// the thresholds in force and whether the regex found a clause (logged next to the judge's answer).
async function judgeRelay({ input, team, role, retired, projectRoot, parties, deps = {} } = {}) {
  try {
    if (!OPERATOR_FACING.has(role) || retired) return null;
    const judge = require('../../scripts/lib/judge.js');
    const env = deps.env || process.env;
    const cfg = judge.judgeConfig(team, env);
    if (!cfg.enabled) return null;
    const raw = input && input.last_assistant_message;
    const message = typeof raw === 'string' ? strip(raw).trim() : '';
    if (!message) return null;
    const regex = !!findRelayRequest(raw, { parties });
    const r = await judge.ask('relay_request', { sender_role: ROLE_NAMES[role], recipient: 'owner', message },
      { config: cfg, env, projectRoot, gate: 'relay-guard', timeoutMs: deps.timeoutMs || 2000, logExtra: { regex: regex ? 'hit' : 'miss' } });
    return { ...r, block_threshold: cfg.block_threshold, warn_threshold: cfg.warn_threshold, regex };
  } catch (err) { return null; }
}

function relayCandidates(message, relay, judged) {
  const p = judged && typeof judged.p === 'number' ? judged.p : null;
  if (p === null) return relay ? [{ kind: 'relay', reason: relayReason(message, relay.clause), detail: relay.phrase }] : [];
  const rated = `The typed judge rates this message p ${p.toFixed(2)} as a relay request (advisory evidence).`;
  if (relay) {
    // overruled only when clearly negative: below the warn threshold and below 0.5, whatever the manifest says
    if (p >= Math.min(judged.warn_threshold, 0.5)) return [{ kind: 'relay', reason: relayReason(message, relay.clause, rated), detail: relay.phrase }];
    return [{ kind: 'relay-overruled', advisory: true, record: true, p, reason: `The relay detector flagged "${String(relay.clause).replace(/\s+/g, ' ').slice(0, 160)}"; the typed judge overruled it at p ${p.toFixed(2)}.` }];
  }
  const start = strip(message).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (p >= judged.block_threshold) return [{ kind: 'relay', reason: relayReason(message, start, rated), detail: start }];
  if (p >= judged.warn_threshold) {
    return [{ kind: 'relay-warn', advisory: true, reason: `Reminder: ${rated}\nIf it asked the operator to act in another session or carry a word, do it yourself next time with SendMessage.` }];
  }
  return [];
}

// Every operator check that applies to this stop, ignoring stop_hook_active (claim-stop.js limits
// repeats per turn, per session). [] for roles that do not address the operator, and on any failure.
function operatorChecks({ input, roleDir, projectRoot, role, instance, captureStatus, parties, pluginRoot, retired, judged, deps = {} } = {}) {
  try {
    // a retired instance records nothing new (operator.js refuses), so its guard stands down
    if (!OPERATOR_FACING.has(role) || retired) return [];
    const op = operatorCommand(pluginRoot || DEFAULT_PLUGIN_ROOT);
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return [];
    const inp = input && typeof input === 'object' ? input : {};
    const warn = deps.warn || (() => {});
    const sessionId = sessionIdOf(roleDir, inp);
    if (captureStatus === 'format_unrecognised' || formatUnrecognised(projectRoot, sessionId)) {
      warn('delivery: the transcript format was not recognised, so the operator stop checks were skipped; tell the Chief of Staff\n');
      return [];
    }
    const out = [];
    out.push(...(inputCheck({ projectRoot, sessionId, instance, deps, warn, op, role }) || []));
    out.push(...relayCandidates(inp.last_assistant_message, findRelayRequest(inp.last_assistant_message, { parties }), judged));
    return out;
  } catch (err) {
    return [];
  }
}

// clauses, compile, addressOf and strip are shared with message-checks.js (orders to the owner)
module.exports = { clauses, compile, addressOf, strip, findRelayRequest, operatorChecks, judgeRelay, relayCandidates, sessionIdOf, relayReason, RELAY_REASON, RELAY_REASON_NO_RECORD, OPERATOR_FACING };
