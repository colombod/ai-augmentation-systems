#!/usr/bin/env node
// scripts/materialise.js — document plans, beads execute. The only writer of bead structure.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, loadManifest } = require('./lib/manifest.js');
const { parseFrontmatter } = require('./lib/compose-brief.js');
const { parseRoadmap, parseStories, parseSpikes } = require('./lib/plan-docs.js');
const { planGraph, denylistFrom } = require('./lib/plan-graph.js');
const { makeBd } = require('./lib/bd.js');

function readIf(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

// The ref tracks the roadmap file itself: last commit touching it, else a content hash (uncommitted or no git).
function roadmapSha(root, initiative, text) {
  try {
    const rel = path.join('.delivery', 'initiatives', initiative, 'roadmap.md');
    const sha = execFileSync('git', ['-C', root, 'log', '-1', '--format=%h', '--', rel], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sha) return sha;
  } catch (err) { /* fall through to the content hash */ }
  return `h${crypto.createHash('sha256').update(text).digest('hex').slice(0, 7)}`;
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
  const roadmapText = fs.readFileSync(roadmapFile, 'utf8');
  return {
    team,
    roadmap: parseRoadmap(roadmapText),
    stories: parseStories(path.join(projectRoot, '.delivery', 'stories')),
    spikes: parseSpikes(readIf(path.join(init, 'architecture.md'))),
    sha: roadmapSha(projectRoot, initiative, roadmapText),
    briefText: readIf(path.join(init, 'brief.md')),
    prdText: readIf(path.join(init, 'prd.md')),
    personaNames: personaNames(path.join(projectRoot, '.delivery', 'personas')),
  };
}

function sameMeta(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

function applyPlan({ plan, bd, dryRun }) {
  const result = { created: [], updated: [], depsAdded: [], skippedClosed: [], skippedDeps: [], commands: [] };
  const known = new Map(bd.list({ all: true }).map((b) => [b.id, b]));
  for (const b of plan.beads) {
    const existing = known.get(b.id);
    if (!existing) {
      result.commands.push(`create ${b.id} "${b.title}"`);
      if (!dryRun) bd.create({ id: b.id, title: b.title, type: b.type, parent: b.parent || undefined, labels: b.labels, metadata: b.metadata, priority: b.priority });
      result.created.push(b.id);
      continue;
    }
    if (existing.status === 'closed') { result.skippedClosed.push(b.id); continue; }
    const missingLabels = b.labels.filter((l) => !existing.labels.includes(l));
    const metaDrift = !sameMeta(existing.metadata, { ...existing.metadata, ...b.metadata });
    const titleChanged = existing.title !== b.title;
    const parentChanged = (existing.parent || null) !== (b.parent || null);
    const staleLabels = parentChanged ? existing.labels.filter((l) => /^phase-\d/.test(l) && !b.labels.includes(l)) : [];
    if (!missingLabels.length && !staleLabels.length && !metaDrift && !titleChanged && !parentChanged) continue;
    result.commands.push(`update ${b.id}`);
    if (!dryRun) bd.update(b.id, { title: titleChanged ? b.title : undefined, parent: parentChanged ? b.parent : undefined, addLabels: missingLabels, removeLabels: staleLabels, metadata: metaDrift ? b.metadata : undefined });
    result.updated.push(b.id);
  }
  const closed = new Set(result.skippedClosed);
  const cache = new Map();
  const blockers = (id) => { if (!cache.has(id)) cache.set(id, result.created.includes(id) ? [] : bd.depsOf(id)); return cache.get(id); };
  for (const d of plan.deps) {
    if (closed.has(d.id)) { result.skippedDeps.push(d); continue; }
    if (blockers(d.id).includes(d.blockedBy)) continue;
    result.commands.push(`dep ${d.id} blocked-by ${d.blockedBy}`);
    if (!dryRun) bd.depAdd(d.id, d.blockedBy);
    blockers(d.id).push(d.blockedBy);
    result.depsAdded.push(d);
  }
  return result;
}

function reconcile({ plan, bd, roadmap }) {
  const out = { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [] };
  const planned = new Map(plan.beads.map((b) => [b.id, b]));
  const doneByPhase = new Map(roadmap.phases.map((p) => [p.number, p.done]));
  const known = new Map(bd.list({ all: true }).map((x) => [x.id, x]));
  const initiative = ((plan.beads[0] || {}).metadata || {}).roadmap_ref ? plan.beads[0].metadata.roadmap_ref.split('/')[0] : '';
  for (const b of plan.beads) {
    const existing = known.get(b.id);
    if (!existing) { if (b.labels.includes('story')) out.storiesWithoutBead.push(b.id); continue; }
    if (existing.status !== 'closed' && (existing.metadata || {}).roadmap_ref !== b.metadata.roadmap_ref) {
      out.staleRef.push({ id: b.id, expected: b.metadata.roadmap_ref, actual: (existing.metadata || {}).roadmap_ref || '' });
    }
    if (b.labels.includes('phase-review') && existing.status === 'closed') {
      const phase = b.docId.replace(/^phase-/, '').replace(/-review$/, '');
      if (!doneByPhase.get(phase)) out.closedNotRealigned.push(b.id);
    }
  }
  for (const b of known.values()) {
    const m = b.metadata || {};
    if (b.labels.includes('roadmap') && m.materialised_by === 'delivery' && b.status !== 'closed' && String(m.roadmap_ref || '').startsWith(`${initiative}/`) && !planned.has(b.id)) out.unknownRoadmapBeads.push(b.id);
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
    if (a.startsWith('--') && a !== '--project' && a !== '--initiative') { out.error = `unknown flag ${a}`; return out; }
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { out.error = `${a} needs a value`; return out; } out[a.slice(2)] = v; i++; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(`materialise: ${args.error}`); process.exit(2); }
  const root = args.project ? path.resolve(args.project) : findProjectRoot(process.cwd());
  if (!root) { console.error('materialise: no .delivery/team/team.json found; pass --project <root>'); process.exit(2); }
  if (args.flags.has('check') && args.flags.has('dry-run')) { console.error('materialise: --check and --dry-run cannot be combined'); process.exit(2); }
  if (!args.initiative) { console.error('materialise: --initiative <slug> is required'); process.exit(2); }
  let inputs;
  try { inputs = loadInputs({ projectRoot: root, initiative: args.initiative }); } catch (err) { console.error(`materialise: ${err.message}`); process.exit(2); }
  const bd = makeBd({ cwd: root });
  try {
    const plan = planGraph({ prefix: inputs.team.prefix, initiative: args.initiative, sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
    if (args.flags.has('check')) {
      const d = reconcile({ plan, bd, roadmap: inputs.roadmap });
      if (hasDrift(d)) { console.log(renderDrift(d)); process.exit(1); }
      console.log('No plan drift.');
      process.exit(0);
    }
    const r = applyPlan({ plan, bd, dryRun: args.flags.has('dry-run') });
    const dryRun = args.flags.has('dry-run');
    const entries = denylistFrom({ initiative: args.initiative, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes, briefText: inputs.briefText, prdText: inputs.prdText, personaNames: inputs.personaNames });
    const denylistPath = path.join(root, '.delivery', 'team', 'denylist.txt');
    if (!dryRun) writeDenylist(root, entries);
    const denyText = dryRun ? `denylist would have ${entries.length} entries at ${denylistPath}` : `denylist ${denylistPath} (${entries.length} entries)`;
    console.log(`${dryRun ? 'dry run: ' : ''}created ${r.created.length}, updated ${r.updated.length}, deps ${r.depsAdded.length}, skipped closed ${r.skippedClosed.length}, skipped deps ${r.skippedDeps.length}; roadmap ${args.initiative}/roadmap.md@${inputs.sha}; ${denyText}`);
    if (args.flags.has('dry-run')) for (const c of r.commands) console.log(`  ${c}`);
    if (plan.warnings.length) { console.log('warnings:'); for (const w of plan.warnings) console.log(`  ${w}`); }
  } catch (err) {
    console.error(`materialise: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { loadInputs, applyPlan, reconcile, writeDenylist, renderDrift, hasDrift };
