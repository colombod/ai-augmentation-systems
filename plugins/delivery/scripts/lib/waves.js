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
// { labelled, kind, link, ok, why }. A `bug` needs a `fixes` link to a merged, deployed or verified
// story, an owner record, or a failed evidence row; a `security` bead a `finding` link to a record, a
// bead or a review file under .delivery/. The label alone is ordinary work.
function fixLink(bead, story, { root, beadOf = () => null, recordOk = () => false } = {}) {
  const labels = (bead && bead.labels) || [];
  const kind = FIX_LABELS.find((l) => labels.includes(l));
  if (!kind) return { labelled: false, ok: false };
  const key = kind === 'bug' ? 'fixes' : 'finding';
  const m = (bead && bead.metadata) || {};
  const link = String(m[key] || (story && story.meta && story.meta[key]) || '').replace(/\s+#.*$/, '').trim();
  if (!link) return { labelled: true, kind, ok: false, why: `labelled ${kind} with no ${key} link` };
  if (/^(dec|in)-/.test(link)) return recordOk(link) ? { labelled: true, kind, link, ok: true } : { labelled: true, kind, link, ok: false, why: `${key} ${link} does not verify` };
  const ev = /^ev-(.+)-\d+$/.exec(link);
  if (ev && kind === 'bug') {
    const row = root ? G.readEvidence(root, ev[1]).find((r) => r.id === link) : null;
    return row && row.result === 'fail' ? { labelled: true, kind, link, ok: true } : { labelled: true, kind, link, ok: false, why: `fixes ${link} is not a failed check row` };
  }
  if (kind === 'security' && /^\.delivery\//.test(link) && root) {
    return fs.existsSync(path.join(root, link.split('#')[0])) ? { labelled: true, kind, link, ok: true } : { labelled: true, kind, link, ok: false, why: `finding ${link} does not exist` };
  }
  const target = beadOf(link);
  if (!target) return { labelled: true, kind, link, ok: false, why: `${key} ${link} names nothing that exists` };
  if (kind === 'bug' && !['merged', 'deployed', 'verified'].includes(G.stateOf(target))) return { labelled: true, kind, link, ok: false, why: `fixes ${link}, which is not shipped (merged, deployed or verified)` };
  return { labelled: true, kind, link, ok: true };
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

function areaReason(root, area, { recordOk = () => false, ownerAreas } = {}) {
  const want = String(area).toLowerCase();
  let owned = ownerAreas;
  if (owned === undefined) { try { owned = require('./goal.js').value(root, 'areas', { warn: false }); } catch (err) { owned = null; } }
  if ((owned || []).some((a) => String(a).toLowerCase() === want)) return { by: 'the owner (goal.js area_add)' };
  const row = roadmapAreas(root).find((r) => r.area.toLowerCase() === want && r.reason && r.record && recordOk(r.record));
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
      if (halfBuilt && budget.set && budget.remaining - need < curNeed) f.push(block('wave-half-built', 'D5', `${w ? `wave ${w}` : 'unwaved work'} while wave ${cur} of ${area} is unfinished: ${u(budget.remaining)} units left, wave ${cur} needs ${u(curNeed)}, this ${u(need)}; it would leave wave ${cur} half-built`));
      else f.push(warn('outside-wave', 'D5', `${what}: finish or cut wave ${cur} first`));
    }
  }
  // file-disjoint parallel builders and WIP (R-23, R-31)
  const mine = filesOf(bead);
  for (const o of others) {
    const hit = overlap(mine, filesOf(o));
    if (hit.length) f.push(warn('file-overlap', 'R-23', `touches ${hit.slice(0, 3).join(', ')}, as ${o.id} in progress does: parallel builders take file-disjoint stories`));
  }
  if (budget.lean && others.length && !tier1) f.push(warn('lean-wip', 'R-31', `lean mode (${u(budget.usedPct)}% used, lean at ${budget.leanAt}%): one story at a time team-wide; ${others.length} already in progress`));
  else if (others.length >= builders) f.push(warn('wip', 'R-23', `${others.length} stories in progress for ${builders} builder(s)`));

  const areaF = [];
  // new areas (R-41): only when other areas already hold built work (front-hopping)
  const elsewhere = [...A.values()].some((y) => y.area !== area && y.built);
  if (!x.built && elsewhere && !tier1) {
    if (budget.set && budget.nearLimit) areaF.push(block('new-area-near-limit', 'D5', `${area} is a new area and the budget is near the limit (${u(budget.remaining)} of ${u(budget.total)} units left): only linked fixes start`));
    else if (!reason && budget.set && budget.half) areaF.push({ ...block('new-area', 'D1', `${area} is a new area with no recorded reason and half or less of the budget is left (${u(budget.remaining)} of ${u(budget.total)} units)`), area });
    else if (!reason) areaF.push(warn('new-area', 'R-41', `${area} is a new area with no recorded reason (goal.js ask area_add ${area}, or a roadmap Areas row citing an owner record)`));
    else if (budget.lean) areaF.push(warn('new-area-lean', 'R-31', `${area} is a new area (reason: ${reason.by}) started in lean mode`));
  }
  // budget-aware start (R-34): only an owner-set budget can refuse
  if (budget.set) {
    if (est.unsized) f.push(warn('no-size', 'R-34', `no size label: estimated as ${est.size} (${u(est.units)} units)`));
    if (tier1) {
      if (budget.nearLimit && est.units > budget.remaining) f.push(block('fix-over-budget', 'D5', `a linked fix of ${u(est.units)} units does not fit the ${u(budget.remaining)} units left, reserve included`));
    } else if (need > budget.free && !areaF.some((x) => x.level === 'block')) {
      const short = `needs ${u(need)} units with the ${Math.round(t.reserve * 100)}% reserve; ${u(budget.free)} are free after in-flight work (short by ${u(need - budget.free)})`;
      if (waveStarted) f.push(warn('budget-short', 'R-34', `${short}: wave ${w} is under way, so finish it and start nothing new`));
      else f.push(block('budget-short', 'D5', `${short}: starting it risks half-built work`));
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
    // admission, scaled by the budget (owner-set only)
    const est = B.estimate(c, { t, team });
    const need = est.units * (1 + t.reserve);
    let refused = null;
    const reason = isNew ? reasonOf(area) : null;
    if (budget.set && budget.nearLimit) {
      if (!fix.ok) refused = `near the limit (${B.n1(budget.remaining)} units left): only linked fixes start (D5)`;
      else if (est.units > budget.remaining) refused = `a ${B.n1(est.units)}-unit fix does not fit the ${B.n1(budget.remaining)} units left (D5)`;
    } else if (tier === 3 && !reason && budget.set && budget.half) refused = 'new area with no recorded reason, half or less of the budget left (D1)';
    else if (budget.set && tier !== 1 && need > budget.free && !waveStarted) refused = `needs ${B.n1(need)} units, ${B.n1(budget.free)} free after in-flight work (D5)`;
    if (!refused && tier === 3 && !reason) warnings.push(`new area ${area} with no recorded reason`);
    if (!refused && tier === 3 && reason && budget.lean) warnings.push(`new area ${area} in lean mode`);
    if (reason) reasons.push(`area reason: ${reason.by}`);
    return { id: c.id, title: c.title, tier, score, reasons, refused, warnings, estimate: est.units };
  });
  return out.sort((p, q) => (Boolean(p.refused) - Boolean(q.refused)) || (p.tier - q.tier) || (q.score - p.score) || String(p.id).localeCompare(String(q.id)));
}

// The reads claimFindings and rank need, from the project: story files, owner records, the budget.
// budget: a precomputed B.state (tests, a caller that has one) or undefined to compute it.
function contextFor(root, { bd, team, beads = [], verifyRecord, budget, now } = {}) {
  const C = require('./gate-context.js');
  const recordOk = C.recordChecker(root, verifyRecord);
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
    budget: budget || B.state(root, { team, beads, now, verifyRecord }),
    fixOf: (b, story) => fixLink(b, story === undefined ? storyOf(b) : story, { root, beadOf, recordOk }),
    reasonOf: (area) => areaReason(root, area, { recordOk, ownerAreas }),
    filesOf: (b) => ((storyOf(b) || {}).files || []),
  };
}

// Open, unclaimed story or fix beads that are not finished: what select ranks.
const candidate = (b) => b && b.status === 'open' && !b.assignee && !finished(b) && (G.isStoryBead(b) || FIX_LABELS.some((l) => (b.labels || []).includes(l)));

module.exports = { contextFor, waveOf, areas, waveLine, overlap, fixLink, roadmapAreas, areaReason, claimFindings, rank, candidate, FIX_LABELS, finished, built };
