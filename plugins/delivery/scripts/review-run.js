#!/usr/bin/env node
// review-run.js checkout <pr> <head> | test <pr> — the reviewer's scratch clone and test run.
//
// Why a script: the reviewer must check out a head and run the tests of a product in any language,
// and the lane cannot list every toolchain's runner without locking languages out or opening a hole
// (a wildcard was got past with `timeout ... git push`; git run by the reviewer was got past with a
// fake bare repository whose config pointed its work tree outside review/). So the lane admits only
// this script, and the reviewer runs no git writes and names no paths: the clone is always
// review/pr-<n> of the role directory, made and reset here with git's repository discovery pinned
// to that clone.
//
// checkout: clone the product repository (team.json product_url, else the role's product worktree's
//   origin, else GitHub's product_github) into review/pr-<n> if absent, fetch <head>, and check it out
//   detached with every local change and untracked file removed (also how a mutation is undone).
// test: run the project's test command there (team.json test_command, or detected from the clone's
//   build files; any language), with the role's DELIVERY_* and beads variables cleared, bounded by
//   test_timeout_minutes (default 60). No extra arguments: a runner's own options can point it
//   outside the clone, and the whole suite is what a review quotes.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testCommandOf, FIX } = require('./lib/test-command.js');

const ROLE_VARS = /^(DELIVERY_|BEADS_|BD_ACTOR$)/;
// git variables that would point git at another repository or config than the clone's
const GIT_REPO_VARS = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|CONFIG|CONFIG_GLOBAL|CONFIG_SYSTEM|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+|CONFIG_PARAMETERS|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM)$/;
const USAGE = 'usage: review-run.js checkout <pr number> <head sha> | review-run.js test <pr number>';
const PR = /^[1-9][0-9]{0,8}$/;
const SHA = /^[0-9a-f]{7,64}$/;

function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!ROLE_VARS.test(k) && !GIT_REPO_VARS.test(k)) out[k] = v;
  return out;
}

function roleOf({ cwd, roleDir, team }) {
  if (roleDir && team) return { roleDir, team };
  try {
    const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js');
    const v = validMarker(findRoleMarker(cwd));
    if (v) return { roleDir: roleDir || v.roleDir, team: team || v.team };
  } catch (e) { /* no role: refused by the caller */ }
  return { roleDir: roleDir || null, team: team || null };
}

// review/pr-<n> under the real role directory, refused when it (or review/) is not a plain
// directory, or when a clone's .git is not a real directory
function cloneDir(roleDir, pr, { mustExist }) {
  const scratch = path.join(fs.realpathSync(roleDir), 'review');
  const dir = path.join(scratch, `pr-${pr}`);
  for (const p of [scratch, dir]) {
    let st = null;
    try { st = fs.lstatSync(p); } catch (e) { st = null; }
    if (st && !st.isDirectory()) return { problem: `${path.relative(path.dirname(scratch), p)} is not a plain directory` };
  }
  if (mustExist) {
    let g = null;
    try { g = fs.lstatSync(path.join(dir, '.git')); } catch (e) { g = null; }
    if (!g || !g.isDirectory()) return { problem: `review/pr-${pr} holds no clone yet. Run: review-run.js checkout ${pr} <head sha>` };
  }
  return { scratch, dir };
}

function productUrl(team, roleDir) {
  if (team && typeof team.product_url === 'string' && /^(https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(team.product_url)) return team.product_url;
  const r = spawnSync('git', ['-C', path.join(roleDir, 'product'), 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  if (team && typeof team.product_github === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(team.product_github)) return `https://github.com/${team.product_github}.git`;
  return null;
}

function checkout(pr, head, { roleDir, team, env, spawn, out, err }) {
  const c = cloneDir(roleDir, pr, { mustExist: false });
  if (c.problem) { err(`review-run: refused: ${c.problem}.`); return 2; }
  const url = productUrl(team, roleDir);
  if (!url) { err('review-run: refused: the product repository is not known. Set it: start.js --product-repo <checkout or URL>, or "product_url" in team.json'); return 2; }
  fs.mkdirSync(c.scratch, { recursive: true });
  const genv = { ...cleanEnv(env), GIT_CEILING_DIRECTORIES: c.scratch, GIT_TERMINAL_PROMPT: '0' };
  // every git call names its repository and work tree: no discovery, no bare repository found by
  // walking up, no hooks or fsmonitor from the clone's config
  const pinned = ['-c', 'safe.bareRepository=explicit', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', `--git-dir=${path.join(c.dir, '.git')}`, `--work-tree=${c.dir}`];
  const git = (args, timeout = 600e3) => spawn('git', args, { env: genv, encoding: 'utf8', timeout, cwd: c.scratch });
  const step = (what, r) => { if (r.status !== 0) { err(`review-run: ${what} failed: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`); return false; } return true; };
  if (!fs.existsSync(c.dir)) {
    if (!step(`clone of ${url}`, git(['-c', 'safe.bareRepository=explicit', 'clone', '--quiet', '--no-checkout', '--', url, c.dir]))) return 1;
  }
  const g = cloneDir(roleDir, pr, { mustExist: true });
  if (g.problem) { err(`review-run: refused: ${g.problem}.`); return 2; }
  // the head itself, or the pull request's head ref where a server will not serve an unadvertised sha
  let f = git([...pinned, 'fetch', '--quiet', 'origin', head]);
  if (f.status !== 0) f = git([...pinned, 'fetch', '--quiet', 'origin', `+refs/pull/${pr}/head:refs/remotes/origin/pr-${pr}`]);
  if (!step(`fetch of ${head}`, f)) return 1;
  if (!step(`checkout of ${head}`, git([...pinned, 'checkout', '--quiet', '--force', '--detach', head]))) return 1;
  if (!step('clean', git([...pinned, 'clean', '-ffdxq']))) return 1;
  const at = git([...pinned, 'rev-parse', 'HEAD']);
  out(`review-run: review/pr-${pr} at ${String(at.stdout || '').trim()} (from ${url}), clean`);
  return 0;
}

function test(pr, { roleDir, team, env, spawn, out, err, platform }) {
  const c = cloneDir(roleDir, pr, { mustExist: true });
  if (c.problem) { err(`review-run: refused: ${c.problem}.`); return 2; }
  const t = testCommandOf(c.dir, team, { platform });
  if (t.problem) { err(`review-run: refused: ${t.problem}.\n${FIX}`); return 2; }
  out(`review-run: ${t.command} (${t.source}) in review/pr-${pr}`);
  const started = Date.now();
  const minutes = team && Number.isFinite(Number(team.test_timeout_minutes)) && Number(team.test_timeout_minutes) > 0 ? Number(team.test_timeout_minutes) : 60;
  const win = platform === 'win32';
  const shell = win ? { cmd: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${t.command}"`] } : { cmd: '/bin/sh', args: ['-c', t.command] };
  // windowsVerbatimArguments: cmd.exe does not read Node's \" escaping (node's own shell: true sets it)
  const r = spawn(shell.cmd, shell.args, { cwd: c.dir, env: cleanEnv(env), stdio: 'inherit', timeout: minutes * 60e3, windowsVerbatimArguments: win });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.error && r.error.code === 'ETIMEDOUT') { out(`review-run: stopped after ${minutes} minutes (team.json test_timeout_minutes)`); return 1; }
  const code = r.status === null ? 1 : r.status;
  out(`review-run: exit ${code} after ${secs}s`);
  return code;
}

function main(argv, { env = process.env, cwd = process.cwd(), team, roleDir, spawn = spawnSync, out = console.log, err = console.error, platform = process.platform } = {}) {
  const [cmd, pr, head, ...rest] = argv;
  const ok = (cmd === 'checkout' && PR.test(pr || '') && SHA.test(head || '') && !rest.length) || (cmd === 'test' && PR.test(pr || '') && head === undefined);
  if (!ok) { err(USAGE); return 2; }
  const role = roleOf({ cwd, roleDir, team });
  if (!role.roleDir) { err('review-run: refused: not in a role directory, so the scratch area (review/) is not known.'); return 2; }
  const ctx = { ...role, env, spawn, out, err, platform };
  return cmd === 'checkout' ? checkout(pr, head, ctx) : test(pr, ctx);
}

module.exports = { main, cleanEnv };
if (require.main === module) process.exit(main(process.argv.slice(2)));
