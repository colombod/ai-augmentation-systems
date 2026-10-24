#!/usr/bin/env node
// map-spike.js -- research spike for the feature-map initiative. NOT shipped code.
//
// Question it answers: built only from the repository's real files at a given git revision,
// what is shipped (entry points), what backs it (the files it reaches), how it integrates
// (typed edges), and would a feature-level blast radius have caught the 6883fee break that
// silently stopped the invocation ledger (R-brief-2)?
//
// Why read git objects instead of the working tree: a replay must see the code exactly as it
// was before the breaking commit (record-invocation.js searched DOWNWARD then, upward now).
//
// Usage:
//   node map-spike.js summary [--rev <rev>]
//   node map-spike.js feature <feature-id> [--rev <rev>]
//   node map-spike.js impact --commit <sha> [--no-runtime]   (maps at <sha>^, changes = <sha>)
//   node map-spike.js impact --files a,b,c [--rev <rev>]
//   node map-spike.js json [--rev <rev>]

'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, input) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 1 << 28 });

// ---------- read a revision ----------
function readRev(rev) {
  const files = git(['ls-tree', '-r', '--name-only', rev, 'plugins']).split('\n').filter(Boolean);
  const textual = files.filter((f) => /\.(js|mjs|cjs|ts|md|json)$/.test(f) && !f.endsWith('dist/attractor.js'));
  const out = git(['cat-file', '--batch'], textual.map((f) => `${rev}:${f}`).join('\n') + '\n');
  const content = new Map();
  let i = 0;
  for (const f of textual) {
    const nl = out.indexOf('\n', i);
    const header = out.slice(i, nl).split(' ');
    const size = Number(header[2]);
    // byte length: slice by bytes through Buffer to stay exact for non-ASCII files
    const buf = Buffer.from(out.slice(nl + 1));
    const body = buf.subarray(0, size).toString('utf8');
    content.set(f, body);
    i = nl + 1 + body.length + 1;
  }
  return { rev, files, content };
}

// ---------- classify what a file is ----------
const pluginOf = (f) => (f.split('/')[1] || '');
function kindOf(f) {
  const p = f.split('/').slice(2).join('/');
  if (/^\.delivery\/|^\.superpowers\//.test(p)) return 'record';
  if (/\.test\.(js|ts)$|(^|\/)test\//.test(p)) return 'test';
  if (/^skills\/[^/]+\/SKILL\.md$/.test(p)) return 'skill';
  if (/^skills\//.test(p)) return 'skill-asset';
  if (/^agents\/[^/]+\.md$/.test(p)) return 'agent';
  if (/^roles\/[^/]+\.md$/.test(p)) return 'role';
  if (/^commands\//.test(p)) return 'command';
  if (/^hooks\/hooks\.json$/.test(p)) return 'hook-wiring';
  if (/^hooks\//.test(p)) return 'hook-script';
  if (/^templates\//.test(p)) return 'template';
  if (/^references\/|^docs\/|README\.md$|AGENTS\.md$|NOTICE/.test(p)) return 'doc';
  if (/^\.claude-plugin\/|\.mcp\.json$|package\.json$/.test(p)) return 'manifest';
  if (/^dist\//.test(p)) return 'build-output';
  if (/^scripts\/lib\//.test(p) || /^engine\/src\//.test(p)) return 'library';
  if (/^scripts\/[^/]+\.js$/.test(p)) return 'cli';
  if (/\.(js|ts|mjs|cjs)$/.test(p)) return 'code';
  return 'other';
}

// ---------- extract edges, each with the evidence that produced it ----------
function resolveRel(from, spec, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const cands = [base, base + '.js', base + '.ts', base.replace(/\.js$/, '.ts'), base + '/index.js', base + '/index.ts'];
  return cands.find((c) => files.has(c)) || null;
}

function extract(snap) {
  const files = new Set(snap.files);
  const edges = []; // { from, to, rel, evidence }
  const add = (from, to, rel, evidence) => { if (to && to !== from) edges.push({ from, to, rel, evidence }); };
  const patterns = new Map(); // dot-dir name -> [{ file, evidence }]
  const dangling = []; // references to files git does not hold
  // top-level CLI scripts by plugin and basename, for prose mentions (only unambiguous names)
  const scriptsByName = new Map();
  for (const f of files) {
    if (!['cli', 'hook-script'].includes(kindOf(f)) || !f.endsWith('.js')) continue;
    const key = `${pluginOf(f)}/${path.posix.basename(f)}`;
    scriptsByName.set(key, scriptsByName.has(key) ? null : f);
  }

  for (const [f, src] of snap.content) {
    const plugin = pluginOf(f);
    const proot = `plugins/${plugin}`;
    const k = kindOf(f);
    if (k === 'record') continue;

    if (/\.(js|mjs|cjs|ts)$/.test(f)) {
      // require('./x') and import ... from './x'
      for (const m of src.matchAll(/(?:require\(\s*|from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        add(f, resolveRel(f, m[1], files), kindOf(f) === 'test' ? 'tests' : 'uses', `import ${m[1]}`);
      }
      // require(path.join(__dirname, '..', 'lib', 'x.js')) -- the plugin's common shape
      for (const m of src.matchAll(/path\.(?:join|resolve)\(\s*__dirname\s*,([^)]*)\)/g)) {
        const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
        if (parts.length) add(f, resolveRel(f, './' + parts.join('/'), files), 'uses', `path.join(__dirname, ${parts.join(', ')})`);
      }
      // RUNTIME REACH: code that discovers directories by name at run time. A change that
      // creates or moves a directory of that name anywhere reaches this code with no code edge.
      if (/readdirSync|readdir\(|existsSync|statSync|opendir/.test(src)) {
        for (const m of src.matchAll(/(?:path\.join\([^)]*?|===\s*|name\s*===\s*)['"](\.[a-z][\w-]*)['"]/g)) {
          const name = m[1];
          if (name === '.js' || name === '.md' || name === '.json' || name === '.ts') continue;
          if (!patterns.has(name)) patterns.set(name, []);
          if (!patterns.get(name).some((x) => x.file === f)) patterns.get(name).push({ file: f, evidence: m[0].slice(0, 60) });
        }
      }
    }

    if (/\.(md|json)$/.test(f)) {
      // ${CLAUDE_PLUGIN_ROOT}/... and ${PLUGIN_ROOT}/... -- how skills, roles and hooks reach scripts.
      // A reference to a file git does not hold is a broken shipped link: record it, never drop it.
      for (const m of src.matchAll(/\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}\/([\w./<>-]+)/g)) {
        const rel = m[1].replace(/[.,)]+$/, '');
        const target = `${proot}/${rel}`;
        const relType = k === 'hook-wiring' ? 'wires' : f.endsWith('.mcp.json') ? 'serves' : 'invokes';
        if (files.has(target)) add(f, target, relType, '${CLAUDE_PLUGIN_ROOT}/' + rel);
        else if (/\.\w+$/.test(rel) && !/[<>]/.test(rel)) dangling.push({ from: f, to: target, rel: relType });
      }
      // a script named in prose, `operator.js ledger`, with no root variable: weaker evidence
      if (f.endsWith('.md')) {
        for (const m of src.matchAll(/`(?:node\s+)?([\w-]+\.js)\b/g)) {
          const hit = scriptsByName.get(`${plugin}/${m[1]}`);
          if (hit && hit !== f) add(f, hit, 'mentions', `\`${m[1]}\` in prose`);
        }
      }
      // cross-plugin: another plugin's root variable (builder role -> attractor dist)
      for (const m of src.matchAll(/\$\{([A-Z]+)_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
        const other = m[1].toLowerCase();
        if (other === 'claude') continue;
        const target = `plugins/${other}/${m[2].replace(/[.,)]+$/, '')}`;
        if (files.has(target)) add(f, target, 'invokes-cross-plugin', '${' + m[1] + '_PLUGIN_ROOT}/' + m[2]);
      }
      // relative markdown links
      if (f.endsWith('.md')) {
        for (const m of src.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
          add(f, resolveRel(f, m[1], files), 'documents', `link ${m[1]}`);
        }
      }
    }

    // build: dist is produced from the engine entry (package.json build script)
    if (f.endsWith('package.json') && /esbuild\s+(\S+)[^"]*--outfile=(\S+?)['" ]/.test(src)) {
      const m = /esbuild\s+(\S+)[^"]*--outfile=(\S+?)['" ]/.exec(src);
      const dir = path.posix.dirname(f);
      const entry = path.posix.normalize(`${dir}/${m[1]}`);
      const out = path.posix.normalize(`${dir}/${m[2]}`);
      if (files.has(out)) add(out, entry, 'built-from', `esbuild ${m[1]} --outfile=${m[2]}`);
    }
  }
  // a pattern node per discovered directory name
  for (const [name, users] of patterns) {
    for (const u of users) add(u.file, `pattern:${name}/`, 'discovers-at-runtime', u.evidence);
  }
  return { edges, patterns, dangling };
}

// ---------- features: what is shipped, from the real entry points ----------
function features(snap) {
  const out = [];
  for (const f of snap.files) {
    const plugin = pluginOf(f);
    const k = kindOf(f);
    const rest = f.split('/').slice(2).join('/');
    if (k === 'skill') out.push({ id: `${plugin}:${rest.split('/')[1]}`, kind: 'skill', entry: [f], plugin });
    else if (k === 'role') out.push({ id: `${plugin}:role:${path.posix.basename(f, '.md')}`, kind: 'role session', entry: [f], plugin });
    else if (k === 'agent') out.push({ id: `${plugin}:agent:${path.posix.basename(f, '.md')}`, kind: 'reviewer agent', entry: [f], plugin });
    else if (k === 'command') out.push({ id: `${plugin}:/${path.posix.basename(f, '.md')}`, kind: 'command', entry: [f], plugin });
    else if (k === 'build-output') out.push({ id: `${plugin}:cli`, kind: 'cli (built)', entry: [f], plugin });
  }
  // MCP servers a plugin ships (.mcp.json): a feature even when its bundle is missing
  for (const [f, src] of snap.content) {
    if (!f.endsWith('.mcp.json')) continue;
    let j; try { j = JSON.parse(src); } catch { continue; }
    for (const name of Object.keys(j.mcpServers || {})) out.push({ id: `${pluginOf(f)}:mcp:${name}`, kind: 'mcp server', entry: [f], plugin: pluginOf(f) });
  }
  // hooks: one feature per (event, script)
  for (const [f, src] of snap.content) {
    if (kindOf(f) !== 'hook-wiring') continue;
    let j; try { j = JSON.parse(src); } catch { continue; }
    const plugin = pluginOf(f);
    for (const [event, groups] of Object.entries(j.hooks || {})) {
      for (const g of groups) for (const h of g.hooks || []) {
        const s = [h.command, ...(h.args || [])].join(' ');
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/.exec(s);
        if (!m) continue;
        const script = `plugins/${plugin}/${m[1]}`;
        const id = `${plugin}:hook:${event}:${path.posix.basename(script, '.js')}`;
        if (!out.some((x) => x.id === id)) out.push({ id, kind: `hook (${event}${g.matcher ? ' ' + g.matcher : ''})`, entry: [script], plugin });
      }
    }
  }
  return out;
}

// ---------- graph queries ----------
function build(rev, opts = {}) {
  const snap = readRev(rev);
  const { edges, patterns, dangling } = extract(snap);
  const use = opts.noRuntime ? edges.filter((e) => e.rel !== 'discovers-at-runtime') : edges;
  const fwd = new Map(), rev_ = new Map();
  for (const e of use) {
    if (e.rel === 'documents') continue; // docs describe, they do not execute: no reach
    if (!fwd.has(e.from)) fwd.set(e.from, []); fwd.get(e.from).push(e);
    if (!rev_.has(e.to)) rev_.set(e.to, []); rev_.get(e.to).push(e);
  }
  const feats = features(snap);
  // backing set of each feature: everything reachable from its entry points
  for (const ft of feats) {
    const seen = new Map(ft.entry.map((x) => [x, null]));
    const q = [...ft.entry];
    while (q.length) {
      const n = q.shift();
      for (const e of fwd.get(n) || []) if (!seen.has(e.to)) { seen.set(e.to, e); q.push(e.to); }
    }
    ft.backing = seen;
  }
  // fan-in: how many features reach each node (hubs light up every radius)
  const fanIn = new Map();
  for (const ft of feats) for (const n of ft.backing.keys()) fanIn.set(n, (fanIn.get(n) || 0) + 1);
  return { snap, edges: use, allEdges: edges, patterns, dangling, feats, fanIn, fwd, rev: rev_ };
}

function chain(ft, node) {
  const steps = [];
  let n = node;
  while (ft.backing.get(n)) { const e = ft.backing.get(n); steps.unshift(`${e.from} -[${e.rel}: ${e.evidence}]-> ${e.to}`); n = e.from; }
  return steps;
}

function impact(g, changed, after) {
  // a changed path hits: itself, and every runtime pattern whose name is one of its segments
  // Runtime reach fires only when the change makes a directory of a discovered name appear or
  // disappear: editing a file inside an existing .delivery/ changes nothing the search sees.
  const hits = new Map();
  const before = new Set(g.snap.files);
  const dirExisted = (dir) => [...before].some((f) => f.startsWith(dir + '/'));
  for (const c of changed) {
    hits.set(c, `changed ${c}`);
    const seg = c.split('/');
    for (const name of g.patterns.keys()) {
      const i = seg.indexOf(name);
      if (i < 0) continue;
      const dir = seg.slice(0, i + 1).join('/');
      const existedBefore = dirExisted(dir);
      const existsAfter = after ? after(dir) : true;
      if (existedBefore !== existsAfter) hits.set(`pattern:${name}/`, `${existsAfter ? 'creates' : 'removes'} directory ${dir}/ (via ${c})`);
    }
  }
  const reached = [];
  for (const ft of g.feats) {
    for (const [node, why] of hits) {
      if (!ft.backing.has(node)) continue;
      reached.push({ feature: ft.id, kind: ft.kind, via: node, why, chain: chain(ft, node), hub: (g.fanIn.get(node) || 0) });
      break;
    }
  }
  return reached;
}

// ---------- CLI ----------
function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; }
const cmd = process.argv[2];
if (require.main === module) {
  if (cmd === 'summary' || cmd === 'json') {
    const g = build(arg('--rev', 'HEAD'));
    const byRel = {}; for (const e of g.allEdges) byRel[e.rel] = (byRel[e.rel] || 0) + 1;
    const byPlugin = {}; for (const f of g.feats) { byPlugin[f.plugin] = byPlugin[f.plugin] || {}; byPlugin[f.plugin][f.kind.split(' (')[0]] = (byPlugin[f.plugin][f.kind.split(' (')[0]] || 0) + 1; }
    const hubs = [...g.fanIn.entries()].filter(([n]) => !n.startsWith('pattern:')).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const orphans = g.snap.files.filter((f) => /\.(js|ts)$/.test(f) && !['test', 'record', 'build-output'].includes(kindOf(f)) && !(g.fanIn.get(f) > 0));
    const cross = g.allEdges.filter((e) => e.rel === 'invokes-cross-plugin');
    const res = { rev: g.snap.rev, files: g.snap.files.length, edges: byRel, features: byPlugin, hubs, runtimePatterns: Object.fromEntries([...g.patterns].map(([k, v]) => [k, v.map((x) => x.file)])), crossPlugin: cross.map((e) => `${e.from} -> ${e.to}`), danglingShippedReferences: g.dangling.map((d) => `${d.from} -[${d.rel}]-> ${d.to} (not in git)`), unreachedCode: orphans };
    if (cmd === 'json') { console.log(JSON.stringify({ ...res, featureList: g.feats.map((f) => ({ id: f.id, kind: f.kind, entry: f.entry, backing: [...f.backing.keys()] })) }, null, 2)); }
    else console.log(JSON.stringify(res, null, 2));
  } else if (cmd === 'feature') {
    const g = build(arg('--rev', 'HEAD'));
    const ft = g.feats.find((f) => f.id === process.argv[3]);
    if (!ft) { console.error('no such feature; try summary'); process.exit(2); }
    console.log(`${ft.id} (${ft.kind})`);
    for (const [n] of ft.backing) console.log(`  ${n}  [${n.startsWith('pattern:') ? 'runtime' : kindOf(n)}, fan-in ${g.fanIn.get(n)}]`);
  } else if (cmd === 'impact') {
    const commit = arg('--commit');
    const rev = commit ? `${commit}^` : arg('--rev', 'HEAD');
    const changed = commit ? git(['show', '--name-only', '--format=', commit]).split('\n').filter(Boolean) : String(arg('--files', '')).split(',').filter(Boolean);
    const g = build(rev, { noRuntime: process.argv.includes('--no-runtime') });
    const afterFiles = commit ? git(['ls-tree', '-r', '--name-only', commit, 'plugins']).split('\n') : null;
    const after = afterFiles ? (dir) => afterFiles.some((f) => f.startsWith(dir + '/')) : null;
    const r = impact(g, changed, after);
    console.log(JSON.stringify({ mappedAt: rev, changedFiles: changed.length, runtimeEdges: !process.argv.includes('--no-runtime'), featuresReached: r.length, reached: r }, null, 2));
  } else {
    console.error('usage: summary | json | feature <id> | impact --commit <sha> [--no-runtime] | impact --files a,b');
    process.exit(2);
  }
}
module.exports = { build, impact, kindOf, readRev, extract, features };
