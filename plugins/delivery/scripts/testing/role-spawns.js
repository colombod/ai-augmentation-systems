// scripts/testing/role-spawns.js — finds where the plugin's code could start a role session, for
// scripts/role-scope.test.js (hjx.1.6.10.1.2). Every role session must start through lib/role-scope.js.
//
// Chasing call forms one by one missed four (rv-202-delivery-lead-8: an alias of
// require('child_process').spawn, a destructured rename, a spawn method on another variable, an absolute
// path to claude), so the guard works from the files outward, in three layers:
//   1. every file under scripts/ and hooks/ whose code requires child_process, in any form, is listed by
//      the test with the reason it runs processes; a file that is not listed fails, named;
//   2. of those, a file whose code names a session (a claude command, including any path ending in
//      /claude, the session supervisor lib/wake-run.js, Remote Control, DELIVERY_CLAUDE_BIN) is listed
//      again, as a session file, with its reason; one that is not fails, named;
//   3. in the session files, every call that starts a session is found, through every alias of
//      child_process the file makes, and must be role-scope's own or allowed by name in the test.
// Its limit: it reads the code as text. A require whose name is computed (require('child_' + x)),
// process.binding, or any other way to reach a process that names neither child_process nor its methods
// is deliberate evasion, and static scanning does not cover it; review does.
const fs = require('fs');
const path = require('path');

const FAMILY = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];
// methods no other common object has: on any object they count; exec and execSync (RegExp#exec) count only
// on an object known to be child_process
const PROCESS_ONLY = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']);
// no capture groups: it is embedded in the alias patterns, whose groups it must not shift. require and
// import() with any spacing, and the import ... from form
const REQUIRE_CP = /\b(?:require|import)\s*\(\s*['"`](?:node:)?child_process['"`]\s*\)|\bfrom\s+['"](?:node:)?child_process['"]/;
const CLAUDE_CMD = /(['"`])(?:[^'"`\s]*\/)?claude(?=[\s'"`])/;
const SESSION_TEXT = new RegExp(`wake-run\\.js|remote-control|\\bDELIVERY_CLAUDE_BIN\\b|${CLAUDE_CMD.source}`);
const SESSION_FLAGS = /(['"`])(?:-p|-c|--resume|--continue|--fork-session|remote-control)\1|wake-run\.js/;
const READ_ONLY = /(['"`])(?:agents|--version|-v|plugin|mcp|update|doctor|auth|config|--help)\1/;
const ID = '[A-Za-z_$][\\w$]*';
const esc = (s) => s.replace(/\$/g, '\\$');

// the source with its comments blanked (strings, templates and regexp literals kept), so a comment that
// names a command is not code that runs it; line numbers stay where they were
function code(src) {
  let out = '';
  let q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i++; } else if (c === q || (q !== '`' && c === '\n')) q = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      out += body.replace(/[^\n]/g, ' ');
      i += body.length - 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if (c === '/') {
      // a regexp literal where an expression starts: copied through its closing slash
      const before = out.trimEnd();
      if (!before || /[(,=:[!&|?{};+\-*%<>~^]$/.test(before) || /\b(?:return|typeof|case)$/.test(before)) {
        let j = i + 1;
        let cls = false;
        for (; j < src.length && src[j] !== '\n'; j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        }
        if (src[j] === '/') { out += src.slice(i, j + 1); i = j; continue; }
      }
    }
    out += c;
  }
  return out;
}

const requiresChildProcess = (src) => REQUIRE_CP.test(code(src));
const namesSession = (src) => SESSION_TEXT.test(code(src));

// the call's argument text, from its open paren to the matching close, skipping strings
function callText(src, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

// the names a file gives child_process: objects (const cp = require('child_process')) and functions (a
// destructured name or rename, const run = require('child_process').spawn, const go = cp.spawn),
// followed through plain re-assignments (const proc = cp)
function aliases(src) {
  const req = REQUIRE_CP.source;
  const objects = new Set();
  const fns = new Map(); // local name -> child_process method
  let m;
  // the left side: a declared name, a plainly assigned one, or a parameter's default (not a member: a
  // property set from child_process is reached through its object)
  const LHS = `(?:\\b(?:const|let|var)\\s+|(?<![\\w$.]))(${ID})\\s*=(?![=>])\\s*(?:await\\s+)?`;
  const objRe = new RegExp(`${LHS}(?:${req})(?!\\s*\\.)`, 'g');
  while ((m = objRe.exec(src))) objects.add(m[1]);
  // a member taken from child_process, or from a bracketed (await import('child_process'))
  const memRe = new RegExp(`${LHS}(?:${req}|\\(\\s*(?:await\\s+)?(?:${req})\\s*\\))\\s*\\.\\s*(${ID})`, 'g');
  while ((m = memRe.exec(src))) if (FAMILY.includes(m[2])) fns.set(m[1], m[2]);
  const destRe = new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(?:await\\s+)?(?:${req})`, 'g');
  while ((m = destRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const [from, to] = part.split(':').map((s) => s.trim().replace(/\s*=.*$/, ''));
      if (FAMILY.includes(from)) fns.set(to || from, from);
    }
  }
  const re = new RegExp(`${LHS}(${ID})\\s*(?:\\.\\s*(${ID}))?\\s*(?=[;\\n,)}]|$)`, 'g');
  for (let changed = true; changed;) {
    changed = false;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const [, to, from, member] = m;
      if (member === undefined && objects.has(from) && !objects.has(to)) { objects.add(to); changed = true; }
      if (member !== undefined && objects.has(from) && FAMILY.includes(member) && !fns.has(to)) { fns.set(to, member); changed = true; }
      if (member === undefined && fns.has(from) && !fns.has(to)) { fns.set(to, fns.get(from)); changed = true; }
    }
  }
  return { objects, fns };
}

// identifiers whose value comes from a session marker, followed through assignments
function markers(src) {
  const assigns = [];
  const re = /\b(?:const|let|var)\s+(?:\{\s*)?([A-Za-z_$][\w$]*)\b[^=\n]*=\s*([^;\n]+)/g;
  let m;
  while ((m = re.exec(src))) assigns.push({ name: m[1], rhs: m[2] });
  const out = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const a of assigns) {
      if (out.has(a.name)) continue;
      // an alias of a marker (const b = bin || 'x', const c = env.X ?? bin) carries it; a value merely
      // computed from one (const pid = spawn(bin, ...)) does not
      const lead = /^\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?:\|\||\?\?|;|$|\)|,)/.exec(a.rhs);
      const alias = lead && out.has(lead[1]);
      if (SESSION_TEXT.test(a.rhs) || alias) { out.add(a.name); changed = true; }
    }
  }
  return out;
}

// the session-starting calls in src: [{ rel, line, fn, first, text, sanctioned, why }]
function sessionCalls(raw, rel) {
  const src = code(raw);
  const marks = markers(src);
  const { objects, fns } = aliases(src);
  const names = [...new Set([...FAMILY, ...fns.keys()])].map(esc);
  const CALL = new RegExp(`(?<![\\w$])(${names.join('|')})\\s*\\(`, 'g');
  const onObject = new RegExp(`(?:${REQUIRE_CP.source}|(?<![\\w$.])(?:${[...objects].map(esc).join('|') || '(?!)'}))\\s*\\.\\s*$`);
  const found = [];
  let m;
  while ((m = CALL.exec(src))) {
    const name = m[1];
    const lead = src.slice(Math.max(0, m.index - 60), m.index);
    let fn = name;
    if (/\.\s*$/.test(lead)) {
      // a method: on child_process or one of its aliases, or (spawn, execFile, fork and their Sync forms,
      // which no other common object has) on any object at all
      if (!FAMILY.includes(name)) continue;
      if (!onObject.test(lead) && !PROCESS_ONLY.has(name)) continue;
    } else if (fns.has(name)) fn = fns.get(name);
    else if (!FAMILY.includes(name)) continue;
    const text = callText(src, m.index + m[0].length - 1);
    const first = text.split(',')[0].trim();
    const usesMark = [...marks].some((n) => new RegExp(`(?:^|[^\\w$.])${esc(n)}\\b`).test(text));
    // a command object (X.bin) is a session start until it is shown to be a roleCommand result
    const session = SESSION_TEXT.test(text) || usesMark || /^[A-Za-z_$][\w$]*\.bin$/.test(first);
    // every call inside the helper is the sanctioned start itself, whatever its arguments
    const inHelper = rel === 'scripts/lib/role-scope.js';
    if (!session && !inHelper) continue;
    if (!inHelper && READ_ONLY.test(text) && !SESSION_FLAGS.test(text)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    let sanctioned = false;
    let why = null;
    if (inHelper) { sanctioned = true; why = 'the helper itself (startRole)'; }
    const bin = /^([A-Za-z_$][\w$]*)\.bin$/.exec(first);
    if (!sanctioned && bin) {
      const above = src.slice(0, m.index).split('\n').slice(-15).join('\n');
      if (new RegExp(`\\b(?:const|let|var)\\s+${esc(bin[1])}\\s*=\\s*[^;\\n]*\\broleCommand\\(`).test(above)) { sanctioned = true; why = `${bin[1]} is a roleCommand result`; }
    }
    found.push({ rel, line, fn, first, text: text.replace(/\s+/g, ' ').slice(0, 120), sanctioned, why });
  }
  return found;
}

// every .js file under dirs, tests left out (the testing helpers are code that runs processes too)
function files(dirs) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p); continue; }
      if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(p);
    }
  };
  for (const d of dirs) if (fs.existsSync(d)) walk(d);
  return out.sort();
}

// { processFiles: [rel], sessionFiles: [rel], calls: [the session calls in the session files] }
function scan(pluginRoot) {
  const processFiles = [];
  const sessionFiles = [];
  const calls = [];
  for (const f of files([path.join(pluginRoot, 'scripts'), path.join(pluginRoot, 'hooks')])) {
    const rel = path.relative(pluginRoot, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    if (!requiresChildProcess(src)) continue;
    processFiles.push(rel);
    if (!namesSession(src)) continue;
    sessionFiles.push(rel);
    calls.push(...sessionCalls(src, rel));
  }
  return { processFiles, sessionFiles, calls };
}

module.exports = { sessionCalls, scan, markers, aliases, callText, code, requiresChildProcess, namesSession };
