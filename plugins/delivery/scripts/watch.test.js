// scripts/watch.test.js — the polling budget (R-25), replayed on the Vault's Progress Observer, which polled
// 30 pull requests every 90 s, through the real lane (testing/role-harness.js) and through main().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WT = require('./lib/watch.js');
const { harness } = require('./testing/role-harness.js');
const watch = require('./watch.js');

const COS = 'chief-of-staff';
const DM = 'delivery-lead';
const fakeEnv = (h, more = {}) => ({ ...process.env, DELIVERY_ROLE: '', GH_FAKE_STORE: path.join(h.root, 'gh-store.json'), PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, ...more });
const scratchLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gh-log-')), 'calls.ndjson');
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('R-25 (the Observer polled 30 pull requests every 90 s): the watcher refuses intervals under 4 minutes and shares one read across roles', () => {
  const log = scratchLog();
  const prs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(471 + i), { headRefOid: 'abc' }]));
  prs['471'].state = 'MERGED';
  const h = harness({ prs });
  const w = (role, args) => h.bash(role, `${h.script('watch.js')} ${args}`);
  withEnv({ GH_FAKE_LOG: log }, () => {
    const fast = w('progress-observer', 'until MERGED --every 90s --max 2h -- gh pr view 472 -R example/example --json state');
    assert.equal(fast.code, 2, fast.deny || fast.out);
    assert.match(fast.out, /polling GitHub every 90 s is under the 4 min minimum; use --every 4m or more/);
    assert.match(w('progress-observer', 'until MERGED --every 5m -- gh pr view 472 -R example/example').out, /needs a time limit/);
    const noExit = w('progress-observer', '--every 5m --max 1h -- gh pr view 472 -R example/example');
    assert.ok(noExit.deny || noExit.code === 2, 'no exit condition');
    assert.match(watch.main(['until', '', '--every', '5m', '--max', '1h', '--', 'gh', 'pr', 'view', '1'], { cwd: os.tmpdir(), env: process.env }).out, /needs an exit condition/);
    assert.match(w('progress-observer', 'until x --every 5m --max 7h -- gh pr view 472 -R example/example').out, /over the 6 h limit/);
    assert.match(w('builder-1', 'gh pr merge 471 -R example/example').out, /only gh reads can be watched/);
    assert.equal(calls(log).length, 0, 'a refused watcher costs no call');
    // 30 pull requests read by the Observer and again by the Delivery Manager: one call each
    for (const role of ['progress-observer', DM]) for (const n of Object.keys(prs)) {
      assert.equal(watch.main(['gh', 'pr', 'view', n, '-R', 'example/example', '--json', 'state'], { cwd: h.roleDir(role), env: fakeEnv(h, { DELIVERY_ROLE: role, GH_FAKE_LOG: log }) }).code, 0);
    }
    assert.equal(w(DM, 'gh pr view 475 -R example/example --json state').code, 0, 'through the lane as well');
    assert.equal(calls(log).length, 30);
    assert.match(w(COS, 'gh pr view 480 -R example/example --json state').out, /from the team's cache, \d+ s old/);
    // a watcher within the budget ends on its exit condition
    const done = w('progress-observer', 'until MERGED --every 5m --max 1h -- gh pr view 471 -R example/example --json state');
    assert.equal(done.code, 0, done.out);
    assert.match(done.out, /^Done after 1 read/);
  });
});

test('R-25: the watcher stops at its time limit, re-reading only once the shared cache is two minutes old', () => {
  let t = 0;
  const reads = [];
  const r = watch.main(['until', 'MERGED', '--every', '4m', '--max', '15m', '--', 'gh', 'pr', 'view', '9'], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), env: { ...process.env, DELIVERY_ROLE: '' }, run: (a) => { reads.push(a); return { code: 0, out: '{"state":"OPEN"}' }; },
    sleep: (s) => { t += s * 1000; }, clock: () => t, now: () => t });
  assert.equal(r.code, 1);
  assert.match(r.out, /^Stopped at the time limit \(15m\) after 4 reads/);
  assert.equal(reads.length, 4);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  let n = 0;
  const run = () => { n++; return { code: 0, out: 'x' }; };
  WT.ghRead(root, ['pr', 'view', '1'], { run, now: 0 });
  assert.equal(WT.ghRead(root, ['pr', 'view', '1'], { run, now: 119e3 }).cached, true);
  WT.ghRead(root, ['pr', 'view', '1'], { run, now: 121e3 });
  assert.equal(n, 2);
  assert.equal(fs.readFileSync(path.join(root, '.delivery', 'cache', '.gitignore'), 'utf8'), '*\n');
});
