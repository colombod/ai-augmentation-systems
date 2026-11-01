#!/usr/bin/env node
// scripts/testing/seal-check.js — the proof that a test run leaves nothing in the host's /tmp, even
// when it is killed mid-way (hjx, dec-chief-of-staff-000014). Run it outside any sealed run (CI runs it
// as its own step): it starts run-tests.js on a fixture test that writes into /tmp and then waits,
// kills the runner with SIGKILL once the fixture is writing, and compares the host's /tmp before and
// after. Then it runs a command from a checkout under the host's /tmp in a fresh seal and checks that
// the checkout, and nothing else of /tmp, is visible. Exit 0 when both hold; 1 with what failed; 2 when
// it cannot run here (no bwrap, or already inside a seal).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const R = require('./run-tests.js');

// pids whose command line names this file (host-visible, whatever pid namespace they run in)
function running(file) {
  const out = [];
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { if (fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').includes(file)) out.push(p); } catch (e) { /* gone */ }
  }
  return out;
}

// A product checkout under the host's /tmp (a review clone, a CI workspace) stays visible in a fresh
// seal, while the rest of the host's /tmp stays hidden (Copilot on #117): the runner binds the
// directory it runs in back over its private /tmp.
function checkoutVisible() {
  const dir = fs.mkdtempSync(path.join('/tmp', 'seal-check-checkout-'));
  try {
    fs.writeFileSync(path.join(dir, 'marker'), 'checkout\n');
    const env = { ...process.env };
    delete env.DELIVERY_SEAL_ACTIVE;
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-tests.js'), '--', 'cat marker && ls -A /tmp'], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
    const lines = String(r.stdout || '').trim().split('\n');
    if (r.status !== 0 || lines[0] !== 'checkout') { console.error(`seal-check: FAILED, a checkout under /tmp is not visible in a fresh seal (exit ${r.status}): ${String(r.stderr || '').slice(-300)}`); return 1; }
    // what the seal may show of /tmp: the top-level entries of the paths the runner keeps, this
    // checkout and the plugin itself when it lives under /tmp too (Copilot on #117); nothing else
    const expected = [...new Set(R.keepPaths([dir, path.join(__dirname, '..', '..')]).map((p) => p.split('/')[2]))].sort();
    const seen = lines.slice(1).filter(Boolean).sort();
    if (seen.join(' ') !== expected.join(' ')) { console.error(`seal-check: FAILED, the seal shows ${seen.join(' ') || 'nothing'} of the host's /tmp, not just ${expected.join(' ')}`); return 1; }
    console.log('seal-check: a checkout under /tmp is visible in a fresh seal, and nothing else of the host\'s /tmp is');
    return 0;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function main() {
  if (process.env.DELIVERY_SEAL_ACTIVE && process.env.DELIVERY_SEAL_ACTIVE !== '0') { console.error('seal-check: run it outside a sealed run'); return Promise.resolve(2); }
  if (!R.bwrapPath(process.env)) { console.error('seal-check: bubblewrap (bwrap) not found: a run cannot be sealed on this host'); return Promise.resolve(2); }
  // the host's /tmp itself, whatever TMPDIR says: it is the mount the seal hides
  const host = '/tmp';
  // the fixture and its ready signal live outside /tmp, which the sealed run cannot see: a directory
  // beside this check, created here and removed at the end
  const signal = fs.mkdtempSync(path.join(__dirname, '.seal-check-'));
  const marker = `sealed-marker-${process.pid}-${Date.now()}`;
  const fixture = path.join(signal, 'writes-and-waits.test.js');
  fs.writeFileSync(fixture, `const test = require('node:test');
const fs = require('fs');
const path = require('path');
test('writes into /tmp and waits', async () => {
  for (let i = 0; i < 50; i++) fs.mkdirSync(path.join('/tmp', ${JSON.stringify(marker)} + '-' + i), { recursive: true });
  fs.writeFileSync(${JSON.stringify(path.join(signal, 'ready'))}, 'ready');
  await new Promise((r) => setTimeout(r, 60000));
});
`);
  const runner = spawn(process.execPath, [path.join(__dirname, 'run-tests.js')], { env: { ...process.env, DELIVERY_TEST_FILES: fixture }, stdio: 'ignore' });
  return new Promise((resolve) => {
    const started = Date.now();
    // a runner that cannot start (EAGAIN under process pressure) emits 'error', not 'exit': stop
    // polling, remove the fixture directory and fail with the reason (Copilot on #111)
    runner.on('error', (err) => {
      clearInterval(poll);
      fs.rmSync(signal, { recursive: true, force: true });
      console.error(`seal-check: could not start run-tests.js (${err.message}); nothing proven`);
      resolve(1);
    });
    const poll = setInterval(() => {
      if (fs.existsSync(path.join(signal, 'ready')) || Date.now() - started > 30000) {
        clearInterval(poll);
        const wasReady = fs.existsSync(path.join(signal, 'ready'));
        const aliveBefore = running(fixture);
        runner.kill('SIGKILL');
        setTimeout(() => {
          // the sandbox died with its parent: no process still runs the fixture (an unchanged /tmp alone
          // would not prove it; a live sandbox hides its files too)
          const aliveAfter = running(fixture);
          fs.rmSync(signal, { recursive: true, force: true });
          // this invocation's own markers only: other processes may use /tmp meanwhile
          const markers = fs.readdirSync(host).filter((f) => f.startsWith(marker));
          if (!wasReady || !aliveBefore.length) { console.error('seal-check: the fixture never started writing; nothing proven'); return resolve(1); }
          if (aliveAfter.length) { console.error(`seal-check: FAILED, the sandboxed run outlived its killed parent (pids ${aliveAfter.join(', ')})`); for (const p of aliveAfter) { try { process.kill(Number(p), 'SIGKILL'); } catch (e) { /* gone */ } } return resolve(1); }
          if (markers.length) { console.error(`seal-check: FAILED, ${markers.length} of this run's markers left in ${host}`); return resolve(1); }
          console.log(`seal-check: a run killed while writing 50 directories into /tmp died with its parent and left nothing in ${host}`);
          return resolve(checkoutVisible());
        }, 2500);
      }
    }, 200);
  });
}

if (require.main === module) main().then((code) => process.exit(code));
module.exports = { main, checkoutVisible };
