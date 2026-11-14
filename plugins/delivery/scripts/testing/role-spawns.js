// scripts/testing/role-spawns.js — finds the calls in the plugin's code that start a role session, for
// scripts/role-scope.test.js (hjx.1.6.10.1.2). Every one must go through lib/role-scope.js.
//
// A call is any spawn, spawnSync, execFile, execFileSync, exec, execSync or fork. It starts a role session
// when it names the session supervisor (lib/wake-run.js) or Remote Control, a literal claude, or a
// variable the file assigns, directly or through other variables, from one of those or from
// DELIVERY_CLAUDE_BIN; a call that only reads (claude agents, --version, plugin, mcp) does not.
// It is sanctioned only inside lib/role-scope.js, or when its command is X.bin and X is assigned from
// roleCommand(...) in the lines just above it: a name alone (cmd.bin) is not trusted.
const fs = require('fs');
const path = require('path');

const CALL = /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g;
const SESSION_TEXT = /wake-run\.js|remote-control|\bDELIVERY_CLAUDE_BIN\b|(['"`])claude(?=[\s'"`/])/;
const SESSION_FLAGS = /(['"`])(?:-p|-c|--resume|--continue|--fork-session|remote-control)\1|wake-run\.js/;
const READ_ONLY = /(['"`])(?:agents|--version|-v|plugin|mcp|update|doctor|auth|config|--help)\1/;

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
function sessionCalls(src, rel) {
  const marks = markers(src);
  const found = [];
  let m;
  CALL.lastIndex = 0;
  while ((m = CALL.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 1), m.index);
    if (/[\w$]/.test(before)) continue;
    // a method call counts only on child_process itself (cp.spawn, require('child_process').exec): a
    // RegExp's exec or another object's method is not a process
    const lead = src.slice(Math.max(0, m.index - 40), m.index);
    if (/\.\s*$/.test(lead) && !/(?:\bcp|\bCP|childProcess|child_process['"]\s*\))\s*\.\s*$/.test(lead)) continue;
    const text = callText(src, m.index + m[0].length - 1);
    const first = text.split(',')[0].trim();
    const usesMark = [...marks].some((n) => new RegExp(`(?:^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\b`).test(text));
    // a command object (X.bin) is a session start until it is shown to be a roleCommand result
    const session = SESSION_TEXT.test(text) || usesMark || /^[A-Za-z_$][\w$]*\.bin$/.test(first);
    // every call inside the helper is the sanctioned start itself, whatever its arguments
    const inHelper = rel === 'scripts/lib/role-scope.js';
    if (!session && !inHelper) continue;
    if (!inHelper && READ_ONLY.test(text) && !SESSION_FLAGS.test(text)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    let sanctioned = false;
    let why = null;
    if (rel === 'scripts/lib/role-scope.js') { sanctioned = true; why = 'the helper itself (startRole)'; }
    const bin = /^([A-Za-z_$][\w$]*)\.bin$/.exec(first);
    if (!sanctioned && bin) {
      const above = src.slice(0, m.index).split('\n').slice(-15).join('\n');
      if (new RegExp(`\\b(?:const|let|var)\\s+${bin[1]}\\s*=\\s*[^;\\n]*\\broleCommand\\(`).test(above)) { sanctioned = true; why = `${bin[1]} is a roleCommand result`; }
    }
    found.push({ rel, line, fn: m[1], first, text: text.replace(/\s+/g, ' ').slice(0, 120), sanctioned, why });
  }
  return found;
}

// every .js file under dirs, tests and the testing directory left out
function files(dirs) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['testing', 'node_modules'].includes(e.name) && !e.name.startsWith('.')) walk(p); continue; }
      if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(p);
    }
  };
  for (const d of dirs) if (fs.existsSync(d)) walk(d);
  return out;
}

function scan(pluginRoot) {
  const out = [];
  for (const f of files([path.join(pluginRoot, 'scripts'), path.join(pluginRoot, 'hooks')])) {
    out.push(...sessionCalls(fs.readFileSync(f, 'utf8'), path.relative(pluginRoot, f).split(path.sep).join('/')));
  }
  return out;
}

module.exports = { sessionCalls, scan, markers, callText };
