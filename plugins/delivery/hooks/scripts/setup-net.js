// hooks/scripts/setup-net.js — the after-check behind the setup guard (setup.js).
//
// Why: what a command writes is not always in its text. A cp of a staged settings file, a script file
// run by name, a name built at run time: the guard before the tool cannot see those. So before every
// write or shell tool the guard snapshots the guarded files, and after it compares: a temp variable
// added or changed, the delivery plugin disabled, or the user-level guard hook removed is put back in
// place, and the tool result is blocked with the same record-citing reason, saying it was reverted.
//
// The snapshot holds only what is restored (temp variable values, the delivery enabledPlugins values,
// the guard hook entries, and the temp assignment lines of a shell or environment file), so it stays
// small and fast. It lives in the plugin's state directory (CLAUDE_PLUGIN_DATA, else
// <config dir>/delivery/state), never in /tmp, keyed by session and tool call, and is deleted after the
// check. Restoring is idempotent: two copies of the guard (the plugin hook and the user-level one) that
// both run after the same tool write the same values.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./setup.js');

const STALE_MS = 24 * 3600 * 1000;
const MANAGED = ['/etc/claude-code/managed-settings.json', '/Library/Application Support/ClaudeCode/managed-settings.json'];

function stateDir({ home, env = {} }) {
  return env.CLAUDE_PLUGIN_DATA ? path.join(env.CLAUDE_PLUGIN_DATA, 'setup-net') : path.join(S.configDirOf(home, env), 'delivery', 'state');
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const list = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };

// The role directories of a project: those its roster recorded, and the default team directory
// prepare-role uses (<root>/../<project>-team/<instance>) for every instance in the manifest.
function roleDirsOf(root) {
  const dirs = [];
  const roster = readJson(path.join(root, '.delivery', 'team', 'roster.json'));
  for (const v of Object.values((roster && roster.instances) || {})) if (v && typeof v.role_dir === 'string' && path.isAbsolute(v.role_dir)) dirs.push(v.role_dir);
  const team = readJson(path.join(root, '.delivery', 'team', 'team.json'));
  if (team && typeof team.project === 'string') {
    const teamDir = path.join(root, '..', `${team.project}-team`);
    for (const name of list(teamDir)) dirs.push(path.join(teamDir, name));
  }
  return dirs;
}

// Every file the after-check guards, as [{ file, kind: 'settings' | 'env' }].
function guardedFiles({ home, env = {}, cwd, roots = [] }) {
  const out = new Map();
  const add = (file, kind) => { if (file && !out.has(file)) out.set(file, kind); };
  for (const dir of new Set([S.configDirOf(home, env), path.join(home, '.claude')])) for (const b of ['settings.json', 'settings.local.json']) add(path.join(dir, b), 'settings');
  for (const f of MANAGED) add(f, 'settings');
  for (const b of S.RC_FILES) add(path.join(home, b), 'env');
  for (const d of ['.bashrc.d', '.zshrc.d']) for (const n of list(path.join(home, d))) add(path.join(home, d, n), 'env');
  for (const n of list(path.join(home, '.config', 'environment.d')).filter((x) => x.endsWith('.conf'))) add(path.join(home, '.config', 'environment.d', n), 'env');
  add(path.join(home, '.config', 'fish', 'config.fish'), 'env');
  for (const n of list(path.join(home, '.config', 'fish', 'conf.d'))) add(path.join(home, '.config', 'fish', 'conf.d', n), 'env');
  for (const n of list(path.join(home, '.config', 'systemd', 'user')).filter((x) => /\.(?:service|conf)$/.test(x))) add(path.join(home, '.config', 'systemd', 'user', n), 'env');
  add('/etc/environment', 'env');
  if (env.CLAUDE_ENV_FILE) add(path.resolve(env.CLAUDE_ENV_FILE), 'env');
  const roleDirs = [];
  if (cwd) {
    roleDirs.push(path.resolve(cwd));
    try { const m = require('./role-context.js').findRoleMarker(cwd); if (m) roleDirs.push(path.dirname(m.markerFile)); } catch (e) { /* no marker */ }
  }
  for (const root of roots) { roleDirs.push(root); try { roleDirs.push(...roleDirsOf(root)); } catch (e) { /* unreadable project */ } }
  for (const d of roleDirs) for (const b of ['settings.json', 'settings.local.json']) add(path.join(d, '.claude', b), 'settings');
  return [...out].map(([file, kind]) => ({ file, kind }));
}

// What is kept of one file: null when it does not exist.
function stateOf(kind, text) {
  if (text === null) return null;
  if (kind === 'env') {
    const lines = String(text).split(/\r?\n/).filter((l) => [...S.assignments(l).keys()].some(S.isTempVar));
    return { lines };
  }
  let j = null;
  try { j = JSON.parse(text); } catch (e) { return { unparsable: true }; }
  if (!j || typeof j !== 'object') return { unparsable: true };
  const temp = {};
  for (const [k, v] of Object.entries((j.env && typeof j.env === 'object') ? j.env : {})) if (S.isTempVar(k)) temp[k] = v;
  const plugins = {};
  for (const [k, v] of Object.entries((j.enabledPlugins && typeof j.enabledPlugins === 'object') ? j.enabledPlugins : {})) if (S.PLUGIN_KEY.test(k)) plugins[k] = v;
  const guard = {};
  const mark = S.GUARD_HOOK_MARK.split(path.sep).join('/');
  for (const [ev, entries] of Object.entries((j.hooks && typeof j.hooks === 'object') ? j.hooks : {})) {
    const mine = Array.isArray(entries) ? entries.filter((e) => JSON.stringify(e).includes(mark)) : [];
    if (mine.length) guard[ev] = mine;
  }
  return { temp, plugins, guard };
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };

function snapshot(files) {
  const snap = {};
  for (const { file, kind } of files) snap[file] = { kind, state: stateOf(kind, readText(file)) };
  return snap;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.setup-net-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// The changes to put back for one file: [{ what, restore(json|lines) }], described for the reason.
function changesOf(kind, before, after) {
  const out = [];
  if (!after) return out;
  if (kind === 'env') {
    const had = new Set((before && before.lines) || []);
    for (const line of after.lines) if (!had.has(line)) out.push({ type: 'temp', name: [...S.assignments(line).keys()].find(S.isTempVar), line });
    return out;
  }
  if (after.unparsable) return out; // a file Claude Code cannot load sets nothing; nothing to restore safely
  const b = before && !before.unparsable ? before : { temp: {}, plugins: {}, guard: {} };
  for (const [k, v] of Object.entries(after.temp)) if (!Object.prototype.hasOwnProperty.call(b.temp, k) || JSON.stringify(b.temp[k]) !== JSON.stringify(v)) out.push({ type: 'temp', name: k, key: k, value: b.temp[k] });
  for (const k of new Set([...Object.keys(b.plugins), ...Object.keys(after.plugins)])) {
    const was = b.plugins[k];
    const now = after.plugins[k];
    if ((now === false && was !== false) || (was === true && now === undefined)) out.push({ type: 'plugin', name: k, plugin: k, value: was });
  }
  for (const [ev, entries] of Object.entries(b.guard)) {
    const nowEntries = (after.guard[ev] || []).map((e) => JSON.stringify(e));
    const missing = entries.filter((e) => !nowEntries.includes(JSON.stringify(e)));
    if (missing.length) out.push({ type: 'plugin', name: 'the user-level setup guard hook', event: ev, entries: missing });
  }
  return out;
}

// Put the changes back in place: only those keys (JSON) or lines (text); the rest of the file stays.
function restore(file, kind, changes) {
  const text = readText(file);
  if (text === null) return false;
  if (kind === 'env') {
    const drop = new Set(changes.map((c) => c.line));
    const kept = text.split('\n').filter((l) => !drop.has(l.replace(/\r$/, '')));
    writeAtomic(file, kept.join('\n'));
    return true;
  }
  const j = JSON.parse(text);
  for (const c of changes) {
    if (c.key) {
      if (c.value === undefined) delete j.env[c.key]; else j.env[c.key] = c.value;
      if (j.env && !Object.keys(j.env).length) delete j.env;
    } else if (c.plugin) {
      j.enabledPlugins = j.enabledPlugins && typeof j.enabledPlugins === 'object' ? j.enabledPlugins : {};
      if (c.value === undefined) delete j.enabledPlugins[c.plugin]; else j.enabledPlugins[c.plugin] = c.value;
    } else if (c.event) {
      j.hooks = j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
      j.hooks[c.event] = [...(Array.isArray(j.hooks[c.event]) ? j.hooks[c.event] : []), ...c.entries];
    }
  }
  writeAtomic(file, `${JSON.stringify(j, null, 2)}\n`);
  return true;
}

const keyOf = (input) => {
  const sid = String(input.session_id || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const tid = input.tool_use_id ? String(input.tool_use_id) : crypto.createHash('sha256').update(JSON.stringify([input.tool_name, input.tool_input])).digest('hex').slice(0, 16);
  return `${sid}-${tid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}.json`;
};

// Before the tool: the guarded files' state, saved for the after-check. Stale snapshots (a tool whose
// after-hook never ran) are removed here.
function beforeTool(input, { home, env = process.env, roots = [] } = {}) {
  const dir = stateDir({ home, env });
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const n of list(dir)) { try { const f = path.join(dir, n); if (now - fs.statSync(f).mtimeMs > STALE_MS) fs.rmSync(f, { force: true }); } catch (e) { /* gone */ } }
  const file = path.join(dir, keyOf(input));
  writeAtomic(file, JSON.stringify(snapshot(guardedFiles({ home, env, cwd: input.cwd, roots }))));
  return file;
}

// After the tool: null, or { reason, reverted: [file] } once the changes were put back.
function afterTool(input, { home, env = process.env, records = [] } = {}) {
  const file = path.join(stateDir({ home, env }), keyOf(input));
  const snap = readJson(file);
  try { fs.rmSync(file, { force: true }); } catch (e) { /* the other copy of the guard took it */ }
  if (!snap) return null;
  const found = [];
  for (const [f, { kind, state }] of Object.entries(snap)) {
    const changes = changesOf(kind, state, stateOf(kind, readText(f)));
    if (changes.length) found.push({ file: f, kind, changes });
  }
  if (!found.length) return null;
  const reverted = [];
  const failed = [];
  for (const x of found) { try { if (restore(x.file, x.kind, x.changes)) reverted.push(x.file); else failed.push(x.file); } catch (e) { failed.push(x.file); } }
  const all = S.usableRecords(records);
  const first = found[0];
  const c = first.changes.find((y) => y.type === 'temp') || first.changes[0];
  const base = c.type === 'temp' ? S.tempReason(c.name, first.file, all) : S.pluginReason(c.name, first.file, all);
  const done = reverted.length ? ` It was reverted: ${reverted.map((f) => `${f} (${found.find((y) => y.file === f).changes.map((y) => y.name).join(', ')})`).join('; ')}.` : '';
  const left = failed.length ? ` It could not be reverted in ${failed.join(', ')}.` : '';
  return { reason: `${base}${done}${left}`, reverted, failed };
}

module.exports = { guardedFiles, roleDirsOf, stateOf, snapshot, changesOf, restore, beforeTool, afterTool, stateDir, keyOf };
