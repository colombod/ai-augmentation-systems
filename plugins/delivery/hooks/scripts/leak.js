// hooks/scripts/leak.js — keep plans and strategy out of the public product repo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { splitWithOps, realish, shellCommandOf, ghApiCall, prOpenCall } = require('./lane.js');

function loadDenylist(projectRoot) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ---------- paths ----------
// Compare paths case-insensitively on every platform: the plan-file segments (.delivery, .beads, team.json)
// and the product directory must not be dodged by case on a case-insensitive filesystem, and a repo moves
// between systems. A directory that differs only by case is over-denied on Linux, which is harmless.
const CI = true;
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
    let repo = null;
    while (k < t.length && t[k].startsWith('-')) {
      if (t[k] === '-R' || t[k] === '--repo') { repo = t[k + 1] || null; k += 2; } else { if (t[k].startsWith('--repo=')) repo = t[k].slice(7); k++; }
    }
    if (/[$`]/.test(`${t[k] || ''}${t[k + 1] || ''}`)) return { prog: 'subst', dirs: live };
    if (t[k] === 'api') return { prog: 'gh', sub: 'api', args: t.slice(k + 1), dirs: live, repo };
    return { prog: 'gh', sub: `${t[k] || ''} ${t[k + 1] || ''}`.trim(), args: t.slice(k + 2), dirs: live, repo };
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

// Opening a pull request through REST (POST repos/<o>/<r>/pulls with inline fields) is checked like gh pr create.
const prOpenOf = (item) => (item.prog === 'gh' && item.sub === 'api' ? ghApiCall(['gh', 'api', ...item.args]) : null);
function itemMessages(item) {
  const open = prOpenOf(item);
  if (open && prOpenCall(open)) return ['title', 'body'].filter((k) => k in open.fields).map((k) => (/[$`]|\\[A-Za-z]/.test(open.fields[k]) ? `<subst: ${unsent(open.fields[k])}>` : unsent(open.fields[k])));
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
  // the private operator store's path: operator records never travel in product text
  if (inAny(hay, 'delivery-operator/')) return { phrase: 'delivery-operator/' };
  for (const p of denylist) { const n = norm(p).trim(); if (n && inAny(hay, n)) return { phrase: p }; }
  return null;
}

// ---------- the strategy leak gate ----------
// The owner's ask (2026-10-31): nothing of the private plan reaches the public product repository, with
// no promise the gate cannot keep. It catches exact terms (denylist, leak-extras.txt) and 8-word passages
// copied from the plan (scripts/lib/plan-print.js); it does not catch paraphrase, and the docs say so.
let PP = null;
const planPrint = () => PP || (PP = require('../../scripts/lib/plan-print.js'));

// The review binding requires a `Refs <bead id>` line, and a spike's id contains the initiative slug, which
// the denylist holds: the guard refused its own required line. A Refs line of bead ids is not scanned. An id
// has a prefix, a hyphen and a digit somewhere (dlv-4oj, <prefix>-<slug>-spike-s1, <prefix>-<slug>-01), so
// a bare slug or phrase after Refs is still scanned.
const BEAD_ID = '[A-Za-z0-9]+-[\\w.-]*\\d[\\w.-]*';
const REFS_LINE = new RegExp(`^[ \\t]*Refs:?[ \\t]+${BEAD_ID}(?:[ \\t]*,[ \\t]*${BEAD_ID})*[ \\t]*$`, 'gim');
const withoutRefs = (t) => String(t).replace(REFS_LINE, '');

// The denylist and the owner's extras, less what the allowlist says is public by design.
function termsOf(denylist, print) {
  const allow = new Set(((print && print.allow) || []).map((a) => String(a).toLowerCase()));
  return [...(denylist || []), ...((print && print.terms) || [])].filter((t) => !allow.has(String(t).toLowerCase()));
}

// The first plan material in text: { what } naming it for the refusal, or null.
function planHit(text, terms, print) {
  const t = withoutRefs(text);
  const hit = scanText(t, terms);
  if (hit) return { what: `a plan phrase: "${hit.phrase}"` };
  const p = print && print.shingles ? planPrint().passage(t, print) : null;
  if (p) return { what: `words copied from the private plan: "${p.words}" (from ${p.source})` };
  return null;
}
// Two lines at most (R-46): what matched and where it came from, then the way out. The Product Manager
// keeps .delivery/team/leak-allow.txt for what is public by design.
const PUBLIC_OK = 'if the words are public by design, message the Product Manager';
const TEXT_FIX = `\nDescribe the change, never the plan: \`git commit -m '<the change>' -m 'Refs <bead id>'\`; ${PUBLIC_OK}.`;
const CODE_FIX = `\nRewrite it in your own words (the product's code and docs describe the product, never the plan); ${PUBLIC_OK}.`;

// Branch and tag names: words split on - _ / . and matched whole against the terms.
const nameWords = (s) => ` ${String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
function nameHit(name, terms) {
  const n = nameWords(name);
  for (const t of terms) { const w = nameWords(t); if (w.trim() && n.includes(w)) return t; }
  return null;
}
// flags whose next word is a value, not a name, per subcommand (git push -u takes none; git tag -u a key)
const VALUE_FLAGS = {
  push: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
  branch: ['-u', '--set-upstream-to', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format'],
  tag: ['-m', '-F', '-u', '--message', '--file', '--local-user', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '--cleanup'],
};
function refNames(item) {
  const a = item.args || [];
  const out = [];
  if (item.sub === 'checkout' || item.sub === 'switch') {
    for (let i = 0; i < a.length; i++) if (['-b', '-B', '-c', '-C', '--orphan'].includes(a[i]) && a[i + 1]) out.push(a[i + 1]);
    return out;
  }
  if (!['push', 'branch', 'tag'].includes(item.sub)) return out;
  // removing a name is how a plan-named branch is cleaned up: never refused
  if (a.some((x) => ['-d', '-D', '--delete'].includes(x) || (item.sub === 'push' && /^:/.test(x)))) return out;
  const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--') { pos.push(...a.slice(i + 1)); break; }
    if (a[i].startsWith('-')) { if (VALUE_FLAGS[item.sub].includes(a[i])) i++; continue; }
    pos.push(a[i]);
  }
  // push: the first word is the remote; the rest are refspecs, either side of a colon
  for (const w of item.sub === 'push' ? pos.slice(1) : pos) for (const side of w.replace(/^\+/, '').split(':')) if (side) out.push(side.replace(/^refs\/(heads|tags)\//, ''));
  return out;
}

// Added lines of the change a commit records, per file. -a commits the working tree, so it reads HEAD.
const DIFF_MAX = 4 * 1024 * 1024;
function stagedAdds(dir, all, max = DIFF_MAX) {
  // suppressBlankEmpty would print a blank context line with no leading space: keep git's default
  const run = (range) => execFileSync('git', ['-C', dir, '-c', 'diff.suppressBlankEmpty=false', 'diff', ...range, '-U0', '--no-color', '--no-ext-diff', '--no-textconv'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] });
  let out;
  try { out = run(all ? ['HEAD'] : ['--cached']); } catch (err) { if (!all) throw err; out = run(['--cached']); }
  const mine = addsOf(out, max);
  // Concluding a merge (a conflicted `git merge`, resolved and committed): the staged change against
  // HEAD holds everything the other side brings in, such as the default branch's own files. Only the
  // lines new against both parents are this commit's own text (delivery-plugin-planning-a1v): a line
  // added at the same place in the result against HEAD and against MERGE_HEAD. Both diffs end at the
  // same tree, so a destination line number names one line of the result.
  let other = null;
  try { other = execFileSync('git', ['-C', dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (err) { other = null; }
  if (!other) return mine.files.map(textOf);
  // --text: a parent's copy with a NUL byte would otherwise give 'Binary files differ' and no lines
  const theirs = addsOf(run(all ? ['--text', other] : ['--text', '--cached', other]), max);
  // a comparison cut short proves nothing about what is inherited: read the whole change instead
  if (theirs.truncated || mine.truncated) return mine.files.map(textOf);
  // a line the other side only moved or re-indented is that side's text, as in the first comparison
  const at = new Map(theirs.files.map((f) => [f.file, new Set(f.lines.filter((l) => !f.removed.has(l.text.trim())).map((l) => l.n))]));
  return mine.files.map((f) => ({ file: f.file, lines: f.lines.filter((l) => at.has(f.file) && at.get(f.file).has(l.n)), removed: f.removed }))
    .map(textOf).filter((f) => f.text);
}
const textOf = (f) => ({ file: f.file, text: f.lines.map((l) => l.text).filter((t) => !f.removed.has(t.trim())).join('\n') });
// Added lines per file from a `git diff -U0` output, each with its line number in the destination
// (from the hunk header); truncated when the output passed DIFF_MAX.
function addsOf(out, max = DIFF_MAX) {
  const files = [];
  // one set for the whole diff, as before: a line moved between files is not new text either
  const removed = new Set();
  let cur = null;
  let n = 0;
  let size = 0;
  let truncated = false;
  // a file's header lines (---, +++) come only between its `diff --git` line and its first hunk; inside
  // a hunk, an added line that starts with "++" is content, never a header
  let inHunk = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) { inHunk = false; cur = null; continue; }
    if (!inHunk && line.startsWith('+++ ')) { cur = { file: line.slice(4).replace(/^b\//, ''), lines: [], removed }; files.push(cur); continue; }
    if (!inHunk && line.startsWith('--- ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { n = Number(h[1]); inHunk = true; continue; }
    if (!cur || !inHunk) continue;
    // A line moved or re-indented was already in the product: not new text.
    if (line.startsWith('-')) { removed.add(line.slice(1).trim()); continue; }
    if (line.startsWith('+')) {
      if (size < max) { cur.lines.push({ n, text: line.slice(1) }); size += line.length; } else truncated = true;
      n += 1;
    } else if (line.startsWith(' ') || line === '') n += 1; // a context line (diff.interHunkContext) is in the result too

  }
  return { files, truncated };
}
// Outside a git work tree the commit fails on its own; there is no change to read.
function inGitTree(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}
const commitsAll = (args) => args.some((x) => x === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(x) && !/^-[A-Za-z]*[mFtcC][A-Za-z]*a/.test(x));

// The product repository a gh command writes to: -R/--repo, or the repos/<owner>/<repo> of a gh api path.
const slugOf = (s) => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
function ghTarget(item) {
  if (item.repo) return slugOf(item.repo);
  const a = item.args || [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-R' || a[i] === '--repo') return slugOf(a[i + 1]);
    if (a[i].startsWith('--repo=')) return slugOf(a[i].slice(7));
  }
  if (item.sub === 'api') { const m = a.map((x) => /^\/?repos\/([^/\s]+\/[^/\s?]+)/.exec(x)).find(Boolean); if (m) return slugOf(m[1]); }
  return null;
}
const targetsProduct = (item, productRepo) => !!productRepo && item.prog === 'gh' && ghTarget(item) === slugOf(productRepo);

const readSmall = (f, base) => { try { const p = path.isAbsolute(f) ? f : path.join(base, f); return fs.readFileSync(p, 'utf8').slice(0, DIFF_MAX); } catch (e) { return null; } };
// Text a gh command sends to the product from outside the product worktree (the Delivery Manager's
// comments, merge subjects, REST calls). Files are read rather than refused here: outside the product
// worktree the guard checks what it can and does not fail closed.
function ghOutsideTexts(item, base) {
  if (item.sub === 'api') {
    const out = [];
    const a = item.args;
    for (let i = 0; i < a.length; i++) {
      const w = a[i];
      let v = null;
      if (['-f', '-F', '--field', '--raw-field'].includes(w)) v = a[++i];
      else if (/^--(raw-)?field=/.test(w)) v = w.slice(w.indexOf('=') + 1);
      else if (/^-[fF]./.test(w)) v = w.slice(2);
      else if (w === '--input') { const t = readSmall(a[++i] || '', base); if (t !== null) out.push(t); continue; }
      if (v == null) continue;
      const val = v.includes('=') ? v.slice(v.indexOf('=') + 1) : v;
      if (val.startsWith('@')) { const t = readSmall(val.slice(1), base); if (t !== null) out.push(t); } else out.push(unsent(val));
    }
    return out;
  }
  if (!GH_WRITES.includes(item.sub) && item.sub !== 'issue create') return [];
  return parseFlags(item.args, GH_SPEC, false).map((f) => (f.kind === 'file' ? readSmall(f.value, base) || '' : unsent(f.value)));
}

const UNANALYSABLE = 'leak guard could not analyse this command.\nRun git and gh as plain commands with inline text: `git commit -m \'<the change>\'`';
const ISSUE_REASON = 'GitHub issues in the product repo are for users.\nRecord internal work in a bead: `bd create --parent <your bead> --title "<the work>"`.';
const RULE = '\nDescribe the change to the product, never the plan: `git commit -m \'<the change>\' -m \'Refs <bead id>\'`.';

// The lines of a product file as it is now (trimmed), and the lines of new text that are not among them.
function existingLines(abs) {
  try { return new Set(fs.readFileSync(abs, 'utf8').slice(0, DIFF_MAX).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)); } catch (e) { return new Set(); }
}
const newLines = (text, before) => (before.size ? String(text).split(/\r?\n/).filter((l) => !before.has(l.trim())).join('\n') : String(text));

// The text a Write, Edit, MultiEdit or NotebookEdit puts into a file.
function contentOf(input) {
  const i = input || {};
  const out = [i.content, i.new_string, i.new_source].filter((x) => typeof x === 'string');
  if (Array.isArray(i.edits)) for (const e of i.edits) if (e && typeof e.new_string === 'string') out.push(e.new_string);
  return out;
}

function filePathsOf(input) {
  const i = input || {};
  const out = [];
  if (i.file_path) out.push(i.file_path);
  if (i.notebook_path) out.push(i.notebook_path);
  if (Array.isArray(i.edits)) for (const e of i.edits) if (e && e.file_path) out.push(e.file_path);
  return out;
}

// MCP tools that may publish text to a forge (GitHub, GitLab): their inputs are scanned like gh.
const MCP_PUBLIC = /github|gitlab|issue|pull|comment|release|commit|repo/i;
// Whole tool names only: add_issue_comment and list_issue_types must not match. issue_write is a
// create only when its method says so (it also updates); the rest are creators by name.
const MCP_ISSUE_CREATE = /(^|__)(create_issue|add_issue|issue_write)$/i;
const mcpCreatesIssue = (name, input) => MCP_ISSUE_CREATE.test(name)
  && (!/(^|__)issue_write$/i.test(name) || String(input && input.method).toLowerCase() === 'create');
const MCP_DEPTH = 4;
const MCP_BUDGET = 256 * 1024;

// Every string value in a tool input, to depth 4, within the first 256 KB in total.
function mcpStrings(input) {
  const out = [];
  let left = MCP_BUDGET;
  const visit = (v, depth) => {
    if (left <= 0) return;
    if (typeof v === 'string') { out.push(v.slice(0, left)); left -= v.length; return; }
    if (!v || typeof v !== 'object' || depth >= MCP_DEPTH) return;
    for (const child of Array.isArray(v) ? v : Object.values(v)) visit(child, depth + 1);
  };
  visit(input, 0);
  return out;
}

// A role touches product when its role directory has a product worktree, or it is a builder.
function touchesProduct(roleDir, roleId) {
  if (roleId === 'builder') return true;
  try { return fs.existsSync(productDir(roleDir)); } catch (e) { return false; }
}

// print: the plan's fingerprint (plan-print.load); productRepo: team.json's product_github; diffOf: the
// added lines of a commit, injectable for tests. Without print the guard checks terms only, as before.
function decideLeak({ toolName, toolInput, cwd, roleDir, denylist, roleId, print = null, productRepo = null, diffOf = stagedAdds }) {
  const base = path.resolve(cwd || process.cwd());
  const name = String(toolName || '');
  const terms = termsOf(denylist, print);
  if (name.startsWith('mcp__') && MCP_PUBLIC.test(name) && touchesProduct(roleDir, roleId)) {
    if (mcpCreatesIssue(name, toolInput)) return { reason: ISSUE_REASON };
    for (const m of mcpStrings(toolInput)) {
      if (BIDI.test(m)) return { reason: `Public text must not contain bidirectional control characters (${name}).${RULE}` };
      const hit = planHit(m, terms, print);
      if (hit) return { reason: `Text sent through ${name} contains ${hit.what}.${TEXT_FIX}` };
    }
    return null;
  }
  const shell = shellCommandOf(toolName, toolInput);
  if (shell !== null) {
    const cmd = shell;
    for (const item of walk(cmd, base)) {
      if (!item.maybeProduct && !anyInProduct(item.dirs, roleDir, base)) {
        if (!targetsProduct(item, productRepo)) continue;
        for (const m of ghOutsideTexts(item, base)) {
          if (BIDI.test(m)) return { reason: `Text for the product repository must not contain bidirectional control characters.${RULE}` };
          const hit = planHit(m, terms, print);
          if (hit) return { reason: `Text for the product repository (${productRepo}) contains ${hit.what}.${TEXT_FIX}` };
        }
        continue;
      }
      if (item.prog === 'unparsed') return { reason: `${UNANALYSABLE.replace('command.\n', `command (${item.why}).\n`)}.` };
      if (item.prog === 'subst') return { reason: 'Command substitution hides the text from the leak check.\nRun git and gh as plain commands: `git commit -m \'<the change>\'`.' };
      if (item.prog === 'shell') {
        if (/\b(git|gh)\s/.test(item.str)) return { reason: 'A shell -c string hides the text from the leak check.\nRun git and gh directly: `git commit -m \'<the change>\'`.' };
        continue;
      }
      if (item.prog === 'gh' && item.sub === 'issue create') return { reason: ISSUE_REASON };
      if (item.prog === 'gh' && item.sub === 'api' && ghApiWrite(item.args) && !prOpenCall(prOpenOf(item))) return { reason: 'Public writes through gh api cannot be checked.\nUse a checked command with inline text: `gh pr comment <n> --body \'<text>\'`.' };
      const writes = (item.prog === 'git' && ['commit', 'merge', 'tag', 'notes', 'push'].includes(item.sub)) || (item.prog === 'gh' && (GH_WRITES.includes(item.sub) || item.sub === 'issue create' || item.sub === 'api'));
      const injected = !writes ? undefined : item.prog === 'git' && item.sub === 'push' ? pushOptionExpanded(item.args) : item.args.find((x) => /[$`]/.test(x));
      if (injected !== undefined) return { reason: `Write arguments inline, without $ or backticks, so they can be checked (${unsent(injected).slice(0, 60)}).${RULE}` };
      for (const m of itemMessages(item)) {
        if (BIDI.test(m)) return { reason: `Commit and PR text must not contain bidirectional control characters.${RULE}` };
        if (m.startsWith('<subst:')) return { reason: `Write the text inline, without substitutions or escapes, so it can be checked (${m.slice(0, 60)}).${RULE}` };
        if (m.startsWith('<file:')) return { reason: `Commit and PR text must be inline so it can be checked (${m}).${RULE}` };
        const hit = planHit(m, terms, print);
        if (hit) return { reason: `Commit or PR text contains ${hit.what}.${TEXT_FIX}` };
      }
      if (item.prog === 'git') {
        for (const ref of refNames(item)) {
          const t = nameHit(ref, terms);
          if (t) return { reason: `The branch or tag name "${ref}" carries a plan phrase: "${t}".\nName it after the change to the product, never the plan; ${PUBLIC_OK}.` };
        }
      }
      if (item.prog === 'git' && item.sub === 'commit') {
        const dir = item.dirs.find((d) => d !== null && dirUnderProduct(d, roleDir)) || base;
        let files;
        try { files = diffOf(dir, commitsAll(item.args)); } catch (err) { if (!inGitTree(dir)) continue; return { reason: `leak guard could not read the change this commit records (${String(err.message || err).split('\n')[0].slice(0, 80)}).\nStage the change with git add, then commit again.` }; }
        for (const f of files) {
          const hit = planHit(f.text, terms, print);
          if (hit) return { reason: `The change to ${f.file} contains ${hit.what}.${CODE_FIX}` };
        }
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
        return { reason: `Plan files (${fp}) never live in the product repo (.delivery, .beads, team.json).\nWrite it in the project repo, or message the Delivery Manager.` };
      }
      // Only lines the file does not already have: text that was public before the gate existed is the
      // owner's call (2026-10-31: "not a risk"), and must not lock out whoever edits that file next.
      const before = existingLines(path.isAbsolute(fp) ? fp : path.join(base, fp));
      for (const text of contentOf(toolInput)) {
        const hit = planHit(newLines(text.slice(0, DIFF_MAX), before), terms, print);
        if (hit) return { reason: `Writing ${fp}: the text contains ${hit.what}.${CODE_FIX}` };
      }
    }
  }
  return null;
}

module.exports = { UNANALYSABLE, failClosed, loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, stagedAdds, refNames, nameHit, withoutRefs };
