// scripts/lib/manifest.js — project manifest: locate, load, validate, expand.
const fs = require('fs');
const path = require('path');

const MODELS = new Set(['opus', 'sonnet', 'haiku']);
const RUNNERS = new Set(['superpowers', 'attractor', 'plain']);
const MODES = new Set(['default', 'delegate']);
const NO_REACH = new Set(['chief-of-staff', 'product-manager', 'delivery-lead', 'staffing']);
// a manager by id or by brief: a custom id with a manager's brief is still a manager
const isManager = (role) => Boolean(role) && (NO_REACH.has(canonicalRoleId(role.id))
  || NO_REACH.has(canonicalRoleId(String(role.brief || '').replace(/^delivery\//, ''))));
// The reach a manifest entry grants (R-05): "local" (browser tools on local development hosts) for a
// non-manager with "reach": true, else none. The lane hook calls this on the live manifest, so a hand
// edit that gives a manager reach is ignored there too.
const reachOf = (role) => (role && role.reach === true && !isManager(role) ? 'local' : null);
const TEAM_REL = path.join('.delivery', 'team', 'team.json');
const HOSTS_REL = path.join('.delivery', 'team', 'hosts.json');

function findProjectRoot(startDir) {
  const override = process.env.DELIVERY_PROJECT_ROOT;
  if (override && fs.existsSync(path.join(override, TEAM_REL))) return override;
  let dir = path.resolve(startDir);
  // A role directory's marker names the original project checkout; prefer it over the role's own clone.
  for (let d = dir; ;) {
    const markerFile = path.join(d, '.delivery-role.json');
    if (fs.existsSync(markerFile)) {
      try {
        const root = JSON.parse(fs.readFileSync(markerFile, 'utf8')).project_root;
        if (typeof root === 'string' && fs.existsSync(path.join(root, TEAM_REL))) return root;
      } catch (err) { /* unreadable marker: fall through */ }
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (;;) {
    if (fs.existsSync(path.join(dir, TEAM_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(projectRoot, rel) {
  const file = path.join(projectRoot, rel);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`manifest: ${path.basename(file)}: not found at ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest: ${path.basename(file)}: invalid JSON (${err.message})`);
  }
}

const PLUGIN_ROOT = path.join(__dirname, '..', '..');

// The brief's own `default_model:` frontmatter, the fallback when a manifest role names no model.
function defaultModelFor(role, projectRoot) {
  const m = /^(delivery|project)\/([a-z0-9][a-z0-9-]*)$/.exec(String(role && role.brief || ''));
  if (!m) return null;
  const file = m[1] === 'delivery' ? path.join(PLUGIN_ROOT, 'roles', `${m[2]}.md`)
    : (projectRoot ? path.join(projectRoot, '.delivery', 'team', 'briefs', `${m[2]}.md`) : null);
  if (!file) return null;
  try {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
    const line = fm && fm[1].split(/\r?\n/).find((l) => /^default_model:/.test(l));
    const v = line ? line.slice('default_model:'.length).trim() : '';
    return v || null;
  } catch (err) { return null; }
}

// "Delivery Manager" is the display name of the role whose id stays delivery-lead (records, lanes and
// bead actors carry the id). Wherever a person types a role or instance id, delivery-manager works too.
function canonicalRoleId(id) {
  const m = /^delivery-manager(-\d+)?$/.exec(String(id || ''));
  return m ? `delivery-lead${m[1] || ''}` : id;
}
function normalizeAliases(team) {
  for (const role of (team && Array.isArray(team.roles) ? team.roles : [])) {
    if (!role || typeof role !== 'object') continue;
    if (role.id === 'delivery-manager') role.id = 'delivery-lead';
    if (role.brief === 'delivery/delivery-manager') role.brief = 'delivery/delivery-lead';
  }
  return team;
}

function loadManifest(projectRoot) {
  const team = normalizeAliases(readJson(projectRoot, TEAM_REL));
  if (team && Array.isArray(team.roles)) {
    for (const role of team.roles) {
      if (role && typeof role === 'object' && (role.model === undefined || role.model === null || role.model === '')) {
        const d = defaultModelFor(role, projectRoot);
        if (d) role.model = d;
      }
    }
  }
  return { team, hosts: readJson(projectRoot, HOSTS_REL) };
}

// Non-fatal notes: a model name Claude Code may not know is passed through as written.
function manifestWarnings(team) {
  const out = [];
  for (const role of (team && Array.isArray(team.roles) ? team.roles : [])) {
    const model = role && (role.model || defaultModelFor(role, null));
    if (typeof model === 'string' && model && !MODELS.has(model)) out.push(`team.json: role "${role.id}" has model "${model}", not one of ${[...MODELS].join(', ')}; it is passed to Claude Code as written`);
  }
  // the typed judge's block: unknown keys are ignored with a warning
  out.push(...require('./judge.js').configProblems(team && team.judge).warnings);
  // R-42: usage budget figures come only from the owner, on the goal sheet; one written here is ignored
  for (const k of ['weekly_units', 'usage_envelope', 'lean_at']) {
    if (team && team.budget && team.budget[k] !== undefined) out.push(`team.json: budget.${k} is ignored; the owner sets it: goal.js set budget.${k} <value> --record <dec-id>`);
  }
  return out;
}

function validateManifest(team, hosts) {
  normalizeAliases(team);
  const problems = [];
  const hostNames = new Set(Object.keys((hosts && hosts.hosts) || {}));
  const seen = new Set();
  const stewards = new Set();
  for (const field of ['project', 'prefix', 'bd_host']) {
    if (!team[field]) problems.push(`team.json: missing "${field}"`);
  }
  // the product's GitHub repository (owner/name), which start.js records and the merge gate reads
  if (team.product_github !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(team.product_github))) problems.push(`team.json: "product_github" must be owner/name, not "${String(team.product_github).slice(0, 80)}"`);
  if (!Array.isArray(team.roles) || team.roles.length === 0) {
    problems.push('team.json: "roles" must be a non-empty array');
    return problems;
  }
  for (const role of team.roles) {
    if (!role.id) { problems.push('team.json: role without "id"'); continue; }
    if (seen.has(role.id)) problems.push(`team.json: duplicate role id "${role.id}"`);
    seen.add(role.id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(role.id)) problems.push(`team.json: role id "${role.id}" must match ^[a-z0-9][a-z0-9-]*$`);
    if (!role.brief) problems.push(`team.json: role "${role.id}" has no "brief"`);
    else if (!/^(delivery|project)\/[a-z0-9][a-z0-9-]*$/.test(role.brief)) problems.push(`team.json: role "${role.id}" has invalid brief "${role.brief}"`);
    if (!hostNames.has(role.host)) problems.push(`team.json: role "${role.id}" has unknown host "${role.host}"`);
    // any non-empty model string is accepted (an unknown one is a warning, see manifestWarnings);
    // a role that names none falls back to its brief's default_model
    const model = role.model === undefined || role.model === null || role.model === '' ? defaultModelFor(role, null) : role.model;
    if (model === null && (role.model === undefined || role.model === null || role.model === '')) {
      if (!/^project\//.test(String(role.brief))) problems.push(`team.json: role "${role.id}" has no "model" and its brief declares no default_model`);
    } else if (typeof model !== 'string' || !model.trim()) problems.push(`team.json: role "${role.id}" has an invalid "model"; name a model such as ${[...MODELS].join(', ')}`);
    if (role.runner !== undefined && !RUNNERS.has(role.runner)) problems.push(`team.json: role "${role.id}" has runner "${role.runner}", expected one of ${[...RUNNERS].join(', ')}`);
    if (role.mode && !MODES.has(role.mode)) problems.push(`team.json: role "${role.id}" has mode "${role.mode}"`);
    if (role.count !== undefined && (!Number.isInteger(role.count) || role.count < 1)) problems.push(`team.json: role "${role.id}" has invalid count`);
    if (role.retired !== undefined && typeof role.retired !== 'boolean') problems.push(`team.json: role "${role.id}" has non-boolean "retired"`);
    // reach: browser, desktop and computer-use tools for a role whose brief does not have them (R-05).
    // Managers never drive the owner's apps; real-surface runs are the Reality Checker's.
    if (role.reach !== undefined && typeof role.reach !== 'boolean') problems.push(`team.json: role "${role.id}" has non-boolean "reach"`);
    else if (role.reach === true && isManager(role)) problems.push(`team.json: role "${role.id}" cannot have "reach": managers never drive the owner's apps; real-surface runs are the Reality Checker's`);
    if (role.steward) stewards.add(role.host);
  }
  problems.push(...require('./judge.js').configProblems(team.judge).problems);
  if (team.budget && team.budget.builders_cap !== undefined) {
    const builders = team.roles.filter((r) => r.id === 'builder').reduce((n, r) => n + (r.count || 1), 0);
    if (builders > team.budget.builders_cap) problems.push(`team.json: ${builders} builders exceed builders_cap ${team.budget.builders_cap}`);
  }
  // a steward converges a host's sessions; a team whose active roles are on one host needs none. The
  // count is of every active host, cloud included (a PC-plus-cloud team needs the PC steward); a cloud
  // host itself has no steward, and a retired role does not run, so its host does not count
  const activeHosts = [...new Set(team.roles.filter((r) => !r.retired).map((r) => r.host))].filter((h) => hostNames.has(h));
  const stewardHosts = activeHosts.filter((h) => hosts.hosts[h].kind !== 'cloud');
  for (const host of activeHosts.length > 1 ? stewardHosts : []) {
    if (!stewards.has(host)) {
      problems.push(`team.json: no steward for host "${host}"`);
    }
  }
  return problems;
}

function expandInstances(team) {
  const out = [];
  for (const role of team.roles) {
    if (role.count && role.count > 1) {
      for (let i = 1; i <= role.count; i++) out.push({ instance: `${role.id}-${i}`, role });
    } else {
      out.push({ instance: role.id, role });
    }
  }
  return out;
}

module.exports = { reachOf, isManager, canonicalRoleId, normalizeAliases, findProjectRoot, loadManifest, validateManifest, manifestWarnings, defaultModelFor, expandInstances, TEAM_REL, HOSTS_REL, MODELS, RUNNERS };
