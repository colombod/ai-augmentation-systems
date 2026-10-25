// scripts/lib/gate-context.js — the reads the gates need, shared by bd-guard, ready.js and evidence.js:
// who is running (role, instance, actor) and, for a bead, its story, surface, evidence and manifest.
const fs = require('fs');
const path = require('path');
const { findProjectRoot, loadManifest, expandInstances } = require('./manifest.js');
const { loadSurface } = require('./surface.js');
const G = require('./gates.js');

// The gates read the project repo's root checkout, but role sessions commit in their own clones and push
// to its origin, and nothing else brings that work into the root: measured 2026-10-25, ready.js read a
// master four commits behind origin and reported "no readable story file" for a story already pushed.
// So before a gate reads, the root fast-forwards to origin's copy of its branch: fast-forward only, never
// with uncommitted changes to tracked files, at most once a minute, and every refusal is left as it is.
// 'updated' | 'current' | 'no-remote' | 'dirty' | 'diverged' | 'recent' | 'skipped'
function freshRoot(root, { env = process.env, everyMs = 60e3, now = Date.now() } = {}) {
  try {
    if (!root || env.DELIVERY_NO_FRESH_ROOT === '1' || !fs.existsSync(path.join(root, '.git'))) return 'skipped';
    const { spawnSync } = require('child_process');
    const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', timeout: 8000, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
    const gitDir = (git('rev-parse', '--git-dir').stdout || '').trim();
    const stamp = path.join(path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir || '.git'), 'delivery-fresh-root');
    try { if (now - fs.statSync(stamp).mtimeMs < everyMs) return 'recent'; } catch (err) { /* never freshened */ }
    if (git('remote', 'get-url', 'origin').status !== 0) return 'no-remote';
    try { fs.writeFileSync(stamp, `${new Date(now).toISOString()}\n`); } catch (err) { /* best effort */ }
    if ((git('status', '--porcelain', '--untracked-files=no').stdout || '').trim()) return 'dirty';
    const branch = (git('rev-parse', '--abbrev-ref', 'HEAD').stdout || '').trim();
    if (!branch || branch === 'HEAD') return 'skipped';
    if (git('fetch', '-q', 'origin', branch).status !== 0) return 'skipped';
    const before = (git('rev-parse', 'HEAD').stdout || '').trim();
    if (git('merge', '--ff-only', '-q', 'FETCH_HEAD').status !== 0) return 'diverged';
    return (git('rev-parse', 'HEAD').stdout || '').trim() === before ? 'current' : 'updated';
  } catch (err) { return 'skipped'; }
}

// { root, roleId, instance, actor, team, roleDir } for this session; role fields are null outside a role session.
function whoAmI({ cwd = process.cwd(), env = process.env, project } = {}) {
  let valid = null;
  try {
    const { findRoleMarker, validMarker } = require('../../hooks/scripts/role-context.js');
    valid = validMarker(findRoleMarker(cwd));
  } catch (err) { valid = null; }
  const root = valid ? valid.marker.project_root : (project ? path.resolve(project) : findProjectRoot(cwd));
  if (root) freshRoot(root, { env });
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

// The owner's record: it verifies, and every captured input it rests on is the owner's own words
// (source human). A peer agent's message is captured as an input too and verifies as one, but it is
// never the owner. { ok, why, head, text, goal } where head is the record (or the input) itself.
function ownerRecord(root, id, verifyRecord) {
  let v;
  try { v = (verifyRecord || require('./operator-records.js').verifyRecord)(root, id); } catch (err) { v = null; }
  if (!v || !v.ok) return { ok: false, why: `${id} does not verify (${v ? v.error || v.code : 'no result'})` };
  const chain = Array.isArray(v.chain) ? v.chain : [];
  const inputs = chain.filter((h) => h && h.kind === 'input');
  const notOwner = inputs.find((h) => h.source !== 'human');
  if (!inputs.length) return { ok: false, why: `${id} rests on no captured input from the owner` };
  if (notOwner) return { ok: false, why: `${id} rests on a ${notOwner.source || 'unknown'} message, not the owner's words` };
  const head = chain[0] || {};
  const labels = (head.scope && head.scope.labels) || [];
  // only the owner's own words: the verified quote and the captured input, never the statement or the
  // scope the recording agent wrote (PR 54 re-review I-a)
  return { ok: true, head, text: [head.quote, ...inputs.map((h) => h.text)].filter(Boolean).join(' '), goal: labels.some((l) => /^goal:/.test(String(l))) };
}

// recordOk(id) for the gates: a cut, waiver or reason must cite the owner's record, still verifying.
function recordChecker(root, verifyRecord) {
  const seen = new Map();
  return (id) => {
    if (!id) return false;
    if (!seen.has(id)) seen.set(id, ownerRecord(root, id, verifyRecord).ok);
    return seen.get(id);
  };
}

const maxUnverified = (team) => { const v = team && team.budget ? team.budget.max_unverified : undefined; return Number.isInteger(v) && v >= 0 ? v : G.DEFAULT_MAX_UNVERIFIED; };

module.exports = { freshRoot, whoAmI, readStory, gateInputs, maxUnverified, writerProblem, recordChecker, ownerRecord, EVIDENCE_WRITERS };
