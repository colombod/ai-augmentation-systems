#!/usr/bin/env node
// scripts/start.js — the deterministic half of /delivery:start. The skill asks the human; this script
// never prompts. Two modes:
//
//   start.js --check [--project <root>]
//       prerequisites as a pass/fail list with the fix for each; exit 1 when a hard one is missing.
//   start.js --project <root> [--host <name>] [--preset minimal|full] [--product-repo <path|url>]
//            [--prefix <bd prefix>] [--runner superpowers|attractor|plain] [--permission-mode <mode>]
//            [--models quality|balanced|economy] [--team-dir <dir>] [--user <name>] [--dry-run]
//       scaffold a shipping team: manifest from the preset (never overwriting one), bd init when
//       .beads is absent, prepare-role for every instance not yet prepared, then the command that
//       starts each session. --dry-run prints the plan and writes nothing.
//
// Exit codes: 0 ok; 1 a hard prerequisite is missing or the scaffold was refused; 2 usage error.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadManifest, validateManifest, manifestWarnings, expandInstances, TEAM_REL, HOSTS_REL, RUNNERS } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const PLUGIN_ID = 'delivery@ai-augmentation-systems';
// The scripts use only Node built-ins and nothing newer than Node 18; the tests use node:test.
const MIN_NODE_MAJOR = 18;
// Cross-session messaging (SendMessage, ListAgents) is documented from Claude Code v2.1.224 on macOS and Linux.
const MIN_CLAUDE = [2, 1, 224];
const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'];

// role id -> manifest entry (host filled in later). Models follow templates/team.json.
const ROLE_ENTRIES = {
  'chief-of-staff': { id: 'chief-of-staff', brief: 'delivery/chief-of-staff', model: 'opus', mode: 'delegate' },
  staffing: { id: 'staffing', brief: 'delivery/staffing', model: 'sonnet', mode: 'delegate' },
  'product-manager': { id: 'product-manager', brief: 'delivery/product-manager', model: 'opus' },
  'delivery-lead': { id: 'delivery-lead', brief: 'delivery/delivery-lead', model: 'sonnet' },
  'progress-observer': { id: 'progress-observer', brief: 'delivery/progress-observer', model: 'haiku' },
  'spike-researcher': { id: 'spike-researcher', brief: 'delivery/spike-researcher', model: 'sonnet' },
  builder: { id: 'builder', brief: 'delivery/builder', model: 'sonnet', steward: true },
};
// --models: one model per role for the whole team. balanced is the role defaults (opus for the Chief
// of Staff and the Product Manager); quality also puts the Delivery Manager on opus; economy moves
// all three to sonnet and Staffing to haiku. Builders stay on sonnet in every preset.
// large_model is the model a builder gives its subagents for a size-L bead (env DELIVERY_LARGE_MODEL).
const MODEL_PRESETS = {
  quality: { 'chief-of-staff': 'opus', 'product-manager': 'opus', 'delivery-lead': 'opus', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'sonnet', 'progress-observer': 'haiku', large_model: 'opus' },
  balanced: { 'chief-of-staff': 'opus', 'product-manager': 'opus', 'delivery-lead': 'sonnet', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'sonnet', 'progress-observer': 'haiku', large_model: 'opus' },
  economy: { 'chief-of-staff': 'sonnet', 'product-manager': 'sonnet', 'delivery-lead': 'sonnet', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'haiku', 'progress-observer': 'haiku', large_model: 'sonnet' },
};
const PRESETS = {
  minimal: ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder'],
  full: ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder'],
};

class UsageError extends Error {}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, ...opts });
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', out: '', err: r.error.message };
  return { ok: r.status === 0, missing: false, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function versionAtLeast(have, need) {
  for (let i = 0; i < need.length; i++) {
    if ((have[i] || 0) > need[i]) return true;
    if ((have[i] || 0) < need[i]) return false;
  }
  return true;
}

function claudeConfigDir(env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return undefined; }
}

// ---- prerequisites ----

// Each row: { name, status: 'pass' | 'fail' | 'warn' | 'unknown', detail, fix, hard }.
function checkPrerequisites({ env = process.env, project, platform = process.platform, nodeVersion = process.versions.node } = {}) {
  const rows = [];
  const runEnv = { ...env };
  const nodeMajor = Number(String(nodeVersion).split('.')[0]);
  rows.push(nodeMajor >= MIN_NODE_MAJOR
    ? { name: 'node', status: 'pass', detail: `${nodeVersion} (need ${MIN_NODE_MAJOR} or later)`, hard: true }
    : { name: 'node', status: 'fail', detail: `${nodeVersion} is older than ${MIN_NODE_MAJOR}`, fix: `install Node ${MIN_NODE_MAJOR} or later`, hard: true });

  const git = run('git', ['--version'], { env: runEnv });
  rows.push(git.ok
    ? { name: 'git', status: 'pass', detail: git.out, hard: true }
    : { name: 'git', status: 'fail', detail: 'not found on PATH', fix: 'install git', hard: true });

  const bd = run('bd', ['version'], { env: runEnv });
  rows.push(bd.ok
    ? { name: 'bd (beads)', status: 'pass', detail: bd.out.split('\n')[0], hard: true }
    : { name: 'bd (beads)', status: 'fail', detail: bd.missing ? 'not found on PATH' : `\`bd version\` failed: ${bd.err.slice(0, 120)}`,
      fix: 'install beads so `bd` is on PATH (https://github.com/gastownhall/beads)', hard: true });

  const claude = run('claude', ['--version'], { env: runEnv });
  const need = MIN_CLAUDE.join('.');
  if (claude.missing) {
    rows.push({ name: 'claude (Claude Code)', status: 'fail', detail: 'not found on PATH', fix: `install Claude Code v${need} or later`, hard: true });
  } else {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(claude.out);
    if (!claude.ok || !m) {
      rows.push({ name: 'claude (Claude Code)', status: 'unknown', detail: '`claude --version` could not be read',
        fix: `verify manually that Claude Code is v${need} or later (cross-session messaging)`, hard: false });
    } else {
      const have = [Number(m[1]), Number(m[2]), Number(m[3])];
      rows.push(versionAtLeast(have, MIN_CLAUDE)
        ? { name: 'claude (Claude Code)', status: 'pass', detail: `${have.join('.')} (cross-session messaging needs ${need} or later)`, hard: true }
        : { name: 'claude (Claude Code)', status: 'fail', detail: `${have.join('.')} is older than ${need}, which cross-session messaging needs`, fix: 'run `claude update`', hard: true });
    }
  }
  if (platform !== 'darwin' && platform !== 'linux') {
    rows.push({ name: 'platform', status: 'warn', detail: `${platform}: cross-session messaging is documented for macOS and Linux`, fix: 'run the team on macOS or Linux', hard: false });
  }

  const configDir = claudeConfigDir(env);
  const installed = readJsonFile(path.join(configDir, 'plugins', 'installed_plugins.json'));
  if (installed === undefined) {
    rows.push({ name: 'delivery plugin', status: 'unknown', detail: 'no readable plugins/installed_plugins.json in the Claude config directory',
      fix: `verify with /plugin that ${PLUGIN_ID} is installed`, hard: false });
  } else {
    const entries = installed && installed.plugins && installed.plugins[PLUGIN_ID];
    const entry = Array.isArray(entries) ? entries[0] : entries;
    if (!entry) {
      rows.push({ name: 'delivery plugin', status: 'warn', detail: 'not listed as installed', fix: `run /plugin install ${PLUGIN_ID}`, hard: false });
    } else {
      const settings = readJsonFile(path.join(configDir, 'settings.json'));
      const enabled = settings && settings.enabledPlugins ? settings.enabledPlugins[PLUGIN_ID] : undefined;
      if (enabled === false) {
        rows.push({ name: 'delivery plugin', status: 'warn', detail: `installed (${entry.version || 'version unknown'}) but disabled in settings.json`, fix: 'enable it with /plugin', hard: false });
      } else {
        const mine = (readJsonFile(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')) || {}).version;
        const older = mine && entry.version && /^\d+\.\d+\.\d+$/.test(entry.version)
          && !versionAtLeast(entry.version.split('.').map(Number), mine.split('.').map(Number));
        rows.push(older
          ? { name: 'delivery plugin', status: 'warn', detail: `installed ${entry.version} is older than this copy (${mine}); the installed hooks may lack the shipping team`, fix: 'update it with /plugin', hard: false }
          : { name: 'delivery plugin', status: 'pass', detail: `installed (${entry.version || 'version unknown'}${enabled === true ? ', enabled' : ''})`, hard: false });
      }
    }
  }

  if (project) {
    const root = path.resolve(project);
    if (!fs.existsSync(path.join(root, '.git'))) {
      rows.push({ name: 'project repo remote', status: 'warn', detail: `${root} is not a git repository yet`, fix: 'start.js runs `git init`; add a private remote with `git remote add origin <url>`', hard: false });
    } else {
      const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root, env: runEnv });
      rows.push(remote.ok
        ? { name: 'project repo remote', status: 'pass', detail: remote.out, hard: false }
        : { name: 'project repo remote', status: 'warn', detail: 'no origin remote', fix: 'add a private remote (`git remote add origin <url>`) so plans are pushed and operator records travel on its delivery-operator branch (sessions need push access to publish them)', hard: false });
    }
  }
  return rows;
}

function formatCheck(rows) {
  const tag = { pass: 'pass', fail: 'FAIL', warn: 'warn', unknown: '????' };
  const lines = ['delivery prerequisites'];
  for (const r of rows) lines.push(`  [${tag[r.status]}] ${r.name}: ${r.detail}${r.fix && r.status !== 'pass' ? `. Fix: ${r.fix}` : ''}`);
  const missing = rows.filter((r) => r.hard && r.status === 'fail');
  lines.push(missing.length ? `${missing.length} hard prerequisite(s) missing: ${missing.map((r) => r.name).join(', ')}.` : 'All hard prerequisites are met.');
  return lines.join('\n');
}

// ---- scaffold ----

function slug(s, fallback) {
  const v = String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z0-9]+/, '');
  return v || fallback;
}

function shellQuote(s) {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function isUrl(s) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[^/\s]+@[^:\s]+:/.test(s);
}

function buildManifest({ project, prefix, host, preset, runner, models = 'balanced' }) {
  const m = MODEL_PRESETS[models];
  const roles = PRESETS[preset].map((id) => {
    const { id: rid, brief, ...rest } = ROLE_ENTRIES[id];
    const r = { id: rid, brief, host, ...rest, model: m[id] || rest.model };
    if (id === 'builder') { r.runner = runner; r.large_model = m.large_model; }
    return r;
  });
  const team = { project, prefix, bd_host: host, budget: { builders_cap: 1, staleness_hours: 2 }, roles };
  const hosts = { hosts: { [host]: { kind: 'pc', bd: 'native', headless: false, desktop_apps: true } } };
  return { team, hosts };
}

function formatManifestJson(team) {
  // one role per line, like templates/team.json, so a human can read and edit it
  const { roles, ...rest } = team;
  const top = Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${top.join(',\n')},\n  "roles": [\n${roles.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`;
}

function startCommand(roleDir, instance, permissionMode) {
  const mode = permissionMode && permissionMode !== 'default' ? ` --permission-mode ${permissionMode}` : '';
  return `cd ${shellQuote(roleDir)} && claude${mode} --name ${instance}`;
}

function scaffold(opts) {
  const {
    project, host: hostFlag, preset = 'minimal', models = 'balanced', productRepo, prefix: prefixFlag, runner = 'plain', permissionMode = 'default',
    teamDir: teamDirFlag, user, dryRun = false, env = process.env, pluginRoot = PLUGIN_ROOT,
  } = opts;
  if (!project) throw new UsageError('--project <root> is required');
  if (!PRESETS[preset]) throw new UsageError(`--preset must be one of ${Object.keys(PRESETS).join(', ')}`);
  if (!MODEL_PRESETS[models]) throw new UsageError(`--models must be one of ${Object.keys(MODEL_PRESETS).join(', ')}`);
  if (!RUNNERS.has(runner)) throw new UsageError(`--runner must be one of ${[...RUNNERS].join(', ')}`);
  if (!PERMISSION_MODES.includes(permissionMode)) throw new UsageError(`--permission-mode must be one of ${PERMISSION_MODES.join(', ')}`);
  const w = dryRun ? 'would ' : '';
  const out = [];
  const say = (s) => out.push(s);
  const projectRoot = path.resolve(project);
  const host = slug(hostFlag || os.hostname().split('.')[0], 'host');
  const gitEnv = { ...env };
  say(`delivery start: ${projectRoot}${dryRun ? ' (dry run: nothing is written)' : ''}`);

  // 1. the private project repo
  if (!fs.existsSync(projectRoot)) {
    say(`  project repo: ${w}create ${projectRoot} and run git init`);
    if (!dryRun) { fs.mkdirSync(projectRoot, { recursive: true }); if (!run('git', ['init', '-q'], { cwd: projectRoot, env: gitEnv }).ok) { say('  project repo: git init failed'); return { code: 1, out }; } }
  } else if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    say(`  project repo: ${w}run git init in ${projectRoot}`);
    if (!dryRun && !run('git', ['init', '-q'], { cwd: projectRoot, env: gitEnv }).ok) { say('  project repo: git init failed'); return { code: 1, out }; }
  } else {
    say('  project repo: exists');
  }

  // 2. the manifest: written only when neither file exists
  const teamFile = path.join(projectRoot, TEAM_REL);
  const hostsFile = path.join(projectRoot, HOSTS_REL);
  const haveTeam = fs.existsSync(teamFile);
  const haveHosts = fs.existsSync(hostsFile);
  let team;
  let hosts;
  let wroteManifest = false;
  let productCheckout = null;
  if (haveTeam || haveHosts) {
    if (!haveTeam || !haveHosts) {
      say(`  manifest: refused: ${haveTeam ? HOSTS_REL : TEAM_REL} is missing while ${haveTeam ? TEAM_REL : HOSTS_REL} exists; write it by hand (templates/ has both), then run start.js again`);
      return { code: 1, out };
    }
    ({ team, hosts } = loadManifest(projectRoot));
    // a manifest an earlier (refused) run wrote, or edited by hand, is not in the role clones until
    // it is committed: commit just these two files
    const st = run('git', ['status', '--porcelain', '--', TEAM_REL, HOSTS_REL], { cwd: projectRoot, env: gitEnv });
    if (st.ok && st.out) { if (dryRun) say('  manifest: would commit the uncommitted manifest files'); else wroteManifest = true; }
    say(`  manifest: keeping the existing ${TEAM_REL} and ${HOSTS_REL} (project "${team.project}", ${expandInstances(team).length} instance(s)); --preset, --models, --host, --prefix and --runner are not applied to it`);
  } else {
    const project = slug(path.basename(projectRoot), 'project');
    const prefix = slug(prefixFlag || project, 'proj');
    ({ team, hosts } = buildManifest({ project, prefix, host, preset, runner, models }));
    say(`  manifest: ${w}write ${TEAM_REL} and ${HOSTS_REL}: preset ${preset}, models ${models}, host "${host}", prefix "${prefix}", roles ${PRESETS[preset].join(', ')}`);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(teamFile), { recursive: true });
      fs.writeFileSync(teamFile, formatManifestJson(team));
      fs.writeFileSync(hostsFile, `${JSON.stringify(hosts, null, 2)}\n`);
      wroteManifest = true;
    }
  }
  const problems = validateManifest(team, hosts);
  if (problems.length) {
    say(`  manifest: invalid:\n${problems.map((p) => `    ${p}`).join('\n')}`);
    return { code: 1, out };
  }
  say('  manifest: valid');
  for (const warning of manifestWarnings(team)) say(`  manifest: warning: ${warning}`);

  // 3. the product checkout builders get a worktree of
  // a URL is cloned next to the project repo as <project>-product; a path is used as it is
  if (productRepo) productCheckout = isUrl(productRepo) ? path.join(path.dirname(projectRoot), `${team.project}-product`) : path.resolve(productRepo);
  if (productCheckout) {
    if (fs.existsSync(path.join(productCheckout, '.git'))) {
      say(`  product repo: using the checkout at ${productCheckout}`);
    } else if (isUrl(productRepo)) {
      say(`  product repo: ${w}clone ${productRepo} into ${productCheckout}`);
      if (!dryRun) {
        const c = run('git', ['clone', '--quiet', '--', productRepo, productCheckout], { env: gitEnv, timeout: 300000 });
        if (!c.ok) { say(`  product repo: clone failed: ${c.err.slice(0, 300)}`); return { code: 1, out }; }
      }
    } else {
      say(`  product repo: refused: ${productCheckout} is not a git checkout`);
      return { code: 1, out };
    }
  } else {
    say('  product repo: none given; a builder prepared in this run gets no product worktree (pass --product-repo <path|url>)');
  }

  // 4. commit the manifest this run wrote, so the role clones carry it
  if (wroteManifest) {
    run('git', ['add', '--', TEAM_REL, HOSTS_REL], { cwd: projectRoot, env: gitEnv });
    const c = run('git', ['commit', '-q', '-m', 'team: manifest from /delivery:start', '--', TEAM_REL, HOSTS_REL], { cwd: projectRoot, env: gitEnv });
    if (c.ok) {
      const sha = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, env: gitEnv }).out;
      say(`  manifest: committed (${sha})`);
    } else {
      say(`  manifest: not committed (${(c.err || c.out).split('\n')[0].slice(0, 160)}); commit it yourself before starting the sessions`);
    }
  } else if (dryRun && !haveTeam) {
    say('  manifest: would commit the two files');
  }

  // 5. beads, before prepare-role so it writes BEADS_DIR into each role's settings
  if (fs.existsSync(path.join(projectRoot, '.beads'))) {
    say('  beads: .beads exists; bd init skipped');
  } else if (!run('bd', ['version'], { env }).ok) {
    say(`  beads: skipped: bd is not on PATH. Install it, run \`bd init --prefix ${team.prefix}\` in ${projectRoot}, then run start.js again: it re-prepares the roles so each gets BEADS_DIR`);
  } else {
    say(`  beads: ${w}run bd init --prefix ${team.prefix}`);
    if (!dryRun) {
      const b = run('bd', ['init', '--prefix', team.prefix, '--non-interactive', '-q'], { cwd: projectRoot, env, timeout: 120000 });
      if (!b.ok) say(`  beads: bd init failed: ${(b.err || b.out).slice(0, 300)}`);
    }
  }

  // 6. one prepared directory per instance; an already prepared one is left as it is
  const teamDir = path.resolve(teamDirFlag || path.join(projectRoot, '..', `${team.project}-team`));
  const instances = expandInstances(team).filter((i) => !i.role.retired);
  instances.sort((a, b) => (a.role.id === 'chief-of-staff' ? -1 : 0) - (b.role.id === 'chief-of-staff' ? -1 : 0));
  const prepared = [];
  say(`  roles (in ${teamDir}):`);
  const { prepareRole } = require('./prepare-role.js');
  for (const { instance, role } of instances) {
    const roleDir = path.join(teamDir, instance);
    const beadsNow = fs.existsSync(path.join(projectRoot, '.beads'));
    const needsBeadsDir = beadsNow && fs.existsSync(path.join(roleDir, '.delivery-role.json')) && (() => {
      try { return !(JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).env || {}).BEADS_DIR; } catch (e) { return true; }
    })();
    if (fs.existsSync(path.join(roleDir, '.delivery-role.json')) && !needsBeadsDir) {
      say(`    ${instance}: already prepared`);
    } else if (dryRun) {
      say(`    ${instance}: would ${needsBeadsDir ? 're-prepare for BEADS_DIR' : 'prepare'} (${role.model}${role.id === 'builder' && productCheckout ? ', product worktree on team/' + instance : ''})`);
    } else {
      try {
        const { files } = prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo: productCheckout || undefined, user });
        say(`    ${instance}: ${needsBeadsDir ? 're-prepared for BEADS_DIR' : 'prepared'} (${role.model})`);
        for (const f of files) if (f.startsWith('warning:')) say(`      ${f}`);
      } catch (err) {
        say(`    ${instance}: prepare failed: ${err.message}`);
        return { code: 1, out };
      }
    }
    prepared.push({ instance, roleDir });
  }

  say('');
  say(`${dryRun ? 'After a real run, start' : 'Start'} each session in its own terminal, the Chief of Staff first:`);
  for (const { instance, roleDir } of prepared) say(`  ${startCommand(roleDir, instance, permissionMode)}`);
  if (permissionMode === 'default') say('  (no --permission-mode: each session uses your own Claude Code default; pass --permission-mode to choose one)');
  say('');
  say('Then:');
  say('  1. In every session, run /delivery:team join.');
  say('  2. Open the Chief of Staff session and talk to it for decisions and logistics; talk with the Product Manager about product vision.');
  say('  3. /delivery:team shows who is live; ask the Chief of Staff for the question ledger to see every decision.');
  return { code: 0, out, teamDir, prepared, projectRoot };
}

// ---- CLI ----

const BOOLEAN = new Set(['check', 'dry-run', 'help']);
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument "${a}"`);
    const key = a.slice(2);
    if (BOOLEAN.has(key)) { flags[key] = true; continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`--${key} needs a value`);
    flags[key] = argv[++i];
  }
  return flags;
}

const USAGE = `usage: start.js --check [--project <root>]
       start.js --project <root> [--host <name>] [--preset minimal|full] [--models quality|balanced|economy] [--product-repo <path|url>] [--prefix <bd prefix>]
                [--runner superpowers|attractor|plain] [--permission-mode <mode>] [--team-dir <dir>] [--user <name>] [--dry-run]`;

const KNOWN = new Set(['check', 'dry-run', 'help', 'project', 'host', 'preset', 'models', 'product-repo', 'prefix', 'runner', 'permission-mode', 'team-dir', 'user']);

function main(argv, { env = process.env, write = (s) => process.stdout.write(s) } = {}) {
  let flags;
  try {
    flags = parseArgs(argv);
    for (const k of Object.keys(flags)) if (!KNOWN.has(k)) throw new UsageError(`unknown option --${k}`);
  } catch (err) {
    write(`${err.message}\n${USAGE}\n`);
    return 2;
  }
  if (flags.help) { write(`${USAGE}\n`); return 0; }
  if (flags.check) {
    const rows = checkPrerequisites({ env, project: flags.project });
    write(`${formatCheck(rows)}\n`);
    return rows.some((r) => r.hard && r.status === 'fail') ? 1 : 0;
  }
  try {
    const res = scaffold({
      project: flags.project, host: flags.host, preset: flags.preset, models: flags.models, productRepo: flags['product-repo'], prefix: flags.prefix,
      runner: flags.runner, permissionMode: flags['permission-mode'], teamDir: flags['team-dir'], user: flags.user, dryRun: !!flags['dry-run'], env,
    });
    write(`${res.out.join('\n')}\n`);
    return res.code;
  } catch (err) {
    if (err instanceof UsageError) { write(`${err.message}\n${USAGE}\n`); return 2; }
    write(`start.js: ${err.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { MODEL_PRESETS, main, checkPrerequisites, formatCheck, scaffold, buildManifest, PRESETS, MIN_CLAUDE, MIN_NODE_MAJOR };
