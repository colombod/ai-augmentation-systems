// scripts/lib/gh-pr.js — read one pull request of the product repository through `gh pr view` (head,
// branch, mergeable, checks, size, body). The repository is always named (-R): the sessions run in
// the project (planning) checkout, where gh would otherwise read the wrong repository. It comes from
// team.json `product_github` (start.js records it from the product checkout's origin), else from the
// origin of the role's own product worktree; with neither, callers refuse. viewPr returns the parsed
// view, or { unavailable: '<why>' } when gh is missing, signed out or cannot reach it. One call, 6 s.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FIELDS = 'number,state,mergedAt,mergeCommit,headRefOid,headRefName,baseRefName,mergeable,statusCheckRollup,additions,deletions,files,body,title,createdAt,comments,commits,author';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// owner/name from a GitHub remote URL (git@github.com:o/r.git, https://github.com/o/r, a PR URL)
function repoOf(url) {
  // the exact github.com host only: scp form, ssh:// or https:// (optionally with a user), nothing else
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/\s]+@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/pull\/\d+(?:[/?#].*)?)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function productRepoOf(team, { roleDir } = {}) {
  if (team && typeof team.product_github === 'string' && REPO.test(team.product_github)) return team.product_github;
  const product = roleDir ? path.join(roleDir, 'product') : null;
  if (product && fs.existsSync(product)) {
    const r = spawnSync('git', ['-C', product, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) return repoOf(r.stdout.trim());
  }
  return null;
}

const sameRepo = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const UNKNOWN = (pr) => `the product repository is not known, so gh cannot read PR ${pr}.\nSet it: start.js --product-repo <checkout or URL> records product_github in team.json`;

const firstLine = (r) => String(r.stderr || r.stdout || `gh exited ${r.status}`).trim().split('\n')[0].slice(0, 160);

function viewPr(pr, { repo, cwd, timeoutMs = 6000 } = {}) {
  if (!repo) return { unavailable: 'the product repository is not known' };
  let r;
  try { r = spawnSync('gh', ['pr', 'view', String(pr), '--json', FIELDS, '-R', repo], { cwd, encoding: 'utf8', timeout: timeoutMs }); } catch (err) { return { unavailable: err.message }; }
  if (r.error) return { unavailable: r.error.code === 'ENOENT' ? 'gh is not installed' : r.error.message };
  if (r.status === 0) {
    try { return JSON.parse(r.stdout); } catch (err) { return { unavailable: 'gh pr view returned no JSON' }; }
  }
  // `gh pr view` is GraphQL. Some hosts reach GitHub only through REST (Claude Code's cloud sessions
  // get "HTTP 403: GitHub GraphQL is not available"), so the same facts are read through `gh api`.
  const why = firstLine(r);
  const rest = viewPrRest(pr, { repo, cwd, timeoutMs });
  return rest.unavailable ? { unavailable: `${why}; through REST: ${rest.unavailable}` } : rest;
}

function ghApi(endpoint, { cwd, timeoutMs }) {
  let r;
  try { r = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', endpoint], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }); } catch (err) { return { unavailable: err.message }; }
  if (r.error) return { unavailable: r.error.message };
  if (r.status !== 0) return { unavailable: firstLine(r) };
  try { return { json: JSON.parse(r.stdout) }; } catch (err) { return { unavailable: `gh api ${endpoint} returned no JSON` }; }
}

const MERGEABLE = (m) => (m === true ? 'MERGEABLE' : m === false ? 'CONFLICTING' : 'UNKNOWN');
const UP = (x) => String(x || '').toUpperCase();

// The fields viewPr's callers read, in `gh pr view --json` shape, from the REST endpoints.
// every page of a list endpoint (rv-201: GitHub returns the oldest first, so one page of 100 dropped the
// newest lines); null when any page cannot be read, so the caller leaves the list out and the gate refuses
function allPages(endpoint, o) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const r = ghApi(`${endpoint}?per_page=100&page=${page}`, o);
    if (r.unavailable || !Array.isArray(r.json)) return null;
    out.push(...r.json);
    if (r.json.length < 100) return out;
  }
  return out;
}
function restExtras(base, pr, o) {
  const out = {};
  // who wrote each comment, so a stranger's comment on a public repository counts for nothing (rv-201)
  const comments = allPages(`${base}/issues/${pr}/comments`, o);
  if (comments) out.comments = comments.map((c) => ({ body: (c && c.body) || '', author: { login: (c && c.user && c.user.login) || null }, authorAssociation: (c && c.author_association) || null, createdAt: (c && c.created_at) || null }));
  const commits = allPages(`${base}/pulls/${pr}/commits`, o);
  if (commits) {
    out.commits = commits.map((c) => {
      const msg = String((c && c.commit && c.commit.message) || '');
      const nl = msg.indexOf('\n');
      const committedDate = (c && c.commit && c.commit.committer && c.commit.committer.date) || null;
      return nl < 0 ? { messageHeadline: msg, messageBody: '', committedDate } : { messageHeadline: msg.slice(0, nl), messageBody: msg.slice(nl + 1).replace(/^\n/, ''), committedDate };
    });
  }
  return out;
}

function viewPrRest(pr, { repo, cwd, timeoutMs = 6000 } = {}) {
  const o = { cwd, timeoutMs };
  const base = `repos/${repo}`;
  const p = ghApi(`${base}/pulls/${pr}`, o);
  if (p.unavailable) return p;
  const pull = p.json || {};
  const sha = pull.head && pull.head.sha;
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const f = ghApi(`${base}/pulls/${pr}/files?per_page=100&page=${page}`, o);
    if (f.unavailable) return f;
    const list = Array.isArray(f.json) ? f.json : [];
    for (const x of list) files.push({ path: x.filename, additions: x.additions, deletions: x.deletions });
    if (list.length < 100) break;
  }
  const rollup = [];
  if (sha) {
    // every page: a failing check past the first page must not read as green (fails closed when the
    // pages do not add up to the total GitHub reports)
    let total = null;
    let seen = 0;
    for (let page = 1; page <= 30; page++) {
      const runs = ghApi(`${base}/commits/${sha}/check-runs?per_page=100&page=${page}`, o);
      if (runs.unavailable) return runs;
      const list = (runs.json && runs.json.check_runs) || [];
      total = runs.json && Number.isFinite(runs.json.total_count) ? runs.json.total_count : total;
      for (const c of list) rollup.push({ __typename: 'CheckRun', name: c.name, status: UP(c.status), conclusion: UP(c.conclusion) });
      seen += list.length;
      if (list.length < 100 || (total !== null && seen >= total)) break;
    }
    if (total !== null && seen < total) return { unavailable: `only ${seen} of ${total} check runs could be read` };
    const st = ghApi(`${base}/commits/${sha}/status?per_page=100`, o);
    if (st.unavailable) return st;
    const statuses = (st.json && st.json.statuses) || [];
    for (const c of statuses) rollup.push({ __typename: 'StatusContext', context: c.context, state: UP(c.state) });
    // the combined state covers statuses past the page read; a failure there is red whatever was listed
    const combined = UP(st.json && st.json.state);
    const stTotal = st.json && Number.isFinite(st.json.total_count) ? st.json.total_count : statuses.length;
    if (stTotal > statuses.length && combined !== 'SUCCESS') rollup.push({ __typename: 'StatusContext', context: `combined status (${stTotal} statuses)`, state: combined || 'PENDING' });
  }
  return {
    number: pull.number,
    state: pull.merged || pull.merged_at ? 'MERGED' : UP(pull.state),
    mergedAt: pull.merged_at || null,
    mergeCommit: pull.merge_commit_sha && (pull.merged || pull.merged_at) ? { oid: pull.merge_commit_sha } : null,
    headRefOid: sha || null,
    headRefName: (pull.head && pull.head.ref) || null,
    baseRefName: (pull.base && pull.base.ref) || null,
    mergeable: MERGEABLE(pull.mergeable),
    statusCheckRollup: rollup,
    additions: pull.additions,
    deletions: pull.deletions,
    files,
    body: pull.body || '',
    title: pull.title || '',
    createdAt: pull.created_at || null,
    author: { login: (pull.user && pull.user.login) || null },
    // the doc-impact line can be said in a comment or a commit message (lib/doc-impact.js); one page of
    // each, and a page that cannot be read leaves only the description, so the gate refuses, never passes
    ...restExtras(base, pr, o),
    via: 'rest',
  };
}

// One file of the repository at a ref, through the contents endpoint: { text } | { missing: true } |
// { unavailable }. A 404 is an answer (the file is not there), any other failure is not.
function readFileAt(repo, file, ref, { cwd, timeoutMs = 6000 } = {}) {
  if (!repo) return { unavailable: 'the product repository is not known' };
  const enc = String(file).split('/').map(encodeURIComponent).join('/');
  const r = ghApi(`repos/${repo}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { cwd, timeoutMs });
  if (r.unavailable) return /\b404\b|Not Found/.test(r.unavailable) ? { missing: true } : r;
  const j = r.json || {};
  if (j.encoding !== 'base64' || typeof j.content !== 'string') return { unavailable: `contents of ${file} came back in no readable form` };
  return { text: Buffer.from(j.content, 'base64').toString('utf8') };
}

module.exports = { readFileAt, viewPr, viewPrRest, repoOf, productRepoOf, sameRepo, UNKNOWN, REPO };
