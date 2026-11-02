// scripts/testing/sweep.test.js — run through scripts/testing/run-tests.js. The suite's /tmp is the seal's
// own tmpfs, so the fixtures below sit directly in /tmp, where the sweep reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const S = require('./sweep.js');

const HOURS_AGO = (Date.now() - 2 * 3600e3) / 1000;
function aged(p) {
  // the whole tree is old: the sweep reads the newest change anywhere under an entry
  const walk = (q) => { if (fs.lstatSync(q).isDirectory()) for (const x of fs.readdirSync(q)) walk(path.join(q, x)); fs.lutimesSync ? fs.lutimesSync(q, HOURS_AGO, HOURS_AGO) : fs.utimesSync(q, HOURS_AGO, HOURS_AGO); };
  walk(p);
}
const DEAD = 2147483646; // no such process
const dead = () => false;

// dec-chief-of-staff-000211, review of #126: only what a run recorded when it made it goes, never a name match
test('sweep removes only old directories in /tmp that a finished run recorded, and forgets them', () => {
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-'));
  const registry = path.join(work, 'reg.ndjson');
  const made = [];
  const mk = (prefix, { old = true, file = false, rec = true, pid = DEAD } = {}) => {
    const p = file ? path.join(S.TMP, `${prefix}-file-${process.pid}`) : fs.mkdtempSync(path.join(S.TMP, `${prefix}-`));
    made.push(p);
    if (file) fs.writeFileSync(p, 'x');
    else fs.writeFileSync(path.join(p, 'team.json'), '{}');
    if (old) aged(p);
    if (rec) S.record(p, { registry, pid });
    return p;
  };
  const savedTmpdir = process.env.TMPDIR;
  try {
    const gone = [mk('delivery-tests'), mk('stop-nobd')];
    const kept = [
      mk('home', { rec: false }), // another tool's directory with a fixture-like name: never recorded
      mk('delivery-tests', { old: false }), // changed within the hour
      mk('delivery-tests', { pid: process.pid }), // the run that recorded it is still going
    ];
    const notDir = mk('delivery-tests', { file: true }); // a file, not a directory
    const nested = path.join(kept[0], 'deep');
    fs.mkdirSync(nested);
    aged(kept[0]);
    S.record(nested, { registry, pid: DEAD }); // never below the top level of /tmp
    // a recorded path elsewhere stays, also when TMPDIR points there: the sweep reads /tmp only
    const elsewhere = fs.mkdtempSync(path.join(work, 'delivery-tests-'));
    aged(elsewhere);
    S.record(elsewhere, { registry, pid: DEAD });
    // a recorded name that is now a symlink to a directory: not followed, and its target stays
    const target = fs.mkdtempSync(path.join(work, 'target-'));
    fs.writeFileSync(path.join(target, 'keep'), 'x');
    const link = path.join(S.TMP, `delivery-tests-link-${process.pid}`);
    fs.symlinkSync(target, link);
    made.push(link);
    aged(target);
    aged(link);
    S.record(link, { registry, pid: DEAD });
    const vanished = path.join(S.TMP, `delivery-tests-gone-${process.pid}`);
    S.record(vanished, { registry, pid: DEAD });
    process.env.TMPDIR = work;

    const dry = S.sweep({ registry, dryRun: true });
    assert.deepEqual(dry.removed.sort(), gone.slice().sort());
    for (const p of gone) assert.ok(fs.existsSync(p), 'a dry run removes nothing');
    assert.equal(S.entries(registry).length, 9, 'a dry run forgets nothing');
    assert.deepEqual(S.sweep({ registry, uid: 424242 }).removed, [], 'another user\'s directories are never touched');

    const r = S.sweep({ registry });
    assert.deepEqual(r.removed.sort(), gone.slice().sort());
    assert.deepEqual(r.failed, []);
    for (const p of gone) assert.ok(!fs.existsSync(p), p);
    for (const p of [...kept, notDir, nested, elsewhere, link]) assert.ok(fs.existsSync(p), p);
    assert.ok(fs.existsSync(path.join(target, 'keep')), 'a symlink is not followed');
    const left = S.entries(registry).map((e) => e.path);
    for (const p of [...gone, vanished]) assert.ok(!left.includes(p), `forgotten: ${p}`);
    // what can never be removed is forgotten, so the registry stays bounded; what may yet pass stays
    for (const p of [notDir, nested, elsewhere, link]) assert.ok(!left.includes(p), `never removable, forgotten: ${p}`);
    assert.deepEqual(left.sort(), [kept[1], kept[2]].sort(), 'a young directory and a live run\'s stay recorded');
    assert.match(S.summary(r, false), /^sweep: removed 2 test leftover\(s\) from \/tmp: /);
    assert.equal(S.summary({ removed: [], failed: [] }, false), 'sweep: no test leftovers in /tmp');
  } finally {
    if (savedTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmpdir;
    for (const p of made) fs.rmSync(p, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('the registry lives in the user\'s state directory unless a run names one', () => {
  assert.equal(S.registryPath({ DELIVERY_TMP_REGISTRY: '/x/r.ndjson' }), '/x/r.ndjson');
  assert.equal(S.registryPath({ XDG_STATE_HOME: '/s' }), path.join('/s', 'delivery', 'tmp-created.ndjson'));
  assert.equal(S.registryPath({}), path.join(os.homedir(), '.local', 'state', 'delivery', 'tmp-created.ndjson'));
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-reg-'));
  try {
    const registry = path.join(work, 'deep', 'reg.ndjson');
    S.record('/tmp/a-AAAAAA', { registry, pid: 7, now: Date.parse('2026-11-02T00:00:00Z') });
    fs.appendFileSync(registry, '{"torn\n');
    S.record('/tmp/b-BBBBBB', { registry, pid: 8 });
    assert.deepEqual(S.entries(registry).map((e) => [e.path, e.pid]), [['/tmp/a-AAAAAA', 7], ['/tmp/b-BBBBBB', 8]]);
    assert.equal(S.entries(registry)[0].at, '2026-11-02T00:00:00.000Z');
    S.forget(['/tmp/a-AAAAAA'], { registry });
    assert.deepEqual(S.entries(registry).map((e) => e.path), ['/tmp/b-BBBBBB']);
    assert.deepEqual(S.entries(path.join(work, 'none')), []);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// the runner records its directory when it makes it and forgets it when it removes it; killed first, the
// record stays, and the sweep removes the directory once the run is gone
test('a run records its directory, forgets it at the end, and a killed run\'s directory is swept', { skip: !process.env.DELIVERY_SEAL_ACTIVE && 'needs the suite\'s own seal' }, async () => {
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-run-'));
  const registry = path.join(work, 'reg.ndjson');
  const ready = path.join(work, 'ready');
  const fixture = path.join(work, 'waits.test.js');
  fs.writeFileSync(fixture, `require('node:test')('waits', async () => { require('fs').writeFileSync(${JSON.stringify(ready)}, require('os').tmpdir() + '\\n' + process.pid); await new Promise((r) => setTimeout(r, 60000)); });\n`);
  const env = { ...process.env, TMPDIR: S.TMP, DELIVERY_TMP_REGISTRY: registry, DELIVERY_TEST_FILES: fixture };
  delete env.NODE_TEST_CONTEXT;
  const runner = path.join(__dirname, 'run-tests.js');
  try {
    const done = spawn(process.execPath, [runner, '--', 'true'], { env, stdio: 'ignore' });
    assert.equal(await new Promise((r) => done.on('exit', r)), 0);
    assert.deepEqual(S.entries(registry), [], 'a finished run forgets its directory');

    const killed = spawn(process.execPath, [runner], { env, stdio: 'ignore' });
    const started = Date.now();
    while (!fs.existsSync(ready) && Date.now() - started < 30000) await new Promise((r) => setTimeout(r, 100));
    const [dir, fixturePid] = fs.readFileSync(ready, 'utf8').split('\n');
    assert.equal(path.dirname(dir), S.TMP);
    assert.deepEqual(S.entries(registry).map((e) => [e.path, e.pid]), [[dir, killed.pid]]);
    assert.deepEqual(S.sweep({ registry, now: Date.now() + 2 * 3600e3 }).removed, [], 'not while its run is going');
    killed.kill('SIGKILL');
    await new Promise((r) => killed.on('exit', r));
    // the suite runs detached from the runner, so it outlives it here; stopped by hand
    try { process.kill(Number(fixturePid), 'SIGKILL'); } catch (e) { /* gone */ }
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(fs.existsSync(dir), 'the killed run left its directory');
    assert.deepEqual(S.sweep({ registry, now: Date.now() + 2 * 3600e3 }).removed, [dir]);
    assert.ok(!fs.existsSync(dir));
    assert.deepEqual(S.entries(registry), []);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// review of #126: a forget that rewrites the registry while runs record must lose none of their lines,
// or those directories are never swept
test('runs recording while the registry is rewritten lose no line', async () => {
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-race-'));
  const registry = path.join(work, 'reg.ndjson');
  const N = 4;
  const EACH = 60;
  const kids = [];
  try {
    for (let k = 0; k < N; k += 1) {
      const code = `const S = require(${JSON.stringify(path.join(__dirname, 'sweep.js'))}); for (let i = 0; i < ${EACH}; i += 1) S.record('/tmp/race-${k}-' + i, { registry: ${JSON.stringify(registry)} }); require('fs').writeFileSync(${JSON.stringify(path.join(work, `done-${k}`))}, '');`;
      kids.push(spawn(process.execPath, ['-e', code], { stdio: 'inherit' }));
    }
    const exits = kids.map((c) => new Promise((r) => c.on('exit', r)));
    const started = Date.now();
    let rewrites = 0;
    while (fs.readdirSync(work).filter((f) => f.startsWith('done-')).length < N && Date.now() - started < 60000) {
      S.forget(['/tmp/not-recorded'], { registry });
      rewrites += 1;
    }
    assert.deepEqual(await Promise.all(exits), new Array(N).fill(0));
    assert.ok(rewrites > 1, 'the registry was rewritten while the runs recorded');
    assert.equal(new Set(S.entries(registry).map((e) => e.path)).size, N * EACH, 'every recorded line survives');
    assert.ok(!fs.existsSync(`${registry}.lock`), 'the lock is released');
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a lock left by a run that died is taken over; a live holder is waited for, then refused', () => {
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-lock-'));
  const registry = path.join(work, 'reg.ndjson');
  const lock = `${registry}.lock`;
  try {
    fs.writeFileSync(lock, String(DEAD));
    S.record('/tmp/a-AAAAAA', { registry });
    assert.deepEqual(S.entries(registry).map((e) => e.path), ['/tmp/a-AAAAAA']);
    assert.ok(!fs.existsSync(lock));

    fs.writeFileSync(lock, String(process.pid)); // a live holder
    const t0 = Date.now();
    assert.throws(() => S.record('/tmp/b-BBBBBB', { registry, waitMs: 300 }), /locked by process/);
    assert.ok(Date.now() - t0 >= 300, 'it waited for the holder');
    assert.throws(() => S.forget(['/tmp/a-AAAAAA'], { registry, waitMs: 100 }), /locked by process/);
    assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid), 'a live holder\'s lock is never taken');
    assert.deepEqual(S.entries(registry).map((e) => e.path), ['/tmp/a-AAAAAA'], 'nothing written without the lock');
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// review of #126: the sweep reads /tmp only, so a run whose temp dir is elsewhere (TMPDIR on macOS) records
// nothing, and the registry does not grow with paths it can never act on
test('a run whose temp directory is not directly in /tmp records nothing', { skip: !process.env.DELIVERY_SEAL_ACTIVE && 'needs the suite\'s own seal' }, async () => {
  const work = fs.mkdtempSync(path.join(__dirname, '.sweep-else-'));
  const registry = path.join(work, 'reg.ndjson');
  const ready = path.join(work, 'ready');
  const fixture = path.join(work, 'waits.test.js');
  const elsewhere = fs.mkdtempSync(path.join(S.TMP, 'macos-like-'));
  fs.writeFileSync(fixture, `require('node:test')('waits', async () => { require('fs').writeFileSync(${JSON.stringify(ready)}, require('os').tmpdir() + '\\n' + process.pid); await new Promise((r) => setTimeout(r, 60000)); });\n`);
  const env = { ...process.env, TMPDIR: elsewhere, DELIVERY_TMP_REGISTRY: registry, DELIVERY_TEST_FILES: fixture };
  delete env.NODE_TEST_CONTEXT;
  const runner = path.join(__dirname, 'run-tests.js');
  let fixturePid = null;
  const run = spawn(process.execPath, [runner], { env, stdio: 'ignore' });
  try {
    const started = Date.now();
    while (!fs.existsSync(ready) && Date.now() - started < 30000) await new Promise((r) => setTimeout(r, 100));
    const [dir, pid] = fs.readFileSync(ready, 'utf8').split('\n');
    fixturePid = Number(pid);
    assert.equal(path.dirname(dir), elsewhere, 'the run made its directory where TMPDIR says');
    assert.deepEqual(S.entries(registry), [], 'and did not record it');
  } finally {
    run.kill('SIGKILL');
    if (fixturePid) { try { process.kill(fixturePid, 'SIGKILL'); } catch (e) { /* gone */ } }
    fs.rmSync(elsewhere, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
