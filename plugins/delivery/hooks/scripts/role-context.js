// hooks/scripts/role-context.js — shared logic for the role retention hooks.
// A hook calls one of the *Text functions and prints the result. Everything
// here must be safe to call from a session with no role: it returns '' then.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, expandInstances } = require('../../scripts/lib/manifest.js');
const { loadRoleBrief, composeBrief, shortBrief } = require('../../scripts/lib/compose-brief.js');
const { registerInstance, touchInstance, readRoster } = require('../../scripts/lib/roster.js');

const TOUCH_AFTER_MS = 5 * 60 * 1000;

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
    return items[0].title ? `${items[0].id}: ${items[0].title}` : String(items[0].id);
  } catch (err) {
    return null;
  }
}

// A marker file alone is not trusted: the session environment must name the same
// instance (prepare-role wrote it into settings.local.json), the project root must be
// absolute, and the manifest must list the instance. Returns null when the marker does
// not belong to this session (hook stays silent); throws when it does but cannot load.
function validMarker(found) {
  if (!found) return null;
  const { marker } = found;
  if (!marker || typeof marker.instance !== 'string') return null;
  if (process.env.DELIVERY_ROLE !== marker.instance) return null;
  if (typeof marker.project_root !== 'string' || !path.isAbsolute(marker.project_root)) return null;
  const { team, hosts } = loadManifest(marker.project_root);
  const entry = expandInstances(team).find((i) => i.instance === marker.instance);
  if (!entry) throw new Error(`instance "${marker.instance}" is not in team.json`);
  return { marker, team, hosts, role: entry.role, roleDir: path.dirname(found.markerFile) };
}

function actorOf(marker) {
  return process.env.BEADS_ACTOR || marker.actor;
}

function claimTail(claim) {
  return claim
    ? `\nYou currently hold: ${claim}. Continue it; append a note before anything else.\n`
    : '\nYou hold no claim. Run `bd prime` then `bd ready`, and say what you could take.\n';
}

function sessionStartText(input, pluginRoot, deps = {}) {
  const found = findRoleMarker(input.cwd);
  if (!found || !found.marker || process.env.DELIVERY_ROLE !== found.marker.instance) return '';
  const { marker } = found;
  const now = deps.now || new Date().toISOString();
  let valid;
  let full;
  try {
    valid = validMarker(found);
    if (!valid) return '';
    full = composeForMarker(marker, pluginRoot);
  } catch (err) {
    return `Role ${marker.instance}: cannot load the team manifest at ${marker.project_root} (${err.message}). Tell the Chief of Staff.\n`;
  }
  try {
    fs.writeFileSync(path.join(valid.roleDir, 'CLAUDE.local.md'), full);
  } catch (err) {
    // an unwritable file must not stop the session; the injected block still carries the role
  }
  try {
    registerInstance(marker.project_root, {
      instance: marker.instance,
      session_id: input.session_id || 'unknown',
      host: marker.host,
      model: marker.model,
      role_dir: valid.roleDir,
      now,
    });
  } catch (err) {
    // roster write failure must not stop the session; the status check will show the gap
  }
  const short = shortBrief({ team: valid.team, hosts: valid.hosts, instance: marker.instance, role: valid.role, roleDir: valid.roleDir });
  const claim = (deps.claim || currentClaim)(actorOf(marker));
  const prefix = input.source === 'compact' ? 'Context was compacted. Your role is restated below; it has not changed.\n\n' : '';
  return `${prefix}${short}${claimTail(claim)}`;
}

function promptSubmitText(input, deps = {}) {
  const found = findRoleMarker(input.cwd);
  let valid;
  try { valid = validMarker(found); } catch (err) { return ''; }
  if (!valid) return '';
  const { marker } = valid;
  const claim = (deps.claim || currentClaim)(actorOf(marker));
  const claimText = claim ? `${claim}.` : 'none (idle; say so and what you could take).';
  try {
    const now = deps.now || new Date().toISOString();
    const entry = readRoster(marker.project_root).instances[marker.instance];
    const seen = entry && entry.last_seen ? Date.parse(entry.last_seen) : NaN;
    if (!entry || Number.isNaN(seen) || Date.parse(now) - seen > TOUCH_AFTER_MS) {
      touchInstance(marker.project_root, { instance: marker.instance, now });
    }
  } catch (err) {
    // liveness bookkeeping must never break a prompt
  }
  return `You are ${marker.instance} (${marker.role}). Current claim: ${claimText}`;
}

module.exports = { readHookInput, findRoleMarker, validMarker, composeForMarker, currentClaim, sessionStartText, promptSubmitText, shortBrief };
