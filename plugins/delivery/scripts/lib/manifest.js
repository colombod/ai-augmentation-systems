// scripts/lib/manifest.js — project manifest: locate, load, validate, expand.
const fs = require('fs');
const path = require('path');

const MODELS = new Set(['opus', 'sonnet', 'haiku']);
const MODES = new Set(['default', 'delegate']);
const TEAM_REL = path.join('.delivery', 'team', 'team.json');
const HOSTS_REL = path.join('.delivery', 'team', 'hosts.json');

function findProjectRoot(startDir) {
  const override = process.env.DELIVERY_PROJECT_ROOT;
  if (override && fs.existsSync(path.join(override, TEAM_REL))) return override;
  let dir = path.resolve(startDir);
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

function loadManifest(projectRoot) {
  return { team: readJson(projectRoot, TEAM_REL), hosts: readJson(projectRoot, HOSTS_REL) };
}

function validateManifest(team, hosts) {
  const problems = [];
  const hostNames = new Set(Object.keys((hosts && hosts.hosts) || {}));
  const seen = new Set();
  const stewards = new Set();
  for (const field of ['project', 'prefix', 'bd_host']) {
    if (!team[field]) problems.push(`team.json: missing "${field}"`);
  }
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
    if (!hostNames.has(role.host)) problems.push(`team.json: role "${role.id}" has unknown host "${role.host}"`);
    if (!MODELS.has(role.model)) problems.push(`team.json: role "${role.id}" has model "${role.model}", expected one of ${[...MODELS].join(', ')}`);
    if (role.mode && !MODES.has(role.mode)) problems.push(`team.json: role "${role.id}" has mode "${role.mode}"`);
    if (role.count !== undefined && (!Number.isInteger(role.count) || role.count < 1)) problems.push(`team.json: role "${role.id}" has invalid count`);
    if (role.steward) stewards.add(role.host);
  }
  if (team.budget && team.budget.builders_cap !== undefined) {
    const builders = team.roles.filter((r) => r.id === 'builder').reduce((n, r) => n + (r.count || 1), 0);
    if (builders > team.budget.builders_cap) problems.push(`team.json: ${builders} builders exceed builders_cap ${team.budget.builders_cap}`);
  }
  for (const host of new Set(team.roles.map((r) => r.host))) {
    if (hostNames.has(host) && hosts.hosts[host].kind !== 'cloud' && !stewards.has(host)) {
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

module.exports = { findProjectRoot, loadManifest, validateManifest, expandInstances, TEAM_REL, HOSTS_REL, MODELS };
