// scripts/lib/plan-graph.js — pure planner: documents in, deterministic bead graph out.
const path = require('path');
const { phaseNumber, spikeKey } = require('./plan-docs.js');

function escapeRegExp(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Last line of defence: materialise must never issue two creates for one id (bd would overwrite the first). First wins.
function uniqueBeads(beads, warnings) {
  const seen = new Set();
  return beads.filter((b) => {
    if (seen.has(b.id)) { warnings.push(`duplicate bead id ${b.id}`); return false; }
    seen.add(b.id);
    return true;
  });
}

function planGraph({ prefix, initiative, sha, roadmap, stories, spikes, surfaces, assumptions = [] }) {
  const beads = [];
  const deps = [];
  const warnings = [];
  const phases = [];
  const seenPhases = new Set();
  for (const p of roadmap.phases) {
    if (seenPhases.has(p.number)) { warnings.push(`duplicate phase ${p.number}`); continue; }
    seenPhases.add(p.number);
    phases.push(p);
  }
  // Story bead ids are <prefix>-<story id>; a story id shaped like a generated id would collide with an epic, review or spike.
  const generated = new RegExp(`^${escapeRegExp(initiative)}-(ph\\d|spike-)`);
  const phaseIds = new Map();
  const reviewIds = new Map();
  const storyById = new Map();
  const ref = (n) => `${initiative}/roadmap.md@${sha} phase ${n}`;
  const base = (n, docId) => ({ roadmap_ref: ref(n), doc_id: docId, materialised_by: 'delivery' });

  for (const p of phases) {
    const id = `${prefix}-${initiative}-ph${p.number}`;
    phaseIds.set(p.number, id);
    reviewIds.set(p.number, `${id}-review`);
    beads.push({ id, title: `Phase ${p.number}: ${p.name}`, type: 'epic', parent: null, labels: ['roadmap', `phase-${p.number}`], metadata: base(p.number, `phase-${p.number}`), priority: 1, docId: `phase-${p.number}` });
  }

  const live = [];
  const seenStories = new Set();
  for (const s of stories.filter((x) => x.status !== 'superseded')) {
    if (seenStories.has(s.id)) { warnings.push(`duplicate story id ${s.id}`); continue; }
    if (generated.test(s.id)) { warnings.push(`story ${s.id}: id collides with generated ids`); continue; }
    seenStories.add(s.id);
    live.push(s);
  }
  const storiesByPhase = new Map();
  for (const s of [...live].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!s.phase || !phaseIds.has(s.phase)) { warnings.push(`story ${s.id}: phase ${s.phase} not in roadmap`); continue; }
    storyById.set(s.id, s);
    (storiesByPhase.get(s.phase) || storiesByPhase.set(s.phase, []).get(s.phase)).push(s);
  }

  // The register (R-14): each external-host assumption still assumed gets a spike, keyed by its id
  // (spike-a-8), that blocks the stories its criteria sit on; a Spikes row naming the assumption gives it
  // its question, decision and rule. One answered on its own spike keeps that spike in the plan.
  const allSpikes = spikes.map((sp) => (sp.assumption ? { ...sp, key: spikeKey(sp.assumption) } : { ...sp }));
  for (const a of assumptions) {
    const key = spikeKey(a.id);
    let sp = allSpikes.find((x) => x.key === key);
    const own = String(a.evidence || '').startsWith(`ev-${prefix}-${initiative}-spike-${key}-`);
    if (!sp && (a.kind !== 'external-host' || (a.status !== 'assumed' && !own))) continue;
    if (!sp) { sp = { key, question: `Does this hold in the real host: ${a.statement}`, timeBox: '', blocks: '' }; allSpikes.push(sp); }
    sp.assumption = a.id;
    sp.stories = a.criteria.map((c) => c.story);
    if (!sp.decisionOwner && a.owner) sp.decisionOwner = { 'delivery-lead': 'DM', 'product-manager': 'PM', owner: 'owner' }[a.owner];
    if (!sp.decisionRule) warnings.push(`spike ${key} for ${a.id}: no decision rule (which result means build, change the design or stop) (R-16)`);
  }
  const spikesByPhase = new Map();
  const spikeBlocks = [];
  const seenSpikes = new Set();
  for (const sp of allSpikes) {
    if (seenSpikes.has(sp.key)) { warnings.push(`duplicate spike key ${sp.key}`); continue; }
    seenSpikes.add(sp.key);
    const id = `${prefix}-${initiative}-spike-${sp.key}`;
    const blocksPhase = phaseNumber(sp.blocks);
    let phase = null;
    let unmatched = false;
    const onStories = (sp.stories || []).filter((x) => storyById.has(x));
    for (const x of sp.stories || []) if (!storyById.has(x)) warnings.push(`spike ${sp.key}: ${sp.assumption} sits on story ${x}, which is not in the plan`);
    if (blocksPhase && phaseIds.has(blocksPhase)) {
      // A phase-blocking spike gates the phase's work itself (every story), or its review when it has none.
      phase = blocksPhase;
      const work = (storiesByPhase.get(phase) || []).map((s) => `${prefix}-${s.id}`);
      for (const target of work.length ? work : [reviewIds.get(phase)]) spikeBlocks.push({ id: target, blockedBy: id });
    } else if (storyById.has(sp.blocks)) {
      phase = storyById.get(sp.blocks).phase;
      spikeBlocks.push({ id: `${prefix}-${sp.blocks}`, blockedBy: id });
    } else if (onStories.length) {
      phase = storyById.get(onStories[0]).phase;
    } else {
      phase = phases.length ? phases[0].number : null;
      unmatched = true;
      warnings.push(`spike ${sp.key}: blocks "${sp.blocks}" matched nothing`);
    }
    for (const x of onStories) spikeBlocks.push({ id: `${prefix}-${x}`, blockedBy: id });
    if (phase === null) continue;
    (spikesByPhase.get(phase) || spikesByPhase.set(phase, []).get(phase)).push({ ...sp, id, phase, unmatched });
  }

  for (const p of phases) {
    const epicId = phaseIds.get(p.number);
    const reviewId = reviewIds.get(p.number);
    for (const s of storiesByPhase.get(p.number) || []) {
      // size (S|M|L) becomes a label and an optional model override bead metadata, so a builder can
      // pick the model for its implementer and reviewer subagents from the bead alone
      const size = /^[sml]$/i.test(String(s.size || '').trim()) ? String(s.size).trim().toUpperCase() : null;
      const metadata = { ...base(p.number, s.id), story: s.id, story_file: path.basename(s.file) };
      if (s.model) metadata.model = s.model;
      // the customer surface (R-09): the story's own, else the initiative's only one; the area for the unverified cap
      const ids = surfaces || [];
      const surface = s.surface || (ids.length === 1 ? ids[0] : '');
      if (surface && ids.length && !ids.includes(surface)) warnings.push(`story ${s.id}: surface ${surface} is not in surface.json (${ids.join(', ')})`);
      else if (surface) metadata.surface = surface;
      else if (ids.length > 1) warnings.push(`story ${s.id}: names no surface; surface.json declares ${ids.join(', ')}`);
      if (s.area || s.epic) metadata.area = s.area || s.epic;
      // the wave (R-36): a label and a number, so the claim check reads it from the bead alone
      const wave = /^\d+$/.test(String(s.wave || '')) && Number(s.wave) > 0 ? Number(s.wave) : null;
      if (s.wave && !wave) warnings.push(`story ${s.id}: wave "${s.wave}" is not a positive whole number`);
      if (wave) metadata.wave = wave;
      beads.push({ id: `${prefix}-${s.id}`, title: s.title, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'story', ...(size ? [`size-${size}`] : []), ...(wave ? [`wave-${wave}`] : [])], metadata, priority: 2, docId: s.id });
    }
    for (const sp of spikesByPhase.get(p.number) || []) {
      const q = sp.question.length > 120 ? `${sp.question.slice(0, 117)}...` : sp.question;
      beads.push({ id: sp.id, title: `Spike ${sp.key}: ${q}`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'spike'], metadata: spikeMeta(sp, base(p.number, `spike-${sp.key}`)), priority: 1, docId: `spike-${sp.key}` });
    }
    beads.push({ id: reviewId, title: `Phase ${p.number} review: sprint-review and realign`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'phase-review'], metadata: base(p.number, `phase-${p.number}-review`), priority: 1, docId: `phase-${p.number}-review` });
  }

  for (let i = 1; i < phases.length; i++) {
    const prevReview = reviewIds.get(phases[i - 1].number);
    const p = phases[i];
    // Only stories wait for the previous phase's review; spikes may run ahead.
    const members = (storiesByPhase.get(p.number) || []).map((s) => `${prefix}-${s.id}`);
    if (members.length === 0) members.push(reviewIds.get(p.number));
    for (const id of members) deps.push({ id, blockedBy: prevReview });
  }
  for (const p of phases) {
    const reviewId = reviewIds.get(p.number);
    for (const s of storiesByPhase.get(p.number) || []) deps.push({ id: reviewId, blockedBy: `${prefix}-${s.id}` });
    for (const sp of (spikesByPhase.get(p.number) || []).filter((x) => !x.unmatched)) deps.push({ id: reviewId, blockedBy: sp.id });
  }
  for (const p of phases) {
    for (const s of storiesByPhase.get(p.number) || []) {
      for (const d of s.dependsOn) {
        if (d === s.id) warnings.push(`story ${s.id}: depends_on itself`);
        else if (storyById.has(d)) deps.push({ id: `${prefix}-${s.id}`, blockedBy: `${prefix}-${d}` });
        else warnings.push(`story ${s.id}: depends_on ${d} unknown`);
      }
    }
  }
  deps.push(...spikeBlocks);

  const seenDeps = new Set();
  const uniqueDeps = deps.filter((d) => {
    const k = `${d.id}\u0000${d.blockedBy}`;
    if (seenDeps.has(k)) return false;
    seenDeps.add(k);
    return true;
  });

  return { beads: uniqueBeads(beads, warnings), deps: uniqueDeps, warnings };
}

// the spike gate's fields (R-16) travel on the bead, so the claim and close checks read them from it
function spikeMeta(sp, base) {
  const m = { ...base, spike: sp.key, time_box: sp.timeBox, question: sp.question };
  for (const [k, f] of [['decision', 'decision'], ['decision_rule', 'decisionRule'], ['decision_owner', 'decisionOwner'], ['assumption', 'assumption']]) if (sp[f]) m[k] = sp[f];
  return m;
}

const STOPLIST = new Set(['context', 'decision', 'decisions', 'overview', 'goal', 'goals', 'non-goals', 'scope', 'out of scope', 'risks', 'risk', 'background', 'summary', 'constraints', 'requirements', 'functional requirements', 'non-functional requirements', 'assumptions', 'open questions', 'open items', 'alternatives considered', 'consequences', 'status', 'notes', 'phases', 'critical path', 'dependencies', 'buffer', 'testing', 'introduction', 'problem', 'solution']);

function headings(text) {
  const out = [];
  let fenced = false;
  for (const l of (text || '').split(/\r?\n/)) {
    if (/^\s*```/.test(l)) { fenced = !fenced; continue; }
    if (!fenced && /^#{1,2}\s/.test(l)) out.push(l.replace(/^#+\s*/, '').trim());
  }
  return out;
}

function denylistFrom({ initiative, roadmap, stories, spikes, briefText, prdText, personaNames }) {
  const always = [initiative, ...(personaNames || [])];
  const derived = [...roadmap.phases.map((p) => p.name), ...stories.map((s) => s.title), ...spikes.map((s) => s.question), ...headings(briefText), ...headings(prdText)]
    .filter((x) => {
      const e = String(x || '').trim();
      return e.split(/\s+/).filter(Boolean).length >= 2 && !STOPLIST.has(e.toLowerCase());
    });
  const seen = new Set();
  const out = [];
  for (const entry of [...always, ...derived]) {
    const e = String(entry || '').trim();
    if (e.length < 3) continue;
    if (/^(phase|spike|roadmap|story|prd|brief)$/i.test(e)) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

module.exports = { planGraph, denylistFrom, uniqueBeads };
