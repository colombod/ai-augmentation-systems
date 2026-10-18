// scripts/lib/waves.js — compounding waves (R-36), the half-built check (D5), and compounding-first
// selection with fixes and security first (R-41). Pure over beads, story files and the budget state;
// the hook (bd-guard), wave.js and plan.js supply the reads.
//
// A wave is a set of story beads in one product area that together deliver a verified increment. It
// is a label, wave-<n>, that materialise stamps from the story's `wave:` frontmatter, not a wave epic:
// a story's one parent is its phase epic, which carries the phase-review chain and the phase labels,
// and re-parenting every story under a wave epic would break that chain. A label is additive, managed
// the way materialise already manages size labels, and readable with `bd list --label wave-2`.
// The current wave of an area is the lowest wave with a story neither verified nor cut. Owner ruling:
// the gates block only on serious divergence; everything else here is a warning.
const fs = require('fs');
const path = require('path');
const G = require('./gates.js');
const B = require('./budget.js');

const FIX_LABELS = ['bug', 'security'];
const waveOf = (b) => {
  const m = b && b.metadata && Number(b.metadata.wave);
  if (Number.isInteger(m) && m > 0) return m;
  const l = ((b && b.labels) || []).find((x) => /^wave-\d+$/.test(x));
  return l ? Number(l.slice(5)) : null;
};
const areaOf = (b) => G.areaOf(b);
const finished = (b) => ['verified', 'cut'].includes(G.stateOf(b));
// built: anything started, merged, deployed, verified or closed (a cut is not built)
const built = (b) => G.stateOf(b) !== 'cut' && (Boolean(G.stateOf(b)) || b.status === 'in_progress' || b.status === 'closed');

// Map area -> { waves: Map n -> beads, unwaved, current, built, verified }. `except` leaves out the
// bead being claimed, so it does not count as work already built in its own area.
function areas(beads, { except } = {}) {
  const out = new Map();
  for (const b of beads) {
    if (!G.isStoryBead(b)) continue;
    const a = areaOf(b);
    if (!out.has(a)) out.set(a, { area: a, waves: new Map(), unwaved: [], current: null, built: false, verified: 0 });
    const x = out.get(a);
    const w = waveOf(b);
    if (w) (x.waves.get(w) || x.waves.set(w, []).get(w)).push(b); else x.unwaved.push(b);
    if (b.id !== except && built(b)) x.built = true;
    if (G.stateOf(b) === 'verified') x.verified++;
  }
  for (const x of out.values()) {
    const order = [...x.waves.keys()].sort((p, q) => p - q);
    x.order = order;
    x.current = order.find((n) => x.waves.get(n).some((b) => !finished(b))) || null;
  }
  return out;
}
const started = (stories, except) => stories.some((b) => b.id !== except && built(b));

// "wave 2 of import: 3 of 5 stories checked on the customer's app"
function waveLine(x) {
  if (!x.order || !x.order.length) return null;
  if (!x.current) return `${x.area}: all ${x.order.length} wave(s) checked on the customer's app`;
  const s = x.waves.get(x.current);
  const done = s.filter((b) => G.stateOf(b) === 'verified').length;
  const cut = s.filter((b) => G.stateOf(b) === 'cut').length;
  return `wave ${x.current} of ${x.area}: ${done} of ${s.length - cut} stories checked on the customer's app${cut ? ` (${cut} cut)` : ''}`;
}

// ---- files touched (parallel builders take file-disjoint stories, R-23) ----
const norm = (p) => String(p).replace(/\/\*\*.*$|\/\*$/, '/').replace(/^\.\//, '');
function overlap(a, b) {
  const hit = [];
  for (const x of a || []) for (const y of b || []) {
    const p = norm(x.path);
    const q = norm(y.path);
    if (p === q || (p.endsWith('/') && q.startsWith(p)) || (q.endsWith('/') && p.startsWith(q))) hit.push(p.length <= q.length ? p : q);
  }
  return [...new Set(hit)];
}

// ---- fixes and security fixes (R-41 tier 1) ----
// { labelled, kind, link, ok, why }. Tier 1 skips the wave, lean and new-area rules, so the link must
// name something a builder cannot make up (PR 54 review B-1):
// - a `bug` with `fixes:` naming a merged, deployed or verified story; a failed check row that counts
//   (written by the Delivery Manager or a Reality Checker, on the declared surface, in an intact
//   chain); or the owner's own report of the defect (a record resting only on the owner's words, not a
//   goal decision, scoped to this bead or naming it);
// - a `security` bead with `finding:` naming a review finding by id (.delivery/reviews/<file>#<id>)
//   or a finding bead (labelled security and finding).
// Never the bead itself. The labels and links are the Delivery Manager's and Product Manager's to set
// (bd-guard). The label alone is ordinary work.
const STOP = new Set('after before every again from with this that when then them they their there have been into onto over under about fix fixes bug the and for'.split(' '));
const words = (t) => new Set((String(t || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/s$/, '')));
const namesBead = (r, b) => [...words(b.title)].filter((w) => words(r.text).has(w)).length >= 2;
const EV_WRITERS = ['delivery-lead', 'reality-checker'];

// One link of one kind; { kind, link, ok, why }.
function oneLink(bead, kind, { root, beadOf, ownerRecord }) {
  const key = kind === 'bug' ? 'fixes' : 'finding';
  // the bead's metadata only, which the Delivery Manager or Product Manager sets; a story file is the
  // builder's to edit, so its fixes:/finding: lines are notes and never make a fix (re-review B-a)
  const link = String(((bead && bead.metadata) || {})[key] || '').replace(/\s+#.*$/, '').trim();
  const no = (why) => ({ kind, link, ok: false, why });
  const yes = () => ({ kind, link, ok: true });
  if (!link) return no(`labelled ${kind} with no ${key} link in the bead`);
  if (link === bead.id) return no(`${key} names the bead itself`);
  if (kind === 'bug') {
    if (/^(dec|in)-/.test(link)) {
      const r = ownerRecord(link);
      if (!r.ok) return no(`fixes ${r.why}`);
      if (r.goal) return no(`fixes ${link}, a goal decision, not a report of this defect`);
      return namesBead(r, bead) ? yes() : no(`fixes ${link}, whose owner's words do not name this defect`);
    }
    const ev = /^ev-(.+)-\d+$/.exec(link);
    if (ev) {
      const chk = root ? G.readEvidenceChecked(root, ev[1]) : { rows: [], problem: 'no project' };
      // the file must match the head evidence.js recorded in its bead, as the done gate requires
      const problem = chk.problem || G.headProblem(chk, beadOf(ev[1]));
      const row = chk.rows.find((r) => r.id === link);
      if (problem || !row || row.type !== 'row' || row.result !== 'fail' || row.arm === 'side' || !EV_WRITERS.includes(row.by)) return no(`fixes ${link}, which is not a counting failed check row`);
      return yes();
    }
    const target = beadOf(link);
    if (!target || !G.isStoryBead(target)) return no(`fixes ${link}, which is not a story`);
    return ['merged', 'deployed', 'verified'].includes(G.stateOf(target)) ? yes() : no(`fixes ${link}, which is not shipped (merged, deployed or verified)`);
  }
  const at = /^(\.delivery\/reviews\/[^#]+)#([A-Za-z][\w.-]*)$/.exec(link);
  if (at) {
    const rel = path.posix.normalize(at[1]);
    if (!root || !rel.startsWith('.delivery/reviews/') || rel.includes('..')) return no(`finding ${link} is not a review finding`);
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (err) { return no(`finding ${link} does not exist`); }
    const esc = at[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w.-])${esc}(?![\\w-])`).test(text) ? yes() : no(`finding ${link}: the review holds no finding ${at[2]}`);
  }
  const target = beadOf(link);
  const tl = (target && target.labels) || [];
  return target && tl.includes('security') && tl.includes('finding') ? yes() : no(`finding ${link} is neither a review finding (.delivery/reviews/<file>#<id>) nor a finding bead`);
}

// { labelled, kind, link, ok, why }: a bead with both labels counts when either link holds (Copilot 915).
// `story` is accepted for the callers' shape and ignored.
function fixLink(bead, story, { root, beadOf = () => null, ownerRecord = () => ({ ok: false, why: 'no record check' }) } = {}) {
  const labels = (bead && bead.labels) || [];
  const kinds = FIX_LABELS.filter((l) => labels.includes(l));
  if (!kinds.length) return { labelled: false, ok: false };
  const results = kinds.map((k) => oneLink(bead, k, { root, beadOf, ownerRecord }));
  const hit = results.find((r) => r.ok);
  return { labelled: true, ...(hit || results[0]), ...(hit ? {} : { why: results.map((r) => r.why).join('; ') }) };
}

// ---- the recorded reason for a new area (R-41) ----
// The owner's yes to "Open <area> as a new product area?" (goal.js area_add), or a row of a roadmap's
// "## Areas" table (| Area | Reason | Record |) citing an owner record that verifies.
function roadmapAreas(root) {
  const out = [];
  let inits = [];
  try { inits = fs.readdirSync(path.join(root, '.delivery', 'initiatives')); } catch (err) { return out; }
  for (const i of inits) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, '.delivery', 'initiatives', i, 'roadmap.md'), 'utf8'); } catch (err) { continue; }
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => /^##\s+Areas\b/i.test(l));
    if (at < 0) continue;
    for (const l of lines.slice(at + 1)) {
      if (/^#{1,2}\s/.test(l)) break;
      if (!l.trim().startsWith('|')) continue;
      const c = l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.replace(/`/g, '').trim());
      if (!c[0] || /^:?-+:?$/.test(c[0]) || /^area$/i.test(c[0])) continue;
      out.push({ area: c[0], reason: c[1] || '', record: (/\bdec-[\w-]+/.exec(c.slice(1).join(' ')) || [null])[0], initiative: i });
    }
  }
  return out;
}

// the roadmap row's record must be the owner's and must name the area it is cited for (review m-6)
const namesArea = (r, area) => new RegExp(`(?<![\\p{L}\\p{N}])${String(area).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(r.text || '');
function areaReason(root, area, { ownerRecord = () => ({ ok: false }), ownerAreas } = {}) {
  const want = String(area).toLowerCase();
  let owned = ownerAreas;
  if (owned === undefined) { try { owned = require('./goal.js').value(root, 'areas', { warn: false }); } catch (err) { owned = null; } }
  if ((owned || []).some((a) => String(a).toLowerCase() === want)) return { by: 'the owner (goal.js area_add)' };
  const row = roadmapAreas(root).find((r) => { if (r.area.toLowerCase() !== want || !r.reason || !r.record) return false; const rec = ownerRecord(r.record); return rec.ok && namesArea(rec, area); });
  return row ? { by: `the ${row.initiative} roadmap, citing ${row.record}` } : null;
}

// ---- the claim check ----
const warn = (code, rule, detail) => ({ level: 'warn', code, rule, detail });
const block = (code, rule, detail) => ({ level: 'block', code, rule, detail });
const u = B.n1;

// Findings for claiming `bead`. ctx: { beads (story beads), budget (B.state), team, fix (fixLink),
// reason (areaReason or null), filesOf(bead) -> [{ path }], builders }.
function claimFindings(bead, { beads = [], budget = { set: false }, team, fix = { ok: false }, reason = null, filesOf = () => [], builders = 1 } = {}) {
  const f = [];
  const t = budget.table || B.table(null);
  const est = B.estimate(bead, { t, team });
  const need = est.units * (1 + t.reserve);
  const tier1 = Boolean(fix.ok);
  if (fix.labelled && !fix.ok) f.push(warn('fix-unlinked', 'R-41', `${fix.why}: checked and ranked as ordinary work`));
  const A = areas(beads, { except: bead.id });
  const area = areaOf(bead);
  const x = A.get(area) || { waves: new Map(), order: [], current: null, built: false };
  const w = waveOf(bead);
  const own = w ? (x.waves.get(w) || []) : [];
  // the bead's own wave has begun (in-flight work to finish) when another of its stories is built
  const waveStarted = started(own, bead.id);
  const others = beads.filter((b) => b.id !== bead.id && G.isStoryBead(b) && b.status === 'in_progress');

  // waves (R-36, D5)
  if (x.order.length && !tier1) {
    const cur = x.current;
    if (cur && (!w || w > cur)) {
      const curStories = x.waves.get(cur);
      const halfBuilt = started(curStories, bead.id);
      const curNeed = curStories.reduce((n, b) => n + B.stillNeeds(b, B.estimate(b, { t, team }), t), 0);
      const open = curStories.filter((b) => !finished(b)).map((b) => b.id);
      const what = `${w ? `wave ${w}` : 'no wave'}, while wave ${cur} of ${area} is not verified (${open.slice(0, 3).join(', ')}${open.length > 3 ? ', ...' : ''})`;
      if (halfBuilt && budget.set && budget.remaining - need < curNeed) f.push(block('wave-half-built', 'D5', `${w ? `wave ${w}` : 'unwaved work'} while wave ${cur} of ${area} is unfinished: ${B.units(budget.remaining)} left, wave ${cur} needs ${u(curNeed)}, this ${u(need)}; it would leave wave ${cur} half-built`));
      else f.push(warn('outside-wave', 'D5', `${what}: finish or cut wave ${cur} first`));
    }
  }
  // file-disjoint parallel builders and WIP (R-23, R-31)
  const mine = filesOf(bead);
  for (const o of others) {
    const hit = overlap(mine, filesOf(o));
    if (hit.length) f.push(warn('file-overlap', 'R-23', `touches ${hit.slice(0, 3).join(', ')}, as ${o.id} in progress does: parallel builders take file-disjoint stories`));
  }
  if (budget.lean && others.length && !tier1) f.push(warn('lean-wip', 'R-31', `lean mode (${u(budget.weeklyPct)}% of the week used, lean at ${budget.leanAt}%): one story at a time team-wide; ${others.length} already in progress`));
  else if (others.length >= builders) f.push(warn('wip', 'R-23', `${others.length} stories in progress for ${builders} builder(s)`));

  const areaF = [];
  // new areas (R-41): only when other areas already hold built work (front-hopping)
  const elsewhere = [...A.values()].some((y) => y.area !== area && y.built);
  if (!x.built && elsewhere && !tier1) {
    if (budget.set && budget.nearLimit) areaF.push(block('new-area-near-limit', 'D5', `${area} is a new area and the budget is near the limit (${B.units(budget.remaining)} of ${u(budget.total)} left): only linked fixes start`));
    else if (!reason && budget.set && budget.half) areaF.push({ ...block('new-area', 'D1', `${area} is a new area with no recorded reason and half or less of the budget is left (${B.units(budget.remaining)} of ${u(budget.total)})`), area });
    else if (!reason) areaF.push(warn('new-area', 'R-41', `${area} is a new area with no recorded reason (goal.js ask area_add ${area}, or a roadmap Areas row citing an owner record)`));
    else if (budget.lean) areaF.push(warn('new-area-lean', 'R-31', `${area} is a new area (reason: ${reason.by}) started in lean mode`));
  }
  // budget-aware start (R-34): only an owner-set budget can refuse
  if (budget.set) {
    if (est.unsized) f.push(warn('no-size', 'R-34', `no size label: estimated as ${est.size} (${u(est.units)} units)`));
    const pct = Math.round(t.reserve * 100);
    const free = `${B.units(budget.free)} are free after in-flight work`;
    if (tier1) {
      // a linked fix may use what in-flight work holds, but it must fit what is left (review I-2)
      if (need > budget.remaining) f.push(block('fix-over-budget', 'D5', `the linked fix needs ${u(need)} units with the ${pct}% reserve; ${B.units(budget.remaining)} are left`));
    } else if (![...f, ...areaF].some((y) => y.level === 'block')) {
      if (waveStarted) {
        if (need > budget.free) f.push(warn('budget-short', 'R-34', `needs ${u(need)} units with the ${pct}% reserve; ${free}: wave ${w} is under way, so finish it and start nothing new`));
      } else if (w) {
        // this claim starts its wave: the whole wave must fit, or it ends half-built (review I-1)
        const waveNeed = own.filter((b) => !finished(b)).reduce((n, b) => n + B.estimate(b, { t, team }).units * (1 + t.reserve), 0);
        if (waveNeed > budget.free) f.push(block('budget-short', 'D5', `wave ${w} of ${area} needs ${u(waveNeed)} units with the ${pct}% reserve to finish; ${free}: starting it risks half-built work`));
      } else if (need > budget.free) f.push(block('budget-short', 'D5', `needs ${u(need)} units with the ${pct}% reserve; ${free}: starting it risks half-built work`));
    }
  }

  f.push(...areaF);
  return f;
}

// ---- selection (R-41) ----
// Ranks ready candidates: tier 1 linked fixes, tier 2 compounding work by score, tier 3 new areas;
// budget-scaled admission refuses what may not start now. ctx as claimFindings plus storyOf(bead),
// fixOf(bead), reasonOf(area). Returns [{ id, tier, score, reasons, refused, warnings }].
function rank(candidates, { beads = [], budget = { set: false }, team, storyOf = () => null, fixOf = () => ({ ok: false }), reasonOf = () => null } = {}) {
  const t = budget.table || B.table(null);
  const A = areas(beads);
  const verified = beads.filter((b) => G.stateOf(b) === 'verified');
  const vSurfaces = new Set(verified.map((b) => b.metadata && b.metadata.surface).filter(Boolean));
  const byStory = new Map(beads.map((b) => [String((b.metadata && b.metadata.story) || b.id), b]));
  const builtAny = [...A.values()].some((y) => y.built);
  const out = candidates.map((c) => {
    const story = storyOf(c);
    const fix = fixOf(c, story);
    const reasons = [];
    const warnings = [];
    if (fix.labelled && !fix.ok) warnings.push(`${fix.why}: ranked as ordinary work`);
    const area = areaOf(c);
    const x = A.get(area) || { built: false, current: null, waves: new Map() };
    const isNew = !x.built && builtAny;
    const tier = fix.ok ? 1 : isNew ? 3 : 2;
    if (fix.ok) reasons.push(`${fix.kind} with ${fix.kind === 'bug' ? 'fixes' : 'finding'} ${fix.link}`);
    let score = 0;
    const deps = require('./plan-docs.js').listValue(story && story.meta && story.meta.depends_on);
    const vdeps = deps.filter((d) => G.stateOf(byStory.get(d) || {}) === 'verified');
    if (vdeps.length) { score += 3 * vdeps.length; reasons.push(`builds on verified ${vdeps.join(', ')}`); }
    if (x.verified) { score += 2; reasons.push(`area ${area} has ${x.verified} verified`); }
    if (c.metadata && vSurfaces.has(c.metadata.surface)) { score += 1; reasons.push(`same surface ${c.metadata.surface} as verified work`); }
    const w = waveOf(c);
    let waveStarted = false;
    if (w && x.current === w) {
      score += 2;
      waveStarted = started(x.waves.get(w), c.id);
      if (waveStarted) score += 1;
      reasons.push(`current wave ${w} of ${area}${waveStarted ? ', under way' : ''}`);
    } else if (w && x.current && w > x.current && !fix.ok) { score -= 3; reasons.push(`waits for wave ${x.current} of ${area}`); }
    const modified = ((story && story.files) || []).filter((f) => f.action === 'modify').length;
    if (modified) { score += 1; reasons.push(`changes ${modified} existing file(s)`); }
    const reuses = require('./plan-docs.js').listValue(story && story.meta && story.meta.reuses);
    if (reuses.length) { score += Math.min(2, reuses.length); reasons.push(`reuses ${reuses.join(', ')}`); }
    if (isNew) reasons.push(`new area ${area}`);
    // admission: the claim check itself, so select never offers what a claim refuses, nor hides what
    // it allows (review I-5)
    const reason = isNew ? reasonOf(area) : null;
    const found = claimFindings(c, { beads, budget, team, fix, reason, builders: Infinity });
    const blocks = found.filter((x) => x.level === 'block');
    const refused = blocks.length ? blocks.map((x) => `${x.detail} (${x.rule})`).join('; ') : null;
    if (!refused) for (const x of found) if (['new-area', 'new-area-lean', 'outside-wave'].includes(x.code)) warnings.push(x.detail);
    if (reason) reasons.push(`area reason: ${reason.by}`);
    const est = B.estimate(c, { t, team });
    return { id: c.id, title: c.title, tier, score, reasons, refused, warnings, estimate: est.units };
  });
  return out.sort((p, q) => (Boolean(p.refused) - Boolean(q.refused)) || (p.tier - q.tier) || (q.score - p.score) || String(p.id).localeCompare(String(q.id)));
}

// Fix beads in progress that are not stories: they hold budget too (Copilot 726)
function activeFixes(bd, known) {
  if (!bd) return [];
  try { return bd.list({ status: 'in_progress' }).filter((b) => b.status === 'in_progress' && !known.has(b.id) && !G.isStoryBead(b) && B.isWork(b)); } catch (err) { return []; }
}

// The reads claimFindings and rank need, from the project: story files, owner records, the budget.
// budget: a precomputed B.state (tests, a caller that has one) or undefined to compute it.
function contextFor(root, { bd, team, beads = [], verifyRecord, budget, now, deadline, budgetOpts = {} } = {}) {
  const C = require('./gate-context.js');
  const stories = new Map();
  const storyOf = (b) => { if (!stories.has(b.id)) stories.set(b.id, C.readStory(root, b)); return stories.get(b.id); };
  const known = new Map(beads.map((b) => [b.id, b]));
  const beadOf = (id) => known.get(id) || (bd ? (() => { try { return bd.show(id); } catch (err) { return null; } })() : null);
  let builders = 1;
  try { builders = require('./manifest.js').expandInstances(team).filter((i) => i.role.id === 'builder' && !i.role.retired).length || 1; } catch (err) { builders = 1; }
  let ownerAreas = null;
  try { ownerAreas = require('./goal.js').value(root, 'areas', { warn: false, verifyRecord }); } catch (err) { ownerAreas = null; }
  return {
    beads, team, builders, storyOf,
    budget: budget || B.state(root, { team, beads: [...beads, ...activeFixes(bd, known)], now, verifyRecord, deadline, ...budgetOpts }),
    fixOf: (b, story) => fixLink(b, story === undefined ? storyOf(b) : story, { root, beadOf, ownerRecord: (id) => C.ownerRecord(root, id, verifyRecord) }),
    reasonOf: (area) => areaReason(root, area, { ownerRecord: (id) => C.ownerRecord(root, id, verifyRecord), ownerAreas }),
    filesOf: (b) => ((storyOf(b) || {}).files || []),
  };
}

// Open, unclaimed story or fix beads that are not finished: what select ranks.
const candidate = (b) => b && b.status === 'open' && !b.assignee && !finished(b) && (G.isStoryBead(b) || FIX_LABELS.some((l) => (b.labels || []).includes(l)));

module.exports = { contextFor, waveOf, areas, waveLine, overlap, fixLink, roadmapAreas, areaReason, claimFindings, rank, candidate, FIX_LABELS, finished, built };
