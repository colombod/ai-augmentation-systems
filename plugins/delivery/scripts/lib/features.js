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
  const nameOf = (root) => {
    const pre = root ? `${root}/` : '';
    try { return JSON.parse(texts[`${pre}.claude-plugin/plugin.json`]).name || path.posix.basename(root) || 'plugin'; } catch (err) { return path.posix.basename(root) || 'plugin'; }
  };
  // two plugins with one name (the Vault ships plugins/the-vault and plugins/the-vault-openai, both
  // "the-vault") would list every feature twice under one id: such names carry their folder
  const counts = {};
  for (const r of map.pluginRoots) counts[nameOf(r)] = (counts[nameOf(r)] || 0) + 1;
  for (const root of map.pluginRoots) {
    const pre = root ? `${root}/` : '';
    const name = counts[nameOf(root)] > 1 ? `${nameOf(root)}@${root || '.'}` : nameOf(root);
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
  out.push(...entryPoints(map, texts));
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

// A product's own entry points, for any project: where its users and machines start.
//   web routes   @app.get("/x"), @router.post(...) (FastAPI, Flask), app.get('/x', ...) (Express):
//                one feature per file, naming its routes
//   MCP tools    Tool("name", ...), server.tool("name", ...), registerTool("name", ...): one per file
//   functions    vercel.json "functions", and api/ files where vercel.json exists (serverless entries)
//   workflows    .github/workflows/*.yml: each is started by a push, a schedule or a person
//   scripts      pyproject [project.scripts] console entry points
// Anchored at the file that declares them: a change reaching that file reaches those entries.
// the text with line comments blanked (`//` and block comments in JS, `#` in Python), keeping line
// numbers; strings are left as they are, so a URL's `//` inside quotes is not cut
function withoutComments(text, lang) {
  let out = '';
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i++; } else if (c === q || (c === '\n' && q !== '`')) q = null;
      continue;
    }
    const line = (lang === 'py' && c === '#') || (lang === 'js' && c === '/' && text[i + 1] === '/');
    if (line) { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } out += text[i] || ''; continue; }
    if (lang === 'js' && c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      const stop = e < 0 ? text.length : e + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    if (c === '"' || c === "'" || (lang === 'js' && c === '`')) q = c;
    out += c;
  }
  return out;
}

function entryPoints(map, texts) {
  const out = [];
  const files = new Set(map.files);
  const stem = (f) => f.replace(/\.[^./]+$/, '');
  // a test file is never the product's entry point, for its routes as for its tools: the Vault's
  // tests/test_twins.py starts an app with routes, and became a feature every sign-in change reached
  const isTest = (f) => /(^|\/)(tests?|__tests__)\//.test(f) || /(^|\/)(test_[^/]*|[^/]*_test\.py|conftest\.py)$|\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
  for (const [f, raw] of Object.entries(texts)) {
    const lang = C.langOf(f);
    // a route or tool written in a comment is an example, not an entry point (the map's own source
    // describes its patterns in comments and read as a route and a tool: found on a real story)
    const text = lang === 'py' || lang === 'js' ? withoutComments(raw, lang) : raw;
    if ((lang === 'py' || lang === 'js') && !isTest(f)) {
      const routes = [];
      for (const m of text.matchAll(/^[ \t]*@\w+(?:\.\w+)*\.(get|post|put|patch|delete|route|websocket|api_route)\(\s*(?:path\s*=\s*)?["']([^"']*)["']/gm)) routes.push(`${m[1].toUpperCase()} ${m[2] || '/'}`);
      for (const m of text.matchAll(/\b(?:app|router|server)\.(get|post|put|patch|delete|all|use)\(\s*["'](\/[^"']*)["']/g)) routes.push(`${m[1].toUpperCase()} ${m[2]}`);
      if (routes.length) out.push({ id: `http:${stem(f)}`, kind: 'routes', source: 'derived', anchors: [f], entries: [...new Set(routes)] });
      const tools = [];
      for (const m of text.matchAll(/(?:^|[^\w.])Tool\(\s*["'](\w+)["']/g)) tools.push(m[1]);
      for (const m of text.matchAll(/\.(?:tool|registerTool|addTool)\(\s*["'](\w+)["']/g)) tools.push(m[1]);
      if (tools.length) out.push({ id: `tools:${stem(f)}`, kind: 'tools', source: 'derived', anchors: [f], entries: [...new Set(tools)] });
    }
    if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(f)) {
      const name = (/^name:\s*["']?([^"'\n]+)/m.exec(text) || [])[1];
      out.push({ id: `ci:${path.posix.basename(f).replace(/\.ya?ml$/, '')}`, kind: 'workflow', source: 'derived', anchors: [f], entries: name ? [name.trim()] : [] });
    }
  }
  for (const v of map.files.filter((x) => path.posix.basename(x) === 'vercel.json')) {
    const dir = path.posix.dirname(v) === '.' ? '' : `${path.posix.dirname(v)}/`;
    let conf = {};
    try { conf = JSON.parse(texts[v]); } catch (err) { conf = {}; }
    const fns = new Set(Object.keys(conf.functions || {}).map((k) => `${dir}${k}`).filter((k) => files.has(k)));
    for (const f of map.files) if (f.startsWith(`${dir}api/`) && /\.(py|js|ts|mjs|go|rb)$/.test(f)) fns.add(f);
    for (const f of fns) out.push({ id: `function:${stem(f)}`, kind: 'function', source: 'derived', anchors: [f] });
  }
  for (const p of map.files.filter((x) => path.posix.basename(x) === 'pyproject.toml')) {
    const sec = /^\[project\.scripts\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(texts[p] || '');
    if (!sec) continue;
    const dir = path.posix.dirname(p) === '.' ? '' : `${path.posix.dirname(p)}/`;
    for (const m of sec[1].matchAll(/^\s*["']?([\w.-]+)["']?\s*=\s*["']([\w.]+)(?::\w+)?["']/gm)) {
      const rel = m[2].split('.').join('/');
      const hit = [`${dir}${rel}.py`, `${dir}src/${rel}.py`, `${dir}${rel}/__init__.py`, `${dir}src/${rel}/__init__.py`].find((c) => files.has(c));
      out.push({ id: `script:${m[1]}`, kind: 'script', source: 'derived', anchors: hit ? [hit] : [], dangling: hit ? [] : [m[2]] });
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
  const withAnchors = feats.filter((f) => f.anchors.length);
  const reaches = withAnchors.map((f) => ({ f, r: C.reach(map, f.anchors) }));
  // fan-in of every file: how many features reach it. A file a fifth or more of the features reach
  // (and at least three) is a hub, like a shared config or a core library: reach through it is real
  // but says little, so features reached only through a hub are counted apart, not listed one by one.
  const fanIn = new Map();
  for (const { r } of reaches) for (const file of r.keys()) fanIn.set(file, (fanIn.get(file) || 0) + 1);
  const isHub = (file) => (fanIn.get(file) || 0) >= Math.max(3, Math.ceil(withAnchors.length * 0.2));
  const reached = [];
  for (const { f, r } of reaches) {
    const hits = changed.filter((p) => r.has(p));
    if (!hits.length) continue;
    const via = hits.map((p) => {
      const chain = C.chainTo(r, p);
      // a doc is a leaf, never a hub: changing one changes no behaviour
      const hub = [p, ...chain.map((st) => st.from)].find((x) => !f.anchors.includes(x) && C.langOf(x) !== 'doc' && isHub(x)) || null;
      return { path: p, hops: r.get(p).hops, chain, hub };
    }).sort((a, b) => a.hops - b.hops);
    const direct = via.filter((v) => !v.hub);
    reached.push({ id: f.id, kind: f.kind, source: f.source, hops: via[0].hops, via, viaHub: direct.length ? null : via[0].hub });
  }
  reached.sort((a, b) => a.hops - b.hops || a.id.localeCompare(b.id));
  const blindSet = new Set(map.blind);
  const unreached = changed.filter((p) => !fanIn.has(p));
  return {
    sha: map.sha,
    changed,
    unknown,
    ambiguous,
    reached,
    // changed files that are hubs: changing one reaches much of the product, so the answer says so
    hubs: changed.filter((p) => isHub(p) && C.langOf(p) !== 'doc').map((p) => ({ path: p, features: fanIn.get(p) })),
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
