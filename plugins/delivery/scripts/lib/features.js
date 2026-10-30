// scripts/lib/features.js — the features a repository ships at one commit, and what a change reaches.
// A feature is something a user can start: a Claude Code plugin's skills, agents, commands and hooks;
// a package's command-line entry points; or a feature the team declares in .delivery/features.json
// ({ "features": [{ "id", "name", "anchors": ["path or glob", ...] }] }), which is how any project
// in any language names what it ships. Derived and declared features are listed apart, so an answer
// says where each came from.
const path = require('path');
const C = require('./codemap.js');

const REGISTER = '.delivery/features.json';

function globRe(glob) {
  const re = String(glob).split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${re}$`);
}

// [{ id, kind, source: 'derived' | 'declared', anchors: [paths], dangling: [specs] }]
function featuresOf(map, texts = map.texts) {
  const out = [];
  const files = new Set(map.files);
  for (const root of map.pluginRoots) {
    const pre = root ? `${root}/` : '';
    let name = path.posix.basename(root) || 'plugin';
    try { name = JSON.parse(texts[`${pre}.claude-plugin/plugin.json`]).name || name; } catch (err) { /* keep the folder name */ }
    for (const f of map.files) {
      if (!f.startsWith(pre)) continue;
      const rel = f.slice(pre.length);
      let m;
      if ((m = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel))) out.push({ id: `${name}:${m[1]}`, kind: 'skill', source: 'derived', anchors: [f] });
      else if ((m = /^agents\/([^/]+)\.md$/.exec(rel))) out.push({ id: `${name}:agent:${m[1]}`, kind: 'agent', source: 'derived', anchors: [f] });
      else if ((m = /^commands\/([^/]+)\.md$/.exec(rel))) out.push({ id: `${name}:command:${m[1]}`, kind: 'command', source: 'derived', anchors: [f] });
      // a team role brief (this plugin's own convention): a role session starts from it
      else if ((m = /^roles\/([^/]+)\.md$/.exec(rel))) out.push({ id: `${name}:role:${m[1]}`, kind: 'role', source: 'derived', anchors: [f] });
    }
    // each hook event is a feature, anchored at the scripts it runs
    const hooksFile = `${pre}hooks/hooks.json`;
    if (texts[hooksFile]) {
      try {
        const hooks = JSON.parse(texts[hooksFile]).hooks || {};
        for (const [event, groups] of Object.entries(hooks)) {
          const anchors = new Set();
          for (const g of groups || []) for (const h of g.hooks || []) {
            for (const mm of String(h.command || '').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/g)) {
              const p = `${pre}${mm[1]}`;
              if (files.has(p)) anchors.add(p);
            }
          }
          out.push({ id: `${name}:hook:${event}`, kind: 'hook', source: 'derived', anchors: anchors.size ? [...anchors] : [hooksFile] });
        }
      } catch (err) { /* unreadable hooks.json: no hook features, said by the anchors check */ }
    }
  }
  // package.json bin entries, anywhere in the tree
  for (const f of map.files.filter((x) => path.posix.basename(x) === 'package.json' && !x.includes('node_modules/'))) {
    let pkg;
    try { pkg = JSON.parse(texts[f]); } catch (err) { continue; }
    const dir = path.posix.dirname(f) === '.' ? '' : `${path.posix.dirname(f)}/`;
    const bins = typeof pkg.bin === 'string' ? { [pkg.name || 'bin']: pkg.bin } : (pkg.bin || {});
    for (const [b, p] of Object.entries(bins)) {
      const a = path.posix.normalize(`${dir}${p}`);
      out.push({ id: `${pkg.name || dir || 'package'}:bin:${b}`, kind: 'bin', source: 'derived', anchors: files.has(a) ? [a] : [], dangling: files.has(a) ? [] : [p] });
    }
  }
  // declared features: the team's names for what it ships, in any language
  const regFile = map.files.find((x) => x === REGISTER || x.endsWith(`/${REGISTER}`));
  if (regFile && texts[regFile]) {
    let reg;
    try { reg = JSON.parse(texts[regFile]); } catch (err) { reg = { features: [], error: err.message }; }
    for (const d of reg.features || []) {
      const anchors = [];
      const dangling = [];
      for (const a of d.anchors || []) {
        const hits = /[*]/.test(a) ? map.files.filter((x) => globRe(a).test(x)) : (files.has(a) ? [a] : []);
        if (hits.length) anchors.push(...hits); else dangling.push(a);
      }
      out.push({ id: d.id, name: d.name, kind: 'declared', source: 'declared', anchors: [...new Set(anchors)], dangling });
    }
  }
  return out;
}

// A path as the user typed it -> the repository path, or null. One file, one path: `./x`, a plugin-relative
// spelling and a unique suffix all name the same file (roadmap feature-map-03).
function canonicalPath(map, p) {
  const n = path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
  if (map.files.includes(n)) return { path: n };
  const hits = map.files.filter((f) => f.endsWith(`/${n}`));
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  return null;
}

// What changing `paths` reaches, from the feature's side, at map.sha.
function impact(map, feats, paths) {
  const changed = [];
  const unknown = [];
  const ambiguous = [];
  for (const p of paths) {
    const c = canonicalPath(map, p);
    if (!c) unknown.push(p);
    else if (c.ambiguous) ambiguous.push({ path: p, candidates: c.ambiguous });
    else changed.push(c.path);
  }
  const want = new Set(changed);
  const reached = [];
  const fanIn = new Map();
  for (const f of feats) {
    if (!f.anchors.length) continue;
    const r = C.reach(map, f.anchors);
    const hits = changed.filter((p) => r.has(p));
    for (const p of hits) fanIn.set(p, (fanIn.get(p) || 0) + 1);
    if (!hits.length) continue;
    const via = hits.map((p) => ({ path: p, hops: r.get(p).hops, chain: C.chainTo(r, p) })).sort((a, b) => a.hops - b.hops);
    reached.push({ id: f.id, kind: f.kind, source: f.source, hops: via[0].hops, via });
  }
  reached.sort((a, b) => a.hops - b.hops || a.id.localeCompare(b.id));
  const withAnchors = feats.filter((f) => f.anchors.length).length;
  const blindSet = new Set(map.blind);
  const unreached = changed.filter((p) => !fanIn.has(p));
  return {
    sha: map.sha,
    changed,
    unknown,
    ambiguous,
    reached,
    // a file most features reach is a hub: changing it reaches nearly everything, so the list says so
    hubs: [...fanIn].filter(([, n]) => withAnchors >= 4 && n / withAnchors >= 0.5).map(([p, n]) => ({ path: p, features: n })),
    // changed files no feature reaches: dead code, a feature nobody declared, or a reference no rule reads
    unreached: unreached.map((p) => ({ path: p, blind: blindSet.has(p) })),
    features: feats.length,
    blind: map.blind.length,
    analysed: map.analysed.length,
  };
}

// What retiring a feature would free, from the map: the files only it reaches (deletable with it) and
// the files other features also reach (retire the surface, keep the code), each with those features.
// From MJ's Market Fit: exclusive anchors are deletable, shared ones mean keep the code. The map shows
// reach, never use: whether anyone still uses the feature needs evidence from the product's own logs
// (Worth Using: no logs means instrument first, never retire), and deleting is the owner's decision.
function retirement(map, feats, id) {
  const f = feats.find((x) => x.id === id);
  if (!f) return { error: `no feature "${id}" at ${map.sha}`, known: feats.map((x) => x.id) };
  const mine = C.reach(map, f.anchors);
  const others = feats.filter((x) => x !== f && x.anchors.length).map((x) => ({ id: x.id, reached: C.reach(map, x.anchors) }));
  const exclusive = [];
  const shared = [];
  for (const file of [...mine.keys()].sort()) {
    const by = others.filter((o) => o.reached.has(file)).map((o) => o.id);
    if (by.length) shared.push({ path: file, features: by });
    else exclusive.push(file);
  }
  return { sha: map.sha, id: f.id, kind: f.kind, source: f.source, anchors: f.anchors, exclusive, shared };
}

module.exports = { featuresOf, impact, retirement, canonicalPath, REGISTER, globRe };
