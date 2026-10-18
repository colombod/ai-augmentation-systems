// scripts/lib/plugin-root.js — turn the literal ${CLAUDE_PLUGIN_ROOT} in text the plugin injects into a
// role session into the resolved absolute plugin root.
//
// Why: the harness substitutes ${CLAUDE_PLUGIN_ROOT} for hook commands, but a role session's own Bash
// does not have it set, so a brief that says `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js verify`
// runs `node /scripts/operator.js` and fails. Every SessionStart re-renders the brief with the
// plugin root of the running hook, so a plugin-cache version move is picked up.
const path = require('path');

// A shell word for an absolute path: bare when it is plainly safe, else single-quoted ('\'' for a ').
function shellPath(p) {
  const s = String(p);
  if (/^[A-Za-z0-9_\/.,+@%=:-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Replace ${CLAUDE_PLUGIN_ROOT} (and the path that follows it, up to whitespace, a backtick or a
// quote) with the absolute path, quoted as one shell word when it needs quoting.
function resolvePluginRoot(text, pluginRoot) {
  if (!pluginRoot) return String(text);
  const root = path.resolve(pluginRoot);
  return String(text).replace(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s`'"]*)/g, (m, rest) => shellPath(root + rest));
}

// The command prefix for operator.js, exactly as briefs, notes and hook reasons print it.
function operatorCommand(pluginRoot) {
  return `node ${shellPath(path.join(path.resolve(pluginRoot), 'scripts', 'operator.js'))}`;
}

module.exports = { shellPath, resolvePluginRoot, operatorCommand };
