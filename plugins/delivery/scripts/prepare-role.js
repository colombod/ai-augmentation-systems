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

function prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo, user, now }) {
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

  const actor = `${user || os.userInfo().username}@${role.host}/${instance}`;
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
  settings.enabledPlugins = Object.assign({}, settings.enabledPlugins, { 'delivery@ai-augmentation-systems': true });
  // Pre-allow the lane's own commands (spec 8.6, permission prompts): a manager session should not
  // stop on a prompt only the operator can clear for a command its lane already permits.
  try {
    const { loadPolicy, laneAllowRules } = require('../hooks/scripts/lane.js');
    const groups = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'lane-groups.json'), 'utf8'));
    const policy = loadPolicy({ pluginRoot, projectRoot, briefRef: role.brief });
    const rules = laneAllowRules(policy, groups, pluginRoot);
    if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
    if (rules.length) {
      const have = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
      settings.permissions.allow = [...new Set([...have, ...rules])];
    }
    // Native deny rules: they hold where a hook cannot (no node, a broken manifest, a moved plugin,
    // bypassPermissions). Workers and managers never address the operator; a lane without `any`
    // never needs these commands, so a hook that fails open still cannot run them. Recomputed on
    // every run: a rule the role now needs is taken out again; the user's other rules stay.
    const operatorFacing = OPERATOR_FACING_ROLES.has(role.id);
    const unrestricted = policy.bash.includes('any');
    const want = [
      ...(operatorFacing ? [] : OPERATOR_CHANNEL_TOOLS),
      ...(unrestricted ? [] : LANE_BACKSTOP_DENY.filter((r) => !rules.includes(r))),
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
    fs.mkdirSync(path.dirname(ownedFile), { recursive: true });
    fs.writeFileSync(ownedFile, JSON.stringify({ deny: want.filter((r) => !users.includes(r)) }, null, 2) + '\n');
  } catch (err) {
    files.push(`warning: lane permission rules not written (${err.message})`);
  }
  if (settings.permissions && typeof settings.permissions === 'object') {
    delete settings.permissions.defaultMode;
    if (Object.keys(settings.permissions).length === 0) delete settings.permissions;
  }
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  files.push(settingsFile);

  const ignoreFile = path.join(projectRoot, '.delivery', 'team', '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.writeFileSync(ignoreFile, 'roster.json\nroster.json.*\n');
  }

  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  const briefFile = path.join(roleDir, 'CLAUDE.local.md');
  fs.writeFileSync(briefFile, composeBrief({ team, hosts, instance, role, brief, rules, pluginRoot }));
  files.push(briefFile);

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
  for (const f of files) if (f.startsWith('warning:')) console.error(f);
  console.log(roleDir);
}

module.exports = { reachDeny, REACH_DENY, OPERATOR_CHANNEL_TOOLS, LANE_BACKSTOP_DENY, MERGE_DENY, prepareRole };
