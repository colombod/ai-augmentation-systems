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

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function readIf(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

// The ref tracks the roadmap file itself: last commit touching it (suffixed `+` when the file has uncommitted
// changes), else a content hash (never committed, or no git).
function roadmapSha(root, initiative, text) {
  try {
    const rel = path.join('.delivery', 'initiatives', initiative, 'roadmap.md');
    const git = (args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const sha = git(['log', '-1', '--format=%h', '--', rel]);
    // An uncommitted edit to a committed roadmap is marked `+` so --check sees it as drift.
    if (sha) return git(['status', '--porcelain', '--', rel]) ? `${sha}+` : sha;
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
  const warnings = [];
  // Story ids become bead ids and git-facing names; anything outside the slug alphabet is skipped, not mangled.
  const stories = parseStories(path.join(projectRoot, '.delivery', 'stories')).filter((st) => {
    if (SLUG.test(st.id)) return true;
    warnings.push(`story "${st.id}" (${path.basename(st.file)}): id must match ${SLUG}, skipped`);
    return false;
  });
  return {
    warnings,
    team,
    roadmap: parseRoadmap(roadmapText),
    stories,
    spikes: parseSpikes(readIf(path.join(init, 'architecture.md'))),
    sha: roadmapSha(projectRoot, initiative, roadmapText),
    briefText: readIf(path.join(init, 'brief.md')),
    prdText: readIf(path.join(init, 'prd.md')),
    personaNames: personaNames(path.join(projectRoot, '.delivery', 'personas')),
  };
}

function sameMeta(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

// A bead this initiative's materialise made; only these may lose a dependency it no longer plans.
function isMaterialised(b, initiative) {
  const m = (b && b.metadata) || {};
  return m.materialised_by === 'delivery' && String(m.roadmap_ref || '').startsWith(`${initiative}/`);
}

function plannedBlockers(plan) {
  const out = new Map();
  for (const d of plan.deps) (out.get(d.id) || out.set(d.id, []).get(d.id)).push(d.blockedBy);
  return out;
}

function applyPlan({ plan, bd, dryRun, initiative }) {
  if (!initiative) throw new Error('applyPlan: initiative is required');
  const result = { created: [], updated: [], depsAdded: [], depsRemoved: [], skippedClosed: [], skippedDeps: [], commands: [] };
  try {
    applyPlanSteps({ plan, bd, dryRun, initiative, result });
  } catch (err) {
    err.partial = result;
    throw err;
  }
  return result;
}

function applyPlanSteps({ plan, bd, dryRun, initiative, result }) {
  const known = new Map(bd.list({ all: true }).map((b) => [b.id, b]));
  for (const b of plan.beads) {
    const existing = known.get(b.id);
    if (!existing) {
      result.commands.push(`create ${b.id} "${b.title}"`);
      if (!dryRun) bd.create({ id: b.id, title: b.title, type: b.type, parent: b.parent || undefined, labels: b.labels, metadata: b.metadata, priority: b.priority });
      result.created.push(b.id);
      // A second planned bead with this id must update, never create again: bd would silently overwrite it.
      known.set(b.id, { ...b, status: 'open' });
      continue;
    }
    if (existing.status === 'closed') { result.skippedClosed.push(b.id); continue; }
    const missingLabels = b.labels.filter((l) => !existing.labels.includes(l));
    const metaDrift = !sameMeta(existing.metadata, { ...existing.metadata, ...b.metadata });
    const titleChanged = existing.title !== b.title;
    const parentChanged = (existing.parent || null) !== (b.parent || null);
    const staleLabels = [
      ...(parentChanged ? existing.labels.filter((l) => /^phase-\d+[a-z]?$/.test(l) && !b.labels.includes(l)) : []),
      // a story re-sized in its file: the old size label goes
      ...existing.labels.filter((l) => /^size-[SML]$/.test(l) && !b.labels.includes(l)),
    ];
    // a story that no longer names a model: the bead's model override goes too
    const unsetMetadata = b.labels.includes('story') && (existing.metadata || {}).model !== undefined && b.metadata.model === undefined ? ['model'] : [];
    if (!missingLabels.length && !staleLabels.length && !metaDrift && !titleChanged && !parentChanged && !unsetMetadata.length) continue;
    result.commands.push(`update ${b.id}`);
    if (!dryRun) bd.update(b.id, { title: titleChanged ? b.title : undefined, parent: parentChanged ? b.parent : undefined, addLabels: missingLabels, removeLabels: staleLabels, metadata: metaDrift ? b.metadata : undefined, unsetMetadata });
    result.updated.push(b.id);
  }
  const closed = new Set(result.skippedClosed);
  const created = new Set(result.created);
  const cache = new Map();
  const blockers = (id) => { if (!cache.has(id)) cache.set(id, created.has(id) ? [] : bd.depsOf(id)); return cache.get(id); };
  // Re-thread: drop deps between this initiative's materialised beads that the plan no longer has,
  // before adding new ones, so a moved story never leaves a cycle for bd to reject.
  const planned = plannedBlockers(plan);
  for (const b of plan.beads) {
    if (created.has(b.id) || closed.has(b.id)) continue;
    const want = planned.get(b.id) || [];
    for (const blocker of [...blockers(b.id)]) {
      if (want.includes(blocker) || !isMaterialised(known.get(blocker), initiative)) continue;
      result.commands.push(`dep-remove ${b.id} blocked-by ${blocker}`);
      if (!dryRun) bd.depRemove(b.id, blocker);
      cache.set(b.id, blockers(b.id).filter((x) => x !== blocker));
      result.depsRemoved.push({ id: b.id, blockedBy: blocker });
    }
  }
  for (const d of plan.deps) {
    if (blockers(d.id).includes(d.blockedBy)) continue;
    if (closed.has(d.id)) { result.skippedDeps.push(d); continue; }
    result.commands.push(`dep ${d.id} blocked-by ${d.blockedBy}`);
    if (!dryRun) bd.depAdd(d.id, d.blockedBy);
    blockers(d.id).push(d.blockedBy);
    result.depsAdded.push(d);
  }
  return result;
}

function refSha(ref) { const m = /@(\S+) phase /.exec(ref || ''); return m ? m[1] : 'none'; }

// What would applyPlan change on this bead? Field names; roadmap_ref reported on its own.
function beadDiff(existing, planned) {
  const fields = [];
  if (existing.title !== planned.title) fields.push('title');
  if ((existing.parent || null) !== (planned.parent || null)) fields.push('parent');
  // labels materialise would add, and the managed ones it would remove (a stale size label)
  const have = existing.labels || [];
  if (planned.labels.some((l) => !have.includes(l)) || have.some((l) => /^size-[SML]$/.test(l) && !planned.labels.includes(l))) fields.push('labels');
  const meta = existing.metadata || {};
  for (const k of Object.keys(planned.metadata)) if (JSON.stringify(meta[k]) !== JSON.stringify(planned.metadata[k])) fields.push(k);
  // a story's model override materialise would unset
  if (planned.labels.includes('story') && meta.model !== undefined && planned.metadata.model === undefined && !fields.includes('model')) fields.push('model');
  return fields;
}

function reconcile({ plan, bd, roadmap, initiative }) {
  if (!initiative) throw new Error('reconcile: initiative is required');
  const out = { storiesWithoutBead: [], spikesWithoutBead: [], staleRef: [], titleDrift: [], parentDrift: [], otherDrift: [], closedNotRealigned: [], unknownRoadmapBeads: [], depDrift: [] };
  const planned = new Map(plan.beads.map((b) => [b.id, b]));
  const doneByPhase = new Map(roadmap.phases.map((p) => [p.number, p.done]));
  const known = new Map(bd.list({ all: true }).map((x) => [x.id, x]));
  for (const b of plan.beads) {
    const existing = known.get(b.id);
    if (!existing) {
      if (b.labels.includes('story')) out.storiesWithoutBead.push(b.id);
      if (b.labels.includes('spike')) out.spikesWithoutBead.push(b.id);
      continue;
    }
    if (b.labels.includes('phase-review') && existing.status === 'closed') {
      const phase = b.docId.replace(/^phase-/, '').replace(/-review$/, '');
      if (!doneByPhase.get(phase)) out.closedNotRealigned.push(b.id);
    }
    if (existing.status === 'closed') continue;
    const fields = beadDiff(existing, b);
    if (!fields.length) continue;
    if (fields.length === 1 && fields[0] === 'roadmap_ref') {
      out.staleRef.push({ id: b.id, expected: b.metadata.roadmap_ref, actual: (existing.metadata || {}).roadmap_ref || '' });
      continue;
    }
    if (fields.includes('title')) out.titleDrift.push({ id: b.id, expected: b.title, actual: existing.title });
    if (fields.includes('parent')) out.parentDrift.push({ id: b.id, expected: b.parent || null, actual: existing.parent || null });
    const rest = fields.filter((f) => f !== 'title' && f !== 'parent' && f !== 'roadmap_ref');
    if (rest.length) out.otherDrift.push({ id: b.id, fields: rest });
  }
  const want = plannedBlockers(plan);
  for (const b of plan.beads) {
    const existing = known.get(b.id);
    if (!existing || existing.status === 'closed') continue;
    const have = bd.depsOf(b.id);
    const wanted = want.get(b.id) || [];
    const missing = wanted.filter((x) => !have.includes(x));
    const extra = have.filter((x) => !wanted.includes(x) && isMaterialised(known.get(x), initiative));
    if (missing.length || extra.length) out.depDrift.push({ id: b.id, missing, extra });
  }
  for (const b of known.values()) {
    if (b.labels.includes('roadmap') && b.status !== 'closed' && isMaterialised(b, initiative) && !planned.has(b.id)) out.unknownRoadmapBeads.push(b.id);
  }
  return out;
}

function writeDenylist(projectRoot, entries) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.length ? `${entries.join('\n')}\n` : '');
  return file;
}

function hasDrift(d) { return Object.values(d).some((v) => Array.isArray(v) && v.length > 0); }

function renderDrift(d) {
  const lines = ['## Plan drift'];
  if (d.staleRef.length) {
    const olds = [...new Set(d.staleRef.map((x) => refSha(x.actual)))].join(', ');
    const news = [...new Set(d.staleRef.map((x) => refSha(x.expected)))].join(', ');
    lines.push(`Roadmap changed since last materialise (${olds}→${news}): ${d.staleRef.length} beads to refresh (run /delivery:materialise)`);
  }
  for (const x of d.titleDrift) lines.push(`Title drift: ${x.id} has "${x.actual}", plan says "${x.expected}"`);
  for (const x of d.parentDrift) lines.push(`Phase drift: ${x.id} is under ${x.actual || 'no epic'}, plan says ${x.expected || 'no epic'}`);
  for (const x of d.otherDrift) lines.push(`Bead out of date: ${x.id} (${x.fields.join(', ')})`);
  if (d.storiesWithoutBead.length) lines.push(`Stories without a bead: ${d.storiesWithoutBead.join(', ')}`);
  if (d.spikesWithoutBead.length) lines.push(`Spikes without a bead: ${d.spikesWithoutBead.join(', ')}`);
  for (const x of d.depDrift) lines.push(`Dependency drift: ${x.id} missing [${x.missing.join(', ')}] extra [${x.extra.join(', ')}]`);
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
  if (!SLUG.test(args.initiative)) { console.error(`materialise: --initiative "${args.initiative}" must match ${SLUG}`); process.exit(2); }
  let inputs;
  try { inputs = loadInputs({ projectRoot: root, initiative: args.initiative }); } catch (err) { console.error(`materialise: ${err.message}`); process.exit(2); }
  const bd = makeBd({ cwd: root });
  try {
    const plan = planGraph({ prefix: inputs.team.prefix, initiative: args.initiative, sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
    if (args.flags.has('check')) {
      const d = reconcile({ plan, bd, roadmap: inputs.roadmap, initiative: args.initiative });
      if (hasDrift(d)) { console.log(renderDrift(d)); process.exit(1); }
      console.log('No plan drift.');
      process.exit(0);
    }
    const r = applyPlan({ plan, bd, dryRun: args.flags.has('dry-run'), initiative: args.initiative });
    const dryRun = args.flags.has('dry-run');
    const entries = denylistFrom({ initiative: args.initiative, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes, briefText: inputs.briefText, prdText: inputs.prdText, personaNames: inputs.personaNames });
    const denylistPath = path.join(root, '.delivery', 'team', 'denylist.txt');
    if (!dryRun) writeDenylist(root, entries);
    const denyText = dryRun ? `denylist would have ${entries.length} entries at ${denylistPath}` : `denylist ${denylistPath} (${entries.length} entries)`;
    console.log(`${dryRun ? 'dry run: ' : ''}created ${r.created.length}, updated ${r.updated.length}, deps ${r.depsAdded.length}, deps removed ${r.depsRemoved.length}, skipped closed ${r.skippedClosed.length}, skipped deps ${r.skippedDeps.length}; roadmap ${args.initiative}/roadmap.md@${inputs.sha}; ${denyText}`);
    if (args.flags.has('dry-run')) for (const c of r.commands) console.log(`  ${c}`);
    const warnings = [...inputs.warnings, ...plan.warnings];
    if (warnings.length) { console.log('warnings:'); for (const w of warnings) console.log(`  ${w}`); }
  } catch (err) {
    const p = err.partial;
    if (p) {
      const ids = (xs) => xs.map((x) => (typeof x === 'string' ? x : `${x.id}<-${x.blockedBy}`)).join(' ') || '-';
      console.log(`materialise stopped part-way; so far: created ${p.created.length} [${ids(p.created)}], updated ${p.updated.length} [${ids(p.updated)}], deps ${p.depsAdded.length} [${ids(p.depsAdded)}], deps removed ${p.depsRemoved.length} [${ids(p.depsRemoved)}]`);
    }
    console.error(`materialise: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { loadInputs, applyPlan, reconcile, writeDenylist, renderDrift, hasDrift };
