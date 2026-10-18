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

function readMarker(file) {
  try { return { markerFile: file, marker: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (err) { return null; }
}

// The session's own role directory (DELIVERY_ROLE_DIR, written by prepare-role) wins, so the marker
// is found after the session leaves its role tree; otherwise walk up from cwd. Callers still validate.
function findRoleMarker(cwd) {
  const envDir = process.env.DELIVERY_ROLE_DIR;
  if (envDir && process.env.DELIVERY_ROLE && path.isAbsolute(envDir)) {
    const file = path.join(envDir, '.delivery-role.json');
    if (fs.existsSync(file)) return readMarker(file);
  }
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const file = path.join(dir, '.delivery-role.json');
    if (fs.existsSync(file)) return readMarker(file);
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
  return composeBrief({ team, hosts, instance: marker.instance, role: found.role, brief, rules, pluginRoot });
}

// Where and with what environment a hook runs bd: at the project root (bd cannot find the
// database from a role directory), with BEADS_DIR defaulted to <project_root>/.beads when that
// directory exists and the session did not set one. Falls back to the hook cwd.
function bdOptionsFor(marker, cwd) {
  const env = { ...process.env };
  const root = marker && typeof marker.project_root === 'string' && path.isAbsolute(marker.project_root) && fs.existsSync(marker.project_root) ? marker.project_root : null;
  if (root && !env.BEADS_DIR) {
    const beads = path.join(root, '.beads');
    if (fs.existsSync(beads)) env.BEADS_DIR = beads;
  }
  return { cwd: root || cwd || process.cwd(), env };
}

function currentClaim(actor, opts = {}) {
  if (!actor) return null;
  try {
    const out = execFileSync('bd', ['list', '--assignee', actor, '--status', 'in_progress', '--json'], { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
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

// Operator capture runs first in every role hook; its failure never changes the hook's own output.
// Returns the short note for the session ('' when there is nothing to say); problems also go to
// deps.warn (the hook scripts pass a stderr writer).
function operatorCaptureNote(input, pluginRoot, deps = {}) {
  try {
    const { captureFromHookInput, captureNote } = require('./operator-capture.js');
    const res = (deps.capture || captureFromHookInput)(input || {}, pluginRoot);
    if (res && res.problem && deps.warn) deps.warn(`delivery: ${res.problem}\n`);
    return captureNote(res, pluginRoot);
  } catch (err) {
    return '';
  }
}

const PLUGIN_ROOT = path.join(__dirname, '..', '..');

function sessionStartText(input, pluginRoot, deps = {}) {
  const note = operatorCaptureNote(input, pluginRoot || PLUGIN_ROOT, deps);
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
  // CLAUDE.local.md loads natively at session start, before this hook rewrites it. When the file is
  // already byte-identical, a startup or resume needs no role block injected (the loaded copy is
  // current); when this run changes it, the loaded copy is stale and the block is injected with a
  // re-read instruction. clear and compact always restate the role.
  const briefFile = path.join(valid.roleDir, 'CLAUDE.local.md');
  let unchanged = false;
  try { unchanged = fs.readFileSync(briefFile, 'utf8') === full; } catch (err) { unchanged = false; }
  if (!unchanged) {
    try {
      fs.writeFileSync(briefFile, full);
    } catch (err) {
      // an unwritable file must not stop the session; the injected block still carries the role
    }
  }
  const freshStart = input.source === 'startup' || input.source === 'resume';
  try {
    registerInstance(marker.project_root, {
      instance: marker.instance,
      session_id: input.session_id || 'unknown',
      host: marker.host,
      model: marker.model,
      role_dir: valid.roleDir,
      now,
      transcript_path: typeof input.transcript_path === 'string' && path.isAbsolute(input.transcript_path) ? input.transcript_path : undefined,
    });
  } catch (err) {
    // roster write failure must not stop the session; the status check will show the gap
  }
  const claim = (deps.claim || currentClaim)(actorOf(marker), bdOptionsFor(marker, input.cwd));
  if (freshStart && unchanged) return `${claimTail(claim).trimStart()}${note ? `\n${note}\n` : ''}`;
  const short = shortBrief({ team: valid.team, hosts: valid.hosts, instance: marker.instance, role: valid.role, roleDir: valid.roleDir, pluginRoot: pluginRoot || PLUGIN_ROOT });
  const prefix = input.source === 'compact' ? 'Context was compacted. Your role is restated below; it has not changed.\n\n'
    : (freshStart ? `Your ${valid.roleDir}/CLAUDE.local.md was rewritten at this start (the manifest or the plugin changed), so the copy loaded with this session is stale: re-read it now; it is binding.\n\n` : '');
  return `${prefix}${short}${claimTail(claim)}${note ? `\n${note}\n` : ''}`;
}

function promptSubmitText(input, deps = {}) {
  const note = operatorCaptureNote(input, PLUGIN_ROOT, deps);
  const found = findRoleMarker(input.cwd);
  let valid;
  try { valid = validMarker(found); } catch (err) { return note; }
  if (!valid) return note;
  const { marker } = valid;
  require('./turn.js').markTurnStart(valid.roleDir, deps.now, input.session_id);
  const claim = (deps.claim || currentClaim)(actorOf(marker), bdOptionsFor(marker, input.cwd));
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
  // The role line repeats only when the claim changed since the last prompt; a claim note the last
  // turn missed (the Stop hook leaves it as a reminder rather than blocking) is said once.
  const lines = [];
  for (const name of [CLAIM_REMINDER, JUDGE_REMINDER, MESSAGE_REMINDER]) {
    const reminderFile = path.join(valid.roleDir, name);
    try { const r = fs.readFileSync(reminderFile, 'utf8').trim(); if (r) lines.push(r); fs.unlinkSync(reminderFile); } catch (err) { /* none */ }
  }
  const lastFile = path.join(valid.roleDir, LAST_CLAIM);
  let last = null;
  try { last = fs.readFileSync(lastFile, 'utf8'); } catch (err) { last = null; }
  if (last !== claimText) {
    lines.push(`You are ${marker.instance} (${marker.role}). Current claim: ${claimText}`);
    try { fs.writeFileSync(lastFile, claimText); } catch (err) { /* say it again next time */ }
  }
  if (note) lines.push(note);
  return lines.join('\n');
}

const CLAIM_REMINDER = '.delivery-claim-reminder';
// the typed judge's relay warning (below the block threshold), said once on the next prompt
const JUDGE_REMINDER = '.delivery-judge-reminder';
// the owner-message warnings (orders, length, ids, tone, unchecked claims) and the idle alarm, said once
const MESSAGE_REMINDER = '.delivery-message-reminder';
const LAST_CLAIM = '.delivery-last-claim';

module.exports = { CLAIM_REMINDER, JUDGE_REMINDER, MESSAGE_REMINDER, operatorCaptureNote, readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor, composeForMarker, currentClaim, sessionStartText, promptSubmitText, shortBrief };
