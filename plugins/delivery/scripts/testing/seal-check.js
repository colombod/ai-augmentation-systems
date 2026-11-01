#!/usr/bin/env node
// scripts/testing/seal-check.js — the proof that a test run leaves nothing in the host's /tmp, even
// when it is killed mid-way (hjx, dec-chief-of-staff-000014). Run it outside any sealed run (CI runs it
// as its own step): it starts run-tests.js on a fixture test that writes into /tmp and then waits,
// kills the runner with SIGKILL once the fixture is writing, and compares the host's /tmp before and
// after. Exit 0 when nothing is left; 1 with what was left; 2 when it cannot run here (no bwrap, or
// already inside a seal).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const R = require('./run-tests.js');

function main() {
  if (process.env.DELIVERY_SEAL_ACTIVE === '1') { console.error('seal-check: run it outside a sealed run'); return Promise.resolve(2); }
  if (!R.bwrapPath(process.env)) { console.error('seal-check: bubblewrap (bwrap) not found: a run cannot be sealed on this host'); return Promise.resolve(2); }
  const host = os.tmpdir();
  const before = new Set(fs.readdirSync(host));
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
    const poll = setInterval(() => {
      if (fs.existsSync(path.join(signal, 'ready')) || Date.now() - started > 30000) {
        clearInterval(poll);
        const wasReady = fs.existsSync(path.join(signal, 'ready'));
        runner.kill('SIGKILL');
        setTimeout(() => {
          fs.rmSync(signal, { recursive: true, force: true });
          const left = fs.readdirSync(host).filter((f) => !before.has(f));
          const markers = fs.readdirSync(host).filter((f) => f.startsWith('sealed-marker-'));
          if (!wasReady) { console.error('seal-check: the fixture never started writing; nothing proven'); return resolve(1); }
          if (left.length || markers.length) { console.error(`seal-check: FAILED, left in ${host}: ${[...new Set([...left, ...markers])].join(', ')}`); return resolve(1); }
          console.log(`seal-check: a run killed while writing 50 directories into /tmp left nothing in ${host}`);
          return resolve(0);
        }, 1500);
      }
    }, 200);
  });
}

if (require.main === module) main().then((code) => process.exit(code));
module.exports = { main };
