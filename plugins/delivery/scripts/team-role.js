#!/usr/bin/env node
// team-role.js — the roster's one structured write: the roles and instances in team.json, and the hosts
// in hosts.json.
//   node team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--brief <b>] [--project <root>] [--dry-run]
//   node team-role.js add <role-id> --instance <id> [--model <m>]     one more instance of a role on the team
//   node team-role.js add builder --count <n>                          how many builders run
//   node team-role.js change <instance> [--model <m>] [--host <h>] [--brief <b>] [--retired true|false]
//   node team-role.js remove <instance>                                retire it (it stays in team.json)
//   node team-role.js host add <name> --kind pc|ssh|cloud --bd native|wrapper|remote --headless true|false --desktop-apps true|false
//   node team-role.js host change <name> [--kind ..] [--bd ..] [--headless ..] [--desktop-apps ..]
//   node team-role.js host remove <name>
//   node team-role.js set-cap builders <n> --record <dec-id> [--project <root>] [--dry-run]
//
// team.json is a work recipe: it is changed through a command that validates it, never by a free-form
// edit (owner decision dec-chief-of-staff-000177), and the lane hook refuses every other write to
// team.json and hosts.json (hooks/scripts/lane.js manifestFiles). Each verb checks what it is given before
// it writes (an unknown host or brief file, a taken id, a missing model, the builders cap), and a refusal
// exits 1 with one line that starts with the offending field; the file is not touched. The whole manifest
// is then checked with validateManifest, and the one changed file is committed alone. The read, check and
// write run under a lock, so two changes at once both land, one after the other.
//
// Instances are never deleted: their names key claims, branches, role directories and operator records,
// and a record whose instance left team.json stops verifying (lib/operator-records.js). `remove` sets
// "retired": true, `change <instance> --retired false` brings it back, and an id a retired instance holds
// is not given out again. A role entry the command changes is written with an `instances` list of
// objects ({ "id", "retired"?, "model"? }, lib/manifest.js expandInstances) keeping the names a `count`
// gave it, and no `count`. Host and brief belong to the role entry, so they change for all its instances.
// A host is the exception to "never deleted": no record names one, so `host remove` deletes it, but not
// while any role entry (a retired one included) still names it.
//
// The builders are one entry with the list of its instances (lib/manifest.js instanceNames). `add builder
// --count <n>` sets how many run without renaming a live instance: the existing names stay, new ones take
// the next free builder-<k>, and a lower count retires the newest. It refuses a count above
// budget.builders_cap, naming the cap. The cap is the
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
const { findProjectRoot, validateManifest, canonicalRoleId, instanceNames, expandInstances, roleRetired, briefExists, knownBriefs, defaultModelFor, TEAM_REL, HOSTS_REL, MODELS } = require('./lib/manifest.js');
const { withLock } = require('./lib/lock.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const USAGE = 'usage: team-role.js add <role-id> [--host <name>] [--model opus|sonnet|haiku] [--brief <b>] [--instance <id>] [--count <n>] [--project <root>] [--dry-run]\n'
  + '       team-role.js change <instance> [--model <m>] [--host <h>] [--brief <b>] [--retired true|false] [--project <root>] [--dry-run]\n'
  + '       team-role.js remove <instance> [--project <root>] [--dry-run]\n'
  + '       team-role.js host add|change|remove <name> [--kind pc|ssh|cloud] [--bd native|wrapper|remote] [--headless true|false] [--desktop-apps true|false] [--project <root>] [--dry-run]\n'
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

// The instances as team-status.js lists them: instance, role, host, model, and retired or active.
function instancesTable(team) {
  const rows = expandInstances(team).map(({ instance, role }) => `| ${instance} | ${role.id} | ${role.host} | ${role.model} | ${role.retired ? 'retired' : 'active'} |`);
  return ['| Instance | Role | Host | Model | State |', '|---|---|---|---|---|', ...rows].join('\n');
}

// Validate the changed manifest, then write and commit the one file changed (team.json, or hosts.json for
// a host verb) alone: every verb ends here. `line` holds one line per change.
const PAST = { add: 'added', set: 'set', change: 'changed', retire: 'retired', remove: 'removed', bring: 'brought' };
function writeManifest(projectRoot, { team, hosts, rel = TEAM_REL }, { line, subject, branch, dryRun, clone }) {
  const file = path.basename(rel);
  const problems = validateManifest(JSON.parse(JSON.stringify(team)), hosts);
  if (problems.length) return { code: 1, out: `team-role: the change would make ${file} invalid:\n  ${problems.join('\n  ')}` };
  if (dryRun) return { code: 0, out: line.split('\n').map((l) => `team-role: would ${l}`).join('\n') };
  const done = line.split('\n').map((l) => `team-role: ${l.replace(/^(\w+)/, (v) => PAST[v] || v)}`).join('\n');
  fs.writeFileSync(path.join(projectRoot, rel), `${JSON.stringify(rel === TEAM_REL ? team : hosts, null, 2)}\n`);
  try {
    execFileSync('git', ['-C', projectRoot, 'add', '--', rel], { stdio: 'pipe' });
    execFileSync('git', ['-C', projectRoot, 'commit', '-q', '-m', `${subject} (team-role.js)`, '--', rel], { stdio: 'pipe' });
  } catch (err) {
    return { code: 1, out: `${done}, but the commit failed: ${String(err.stderr || err.message).trim().slice(0, 300)}` };
  }
  const listing = rel === TEAM_REL ? `\n${instancesTable(team)}` : `\nhosts: ${Object.keys(hosts.hosts).join(', ')}`;
  if (clone) return { code: 0, out: `${done}; committed in your clone. Publish it: git -C ${projectRoot} push origin HEAD:staffing/${branch}, then message the Delivery Manager to merge it into the default branch; start.js prepares the role once it is there.${listing}` };
  return { code: 0, out: `${done}; committed. Prepare its directory with start.js.${listing}` };
}
const writeTeam = (projectRoot, next, hosts, o) => writeManifest(projectRoot, { team: next, hosts }, o);

// The read, check and write of one change, under a lock beside team.json: a second change waits for the
// first, then reads what it wrote.
function locked(projectRoot, fn) {
  try {
    return withLock(path.join(projectRoot, path.dirname(TEAM_REL), '.team-role.lock'), fn, { strict: true, waitMs: 30000, staleMs: 60000 });
  } catch (err) { return { code: 1, out: `team-role: ${err.message}` }; }
}

// A refusal: one line that starts with the field it is about.
const refuse = (field, why) => ({ code: 1, out: `team-role: ${field}: ${why}` });
const hostNames = (hosts) => Object.keys((hosts && hosts.hosts) || {});
function hostProblem(hosts, host) {
  if (host === undefined || hostNames(hosts).includes(host)) return null;
  return refuse('host', `unknown host "${host}"; valid hosts: ${hostNames(hosts).join(', ') || 'none (team-role.js host add <name> ...)'}`);
}
function briefProblem(projectRoot, brief) {
  if (brief === undefined || briefExists(brief, projectRoot)) return null;
  return refuse('brief', `unknown brief "${brief}" (no brief file for it); valid briefs: ${knownBriefs(projectRoot).join(', ')}`);
}
function modelProblem(model) {
  if (model === undefined) return null;
  if (model === null || model === '') return refuse('model', `missing: --model needs one of ${[...MODELS].join(', ')}`);
  return MODELS.has(model) ? null : refuse('model', `--model must be one of ${[...MODELS].join(', ')}, not "${model}"`);
}
// Every id the team uses, role ids and instance ids, retired ones included.
function idsInUse(roles) {
  const out = new Set();
  for (const r of roles) if (r && r.id) { out.add(r.id); for (const n of instanceNames(r)) out.add(n); }
  return out;
}
const isRetiredId = (team, id) => expandInstances(team).some((i) => i.instance === id && i.role.retired);
const takenWhy = (team, id) => `${id} is already on the team${isRetiredId(team, id) ? ` (retired; bring it back: team-role.js change ${id} --retired false)` : ''}`;
// A role entry's instances as objects ({ id, retired?, model? }), keeping the names a count gave it.
function entriesOf(role) {
  const objs = new Map((Array.isArray(role.instances) ? role.instances : []).filter((x) => x && typeof x === 'object').map((x) => [x.id, x]));
  return instanceNames(role).map((id) => ({ ...(objs.get(id) || {}), id }));
}
// The role entry with these instances and no count; a lone plain instance named after the role is the
// plain entry again.
function withEntries(role, entries) {
  const { count, instances, ...rest } = role;
  if (entries.length === 1 && entries[0].id === role.id && Object.keys(entries[0]).length === 1) return rest;
  return { ...rest, instances: entries };
}

const capOf = (team) => (team.budget && team.budget.builders_cap !== undefined ? team.budget.builders_cap : undefined);
const countArg = (count) => (Number.isInteger(Number(count)) && Number(count) >= 1 && /^\d+$/.test(String(count)) ? Number(count) : null);
function capProblem(team, n) {
  const cap = capOf(team);
  if (cap === undefined || n <= cap) return null;
  return refuse('builders_cap', `${n} builders is above builders_cap ${cap}; the owner raises it: team-role.js set-cap builders ${n} --record <dec-id>`);
}

function addRole(projectRoot, rawId, { host, model, count, brief, instance, dryRun, clone = false } = {}) {
  // delivery-manager is typed for delivery-lead wherever a role id is typed (lib/manifest.js)
  const id = canonicalRoleId(rawId);
  const { team, hosts, roles } = readTeam(projectRoot);
  const bad = modelProblem(model) || hostProblem(hosts, host) || briefProblem(projectRoot, brief);
  if (bad) return bad;
  if (instance !== undefined) return addInstance(projectRoot, id, instance, { team, hosts, roles, model, dryRun, clone });
  const role = brief ? { id, model: defaultModelFor({ brief }, projectRoot) } : shippedRole(id);
  if (!role) {
    const known = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).map((f) => f.replace(/\.md$/, '')).join(', ');
    return { code: 1, out: `team-role: ${id} is not a role this plugin ships (${known}); a role with a project brief: team-role.js add ${id} --brief project/<name>` };
  }
  if (count !== undefined) return setBuilderCount(projectRoot, id, count, { team, hosts, roles, host, model, role, dryRun, clone });
  if (idsInUse(roles).has(id)) return refuse('id', `${takenWhy(team, id)}${id === 'builder' ? '; more builders: team-role.js add builder --instance builder-<n>, or --count <n>' : ''}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return refuse('id', `"${id}" must match ^[a-z0-9][a-z0-9-]*$`);
  if (!(model || role.model)) return refuse('model', `missing: ${brief} declares no default_model; pass --model ${[...MODELS].join('|')}`);
  const counts = {};
  // a retired role does not run, so its host does not vote (validateManifest counts active hosts alike)
  for (const r of roles) if (r && r.host && !roleRetired(r)) counts[r.host] = (counts[r.host] || 0) + 1;
  const chosenHost = host || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (!chosenHost) return { code: 1, out: 'team-role: no host to place the role on; pass --host <name>' };
  const entry = { id, brief: brief || `delivery/${id}`, host: chosenHost, model: model || role.model };
  return writeTeam(projectRoot, { ...team, roles: [...roles, entry] }, hosts,
    { line: `add ${id} on ${entry.host} (${entry.model})`, subject: `team: add the ${id} role`, branch: `add-${id}`, dryRun, clone });
}

// add <role> --instance <id>: one more instance of a role already on the team; the ones it has keep their
// names. An id the team already uses, a retired instance's included, is refused.
function addInstance(projectRoot, id, inst, { team, hosts, roles, model, dryRun, clone }) {
  const at = roles.findIndex((r) => r && r.id === id);
  if (at < 0) return refuse('id', `${id} is not on the team; add the role first: team-role.js add ${id}`);
  if (idsInUse(roles).has(inst)) return refuse('id', takenWhy(team, inst));
  if (!new RegExp(`^${id}(?:-[1-9][0-9]*)?$`).test(String(inst))) return refuse('id', `"${inst}" is not an instance name for ${id}: use ${id}-<n>`);
  const entries = [...entriesOf(roles[at]), { id: inst, ...(model ? { model } : {}) }];
  const cap = id === 'builder' ? capProblem(team, entries.filter((e) => !e.retired).length) : null;
  if (cap) return cap;
  const next = { ...team, roles: roles.map((r, i) => (i === at ? withEntries(r, entries) : r)) };
  return writeTeam(projectRoot, next, hosts, { line: `add ${inst} to ${id}${model ? ` (${model})` : ''}`, subject: `team: add ${inst}`, branch: `add-${inst}`, dryRun, clone });
}

// change <instance>: its model, and whether it is retired, on the instance itself; host and brief on its
// role entry, so for every instance of it.
function changeInstance(projectRoot, inst, { model, host, brief, retired, dryRun, clone = false } = {}) {
  const { team, hosts, roles } = readTeam(projectRoot);
  const bad = modelProblem(model) || hostProblem(hosts, host) || briefProblem(projectRoot, brief);
  if (bad) return bad;
  if (retired !== undefined && !['true', 'false'].includes(String(retired))) return refuse('retired', `--retired must be true or false, not "${retired}"`);
  const at = roles.findIndex((r) => r && instanceNames(r).includes(inst));
  if (at < 0) return refuse('id', `no instance ${inst} on the team (${expandInstances(team).map((i) => i.instance).join(', ')})`);
  if ([model, host, brief, retired].every((v) => v === undefined)) return { code: 2, out: USAGE };
  const role = roles[at];
  const now = expandInstances({ roles: [role] }).find((i) => i.instance === inst).role;
  const want = retired === undefined ? undefined : String(retired) === 'true';
  const plain = !Array.isArray(role.instances) && instanceNames(role).length === 1;
  const all = plain ? '' : ` (every instance of ${role.id})`;
  const lines = [];
  let entry = { ...role };
  if (host !== undefined && host !== role.host) { entry.host = host; lines.push(`change ${inst} host ${role.host} -> ${host}${all}`); }
  if (brief !== undefined && brief !== role.brief) { entry.brief = brief; lines.push(`change ${inst} brief ${role.brief} -> ${brief}${all}`); }
  // the instance's own fields: on the entry itself when it is the role's only, plain instance
  const own = (x, was) => {
    if (model !== undefined && model !== now.model) { x.model = model; lines.push(`change ${inst} model ${now.model} -> ${model}`); }
    if (want !== undefined && want !== Boolean(was)) {
      if (want) x.retired = true; else delete x.retired;
      lines.push(want ? `retire ${inst} (it stays in team.json so its records verify; bring it back: team-role.js change ${inst} --retired false)` : `bring ${inst} back`);
    }
    return x;
  };
  if (plain) entry = own(entry, role.retired);
  else {
    const entries = entriesOf(role).map((e) => (e.id === inst ? own({ ...e }, e.retired) : e));
    const cap = role.id === 'builder' && want === false ? capProblem(team, entries.filter((e) => !e.retired).length) : null;
    if (cap) return cap;
    entry = withEntries(entry, entries);
  }
  if (!lines.length) return { code: 1, out: `team-role: ${inst} already is as asked; nothing to change` };
  const next = { ...team, roles: roles.map((r, i) => (i === at ? entry : r)) };
  return writeTeam(projectRoot, next, hosts, { line: lines.join('\n'), subject: `team: change ${inst}`, branch: `change-${inst}`, dryRun, clone });
}

// remove <instance>: retire it; nothing is deleted.
function removeInstance(projectRoot, inst, { dryRun, clone = false } = {}) {
  if (isRetiredId(readTeam(projectRoot).team, inst)) return { code: 1, out: `team-role: ${inst} is already retired; it stays in team.json so its records verify` };
  return changeInstance(projectRoot, inst, { retired: 'true', dryRun, clone });
}

// hosts.json: the fields every host has, and the values each takes
const HOST_FIELDS = { kind: ['pc', 'ssh', 'cloud'], bd: ['native', 'wrapper', 'remote'], headless: ['true', 'false'], desktop_apps: ['true', 'false'] };
const flagOf = (k) => `--${k.replace(/_/g, '-')}`;
const typed = (k, v) => (k === 'headless' || k === 'desktop_apps' ? String(v) === 'true' : String(v));
function hostVerb(projectRoot, verb, name, fields = {}, { dryRun, clone = false } = {}) {
  const { team, hosts: read } = readTeam(projectRoot);
  const hosts = read && read.hosts && typeof read.hosts === 'object' ? read : { hosts: {} };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name || ''))) return refuse('host', `"${name}" is not a host name (letters, digits, dot, dash, underscore)`);
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && !HOST_FIELDS[k].includes(String(v))) return refuse(k, `${v === '' ? 'missing: ' : ''}${flagOf(k)} must be one of ${HOST_FIELDS[k].join(', ')}${v === '' ? '' : `, not "${v}"`}`);
  }
  const exists = Object.prototype.hasOwnProperty.call(hosts.hosts, name);
  let next;
  let line;
  if (verb === 'add') {
    if (exists) return refuse('host', `${name} is already in hosts.json; change it: team-role.js host change ${name} ...`);
    const missing = Object.keys(HOST_FIELDS).filter((k) => fields[k] === undefined);
    if (missing.length) return refuse(missing[0], `missing: host add needs ${missing.map((k) => `${flagOf(k)} ${HOST_FIELDS[k].join('|')}`).join(', ')}`);
    next = { ...hosts, hosts: { ...hosts.hosts, [name]: Object.fromEntries(Object.keys(HOST_FIELDS).map((k) => [k, typed(k, fields[k])])) } };
    line = `add host ${name} (${Object.keys(HOST_FIELDS).map((k) => `${k} ${fields[k]}`).join(', ')})`;
  } else if (!exists) {
    return refuse('host', `unknown host "${name}"; valid hosts: ${hostNames(hosts).join(', ') || 'none'}`);
  } else if (verb === 'change') {
    const given = Object.keys(HOST_FIELDS).filter((k) => fields[k] !== undefined && typed(k, fields[k]) !== hosts.hosts[name][k]);
    if (!given.length) return { code: 1, out: `team-role: host ${name} already is as asked; nothing to change` };
    next = { ...hosts, hosts: { ...hosts.hosts, [name]: { ...hosts.hosts[name], ...Object.fromEntries(given.map((k) => [k, typed(k, fields[k])])) } } };
    line = given.map((k) => `change host ${name} ${k} ${hosts.hosts[name][k]} -> ${fields[k]}`).join('\n');
  } else {
    // a role entry naming it, a retired one included, would make team.json invalid at the next load
    const users = (Array.isArray(team.roles) ? team.roles : []).filter((r) => r && r.host === name).map((r) => `${r.id}${roleRetired(r) ? ' (retired)' : ''}`);
    if (users.length) return refuse('host', `${name} is still named by role ${users.join(', ')}; move them first: team-role.js change <instance> --host <other>`);
    const { [name]: gone, ...rest } = hosts.hosts;
    next = { ...hosts, hosts: rest };
    line = `remove host ${name}`;
  }
  return writeManifest(projectRoot, { team, hosts: next, rel: HOSTS_REL }, { line, subject: `team: ${verb} host ${name}`, branch: `host-${verb}-${name}`, dryRun, clone });
}

// add builder --count <n>: how many builders run, within budget.builders_cap
function setBuilderCount(projectRoot, id, rawCount, { team, hosts, roles, host, model, role, dryRun, clone }) {
  if (id !== 'builder') return { code: 1, out: `team-role: --count is for the builders only (team-role.js add builder --count <n>), not ${id}` };
  const n = countArg(rawCount);
  if (n === null) return { code: 1, out: `team-role: --count must be a whole number from 1, not ${rawCount}` };
  const capped = capProblem(team, n);
  if (capped) return capped;
  const at = roles.findIndex((r) => r && r.id === id && !r.retired);
  let next;
  const retiredNow = [];
  if (at >= 0) {
    // grow or shrink without renaming: every instance that exists keeps its name (its claims, pull
    // requests, team/<instance> branch and role directory are keyed by it); new ones take the next free
    // <id>-<k> from 2, never a retired instance's; a shrink retires the newest live ones and says which,
    // and they stay in team.json so their records keep verifying (8l1.2.2, 8l1.2.3)
    const entries = entriesOf(roles[at]);
    const live = entries.filter((e) => !e.retired);
    if (live.length === n) return { code: 1, out: `team-role: the team already has ${n} builder${n === 1 ? '' : 's'} (${live.map((e) => e.id).join(', ')})` };
    for (const e of live.slice(n)) { e.retired = true; retiredNow.push(e.id); }
    for (let k = 2, need = n - live.length; need > 0; k++) if (!entries.some((e) => e.id === `${id}-${k}`)) { entries.push({ id: `${id}-${k}` }); need--; }
    const entry = withEntries(roles[at], entries);
    if (host) entry.host = host;
    if (model) entry.model = model;
    next = { ...team, roles: roles.map((r, i) => (i === at ? entry : r)) };
  } else {
    const counts = {};
    for (const r of roles) if (r && r.host && !roleRetired(r)) counts[r.host] = (counts[r.host] || 0) + 1;
    const chosenHost = host || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!chosenHost) return { code: 1, out: 'team-role: no host to place the role on; pass --host <name>' };
    next = { ...team, roles: [...roles, { id, brief: `delivery/${id}`, host: chosenHost, model: model || role.model, count: n }] };
  }
  const kept = at >= 0 ? ` (instances: ${expandInstances({ roles: [next.roles[at]] }).filter((i) => !i.role.retired).map((i) => i.instance).join(', ')}${retiredNow.length ? `; retired ${retiredNow.join(', ')}: reassign its claims` : ''})` : '';
  return writeTeam(projectRoot, next, hosts, { line: `set builder count to ${n}${kept}`, subject: `team: ${n} builders`, branch: `builders-${n}`, dryRun, clone });
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

// every write runs under the lock (two changes at once leave valid JSON holding both)
const lockedFn = (fn) => (projectRoot, ...args) => locked(projectRoot, () => fn(projectRoot, ...args));
module.exports = {
  addRole: lockedFn(addRole), setCap: lockedFn(setCap), changeInstance: lockedFn(changeInstance), removeInstance: lockedFn(removeInstance), hostVerb: lockedFn(hostVerb),
  shippedRole, writeRoot, roleDirOf, HOST_FIELDS,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  // a flag's value: undefined when the flag is absent, '' when it is given without one
  const opt = (k) => { const i = argv.indexOf(`--${k}`); if (i < 0) return undefined; const v = argv[i + 1]; return v === undefined || v.startsWith('--') ? '' : v; };
  const [verb, a1, a2] = argv;
  const word = (x) => Boolean(x) && !x.startsWith('-');
  const usable = (['add', 'change', 'remove'].includes(verb) && word(a1))
    || (verb === 'host' && ['add', 'change', 'remove'].includes(a1) && word(a2))
    || (verb === 'set-cap' && word(a1) && a2 !== undefined && !a2.startsWith('-'));
  if (!usable) { process.stderr.write(`${USAGE}\n`); process.exit(2); }
  const { root, clone } = writeRoot(process.cwd(), { project: opt('project') });
  if (!root || !fs.existsSync(path.join(root, TEAM_REL))) { process.stderr.write(`team-role: no team.json found${clone ? ` in your clone (${root}); prepare-role makes it` : '; pass --project <root>'}\n`); process.exit(1); }
  const dryRun = argv.includes('--dry-run');
  const E = module.exports;
  const common = { dryRun, clone };
  const r = verb === 'add' ? E.addRole(root, a1, { host: opt('host'), model: opt('model'), brief: opt('brief'), instance: opt('instance'), count: opt('count'), ...common })
    : verb === 'change' ? E.changeInstance(root, a1, { host: opt('host'), model: opt('model'), brief: opt('brief'), retired: opt('retired'), ...common })
      : verb === 'remove' ? E.removeInstance(root, a1, common)
        : verb === 'host' ? E.hostVerb(root, a1, a2, Object.fromEntries(Object.keys(HOST_FIELDS).map((k) => [k, opt(k.replace(/_/g, '-'))])), common)
          : E.setCap(root, a1, a2, { record: opt('record'), recordRoot: clone ? markerProject(process.cwd()) : root, ...common });
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exit(r.code);
}
