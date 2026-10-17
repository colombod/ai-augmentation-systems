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
function record(root, instance, statement) {
  return chain.appendEntry(path.join(log.opDir(root), 'records', `${instance}.ndjson`), (last) => {
    const n = last ? Number(last.id.slice(-6)) + 1 : 1;
    return { id: `dec-${instance}-${String(n).padStart(6, '0')}`, kind: 'decision', statement, by: { instance }, ts: new Date().toISOString() };
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
