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
    assert.match(watch.main(['until', '', '--every', '5m', '--max', '1h', '--', 'gh', 'pr', 'view', '1'], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), env: process.env }).out, /needs an exit condition/);
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

test('R-25: the watcher stops at its time limit, re-reading only once the shared cache is four minutes old', () => {
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
  assert.equal(WT.ghRead(root, ['pr', 'view', '1'], { run, now: 239e3 }).cached, true, 'one read per 4 minutes for the team (R-25)');
  WT.ghRead(root, ['pr', 'view', '1'], { run, now: 241e3 });
  assert.equal(n, 2);
  assert.equal(fs.readFileSync(path.join(root, '.delivery', 'cache', '.gitignore'), 'utf8'), '*\n');
});

test('Copilot 305: a cached read is shared only for the same read on the same repository and host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  let n = 0;
  const run = () => { n++; return { code: 0, out: String(n) }; };
  const read = (args, more = {}) => WT.ghRead(root, args, { run, now: 0, ...more });
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-b-'));
  read(['pr', 'checks', '-R', 'o/one', '12']);
  assert.equal(read(['pr', 'checks', '-R', 'o/one', '12']).cached, true);
  assert.equal(read(['pr', 'checks', '-R', 'o/two', '12']).cached, false, 'another repository');
  assert.equal(read(['pr', 'checks', '-R', 'o/one', '12'], { env: { GH_HOST: 'ghe.example.com' } }).cached, false, 'another host');
  read(['pr', 'checks'], { cwd: a });
  assert.equal(read(['pr', 'checks'], { cwd: a }).cached, true);
  assert.equal(read(['pr', 'checks'], { cwd: b }).cached, false, 'without -R, each checkout resolves its own pull request');
  assert.equal(read(['pr', 'checks'], { cwd: b, env: { GH_REPO: 'o/one' } }).cached, false);
});

test('Copilot 349: gh\'s own polling flags are refused, so only watch.js until repeats a read', () => {
  for (const flags of [['--watch'], ['--watch', '--interval', '1'], ['-w'], ['-wi', '1'], ['--interval=1']]) {
    const r = watch.main(['gh', 'pr', 'checks', '471', ...flags], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), env: { ...process.env, DELIVERY_ROLE: '' }, run: () => ({ code: 0, out: '' }) });
    assert.equal(r.code, 2, flags.join(' '));
    assert.match(r.out, /gh's own polling .* is not allowed/);
  }
  assert.match(watch.main(['until', 'pass', '--every', '5m', '--max', '1h', '--', 'gh', 'pr', 'checks', '1', '--watch'], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), env: process.env }).out, /not allowed/);
});

test('Copilot 374: concurrent cold reads make one gh call; the others take its result', () => {
  const h = harness({ prs: { 471: { headRefOid: 'abc' } } });
  const log = scratchLog();
  const env = fakeEnv(h, { GH_FAKE_LOG: log, GH_FAKE_DELAY_MS: '400' });
  const { spawn } = require('child_process');
  const runs = Array.from({ length: 6 }, () => spawn('node', [path.join(__dirname, 'watch.js'), 'gh', 'pr', 'view', '471', '-R', 'example/example', '--json', 'state'], { cwd: h.root, env, stdio: ['ignore', 'pipe', 'ignore'] }));
  const outs = runs.map((c) => { let o = ''; c.stdout.on('data', (d) => { o += d; }); return new Promise((r) => c.on('exit', (code) => r({ code, o }))); });
  return Promise.all(outs).then((rs) => {
    assert.deepEqual(rs.map((r) => r.code), [0, 0, 0, 0, 0, 0]);
    for (const r of rs) assert.match(r.o, /"state":"OPEN"/);
    assert.equal(calls(log).length, 1);
  });
});

test('the cache drops entries older than an hour and keeps at most its cap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  const dir = WT.cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (let i = 0; i < WT.MAX_ENTRIES + 5; i++) { const f = path.join(dir, `e${i}.json`); fs.writeFileSync(f, '{}'); fs.utimesSync(f, (now - i * 1000) / 1000, (now - i * 1000) / 1000); }
  const stale = path.join(dir, 'old.json');
  fs.writeFileSync(stale, '{}');
  fs.utimesSync(stale, (now - 2 * 3600e3) / 1000, (now - 2 * 3600e3) / 1000);
  WT.prune(dir, now);
  // a fresh read prunes as it writes
  const old = path.join(dir, 'old2.json');
  fs.writeFileSync(old, '{}');
  fs.utimesSync(old, (now - 2 * 3600e3) / 1000, (now - 2 * 3600e3) / 1000);
  WT.ghRead(root, ['pr', 'view', '7'], { run: () => ({ code: 0, out: 'x' }), now, cwd: root });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, WT.MAX_ENTRIES);
});

test('Copilot 065: a failed or pending read is shared for its window too', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  let n = 0;
  const run = () => { n++; return { code: 8, out: 'some checks are still pending' }; };
  const a = WT.ghRead(root, ['pr', 'checks', '-R', 'o/r', '5'], { run, now: 0 });
  const b = WT.ghRead(root, ['pr', 'checks', '-R', 'o/r', '5'], { run, now: 200e3 });
  assert.equal(n, 1);
  assert.deepEqual([a.code, b.code, b.cached], [8, 8, true]);
  WT.ghRead(root, ['pr', 'checks', '-R', 'o/r', '5'], { run, now: 241e3 });
  assert.equal(n, 2);
});
