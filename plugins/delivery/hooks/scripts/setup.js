// hooks/scripts/setup.js — machine setup the operator has ruled on is not a session's call.
//
// Why this exists: a Claude Code session that was not a team role session set TMPDIR in every role's
// .claude/settings.local.json, against a recorded operator decision that temp files stay in the sealed
// runner's private /tmp and are never relocated. The lane and leak guards could not stop it: they are
// inert without a role marker. This guard is the opposite: setup-guard.js runs it in EVERY session on
// the host, team role or not (as a plugin hook, and as a user-level hook the team installs, so it
// holds where the plugin is not enabled and after the plugin is removed: lib/user-guard.js).
//
// What it refuses before a tool runs (decideSetup):
//   1. Any change of where temp files go (TMPDIR, CLAUDE_CODE_TMPDIR, TMP, TEMP, TEMPDIR) in a Claude
//      settings file, a shell or session environment file, through a command or script that writes
//      one, or through a command that persists it (systemctl --user set-environment, launchctl
//      setenv, setx, claude --settings, ...). A hard rule: refused even when no operator record can be
//      read, because the sealed test runner depends on it.
//   2. Switching this guard off: disabling or uninstalling the delivery plugin, setting its
//      enabledPlugins entry to false, or removing the user-level setup guard hook.
//   3. Rebooting the host when a record says never to rely on a restart.
//   4. Changing an environment variable (or a settings key named next to "settings", "env",
//      "config") that a recorded operator decision forbids changing, in the same sentence as a
//      prohibition (never, not, no, must not). A record that asks for the change ("Fix the bd PATH")
//      does not block it.
// Removing a temp-location setting is allowed: that is how a wrong one is reverted.
// What a command does is not always visible in its text (a cp of a staged file, a script that builds
// the name): setup-net.js snapshots the guarded files before a tool runs and reverts such a change
// after it, with the same reason.
//
// The refusal never tells the session to ask the operator: a ruled-on change goes to the Chief of
// Staff with the record id, and the operator is never asked to approve or undo it.
//
// decideSetup is pure: files and records come in through readFile, exists and records (an array, or a
// function returning one, called only when a candidate machine-setup change is found, so ordinary
// tool calls never read the operator store).
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const TEMP_VARS = ['TMPDIR', 'CLAUDE_CODE_TMPDIR', 'TMP', 'TEMP', 'TEMPDIR'];
const isTempVar = (k) => TEMP_VARS.includes(String(k).toUpperCase());
// a temp variable name as a whole word, case-sensitive: "/tmp" and "temporary" are not one
const TEMP_WORD_SRC = `(?<![A-Za-z0-9_])(?:${TEMP_VARS.join('|')})(?![A-Za-z0-9_])`;
const TEMP_WORD = new RegExp(TEMP_WORD_SRC);
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const PLUGIN_KEY = /^delivery@/;
// settings keys that switch off every hook from settings files and plugins, this guard's two copies
// included (Claude Code's settings schema: disableAllHooks; allowManagedHooksOnly drops user, project,
// local and user-installed plugin hooks). Set to true anywhere, they are refused and reverted.
const HOOKS_OFF_KEYS = ['disableAllHooks', 'allowManagedHooksOnly'];
// the user-level hook command lib/user-guard.js installs; a settings change that drops it is refused
const GUARD_HOOK_MARK = path.join('delivery', 'bin', 'setup-guard.js');
const MAX_QUOTE = 160;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- which files are machine setup ----------

const RC_FILES = ['.bashrc', '.bash_profile', '.bash_login', '.bash_aliases', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.kshrc', '.pam_environment'];
const ETC_FILES = ['/etc/environment', '/etc/profile', '/etc/bash.bashrc', '/etc/zshenv', '/etc/zsh/zshenv', '/etc/zsh/zshrc', '/etc/zprofile'];
// directories that hold test fixtures: a settings file there configures no real session
const FIXTURE_DIRS = ['test', 'tests', 'fixtures', '__fixtures__', 'testdata'];

function expandHome(p, home) {
  const s = String(p);
  if (s === '~' || s.startsWith('~/')) return path.join(home, s.slice(1));
  return s.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
}
const under = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const configDirOf = (home, env = {}) => (env.CLAUDE_CONFIG_DIR ? path.resolve(expandHome(env.CLAUDE_CONFIG_DIR, home)) : path.join(home, '.claude'));

// { kind: 'settings' | 'env', file, userScope } or null. 'settings' is a Claude settings file; 'env' a
// shell or session environment file. userScope: a settings file that applies to every project (the
// user's, CLAUDE_CONFIG_DIR's, managed settings).
// A project settings file or .envrc under a test or fixture directory, or in the host's temp directory
// (the sealed runner's private /tmp), is a fixture and not guarded, unless it is a role directory's
// (a .delivery-role.json beside its .claude).
function classifyFile(file, { cwd, home, env = {}, exists, tmpdir } = {}) {
  if (!file || typeof file !== 'string') return null;
  // Claude Code's per-session environment file: what is appended there reaches every later command
  if (/^\$\{?CLAUDE_ENV_FILE\}?$/.test(file) || (env.CLAUDE_ENV_FILE && path.resolve(file) === path.resolve(env.CLAUDE_ENV_FILE))) return { kind: 'env', file };
  const abs = path.resolve(cwd || '/', expandHome(file, home));
  const base = path.basename(abs);
  const dir = path.dirname(abs);
  const fixture = () => {
    const roleDir = path.basename(dir) === '.claude' ? path.dirname(dir) : dir;
    let isRole = false;
    try { isRole = !!(exists || require('fs').existsSync)(path.join(roleDir, '.delivery-role.json')); } catch (e) { isRole = false; }
    if (isRole) return false;
    const t = tmpdir === undefined ? os.tmpdir() : tmpdir;
    return (t && under(abs, path.resolve(t))) || abs.split(path.sep).some((s) => FIXTURE_DIRS.includes(s));
  };
  if (base === 'managed-settings.json') return { kind: 'settings', file: abs, userScope: true };
  if (base === 'settings.json' || base === 'settings.local.json') {
    const userDirs = [path.join(home, '.claude'), configDirOf(home, env)];
    if (userDirs.includes(dir)) return { kind: 'settings', file: abs, userScope: true };
    if (abs.split(path.sep).includes('.claude') && !fixture()) return { kind: 'settings', file: abs, userScope: false };
    return null;
  }
  if (base === '.envrc') return fixture() ? null : { kind: 'env', file: abs };
  if (dir === home && RC_FILES.includes(base)) return { kind: 'env', file: abs };
  if (dir === path.join(home, '.bashrc.d') || dir === path.join(home, '.zshrc.d')) return { kind: 'env', file: abs };
  if (ETC_FILES.includes(abs) || dir === '/etc/profile.d') return { kind: 'env', file: abs };
  if (dir === path.join(home, '.config', 'environment.d') && base.endsWith('.conf')) return { kind: 'env', file: abs };
  if (under(abs, path.join(home, '.config', 'fish')) && abs !== path.join(home, '.config', 'fish')) return { kind: 'env', file: abs };
  if (abs.startsWith(path.join(home, '.config', 'systemd', 'user') + path.sep)) return { kind: 'env', file: abs };
  return null;
}

// ---------- the file as the tool would leave it ----------

function applyEdit(text, oldS, newS, all) {
  const o = String(oldS == null ? '' : oldS);
  const n = String(newS == null ? '' : newS);
  // Edit fails when old_string is not there; we cannot know it will, so judge the new text as if it
  // were added: a false refusal costs one retry, a false allow lets the change through.
  if (!o || !text.includes(o)) return `${text}\n${n}`;
  return all ? text.split(o).join(n) : text.replace(o, () => n);
}

function afterText(toolName, input, before) {
  if (toolName === 'Write') return String(input.content == null ? '' : input.content);
  if (toolName === 'Edit') return applyEdit(before, input.old_string, input.new_string, input.replace_all);
  if (toolName === 'MultiEdit') {
    let t = before;
    for (const e of Array.isArray(input.edits) ? input.edits : []) t = applyEdit(t, e && e.old_string, e && e.new_string, e && e.replace_all);
    return t;
  }
  if (toolName === 'NotebookEdit') return `${before}\n${String(input.new_source == null ? '' : input.new_source)}`;
  return before;
}

// ---------- what changed ----------

const parseObject = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } };
const envOf = (s) => (s && s.env && typeof s.env === 'object' ? s.env : {});
const tempMentions = (t) => (String(t).match(new RegExp(TEMP_WORD_SRC, 'g')) || []).join(',');
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,}$/;
const hasGuardHook = (s) => !!(s && s.hooks) && JSON.stringify(s.hooks).includes(GUARD_HOOK_MARK.split(path.sep).join('/'));

// A Claude settings change: temp keys added or changed, every other changed key (for the record
// search), and anything that switches this guard off.
function settingsChange(beforeText, after, cls) {
  const b = parseObject(beforeText) || {};
  const a = parseObject(after);
  if (!a) {
    // Unparsable: what changed cannot be told. A temp name the before-text did not hold the same way
    // counts as a temp change; Claude Code would not load the file anyway, so little is lost.
    const m = after.match(TEMP_WORD);
    return { temp: m && tempMentions(after) !== tempMentions(beforeText) ? [m[0]] : [], keys: [], plugin: false };
  }
  const be = envOf(b);
  const ae = envOf(a);
  const temp = [];
  const keys = [];
  for (const k of new Set([...Object.keys(be), ...Object.keys(ae)])) {
    if (isDeepStrictEqual(be[k], ae[k])) continue;
    if (isTempVar(k)) { if (has(ae, k)) temp.push(k); continue; } // a removal is allowed
    if (ENV_NAME.test(k)) keys.push({ name: k, exact: true });
  }
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'env' || isDeepStrictEqual(b[k], a[k])) continue;
    keys.push({ name: k, setting: true });
  }
  return { temp, keys, plugin: pluginOff(b, a, cls) };
}

// Switching the guard off. false in any settings file disables the plugin for that scope; removing a
// true from a user-scope file leaves it off everywhere (removing it from a project file falls back to
// the user's setting, so that is allowed). Dropping the user-level guard hook switches off the copy
// that holds where the plugin is not enabled.
function pluginOff(b, a, cls) {
  const bp = b.enabledPlugins && typeof b.enabledPlugins === 'object' ? b.enabledPlugins : {};
  const ap = a.enabledPlugins && typeof a.enabledPlugins === 'object' ? a.enabledPlugins : {};
  let off = false;
  for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
    if (!PLUGIN_KEY.test(k)) continue;
    if (ap[k] === false && bp[k] !== false) off = k;
    if (bp[k] === true && !has(ap, k) && cls.userScope) off = k;
  }
  for (const k of HOOKS_OFF_KEYS) if (!off && a[k] === true && b[k] !== true) off = k;
  if (!off && hasGuardHook(b) && !hasGuardHook(a)) off = 'the user-level setup guard hook';
  return off;
}

// Variable assignments in a shell or environment file: NAME=..., export NAME=..., setenv NAME ...,
// set -gx NAME ... (fish), Environment=NAME=... (systemd). A map of name to its assignment lines.
function assignments(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // systemd's Environment= first: otherwise "Environment" itself would be read as the name
    const re = /^Environment=["']?([A-Za-z_][A-Za-z0-9_]*)=|(?:^|[\s;&|"'])(?:export\s+|declare\s+-x\s+|typeset\s+-x\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=|(?:^|[\s;])setenv\s+([A-Za-z_][A-Za-z0-9_]*)|(?:^|[\s;])set\s+-[a-zA-Z]*x[a-zA-Z]*\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(line))) {
      const name = m[1] || m[2] || m[3] || m[4];
      if (!out.has(name)) out.set(name, new Set());
      out.get(name).add(line);
    }
  }
  return out;
}

function envFileChange(beforeText, after) {
  const b = assignments(beforeText);
  const a = assignments(after);
  const temp = [];
  const keys = [];
  for (const [name, lines] of a) {
    const prev = b.get(name);
    if (prev && [...lines].every((l) => prev.has(l))) continue;
    if (isTempVar(name)) temp.push(name); else if (ENV_NAME.test(name)) keys.push({ name, exact: true });
  }
  for (const name of b.keys()) if (!a.has(name) && !isTempVar(name) && ENV_NAME.test(name)) keys.push({ name, exact: true });
  return { temp, keys, plugin: false };
}

// ---------- shell commands ----------

// The words of a command with quotes dropped, so a guarded file is found however it is quoted.
function wordsOf(command) {
  return String(command).split(/[\s;&|()<>`]+/).map((w) => w.replace(/^['"]+|['"]+$/g, '')).filter(Boolean);
}

// Heredoc bodies taken out of the command: what they hold is a script or a file's text, never shell
// words at command position (an `export TMPDIR=` line in a heredoc is written somewhere).
function splitHeredocs(cmd) {
  const lines = String(cmd).split('\n');
  const shell = [];
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    shell.push(lines[i]);
    const tags = [...lines[i].matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)].map((m) => m[2]);
    for (const tag of tags) {
      const body = [];
      while (++i < lines.length && lines[i].trim() !== tag) body.push(lines[i]);
      bodies.push(body.join('\n'));
    }
  }
  return { shell: shell.join('\n'), bodies };
}

// A one-off `NAME=value cmd` prefix or a bare `export NAME=value` at command position sets nothing that
// outlives the command; taken out before the text is judged.
function stripOneOff(shell) {
  return String(shell).replace(/(^|[;&|(\n]\s*)(?:export\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s;&|]*)\s*)+/g, '$1');
}

// Quote-joined fragments put back together: 'TMP' + 'DIR', "TMP" "DIR", ['TM', 'PDIR'].join(''),
// TMP""DIR, so a name assembled from parts is seen as the name.
const joinFragments = (t) => String(t).replace(/(['"`])\s*(?:\+|\.|,)?\s*(['"`])/g, '');

// The temp variable a text sets: NAME=, "NAME": , env.NAME, ["NAME"] =, setenv/setx NAME, or none.
// Removals (unset, jq del(...), a sed /.../d delete) are stripped first: they revert.
function setsTemp(text) {
  const t = String(text)
    .replace(/\bdel\s*\([^)]*\)/g, ' ')
    .replace(/\bunset\s+(?:-v\s+)?[A-Za-z_ ]+/g, ' ')
    .replace(/\/[^/\n]*\/d\b/g, ' ')
    .replace(/\bRemove-Item\s+[^;|]*/gi, ' ');
  const v = `(?:${TEMP_VARS.join('|')})`;
  const res = [
    new RegExp(`(?<![A-Za-z0-9_$])${v}\\s*=`),
    new RegExp(`["']${v}["']\\s*(?::|=|,)`),
    new RegExp(`\\benv\\.${v}\\b`),
    new RegExp(`["']${v}["']\\s*\\]\\s*=(?!=)`),
    new RegExp(`\\b(?:setenv|putenv|setx|set-environment|import-environment)\\s+(?:/m\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*["']?${v}\\b`, 'i'),
  ];
  for (const re of res) { const m = t.match(re); if (m) return m[0].match(new RegExp(v, 'i'))[0]; }
  return null;
}

// A temp variable a script names at all, written whole or assembled from quoted parts.
function namesTemp(text) {
  const m = String(text).match(TEMP_WORD) || joinFragments(text).match(TEMP_WORD);
  return m ? m[0] : null;
}

// An interpreter given its script inline or on stdin: the script text is then judged as a whole.
const INTERPRETER = /(?:^|[\s;&|(/])(?:python[0-9.]*|node|nodejs|perl|ruby|deno|bun|php|bash|sh|zsh|dash|ksh|fish|pwsh|powershell|osascript|jq)(?=\s|$)/;
const INLINE_FLAG = /(?:^|[\s;&|(/])(?:python[0-9.]*|node|nodejs|perl|ruby|php|bash|sh|zsh|dash|ksh|fish)\s+(?:-\S+\s+)*-[a-zA-Z]*[ce]\b|\bdeno\s+eval\b|\b(?:pwsh|powershell)\b[^;&|]*-(?:c|Command)\b/i;
// A script call that writes: open(..., 'w'/'a'), write*/append*, json.dump, a rename or copy. A bare
// '>' is not counted: in a script it is a comparison or an arrow far more often than a redirect.
// A read (require, json.load, readFileSync) is no write: such a script is never refused.
const WRITE_CALL = /\bopen\s*\([^)]*['"][wax]\+?b?['"]|\.write(?:_text|_bytes|lines)?\s*\(|\bwrite(?:FileSync|File|Sync)?\s*\(|\bappend(?:FileSync|File)?\s*\(|\bjson\.dump\s*\(|\b(?:rename|copy|copyfile|copy2|move|replace|copyFile|cp|rm|unlink|remove|truncate)(?:Sync)?\s*\(|\bshutil\.|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bsponge\b|\bprint\s*\([^)]*\bfile\s*=|\bsed\b[^|;&]*\s-[a-zA-Z]*i|\btee\b/;
// guarded file names as text can name them (a script joins its paths at run time)
const GUARDED_NAME = /(?:managed-)?settings(?:\.local)?\.json|\.claude\b|\.bashrc|\.bash_profile|\.bash_aliases|\.bash_login|\.profile\b|\.zshrc|\.zshenv|\.zprofile|\.zlogin|\.kshrc|\.pam_environment|\.envrc|environment\.d|\.config\/fish|systemd\/user|\/etc\/environment|\/etc\/profile|CLAUDE_ENV_FILE|CLAUDE_CONFIG_DIR/;

// Does a script's text name a guarded file? A full plain path is judged by classifyFile (so a fixture
// under test/ is not); a bare name, a glob or a variable cannot be resolved and counts as guarded.
function namesGuarded(text, ctx) {
  const tokens = String(text).match(/[^\s'"`,()[\]{};=<>|&]*(?:(?:managed-)?settings(?:\.local)?\.json|\.claude\b|\.bashrc[^\s'"`,()]*|\.bash_profile|\.bash_aliases|\.bash_login|\.profile\b|\.zshrc|\.zshenv|\.zprofile|\.zlogin|\.kshrc|\.pam_environment|\.envrc|environment\.d|\.config\/fish|systemd\/user|\/etc\/environment|\/etc\/profile)[^\s'"`,()[\]{};<>|&]*|CLAUDE_ENV_FILE|CLAUDE_CONFIG_DIR/g) || [];
  return tokens.some((tok) => {
    if (!tok.includes('/') || /[*?$]/.test(tok) || /^(?:CLAUDE_ENV_FILE|CLAUDE_CONFIG_DIR)$/.test(tok)) return true;
    if (/\.claude\/?$/.test(tok)) return !classifyFixtureDir(tok, ctx);
    return !!classifyFile(tok, ctx);
  });
}
// a path ending in .claude: guarded unless its settings file would be a fixture
function classifyFixtureDir(tok, ctx) { return !classifyFile(path.join(tok, 'settings.json'), ctx); }

// Where a script writes: the target of each write call (open(X, 'w'), writeFileSync(X), appendFile(X),
// Path(X).write_text, the destination of rename / copy / move, Set-Content X, a shell redirect or tee
// in a shell script). A target that is a string literal is judged as a path; a variable assigned one
// literal is read through; an expression naming a guarded file (path.join(d, '.claude',
// 'settings.json')) is guarded; one with no literal at all (the loop variable of a glob) cannot be
// resolved and counts as guarded. A script that reads settings and writes report.txt passes.
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === '\\') { cur += text[++i] || ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) { args.push(cur.trim()); return args; } depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  args.push(cur.trim());
  return args;
}
const FIRST_ARG_WRITERS = /\b(?:open|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|write_text|write_bytes|truncate|truncateSync|unlink|unlinkSync|remove|rmSync|rm)\s*\(/g;
const SECOND_ARG_WRITERS = /\b(?:rename|renameSync|copy|copyfile|copy2|copyFile|copyFileSync|move|replace|symlink|symlinkSync|link)\s*\(/g;
function scriptWriteTargets(text) {
  const t = String(text);
  const out = [];
  let m;
  FIRST_ARG_WRITERS.lastIndex = 0;
  while ((m = FIRST_ARG_WRITERS.exec(t))) {
    const args = callArgs(t, m.index + m[0].length);
    // open(X) with no mode, or a read mode, reads
    if (/\bopen\s*\($/.test(m[0]) && !(args[1] && /^['"][wax]\+?b?['"]$|mode\s*=\s*['"][wax]/.test(args[1]))) continue;
    // Path(X).write_text(...): the path is the receiver
    if (/write_(?:text|bytes)/.test(m[0])) { const r = t.slice(0, m.index).match(/Path\s*\(([^()]*)\)\s*\.$/); out.push(r ? r[1] : ''); continue; }
    out.push(args[0] || '');
  }
  SECOND_ARG_WRITERS.lastIndex = 0;
  while ((m = SECOND_ARG_WRITERS.exec(t))) out.push(callArgs(t, m.index + m[0].length)[1] || '');
  const ps = /\b(?:Set-Content|Add-Content|Out-File)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?(\S+)/g;
  while ((m = ps.exec(t))) out.push(m[1]);
  for (const w of writeTargets(t)) out.push(JSON.stringify(w));
  return out;
}
function scriptWritesGuarded(text, ctx) {
  const t = String(text);
  const targets = scriptWriteTargets(t);
  // a write call whose target could not be found at all (f.write on a handle opened elsewhere)
  if (!targets.length) return true;
  const literal = (e) => { const m = String(e).trim().match(/^(['"`])((?:(?!\1).)*)\1$/); return m ? m[2] : null; };
  const assigned = (name) => { const m = t.match(new RegExp(`(?:^|[\\s;(])(?:const\\s+|let\\s+|var\\s+|my\\s+\\$?)?\\$?${name.replace(/[^A-Za-z0-9_]/g, '')}\\s*=\\s*(['"])([^'"]*)\\1`)); return m ? m[2] : null; };
  const pathGuarded = (p) => {
    if (/[*?$]/.test(p)) return true;
    if (!p.includes('/')) return GUARDED_NAME.test(p) && new RegExp(`^(?:${GUARDED_NAME.source})$`).test(p);
    return !!classifyFile(p, ctx);
  };
  return targets.some((e) => {
    const lit = literal(e);
    if (lit !== null) return pathGuarded(lit);
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(e).trim())) { const v = assigned(String(e).trim()); if (v !== null) return pathGuarded(v); }
    const lits = String(e).match(/(['"`])((?:(?!\1).)*)\1/g) || [];
    if (!lits.length) return true;
    return lits.some((l) => GUARDED_NAME.test(l.slice(1, -1)));
  });
}

// The files a plain command may write: redirect targets, tee's files, and, for an in-place editor or
// a copy, every word it names. A read of a guarded file (cat, grep, echo $TMPDIR, grep ... > out.txt)
// is therefore never refused.
// Only at command position: "install" or "cp" inside a commit message writes nothing.
const OTHER_WRITER = /(?:^|[;&|(\n]\s*)(?:sudo\s+(?:-\S+\s+)*)?(?:(?:sed|perl|ruby)\b[^|;&\n]*\s-[a-zA-Z]*i|(?:cp|mv|install|ln|sponge|dd|ed|ex|crudini|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item)\b)|\|\s*(?:sponge|dd)\b/;
// Quoted text blanked to spaces (same length): an operator or a command word inside a quoted string
// (a commit message, an echo) is not the shell's. Positions found in the blanked text are read back
// from the original, so a quoted target ("~/.bashrc") is still seen.
function blankQuotes(s) {
  return String(s).replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q) => q[0] + ' '.repeat(Math.max(0, q.length - 2)) + q[q.length - 1]);
}
function writeTargets(cmd) {
  const out = [];
  const text = String(cmd);
  const b = blankQuotes(text);
  const redirect = /(?:^|[^<>&0-9])[0-9]*>>?\|?/g;
  const target = /\s*(["']?)([^\s"';|&<>]+)\1/y;
  let m;
  while ((m = redirect.exec(b))) { target.lastIndex = m.index + m[0].length; const t = target.exec(text); if (t) out.push(t[2]); }
  const tee = /\btee\b[^;|&]*/g;
  while ((m = tee.exec(b))) out.push(...wordsOf(text.slice(m.index + 3, m.index + m[0].length)).filter((w) => !w.startsWith('-')));
  if (OTHER_WRITER.test(b)) out.push(...wordsOf(text));
  return out;
}
const writesSomething = (cmd) => writeTargets(cmd).some((w) => w !== '/dev/null' && !/^&?\d$/.test(w));

// cp / mv / install of one file onto a guarded file: judged by the source file's content.
function copyFindings(shell, ctx, readFile) {
  const out = [];
  const re = /(?:^|[;&|(\n]\s*)(?:sudo\s+)?(?:cp|mv|install|Copy-Item|Move-Item)\s+((?:[^;&|\n])+)/g;
  const b = blankQuotes(shell);
  let m;
  while ((m = re.exec(b))) {
    const span = String(shell).slice(m.index + m[0].length - m[1].length, m.index + m[0].length);
    const args = wordsOf(span).filter((w) => !w.startsWith('-'));
    if (args.length < 2) continue;
    const src = args[args.length - 2];
    let dest = args[args.length - 1];
    let cls = classifyFile(dest, ctx);
    if (!cls) { dest = path.join(dest, path.basename(src)); cls = classifyFile(dest, ctx); }
    if (!cls) continue;
    let srcText = null;
    let destText = '';
    try { srcText = String(readFile(path.resolve(ctx.cwd, expandHome(src, ctx.home)))); } catch (e) { srcText = null; }
    try { destText = String(readFile(cls.file)); } catch (e) { destText = ''; }
    if (srcText === null) continue; // unreadable source: the after-diff (setup-net.js) still sees it
    const ch = cls.kind === 'settings' ? settingsChange(destText, srcText, cls) : envFileChange(destText, srcText);
    for (const name of ch.temp) out.push({ type: 'temp', name, where: cls.file });
    if (ch.plugin) out.push({ type: 'plugin', name: ch.plugin, where: cls.file });
  }
  return out;
}

// `claude --settings <file|json>`: settings for that session, so a temp variable there moves its files.
function claudeSettingsFinding(shell, ctx, readFile) {
  const m = String(shell).match(/(?:^|[\s;&|(/])claude\b[^;&|\n]*?--settings(?:=|\s+)('[^']*'|"(?:[^"\\]|\\.)*"|\S+)/);
  if (!m) return null;
  const arg = m[1].replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1').replace(/\\"/g, '"');
  let text = arg;
  if (!arg.trim().startsWith('{')) { try { text = String(readFile(path.resolve(ctx.cwd, expandHome(arg, ctx.home)))); } catch (e) { text = ''; } }
  const parsed = parseObject(text);
  const name = parsed ? Object.keys(envOf(parsed)).find(isTempVar) : namesTemp(text);
  return name ? { type: 'temp', name, where: 'claude --settings' } : null;
}

// Disabling the plugin from a command: claude plugin disable|uninstall|remove delivery, or a write
// whose text sets a delivery@ enabledPlugins entry to false or deletes it.
const PLUGIN_CLI = /(?:^|[\s;&|(/])claude\s+plugins?\s+(?:disable|uninstall|remove|rm)\b[^;&|\n]*?(?:^|[\s'"])(delivery(?:@[A-Za-z0-9._-]+)?)(?![A-Za-z0-9_-])/;
const PLUGIN_OFF = [
  /(delivery@[A-Za-z0-9._-]+)['"]?\s*\]?\s*(?::|=(?!=))\s*(?:false|False|FALSE|0|\$false)\b/,
  /(?:\bdel\b|\bdelete\b|\.pop\s*\(|\bRemove\s*\(|\bunset\b)[^;\n]{0,80}?(delivery@[A-Za-z0-9._-]+)/,
  /(disableAllHooks|allowManagedHooksOnly)['"]?\s*\]?\s*(?::|=(?!=))\s*(?:true|True|TRUE|1|\$true)\b/,
];
// claude config set disableAllHooks true: the CLI writes the settings file itself
const HOOKS_OFF_CLI = /(?:^|[\s;&|(/])claude\s+config\s+(?:set|add)\b[^;&|\n]*?\b(disableAllHooks|allowManagedHooksOnly)\b/;

function pluginFindings(shell, scripts) {
  const cli = String(shell).match(PLUGIN_CLI);
  if (cli) return [{ type: 'plugin', name: cli[1], where: 'claude plugin' }];
  const cfgOff = String(shell).match(HOOKS_OFF_CLI);
  if (cfgOff) return [{ type: 'plugin', name: cfgOff[1], where: 'claude config' }];
  for (const text of [shell, ...scripts]) {
    for (const re of PLUGIN_OFF) {
      const m = joinFragments(text).match(re);
      if (m && (writesSomething(shell) || WRITE_CALL.test(text))) return [{ type: 'plugin', name: m[1], where: /delivery@/.test(m[1]) ? 'enabledPlugins' : 'settings' }];
    }
  }
  return [];
}

// The user-level guard launcher (lib/user-guard.js): only its installer writes it. A command that
// removes, moves, truncates or overwrites it, or a script that writes it, switches the guard off.
const LAUNCHER_NAME = GUARD_HOOK_MARK.split(path.sep).join('/');
function isLauncher(file, ctx) {
  if (!file) return false;
  const abs = path.resolve(ctx.cwd || '/', expandHome(String(file), ctx.home));
  return abs === path.join(configDirOf(ctx.home, ctx.env), GUARD_HOOK_MARK) || abs === path.join(ctx.home, '.claude', GUARD_HOOK_MARK);
}
const REMOVER = /(?:^|[;&|(\n]\s*)(?:sudo\s+(?:-\S+\s+)*)?(?:rm|unlink|mv|truncate|shred|cp|ln|install|chmod|dd|Remove-Item|Move-Item|Copy-Item|Clear-Content)\b/;
function launcherFindings(shell, scripts, ctx) {
  const text = String(shell);
  if (!text.includes('bin/setup-guard.js')) return [];
  const words = wordsOf(text).filter((w) => /bin\/setup-guard\.js$/.test(w));
  const named = words.some((w) => isLauncher(w, ctx) || /^(?:\$\{?CLAUDE_CONFIG_DIR\}?|~|\$\{?HOME\}?)?\/?(?:\.claude\/)?delivery\/bin\/setup-guard\.js$/.test(w));
  if (!named) return [];
  const writes = REMOVER.test(blankQuotes(text)) || writeTargets(text).some((w) => /bin\/setup-guard\.js$/.test(w))
    || scripts.some((sc) => WRITE_CALL.test(sc) || /\bremove\s*\(/.test(sc));
  return writes ? [{ type: 'plugin', name: 'the user-level setup guard launcher', where: words[0] }] : [];
}

const REBOOT = /(?:^|[;&|(]|\n)\s*(?:sudo\s+(?:-\S+\s+)*)?(?:reboot|poweroff|halt|shutdown)(?=\s|$|;|&|\|)|\bsystemctl\s+(?:--\S+\s+)*(?:reboot|poweroff|halt|kexec|soft-reboot)\b|(?:^|[;&|(]|\n)\s*(?:sudo\s+)?init\s+[06]\b|\bRestart-Computer\b|\bStop-Computer\b/;

function shellFindings(command, ctx, readFile = () => { throw new Error('no reader'); }, depth = 0) {
  const findings = [];
  // a shell given its script inline (bash -c '...', eval '...'): that script is a command line too
  if (depth < 3) {
    const inner = String(command).match(/(?:^|[\s;&|(/])(?:(?:bash|sh|zsh|dash|ksh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c|eval)\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/);
    if (inner) findings.push(...shellFindings(inner[1] !== undefined ? inner[1] : inner[2].replace(/\\(["\\$`])/g, '$1'), ctx, readFile, depth + 1));
  }
  const { shell: rawShell, bodies } = splitHeredocs(command);
  const shell = stripOneOff(rawShell);
  const dequoted = shell.replace(/['"]/g, '');
  const temp = setsTemp(shell) || setsTemp(dequoted);
  // Persistent environments with no file to name: the user's session manager, launchd, Windows.
  if (temp && /\bsystemctl\b[^;&|]*\b(?:set-environment|import-environment)\b/.test(shell)) findings.push({ type: 'temp', name: temp, where: 'the user session manager (systemctl --user)' });
  else if (temp && /\blaunchctl\s+(?:setenv|putenv)\b/.test(shell)) findings.push({ type: 'temp', name: temp, where: 'launchd (launchctl setenv)' });
  else if (temp && /\bsetx\b/i.test(shell)) findings.push({ type: 'temp', name: temp, where: 'the Windows user environment (setx)' });
  else if (/\[(?:System\.)?Environment\]::SetEnvironmentVariable\s*\(\s*['"](?:TMPDIR|TMP|TEMP|TEMPDIR|CLAUDE_CODE_TMPDIR)['"]/i.test(shell)) findings.push({ type: 'temp', name: shell.match(/SetEnvironmentVariable\s*\(\s*['"]([A-Za-z_]+)/i)[1], where: 'the Windows environment (SetEnvironmentVariable)' });
  else if (temp && /\bclaude\s+config\s+(?:set|add)\b/.test(shell)) findings.push({ type: 'temp', name: temp, where: 'Claude Code settings (claude config)' });
  else if (temp) {
    const target = writeTargets(shell).map((w) => classifyFile(w, ctx)).find(Boolean);
    if (target) findings.push({ type: 'temp', name: temp, where: target.file });
  }
  const cs = claudeSettingsFinding(shell, ctx, readFile);
  if (cs) findings.push(cs);
  // A heredoc body or an inline script: judged as a whole. It names a temp variable (whole or from
  // parts), names a guarded file, and calls something that writes: refused. A heredoc fed to a plain
  // writer (cat > ~/.bashrc <<EOF) is judged with the shell's write targets instead.
  const scripts = [...bodies];
  if (INLINE_FLAG.test(rawShell)) scripts.push(rawShell);
  const fedToInterpreter = bodies.length && INTERPRETER.test(rawShell);
  if (!findings.some((f) => f.type === 'temp')) {
    for (const text of scripts) {
      const name = namesTemp(text);
      const isScript = text === rawShell || fedToInterpreter;
      if (!name) continue;
      if (isScript && namesGuarded(text, ctx) && WRITE_CALL.test(text) && scriptWritesGuarded(text, ctx)) { findings.push({ type: 'temp', name, where: 'a script that writes a settings or environment file' }); break; }
      if (!isScript && setsTemp(text)) {
        const target = writeTargets(rawShell).map((w) => classifyFile(w, ctx)).find(Boolean);
        if (target) { findings.push({ type: 'temp', name, where: target.file }); break; }
      }
    }
  }
  findings.push(...copyFindings(shell, ctx, readFile));
  findings.push(...pluginFindings(rawShell, bodies));
  findings.push(...launcherFindings(rawShell, scripts, ctx));
  // Other variables made persistent the same way: searched in the records.
  if (!findings.length) {
    const m = shell.match(/\b(?:systemctl\b[^;&|]*\bset-environment|launchctl\s+(?:setenv|putenv)|setx(?:\s+\/m)?)\s+((?:[A-Za-z_][A-Za-z0-9_]*(?:=\S*)?\s*)+)/i);
    if (m) {
      const names = m[1].trim().split(/\s+/).map((x) => x.split('=')[0]).filter((x) => ENV_NAME.test(x) && !isTempVar(x));
      // launchctl setenv and setx take NAME VALUE: only the first word is a name
      if (/launchctl|setx/i.test(m[0])) names.splice(1);
      if (names.length) findings.push({ type: 'keys', keys: names.map((name) => ({ name, exact: true })), where: 'the persistent user environment' });
    }
  }
  // Restarting the host; `systemctl restart <unit>` restarts a service and is not this.
  if (REBOOT.test(rawShell)) findings.push({ type: 'restart' });
  return findings;
}

// ---------- records ----------

const usable = (r) => r && typeof r.statement === 'string' && (r.kind === 'decision' || (r.kind === 'answer' && r.confidence === 'settled'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sentencesOf = (s) => String(s).split(/(?<=[.!?])\s+|\n+/);
const PROHIBIT = /\b(?:never|not|no|don't|do not|must not|mustn't|nobody|no one)\b/i;
const SETTINGS_CTX = /\b(?:settings?|settings\.json|env|environment|config|configuration|machine setup)\b/i;
const REQUEST = /\b(?:fix|set|add|restore|repair|install|update|change|put)\b/i;

// The records that forbid changing a key. Matched sentence by sentence: the key as a word
// (case-sensitive for an environment variable, any case for a settings key), a prohibition in the same
// sentence, and no request for the change ahead of the key ("Fix the bd PATH bug" asks for it). A
// settings key also needs "settings", "env", "config" or "machine setup" within a few words, so a
// record that says "model" or "hooks" in passing blocks nothing.
function recordsNaming(all, key, { exact, setting }) {
  const word = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(key)}(?![A-Za-z0-9_])`, exact ? '' : 'i');
  return all.filter((r) => sentencesOf(r.statement).some((s) => {
    const m = word.exec(s);
    if (!m || !PROHIBIT.test(s)) return false;
    // a request ahead of the key asks for the change, unless it is itself negated ("must not change")
    const from = Math.max(0, m.index - 40);
    const rq = REQUEST.exec(s.slice(from, m.index));
    if (rq && !PROHIBIT.test(s.slice(Math.max(0, from + rq.index - 15), from + rq.index))) return false;
    if (setting) {
      const near = s.slice(Math.max(0, m.index - 40), m.index + key.length + 40);
      if (!SETTINGS_CTX.test(near.replace(word, ' '))) return false;
    }
    return true;
  }));
}
const TEMP_RECORD = /\/tmp\b|(?<![A-Za-z0-9_])(?:CLAUDE_CODE_)?TMPDIR(?![A-Za-z0-9_])|\btemp(?:orary)?[- ]files?\b/i;
// "never rely on a restart", "must not rely on restarting it"; not "restart the team onto it"
const RESTART_RECORD = /\b(?:never|not)\b[^.]{0,40}\b(?:restart|reboot)/i;
// the standing rule that machine setup the operator ruled on is not a session's call
const RULE_RECORD = /\bmachine (?:settings|setup)\b/i;

function quoteOf(r) {
  const s = String(r.statement).replace(/\s+/g, ' ').trim();
  return s.length > MAX_QUOTE ? `${s.slice(0, MAX_QUOTE - 3)}...` : s;
}
function cite(records) {
  const head = records.slice(0, 2).map((r) => `${r.id} "${quoteOf(r)}"`).join('; ');
  const rest = records.slice(2).map((r) => r.id);
  return rest.length ? `${head}; also ${rest.join(', ')}` : head;
}
function ruleClause(all) {
  const rule = all.find((r) => RULE_RECORD.test(r.statement));
  return `Changing machine setup the operator has ruled on is not a session's call${rule ? ` (${rule.id})` : ''}.`;
}
function closing(ids) {
  return ids.length
    ? `If you believe it must change, message the Chief of Staff with the record id (${ids[0]}); do not ask the operator.`
    : 'If you believe it must change, message the Chief of Staff; do not ask the operator.';
}
const usableRecords = (records) => {
  let all = [];
  try { all = (typeof records === 'function' ? records() : records) || []; } catch (e) { all = []; }
  return Array.isArray(all) ? all.filter(usable) : [];
};

// The reason for a temp-location change or a guard switch-off, shared with the after-diff.
function tempReason(name, where, all) {
  // the record that rules on the location itself (names TMPDIR, or relocating) is cited first;
  // the store lists newest first, which would put a later record that only mentions temp files ahead
  const rank = (r) => (/(?<![A-Za-z0-9_])(?:CLAUDE_CODE_)?TMPDIR(?![A-Za-z0-9_])|\brelocat/i.test(r.statement) ? 0 : 1);
  const named = all.filter((r) => TEMP_RECORD.test(r.statement)).map((r, i) => [rank(r), i, r]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
  const ruled = named.length
    ? `The operator ruled on it: ${cite(named)}.`
    : 'Where temp files go is fixed on this host: tests run in the sealed runner\'s private /tmp, and temp files are not relocated.';
  return `Refused: this changes where temp files go (${name} in ${where}). ${ruled} ${ruleClause(all)} ${closing(named.map((r) => r.id))}`;
}
function pluginReason(name, where, all) {
  return `Refused: this switches off the setup guard (${name} in ${where}), which keeps machine setup the operator has ruled on. ${ruleClause(all)} ${closing([])}`;
}

// ---------- the decision ----------

// null (allow) or { reason } (deny).
function decideSetup({ toolName, toolInput, cwd, home, env = {}, readFile, exists, tmpdir, records } = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const ctx = { cwd: cwd || '/', home: home || '/nonexistent-home', env, exists, tmpdir };
  const read = readFile || (() => { throw new Error('no reader'); });
  const findings = [];
  if (FILE_TOOLS.includes(toolName)) {
    if (isLauncher(input.file_path || input.notebook_path, ctx)) return { reason: pluginReason('the user-level setup guard launcher', path.resolve(ctx.cwd, expandHome(input.file_path || input.notebook_path, ctx.home)), usableRecords(records)) };
    const cls = classifyFile(input.file_path || input.notebook_path, ctx);
    if (!cls) return null;
    let before = '';
    try { before = String(read(cls.file)); } catch (e) { before = ''; } // a new file
    const after = afterText(toolName, input, before);
    const ch = cls.kind === 'settings' ? settingsChange(before, after, cls) : envFileChange(before, after);
    for (const name of ch.temp) findings.push({ type: 'temp', name, where: cls.file });
    if (ch.plugin) findings.push({ type: 'plugin', name: ch.plugin, where: cls.file });
    if (ch.keys.length) findings.push({ type: 'keys', keys: ch.keys, where: cls.file });
  } else {
    let command = null;
    try { command = require('./lane.js').shellCommandOf(toolName, input); } catch (e) { command = typeof input.command === 'string' ? input.command : null; }
    if (command === null || !command.trim()) return null;
    findings.push(...shellFindings(command, ctx, read));
  }
  if (!findings.length) return null;
  const all = usableRecords(records);

  const temp = findings.find((f) => f.type === 'temp');
  if (temp) return { reason: tempReason(temp.name, temp.where, all) };
  const plugin = findings.find((f) => f.type === 'plugin');
  if (plugin) return { reason: pluginReason(plugin.name, plugin.where, all) };
  if (findings.some((f) => f.type === 'restart')) {
    const named = all.filter((r) => RESTART_RECORD.test(r.statement));
    if (named.length) return { reason: `Refused: this restarts the machine. The operator ruled on it: ${cite(named)}. ${ruleClause(all)} ${closing(named.map((r) => r.id))}` };
  }
  for (const f of findings.filter((x) => x.type === 'keys')) {
    for (const k of f.keys) {
      const named = recordsNaming(all, k.name, k);
      if (named.length) return { reason: `Refused: this changes ${k.name} in ${f.where}, machine setup the operator ruled on: ${cite(named)}. ${ruleClause(all)} ${closing(named.map((r) => r.id))}` };
    }
  }
  return null;
}

// ---------- where the records are ----------

// Every project root on this host whose operator records bind it: the session's own role project, the
// projects the watchdog host job serves (one systemd service or launchd agent per project), and
// DELIVERY_PROJECTS (path-delimited). The watchdog units carry the project as their working directory
// (watchdog.js jobFiles); the --project argument itself lives in the job's job.js, not in the unit.
// The role marker is read without validating it: it can only add records, so more refusals, never fewer.
function projectRoots({ cwd, home, env = process.env, fs = require('fs') } = {}) {
  const roots = [];
  const add = (r) => { if (typeof r === 'string' && path.isAbsolute(r) && !roots.includes(r)) roots.push(r); };
  try {
    const found = require('./role-context.js').findRoleMarker(cwd);
    if (found && found.marker) add(found.marker.project_root);
  } catch (e) { /* no marker */ }
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
  const list = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
  const units = path.join(home, '.config', 'systemd', 'user');
  for (const f of list(units).filter((n) => /^delivery-watchdog-[0-9a-f]+\.service$/.test(n))) {
    const body = read(path.join(units, f));
    const wd = body.match(/^WorkingDirectory=(.+)$/m);
    if (wd) add(wd[1].trim().replace(/%%/g, '%'));
  }
  const agents = path.join(home, 'Library', 'LaunchAgents');
  for (const f of list(agents).filter((n) => /^com\.delivery-plugin\.watchdog\..+\.plist$/.test(n))) {
    const m = read(path.join(agents, f)).match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/);
    if (m) add(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  for (const p of String(env.DELIVERY_PROJECTS || '').split(path.delimiter)) add(p.trim());
  return roots;
}

// The operator records of every project root (find drops revoked and superseded ones); a project
// whose records cannot be read adds none.
function loadRecords(roots) {
  const out = [];
  const seen = new Set();
  let find;
  try { find = require('../../scripts/lib/operator-records.js').find; } catch (e) { return out; }
  for (const root of roots) {
    try {
      for (const r of find(root, { kinds: ['decision', 'answer'] })) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    } catch (e) { /* unreadable: no records from this project */ }
  }
  return out;
}

// For the hook's fail-safe: the input clearly targets a Claude settings file and names a temp variable.
function obviousTempSettings(toolInput, ctx) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (!TEMP_WORD.test(JSON.stringify(input))) return false;
  const file = input.file_path || input.notebook_path;
  const isSettings = (w) => { const c = classifyFile(w, ctx); return !!c && c.kind === 'settings'; };
  if (file) return isSettings(file);
  return typeof input.command === 'string' && (wordsOf(input.command).some(isSettings) || /settings(?:\.local)?\.json/.test(input.command));
}

module.exports = {
  decideSetup, classifyFile, afterText, settingsChange, envFileChange, assignments, shellFindings, setsTemp, namesTemp,
  recordsNaming, projectRoots, loadRecords, obviousTempSettings, tempReason, pluginReason, usableRecords, configDirOf,
  hasGuardHook, isTempVar, isLauncher, scriptWriteTargets, TEMP_VARS, RC_FILES, GUARD_HOOK_MARK, PLUGIN_KEY, HOOKS_OFF_KEYS,
};
