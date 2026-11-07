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
// The file a brief names: delivery/<x> is the plugin's roles/<x>.md, project/<x> the project's
// .delivery/team/briefs/<x>.md; null for a malformed brief (or a project brief without a project).
function briefFile(brief, projectRoot) {
  const m = /^(delivery|project)\/([a-z0-9][a-z0-9-]*)$/.exec(String(brief || ''));
  if (!m) return null;
  return m[1] === 'delivery' ? path.join(PLUGIN_ROOT, 'roles', `${m[2]}.md`)
    : (projectRoot ? path.join(projectRoot, '.delivery', 'team', 'briefs', `${m[2]}.md`) : null);
}
const briefExists = (brief, projectRoot) => { const f = briefFile(brief, projectRoot); return Boolean(f) && fs.existsSync(f); };
// Every brief a role entry may name: the plugin's roles and the project's own briefs.
function knownBriefs(projectRoot) {
  const ls = (dir, prefix) => { try { return fs.readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/.test(f)).map((f) => `${prefix}/${f.slice(0, -3)}`).sort(); } catch (e) { return []; } };
  return [...ls(path.join(PLUGIN_ROOT, 'roles'), 'delivery'), ...(projectRoot ? ls(path.join(projectRoot, '.delivery', 'team', 'briefs'), 'project') : [])];
}

function defaultModelFor(role, projectRoot) {
  const file = briefFile(role && role.brief, projectRoot);
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
  if (team.permission_mode !== undefined && !['default', 'acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'].includes(team.permission_mode)) problems.push(`team.json: "permission_mode" must be a Claude Code permission mode (auto, acceptEdits, default, ...), not "${String(team.permission_mode).slice(0, 40)}"`);
  if (team.wake_fresh_above_tokens !== undefined && !(Number.isInteger(team.wake_fresh_above_tokens) && team.wake_fresh_above_tokens >= 0)) problems.push('team.json: "wake_fresh_above_tokens" must be a whole number of tokens (0: never start a fresh session)');
  // the command that runs the product's tests from its checkout root (review-run.js), any language
  if (team.test_command !== undefined && (typeof team.test_command !== 'string' || !team.test_command.trim() || /[\r\n]/.test(team.test_command))) problems.push('team.json: "test_command" must be one line of shell, the command CI runs from the repository root');
  if (team.test_timeout_minutes !== undefined && !(Number.isFinite(team.test_timeout_minutes) && team.test_timeout_minutes > 0)) problems.push('team.json: "test_timeout_minutes" must be a positive number');
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
    if (role.instances !== undefined) {
      // each entry a name, or { "id", "retired"?, "model"? } so one instance can be retired or run
      // another model while its siblings keep running
      const list = role.instances;
      const shape = new RegExp(`^${role.id}(?:-[1-9][0-9]*)?$`);
      const okEntry = (x) => (typeof x === 'string' ? shape.test(x)
        : Boolean(x) && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && shape.test(x.id) && Object.keys(x).every((k) => INSTANCE_KEYS.includes(k)));
      const names = Array.isArray(list) ? list.map(instanceId) : [];
      if (!Array.isArray(list) || !list.length || !list.every(okEntry)) problems.push(`team.json: role "${role.id}" has invalid "instances": a list of names or {"id", "retired"?, "model"?}, each id "${role.id}" or "${role.id}-<n>"`);
      else if (new Set(names).size !== names.length) problems.push(`team.json: role "${role.id}" lists an instance twice`);
      else if (role.count !== undefined && role.count !== names.length) problems.push(`team.json: role "${role.id}" has count ${role.count} but ${names.length} instances`);
      for (const x of Array.isArray(list) ? list.filter((y) => y && typeof y === 'object' && !Array.isArray(y)) : []) {
        if (x.retired !== undefined && typeof x.retired !== 'boolean') problems.push(`team.json: instance "${x.id}" has non-boolean "retired"`);
        if (x.model !== undefined && (typeof x.model !== 'string' || !x.model.trim())) problems.push(`team.json: instance "${x.id}" has an invalid "model"; name a model such as ${[...MODELS].join(', ')}`);
      }
    }
    if (role.retired !== undefined && typeof role.retired !== 'boolean') problems.push(`team.json: role "${role.id}" has non-boolean "retired"`);
    // reach: browser, desktop and computer-use tools for a role whose brief does not have them (R-05).
    // Managers never drive the owner's apps; real-surface runs are the Reality Checker's.
    if (role.reach !== undefined && typeof role.reach !== 'boolean') problems.push(`team.json: role "${role.id}" has non-boolean "reach"`);
    else if (role.reach === true && isManager(role)) problems.push(`team.json: role "${role.id}" cannot have "reach": managers never drive the owner's apps; real-surface runs are the Reality Checker's`);
    // permissions: native allow rules the owner approved for this role, each citing its record;
    // prepare-role writes one only while that record verifies (8l1.3.4.1.1)
    if (role.permissions !== undefined) {
      const ok = (p) => Boolean(p) && typeof p === 'object' && !Array.isArray(p) && typeof p.allow === 'string' && p.allow.trim()
        && typeof p.record === 'string' && /^(dec|ans)-.+-\d{6,}$/.test(p.record) && Object.keys(p).every((k) => ['allow', 'record'].includes(k));
      if (!Array.isArray(role.permissions) || !role.permissions.every(ok)) problems.push(`team.json: role "${role.id}" has invalid "permissions": a list of {"allow": "<permission rule>", "record": "<dec- or ans- record id>"}`);
      else for (const p of role.permissions) {
        const why = permissionRuleProblem(p.allow);
        if (why) problems.push(`team.json: role "${role.id}" permission rule ${p.allow} is refused: ${why}`);
      }
    }
    if (role.steward) stewards.add(role.host);
  }
  // an instance id names one session, its branch and its records: never two in the whole team
  const owners = new Map();
  for (const role of team.roles) {
    if (!role || !role.id) continue;
    let names;
    try { names = instanceNames(role); } catch (e) { names = []; }
    for (const n of new Set(names)) {
      if (owners.has(n) && owners.get(n) !== role.id) problems.push(`team.json: instance id "${n}" is used by both "${owners.get(n)}" and "${role.id}"`);
      else owners.set(n, role.id);
    }
  }
  problems.push(...require('./judge.js').configProblems(team.judge).problems);
  if (team.budget && team.budget.builders_cap !== undefined) {
    // a retired builder does not run, so it does not count
    const builders = team.roles.filter((r) => r.id === 'builder').reduce((n, r) => n + liveInstanceNames(r).length, 0);
    if (builders > team.budget.builders_cap) problems.push(`team.json: ${builders} builders exceed builders_cap ${team.budget.builders_cap}`);
  }
  // a steward converges a host's sessions; a team whose active roles are on one host needs none. The
  // count is of every active host, cloud included (a PC-plus-cloud team needs the PC steward); a cloud
  // host itself has no steward, and a retired role does not run, so its host does not count
  const activeHosts = [...new Set(team.roles.filter((r) => !roleRetired(r)).map((r) => r.host))].filter((h) => hostNames.has(h));
  const stewardHosts = activeHosts.filter((h) => hosts.hosts[h].kind !== 'cloud');
  for (const host of activeHosts.length > 1 ? stewardHosts : []) {
    if (!stewards.has(host)) {
      problems.push(`team.json: no steward for host "${host}"`);
    }
  }
  return problems;
}

// Instance names: a role's `instances` list when it has one, else <id>-1..<id>-n for a count above one,
// else the bare id. The list exists so a role can grow without renaming a live instance: claims, pull
// requests, branches (team/<instance>) and role directories are all keyed by the instance name, so the
// builder that was "builder" stays "builder" when builder-2 joins (team-role.js writes the list).
// An entry of `instances` is a name or { id, retired?, model? }.
const INSTANCE_KEYS = ['id', 'retired', 'model'];
const instanceId = (x) => (x && typeof x === 'object' ? x.id : x);
function instanceNames(role) {
  if (Array.isArray(role.instances) && role.instances.length) return role.instances.map(instanceId);
  if (role.count && role.count > 1) return Array.from({ length: role.count }, (_, i) => `${role.id}-${i + 1}`);
  return [role.id];
}

// The role each instance runs as: the entry, with the instance's own `retired` and `model` laid over
// it, so a retired builder-2 is retired everywhere a reader checks role.retired and builder stays live.
function expandInstances(team) {
  const out = [];
  for (const role of team.roles) {
    const objs = new Map((Array.isArray(role.instances) ? role.instances : []).filter((x) => x && typeof x === 'object').map((x) => [x.id, x]));
    for (const instance of instanceNames(role)) {
      const x = objs.get(instance);
      const own = x && (x.retired === true || (typeof x.model === 'string' && x.model));
      out.push({ instance, role: own ? { ...role, ...(x.model ? { model: x.model } : {}), ...(x.retired === true ? { retired: true } : {}) } : role });
    }
  }
  return out;
}
// The instances of one role entry that run (none for a retired entry).
const liveInstanceNames = (role) => expandInstances({ roles: [role] }).filter((i) => !i.role.retired).map((i) => i.instance);
// A role entry is retired when it says so, or when every one of its instances is.
const roleRetired = (role) => Boolean(role) && (role.retired === true || liveInstanceNames(role).length === 0);

// An owner-approved allow rule must name one specific command, never a whole tool or a whole program:
// "Bash(gh pr close:*)" or "Bash(gh pr close 136)", never "Bash", "Bash(*)", "Bash(git:*)", "Write" or
// "mcp__*". A record approves one command for one role, so a broad rule would grant what nobody approved
// (PR 184 review). Returns why the rule is refused, or null.
function permissionRuleProblem(allow) {
  const m = /^Bash\((.*)\)$/s.exec(String(allow || '').trim());
  if (!m) return 'only a Bash rule for a specific command is accepted, as Bash(<command> <subcommand>:*)';
  const cmd = m[1].replace(/:\*$/, '').trim();
  if (!cmd || /[*?\[\]{}]/.test(cmd)) return 'the command must be spelled out, with no wildcard but a trailing :*';
  if (/[;&|`$<>()\\\n'"]/.test(cmd)) return 'the command may not hold shell operators, quotes or substitutions';
  if (cmd.split(/\s+/).length < 2) return 'it must name a command and its subcommand (Bash(gh pr close:*)), not a whole program';
  return null;
}

module.exports = { permissionRuleProblem, reachOf, isManager, canonicalRoleId, normalizeAliases, findProjectRoot, loadManifest, validateManifest, manifestWarnings, defaultModelFor, briefFile, briefExists, knownBriefs, expandInstances, instanceNames, instanceId, liveInstanceNames, roleRetired, TEAM_REL, HOSTS_REL, MODELS, RUNNERS };
