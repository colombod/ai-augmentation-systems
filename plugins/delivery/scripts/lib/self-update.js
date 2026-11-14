// scripts/lib/self-update.js — the watchdog's host job installs the plugin the team's gate merged
// (delivery-plugin-planning-0ba). After every merge someone had to run `claude plugin marketplace update`
// and `claude plugin update` on the host and restart the roles: the owner was the installer. Each `run`
// pass now reads the product's main from the marketplace's own clone and installs it when:
//   - main's plugin version is newer than the job's own install, or than a role directory's install
//     while the job's own is current (one a failed or partial pass left behind catches up later);
//   - every commit that changed the plugin since the installed one is the merge commit of a pull
//     request the Delivery Manager recorded as merged through the gate, for the marketplace's repository
//     (an ungated commit in the range would ride into the install under the gated version: refused).
//     The "(#N)" in the subject only says which record to read; anyone can type it, so the commit must
//     equal that record's merge_commit (or, for a row written before merge_commit was recorded,
//     GitHub's merge commit for the pull request). A subject with no "(#N)" (a squash merge whose
//     title ends "(Refs <bead>)") asks GitHub which merged pull request has exactly this merge commit,
//     then reads that record the same way; with no answer, refused. The installed sha must be known to
//     the clone, or the range cannot be read: refused, never guessed;
//   - no wake is running (its session loaded the old plugin; installing under it is the run in
//     progress the bead forbids): held, tried again next cycle, for every install. A held pass says so
//     (`held`), and the job starts no new wake while it is: wakes ran back to back on wintermute, so some
//     wake was always running when the job looked and merged releases sat uninstalled for hours
//     (delivery-plugin-planning-0ba.6). The running wakes end (the wake timeout bounds them) and the
//     next look installs.
// Each install (the job's own and each role directory's) is decided on its own range and goes when it
// passes: an old role install refused over its range never blocks the others (seen on wintermute: role
// installs at 0.41.2 held every install back at 0.43.39). A role install is always checked over its own
// range, never the job's: what the job's install carries proves nothing about the commits below it (a
// hand push under a later gated install would ride into an older role install).
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
const { sameRepo, repoOf } = require('./gh-pr.js');

const RETRY_MS = 3600e3;
// how long an install may be held: no new wake starts while it is, so the longest it can wait is the
// wake timeout (the supervisor stops a wake then) and the next cycle. A hold past it means a wake outlived
// its supervisor's stop; it is logged once (`held-overdue`) and the owner briefing reports it
// (delivery-plugin-planning-0ba.5)
const HOLD_BOUND_MS = WD.WAKE_TIMEOUT_H * 3600e3 + 30 * 60e3;
const EXEC_TIMEOUT_MS = 5 * 60e3;
const GH_TIMEOUT_MS = 30e3;
const PR_OF = /\(#(\d+)\)\s*$/;

const pluginsDir = (configDir) => path.join(configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { return null; } };
const same = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b);
const entriesOf = (j, key) => { const v = j && (j.plugins || j)[key]; return (Array.isArray(v) ? v : v ? [v] : []).filter((e) => e && typeof e === 'object'); };

// The installs of plugin `name` this machine records now, as { key, target, version }: the key is the
// record's '<name>@<marketplace>', so a refusal is matched to its own marketplace's install only (a
// same-named plugin from another marketplace never ends it, rv-167-delivery-lead-14); the target as
// selfUpdate names it ('user', or '<scope> <path>'), the version the record says it is at (null when it
// names none). null when the record cannot be read. A refusal for an install that is gone (the Delivery
// Manager had it removed), or that is at the refused version or newer (updated outside the job, by
// `claude plugin update`, so the job writes no installed row for it), no longer stands (watchdog.js
// refusedInstalls, rv-167)
function installTargets(name, configDir) {
  const j = readJson(path.join(pluginsDir(configDir), 'installed_plugins.json'));
  if (!j || typeof j !== 'object') return null;
  const keys = Object.keys(j.plugins || j).filter((k) => k.split('@')[0] === name);
  return keys.flatMap((k) => entriesOf(j, k).map((e) => ({ key: k, target: !e.scope || e.scope === 'user' ? 'user' : `${e.scope} ${e.projectPath}`, version: typeof e.version === 'string' && e.version ? e.version : null })));
}

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
  const src = m.source || {};
  return { ...hit, name, marketplace, clone: m.installLocation || null, repo: src.repo || repoOf(src.url) || null };
}

const git = (clone, args) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60e3 }).trim();
const commitsOf = (out) => out.split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\0'); const m = PR_OF.exec(subject || ''); return { sha, pr: m ? Number(m[1]) : null }; });

// Main as the remote has it, without touching the clone's checkout: its sha, the plugin's version there
// and the commits that changed the plugin since `base` (the installed sha). `known` is false when the
// clone does not know `base`: the commits since it cannot be listed, and decide refuses.
function readMain(clone, name, base) {
  git(clone, ['fetch', '--quiet', 'origin']);
  let ref = 'origin/HEAD';
  try { git(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch (err) { ref = 'origin/main'; }
  const sha = git(clone, ['rev-parse', `${ref}^{commit}`]);
  let src = `plugins/${name}`;
  try { const p = (JSON.parse(git(clone, ['show', `${sha}:.claude-plugin/marketplace.json`])).plugins || []).find((x) => x.name === name); if (p && typeof p.source === 'string') src = p.source.replace(/^\.\//, '').replace(/\/$/, ''); } catch (err) { /* the conventional layout */ }
  const manifest = `${src}/.claude-plugin/plugin.json`;
  const version = JSON.parse(git(clone, ['show', `${sha}:${manifest}`])).version;
  return { sha, version, src, ...rangeFrom(clone, src, base, sha) };
}

// Claude Code keeps the marketplace clone shallow (depth 1): after an install it holds main's tip and
// nothing behind it, so the installed sha was never in it and every update was refused (seen on wintermute,
// 0.43.36 to 0.43.37). A shallow clone is deepened, in bounded steps, until it holds `base`; a sha that is
// still missing after the last step stays unknown, and decide refuses as before.
const DEEPEN_STEPS = [50, 200, 1000];
function holdsBase(clone, base) {
  if (!/^[0-9a-f]{7,40}$/.test(String(base))) return false;
  const has = () => { try { git(clone, ['cat-file', '-e', `${base}^{commit}`]); return true; } catch (err) { return false; } };
  if (has()) return true;
  let shallow = false;
  try { shallow = git(clone, ['rev-parse', '--is-shallow-repository']) === 'true'; } catch (err) { shallow = false; }
  if (!shallow) return false;
  for (const n of DEEPEN_STEPS) {
    try { git(clone, ['fetch', '--quiet', `--deepen=${n}`, 'origin']); } catch (err) { return false; }
    if (has()) return true;
  }
  return false;
}

// the commits that changed the plugin from `base` to `sha`, or known false when the clone lacks `base`
function rangeFrom(clone, src, base, sha) {
  const known = holdsBase(clone, base);
  const commits = known ? commitsOf(git(clone, ['log', '--format=%H%x00%s', `${base}..${sha}`, '--', src])) : [];
  return { known, commits };
}

// Is commit `sha` the gated merge of pull request `pr`: a merged row the Delivery Manager wrote (only it
// runs merge-gate.js merged) for the marketplace's repository, gated true, whose merge commit is `sha`.
// A row from before merge_commit was recorded asks GitHub (`mergeCommitOf`); with no answer, refused.
function gatedMerge(root, pr, repo, sha, mergeCommitOf = () => null) {
  if (!repo) return { ok: false, why: 'the marketplace names no GitHub repository, so its merges cannot be matched to the gate' };
  const r = R.read(root, pr);
  if (r.problem) return { ok: false, why: r.problem };
  const m = r.rows.filter((x) => x.type === 'merged' && x.by === 'delivery-lead' && sameRepo(x.repo, repo)).pop();
  if (!m) return { ok: false, why: `PR ${pr} has no merged row by the Delivery Manager for ${repo} in the team's review record` };
  if (m.gated !== true) return { ok: false, why: `PR ${pr} was merged without passing the team's gate` };
  const mc = m.merge_commit || mergeCommitOf(pr);
  if (!mc) return { ok: false, why: `PR ${pr}'s merge commit is not recorded and GitHub did not say it, so commit ${sha.slice(0, 12)} cannot be matched to it` };
  return mc === sha ? { ok: true } : { ok: false, why: `commit ${sha.slice(0, 12)} names PR ${pr} but is not its merge (${String(mc).slice(0, 12)})` };
}

// The pull request GitHub says commit `sha` is the merge of, or null: merged, and its merge commit is
// exactly `sha` (a pull request that merely contains the commit is not its merge). Bounded, never throws.
const ghPrOfCommit = (exec, repo, cwd) => (sha) => {
  if (!repo) return null;
  try {
    const list = JSON.parse(String(exec('gh', ['api', `repos/${repo}/commits/${sha}/pulls`], { cwd, timeout: GH_TIMEOUT_MS }) || '[]'));
    const p = (Array.isArray(list) ? list : []).find((x) => x && x.merged_at && x.merge_commit_sha === sha && Number.isInteger(x.number));
    return p ? p.number : null;
  } catch (err) { return null; }
};

// GitHub's merge commit for a pull request, or null: bounded, and never throws
const ghMergeCommit = (exec, repo, cwd) => (pr) => {
  try {
    const out = String(exec('gh', ['api', `repos/${repo}/pulls/${pr}`, '--jq', '.merge_commit_sha'], { cwd, timeout: GH_TIMEOUT_MS }) || '').trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch (err) { return null; }
};

// The decision, pure: { action: 'none' | 'install' | 'held' | 'refuse', why, pr }. `prOf(sha)` names the
// pull request GitHub merged as a commit whose subject names none; gatedOf(pr, sha, true) is then told
// GitHub already matched that pull request's merge commit to `sha`.
function decide({ installed, main, gatedOf, running, prOf = () => null }) {
  const c = compare(main.version, installed);
  if (c !== 1) return { action: 'none', why: c === null ? `unreadable version (${main.version} vs ${installed})` : `main carries ${main.version}, installed ${installed}` };
  if (!main.known) return { action: 'refuse', why: 'the installed sha is not known, so the commits since it cannot be checked', pr: null };
  if (!main.commits.length) return { action: 'refuse', why: 'no commit on main changed the plugin since the installed one', pr: null };
  const prs = [];
  for (const k of main.commits) {
    const pr = k.pr || prOf(k.sha);
    if (!pr) return { action: 'refuse', why: `commit ${k.sha.slice(0, 12)} names no pull request and GitHub names none`, pr: null };
    const g = gatedOf(pr, k.sha, !k.pr);
    if (!g.ok) return { action: 'refuse', why: g.why, pr };
    prs.push(pr);
  }
  const pr = prs[0];
  if (running.length) return { action: 'held', why: `a run is in progress (wake pid ${running.join(', ')})`, pr };
  return { action: 'install', why: `gated through PR ${prs.filter((x, i, a) => a.indexOf(x) === i).join(', PR ')}`, pr };
}

const defaultExec = (bin, args, { cwd, timeout = EXEC_TIMEOUT_MS }) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
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
    // logRows reads the current log and the one rotation kept; a wake older than both (over 2 MB of
    // rows ago) is not seen, which the wake timeout makes moot: such a wake has long been stopped
    // each pid is asked about with its own row's time, so a pid the system gave to another program
    // after its wake ended holds nothing (hjx.1.6.20)
    // (once per pid, with its newest row: a pid reused by a later wake is asked about as that wake)
    const newest = new Map();
    for (const r of WD.logRows(root)) if (r.type === 'wake' && r.pid) newest.set(r.pid, r.at);
    const running = [...newest].filter(([pid, at]) => alive(pid, at)).map(([pid]) => pid);
    const mergeCommitOf = ghMergeCommit(exec, own.repo, root);
    const prOf = ghPrOfCommit(exec, own.repo, root);
    // a pull request found by its merge commit was matched to `sha` by GitHub already; a recorded
    // merge_commit still has to agree with it. `() => sha` stands for GitHub's merge commit only because
    // ghPrOfCommit returns a pull request solely when its merge_commit_sha equals `sha` exactly: loosen
    // that match and this must pass GitHub's merge_commit_sha through instead
    const gatedOf = (pr, sha, byCommit) => gatedMerge(root, pr, own.repo, sha, byCommit ? () => sha : mergeCommitOf);
    const vs = compare(main.version, own.entry.version);
    const ownBehind = vs === 1;
    // role directories behind main: looked for on every pass, not only when the job's own install is,
    // so one a failed or partial pass left on the old version (or that was not there then) catches up
    const others = entriesOf(readJson(path.join(pluginsDir(configDir || env.CLAUDE_CONFIG_DIR), 'installed_plugins.json')), own.key)
      .filter((e) => (vs === 0 || vs === 1) && e !== own.entry && e.projectPath && roleDirs.some((r) => same(r, e.projectPath)) && compare(main.version, e.version) === 1 && !(same(e.projectPath, own.entry.projectPath) && e.scope === own.entry.scope));
    // each install passes the same gate check, over the commits since its own installed sha
    const rangeOf = (e) => (e === own.entry ? main : { ...main, ...rangeFrom(own.clone, main.src, e.gitCommitSha, main.sha) });
    const entries = [...(ownBehind ? [own.entry] : []), ...others];
    if (!entries.length) return { lines: [], installed: false };
    // each install is decided on its own: one refused never blocks another that passes
    const checks = entries.map((e) => ({ e, d: decide({ installed: e.version, main: rangeOf(e), gatedOf, running, prOf }) }));
    const label = `plugin ${own.name} ${main.version} (main ${main.sha.slice(0, 12)})`;
    const targetOf = (e) => (!e.scope || e.scope === 'user' ? 'user' : `${e.scope} ${e.projectPath}`);
    const forOf = (e) => (e === own.entry ? '' : ` (for ${targetOf(e)})`);
    const refusals = [];
    for (const { e, d } of checks.filter((c) => c.d.action === 'refuse')) {
      const target = targetOf(e);
      // once per version and install: a refusal that stands is not news every fifteen minutes (a row
      // from before targets were recorded counts as the job's own)
      if (!dryRun && !rows.some((r) => r.result === 'refused' && (r.target || targetOf(own.entry)) === target)) WD.log(root, { type: 'self-update', from: e.version, version: main.version, sha: main.sha, pr: d.pr, scope: e.scope, target, key: own.key, at, result: 'refused', why: d.why });
      refusals.push(`self-update: ${label} refused: ${d.why}${forOf(e)}.`);
    }
    // a running wake holds every install that passed: its session loaded the old plugin
    const held = checks.find((c) => c.d.action === 'held');
    if (held) {
      // the hold's start is logged once per hold, so its age is read from the log, not this process; an
      // install tried since (failed or not) ended the hold before, so each hold is timed from its own start
      const tried = rows.findLastIndex((r) => ['failed', 'installed', 'ungated-install'].includes(r.result));
      const current = rows.slice(tried + 1);
      const since = current.find((r) => r.result === 'held');
      const base = { type: 'self-update', from: held.e.version, version: main.version, sha: main.sha, pr: held.d.pr, at };
      if (!since && !dryRun) WD.log(root, { ...base, result: 'held', why: held.d.why });
      const age = since ? Date.parse(at) - Date.parse(since.at) : 0;
      const overdue = age > HOLD_BOUND_MS;
      if (overdue && !dryRun && !current.some((r) => r.result === 'held-overdue')) WD.log(root, { ...base, result: 'held-overdue', since: since.at, why: held.d.why });
      const line = overdue
        ? `self-update: ${label} held since ${since.at} (over ${Math.floor(age / 3600e3)} h, past the ${HOLD_BOUND_MS / 3600e3} h bound): ${held.d.why}, a wake that outlived its timeout; tried again next cycle.`
        : `self-update: ${label} held: ${held.d.why}; tried again next cycle.`;
      return { lines: [line, ...refusals], installed: false, held: label };
    }
    const go = checks.filter((c) => c.d.action === 'install');
    if (!go.length) return { lines: refusals, installed: false };
    const { e: first, d } = go[0];
    const ownGo = go.some((c) => c.e === own.entry);
    const goOthers = go.map((c) => c.e).filter((e) => e !== own.entry);
    const row = { type: 'self-update', from: first.version, version: main.version, sha: main.sha, pr: d.pr, scope: first.scope, at };
    const failed = rows.filter((r) => r.result === 'failed').pop();
    if (failed && Date.parse(at) - Date.parse(failed.at) < RETRY_MS) return { lines: [`self-update: ${label} failed at ${failed.at}; tried again an hour after.`, ...refusals], installed: false };
    const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
    const key = `${own.name}@${own.marketplace}`;
    const targets = go.map(({ e }) => ({ scope: e.scope || 'user', cwd: e.projectPath && e.scope !== 'user' ? e.projectPath : root }));
    if (dryRun) return { lines: [`self-update: would install ${label} (${d.why}) for ${targets.map((t) => (t.scope === 'user' ? 'user' : `${t.scope} ${t.cwd}`)).join(', ')}.`, ...refusals], installed: false };
    let detail = '';
    try {
      exec(bin, ['plugin', 'marketplace', 'update', own.marketplace], { cwd: root });
      for (const t of targets) exec(bin, ['plugin', 'update', key, '--scope', t.scope], { cwd: t.cwd });
    } catch (err) { detail = brief(err); }
    // the update's word is not the proof: the installed record must carry main's version afterwards
    const after = entriesOf(readJson(path.join(pluginsDir(configDir || env.CLAUDE_CONFIG_DIR), 'installed_plugins.json')), own.key);
    const now0 = after.find((e) => e.scope === own.entry.scope && (e.projectPath || null) === (own.entry.projectPath || null));
    // main may have moved between the fetch and the update: the install then changed to a commit nobody
    // checked against the gate. Recorded and warned about, never reported installed or kicked; this is
    // looked at first, since a newer version than the checked one is that case too, not a failure
    const got = (now0 && now0.gitCommitSha) || null;
    const untouched = now0 && now0.version === own.entry.version && got === (own.entry.gitCommitSha || null);
    if (ownGo && now0 && !untouched && got !== main.sha) {
      const why = `installed ${got ? got.slice(0, 12) : 'an unrecorded sha'}, not the checked ${main.sha.slice(0, 12)}: main moved during the update`;
      WD.log(root, { ...row, result: 'ungated-install', version: now0.version, sha: got, checked: main.sha, detail: why });
      const w = require('./warnings.js').record(root, { kind: 'install-ungated', rule: 'R-32', bead: null, detail: `plugin ${own.name} ${now0.version}: ${why}`, raisedBy: 'watchdog', instance: 'watchdog', now: at });
      return { lines: [`self-update: warning ${w ? w.id : 'unrecorded'}: ${label} ${why}; what it carries was not checked against the gate.`, ...refusals], installed: false };
    }
    if (!detail && ownGo && (!now0 || now0.version !== main.version)) detail = `the install still records ${now0 ? now0.version : 'nothing'} after the update`;
    const behind = goOthers.filter((o) => !after.some((e) => same(e.projectPath, o.projectPath) && e.scope === o.scope && e.version === main.version)).map((o) => o.projectPath);
    if (!detail && behind.length) detail = `still on the old version: ${behind.join(', ')}`;
    if (detail) {
      WD.log(root, { ...row, result: 'failed', detail });
      return { lines: [`self-update: ${label} failed: ${detail}.`, ...refusals], installed: false };
    }
    // the installs it covers by name: a refusal standing for one of them ends here (watchdog.js refusedInstalls)
    WD.log(root, { ...row, result: 'installed', sha: ownGo ? got : main.sha, targets: go.map((c) => targetOf(c.e)), detail: `${d.why}; ${targets.length} install(s)` });
    return { lines: [`self-update: installed ${label}, ${d.why}.`, ...refusals], installed: true, version: main.version };
  } catch (err) {
    return { lines: [`self-update: not checked (${brief(err)}); the wakes go on.`], installed: false };
  }
}

module.exports = { RETRY_MS, HOLD_BOUND_MS, installTargets, findInstall, readMain, gatedMerge, decide, selfUpdate };
