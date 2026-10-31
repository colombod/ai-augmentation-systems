// scripts/lib/plan-sync.js — the planning repository stays true to what shipped.
//
// The owner (2026-10-31): "Delivery plugin must ensure the planning repo is up to date ... Letting such
// repo and feature map diverge defeats completely the entire product." The plan lives in the project
// repository; the team works in clones of it and merges product pull requests elsewhere, and nothing
// tied the two: on the first real team the planning repository stopped moving after day one while the
// product kept shipping. So the plan is brought up to date by the merge itself, and the merge gate
// refuses the next merge while it is behind:
//   - story files say what their beads say (closed: done; claimed, merged or deployed: in-progress);
//   - the feature map (.delivery/feature-map.json and .md) is regenerated from the product at the
//     merged head: the features it ships, what each open story reaches, and a shipped log;
//   - plan documents changed in the project root are committed and pushed to origin.
// Story statuses only move forward here; a story marked done whose bead is open again is reported, not
// rewritten, because reopening is a decision someone has to look at.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAP_JSON = path.join('.delivery', 'feature-map.json');
const MAP_MD = path.join('.delivery', 'feature-map.md');
// plan documents the sync publishes from the project root (records the scripts write publish themselves)
const PLAN_PATHS = ['initiatives', 'stories', 'sprints', 'decisions', 'personas', 'interviews', 'simulations', 'reviews', 'glossary.md', 'feature-map.json', 'feature-map.md'].map((p) => path.join('.delivery', p));
const HISTORY = 200;
const ORDER = { draft: 0, ready: 1, 'in-progress': 2, done: 3 };

const git = (dir, args, { env = process.env, timeout = 20000 } = {}) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
const isRepo = (d) => !!d && fs.existsSync(d) && git(d, ['rev-parse', '--git-dir'], { timeout: 5000 }).status === 0;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { return null; } };

// ---------- stories against beads ----------

function storyFiles(root) {
  const dir = path.join(root, '.delivery', 'stories');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => ({ file: f, abs: path.join(dir, f) })); } catch (err) { return []; }
}
const statusOf = (text) => { const m = /^---\r?\n[\s\S]*?^status:[ \t]*([^\r\n]*?)[ \t]*$/m.exec(text); return m ? m[1] : null; };
function setStatus(text, status) { return text.replace(/^(---\r?\n[\s\S]*?^status:[ \t]*)[^\r\n]*$/m, `$1${status}`); }

// What the bead says the story's status is, or null when it says nothing a file should follow.
function beadStatus(b) {
  const G = require('./gates.js');
  const st = G.stateOf(b);
  if (st === 'cut') return null;
  if (b.status === 'closed') return 'done';
  if (st || b.status === 'in_progress') return 'in-progress';
  return null;
}

// [{ file, abs, story, bead, from, to, kind: 'advance' | 'reopened' }]
function storyDrift(root, beads) {
  const byFile = new Map();
  for (const b of beads || []) { const f = b.metadata && b.metadata.story_file; if (f) byFile.set(String(f), b); }
  const out = [];
  for (const s of storyFiles(root)) {
    const b = byFile.get(s.file);
    if (!b) continue;
    let text;
    try { text = fs.readFileSync(s.abs, 'utf8'); } catch (err) { continue; }
    const from = statusOf(text);
    const to = beadStatus(b);
    if (!from || !to || from === to || from === 'superseded') continue;
    if ((ORDER[from] ?? -1) < ORDER[to]) out.push({ ...s, bead: b.id, from, to, kind: 'advance' });
    else if (from === 'done') out.push({ ...s, bead: b.id, from, to, kind: 'reopened' });
  }
  return out;
}

// ---------- the feature map ----------

// The product at its default branch, as a local repository and a ref: the role's product worktree or
// the team's local product path, fetched; else a bare clone kept in .delivery/cache/product.git.
function productSource(root, { team, roleDir, env = process.env, clone = true } = {}) {
  const url = team && team.product_url;
  const slug = team && team.product_github;
  const local = [roleDir && path.join(roleDir, 'product'), typeof url === 'string' && path.isAbsolute(url) ? url : null].find(isRepo);
  const remote = local ? 'origin' : (typeof url === 'string' && url && !path.isAbsolute(url) ? url : slug ? `https://github.com/${slug}.git` : null);
  let repo = local;
  if (!repo) {
    if (!remote) return { error: 'no product repository is recorded (product_github or product_url in team.json)' };
    repo = path.join(root, '.delivery', 'cache', 'product.git');
    if (!isRepo(repo)) {
      // the automatic sync after a merge never clones (it must not stall the merge on a first download);
      // plan-sync.js apply, which the gate names, makes the first copy
      if (!clone) return { error: `there is no local copy of the product yet: run ${require('./reviews.js').cmd('plan-sync.js', 'apply')} once` };
      fs.mkdirSync(path.dirname(repo), { recursive: true });
      const ig = path.join(path.dirname(repo), '.gitignore');
      if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
      const c = spawnSync('git', ['clone', '-q', '--bare', remote, repo], { encoding: 'utf8', timeout: 120000, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
      if (c.status !== 0) return { error: `the product could not be cloned from ${remote}: ${(c.stderr || '').trim().split('\n').pop()}` };
    }
  }
  // a product with no remote (a local-only product): its own HEAD is what shipped
  if (local && git(local, ['remote', 'get-url', 'origin']).status !== 0) return { repo, ref: 'HEAD', branch: 'HEAD' };
  const branch = (team && team.product_branch) || defaultBranch(repo, local ? 'origin' : remote, env);
  const f = git(repo, ['fetch', '-q', local ? 'origin' : remote, `+refs/heads/${branch}:refs/remotes/plan-sync/${branch}`], { env, timeout: 120000 });
  if (f.status !== 0) {
    // offline: the copy already here is what can be mapped; the map says which commit it is
    if (git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/plan-sync/${branch}`]).status !== 0) return { error: `the product's ${branch} could not be fetched: ${(f.stderr || '').trim().split('\n').pop()}` };
  }
  return { repo, ref: `refs/remotes/plan-sync/${branch}`, branch };
}
function defaultBranch(repo, remote, env) {
  const r = git(repo, ['ls-remote', '--symref', remote, 'HEAD'], { env, timeout: 30000 });
  const m = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(r.stdout || '');
  return m ? m[1] : 'main';
}

// The feature map at one product commit, with what each open story reaches.
function featureMap(root, { repo, ref }, { previous, pr = null, stories = [], at }) {
  const C = require('./codemap.js');
  const F = require('./features.js');
  const map = C.buildMap(repo, ref);
  const features = F.featuresOf(map).map((f) => ({ id: f.id, kind: f.kind, source: f.source, anchors: f.anchors }));
  const planned = [];
  for (const s of stories) {
    if (['done', 'superseded'].includes(s.status)) continue;
    let reached = [];
    try {
      const paths = require('../map.js').storyPaths(s.text);
      if (paths.length) reached = F.impact(map, F.featuresOf(map), paths).reached.map((f) => f.id);
    } catch (err) { reached = []; }
    planned.push({ story: s.id, file: s.file, status: s.status, features: reached });
  }
  const before = new Set(((previous && previous.features) || []).map((f) => f.id));
  const now = new Set(features.map((f) => f.id));
  const history = ((previous && previous.history) || []).slice();
  if (!previous || previous.sha !== map.sha) {
    history.push({ at, pr, sha: map.sha, added: [...now].filter((x) => !before.has(x)), removed: [...before].filter((x) => !now.has(x)) });
  }
  return { generated_by: 'plan-sync.js', at, sha: map.sha, pr, features, analysed: map.analysed.length, blind: map.blind.length, planned, history: history.slice(-HISTORY) };
}

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function featureMapMd(m, product) {
  const out = [`# Feature map`, '', `> Generated by \`plan-sync.js\` from ${product || 'the product'} at \`${String(m.sha).slice(0, 12)}\`${m.pr ? ` (after PR ${m.pr})` : ''}, ${m.at}. Do not edit: it is rewritten on every merge.`, ''];
  out.push(`## What ships (${m.features.length} features; ${m.analysed} files analysed, ${m.blind} blind)`, '', '| Feature | Kind | Source | Anchors |', '| :-- | :-- | :-- | :-- |');
  for (const f of m.features) out.push(`| ${cell(f.id)} | ${f.kind} | ${f.source} | ${cell(f.anchors.slice(0, 3).join(', '))}${f.anchors.length > 3 ? ` and ${f.anchors.length - 3} more` : ''} |`);
  out.push('', `## Planned, not shipped (${m.planned.length} stories)`, '', '| Story | Status | Features it reaches |', '| :-- | :-- | :-- |');
  for (const p of m.planned) out.push(`| ${cell(p.story)} | ${p.status} | ${p.features.length ? cell(p.features.join(', ')) : 'none named (its Files and modules table names no shipped file)'} |`);
  out.push('', '## Shipped, newest first', '', '| When | PR | Commit | Features added | Features removed |', '| :-- | :-- | :-- | :-- | :-- |');
  for (const h of m.history.slice().reverse().slice(0, 50)) out.push(`| ${h.at} | ${h.pr || ''} | \`${String(h.sha).slice(0, 12)}\` | ${cell(h.added.join(', '))} | ${cell(h.removed.join(', '))} |`);
  return `${out.join('\n')}\n`;
}

// ---------- the project root against origin ----------

// Plan documents in the project root that are not on origin: changed or new files, and commits not pushed.
function unpublished(root) {
  // no origin: nothing to publish to (publish-records skips such a root the same way)
  if (!isRepo(root) || git(root, ['remote', 'get-url', 'origin']).status !== 0) return { files: [], ahead: 0 };
  const st = git(root, ['status', '--porcelain', '--untracked-files=all', '--', ...PLAN_PATHS]);
  const files = (st.stdout || '').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const branch = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
  let ahead = 0;
  if (branch && branch !== 'HEAD' && git(root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]).status === 0) {
    ahead = Number((git(root, ['rev-list', '--count', `refs/remotes/origin/${branch}..HEAD`]).stdout || '0').trim()) || 0;
  }
  return { files, ahead };
}

// The last merge the review records hold: { pr, at } or null
function lastMerge(root) {
  const R = require('./reviews.js');
  let last = null;
  for (const pr of R.listPrs(root)) {
    let rows = [];
    try { rows = R.read(root, pr).rows || []; } catch (err) { rows = []; }
    for (const r of rows) if (r.type === 'merged' && (!last || String(r.at) > String(last.at))) last = { pr, at: r.at, head: r.head };
  }
  return last;
}

// ---------- check and apply ----------

// [{ kind, detail }]: everything that says the plan is behind what shipped. Local reads only (the merge
// gate runs it before every merge); bd is read when it can be, and its absence is said, not refused.
function drift(root, { beads } = {}) {
  const out = [];
  if (beads) for (const d of storyDrift(root, beads)) out.push({ kind: d.kind === 'advance' ? 'story-status' : 'story-reopened', detail: d.kind === 'advance' ? `${d.file} says ${d.from}, its bead ${d.bead} says ${d.to}` : `${d.file} says done, but its bead ${d.bead} is open again (${d.to})` });
  const last = lastMerge(root);
  const map = readJson(path.join(root, MAP_JSON));
  if (last && (!map || String(map.at) < String(last.at))) out.push({ kind: 'feature-map', detail: map ? `the feature map is from ${map.at}, before PR ${last.pr} merged at ${last.at}` : `there is no feature map, and PR ${last.pr} has merged` });
  const u = unpublished(root);
  if (u.files.length) out.push({ kind: 'unpublished', detail: `${u.files.length} plan file${u.files.length === 1 ? '' : 's'} not on origin (${u.files.slice(0, 3).join(', ')}${u.files.length > 3 ? ', ...' : ''})` });
  if (u.ahead) out.push({ kind: 'unpushed', detail: `${u.ahead} plan commit${u.ahead === 1 ? '' : 's'} not pushed to origin` });
  return out;
}

// Bring the plan up to date: story statuses, the feature map, and publish. { ok, lines, problems }
function apply(root, { beads, team, roleDir, env = process.env, now = new Date().toISOString(), pr = null, source, clone = true } = {}) {
  const lines = [];
  const problems = [];
  const written = [];
  if (beads) {
    for (const d of storyDrift(root, beads)) {
      if (d.kind !== 'advance') { problems.push(`${d.file} says done, but its bead ${d.bead} is open again: decide with its owner, then set its status`); continue; }
      fs.writeFileSync(d.abs, setStatus(fs.readFileSync(d.abs, 'utf8'), d.to));
      written.push(path.join('.delivery', 'stories', d.file));
      lines.push(`${d.file}: ${d.from} -> ${d.to} (bead ${d.bead})`);
    }
  } else problems.push('bd could not be read: story statuses were not checked');
  const last = lastMerge(root);
  const previous = readJson(path.join(root, MAP_JSON));
  const src = source || productSource(root, { team, roleDir, env, clone });
  if (src.error) problems.push(`the feature map was not rebuilt: ${src.error}`);
  else {
    try {
      const G = require('./gates.js');
      const stories = storyFiles(root).map((s) => { const text = fs.readFileSync(s.abs, 'utf8'); const meta = G.parseStory(text).meta || {}; return { id: meta.id || s.file.replace(/\.md$/, ''), file: s.file, status: statusOf(text), text }; });
      const m = featureMap(root, src, { previous, pr: pr || (last && last.pr) || null, stories, at: now });
      fs.writeFileSync(path.join(root, MAP_JSON), `${JSON.stringify(m, null, 2)}\n`);
      fs.writeFileSync(path.join(root, MAP_MD), featureMapMd(m, team && team.product_github));
      written.push(MAP_JSON, MAP_MD);
      const h = m.history[m.history.length - 1];
      lines.push(`feature map at ${String(m.sha).slice(0, 12)}: ${m.features.length} features, ${m.planned.length} planned stories${h && h.sha === m.sha && (h.added.length || h.removed.length) ? `; added ${h.added.length}, removed ${h.removed.length}` : ''}`);
    } catch (err) { problems.push(`the feature map was not rebuilt: ${String(err.message).split('\n')[0]}`); }
  }
  const u = unpublished(root);
  const paths = [...new Set([...written, ...u.files])];
  if (paths.length || u.ahead) {
    const res = require('./publish-records.js').publish(root, paths.length ? paths : [MAP_JSON], `plan: up to date with what shipped${pr ? ` (PR ${pr})` : ''}`, { env });
    if (res.ok && !res.skipped) lines.push(`published to origin: ${paths.length} file${paths.length === 1 ? '' : 's'}`);
    else if (!res.ok) problems.push(`the plan was not pushed to origin: ${res.reason}`);
  }
  return { ok: problems.length === 0, lines, problems };
}

module.exports = { drift, apply, storyDrift, featureMap, featureMapMd, unpublished, lastMerge, productSource, setStatus, statusOf, MAP_JSON, MAP_MD, PLAN_PATHS };
