// scripts/lib/amplifier.test.js — run with: node --test scripts/lib/amplifier.test.js
// The owner's ruling (2026-10-28): a session on a machine with Microsoft Amplifier leans on it first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./amplifier.js');
const CLI = require('../amplifier.js');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'scripts', 'role-session-start.js');

// a PATH directory holding fake executables: { name: shell body }
function fakeBin(tools) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-bin-'));
  for (const [name, body] of Object.entries(tools)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(f, 0o755);
  }
  return dir;
}
const envWith = (dir) => ({ PATH: `${dir}:/usr/bin:/bin` });
const realRun = (cmd, args) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), err: '' }; } catch (err) { return { ok: false, out: String(err.stdout || ''), err: String(err.stderr || '') }; }
};

test('without Amplifier on PATH: no hint, no check rows, detect exits 3', () => {
  const env = envWith(fakeBin({}));
  assert.equal(A.sessionHint(env, 'linux'), '');
  const d = A.detect({ env, platform: 'linux', run: realRun });
  assert.equal(d.amplifier, null);
  assert.deepEqual(A.checkRows(d), []);
  let out = '';
  assert.equal(CLI.main(['detect'], { env, platform: 'linux', runner: realRun, write: (s) => { out += s; } }), 3);
  assert.match(out, /not installed on this machine/);
});

test('a file named amplifier that is not executable is not Amplifier', () => {
  const dir = fakeBin({});
  fs.writeFileSync(path.join(dir, 'amplifier'), 'not a program');
  fs.chmodSync(path.join(dir, 'amplifier'), 0o644);
  assert.equal(A.onPath('amplifier', envWith(dir), 'linux'), null);
});

test('with Amplifier: every session starts knowing to lean on it, and names the skill', () => {
  const env = envWith(fakeBin({ amplifier: 'echo amplifier 2026.10.1', 'amplifier-work-tracker': 'exit 0' }));
  const hint = A.sessionHint(env, 'linux');
  assert.match(hint, /Microsoft Amplifier and amplifier-work-tracker is installed on this machine/);
  assert.match(hint, /delivery:amplifier skill before changing anything yourself/);
  assert.match(hint, /never read a credential file/);
  assert.equal(hint.split('\n').filter(Boolean).length, 1, 'one line: it is in every session\'s context');
});

// the state found on Wintermute: the work-tracker's own doctor refused by its Dolt server
test('a failing work-tracker doctor is a warning whose fix is Amplifier, not a hand repair; a passing one is a pass', () => {
  const failing = envWith(fakeBin({
    amplifier: 'echo amplifier 2026.10.1',
    'amplifier-work-tracker': 'echo "amplifier-work-tracker: bd init failed: Error 1045 (28000): Access denied for user \'root\'" >&2; exit 1',
  }));
  const d = A.detect({ env: failing, platform: 'darwin', run: realRun });
  assert.equal(d.version, 'amplifier 2026.10.1');
  assert.equal(d.doctor.ok, false);
  const rows = A.checkRows(d);
  assert.equal(rows[0].status, 'pass');
  assert.match(rows[0].detail, /host problems go to it first/);
  assert.equal(rows[1].status, 'warn');
  assert.match(rows[1].detail, /doctor fails: .*Error 1045/);
  assert.match(rows[1].fix, /ask Amplifier to fix its own setup/);
  assert.ok(rows.every((r) => r.hard === false), 'Amplifier is never a prerequisite');

  const passing = envWith(fakeBin({ amplifier: 'echo amplifier 2026.10.1', 'amplifier-work-tracker': 'echo ok' }));
  const p = A.checkRows(A.detect({ env: passing, platform: 'darwin', run: realRun }));
  assert.equal(p[1].status, 'pass');
  assert.match(p[1].detail, /doctor passes/);
  let out = '';
  assert.equal(CLI.main(['detect', '--json'], { env: passing, platform: 'darwin', runner: realRun, write: (s) => { out += s; } }), 0);
  assert.equal(JSON.parse(out).doctor.ok, true);
});

test('detect never starts an Amplifier agent: only --version and the work-tracker doctor run', () => {
  const calls = [];
  const env = envWith(fakeBin({ amplifier: 'exit 0', 'amplifier-work-tracker': 'exit 0' }));
  A.detect({ env, platform: 'linux', run: (cmd, args) => { calls.push([path.basename(cmd), ...args].join(' ')); return { ok: true, out: '', err: '' }; } });
  assert.deepEqual(calls, ['amplifier --version', 'systemctl --user is-active amplifier-work-tracker.service', 'amplifier-work-tracker doctor --quick']);
});

// the hook runs in every session, role or not: Wintermute's own session is not a role
test('the SessionStart hook gives a non-role session the hint where Amplifier is installed, and nothing where it is not', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-cwd-'));
  const hook = (env) => execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd, hook_event_name: 'SessionStart', source: 'startup' }), env: { ...env, HOME: cwd }, encoding: 'utf8' });
  assert.match(hook(envWith(fakeBin({ amplifier: 'exit 0' }))), /^Microsoft Amplifier is installed on this machine/);
  assert.equal(hook(envWith(fakeBin({}))), '');
});
