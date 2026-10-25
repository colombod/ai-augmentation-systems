#!/usr/bin/env node
// review-run.js <clone> — run the product's tests in a reviewer's scratch clone.
//
// Why a script: the reviewer must run the tests of a product in any language, and the lane cannot
// list every toolchain's runner without either locking languages out or opening a hole (a wildcard
// was tried and got past with `timeout ... git push`). So the lane admits this one command. It runs
// the project's test command (team.json `test_command`, or detected from the clone's build files),
// only inside review/ of the role directory, with the role's DELIVERY_* and beads variables cleared
// so the suite runs as it does in CI. It takes no extra arguments: a runner's options can point it
// outside the clone (pytest --basetemp=, make -C), and the whole suite is what a review quotes.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testCommandOf, FIX } = require('./lib/test-command.js');

const ROLE_VARS = /^(DELIVERY_|BEADS_|BD_ACTOR$)/;
const USAGE = 'usage: review-run.js <clone under review/>';

function main(argv, { env = process.env, cwd = process.cwd(), team: givenTeam, roleDir: givenRoleDir, spawn = spawnSync, out = console.log, err = console.error } = {}) {
  const args = argv;
  if (args.length !== 1 || args[0].startsWith('-')) { err(USAGE); return 2; }
  let roleDir = givenRoleDir || null;
  let team = givenTeam || null;
  if (!roleDir || !team) {
    try {
      const { findRoleMarker, validMarker } = require('../hooks/scripts/role-context.js');
      const v = validMarker(findRoleMarker(cwd));
      if (v) { roleDir = roleDir || v.roleDir; team = team || v.team; }
    } catch (e) { /* no role: refused below */ }
  }
  if (!roleDir) { err('review-run: refused: not in a role directory, so the scratch area (review/) is not known.'); return 2; }
  const scratch = path.join(fs.realpathSync(roleDir), 'review');
  let dir;
  try { dir = fs.realpathSync(path.resolve(cwd, args[0])); } catch (e) { err(`review-run: refused: ${args[0]} does not exist. Clone the head first: git clone <product repo> review/pr-<n>`); return 2; }
  const rel = path.relative(scratch, dir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) { err(`review-run: refused: ${args[0]} is not a clone under review/ (${scratch}).`); return 2; }
  const t = testCommandOf(dir, team);
  if (t.problem) { err(`review-run: refused: ${t.problem}.\n${FIX}`); return 2; }
  const command = t.command;
  const clean = {};
  for (const [k, v] of Object.entries(env)) if (!ROLE_VARS.test(k)) clean[k] = v;
  out(`review-run: ${command} (${t.source}) in ${path.relative(scratch, dir) || '.'}`);
  const started = Date.now();
  const minutes = team && Number.isFinite(Number(team.test_timeout_minutes)) && Number(team.test_timeout_minutes) > 0 ? Number(team.test_timeout_minutes) : 60;
  const shell = process.platform === 'win32' ? { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] } : { cmd: '/bin/sh', args: ['-c', command] };
  const r = spawn(shell.cmd, shell.args, { cwd: dir, env: clean, stdio: 'inherit', timeout: minutes * 60e3 });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.error && r.error.code === 'ETIMEDOUT') { out(`review-run: stopped after ${minutes} minutes (team.json test_timeout_minutes)`); return 1; }
  const code = r.status === null ? 1 : r.status;
  out(`review-run: exit ${code} after ${secs}s`);
  return code;
}

module.exports = { main };
if (require.main === module) process.exit(main(process.argv.slice(2)));
