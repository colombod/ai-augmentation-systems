// scripts/lib/daily-plan.js — the Chief of Staff's day, computed from the record (R-01, R-02, R-06, R-45).
//
// In the Vault the Chief of Staff planned only at the end, relayed 44% of the owner's words verbatim,
// sent 65 messages to the Product Manager and 9 to the Delivery Manager, and never made the deciding
// unknown (the desktop app hands a local path, not a link) a blocker. Here the goal sheet, the day's
// ranked plan and the owner's briefing are assembled from records only: the owner queue and open owner
// questions, area stops, the assumption register and spike beads, plan.js select, pull request review
// records and reality-check beads. No agent judgement goes in; each item names the role it is routed to
// (the routing table below) and the one action, and carries the record id it came from.
//
// The plan is written to .delivery/plans/<date>.ndjson, append-only: a plan row per run (the latest of
// the day counts), and a sent row each time the Chief of Staff's message carries an item to a session
// (hooks/scripts/route-check.js). Yesterday's last plan row holds the story states the brief compares
// against. Protected by the lane for every role; rows are not chained (cooperative trust, like warnings).
const fs = require('fs');
const path = require('path');
const { withLock } = require('./lock.js');
const G = require('./gates.js');

const REL = path.join('.delivery', 'plans');
const SECTIONS = ['Owner steps due', 'Stops', 'Blocking unknowns', 'Next stories of the current wave', 'Pull requests waiting for review or merge', 'Reality checks pending'];
const COS = 'chief-of-staff';
const DM = 'delivery-lead';
const ROLE_WORD = { 'chief-of-staff': 'Chief of Staff', 'delivery-lead': 'Delivery Manager', 'product-manager': 'Product Manager', 'reality-checker': 'Reality Checker', 'spike-researcher': 'Spike Researcher', builder: 'builder', staffing: 'Staffing', 'progress-observer': 'Progress Observer' };

// ---- the routing table (R-06): one owning role per function ----
// fallback: the role that takes the function when the first is not on the team
const ROUTES = {
  owner_steps: [COS], owner_questions: [COS], decide_spike: [COS],
  stops: [DM], stall: [DM], probe: [DM], assign: [DM], review: [DM], merge: [DM], decide: [DM],
  design: ['product-manager'], decide_pm: ['product-manager'],
  spike: ['spike-researcher', DM], reality_check: ['reality-checker', DM],
};
// what is acceptance (the Delivery Manager's alone) and what is implementation (never the Product Manager's)
const ACCEPTANCE = new Set(['stops', 'review', 'merge', 'probe', 'decide']);
const IMPLEMENTATION = new Set(['assign', 'spike', 'reality_check']);

function instancesOf(team) {
  try { return require('./manifest.js').expandInstances(team).filter((i) => !i.role.retired); } catch (err) { return []; }
}
function routeOf(fn, team) {
  const inst = instancesOf(team);
  for (const role of ROUTES[fn] || [DM]) {
    const i = inst.find((x) => x.role.id === role);
    if (i) return { role, instance: i.instance };
  }
  const role = (ROUTES[fn] || [DM])[0];
  return { role, instance: role };
}

// ---- reading the record ----
const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (err) { return dflt; } };
const today = (now) => String(now || new Date().toISOString()).slice(0, 10);

function initiatives(root) {
  const dir = path.join(root, '.delivery', 'initiatives');
  return safe(() => fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort(), []);
}

// A read the views cannot do without: its failure is the command's, never an empty record (B2).
// hint: the command that shows the problem (bd where by default)
class ReadError extends Error { constructor(message, hint = 'bd where') { super(message); this.hint = hint; } }
function must(fn, what) {
  try { const v = fn(); return v === undefined || v === null ? [] : v; } catch (err) { throw new ReadError(`${what} could not be read (${String(err && err.message ? err.message : err).split('\n')[0]})`); }
}
// open owner questions; a broken or missing chain hides its questions, so it refuses the view (Copilot 741)
function ownerQuestions(root, pending) {
  const p = must(() => (pending || ((r) => require('./operator-records.js').pending(r, {})))(root), 'the operator records');
  const problems = p.problems || [];
  if (problems.length) {
    const first = problems[0];
    const text = typeof first === 'string' ? first : first.problem || first.error || first.message || JSON.stringify(first);
    throw new ReadError(`the operator records could not be read (${problems.length} problem${problems.length > 1 ? 's' : ''}: ${String(text).split('\n')[0]})`, 'operator.js problems');
  }
  return p.open_questions || [];
}

// Everything the sheet, the plan and the brief read. deps: bd (lib/bd.js store), team, now, gh (for
// pull requests), ci (the main build state), budget, verifyRecord. Throws a ReadError when bd, the owner
// queue, the operator records or the review records cannot be read, so no view stands on a guess.
function facts(root, { bd, team, now, gh, ci, budget, budgetOpts, verifyRecord, pending } = {}) {
  const W = require('./waves.js');
  const A = require('./assumptions.js');
  const AN = require('./andon.js');
  const C = require('./gate-context.js');
  const Q = require('./owner-queue.js');
  const stories = must(() => bd.list({ label: 'story', all: true }), 'bd');
  const known = new Map(stories.map((b) => [b.id, b]));
  const beadOf = (id) => known.get(id) || safe(() => bd.show(id), null);
  const spikes = must(() => bd.list({ label: 'spike', all: true }), 'bd');
  const checks = require('../reality-check.js').pending(must(() => bd.list({ label: 'reality-check' }), 'bd'));
  const fixBeads = ['bug', 'security'].flatMap((l) => must(() => bd.list({ label: l, all: true }), 'bd'));
  const ciState = ci || AN.ciState(root, { team });
  const andon = AN.summary(root, { beadOf, team, now, ci: ciState, fixBeads });
  const titles = new Map(require('./plan-docs.js').parseStories(path.join(root, '.delivery', 'stories')).map((s) => [s.id, s.title]));
  // what waits on the outside world: external-host assumptions not observed and acknowledged
  const regs = A.registers(root, { bd, verifyRecord });
  const unknowns = [];
  for (const slug of initiatives(root)) {
    for (const a of regs.rowsFor(slug).filter((x) => x.kind === 'external-host' && (x.status !== 'observed' || !x.acked) && x.criteria.length)) {
      const spike = a.spike || A.spikeIdFor((team && team.prefix) || 'x', slug, a.id);
      // assumption ids restart per initiative: the item is <initiative>/<id>, its spike an alias
      unknowns.push({ a, slug, spike, plain: a.criteria.map((c) => A.plainLine(titles.get(c.story) || 'A story not yet written up', a)) });
    }
  }
  const covered = new Set(unknowns.map((u) => u.spike));
  const openSpikes = spikes.filter((b) => b.status !== 'closed' && !covered.has(b.id));
  const queue = must(() => Q.open(root), 'the owner queue');
  const questions = ownerQuestions(root, pending);
  const ctx = W.contextFor(root, { bd, team, beads: stories, now, verifyRecord, budget, budgetOpts });
  must(() => bd.ready && bd.ready(), 'bd');
  const { ranked, byId } = W.selectRanked(bd, stories, ctx);
  // admission as the claim check decides it (bd-guard): the stop-the-line findings and the assumption
  // gate on top of select's own, so the plan never offers a claim the hook refuses, nor hides recovery
  // work the hook allows (Copilot 459)
  const regsAt = A.registers(root, { bd, verifyRecord });
  const admitted = (r) => {
    const b = byId.get(r.id) || known.get(r.id);
    if (!b) return false;
    const blocks = [...AN.claimFindings(b, { root, parent: b.parent ? beadOf(b.parent) : null, fix: ctx.fixOf(b), stories, beadOf, team, now, ci: ciState }),
      ...(G.isStoryBead(b) ? A.forStory(root, b, { bd, team, verifyRecord, atClaim: true, regs: regsAt }).findings : []),
      // the area pause on a refuted external assumption, each story read against its own initiative (Copilot 778)
      ...(G.isStoryBead(b) ? [A.areaAndon(b, stories, (s) => regsAt.rowsFor(G.initiativeOf(s)))].filter(Boolean) : [])].filter((x) => x.level === 'block');
    return !blocks.length;
  };
  const next = ranked.filter((r) => !r.refused && admitted(r)).slice(0, 3);
  const prs = must(() => require('../team-status.js').reviewStatus(root, { team, gh }), 'the review records');
  // checked on the customer's app: the done gate's own verdict on the evidence (B1)
  const recordOk = C.recordChecker(root, verifyRecord);
  const checked = (b) => G.stateOf(b) === 'verified' && safe(() => {
    const inp = C.gateInputs(root, b, { team });
    if (inp.evidenceProblem || G.scopeDrift(inp.story, b)) return false;
    const d = G.doneCheck({ story: inp.story, bead: b, rows: inp.rows, surface: inp.surface, noSurface: inp.noSurface, instances: inp.instances, recordOk });
    return d.ok && !d.cut;
  }, false);
  // stalls first (R-04, R-43): the watchdog's own reading of the record; it fails open, never refuses the view
  const watch = safe(() => require('./watchdog.js').read(root, { bd, now, team }), { stalls: [] });
  return { root, now, team, stalls: (watch && watch.stalls) || [], stalls_paused: (watch && watch.paused) || null, stories, titles, spikes: openSpikes, checks, andon, unknowns, queue, questions, budget: ctx.budget, areas: W.areas(stories), next, known, prs, storyOf: ctx.storyOf, checked };
}

// ---- the plan for the day ----
const item = (section, kind, fn, ref, action, plain, team, match = [ref]) => ({ section, kind, fn, ref, key: `${kind}:${ref}`, ...routeOf(fn, team), action, plain, match });

// the role of an instance named by the watchdog (a builder's own session, or the Delivery Manager)
function roleOfInstance(team, instance) {
  const i = instancesOf(team).find((x) => x.instance === instance);
  return i ? i.role.id : DM;
}
// section 0: stalls due now, each routed to the session the watchdog wakes for it
const stallRef = (s) => s.bead || (s.kind === 'limit' ? `limit:${s.target}` : s.kind);
function stallItems(f) {
  return (f.stalls || []).filter((s) => s.due).map((s) => ({ section: 0, kind: 'stall', fn: 'stall', ref: stallRef(s), key: `stall:${stallRef(s)}`, role: roleOfInstance(f.team, s.target), instance: s.target, action: s.line, plain: s.plain, match: [stallRef(s)] }));
}
// when the team resumes after a usage limit: the earliest scheduled wake
function resumesAt(f) {
  const w = (f.stalls || []).filter((s) => s.kind === 'limit' && !s.due).map((s) => s.wakeAt).sort();
  return w.length ? w[0] : null;
}

function items(f) {
  const t = f.team;
  const out = [...stallItems(f)];
  const W = require('./waves.js');
  for (const s of f.queue) out.push(item(1, 'owner-step', 'owner_steps', s.id, `give the owner today's batch (owner-queue.js list): ${s.what}`, s.what, t));
  for (const q of f.questions) out.push(item(1, 'owner-question', 'owner_questions', q.id, `put the question to the owner once, with options: ${q.text}`, q.text, t));
  const AN = require('./andon.js');
  for (const s of f.andon.stops) {
    const what = s.unreadable ? `a stop on ${s.row} could not be read: check it (bd show ${s.bead})` : `the ${s.areaName || s.area} area is stopped on ${s.row}: ${s.a3 ? `finish A3 ${s.a3.id}` : 'open the A3'} and route the linked fix (a3.js, andon.js show)`;
    out.push(item(2, 'stop', 'stops', s.row, what, AN.plainLines({ stops: [s], ci: {}, flaky: [], chains: [] })[0], t, [s.row, s.bead]));
  }
  if (f.andon.ci && f.andon.ci.red) out.push(item(2, 'stop', 'stops', 'ci:main', `main is red since ${String(f.andon.ci.since).slice(0, 16)}: fixes only, A3 on ci:main`, 'The main build is failing; only fixes go on.', t));
  for (const u of f.unknowns) {
    const a = u.a;
    const ref = `${u.slug}/${a.id}`;
    if (a.status === 'refuted') out.push(item(3, 'unknown', 'design', ref, `${a.id} of ${u.slug} was refuted: change the design (assumptions.js add, retire, relink --initiative ${u.slug}), then ask the Delivery Manager to materialise`, u.plain[0], t, [ref, u.spike]));
    else if (a.status === 'observed' && a.owner === 'owner') {
      // the owner decides: the Chief of Staff asks in the question box and records it; the Delivery
      // Manager, who can run assumptions.js ack, acknowledges citing that record (Copilot 800)
      out.push(item(3, 'owner-decision', 'decide_spike', ref, `ask the owner to decide on the result of ${a.id} of ${u.slug} in a question box (operator.js ask), record the answer scoped to ${u.spike}, then send the record to the Delivery Manager`, u.plain[0], t, [ref, u.spike]));
      out.push(item(3, 'unknown', 'decide', ref, `once the Chief of Staff sends the owner's record: assumptions.js ack ${u.spike} --result ${a.evidence} --decision '<the owner's decision>' --record <dec-id>`, u.plain[0], t, [ref, u.spike]));
    } else if (a.status === 'observed') {
      const fn = a.owner === 'product-manager' ? 'decide_pm' : 'decide';
      out.push(item(3, 'unknown', fn, ref, `${a.id} of ${u.slug} was observed on ${u.spike}: its decision owner acknowledges the result (assumptions.js ack ${u.spike} --result ${a.evidence} --decision '<decision>')`, u.plain[0], t, [ref, u.spike]));
    } else out.push(item(3, 'unknown', 'probe', ref, `${a.id} of ${u.slug} is still assumed: dispatch the Reality Checker's probe in the real host on spike ${u.spike} before any story on it`, u.plain[0], t, [ref, u.spike]));
  }
  for (const b of f.spikes) out.push(item(3, 'spike', 'spike', b.id, `run spike ${b.id}: ${b.title || ''}`.trim(), `${b.title || 'A technical question'}: being checked`, t));
  for (const r of f.next) {
    const b = f.known.get(r.id) || {};
    const w = W.waveOf(b);
    out.push(item(4, 'story', 'assign', r.id, `assign ${r.id} to a builder${w ? ` (wave ${w} of ${G.areaOf(b)})` : ''}`, f.titles.get(String((b.metadata || {}).story || '')) || r.title || b.title || 'a story', t));
  }
  const prs = f.prs || {};
  for (const n of [...(prs['waiting for review'] || [])]) out.push(item(5, 'pr', 'review', `#${n}`, `dispatch an independent review of PR #${n} (review.js request)`, 'a change waiting for review', t));
  for (const n of [...(prs['ready to merge'] || []), ...(prs['review passed'] || [])]) out.push(item(5, 'pr', 'merge', `#${n}`, `merge PR #${n} through the merge gate`, 'a reviewed change waiting to be merged', t));
  for (const n of prs['changes requested'] || []) out.push(item(5, 'pr', 'review', `#${n}`, `PR #${n} has changes requested: send the findings to its builder (review.js send-back)`, 'a change going back to its builder', t));
  for (const n of prs['build failing'] || []) out.push(item(5, 'pr', 'review', `#${n}`, `the build of PR #${n} is failing: route it to its builder`, 'a change whose build is failing', t));
  for (const n of prs['review record damaged'] || []) out.push(item(5, 'pr', 'review', `#${n}`, `the review record of PR #${n} is damaged: check it (review.js show ${n})`, 'a change whose review record needs a check', t));
  for (const b of f.checks) out.push(item(6, 'check', 'reality_check', b.id, `run the reality check ${b.id}`, b.title || 'a check on the customer\'s app', t));
  return out;
}

function snapshot(stories) {
  return Object.fromEntries(stories.map((b) => [b.id, G.stateOf(b) || (b.status === 'closed' ? 'closed' : 'open')]));
}

// ---- the append-only record ----
const fileOf = (root, date) => path.join(root, REL, `${date}.ndjson`);
function rowsOf(root, date) {
  return safe(() => fs.readFileSync(fileOf(root, date), 'utf8').split('\n').filter(Boolean).map((l) => safe(() => JSON.parse(l), null)).filter(Boolean), []);
}
function append(root, date, row) {
  fs.mkdirSync(path.join(root, REL), { recursive: true });
  return withLock(path.join(root, REL, '.lock'), () => {
    const seq = rowsOf(root, date).length + 1;
    const r = { seq, ...row };
    fs.appendFileSync(fileOf(root, date), `${JSON.stringify(r)}\n`);
    return r;
  }, { strict: true });
}
const dates = (root) => safe(() => fs.readdirSync(path.join(root, REL)).filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n)).map((n) => n.slice(0, 10)).sort(), []);
const lastPlan = (rows) => [...rows].reverse().find((r) => r.type === 'plan') || null;
function latest(root, date) { return lastPlan(rowsOf(root, date)); }
// the last plan of the latest earlier day
function previous(root, date) {
  for (const d of dates(root).filter((x) => x < date).reverse()) { const p = latest(root, d); if (p) return p; }
  return null;
}

function record(root, f, { by, now } = {}) {
  const at = now || new Date().toISOString();
  return append(root, today(at), { type: 'plan', at, by: by || null, items: items(f), states: snapshot(f.stories) });
}

// ---- routing: which plan items a message carries, and to whom ----
// display names and the short names the register uses (DM, PM)
const NAMES = { ...Object.fromEntries(Object.entries(ROLE_WORD).map(([id, w]) => [w.toLowerCase(), id])), dm: DM, pm: 'product-manager', cos: COS, rc: 'reality-checker' };
// { instance, role } for a SendMessage `to` or a session id, from the manifest and the roster
function recipient(root, team, to) {
  const name = String(to || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const inst = instancesOf(team);
  const hit = inst.find((i) => i.instance === name) || inst.find((i) => name.toLowerCase() === i.instance.toLowerCase());
  if (hit) return { instance: hit.instance, role: hit.role.id };
  const roster = safe(() => require('./roster.js').readRoster(root).instances, {}) || {};
  const bySession = Object.entries(roster).find(([, e]) => e && e.session_id && e.session_id === name);
  if (bySession) { const i = inst.find((x) => x.instance === bySession[0]); if (i) return { instance: i.instance, role: i.role.id }; }
  const role = NAMES[name.toLowerCase()];
  if (role) { const i = inst.find((x) => x.role.id === role); return { instance: i ? i.instance : role, role }; }
  return { instance: name || null, role: null };
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// only a reference written as [ref] carries an item: a plain mention for context is no send (I2)
const carries = (message, it) => (it.match || [it.ref]).some((m) => m && new RegExp(`\\[\\s*${esc(m)}\\s*\\]`, 'i').test(String(message || '')));

function misrouteText(it, to) {
  const owner = ROLE_WORD[it.role] || it.role;
  const sent = ROLE_WORD[to.role] || to.instance || 'an unknown session';
  const what = ACCEPTANCE.has(it.fn) ? 'acceptance work' : IMPLEMENTATION.has(it.fn) ? 'implementation work' : 'this item';
  return `${it.key} is ${what}, routed to the ${owner}; it was sent to the ${sent}`;
}

// After the Chief of Staff's message: a sent row for each of today's items it carries, and a warning for
// each sent to a role other than its owner. { sent: [...], misroutes: [...] }
function noteSent(root, { team, to, message, now, by } = {}) {
  const at = now || new Date().toISOString();
  const plan = latest(root, today(at));
  if (!plan) return { sent: [], misroutes: [], noPlan: true };
  const r = recipient(root, team, to);
  const sent = [];
  const misroutes = [];
  for (const it of plan.items.filter((x) => x.role !== COS && carries(message, x))) {
    const wrong = r.role !== it.role;
    sent.push(append(root, today(at), { type: 'sent', at, by: by || null, plan: plan.seq, key: it.key, to: r.instance, role: r.role, ...(wrong ? { misroute: true } : {}) }));
    if (wrong) {
      const detail = misrouteText(it, r);
      misroutes.push({ item: it, to: r, detail });
      safe(() => require('./warnings.js').record(root, { kind: 'misroute', rule: 'R-06', bead: /^[a-z0-9]/i.test(it.ref) && !/^(?:A-|ci:|#)/.test(it.ref) ? it.ref : undefined, detail, raisedBy: by, instance: by, now: at }));
    }
  }
  return { sent, misroutes };
}

// Today's items the Chief of Staff has not yet sent to their owning role (its own items excepted).
function unrouted(root, { now } = {}) {
  const d = today(now);
  const rows = rowsOf(root, d);
  const plan = lastPlan(rows);
  if (!plan) return { plan: null, open: [], misroutes: [] };
  const sent = rows.filter((r) => r.type === 'sent' && r.seq > plan.seq);
  const ok = (it) => sent.some((s) => s.key === it.key && s.role === it.role);
  const routed = plan.items.filter((x) => x.role !== COS);
  return { plan, open: routed.filter((x) => !ok(x)), misroutes: sent.filter((s) => s.misroute), total: routed.length };
}

// ---- the owner's briefing (R-45): outcome first, plain words, no ids, at most briefing_lines ----
const RANK = { open: 0, closed: 0, merged: 1, deployed: 2, verified: 3, cut: -1 };
const DAY = 86400e3;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function brief(f, { prev, limit = 12 } = {}) {
  const lines = [];
  const AN = require('./andon.js');
  // a stall or the resume time first: nothing else matters while nobody works (R-43)
  const r = resumesAt(f);
  if (r) lines.push(`The team resumes at ${require('./watchdog.js').clock(Date.parse(r))}, when the usage limit resets.`);
  lines.push(...[...new Set(stallItems(f).map((x) => x.plain))].slice(0, r ? 1 : 2));
  lines.push(...AN.plainLines(f.andon).slice(0, 2));
  // what changed since yesterday's plan, by the story states on the record
  const before = (prev && prev.states) || {};
  let merged = 0; let live = 0; let done = 0; let doneTitle = null;
  for (const b of f.stories) {
    const now = RANK[G.stateOf(b) || 'open'];
    const was = RANK[before[b.id] || 'open'] || 0;
    if (now >= 1 && was < 1) merged++;
    if (now >= 2 && was < 2) live++;
    if (now === 3 && was < 3 && f.checked(b)) { done++; doneTitle = doneTitle || f.titles.get(String((b.metadata || {}).story || '')) || b.title; }
  }
  // a plan more than a day before today is named by its date (M1)
  const gap = prev ? Date.parse(today(f.now)) - Date.parse(today(prev.at)) : 0;
  const since = !prev ? 'So far' : gap <= DAY ? 'Since yesterday' : `Since ${today(prev.at)}`;
  lines.push(merged || live || done
    ? `${since}: ${plural(merged, 'change')} merged, ${live} live, ${done} checked on the customer's app${doneTitle && done ? ` (${doneTitle})` : ''}.`
    : `${since}: nothing new merged, live or checked on the customer's app.`);
  // the plan's blocking unknowns in the owner's words: assumptions and open technical spikes (Copilot 509)
  for (const p of items(f).filter((x) => x.section === 3).map((x) => x.plain).slice(0, 2)) lines.push(`${p}.`);
  const waits = [];
  if (f.queue.length) waits.push(`${plural(f.queue.length, 'step')} only you can take, in one list`);
  if (f.questions.length) waits.push(`${plural(f.questions.length, 'decision')} for you`);
  lines.push(waits.length ? `Waiting on you: ${waits.join('; ')}.` : 'Nothing is waiting on you.');
  const next = items(f).filter((x) => x.section === 4).map((x) => x.plain);
  if (next.length) lines.push(`Today the team works on: ${next.slice(0, 2).join('; ')}${next.length > 2 ? `, and ${next.length - 2} more` : ''}.`);
  const prs = ['waiting for review', 'ready to merge', 'review passed'].reduce((n, k) => n + ((f.prs || {})[k] || []).length, 0);
  if (prs) lines.push(`${plural(prs, 'change')} waiting for review or merge.`);
  if (f.checks.length) lines.push(`${plural(f.checks.length, 'check')} on the customer's app planned.`);
  const end = 'Ask for details on any item';
  // one line: the most important one, ending with the offer
  if (limit <= 1) return [`${lines[0]} ${end}`];
  return [...lines.slice(0, limit - 1), end];
}

// ---- the goal sheet (R-01): one page from the records, each line with the ids it comes from ----
function firstSentence(file, heading) {
  const text = safe(() => fs.readFileSync(file, 'utf8'), '');
  const m = new RegExp(`^##\\s+${esc(heading)}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'mi').exec(text);
  if (!m) return null;
  const body = m[1].replace(/<!--[\s\S]*?-->/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !/^[|>#-]/.test(l)).join(' ');
  const s = (/^.*?[.!?](?=\s|$)/.exec(body) || [body])[0].trim();
  return s && !/^<.*>$/.test(s) ? s : null;
}

function sheet(f, { verifyRecord } = {}) {
  const Goal = require('./goal.js');
  const S = require('./surface.js');
  const W = require('./waves.js');
  const AN = require('./andon.js');
  const root = f.root;
  const out = [];
  const line = (section, text, sources) => out.push({ section, text, sources: sources.filter(Boolean) });
  for (const slug of initiatives(root)) {
    const dir = path.join(root, '.delivery', 'initiatives', slug);
    const fromBrief = firstSentence(path.join(dir, 'brief.md'), 'What changes if we solve it');
    const outcome = fromBrief || firstSentence(path.join(dir, 'prd.md'), 'Summary');
    if (outcome) line('Outcome', outcome, [`${slug}/${fromBrief ? 'brief.md' : 'prd.md'}`]);
    const sf = S.loadSurface(root, slug);
    const used = new Set(f.stories.filter((b) => G.initiativeOf(b) === slug || !G.initiativeOf(b)).map((b) => (b.metadata || {}).surface).filter(Boolean));
    for (const s of sf.surfaces.filter((x) => !used.size || used.has(x.id))) line('Customer surface', `${s.app} in ${s.mode}, on ${s.host}`, [sf.doc && sf.doc.owner_record, `surface ${s.id}`]);
  }
  const scope = Goal.resolve(root, 'scope', { verifyRecord, warn: false });
  if (scope.value && scope.value.length) line('Outcome', `In scope, on the owner's word: ${scope.value.join(', ')}`, [...new Set(Goal.read(root).history.filter((h) => h.field === 'scope_log').map((h) => h.record))]);
  if (!out.some((x) => x.section === 'Outcome')) line('Outcome', 'Not written yet: the brief has no outcome.', []);
  // done: every criterion of every story passes on the customer's app
  const crit = f.stories.filter((b) => G.stateOf(b) !== 'cut').map((b) => ({ b, n: ((f.storyOf(b) || {}).criteria || []).length }));
  const n = crit.reduce((m, x) => m + x.n, 0);
  const verified = f.stories.filter(f.checked);
  line('Done means', crit.length ? `each of ${plural(n, 'criterion', 'criteria')} across ${plural(crit.length, 'story', 'stories')} passes on the customer's app; ${verified.length} ${verified.length === 1 ? 'story is' : 'stories are'} checked so far` : 'no stories yet, so nothing defines done', crit.map((x) => x.b.id));
  const units = Goal.resolve(root, 'budget.weekly_units', { verifyRecord, warn: false });
  line('Budget', units.value !== null ? `${units.value} units a week, set by the owner${f.budget && f.budget.set ? `; ${require('./budget.js').units(f.budget.remaining)} left` : ''}` : 'not set by the owner, so budget checks only warn', [units.value !== null ? units.from : null]);
  const env = Goal.resolve(root, 'budget.usage_envelope', { verifyRecord, warn: false });
  if (env.value !== null) line('Budget', `at most ${env.value}% of the weekly allowance, set by the owner`, [env.from]);
  // waves counted by the same evidence-backed rule as "checked" above (Copilot 810)
  for (const x of f.areas.values()) {
    const w = W.waveLine(x, { checked: f.checked });
    const cur = W.currentWave(x, { checked: f.checked });
    if (w) line('Current wave', w, cur ? x.waves.get(cur).map((b) => b.id) : []);
  }
  for (const u of f.unknowns) for (const p of u.plain) line('Blocking unknowns', p, [u.a.id, u.spike]);
  for (const b of f.spikes) line('Blocking unknowns', `${b.title || 'A technical question'}: being checked`, [b.id]);
  for (const s of f.andon.stops) line('Blocking unknowns', AN.plainLines({ stops: [s], ci: {}, flaky: [], chains: [] })[0], [s.row, s.a3 && s.a3.id]);
  if (!out.some((x) => x.section === 'Blocking unknowns')) line('Blocking unknowns', 'none on the record', []);
  for (const s of f.queue) line('Waiting on the owner', `${s.what} (${s.where})`, [s.id]);
  for (const q of f.questions) line('Waiting on the owner', q.text, [q.id]);
  if (!out.some((x) => x.section === 'Waiting on the owner')) line('Waiting on the owner', 'nothing', []);
  return out;
}

module.exports = { resumesAt, stallItems, ReadError, REL, SECTIONS, ROUTES, ACCEPTANCE, IMPLEMENTATION, ROLE_WORD, routeOf, facts, items, record, latest, previous, rowsOf, recipient, carries, noteSent, unrouted, brief, sheet, today };
