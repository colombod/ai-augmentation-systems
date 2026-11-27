// scripts/lib/syntax.js — what each top-level definition of a JavaScript file uses, read from its
// syntax tree (tree-sitter, vendor/tree-sitter), and reach from a feature's files to definitions.
// Where a use cannot be followed (a module passed around as a value, a computed require, an export
// this cannot name), the whole file is taken: reach is never narrowed on a guess.
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./codemap.js');

const JS_FILE = /\.[cm]?js$/;

const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'tree-sitter');

async function loadParser() {
  const { Parser, Language } = require(path.join(VENDOR, 'web-tree-sitter.cjs'));
  await Parser.init({ locateFile: (f) => path.join(VENDOR, f) });
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(VENDOR, 'tree-sitter-javascript.wasm')));
  return parser;
}

const kids = (n) => n.namedChildren;
const str = (n) => (n && n.type === 'string' ? n.text.slice(1, -1) : null);
// require('x') -> 'x'; require(expr) -> false; anything else -> null
function required(n) {
  if (!n || n.type !== 'call_expression' || n.childForFieldName('function').text !== 'require') return null;
  const a = kids(n.childForFieldName('arguments'))[0];
  return str(a) === null ? false : str(a);
}

// the names a `const ... = require(...)` (or require(...).y) declarator binds: [[name, { spec, name? }]]
function bindingsOf(d) {
  const name = d.childForFieldName('name');
  let value = d.childForFieldName('value');
  let member = null;
  if (value && value.type === 'member_expression' && required(value.childForFieldName('object'))) { member = value.childForFieldName('property').text; value = value.childForFieldName('object'); }
  const spec = required(value);
  if (!spec) return null;
  if (name.type === 'identifier') return [[name.text, member ? { spec, name: member } : { spec }]];
  if (name.type !== 'object_pattern' || member) return null;
  const out = [];
  for (const p of kids(name)) {
    if (p.type === 'shorthand_property_identifier_pattern') out.push([p.text, { spec, name: p.text }]);
    else if (p.type === 'pair_pattern' && p.childForFieldName('value').type === 'identifier') out.push([p.childForFieldName('value').text, { spec, name: p.childForFieldName('key').text }]);
    else return null;
  }
  return out;
}

const FUNCTIONS = ['arrow_function', 'function_expression', 'function', 'generator_function', 'class', 'class_declaration', 'function_declaration'];
// does evaluating this initializer run code now (a call or `new` outside a function body)?
const runsAtLoad = (n) => Boolean(n) && !FUNCTIONS.includes(n.type) && (n.type === 'call_expression' || n.type === 'new_expression' || n.namedChildren.some(runsAtLoad));

function parseFile(parser, text) {
  const tree = parser.parse(text);
  const defs = new Map(); // name -> [nodes]
  const bindings = new Map();
  const exports = new Map(); // exported name -> local definition name, or { spec, name }
  const spans = []; // { from, to, sym }
  const moduleNodes = [];
  const topRequires = [];
  const eager = new Set(); // definitions whose initializer runs when the file loads
  let openExports = false; // an export shape this cannot name
  const span = (n, sym) => spans.push({ from: n.startPosition.row + 1, to: n.endPosition.row + 1, sym });
  const define = (name, node, at = node) => { if (!defs.has(name)) defs.set(name, []); defs.get(name).push(node); span(at, name); };

  const exportAssign = (stmt, left, right) => {
    const target = left.text;
    const prop = /^(?:module\.)?exports\.([\w$]+)$/.exec(target);
    if (prop) { if (right.type === 'identifier') { exports.set(prop[1], right.text); span(stmt, '<exports>'); } else { const sym = `exports.${prop[1]}`; exports.set(prop[1], sym); define(sym, right, stmt); } return true; }
    if (target !== 'module.exports') return false;
    if (right.type !== 'object') { if (right.type === 'identifier') exports.set('*default*', right.text); else { define('exports.*default*', right, stmt); exports.set('*default*', 'exports.*default*'); } openExports = true; return true; }
    span(stmt, '<exports>');
    for (const p of kids(right)) {
      if (p.type === 'shorthand_property_identifier') exports.set(p.text, p.text);
      else if (p.type === 'pair' && p.childForFieldName('value').type === 'identifier') exports.set(p.childForFieldName('key').text, p.childForFieldName('value').text);
      else if (p.type === 'pair') { const k = p.childForFieldName('key').text; define(`exports.${k}`, p.childForFieldName('value'), p); exports.set(k, `exports.${k}`); }
      else if (p.type === 'method_definition') { const k = p.childForFieldName('name').text; define(`exports.${k}`, p, p); exports.set(k, `exports.${k}`); }
      else if (p.type !== 'comment') openExports = true;
    }
    return true;
  };

  const top = (n, outer = n) => {
    if (n.type === 'comment') return;
    if (['function_declaration', 'generator_function_declaration', 'class_declaration'].includes(n.type)) { define(n.childForFieldName('name').text, n, outer); return; }
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      for (const d of kids(n).filter((x) => x.type === 'variable_declarator')) {
        const b = bindingsOf(d);
        if (b) { for (const [name, to] of b) { bindings.set(name, to); span(outer, `<binding:${name}>`); } topRequires.push(b[0][1].spec); }
        else if (d.childForFieldName('name').type === 'identifier') { define(d.childForFieldName('name').text, d, outer); if (runsAtLoad(d.childForFieldName('value'))) eager.add(d.childForFieldName('name').text); }
        else moduleNodes.push(d);
      }
      return;
    }
    if (n.type === 'export_statement') { const d = n.childForFieldName('declaration'); if (d) { top(d, n); const name = d.childForFieldName('name'); if (name) exports.set(name.text, name.text); } openExports = true; return; }
    if (n.type === 'import_statement') { openExports = true; moduleNodes.push(n); return; }
    if (n.type === 'expression_statement' && kids(n)[0] && kids(n)[0].type === 'assignment_expression') {
      const a = kids(n)[0];
      if (exportAssign(n, a.childForFieldName('left'), a.childForFieldName('right'))) return;
    }
    if (n.type === 'if_statement' && /require\.main\s*===?\s*module/.test(n.childForFieldName('condition').text)) { define('<main>', n); return; }
    moduleNodes.push(n);
    span(n, '<module>');
  };
  for (const n of kids(tree.rootNode)) top(n);

  // what a definition uses: { local }, { spec, name } or { spec } (the whole module)
  const usesOf = (nodes) => {
    const uses = [];
    for (const root of nodes) {
      const local = new Map(bindings);
      const walk = (n) => {
        if (n.type === 'variable_declarator') { const b = bindingsOf(n); if (b) { for (const [name, to] of b) { local.set(name, to); uses.push({ spec: to.spec, name: '<module>' }); } return; } }
        // the file's own export, called through module.exports (a test seam, or recursion by name)
        if (n.type === 'member_expression' && /^(?:module\.)?exports$/.test(n.childForFieldName('object').text)) {
          const to = exports.get(n.childForFieldName('property').text);
          if (typeof to === 'string' && defs.has(to)) uses.push({ local: to });
          else if (to) uses.push(to);
          return;
        }
        const spec = required(n);
        if (spec !== null) {
          if (spec === false) uses.push({ unknown: true });
          else if (n.parent && n.parent.type === 'member_expression' && n.parent.childForFieldName('object').id === n.id) uses.push({ spec, name: n.parent.childForFieldName('property').text });
          else uses.push({ spec });
          return;
        }
        if (n.type === 'identifier' || n.type === 'shorthand_property_identifier') {
          const to = local.get(n.text);
          if (to) {
            const p = n.parent;
            if (to.name) uses.push(to);
            else if (p && p.type === 'member_expression' && p.childForFieldName('object').id === n.id) uses.push({ spec: to.spec, name: p.childForFieldName('property').text });
            else uses.push({ spec: to.spec });
          } else if (defs.has(n.text)) uses.push({ local: n.text });
          return;
        }
        for (const c of kids(n)) walk(c);
      };
      walk(root);
    }
    return uses;
  };
  const uses = new Map([...defs].map(([name, nodes]) => [name, usesOf(nodes)]));
  uses.set('<module>', [...usesOf(moduleNodes), ...topRequires.map((spec) => ({ spec, name: '<module>' })), ...[...eager].map((local) => ({ local }))]);
  const comments = new Set();
  (function walk(n) { if (n.type === 'comment') { for (let r = n.startPosition.row + 1; r <= n.endPosition.row + 1; r++) { const line = text.split('\n')[r - 1] || ''; if (/^\s*(\/\/|\/\*|\*)/.test(line)) comments.add(r); } return; } for (const c of n.namedChildren) walk(c); })(tree.rootNode);
  const info = { eager, uses, exports, openExports, bindings, spans, comments, lines: text.split('\n'), error: tree.rootNode.hasError };
  tree.delete();
  return info;
}

const EXTS = ['', '.js', '.mjs', '.cjs', '.json', '/index.js'];
function resolveSpec(files, from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const e of EXTS) if (files.has(base + e)) return base + e;
  return null;
}

// the symbol a line belongs to: the narrowest span holding it
const symbolAt = (info, line) => {
  const hit = info.spans.filter((s) => s.from <= line && line <= s.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  return hit ? hit.sym : '<module>';
};

// What a change to a file touches: a Set of symbols, or null for the whole file. before/after: parsed
// files; oldLines/newLines: the changed line numbers on each side.
function changedSymbols(before, after, oldLines, newLines) {
  if (!before || !after || before.error || after.error) return null;
  const out = new Set();
  for (const [info, nums] of [[before, oldLines], [after, newLines]]) {
    for (const n of nums) {
      if (info.comments.has(n) || !String(info.lines[n - 1] || '').trim()) continue;
      const sym = symbolAt(info, n);
      if (sym !== '<exports>' && !sym.startsWith('<binding:')) out.add(sym);
      // what runs on load reaches everyone who loads the file
      if (info.eager.has(sym)) out.add('<module>');
    }
  }
  // an export removed or pointed elsewhere reaches who uses it
  for (const [name, to] of before.exports) if (JSON.stringify(after.exports.get(name)) !== JSON.stringify(to)) out.add(`export:${name}`);
  // a binding pointed elsewhere changes every definition that uses the name
  for (const [name, to] of before.bindings) {
    const now = after.bindings.get(name);
    if (!now || JSON.stringify(now) === JSON.stringify(to)) continue;
    for (const [sym, uses] of after.uses) if (uses.some((u) => u.spec === now.spec)) out.add(sym);
  }
  return out;
}

// Everything reached from `starts`: Map(file -> Set of symbols reached; '*' for the whole file)
function reach(map, parsed, starts) {
  const files = new Set(map.files);
  const seen = new Map();
  const queue = [];
  const visit = (file, sym) => {
    if (!seen.has(file)) seen.set(file, new Set());
    const have = seen.get(file);
    if (have.has(sym) || (have.has('*') && sym !== '*')) return;
    have.add(sym);
    queue.push([file, sym]);
  };
  const starting = new Set(starts);
  for (const s of starts) visit(s, '*');
  while (queue.length) {
    const [file, sym] = queue.shift();
    const info = parsed.get(file);
    if (!info || info.error) { // not a parsed file: the map's own file edges, whole files
      if (C.langOf(file) === 'doc' && !starting.has(file)) continue;
      for (const e of map.edges.get(file) || []) visit(e.to, '*');
      continue;
    }
    const syms = sym === '*' ? [...info.uses.keys()] : sym.startsWith('export:') ? [] : [sym];
    if (sym !== '*' && sym !== '<module>') visit(file, '<module>');
    for (const s of syms) {
      for (const u of info.uses.get(s) || []) {
        if (u.local) { visit(file, u.local); continue; }
        if (u.unknown) { for (const e of map.edges.get(file) || []) visit(e.to, '*'); continue; }
        const to = resolveSpec(files, file, u.spec);
        if (!to) continue;
        const target = parsed.get(to);
        if (!u.name || !target || target.error) { visit(to, '*'); continue; }
        if (u.name === '<module>') { visit(to, '<module>'); continue; }
        const local = target.exports.get(u.name);
        if (typeof local === 'string' && target.uses.has(local)) { visit(to, local); visit(to, `export:${u.name}`); }
        else if (target.openExports || local !== undefined) visit(to, '*');
        else { visit(to, `export:${u.name}`); visit(to, '*'); }
      }
    }
    // what the syntax rules do not cover (a script run by path, a file named in a string): whole files,
    // charged to the definition whose line names them
    for (const e of map.edges.get(file) || []) {
      if (e.kind === 'require' || e.kind === 'import') continue;
      if (sym === '*' || symbolAt(info, e.line) === sym) visit(e.to, '*');
    }
  }
  return seen;
}

// does a reach touch a change? syms: from changedSymbols (null: the whole file)
function touches(reached, file, syms) {
  const have = reached.get(file);
  if (!have) return false;
  if (syms === null || have.has('*')) return syms === null || syms.size > 0;
  return [...syms].some((s) => s === '<module>' || have.has(s));
}

const git = (repo, ...a) => {
  const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${a[0]}: ${String(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
};
// parsed files, read as the walk asks for them
function lazyParsed(parser, map) {
  const cache = new Map();
  return { get: (f) => { if (!cache.has(f)) cache.set(f, JS_FILE.test(f) && typeof map.texts[f] === 'string' ? parseFile(parser, map.texts[f]) : undefined); return cache.get(f); } };
}

// the definitions `from`..`to` changed in a file, or null for the whole file
function diffSymbols(parser, repo, from, to, file) {
  if (!JS_FILE.test(file)) return null;
  let before; let after; let diff;
  try {
    before = parseFile(parser, git(repo, 'show', `${from}:${file}`));
    after = parseFile(parser, git(repo, 'show', `${to}:${file}`));
    diff = git(repo, 'diff', '-U0', '--no-renames', from, to, '--', `:(top,literal)${file}`);
  } catch (err) { return null; } // added or removed: whole
  const oldLines = []; const newLines = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    for (let i = 0; i < Number(m[2] === undefined ? 1 : m[2]); i++) oldLines.push(Number(m[1]) + i);
    for (let i = 0; i < Number(m[4] === undefined ? 1 : m[4]); i++) newLines.push(Number(m[3]) + i);
  }
  // an unchanged file in this range: nothing is known about the change, so all of it
  if (!oldLines.length && !newLines.length) return null;
  return changedSymbols(before, after, oldLines, newLines);
}

// Which of `features` ([{ id, anchors }]) reach what changed in `paths` at map.sha, following what each
// definition uses. With `from`, only the definitions changed between `from` and `to` count.
async function touched({ repo, sha, from, to, paths, features }) {
  const parser = await loadParser();
  const map = C.buildMap(repo, sha);
  const parsed = lazyParsed(parser, map);
  const changes = paths.map((f) => [f, from ? diffSymbols(parser, repo, from, to || map.sha, f) : null]);
  return features.filter((f) => { const r = reach(map, parsed, f.anchors); return changes.some(([file, syms]) => touches(r, file, syms)); }).map((f) => f.id);
}

// The same, from synchronous code: the parser loads asynchronously, so it runs in its own process.
// { ids } or { error }; the caller keeps the file-level answer on an error.
function narrow(request) {
  const r = spawnSync(process.execPath, [__filename], { input: JSON.stringify(request), encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
  if (r.status !== 0) return { error: String((r.error && r.error.message) || r.stderr || 'the parser did not finish').trim().split('\n')[0].slice(0, 200) };
  try { return { ids: JSON.parse(r.stdout) }; } catch (err) { return { error: 'the parser answered nothing readable' }; }
}

module.exports = { loadParser, parseFile, changedSymbols, reach, touches, resolveSpec, symbolAt, touched, narrow };

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (d) => { input += d; }).on('end', () => {
    Promise.resolve().then(() => touched(JSON.parse(input))).then((ids) => process.stdout.write(JSON.stringify(ids)),
      (err) => { process.stderr.write(`${err.message}\n`); process.exitCode = 1; });
  });
}
