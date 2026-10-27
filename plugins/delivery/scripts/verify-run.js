#!/usr/bin/env node
// scripts/verify-run.js run <bead> --criterion <n> — the Reality Checker's runner for a story whose
// customer surface is a command line (a CLI, a library, a service driven by commands).
//
// Why a script: the Reality Checker drives a screen; a terminal product has none, and the builder who
// wrote the story may not verify it. This runs the one command the Delivery Manager put in the
// criterion's script step (reality-check.js refine ... --command), against the DEPLOYED sha in a scratch
// clone (verify/<bead>-<sha> of the role directory, like review-run.js's review/pr-<n>), saves the
// command, sha, stdout, stderr and exit code as the capture under .delivery/evidence/artifacts/<bead>/,
// decides pass or fail itself (exit 0, and the step's `match` pattern found in stdout when it has one),
// and records the row through reality-check.js run-record, so every refusal there applies: the deployed
// sha, the run cap, a capture that backs one run. The agent running this never types a result.
// Exit codes: 0 the command ran and a row was recorded (a fail row is recorded too); 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const RR = require('./review-run.js');
const RC = require('./reality-check.js');
const G = require('./lib/gates.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');

const USAGE = 'usage: verify-run.js run <bead> --criterion <n>';
const CAPTURE_MAX = 256 * 1024;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const refuse = (text) => ({ code: 1, out: `verify-run.js: ${text}` });

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--criterion') { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); out[argv[i].slice(2)] = argv[++i]; }
    else if (argv[i].startsWith('--')) throw new Error(`unknown option ${argv[i]}`);
    else out._.push(argv[i]);
  }
  return out;
}

// verify/<bead>-<sha12> under the real role directory; refused when it is not a plain directory
function cloneDir(roleDir, bead, sha) {
  const scratch = path.join(fs.realpathSync(roleDir), 'verify');
  const dir = path.join(scratch, `${bead}-${sha.slice(0, 12)}`);
  for (const p of [scratch, dir]) {
    let st = null;
    try { st = fs.lstatSync(p); } catch (e) { st = null; }
    if (st && !st.isDirectory()) return { problem: `${path.relative(path.dirname(scratch), p)} is not a plain directory` };
  }
  return { scratch, dir };
}

// The clone at exactly the deployed sha, every local change and untracked file removed. Git is pinned
// to the clone as review-run.js pins it: no discovery, no hooks or fsmonitor from the clone's config.
function checkoutDeployed({ roleDir, team, sha, bead, env, spawn }) {
  const c = cloneDir(roleDir, bead, sha);
  if (c.problem) return { problem: c.problem };
  const url = RR.productUrl(team, roleDir);
  if (!url) return { problem: 'the product repository is not known. Set it: start.js --product-repo <checkout or URL>, or "product_url" in team.json' };
  fs.mkdirSync(c.scratch, { recursive: true });
  const genv = { ...RR.cleanEnv(env), GIT_CEILING_DIRECTORIES: c.scratch, GIT_TERMINAL_PROMPT: '0' };
  const pinned = [...RR.GIT_PINS, `--git-dir=${path.join(c.dir, '.git')}`, `--work-tree=${c.dir}`];
  const git = (args) => spawn('git', args, { env: genv, encoding: 'utf8', timeout: 600e3, cwd: c.scratch });
  const fail = (what, r) => ({ problem: `${what} failed: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}` });
  if (!fs.existsSync(c.dir)) {
    const r = git(['-c', 'safe.bareRepository=explicit', 'clone', '--quiet', '--no-checkout', '--', url, c.dir]);
    if (r.status !== 0) return fail(`clone of ${url}`, r);
  }
  for (const [what, args] of [[`fetch of ${sha}`, ['fetch', '--quiet', 'origin', sha]], [`checkout of ${sha}`, ['checkout', '--quiet', '--force', '--detach', `${sha}^{commit}`]], ['clean', ['clean', '-ffdxq']]]) {
    const r = git([...pinned, ...args]);
    if (r.status !== 0) return fail(what, r);
  }
  const at = String(git([...pinned, 'rev-parse', 'HEAD']).stdout || '').trim();
  if (at !== sha) return { problem: `the clone is at ${at || 'nothing'}, not the deployed ${sha}` };
  return { dir: c.dir, sha: at, url };
}

function run(who, store, bead, a, { cwd, env, now, spawn, verifyRecord }) {
  const wp = writerProblem(who, ['reality-checker']);
  if (wp) return refuse(wp.replace("the Delivery Manager's", "the Reality Checker's"));
  const n = Number(a.criterion);
  if (!Number.isInteger(n) || n < 1) return { code: 2, out: USAGE };
  const b = store.show(bead);
  if (!b) return refuse(`no bead ${bead}`);
  const m = b.metadata || {};
  const sha = String(m.deployed_sha || '');
  if (!SHA.test(sha)) return refuse(`${bead} has no full deployed sha (it has "${sha || 'none'}"): a check runs on a deploy recorded with the full sha (evidence.js state ${bead} deployed --sha <full sha>)`);
  const script = RC.readScript(who.root, bead);
  if (!script) return refuse(`no reality-check script for ${bead}: the Delivery Manager writes it (reality-check.js plan ${bead})`);
  if (!G.shaMatch(script.artifact && script.artifact.deployed_sha, sha)) return refuse(`the script is for ${(script.artifact && script.artifact.deployed_sha) || 'no deploy'}, not the deployed ${sha}: message the Delivery Manager to plan it again`);
  const group = (script.criteria || []).find((g) => g.criterion === n);
  if (!group) return refuse(`criterion ${n} is not in the script (${(script.criteria || []).map((g) => g.criterion).join(', ') || 'none'})`);
  const withCommand = (group.steps || []).filter((s) => typeof s.command === 'string' && s.command.trim());
  if (withCommand.length > 1) return refuse(`criterion ${n} has ${withCommand.length} steps with a command (steps ${withCommand.map((s) => s.n).join(', ')}): the runner runs exactly one, so none is silently ignored. The Delivery Manager keeps one command on the criterion (reality-check.js refine ${bead} --criterion ${n} --step <k> --command '<the one command>') and splits the rest into criteria`);
  const step = withCommand[0];
  if (!step) return refuse(`criterion ${n} has no step with a command: the Delivery Manager adds it (reality-check.js refine ${bead} --criterion ${n} --step 1 --command '<the command>' [--match '<pattern stdout must show>'])`);
  if (!who.roleDir) return refuse('not in a role directory, so the scratch area (verify/) is not known.');
  const minutes = Number(script.cap && script.cap.minutes) > 0 ? Number(script.cap.minutes) : RC.DEFAULT_CAP.minutes;
  // the run cap is checked before any checkout or spawn: an over-cap run executes nothing and leaves no capture
  const attempts = (script.cap && script.cap.attempts) || RC.DEFAULT_CAP.attempts;
  const spent = G.readEvidence(who.root, bead).filter((r) => r.type === 'row' && r.via === 'reality-check' && r.arm !== 'side' && Number(r.criterion) === n && G.shaMatch(r.sha, sha));
  if (spent.length >= attempts) return refuse(`criterion ${n} already has ${spent.length} run(s) on ${sha.slice(0, 12)}, the script's cap.\nStop and message the Delivery Manager: a new run needs a new deploy or a new script`);
  const co = checkoutDeployed({ roleDir: who.roleDir, team: who.team, sha, bead, env, spawn });
  if (co.problem) return refuse(co.problem);
  const started = Date.now();
  const r = spawn('/bin/sh', ['-c', step.command], { cwd: co.dir, env: RR.cleanEnv(env), encoding: 'utf8', timeout: minutes * 60e3, maxBuffer: 16 * 1024 * 1024 });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  const code = r.status === null ? null : r.status;
  const stdout = String(r.stdout || '');
  const clip = (t) => (t.length > CAPTURE_MAX ? `${t.slice(0, CAPTURE_MAX)}\n[truncated: ${t.length - CAPTURE_MAX} more characters not kept]\n` : t);
  let matched = true;
  if (step.match) { try { matched = new RegExp(step.match).test(stdout); } catch (err) { return refuse(`step ${step.n} has a match that is not a pattern (${err.message})`); } }
  const pass = !timedOut && code === 0 && matched;
  const why = timedOut ? `stopped after ${minutes} minutes` : code !== 0 ? `exit ${code === null ? 'by signal' : code}` : matched ? 'exit 0' : `exit 0 but stdout does not match /${step.match}/`;
  // the capture sits in the checker's own project clone, where its lane writes; run-record publishes it
  const base = path.join(who.roleDir, 'project');
  const dir = path.join(base, '.delivery', 'evidence', 'artifacts', bead);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `verify-c${n}-${sha.slice(0, 7)}-${Date.parse(now) || started}.txt`);
  fs.writeFileSync(file, [`$ ${step.command}`, `sha: ${co.sha}`, `repo: ${co.url}`, `at: ${now}`, `criterion: ${n} step ${step.n}`, step.match ? `match: /${step.match}/` : 'match: none', `result: ${pass ? 'pass' : 'fail'} (${why})`, '', '--- stdout ---', clip(stdout), '--- stderr ---', clip(String(r.stderr || '')), `--- exit ${code === null ? 'signal' : code} after ${Math.round((Date.now() - started) / 1000)}s ---`, ''].join('\n'));
  const rec = RC.main(['run-record', bead, '--criterion', String(n), '--result', pass ? 'pass' : 'fail', '--artifact', file, '--observed-version', co.sha], { cwd, env, bd: store, now, verifyRecord, who });
  return { code: rec.code, out: `verify-run.js: criterion ${n} of ${bead}: \`${step.command}\` in verify/${bead}-${sha.slice(0, 12)} at ${co.sha}: ${pass ? 'pass' : 'fail'} (${why})\n${rec.out}`, row: rec.row };
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, who: given, spawn = spawnSync, verifyRecord } = {}) {
  let a;
  try { a = parse(argv); } catch (err) { return { code: 2, out: `verify-run.js: ${err.message}\n${USAGE}` }; }
  const [cmd, id] = a._;
  if (cmd !== 'run' || !id || a._.length !== 2 || a.criterion === undefined) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env });
  if (!who.root) return { code: 2, out: 'verify-run.js: no project found; run it from the role directory' };
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  return run(who, store, id, a, { cwd, env, now: now || new Date().toISOString(), spawn, verifyRecord });
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `verify-run.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, checkoutDeployed };
