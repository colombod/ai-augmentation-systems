// scripts/lib/publish-records.js — publish record files a script wrote into the project root.
//
// The gates read the project repo's root checkout, and a record written there but never committed
// stays on that host: the merge gate on another host, or after a container restart, does not see it.
// publish() commits exactly the named paths and pushes the current branch to origin, fast-forward
// only (on a rejected push: fetch, rebase the record commit onto origin, retry once). It never
// blocks the caller: every failure comes back as a reason, and the next publish carries what this
// one could not (the same paths are staged again, and earlier local commits go with the push).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// { ok: true } | { ok: false, reason }
function publish(root, paths, message, { env = process.env, timeoutMs = 20000 } = {}) {
  try {
    if (!root || env.DELIVERY_NO_PUBLISH === '1' || !fs.existsSync(path.join(root, '.git'))) return { ok: true, skipped: true }; // not a git checkout: nothing to publish to, as freshRoot skips it
    const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', timeout: timeoutMs, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
    const rel = paths.map((p) => (path.isAbsolute(p) ? path.relative(root, p) : p)).filter((p) => fs.existsSync(path.join(root, p)));
    if (!rel.length) return { ok: false, reason: 'nothing was written' };
    // only the named paths are staged and committed; anything else staged or modified in the root stays as it is
    if (git('status', '--porcelain', '--', ...rel).stdout.trim()) {
      const add = git('add', '--', ...rel);
      if (add.status !== 0) return { ok: false, reason: `git add failed: ${(add.stderr || add.stdout).trim().slice(0, 160)}` };
      const c = git('commit', '-q', '-m', message, '--', ...rel);
      if (c.status !== 0) return { ok: false, reason: `git commit failed: ${(c.stderr || c.stdout).trim().slice(0, 160)}` };
    }
    if (git('remote', 'get-url', 'origin').status !== 0) return { ok: false, reason: 'the project repo has no origin remote' };
    const branch = (git('rev-parse', '--abbrev-ref', 'HEAD').stdout || '').trim();
    if (!branch || branch === 'HEAD') return { ok: false, reason: 'the project root is not on a branch' };
    let push = git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    if (push.status !== 0) {
      const f = git('fetch', '-q', 'origin', branch);
      if (f.status !== 0) return { ok: false, reason: `origin is not reachable: ${(f.stderr || f.stdout).trim().split('\n')[0].slice(0, 160)}` };
      const r = git('-c', 'rebase.autoStash=true', 'rebase', '-q', 'FETCH_HEAD');
      if (r.status !== 0) { git('rebase', '--abort'); return { ok: false, reason: `origin moved and the record commit does not rebase onto it: ${(r.stderr || r.stdout).trim().split('\n')[0].slice(0, 160)}` }; }
      push = git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
      if (push.status !== 0) return { ok: false, reason: `push refused: ${(push.stderr || push.stdout).trim().split('\n')[0].slice(0, 160)}` };
    }
    return { ok: true };
  } catch (err) { return { ok: false, reason: err.message }; }
}

module.exports = { publish };
