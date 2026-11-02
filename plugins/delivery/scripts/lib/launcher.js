// scripts/lib/launcher.js — a version-independent way to name the plugin's scripts.
//
// Why: Claude Code installs a plugin under <config>/plugins/cache/<marketplace>/delivery/<version>/, so
// every install moves the scripts. A brief, a remembered command or a reality-check step that names
// .../delivery/<version>/scripts/<x>.js breaks at the next install (the lane refuses the old path and the
// old directory is deleted). A role session's Bash has no CLAUDE_PLUGIN_ROOT either. So each project gets
// one small launcher, <project>/.delivery/bin/delivery.js, that finds the installed plugin when it runs
// (the same ranking the watchdog job shim uses) and runs scripts/<x>.js there:
//   node <project>/.delivery/bin/delivery.js operator.js verify <id>
// The launcher's bytes do not depend on the plugin version (a cache install embeds no path), so an
// install does not rewrite it, and a guard can trust it only when it is byte-identical to what this
// module would write: an edited launcher is never trusted.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shellPath } = require('./plugin-root.js');

const LAUNCHER_REL = path.join('.delivery', 'bin', 'delivery.js');
// a script name the launcher runs: one file directly under scripts/, never a path (no testing/, no ..)
const SCRIPT_NAME = /^[a-z0-9][a-z0-9-]*\.js$/;

// The plugin root to run now. A checkout (atInstall outside the Claude plugin cache) stays where it is;
// otherwise installed_plugins.json is read each time: an install local to the project wins, then the
// user's own, then the newest version (an older install local to one role directory is never chosen:
// the job once ran 0.43.0 after 0.43.3 shipped). Falls back to atInstall when it still exists.
// This function's source is copied into the watchdog job shim and the launcher (toString), so it must
// stay self-contained: only fs, os and path, no other module-level name.
function resolveInstalledRoot({ project, atInstall, configDir }) {
  const ok = (p) => !!p && fs.existsSync(path.join(p, 'scripts', 'watchdog.js'));
  const cache = path.join(configDir || path.join(os.homedir(), '.claude'), 'plugins');
  if (ok(atInstall) && !atInstall.startsWith(cache + path.sep)) return atInstall;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cache, 'installed_plugins.json'), 'utf8'));
    for (const [k, v] of Object.entries(j.plugins || j)) {
      if (!/^delivery@/.test(k)) continue;
      const rank = (e) => (e.projectPath && project && path.resolve(e.projectPath) === path.resolve(project) ? 0 : e.scope === 'user' ? 1 : 2);
      const ver = (e) => String(e.version || '').split('.').map((n) => parseInt(n, 10) || 0);
      const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
      const found = (Array.isArray(v) ? v : [v]).filter((e) => e && ok(e.installPath)).sort((a, b) => rank(a) - rank(b) || newer(a, b));
      if (found.length) return found[0].installPath;
    }
  } catch (err) { /* fall back below */ }
  return ok(atInstall) ? atInstall : null;
}

const configOf = (configDir) => configDir || process.env.CLAUDE_CONFIG_DIR || null;
// A checkout is embedded (it does not move); a cache install is not (it moves at every install, and
// embedding it would make each version write different launcher bytes).
function checkoutRoot(pluginRoot, configDir) {
  if (!pluginRoot) return null;
  const root = path.resolve(pluginRoot);
  const cache = path.join(configDir || path.join(os.homedir(), '.claude'), 'plugins');
  return root.startsWith(cache + path.sep) ? null : root;
}

function launcherPath(projectRoot) { return path.join(path.resolve(projectRoot), LAUNCHER_REL); }

function launcherBody(projectRoot, pluginRoot, configDir) {
  const config = configOf(configDir);
  return `#!/usr/bin/env node
// written by the delivery plugin for ${path.resolve(projectRoot)}; do not edit (an edited launcher is refused).
// Runs scripts/<name>.js of the delivery plugin installed now, so a command naming it survives plugin
// installs: node ${LAUNCHER_REL.split(path.sep).join('/')} <name>.js [args...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const PROJECT = ${JSON.stringify(path.resolve(projectRoot))};
const AT_INSTALL = ${JSON.stringify(checkoutRoot(pluginRoot, config))};
const AT_CONFIG = ${JSON.stringify(config)};
if (AT_CONFIG && !process.env.CLAUDE_CONFIG_DIR) process.env.CLAUDE_CONFIG_DIR = AT_CONFIG;
${resolveInstalledRoot.toString()}
const name = process.argv[2];
if (!name || !${SCRIPT_NAME.toString()}.test(name)) { console.error('delivery launcher: name one plugin script, as: node ' + process.argv[1] + ' operator.js verify <id>'); process.exit(2); }
const root = resolveInstalledRoot({ project: PROJECT, atInstall: AT_INSTALL, configDir: process.env.CLAUDE_CONFIG_DIR });
if (!root) { console.error('delivery launcher: the delivery plugin is not installed'); process.exit(2); }
const script = path.join(root, 'scripts', name);
if (!fs.existsSync(script)) { console.error('delivery launcher: the delivery plugin at ' + root + ' has no scripts/' + name); process.exit(2); }
const r = require('child_process').spawnSync(process.execPath, [script, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`;
}

// Writes the launcher (and a .gitignore beside it: the launcher holds this machine's absolute paths, so
// it is never committed) only when its content differs. Never throws: returns a problem string or null.
function ensureLauncher(projectRoot, pluginRoot, configDir) {
  try {
    if (!projectRoot || !path.isAbsolute(String(projectRoot))) return 'no absolute project root';
    const file = launcherPath(projectRoot);
    const body = launcherBody(projectRoot, pluginRoot, configDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ignore = path.join(path.dirname(file), '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch (err) { old = null; }
    if (old !== body) {
      // a new file then a rename: a session running the launcher never reads a half-written one
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, body, { mode: 0o755 });
      fs.renameSync(tmp, file);
    }
    fs.chmodSync(file, 0o755);
    return null;
  } catch (err) {
    return `cannot write the script launcher (${err && err.message ? err.message : err})`;
  }
}

// The plugin root this project's launcher runs now, or null. Only a launcher byte-identical to the one
// this module writes for this project and configuration is trusted: anyone can edit the file, and a
// guard that read the edited one would judge one script while another runs.
function resolveLauncher(projectRoot, pluginRoot, configDir) {
  try {
    if (!projectRoot || !path.isAbsolute(String(projectRoot))) return null;
    const config = configOf(configDir);
    if (fs.readFileSync(launcherPath(projectRoot), 'utf8') !== launcherBody(projectRoot, pluginRoot, config)) return null;
    return resolveInstalledRoot({ project: path.resolve(projectRoot), atInstall: checkoutRoot(pluginRoot, config), configDir: config });
  } catch (err) {
    return null;
  }
}

function launcherCommand(projectRoot, script) { return `node ${shellPath(launcherPath(projectRoot))} ${script}`; }

module.exports = { LAUNCHER_REL, SCRIPT_NAME, resolveInstalledRoot, checkoutRoot, launcherPath, launcherBody, ensureLauncher, resolveLauncher, launcherCommand };
