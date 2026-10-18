// scripts/lib/gh-pr.js — read one pull request through `gh pr view` (head, mergeable, checks, size, body).
// Returns the parsed view, or { unavailable: '<why>' } when gh is missing, signed out or cannot reach it;
// the callers then fall back to the recorded rows. Bounded: one call, at most 6 s.
const { spawnSync } = require('child_process');

const FIELDS = 'number,state,headRefOid,mergeable,statusCheckRollup,additions,deletions,files,body,title';

// owner/repo from team.json's product_repo (git@github.com:o/r.git, https://github.com/o/r)
function repoOf(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

function viewPr(pr, { repo, cwd, timeoutMs = 6000 } = {}) {
  const args = ['pr', 'view', String(pr), '--json', FIELDS, ...(repo ? ['-R', repo] : [])];
  let r;
  try { r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: timeoutMs }); } catch (err) { return { unavailable: err.message }; }
  if (r.error) return { unavailable: r.error.code === 'ENOENT' ? 'gh is not installed' : r.error.message };
  if (r.status !== 0) return { unavailable: String(r.stderr || r.stdout || `gh exited ${r.status}`).trim().split('\n')[0].slice(0, 160) };
  try { return JSON.parse(r.stdout); } catch (err) { return { unavailable: 'gh pr view returned no JSON' }; }
}

module.exports = { viewPr, repoOf };
