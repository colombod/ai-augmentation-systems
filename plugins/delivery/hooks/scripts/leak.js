// hooks/scripts/leak.js — keep plans and strategy out of the public product repo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { splitWithOps, tokens, realish } = require('./lane.js');

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

// Drop leading env/command/VAR=val wrappers and reduce an absolute git/gh/shell path to its name.
// Returns the command words and the VAR=val assignments seen on the way.
function unwrap(t) {
  let k = 0;
  const assigns = [];
  const take = (w) => { const i = w.indexOf('='); assigns.push({ name: w.slice(0, i), value: w.slice(i + 1) }); };
  while (k < t.length) {
    const w = t[k];
    if (VAR_ASSIGN.test(w)) { take(w); k++; continue; }
    const b = path.basename(w);
    if (b === 'env') {
      k++;
      while (k < t.length && (t[k].startsWith('-') || VAR_ASSIGN.test(t[k]))) {
        if (VAR_ASSIGN.test(t[k])) take(t[k]);
        else if (['-u', '-C', '-S'].includes(t[k])) k++;
        k++;
      }
      continue;
    }
    if (['command', 'exec', 'nohup', 'time', 'builtin'].includes(b)) { k++; while (k < t.length && t[k].startsWith('-')) k++; continue; }
    break;
  }
  const rest = t.slice(k);
  if (rest.length) { const b = path.basename(rest[0]); if (['git', 'gh', ...SHELLS].includes(b)) rest[0] = b; }
  return { rest, assigns };
}

// Shell reserved words and case labels are transparent: the command after them is what runs.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'in', 'esac', '!', 'time', 'select', 'function', '{', '}', '(', ')']);
function stripKeywords(t) {
  let a = t;
  for (;;) {
    if (!a.length) return a;
    if (a[0] === 'case') { const i = a.findIndex((w) => w.endsWith(')')); a = i >= 0 ? a.slice(i + 1) : []; continue; }
    if (KEYWORDS.has(a[0]) || /^[\w.*?[\]-]+\)$/.test(a[0])) { a = a.slice(1); continue; }
    return a;
  }
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
      } else if (w === '-C' || w === '--work-tree') { const v = t[k + 1]; dirs = dirs.map((d) => moveDir(d, v)); k += 2; } else if (w.startsWith('--work-tree=')) { const v = w.slice(12); dirs = dirs.map((d) => moveDir(d, v)); k++; } else if (GIT_ARG_GLOBALS.includes(w)) k += 2;
      else k++;
    }
    return { prog: 'git', sub: t[k] || '', args: t.slice(k + 1), dirs };
  }
  if (t[0] === 'gh') {
    let k = 1;
    while (k < t.length && t[k].startsWith('-')) { if (t[k] === '-R' || t[k] === '--repo') k += 2; else k++; }
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
function walk(command, cwd) {
  const items = [];
  let live = [path.resolve(cwd || process.cwd())];
  let deferred = [];
  const stack = [];
  const segs = splitWithOps(command);
  for (let n = 0; n < segs.length; n++) {
    const { text, op } = segs[n];
    if (RESUME_OPS.includes(op)) { live = union(live, deferred); deferred = []; }
    if (/\$\(|`/.test(text) && /\b(git|gh)\s/.test(text)) items.push({ prog: 'subst', dirs: live });
    let raw = stripKeywords(tokens(text.replace(/^[\s({]+/, '')));
    let persistent = false;
    if (raw[0] === 'export') { raw = raw.slice(1); persistent = true; }
    const { rest: t, assigns } = unwrap(raw);
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
    const item = describe(t, persistent ? live : envMove(live, assigns));
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
const GH_WRITES = ['pr create', 'pr edit', 'pr comment', 'pr merge', 'pr review', 'pr close', 'issue comment', 'issue close', 'issue edit', 'release create', 'release edit'];

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
    return /[$`]|\\[A-Za-z]/.test(f.value) ? `<subst: ${f.value}>` : f.value;
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
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

function scanText(text, denylist) {
  const hay = norm(text);
  if (hay.includes('.delivery/')) return { phrase: '.delivery/' };
  for (const p of denylist) { const n = norm(p).trim(); if (n && hay.includes(n)) return { phrase: p }; }
  return null;
}

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
  if (toolName === 'Bash') {
    const cmd = String((toolInput || {}).command || '');
    for (const item of walk(cmd, base)) {
      if (!anyInProduct(item.dirs, roleDir, base)) continue;
      if (item.prog === 'subst') return { reason: 'Run git and gh as plain commands so the text can be checked; command substitution hides it.' };
      if (item.prog === 'shell') {
        if (/\b(git|gh)\s/.test(item.str)) return { reason: 'Run git and gh directly so the text can be checked; wrapping them in a shell -c string hides it.' };
        continue;
      }
      if (item.prog === 'gh' && item.sub === 'issue create') return { reason: 'GitHub issues in the product repo are for users; record internal work in beads.' };
      if (item.prog === 'gh' && item.sub === 'api' && ghApiWrite(item.args)) return { reason: 'Public writes through gh api cannot be checked; use the checked gh commands (pr, issue comment) with inline text.' };
      for (const m of itemMessages(item)) {
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
      const tags = item.args.some((a) => a === '--tags' || a === '--follow-tags') || names.some((n) => n.includes('refs/tags/') || run(['tag', '-l', n]).trim() === n);
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
  const hay = norm(log);
  const hits = [];
  for (const p of denylist) { const n = norm(p).trim(); if (n && hay.includes(n) && !hits.includes(p)) hits.push(p); }
  if (hay.includes('.delivery/') && !hits.includes('.delivery/')) hits.push('.delivery/');
  return hits;
}

module.exports = { loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, scanPushed, pushInfo, recordPrepush, clearPrepush };
