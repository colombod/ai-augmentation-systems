#!/usr/bin/env node
// scripts/prepare-role.js — create one role instance directory from the manifest.
// Run by start.js, a steward or by hand: the session is then started IN that
// directory and the SessionStart hook does the rest. Idempotent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, validateManifest, manifestWarnings, expandInstances, canonicalRoleId, reachOf } = require('./lib/manifest.js');
const { loadRoleBrief, composeBrief } = require('./lib/compose-brief.js');
const { installExperts } = require('./lib/experts.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function remoteOf(repo) {
  try { return git(repo, 'remote', 'get-url', 'origin'); } catch (err) { return null; }
}

// operator channels only the operator-facing roles use (the ask-guard hook is the second layer)
const OPERATOR_FACING_ROLES = new Set(['chief-of-staff', 'product-manager']);
const OPERATOR_CHANNEL_TOOLS = ['AskUserQuestion', 'PushNotification', 'SendUserFile'];
// merging belongs to the Delivery Manager; every other role gets the native backstop too
const MERGE_DENY = ['Bash(gh pr merge:*)'];
// commands no restricted lane needs; denied natively unless the role's lane allows them
const LANE_BACKSTOP_DENY = ['Bash(git push:*)', 'Bash(sudo:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(rm:*)'];
// browser, desktop and computer-use servers: denied natively to every role without a reach lane (R-05)
const { REACH_PREFIXES, OWNER_SERVERS } = require('../hooks/scripts/lane.js');
const REACH_DENY = REACH_PREFIXES.map((p) => p.replace(/__$/, ''));
// in a reach lane: never credentials, the clipboard or full control (sign-in is an owner-queue step);
// a builder's local reach also never gets the owner's own Chrome or desktop
const REACH_TOOL_DENY = ['mcp__claude-in-chrome__request_credentials', 'mcp__computer-use__read_clipboard', 'mcp__computer-use__write_clipboard', 'mcp__computer-use__request_full_control', 'mcp__computer-use__request_teach_access'];
const reachDeny = (reach) => (!reach ? REACH_DENY : reach === 'local' ? OWNER_SERVERS.map((s) => `mcp__${s}`) : REACH_TOOL_DENY);

// The preparing shell's PATH in its own order (so the bd and claude it selects stay the ones selected),
// each entry made absolute (the session starts in another directory), then the usual install places
// where a service manager's bare PATH would miss bd and claude, then node's own directory: nothing
// versioned is pinned (as the watchdog's jobPath). (Copilot on #115: no reordering, no relative entry.)
function rolePath(env, home = os.homedir(), cwd = process.cwd()) {
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(home, '.local', 'bin')];
  // an empty component (a leading, trailing or doubled delimiter) searches the current directory; an
  // entry is never normalised (a `..` after a symlink is resolved by the kernel, not lexically)
  const own = env.PATH === undefined ? [] : String(env.PATH).split(path.delimiter).map((d) => (!d ? cwd : path.isAbsolute(d) ? d : `${cwd}${path.sep}${d}`));
  const parts = [...own, ...usual, path.dirname(process.execPath)];
  return [...new Set(parts)].join(path.delimiter);
}

// The role's owner-approved permission rules: { rules, refused: [{ allow, why }] }. A rule counts only
// while its record verifies, rests on the owner's own captured words (gate-context ownerRecord), and is
// scoped to this role and this command: its scope carries the label permission:<role>=<command>, the
// command as the rule names it without Bash( ) or the trailing :* (permission:builder=gh pr close).
// The rule itself is not the label: the operator store refuses a * in any scope entry, so a label
// holding Bash(gh pr close:*) could never be recorded (PR 184 re-review). Any verified owner record
// would otherwise authorise any rule on any role, so the record must name both, as an assumption's
// acknowledgement must name its spike (assumptions scopedTo). The scope is written by the recording
// agent, so the command must also be in the owner's own words (the quote or the captured input). A
// rule broader than one specific command is refused whatever its record says (permissionRuleProblem).
const permissionLabel = (roleId, allow) => `permission:${roleId}=${require('./lib/manifest.js').permissionCommand(allow)}`;
const wordsOf = (t) => ` ${String(t || '').toLowerCase().replace(/[^a-z0-9._-]+/g, ' ').trim()} `;
function ownerApproved(projectRoot, role, verifyRecord) {
  const { ownerRecord } = require('./lib/gate-context.js');
  const { permissionRuleProblem, permissionCommand } = require('./lib/manifest.js');
  const out = { rules: [], refused: [] };
  for (const p of Array.isArray(role.permissions) ? role.permissions : []) {
    const allow = p && typeof p.allow === 'string' ? p.allow.trim() : '';
    if (!allow) continue;
    const broad = permissionRuleProblem(allow);
    if (broad) { out.refused.push({ allow, why: broad }); continue; }
    if (!p.record) { out.refused.push({ allow, why: 'it cites no owner record' }); continue; }
    const v = ownerRecord(projectRoot, String(p.record), verifyRecord);
    if (!v.ok) { out.refused.push({ allow, why: v.why }); continue; }
    const want = permissionLabel(role.id, allow);
    const labels = (v.head && v.head.scope && Array.isArray(v.head.scope.labels)) ? v.head.scope.labels : [];
    if (!labels.includes(want)) { out.refused.push({ allow, why: `${p.record} is not scoped to this rule for role ${role.id} (its scope needs the label ${want})` }); continue; }
    const cmd = permissionCommand(allow);
    if (!wordsOf(v.text).includes(wordsOf(cmd))) { out.refused.push({ allow, why: `the owner's own words in ${p.record} do not name the command "${cmd}"` }); continue; }
    out.rules.push(allow);
  }
  out.rules = [...new Set(out.rules)];
  return out;
}

function prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo, user, now, verifyRecord }) {
  instance = canonicalRoleId(instance); // --instance delivery-manager means delivery-lead
  projectRoot = path.resolve(projectRoot);
  const { team, hosts } = loadManifest(projectRoot);
  const problems = validateManifest(team, hosts);
  if (problems.length) throw new Error(`manifest invalid:\n${problems.join('\n')}`);
  const found = expandInstances(team).find((i) => i.instance === instance);
  if (!found) throw new Error(`unknown instance "${instance}" (not in team.json)`);
  const { role } = found;
  if (role.retired) throw new Error(`instance "${instance}" is retired in team.json; it is kept so its records verify, not started`);
  const brief = loadRoleBrief(pluginRoot, projectRoot, role.brief);
  teamDir = path.resolve(teamDir || path.join(projectRoot, '..', `${team.project}-team`));
  const roleDir = path.join(teamDir, instance);
  fs.mkdirSync(roleDir, { recursive: true });
  const files = [];
  for (const w of manifestWarnings(team)) if (w.includes(`"${role.id}"`)) files.push(`warning: ${w}`);

  const projectDir = path.join(roleDir, 'project');
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    git(roleDir, 'clone', '--quiet', projectRoot, 'project');
    files.push(projectDir);
  }
  // Reconcile origin every run so a half-failed earlier run self-heals.
  const realRemote = remoteOf(projectRoot);
  if (realRemote) git(projectDir, 'remote', 'set-url', 'origin', realRemote);

  if (brief.meta.touches_code && productRepo) {
    const productDir = path.join(roleDir, 'product');
    if (!fs.existsSync(productDir)) {
      const branch = `team/${instance}`;
      let branchExists = false;
      try { git(productRepo, 'rev-parse', '--verify', '--quiet', branch); branchExists = true; } catch (err) { branchExists = false; }
      if (branchExists) git(productRepo, 'worktree', 'add', productDir, branch);
      else git(productRepo, 'worktree', 'add', '-b', branch, productDir);
      files.push(productDir);
    }
  }

  if (brief.meta.touches_code && !productRepo) files.push('warning: no product worktree (pass --product-repo)');

  // a re-preparation without --user keeps the role's saved actor: whoever re-runs start.js (say, to
  // change the permission mode) is not the role's identity, and a new actor loses the role's claims
  let savedUser;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8')).actor;
    if (typeof saved === 'string' && saved.lastIndexOf('@') > 0) savedUser = saved.slice(0, saved.lastIndexOf('@'));
  } catch (err) { savedUser = undefined; }
  const actor = `${user || savedUser || os.userInfo().username}@${role.host}/${instance}`;
  fs.mkdirSync(path.join(roleDir, '.claude'), { recursive: true });
  const settingsFile = path.join(roleDir, '.claude', 'settings.local.json');
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('not an object');
    } catch (err) {
      settings = {};
      files.push(`warning: ${settingsFile} was not valid JSON and was replaced`);
    }
  }
  settings.model = role.model;
  settings.env = Object.assign({}, settings.env, {
    DELIVERY_ROLE: instance,
    DELIVERY_ROLE_ID: role.id,
    DELIVERY_HOST: role.host,
    DELIVERY_PROJECT_ROOT: projectRoot,
    DELIVERY_ROLE_DIR: roleDir,
    BEADS_ACTOR: actor,
    DELIVERY_RUNNER: role.runner || 'plain',
    DELIVERY_MODE: role.mode || brief.meta.mode || 'default',
    // the model a builder gives its implementer and reviewer subagents on a size-L bead
    ...(brief.meta.touches_code ? { DELIVERY_LARGE_MODEL: role.large_model || 'opus' } : {}),
  });
  // Hooks and bd run from the role directory, where bd cannot find the project database on its own.
  // A value this script wrote earlier (remembered in the marker) follows the project when it moves;
  // any other value was set by the user and is never touched.
  const markerFile = path.join(roleDir, '.delivery-role.json');
  let previouslyWritten;
  try { previouslyWritten = JSON.parse(fs.readFileSync(markerFile, 'utf8')).beads_dir_written; } catch (err) { previouslyWritten = undefined; }
  const beadsDir = path.join(projectRoot, '.beads');
  let beadsDirWritten;
  const currentBeadsDir = settings.env.BEADS_DIR;
  if (fs.existsSync(beadsDir) && (!currentBeadsDir || (previouslyWritten && currentBeadsDir === previouslyWritten))) {
    settings.env.BEADS_DIR = beadsDir;
    beadsDirWritten = beadsDir;
  } else if (previouslyWritten && currentBeadsDir === previouslyWritten) {
    beadsDirWritten = previouslyWritten;
  }
  // A role session started by a service manager (systemd, launchd, the Remote Control service) gets
  // the manager's bare PATH, without ~/.local/bin where bd and claude usually live, and every bd call
  // failed with ENOENT (07t). The session's PATH is written from the tools resolved here, so it no
  // longer depends on how the session was started. Same rule as BEADS_DIR: a value this script wrote
  // earlier is refreshed; one the user set is never touched.
  let previousPath;
  try { previousPath = JSON.parse(fs.readFileSync(markerFile, 'utf8')).path_written; } catch (err) { previousPath = undefined; }
  let pathWritten;
  // only an unset PATH is ours to fill: an empty one is a user's valid choice (Copilot on #115)
  if (settings.env.PATH === undefined || (previousPath && settings.env.PATH === previousPath)) {
    settings.env.PATH = rolePath(process.env);
    pathWritten = settings.env.PATH;
  }
  settings.enabledPlugins = Object.assign({}, settings.enabledPlugins, { 'delivery@ai-augmentation-systems': true });
  // Pre-allow the lane's own commands (spec 8.6, permission prompts): a manager session should not
  // stop on a prompt only the operator can clear for a command its lane already permits.
  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
  let policy = null;
  let laneRules = [];
  let laneError = null;
  try {
    const { loadPolicy, laneAllowRules } = require('../hooks/scripts/lane.js');
    const groups = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'lane-groups.json'), 'utf8'));
    policy = loadPolicy({ pluginRoot, projectRoot, briefRef: role.brief });
    laneRules = laneAllowRules(policy, groups, pluginRoot);
    if (laneRules.length) {
      const have = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
      settings.permissions.allow = [...new Set([...have, ...laneRules])];
    }
  } catch (err) {
    laneError = err;
    files.push(`warning: lane permission rules not written (${err.message})`);
  }
  // The sidecars name the rules this script wrote, so they are written only after the settings file
  // (PR 184 re-review): a sidecar written first and settings that then failed to write would claim
  // rules the settings never got, and a later run would take out the same rule once the user added it
  // by hand. A sidecar write that fails after the settings throws out of prepareRole, so it is seen.
  const sidecars = [];
  // A separate step: when the lane cannot be loaded, a rule whose record stopped verifying must still
  // be taken out, never left in place by the same failure (PR 184 review).
  try {
    // Owner-approved rules (team.json role "permissions": [{ "allow", "record" }]): a rule the owner
    // approved for a role reached no settings file, since no lane may write a role's settings and
    // prepare-role wrote lane rules only (8l1.3.4.1.1). Each is written only while its record verifies
    // as the owner's own words; one that does not is refused and named. The rules written are listed
    // in a sidecar, so a rule whose record stops verifying, or that leaves the manifest, is taken out
    // again; an allow rule the user wrote is never touched.
    // a failure to read the records authorises nothing, and the rules written earlier still leave
    let approved;
    try { approved = module.exports.ownerApproved(projectRoot, role, verifyRecord); } catch (err) {
      approved = { rules: [], refused: [] };
      files.push(`warning: owner-approved permission rules not checked, none written (${err.message})`);
    }
    for (const r of approved.refused) files.push(`warning: permission rule ${r.allow} not written: ${r.why}`);
    const allowFile = path.join(roleDir, '.claude', '.delivery-managed-allow.json');
    let ownedAllow = [];
    try { ownedAllow = JSON.parse(fs.readFileSync(allowFile, 'utf8')).allow || []; } catch (e) { ownedAllow = []; }
    const haveAllow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    const userAllow = haveAllow.filter((r) => !ownedAllow.includes(r) || laneRules.includes(r));
    const allow = [...new Set([...userAllow, ...approved.rules])];
    if (allow.length) settings.permissions.allow = allow; else delete settings.permissions.allow;
    sidecars.push([allowFile, { allow: approved.rules.filter((r) => !userAllow.includes(r)) }]);
  } catch (err) {
    files.push(`warning: owner-approved permission rules not written (${err.message})`);
  }
  try {
    if (laneError) throw laneError;
    // Native deny rules: they hold where a hook cannot (no node, a broken manifest, a moved plugin,
    // bypassPermissions). Workers and managers never address the operator; a lane without `any`
    // never needs these commands, so a hook that fails open still cannot run them. Recomputed on
    // every run: a rule the role now needs is taken out again; the user's other rules stay.
    const operatorFacing = OPERATOR_FACING_ROLES.has(role.id);
    const unrestricted = policy.bash.includes('any');
    const want = [
      ...(operatorFacing ? [] : OPERATOR_CHANNEL_TOOLS),
      ...(unrestricted ? [] : LANE_BACKSTOP_DENY.filter((r) => !laneRules.includes(r))),
      ...(role.id === 'delivery-lead' ? [] : MERGE_DENY),
      ...reachDeny(policy.reach || reachOf(role)),
    ];
    // Only the rules this script added are its to take out again: they are listed in a sidecar next to
    // the settings. Any other deny rule is the user's and stays, even one the plugin also manages; a
    // role directory without the sidecar (an earlier version) keeps every existing rule.
    const ownedFile = path.join(roleDir, '.claude', '.delivery-managed-deny.json');
    let owned = [];
    try { owned = JSON.parse(fs.readFileSync(ownedFile, 'utf8')).deny || []; } catch (e) { owned = []; }
    const haveDeny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
    const users = haveDeny.filter((r) => !owned.includes(r));
    const deny = [...new Set([...users, ...want])];
    if (deny.length) settings.permissions.deny = deny; else delete settings.permissions.deny;
    sidecars.push([ownedFile, { deny: want.filter((r) => !users.includes(r)) }]);
  } catch (err) {
    if (err !== laneError) files.push(`warning: lane permission rules not written (${err.message})`);
  }
  // The team's permission mode is the role's default too, not only the flag a launch passes: a session
  // started any other way (the owner's Claude app through Remote Control, a start command typed by
  // hand, a fresh-start wake) otherwise came up in manual-approve mode and turned every bead note,
  // record and ack into an approval prompt for the owner (kk5, dec-chief-of-staff-000076: no session
  // the plugin spawns may run in manual-approve mode). team.json permission_mode, auto when unset;
  // 'default' or 'manual' written by an owner is respected as asked.
  const mode = team.permission_mode || 'auto';
  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
  if (mode === 'default' || mode === 'manual') delete settings.permissions.defaultMode;
  else settings.permissions.defaultMode = mode;
  if (Object.keys(settings.permissions).length === 0) delete settings.permissions;
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  files.push(settingsFile);
  for (const [f, body] of sidecars) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(body, null, 2)}\n`); }

  const ignoreFile = path.join(projectRoot, '.delivery', 'team', '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.writeFileSync(ignoreFile, 'roster.json\nroster.json.*\n');
  }

  // the brief names plugin scripts through the project's launcher, which survives plugin installs; when
  // it cannot be written the brief falls back to the absolute plugin root (lib/launcher.js)
  const launcherProblem = require('./lib/launcher.js').ensureLauncher(projectRoot, pluginRoot);
  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  const briefFile = path.join(roleDir, 'CLAUDE.local.md');
  fs.writeFileSync(briefFile, composeBrief({ team, hosts, instance, role, brief, rules, pluginRoot, projectRoot: launcherProblem ? null : projectRoot }));
  files.push(briefFile);

  // The product's own experts (Staffing's .delivery/team/experts/), as subagents in this session.
  const ex = installExperts({ projectRoot, roleDir });
  files.push(...ex.installed);
  for (const r of ex.removed) files.push(`removed (expert retired): ${r}`);
  for (const w of ex.warnings) files.push(`warning: ${w}`);

  const marker = {
    instance,
    role: role.id,
    project_root: projectRoot,
    actor,
    host: role.host,
    model: role.model,
    prepared_at: now || new Date().toISOString(),
  };
  if (beadsDirWritten) marker.beads_dir_written = beadsDirWritten;
  if (pathWritten) marker.path_written = pathWritten;
  fs.writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
  files.push(markerFile);

  return { roleDir, files };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2).replace(/-/g, '_')] = argv[i + 1]; i++; }
  }
  return out;
}

// exported before the CLI runs: prepareRole calls ownerApproved through module.exports (a test seam)
module.exports = { rolePath, reachDeny, REACH_DENY, OPERATOR_CHANNEL_TOOLS, LANE_BACKSTOP_DENY, MERGE_DENY, prepareRole, ownerApproved, permissionLabel };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.instance) {
    console.error('usage: prepare-role.js --project <projectRoot> --instance <id> [--team-dir <dir>] [--product-repo <path>] [--user <name>]');
    process.exit(2);
  }
  const { roleDir, files } = prepareRole({
    projectRoot: args.project,
    instance: args.instance,
    teamDir: args.team_dir,
    pluginRoot: path.join(__dirname, '..'),
    productRepo: args.product_repo,
    user: args.user,
  });
  for (const f of files) if (f.startsWith('warning:') || f.startsWith('removed (expert retired):')) console.error(f);
  console.log(roleDir);
}
