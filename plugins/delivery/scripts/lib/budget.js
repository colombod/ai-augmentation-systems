// scripts/lib/budget.js — start only what can finish (R-34), lean mode (R-31), on owner-set figures only (R-42).
//
// The budget exists only when the owner set budget.weekly_units through goal.js (a yes in the question
// box); the plugin ships no figure, and until then every budget check only warns. The estimate table
// below is the seed: S 1, M 3, L 8 units on sonnet, opus 1.7x, haiku 0.35x, and a 30% reserve for
// review, reality check and merge. The owner overrides any entry through its goal field
// (budget.estimate_s|m|l, budget.reserve, budget.unit_tokens); /delivery:realign proposes the change.
// Spend is what lib/usage.js measures: weighted tokens from the role transcripts since the period
// start, and the status line's weekly percentage when a fresh snapshot exists.
const Goal = require('./goal.js');
const U = require('./usage.js');
const G = require('./gates.js');

const SEED = { units: { S: 1, M: 3, L: 8 }, hours: { S: 2, M: 6, L: 16 }, reserve: 30, unit_tokens: 5e6 };
const UNSIZED = 'M';

const owner = (root, field, opts) => Goal.value(root, field, { warn: false, ...opts });

// The table in force: the seed with the owner's overrides. { units, hours, reserve (fraction), unitTokens, overridden }
function table(root, opts = {}) {
  const t = { units: { ...SEED.units }, hours: { ...SEED.hours }, reserve: SEED.reserve / 100, unitTokens: SEED.unit_tokens, overridden: [] };
  if (!root) return t;
  for (const s of ['S', 'M', 'L']) {
    const v = owner(root, `budget.estimate_${s.toLowerCase()}`, opts);
    if (Number.isFinite(v)) { t.units[s] = v; t.overridden.push(`estimate_${s.toLowerCase()}`); }
  }
  const r = owner(root, 'budget.reserve', opts);
  if (Number.isFinite(r)) { t.reserve = r / 100; t.overridden.push('reserve'); }
  const u = owner(root, 'budget.unit_tokens', opts);
  if (Number.isFinite(u)) { t.unitTokens = u; t.overridden.push('unit_tokens'); }
  return t;
}

const sizeOf = (b) => { const l = ((b && b.labels) || []).find((x) => /^size-[SML]$/.test(x)); return l ? l.slice(5) : null; };
// the model the builder dispatches: the bead's override, else size-L on the large model (the builder
// brief's DELIVERY_LARGE_MODEL, which prepare-role sets from large_model, opus by default), else its own
function modelOf(b, team) {
  const m = b && b.metadata && b.metadata.model;
  if (m) return U.modelKind(m);
  const builder = ((team && team.roles) || []).find((r) => r.id === 'builder');
  if (sizeOf(b) === 'L') return U.modelKind((builder && builder.large_model) || 'opus');
  return U.modelKind(builder && builder.model);
}

// { units, hours, size, model, unsized }: an unsized story is estimated as M and says so
function estimate(b, { t = table(null), team } = {}) {
  const size = sizeOf(b);
  const s = size || UNSIZED;
  const model = modelOf(b, team);
  return { units: t.units[s] * U.MODEL[model], hours: t.hours[s], size: s, model, unsized: !size };
}

// What a started or merged story still costs: all of it plus the reserve while in progress, only the
// reserve (review, reality check, merge) once merged.
function stillNeeds(b, est, t) {
  const st = G.stateOf(b);
  if (st === 'verified' || st === 'cut' || (b.status === 'closed' && !st)) return 0;
  if (st === 'merged' || st === 'deployed') return est.units * t.reserve;
  return est.units * (1 + t.reserve);
}
// a story or a fix bead (bug, security) that is claimed or merged and not yet verified holds its share
const isWork = (b) => G.isStoryBead(b) || ['bug', 'security'].some((l) => ((b && b.labels) || []).includes(l));
const inFlight = (b) => isWork(b) && !['verified', 'cut'].includes(G.stateOf(b)) && (b.status === 'in_progress' || ['merged', 'deployed'].includes(G.stateOf(b)));

// The week the spend is counted in: the status line's reset when a fresh reading exists; else the
// owner's week start (budget.period_start), stepped on to its latest weekly reset; else the last
// seven days, said plainly (PR 54 review I-7).
function period(root, { snap, now, opts }) {
  const t = Date.parse(now || new Date().toISOString());
  if (snap) return { start: snap.periodStart, basis: `since the weekly reset the status line reports${snap.resetsAt ? ` (${snap.resetsAt.slice(0, 16)})` : ''}` };
  const ps = root ? owner(root, 'budget.period_start', opts) : null;
  const p0 = Date.parse(ps || '');
  if (Number.isFinite(p0) && p0 <= t) {
    const start = p0 + Math.floor((t - p0) / U.WEEK_MS) * U.WEEK_MS;
    return { start: new Date(start).toISOString(), basis: `since the weekly reset the owner set (${new Date(start).toISOString().slice(0, 16)})` };
  }
  return { start: new Date(t - U.WEEK_MS).toISOString(), basis: 'over the last 7 days (reset time unknown; the owner can set the week start: goal.js ask budget.period_start <time>)' };
}

// The budget now. set: false means no owner figure (checks warn only). Overrides for tests and the
// hook: usedTokens (weighted tokens spent), snapshot (the status line reading, or null).
function state(root, { team, beads = [], now, verifyRecord, usedTokens, snapshot, deadline } = {}) {
  const opts = { verifyRecord };
  const t = table(root, opts);
  const weekly = root ? owner(root, 'budget.weekly_units', opts) : null;
  const leanAt = root ? owner(root, 'budget.lean_at', opts) : null;
  if (!Number.isFinite(weekly)) return { set: false, table: t, leanAt: Number.isFinite(leanAt) ? leanAt : null, note: 'no owner-set budget: budget checks only warn (goal.js ask budget.weekly_units <n>)' };
  const envelope = owner(root, 'budget.usage_envelope', opts);
  const total = Number.isFinite(envelope) ? weekly * envelope / 100 : weekly;
  const snap = snapshot !== undefined ? snapshot : U.readSnapshot(root, now);
  const per = period(root, { snap, now, opts });
  const periodStart = per.start;
  const spent = usedTokens !== undefined ? { tokens: usedTokens } : U.tokensSince(root, periodStart, { deadline });
  const teamUnits = spent.tokens / t.unitTokens;
  let used = teamUnits;
  let source = `role transcripts ${per.basis}`;
  let remaining = total - used;
  // lean_at is a share of the weekly allowance (its question says so): the team's spend against the
  // weekly units, or the status line's weekly percentage when that is higher (Copilot 620)
  let weeklyPct = weekly > 0 ? (teamUnits / weekly) * 100 : 100;
  if (snap) {
    weeklyPct = Math.max(weeklyPct, snap.usedPct);
    // the weekly window binds the whole account: never claim more room than it leaves
    const weeklyLeft = weekly * (1 - snap.usedPct / 100);
    if (weeklyLeft < remaining) { remaining = weeklyLeft; used = total - remaining; source = `the status line's weekly reading (${snap.usedPct}% used)`; }
  }
  const inflightNeed = beads.filter(inFlight).reduce((n, b) => n + stillNeeds(b, estimate(b, { t, team }), t), 0);
  const usedPct = total > 0 ? Math.max(0, (used / total) * 100) : 100;
  const out = {
    set: true, table: t, weekly, envelope: Number.isFinite(envelope) ? envelope : null, total, used, remaining, usedPct, weeklyPct, periodStart, source, partial: Boolean(spent.partial),
    leanAt: Number.isFinite(leanAt) ? leanAt : null, inflightNeed, free: remaining - inflightNeed,
  };
  out.half = remaining <= total / 2;
  out.lean = out.leanAt !== null && weeklyPct >= out.leanAt;
  // near the limit: once in-flight work and its reserve are paid for, not even a small story fits
  out.nearLimit = out.free < t.units.S * (1 + t.reserve);
  out.level = out.nearLimit ? 'near the limit' : out.lean ? 'lean' : out.half ? 'half or less left' : 'more than half left';
  return out;
}

const n1 = (x) => (Math.round(x * 10) / 10).toString();
// a figure for people: never a negative amount (review m-2)
const units = (x) => (x > 0.05 ? `${n1(x)} units` : 'no units');

module.exports = { SEED, table, estimate, sizeOf, modelOf, stillNeeds, inFlight, isWork, state, n1, units };
