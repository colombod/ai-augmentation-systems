// scripts/lib/version-gate.js — a pull request that changes a plugin must raise that plugin's version.
//
// Why: an installed plugin updates only when its version moves. Two pull requests had both bumped to
// the same version; the second merged after the first had already put that version on main, so main
// held new code at a version already installed, and the self-update saw nothing to install. A change
// that never installs is never checked on the customer's surface either. So the gate reads, for each
// plugin the pull request touches, `.claude-plugin/plugin.json` at the pull request's head and on its
// base branch, and refuses unless the head's version is greater.
//
// A plugin is a directory named plugins/<name> (at any depth) whose plugin.json exists on the base
// branch; a product with no such directory is never asked. A read that fails is a refusal, never a pass.
//
// The marketplace that lists the plugin (.claude-plugin/marketplace.json beside the plugins directory)
// carries the version too, and an install reads it from there (8l1.5): a head that raised plugin.json
// but left the marketplace entry at main's version, or gave the two different numbers, passed. So when
// the base's marketplace lists the plugin with a version, the head's entry must equal the head's
// plugin.json and be above the base's entry. A repository with no marketplace, or an entry without a
// version, asks nothing more.

const PLUGIN_DIR = /^((?:.*\/)?plugins\/[^/]+)\//;
const MANIFEST = '.claude-plugin/plugin.json';
const MARKETPLACE = '.claude-plugin/marketplace.json';

// the marketplace beside a plugins directory: plugins/app -> .claude-plugin/marketplace.json,
// vendor/plugins/b -> vendor/.claude-plugin/marketplace.json
function marketplaceOf(dir) {
  const root = dir.replace(/(?:^|\/)plugins\/[^/]+$/, '');
  return root ? `${root}/${MARKETPLACE}` : MARKETPLACE;
}

// a plugin's entry version in a marketplace's text: the version string, null for an entry with none,
// undefined for no entry, false for text that is not a marketplace
function entryVersion(text, name) {
  let j;
  try { j = JSON.parse(text); } catch (err) { return false; }
  if (!j || !Array.isArray(j.plugins)) return false;
  const e = j.plugins.find((x) => x && x.name === name);
  if (!e) return undefined;
  return typeof e.version === 'string' ? e.version : null;
}

function nameOf(text) {
  try { const j = JSON.parse(text); return typeof j.name === 'string' && j.name ? j.name : null; } catch (err) { return null; }
}

// the marketplace side of one plugin's step: null when it holds, else the refusal
function marketplaceStep({ dir, file, name, head, headRef, baseRef, read }) {
  const mfile = marketplaceOf(dir);
  const mb = read(mfile, baseRef);
  if (mb.unavailable) return { ok: false, dir, why: `${mfile} on ${baseRef} could not be read (${mb.unavailable}), so the version step cannot be checked` };
  if (mb.missing) return null;
  const base = entryVersion(mb.text, name);
  if (base === false) return { ok: false, dir, why: `${mfile} on ${baseRef} is not a readable marketplace, so the version step cannot be checked` };
  if (base === undefined || base === null || !parse(base)) return null;
  const mh = read(mfile, headRef);
  if (mh.unavailable) return { ok: false, dir, why: `${mfile} at the head could not be read (${mh.unavailable}), so the version step cannot be checked` };
  if (mh.missing) return { ok: false, dir, base, why: `${mfile} is gone at the head, while ${baseRef} lists ${name} at ${base}` };
  const at = entryVersion(mh.text, name);
  if (at === false || at === undefined || at === null || !parse(at)) return { ok: false, dir, base, why: `${mfile} at the head lists no valid version for ${name}, while ${baseRef} lists ${base}` };
  if (compare(parse(at), parse(head)) !== 0) return { ok: false, dir, base, head, why: `${mfile} lists ${name} at ${at} at the head while ${file} is at ${head}: the two must name the same version` };
  if (compare(parse(at), parse(base)) <= 0) return { ok: false, dir, base, head: at, why: `${mfile} lists ${name} at ${at} at the head, not above ${base} on ${baseRef}, so the merged change would never install` };
  return null;
}

// The plugin directories a list of changed paths reaches, in first-seen order.
function pluginDirs(paths) {
  const out = [];
  for (const p of paths || []) {
    const m = PLUGIN_DIR.exec(String(p || ''));
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// x.y.z with an optional -prerelease, compared numerically; a prerelease sorts below its release.
// null when the text is not a version.
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v == null ? '' : v).trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null } : null;
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] < b.n[i] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function versionOf(text) {
  try { const j = JSON.parse(text); return typeof j.version === 'string' ? j.version : null; } catch (err) { return null; }
}

// read(path, ref) -> { text } | { missing: true } | { unavailable: '<why>' }
// Returns { ok: true, checked: [{ dir, base, head }] } or { ok: false, why, dir, base, head }.
function checkVersions({ paths, headRef, baseRef, read }) {
  const checked = [];
  for (const dir of pluginDirs(paths)) {
    const file = `${dir}/${MANIFEST}`;
    const b = read(file, baseRef);
    if (b.unavailable) return { ok: false, dir, why: `${file} on ${baseRef} could not be read (${b.unavailable}), so the version step cannot be checked` };
    if (b.missing) continue; // not a plugin on the base branch (a new plugin starts at any version)
    const base = versionOf(b.text);
    // a base whose version cannot be read leaves nothing to compare against: a failed read, so a refusal
    const pb = parse(base);
    if (!pb) return { ok: false, dir, base, why: `${file} on ${baseRef} has no valid version (${base === null ? 'none' : JSON.stringify(base)}), so the version step cannot be checked` };
    const h = read(file, headRef);
    if (h.unavailable) return { ok: false, dir, why: `${file} at the head could not be read (${h.unavailable}), so the version step cannot be checked` };
    if (h.missing) return { ok: false, dir, base, why: `${file} is gone at the head, while ${baseRef} has ${base || 'no version'}` };
    const head = versionOf(h.text);
    const ph = parse(head);
    if (!ph) return { ok: false, dir, base, head, why: `${file} at the head has no valid version (${head === null ? 'none' : JSON.stringify(head)})` };
    if (compare(ph, pb) <= 0) {
      return { ok: false, dir, base, head, why: `${dir} is at ${head} at the head, not above ${base} on ${baseRef}, so the merged change would never install` };
    }
    const market = marketplaceStep({ dir, file, name: nameOf(h.text) || dir.split('/').pop(), head, headRef, baseRef, read });
    if (market) return market;
    checked.push({ dir, base, head });
  }
  return { ok: true, checked };
}

module.exports = { checkVersions, pluginDirs, parse, compare, marketplaceOf, MANIFEST, MARKETPLACE };
