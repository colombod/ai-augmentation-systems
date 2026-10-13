// hooks/scripts/leak.js — keep plans and strategy out of the public product repo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { splitWithOps, realish, shellCommandOf } = require('./lane.js');

function loadDenylist(projectRoot) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ---------- paths ----------
const CI = process.platform === 'darwin' || process.platform === 'win32';
const fold = (p) => (CI ? p.toLowerCase() : p);
function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
function productDir(roleDir) { return path.join(realish(path.resolve(roleDir)), 'product'); }
function dirUnderProduct(dir, roleDir) { return under(fold(realish(path.resolve(dir))), fold(productDir(roleDir))); }
function inProductWorktree(cwd, roleDir) { return dirUnderProduct(cwd || '.', roleDir); }
// An undeterminable directory (null) counts as inside product only when the command started in
// product or at the role directory itself (from where product is one step away); from project or
// anywhere outside the role tree it counts as outside.
function anyInProduct(dirs, roleDir, cwd) {
  const start = fold(realish(path.resolve(cwd || '.')));
  const nullIn = under(start, fold(productDir(roleDir))) || start === fold(realish(path.resolve(roleDir)));
  return dirs.some((d) => (d === null ? nullIn : dirUnderProduct(d, roleDir)));
}

// ---------- command parsing ----------
const UNSAFE_DIR = /[$~`]/;
const VAR_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
const RESUME_OPS = [';', '||', '&', '\n'];

// A command the guard cannot parse with confidence. In the product worktree it is refused.
class Unparseable extends Error {}
const fail = (why) => { throw new Unparseable(why); };
// Markers use control characters, which are refused in input, so a planted marker cannot exist.
const MK = (k) => `\u0001${k}\u0001`;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PRIVATE_USE = /[\uE000-\uF8FF]/;

// Like lane's tokens(), but characters that are literal (single-quoted or escaped) have $, ` and \
// replaced by sentinels, so a later check for substitution sees only live ones.
const SENT = { $: '\u0002', '`': '\u0003', '\\': '\u0004' };
const lit = (c) => SENT[c] || c;
const unsent = (v) => String(v).replace(/\u0002/g, '$').replace(/\u0003/g, '`').replace(/\u0004/g, '\\');
// Redirection operators at the start of an unquoted word; the word they apply to is dropped with them.
// `<(` and `>(` are process substitutions, not redirections: they stay as words (e.g. a -F value).
const REDIR = /^\d*(?:&>>|&>|>>|>&|>\||<<<|<<-?|<&|<>|>(?!\()|<(?!\())/;
function tokensQ(seg) {
  const s = String(seg == null ? '' : seg);
  const out = [];
  let cur = null;
  let drop = false; // the current word is a redirection target
  let dropNext = false; // the next word is a redirection target
  let q = null;
  const end = () => { if (cur !== null && !drop) out.push(cur); cur = null; drop = false; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += lit(c); continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += lit(s[++i]);
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { end(); continue; }
    if (cur === null) {
      const m = REDIR.exec(s.slice(i, i + 6));
      if (m) {
        i += m[0].length - 1;
        if (i + 1 < s.length && !/\s/.test(s[i + 1])) { cur = ''; drop = true; } else dropNext = true;
        continue;
      }
      cur = '';
      drop = dropNext;
      dropNext = false;
    }
    if (c === '\\') { if (i + 1 < s.length) cur += lit(s[++i]); continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    cur += c;
  }
  end();
  return out;
}

// ----- lexer: masks substitutions, drops comments and heredoc bodies, refuses what it cannot delimit -----
const unbacktick = (b) => b.replace(/\\([$`\\])/g, '$1');
function addBody(sink, body, open) {
  if (!sink) return '';
  sink.bodies.push(body);
  return `${open}${MK(`S${sink.bodies.length - 1}`)}${open === '`' ? '`' : ')'}`;
}
// A substitution starting at `from` (just after its opener); returns the index after its closer.
function substAt(text, from, closeCh, open, sink) {
  const end = scanCtx(text, from, closeCh, null);
  const body = text.slice(from, end);
  if (sink) sink.out.push(addBody(sink, closeCh === '`' ? unbacktick(body) : body, open));
  return end + 1;
}
// ${...}: only simple forms are accepted; quotes, nesting or substitution inside are refused.
function paramAt(text, i, sink) {
  const j = text.indexOf('}', i + 2);
  if (j < 0) fail('unterminated ${');
  if (/['"`(){}\\\n]/.test(text.slice(i + 2, j))) fail('parameter expansion with quotes or substitution');
  if (sink) sink.out.push(text.slice(i, j + 1));
  return j + 1;
}
// Inside "...": returns the index of the closing quote.
function scanDq(text, i, sink) {
  enter();
  try { return scanDqIn(text, i, sink); } finally { nest--; }
}
function scanDqIn(text, i, sink) {
  const put = (s) => { if (sink) sink.out.push(s); };
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') return i;
    if (c === '\\' && n === '\n') { i += 2; continue; }
    if (c === '\\') { put(c + (n === undefined ? '' : n)); i += 2; continue; }
    if (c === '$' && n === '(') { i = substAt(text, i + 2, ')', '$(', sink); continue; }
    if (c === '$' && n === '{') { i = paramAt(text, i, sink); continue; }
    if (c === '`') { i = substAt(text, i + 1, '`', '`', sink); continue; }
    put(c);
    i++;
  }
  return fail('unbalanced double quote');
}
// Substitutions in an unquoted heredoc body run; return their markers.
function heredocSubst(body, sink) {
  let marks = '';
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '\\') { k++; continue; }
    if (c === '$' && body[k + 1] === '(') { const e = scanCtx(body, k + 2, ')', null); marks += ` ${addBody(sink, body.slice(k + 2, e), '$(')}`; k = e; continue; }
    if (c === '`') { const e = scanCtx(body, k + 1, '`', null); marks += ` ${addBody(sink, unbacktick(body.slice(k + 1, e)), '`')}`; k = e; continue; }
    if (c === '$' && body[k + 1] === '{') { k = paramAt(body, k, null) - 1; }
  }
  return marks;
}
const MAX_NEST = 32;
const MAX_LEN = 16 * 1024;
let nest = 0;
const enter = () => { if (++nest > MAX_NEST) { nest--; fail('nesting deeper than 32'); } };
const META = ' \t\n;&|()<>';
const CMD_KW = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', 'time']);
// An unquoted context from i to `close` (')' or '`'; null = end of text). Returns the closer's index.
// With a sink, the masked text goes to sink.out and substitution bodies to sink.bodies.
function scanCtx(text, i, close, sink) {
  enter();
  try { return scanCtxIn(text, i, close, sink); } finally { nest--; }
}
function scanCtxIn(text, i, close, sink) {
  const start = i;
  const put = (s) => { if (sink) sink.out.push(s); };
  let depth = 0;
  let caseDepth = 0;
  let pending = [];
  const wordStart = (k) => k === start || /[\s;&|()<>]/.test(text[k - 1]);
  const cmdPos = (k) => {
    let j = k - 1;
    while (j >= start && (text[j] === ' ' || text[j] === '\t')) j--;
    if (j < start || ';&|(\n{)'.includes(text[j])) return true;
    let w = j;
    while (w > start && /[A-Za-z!{]/.test(text[w - 1]) && j - w < 8) w--;
    if (w > start && !/[\s;&|()]/.test(text[w - 1])) return false;
    return CMD_KW.has(text.slice(w, j + 1));
  };
  const heredocOp = (at) => {
    let j = at + 2;
    let strip = false;
    if (text[j] === '-') { strip = true; j++; }
    while (text[j] === ' ' || text[j] === '\t') j++;
    let delim = '';
    let quoted = false;
    while (j < text.length && !META.includes(text[j])) {
      const ch = text[j];
      if (ch === "'" || ch === '"') { const e = text.indexOf(ch, j + 1); if (e < 0) fail('unbalanced quote'); delim += text.slice(j + 1, e); quoted = true; j = e + 1; continue; }
      if (ch === '\\') { quoted = true; delim += text[j + 1] || ''; j += 2; continue; }
      if (ch === '$' || ch === '`') fail('heredoc delimiter with substitution');
      delim += ch;
      j++;
    }
    if (!delim) fail('heredoc without delimiter');
    put(`<<${MK('H')} `);
    pending.push({ delim, strip, quoted, slot: sink ? sink.out.length : -1 });
    put('');
    return j;
  };
  const readHeredocs = (from) => {
    let j = from;
    for (const h of pending) {
      const bodyStart = j;
      let bodyEnd = text.length;
      let next = text.length;
      for (;;) {
        let e = text.indexOf('\n', j);
        if (e < 0) e = text.length;
        const line = text.slice(j, e);
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) { bodyEnd = j; next = Math.min(e + 1, text.length); break; }
        if (e >= text.length) break;
        j = e + 1;
      }
      j = next;
      if (!h.quoted) { const marks = heredocSubst(text.slice(bodyStart, bodyEnd), sink); if (sink) sink.out[h.slot] = marks; }
    }
    pending = [];
    return j;
  };
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '\\' && n === '\n') { i += 2; continue; } // line continuation
    if (c === '\\') { put(c + (n === undefined ? '' : n)); i += 2; continue; }
    if (c === "'") { const j = text.indexOf("'", i + 1); if (j < 0) fail('unbalanced single quote'); put(text.slice(i, j + 1)); i = j + 1; continue; }
    if (c === '"') { put('"'); i = scanDq(text, i + 1, sink) + 1; put('"'); continue; }
    if (c === '$' && n === "'") {
      let j = i + 2;
      while (j < text.length && text[j] !== "'") { if (text[j] === '\\') j++; j++; }
      if (j >= text.length) fail('unbalanced $\' quote');
      put(MK('A'));
      i = j + 1;
      continue;
    }
    if (c === '$' && n === '"') { put(`${MK('A')}"`); i = scanDq(text, i + 2, sink) + 1; put('"'); continue; }
    if (c === '<' && n === '<' && text[i + 2] === '<') { put('<<<'); i += 3; continue; }
    if (c === '<' && n === '<') { i = heredocOp(i); continue; }
    if ((c === '$' || c === '<' || c === '>') && n === '(') { i = substAt(text, i + 2, ')', `${c}(`, sink); continue; }
    if (c === '$' && n === '{') { i = paramAt(text, i, sink); continue; }
    if (c === '`') { if (close === '`') return i; i = substAt(text, i + 1, '`', '`', sink); continue; }
    if (c === '#' && wordStart(i)) { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '\n' && pending.length) { put('\n'); i = readHeredocs(i + 1); continue; }
    if (wordStart(i) && /^(case|esac)(?![^\s;&|()<>])/.test(text.slice(i, i + 5)) && cmdPos(i)) {
      if (text.startsWith('case', i)) caseDepth++;
      else if (caseDepth > 0) caseDepth--;
      put(text.slice(i, i + 4));
      i += 4;
      continue;
    }
    if (c === '(') { if (++depth > MAX_NEST) fail('nesting deeper than 32'); }
    else if (c === ')') {
      if (depth > 0) depth--;
      else if (caseDepth > 0) { /* a case pattern terminator */ }
      else if (close === ')') return i;
      else fail('unbalanced parenthesis');
    }
    put(c);
    i++;
  }
  if (close) fail(`unterminated ${close === ')' ? '$(' : '`'} substitution`);
  if (depth !== 0) fail('unbalanced parenthesis');
  if (caseDepth !== 0) fail('unterminated case');
  return i;
}
function maskSubst(text) {
  if (text.length > MAX_LEN) fail('command longer than 16 KB');
  nest = 0;
  const sink = { out: [], bodies: [] };
  scanCtx(text, 0, null, sink);
  return { masked: sink.out.join(''), bodies: sink.bodies };
}
const RISKY_BODY = (b) => (/\bgit\b/.test(b) && /\b(commit|merge|tag|notes|push)\b/.test(b)) || /\bgh\s/.test(b);

const WRAPPERS = ['command', 'exec', 'nohup', 'time', 'builtin', 'timeout', 'stdbuf', 'nice', 'coproc', 'sudo'];
// Options that take a separate value, for the wrappers that have them.
const WRAP_VALUE = new Set(['--max-args', '--adjustment', '--output', '--error', '--input', '--signal', '--kill-after', '-n', '-P', '-s', '-k', '-I', '-d', '-a', '-L', '-E', '-S', '-i', '-o', '-e']);
const SUDO_VALUE = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--role', '--type', '--other-user', '--command-timeout']);
const MENTIONS_GIT = (w) => /\b(git|gh)\b/.test(w);
// Drop leading env/command/sudo/VAR=val wrappers and reduce an absolute git/gh/shell path to its name.
// Returns the command words, the VAR=val assignments, directory changes (env -C, sudo -D), and
// whether the wrapper hides the command (exec with git/gh, env -S).
function unwrap(t) {
  let k = 0;
  const assigns = [];
  const chdirs = [];
  let hidden = false;
  const take = (w) => { const i = w.indexOf('='); assigns.push({ name: w.slice(0, i), value: w.slice(i + 1) }); };
  while (k < t.length) {
    const w = t[k];
    if (VAR_ASSIGN.test(w)) { take(w); k++; continue; }
    const b = path.basename(w);
    if (b === 'env') {
      k++;
      while (k < t.length && (t[k].startsWith('-') || VAR_ASSIGN.test(t[k]))) {
        const o = t[k];
        if (VAR_ASSIGN.test(o)) take(o);
        else if (o === '-C' || o === '--chdir') { chdirs.push(t[k + 1]); k++; } else if (o.startsWith('--chdir=')) chdirs.push(o.slice(8));
        else if (/^-C./.test(o)) chdirs.push(o.slice(2));
        else if (o.startsWith('--split-string') || /^-[A-Za-z]*S/.test(o)) hidden = true;
        else if (o === '-u' || o === '--unset') k++;
        k++;
      }
      continue;
    }
    if ((b === 'xargs' || b === 'parallel') && t.slice(k + 1).some(MENTIONS_GIT)) { hidden = true; break; }
    if (WRAPPERS.includes(b)) {
      if (b === 'exec' && t.slice(k + 1).some(MENTIONS_GIT)) hidden = true;
      const values = b === 'sudo' ? SUDO_VALUE : ['timeout', 'stdbuf', 'nice'].includes(b) ? WRAP_VALUE : new Set();
      k++;
      while (k < t.length && t[k].startsWith('-') && t[k] !== '-') {
        const o = t[k];
        if (b === 'sudo' && (o === '-D' || o === '--chdir')) chdirs.push(t[k + 1]);
        else if (b === 'sudo' && o.startsWith('--chdir=')) chdirs.push(o.slice(8));
        else if (b === 'sudo' && /^-D./.test(o)) chdirs.push(o.slice(2));
        if (values.has(o)) k++;
        k++;
      }
      if (b === 'timeout' && k < t.length) k++; // the duration
      if (b === 'coproc' && /^[A-Za-z_]\w*$/.test(t[k] || '') && t[k + 1] !== undefined && (t[k + 1] === '{' || t[k + 1].startsWith('('))) k++; // coproc NAME
      continue;
    }
    break;
  }
  const rest = t.slice(k);
  if (rest.length) { const b = path.basename(rest[0]); if (['git', 'gh', ...SHELLS].includes(b)) rest[0] = b; }
  return { rest, assigns, chdirs, hidden };
}

// Shell reserved words, case labels and function headers are transparent: the command after them runs.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'in', 'esac', '!', 'select', '{', '}', '(', ')', '()']);
const FUNC_HEAD = /^[^\s()=$`]+\(\)[{(]*/;
function stripKeywords(t) {
  let a = t;
  for (;;) {
    if (!a.length) return a;
    const w = a[0];
    if (w === 'case') { const i = a.findIndex((x) => x.endsWith(')')); a = i >= 0 ? a.slice(i + 1) : []; continue; }
    if (w === 'function') {
      // function NAME, function NAME(), function NAME(){, function NAME()(cmd
      const r = a.length > 1 ? a[1].replace(/^[^()]*(?:\(\))?[{(]*/, '') : '';
      a = r ? [r, ...a.slice(2)] : a.slice(2);
      continue;
    }
    if (FUNC_HEAD.test(w)) { const r = w.replace(FUNC_HEAD, ''); a = r ? [r, ...a.slice(1)] : a.slice(1); continue; }
    if (a[1] === '()' && /^[^\s()=$`]+$/.test(w)) { a = a.slice(2); continue; }
    if (w.length > 1 && w[0] === '(') { a = [w.replace(/^\(+/, ''), ...a.slice(1)]; continue; }
    if (KEYWORDS.has(w) || /^[\w.*?[\]-]+\)$/.test(w)) { a = a.slice(1); continue; }
    return a;
  }
}

// Keywords and wrappers can alternate (coproc { ...; }, time -p, if sudo ...): peel until stable.
function peel(tokens) {
  let a = tokens;
  const assigns = [];
  const chdirs = [];
  let persistent = false;
  let hidden = false;
  let settled = false;
  for (let n = 0; n < 100 && !settled; n++) {
    const before = JSON.stringify(a);
    a = stripKeywords(a);
    if (a[0] === 'export') { a = a.slice(1); persistent = true; }
    const u = unwrap(a);
    assigns.push(...u.assigns);
    chdirs.push(...u.chdirs);
    hidden = hidden || u.hidden;
    a = u.rest;
    if (JSON.stringify(a) === before) settled = true;
  }
  if (!settled) fail('too many keywords and wrappers to peel');
  return { t: a, assigns, chdirs, persistent, hidden };
}

function moveDir(d, target) {
  if (target === undefined || UNSAFE_DIR.test(target)) return null;
  if (path.isAbsolute(target)) return target;
  return d === null ? null : path.join(d, target);
}

const GIT_ARG_GLOBALS = ['-c', '--namespace', '--super-prefix', '--exec-path', '--config-env'];
function describe(t, live) {
  if (t[0] === 'git') {
    let dirs = live;
    let k = 1;
    while (k < t.length && t[k].startsWith('-')) {
      const w = t[k];
      if (w === '--git-dir' || w.startsWith('--git-dir=')) {
        const v = w === '--git-dir' ? t[k + 1] : w.slice(10);
        dirs = dirs.map((d) => { const m = moveDir(d, v); return m === null ? null : path.dirname(m); });
        k += w === '--git-dir' ? 2 : 1;
      } else if (w === '-C' || w === '--work-tree') { const v = t[k + 1]; dirs = dirs.map((d) => moveDir(d, v)); k += 2; } else if (w.startsWith('--work-tree=')) { const v = w.slice(12); dirs = dirs.map((d) => moveDir(d, v)); k++; } else if (GIT_ARG_GLOBALS.includes(w) || w.startsWith('--config-env=')) {
        const v = w.includes('=') ? w.slice(w.indexOf('=') + 1) : t[k + 1] || '';
        if ((w === '-c' || w.startsWith('--config-env')) && (/^alias\./i.test(v) || /[$`]/.test(v))) return { prog: 'unparsed', why: 'git aliases cannot be checked', dirs };
        k += w.includes('=') ? 1 : 2;
      } else k++;
    }
    if (/[$`]/.test(t[k] || '')) return { prog: 'subst', dirs };
    if (t[k] === 'config' && t.slice(k + 1).some((a) => /^alias\./i.test(a))) return { prog: 'unparsed', why: 'git aliases cannot be checked', dirs };
    return { prog: 'git', sub: t[k] || '', args: t.slice(k + 1), dirs };
  }
  if (t[0] === 'gh') {
    let k = 1;
    while (k < t.length && t[k].startsWith('-')) { if (t[k] === '-R' || t[k] === '--repo') k += 2; else k++; }
    if (/[$`]/.test(`${t[k] || ''}${t[k + 1] || ''}`)) return { prog: 'subst', dirs: live };
    if (t[k] === 'api') return { prog: 'gh', sub: 'api', args: t.slice(k + 1), dirs: live };
    return { prog: 'gh', sub: `${t[k] || ''} ${t[k + 1] || ''}`.trim(), args: t.slice(k + 2), dirs: live };
  }
  if (SHELLS.includes(t[0])) {
    const i = t.findIndex((x, n) => n > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
    if (i > 0) return { prog: 'shell', str: t[i + 1] || '', dirs: live };
  }
  return null;
}

function union(a, b) { const out = [...a]; for (const x of b) if (!out.includes(x)) out.push(x); return out; }

function envMove(dirs, assigns) {
  let out = dirs;
  for (const { name, value } of assigns) {
    if (name === 'GIT_WORK_TREE') out = out.map((d) => moveDir(d, value));
    else if (name === 'GIT_DIR') out = out.map((d) => { const m = moveDir(d, value); return m === null ? null : path.dirname(m); });
  }
  return out;
}

// Segments of a command with the directories each may run in (cd, pushd/popd, git -C, GIT_DIR tracked).
// A command that cannot be parsed yields an 'unparsed' item; maybeProduct marks one that may move
// into product by means the guard could not follow.
const MOVES = /cd|pushd|chdir|-C|GIT_|--git-dir|--work-tree|product/;
// Whether a command the guard failed on may act in product by means it could not follow.
const maybeProductText = (command) => MENTIONS_GIT(String(command)) && MOVES.test(String(command));
function walk(command, cwd) {
  const start = path.resolve(cwd || process.cwd());
  const text = String(command);
  try {
    return walkIn(text, [start], true);
  } catch (e) {
    // Any failure (a parse refusal, a RangeError, a bug) is treated as unparseable.
    return [{ prog: 'unparsed', why: e instanceof Unparseable ? e.message : 'analysis error', dirs: [start, null], maybeProduct: maybeProductText(text) }];
  }
}
// The entry point's rule when the guard itself throws: effective dir in product, hook cwd at the
// role directory, or git/gh with a directory change in the text.
function failClosed({ command, cwd, roleDir }) {
  const start = path.resolve(cwd || process.cwd());
  return anyInProduct([start, null], roleDir, start) || maybeProductText(command);
}

function walkIn(command, startDirs, top) {
  const items = [];
  let live = startDirs;
  let deferred = [];
  const stack = [];
  if (top && CONTROL.test(command)) fail('control characters');
  if (top && PRIVATE_USE.test(command)) fail('private-use characters');
  const { masked, bodies: allBodies } = maskSubst(command);
  const segs = splitWithOps(masked);
  for (let n = 0; n < segs.length; n++) {
    const { text, op } = segs[n];
    if (RESUME_OPS.includes(op)) { live = union(live, deferred); deferred = []; }
    for (const m of text.matchAll(/\u0001S(\d+)\u0001/g)) {
      const body = allBodies[Number(m[1])];
      if (typeof body !== 'string') throw new Error('substitution marker out of range');
      if (RISKY_BODY(body)) items.push({ prog: 'subst', dirs: live });
      items.push(...walkIn(body, live, false));
    }
    if (text.includes(MK('A'))) items.push({ prog: 'unparsed', why: '$\'...\' or $"..." quoting', dirs: live });
    const { t, assigns, chdirs, persistent, hidden } = peel(tokensQ(text.replace(/^[\s({]+/, '')));
    if (persistent && [...assigns.map((a) => a.name), ...t].some((w) => /^GIT_CONFIG/.test(w))) { items.push({ prog: 'unparsed', why: 'git configuration from the environment cannot be checked', dirs: live }); continue; }
    if (!t.length || persistent) { live = envMove(live, assigns); if (!t.length) continue; }
    if (t[0] === 'popd') { live = stack.pop() || [null]; continue; }
    if (t[0] === 'cd' || t[0] === 'pushd') {
      if (t[0] === 'pushd') stack.push(live);
      const unknown = t.length !== 2 || t[1].startsWith('-') || UNSAFE_DIR.test(t[1]);
      const moved = live.map((d) => (unknown ? null : path.isAbsolute(t[1]) ? path.resolve(t[1]) : d === null ? null : path.resolve(d, t[1])));
      const nextOp = segs[n + 1] ? segs[n + 1].op : '';
      const reliable = nextOp === '&&' && !['||', '|'].includes(op);
      if (reliable) { deferred = union(deferred, live); live = union([], moved); } else live = union(live, moved);
      continue;
    }
    const here = chdirs.reduce((ds, c) => ds.map((d) => moveDir(d, c)), persistent ? live : envMove(live, assigns));
    if (hidden || t[0] === 'eval') { items.push({ prog: 'unparsed', why: 'eval, exec, env -S, xargs or parallel hides the command', dirs: here }); continue; }
    if (/[$`]/.test(t[0])) { items.push({ prog: 'unparsed', why: 'the command word is a substitution', dirs: here }); continue; }
    if (t[0] === 'git' && assigns.some((a) => /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_)/.test(a.name))) { items.push({ prog: 'unparsed', why: 'git configuration from the environment cannot be checked', dirs: here }); continue; }
    const item = describe(t, here);
    if (item) items.push(item);
  }
  return items;
}

// ---------- message extraction ----------
const GIT_SPECS = {
  commit: { text: ['-m', '--message', '--trailer'], file: ['-F', '--file', '-t', '--template'], letters: 'mFtcC' },
  merge: { text: ['-m', '--message'], file: ['-F', '--file'], letters: 'mF' },
  tag: { text: ['-m', '--message'], file: ['-F', '--file'], letters: 'mFu' },
  notes: { text: ['-m', '--message'], file: ['-F', '--file'], letters: 'mFC' },
};
const GH_SPEC = { text: ['--title', '-t', '--body', '-b', '--subject', '--comment', '-c', '--notes', '-n'], file: ['--body-file', '--notes-file', '-F'], letters: 'tbcnF' };
const GH_WRITES = ['pr create', 'pr edit', 'pr comment', 'pr merge', 'pr review', 'pr close', 'pr reopen', 'issue comment', 'issue close', 'issue edit', 'issue reopen', 'release create', 'release edit'];

function parseFlags(args, spec, abbrev) {
  const out = [];
  const longs = [...spec.text, ...spec.file].filter((f) => f.startsWith('--'));
  const kindOf = (f) => (spec.text.includes(f) ? 'text' : spec.file.includes(f) ? 'file' : null);
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--') break;
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq > 0 ? w.slice(0, eq) : w;
      let key = kindOf(name) ? name : null;
      if (!key && abbrev && name.length >= 4) key = longs.find((f) => f.startsWith(name)) || null;
      if (!key) continue;
      const value = eq > 0 ? w.slice(eq + 1) : args[i + 1];
      if (eq < 0) i++;
      if (value !== undefined) out.push({ kind: kindOf(key), value });
    } else if (/^-[A-Za-z]/.test(w)) {
      for (let j = 1; j < w.length; j++) {
        const ch = w[j];
        if (!spec.letters.includes(ch)) continue;
        const rest = w.slice(j + 1);
        const value = rest || args[i + 1];
        if (!rest) i++;
        const kind = kindOf(`-${ch}`);
        if (kind && value !== undefined) out.push({ kind, value });
        break;
      }
    }
  }
  return out;
}

function itemMessages(item) {
  let spec = null;
  if (item.prog === 'git') spec = GIT_SPECS[item.sub];
  else if (item.prog === 'gh' && GH_WRITES.includes(item.sub)) spec = GH_SPEC;
  if (!spec) return [];
  return parseFlags(item.args, spec, item.prog === 'git').map((f) => {
    if (f.kind === 'file') return `<file: ${f.value}>`;
    return /[$`]|\\[A-Za-z]/.test(f.value) ? `<subst: ${unsent(f.value)}>` : unsent(f.value);
  });
}

function extractMessages(command, cwd) {
  const out = [];
  for (const item of walk(command, cwd)) out.push(...itemMessages(item));
  return out;
}

// gh api writes: a non-GET method, a field/input flag, or an issues/comments path.
function ghApiWrite(args) {
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w.startsWith('--')) {
      const name = w.split('=')[0];
      if (['--field', '--raw-field', '--input'].includes(name)) return true;
      if (name === '--method') { const v = (w.includes('=') ? w.slice(w.indexOf('=') + 1) : args[i + 1] || '').toUpperCase(); if (v !== 'GET') return true; }
    } else if (/^-[A-Za-z]/.test(w)) {
      for (let j = 1; j < w.length; j++) {
        const ch = w[j];
        if (ch === 'f' || ch === 'F') return true;
        if (ch === 'X') { const v = (w.slice(j + 1) || args[i + 1] || '').toUpperCase(); if (v !== 'GET') return true; break; }
        if ('HqtjpR'.includes(ch)) break;
      }
    } else if (/\/(issues|comments)/.test(w)) return true;
  }
  return false;
}

// ---------- matching ----------
const normWith = (s, cf) => String(s || '').normalize('NFKC').replace(/\p{Cf}/gu, cf).toLowerCase().replace(/\s+/g, ' ');
const norm = (s) => normWith(s, '');
const normSpaced = (s) => normWith(s, ' ');
// git push: remote and refspec words may be expanded (a refspec with $ counts as a tag push in
// pushInfo); push options and their values may not. Returns the first expanded option, if any.
const PUSH_VALUE_OPTS = ['-o', '--push-option', '--receive-pack', '--exec', '--repo'];
function pushOptionExpanded(args) {
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--') break;
    if (!w.startsWith('-')) continue;
    if (/[$`]/.test(w)) return w;
    if (PUSH_VALUE_OPTS.includes(w)) { const v = args[i + 1]; if (v !== undefined && /[$`]/.test(v)) return v; i++; }
  }
  return undefined;
}
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

// Two haystacks: format characters deleted, and replaced by a space; a phrase in either matches.
const hays = (s) => [norm(s), normSpaced(s)];
const inAny = (hs, n) => hs.some((h) => h.includes(n));

function scanText(text, denylist) {
  const hay = hays(text);
  if (inAny(hay, '.delivery/')) return { phrase: '.delivery/' };
  for (const p of denylist) { const n = norm(p).trim(); if (n && inAny(hay, n)) return { phrase: p }; }
  return null;
}

const UNANALYSABLE = 'leak guard could not analyse this command; run git and gh as plain commands with inline text';
const RULE = ' Only Refs <bead id> is allowed; describe the change to the product, never the plan.';

function filePathsOf(input) {
  const i = input || {};
  const out = [];
  if (i.file_path) out.push(i.file_path);
  if (i.notebook_path) out.push(i.notebook_path);
  if (Array.isArray(i.edits)) for (const e of i.edits) if (e && e.file_path) out.push(e.file_path);
  return out;
}

function decideLeak({ toolName, toolInput, cwd, roleDir, denylist }) {
  const base = path.resolve(cwd || process.cwd());
  const shell = shellCommandOf(toolName, toolInput);
  if (shell !== null) {
    const cmd = shell;
    for (const item of walk(cmd, base)) {
      if (!item.maybeProduct && !anyInProduct(item.dirs, roleDir, base)) continue;
      if (item.prog === 'unparsed') return { reason: `${UNANALYSABLE} (${item.why}).` };
      if (item.prog === 'subst') return { reason: 'Run git and gh as plain commands so the text can be checked; command substitution hides it.' };
      if (item.prog === 'shell') {
        if (/\b(git|gh)\s/.test(item.str)) return { reason: 'Run git and gh directly so the text can be checked; wrapping them in a shell -c string hides it.' };
        continue;
      }
      if (item.prog === 'gh' && item.sub === 'issue create') return { reason: 'GitHub issues in the product repo are for users; record internal work in beads.' };
      if (item.prog === 'gh' && item.sub === 'api' && ghApiWrite(item.args)) return { reason: 'Public writes through gh api cannot be checked; use the checked gh commands (pr, issue comment) with inline text.' };
      const writes = (item.prog === 'git' && ['commit', 'merge', 'tag', 'notes', 'push'].includes(item.sub)) || (item.prog === 'gh' && (GH_WRITES.includes(item.sub) || item.sub === 'issue create' || item.sub === 'api'));
      const injected = !writes ? undefined : item.prog === 'git' && item.sub === 'push' ? pushOptionExpanded(item.args) : item.args.find((x) => /[$`]/.test(x));
      if (injected !== undefined) return { reason: `Write arguments inline, without $ or backticks, so they can be checked (${unsent(injected).slice(0, 60)}).${RULE}` };
      for (const m of itemMessages(item)) {
        if (BIDI.test(m)) return { reason: `Commit and PR text must not contain bidirectional control characters.${RULE}` };
        if (m.startsWith('<subst:')) return { reason: `Write the text inline, without substitutions or escapes, so it can be checked (${m.slice(0, 60)}).${RULE}` };
        if (m.startsWith('<file:')) return { reason: `Commit and PR text must be inline so it can be checked (${m}).${RULE}` };
        const hit = scanText(m, denylist);
        if (hit) return { reason: `Commit or PR text contains a plan phrase: "${hit.phrase}".${RULE}` };
      }
    }
    return null;
  }
  if (['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(toolName)) {
    const prod = fold(productDir(roleDir));
    for (const fp of filePathsOf(toolInput)) {
      const abs = fold(realish(path.isAbsolute(fp) ? fp : path.join(base, fp)));
      if (!under(abs, prod)) continue;
      const parts = path.relative(prod, abs).split(path.sep);
      if (parts.includes(fold('.delivery')) || parts.includes(fold('.beads')) || parts[parts.length - 1] === 'team.json') {
        return { reason: `Plan files (${fp}) never live in the product repo (.delivery, .beads, team.json); they belong in the project repo.` };
      }
    }
  }
  return null;
}

// ---------- push re-scan ----------
const PREPUSH = '.delivery-prepush';
const gitIn = (dir) => (args) => { try { return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (err) { return ''; } };

// git pushes in the product worktree: [{ dir, tags }]. A pushed ref that is a tag counts as a tag push.
function pushInfo(command, cwd, roleDir, git) {
  const out = [];
  for (const item of walk(command, cwd)) {
    if (item.prog !== 'git' || item.sub !== 'push' || !anyInProduct(item.dirs, roleDir, cwd)) continue;
    const names = item.args.filter((a) => !a.startsWith('-')).flatMap((a) => a.replace(/^\+/, '').split(':')).filter(Boolean);
    for (const d of item.dirs) {
      if (d === null ? !anyInProduct([null], roleDir, cwd) : !dirUnderProduct(d, roleDir)) continue;
      const dir = d === null ? path.resolve(cwd) : d;
      const run = git || gitIn(dir);
      const tags = item.args.some((a) => a === '--tags' || a === '--follow-tags') || names.some((n) => /[$`]/.test(n)) || names.some((n) => n.includes('refs/tags/') || run(['tag', '-l', n]).trim() === n);
      out.push({ dir, tags });
    }
  }
  return out;
}

function readPrepush(roleDir) { try { return JSON.parse(fs.readFileSync(path.join(roleDir, PREPUSH), 'utf8')) || {}; } catch (e) { return {}; } }
function prepushKey(dir) { return fold(realish(path.resolve(dir))); }

function recordPrepush({ roleDir, dir, git }) {
  const run = git || gitIn(dir);
  const sha = run(['rev-parse', '@{upstream}']).trim();
  const all = readPrepush(roleDir);
  all[prepushKey(dir)] = sha || null;
  fs.writeFileSync(path.join(roleDir, PREPUSH), JSON.stringify(all));
}

function clearPrepush(roleDir, dir) {
  const all = readPrepush(roleDir);
  delete all[prepushKey(dir)];
  try { fs.writeFileSync(path.join(roleDir, PREPUSH), JSON.stringify(all)); } catch (e) { /* ignore */ }
}

function scanPushed({ cwd, roleDir, denylist, git, tags }) {
  if (!inProductWorktree(cwd, roleDir)) return [];
  const run = git || gitIn(cwd);
  const all = readPrepush(roleDir);
  const key = prepushKey(cwd);
  let log;
  if (Object.prototype.hasOwnProperty.call(all, key) && all[key]) log = run(['log', `${all[key]}..HEAD`, '--format=%B']);
  else if (run(['rev-parse', '--verify', '-q', 'origin/HEAD']).trim()) log = run(['log', 'origin/HEAD..HEAD', '--format=%B']);
  else log = run(['log', '-n', '20', '--format=%B']);
  if (tags) log += `\n${run(['for-each-ref', 'refs/tags', '--format=%(contents)'])}`;
  const hay = hays(log);
  const hits = [];
  for (const p of denylist) { const n = norm(p).trim(); if (n && inAny(hay, n) && !hits.includes(p)) hits.push(p); }
  if (inAny(hay, '.delivery/') && !hits.includes('.delivery/')) hits.push('.delivery/');
  return hits;
}

module.exports = { UNANALYSABLE, failClosed, loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, scanPushed, pushInfo, recordPrepush, clearPrepush };
