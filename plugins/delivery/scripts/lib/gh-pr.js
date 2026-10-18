// scripts/lib/gh-pr.js — read one pull request of the product repository through `gh pr view` (head,
// branch, mergeable, checks, size, body). The repository is always named (-R): the sessions run in
// the project (planning) checkout, where gh would otherwise read the wrong repository. It comes from
// team.json `product_github` (start.js records it from the product checkout's origin), else from the
// origin of the role's own product worktree; with neither, callers refuse. viewPr returns the parsed
// view, or { unavailable: '<why>' } when gh is missing, signed out or cannot reach it. One call, 6 s.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FIELDS = 'number,state,headRefOid,headRefName,mergeable,statusCheckRollup,additions,deletions,files,body,title';
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

function viewPr(pr, { repo, cwd, timeoutMs = 6000 } = {}) {
  if (!repo) return { unavailable: 'the product repository is not known' };
  let r;
  try { r = spawnSync('gh', ['pr', 'view', String(pr), '--json', FIELDS, '-R', repo], { cwd, encoding: 'utf8', timeout: timeoutMs }); } catch (err) { return { unavailable: err.message }; }
  if (r.error) return { unavailable: r.error.code === 'ENOENT' ? 'gh is not installed' : r.error.message };
  if (r.status !== 0) return { unavailable: String(r.stderr || r.stdout || `gh exited ${r.status}`).trim().split('\n')[0].slice(0, 160) };
  try { return JSON.parse(r.stdout); } catch (err) { return { unavailable: 'gh pr view returned no JSON' }; }
}

module.exports = { viewPr, repoOf, productRepoOf, sameRepo, UNKNOWN, REPO };
