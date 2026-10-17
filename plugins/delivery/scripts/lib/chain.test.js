// scripts/lib/chain.test.js — hash chain: canonical JSON, append under lock, verify.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const chain = require('./chain.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'chain-')); }

test('canonical sorts keys at every depth and has no whitespace', () => {
  assert.strictEqual(chain.canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }),
    '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
});

test('hashEntry is sha256 of prev, newline, canonical entry', () => {
  const crypto = require('crypto');
  const e = { x: 1, a: 'b' };
  const want = crypto.createHash('sha256').update('0\n{"a":"b","x":1}').digest('hex');
  assert.strictEqual(chain.hashEntry('0', e), want);
});

test('appendEntry creates directories, chains prev and hash, one line each', () => {
  const dir = tmp();
  const file = path.join(dir, 'deep', 'er', 'log.ndjson');
  const a = chain.appendEntry(file, { id: 'a', n: 1 });
  const b = chain.appendEntry(file, { id: 'b', n: 2 });
  assert.strictEqual(a.prev, '0');
  assert.strictEqual(b.prev, a.hash);
  assert.strictEqual(b.hash, chain.hashEntry(b.prev, { id: 'b', n: 2, prev: b.prev }));
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[2], '');
  assert.deepStrictEqual(chain.verifyChain(file), { ok: true, count: 2, last_hash: b.hash });
  assert.ok(!fs.existsSync(file + '.lock'), 'lock released');
});

test('verifyChain on a missing or empty file is ok with count 0', () => {
  const dir = tmp();
  assert.strictEqual(chain.verifyChain(path.join(dir, 'nope')).ok, true);
  assert.strictEqual(chain.verifyChain(path.join(dir, 'nope')).count, 0);
});

test('a tampered middle line is reported with the 1-based line of the first break', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  for (let i = 1; i <= 5; i++) chain.appendEntry(file, { id: 'e' + i, text: 'line ' + i });
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[2] = lines[2].replace('line 3', 'line X');
  fs.writeFileSync(file, lines.join('\n'));
  const v = chain.verifyChain(file);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.at, 3);
  assert.match(v.error, /hash/);
});

test('a deleted middle line breaks the prev link at the following line', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  for (let i = 1; i <= 4; i++) chain.appendEntry(file, { id: 'e' + i });
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.splice(1, 1);
  fs.writeFileSync(file, lines.join('\n'));
  const v = chain.verifyChain(file);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.at, 2);
  assert.match(v.error, /prev/);
});

test('an unparsable line is reported', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  chain.appendEntry(file, { id: 'e1' });
  fs.appendFileSync(file, '{not json\n');
  const v = chain.verifyChain(file);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.at, 2);
});

test('prevFile supplies prev when the file is new, so a chain can cross files', () => {
  const dir = tmp();
  const f1 = path.join(dir, '2026-09.ndjson');
  const f2 = path.join(dir, '2026-10.ndjson');
  const a = chain.appendEntry(f1, { id: 'a' });
  const b = chain.appendEntry(f2, { id: 'b' }, { prevFile: f1 });
  assert.strictEqual(b.prev, a.hash);
  assert.strictEqual(chain.verifyChain(f2, { prev: a.hash }).ok, true);
  assert.strictEqual(chain.verifyChain(f2).ok, false);
});

test('entry may be a function of the last stored entry (seq under the lock)', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  const seq = (last) => ({ n: last ? last.n + 1 : 1 });
  chain.appendEntry(file, seq);
  chain.appendEntry(file, seq);
  const c = chain.appendEntry(file, seq);
  assert.strictEqual(c.n, 3);
});

test('a stale lock file is broken, a fresh one makes append fail after about 2 s', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  fs.writeFileSync(file + '.lock', 'x');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(file + '.lock', old, old);
  assert.ok(chain.appendEntry(file, { id: 'a' }));
  fs.writeFileSync(file + '.lock', 'x');
  const t0 = Date.now();
  assert.throws(() => chain.appendEntry(file, { id: 'b' }), /lock/);
  const dt = Date.now() - t0;
  assert.ok(dt >= 1800 && dt < 5000, 'waited ' + dt);
});

test('a final line without newline does not corrupt the next append', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  const a = chain.appendEntry(file, { id: 'a' });
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n$/, ''));
  const b = chain.appendEntry(file, { id: 'b' });
  assert.strictEqual(b.prev, a.hash);
  assert.strictEqual(chain.verifyChain(file).ok, true);
});

test('concurrent appends from 6 processes keep a valid chain', async () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  const script = `
    const chain = require(${JSON.stringify(path.join(__dirname, 'chain.js'))});
    for (let i = 0; i < 8; i++) chain.appendEntry(${JSON.stringify(file)}, { who: process.argv[1], i, pad: 'x'.repeat(20000) });
  `;
  await Promise.all([1, 2, 3, 4, 5, 6].map((n) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', script, String(n)], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('child ' + n + ' exit ' + code))));
  })));
  const v = chain.verifyChain(file);
  assert.deepStrictEqual([v.ok, v.count], [true, 48]);
  assert.ok(!fs.existsSync(file + '.lock'));
});

test('a truncated JSON tail is moved aside and the next append chains from the last good line', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  chain.appendEntry(file, { id: 'a', n: 1 });
  const b = chain.appendEntry(file, { id: 'b', n: 2 });
  fs.appendFileSync(file, '{"id":"c","n":3,"prev":"abc","ha');
  const next = (last) => ({ n: last ? last.n + 1 : 1 });
  const c = chain.appendEntry(file, next);
  assert.strictEqual(c.prev, b.hash);
  assert.strictEqual(c.n, 3);
  assert.strictEqual(chain.verifyChain(file).ok, true);
  assert.strictEqual(chain.verifyChain(file).count, 3);
  const partial = fs.readdirSync(dir).filter((n) => n.includes('.partial-'));
  assert.strictEqual(partial.length, 1);
  assert.match(fs.readFileSync(path.join(dir, partial[0]), 'utf8'), /"id":"c"/);
});

test('a file with only garbage is never treated as empty history silently: evidence is kept', () => {
  const dir = tmp();
  const file = path.join(dir, 'log.ndjson');
  fs.writeFileSync(file, '{"half');
  const a = chain.appendEntry(file, { id: 'a' });
  assert.strictEqual(a.prev, '0');
  assert.ok(fs.readdirSync(dir).some((n) => n.includes('.partial-')));
});
