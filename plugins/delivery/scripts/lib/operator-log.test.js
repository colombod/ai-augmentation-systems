// scripts/lib/operator-log.test.js — operator inputs log: sync, dedupe, per-host chains, distribution.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const chain = require('./chain.js');
const log = require('./operator-log.js');

// Hermetic git: no user or system config leaks in.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const SID = 'sess-1';
const mk = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const human = (text, n, extra = {}) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: SID,
  message: { role: 'user', content: text }, ...extra,
});
const peer = (n) => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', from: 'x' }, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: SID,
  message: { role: 'user', content: 'Another Claude session sent a message: hi' },
});
const sysRem = (n) => human('<system-reminder>ui toggled</system-reminder>', n);
const noOrigin = (n) => ({ type: 'user', uuid: 'u' + n, timestamp: '2026-10-13T10:02:00.000Z', sessionId: SID, message: { role: 'user', content: 'who knows' } });

function project() { return mk('oplog-proj-'); }
function transcript(records) {
  const f = path.join(mk('oplog-tr-'), 't.jsonl');
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}
function sync(root, tr, over = {}) {
  return log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff',
    role: 'chief-of-staff', host: 'pc', now: new Date('2026-10-13T12:00:00Z'), ...over });
}
function hostFiles(root, host) {
  const d = path.join(root, '.delivery', 'operator', 'inputs', host);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.ndjson')).sort() : [];
}

test('sync stores human, peer and unknown, never system; ids embed host and sequence', () => {
  const root = project();
  const tr = transcript([human('use postgres', 1), peer(2), sysRem(3), noOrigin(4), human('and redis', 5)]);
  const r = sync(root, tr);
  assert.strictEqual(r.added, 4);
  assert.strictEqual(r.status, 'ok');
  const all = log.listInputs(root);
  assert.deepStrictEqual(all.map((e) => [e.id, e.source, e.text]), [
    ['in-pc-000001', 'human', 'use postgres'],
    ['in-pc-000002', 'peer', 'Another Claude session sent a message: hi'],
    ['in-pc-000003', 'unknown', 'who knows'],
    ['in-pc-000004', 'human', 'and redis'],
  ]);
  assert.deepStrictEqual(hostFiles(root, 'pc'), ['2026-10.ndjson']);
});

test('entry shape: ts, captured_at, session, instance, role, hash of text, ext_id, transcript_ref', () => {
  const root = project();
  const tr = transcript([human('exact words', 1)]);
  sync(root, tr);
  const e = log.getInput(root, 'in-pc-000001');
  const crypto = require('crypto');
  assert.strictEqual(e.host, 'pc');
  assert.strictEqual(e.ts, '2026-10-13T10:00:01.000Z');
  assert.strictEqual(e.captured_at, '2026-10-13T12:00:00.000Z');
  assert.strictEqual(e.session_id, SID);
  assert.strictEqual(e.instance, 'chief-of-staff');
  assert.strictEqual(e.role, 'chief-of-staff');
  assert.strictEqual(e.text_sha256, crypto.createHash('sha256').update('exact words').digest('hex'));
  assert.strictEqual(e.ext_id, 'p1');
  assert.deepStrictEqual(e.transcript_ref, { file: tr, line: 1 });
  assert.strictEqual(e.prev, '0');
  assert.strictEqual(e.truncated, undefined);
  assert.ok(/^[0-9a-f]{64}$/.test(e.hash));
});

test('a second sync of the same transcript adds nothing', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2)]);
  assert.strictEqual(sync(root, tr).added, 2);
  assert.strictEqual(sync(root, tr).added, 0);
  assert.strictEqual(log.listInputs(root).length, 2);
});

test('sync is incremental: appended records are picked up from the cursor', () => {
  const root = project();
  const tr = transcript([human('one', 1)]);
  sync(root, tr);
  const cur = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'operator', 'cursors', SID + '.json'), 'utf8'));
  assert.strictEqual(cur.line, 1);
  assert.strictEqual(cur.transcript, tr);
  fs.appendFileSync(tr, JSON.stringify(human('two', 2)) + '\n');
  assert.strictEqual(sync(root, tr).added, 1);
  assert.strictEqual(log.listInputs(root).length, 2);
});

test('a re-written transcript (cursor lost) dedupes by ext_id', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2)]);
  sync(root, tr);
  fs.rmSync(path.join(root, '.delivery', 'operator', 'cursors', SID + '.json'));
  // same records, shifted by a new leading record, so the lines differ
  const tr2 = transcript([{ type: 'summary', summary: 's' }, human('one', 1), human('two', 2), human('three', 3)]);
  assert.strictEqual(sync(root, tr2).added, 1);
  assert.deepStrictEqual(log.listInputs(root).map((e) => e.text), ['one', 'two', 'three']);
});

test('records of other sources sharing a promptId within a turn are each stored once', () => {
  const root = project();
  const a = peer(2); a.promptId = 'shared';
  const b = noOrigin(3); b.promptId = 'shared';
  const c = noOrigin(4); c.promptId = 'shared';
  const tr = transcript([human('typed', 1), a, b, c]);
  assert.strictEqual(sync(root, tr).added, 4);
  fs.rmSync(path.join(root, '.delivery', 'operator', 'cursors'), { recursive: true });
  assert.strictEqual(sync(root, tr).added, 0);
});

test('a shorter rewritten transcript restarts from the top instead of stalling', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2), human('three', 3)]);
  sync(root, tr);
  fs.writeFileSync(tr, JSON.stringify(human('four', 4)) + '\n');
  assert.strictEqual(sync(root, tr).added, 1);
});

test('the ext_id index is rebuilt from the log when missing or stale', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2)]);
  sync(root, tr);
  const curDir = path.join(root, '.delivery', 'operator', 'cursors');
  for (const f of fs.readdirSync(curDir)) fs.rmSync(path.join(curDir, f), { recursive: true, force: true });
  assert.strictEqual(sync(root, tr).added, 0);
  assert.ok(fs.readdirSync(curDir).some((f) => /index/.test(f)), 'index rewritten');
  // stale: index file claims a different last id
  const idx = fs.readdirSync(curDir).find((f) => /index/.test(f));
  fs.writeFileSync(path.join(curDir, idx), JSON.stringify({ last_id: 'in-pc-000099', map: {} }));
  fs.rmSync(path.join(curDir, SID + '.json'));
  assert.strictEqual(sync(root, tr).added, 0);
});

test('a status of format_unrecognised is returned when user records carry no origin', () => {
  const root = project();
  const tr = transcript([noOrigin(1), noOrigin(2), noOrigin(3)]);
  const r = sync(root, tr);
  assert.strictEqual(r.status, 'format_unrecognised');
});

test('format status accumulates across incremental syncs', () => {
  const root = project();
  const tr = transcript([noOrigin(1)]);
  assert.strictEqual(sync(root, tr).status, 'ok');
  fs.appendFileSync(tr, JSON.stringify(noOrigin(2)) + '\n');
  assert.strictEqual(sync(root, tr).status, 'ok');
  fs.appendFileSync(tr, JSON.stringify(noOrigin(3)) + '\n');
  assert.strictEqual(sync(root, tr).status, 'format_unrecognised');
});

test('a 70 KB text is truncated at 64 KB with truncated:true and the full sha256', () => {
  const root = project();
  const big = 'a'.repeat(70 * 1024);
  sync(root, transcript([human(big, 1)]));
  const e = log.listInputs(root)[0];
  const crypto = require('crypto');
  assert.strictEqual(e.truncated, true);
  assert.strictEqual(Buffer.byteLength(e.text), 65536);
  assert.strictEqual(e.text_sha256, crypto.createHash('sha256').update(big).digest('hex'));
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).ok, true);
});

test('month rollover starts a new file whose first entry chains from the previous month', () => {
  const root = project();
  sync(root, transcript([human('october', 1)]), { now: new Date('2026-10-31T23:59:00Z') });
  sync(root, transcript([human('november', 2)]), { now: new Date('2026-11-01T00:01:00Z'), sessionId: 'sess-2' });
  assert.deepStrictEqual(hostFiles(root, 'pc'), ['2026-10.ndjson', '2026-11.ndjson']);
  const ids = log.listInputs(root).map((e) => e.id);
  assert.deepStrictEqual(ids, ['in-pc-000001', 'in-pc-000002']);
  const dir = path.join(root, '.delivery', 'operator', 'inputs', 'pc');
  const a = JSON.parse(fs.readFileSync(path.join(dir, '2026-10.ndjson'), 'utf8').trim());
  const b = JSON.parse(fs.readFileSync(path.join(dir, '2026-11.ndjson'), 'utf8').trim());
  assert.strictEqual(b.prev, a.hash);
  assert.deepStrictEqual(log.verifyInputs(root, { host: 'pc' }), { ok: true, count: 2, host: 'pc' });
});

test('verifyInputs detects an edited text and names host, file and line', () => {
  const root = project();
  sync(root, transcript([human('use postgres', 1), human('use redis', 2)]));
  const f = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('use redis', 'use mysql'));
  const v = log.verifyInputs(root, { host: 'pc' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.host, 'pc');
  assert.strictEqual(v.at, 2);
  assert.match(v.file, /2026-10\.ndjson$/);
  assert.ok(v.error);
  assert.strictEqual(log.verifyInputs(root).ok, false);
});

test('verifyInputs detects a break across month files', () => {
  const root = project();
  sync(root, transcript([human('october', 1)]), { now: new Date('2026-10-31T23:59:00Z') });
  sync(root, transcript([human('november', 2)]), { now: new Date('2026-11-01T00:01:00Z'), sessionId: 's2' });
  const f = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('october', 'octobex'));
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).ok, false);
});

test('two hosts write different files with different ids; the first host file is untouched by the second', () => {
  const root = project();
  sync(root, transcript([human('from pc', 1)]), { host: 'pc' });
  const fa = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  const before = fs.readFileSync(fa, 'utf8');
  sync(root, transcript([human('from ssh', 2)]), { host: 'ssh-box', sessionId: 'sess-9' });
  assert.strictEqual(fs.readFileSync(fa, 'utf8'), before);
  assert.deepStrictEqual(log.listInputs(root).map((e) => e.id).sort(), ['in-pc-000001', 'in-ssh-box-000001']);
  assert.strictEqual(log.getInput(root, 'in-ssh-box-000001').text, 'from ssh');
  assert.strictEqual(log.getInput(root, 'in-pc-000001').text, 'from pc');
  assert.strictEqual(log.getInput(root, 'in-pc-000009'), null);
  assert.strictEqual(log.getInput(root, 'in-nohost-000001'), null);
  assert.strictEqual(log.getInput(root, 'garbage'), null);
  assert.strictEqual(log.verifyInputs(root).count, 2);
  assert.strictEqual(log.verifyInputs(root).ok, true);
});

test('listInputs filters by since, source and session', () => {
  const root = project();
  sync(root, transcript([human('one', 1), peer(2)]));
  sync(root, transcript([human('two', 30)]), { sessionId: 'sess-2' });
  assert.deepStrictEqual(log.listInputs(root, { source: 'human' }).map((e) => e.text), ['one', 'two']);
  assert.deepStrictEqual(log.listInputs(root, { sessionId: 'sess-2' }).map((e) => e.text), ['two']);
  assert.deepStrictEqual(log.listInputs(root, { since: '2026-10-13T10:00:10Z' }).map((e) => e.text), ['two']);
});

test('the operator directory gets a .gitignore for local-only state', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]));
  const gi = fs.readFileSync(path.join(root, '.delivery', 'operator', '.gitignore'), 'utf8');
  assert.match(gi, /^cursors\/$/m);
  assert.match(gi, /\*\.lock/);
});

test('concurrent syncs of one transcript from separate processes store each input once', async () => {
  const root = project();
  const tr = transcript(Array.from({ length: 40 }, (_, i) => human('msg ' + i, i + 1)));
  const script = `require(${JSON.stringify(path.join(__dirname, 'operator-log.js'))}).syncTranscript(${JSON.stringify({
    projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'cos', role: 'chief-of-staff', host: 'pc' })});`;
  await Promise.all([1, 2, 3, 4].map(() => new Promise((resolve, reject) => {
    const p = cp.spawn(process.execPath, ['-e', script], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('exit ' + c))));
  })));
  assert.strictEqual(log.listInputs(root).length, 40);
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).ok, true);
});

// ---- two hosts sharing a bare remote ----

function git(cwd, ...args) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function twoHosts() {
  const base = mk('oplog-git-');
  const bare = path.join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', bare);
  const seed = path.join(base, 'seed');
  git(base, 'clone', bare, seed);
  for (const [k, v] of [['user.email', 'a@example.test'], ['user.name', 'Seed'], ['commit.gpgsign', 'false']]) git(seed, 'config', k, v);
  fs.mkdirSync(path.join(seed, '.delivery'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'README.md'), 'project\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'init');
  git(seed, 'push', '-u', 'origin', 'HEAD:main');
  const clones = {};
  for (const host of ['hosta', 'hostb']) {
    const dir = path.join(base, host);
    git(base, 'clone', bare, dir);
    for (const [k, v] of [['user.email', host + '@example.test'], ['user.name', host], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
    clones[host] = dir;
  }
  return clones;
}

test('host B input is visible to host A after publish and refresh', () => {
  const { hosta, hostb } = twoHosts();
  sync(hostb, transcript([human('decision from b', 1)]), { host: 'hostb', instance: 'pm-b' });
  assert.strictEqual(log.getInput(hosta, 'in-hostb-000001'), null);
  const p = log.publish(hostb, { force: true });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  const r = log.refresh(hosta);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(log.getInput(hosta, 'in-hostb-000001').text, 'decision from b');
  assert.strictEqual(log.verifyInputs(hosta).ok, true);
  assert.strictEqual(fs.existsSync(path.join(hosta, '.delivery', 'operator', 'cursors')), false, 'local state not shared');
});

test('concurrent appends on both hosts merge without conflict', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, transcript([human('a one', 1)]), { host: 'hosta', sessionId: 'sa' });
  sync(hostb, transcript([human('b one', 2)]), { host: 'hostb', sessionId: 'sb' });
  assert.strictEqual(log.publish(hosta, { force: true }).published, true);
  const pb = log.publish(hostb, { force: true }); // rejected, rebases once, pushes
  assert.strictEqual(pb.published, true, JSON.stringify(pb));
  // each host appends again while the other has not refreshed
  sync(hosta, transcript([human('a two', 3)]), { host: 'hosta', sessionId: 'sa2' });
  sync(hostb, transcript([human('b two', 4)]), { host: 'hostb', sessionId: 'sb2' });
  assert.strictEqual(log.publish(hosta, { force: true }).published, true);
  assert.strictEqual(log.publish(hostb, { force: true }).published, true);
  assert.strictEqual(log.refresh(hosta).ok, true);
  assert.strictEqual(log.refresh(hostb).ok, true);
  for (const root of [hosta, hostb]) {
    assert.deepStrictEqual(log.listInputs(root).map((e) => e.id).sort(),
      ['in-hosta-000001', 'in-hosta-000002', 'in-hostb-000001', 'in-hostb-000002']);
    assert.strictEqual(log.verifyInputs(root).ok, true);
  }
  assert.strictEqual(git(hosta, 'status', '--porcelain').trim(), '');
});

test('publish never throws, even outside a git repository, and is throttled', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]));
  const r = log.publish(root, { force: true });
  assert.strictEqual(r.published, false);
  const { hosta } = twoHosts();
  sync(hosta, transcript([human('x', 1)]), { host: 'hosta' });
  assert.strictEqual(log.publish(hosta, { force: true }).published, true);
  sync(hosta, transcript([human('y', 2)]), { host: 'hosta', sessionId: 's2' });
  const t = log.publish(hosta, {});
  assert.strictEqual(t.published, false);
  assert.strictEqual(t.reason, 'throttled');
});
