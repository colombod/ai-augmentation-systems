// scripts/lib/self-update.js — the watchdog's host job installs the plugin the team's gate merged
// (delivery-plugin-planning-0ba). After every merge someone had to run `claude plugin marketplace update`
// and `claude plugin update` on the host and restart the roles: the owner was the installer. Each `run`
// pass now reads the product's main from the marketplace's own clone and installs it when:
//   - main's plugin version is newer than the job's own install (same or older: nothing);
//   - every commit that changed the plugin since the installed one names its pull request "(#N)" and
//     that pull request has a merged row with gated true in the project's review record (an ungated
//     commit in the range would ride into the install under the gated version: refused);
//   - no wake is running (its session loaded the old plugin; installing under it is the run in
//     progress the bead forbids): held, tried again next cycle.
// Main is read with `git fetch` only: `claude plugin marketplace update` runs after the gate passed,
// since a refreshed catalog would make an ungated version installable by hand. A development checkout
// (not an install) is never updated. Failures are logged and retried at most once an hour; nothing here
// throws into the watchdog, so a failed update never stops the wakes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const WD = require('./watchdog.js');
const R = require('./reviews.js');
const { compare } = require('./plugin-version.js');
const { resolveInstalledRoot } = require('./launcher.js');

const RETRY_MS = 3600e3;
const EXEC_TIMEOUT_MS = 5 * 60e3;
const PR_OF = /\(#(\d+)\)\s*$/;

const pluginsDir = (configDir) => path.join(configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { return null; } };
const same = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b);
const entriesOf = (j, key) => { const v = j && (j.plugins || j)[key]; return (Array.isArray(v) ? v : v ? [v] : []).filter((e) => e && typeof e === 'object'); };

// The job's own install: the entry whose installPath is the running plugin root, else the one the job
// shim would run for this project. null for a development checkout, which nobody installs.
function findInstall(pluginRoot, project, configDir) {
  const dir = pluginsDir(configDir);
  if (!path.resolve(pluginRoot).startsWith(path.join(dir, 'cache') + path.sep)) return null;
  const j = readJson(path.join(dir, 'installed_plugins.json'));
  const keys = Object.keys((j && (j.plugins || j)) || {}).filter((k) => /^[^@]+@[^@]+$/.test(k));
  const pick = (root) => { for (const key of keys) { const e = entriesOf(j, key).find((x) => same(x.installPath, root)); if (e) return { key, entry: e }; } return null; };
  const hit = pick(pluginRoot) || pick(resolveInstalledRoot({ project, atInstall: pluginRoot, configDir: path.dirname(dir) }));
  if (!hit) return null;
  const [name, marketplace] = hit.key.split('@');
  const m = (readJson(path.join(dir, 'known_marketplaces.json')) || {})[marketplace] || {};
  return { ...hit, name, marketplace, clone: m.installLocation || null, repo: (m.source && m.source.repo) || null };
}

const git = (clone, args) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60e3 }).trim();
const commitsOf = (out) => out.split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\0'); const m = PR_OF.exec(subject || ''); return { sha, pr: m ? Number(m[1]) : null }; });

// Main as the remote has it, without touching the clone's checkout: its sha, the plugin's version there
// and the commits that changed the plugin since `base` (the installed sha; when the clone does not know
// it, the last commit to the plugin and the one that set the version).
function readMain(clone, name, base) {
  git(clone, ['fetch', '--quiet', 'origin']);
  let ref = 'origin/HEAD';
  try { git(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch (err) { ref = 'origin/main'; }
  const sha = git(clone, ['rev-parse', `${ref}^{commit}`]);
  let src = `plugins/${name}`;
  try { const p = (JSON.parse(git(clone, ['show', `${sha}:.claude-plugin/marketplace.json`])).plugins || []).find((x) => x.name === name); if (p && typeof p.source === 'string') src = p.source.replace(/^\.\//, '').replace(/\/$/, ''); } catch (err) { /* the conventional layout */ }
  const manifest = `${src}/.claude-plugin/plugin.json`;
  const version = JSON.parse(git(clone, ['show', `${sha}:${manifest}`])).version;
  let known = false;
  try { git(clone, ['cat-file', '-e', `${base}^{commit}`]); known = /^[0-9a-f]{7,40}$/.test(String(base)); } catch (err) { known = false; }
  const commits = known
    ? commitsOf(git(clone, ['log', '--format=%H%x00%s', `${base}..${sha}`, '--', src]))
    : [...commitsOf(git(clone, ['log', '-1', '--format=%H%x00%s', sha, '--', src])), ...commitsOf(git(clone, ['log', '-1', '--format=%H%x00%s', sha, '--', manifest]))];
  return { sha, version, commits: commits.filter((c, i) => commits.findIndex((x) => x.sha === c.sha) === i) };
}

// Is pull request `pr` merged through the gate: a merged row with gated true (for the same repository
// when both name one).
function gatedMerge(root, pr, repo) {
  const r = R.read(root, pr);
  if (r.problem) return { ok: false, why: r.problem };
  const m = r.rows.filter((x) => x.type === 'merged' && (!repo || !x.repo || String(x.repo).toLowerCase() === String(repo).toLowerCase())).pop();
  if (!m) return { ok: false, why: `PR ${pr} has no merged row in the team's review record` };
  return m.gated === true ? { ok: true } : { ok: false, why: `PR ${pr} was merged without passing the team's gate` };
}

// The decision, pure: { action: 'none' | 'install' | 'held' | 'refuse', why, pr }.
function decide({ installed, main, gatedOf, running }) {
  const c = compare(main.version, installed);
  if (c !== 1) return { action: 'none', why: c === null ? `unreadable version (${main.version} vs ${installed})` : `main carries ${main.version}, installed ${installed}` };
  if (!main.commits.length) return { action: 'refuse', why: 'no commit on main changed the plugin since the installed one', pr: null };
  for (const k of main.commits) {
    if (!k.pr) return { action: 'refuse', why: `commit ${k.sha.slice(0, 12)} names no pull request`, pr: null };
    const g = gatedOf(k.pr);
    if (!g.ok) return { action: 'refuse', why: g.why, pr: k.pr };
  }
  const pr = main.commits[0].pr;
  if (running.length) return { action: 'held', why: `a run is in progress (wake pid ${running.join(', ')})`, pr };
  return { action: 'install', why: `gated through PR ${main.commits.map((k) => k.pr).filter((x, i, a) => a.indexOf(x) === i).join(', PR ')}`, pr };
}

const defaultExec = (bin, args, { cwd }) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: EXEC_TIMEOUT_MS });
const brief = (err) => String((err && (err.stderr || err.message)) || err).trim().split('\n').pop().slice(0, 200);

// One pass: returns { lines, installed } and never throws. `roleDirs` are the team's role directories:
// a local or project install there is what that role's session loads, so it is updated too, or the role
// would stay on the old version after its fresh wake (criterion c).
function selfUpdate(root, { pluginRoot, configDir, env = process.env, exec = defaultExec, now, dryRun = false, alive = WD.pidAlive, roleDirs = [] } = {}) {
  const at = now || new Date().toISOString();
  try {
    const own = findInstall(pluginRoot, root, configDir || env.CLAUDE_CONFIG_DIR);
    if (!own || !own.clone) return { lines: [], installed: false };
    const main = readMain(own.clone, own.name, own.entry.gitCommitSha);
    const rows = WD.logRows(root).filter((r) => r.type === 'self-update' && r.version === main.version);
    const running = [...new Set(WD.logRows(root).filter((r) => r.type === 'wake').map((r) => r.pid))].filter((pid) => alive(pid));
    const d = decide({ installed: own.entry.version, main, gatedOf: (pr) => gatedMerge(root, pr, own.repo), running });
    const label = `plugin ${own.name} ${main.version} (main ${main.sha.slice(0, 12)})`;
    if (d.action === 'none') return { lines: [], installed: false };
    if (d.action === 'held') return { lines: [`self-update: ${label} held: ${d.why}; tried again next cycle.`], installed: false };
    const row = { type: 'self-update', from: own.entry.version, version: main.version, sha: main.sha, pr: d.pr, scope: own.entry.scope, at };
    if (d.action === 'refuse') {
      // once per version: a refusal that stands is not news every fifteen minutes
      if (!dryRun && !rows.some((r) => r.result === 'refused')) WD.log(root, { ...row, result: 'refused', why: d.why });
      return { lines: [`self-update: ${label} refused: ${d.why}.`], installed: false };
    }
    const failed = rows.filter((r) => r.result === 'failed').pop();
    if (failed && Date.parse(at) - Date.parse(failed.at) < RETRY_MS) return { lines: [`self-update: ${label} failed at ${failed.at}; tried again an hour after.`], installed: false };
    const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
    const key = `${own.name}@${own.marketplace}`;
    const others = entriesOf(readJson(path.join(pluginsDir(configDir || env.CLAUDE_CONFIG_DIR), 'installed_plugins.json')), own.key)
      .filter((e) => e !== own.entry && e.projectPath && roleDirs.some((r) => same(r, e.projectPath)) && compare(main.version, e.version) === 1 && !(same(e.projectPath, own.entry.projectPath) && e.scope === own.entry.scope));
    const targets = [own.entry, ...others].map((e) => ({ scope: e.scope || 'user', cwd: e.projectPath && e.scope !== 'user' ? e.projectPath : root }));
    if (dryRun) return { lines: [`self-update: would install ${label} (${d.why}) for ${targets.map((t) => (t.scope === 'user' ? 'user' : `${t.scope} ${t.cwd}`)).join(', ')}.`], installed: false };
    let detail = '';
    try {
      exec(bin, ['plugin', 'marketplace', 'update', own.marketplace], { cwd: root });
      for (const t of targets) exec(bin, ['plugin', 'update', key, '--scope', t.scope], { cwd: t.cwd });
    } catch (err) { detail = brief(err); }
    // the update's word is not the proof: the installed record must carry main's version afterwards
    const after = entriesOf(readJson(path.join(pluginsDir(configDir || env.CLAUDE_CONFIG_DIR), 'installed_plugins.json')), own.key);
    const now0 = after.find((e) => e.scope === own.entry.scope && (e.projectPath || null) === (own.entry.projectPath || null));
    if (!detail && (!now0 || now0.version !== main.version)) detail = `the install still records ${now0 ? now0.version : 'nothing'} after the update`;
    const behind = others.filter((o) => !after.some((e) => same(e.projectPath, o.projectPath) && e.scope === o.scope && e.version === main.version)).map((o) => o.projectPath);
    if (!detail && behind.length) detail = `still on the old version: ${behind.join(', ')}`;
    if (detail) {
      WD.log(root, { ...row, result: 'failed', detail });
      return { lines: [`self-update: ${label} failed: ${detail}.`], installed: false };
    }
    WD.log(root, { ...row, result: 'installed', sha: (now0 && now0.gitCommitSha) || main.sha, detail: `${d.why}; ${targets.length} install(s)` });
    return { lines: [`self-update: installed ${label}, ${d.why}.`], installed: true, version: main.version };
  } catch (err) {
    return { lines: [`self-update: not checked (${brief(err)}); the wakes go on.`], installed: false };
  }
}

module.exports = { RETRY_MS, findInstall, readMain, gatedMerge, decide, selfUpdate };
