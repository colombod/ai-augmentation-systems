#!/usr/bin/env node
// scripts/start.js — the deterministic half of /delivery:start. The skill asks the human; this script
// never prompts. Two modes:
//
//   start.js --check [--project <root>]
//       prerequisites as a pass/fail list with the fix for each; exit 1 when a hard one is missing.
//   start.js --project <root> [--host <name>] [--preset minimal|full] [--product-repo <path|url>]
//            [--prefix <bd prefix>] [--runner superpowers|attractor|plain] [--permission-mode <mode>]
//            [--models quality|balanced|economy] [--reality-checker] [--team-dir <dir>] [--user <name>] [--launch [--keep-alive]] [--import-beads <file>] [--dry-run]
//       scaffold a shipping team: manifest from the preset (never overwriting one), bd init when
//       .beads is absent, prepare-role for every instance not yet prepared, then the command that
//       starts each session. --dry-run prints the plan and writes nothing. --import-beads loads a
//       `bd export` file (JSONL) into the project's beads once: ids must carry the team's prefix,
//       an id already present is skipped and never overwritten.
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
  'reality-checker': { id: 'reality-checker', brief: 'delivery/reality-checker', model: 'sonnet' },
};
// --models: one model per role for the whole team. balanced is the role defaults (opus for the Chief
// of Staff and the Product Manager); quality also puts the Delivery Manager on opus; economy moves
// all three to sonnet and Staffing to haiku. Builders stay on sonnet in every preset.
// large_model is the model a builder gives its subagents for a size-L bead (env DELIVERY_LARGE_MODEL).
const MODEL_PRESETS = {
  quality: { 'chief-of-staff': 'opus', 'product-manager': 'opus', 'delivery-lead': 'opus', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'sonnet', 'progress-observer': 'haiku', 'reality-checker': 'sonnet', large_model: 'opus' },
  balanced: { 'chief-of-staff': 'opus', 'product-manager': 'opus', 'delivery-lead': 'sonnet', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'sonnet', 'progress-observer': 'haiku', 'reality-checker': 'sonnet', large_model: 'opus' },
  economy: { 'chief-of-staff': 'sonnet', 'product-manager': 'sonnet', 'delivery-lead': 'sonnet', builder: 'sonnet', 'spike-researcher': 'sonnet', staffing: 'haiku', 'progress-observer': 'haiku', 'reality-checker': 'sonnet', large_model: 'sonnet' },
};
const PRESETS = {
  minimal: ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder'],
  full: ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'reality-checker', 'builder'],
};

// R-33: a customer surface no test reaches needs the Reality Checker, so a declared surface with
// scriptable: false puts it in the minimal preset too. So does a command-line surface (command_line:
// true): its stories are verified by verify-run.js, which only the Reality Checker may run, never the
// builder. The surface ids that need the Reality Checker:
function unscriptableSurfaces(projectRoot) {
  const dir = path.join(projectRoot, '.delivery', 'initiatives');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (err) { return []; }
  const { loadSurface } = require('./lib/surface.js');
  return names.flatMap((n) => loadSurface(projectRoot, n).surfaces.filter((x) => x.scriptable === false || x.command_line === true).map((x) => `${n}/${x.id}`));
}
function presetRoles(preset, { realityChecker = false, unscriptable = [] } = {}) {
  const ids = PRESETS[preset].slice();
  if (!ids.includes('reality-checker') && (realityChecker || unscriptable.length)) ids.splice(ids.indexOf('builder'), 0, 'reality-checker');
  return ids;
}

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
  if (bd.ok) {
    rows.push({ name: 'bd (beads)', status: 'pass', detail: bd.out.split('\n')[0], hard: true });
  } else if (platform === 'win32') {
    rows.push(windowsBdRow(bd, smartAppControl(runEnv)));
  } else {
    rows.push({ name: 'bd (beads)', status: 'fail', detail: bd.missing ? 'not found on PATH' : `\`bd version\` failed: ${bd.err.slice(0, 120)}`,
      fix: `install beads so \`bd\` is on PATH (${SETUP_DOC})`, hard: true });
  }

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
    rows.push({ name: 'platform', status: 'warn', detail: `${platform}: cross-session messaging is documented for macOS and Linux`,
      fix: platform === 'win32' ? `run the team inside WSL2 (${SETUP_DOC}, Windows)` : 'run the team on macOS or Linux', hard: false });
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
    if (bd.ok && fs.existsSync(path.join(root, '.beads'))) {
      const ids = beadsIssueIds(root, runEnv);
      rows.push(ids
        ? { name: 'beads issues', status: 'pass', detail: `${issuesOf(ids.length)} in ${path.join(root, '.beads')}`, hard: false }
        : { name: 'beads issues', status: 'unknown', detail: 'this machine has no readable database yet', fix: 'run start.js (it fetches the team\'s issues with `bd bootstrap`)', hard: false });
    }
    if (bd.ok && fs.existsSync(path.join(root, '.beads'))) rows.push(beadsSyncRow(run('bd', ['dolt', 'remote', 'list', '--json'], { cwd: root, env: runEnv })));
  }
  // Amplifier is not a prerequisite; where it is installed it owns the machine's setup (skills/amplifier)
  const A = require('./lib/amplifier.js');
  rows.push(...A.checkRows(A.detect({ env: runEnv, platform, run: (c, a) => run(c, a, { env: runEnv, timeout: 60000 }) })));
  return rows;
}

const SETUP_DOC = 'docs/quickstart.md, "Setting up beads"';

// The team starts itself (--launch). Each role on this machine gets its first turn headless, in its own
// role directory, in the team's permission mode, and joins the team; the session it creates is on the
// roster, so the watchdog (--keep-alive) can resume it whenever work is due. Before this, the operator
// started every session by hand and, in their default mode, approved its steps: the opposite of rule 0.
const JOIN_PROMPT = '/delivery:team join';
function launchTeam({ projectRoot, prepared, host, permissionMode, env, dryRun, w, say }) {
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const here = prepared.filter((p) => p.host === host);
  const elsewhere = prepared.filter((p) => p.host !== host).map((p) => `${p.instance} (${p.host})`);
  say(`  launch (on host "${host}"):`);
  if (!here.length) { say(`    nothing to start: no role of this team runs on host "${host}" (pass --host with this machine's name in hosts.json)`); return { code: 1 }; }
  const roster = require('./lib/roster.js').readRoster(projectRoot).instances || {};
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  for (const { instance, roleDir } of here) {
    const known = roster[instance] && roster[instance].session_id;
    if (known) { say(`    ${instance}: already started (session ${known}); the watchdog resumes it when work is due`); continue; }
    const args = ['-p', JOIN_PROMPT, ...(permissionMode && permissionMode !== 'default' ? ['--permission-mode', permissionMode] : []), '--name', instance];
    if (dryRun) { say(`    ${instance}: would start in ${roleDir}: ${bin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`); continue; }
    const logPath = path.join(projectRoot, '.delivery', 'watchdog', 'logs', `launch-${instance}-${at}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, 'a');
    const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'lib', 'wake-run.js'), String(2 * 3600e3), bin, ...args],
      { cwd: roleDir, env: require('./lib/fresh-session-env.js').freshSessionEnv(env, { DELIVERY_ROLE: instance, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' }), detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    fs.closeSync(fd);
    say(`    ${instance}: started (pid ${child.pid}), joining the team; log ${path.relative(projectRoot, logPath)}`);
  }
  if (elsewhere.length) say(`    not on this machine: ${elsewhere.join(', ')}; run start.js --launch on each of those hosts`);
  if (permissionMode === 'default') say('    warning: --permission-mode default: a headless session cannot ask you, so steps your default would ask about are refused');
  return { code: 0 };
}

// --keep-alive installs the watchdog's host job (launchd, systemd user timer or cron), which resumes a
// role session whose work is due; without it a session that stopped stays stopped.
function keepTeamAlive({ projectRoot, env, dryRun, w, say }) {
  if (dryRun) { say(`  keep-alive: ${w}install the watchdog job (watchdog.js install --apply)`); return; }
  const r = run(process.execPath, [path.join(__dirname, 'watchdog.js'), 'install', '--apply', '--project', projectRoot], { env, timeout: 60000 });
  say(r.ok ? `  keep-alive: watchdog job installed${r.out ? `: ${r.out.split('\n').slice(-1)[0]}` : ''}` : `  keep-alive: watchdog install failed: ${(r.err || r.out).slice(0, 300)}`);
}

// Dolt names git remotes with a git+ prefix; the project repo's origin is the sync remote (beads
// stores issue history there under refs/dolt/data), so no server and no database password exist.
function doltUrlOf(url) {
  if (/^git\+/.test(url)) return url;
  if (/^(https?|ssh|file):\/\//.test(url)) return `git+${url}`;
  const scp = /^([^@\s]+@)?([^:\s/]+):(.+)$/.exec(url);
  if (scp) return `git+ssh://${scp[1] || ''}${scp[2]}/${scp[3]}`;
  if (path.isAbsolute(url)) return `git+file://${url}`;
  return null;
}

// Beads for any project, on any machine, with nothing for the customer to run by hand:
//   no .beads              -> bd init (bd wires the project's origin as the sync remote), publish
//   .beads, no database    -> bd bootstrap: a second machine's fresh clone carries .beads/config.yaml
//                             but never the database, and bd init there would fork the history
//   database, no remote    -> add the project's origin as the sync remote, publish
//   database and remote    -> nothing
// A failed publish is reported with its fix and does not stop the scaffold: the database works
// locally, and the --check "beads sync" row keeps saying what is missing.
// Commit only the named beads paths, never anything else the customer has staged.
function commitBeadsFiles({ projectRoot, env, say, paths, message }) {
  const existing = paths.filter((p) => fs.existsSync(path.join(projectRoot, p)));
  if (!existing.length) return;
  run('git', ['add', '--', ...existing], { cwd: projectRoot, env });
  if (run('git', ['diff', '--cached', '--quiet', '--', ...existing], { cwd: projectRoot, env }).ok) return;
  const c = run('git', ['commit', '-q', '-m', message, '--', ...existing], { cwd: projectRoot, env });
  say(c.ok ? `  beads: committed ${existing.join(', ')} (${run('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, env }).out})` : `  beads: could not commit ${existing.join(', ')}: ${(c.err || c.out).slice(0, 200)}`);
}

function setUpBeads({ projectRoot, prefix, env, dryRun, w, say, skipPublish = false }) {
  const bd = (args, timeout = 120000) => run('bd', args, { cwd: projectRoot, env, timeout });
  const hasBeads = fs.existsSync(path.join(projectRoot, '.beads'));
  const hasDb = hasBeads && bd(['stats'], 30000).ok;
  // the project repo already holds the team's issues even when this clone has no .beads yet
  // (another machine published them before pushing its commit): fetch them, never init a second history
  const published = !hasDb && run('git', ['ls-remote', 'origin', 'refs/dolt/data'], { cwd: projectRoot, env, timeout: 30000 }).out.trim() !== '';
  if (!hasBeads && !published) {
    say(`  beads: ${w}run bd init --prefix ${prefix}`);
    if (dryRun) { say(`  beads: ${w}set the project repo's origin as the sync remote and publish the issues (bd dolt push)`); return; }
    // --skip-agents: without it bd init also writes and commits AGENTS.md, CLAUDE.md,
    // .claude/settings.json, .codex/ and .agents/skills/ into the customer's project repo (bd 1.1.2),
    // over their own files; the plugin brings its own role instructions.
    const gitignoreWasClean = run('git', ['status', '--porcelain', '--', '.gitignore'], { cwd: projectRoot, env }).out === '';
    const b = bd(['init', '--prefix', prefix, '--non-interactive', '-q', '--skip-agents']);
    if (!b.ok) { say(`  beads: bd init failed: ${(b.err || b.out).slice(0, 300)}`); return; }
    commitBeadsFiles({ projectRoot, env, say, paths: gitignoreWasClean ? ['.beads', '.gitignore'] : ['.beads'], message: 'beads: initialise issue tracking (start.js, bd init)' });
  } else if (!hasDb) {
    say(`  beads: ${hasBeads ? '.beads is here but this machine has no database (a fresh clone)' : 'the project repo already holds the team\'s issues'}; ${w}run bd bootstrap to fetch them from the project repo`);
    if (dryRun) return;
    const b = bd(['bootstrap', '--yes']);
    if (!b.ok) { say(`  beads: bd bootstrap failed: ${(b.err || b.out).slice(0, 300)}. Fix: ${SETUP_DOC}`); return; }
    if (!bd(['stats'], 30000).ok) { say(`  beads: bd bootstrap ran but there is still no database. Fix: ${SETUP_DOC}`); return; }
    say('  beads: database fetched from the project repo');
    return;
  } else {
    say('  beads: database present');
  }
  const remotes = bd(['dolt', 'remote', 'list', '--json'], 30000);
  let list = [];
  try { list = remotes.ok ? JSON.parse(remotes.out || '[]') : []; } catch (e) { list = []; }
  if (!list.length) {
    const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: projectRoot, env });
    const url = origin.ok && doltUrlOf(origin.out);
    if (!url) { say(`  beads: no sync remote, and the project repo has no origin to sync through: its issues stay on this machine. Fix: add a private remote, then run start.js again (${SETUP_DOC})`); return; }
    say(`  beads: ${w}set the sync remote to the project repo (${url})`);
    if (dryRun) return;
    const a = bd(['dolt', 'remote', 'add', 'origin', url], 30000);
    if (!a.ok) { say(`  beads: could not set the sync remote: ${(a.err || a.out).slice(0, 300)}. Fix: ${SETUP_DOC}`); return; }
    // bd writes sync.remote into .beads/config.yaml; committed, a fresh clone knows where to bootstrap from
    commitBeadsFiles({ projectRoot, env, say, paths: ['.beads/config.yaml'], message: 'beads: sync through the project repo (start.js)' });
  } else if (hasDb) {
    return;
  }
  if (dryRun) { say(`  beads: ${w}publish the issues to the project repo (bd dolt push)`); return; }
  if (skipPublish) return;
  publishBeads({ projectRoot, env, say });
}

function publishBeads({ projectRoot, env, say }) {
  const bd = (args, timeout = 120000) => run('bd', args, { cwd: projectRoot, env, timeout });
  const p = bd(['dolt', 'push']);
  // A Claude Code cloud session's git proxy refuses pushes to refs outside refs/heads (measured:
  // HTTP 403 for refs/dolt/data, while branch pushes pass), so the first publish must come from a
  // machine with ordinary git access to the project repo.
  const refused = !p.ok && /HTTP 403|returned error: 403/.test(`${p.err} ${p.out}`);
  say(p.ok
    ? '  beads: issues published to the project repo; other machines get them from a clone with `bd bootstrap` (start.js does it)'
    : refused
      ? `  beads: publish refused (HTTP 403): this machine's network does not allow pushing beads' refs/dolt/data (a Claude Code cloud session's proxy refuses refs outside branches). The database works here; publish once from a machine with ordinary git access by running start.js there`
      : `  beads: publish failed: ${(p.err || p.out).slice(0, 300)}. The database works here; run \`bd dolt push\` in ${projectRoot} once the project repo accepts pushes`);
}

// ---- --import-beads: load a `bd export` file once ----

// The prefix the team's issues will carry: the existing manifest's, else the one scaffold would write.
function plannedPrefix(projectRoot, prefixFlag) {
  const team = readJsonFile(path.join(projectRoot, TEAM_REL));
  if (team && team.prefix) return team.prefix;
  return slug(prefixFlag || slug(path.basename(projectRoot), 'project'), 'proj');
}

// Read and check the whole file before anything is written. Returns { ids, lines } (one entry per
// distinct id, in file order) or { refusal }. An id is `<prefix>-<rest>`; a prefix is never rewritten.
function readBeadsExport(file, prefix) {
  let text;
  try { text = fs.readFileSync(path.resolve(file), 'utf8'); } catch (err) { return { refusal: `${file} cannot be read (${err.code === 'ENOENT' ? 'no such file' : err.message})` }; }
  const issues = new Map();
  const wrong = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    let obj;
    try { obj = JSON.parse(rows[i]); } catch (err) { return { refusal: `line ${i + 1} of ${file} is not JSON` }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.id !== 'string' || !obj.id) return { refusal: `line ${i + 1} of ${file} is not an issue (no "id")` };
    if (!obj.id.startsWith(`${prefix}-`) || obj.id.length === prefix.length + 1) { wrong.push({ line: i + 1, id: obj.id }); continue; }
    if (!issues.has(obj.id)) issues.set(obj.id, rows[i]);
  }
  if (wrong.length) {
    const first = wrong[0];
    const own = first.id.includes('-') ? first.id.slice(0, first.id.lastIndexOf('-')) : first.id;
    return { refusal: `line ${first.line} of ${file} holds ${first.id}, whose prefix is "${own}", but this project's prefix is "${prefix}"${wrong.length > 1 ? ` (${wrong.length} lines do not match)` : ''}; ids are never rewritten` };
  }
  return { ids: [...issues.keys()], lines: [...issues.values()] };
}

// Every issue id in the project's database, closed ones included; null when it cannot be read.
function beadsIssueIds(projectRoot, env) {
  const r = run('bd', ['list', '--all', '--limit', '0', '--json'], { cwd: projectRoot, env, timeout: 60000 });
  if (!r.ok) return null;
  try { return JSON.parse(r.out || '[]').map((x) => x.id); } catch (err) { return null; }
}

const issuesOf = (n) => `${n} issue${n === 1 ? '' : 's'}`;

function importBeads({ projectRoot, parsed, env, dryRun, say }) {
  const have = fs.existsSync(path.join(projectRoot, '.beads')) ? beadsIssueIds(projectRoot, env) : null;
  if (!have && !dryRun) { say(`  beads: import refused: the project has no readable beads database to load ${issuesOf(parsed.ids.length)} into`); return false; }
  const present = new Set(have || []);
  const lines = parsed.lines.filter((_, i) => !present.has(parsed.ids[i]));
  const skipped = parsed.ids.length - lines.length;
  // "imported 3 issues" on a first load; "0 new, 3 already present" when some or all were there
  const summary = (verb) => (skipped ? `${verb === 'imported' ? '' : `${verb} `}${lines.length} new, ${skipped} already present` : `${verb} ${issuesOf(lines.length)}`);
  if (dryRun) { say(`  beads: ${summary('would import')}`); return true; }
  if (lines.length) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'start-import-')), 'issues.jsonl');
    fs.writeFileSync(tmp, `${lines.join('\n')}\n`);
    const r = run('bd', ['import', tmp], { cwd: projectRoot, env, timeout: 300000 });
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    if (!r.ok) { say(`  beads: import failed: ${(r.err || r.out).slice(0, 300)}`); return false; }
  }
  say(`  beads: ${summary('imported')}`);
  if (lines.length) {
    const remotes = run('bd', ['dolt', 'remote', 'list', '--json'], { cwd: projectRoot, env, timeout: 30000 });
    let list = [];
    try { list = remotes.ok ? JSON.parse(remotes.out || '[]') : []; } catch (err) { list = []; }
    if (list.length) publishBeads({ projectRoot, env, say });
  }
  return true;
}

// Smart App Control state from the registry value Windows keeps it in: 0 off, 1 on (enforcing),
// 2 evaluation. Read with reg.exe so no PowerShell module is needed; anything unreadable is unknown.
function smartAppControl(env) {
  const r = run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy', '/v', 'VerifiedAndReputablePolicyState'], { env });
  const m = r.ok && /VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.out);
  return m ? ({ 0: 'off', 1: 'on', 2: 'evaluation' })[parseInt(m[1], 16)] || 'unknown' : 'unknown';
}

// Why the Windows row is its own: the released bd.exe is not code-signed (1.1.2 has an empty
// certificate table), and Smart App Control blocks unsigned programs, a local build included, with
// no per-app exception. Telling a Windows user to "install beads" sends them into that wall.
function windowsBdRow(bd, sac) {
  const wsl = 'run the team inside WSL2 and install the Linux bd there (recommended: cross-session messaging is also documented only for macOS and Linux)';
  const off = 'or turn Smart App Control off (machine-wide; it can be turned back on only on Windows 11 25H2 with the April 2026 update or later)';
  const detail = bd.missing ? 'not found on PATH' : `\`bd version\` failed: ${bd.err.slice(0, 120)}`;
  if (sac === 'on' || sac === 'evaluation') {
    return { name: 'bd (beads)', status: 'fail', hard: true,
      detail: `${detail}; Smart App Control is ${sac === 'on' ? 'on' : 'in evaluation mode'}, and it blocks unsigned programs such as bd.exe`,
      fix: `${wsl}, ${off}. See ${SETUP_DOC}, Windows` };
  }
  return { name: 'bd (beads)', status: 'fail', hard: true,
    detail: `${detail}; Smart App Control is ${sac}`,
    fix: `${wsl}; or install bd.exe with beads' checksum-verified PowerShell installer. See ${SETUP_DOC}, Windows` };
}

// A beads database with no sync remote lives on one machine only: no other host or cloud session
// sees its issues, and losing that disk loses them. beads syncs through the project repo's own git
// remote (refs/dolt/data), so the fix needs no server.
function beadsSyncRow(r) {
  let remotes;
  try { remotes = r.ok ? JSON.parse(r.out || '[]') : null; } catch (e) { remotes = null; }
  if (!Array.isArray(remotes)) {
    return { name: 'beads sync', status: 'unknown', detail: `\`bd dolt remote list --json\` could not be read${r.err ? `: ${r.err.slice(0, 120)}` : ''}`, fix: `check with \`bd dolt remote list\` (${SETUP_DOC})`, hard: false };
  }
  if (!remotes.length) {
    return { name: 'beads sync', status: 'warn', detail: 'no sync remote: these issues exist on this machine only, and no other host or cloud session sees them',
      fix: `in the project repo: \`bd dolt remote add origin <its private git URL>\`, then \`bd dolt push\` and commit .beads/config.yaml (${SETUP_DOC})`, hard: false };
  }
  return { name: 'beads sync', status: 'pass', detail: remotes.map((x) => `${x.name} ${x.url}`).join(', '), hard: false };
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

function buildManifest({ project, prefix, host, preset, runner, models = 'balanced', roleIds }) {
  const m = MODEL_PRESETS[models];
  const roles = (roleIds || PRESETS[preset]).map((id) => {
    const { id: rid, brief, ...rest } = ROLE_ENTRIES[id];
    const r = { id: rid, brief, host, ...rest, model: m[id] || rest.model };
    if (id === 'builder') { r.runner = runner; r.large_model = m.large_model; }
    return r;
  });
  const team = { project, prefix, bd_host: host, budget: { builders_cap: 1, staleness_hours: 2 }, roles };
  const hosts = { hosts: { [host]: { kind: 'pc', bd: 'native', headless: false, desktop_apps: true } } };
  return { team, hosts };
}

// owner/name of a checkout's origin on GitHub, or null
function githubOf(checkout) {
  try {
    const url = require('child_process').execFileSync('git', ['-C', checkout, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    return require('./lib/gh-pr.js').repoOf(url);
  } catch (err) { return null; }
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
    project, host: hostFlag, preset = 'minimal', models = 'balanced', productRepo, prefix: prefixFlag, runner = 'plain', permissionMode: modeFlag,
    teamDir: teamDirFlag, user, dryRun = false, env = process.env, pluginRoot = PLUGIN_ROOT, realityChecker = false, launch = false, keepAlive = false, importBeads: importFile,
  } = opts;
  if (!project) throw new UsageError('--project <root> is required');
  if (!PRESETS[preset]) throw new UsageError(`--preset must be one of ${Object.keys(PRESETS).join(', ')}`);
  if (!MODEL_PRESETS[models]) throw new UsageError(`--models must be one of ${Object.keys(MODEL_PRESETS).join(', ')}`);
  if (!RUNNERS.has(runner)) throw new UsageError(`--runner must be one of ${[...RUNNERS].join(', ')}`);
  if (modeFlag !== undefined && !PERMISSION_MODES.includes(modeFlag)) throw new UsageError(`--permission-mode must be one of ${PERMISSION_MODES.join(', ')}`);
  const w = dryRun ? 'would ' : '';
  const out = [];
  const say = (s) => out.push(s);
  const projectRoot = path.resolve(project);
  const host = slug(hostFlag || os.hostname().split('.')[0], 'host');
  const gitEnv = { ...env };
  // --import-beads is checked whole before anything is written, so a refusal changes nothing
  let parsedImport = null;
  if (importFile) {
    const expected = plannedPrefix(projectRoot, prefixFlag);
    parsedImport = readBeadsExport(importFile, expected);
    if (parsedImport.refusal) { say(`delivery start: import refused: ${parsedImport.refusal}; nothing was imported or written`); return { code: 1, out }; }
    if (!run('bd', ['version'], { env }).ok) { say('delivery start: import refused: bd is not on PATH; install it, then run start.js again with --import-beads'); return { code: 1, out }; }
  }
  say(`delivery start: ${projectRoot}${dryRun ? ' (dry run: nothing is written)' : ''}`);

  // 1. the private project repo
  if (!fs.existsSync(projectRoot)) {
    say(`  project repo: ${w}create ${projectRoot} and run git init`);
    if (!dryRun) { fs.mkdirSync(projectRoot, { recursive: true }); if (!run('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot, env: gitEnv }).ok) { say('  project repo: git init failed'); return { code: 1, out }; } }
  } else if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    say(`  project repo: ${w}run git init in ${projectRoot}`);
    if (!dryRun && !run('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot, env: gitEnv }).ok) { say('  project repo: git init failed'); return { code: 1, out }; }
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
    const unscriptable = unscriptableSurfaces(projectRoot);
    if (unscriptable.length && !team.roles.some((r) => r.id === 'reality-checker' && !r.retired)) say(`  manifest: warning: ${unscriptable.join(', ')} ${unscriptable.length > 1 ? 'need' : 'needs'} the Reality Checker (not scriptable, or a command line) and the team has none: add {"id": "reality-checker", "brief": "delivery/reality-checker", "host": "<a host with desktop apps>"} to roles`);
  } else {
    const project = slug(path.basename(projectRoot), 'project');
    const prefix = slug(prefixFlag || project, 'proj');
    const unscriptable = unscriptableSurfaces(projectRoot);
    const roleIds = presetRoles(preset, { realityChecker, unscriptable });
    ({ team, hosts } = buildManifest({ project, prefix, host, preset, runner, models, roleIds }));
    say(`  manifest: ${w}write ${TEAM_REL} and ${HOSTS_REL}: preset ${preset}, models ${models}, host "${host}", prefix "${prefix}", roles ${roleIds.join(', ')}`);
    if (unscriptable.length && !PRESETS[preset].includes('reality-checker')) say(`  manifest: the Reality Checker is added: ${unscriptable.join(', ')} ${unscriptable.length > 1 ? 'are' : 'is'} not scriptable or a command line, so its checks run on the real surface`);
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
  // the command the reviewer runs on each pull request (review-run.js): any language, said up front so
  // a repository the detection cannot read is fixed once here, not found at the first review
  if (productCheckout && fs.existsSync(path.join(productCheckout, '.git'))) {
    const t = require('./lib/test-command.js').testCommandOf(productCheckout, team);
    say(t.problem ? `  product tests: not known: ${t.problem}.\n    ${require('./lib/test-command.js').FIX}` : `  product tests: \`${t.command}\` (${t.source}); reviewers run it on each pull request`);
  }
  // the GitHub repository the review records and the merge gate read (R-32): from the checkout's origin
  const github = productCheckout && fs.existsSync(path.join(productCheckout, '.git')) ? githubOf(productCheckout) : (productRepo && isUrl(productRepo) ? require('./lib/gh-pr.js').repoOf(productRepo) : null);
  if (github) {
    const same = team.product_github === github;
    say(`  product repo: GitHub ${github}${same ? '' : `; ${w}record it as product_github in ${TEAM_REL}`}`);
    if (!same && !dryRun) {
      const raw = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
      raw.product_github = github;
      team.product_github = github;
      fs.writeFileSync(teamFile, formatManifestJson(raw));
      wroteManifest = true;
    }
  }

  // the team's permission mode, recorded in team.json: the watchdog resumes each session in it. A
  // resumed session does not keep the mode it was started in (`claude --resume -p` came back in
  // default mode and stopped at approval prompts no one could answer), so every wake passes it.
  // (a recorded value is valid here: validateManifest refused the run otherwise)
  const permissionMode = modeFlag || team.permission_mode || 'auto';
  if (team.permission_mode !== permissionMode) {
    say(`  permission mode: ${permissionMode}; ${w}record it as permission_mode in ${TEAM_REL} (the watchdog wakes each session in it)`);
    if (!dryRun) {
      const raw = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
      raw.permission_mode = permissionMode;
      team.permission_mode = permissionMode;
      fs.writeFileSync(teamFile, formatManifestJson(raw));
      wroteManifest = true;
    }
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
  if (!run('bd', ['version'], { env }).ok) {
    say(`  beads: skipped: bd is not on PATH. Install it (${SETUP_DOC}), then run start.js again: it sets up beads and re-prepares the roles so each gets BEADS_DIR`);
  } else {
    setUpBeads({ projectRoot, prefix: team.prefix, env, dryRun, w, say, skipPublish: !!parsedImport });
    if (parsedImport && !importBeads({ projectRoot, parsed: parsedImport, env, dryRun, say })) return { code: 1, out };
  }
  if (productCheckout && fs.existsSync(path.join(productCheckout, '.beads'))) {
    say(`  beads: the product repo has its own beads workspace (${path.join(productCheckout, '.beads')}); it is not imported and nothing waits on it. The team's work items live in ${projectRoot}. To bring that backlog in, run \`bd export -o <file>\` there and pass the file with --import-beads <file>`);
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
    prepared.push({ instance, roleDir, host: role.host });
  }

  if (launch) {
    const launched = launchTeam({ projectRoot, prepared, host, permissionMode, env, dryRun, w, say });
    if (keepAlive) keepTeamAlive({ projectRoot, env, dryRun, w, say });
    if (launched.code) return { code: launched.code, out };
    say('');
    say('The team is starting: each role on this machine runs its first turn in its own role directory and joins the team (/delivery:team join); /delivery:team shows when each is live.');
    say(`  Talk to the Chief of Staff: cd ${path.join(teamDir, 'chief-of-staff')} && claude --continue${permissionMode && permissionMode !== 'default' ? ` --permission-mode ${permissionMode}` : ''}`);
    return { code: 0, out, teamDir, prepared, projectRoot };
  }
  say('');
  say(`${dryRun ? 'After a real run, start' : 'Start'} each session in its own terminal, the Chief of Staff first:`);
  for (const { instance, roleDir } of prepared) say(`  ${startCommand(roleDir, instance, permissionMode)}`);
  // auto by default: a team whose sessions ask the operator to approve each step puts the operator
  // to work as the team's approver, which is what the team exists to remove (team rule 0). The lane
  // hook and the native deny rules still bound what each role can do in any mode.
  say(permissionMode === 'default'
    ? '  (--permission-mode default: each session uses your own Claude Code default and may ask you to approve its steps)'
    : `  (--permission-mode ${permissionMode}: the sessions run without asking you to approve each step; the lane hook still limits what each role can do. Pass --permission-mode default to be asked instead)`);
  say('');
  say('Then:');
  say('  1. In every session, run /delivery:team join.');
  say('  2. Open the Chief of Staff session and talk to it for decisions and logistics; talk with the Product Manager about product vision.');
  say('  3. /delivery:team shows who is live; ask the Chief of Staff for the question ledger to see every decision.');
  return { code: 0, out, teamDir, prepared, projectRoot };
}

// ---- CLI ----

const BOOLEAN = new Set(['check', 'dry-run', 'help', 'reality-checker', 'launch', 'keep-alive']);
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
       start.js --project <root> [--host <name>] [--preset minimal|full] [--models quality|balanced|economy] [--reality-checker] [--product-repo <path|url>] [--prefix <bd prefix>]
                [--runner superpowers|attractor|plain] [--permission-mode <mode>] [--team-dir <dir>] [--user <name>] [--launch [--keep-alive]] [--import-beads <file>] [--dry-run]`;

const KNOWN = new Set(['check', 'dry-run', 'help', 'reality-checker', 'launch', 'keep-alive', 'project', 'host', 'preset', 'models', 'product-repo', 'prefix', 'runner', 'permission-mode', 'team-dir', 'user', 'import-beads']);

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
      runner: flags.runner, permissionMode: flags['permission-mode'], teamDir: flags['team-dir'], user: flags.user, dryRun: !!flags['dry-run'], env, realityChecker: !!flags['reality-checker'], launch: !!flags.launch, keepAlive: !!flags['keep-alive'], importBeads: flags['import-beads'],
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

module.exports = { doltUrlOf, githubOf, presetRoles, unscriptableSurfaces, MODEL_PRESETS, main, checkPrerequisites, formatCheck, scaffold, buildManifest, PRESETS, MIN_CLAUDE, MIN_NODE_MAJOR };
