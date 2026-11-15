// scripts/lib/check-command.js — the first run of a reality-check command, at refine (8l1.4.1.2).
//
// Why: a check command used to be saved without ever running, so its first run was the real check on the
// deployed build, and a defect in the command itself became an andon on a product that was fine
// (ev-delivery-plugin-planning-8l1.4.1-1..3: DELIVERY_TEST_FILES named paths that exist only under the
// plugin root, the sealed runner found no test, and each run exited 1 in under a second). refine now runs
// each new command once against the installed plugin and refuses, before it is saved:
//   - a DELIVERY_TEST_FILES path that is not a file under the plugin root (a relative path counts only
//     after a cd that names where it runs: the check runs the command in another directory);
//   - a test run that reports zero tests.
// What it ran, its last lines, and whether the match holds are printed either way. A command that ends in
// a pipe passes or fails on the last command's exit alone, so that is a warning.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_ENV = 'DELIVERY_PLUGIN_ROOT';
const DRY_MINUTES = 10;
const TAIL_LINES = 8;
const WORD = String.raw`"([^"]*)"|'([^']*)'|([^\s;&|()<>]+)`;
const unq = (m, at) => (m[at] !== undefined ? m[at] : m[at + 1] !== undefined ? m[at + 1] : m[at + 2]);

// ${DELIVERY_PLUGIN_ROOT} and $DELIVERY_PLUGIN_ROOT filled in; null when another variable is left
function expand(text, pluginRoot) {
  const out = String(text).replace(/\$\{DELIVERY_PLUGIN_ROOT\}|\$DELIVERY_PLUGIN_ROOT\b/g, pluginRoot);
  return /\$/.test(out) ? null : out;
}

// a path's real location, or its resolved one when it does not exist
function real(p) { try { return fs.realpathSync(p); } catch (err) { return path.resolve(p); } }

// Each DELIVERY_TEST_FILES path the command names that is not a file under the plugin root, as a line
function testFileProblems(command, pluginRoot) {
  const text = String(command);
  const root = real(pluginRoot);
  const out = [];
  const assign = new RegExp(String.raw`\bDELIVERY_TEST_FILES=(?:${WORD})`, 'g');
  let m;
  while ((m = assign.exec(text))) {
    const before = text.slice(0, m.index);
    const cds = [...before.matchAll(new RegExp(String.raw`(?:^|[\s;&|(])cd\s+(?:${WORD})`, 'g'))];
    const cd = cds.length ? unq(cds[cds.length - 1], 1) : null;
    for (const p of String(unq(m, 1)).split(':').filter(Boolean)) {
      const e = expand(p, pluginRoot);
      if (e === null) { out.push(`${p} names a variable other than \${${ROOT_ENV}}, so where it points cannot be checked`); continue; }
      let abs = null;
      if (path.isAbsolute(e)) abs = e;
      else if (cd !== null) { const d = expand(cd, pluginRoot); abs = d === null ? null : path.resolve(d, e); }
      if (abs === null) { out.push(`${p} is relative and no cd before it names where it runs (the check runs the command elsewhere): name it \${${ROOT_ENV}}/${e}`); continue; }
      const r = real(abs);
      if (r !== root && !r.startsWith(root + path.sep)) { out.push(`${p} is not under the plugin root (${pluginRoot})`); continue; }
      let isFile = false;
      try { isFile = fs.statSync(r).isFile(); } catch (err) { isFile = false; }
      if (!isFile) out.push(`${p} is not a file under the plugin root (${pluginRoot})`);
    }
  }
  return out;
}

// whether the command's last top-level step is the end of a pipeline (a | outside quotes, not ||, with
// no ; && || after it)
function endsInPipe(command) {
  const t = String(command);
  let q = null;
  let lastPipe = -1;
  let lastSep = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '|' && t[i + 1] === '|') { lastSep = i; i++; continue; }
    if (c === '&' && t[i + 1] === '&') { lastSep = i; i++; continue; }
    if (c === ';' || c === '\n') { lastSep = i; continue; }
    if (c === '|') lastPipe = i;
  }
  return lastPipe > lastSep;
}

// The TAP summary of a node test run says how many tests ran
const zeroTests = (text) => /^#\s*tests\s+0\s*$/m.test(text);

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// Runs the command once: in a scratch directory of its own, inside the plugin's sealed runner (a check
// command often runs tests, and a test run outside the seal leaves its fixtures in the host's shared
// /tmp), with the role's variables cleared and DELIVERY_PLUGIN_ROOT naming the installed plugin, as
// verify-run.js runs it, under a time cap. The runner clears every DELIVERY_ variable, so the root is
// exported in the shell line it runs. { code, timedOut, stdout, stderr, matched, zero, tail, problems, warnings }
function dryRun(command, match, { pluginRoot, env = process.env, minutes = DRY_MINUTES, spawn = require('child_process').spawnSync } = {}) {
  const problems = testFileProblems(command, pluginRoot);
  const warnings = [];
  if (endsInPipe(command)) warnings.push('the command ends in a pipe, so its exit is the last command\'s alone and a pass rests on the match');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-dry-'));
  let r;
  try {
    const clean = require('../review-run.js').cleanEnv(env);
    // inside a seal already (this plugin's own tests), the runner must know it, or it opens a second
    // sandbox the host refuses: that is this process's fact, whatever env the caller passed
    if (process.env.DELIVERY_SEAL_ACTIVE && !clean.DELIVERY_SEAL_ACTIVE) clean.DELIVERY_SEAL_ACTIVE = process.env.DELIVERY_SEAL_ACTIVE;
    const runner = path.join(pluginRoot, 'scripts', 'testing', 'run-tests.js');
    const line = `${ROOT_ENV}=${shq(pluginRoot)}; export ${ROOT_ENV}\n${command}`;
    r = spawn(process.execPath, [runner, '--', line], { cwd: dir, env: clean, encoding: 'utf8', timeout: minutes * 60e3, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  const code = r.status === null || r.status === undefined ? null : r.status;
  let matched = null;
  if (match) { try { matched = new RegExp(match).test(stdout); } catch (err) { matched = null; } }
  const zero = zeroTests(`${stdout}\n${stderr}`);
  if (zero) problems.push('the test run it starts reports zero tests (# tests 0): its test file paths are not where it runs them');
  if (timedOut) warnings.push(`it did not finish within ${minutes} minutes`);
  else if (code !== 0) warnings.push(`it exits ${code === null ? 'by a signal' : code} on the installed plugin`);
  if (matched === false) warnings.push(`its output on the installed plugin does not match /${match}/`);
  const tail = (stdout.trim() ? stdout : stderr).trimEnd().split('\n').slice(-TAIL_LINES);
  return { code, timedOut, stdout, stderr, matched, zero, tail, problems, warnings };
}

// The lines refine prints for one dry run
function report(label, r, match) {
  const lines = [`${label}: ran it once on the installed plugin: ${r.timedOut ? 'stopped at the time cap' : `exit ${r.code === null ? 'by a signal' : r.code}`}${match ? `, match /${match}/ ${r.matched ? 'holds' : 'does not hold'}` : ''}; last lines:`];
  for (const l of r.tail) lines.push(`  | ${l}`);
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines;
}

module.exports = { dryRun, report, testFileProblems, endsInPipe, zeroTests, DRY_MINUTES };
