// scripts/lib/owner-queue.js — the only things the owner is asked to do, each with exact steps (R-07, R-44).
//
// In the Vault the Chief of Staff sent the owner at least 36 asks in six days, 14 of them "open session
// X and type". The queue holds only what no agent can do: sign-in, consent, payment, a secret, an account
// step, or a decision only the owner makes (scope or vision, money, an irreversible action, logged first
// as an operator question). Checking whether something works is never the owner's: the Reality Checker
// or a builder runs it. Append-only rows per instance under .delivery/owner-queue/, like the warnings
// ledger; a done row closes a step.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./lock.js');
const W = require('./warnings.js');

const KINDS = ['signin', 'consent', 'payment', 'secret', 'account', 'decision'];
const DECISION_ABOUT = ['scope', 'money', 'irreversible'];
// A check of whether something works is never the owner's (the Reality Checker or a builder runs it);
// retrying a sign-in or testing a connection that is part of an owner-only step is fine.
const A_CHECK = /\b(?:tell me what you see|see (?:if|whether) it works|check (?:if|whether|that)|verify (?:it|that|whether|the (?:fix|import|feature|change|build))|test (?:it|that|whether|the (?!connection\b))|try (?:it|the|dropping|running)|run the (?:test|check|probe)|confirm (?:it|that) works)\b/i;
// A relay: going into another session to act there, or carrying a word to another role
const A_RELAY = /\b(?:open|go to|switch to)\b[^.;]{0,40}\bsession\b|\b(?:type|paste|enter|reply|approve|click|press)\b[^.;]{0,30}\b(?:in|into|inside)\s+(?:the\s+)?(?:[\w-]+\s+){0,4}(?:session|tab|pane)\b|\btell the [\w-]+|\breply in\b/i;

function dirOf(root) { return path.join(root, '.delivery', 'owner-queue'); }
const newId = (inst) => `o-${inst}-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

function rows(root) {
  let files = [];
  try { files = fs.readdirSync(dirOf(root)).filter((f) => f.endsWith('.ndjson')).sort(); } catch (err) { return []; }
  const out = [];
  for (const f of files) {
    for (const l of fs.readFileSync(path.join(dirOf(root), f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch (err) { /* a torn line is skipped */ }
    }
  }
  return out;
}

// every step with done folded in, oldest first
function list(root) {
  const all = rows(root);
  const done = new Map(all.filter((r) => r.type === 'done').map((r) => [r.id, r]));
  return all.filter((r) => r.type === 'step').map((s) => (done.has(s.id) ? { ...s, done_at: done.get(s.id).at, done_by: done.get(s.id).by } : s))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
const open = (root) => list(root).filter((s) => !s.done_at);

// { problem } or {} for a candidate step
function stepProblem(s, { questionExists } = {}) {
  if (!KINDS.includes(s.kind)) return { problem: `kind ${s.kind || '(none)'} is not an owner step (kinds: ${KINDS.join(', ')}); checks go to the Reality Checker`, team: s.kind === 'verification' ? 'check' : false };
  for (const k of ['what', 'where', 'steps']) if (!s[k] || !String(s[k]).trim()) return { problem: `--${k} is required: the owner gets the exact steps, not a summary` };
  // the destination counts too: "Approve the edit" in "the builder session" is a relay (Copilot round 5)
  const text = `${s.what} ${s.where} ${s.steps}`;
  if (A_RELAY.test(text) || /\b(?:in|inside|into|on) (?:the )?(?:[\w-]+ ){0,4}(?:session|tab|pane)\b/i.test(String(s.where))) return { problem: 'that is a relay into another session, not an owner step: that session does it itself', team: true };
  if (A_CHECK.test(text)) return { problem: 'that is a check of whether something works, not an owner step: the Reality Checker or a builder runs it', team: 'check' };
  if (s.kind === 'decision') {
    if (!DECISION_ABOUT.includes(s.about)) return { problem: `a decision step names --about ${DECISION_ABOUT.join('|')}; other decisions are the team's` };
    if (!/^q-/.test(String(s.question || '')) || (questionExists && !questionExists(s.question))) return { problem: 'a decision step cites the logged question (--question q-...): log it with operator.js ask first' };
  }
  return {};
}

function add(root, step, { instance, now, questionExists } = {}) {
  const p = stepProblem(step, { questionExists });
  if (p.problem) return { ok: false, error: p.problem, team: p.team || false };
  const inst = W.instanceOf(instance);
  const row = { type: 'step', id: newId(inst), kind: step.kind, what: step.what, where: step.where, steps: step.steps,
    ...(step.expect ? { expect: step.expect } : {}), ...(step.check ? { check: step.check } : {}), ...(step.bead ? { bead: step.bead } : {}),
    ...(step.about ? { about: step.about } : {}), ...(step.question ? { question: step.question } : {}), by: inst, at: now || new Date().toISOString() };
  withLock(path.join(dirOf(root), '.lock'), () => {
    fs.mkdirSync(dirOf(root), { recursive: true });
    fs.appendFileSync(path.join(dirOf(root), `${inst}.ndjson`), `${JSON.stringify(row)}\n`);
  });
  return { ok: true, row };
}

function done(root, id, { instance, now } = {}) {
  // under the lock: two sessions closing the same step write one done row
  return withLock(path.join(dirOf(root), '.lock'), () => {
    const s = list(root).find((x) => x.id === id);
    if (!s) return { ok: false, error: `no owner step ${id}` };
    if (s.done_at) return { ok: false, error: `${id} was done at ${s.done_at}` };
    const inst = W.instanceOf(instance);
    const row = { type: 'done', id, by: inst, at: now || new Date().toISOString() };
    fs.mkdirSync(dirOf(root), { recursive: true });
    fs.appendFileSync(path.join(dirOf(root), `${inst}.ndjson`), `${JSON.stringify(row)}\n`);
    return { ok: true, row, step: s };
  });
}

// The daily batch: every open step, numbered, in plain words, with its exact steps.
function batchLines(steps) {
  if (!steps.length) return ['Nothing needs you today.'];
  const order = (s) => KINDS.indexOf(s.kind);
  const lines = [`${steps.length} thing${steps.length > 1 ? 's' : ''} only you can do today:`];
  [...steps].sort((a, b) => order(a) - order(b)).forEach((s, i) => {
    lines.push(`${i + 1}. ${s.what} (${s.where})`);
    lines.push(`   Steps: ${s.steps}`);
    if (s.expect) lines.push(`   You should see: ${s.expect}`);
  });
  lines.push('Tell me when each is done; I check it from here.');
  return lines;
}

// Content words of a step's what, for matching a message's ask to a queue entry.
const STOP = new Set('the and for with that this from into your you our its a an to of in on at by it is be or as'.split(' '));
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

// true when the clause asks for the same action an open step holds: the clause's first action verb is
// the step's own verb, and they share at least two more words (or all, when the step has fewer).
// Shared place names alone ("Vault", "Edge") do not make "run the Vault import in Edge" the queued
// "Sign in to Vault in Edge" (Copilot 743).
const VERBS = new Set(('open type paste click run go sign log approve press enter copy restart reboot install set add create configure grant accept '
  + 'update delete push merge review test try unlock switch send tell forward check drop upload download change turn enable disable remove '
  + 'rotate generate visit start stop kill pay buy renew verify confirm connect authorize authorise link choose decide pick reply').split(' '));
const allWords = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function inQueue(clause, steps) {
  const cw = allWords(clause);
  const verb = cw.find((w) => VERBS.has(w));
  const c = new Set(words(clause));
  return steps.some((s) => {
    const sv = allWords(s.what).find((w) => VERBS.has(w));
    if (!verb || verb !== sv) return false;
    const w = [...new Set(words(s.what))].filter((x) => x !== sv);
    const hit = w.filter((x) => c.has(x)).length;
    return hit >= Math.min(2, w.length);
  });
}

// true when every action in the clause ("sign in ... and then run the import") is an open step's
// action; a queued first action does not exempt the others (Copilot round 3)
function allQueued(clause, steps) {
  const parts = String(clause || '').split(/\b(?:and then|then|and|also)\b|[,;]/i).filter((p) => allWords(p).some((w) => VERBS.has(w)));
  return parts.length > 0 && parts.every((p) => inQueue(p, steps));
}

module.exports = { allQueued, KINDS, DECISION_ABOUT, list, open, add, done, batchLines, inQueue, stepProblem, dirOf };
