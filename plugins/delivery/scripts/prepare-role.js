#!/usr/bin/env node
// scripts/prepare-role.js — create one role instance directory from the manifest.
// Run by a steward (phase 4) or by hand: the session is then started IN that
// directory and the SessionStart hook does the rest. Idempotent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, validateManifest, expandInstances } = require('./lib/manifest.js');
const { loadRoleBrief, composeBrief } = require('./lib/compose-brief.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function remoteOf(repo) {
  try { return git(repo, 'remote', 'get-url', 'origin'); } catch (err) { return null; }
}

function prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo, user, now }) {
  projectRoot = path.resolve(projectRoot);
  const { team, hosts } = loadManifest(projectRoot);
  const problems = validateManifest(team, hosts);
  if (problems.length) throw new Error(`manifest invalid:\n${problems.join('\n')}`);
  const found = expandInstances(team).find((i) => i.instance === instance);
  if (!found) throw new Error(`unknown instance "${instance}" (not in team.json)`);
  const { role } = found;
  const brief = loadRoleBrief(pluginRoot, projectRoot, role.brief);
  teamDir = path.resolve(teamDir || path.join(projectRoot, '..', `${team.project}-team`));
  const roleDir = path.join(teamDir, instance);
  fs.mkdirSync(roleDir, { recursive: true });
  const files = [];

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
  });
  // Hooks and bd run from the role directory, where bd cannot find the project database on its own.
  const beadsDir = path.join(projectRoot, '.beads');
  if (!settings.env.BEADS_DIR && fs.existsSync(beadsDir)) settings.env.BEADS_DIR = beadsDir;
  settings.enabledPlugins = Object.assign({}, settings.enabledPlugins, { 'delivery@ai-augmentation-systems': true });
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
  fs.writeFileSync(briefFile, composeBrief({ team, hosts, instance, role, brief, rules }));
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
  const markerFile = path.join(roleDir, '.delivery-role.json');
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

module.exports = { prepareRole };
