// scripts/lib/plan-graph.js — pure planner: documents in, deterministic bead graph out.
const path = require('path');
const { phaseNumber } = require('./plan-docs.js');

function planGraph({ prefix, initiative, sha, roadmap, stories, spikes }) {
  const beads = [];
  const deps = [];
  const warnings = [];
  const phases = roadmap.phases;
  const phaseIds = new Map();
  const reviewIds = new Map();
  const storyById = new Map();
  const ref = (n) => `${initiative}/roadmap.md@${sha} phase ${n}`;
  const base = (n, docId) => ({ roadmap_ref: ref(n), doc_id: docId, materialised_by: 'delivery' });

  for (const p of phases) {
    const id = `${prefix}-ph${p.number}`;
    phaseIds.set(p.number, id);
    reviewIds.set(p.number, `${id}-review`);
    beads.push({ id, title: `Phase ${p.number}: ${p.name}`, type: 'epic', parent: null, labels: ['roadmap', `phase-${p.number}`], metadata: base(p.number, `phase-${p.number}`), priority: 1, docId: `phase-${p.number}` });
  }

  const live = stories.filter((s) => s.status !== 'superseded');
  for (const s of live) storyById.set(s.id, s);
  const storiesByPhase = new Map();
  for (const s of [...live].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!s.phase || !phaseIds.has(s.phase)) { warnings.push(`story ${s.id}: phase ${s.phase} not in roadmap`); continue; }
    (storiesByPhase.get(s.phase) || storiesByPhase.set(s.phase, []).get(s.phase)).push(s);
  }

  const spikesByPhase = new Map();
  const spikeBlocks = [];
  for (const sp of spikes) {
    const id = `${prefix}-spike-${sp.key}`;
    const blocksPhase = phaseNumber(sp.blocks);
    let phase = null;
    let unmatched = false;
    if (blocksPhase && phaseIds.has(blocksPhase)) {
      phase = blocksPhase;
      spikeBlocks.push({ id: reviewIds.get(phase), blockedBy: id });
    } else if (storyById.has(sp.blocks) && storyById.get(sp.blocks).phase && phaseIds.has(storyById.get(sp.blocks).phase)) {
      phase = storyById.get(sp.blocks).phase;
      spikeBlocks.push({ id: `${prefix}-${sp.blocks}`, blockedBy: id });
    } else {
      phase = phases.length ? phases[0].number : null;
      unmatched = true;
      warnings.push(`spike ${sp.key}: blocks "${sp.blocks}" matched nothing`);
    }
    if (phase === null) continue;
    (spikesByPhase.get(phase) || spikesByPhase.set(phase, []).get(phase)).push({ ...sp, id, phase, unmatched });
  }

  for (const p of phases) {
    const epicId = phaseIds.get(p.number);
    const reviewId = reviewIds.get(p.number);
    for (const s of storiesByPhase.get(p.number) || []) {
      beads.push({ id: `${prefix}-${s.id}`, title: s.title, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'story'], metadata: { ...base(p.number, s.id), story: s.id, story_file: path.basename(s.file) }, priority: 2, docId: s.id });
    }
    for (const sp of spikesByPhase.get(p.number) || []) {
      const q = sp.question.length > 120 ? `${sp.question.slice(0, 117)}...` : sp.question;
      beads.push({ id: sp.id, title: `Spike ${sp.key}: ${q}`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'spike'], metadata: { ...base(p.number, `spike-${sp.key}`), spike: sp.key, time_box: sp.timeBox }, priority: 1, docId: `spike-${sp.key}` });
    }
    beads.push({ id: reviewId, title: `Phase ${p.number} review: sprint-review and realign`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'phase-review'], metadata: base(p.number, `phase-${p.number}-review`), priority: 1, docId: `phase-${p.number}-review` });
  }

  for (let i = 1; i < phases.length; i++) {
    const prevReview = reviewIds.get(phases[i - 1].number);
    const p = phases[i];
    const members = [...(storiesByPhase.get(p.number) || []).map((s) => `${prefix}-${s.id}`), ...(spikesByPhase.get(p.number) || []).filter((sp) => !sp.unmatched).map((sp) => sp.id)];
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
        if (storyById.has(d)) deps.push({ id: `${prefix}-${s.id}`, blockedBy: `${prefix}-${d}` });
        else warnings.push(`story ${s.id}: depends_on ${d} unknown`);
      }
    }
  }
  deps.push(...spikeBlocks);

  return { beads, deps, warnings };
}

function headings(text) {
  return (text || '').split(/\r?\n/).filter((l) => /^#{1,2}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
}

function denylistFrom({ initiative, roadmap, stories, spikes, briefText, prdText, personaNames }) {
  const raw = [initiative, ...roadmap.phases.map((p) => p.name), ...stories.map((s) => s.title), ...spikes.map((s) => s.question), ...headings(briefText), ...headings(prdText), ...(personaNames || [])];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
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

module.exports = { planGraph, denylistFrom };
