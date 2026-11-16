// scripts/lib/check-command.js — what can be told about a reality-check command before and after it runs
// (8l1.4.1.2), without running it here.
//
// Why: a check command was saved without ever running, so its first run was the real check on the
// deployed build, and a defect in the command itself became an andon on a product that was fine
// (ev-delivery-plugin-planning-8l1.4.1-1..3: DELIVERY_TEST_FILES named paths that exist only under the
// plugin root, the sealed runner found no test, and each run exited 1 in under a second). These checks
// are pure: refine (the Delivery Manager's, whose lane runs no product code) uses the path check and the
// pipe warning; verify-run.js (the Reality Checker's, which runs the command) uses the path check before
// the run and the zero-test check after it, and records neither outcome as a fail.
//   - a DELIVERY_TEST_FILES path that is not a file under the plugin root (a relative path counts only
//     after a cd that names where it runs: the check runs the command in another directory);
//   - a test run that reports zero tests;
//   - a command that ends in a pipe passes or fails on the last command's exit alone (a warning).
const fs = require('fs');
const path = require('path');

const ROOT_ENV = 'DELIVERY_PLUGIN_ROOT';
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

// whether the command runs tests: the plugin's sealed runner, or node's own test runner (rv-217 F2: only
// then can an empty run mean the command is wrong; any other command may print what it likes)
const RUNS_TESTS = /\brun-tests\.js\b|\bnode\b[^;&|\n]*\s--test\b/;
const runsTests = (command) => RUNS_TESTS.test(String(command));

// whether such a run found no test: the TAP summary says # tests 0, or node says it found no test file
// (rv-217 F1: "Could not find" a test file, or no test files)
const NONE_FOUND = /^#\s*tests\s+0\s*$|Could not find\b|\bno test files\b/im;
const zeroTests = (command, text) => runsTests(command) && NONE_FOUND.test(String(text));

const PIPE_WARNING = 'the command ends in a pipe, so its exit is the last command\'s alone and a pass rests on the match';

module.exports = { testFileProblems, endsInPipe, zeroTests, runsTests, PIPE_WARNING, ROOT_ENV };
