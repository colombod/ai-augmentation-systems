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
  assert.deepStrictEqual(e.transcript_ref, { file: 't.jsonl', line: 1 });
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
  const vv = log.verifyInputs(root, { host: 'pc' });
  assert.deepStrictEqual([vv.ok, vv.count, vv.host], [true, 2, 'pc']);
  assert.match(vv.last_hash, /^[0-9a-f]{64}$/);
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
  sync(root, transcript([human('two', 30, { sessionId: 'sess-2' })]), { sessionId: 'sess-2' });
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
  const p = log.publish(hostb, { force: true, host: 'hostb' });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  const r = log.refresh(hosta);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(log.getInput(hosta, 'in-hostb-000001').text, 'decision from b');
  assert.strictEqual(log.verifyInputs(hosta).ok, true);
  assert.ok(!git(hosta, 'ls-files', '.delivery/operator').includes('cursors/'), 'local state not shared');
});

test('concurrent appends on both hosts merge without conflict', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, transcript([human('a one', 1)]), { host: 'hosta', sessionId: 'sa' });
  sync(hostb, transcript([human('b one', 2)]), { host: 'hostb', sessionId: 'sb' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  const pb = log.publish(hostb, { force: true, host: 'hostb' }); // rejected, rebases once, pushes
  assert.strictEqual(pb.published, true, JSON.stringify(pb));
  // each host appends again while the other has not refreshed
  sync(hosta, transcript([human('a two', 3)]), { host: 'hosta', sessionId: 'sa2' });
  sync(hostb, transcript([human('b two', 4)]), { host: 'hostb', sessionId: 'sb2' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  assert.strictEqual(log.publish(hostb, { force: true, host: 'hostb' }).published, true);
  assert.strictEqual(log.refresh(hosta).ok, true);
  assert.strictEqual(log.refresh(hostb).ok, true);
  for (const root of [hosta, hostb]) {
    assert.deepStrictEqual(log.listInputs(root).map((e) => e.id).sort(),
      ['in-hosta-000001', 'in-hosta-000002', 'in-hostb-000001', 'in-hostb-000002']);
    assert.strictEqual(log.verifyInputs(root).ok, true);
  }
  const dirty = git(hosta, 'status', '--porcelain').split('\n').filter((l) => l && !l.includes('.delivery/operator'));
  assert.deepStrictEqual(dirty, []);
});

test('publish never throws, even outside a git repository, and is throttled', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]));
  const r = log.publish(root, { force: true });
  assert.strictEqual(r.published, false);
  const { hosta } = twoHosts();
  sync(hosta, transcript([human('x', 1)]), { host: 'hosta' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  sync(hosta, transcript([human('y', 2)]), { host: 'hosta', sessionId: 's2' });
  const t = log.publish(hosta, { host: 'hosta' });
  assert.strictEqual(t.published, false);
  assert.strictEqual(t.reason, 'throttled');
});

// ---- hardening round ----

test('deleting the last line is detected as truncated against the recorded head', () => {
  const root = project();
  sync(root, transcript([human('one', 1), human('two', 2), human('three', 3)]));
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).ok, true);
  const f = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(f, lines.slice(0, 2).join('\n') + '\n');
  const v = log.verifyInputs(root, { host: 'pc' });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /truncated/);
  assert.strictEqual(log.verifyInputs(root).ok, false);
});

test('verifyInputs returns per-host heads and heads.json is local and git-ignored', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]), { host: 'pc' });
  sync(root, transcript([human('two', 2)]), { host: 'box', sessionId: 's2' });
  const v = log.verifyInputs(root);
  assert.deepStrictEqual(Object.keys(v.host_heads).sort(), ['box', 'pc']);
  assert.strictEqual(v.host_heads.pc.count, 1);
  assert.strictEqual(v.heads, 'recorded');
  const h = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'operator', 'cursors', 'heads.json'), 'utf8'));
  assert.strictEqual(h.pc.last_hash, v.host_heads.pc.last_hash);
});

test('a half-written tail line is set aside and the chain and seq continue from the last good line', () => {
  const root = project();
  sync(root, transcript([human('one', 1), human('two', 2)]));
  const f = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  fs.appendFileSync(f, '{"id":"in-pc-000003","text":"cut o');
  sync(root, transcript([human('three', 3)]), { sessionId: 's3' });
  const all = log.listInputs(root);
  assert.deepStrictEqual(all.map((e) => e.id), ['in-pc-000001', 'in-pc-000002', 'in-pc-000003']);
  assert.strictEqual(all[2].text, 'three');
  assert.strictEqual(chain.verifyChain(f).ok, true);
  const d = path.dirname(f);
  assert.ok(fs.readdirSync(d).some((n) => n.includes('.partial-')), 'evidence file kept');
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).ok, true);
});

test('session_id prefers the record sessionId over the caller argument', () => {
  const root = project();
  sync(root, transcript([human('one', 1, { sessionId: 'rec-sess' })]), { sessionId: 'arg-sess' });
  assert.strictEqual(log.listInputs(root)[0].session_id, 'rec-sess');
});

test('the cursor stores a byte offset and a rewritten smaller file is rescanned', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2)]);
  sync(root, tr);
  const cur = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'operator', 'cursors', SID + '.json'), 'utf8'));
  assert.strictEqual(cur.offset, fs.statSync(tr).size);
  fs.appendFileSync(tr, JSON.stringify(human('three', 3)) + '\n');
  const r = sync(root, tr);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(log.listInputs(root).find((e) => e.text === 'three').transcript_ref.line, 3);
});

// publish and refresh must never touch unrelated work

test('publish and refresh leave an unrelated dirty file untouched', () => {
  const { hosta, hostb } = twoHosts();
  fs.writeFileSync(path.join(hosta, 'README.md'), 'my uncommitted edits\n');
  fs.writeFileSync(path.join(hosta, 'scratch.txt'), 'untracked\n');
  sync(hostb, transcript([human('from b', 1)]), { host: 'hostb' });
  assert.strictEqual(log.publish(hostb, { force: true, host: 'hostb' }).published, true);
  sync(hosta, transcript([human('from a', 2)]), { host: 'hosta', sessionId: 'sa' });
  const p = log.publish(hosta, { force: true, host: 'hosta' });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  assert.strictEqual(log.refresh(hosta, { host: 'hosta' }).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(hosta, 'README.md'), 'utf8'), 'my uncommitted edits\n');
  assert.strictEqual(fs.readFileSync(path.join(hosta, 'scratch.txt'), 'utf8'), 'untracked\n');
  assert.ok(git(hosta, 'show', '--stat', '--format=%s', 'HEAD').indexOf('README.md') === -1);
  assert.strictEqual(log.getInput(hosta, 'in-hostb-000001').text, 'from b');
});

test('an unrelated unpushed commit blocks publish and nothing is pushed', () => {
  const { hosta } = twoHosts();
  fs.writeFileSync(path.join(hosta, 'feature.js'), 'x\n');
  git(hosta, 'add', 'feature.js');
  git(hosta, 'commit', '-m', 'unrelated wip');
  sync(hosta, transcript([human('a', 1)]), { host: 'hosta' });
  const before = git(hosta, 'rev-parse', '@{u}').trim();
  const p = log.publish(hosta, { force: true, host: 'hosta' });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'unpushed unrelated commits');
  assert.strictEqual(git(hosta, 'ls-remote', 'origin', 'main').split('\t')[0], before);
});

test('a rejected push recovers by fetch, merge and one retry', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, transcript([human('a', 1)]), { host: 'hosta' });
  sync(hostb, transcript([human('b', 2)]), { host: 'hostb' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  const p = log.publish(hostb, { force: true, host: 'hostb' });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  const remote = git(hostb, 'ls-tree', '-r', '--name-only', 'origin/main');
  assert.match(remote, /inputs\/hosta\//);
  assert.match(remote, /inputs\/hostb\//);
});

test('refresh brings another host file and never overwrites this host file with an older upstream copy', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, transcript([human('a one', 1)]), { host: 'hosta' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  sync(hosta, transcript([human('a two', 2)]), { host: 'hosta', sessionId: 'sa2' }); // local, unpublished
  sync(hostb, transcript([human('b one', 3)]), { host: 'hostb' });
  assert.strictEqual(log.refresh(hostb, { host: 'hostb' }).ok, true);
  assert.strictEqual(log.publish(hostb, { force: true, host: 'hostb' }).published, true);
  const r = log.refresh(hosta, { host: 'hosta' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(log.listInputs(hosta).map((e) => e.text).sort(), ['a one', 'a two', 'b one']);
  assert.strictEqual(log.verifyInputs(hosta).ok, true);
});

test('refresh without an upstream reports no upstream', () => {
  const root = project();
  cp.spawnSync('git', ['init', '-q'], { cwd: root });
  assert.deepStrictEqual(log.refresh(root), { ok: false, reason: 'no upstream', no_remote: true });
});

test('a lock whose token changed is not removed by the old holder', () => {
  const dir = mk('oplog-lock-');
  const lock = path.join(dir, 'x.lock');
  chain.withLock(lock, () => {
    fs.writeFileSync(lock, '9999:someoneelse'); // stolen as stale and re-acquired by another process
  });
  assert.strictEqual(fs.readFileSync(lock, 'utf8'), '9999:someoneelse');
});

test('refresh applies a second upstream update to a file it brought earlier', () => {
  const { hosta, hostb } = twoHosts();
  sync(hostb, transcript([human('b one', 1)]), { host: 'hostb' });
  log.publish(hostb, { force: true, host: 'hostb' });
  assert.strictEqual(log.refresh(hosta, { host: 'hosta' }).ok, true);
  assert.strictEqual(log.listInputs(hosta).length, 1);
  sync(hostb, transcript([human('b two', 2)]), { host: 'hostb', sessionId: 's2' });
  log.publish(hostb, { force: true, host: 'hostb' });
  assert.strictEqual(log.refresh(hosta, { host: 'hosta' }).ok, true);
  assert.strictEqual(log.listInputs(hosta).length, 2);
  assert.strictEqual(log.verifyInputs(hosta).ok, true);
});

test('refresh does not replace a longer local copy even when no host is named', () => {
  const { hosta } = twoHosts();
  sync(hosta, transcript([human('a one', 1)]), { host: 'hosta' });
  log.publish(hosta, { force: true, host: 'hosta' });
  sync(hosta, transcript([human('a two', 2)]), { host: 'hosta', sessionId: 's2' });
  assert.strictEqual(log.refresh(hosta).ok, true);
  assert.strictEqual(log.listInputs(hosta).length, 2);
});

// ---- round 2 ----

test('a sync after truncation cannot lower the head: verify keeps failing and heads.json says 5', () => {
  const root = project();
  sync(root, transcript(Array.from({ length: 5 }, (_, i) => human('m' + i, i + 1))));
  const f = path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson');
  const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(f, lines.slice(0, 3).join('\n') + '\n');
  assert.strictEqual(sync(root, transcript([human('new', 9)]), { sessionId: 's9' }).added, 1);
  const v = log.verifyInputs(root, { host: 'pc' });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /truncated/);
  const heads = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'operator', 'cursors', 'heads.json'), 'utf8'));
  assert.strictEqual(heads.pc.count, 5);
});

test('heads is reported as absent when heads.json has no entry for the host', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]));
  assert.strictEqual(log.verifyInputs(root, { host: 'pc' }).heads, 'recorded');
  fs.rmSync(path.join(root, '.delivery', 'operator', 'cursors', 'heads.json'));
  const v = log.verifyInputs(root, { host: 'pc' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.heads, 'absent');
  assert.strictEqual(log.verifyInputs(root).heads, 'recorded'); // now trusted from first use
});

test('a transcript rewritten larger than the stored offset is rescanned from the top', () => {
  const root = project();
  const tr = transcript([human('one', 1), human('two', 2)]);
  sync(root, tr);
  const bigger = [human('zero', 5), human('one', 1), human('two', 2), human('three', 3), human('four', 4)];
  fs.writeFileSync(tr, bigger.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = sync(root, tr);
  assert.strictEqual(r.added, 3);
  assert.deepStrictEqual(log.listInputs(root).map((e) => e.text).sort(), ['four', 'one', 'three', 'two', 'zero']);
});

test('the operator .gitignore also covers stale lock names', () => {
  const root = project();
  sync(root, transcript([human('one', 1)]));
  const gi = fs.readFileSync(path.join(root, '.delivery', 'operator', '.gitignore'), 'utf8');
  assert.match(gi, /^\*\.stale-\*$/m);
  assert.match(gi, /^\*\.lock\.stale-\*$/m);
});

test('publish adds only this host files and counts entries, not .gitignore lines', () => {
  const { hosta, hostb } = twoHosts();
  const stray = path.join(hosta, '.delivery', 'operator', 'inputs', 'hostz');
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, '2026-10.ndjson'), 'foreign\n');
  fs.mkdirSync(path.join(hosta, '.delivery', 'operator', 'records'), { recursive: true });
  fs.writeFileSync(path.join(hosta, '.delivery', 'operator', 'records', 'other-instance.ndjson'), 'foreign\n');
  sync(hosta, transcript([human('a', 1), human('b', 2)]), { host: 'hosta' });
  const p = log.publish(hosta, { force: true, host: 'hosta', instance: 'mine' });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  assert.strictEqual(p.entries, 2);
  const tracked = git(hosta, 'ls-tree', '-r', '--name-only', 'HEAD');
  assert.match(tracked, /inputs\/hosta\//);
  assert.doesNotMatch(tracked, /hostz/);
  assert.doesNotMatch(tracked, /other-instance/);
  assert.match(git(hosta, 'log', '-1', '--format=%s'), /operator: 2 entries/);
  assert.ok(hostb);
});

test('a file refreshed earlier does not block recovery from a rejected push', () => {
  const { hosta, hostb } = twoHosts();
  sync(hosta, transcript([human('a one', 1)]), { host: 'hosta' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  assert.strictEqual(log.refresh(hostb, { host: 'hostb' }).ok, true); // brings hosta file, uncommitted
  sync(hosta, transcript([human('a two', 2)]), { host: 'hosta', sessionId: 's2' });
  assert.strictEqual(log.publish(hosta, { force: true, host: 'hosta' }).published, true);
  sync(hostb, transcript([human('b one', 3)]), { host: 'hostb' });
  const p = log.publish(hostb, { force: true, host: 'hostb' });
  assert.strictEqual(p.published, true, JSON.stringify(p));
  assert.strictEqual(log.listInputs(hostb).length, 3);
});

test('Copilot 2: a head never moves back inside the lock (a stale reader cannot lower a head capture raised)', () => {
  const root = project();
  // the interleaving: a reader verified 11 entries, capture then recorded 12, the reader writes last
  log.setHead(root, 'pc', { count: 12, last_hash: 'h12' });
  log.setHead(root, 'pc', { count: 11, last_hash: 'h11' });
  assert.deepStrictEqual(log.readHeads(root).pc, { count: 12, last_hash: 'h12' });
  // a conflicting hash at the same count is refused too; the same head with a role added is not
  log.setHead(root, 'pc', { count: 12, last_hash: 'other' });
  assert.strictEqual(log.readHeads(root).pc.last_hash, 'h12');
  log.setHead(root, 'pc', { count: 12, last_hash: 'h12', role: 'chief-of-staff' });
  assert.strictEqual(log.readHeads(root).pc.role, 'chief-of-staff');
  log.setHead(root, 'pc', { count: 13, last_hash: 'h13' });
  assert.strictEqual(log.readHeads(root).pc.count, 13);
});
