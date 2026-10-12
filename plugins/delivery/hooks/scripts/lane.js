// hooks/scripts/lane.js — the role lane policy: what a role may write and run.
// Pure except loadPolicy (reads the role file) and pathAllowed/decideLane (resolve real paths on disk).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRoleBrief } = require('../../scripts/lib/compose-brief.js');
const { listValue } = require('../../scripts/lib/plan-docs.js');

const SANCTIONED = {
  'chief-of-staff': 'route it: create a child bead for the right role (`bd create --parent <id> ...`) and message that session',
  staffing: 'only team.json and briefs are yours; anything else goes to the Delivery Lead',
  'product-manager': 'product documents are yours; building goes to a builder bead, plan structure to the Delivery Lead',
  'delivery-lead': 'stories, sprints and bead structure are yours; building goes to a builder bead',
  'progress-observer': 'record evidence in reviews and beads; fixes go to a builder bead',
  builder: 'product code in your worktree is yours; plans belong to the Delivery Lead',
  'spike-researcher': 'answers go in the bead and the ADR or roadmap; product code is never yours',
};
const REACH_PREFIXES = ['mcp__Claude_Browser__', 'mcp__claude-in-chrome__', 'mcp__computer-use__', 'mcp__Claude_Code_iOS_Simulator__'];
const MCP_WRITE = /^mcp__.*(write|edit|create|delete|move|copy)/i;
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
// Commands that change files or privilege: classified [] unless a group names them explicitly.
const GUARDED_FIRST = ['rm', 'mv', 'cp', 'sudo', 'chmod', 'chown', 'curl', 'wget'];
// git options that may precede the subcommand. Those in GIT_GLOBAL_ARG take a value.
const GIT_GLOBAL_ARG = ['-C', '-c'];
const GIT_GLOBAL_FLAG = ['--no-pager', '--no-color', '-P'];
const BD_GLOBAL_FLAG = ['--json'];
// A separator after which a failed or skipped `cd` no longer stops the commands that follow.
const RESUME_OPS = [';', '||', '&', '\n'];

function sanctioned(roleId) { return SANCTIONED[roleId] || 'stay in your lane; ask the Delivery Lead'; }

function loadPolicy({ pluginRoot, projectRoot, briefRef }) {
  const { meta } = loadRoleBrief(pluginRoot, projectRoot, briefRef);
  return { roleId: String(meta.id || ''), writes: listValue(meta.lane_writes), bash: listValue(meta.lane_bash) };
}

// Walk a command with shell quoting rules: backslash escapes outside single quotes,
// no escapes inside single quotes. visit(c, i, quote) may return a number of chars to skip.
function scan(s, visit) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else visit(c, i, q); continue; }
    if (c === '\\') { i++; continue; }
    if (q === '"') { if (c === '"') q = null; else { const k = visit(c, i, q); if (k) i += k; } continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    const k = visit(c, i, null);
    if (k) i += k;
  }
}

// Segments with the operator that precedes each one ('' for the first).
function splitWithOps(command) {
  const s = String(command == null ? '' : command);
  const cuts = []; // [start, end, op]
  scan(s, (c, i, q) => {
    if (q) return 0;
    const next = s[i + 1];
    const prev = s[i - 1];
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { cuts.push([i, i + 2, c + next]); return 1; }
    if (c === '&' && (prev === '>' || next === '>')) return 0; // 2>&1, &> file: a redirection, not a separator
    if (c === ';' || c === '|' || c === '&' || c === '\n') cuts.push([i, i + 1, c]);
    return 0;
  });
  const out = [];
  let start = 0;
  let op = '';
  const push = (text) => {
    const t = text.trim();
    if (t) out.push({ text: t, op });
    else if (op && out.length === 0) op = ''; // leading separators carry no meaning
  };
  for (const [a, b, o] of cuts) { push(s.slice(start, a)); start = b; op = o; }
  push(s.slice(start));
  return out;
}

function splitCommand(command) { return splitWithOps(command).map((x) => x.text); }

// Shell-like words: adjacent quoted and unquoted parts join into one word; quotes are removed.
function tokens(seg) {
  const s = String(seg == null ? '' : seg);
  const out = [];
  let cur = null;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null; continue; }
    if (cur === null) cur = '';
    if (c === '\\') { if (i + 1 < s.length) cur += s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// Merging, closing or discarding a stream writes no file: >&N, >&-, >/dev/null, >>/dev/null.
const STREAM_ONLY = /^(?:>&(?:\d+|-)|>>?[ \t]*\/dev\/null)(?=[\s;&|)]|$)/;

function hasRedirect(seg) {
  let found = false;
  scan(seg, (c, i, q) => {
    if (q || c !== '>') return 0;
    if (!STREAM_ONLY.test(seg.slice(i))) found = true; // `>>` is judged from its first `>`
    return seg[i + 1] === '>' ? 1 : 0;
  });
  return found;
}

// $(...), backticks and <(...) run another command inside this one.
function hasSubstitution(seg) {
  let found = false;
  scan(seg, (c, i, q) => {
    if (q === "'") return;
    if (c === '`' || (c === '$' && seg[i + 1] === '(') || (!q && c === '<' && seg[i + 1] === '(')) found = true;
  });
  return found;
}

// A leading VAR=value or `env` changes how the command runs (GIT_DIR, PATH, LD_PRELOAD...).
function hasEnvPrefix(t) { return t[0] === 'env' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0] || ''); }

// git/bd options that precede the subcommand; `rest` starts at the subcommand.
function splitGlobals(t) {
  const globals = [];
  let k = 1;
  if (t[0] === 'git') {
    while (k < t.length) {
      if (GIT_GLOBAL_ARG.includes(t[k])) { globals.push(t[k], t[k + 1]); k += 2; } else if (GIT_GLOBAL_FLAG.includes(t[k])) { globals.push(t[k]); k++; } else break;
    }
  } else if (t[0] === 'bd') {
    while (k < t.length && BD_GLOBAL_FLAG.includes(t[k])) { globals.push(t[k]); k++; }
  }
  return { globals, rest: t.slice(k) };
}

function writesFiles(t) {
  if (t[0] === 'sed') return t.slice(1).some((x) => /^-[a-zA-Z]*i/.test(x) || x.startsWith('--in-place'));
  if (t[0] === 'find') return t.slice(1).some((x) => ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(x));
  if (t[0] === 'sort') return t.slice(1).some((x) => /^-[a-zA-Z]*o/.test(x)); // -o, -uo, -ofile
  if (t[0] === 'git') return splitGlobals(t).globals.includes('-c'); // -c alias.x=!cmd runs arbitrary commands
  return false;
}

// Exact, --flag=value, or a short flag inside a cluster of short flags (-vd contains -d).
function hasFlag(t, f) {
  const short = /^-[A-Za-z]$/.test(f);
  return t.some((x) => x === f || x.startsWith(`${f}=`) || (short && /^-[A-Za-z]{2,}$/.test(x) && x.includes(f[1])));
}

const UNSAFE_DIR = /[$~`]/;

// The directories a segment may run in: one per possible cwd, null where unknown.
function effectiveDirs(t, dirs) {
  const { globals } = splitGlobals(t);
  return dirs.map((d0) => {
    let d = d0;
    if (t[0] !== 'git') return d;
    for (let k = 0; k < globals.length; k++) {
      if (globals[k] !== '-C') continue;
      const target = globals[++k];
      if (target === undefined || UNSAFE_DIR.test(target)) d = null;
      else if (path.isAbsolute(target)) d = path.resolve(target);
      else d = d === null ? null : path.resolve(d, target);
    }
    return d;
  });
}

function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

function pluginRootOf(ctx) { return (ctx && ctx.pluginRoot) || process.env.CLAUDE_PLUGIN_ROOT || ''; }

function ctxDirs(ctx) {
  if (Array.isArray(ctx.dirs)) return ctx.dirs;
  return [ctx.cwd === null ? null : path.resolve(ctx.cwd || process.cwd())];
}

function expandPluginRoot(arg, root) {
  for (const v of ['${CLAUDE_PLUGIN_ROOT}', '$CLAUDE_PLUGIN_ROOT']) {
    if (arg === v || arg.startsWith(`${v}/`)) return root + arg.slice(v.length);
  }
  return arg;
}

function ruleMatches(rule, t, ctx) {
  if (!rule || typeof rule !== 'object' || !t.length) return false;
  if (rule.first === '*') return true;
  if (t[0] !== rule.first) return false;
  const argv = splitGlobals(t).rest;
  let subLen = 0;
  if (rule.sub) {
    const hit = rule.sub.map((s) => String(s).split(' ')).find((parts) => parts.every((p, k) => argv[k] === p));
    if (!hit) return false;
    subLen = hit.length;
  }
  if (rule.arg_prefix) {
    const root = pluginRootOf(ctx);
    if (!root || !argv[0]) return false;
    const arg = expandPluginRoot(argv[0], root);
    if (UNSAFE_DIR.test(arg)) return false;
    const prefix = String(rule.arg_prefix).replace('${CLAUDE_PLUGIN_ROOT}', root);
    const dirs = ctxDirs(ctx);
    const dirPrefix = prefix.endsWith('/') || prefix.endsWith(path.sep);
    const ok = dirs.every((d) => {
      if (d === null && !path.isAbsolute(arg)) return false;
      const target = path.resolve(d || '/', arg);
      return dirPrefix ? under(target, path.resolve(prefix)) && target !== path.resolve(prefix) : target === path.resolve(prefix);
    });
    if (!ok) return false;
  }
  if (rule.flags_any && !rule.flags_any.some((f) => hasFlag(t, f))) return false;
  if (rule.flags_none && rule.flags_none.some((f) => hasFlag(t, f))) return false;
  if (rule.no_positional) {
    const valueFlags = rule.value_flags || [];
    const args = argv.slice(subLen);
    for (let k = 0; k < args.length; k++) {
      if (!args[k].startsWith('-')) return false;
      if (valueFlags.includes(args[k])) k++;
    }
  }
  if (rule.scope) {
    if (!ctx.roleDir) return false;
    const base = path.join(path.resolve(ctx.roleDir), String(rule.scope));
    if (!effectiveDirs(t, ctxDirs(ctx)).every((d) => d !== null && under(d, base))) return false;
  }
  return true;
}

// ctx: { roleDir, pluginRoot, cwd } or { roleDir, pluginRoot, dirs: [dir|null, ...] }.
function classifySegment(seg, groups, ctx) {
  try {
    const c = ctx || {};
    const text = String(seg == null ? '' : seg);
    const t = tokens(text);
    if (!t.length) return [];
    const g = groups && typeof groups === 'object' ? groups : {};
    const guarded = hasRedirect(text) || hasSubstitution(text) || writesFiles(t);
    if (hasEnvPrefix(t)) return !guarded && Array.isArray(g.any) ? ['any'] : [];
    const names = [];
    for (const [name, rules] of Object.entries(g)) {
      if (!Array.isArray(rules)) continue;
      // A guarded segment matches nothing, not even `*`; a guarded command only a rule that names it.
      let usable = rules;
      if (guarded) usable = [];
      else if (GUARDED_FIRST.includes(t[0])) usable = rules.filter((r) => r && r.first === t[0]);
      if (usable.some((r) => { try { return ruleMatches(r, t, c); } catch (e) { return false; } })) names.push(name);
    }
    return names;
  } catch (e) {
    return [];
  }
}

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; } else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

// Resolve a path component by component on disk: symlinks are followed and `..` is applied
// to the real directory, the way the OS does; past the first missing component it is lexical.
function realish(p) {
  const raw = String(p);
  const abs = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  const parts = abs.split(/[\\/]+/).filter(Boolean);
  let cur = path.parse(abs).root || '/';
  let exists = true;
  try { cur = fs.realpathSync(cur); } catch (e) { exists = false; }
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { cur = path.dirname(cur); continue; }
    const next = path.join(cur, part);
    if (exists) {
      try { cur = fs.realpathSync(next); continue; } catch (e) { exists = false; }
    }
    cur = next;
  }
  return cur;
}

function pathAllowed(filePath, { roleDir, writes, pluginRoot } = {}) {
  const abs = realish(filePath);
  // Inside the role directory the lane patterns decide, even when the role directory sits under tmp.
  if (roleDir) {
    const rd = realish(roleDir);
    if (under(abs, rd)) {
      const posix = path.relative(rd, abs).split(path.sep).join('/');
      return (writes || []).some((w) => globToRegExp(String(w)).test(posix));
    }
  }
  if (pluginRoot && under(abs, realish(pluginRoot))) return false;
  const tmp = [os.tmpdir(), process.env.TMPDIR].filter(Boolean).map(realish);
  return tmp.some((t) => under(abs, t));
}

function cdTarget(t) {
  // Returns { dir } for a resolvable target, or { unknown: true } (bare cd, cd -, flags, $ ~ `).
  if (t.length !== 2 || t[1].startsWith('-') || UNSAFE_DIR.test(t[1])) return { unknown: true };
  return { dir: t[1] };
}

function union(a, b) {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y === x)) out.push(x);
  return out;
}

function filePathsOf(name, input) {
  const i = input || {};
  const out = [];
  if (i.file_path) out.push(i.file_path);
  if (i.notebook_path) out.push(i.notebook_path);
  if (name === 'MultiEdit' && Array.isArray(i.edits)) for (const e of i.edits) if (e && e.file_path) out.push(e.file_path);
  return out;
}

function decideLane({ toolName, toolInput, roleDir, policy, groups, pluginRoot, cwd, hostHeadless, hostName, desktopHosts }) {
  const name = String(toolName || '');
  const pol = policy || { roleId: '', writes: [], bash: [] };
  const bash = pol.bash || [];
  const tail = ` Sanctioned path for ${pol.roleId}: ${sanctioned(pol.roleId)}.`;
  if (REACH_PREFIXES.some((p) => name.startsWith(p))) {
    if (hostHeadless) {
      const where = (desktopHosts || []).length ? `a session on ${desktopHosts.join(' or ')}` : 'a session on a host with a desktop';
      return { allow: false, reason: `Host ${hostName || 'this host'} is headless: browser, desktop-app and computer-use checks cannot run here. Hand the check to ${where} and record it as owner-side in the bead.` };
    }
    return { allow: true };
  }
  if (FILE_TOOLS.includes(name)) {
    const base = cwd || process.cwd();
    for (const fp of filePathsOf(name, toolInput)) {
      const p = path.isAbsolute(fp) ? fp : `${base}${path.sep}${fp}`; // not normalised: realish applies `..` physically
      if (pathAllowed(p, { roleDir, writes: pol.writes, pluginRoot: pluginRootOf({ pluginRoot }) })) continue;
      const real = realish(p);
      const rd = roleDir ? realish(roleDir) : null;
      const shown = rd && under(real, rd) ? path.relative(rd, real) : real;
      return { allow: false, reason: `Role ${pol.roleId} does not edit ${shown}.${tail}` };
    }
    return { allow: true };
  }
  if (MCP_WRITE.test(name) && !bash.includes('any')) {
    return { allow: false, reason: `Role ${pol.roleId} does not use write-capable tool ${name}.${tail}` };
  }
  if (name === 'Bash') {
    if (bash.includes('any')) return { allow: true };
    const segs = splitWithOps(toolInput && toolInput.command);
    let live = [cwd ? path.resolve(cwd) : path.resolve(process.cwd())];
    let deferred = [];
    for (let n = 0; n < segs.length; n++) {
      const { text, op } = segs[n];
      if (RESUME_OPS.includes(op)) { live = union(live, deferred); deferred = []; }
      const names = classifySegment(text, groups, { roleDir, pluginRoot, dirs: live });
      if (!names.some((x) => bash.includes(x))) {
        return { allow: false, reason: `Role ${pol.roleId} may not run \`${text.slice(0, 80)}\` (allowed groups: ${bash.join(', ') || 'none'}).${tail}` };
      }
      const t = tokens(text);
      if (t[0] !== 'cd') continue;
      // Track where later segments may run. A cd that can fail or be skipped leaves the old dir possible.
      const target = cdTarget(t);
      const moved = live.map((d) => {
        if (target.unknown) return null;
        if (path.isAbsolute(target.dir)) return path.resolve(target.dir);
        return d === null ? null : path.resolve(d, target.dir);
      });
      const nextOp = segs[n + 1] ? segs[n + 1].op : '';
      const reliable = nextOp === '&&' && !['||', '|'].includes(op);
      if (reliable) { deferred = union(deferred, live); live = union([], moved); } else live = union(live, moved);
    }
    return { allow: true };
  }
  return { allow: true };
}

module.exports = { loadPolicy, splitCommand, classifySegment, pathAllowed, decideLane, sanctioned, tokens };
