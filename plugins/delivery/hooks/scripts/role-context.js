// hooks/scripts/role-context.js — shared logic for the role retention hooks.
// A hook calls one of the *Text functions and prints the result. Everything
// here must be safe to call from a session with no role: it returns '' then.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, expandInstances } = require('../../scripts/lib/manifest.js');
const { loadRoleBrief, composeBrief } = require('../../scripts/lib/compose-brief.js');
const { registerInstance } = require('../../scripts/lib/roster.js');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function findRoleMarker(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const file = path.join(dir, '.delivery-role.json');
    if (fs.existsSync(file)) {
      try { return { markerFile: file, marker: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (err) { return null; }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function composeForMarker(marker, pluginRoot) {
  const { team, hosts } = loadManifest(marker.project_root);
  const found = expandInstances(team).find((i) => i.instance === marker.instance);
  if (!found) return `# Role: ${marker.instance}\n\nThis instance is no longer in team.json. Stop and tell the Chief of Staff.\n`;
  const brief = loadRoleBrief(pluginRoot, marker.project_root, found.role.brief);
  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  return composeBrief({ team, hosts, instance: marker.instance, role: found.role, brief, rules });
}

function currentClaim(actor) {
  if (!actor) return null;
  try {
    const out = execFileSync('bd', ['list', '--assignee', actor, '--status', 'in_progress', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
    const items = JSON.parse(out);
    if (!Array.isArray(items) || items.length === 0) return null;
    return `${items[0].id}: ${items[0].title}`;
  } catch (err) {
    return null;
  }
}

function sessionStartText(input, pluginRoot, deps = {}) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  const { marker } = found;
  const now = deps.now || new Date().toISOString();
  try {
    registerInstance(marker.project_root, {
      instance: marker.instance,
      session_id: input.session_id || 'unknown',
      host: marker.host,
      model: marker.model,
      role_dir: path.dirname(found.markerFile),
      now,
    });
  } catch (err) {
    // roster write failure must not stop the session; the status check will show the gap
  }
  const brief = composeForMarker(marker, pluginRoot);
  const claim = (deps.claim || currentClaim)(process.env.BEADS_ACTOR);
  const tail = claim
    ? `\nYou currently hold: ${claim}. Continue it; append a note before anything else.\n`
    : '\nYou hold no claim. Run `bd prime` then `bd ready`, and say what you could take.\n';
  return `${brief}${tail}`;
}

function postCompactText(input, pluginRoot) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  return `Context was compacted. Your role is restated below; it has not changed.\n\n${composeForMarker(found.marker, pluginRoot)}`;
}

function promptSubmitText(input, deps = {}) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  const claim = (deps.claim || currentClaim)(process.env.BEADS_ACTOR);
  const claimText = claim ? `${claim}.` : 'none (idle; say so and what you could take).';
  return `You are ${found.marker.instance} (${found.marker.role}). Current claim: ${claimText}`;
}

module.exports = { readHookInput, findRoleMarker, composeForMarker, currentClaim, sessionStartText, postCompactText, promptSubmitText };
