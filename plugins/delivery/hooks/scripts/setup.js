// hooks/scripts/setup.js — machine setup the operator has ruled on is not a session's call.
//
// Why this exists: a Claude Code session that was not a team role session set TMPDIR in every role's
// .claude/settings.local.json, against a recorded operator decision that temp files stay in the sealed
// runner's private /tmp and are never relocated. The lane and leak guards could not stop it: they are
// inert without a role marker. This guard is the opposite: setup-guard.js runs it in EVERY session on
// the host (the plugin is enabled at user scope), team role or not.
//
// What it refuses:
//   1. Any change of where temp files go (TMPDIR, CLAUDE_CODE_TMPDIR, TMP, TEMP, TEMPDIR) in a Claude
//      settings file, a shell or session environment file, or through a command that persists it
//      (systemctl --user set-environment, launchctl setenv, setx, ...). A hard rule: refused even when
//      no operator record can be read, because the sealed test runner depends on it.
//   2. Any other change to those machine-setup files whose changed key a recorded operator decision
//      names (a decision, or a settled answer, that is neither revoked nor superseded). The reason
//      names the record. No record names it: allowed.
//   3. Disabling this plugin in a Claude settings file (it would switch this guard off).
//   4. Rebooting the host when a record says never to rely on a restart.
// Removing a temp-location setting is allowed: that is how a wrong one is reverted.
//
// The refusal never tells the session to ask the operator: a ruled-on change goes to the Chief of
// Staff with the record id, and the operator is never asked to approve or undo it.
//
// decideSetup is pure: files and records come in through readFile and records (an array, or a
// function returning one, called only when a candidate machine-setup change is found, so ordinary
// tool calls never read the operator store).
const path = require('path');
const { isDeepStrictEqual } = require('util');

const TEMP_VARS = ['TMPDIR', 'CLAUDE_CODE_TMPDIR', 'TMP', 'TEMP', 'TEMPDIR'];
const isTempVar = (k) => TEMP_VARS.includes(String(k).toUpperCase());
// a temp variable name as a whole word, case-sensitive: "/tmp" and "temporary" are not one
const TEMP_WORD_SRC = `(?<![A-Za-z0-9_])(?:${TEMP_VARS.join('|')})(?![A-Za-z0-9_])`;
const TEMP_WORD = new RegExp(TEMP_WORD_SRC);
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const PLUGIN_KEY = /^delivery@/;
const MAX_QUOTE = 160;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- which files are machine setup ----------

const RC_FILES = ['.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.pam_environment'];
const ETC_FILES = ['/etc/environment', '/etc/profile', '/etc/bash.bashrc', '/etc/zshenv', '/etc/zsh/zshenv', '/etc/zsh/zshrc', '/etc/zprofile'];

function expandHome(p, home) {
  const s = String(p);
  if (s === '~' || s.startsWith('~/')) return path.join(home, s.slice(1));
  return s.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
}

// { kind: 'settings' | 'env', file, userScope } or null. 'settings' is a Claude settings file; 'env' a
// shell or session environment file. userScope: a settings file that applies to every project (the
// user's, CLAUDE_CONFIG_DIR's, managed settings).
function classifyFile(file, { cwd, home, env = {} }) {
  if (!file || typeof file !== 'string') return null;
  // Claude Code's per-session environment file: what is appended there reaches every later command
  if (/^\$\{?CLAUDE_ENV_FILE\}?$/.test(file) || (env.CLAUDE_ENV_FILE && path.resolve(file) === path.resolve(env.CLAUDE_ENV_FILE))) return { kind: 'env', file };
  const abs = path.resolve(cwd || '/', expandHome(file, home));
  const base = path.basename(abs);
  const dir = path.dirname(abs);
  const configDir = env.CLAUDE_CONFIG_DIR ? path.resolve(expandHome(env.CLAUDE_CONFIG_DIR, home)) : null;
  if (base === 'managed-settings.json') return { kind: 'settings', file: abs, userScope: true };
  if (base === 'settings.json' || base === 'settings.local.json') {
    const userDirs = [path.join(home, '.claude'), configDir].filter(Boolean);
    if (userDirs.includes(dir)) return { kind: 'settings', file: abs, userScope: true };
    if (abs.split(path.sep).includes('.claude')) return { kind: 'settings', file: abs, userScope: false };
    return null;
  }
  if (dir === home && RC_FILES.includes(base)) return { kind: 'env', file: abs };
  if (ETC_FILES.includes(abs) || dir === '/etc/profile.d') return { kind: 'env', file: abs };
  if (dir === path.join(home, '.config', 'environment.d') && base.endsWith('.conf')) return { kind: 'env', file: abs };
  if (dir === path.join(home, '.config', 'fish') && base === 'config.fish') return { kind: 'env', file: abs };
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

// A Claude settings change: temp keys added or changed, every other changed key (for the record
// search), and a disable of this plugin.
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
    keys.push({ name: k, exact: true });
  }
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'env' || isDeepStrictEqual(b[k], a[k])) continue;
    keys.push({ name: k });
  }
  // Disabling the plugin switches this guard off. false in any settings file disables it for that
  // scope; removing a true from a user-scope file leaves it off everywhere. Removing it from a project
  // file falls back to the user's setting, so that is allowed.
  const bp = b.enabledPlugins && typeof b.enabledPlugins === 'object' ? b.enabledPlugins : {};
  const ap = a.enabledPlugins && typeof a.enabledPlugins === 'object' ? a.enabledPlugins : {};
  let plugin = false;
  for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
    if (!PLUGIN_KEY.test(k)) continue;
    if (ap[k] === false && bp[k] !== false) plugin = k;
    if (bp[k] === true && !has(ap, k) && cls.userScope) plugin = k;
  }
  return { temp, keys, plugin };
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
    if (isTempVar(name)) temp.push(name); else keys.push({ name, exact: true });
  }
  for (const name of b.keys()) if (!a.has(name) && !isTempVar(name)) keys.push({ name, exact: true });
  return { temp, keys, plugin: false };
}

// ---------- shell commands ----------

// The words of a command with quotes dropped, so a guarded file is found however it is quoted.
function wordsOf(command) {
  return String(command).split(/[\s;&|()<>`]+/).map((w) => w.replace(/^['"]+|['"]+$/g, '')).filter(Boolean);
}

// The temp variable a command sets: NAME=, "NAME": , .env.NAME, env["NAME"] =, setenv/setx NAME,
// or none. Removals (unset, jq del(...), a sed /.../d delete) are stripped first: they revert.
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

// The files a command may write: redirect targets, tee's files, and, for an in-place editor, an inline
// interpreter or a copy, every word it names (which file such a command writes is not parsed). A
// read of a guarded file (cat, grep, echo $TMPDIR, grep ... > out.txt) is therefore never refused.
const OTHER_WRITER = /\bsed\b[^|;&]*\s-[a-zA-Z]*i|\b(?:perl|ruby)\b[^|;&]*\s-[a-zA-Z]*i|\b(?:python[0-9.]*|node|perl|ruby|deno|bun)\b[^|;&]*\s-[ce]\b|\b(?:cp|mv|install|ln|sponge|dd|ed|ex|crudini|Set-Content|Add-Content|Out-File)\b/;
function writeTargets(cmd) {
  const out = [];
  const redirect = /(?:^|[^<>&0-9])[0-9]*>>?\|?\s*(["']?)([^\s"';|&<>]+)\1/g;
  let m;
  while ((m = redirect.exec(cmd))) out.push(m[2]);
  const tee = /\btee\b([^;|&]*)/g;
  while ((m = tee.exec(cmd))) out.push(...wordsOf(m[1]).filter((w) => !w.startsWith('-')));
  if (OTHER_WRITER.test(cmd)) out.push(...wordsOf(cmd));
  return out;
}
const REBOOT = /(?:^|[;&|(]|\n)\s*(?:sudo\s+(?:-\S+\s+)*)?(?:reboot|poweroff|halt|shutdown)(?=\s|$|;|&|\|)|\bsystemctl\s+(?:--\S+\s+)*(?:reboot|poweroff|halt|kexec|soft-reboot)\b|(?:^|[;&|(]|\n)\s*(?:sudo\s+)?init\s+[06]\b|\bRestart-Computer\b|\bStop-Computer\b/;

function shellFindings(command, ctx) {
  const findings = [];
  const cmd = String(command);
  const temp = setsTemp(cmd);
  // Persistent environments with no file to name: the user's session manager, launchd, Windows.
  // A one-off `TMPDIR=x cmd` sets nothing that outlives the command and is not refused.
  if (temp && /\bsystemctl\b[^;&|]*\b(?:set-environment|import-environment)\b/.test(cmd)) findings.push({ type: 'temp', name: temp, where: 'the user session manager (systemctl --user)' });
  else if (temp && /\blaunchctl\s+(?:setenv|putenv)\b/.test(cmd)) findings.push({ type: 'temp', name: temp, where: 'launchd (launchctl setenv)' });
  else if (temp && /\bsetx\b/i.test(cmd)) findings.push({ type: 'temp', name: temp, where: 'the Windows user environment (setx)' });
  else if (/\[(?:System\.)?Environment\]::SetEnvironmentVariable\s*\(\s*['"](?:TMPDIR|TMP|TEMP|TEMPDIR|CLAUDE_CODE_TMPDIR)['"]/i.test(cmd)) findings.push({ type: 'temp', name: cmd.match(/SetEnvironmentVariable\s*\(\s*['"]([A-Za-z_]+)/i)[1], where: 'the Windows environment (SetEnvironmentVariable)' });
  else if (temp && /\bclaude\s+config\s+(?:set|add)\b/.test(cmd)) findings.push({ type: 'temp', name: temp, where: 'Claude Code settings (claude config)' });
  else if (temp) {
    const target = writeTargets(cmd).map((w) => classifyFile(w, ctx)).find(Boolean);
    if (target) findings.push({ type: 'temp', name: temp, where: target.file });
  }
  // Other variables made persistent the same way: searched in the records.
  if (!findings.length) {
    const m = cmd.match(/\b(?:systemctl\b[^;&|]*\bset-environment|launchctl\s+(?:setenv|putenv)|setx(?:\s+\/m)?)\s+((?:[A-Za-z_][A-Za-z0-9_]*(?:=\S*)?\s*)+)/i);
    if (m) {
      const names = m[1].trim().split(/\s+/).map((x) => x.split('=')[0]).filter((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x) && !isTempVar(x));
      // launchctl setenv and setx take NAME VALUE: only the first word is a name
      if (/launchctl|setx/i.test(m[0])) names.splice(1);
      if (names.length) findings.push({ type: 'keys', keys: names.map((name) => ({ name, exact: true })), where: 'the persistent user environment' });
    }
  }
  // Restarting the host; `systemctl restart <unit>` restarts a service and is not this.
  if (REBOOT.test(cmd)) findings.push({ type: 'restart' });
  return findings;
}

// ---------- records ----------

const usable = (r) => r && typeof r.statement === 'string' && (r.kind === 'decision' || (r.kind === 'answer' && r.confidence === 'settled'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A key is named by a record when its statement holds it as a word: case-sensitive for an environment
// variable (exact) or an upper-case name (PATH, not "path"); case-insensitive otherwise but only from
// four characters, so a short settings key ("env", "ui") matches nothing by accident.
function keyMatcher(key, exact = false) {
  const k = String(key);
  if (exact || /^[A-Z][A-Z0-9_]*$/.test(k)) return new RegExp(`(?<![A-Za-z0-9_])${escapeRe(k)}(?![A-Za-z0-9_])`);
  if (k.length < 4) return null;
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRe(k)}(?![A-Za-z0-9_])`, 'i');
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

// ---------- the decision ----------

// null (allow) or { reason } (deny).
function decideSetup({ toolName, toolInput, cwd, home, env = {}, readFile, records } = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const ctx = { cwd: cwd || '/', home: home || '/nonexistent-home', env };
  const findings = [];
  if (FILE_TOOLS.includes(toolName)) {
    const cls = classifyFile(input.file_path || input.notebook_path, ctx);
    if (!cls) return null;
    let before = '';
    try { before = readFile ? String(readFile(cls.file)) : ''; } catch (e) { before = ''; } // a new file
    const after = afterText(toolName, input, before);
    const ch = cls.kind === 'settings' ? settingsChange(before, after, cls) : envFileChange(before, after);
    for (const name of ch.temp) findings.push({ type: 'temp', name, where: cls.file });
    if (ch.plugin) findings.push({ type: 'plugin', name: ch.plugin, where: cls.file });
    if (ch.keys.length) findings.push({ type: 'keys', keys: ch.keys, where: cls.file });
  } else {
    let command = null;
    try { command = require('./lane.js').shellCommandOf(toolName, input); } catch (e) { command = typeof input.command === 'string' ? input.command : null; }
    if (command === null || !command.trim()) return null;
    findings.push(...shellFindings(command, ctx));
  }
  if (!findings.length) return null;
  let all = [];
  try { all = (typeof records === 'function' ? records() : records) || []; } catch (e) { all = []; }
  all = Array.isArray(all) ? all.filter(usable) : [];

  const temp = findings.find((f) => f.type === 'temp');
  if (temp) {
    // the record that rules on the location itself (names TMPDIR, or relocating) is cited first;
    // the store lists newest first, which would put a later record that only mentions temp files ahead
    const rank = (r) => (/(?<![A-Za-z0-9_])(?:CLAUDE_CODE_)?TMPDIR(?![A-Za-z0-9_])|\brelocat/i.test(r.statement) ? 0 : 1);
    const named = all.filter((r) => TEMP_RECORD.test(r.statement)).map((r, i) => [rank(r), i, r]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
    const ruled = named.length
      ? `The operator ruled on it: ${cite(named)}.`
      : 'Where temp files go is fixed on this host: tests run in the sealed runner\'s private /tmp, and temp files are not relocated.';
    return { reason: `Refused: this changes where temp files go (${temp.name} in ${temp.where}). ${ruled} ${ruleClause(all)} ${closing(named.map((r) => r.id))}` };
  }
  const plugin = findings.find((f) => f.type === 'plugin');
  if (plugin) {
    return { reason: `Refused: this disables the delivery plugin (${plugin.name} in ${plugin.where}), which switches off the guard over machine setup the operator has ruled on. ${ruleClause(all)} ${closing([])}` };
  }
  if (findings.some((f) => f.type === 'restart')) {
    const named = all.filter((r) => RESTART_RECORD.test(r.statement));
    if (named.length) return { reason: `Refused: this restarts the machine. The operator ruled on it: ${cite(named)}. ${ruleClause(all)} ${closing(named.map((r) => r.id))}` };
  }
  for (const f of findings.filter((x) => x.type === 'keys')) {
    for (const { name: key, exact } of f.keys) {
      const re = keyMatcher(key, exact);
      if (!re) continue;
      const named = all.filter((r) => re.test(r.statement));
      if (named.length) return { reason: `Refused: this changes ${key} in ${f.where}, machine setup the operator ruled on: ${cite(named)}. ${ruleClause(all)} ${closing(named.map((r) => r.id))}` };
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
  return typeof input.command === 'string' && wordsOf(input.command).some(isSettings);
}

module.exports = { decideSetup, classifyFile, afterText, settingsChange, envFileChange, shellFindings, setsTemp, keyMatcher, projectRoots, loadRecords, obviousTempSettings, TEMP_VARS };
