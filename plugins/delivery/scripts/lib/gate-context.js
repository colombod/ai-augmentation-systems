// scripts/lib/gate-context.js — the reads the gates need, shared by bd-guard, ready.js and evidence.js:
// who is running (role, instance, actor) and, for a bead, its story, surface, evidence and manifest.
const fs = require('fs');
const path = require('path');
const { findProjectRoot, loadManifest, expandInstances } = require('./manifest.js');
const { loadSurface } = require('./surface.js');
const G = require('./gates.js');

// { root, roleId, instance, actor, team } for this session; role fields are null outside a role session.
function whoAmI({ cwd = process.cwd(), env = process.env, project } = {}) {
  let valid = null;
  try {
    const { findRoleMarker, validMarker } = require('../../hooks/scripts/role-context.js');
    valid = validMarker(findRoleMarker(cwd));
  } catch (err) { valid = null; }
  const root = valid ? valid.marker.project_root : (project ? path.resolve(project) : findProjectRoot(cwd));
  let team = valid ? valid.team : null;
  if (!team && root) { try { team = loadManifest(root).team; } catch (err) { team = null; } }
  return {
    root,
    team,
    roleId: valid ? valid.role.id : null,
    instance: valid ? valid.marker.instance : null,
    actor: valid ? (env.BEADS_ACTOR || valid.marker.actor) : (env.BEADS_ACTOR || null),
  };
}

function readStory(root, bead) {
  const file = bead && bead.metadata && bead.metadata.story_file;
  if (!root || !file || path.basename(String(file)) !== String(file)) return null;
  try { return G.parseStory(fs.readFileSync(path.join(root, '.delivery', 'stories', file), 'utf8')); } catch (err) { return null; }
}

// Everything a gate reads about one bead. Missing pieces stay null; nothing throws on a bad read.
function gateInputs(root, bead, { bd, team } = {}) {
  const story = readStory(root, bead);
  const initiative = G.initiativeOf(bead);
  const s = initiative ? loadSurface(root, initiative) : { surfaces: [], missing: true, problems: [], warnings: [] };
  const { id: surfaceId, surface } = G.storySurface(story || { meta: {} }, bead, s.surfaces);
  let instances = [];
  try { instances = team ? expandInstances(team) : []; } catch (err) { instances = []; }
  let parent = null;
  if (bead.parent && bd) { try { parent = bd.show(bead.parent); } catch (err) { parent = null; } }
  return { story, initiative, surfaces: s.surfaces, surfaceMissing: s.missing || s.problems.length > 0, surfaceId, surface,
    rows: G.readEvidence(root, bead.id), instances, parent, parentStory: parent ? readStory(root, parent) : null };
}

const maxUnverified = (team) => { const v = team && team.budget ? team.budget.max_unverified : undefined; return Number.isInteger(v) && v >= 0 ? v : G.DEFAULT_MAX_UNVERIFIED; };

module.exports = { whoAmI, readStory, gateInputs, maxUnverified };
