'use strict';
// hjx.1.5.4: a script run as the main module ran main() before it set module.exports, so a module it
// reached during main() that lazily required the script back (team-revive.js gather():
// require('./watchdog.js').liveSessions) got the half-built exports: every host job run logged "the missing
// role sessions were not checked (require(...).liveSessions is not a function)" and no session came back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = __dirname;
const HOOKS = path.join(__dirname, '..', 'hooks', 'scripts');
const WATCHDOG = path.join(SCRIPTS, 'watchdog.js');
const REVIVE = path.join(SCRIPTS, 'team-revive.js');

// Runs `script` as the main module with a preload that swaps lib/gate-context.js's whoAmI (which both
// scripts call inside main()) for one that makes the lazy requires the job makes, then exits: the
// requires happen while the main script is still running main(), as in the host job.
function asMain(script, argv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-exports-'));
  try {
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    const preload = path.join(dir, 'preload.js');
    fs.writeFileSync(preload, `
const GC = require(${JSON.stringify(path.join(SCRIPTS, 'lib', 'gate-context.js'))});
GC.whoAmI = () => {
  const out = {};
  try { out.live = require(${JSON.stringify(WATCHDOG)}).liveSessions(${JSON.stringify(bin)}, process.env); } catch (err) { out.live = 'error: ' + err.message; }
  try { out.revive = typeof require(${JSON.stringify(REVIVE)}).revive; } catch (err) { out.revive = 'error: ' + err.message; }
  try { out.roleContext = typeof require(${JSON.stringify(WATCHDOG)}).roleContext; } catch (err) { out.roleContext = 'error: ' + err.message; }
  process.stdout.write(JSON.stringify(out) + '\\n');
  process.exit(0);
};
`);
    const r = spawnSync(process.execPath, ['--require', preload, script, ...argv], { encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_OPTIONS: '' } });
    const line = String(r.stdout || '').trim().split('\n').pop();
    let out = null;
    try { out = JSON.parse(line); } catch (err) { out = { unparsed: r.stdout, status: r.status }; }
    return { out, stderr: String(r.stderr || '') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('hjx.1.5.4: watchdog.js run as main hands liveSessions to a module that requires it back, with no circular warning', () => {
  const { out, stderr } = asMain(WATCHDOG, ['check']);
  assert.deepEqual(out, { live: [], revive: 'function', roleContext: 'function' }, stderr);
  assert.doesNotMatch(stderr, /circular dependency/);
});

test('hjx.1.5.4: team-revive.js run as main, the other order, reads watchdog.js and itself whole', () => {
  const { out, stderr } = asMain(REVIVE, ['check']);
  assert.deepEqual(out, { live: [], revive: 'function', roleContext: 'function' }, stderr);
  assert.doesNotMatch(stderr, /circular dependency/);
});

// The class, not the one call site: any script with a main block that another module may require sets its
// exports before main() runs, so a lazy require reached from main() never sees them half-built.
// scripts/testing is scanned too: its runners (seal-check.js, sweep.js, run-tests.js) have main blocks and are
// required by tests. The last export assignment (module.exports = or module.exports.x =) counts, not the first.
test('hjx.1.5.4: every script with a main block sets module.exports before it runs main', () => {
  const files = [SCRIPTS, path.join(SCRIPTS, 'lib'), path.join(SCRIPTS, 'testing'), HOOKS]
    .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join(d, f)));
  const late = [];
  let checked = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const main = lines.findIndex((l) => /^if \(require\.main === module\)/.test(l));
    const exp = lines.findLastIndex((l) => /^module\.exports(\.\w+)?\s*=/.test(l));
    if (main < 0 || exp < 0) continue;
    checked++;
    if (exp > main) late.push(`${path.relative(path.join(SCRIPTS, '..'), f)}: exports at line ${exp + 1}, main at line ${main + 1}`);
  }
  assert.ok(checked >= 20, `the scan found the scripts (${checked})`);
  assert.deepEqual(late, []);
});

// Every lazy require of liveSessions names a module that exports it.
test('hjx.1.5.4: every require(...).liveSessions in the scripts resolves to an exported function', () => {
  const files = [SCRIPTS, path.join(SCRIPTS, 'lib'), HOOKS]
    .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join(d, f)));
  const sites = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\((['"])(\.{1,2}\/[^'"]+)\1\)\.liveSessions\b/g)) sites.push({ from: f, target: path.resolve(path.dirname(f), m[2]) });
  }
  assert.ok(sites.length >= 1, 'the call site in team-revive.js is found');
  for (const s of sites) assert.equal(typeof require(s.target).liveSessions, 'function', `${path.basename(s.from)} -> ${s.target}`);
});
