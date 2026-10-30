// scripts/lib/codemap.js — the code map behind the feature map: files at one commit, the edges between
// them with file:line evidence, and the files no rule can read (blind spots, always reported).
// The owner's ask (2026-10-24): "a feature to code map helping understanding blast radius from feature
// point of view before hitting the code". Any user, any project, any language: each language has a small
// import rule; a mention rule (a token in a doc or config file that names an existing file) covers what
// no import rule does; whatever is left is listed as blind, never silently skipped.
// Everything is read from git at a resolved 40-hex commit, never the working tree, so an answer names
// exactly what it describes.
const { spawnSync } = require('child_process');
const path = require('path');

const MAX_BYTES = 1024 * 1024;

function git(repo, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: repo, encoding: opts.encoding === null ? null : 'utf8', input: opts.input, maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
}

// any ref or SHA -> the 40-hex (or 64-hex) commit it names
function resolveCommit(repo, ref = 'HEAD') {
  return String(git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
}

function listFiles(repo, sha) {
  return String(git(repo, ['ls-tree', '-r', '-z', '--name-only', sha])).split('\0').filter(Boolean);
}

// { path: text } for the given paths at sha, in one git process; binary and huge files are left out
function readFiles(repo, sha, paths) {
  if (!paths.length) return {};
  const out = git(repo, ['cat-file', '--batch'], { input: paths.map((p) => `${sha}:${p}`).join('\n') + '\n', encoding: null });
  const files = {};
  let i = 0;
  for (const p of paths) {
    const nl = out.indexOf(10, i);
    const header = out.slice(i, nl).toString('utf8');
    i = nl + 1;
    const m = /^\S+ (\S+) (\d+)$/.exec(header);
    if (!m) continue; // "missing"
    const size = Number(m[2]);
    const body = out.slice(i, i + size);
    i += size + 1;
    if (m[1] !== 'blob' || size > MAX_BYTES || body.includes(0)) continue;
    files[p] = body.toString('utf8');
  }
  return files;
}

const EXT = (p) => path.posix.extname(p).toLowerCase();
const LANG = {
  js: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
  py: ['.py'],
  go: ['.go'],
  rs: ['.rs'],
  c: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh'],
  rb: ['.rb'],
  php: ['.php'],
  sh: ['.sh', '.bash', '.zsh'],
  jvm: ['.java', '.kt', '.kts', '.scala'],
  doc: ['.md', '.mdx', '.markdown', '.txt', '.rst', '.html', '.htm'],
  conf: ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg'],
};
const langOf = (p) => {
  const e = EXT(p);
  for (const [k, exts] of Object.entries(LANG)) if (exts.includes(e)) return k;
  const base = path.posix.basename(p);
  if (['Makefile', 'Dockerfile', 'Justfile', 'Rakefile', 'Gemfile'].includes(base)) return 'conf';
  return null;
};

const CODE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx|py|go|rs|rb|php|java|kt|scala|c|cc|cpp|h|hpp|sh|bash)$/i;
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// raw references in a file: [{ spec, line, kind }]
function references(p, text, lang) {
  const refs = [];
  const add = (re, kind, group = 1) => { let m; while ((m = re.exec(text))) refs.push({ spec: m[group], line: lineOf(text, m.index), kind }); };
  if (lang === 'js') {
    add(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'require');
    add(/\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g, 'import');
    add(/\bexport\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]/g, 'import');
    add(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'import');
    // path.join(__dirname, 'a', 'b.js'): runtime reach to a file spelled in parts
    let m;
    const re = /\b\w+\.(?:join|resolve)\(\s*__dirname\s*((?:,\s*['"][^'"]+['"]\s*)+)\)/g;
    while ((m = re.exec(text))) {
      const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      refs.push({ spec: `./${parts.join('/')}`, line: lineOf(text, m.index), kind: 'path' });
    }
  } else if (lang === 'py') {
    // `from pkg import mod` may import a submodule: try pkg.mod for each name, then pkg itself
    let fm;
    const fre = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)|([\w*, \t]+))/gm;
    while ((fm = fre.exec(text))) {
      const line = lineOf(text, fm.index);
      const mod = fm[1];
      for (const n of (fm[2] || fm[3] || '').split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((x) => /^\w+$/.test(x))) {
        refs.push({ spec: /\.$/.test(mod) ? `${mod}${n}` : `${mod}.${n}`, line, kind: 'from' });
      }
      refs.push({ spec: mod, line, kind: 'from' });
    }
    add(/^\s*import\s+([\w.]+)/gm, 'import');
  } else if (lang === 'go') {
    const blocks = [...text.matchAll(/\bimport\s*\(([\s\S]*?)\)/g)];
    for (const b of blocks) for (const m of b[1].matchAll(/"([^"]+)"/g)) refs.push({ spec: m[1], line: lineOf(text, b.index + m.index), kind: 'import' });
    add(/\bimport\s+(?:\w+\s+)?"([^"]+)"/g, 'import');
  } else if (lang === 'rs') {
    add(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm, 'mod');
  } else if (lang === 'c') {
    add(/^\s*#\s*include\s+"([^"]+)"/gm, 'include');
  } else if (lang === 'rb') {
    add(/\brequire_relative\s+['"]([^'"]+)['"]/g, 'require');
  } else if (lang === 'php') {
    add(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g, 'require');
  } else if (lang === 'jvm') {
    add(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;?/gm, 'import');
  }
  if (lang === 'sh') add(/^\s*(?:source|\.)\s+['"]?([^\s'";]+)/gm, 'source');
  // the mention rule, for every analysed file: a path-shaped token resolved against the repository
  if (lang === 'doc' || lang === 'conf' || lang === 'sh' || lang === 'js' || lang === 'py') {
    const re = /(?:\$\{CLAUDE_PLUGIN_ROOT\}\/)?(?:\.{1,2}\/)?[A-Za-z0-9_@-][A-Za-z0-9_.@/-]*\/[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+|\]\(([^)\s#]+)/g;
    let m;
    const code = lang === 'js' || lang === 'py';
    while ((m = re.exec(text))) {
      const spec = m[1] || m[0];
      // In code, a path in a string or comment is a dependency only when it runs a script (`node x.js`,
      // `python x.py`), uses the plugin root, or names a non-code file the code serves or reads (a
      // template, a page, a config). Naming another source file in a comment is not a dependency: on the
      // Vault it made every route reach tests/test_workflows.py.
      if (code && !spec.includes('${CLAUDE_PLUGIN_ROOT}') && CODE_EXT.test(spec)
        && !/\b(?:node|python3?|bash|sh|deno|bun|ruby|php)\s+["']?$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
      refs.push({ spec, line: lineOf(text, m.index), kind: 'mention' });
    }
  }
  return refs;
}

// The plugin root a file belongs to (the nearest ancestor with .claude-plugin/plugin.json), or ''
function pluginRootOf(p, pluginRoots) {
  let best = null;
  for (const r of pluginRoots) if ((r === '' || p.startsWith(`${r}/`)) && (best === null || r.length > best.length)) best = r;
  return best === null ? null : best;
}

const JS_EXTS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '/index.js', '/index.ts'];

// a reference -> the repository paths it names (possibly several for a Go package), or []
function resolve(from, ref, ctx) {
  const { files, dirs, pluginRoots, goModule } = ctx;
  const dir = path.posix.dirname(from);
  const norm = (x) => path.posix.normalize(x).replace(/^\.\//, '');
  const exists = (x) => files.has(x);
  let spec = ref.spec.replace(/[`'",;:)]+$/, '');
  if (!spec || /^[a-z]+:\/\//i.test(spec) || spec.startsWith('#')) return [];
  if (spec.includes('${CLAUDE_PLUGIN_ROOT}/')) {
    const root = pluginRootOf(from, pluginRoots);
    if (root === null) return [];
    const t = norm(path.posix.join(root, spec.split('${CLAUDE_PLUGIN_ROOT}/')[1]));
    return exists(t) ? [t] : [];
  }
  const lang = langOf(from);
  if (lang === 'js' && ref.kind !== 'mention') {
    if (!spec.startsWith('.')) return [];
    const base = norm(path.posix.join(dir, spec));
    for (const e of JS_EXTS) if (exists(base + e)) return [base + e];
    return [];
  }
  if (lang === 'py' && ref.kind !== 'mention') {
    const mod = spec;
    const dots = (/^\.+/.exec(mod) || [''])[0].length;
    const rest = mod.slice(dots).split('.').filter(Boolean);
    const bases = dots ? [path.posix.join(dir, ...Array(dots - 1).fill('..'))] : [dir, '', 'src', ...ctx.pyRoots];
    for (const b of bases) {
      for (let k = rest.length; k >= 1; k--) {
        const stem = norm(path.posix.join(b, ...rest.slice(0, k)));
        for (const c of [`${stem}.py`, `${stem}/__init__.py`]) if (exists(c)) return [c];
      }
    }
    return [];
  }
  if (lang === 'go' && ref.kind !== 'mention') {
    const rel = goModule && spec.startsWith(`${goModule}/`) ? spec.slice(goModule.length + 1) : null;
    if (rel === null || !dirs.has(rel)) return [];
    return [...files].filter((f) => path.posix.dirname(f) === rel && f.endsWith('.go') && !f.endsWith('_test.go'));
  }
  if (lang === 'rs' && ref.kind === 'mod') {
    const stem = path.posix.basename(from) === 'mod.rs' || ['main.rs', 'lib.rs'].includes(path.posix.basename(from)) ? dir : path.posix.join(dir, path.posix.basename(from, '.rs'));
    for (const c of [`${stem}/${spec}.rs`, `${stem}/${spec}/mod.rs`, `${dir}/${spec}.rs`]) if (exists(norm(c))) return [norm(c)];
    return [];
  }
  if (lang === 'jvm' && ref.kind === 'import') {
    const rel = spec.replace(/\.\*$/, '').split('.').join('/');
    return [...files].filter((f) => /\.(java|kt|kts|scala)$/.test(f) && f.replace(/\.(java|kt|kts|scala)$/, '').endsWith(rel));
  }
  // relative to the file, then to its plugin root, then to the repository root
  const root = pluginRootOf(from, pluginRoots);
  const cands = [path.posix.join(dir, spec)];
  if (root !== null) cands.push(path.posix.join(root, spec));
  cands.push(spec);
  for (const c of cands) {
    const n = norm(c);
    if (n.startsWith('..')) continue;
    if (exists(n)) return [n];
    if (ref.kind === 'require' && exists(`${n}.rb`)) return [`${n}.rb`];
  }
  return [];
}

// The code map at one commit: { sha, files, analysed, blind, edges: Map(from -> [{ to, line, kind }]), texts }
function buildMap(repo, ref = 'HEAD') {
  const sha = resolveCommit(repo, ref);
  const all = listFiles(repo, sha);
  const files = new Set(all);
  const dirs = new Set(all.map((f) => path.posix.dirname(f)));
  const analysable = all.filter((f) => langOf(f));
  const texts = readFiles(repo, sha, analysable);
  const pluginRoots = all.filter((f) => f === '.claude-plugin/plugin.json' || f.endsWith('/.claude-plugin/plugin.json')).map((f) => f.replace(/\/?\.claude-plugin\/plugin\.json$/, ''));
  const goMod = all.includes('go.mod') ? readFiles(repo, sha, ['go.mod'])['go.mod'] : null;
  const goModule = goMod ? ((/^module\s+(\S+)/m.exec(goMod) || [])[1] || null) : null;
  const pyRoots = [...dirs].filter((d) => files.has(`${d}/pyproject.toml`) || files.has(`${d}/setup.py`)).map((d) => `${d}/src`);
  const ctx = { files, dirs, pluginRoots, goModule, pyRoots };
  const edges = new Map();
  for (const [p, text] of Object.entries(texts)) {
    const seen = new Set();
    const out = [];
    for (const ref of references(p, text, langOf(p))) {
      for (const to of resolve(p, ref, ctx)) {
        if (to === p || seen.has(to)) continue;
        seen.add(to);
        out.push({ to, line: ref.line, kind: ref.kind });
      }
    }
    edges.set(p, out);
  }
  const analysed = Object.keys(texts);
  // an empty file is analysed (it references nothing), not blind
  const blind = all.filter((f) => !Object.prototype.hasOwnProperty.call(texts, f));
  return { sha, files: all, analysed, blind, edges, texts, pluginRoots };
}

// everything a set of start files reaches: Map(file -> { hops, via: prevFile, line, kind })
function reach(map, starts) {
  const seen = new Map();
  const queue = [];
  for (const s of starts) if (!seen.has(s)) { seen.set(s, { hops: 0, via: null }); queue.push(s); }
  while (queue.length) {
    const f = queue.shift();
    const h = seen.get(f).hops;
    // A document reached from somewhere else is the end of its chain: docs name files to explain them,
    // so walking on from a doc reached through another made everything reach everything (the Vault:
    // SKILL.md -> docs -> a build script -> docs -> tests). A feature's own doc (a start) still counts.
    if (h > 0 && langOf(f) === 'doc') continue;
    for (const e of map.edges.get(f) || []) {
      if (seen.has(e.to)) continue;
      seen.set(e.to, { hops: h + 1, via: f, line: e.line, kind: e.kind });
      queue.push(e.to);
    }
  }
  return seen;
}

// the chain from a start file to `file`, as [{ from, to, line, kind }]
function chainTo(reached, file) {
  const out = [];
  let f = file;
  while (reached.get(f) && reached.get(f).via) {
    const r = reached.get(f);
    out.unshift({ from: r.via, to: f, line: r.line, kind: r.kind });
    f = r.via;
  }
  return out;
}

module.exports = { resolveCommit, listFiles, readFiles, buildMap, reach, chainTo, langOf, references };
