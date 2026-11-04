// scripts/lib/product-view.js — the work in flight of each product, read only from records that exist:
// beads (bd), the product repository's open pull requests (gh), the Claude Code install record
// (installed_plugins.json, read the way lib/self-update.js and lib/launcher.js read it), the evidence
// ledger (the done gate evidence.js check applies), the owner queue and the open operator questions.
// It writes nothing, reads no message and keeps no store of its own.
//
// readProduct(root, deps) returns one product's view; readProducts(roots, deps) returns every product's
// view, sorted by product name, so the same records always give the same structure. A source that cannot
// be read is never an empty section: it is named in `unavailable` ({ source, section, why }), and the
// sections it feeds are left null.
//
// deps (each optional; the tests pass fakes):
//   loadTeam(root)          -> team.json object (default lib/manifest.js loadManifest)
//   bdFor(root, team)       -> a lib/bd.js store for that product (default makeBd with that product's BEADS_DIR)
//   gh(args, { cwd })       -> { status, stdout, stderr, error } (default spawnSync('gh', args))
//   git(args)               -> { status, stdout } (default spawnSync('git', args)), for the install's ancestry
//   readFile(path)          -> string (default fs.readFileSync utf8), for the install record
//   configDir               -> where Claude Code keeps its plugins directory (default: the user's)
//   ownerSteps(root)        -> open owner-queue steps (default lib/owner-queue.js open)
//   questions(root)         -> open operator questions (default lib/daily-plan.js ownerQuestions)
//   checkOf(root, bead, ctx)-> the done gate's verdict ({ ok, criteria: [{ n, row|waiver|why }], problem?, empty?, cut? })
//   verifyRecord            -> passed to the done gate's owner-record check
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const OPEN_STATUSES = ['in_progress', 'blocked', 'open'];
const SECTIONS = ['open', 'reviews', 'notInstalled', 'unchecked', 'blockers'];
const SECTION_NAMES = { open: 'open work', reviews: 'in review', notInstalled: 'merged, not installed', unchecked: 'installed, not checked', blockers: 'blockers and owner questions' };

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const firstLine = (x) => String((x && x.message) || x || '').trim().split('\n')[0].slice(0, 200);
const prNumber = (v) => { const m = /(\d+)\s*$/.exec(String(v === undefined || v === null ? '' : v)); return m ? Number(m[1]) : null; };
function claudeHome(env) { return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : path.resolve(os.homedir(), '.claude'); }

function defaultBdFor(root) {
  // a role session's BEADS_DIR names its own project; each product reads its own database
  const e = { ...process.env };
  const own = path.join(root, '.beads');
  if (fs.existsSync(own)) e.BEADS_DIR = own; else delete e.BEADS_DIR;
  return require('./bd.js').makeBd({ cwd: root, env: e, timeoutMs: 30000 });
}

function defaultGh(args, { cwd } = {}) {
  try { return spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); } catch (err) { return { status: null, error: err }; }
}

function defaultGit(args) {
  try { return spawnSync('git', args, { encoding: 'utf8', timeout: 10000 }); } catch (err) { return { status: null, error: err }; }
}

function defaultCheckOf(root, bead, { bd, team, verifyRecord }) {
  const C = require('./gate-context.js');
  const inp = { ...C.gateInputs(root, bead, { bd, team }), recordOk: C.recordChecker(root, verifyRecord) };
  return require('../evidence.js').done(bead, inp);
}

// ---- the install record ----

// { key, version, sha, clone, file } for the product's install, or { unavailable }. The product's plugins
// are those of the marketplace whose source repository is team.product_github; team.product_plugin, when
// set, names the plugin. Among the entries the one local to the project wins, then the user's, then the
// newest version (lib/launcher.js resolveInstalledRoot's ranking).
function installOf(root, team, { readFile, configDir }) {
  const { sameRepo, repoOf } = require('./gh-pr.js');
  const { compare } = require('./plugin-version.js');
  const dir = path.join(configDir, 'plugins');
  const file = path.join(dir, 'installed_plugins.json');
  let raw;
  try { raw = readFile(file); } catch (err) { return { unavailable: `the install record ${file} is missing or cannot be read (${firstLine(err)})` }; }
  let j;
  try { j = JSON.parse(raw); } catch (err) { return { unavailable: `the install record ${file} is not JSON (${firstLine(err)})` }; }
  const repo = team && team.product_github;
  if (!repo) return { unavailable: 'team.json names no product_github, so its install cannot be found' };
  let markets = {};
  try { markets = JSON.parse(readFile(path.join(dir, 'known_marketplaces.json'))) || {}; } catch (err) { return { unavailable: `${path.join(dir, 'known_marketplaces.json')} is missing or cannot be read (${firstLine(err)})` }; }
  const mine = Object.keys(markets).filter((m) => { const s = (markets[m] && markets[m].source) || {}; return sameRepo(s.repo || repoOf(s.url), repo); }).sort(byStr);
  const plugins = (j && (j.plugins || j)) || {};
  const keys = Object.keys(plugins).filter((k) => { const [name, m] = k.split('@'); return mine.includes(m) && (!team.product_plugin || name === team.product_plugin); }).sort(byStr);
  const rank = (e) => (e.projectPath && path.resolve(e.projectPath) === path.resolve(root) ? 0 : e.scope === 'user' ? 1 : 2);
  const all = [];
  for (const key of keys) for (const e of [].concat(plugins[key] || [])) if (e && typeof e === 'object' && e.gitCommitSha) all.push({ key, e });
  if (!all.length) return { unavailable: `the install record has no install of a plugin from ${repo}` };
  all.sort((a, b) => rank(a.e) - rank(b.e) || -(compare(a.e.version, b.e.version) || 0) || byStr(a.key, b.key) || byStr(String(a.e.gitCommitSha), String(b.e.gitCommitSha)));
  const { key, e } = all[0];
  const market = markets[key.split('@')[1]] || {};
  return { key, version: e.version || null, sha: e.gitCommitSha, clone: market.installLocation || null, file };
}

// true when `sha` is in the install (the installed commit or one of its ancestors), false when not,
// null when it cannot be told (no clone, the clone does not know one of the commits)
function inInstall(sha, install, git) {
  const G = require('./gates.js');
  if (!sha || !install || !install.sha) return null;
  if (G.shaMatch(sha, install.sha)) return true;
  if (!install.clone) return null;
  const r = git(['-C', install.clone, 'merge-base', '--is-ancestor', sha, install.sha]);
  return r && r.status === 0 ? true : r && r.status === 1 ? false : null;
}

// ---- one product ----

function readProduct(root, deps = {}) {
  const G = require('./gates.js');
  const R = require('./reviews.js');
  const abs = path.resolve(root);
  const out = { product: path.basename(abs), root: abs, prefix: null, repo: null, install: null, open: null, reviews: null, notInstalled: null, unchecked: null, blockers: null, unavailable: [] };
  const miss = (source, section, why) => out.unavailable.push({ source, section, why: firstLine(why) });

  let team;
  try { team = (deps.loadTeam || ((r) => require('./manifest.js').loadManifest(r).team))(abs); } catch (err) { team = null; miss('team.json', 'all', err); }
  if (!team) {
    if (!out.unavailable.length) miss('team.json', 'all', `no readable ${require('./manifest.js').TEAM_REL} under ${abs}`);
    return out;
  }
  out.product = team.project || out.product;
  out.prefix = team.prefix || null;
  out.repo = team.product_github || null;

  // beads: every bead not closed, and the stories in a shipping state, open or closed
  let beads = null;
  let shipping = null;
  let bd = null;
  try {
    bd = (deps.bdFor || defaultBdFor)(abs, team);
    beads = bd.list({}) || [];
    const seen = new Map();
    for (const label of [G.STATE.merged, G.STATE.deployed]) for (const b of bd.list({ label, all: true }) || []) seen.set(b.id, b);
    shipping = [...seen.values()];
  } catch (err) { miss('bd', 'open work, merged not installed, installed not checked, blockers', err); }

  if (beads) {
    out.open = beads.filter((b) => OPEN_STATUSES.includes(b.status))
      .map((b) => ({ id: b.id, status: b.status, assignee: b.assignee || null, state: G.stateOf(b), title: b.title || '' }))
      .sort((a, b) => OPEN_STATUSES.indexOf(a.status) - OPEN_STATUSES.indexOf(b.status) || byStr(a.id, b.id));
  }

  // pull requests in review: the product repository's open ones, with the review record's state
  if (!out.repo) miss('gh', 'in review', 'team.json names no product_github, so gh cannot be asked which pull requests are open');
  else {
    const r = (deps.gh || defaultGh)(['pr', 'list', '-R', out.repo, '--state', 'open', '--limit', '200', '--json', 'number,title,headRefName,headRefOid,isDraft,body'], { cwd: abs });
    let list = null;
    if (r && r.status === 0) { try { list = JSON.parse(r.stdout); } catch (err) { list = null; } }
    if (!Array.isArray(list)) miss('gh', 'in review', r && r.error ? (r.error.code === 'ENOENT' ? 'gh is not installed' : r.error) : `gh pr list -R ${out.repo}: ${(r && (r.stderr || r.stdout)) || 'no JSON'}`);
    else {
      const recorded = R.listPrs(abs);
      out.reviews = list.map((p) => {
        let review = 'no review requested';
        if (recorded.includes(String(p.number))) {
          const rec = R.read(abs, p.number);
          review = rec.problem ? 'review record damaged' : R.stateOf(rec.rows, null, { repo: out.repo });
        }
        return { pr: Number(p.number), title: p.title || '', branch: p.headRefName || null, head: p.headRefOid || null, draft: Boolean(p.isDraft), refs: R.refsOf(p.body), review };
      }).sort((a, b) => a.pr - b.pr);
    }
  }

  // the install
  const install = installOf(abs, team, { readFile: deps.readFile || ((f) => fs.readFileSync(f, 'utf8')), configDir: deps.configDir || claudeHome(process.env) });
  if (install.unavailable) miss('install record', 'merged not installed, installed not checked', install.unavailable);
  else out.install = install;

  // merged, not installed; installed (or deployed), not checked
  if (shipping) {
    const git = deps.git || defaultGit;
    const checkOf = deps.checkOf || defaultCheckOf;
    const notInstalled = [];
    const unchecked = [];
    for (const b of shipping.sort((x, y) => byStr(x.id, y.id))) {
      const m = b.metadata || {};
      const state = G.stateOf(b);
      if (state === 'merged' && !m.deployed_sha) {
        const pr = prNumber(m.merged_pr);
        let merge = null;
        if (pr) { const rec = R.read(abs, pr); merge = ((rec.rows || []).find((x) => x.type === 'merged') || {}).merge_commit || null; }
        const inside = install.unavailable ? null : inInstall(merge, install, git);
        if (inside === true) unchecked.push({ id: b.id, state, sha: null, pr, merge, installed: install.sha, criteria: null, problem: 'no deploy recorded' });
        else if (!install.unavailable) notInstalled.push({ id: b.id, pr, merge, installed: { version: install.version, sha: install.sha }, known: inside === false });
      } else if (state === 'deployed' && m.deployed_sha) {
        let d;
        try { d = checkOf(abs, b, { bd, team, verifyRecord: deps.verifyRecord }); } catch (err) { d = { ok: false, criteria: [], problem: `the evidence could not be read (${firstLine(err)})` }; }
        if (d && d.ok && !d.cut) continue;
        const problem = d.problem || (d.empty ? 'the story has no acceptance criteria' : null);
        unchecked.push({ id: b.id, state, sha: m.deployed_sha, pr: prNumber(m.merged_pr), merge: null, installed: install.unavailable ? null : install.sha,
          criteria: (d.criteria || []).map((c) => ({ n: c.n, row: c.row || null, waiver: c.waiver || null, why: c.why || null })), problem });
      }
    }
    if (!install.unavailable) out.notInstalled = notInstalled;
    out.unchecked = unchecked;
  }

  // blockers: blocked beads, the owner's open steps, the open operator questions
  const blockers = [];
  let blockersOk = true;
  if (beads) for (const b of beads.filter((x) => x.status === 'blocked')) blockers.push({ kind: 'bead', id: b.id, assignee: b.assignee || null, text: b.title || '' });
  else blockersOk = false;
  try {
    for (const s of (deps.ownerSteps || ((r) => require('./owner-queue.js').open(r)))(abs) || []) blockers.push({ kind: 'owner-step', id: s.id, assignee: null, text: `${s.kind}: ${s.what}${s.bead ? ` (${s.bead})` : ''}` });
  } catch (err) { blockersOk = false; miss('owner queue', 'blockers and owner questions', err); }
  try {
    for (const q of (deps.questions || ((r) => require('./daily-plan.js').ownerQuestions(r)))(abs) || []) blockers.push({ kind: 'question', id: q.id, assignee: null, text: q.text || '' });
  } catch (err) { blockersOk = false; miss('operator records', 'blockers and owner questions', err); }
  const KIND = ['bead', 'owner-step', 'question'];
  blockers.sort((a, b) => KIND.indexOf(a.kind) - KIND.indexOf(b.kind) || byStr(a.id, b.id));
  // what could be read is shown; the missing source is named in unavailable
  out.blockers = blockers;
  out.blockersComplete = blockersOk;
  return out;
}

// every product's view, by product name (then root), whatever order the roots came in
function readProducts(roots, deps = {}) {
  const seen = new Set();
  const views = [];
  for (const r of roots) {
    const abs = path.resolve(r);
    if (seen.has(abs)) continue;
    seen.add(abs);
    views.push(readProduct(abs, deps));
  }
  return views.sort((a, b) => byStr(a.product, b.product) || byStr(a.root, b.root));
}

// true when a product has work in flight: open beads, open pull requests, unshipped or unchecked work, blockers
const inFlight = (v) => SECTIONS.some((s) => Array.isArray(v[s]) && v[s].length > 0);

module.exports = { readProduct, readProducts, installOf, inInstall, inFlight, SECTIONS, SECTION_NAMES, OPEN_STATUSES };
