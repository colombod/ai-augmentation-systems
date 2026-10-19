// hooks/scripts/lane.js — the role lane policy: what a role may write and run.
// Pure except loadPolicy (reads the role file) and pathAllowed/decideLane (resolve real paths on disk).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRoleBrief } = require('../../scripts/lib/compose-brief.js');
const { listValue } = require('../../scripts/lib/plan-docs.js');

// The second line of a lane refusal (R-46: two lines, ending with the way out).
const SANCTIONED = {
  'chief-of-staff': 'Route it to the right role: `bd create --parent <id> --title "<the ask>"`, then message that session.',
  staffing: 'Only team.json and briefs are yours: message the Delivery Manager for anything else.',
  'product-manager': 'Product documents are yours; for building or plan structure, message the Delivery Manager.',
  'delivery-lead': 'Building goes to a builder bead: `bd create --parent <story> --title "<the change>"`.',
  'progress-observer': 'Record what you found in the bead (`bd update <id> --append-notes "<finding>"`); fixes go to a builder bead.',
  builder: 'Product code in your worktree is yours; for plans, message the Delivery Manager.',
  'spike-researcher': 'Answers go in the bead: `bd update <id> --append-notes "<answer>"`; product code is never yours.',
  'reality-checker': 'Captures go under `.delivery/evidence/artifacts/<bead>/` and rows through `reality-check.js run-record`; anything else, message the Delivery Manager.',
};
// Browser, desktop and computer-use tools reach the owner's apps and the customer surface (R-05, R-33):
// allowed only in a reach lane (the role file's `lane_reach: true`, or `"reach": true` on its manifest
// entry), and never on a headless host. prepare-role writes the native deny rules from the same list.
const REACH_SERVERS = ['Claude_Browser', 'claude-in-chrome', 'computer-use', 'Claude_Code_iOS_Simulator', 'playwright', 'chrome-devtools', 'puppeteer'];
const REACH_PREFIXES = REACH_SERVERS.map((s) => `mcp__${s}__`);
// a plugin-provided copy of one of these servers carries a plugin_<plugin>_ prefix
const REACH_RE = new RegExp(`^mcp__(?:plugin_[A-Za-z0-9-]+_)?(${REACH_SERVERS.map((s) => s.replace(/[-]/g, '\\-')).join('|')})__`);
// a builder's opted-in ("local") reach never touches the owner's own Chrome or desktop
const OWNER_SERVERS = ['claude-in-chrome', 'computer-use'];
// credentials, the clipboard and full control are never an agent's: sign-in is an owner-queue step
const REACH_NEVER = /(^|_)(request_credentials|read_clipboard|write_clipboard|request_full_control|request_teach_access|teach_batch|teach_step)$/;
const LOCAL_HOST = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h) || h.endsWith('.localhost') || h.endsWith('.test');
function nonLocalUrl(input) {
  for (const k of ['url', 'uri', 'href']) {
    const v = input && input[k];
    if (typeof v !== 'string' || !v) continue;
    let host = null;
    try { host = new URL(v).hostname.toLowerCase(); } catch (err) { return v; }
    if (!LOCAL_HOST(host)) return v;
  }
  return null;
}
const REACH_REASON = 'real-surface runs belong to the Reality Checker, with a script.\nAsk the Delivery Manager for a reality check (`reality-check.js plan <bead>`); a team that needs it for this role sets `"reach": true` on its team.json entry';
// MCP tools for allowlist roles: only read-shaped verbs, and never a name that also carries a write verb.
const MCP_READ = /^(read|get|list|search|query|view|status|find|describe|resolve|fetch|context|ask|show|display|tabs_context|read_page|get_page_text)(_|$)/i;
const MCP_WRITE_VERB = /(^|_)(update|upload|trash|send|set|create|delete|write|move|copy|rename|post|put|insert|append|replace|execute|run|remove|edit)(_|$)/i;
// Value-carrying short git options, per subcommand: letters after them are the value (-Sfoo, -mfix).
// Every other subcommand (rebase above all) reads a cluster as plain flag letters.
const GIT_VALUE_LETTERS = {
  commit: 'm', tag: 'm', merge: 'm', notes: 'm',
  log: 'SGO', diff: 'SGO', show: 'SGO', grep: 'SGO', shortlog: 'SGO', blame: 'SGO',
};
// Real options that happen to prefix a denied one (--text / --textconv): never read as abbreviations.
const EXACT_OK = ['--text', '--stat', '--patch', '--name-only', '--oneline'];
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
// Tools that run a shell command from tool_input.command. Any other non-MCP tool whose input
// carries a string `command` is treated as one too (deny by default for an unknown channel).
const SHELL_TOOLS = ['Bash', 'Monitor', 'PowerShell'];
// Commands that change files or privilege: classified [] unless a group names them explicitly.
const GUARDED_FIRST = ['rm', 'mv', 'cp', 'sudo', 'chmod', 'chown', 'curl', 'wget'];
// git options that may precede the subcommand. Those in GIT_GLOBAL_ARG take a value.
const GIT_GLOBAL_ARG = ['-C', '-c'];
const GIT_GLOBAL_FLAG = ['--no-pager', '--no-color', '-P'];
const BD_GLOBAL_FLAG = ['--json'];
// Every bd global option (bd 1.2.2 plus --no-color), for the bd guard: it must find the subcommand
// behind any of them. The lane keeps BD_GLOBAL_FLAG narrow so these do not widen a lane group.
const BD_ALL_GLOBAL_FLAG = ['--json', '-q', '--quiet', '--no-color', '-v', '--verbose', '--global', '--ignore-schema-skew', '--profile', '--readonly', '--sandbox'];
const BD_ALL_GLOBAL_ARG = ['--actor', '--db', '-C', '--directory', '--dolt-auto-commit'];
// A role file without lane_bash (a hired specialist) may read, never write.
const DEFAULT_BASH = ['read', 'bd-read', 'git-read', 'operator-read', 'judge'];
// The harness's own plan and memory files, relative to ~/.claude: writable for every role.
const HARNESS_WRITES = ['plans/**', 'projects/*/memory/**'];
// A separator after which a failed or skipped `cd` no longer stops the commands that follow.
const RESUME_OPS = [';', '||', '&', '\n'];

function sanctioned(roleId) { return SANCTIONED[roleId] || 'Stay in your lane: message the Delivery Manager.'; }

function loadPolicy({ pluginRoot, projectRoot, briefRef }) {
  const { meta } = loadRoleBrief(pluginRoot, projectRoot, briefRef);
  const bash = listValue(meta.lane_bash);
  return { roleId: String(meta.id || ''), writes: listValue(meta.lane_writes), bash: bash.length ? bash : DEFAULT_BASH.slice(), mcp: listValue(meta.lane_mcp), reach: meta.lane_reach === true || meta.lane_reach === 'true' };
}

// Harness permission rules that pre-allow a lane's own commands, so a worker session does not stop
// on a permission prompt only the operator can clear. Prefix rules only: the lane hook still runs
// before the permission check and refuses whatever the lane does not allow (flags_none, scope).
// Unrestricted (`any`) lanes get none: pre-allowing every command is not this hook's call.
function laneAllowRules(policy, groups, pluginRoot) {
  if (!policy || policy.bash.includes('any')) return [];
  const root = pluginRoot ? path.resolve(pluginRoot) : null;
  const out = new Set();
  for (const g of policy.bash) {
    for (const rule of (groups && groups[g]) || []) {
      // a rule whose flags matter (native_allow: false) gets no native allow: `Bash(cmd:*)` cannot exclude a flag
      if (!rule || !rule.first || rule.first === '*' || rule.native_allow === false) continue;
      let head = rule.first;
      if (rule.arg_prefix) {
        if (!root) continue;
        head = `${rule.first} ${String(rule.arg_prefix).replace('${CLAUDE_PLUGIN_ROOT}', root)}`;
      }
      for (const sub of rule.sub && rule.sub.length ? rule.sub : [null]) out.add(`Bash(${sub ? `${head} ${sub}` : head}:*)`);
    }
  }
  return [...out];
}

// lane_mcp patterns: whole tool names, `*` matches any run of characters, everything else is literal.
function mcpPatternMatches(pattern, name) {
  const re = String(pattern).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`).test(name);
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
    if ((c === '|' && prev === '>') || (c === '&' && prev === '<')) return 0; // >| and <&: redirections, not separators
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

// Shell expansion (globs, braces, variables, quoting forms, here-docs, process substitution,
// continuations) makes the words the shell runs differ from the words we see. Allowlist roles get none.
// The one exception is the documented `node ${CLAUDE_PLUGIN_ROOT}/scripts/...` form, judged against the plugin root.
const PLUGIN_ROOT_ARG = /^(node[ \t]+"?)(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)(?=\/)/;

// The raw segment with quoted text bash does not expand blanked. Single-quoted spans: everything.
// Double-quoted spans: everything except `$` and backtick (bash expands only those there, plus `\`
// escapes and the interactive-only `!`; globs, braces, `~`, `?`, `[ ]`, `!` are literal inside them).
// A ' inside double quotes is literal and opens nothing; $'...' keeps its $ outside the span.
function blankQuoted(raw) {
  let out = '';
  let q = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q === "'") { if (c === "'") { q = null; out += c; } else out += '_'; continue; }
    if (q === '"') {
      if (c === '"') { q = null; out += c; continue; }
      if (c === '\\') { out += '__'; i++; continue; } // \" \$ \` \\ are literal; the pair expands nothing
      if (c === '$' && raw[i + 1] === '(') { out += '$('; i++; continue; } // command substitution stays visible
      out += c === '$' || c === '`' ? c : '_';
      continue;
    }
    if (c === '\\') { out += c + (i + 1 < raw.length ? raw[i + 1] : ''); i++; continue; }
    if (c === '"' || c === "'") q = c;
    out += c;
  }
  return out;
}

// The expansion construct a segment uses, as a short phrase, or null when it uses none.
function expansionConstruct(raw) {
  const s = blankQuoted(String(raw == null ? '' : raw).replace(PLUGIN_ROOT_ARG, '$1ROOT'));
  if (/\$\(|`/.test(s)) return 'command substitution ($(...) or backticks)';
  if (/<\(|>\(/.test(s)) return 'process substitution';
  if (/<</.test(s)) return 'a here-document';
  if (/\\\n/.test(s)) return 'a line continuation';
  if (/\$/.test(s)) return 'variable expansion ($)';
  if (/[*?[\]]/.test(s)) return 'an unquoted glob (* ? [ ])';
  if (/[{}]/.test(s)) return 'unquoted brace expansion ({ })';
  if (/!/.test(s)) return 'an unquoted !';
  if (/(^|\s)~/.test(s)) return 'tilde expansion (~)';
  return null;
}

function hasExpansion(raw) {
  return expansionConstruct(raw) !== null;
}

// The command word must be a plain word: no quotes or escapes ('cat', c\at, "rm").
function quotedCommandWord(raw) {
  const first = raw.trimStart().split(/\s/)[0] || '';
  return /['"\\]/.test(first);
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

// bd global options before the subcommand, all of them; `rest` starts at the subcommand.
function splitBdGlobals(t) {
  const globals = [];
  let k = 1;
  while (k < t.length) {
    const x = t[k];
    const opt = x.split('=')[0];
    if (BD_ALL_GLOBAL_FLAG.includes(x)) { globals.push(x); k++; } else if (BD_ALL_GLOBAL_ARG.includes(x)) { globals.push(x, t[k + 1]); k += 2; } else if (x.includes('=') && BD_ALL_GLOBAL_ARG.includes(opt)) { globals.push(x); k++; } else break;
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

// Short flags named by a cluster (-vd -> v, d). For git, a value-carrying letter ends the
// cluster for the subcommands that take it: git log -Sfoo is S, git commit -amfix is a and m.
function clusterLetters(x, t) {
  if (!/^-[A-Za-z]{2,}$/.test(x)) return '';
  const values = t[0] === 'git' ? GIT_VALUE_LETTERS[splitGlobals(t).rest[0]] || '' : '';
  let out = '';
  for (const ch of x.slice(1)) { out += ch; if (values.includes(ch)) break; }
  return out;
}

// Exact, --flag=value, or a short flag in a cluster. When deny is set, a long option of 4+ chars
// also matches every denied flag it abbreviates (git accepts unique prefixes: --upload for --upload-pack).
function hasFlag(t, f, deny) {
  const short = /^-[A-Za-z]$/.test(f);
  // a denied long flag matches in any letter case (--Transcript): over-denial is safe, and a parser
  // that folds case must not slip past the list; short flags stay case-sensitive (-d is not -D)
  const fold = (x) => (deny && f.startsWith('--') && x.startsWith('--') ? x.toLowerCase() : x);
  return t.some((x0) => {
    const x = fold(x0);
    if (x === f || x.startsWith(`${f}=`)) return true;
    if (deny && f.startsWith('--') && x.startsWith('--')) {
      const opt = x.split('=')[0];
      if (opt.length >= 4 && !EXACT_OK.includes(opt) && f.startsWith(opt)) return true;
    }
    return short && clusterLetters(x, t).includes(f[1]);
  });
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
      else if (path.isAbsolute(target)) d = target;
      else d = d === null ? null : `${d}${path.sep}${target}`; // git chdirs physically: realish applies `..`
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
  // With arg_prefix the first argument is the script path, so the subcommand is the word after it.
  const subAt = rule.arg_prefix ? 1 : 0;
  if (rule.sub) {
    const hit = rule.sub.map((s) => String(s).split(' ')).find((parts) => parts.every((p, k) => argv[subAt + k] === p));
    if (!hit) return false;
    subLen = subAt + hit.length;
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
  if (rule.flags_none && rule.flags_none.some((f) => hasFlag(t, f, true))) return false;
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
    const base = path.join(realish(ctx.roleDir), String(rule.scope));
    if (!effectiveDirs(t, ctxDirs(ctx)).every((d) => d !== null && under(realish(d), base))) return false;
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
    if (hasEnvPrefix(t) || hasExpansion(text) || quotedCommandWord(text)) return !guarded && Array.isArray(g.any) ? ['any'] : [];
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

function pathAllowed(filePath, { roleDir, writes, pluginRoot, projectRoot } = {}) {
  const abs = realish(filePath);
  const allowed = (posix) => (writes || []).some((w) => globToRegExp(String(w)).test(posix));
  // Inside the role directory the lane patterns decide, even when the role directory sits under tmp.
  if (roleDir) {
    const rd = realish(roleDir);
    if (under(abs, rd)) return allowed(path.relative(rd, abs).split(path.sep).join('/'));
  }
  // The shared checkout is no role's to write: each role works in its own clone (<roleDir>/project), so a
  // path under the project root is refused, and the temporary-directory exemption never applies there,
  // wherever the checkout lives (PR 58 I3)
  if (projectRoot && path.isAbsolute(String(projectRoot))) {
    const pr = realish(String(projectRoot));
    if (under(abs, pr) || abs === pr) return false;
  }
  if (pluginRoot && under(abs, realish(pluginRoot))) return false;
  const tmp = [os.tmpdir(), process.env.TMPDIR].filter(Boolean).map(realish);
  // nor inside another role's directory (one holding a role marker)
  return tmp.some((t) => under(abs, t)) && !inRoleDir(abs);
}
function inRoleDir(abs) {
  for (let d = path.dirname(abs); d !== path.dirname(d); d = path.dirname(d)) {
    try { if (fs.existsSync(path.join(d, '.delivery-role.json'))) return true; } catch (err) { return true; }
  }
  return false;
}

// Under ~/.claude/plans/** or ~/.claude/projects/*/memory/**, by real path (symlinks and `..` resolved).
function harnessFile(p) {
  const home = os.homedir();
  if (!home) return false;
  const base = realish(path.join(home, '.claude'));
  const abs = realish(p);
  if (!under(abs, base) || abs === base) return false;
  const rel = path.relative(base, abs).split(path.sep).join('/');
  return HARNESS_WRITES.some((g) => globToRegExp(g).test(rel));
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

// The shell command a tool call runs, or null when the tool is not a shell channel.
function shellCommandOf(toolName, toolInput) {
  const name = String(toolName || '');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (SHELL_TOOLS.includes(name)) return String(input.command == null ? '' : input.command);
  if (FILE_TOOLS.includes(name) || name.startsWith('mcp__')) return null;
  return typeof input.command === 'string' ? input.command : null;
}

// The operator records: written only by scripts/operator.js (run through the operator-write group).
// They live in the project's private operator store, <git-common-dir>/delivery-operator (see
// scripts/lib/operator-store.js); the legacy <project>/.delivery/operator stays protected so a stray
// copy there never becomes a back door. Protected for every role, `any` included: the project's own
// checkout and the role's clone of it.
const OPERATOR_REL = path.join('.delivery', 'operator');
const STORE_REL = path.join('.git', 'delivery-operator');
const OPERATOR_REASON = 'operator records are written by `operator.js` only; read them with `operator.js show`';
// A mention of the operator records in a shell command, as a path: .delivery/operator (also
// .delivery//operator, .delivery/./operator) or the store, .git/delivery-operator. Case-folded: macOS and
// Windows file systems are case-insensitive. A bare "delivery-operator" in a commit message or a local
// branch name is not a mention; pushes of the delivery-operator branch and git commands aimed at the
// store (-C, --git-dir, --work-tree, GIT_DIR) are checked separately below.
const OPERATOR_MENTION = /\.delivery\/+(?:\.\/+)*operator(?=\/|[\s'";|&)>]|$)|\.git\/+(?:\.\/+)*delivery-operator(?=\/|[\s'";|&)>]|$)/i;
const STORE_SEGMENT = /(?:^|[\\/])delivery-operator(?:[\\/]|$)/i;
const BRANCH_REF = /(?:^|[:+/])delivery-operator$/i;
const OPERATOR_WRITE_WORDS = ['tee', 'cp', 'mv', 'rm', 'truncate', 'dd', 'ln', 'install', 'rsync'];
// git subcommands that only read: any other git command that names the operator records writes them
// (a commit, push, reset, checkout or update-ref in the store, or a push of its branch).
const GIT_READS = ['log', 'show', 'status', 'diff', 'ls-files', 'ls-tree', 'cat-file', 'rev-parse', 'rev-list', 'blame', 'grep',
  'shortlog', 'describe', 'merge-base', 'for-each-ref', 'show-ref', 'ls-remote', 'count-objects', 'whatchanged'];

function operatorDirs({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) {
    out.push(realish(path.join(String(projectRoot), OPERATOR_REL)), realish(path.join(String(projectRoot), STORE_REL)));
    // a project that is a linked worktree keeps its store in the main repository's .git
    try {
      const sd = require('../../scripts/lib/operator-store.js').storeDir(String(projectRoot));
      if (sd) out.push(realish(sd));
    } catch (err) { /* the fixed paths above still hold */ }
  }
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', OPERATOR_REL)), realish(path.join(String(roleDir), 'project', STORE_REL)));
  return out;
}

// Case-folded: on a case-insensitive file system .delivery/OPERATOR is the same directory.
function underOperator(p, dirs) {
  const real = realish(p).toLowerCase();
  return dirs.some((d) => under(real, d.toLowerCase()));
}

// Best effort, and tamper-evidence rather than a boundary (the hash chains, recorded heads and the
// store's append-only merge check are what detect a change): a shell command that names the operator
// records and also writes something.
// Where a segment writes: redirect targets, and the path arguments of the write words.
function writeTargets(seg, t) {
  const out = [];
  const re = />{1,2}\s*([^\s;&|()<>]+)/g;
  let m;
  while ((m = re.exec(seg))) if (!/^&\d?$/.test(m[1])) out.push(m[1].replace(/^['"]|['"]$/g, ''));
  if (OPERATOR_WRITE_WORDS.includes(path.basename(t[0] || ''))) out.push(...t.slice(1).filter((x) => !x.startsWith('-')));
  return out;
}

// opts: { cwd, dirs } — the operator directories; a write whose target resolves into one (through a
// symlink, for instance) counts even when the command never names it.
function operatorShellWrite(command, opts = {}) {
  const text = String(command == null ? '' : command);
  const segs = splitCommand(text);
  // entering the store (cd .git && cd delivery-operator, pushd .git/delivery-operator) is a mention
  const entered = segs.some((seg) => { const t = tokens(seg); return ['cd', 'pushd'].includes(t[0]) && t.slice(1).some((a) => STORE_SEGMENT.test(a)); });
  const mentioned = entered || OPERATOR_MENTION.test(text);
  return segs.some((seg) => {
    const t = tokens(seg);
    if (!t.length) return false;
    if (opts.dirs && opts.dirs.length) {
      const base = opts.cwd || process.cwd();
      if (writeTargets(seg, t).some((x) => underOperator(path.isAbsolute(x) ? x : `${base}${path.sep}${x}`, opts.dirs))) return true;
    }
    const envs = t.filter((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
    const words = hasEnvPrefix(t) ? t.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env') : t;
    const first = path.basename(words[0] || '');
    if (first === 'git') {
      const { globals, rest } = splitGlobals(['git', ...words.slice(1)]);
      const sub = rest[0];
      // the delivery-operator branch is pushed by operator.js only
      if (sub === 'push' && rest.slice(1).some((a) => BRANCH_REF.test(a) || /refs\/heads\/delivery-operator/i.test(a))) return true;
      // a git command run in or on the store
      const targets = [...globals.filter((g, i) => globals[i - 1] === '-C'), ...rest.filter((a) => /^--(?:git-dir|work-tree)=/.test(a)).map((a) => a.split('=')[1]),
        ...envs.filter((e) => /^GIT_(?:DIR|WORK_TREE)=/.test(e)).map((e) => e.split('=')[1])];
      if (targets.some((d) => STORE_SEGMENT.test(String(d))) && !GIT_READS.includes(sub)) return true;
    }
    if (!mentioned) return false;
    if (hasRedirect(seg)) return true;
    if (OPERATOR_WRITE_WORDS.includes(first)) return true;
    if (first === 'sed' && writesFiles(['sed', ...words.slice(1)])) return true;
    if (first === 'git' && !GIT_READS.includes(splitGlobals(['git', ...words.slice(1)]).rest[0])) return true;
    return false;
  });
}

// The goal sheet (R-42): its budget, pause, scope and approval fields change only through
// scripts/goal.js, which needs an owner record. Protected for every role, `any` included. Committing it
// is fine; a write, a move, a delete or a checkout over it is not. Tamper-evidence by history, as above.
const GOAL_REL = path.join('.delivery', 'goal.json');
const GOAL_REASON = 'the goal sheet changes only on the owner\'s word: `goal.js set <field> <value> --record <dec-id>`';
const GOAL_MENTION = /\.delivery\/+(?:\.\/+)*goal\.json\b/i;
const GOAL_GIT_WRITES = ['checkout', 'restore', 'reset', 'rm', 'mv', 'apply', 'stash', 'switch'];

function goalFiles({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) out.push(realish(path.join(String(projectRoot), GOAL_REL)).toLowerCase());
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', GOAL_REL)).toLowerCase());
  return out;
}
const isGoalFile = (p, files) => files.includes(realish(p).toLowerCase());

function goalShellWrite(command, { cwd, files = [] } = {}) {
  const text = String(command == null ? '' : command);
  const mentioned = GOAL_MENTION.test(text);
  // the directory each segment runs in: a `cd <dir>` moves the ones after it (Copilot 658)
  let base = cwd || process.cwd();
  return splitCommand(text).some((seg) => {
    const t = tokens(seg);
    if (!t.length) return false;
    if (t[0] === 'cd') { const c = cdTarget(t); if (!c.unknown) base = path.resolve(base, c.dir); return false; }
    const words = hasEnvPrefix(t) ? t.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env') : t;
    const first = path.basename(words[0] || '');
    const targets = writeTargets(seg, t);
    // in-place editors write every file argument: sed -i, perl -i
    if ((first === 'sed' && writesFiles(['sed', ...words.slice(1)])) || (first === 'perl' && words.some((x) => /^-[a-zA-Z]*i/.test(x)))) targets.push(...words.slice(1).filter((x) => !x.startsWith('-')));
    if (files.length && targets.some((x) => isGoalFile(path.isAbsolute(x) ? x : `${base}${path.sep}${x}`, files))) return true;
    if (!mentioned || !GOAL_MENTION.test(seg)) return false;
    if (hasRedirect(seg) || OPERATOR_WRITE_WORDS.includes(first)) return true;
    if (first === 'sed' && writesFiles(['sed', ...words.slice(1)])) return true;
    if (first === 'git') return GOAL_GIT_WRITES.includes(splitGlobals(['git', ...words.slice(1)]).rest[0]);
    return false;
  });
}

// The spend readings (R-34): .delivery/usage/ holds the transcript cache the budget trusts by size and
// mtime and the status line's weekly reading. A forged cache would hide spend, so only the plugin's own
// readers write it (lib/usage.js runs inside the hooks and scripts, not through a tool call).
// Protected for every role, `any` included; best effort, like the goal sheet.
const USAGE_REL = path.join('.delivery', 'usage');
const USAGE_REASON = 'the spend readings in .delivery/usage/ are written only by the plugin\'s usage reader; read them with `usage.js show`';
const USAGE_MENTION = /\.delivery\/+(?:\.\/+)*usage(?=\/|[\s'";|&)>]|$)/i;
function usageDirs({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) out.push(realish(path.join(String(projectRoot), USAGE_REL)));
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', USAGE_REL)));
  return out;
}
// Review findings (.delivery/reviews/): a security fix links to a finding by id, so only the roles that
// run reviews write them (re-review I-a): the Delivery Manager, Product Manager and Reality Checker.
const REVIEWS_REL = path.join('.delivery', 'reviews');
const REVIEW_WRITERS = ['delivery-lead', 'product-manager', 'reality-checker'];
const REVIEWS_REASON = 'review findings in .delivery/reviews/ are written by the Delivery Manager, Product Manager or Reality Checker; message the Delivery Manager with the finding';
const REVIEWS_MENTION = /\.delivery\/+(?:\.\/+)*reviews(?=\/|[\s'";|&)>]|$)/i;
function reviewDirs({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) out.push(realish(path.join(String(projectRoot), REVIEWS_REL)));
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', REVIEWS_REL)));
  return out;
}
// Pull request review records (.delivery/reviews/prs/, R-32): the merge gate reads them, so only
// review.js and merge-gate.js write them (node processes, not tool calls). Protected for every role,
// the Delivery Manager and the `any` lanes included; best effort, and the rows are chained.
const PR_REVIEWS_REL = path.join('.delivery', 'reviews', 'prs');
const PR_REVIEWS_REASON = 'review records in .delivery/reviews/prs/ are written only by `review.js`; read them with `review.js show <pr>`';
const PR_REVIEWS_MENTION = /\.delivery\/+(?:\.\/+)*reviews\/+(?:\.\/+)*prs(?=\/|[\s'";|&)>]|$)/i;
function prReviewDirs({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) out.push(realish(path.join(String(projectRoot), PR_REVIEWS_REL)));
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', PR_REVIEWS_REL)));
  return out;
}
// The andon ledger (.delivery/andon/, R-22): what stops the line and the A3 closes that lift it, written
// only by a3.js, andon.js and merge-gate.js (node processes). Protected for every role, `any` included.
const ANDON_REL = path.join('.delivery', 'andon');
const ANDON_REASON = 'the andon ledger in .delivery/andon/ is written only by `a3.js` and `andon.js`; read it with `andon.js show`';
const ANDON_MENTION = /\.delivery\/+(?:\.\/+)*andon(?=\/|[\s'";|&)>]|$)/i;
function andonDirs({ projectRoot, roleDir }) {
  const out = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) out.push(realish(path.join(String(projectRoot), ANDON_REL)));
  if (roleDir) out.push(realish(path.join(String(roleDir), 'project', ANDON_REL)));
  return out;
}
// The day's plans (.delivery/plans/, R-02): written only by plan.js today and the route check (node
// processes), so what was planned and sent stays the record. Protected for every role, `any` included.
const PLANS_REL = path.join('.delivery', 'plans');
const PLANS_REASON = 'the day\'s plans in .delivery/plans/ are written only by `plan.js today`; read them with `plan.js routed`';
const PLANS_MENTION = /\.delivery\/+(?:\.\/+)*plans(?=\/|[\s'";|&)>]|$)/i;
const planDirs = ({ projectRoot, roleDir }) => [
  ...(projectRoot && path.isAbsolute(String(projectRoot)) ? [realish(path.join(String(projectRoot), PLANS_REL))] : []),
  ...(roleDir ? [realish(path.join(String(roleDir), 'project', PLANS_REL))] : []),
];
// The assumption register (R-14): the gates read its rows, so only scripts/assumptions.js writes it (a
// node process, not a tool call). Protected for every role, `any` included, the Product Manager too;
// best effort, like the goal sheet. The gates also re-verify each row against its evidence.
const REGISTER_REASON = 'the assumption register changes only through `assumptions.js` (add, observe, refute, reopen, retire, relink)';
const REGISTER_MENTION = /\.delivery\/+(?:\.\/+)*initiatives\/+[^/\s'"]+\/+assumptions\.md\b/i;
const REGISTER_REL = /^\.delivery[\\/]initiatives[\\/][^\\/]+[\\/]assumptions\.md$/i;
function registerHit({ projectRoot, roleDir }) {
  const bases = [];
  if (projectRoot && path.isAbsolute(String(projectRoot))) bases.push(realish(String(projectRoot)));
  if (roleDir) bases.push(realish(path.join(String(roleDir), 'project')));
  return (p) => { const r = realish(p); return bases.some((b) => REGISTER_REL.test(path.relative(b, r))); };
}

// The watchdog's wake, run, install and uninstall are the host job's, installed by the owner (R-04,
// R-42): refused to every role, `any` included, in any form (a chain, a wrapper, `node -e`, its shim),
// and so is resuming or continuing another Claude session by hand. Only `node .../watchdog.js check`
// runs in a role session; the script refuses the rest inside a role directory as well.
const WATCHDOG_REASON = 'the watchdog\'s wake, run, install and uninstall are the host job\'s, which the owner installs from a shell outside any role directory; read the stalls with `watchdog.js check`';
const RESUME_REASON = 'resuming or continuing a Claude session is the watchdog host job\'s; message the session instead';
// Only what runs is judged: the command word of each segment (after VAR=x assignments and wrappers such
// as env, nohup, timeout), the script an interpreter runs or the code it evaluates, the command a shell
// runs with -c or eval, and what $(...) and backticks run. A note, a commit message or
// `git diff -- scripts/watchdog.js` names the file without running it. Quote-split (wat""chdog.js) and
// glob (watchd?g.js) words are matched as the shell would expand them; a command word built from a
// variable ($c) is refused when its arguments are a resume flag or a watchdog verb.
const WRAPPERS = new Set(['env', 'nohup', 'exec', 'command', 'builtin', 'time', 'nice', 'sudo', 'doas', 'xargs', 'timeout', 'stdbuf', 'caffeinate', 'setsid', 'ionice', 'chrt']);
const WRAPPER_VALUE_FLAGS = new Set(['-u', '-g', '-C', '-n', '-k', '-s', '-S', '--signal', '--kill-after', '--unset', '--chdir', '-P', '-I', '-L']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node']);
const CODE_FLAGS = new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '-i']);
const WATCHDOG_VERBS = new Set(['wake', 'run', 'install', 'uninstall']);
const CHECK_FLAGS = new Set(['--json']);
const RESUME_FLAGS = new Set(['-r', '--resume', '-c', '--continue', '--fork-session', '--teleport', '--from-pr']);
const CLAUDE_RESUME = /(?:^|[;&|(`\s'"])(?:\S*\/)?claude\s+(?:[^;&|\n]*\s)?(?:-r|--resume|-c|--continue|--fork-session|--teleport|--from-pr)(?=$|[\s=])|(?:^|[;&|(`\s'"])(?:\S*\/)?claude\s+(?:respawn|attach)\b/;
const WATCHDOG_TEXT = /watchdog/i;
const baseOf = (w) => String(w || '').split('/').pop();
// a word that names the watchdog script, its shim, or a glob the shell may expand to one of them
function namesWatchdog(word) {
  const w = String(word || '');
  if (/(?:^|\/)watchdog(?:\.js)?$/i.test(w) || /\.delivery\/+(?:\.\/+)*watchdog\//i.test(w)) return true;
  if (!GLOB.test(w)) return false;
  const b = segRe(baseOf(w));
  return b.test('watchdog.js') || b.test('watchdog') || (b.test('job.js') && /delivery|watch|[*?[]/i.test(w.slice(0, -baseOf(w).length)));
}
// the job shim always starts `watchdog.js run`, whatever its arguments (Copilot 749)
function isShim(word) {
  const w = String(word || '');
  if (/\.delivery\/+(?:\.\/+)*watchdog\/+job\.js$/i.test(w)) return true;
  return GLOB.test(w) && segRe(baseOf(w)).test('job.js') && /delivery|watch|[*?[]/i.test(w.slice(0, -baseOf(w).length));
}
// the CLI, whose `check` alone a role may run
const isCli = (w) => namesWatchdog(w) && !isShim(w) && !/\.delivery\/+(?:\.\/+)*watchdog\//i.test(String(w || ''));
// shell grammar words before a command: if/then/do/!, a brace or subshell, a function header, a case pattern
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}', '(', ')', 'fi', 'done', 'esac', 'time', 'coproc']);
function stripGrammar(t) {
  const out = [...t];
  for (;;) {
    if (!out.length) return out;
    if (KEYWORDS.has(out[0]) || /^[A-Za-z_][\w-]*\(\)$/.test(out[0])) { out.shift(); continue; }
    if (out[0] === 'case') { const k = out.findIndex((x) => /\)$/.test(x)); out.splice(0, k >= 0 ? k + 1 : out.length); continue; }
    if (/^[({]+./.test(out[0])) { out[0] = out[0].replace(/^[({]+/, ''); continue; }
    if (out[0] === 'for' || out[0] === 'select') return [];
    return out.map((x) => x.replace(/[)}]+$/, '')).filter((x) => x !== '');
  }
}
const namesClaude = (w) => baseOf(w) === 'claude' || (GLOB.test(String(w || '')) && segRe(baseOf(w)).test('claude'));
const nonLiteral = (w) => /[$`]/.test(String(w || ''));
// the words that run: assignments and wrappers (with their flags) skipped
function commandWords(t) {
  let i = 0;
  for (;;) {
    while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
    if (i < t.length && WRAPPERS.has(baseOf(t[i]))) {
      i++;
      while (i < t.length && (t[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || /^\d+(?:\.\d+)?[smhd]?$/.test(t[i]))) { i += WRAPPER_VALUE_FLAGS.has(t[i]) ? 2 : 1; }
      continue;
    }
    return t.slice(i);
  }
}
function checkOnly(args) {
  if (args[0] !== 'check') return false;
  for (let i = 1; i < args.length; i++) {
    if (CHECK_FLAGS.has(args[i])) continue;
    if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('-')) { i++; continue; }
    return false;
  }
  return true;
}
const claudeResumes = (args) => ['respawn', 'attach'].includes(args[0]) || args.some((a) => RESUME_FLAGS.has(a) || /^--(?:resume|continue|teleport|from-pr)=/.test(a) || (/^-[A-Za-z]{2,}$/.test(a) && /[cr]/.test(a.slice(1))));
// 'watchdog', 'resume' or null for one command line, depth-limited
function refusedRun(text, depth = 0) {
  if (depth > 4) return null;
  const subs = [];
  String(text).replace(/\$\(([^()]*)\)|`([^`]*)`|<\(([^()]*)\)/g, (m, a, b, c) => { subs.push(a || b || c || ''); return m; });
  for (const sub of subs) { const r = refusedRun(sub, depth + 1); if (r) return r; }
  for (const seg of splitWithOps(text)) {
    const all = tokens(seg.text);
    // a backstop over every unquoted word: a protected invocation in a form the walk below does not
    // parse (a compound command, a case arm) is still found (Copilot 716)
    for (let k = 0; k < all.length; k++) {
      if (namesClaude(all[k]) && claudeResumes(all.slice(k + 1))) return 'resume';
      if (isShim(all[k]) && (k === 0 || all.slice(0, k).some((x) => INTERPRETERS.has(baseOf(x)) || KEYWORDS.has(x)))) return 'watchdog';
      if (namesWatchdog(all[k]) && WATCHDOG_VERBS.has(all[k + 1])) return 'watchdog';
    }
    const t = commandWords(stripGrammar(all));
    if (!t.length) continue;
    const w = t[0];
    const args = t.slice(1);
    const name = baseOf(w);
    if (SHELLS.has(name) || name === 'eval') {
      const inner = name === 'eval' ? args.join(' ') : (() => { const k = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a)); return k >= 0 ? args[k + 1] || '' : ''; })();
      const r = inner ? refusedRun(inner, depth + 1) : null;
      if (r) return r;
      if (name !== 'eval' && args.some(namesWatchdog)) return 'watchdog';
      continue;
    }
    if ((name === 'source' || name === '.') && args.some(namesWatchdog)) return 'watchdog';
    if (INTERPRETERS.has(name)) {
      let script = null;
      for (let i = 0; i < args.length; i++) {
        if (CODE_FLAGS.has(args[i]) || /^--(?:eval|print|require|import)=/.test(args[i])) {
          const code = args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[++i] || '';
          if (WATCHDOG_TEXT.test(code)) return 'watchdog';
          if (CLAUDE_RESUME.test(code)) return 'resume';
          continue;
        }
        if (args[i].startsWith('-')) continue;
        script = i;
        break;
      }
      if (script !== null && namesWatchdog(args[script]) && !(isCli(args[script]) && checkOnly(args.slice(script + 1)))) return 'watchdog';
      continue;
    }
    if (namesWatchdog(w) && !(isCli(w) && checkOnly(args))) return 'watchdog';
    if (namesClaude(w) && claudeResumes(args)) return 'resume';
    if (nonLiteral(w) && (claudeResumes(args) || WATCHDOG_VERBS.has(args[0]))) return 'resume';
  }
  return null;
}
const watchdogAction = (command) => refusedRun(command) === 'watchdog';

// deep: a deletion or move of a protected folder's parent (rm -rf .delivery), or a glob that reaches the
// folder or names files in it (rm -rf .delivery/an*, rm .delivery/andon/*.ndjson), counts as a write too
const GLOB = /[*?[]/;
const REMOVERS = ['rm', 'mv', 'rmdir', 'unlink'];
// one glob segment as the shell reads it: *, ?, [abc] and [!abc]
function segRe(seg) {
  let out = '';
  for (let k = 0; k < seg.length; k++) {
    const c = seg[k];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '[') { const e = seg.indexOf(']', k + 2); if (e < 0) { out += '\\['; continue; } out += `[${seg.slice(k + 1, e).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; k = e; }
    else out += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}
function deepHit(x, dirs, remover) {
  const ds = dirs.map((d) => d.toLowerCase());
  const i = x.search(GLOB);
  if (i < 0) { const r = realish(x).toLowerCase(); return remover && ds.some((d) => under(d, r)); }
  const cut = x.lastIndexOf(path.sep, i);
  const base = realish(x.slice(0, cut) || path.sep).toLowerCase();
  const globs = x.slice(cut + 1).split(path.sep).filter(Boolean).map(segRe);
  return ds.some((d) => {
    if (under(base, d)) return true;
    if (!under(d, base)) return false;
    const segs = path.relative(base, d).split(path.sep).filter(Boolean);
    const n = Math.min(globs.length, segs.length);
    for (let k = 0; k < n; k++) if (!globs[k].test(segs[k])) return false;
    // the glob reaches into the folder, names it, or (for rm and mv) names one of its parents
    return globs.length > segs.length || globs.length === segs.length || remover;
  });
}

function usageShellWrite(command, { cwd, dirs = [], mention = USAGE_MENTION, hit = null, deep = false } = {}) {
  const text = String(command == null ? '' : command);
  let base = cwd || process.cwd();
  return splitCommand(text).some((seg) => {
    const t = tokens(seg);
    if (!t.length) return false;
    if (t[0] === 'cd') { const c = cdTarget(t); if (!c.unknown) base = path.resolve(base, c.dir); return false; }
    const words = hasEnvPrefix(t) ? t.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env') : t;
    const first = path.basename(words[0] || '');
    const targets = writeTargets(seg, t);
    if ((first === 'sed' && writesFiles(['sed', ...words.slice(1)])) || (first === 'perl' && words.some((x) => /^-[a-zA-Z]*i/.test(x)))) targets.push(...words.slice(1).filter((x) => !x.startsWith('-')));
    if (dirs.length && targets.some((x) => underOperator(path.isAbsolute(x) ? x : `${base}${path.sep}${x}`, dirs))) return true;
    if (deep && dirs.length && targets.some((x) => deepHit(path.isAbsolute(x) ? x : `${base}${path.sep}${x}`, dirs, REMOVERS.includes(first)))) return true;
    if (hit && targets.some((x) => hit(path.isAbsolute(x) ? x : `${base}${path.sep}${x}`))) return true;
    if (!mention.test(seg)) return false;
    return hasRedirect(seg) || OPERATOR_WRITE_WORDS.includes(first) || (first === 'git' && GOAL_GIT_WRITES.includes(splitGlobals(['git', ...words.slice(1)]).rest[0]));
  });
}

// Merging belongs to the Delivery Manager: it requests independent review of each pull request and
// merges on a passing review. Every other role, the unrestricted `any` lanes included, is refused a
// merge in whatever form: `gh pr merge`, the merge endpoint through `gh api`, a push to the default
// branch, `git merge` while on it, or an MCP merge tool.
const MERGER = 'delivery-lead';
const MERGE_REASON = 'merging is the Delivery Manager\'s.\nOpen the pull request and message the Delivery Manager; resolve conflicts when it asks';
const DEFAULT_BRANCHES = ['main', 'master'];

function gitIn(dir, args) {
  try {
    const r = require('child_process').spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout || '').trim() : null;
  } catch (err) { return null; }
}
// main, master, and what origin/HEAD names, for the repository at dir
function defaultBranches(dir) {
  const out = new Set(DEFAULT_BRANCHES);
  const h = gitIn(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (h && h.includes('/')) out.add(h.slice(h.indexOf('/') + 1));
  return out;
}

function mergeAttempt(command, cwd) {
  const text = String(command == null ? '' : command);
  return splitCommand(text).some((seg) => {
    const t = tokens(seg);
    const words = hasEnvPrefix(t) ? t.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env') : t;
    const first = path.basename(words[0] || '');
    if (first === 'gh') {
      const rest = [];
      for (let i = 1; i < words.length; i++) {
        if (words[i] === '-R' || words[i] === '--repo') { i++; continue; }
        if (/^--repo=/.test(words[i])) continue;
        rest.push(words[i]);
      }
      if (rest[0] === 'pr' && rest[1] === 'merge') return true;
      if (rest[0] === 'api' && rest.some((a) => /\/merges?(?:$|[/?])/.test(a))) return true;
      return false;
    }
    if (first !== 'git') return false;
    const { globals, rest } = splitGlobals(['git', ...words.slice(1)]);
    const ci = globals.indexOf('-C');
    const dir = ci >= 0 ? path.resolve(cwd || process.cwd(), globals[ci + 1] || '.') : (cwd || process.cwd());
    const sub = rest[0];
    if (sub !== 'push' && sub !== 'merge') return false;
    const branches = defaultBranches(dir);
    const current = gitIn(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (sub === 'merge') return !rest.includes('--abort') && !!current && branches.has(current);
    const args = rest.slice(1).filter((a) => !a.startsWith('-'));
    const refspecs = args.slice(1);
    if (!refspecs.length) return !!current && branches.has(current); // pushes the current branch
    return refspecs.some((r) => {
      const dst = r.includes(':') ? r.slice(r.lastIndexOf(':') + 1) : r;
      const name = dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
      return branches.has(name) || (dst === 'HEAD' && !!current && branches.has(current));
    });
  });
}

// A push onto another builder's team/<instance> branch (or anything under it): the merge gate knows a
// pull request's author by that branch, so only its own session pushes there (PR 56 re-check).
function foreignTeamPush(command, instance) {
  const me = String(instance || '').toLowerCase();
  for (const seg of splitCommand(String(command == null ? '' : command))) {
    const t = tokens(seg);
    const words = hasEnvPrefix(t) ? t.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env') : t;
    if (path.basename(words[0] || '') !== 'git') continue;
    const { rest } = splitGlobals(['git', ...words.slice(1)]);
    if (rest[0] !== 'push') continue;
    for (const r of rest.slice(1).filter((x) => !x.startsWith('-')).slice(1)) {
      const dst = (r.includes(':') ? r.slice(r.lastIndexOf(':') + 1) : r).replace(/^\+/, '').replace(/^refs\/heads\//, '');
      const m = /^team\/([^/]+)/i.exec(dst);
      if (m && m[1].toLowerCase() !== me) return { branch: `team/${m[1]}`, owner: m[1] };
    }
  }
  return null;
}

function decideLane({ toolName, toolInput, roleDir, policy, groups, pluginRoot, cwd, hostHeadless, hostName, desktopHosts, projectRoot }) {
  const name = String(toolName || '');
  const pol = policy || { roleId: '', writes: [], bash: [] };
  const bash = pol.bash || [];
  const tail = `\n${sanctioned(pol.roleId)}`;
  const reach = REACH_RE.exec(name);
  if (reach) {
    if (!pol.reach) return { allow: false, reason: `Role ${pol.roleId} does not drive browsers, desktop apps or computer use: ${REACH_REASON}.` };
    if (hostHeadless) {
      const where = (desktopHosts || []).length ? `a session on ${desktopHosts.join(' or ')}` : 'a session on a host with a desktop';
      return { allow: false, reason: `Host ${hostName || 'this host'} is headless: browser, desktop-app and computer-use checks cannot run here.\nMessage the Delivery Manager: the check needs ${where}.` };
    }
    if (REACH_NEVER.test(name.split('__').pop())) return { allow: false, reason: `Role ${pol.roleId} never handles credentials, the clipboard or full control: a sign-in, consent or payment step goes to the owner queue.\nMessage the Chief of Staff with the one exact step.` };
    if (pol.reach === 'local') {
      if (OWNER_SERVERS.includes(reach[1])) return { allow: false, reason: `Role ${pol.roleId}'s reach covers its own UI on local development hosts, not the owner's Chrome or desktop: ${REACH_REASON}.` };
      const url = nonLocalUrl(toolInput);
      if (url) return { allow: false, reason: `Role ${pol.roleId} opens only local development hosts (localhost, 127.0.0.1, *.localhost, *.test), not ${String(url).slice(0, 80)}: ${REACH_REASON}.` };
    }
    return { allow: true };
  }
  const opDirs = operatorDirs({ projectRoot, roleDir });
  if (FILE_TOOLS.includes(name)) {
    const base = cwd || process.cwd();
    for (const fp of filePathsOf(name, toolInput)) {
      const p = path.isAbsolute(fp) ? fp : `${base}${path.sep}${fp}`; // not normalised: realish applies `..` physically
      if (underOperator(p, opDirs)) return { allow: false, reason: `Role ${pol.roleId}: ${OPERATOR_REASON}.` };
      if (isGoalFile(p, goalFiles({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${GOAL_REASON}.` };
      if (underOperator(p, usageDirs({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${USAGE_REASON}.` };
      if (registerHit({ projectRoot, roleDir })(p)) return { allow: false, reason: `Role ${pol.roleId}: ${REGISTER_REASON}.` };
      if (underOperator(p, prReviewDirs({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${PR_REVIEWS_REASON}.` };
      if (underOperator(p, andonDirs({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${ANDON_REASON}.` };
      if (underOperator(p, planDirs({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${PLANS_REASON}.` };
      if (!REVIEW_WRITERS.includes(pol.roleId) && underOperator(p, reviewDirs({ projectRoot, roleDir }))) return { allow: false, reason: `Role ${pol.roleId}: ${REVIEWS_REASON}.` };
      if (harnessFile(p)) continue;
      if (pathAllowed(p, { roleDir, writes: pol.writes, pluginRoot: pluginRootOf({ pluginRoot }), projectRoot })) continue;
      const real = realish(p);
      const rd = roleDir ? realish(roleDir) : null;
      const shown = rd && under(real, rd) ? path.relative(rd, real) : real;
      return { allow: false, reason: `Role ${pol.roleId} does not edit ${shown}.${tail}` };
    }
    return { allow: true };
  }
  if (name.startsWith('mcp__') && pol.roleId !== MERGER && /merge_pull_request|merge_pr\b|pull_request_merge/i.test(name)) return { allow: false, reason: `Role ${pol.roleId}: ${MERGE_REASON}.` };
  if (name.startsWith('mcp__') && (pol.mcp || []).some((p) => mcpPatternMatches(p, name))) return { allow: true };
  if (name.startsWith('mcp__') && !bash.includes('any')) {
    const verb = name.split('__').pop();
    if (!MCP_READ.test(verb) || MCP_WRITE_VERB.test(verb)) {
      return { allow: false, reason: `Role ${pol.roleId} uses MCP tools only to read; ${name} is not a read.${tail}` };
    }
  }
  const command = shellCommandOf(name, toolInput);
  if (command !== null) {
    if (operatorShellWrite(command, { cwd, dirs: opDirs })) return { allow: false, reason: `Role ${pol.roleId}: ${OPERATOR_REASON}.` };
    if (goalShellWrite(command, { cwd, files: goalFiles({ projectRoot, roleDir }) })) return { allow: false, reason: `Role ${pol.roleId}: ${GOAL_REASON}.` };
    if (usageShellWrite(command, { cwd, dirs: usageDirs({ projectRoot, roleDir }) })) return { allow: false, reason: `Role ${pol.roleId}: ${USAGE_REASON}.` };
    if (usageShellWrite(command, { cwd, mention: REGISTER_MENTION, hit: registerHit({ projectRoot, roleDir }) })) return { allow: false, reason: `Role ${pol.roleId}: ${REGISTER_REASON}.` };
    if (usageShellWrite(command, { cwd, dirs: prReviewDirs({ projectRoot, roleDir }), mention: PR_REVIEWS_MENTION })) return { allow: false, reason: `Role ${pol.roleId}: ${PR_REVIEWS_REASON}.` };
    if (usageShellWrite(command, { cwd, dirs: andonDirs({ projectRoot, roleDir }), mention: ANDON_MENTION, deep: true })) return { allow: false, reason: `Role ${pol.roleId}: ${ANDON_REASON}.` };
    if (usageShellWrite(command, { cwd, dirs: planDirs({ projectRoot, roleDir }), mention: PLANS_MENTION, deep: true })) return { allow: false, reason: `Role ${pol.roleId}: ${PLANS_REASON}.` };
    if (!REVIEW_WRITERS.includes(pol.roleId) && usageShellWrite(command, { cwd, dirs: reviewDirs({ projectRoot, roleDir }), mention: REVIEWS_MENTION })) return { allow: false, reason: `Role ${pol.roleId}: ${REVIEWS_REASON}.` };
    if (pol.roleId !== MERGER && mergeAttempt(command, cwd)) return { allow: false, reason: `Role ${pol.roleId}: ${MERGE_REASON}.` };
    const run = refusedRun(command);
    if (run) return { allow: false, reason: `Role ${pol.roleId}: ${run === 'watchdog' ? WATCHDOG_REASON : RESUME_REASON}.` };
    if (bash.includes('any')) return { allow: true };
    if (name === 'PowerShell') {
      return { allow: false, reason: `Role ${pol.roleId} may not run PowerShell commands: the lane cannot check them (allowed groups: ${bash.join(', ') || 'none'}).${tail}` };
    }
    const segs = splitWithOps(command);
    let live = [cwd ? path.resolve(cwd) : path.resolve(process.cwd())];
    let deferred = [];
    for (let n = 0; n < segs.length; n++) {
      const { text, op } = segs[n];
      if (RESUME_OPS.includes(op)) { live = union(live, deferred); deferred = []; }
      const names = classifySegment(text, groups, { roleDir, pluginRoot, dirs: live });
      if (!names.some((x) => bash.includes(x))) {
        const construct = expansionConstruct(text);
        // a refused construct is the whole story; otherwise the allowed groups say what the lane runs
        const why = construct ? `. Refused construct: ${construct}; put literal text in single quotes.` : ` (allowed groups: ${bash.join(', ') || 'none'}).`;
        return { allow: false, reason: `Role ${pol.roleId} may not run \`${text.slice(0, 80)}\`${why}${tail}` };
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

function laneDecisionForHook(input, pluginRoot) {
  const { findRoleMarker, validMarker } = require('./role-context.js');
  const found = findRoleMarker(input.cwd);
  if (!found) return null;
  const ctx = validMarker(found);
  if (!ctx) return null;
  const { marker, hosts, role, roleDir } = ctx;
  const policy = loadPolicy({ pluginRoot, projectRoot: marker.project_root, briefRef: role.brief });
  // the manifest's opt-in: local reach only, and never for a manager even when team.json was edited by hand
  const granted = require('../../scripts/lib/manifest.js').reachOf(role);
  if (granted && !policy.reach) policy.reach = granted;
  const hostMap = (hosts && hosts.hosts) || {};
  const host = hostMap[role.host] || {};
  const desktopHosts = Object.entries(hostMap).filter(([, h]) => h && h.desktop_apps).map(([n]) => n);
  const groups = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'lane-groups.json'), 'utf8'));
  let d = decideLane({ toolName: input.tool_name, toolInput: input.tool_input || {}, roleDir, policy, groups, pluginRoot, cwd: input.cwd, hostHeadless: !!host.headless, hostName: role.host, desktopHosts, projectRoot: marker.project_root });
  // the Delivery Manager's merge passes only through the merge gate (R-32): a passing independent
  // review of the current head, CI green, no conflict, in the product repository; its GitHub approvals
  // are refused (approvals are review rows); an error here fails closed in role-lane.js
  if (d.allow && policy.roleId === MERGER) {
    const cmd = shellCommandOf(input.tool_name, input.tool_input || {});
    if (cmd !== null && /\bgh\b/.test(cmd)) {
      const why = require('../../scripts/merge-gate.js').mergeCommandProblem(cmd, { root: marker.project_root, team: ctx.team, roleDir });
      if (why) d = { allow: false, reason: `Role ${policy.roleId}: ${why}` };
    }
  }
  const pushCmd = d.allow ? shellCommandOf(input.tool_name, input.tool_input || {}) : null;
  const foreign = pushCmd !== null ? foreignTeamPush(pushCmd, marker.instance) : null;
  if (foreign) d = { allow: false, reason: `Role ${policy.roleId}: ${foreign.branch} is ${foreign.owner}'s branch: the merge gate knows a pull request's author by it, so only ${foreign.owner} pushes there.\nPush your own: \`git push origin HEAD:team/${marker.instance}\`` };
  if (d.allow) return null;
  try {
    const ti = input.tool_input || {};
    const cmd = shellCommandOf(input.tool_name, ti);
    const what = cmd !== null ? cmd : String(ti.file_path || ti.notebook_path || '');
    const tool = String(input.tool_name).replace(/[\x00-\x1f\x7f]/g, ' ');
    fs.appendFileSync(path.join(roleDir, '.delivery-lane.log'), `${new Date().toISOString()} ${tool} ${what.slice(0, 120).replace(/[\x00-\x1f\x7f]/g, ' ')} DENIED\n`);
  } catch (err) { /* logging must not block */ }
  return { reason: d.reason };
}

module.exports = { refusedRun, watchdogAction, foreignTeamPush, REACH_PREFIXES, OWNER_SERVERS, goalShellWrite, usageShellWrite, mergeAttempt, laneAllowRules, expansionConstruct, operatorShellWrite, laneDecisionForHook, shellCommandOf, splitBdGlobals, loadPolicy, splitCommand, splitWithOps, classifySegment, pathAllowed, decideLane, sanctioned, tokens, realish };
