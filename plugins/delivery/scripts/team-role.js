#!/usr/bin/env node
// team-role.js — the roster's one structured write: add a role to team.json, size the builders.
//   node team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--project <root>] [--dry-run]
//   node team-role.js add builder --count <n> [--project <root>] [--dry-run]
//   node team-role.js set-cap builders <n> --record <dec-id> [--project <root>] [--dry-run]
//
// team.json is a work recipe: it is changed through a command that validates it, never by a free-form
// edit (owner decision dec-chief-of-staff-000177). The role must be one the plugin ships (roles/<id>.md);
// a role already on the team is refused, so is a manifest the change would make invalid. The new entry
// takes the host most roles run on and the role's default model unless told otherwise, and the change is
// committed alone. Then `start.js` prepares the new role's directory.
//
// The builders are one entry with a count (lib/manifest.js expands it to builder-1..n). `add builder
// --count <n>` sets that count, and refuses one above budget.builders_cap, naming the cap. The cap is the
// owner's to raise: `set-cap builders <n>` takes a decision record and writes the cap only when that
// record verifies as the owner's own decision (lib/gate-context.js ownerRecord), not revoked or superseded.
//
// Where it writes: in a role session (a directory holding .delivery-role.json), the role's own clone
// (<role dir>/project), never the shared checkout the marker and DELIVERY_PROJECT_ROOT name: every role
// writes its clone and the shared checkout is brought up to origin by the gates (lib/lane.js pathAllowed,
// roles/delivery-lead.md). The commit is then published like any plan change: push it to a branch
// (`git -C project push origin HEAD:staffing/add-<role>`) and the Delivery Manager merges it into the
// default branch, where git reconciles it with any other roster change. Outside a role session (the
// operator's own checkout) it writes the project found from the working directory, or --project.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, validateManifest, canonicalRoleId, TEAM_REL, HOSTS_REL, MODELS } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const USAGE = 'usage: team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--count <n>] [--project <root>] [--dry-run]\n'
  + '       team-role.js set-cap builders <n> --record <dec-id> [--project <root>] [--dry-run]';

function shippedRole(id) {
  const file = path.join(PLUGIN_ROOT, 'roles', `${id}.md`);
  if (!/^[a-z][a-z-]*$/.test(id) || !fs.existsSync(file)) return null;
  const m = /^default_model:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'));
  return { id, model: m ? m[1] : 'sonnet' };
}

// The role directory holding `dir`: the nearest ancestor with a role marker, or null.
function roleDirOf(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.delivery-role.json'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

// Where the roster change is written: a role's own clone, else the project found from `cwd`.
function writeRoot(cwd, { project } = {}) {
  if (project) return { root: path.resolve(project), clone: false };
  const rd = roleDirOf(cwd);
  if (rd) return { root: path.join(rd, 'project'), clone: true };
  return { root: findProjectRoot(cwd), clone: false };
}

// The shared project a role session belongs to, from its marker; null outside one.
function markerProject(cwd) {
  const rd = roleDirOf(cwd);
  if (!rd) return null;
  try { return JSON.parse(fs.readFileSync(path.join(rd, '.delivery-role.json'), 'utf8')).project_root || null; } catch (e) { return null; }
}

function readTeam(projectRoot) {
  const team = JSON.parse(fs.readFileSync(path.join(projectRoot, TEAM_REL), 'utf8'));
  let hosts = null;
  try { hosts = JSON.parse(fs.readFileSync(path.join(projectRoot, HOSTS_REL), 'utf8')); } catch (e) { hosts = null; }
  return { team, hosts, roles: Array.isArray(team.roles) ? team.roles : [] };
}

// Validate the changed manifest, then write and commit team.json alone: every verb ends here.
function writeTeam(projectRoot, next, hosts, { line, subject, branch, dryRun, clone }) {
  const problems = validateManifest(JSON.parse(JSON.stringify(next)), hosts);
  if (problems.length) return { code: 1, out: `team-role: the change would make team.json invalid:\n  ${problems.join('\n  ')}` };
  if (dryRun) return { code: 0, out: `team-role: would ${line}` };
  const done = `team-role: ${line.replace(/^(\w+)/, (v) => ({ add: 'added', set: 'set' }[v] || v))}`;
  fs.writeFileSync(path.join(projectRoot, TEAM_REL), `${JSON.stringify(next, null, 2)}\n`);
  try {
    execFileSync('git', ['-C', projectRoot, 'add', '--', TEAM_REL], { stdio: 'pipe' });
    execFileSync('git', ['-C', projectRoot, 'commit', '-q', '-m', `${subject} (team-role.js)`, '--', TEAM_REL], { stdio: 'pipe' });
  } catch (err) {
    return { code: 1, out: `${done}, but the commit failed: ${String(err.stderr || err.message).trim().slice(0, 300)}` };
  }
  if (clone) return { code: 0, out: `${done}; committed in your clone. Publish it: git -C ${projectRoot} push origin HEAD:staffing/${branch}, then message the Delivery Manager to merge it into the default branch; start.js prepares the role once it is there.` };
  return { code: 0, out: `${done}; committed. Prepare its directory with start.js.` };
}

const capOf = (team) => (team.budget && team.budget.builders_cap !== undefined ? team.budget.builders_cap : undefined);
const countArg = (count) => (Number.isInteger(Number(count)) && Number(count) >= 1 && /^\d+$/.test(String(count)) ? Number(count) : null);

function addRole(projectRoot, rawId, { host, model, count, dryRun, clone = false } = {}) {
  // delivery-manager is typed for delivery-lead wherever a role id is typed (lib/manifest.js)
  const id = canonicalRoleId(rawId);
  const role = shippedRole(id);
  if (!role) {
    const known = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).map((f) => f.replace(/\.md$/, '')).join(', ');
    return { code: 1, out: `team-role: ${id} is not a role this plugin ships (${known})` };
  }
  const { team, hosts, roles } = readTeam(projectRoot);
  if (count !== undefined) return setBuilderCount(projectRoot, id, count, { team, hosts, roles, host, model, role, dryRun, clone });
  if (roles.some((r) => r && r.id === id && !r.retired)) {
    const more = id === 'builder' ? '; more builders: team-role.js add builder --count <n>' : '';
    return { code: 1, out: `team-role: ${id} is already on the team${more}` };
  }
  if (model && !MODELS.has(model)) return { code: 1, out: `team-role: --model must be one of ${[...MODELS].join(', ')}` };
  const counts = {};
  // a retired role does not run, so its host does not vote (validateManifest counts active hosts alike)
  for (const r of roles) if (r && r.host && !r.retired) counts[r.host] = (counts[r.host] || 0) + 1;
  const chosenHost = host || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (!chosenHost) return { code: 1, out: 'team-role: no host to place the role on; pass --host <name>' };
  const entry = { id, brief: `delivery/${id}`, host: chosenHost, model: model || role.model };
  return writeTeam(projectRoot, { ...team, roles: [...roles, entry] }, hosts,
    { line: `add ${id} on ${entry.host} (${entry.model})`, subject: `team: add the ${id} role`, branch: `add-${id}`, dryRun, clone });
}

// add builder --count <n>: the builder entry's count, within budget.builders_cap
function setBuilderCount(projectRoot, id, rawCount, { team, hosts, roles, host, model, role, dryRun, clone }) {
  if (id !== 'builder') return { code: 1, out: `team-role: --count is for the builders only (team-role.js add builder --count <n>), not ${id}` };
  const n = countArg(rawCount);
  if (n === null) return { code: 1, out: `team-role: --count must be a whole number from 1, not ${rawCount}` };
  const cap = capOf(team);
  if (cap !== undefined && n > cap) return { code: 1, out: `team-role: ${n} builders is above builders_cap ${cap}; the owner raises it: team-role.js set-cap builders ${n} --record <dec-id>` };
  if (model && !MODELS.has(model)) return { code: 1, out: `team-role: --model must be one of ${[...MODELS].join(', ')}` };
  const at = roles.findIndex((r) => r && r.id === id && !r.retired);
  let next;
  if (at >= 0) {
    if ((roles[at].count || 1) === n) return { code: 1, out: `team-role: the team already has ${n} builder${n === 1 ? '' : 's'}` };
    const entry = { ...roles[at], count: n };
    if (host) entry.host = host;
    if (model) entry.model = model;
    next = { ...team, roles: roles.map((r, i) => (i === at ? entry : r)) };
  } else {
    const counts = {};
    for (const r of roles) if (r && r.host && !r.retired) counts[r.host] = (counts[r.host] || 0) + 1;
    const chosenHost = host || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!chosenHost) return { code: 1, out: 'team-role: no host to place the role on; pass --host <name>' };
    next = { ...team, roles: [...roles, { id, brief: `delivery/${id}`, host: chosenHost, model: model || role.model, count: n }] };
  }
  return writeTeam(projectRoot, next, hosts, { line: `set builder count to ${n}`, subject: `team: ${n} builders`, branch: `builders-${n}`, dryRun, clone });
}

// Why `record` cannot raise the cap, or null: it must verify, stand, and be the owner's own decision.
function capRecordProblem(root, record, verifyRecord) {
  if (!/^dec-/.test(String(record || ''))) return 'the cap changes only on an owner decision record: --record <dec-id>';
  let v;
  try { v = (verifyRecord || require('./lib/operator-records.js').verifyRecord)(root, record); } catch (err) { v = null; }
  if (!v || !v.ok) return `${record} does not verify (${v ? v.code || v.error : 'no result'})`;
  if ((v.notes || []).some((x) => /revoked|superseded/.test(x))) return `${record} was revoked or superseded`;
  const owner = require('./lib/gate-context.js').ownerRecord(root, record, () => v);
  if (!owner.ok) return owner.why;
  if (owner.head.kind !== 'decision') return `${record} is not an owner decision`;
  // The authority is the owner's input (ownerRecord); this only checks the decision is about the builders,
  // so an unrelated decision (say, on how team.json is edited) cannot raise the cap. The scope label is the
  // precise form; a decision whose words name the builders also counts, as dec-chief-of-staff-000215 does.
  const labels = (owner.head.scope && owner.head.scope.labels) || [];
  const words = [owner.head.statement, owner.text].filter(Boolean).join(' ');
  if (!labels.includes('budget:builders_cap') && !/\bbuilders?\b/i.test(words)) return `${record} is not about the builders (no budget:builders_cap scope, and its words do not name builders)`;
  return null;
}

// recordRoot: where the operator records live. In a role session that is the shared project the role
// marker names, not the role's clone: the clone holds team.json but not the operator store.
function setCap(projectRoot, what, rawN, { record, verifyRecord, recordRoot, dryRun, clone = false } = {}) {
  if (what !== 'builders') return { code: 1, out: `team-role: set-cap takes builders, not ${what}` };
  const n = countArg(rawN);
  if (n === null) return { code: 1, out: `team-role: the cap must be a whole number from 1, not ${rawN}` };
  const why = capRecordProblem(recordRoot || projectRoot, record, verifyRecord);
  if (why) return { code: 1, out: `team-role: builders_cap stays as it is: ${why}` };
  const { team, hosts } = readTeam(projectRoot);
  if (capOf(team) === n) return { code: 1, out: `team-role: builders_cap is already ${n}` };
  return writeTeam(projectRoot, { ...team, budget: { ...(team.budget || {}), builders_cap: n } }, hosts,
    { line: `set builders_cap to ${n} under ${record}`, subject: `team: builders_cap ${n} under ${record}`, branch: `builders-cap-${n}`, dryRun, clone });
}

module.exports = { addRole, setCap, shippedRole, writeRoot, roleDirOf };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const [verb, a1, a2] = argv;
  const usable = (verb === 'add' && a1 && !a1.startsWith('-')) || (verb === 'set-cap' && a1 && a2 !== undefined && !a1.startsWith('-') && !a2.startsWith('-'));
  if (!usable) { process.stderr.write(`${USAGE}\n`); process.exit(2); }
  const { root, clone } = writeRoot(process.cwd(), { project: opt('project') });
  if (!root || !fs.existsSync(path.join(root, TEAM_REL))) { process.stderr.write(`team-role: no team.json found${clone ? ` in your clone (${root}); prepare-role makes it` : '; pass --project <root>'}\n`); process.exit(1); }
  const dryRun = argv.includes('--dry-run');
  const r = verb === 'add'
    ? addRole(root, a1, { host: opt('host'), model: opt('model'), count: argv.includes('--count') ? (opt('count') ?? '') : undefined, dryRun, clone })
    : setCap(root, a1, a2, { record: opt('record'), recordRoot: clone ? markerProject(process.cwd()) : root, dryRun, clone });
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exit(r.code);
}
