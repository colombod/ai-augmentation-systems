// scripts/lib/gate-context.js — the reads the gates need, shared by bd-guard, ready.js and evidence.js:
// who is running (role, instance, actor) and, for a bead, its story, surface, evidence and manifest.
const fs = require('fs');
const path = require('path');
const { findProjectRoot, loadManifest, expandInstances } = require('./manifest.js');
const { loadSurface } = require('./surface.js');
const G = require('./gates.js');

// { root, roleId, instance, actor, team, roleDir } for this session; role fields are null outside a role session.
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
    roleDir: valid ? valid.roleDir : null,
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
  const ev = G.readEvidenceChecked(root, bead.id);
  // no surface declared for this story (no surface.json, no initiative, several and none named):
  // evidence counts without the surface check, with a warning (R-09 is warn-level)
  const noSurface = !s.surfaces.length || !surfaceId;
  return { story, initiative, surfaces: s.surfaces, surfaceMissing: s.missing || s.problems.length > 0, surfaceId, surface, noSurface,
    rows: ev.rows, evidenceProblem: G.headProblem(ev, bead), instances, parent, parentStory: parent ? readStory(root, parent) : null };
}

// Gate records are written only from a role session, and the role comes from its marker (an
// environment variable alone is not enough). Fails closed: no valid marker, no write.
const EVIDENCE_WRITERS = ['delivery-lead', 'reality-checker'];
function writerProblem(who, allowed = ['delivery-lead']) {
  if (!who.roleId) return 'this writes a gate record and needs the Delivery Manager\'s role session; none is active here.';
  if (!allowed.includes(who.roleId)) return `this is the Delivery Manager's to do (this session is ${who.roleId}); message the Delivery Manager.`;
  return null;
}

// recordOk(id) for the done gate: an owner record cited by a cut or waiver row must still verify.
function recordChecker(root, verifyRecord) {
  const seen = new Map();
  return (id) => {
    if (!id) return false;
    if (!seen.has(id)) {
      let ok = false;
      try { const v = (verifyRecord || require('./operator-records.js').verifyRecord)(root, id); ok = Boolean(v && v.ok); } catch (err) { ok = false; }
      seen.set(id, ok);
    }
    return seen.get(id);
  };
}

const maxUnverified = (team) => { const v = team && team.budget ? team.budget.max_unverified : undefined; return Number.isInteger(v) && v >= 0 ? v : G.DEFAULT_MAX_UNVERIFIED; };

module.exports = { whoAmI, readStory, gateInputs, maxUnverified, writerProblem, recordChecker, EVIDENCE_WRITERS };
