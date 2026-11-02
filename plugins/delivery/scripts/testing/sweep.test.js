// scripts/testing/sweep.test.js — run through scripts/testing/run-tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./sweep.js');

const HOUR_AGO = (Date.now() - 2 * 3600e3) / 1000;
function aged(p) {
  // the whole tree is old: the sweep reads the newest change anywhere under an entry
  const walk = (q) => { if (fs.lstatSync(q).isDirectory()) for (const x of fs.readdirSync(q)) walk(path.join(q, x)); fs.lutimesSync ? fs.lutimesSync(q, HOUR_AGO, HOUR_AGO) : fs.utimesSync(q, HOUR_AGO, HOUR_AGO); };
  walk(p);
}
function fixture(name, { old = true, file = false } = {}, dir) {
  const p = path.join(dir, name);
  if (file) fs.writeFileSync(p, 'x');
  else { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'team.json'), '{}'); }
  if (old) aged(p);
  return p;
}

// dec-chief-of-staff-000211: only the plugin's own test leftovers go, and only once nothing touches them
test('sweep removes old fixture directories of the plugin\'s own prefixes and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, '.sweep-'));
  const outside = fs.mkdtempSync(path.join(__dirname, '.sweep-target-'));
  try {
    const gone = [fixture('stop-nobd-AbC123', {}, dir), fixture('opcli-chief-of-staff-xY12Zq', {}, dir), fixture('relay-tr-QQ11ww', {}, dir)];
    const kept = [
      fixture('stop-nobd-Young1', { old: false }, dir), // a run may still be using it
      fixture('stop-nobd-File12', { file: true }, dir), // not a directory
      fixture('zzqqx-AbC123', {}, dir), // not one of the plugin's prefixes
      fixture('stop-nobd-TooLong1', {}, dir), // not mkdtemp's six characters
      fixture('delivery-watch-1000', {}, dir), // a live watcher's state
    ];
    fs.writeFileSync(path.join(outside, 'keep'), 'x');
    fs.symlinkSync(outside, path.join(dir, 'stop-nobd-Link12'));
    aged(path.join(dir, 'stop-nobd-Link12'));
    fs.mkdirSync(path.join(dir, 'nested'));
    kept.push(fixture('stop-nobd-Deep12', {}, path.join(dir, 'nested'))); // never below the top level
    const youngInside = fixture('stop-team-Inner1', {}, dir);
    fs.writeFileSync(path.join(youngInside, 'fresh'), 'x'); // one file still being written
    kept.push(youngInside);

    const dry = S.sweep({ dirs: [dir], dryRun: true });
    assert.deepEqual(dry.removed.sort(), gone.slice().sort());
    for (const p of gone) assert.ok(fs.existsSync(p), 'a dry run removes nothing');
    assert.deepEqual(S.sweep({ dirs: [dir], uid: 424242 }).removed, [], 'another user\'s directories are never touched');

    const r = S.sweep({ dirs: [dir] });
    assert.deepEqual(r.removed.sort(), gone.slice().sort());
    assert.deepEqual(r.failed, []);
    for (const p of gone) assert.ok(!fs.existsSync(p), p);
    for (const p of kept) assert.ok(fs.existsSync(p), p);
    assert.ok(fs.existsSync(path.join(outside, 'keep')), 'a symlink is not followed');
    assert.match(S.summary(r, false), /^sweep: removed 3 test leftover\(s\) from the temp directory: /);
    assert.equal(S.summary({ removed: [], failed: [] }, false), 'sweep: no test leftovers in the temp directory');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('the fixture prefixes come from the plugin\'s own test sources, template parts included', () => {
  const p = S.fixturePatterns();
  assert.ok(p.length > 100);
  for (const n of ['stop-nobd-AbC123', 'gates-6O4vP0', 'mat-proj-L51Qnc', 'opcli-chief-of-staff-xY12Zq']) assert.ok(p.some((re) => re.test(n)), n);
  for (const n of ['claude-1000', 'tmux-1000', 'uv-b50fd95e6994b2d2.lock', 'm.bak', 'node-compile-cache', 'cc-socks', 'plex-state.json']) assert.ok(!p.some((re) => re.test(n)), n);
});
