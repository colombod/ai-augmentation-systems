// scripts/lib/operator-store.test.js — the private operator store: where records live, how they travel,
// and that the user's own checkout is never touched (the B1-B3, I4-I7 review matrix).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const chain = require('./chain.js');
const log = require('./operator-log.js');
const store = require('./operator-store.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function git(cwd, ...args) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const gitTry = (cwd, ...args) => cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
function ident(dir, name) {
  for (const [k, v] of [['user.email', `${name}@example.test`], ['user.name', name], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
}

// A bare remote with one project commit and n clones (one per host).
function hosts(n = 2, o = {}) {
  const base = mk('opstore-');
  const bare = path.join(base, 'remote.git');
  git(base, 'init', '--bare', '-q', '-b', 'main', bare);
  const seed = path.join(base, 'seed');
  git(base, 'clone', '-q', bare, seed);
  ident(seed, 'seed');
  fs.writeFileSync(path.join(seed, 'README.md'), 'project\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'init'); git(seed, 'push', '-q', '-u', 'origin', 'HEAD:main');
  const out = { base, bare, seed, dirs: [] };
  for (let i = 0; i < n; i++) {
    const name = `host${String.fromCharCode(97 + i)}`;
    const dir = path.join(base, name);
    git(base, 'clone', '-q', ...(o.shallow ? ['--depth', '1', `file://${bare}`] : [bare]), dir);
    ident(dir, name);
    out[name] = dir;
    out.dirs.push([name, dir]);
  }
  return out;
}

let seq = 0;
function say(root, host, ...texts) {
  const f = path.join(mk('opstore-tr-'), 't.jsonl');
  const sid = `s${++seq}`;
  fs.writeFileSync(f, texts.map((t, i) => JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: `${sid}-p${i}`, uuid: `${sid}-u${i}`,
    timestamp: `2026-10-13T10:00:${String(i % 60).padStart(2, '0')}.000Z`, sessionId: sid, message: { role: 'user', content: t } })).join('\n') + '\n');
  return log.syncTranscript({ projectRoot: root, transcriptPath: f, sessionId: sid, instance: 'cos', role: 'chief-of-staff', host, now: new Date('2026-10-13T12:00:00Z') });
}
// a valid records chain entry for an instance (enough for the publish check: hashes, ids, author)
function record(root, instance, statement, host, extra = {}) {
  return chain.appendEntry(path.join(log.opDir(root), 'records', `${instance}.ndjson`), (last) => {
    const n = last ? Number(last.id.slice(-6)) + 1 : 1;
    return { id: `dec-${instance}-${String(n).padStart(6, '0')}`, kind: 'decision', statement, by: { instance, ...(host ? { host } : {}) }, ts: new Date().toISOString(), ...extra };
  });
}
const pub = (root, host) => log.publish(root, { force: true, host });
const remoteFiles = (bare) => gitTry(bare, 'ls-tree', '-r', '--name-only', 'delivery-operator').stdout.split('\n').filter(Boolean);
const remoteFile = (bare, p) => git(bare, 'show', `delivery-operator:operator/${p}`);
const inputsOf = (bare, host) => remoteFile(bare, `inputs/${host}/2026-10.ndjson`).split('\n').filter(Boolean).map((l) => JSON.parse(l).id);

// Everything about the user's checkout that an operator command could change.
function snapshot(dir) {
  const gd = path.resolve(dir, git(dir, 'rev-parse', '--git-dir').trim());
  const state = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply', 'ORIG_HEAD', 'index']
    .map((f) => { try { const st = fs.statSync(path.join(gd, f)); return `${f}:${st.isFile() ? fs.readFileSync(path.join(gd, f)).toString('base64').slice(0, 64) : 'dir'}`; } catch (e) { return `${f}:-`; } });
  return [gitTry(dir, 'status', '--porcelain=v2', '--branch', '--untracked-files=all').stdout,
    gitTry(dir, 'rev-parse', 'HEAD').stdout, gitTry(dir, 'stash', 'list').stdout, gitTry(dir, 'for-each-ref').stdout, ...state].join('\n');
}

// Rewrite the remote delivery-operator branch the way a hostile or careless writer could.
function tamper(bare, fn) {
  const d = path.join(mk('opstore-tamper-'), 'w');
  git(path.dirname(d), 'clone', '-q', '-b', 'delivery-operator', bare, d);
  ident(d, 'tamper');
  fn(d);
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'tamper'); git(d, 'push', '-q', '--force', 'origin', 'HEAD:delivery-operator');
}

test('layout: the store is <git-common-dir>/delivery-operator, tracks operator files only, and the checkout never sees it', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'use postgres');
  const sd = store.storeDir(h.hosta);
  assert.strictEqual(fs.realpathSync(sd), fs.realpathSync(path.join(h.hosta, '.git', 'delivery-operator')));
  assert.strictEqual(log.opDir(h.hosta), path.join(sd, 'operator'));
  assert.ok(!fs.existsSync(path.join(h.hosta, '.delivery', 'operator')), 'nothing in the working tree');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  assert.deepStrictEqual(git(sd, 'ls-files').split('\n').filter(Boolean), ['operator/inputs/hosta/2026-10.ndjson']);
  assert.strictEqual(git(sd, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'delivery-operator');
  assert.deepStrictEqual(remoteFiles(h.bare), ['operator/inputs/hosta/2026-10.ndjson'], 'the branch carries operator files only, no local state');
  assert.strictEqual(git(h.hosta, 'status', '--porcelain'), '');
  assert.strictEqual(git(sd, 'status', '--porcelain'), '', 'the store reads clean for a person inspecting it');
  // a linked worktree of the same repository shares the store
  const wt = path.join(h.base, 'wt');
  git(h.hosta, 'worktree', 'add', '-q', wt);
  assert.strictEqual(fs.realpathSync(store.storeDir(wt)), fs.realpathSync(sd));
  assert.deepStrictEqual(log.listInputs(wt).map((e) => e.id), ['in-hosta-000001']);
});

test('B1/B3: publish and refresh leave the user checkout byte-identical in every repository state, and git pull behaves as without the plugin', () => {
  const states = {
    clean: () => {},
    detached: (d) => git(d, 'checkout', '-q', '--detach'),
    'no upstream': (d) => git(d, 'checkout', '-q', '-b', 'local-only'),
    'pull.rebase=true': (d) => git(d, 'config', 'pull.rebase', 'true'),
    'dirty and untracked': (d) => { fs.writeFileSync(path.join(d, 'README.md'), 'edited\n'); fs.writeFileSync(path.join(d, 'new.txt'), 'n\n'); },
    'mid-merge': (d, h) => {
      fs.writeFileSync(path.join(h.seed, 'README.md'), 'upstream\n'); git(h.seed, 'commit', '-qam', 'up'); git(h.seed, 'push', '-q');
      fs.writeFileSync(path.join(d, 'README.md'), 'mine\n'); git(d, 'commit', '-qam', 'mine');
      git(d, 'fetch', '-q'); assert.notStrictEqual(gitTry(d, 'merge', 'origin/main').status, 0);
    },
    'mid-rebase': (d, h) => {
      fs.writeFileSync(path.join(h.seed, 'README.md'), 'upstream\n'); git(h.seed, 'commit', '-qam', 'up'); git(h.seed, 'push', '-q');
      fs.writeFileSync(path.join(d, 'README.md'), 'mine\n'); git(d, 'commit', '-qam', 'mine');
      git(d, 'fetch', '-q'); assert.notStrictEqual(gitTry(d, 'rebase', 'origin/main').status, 0);
    },
  };
  for (const [name, setup] of Object.entries(states)) {
    const h = hosts(2);
    say(h.hostb, 'hostb', 'b says hi');
    assert.strictEqual(pub(h.hostb, 'hostb').published, true, name);
    setup(h.hosta, h);
    say(h.hosta, 'hosta', `a in state ${name}`);
    const before = snapshot(h.hosta);
    const r = log.refresh(h.hosta, { host: 'hosta' });
    assert.strictEqual(r.ok, true, `${name}: ${JSON.stringify(r)}`);
    const p = pub(h.hosta, 'hosta');
    assert.strictEqual(p.published, true, `${name}: ${JSON.stringify(p)}`);
    assert.strictEqual(snapshot(h.hosta), before, `${name}: the user checkout changed`);
    assert.deepStrictEqual(inputsOf(h.bare, 'hosta'), ['in-hosta-000001'], name);
    assert.ok(log.getInput(h.hosta, 'in-hostb-000001'), `${name}: peer records are served from the store`);
  }
  // pull in a checkout with pull.rebase=true and new upstream work, with operator records published meanwhile
  const h = hosts(2);
  git(h.hosta, 'config', 'pull.rebase', 'true');
  fs.writeFileSync(path.join(h.hostb, 'b.txt'), 'b\n'); git(h.hostb, 'add', 'b.txt'); git(h.hostb, 'commit', '-qm', 'b work'); git(h.hostb, 'push', '-q');
  fs.writeFileSync(path.join(h.hosta, 'a.txt'), 'a\n'); git(h.hosta, 'add', 'a.txt'); git(h.hosta, 'commit', '-qm', 'a work');
  say(h.hostb, 'hostb', 'b decides'); assert.strictEqual(pub(h.hostb, 'hostb').published, true);
  say(h.hosta, 'hosta', 'a decides'); assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true);
  const pull = gitTry(h.hosta, 'pull', '-q');
  assert.strictEqual(pull.status, 0, pull.stderr);
  assert.strictEqual(git(h.hosta, 'status', '--porcelain'), '');
  assert.deepStrictEqual(git(h.hosta, 'log', '--format=%s').split('\n').filter(Boolean), ['a work', 'b work', 'init'], 'only the user\'s history');
  assert.strictEqual(gitTry(h.hostb, 'pull', '--ff-only', '-q').status, 0);
});

test('B3: a shallow clone publishes and refreshes; its checkout is untouched', () => {
  const h = hosts(2, { shallow: true });
  say(h.hosta, 'hosta', 'a'); say(h.hostb, 'hostb', 'b');
  const before = snapshot(h.hosta);
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  assert.strictEqual(pub(h.hostb, 'hostb').published, true);
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true);
  assert.ok(log.getInput(h.hosta, 'in-hostb-000001'));
  assert.strictEqual(snapshot(h.hosta), before);
});

test('B1: the user\'s own commit contains only the user\'s files', () => {
  const h = hosts(2);
  say(h.hostb, 'hostb', 'b'); pub(h.hostb, 'hostb');
  say(h.hosta, 'hosta', 'a'); record(h.hosta, 'pm', 'x');
  log.refresh(h.hosta, { host: 'hosta' }); pub(h.hosta, 'hosta');
  fs.writeFileSync(path.join(h.hosta, 'feature.js'), 'x\n');
  git(h.hosta, 'add', '-A'); git(h.hosta, 'commit', '-qm', 'feature');
  assert.deepStrictEqual(git(h.hosta, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean), ['feature.js']);
  assert.deepStrictEqual(git(h.hosta, 'ls-files').split('\n').filter(Boolean), ['README.md', 'feature.js']);
});

test('the user\'s cleanup commands in the checkout (clean -fdx, reset --hard, checkout ., stash -u) delete no operator record', () => {
  for (const cmd of [['clean', '-fdx'], ['reset', '--hard'], ['checkout', '.'], ['stash', '-u']]) {
    const h = hosts(1);
    say(h.hosta, 'hosta', 'one', 'two');
    record(h.hosta, 'pm', 'unpublished decision');
    fs.writeFileSync(path.join(h.hosta, 'README.md'), 'dirty\n');
    fs.writeFileSync(path.join(h.hosta, 'junk.txt'), 'junk\n');
    git(h.hosta, ...cmd);
    assert.deepStrictEqual(log.listInputs(h.hosta).map((e) => e.id), ['in-hosta-000001', 'in-hosta-000002'], cmd.join(' '));
    assert.ok(fs.existsSync(path.join(log.opDir(h.hosta), 'records', 'pm.ndjson')), cmd.join(' '));
    assert.strictEqual(pub(h.hosta, 'hosta').published, true);
    assert.ok(remoteFiles(h.bare).includes('operator/records/pm.ndjson'), cmd.join(' '));
  }
});

test('the user repository\'s GIT_DIR / GIT_INDEX_FILE in the environment (a git hook) cannot redirect the store', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'x');
  const before = snapshot(h.hosta);
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = path.join(h.hosta, '.git');
  process.env.GIT_INDEX_FILE = path.join(h.hosta, '.git', 'index');
  process.env.GIT_WORK_TREE = h.hosta;
  try { assert.strictEqual(pub(h.hosta, 'hosta').published, true); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.strictEqual(snapshot(h.hosta), before);
  assert.deepStrictEqual(inputsOf(h.bare, 'hosta'), ['in-hosta-000001']);
});

test('I4: three hosts publishing in parallel, then one quiet round, converge with every entry on the remote', async () => {
  const h = hosts(3);
  for (const [name, dir] of h.dirs) { say(dir, name, `${name} one`, `${name} two`); record(dir, `pm-${name}`, `${name} decides`); }
  const script = `const log = require(${JSON.stringify(path.join(__dirname, 'operator-log.js'))});
    const r = log.publish(process.argv[1], { force: true, host: process.argv[2] }); process.stdout.write(JSON.stringify(r));`;
  const runOne = ([name, dir]) => new Promise((resolve) => {
    const c = cp.spawn(process.execPath, ['-e', script, dir, name], { env: process.env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(JSON.parse(out || '{}')));
  });
  for (let round = 0; round < 2; round++) {
    const results = await Promise.all(h.dirs.map(runOne));
    for (const r of results) assert.strictEqual(r.published, true, JSON.stringify(results));
    for (const [name, dir] of h.dirs) { say(dir, name, `${name} round ${round}`); record(dir, `pm-${name}`, `round ${round}`); }
  }
  for (const [name, dir] of h.dirs) { assert.strictEqual(pub(dir, name).published, true); }
  for (const [name] of h.dirs) {
    assert.deepStrictEqual(inputsOf(h.bare, name), [1, 2, 3, 4].map((n) => `in-${name}-00000${n}`));
    assert.strictEqual(remoteFile(h.bare, `records/pm-${name}.ndjson`).split('\n').filter(Boolean).length, 3);
  }
  // a quiet round: everyone refreshes and holds everything; nothing new is committed
  for (const [name, dir] of h.dirs) {
    assert.strictEqual(log.refresh(dir, { host: name }).ok, true);
    assert.strictEqual(log.listInputs(dir).length, 12);
    assert.strictEqual(log.verifyInputs(dir).ok, true);
    const n = git(store.storeDir(dir), 'rev-list', '--count', 'HEAD');
    assert.strictEqual(pub(dir, name).published, true);
    assert.strictEqual(git(store.storeDir(dir), 'rev-list', '--count', 'HEAD'), n, 'no empty commit for a publish with nothing new');
    assert.strictEqual(log.unpublished(dir, { all: true }).count, 0);
  }
});

test('a rejected push is retried (fetch, merge, push) and reports the attempt', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'a'); say(h.hostb, 'hostb', 'b');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  const r = pub(h.hostb, 'hostb');
  assert.strictEqual(r.published, true, JSON.stringify(r));
  assert.deepStrictEqual(remoteFiles(h.bare).sort(), ['operator/inputs/hosta/2026-10.ndjson', 'operator/inputs/hostb/2026-10.ndjson']);
});

test('I7: a stale peer copy can never be pushed over the newer one (the merge takes the longer chain)', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'a1');
  pub(h.hosta, 'hosta');
  assert.strictEqual(log.refresh(h.hostb, { host: 'hostb' }).ok, true); // b holds a's chain at 1 entry
  say(h.hosta, 'hosta', 'a2', 'a3');
  pub(h.hosta, 'hosta');
  say(h.hostb, 'hostb', 'b1');
  const r = pub(h.hostb, 'hostb'); // no refresh first: b's copy of a's chain is stale
  assert.strictEqual(r.published, true, JSON.stringify(r));
  assert.deepStrictEqual(inputsOf(h.bare, 'hosta'), ['in-hosta-000001', 'in-hosta-000002', 'in-hosta-000003']);
  assert.deepStrictEqual(inputsOf(h.bare, 'hostb'), ['in-hostb-000001']);
  assert.strictEqual(log.listInputs(h.hostb).filter((e) => e.host === 'hosta').length, 3, 'b\'s working copy caught up');
});

test('B2/I7: a forged own chain is refused on a normal push, before and after it was published', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one', 'two');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  const f = path.join(log.opDir(h.hosta), 'inputs', 'hosta', '2026-10.ndjson');
  const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
  const e = JSON.parse(lines[0]); e.text = 'forged'; lines[0] = JSON.stringify(e);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const r = pub(h.hosta, 'hosta');
  assert.strictEqual(r.published, false);
  assert.match(r.reason, /inputs\/hosta\/2026-10\.ndjson no longer starts with the copy already committed/);
  assert.match(r.reason, /git -C .* checkout -- operator\/inputs\/hosta\/2026-10\.ndjson/, 'the refusal says how to restore');
  assert.ok(!remoteFile(h.bare, 'inputs/hosta/2026-10.ndjson').includes('forged'));
  // never published: a broken chain is caught by the chain check
  const h2 = hosts(1);
  say(h2.hosta, 'hosta', 'one');
  const f2 = path.join(log.opDir(h2.hosta), 'inputs', 'hosta', '2026-10.ndjson');
  const e2 = JSON.parse(fs.readFileSync(f2, 'utf8')); e2.text = 'forged before publishing';
  fs.writeFileSync(f2, JSON.stringify(e2) + '\n');
  const r2 = pub(h2.hosta, 'hosta');
  assert.strictEqual(r2.published, false);
  assert.match(r2.reason, /inputs\/hosta\/ fails verification .*operator\.js problems/);
  assert.deepStrictEqual(remoteFiles(h2.bare), []);
  // a forged records chain too
  const h3 = hosts(1);
  record(h3.hosta, 'pm', 'real');
  fs.appendFileSync(path.join(log.opDir(h3.hosta), 'records', 'pm.ndjson'), JSON.stringify({ id: 'dec-pm-000002', prev: 'x', hash: 'y' }) + '\n');
  const r3 = pub(h3.hosta, 'hosta');
  assert.strictEqual(r3.published, false);
  assert.match(r3.reason, /records\/pm\.ndjson fails verification/);
});

test('I7: an altered peer copy on the remote is refused: nothing merged, nothing pushed', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'original words');
  pub(h.hosta, 'hosta');
  assert.strictEqual(log.refresh(h.hostb, { host: 'hostb' }).ok, true);
  tamper(h.bare, (d) => {
    const f = path.join(d, 'operator', 'inputs', 'hosta', '2026-10.ndjson');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('original words', 'altered words'));
  });
  const remoteBefore = git(h.bare, 'rev-parse', 'delivery-operator');
  const r = log.refresh(h.hostb, { host: 'hostb' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diverged, ['inputs/hosta/2026-10.ndjson']);
  assert.match(r.reason, /remote copy of inputs\/hosta\/2026-10\.ndjson no longer starts with this store's copy/);
  assert.match(r.reason, /git -C .* log -p/);
  assert.strictEqual(log.getInput(h.hostb, 'in-hosta-000001').text, 'original words', 'the local copy is kept');
  say(h.hostb, 'hostb', 'b');
  const p = pub(h.hostb, 'hostb');
  assert.strictEqual(p.published, false);
  assert.strictEqual(git(h.bare, 'rev-parse', 'delivery-operator'), remoteBefore);
});

test('I5: an upstream deletion of a chain file is refused by the merge check, for a peer chain and for an own chain', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'a'); say(h.hostb, 'hostb', 'b');
  pub(h.hosta, 'hosta'); pub(h.hostb, 'hostb');
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true);
  tamper(h.bare, (d) => fs.rmSync(path.join(d, 'operator', 'inputs', 'hosta'), { recursive: true }));
  for (const [dir, host] of [[h.hosta, 'hosta'], [h.hostb, 'hostb']]) {
    const r = log.refresh(dir, { host });
    assert.strictEqual(r.ok, false, host);
    assert.deepStrictEqual(r.diverged, ['inputs/hosta/2026-10.ndjson'], host);
    assert.match(r.reason, /no longer has inputs\/hosta\/2026-10\.ndjson.*never deleted/, host);
    assert.ok(log.getInput(dir, 'in-hosta-000001'), `${host}: nothing deleted locally`);
  }
  say(h.hosta, 'hosta', 'a2');
  assert.strictEqual(pub(h.hosta, 'hosta').published, false);
});

test('I7: an unpublished record of another role sharing the store survives any publish and is published by it', () => {
  const h = hosts(2);
  say(h.hostb, 'hostb', 'b'); pub(h.hostb, 'hostb'); // the remote moved: a's push is rejected first
  say(h.hosta, 'hosta', 'a');
  record(h.hosta, 'chief-of-staff', 'cos decides');
  record(h.hosta, 'product-manager', 'pm decides, not published yet');
  const r = log.publish(h.hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' });
  assert.strictEqual(r.published, true, JSON.stringify(r));
  assert.match(remoteFile(h.bare, 'records/product-manager.ndjson'), /pm decides, not published yet/);
  record(h.hosta, 'product-manager', 'pm again');
  assert.strictEqual(log.unpublished(h.hosta, { host: 'hosta', instances: ['product-manager'] }).count, 1);
  assert.strictEqual(log.unpublished(h.hosta, { host: 'hosta', instances: ['chief-of-staff'] }).count, 0);
  assert.strictEqual(log.publish(h.hosta, { force: true, host: 'hosta', instance: 'chief-of-staff' }).published, true);
  assert.strictEqual(log.unpublished(h.hosta, { all: true }).count, 0);
});

test('a project without a remote keeps a local-only store; publish says "no remote"', () => {
  const root = mk('opstore-local-');
  git(root, 'init', '-q');
  say(root, 'pc', 'solo');
  const r = pub(root, 'pc');
  assert.strictEqual(r.published, false);
  assert.strictEqual(r.reason, 'no remote');
  assert.deepStrictEqual(git(store.storeDir(root), 'ls-files').split('\n').filter(Boolean), ['operator/inputs/pc/2026-10.ndjson'], 'committed locally');
  assert.strictEqual(log.unpublished(root, { all: true }).reason, 'no remote');
  assert.strictEqual(git(root, 'status', '--porcelain'), '');
});

test('records an earlier version left in <project>/.delivery/operator are copied into the store once, and the chain continues', () => {
  const root = mk('opstore-legacy-');
  say(root, 'pc', 'before git'); // not a git repository yet: .delivery/operator
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson')));
  git(root, 'init', '-q');
  say(root, 'pc', 'after git');
  assert.deepStrictEqual(log.listInputs(root).map((e) => e.id), ['in-pc-000001', 'in-pc-000002']);
  assert.strictEqual(log.verifyInputs(root).ok, true);
  assert.ok(log.opDir(root).includes(path.join('.git', 'delivery-operator')));
  assert.strictEqual(fs.readFileSync(path.join(root, '.delivery', 'operator', 'inputs', 'pc', '2026-10.ndjson'), 'utf8').split('\n').filter(Boolean).length, 1, 'the old files are left as they were');
});

test('I6: every refusal names what to do', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'x');
  fs.rmSync(h.bare, { recursive: true });
  const r = pub(h.hosta, 'hosta');
  assert.strictEqual(r.published, false);
  assert.match(r.reason, /project remote \(origin\) was not found .*git remote -v/);
  assert.ok(!r.reason.includes(h.bare), 'the URL is not repeated');
});

test('quarantine resolves a fork: the set-aside copy is kept as evidence, the store takes the remote copy, and publishing resumes', () => {
  const R = require('./operator-records.js');
  const h = hosts(2);
  record(h.hosta, 'pm', 'from clone a');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  record(h.hostb, 'pm', 'from clone b'); // a second clone writing as the same instance: a fork
  const r = pub(h.hostb, 'hostb');
  assert.strictEqual(r.published, false);
  assert.match(r.reason, /records chain forked: another writer appended to records\/pm\.ndjson/);
  const q = R.quarantine({ projectRoot: h.hostb, file: 'records/pm.ndjson', reason: 'fork with clone a', by: { instance: 'chief-of-staff', role: 'chief-of-staff' } });
  assert.strictEqual(q.adopted_remote, true);
  assert.match(fs.readFileSync(path.join(log.opDir(h.hostb), 'records', 'pm.ndjson'), 'utf8'), /from clone a/);
  const evidence = fs.readdirSync(path.join(log.opDir(h.hostb), 'quarantine')).find((f) => /^pm\.ndjson\.\d+$/.test(f));
  assert.match(fs.readFileSync(path.join(log.opDir(h.hostb), 'quarantine', evidence), 'utf8'), /from clone b/);
  say(h.hostb, 'hostb', 'b goes on');
  assert.strictEqual(pub(h.hostb, 'hostb').published, true);
  assert.ok(!remoteFiles(h.bare).some((f) => f.includes('quarantine')), 'evidence stays local');
  // a published chain corrupted locally: setting it aside restores the published lines, and the
  // instance carries on from them
  const h2 = hosts(1);
  record(h2.hosta, 'pm', 'ok');
  assert.strictEqual(pub(h2.hosta, 'hosta').published, true);
  fs.appendFileSync(path.join(log.opDir(h2.hosta), 'records', 'pm.ndjson'), JSON.stringify({ id: 'dec-pm-000002', prev: 'x', hash: 'y' }) + '\n');
  assert.match(pub(h2.hosta, 'hosta').reason, /records\/pm\.ndjson fails verification/);
  assert.strictEqual(R.quarantine({ projectRoot: h2.hosta, file: 'records/pm.ndjson', reason: 'forged line', by: { instance: 'chief-of-staff', role: 'chief-of-staff' } }).adopted_remote, true);
  assert.strictEqual(record(h2.hosta, 'pm', 'carries on').id, 'dec-pm-000002');
  assert.strictEqual(pub(h2.hosta, 'hosta').published, true);
  assert.match(remoteFile(h2.bare, 'records/pm.ndjson'), /carries on/);
  // never published: it leaves the store and the instance starts a new chain
  const h3 = hosts(1);
  record(h3.hosta, 'pm', 'local only');
  assert.strictEqual(log.refresh(h3.hosta, { host: 'hosta' }).ok, true); // committed in the store, not pushed
  R.quarantine({ projectRoot: h3.hosta, file: 'records/pm.ndjson', reason: 'bad', by: { instance: 'chief-of-staff', role: 'chief-of-staff' } });
  record(h3.hosta, 'pm', 'fresh');
  assert.strictEqual(pub(h3.hosta, 'hosta').published, true);
  assert.doesNotMatch(remoteFile(h3.bare, 'records/pm.ndjson'), /local only/);
});

// ---- second review round: B1, B2, B3 ----

test('B1: a rewritten or forged own chain committed by hand in the store is never pushed', () => {
  for (const how of ['rewrite', 'bad hash']) {
    const h = hosts(1);
    record(h.hosta, 'cos', 'Orders use Postgres', 'hosta');
    record(h.hosta, 'cos', 'no redis', 'hosta');
    assert.strictEqual(pub(h.hosta, 'hosta').published, true);
    const sd = store.storeDir(h.hosta);
    const f = path.join(log.opDir(h.hosta), 'records', 'cos.ndjson');
    const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
    if (how === 'rewrite') lines[0] = lines[0].replace('Postgres', 'MySQL');
    else { const o = JSON.parse(lines[1]); lines.push(JSON.stringify({ ...o, id: 'dec-cos-000003', statement: 'forged', prev: o.hash, hash: 'f'.repeat(40) })); }
    fs.writeFileSync(f, lines.join('\n') + '\n');
    git(sd, 'add', 'operator/records/cos.ndjson');
    git(sd, '-c', 'user.name=x', '-c', 'user.email=x@example.test', 'commit', '-qm', 'by hand');
    const before = git(h.bare, 'rev-parse', 'delivery-operator');
    const r = pub(h.hosta, 'hosta');
    assert.strictEqual(r.published, false, how);
    assert.match(r.reason, how === 'rewrite' ? /records\/cos\.ndjson in the private operator store no longer starts with the published copy/ : /records\/cos\.ndjson as committed in the private operator store fails verification/, how);
    assert.match(r.reason, /git -C .* checkout refs\/remotes\/origin\/delivery-operator -- <path>/, how);
    assert.doesNotMatch(r.reason, /operator-outgoing-/, 'no scratch path in the advice');
    assert.strictEqual(git(h.bare, 'rev-parse', 'delivery-operator'), before, how);
  }
});

function commitManifest(dir, placement) {
  fs.mkdirSync(path.join(dir, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.delivery', 'team', 'team.json'), JSON.stringify({ roles: Object.entries(placement).map(([id, host]) => ({ id, host })) }, null, 2));
  git(dir, 'add', '.delivery/team/team.json'); git(dir, 'commit', '-qm', 'manifest');
}

function forgeRemote(bare, instance, statement, host) {
  const d = path.join(mk('opstore-forger-'), 'w');
  git(path.dirname(d), 'clone', '-q', '-b', 'delivery-operator', bare, d);
  ident(d, 'forger');
  chain.appendEntry(path.join(d, 'operator', 'records', `${instance}.ndjson`), (last) => ({
    ...last, id: `dec-${instance}-${String(Number(last.id.slice(-6)) + 1).padStart(6, '0')}`, statement, by: { instance, host }, hash: undefined, prev: undefined }));
  git(d, 'commit', '-qam', 'operator: 1 entry'); git(d, 'push', '-q', 'origin', 'HEAD:delivery-operator');
}

test('B2: a correctly hashed extension of this store\'s own chain on the remote is a fork for its owner; a reader takes it', () => {
  const h = hosts(2);
  record(h.hosta, 'cos', 'Orders use Postgres', 'hosta');
  say(h.hosta, 'hosta', 'use postgres');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  forgeRemote(h.bare, 'cos', 'Orders use MySQL', 'hosta');
  const r = log.refresh(h.hosta, { host: 'hosta' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diverged, ['records/cos.ndjson']);
  assert.match(r.reason, /records chain forked: another writer appended to records\/cos\.ndjson.*operator\.js quarantine/);
  assert.doesNotMatch(fs.readFileSync(path.join(log.opDir(h.hosta), 'records', 'cos.ndjson'), 'utf8'), /MySQL/, 'the forged line never reaches the owner\'s copy');
  assert.strictEqual(pub(h.hosta, 'hosta').published, false);
  // the same for this host's inputs chain
  const h2 = hosts(1);
  say(h2.hosta, 'hosta', 'one');
  pub(h2.hosta, 'hosta');
  tamper(h2.bare, (d) => {
    chain.appendEntry(path.join(d, 'operator', 'inputs', 'hosta', '2026-10.ndjson'), (last) => ({ ...last, id: 'in-hosta-000002', text: 'forged', hash: undefined, prev: undefined }));
  });
  assert.deepStrictEqual(log.refresh(h2.hosta, { host: 'hosta' }).diverged, ['inputs/hosta/2026-10.ndjson']);
  // a reader (no host of its own on that chain) cannot tell, and takes the extension; verify reads it
  assert.strictEqual(log.refresh(h.hostb, { host: 'hostb' }).ok, true);
  assert.match(fs.readFileSync(path.join(log.opDir(h.hostb), 'records', 'cos.ndjson'), 'utf8'), /MySQL/);
});

test('B2: legitimate growth elsewhere: a fresh clone adopts its host\'s published chains, and a rehosted instance continues on its new host', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'one', 'two');
  record(h.hosta, 'pm', 'first', 'hosta');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  // the store is deleted (or the checkout re-cloned): the first capture fetches before writing
  fs.rmSync(store.storeDir(h.hosta), { recursive: true, force: true });
  say(h.hosta, 'hosta', 'three');
  assert.deepStrictEqual(log.listInputs(h.hosta).map((e) => e.id), ['in-hosta-000001', 'in-hosta-000002', 'in-hosta-000003'], 'the host chain continues');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  assert.deepStrictEqual(inputsOf(h.bare, 'hosta'), ['in-hosta-000001', 'in-hosta-000002', 'in-hosta-000003']);
  // a new store that refreshes before any capture adopts the own records chain too
  fs.rmSync(store.storeDir(h.hosta), { recursive: true, force: true });
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true);
  assert.strictEqual(record(h.hosta, 'pm', 'second', 'hosta').id, 'dec-pm-000002');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  // pm moves to hostb: the manifest change is committed (and pulled on hosta); hostb holds pm's chain
  // as a peer copy, records the rehost and writes there
  for (const dir of [h.hosta, h.hostb]) commitManifest(dir, { pm: 'hostb' });
  assert.strictEqual(log.refresh(h.hostb, { host: 'hostb' }).ok, true);
  chain.appendEntry(path.join(log.opDir(h.hostb), 'records', 'pm.ndjson'), (last) => ({ id: 'rh-pm-000003', kind: 'rehost', instance: 'pm', from: { host: 'hosta', machine: null }, to: { host: 'hostb', machine: null }, by: { instance: 'pm', host: 'hostb' }, ts: new Date().toISOString() }));
  record(h.hostb, 'pm', 'from the new host', 'hostb');
  assert.strictEqual(pub(h.hostb, 'hostb').published, true);
  // the old host sees its former chain grow and accepts it: the rehost explains it
  const r = log.refresh(h.hosta, { host: 'hosta' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(log.opDir(h.hosta), 'records', 'pm.ndjson'), 'utf8'), /from the new host/);
});

test('I3: a remote update never replaces a working copy that already holds more lines (uncommitted local lines are kept)', () => {
  const h = hosts(2);
  record(h.hosta, 'pm', 'one', 'hosta');
  pub(h.hosta, 'hosta');
  say(h.hostb, 'hostb', 'b');
  pub(h.hostb, 'hostb'); // hostb holds pm v1
  record(h.hosta, 'pm', 'two', 'hosta');
  pub(h.hosta, 'hosta'); // the remote holds pm v1+v2
  // hostb's working copy already has v1+v2 and a third line, not committed: another chain's local
  // rewrite makes hostb's commit refuse, so the refresh merges with those lines still uncommitted
  const pmB = path.join(log.opDir(h.hostb), 'records', 'pm.ndjson');
  fs.copyFileSync(path.join(log.opDir(h.hosta), 'records', 'pm.ndjson'), pmB);
  record(h.hostb, 'pm', 'three, local only', 'hosta');
  const inB = path.join(log.opDir(h.hostb), 'inputs', 'hostb', '2026-10.ndjson');
  fs.writeFileSync(inB, fs.readFileSync(inB, 'utf8').replace('"b"', '"edited"'));
  const r = log.refresh(h.hostb);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.refused, 'the local commit was refused');
  assert.match(fs.readFileSync(pmB, 'utf8'), /three, local only/, 'the local line is kept');
});

test('I3: two copies of one chain with no shared history merge to the longer one when it extends the other', () => {
  const h = hosts(2);
  say(h.hosta, 'hosta', 'one', 'two');
  pub(h.hosta, 'hosta');
  // hostb carries hosta's first line from an earlier version's .delivery/operator, imported into a new store
  const first = fs.readFileSync(path.join(log.opDir(h.hosta), 'inputs', 'hosta', '2026-10.ndjson'), 'utf8').split('\n')[0] + '\n';
  const legacy = path.join(h.hostb, '.delivery', 'operator', 'inputs', 'hosta');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, '2026-10.ndjson'), first);
  const r = log.refresh(h.hostb, { host: 'hostb' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(log.listInputs(h.hostb).map((e) => e.id), ['in-hosta-000001', 'in-hosta-000002']);
});

test('B3: a remote that accepts and never answers costs one bounded wait per command, kills its git processes, and a later publish delivers everything', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  // accepts every connection and never answers
  const portFile = path.join(mk('opstore-hang-'), 'port');
  const srv = cp.spawn(process.execPath, ['-e', `const s = require('net').createServer(() => {}); s.listen(0, '127.0.0.1', () => require('fs').writeFileSync(process.argv[1], String(s.address().port)));`, portFile], { stdio: 'ignore' });
  let port = '';
  const t0 = Date.now();
  while (!port && Date.now() - t0 < 5000) { try { port = fs.readFileSync(portFile, 'utf8'); } catch (e) { cp.spawnSync('sleep', ['0.05']); } }
  try {
    assert.ok(port, 'the black-hole server is listening');
    const good = git(h.hosta, 'config', '--get', 'remote.origin.url').trim();
    git(h.hosta, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/r.git`);
    say(h.hosta, 'hosta', 'two', 'three');
    // one command: a refresh then a publish, as every operator.js write does
    const script = `const log = require(${JSON.stringify(path.join(__dirname, 'operator-log.js'))});
      const a = log.refresh(process.argv[1], { host: 'hosta' }); const b = log.publish(process.argv[1], { force: true, host: 'hosta' });
      process.stdout.write(JSON.stringify({ a, b }));`;
    const start = Date.now();
    const out = cp.spawnSync(process.execPath, ['-e', script, h.hosta], { encoding: 'utf8', env: { ...process.env, DELIVERY_GIT_TIMEOUT_MS: '' } });
    const ms = Date.now() - start;
    const { a, b } = JSON.parse(out.stdout);
    assert.ok(ms < 45000, `took ${ms} ms`);
    assert.strictEqual(a.ok, false);
    assert.match(a.reason, /not reachable|did not answer within/);
    assert.strictEqual(b.published, false);
    assert.match(b.reason, /not tried again in this command/, 'the publish does not wait on the remote a second time');
    const left = cp.spawnSync('sh', ['-c', `ps ax -o command | grep "127.0.0.1:${port}" | grep -v grep | wc -l`], { encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(left, '0', 'no git process outlives the command');
    git(h.hosta, 'remote', 'set-url', 'origin', good);
    assert.strictEqual(pub(h.hosta, 'hosta').published, true);
    assert.deepStrictEqual(inputsOf(h.bare, 'hosta'), ['in-hosta-000001', 'in-hosta-000002', 'in-hosta-000003']);
  } finally { srv.kill('SIGKILL'); }
});

test('minors: publish reports the entries it pushed (also those committed by an earlier refresh), honours pushurl, and follows a sha256 project', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one', 'two');
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true); // committed in the store, not pushed
  const r = pub(h.hosta, 'hosta');
  assert.strictEqual(r.published, true);
  assert.strictEqual(r.entries, 2);
  assert.strictEqual(pub(h.hosta, 'hosta').nothing_new, true);
  // a push URL set on the project is the store's push URL too
  const mirror = path.join(h.base, 'push.git');
  git(h.base, 'clone', '-q', '--bare', h.bare, mirror);
  git(h.hosta, 'config', 'remote.origin.pushurl', mirror);
  say(h.hosta, 'hosta', 'three');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  assert.strictEqual(git(store.storeDir(h.hosta), 'config', '--get', 'remote.origin.pushurl').trim(), mirror);
  assert.strictEqual(git(mirror, 'show', 'delivery-operator:operator/inputs/hosta/2026-10.ndjson').trim().split('\n').length, 3);
  // a sha256 project gets a sha256 store
  const probe = gitTry(h.base, 'init', '-q', '--object-format=sha256', path.join(h.base, 'probe256'));
  if (probe.status !== 0) return; // git without sha256 support
  const bare = path.join(h.base, 'r256.git');
  git(h.base, 'init', '-q', '--bare', '--object-format=sha256', bare);
  const c = path.join(h.base, 'c256');
  git(h.base, 'clone', '-q', bare, c);
  ident(c, 'c');
  say(c, 'pc', 'sha256 words');
  const p256 = pub(c, 'pc');
  assert.strictEqual(p256.published, true, JSON.stringify(p256));
  assert.strictEqual(git(store.storeDir(c), 'rev-parse', '--show-object-format').trim(), 'sha256');
  say(c, 'pc', 'more');
  assert.strictEqual(pub(c, 'pc').entries, 1);
});

// ---- third review round ----

// someone with push access records a rehost of an instance owned elsewhere, then writes as it
function forgeRehost(bare, instance, toHost) {
  const d = path.join(mk('opstore-rehost-'), 'w');
  git(path.dirname(d), 'clone', '-q', '-b', 'delivery-operator', bare, d);
  ident(d, 'forger');
  const f = path.join(d, 'operator', 'records', `${instance}.ndjson`);
  chain.appendEntry(f, (last) => ({ id: `rh-${instance}-${String(Number(last.id.slice(-6)) + 1).padStart(6, '0')}`, kind: 'rehost', instance, from: { host: 'hosta', machine: null }, to: { host: toHost, machine: null }, by: { instance, role: 'chief-of-staff', host: toHost }, ts: new Date().toISOString() }));
  chain.appendEntry(f, (last) => ({ id: `dec-${instance}-${String(Number(last.id.slice(-6)) + 1).padStart(6, '0')}`, kind: 'decision', statement: 'Orders use MySQL', by: { instance, host: toHost }, ts: new Date().toISOString() }));
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'operator: 2 entries'); git(d, 'push', '-q', 'origin', 'HEAD:delivery-operator');
}

test('round 3: a rehost the committed manifest does not back is a loud fork for the owner, naming the rehost record', () => {
  const h = hosts(1);
  commitManifest(h.hosta, { cos: 'hosta' });
  record(h.hosta, 'cos', 'Orders use Postgres', 'hosta');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  forgeRehost(h.bare, 'cos', 'cloud');
  const r = log.refresh(h.hosta, { host: 'hosta' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.diverged, ['records/cos.ndjson']);
  assert.match(r.reason, /moves cos to cloud with rh-cos-000002, but the committed \.delivery\/team\/team\.json places it on hosta; that rehost is not authorised/);
  assert.match(r.reason, /dec-cos-000003 \(by cos from cloud\)/);
  assert.strictEqual(r.diverged_detail[0].rehost, 'rh-cos-000002');
  assert.doesNotMatch(fs.readFileSync(path.join(log.opDir(h.hosta), 'records', 'cos.ndjson'), 'utf8'), /MySQL/);
  // an uncommitted manifest edit does not authorise it either
  fs.writeFileSync(path.join(h.hosta, '.delivery', 'team', 'team.json'), JSON.stringify({ roles: [{ id: 'cos', host: 'cloud' }] }));
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, false);
  // once the move is committed in the manifest, the same rehost is accepted
  git(h.hosta, 'commit', '-qam', 'cos moves to the cloud');
  const ok = log.refresh(h.hosta, { host: 'hosta' });
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
});

test('round 3: quarantine does not launder a remote extension: it names the lines and needs --adopt-remote', () => {
  const R = require('./operator-records.js');
  const h = hosts(1);
  record(h.hosta, 'cos', 'Orders use Postgres', 'hosta');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  forgeRemote(h.bare, 'cos', 'Orders use MySQL', 'hosta');
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, false);
  const CHIEF = { instance: 'chief-of-staff', role: 'chief-of-staff', host: 'hosta' };
  const f = path.join(log.opDir(h.hosta), 'records', 'cos.ndjson');
  let err = null;
  try { R.quarantine({ projectRoot: h.hosta, file: 'records/cos.ndjson', reason: 'forged line', by: CHIEF }); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'adopt_remote_needed');
  assert.match(err.message, /plus 1 line\(s\) this store did not write: dec-cos-000002 \(by cos from hosta\).*--adopt-remote/);
  assert.ok(fs.existsSync(f), 'nothing was moved');
  const q = R.quarantine({ projectRoot: h.hosta, file: 'records/cos.ndjson', reason: 'reviewed: genuine', by: CHIEF, adoptRemote: true });
  assert.deepStrictEqual(q.adopted.map((e) => e.id), ['dec-cos-000002']);
  assert.match(fs.readFileSync(path.join(h.hosta, q.evidence), 'utf8'), /dec-cos-000002 by cos from hosta/);
});

test('round 3: the chain\'s own instance or host may quarantine it; others may not', () => {
  const R = require('./operator-records.js');
  const root = mk('opstore-q-');
  record(root, 'pm', 'x', 'pc');
  say(root, 'pc', 'words');
  const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
  assert.strictEqual(code(() => R.quarantine({ projectRoot: root, file: 'records/pm.ndjson', reason: 'r', by: { instance: 'builder-1', role: 'builder', host: 'pc' } })), 'not_allowed');
  assert.strictEqual(code(() => R.quarantine({ projectRoot: root, file: 'records/pm.ndjson', reason: 'r', by: { instance: 'pm', role: 'product-manager', host: 'pc' } })), null);
  assert.strictEqual(code(() => R.quarantine({ projectRoot: root, file: 'inputs/pc/2026-10.ndjson', reason: 'r', by: { instance: 'builder-1', role: 'builder', host: 'other' } })), 'not_allowed');
  assert.strictEqual(code(() => R.quarantine({ projectRoot: root, file: 'inputs/pc/2026-10.ndjson', reason: 'r', by: { instance: 'builder-1', role: 'builder', host: 'pc' } })), null);
});

// a child process runs one publish, with its own environment (the "remote down" memory of a process
// must not leak into the other tests)
function publishIn(root, env) {
  const script = `const log = require(${JSON.stringify(path.join(__dirname, 'operator-log.js'))});
    process.stdout.write(JSON.stringify(log.publish(process.argv[1], { force: true, host: 'hosta' })));`;
  const t = Date.now();
  const r = cp.spawnSync(process.execPath, ['-e', script, root], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { ms: Date.now() - t, res: JSON.parse(r.stdout || '{}') };
}
function server(kind) {
  const portFile = path.join(mk('opstore-srv-'), 'port');
  const body = kind === 'auth'
    ? `require('http').createServer((q, s) => { s.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); s.end(); })`
    : `require('net').createServer(() => {})`;
  const srv = cp.spawn(process.execPath, ['-e', `const s = ${body}; s.listen(0, '127.0.0.1', () => require('fs').writeFileSync(process.argv[1], String(s.address().port)));`, portFile], { stdio: 'ignore' });
  let port = '';
  const t0 = Date.now();
  while (!port && Date.now() - t0 < 5000) { try { port = fs.readFileSync(portFile, 'utf8'); } catch (e) { cp.spawnSync('sleep', ['0.05']); } }
  return { srv, port };
}

test('round 3: a blocking credential helper is killed with its process group; no process outlives the call', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one');
  const { srv, port } = server('auth');
  try {
    assert.ok(port);
    git(h.hosta, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/r.git`);
    store.ensureStore(h.hosta);
    const marker = `301.${process.pid}${Date.now() % 100000}`;
    git(store.storeDir(h.hosta), 'config', 'credential.helper', `!f() { sleep ${marker}; }; f`);
    const { ms, res } = publishIn(h.hosta, { DELIVERY_GIT_TIMEOUT_MS: '2000' });
    assert.strictEqual(res.published, false);
    assert.match(res.reason, /did not answer within 2 s/);
    // the runner kills the whole group at the timeout; without that, the helper would hold the pipes
    // until the outer guard (timeout + 5 s) kills the group instead
    assert.ok(ms < 5000, `took ${ms} ms`);
    cp.spawnSync('sleep', ['0.3']);
    const left = cp.spawnSync('sh', ['-c', `ps ax -o command | grep "sleep ${marker}" | grep -v grep | wc -l`], { encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(left, '0', 'the helper was killed with the group');
    // the next command within 60 s does not wait on the remote again, in another process
    const again = publishIn(h.hosta, { DELIVERY_GIT_TIMEOUT_MS: '2000' });
    assert.ok(again.ms < 1500, `took ${again.ms} ms`);
    assert.match(again.res.reason, /seen \d+ s ago; tried again after \d+ s/);
  } finally { srv.kill('SIGKILL'); }
});

test('round 3: one publish stays inside its budget even when each network call may take longer', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one');
  const { srv, port } = server('hang');
  try {
    git(h.hosta, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/r.git`);
    const { ms, res } = publishIn(h.hosta, { DELIVERY_GIT_TIMEOUT_MS: '20000', DELIVERY_PUBLISH_BUDGET_MS: '2500' });
    assert.strictEqual(res.published, false);
    assert.ok(ms < 6000, `took ${ms} ms`);
  } finally { srv.kill('SIGKILL'); }
});

test('round 3: a refresh that works clears the reason the last push failed', () => {
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one');
  const f = path.join(log.opDir(h.hosta), 'cursors', 'last-publish.json');
  fs.writeFileSync(f, JSON.stringify({ at: Date.now(), reason: 'records chain forked: an old fork' }));
  assert.match(log.lastPublishReason(h.hosta), /old fork/);
  assert.strictEqual(log.refresh(h.hosta, { host: 'hosta' }).ok, true);
  assert.strictEqual(log.lastPublishReason(h.hosta), null);
});

test('round 3: an offline first fetch on a re-clone forks the host chain; quarantine recovers it and the inputs are captured again', () => {
  const R = require('./operator-records.js');
  const h = hosts(1);
  say(h.hosta, 'hosta', 'one');
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
  fs.rmSync(store.storeDir(h.hosta), { recursive: true, force: true });
  const good = git(h.hosta, 'config', '--get', 'remote.origin.url').trim();
  git(h.hosta, 'remote', 'set-url', 'origin', path.join(h.base, 'missing.git'));
  const tr = path.join(mk('opstore-tr2-'), 't.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'off-p1', uuid: 'off-u1', timestamp: '2026-10-13T11:00:00.000Z', sessionId: 'off', message: { role: 'user', content: 'said while offline' } }) + '\n');
  const sync = () => log.syncTranscript({ projectRoot: h.hosta, transcriptPath: tr, sessionId: 'off', instance: 'cos', role: 'chief-of-staff', host: 'hosta', now: new Date('2026-10-13T12:00:00Z') });
  sync();
  assert.deepStrictEqual(log.listInputs(h.hosta).map((e) => e.id), ['in-hosta-000001'], 'the chain started over');
  git(h.hosta, 'remote', 'set-url', 'origin', good);
  const r = log.refresh(h.hosta, { host: 'hosta' });
  assert.deepStrictEqual(r.diverged, ['inputs/hosta/2026-10.ndjson']);
  assert.match(r.reason, /quarantine --file inputs\/hosta\/2026-10\.ndjson/);
  R.quarantine({ projectRoot: h.hosta, file: 'inputs/hosta/2026-10.ndjson', reason: 'offline re-clone', by: { instance: 'cos', role: 'chief-of-staff', host: 'hosta' } });
  sync();
  assert.deepStrictEqual(log.listInputs(h.hosta).map((e) => [e.id, e.text]), [['in-hosta-000001', 'one'], ['in-hosta-000002', 'said while offline']]);
  assert.strictEqual(pub(h.hosta, 'hosta').published, true);
});
