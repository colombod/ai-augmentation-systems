#!/usr/bin/env node
// team-role.js — the roster's one structured write: add a role to team.json.
//   node team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--project <root>] [--dry-run]
//
// team.json is a work recipe: it is changed through a command that validates it, never by a free-form
// edit (owner decision dec-chief-of-staff-000177). The role must be one the plugin ships (roles/<id>.md);
// a role already on the team is refused, so is a manifest the change would make invalid. The new entry
// takes the host most roles run on and the role's default model unless told otherwise, and the change is
// committed alone. Then `start.js` prepares the new role's directory.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, validateManifest, TEAM_REL, HOSTS_REL, MODELS } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');

function shippedRole(id) {
  const file = path.join(PLUGIN_ROOT, 'roles', `${id}.md`);
  if (!/^[a-z][a-z-]*$/.test(id) || !fs.existsSync(file)) return null;
  const m = /^default_model:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'));
  return { id, model: m ? m[1] : 'sonnet' };
}

function addRole(projectRoot, id, { host, model, dryRun } = {}) {
  const role = shippedRole(id);
  if (!role) {
    const known = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).map((f) => f.replace(/\.md$/, '')).join(', ');
    return { code: 1, out: `team-role: ${id} is not a role this plugin ships (${known})` };
  }
  const teamFile = path.join(projectRoot, TEAM_REL);
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  let hosts = null;
  try { hosts = JSON.parse(fs.readFileSync(path.join(projectRoot, HOSTS_REL), 'utf8')); } catch (e) { hosts = null; }
  const roles = Array.isArray(team.roles) ? team.roles : [];
  if (roles.some((r) => r && r.id === id && !r.retired)) return { code: 1, out: `team-role: ${id} is already on the team` };
  if (model && !MODELS.has(model)) return { code: 1, out: `team-role: --model must be one of ${[...MODELS].join(', ')}` };
  const counts = {};
  for (const r of roles) if (r && r.host) counts[r.host] = (counts[r.host] || 0) + 1;
  const chosenHost = host || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (!chosenHost) return { code: 1, out: 'team-role: no host to place the role on; pass --host <name>' };
  const entry = { id, brief: `delivery/${id}`, host: chosenHost, model: model || role.model };
  const next = { ...team, roles: [...roles, entry] };
  const problems = validateManifest(JSON.parse(JSON.stringify(next)), hosts);
  if (problems.length) return { code: 1, out: `team-role: the change would make team.json invalid:\n  ${problems.join('\n  ')}` };
  const line = `team-role: ${dryRun ? 'would add' : 'added'} ${id} on ${entry.host} (${entry.model})`;
  if (dryRun) return { code: 0, out: line };
  fs.writeFileSync(teamFile, `${JSON.stringify(next, null, 2)}\n`);
  try {
    execFileSync('git', ['-C', projectRoot, 'add', '--', TEAM_REL], { stdio: 'pipe' });
    execFileSync('git', ['-C', projectRoot, 'commit', '-q', '-m', `team: add the ${id} role (team-role.js)`, '--', TEAM_REL], { stdio: 'pipe' });
  } catch (err) {
    return { code: 1, out: `${line}, but the commit failed: ${String(err.stderr || err.message).trim().slice(0, 300)}` };
  }
  return { code: 0, out: `${line}; committed. Prepare its directory with start.js.` };
}

module.exports = { addRole, shippedRole };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const [verb, id] = argv;
  if (verb !== 'add' || !id || id.startsWith('-')) {
    process.stderr.write('usage: team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--project <root>] [--dry-run]\n');
    process.exit(2);
  }
  const root = opt('project') ? path.resolve(opt('project')) : findProjectRoot(process.cwd());
  if (!root || !fs.existsSync(path.join(root, TEAM_REL))) { process.stderr.write('team-role: no team.json found; pass --project <root>\n'); process.exit(1); }
  const r = addRole(root, id, { host: opt('host'), model: opt('model'), dryRun: argv.includes('--dry-run') });
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exit(r.code);
}
