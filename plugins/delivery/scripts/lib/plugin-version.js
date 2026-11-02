// scripts/lib/plugin-version.js — which version of this plugin is running, and which one a session ran.
//
// A plugin install puts each version in its own directory (<cache>/<marketplace>/delivery/<version>/), and
// the lane judges a script path against the running plugin root. A role session that ran an older
// version remembers that version's paths in its conversation, so resumed after an install it runs them
// and the new lane refuses them (delivery-plugin-planning-8wz). These helpers let the watchdog wake such
// a session fresh, and the lane name the current path when it refuses another version's.
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const VERSION = /^\d+\.\d+\.\d+$/;

// the version in a plugin root's .claude-plugin/plugin.json, or null
function runningVersion(root = PLUGIN_ROOT) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    return typeof v === 'string' && VERSION.test(v) ? v : null;
  } catch (err) { return null; }
}

// -1, 0 or 1 for two x.y.z versions; null when either is not one
function compare(a, b) {
  if (!VERSION.test(String(a)) || !VERSION.test(String(b))) return null;
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// The version of the last plugin script path in some text (a command a session ran), or null. Only the
// installed layout counts: .../delivery/<x.y.z>/scripts/... or .../hooks/...
const PATH_VERSION = /\/delivery\/(\d+\.\d+\.\d+)\/(?:scripts|hooks)\//g;
function versionInText(text) {
  let last = null;
  for (const m of String(text || '').matchAll(PATH_VERSION)) last = m[1];
  return last;
}

// A path into a sibling version directory of the running plugin root (<parent>/<other version>/<rest>):
// { version, rest, current } with current the same file under the running root, or null. Only when the
// running root itself is a version directory, so a development checkout never matches.
function otherVersionPath(p, pluginRoot) {
  if (!pluginRoot || !VERSION.test(path.basename(pluginRoot))) return null;
  const parent = `${path.dirname(path.resolve(pluginRoot))}${path.sep}`;
  const s = String(p || '');
  if (!s.startsWith(parent)) return null;
  const [version, ...rest] = s.slice(parent.length).split(path.sep);
  if (!VERSION.test(version) || version === path.basename(pluginRoot) || !rest.length) return null;
  return { version, rest: rest.join('/'), current: path.join(pluginRoot, ...rest) };
}

module.exports = { PLUGIN_ROOT, runningVersion, compare, versionInText, otherVersionPath };
