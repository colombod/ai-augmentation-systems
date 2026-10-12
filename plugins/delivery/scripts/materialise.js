#!/usr/bin/env node
// scripts/materialise.js — document plans, beads execute. The only writer of bead structure.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, loadManifest } = require('./lib/manifest.js');
const { parseFrontmatter } = require('./lib/compose-brief.js');
const { parseRoadmap, parseStories, parseSpikes } = require('./lib/plan-docs.js');
const { planGraph, denylistFrom } = require('./lib/plan-graph.js');
const { makeBd } = require('./lib/bd.js');

function readIf(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

function gitSha(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (err) { return 'nogit'; }
}

function personaNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, ''));
    return meta.name ? String(meta.name) : null;
  }).filter(Boolean);
}

function loadInputs({ projectRoot, initiative }) {
  const { team } = loadManifest(projectRoot);
  const init = path.join(projectRoot, '.delivery', 'initiatives', initiative);
  const roadmapFile = path.join(init, 'roadmap.md');
  if (!fs.existsSync(roadmapFile)) throw new Error(`materialise: roadmap not found at ${roadmapFile}`);
  return {
    team,
    roadmap: parseRoadmap(fs.readFileSync(roadmapFile, 'utf8')),
    stories: parseStories(path.join(projectRoot, '.delivery', 'stories')),
    spikes: parseSpikes(readIf(path.join(init, 'architecture.md'))),
    sha: gitSha(projectRoot),
    briefText: readIf(path.join(init, 'brief.md')),
    prdText: readIf(path.join(init, 'prd.md')),
    personaNames: personaNames(path.join(projectRoot, '.delivery', 'personas')),
  };
}

function sameMeta(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

function applyPlan({ plan, bd, dryRun }) {
  const result = { created: [], updated: [], depsAdded: [], skippedClosed: [], commands: [] };
  for (const b of plan.beads) {
    const existing = bd.show(b.id);
    if (!existing) {
      result.commands.push(`create ${b.id} "${b.title}"`);
      if (!dryRun) bd.create({ id: b.id, title: b.title, type: b.type, parent: b.parent || undefined, labels: b.labels, metadata: b.metadata, priority: b.priority });
      result.created.push(b.id);
      continue;
    }
    if (existing.status === 'closed') { result.skippedClosed.push(b.id); continue; }
    const missingLabels = b.labels.filter((l) => !existing.labels.includes(l));
    const refChanged = (existing.metadata || {}).roadmap_ref !== b.metadata.roadmap_ref;
    const titleChanged = existing.title !== b.title;
    const parentChanged = (existing.parent || null) !== (b.parent || null);
    if (!missingLabels.length && !refChanged && !titleChanged && !parentChanged) continue;
    result.commands.push(`update ${b.id}`);
    if (!dryRun) bd.update(b.id, { title: titleChanged ? b.title : undefined, parent: parentChanged ? b.parent : undefined, addLabels: missingLabels, metadata: refChanged || !sameMeta(existing.metadata, { ...existing.metadata, ...b.metadata }) ? b.metadata : undefined });
    result.updated.push(b.id);
  }
  const cache = new Map();
  const blockers = (id) => { if (!cache.has(id)) cache.set(id, dryRun && result.created.includes(id) ? [] : bd.depsOf(id)); return cache.get(id); };
  for (const d of plan.deps) {
    if (!dryRun && (blockers(d.id).includes(d.blockedBy))) continue;
    if (dryRun && !result.created.includes(d.id) && blockers(d.id).includes(d.blockedBy)) continue;
    result.commands.push(`dep ${d.id} blocked-by ${d.blockedBy}`);
    if (!dryRun) { bd.depAdd(d.id, d.blockedBy); cache.get(d.id).push(d.blockedBy); }
    result.depsAdded.push(d);
  }
  return result;
}

function reconcile({ plan, bd, roadmap }) {
  const out = { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [] };
  const planned = new Map(plan.beads.map((b) => [b.id, b]));
  const doneByPhase = new Map(roadmap.phases.map((p) => [p.number, p.done]));
  for (const b of plan.beads) {
    const existing = bd.show(b.id);
    if (!existing) { if (b.labels.includes('story')) out.storiesWithoutBead.push(b.id); continue; }
    if (existing.status !== 'closed' && (existing.metadata || {}).roadmap_ref !== b.metadata.roadmap_ref) {
      out.staleRef.push({ id: b.id, expected: b.metadata.roadmap_ref, actual: (existing.metadata || {}).roadmap_ref || '' });
    }
    if (b.labels.includes('phase-review') && existing.status === 'closed') {
      const phase = b.docId.replace(/^phase-/, '').replace(/-review$/, '');
      if (!doneByPhase.get(phase)) out.closedNotRealigned.push(b.id);
    }
  }
  for (const b of bd.list({ label: 'roadmap', all: true })) {
    if ((b.metadata || {}).materialised_by === 'delivery' && !planned.has(b.id)) out.unknownRoadmapBeads.push(b.id);
  }
  return out;
}

function writeDenylist(projectRoot, entries) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.length ? `${entries.join('\n')}\n` : '');
  return file;
}

function hasDrift(d) { return d.storiesWithoutBead.length || d.staleRef.length || d.closedNotRealigned.length || d.unknownRoadmapBeads.length; }

function renderDrift(d) {
  const lines = ['## Plan drift'];
  if (d.storiesWithoutBead.length) lines.push(`Stories without a bead: ${d.storiesWithoutBead.join(', ')}`);
  for (const s of d.staleRef) lines.push(`Stale roadmap_ref: ${s.id} expected ${s.expected}, has ${s.actual || 'none'}`);
  if (d.closedNotRealigned.length) lines.push(`Phase review closed but roadmap not marked (done): ${d.closedNotRealigned.join(', ')}`);
  if (d.unknownRoadmapBeads.length) lines.push(`Roadmap beads not in the plan: ${d.unknownRoadmapBeads.join(', ')}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--check') { out.flags.add(a.slice(2)); continue; }
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { out.error = `${a} needs a value`; return out; } out[a.slice(2)] = v; i++; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(`materialise: ${args.error}`); process.exit(2); }
  const root = args.project ? path.resolve(args.project) : findProjectRoot(process.cwd());
  if (!root) { console.error('materialise: no .delivery/team/team.json found; pass --project <root>'); process.exit(2); }
  if (!args.initiative) { console.error('materialise: --initiative <slug> is required'); process.exit(2); }
  let inputs;
  try { inputs = loadInputs({ projectRoot: root, initiative: args.initiative }); } catch (err) { console.error(`materialise: ${err.message}`); process.exit(2); }
  const plan = planGraph({ prefix: inputs.team.prefix, initiative: args.initiative, sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const bd = makeBd({ cwd: root });
  try {
    if (args.flags.has('check')) {
      const d = reconcile({ plan, bd, roadmap: inputs.roadmap });
      if (hasDrift(d)) { console.log(renderDrift(d)); process.exit(1); }
      console.log('No plan drift.');
      process.exit(0);
    }
    const r = applyPlan({ plan, bd, dryRun: args.flags.has('dry-run') });
    const denylist = writeDenylist(root, denylistFrom({ initiative: args.initiative, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes, briefText: inputs.briefText, prdText: inputs.prdText, personaNames: inputs.personaNames }));
    console.log(`${args.flags.has('dry-run') ? 'dry run: ' : ''}created ${r.created.length}, updated ${r.updated.length}, deps ${r.depsAdded.length}, skipped closed ${r.skippedClosed.length}; roadmap ${args.initiative}/roadmap.md@${inputs.sha}; denylist ${denylist} (${fs.readFileSync(denylist, 'utf8').split('\n').filter(Boolean).length} entries)`);
    if (args.flags.has('dry-run')) for (const c of r.commands) console.log(`  ${c}`);
    if (plan.warnings.length) { console.log('warnings:'); for (const w of plan.warnings) console.log(`  ${w}`); }
  } catch (err) {
    console.error(`materialise: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { loadInputs, applyPlan, reconcile, writeDenylist, renderDrift, hasDrift };
