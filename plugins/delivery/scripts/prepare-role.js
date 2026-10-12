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
    const realRemote = remoteOf(projectRoot);
    if (realRemote) git(projectDir, 'remote', 'set-url', 'origin', realRemote);
    files.push(projectDir);
  }

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

  const settings = {
    model: role.model,
    permissions: { defaultMode: 'auto' },
    env: {
      DELIVERY_ROLE: instance,
      DELIVERY_ROLE_ID: role.id,
      DELIVERY_HOST: role.host,
      DELIVERY_PROJECT_ROOT: projectRoot,
      BEADS_ACTOR: `${user || os.userInfo().username}@${role.host}/${instance}`,
    },
  };
  fs.mkdirSync(path.join(roleDir, '.claude'), { recursive: true });
  const settingsFile = path.join(roleDir, '.claude', 'settings.local.json');
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  files.push(settingsFile);

  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  const briefFile = path.join(roleDir, 'CLAUDE.local.md');
  fs.writeFileSync(briefFile, composeBrief({ team, hosts, instance, role, brief, rules }));
  files.push(briefFile);

  const marker = {
    instance,
    role: role.id,
    project_root: projectRoot,
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
  const { roleDir } = prepareRole({
    projectRoot: args.project,
    instance: args.instance,
    teamDir: args.team_dir,
    pluginRoot: path.join(__dirname, '..'),
    productRepo: args.product_repo,
    user: args.user,
  });
  console.log(roleDir);
}

module.exports = { prepareRole };
