// scripts/lib/operator-store.js — where the operator records live and how they travel.
//
// The records are kept in a PRIVATE git repository that the user's checkout never sees:
//   <git-common-dir of the project>/delivery-operator/          the store (its own .git, branch delivery-operator)
//   <store>/operator/{inputs,records,LEDGER.md}                 tracked: the hash chains and the derived ledger
//   <store>/operator/{cursors,quarantine}/                      local state, never committed
// It lives inside the project's .git directory, so it is outside the user's index and working tree:
// git status, git clean, git stash, git reset --hard and the user's commits never see it. Every git
// command that changes state runs in the store; in the project only `git rev-parse --git-common-dir`
// and `git config --get remote.origin.url` are read. The store's remote is the project's origin; the
// records travel on its `delivery-operator` branch, which carries operator files only.
//
// A project root that is not in a git repository keeps the records in <project>/.delivery/operator
// (local only, nothing to publish). Records left there by an earlier version are copied into the
// store the first time a git project resolves its store.
//
// Callers only ask for paths (operatorDir) and call publish / refresh / unpublished; the chain and
// validation code never runs git.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const BRANCH = 'delivery-operator';
const REF = `refs/heads/${BRANCH}`;
const TRACKING = `refs/remotes/origin/${BRANCH}`;
const STORE_NAME = 'delivery-operator';
const OP = 'operator'; // the operator directory inside the store
const LEGACY_REL = path.join('.delivery', 'operator');
// object ids depend on the repository's object format (the store follows the project's)
const EMPTY_TREES = { sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321' };
const emptyTree = (loc) => EMPTY_TREES[loc.fmt] || EMPTY_TREES.sha1;
const zero = (loc) => '0'.repeat(loc.fmt === 'sha256' ? 64 : 40);
const PUSH_ATTEMPTS = 5;
// Network calls (fetch, push) are bounded: a remote that accepts and never answers must not stall a
// write. Each call gets at most DELIVERY_GIT_TIMEOUT_MS (default 15 s), one publish at most
// DELIVERY_PUBLISH_BUDGET_MS in all (default 30 s).
const envMs = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const NET_TIMEOUT_MS = () => envMs('DELIVERY_GIT_TIMEOUT_MS', 15000);
const PUBLISH_BUDGET_MS = () => envMs('DELIVERY_PUBLISH_BUDGET_MS', 30000);
const NET_FLAGS = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=10'];
// set when a network call in this process timed out or could not reach the remote: later calls in the
// same command do not wait on it again
let networkDown = null;
const LOCK_WAIT_MS = 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const IDENTITY = { GIT_AUTHOR_NAME: 'delivery operator store', GIT_AUTHOR_EMAIL: 'operator-store@delivery.invalid',
  GIT_COMMITTER_NAME: 'delivery operator store', GIT_COMMITTER_EMAIL: 'operator-store@delivery.invalid' };
// Inherited variables that would point git at another repository, index or work tree (a hook of the
// user's own repository sets some of them).
const REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_QUARANTINE_PATH',
  'GIT_INDEX_VERSION', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE'];
// Settings that make the store's own commands independent of the user's hooks, signing and helpers.
const STORE_FLAGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'core.fsmonitor=false',
  '-c', 'core.autocrlf=false', '-c', 'maintenance.auto=false', '-c', 'push.gpgSign=false'];

const CHAIN_RE = /^operator\/(?:inputs\/[A-Za-z0-9._-]+\/\d{4}-\d{2}\.ndjson|records\/[A-Za-z0-9][A-Za-z0-9._-]*\.ndjson)$/;
const LEDGER = `${OP}/LEDGER.md`;
const isChain = (p) => CHAIN_RE.test(p);

function baseEnv(extra) {
  const env = { ...process.env };
  for (const k of REPO_ENV) delete env[k];
  env.GIT_TERMINAL_PROMPT = '0';
  return extra ? { ...env, ...extra } : env;
}

// A network git call, in its own process group, killed with the whole group (git-remote-http, ssh)
// when it outlives its timeout. { ok, out, err, timedOut }.
const NET_RUNNER = `
const cp = require('child_process');
const [cwd, timeout, args] = [process.argv[1], Number(process.argv[2]), JSON.parse(process.argv[3])];
const c = cp.spawn('git', args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
process.stderr.write('PGID:' + c.pid + '\\n'); // so the parent can kill the group if this runner stalls
let out = '', err = '', timedOut = false;
c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
const t = setTimeout(() => { timedOut = true; try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { try { c.kill('SIGKILL'); } catch (x) {} } }, timeout);
c.on('error', (e) => { err += String(e.message); });
c.on('close', (code) => { clearTimeout(t); process.stdout.write(JSON.stringify({ code, out, err, timedOut })); });
`;
function runNet(loc, args, timeoutMs) {
  const env = baseEnv();
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH && !sshConfigured(loc)) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
  const r = cp.spawnSync(process.execPath, ['-e', NET_RUNNER, loc.store, String(timeoutMs), JSON.stringify([...STORE_FLAGS, ...NET_FLAGS, ...args])],
    { env, encoding: 'utf8', timeout: timeoutMs + 5000, maxBuffer: 64 * 1024 * 1024 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
  if (!j) {
    // the runner itself did not finish: kill the git process group it started
    const m = /PGID:(\d+)/.exec(String(r.stderr || ''));
    if (m) { try { process.kill(-Number(m[1]), 'SIGKILL'); } catch (e) { /* gone */ } }
  }
  if (!j) return { ok: false, out: '', err: `git ${args[0]} did not finish (${r.error ? r.error.message : 'no result'})`, timedOut: true };
  return { ok: j.code === 0 && !j.timedOut, out: String(j.out || '').replace(/\s+$/, ''), err: String(j.err || '').trim(), timedOut: !!j.timedOut };
}
function sshConfigured(loc) {
  if (loc.sshConfigured === undefined) loc.sshConfigured = run(loc.store, ['config', '--get', 'core.sshCommand']).ok;
  return loc.sshConfigured;
}

function run(cwd, args, o = {}) {
  const r = cp.spawnSync('git', o.plain ? args : [...STORE_FLAGS, ...args], {
    cwd, env: baseEnv(o.env), input: o.input, timeout: o.timeout || 120000, maxBuffer: 256 * 1024 * 1024,
    encoding: o.buffer ? null : 'utf8',
  });
  const out = o.buffer ? (r.stdout || Buffer.alloc(0)) : String(r.stdout || '').replace(/\s+$/, '');
  return { ok: r.status === 0, out, err: String(r.stderr || '').trim() + (r.error ? ` ${r.error.message}` : '') };
}

// ---- locating the store ----

const located = new Map();
function hasGitAbove(dir) {
  let d = dir;
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

// { git: true, store, opDir } for a project in a git repository, { git: false, opDir } otherwise.
// Only a found repository is cached: a directory that becomes one later is picked up.
function locate(projectRoot) {
  const root = path.resolve(String(projectRoot));
  const hit = located.get(root);
  if (hit) return hit;
  const legacy = { git: false, opDir: path.join(root, LEGACY_REL) };
  if (!hasGitAbove(root)) return legacy;
  const r = run(root, ['rev-parse', '--git-common-dir'], { plain: true });
  if (!r.ok || !r.out) return legacy;
  const store = path.join(path.resolve(root, r.out), STORE_NAME);
  const loc = { git: true, root, store, opDir: path.join(store, OP), legacy: legacy.opDir };
  Object.defineProperty(loc, 'fmt', { enumerable: true, get() { return objectFormat(loc); } });
  located.set(root, loc);
  return loc;
}

// The store's object format: the store's own once it exists, else the project's (read-only), else sha1.
function objectFormat(loc) {
  if (loc._fmt) return loc._fmt;
  const where = fs.existsSync(path.join(loc.store, '.git', 'HEAD')) ? loc.store : loc.root;
  const r = run(where, ['rev-parse', '--show-object-format'], { plain: true });
  const f = r.ok && /^sha(1|256)$/.test(r.out) ? r.out : 'sha1';
  if (where === loc.store) loc._fmt = f;
  return f;
}

// The directory every operator read and write uses. For a git project, records an earlier version left
// in <project>/.delivery/operator are copied in the first time (plain file copies, no git), so a host's
// chain continues where it was instead of starting over.
function operatorDir(projectRoot) {
  const loc = locate(projectRoot);
  if (loc.git && !loc.imported) {
    loc.imported = true;
    try { importLegacy(loc); } catch (e) { /* best effort: the legacy files stay where they are */ }
  }
  return loc.opDir;
}

function storeDir(projectRoot) {
  const loc = locate(projectRoot);
  return loc.git ? loc.store : null;
}

function importLegacy(loc) {
  if (fs.existsSync(loc.opDir)) return;
  const parts = ['inputs', 'records', 'cursors', 'quarantine'].filter((p) => fs.existsSync(path.join(loc.legacy, p)));
  if (!parts.length) return;
  const tmp = path.join(loc.store, `.import-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmp, { recursive: true });
  for (const p of parts) fs.cpSync(path.join(loc.legacy, p), path.join(tmp, p), { recursive: true, filter: (src) => !/\.lock$/.test(src) });
  try { fs.renameSync(tmp, loc.opDir); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); } // another process won
}

// Create the store's repository when it does not exist yet: local only, no network.
function ensureStore(projectRoot) {
  const loc = locate(projectRoot);
  if (!loc.git) return null;
  operatorDir(projectRoot);
  if (fs.existsSync(path.join(loc.store, '.git', 'HEAD'))) return loc;
  fs.mkdirSync(loc.store, { recursive: true });
  withStoreLock(loc, () => {
    if (fs.existsSync(path.join(loc.store, '.git', 'HEAD'))) return;
    // the project's object format (blob ids are computed here to skip unchanged files); git before
    // 2.29 has no --object-format and makes sha1 repositories anyway
    const init = run(loc.store, ['init', '-q', '--template=', `--object-format=${objectFormat(loc)}`]);
    if (!init.ok) {
      const plain = run(loc.store, ['init', '-q', '--template=']);
      if (!plain.ok) throw new Error(`cannot create the private operator store at ${loc.store}: ${firstLine(plain.err || init.err)}`);
    }
    const steps = [
      ['symbolic-ref', 'HEAD', REF],
      ['config', 'core.hooksPath', '/dev/null'],
      ['config', 'commit.gpgSign', 'false'],
      ['config', 'gc.auto', '0'],
    ];
    for (const s of steps) {
      const r = run(loc.store, s);
      if (!r.ok) throw new Error(`cannot create the private operator store at ${loc.store}: ${firstLine(r.err)}`);
    }
    fs.mkdirSync(path.join(loc.store, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(loc.store, '.git', 'info', 'exclude'),
      ['operator/cursors/', 'operator/quarantine/', '*.lock', '*.lock.stale-*', '*.stale-*', '*.tmp', '*.partial-*', '.import-*', ''].join('\n'));
  }, { early: true });
  return loc;
}

// ---- the store lock: one publish or refresh per store at a time ----

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function withStoreLock(loc, fn, o = {}) {
  const file = o.early ? path.join(loc.store, '.store-init.lock') : path.join(loc.store, '.git', 'delivery-store.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
  const wait = o.waitMs === undefined ? LOCK_WAIT_MS : o.waitMs;
  const deadline = Date.now() + wait;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, token); } finally { fs.closeSync(fd); }
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let seen = null;
      let age = 0;
      try { seen = fs.readFileSync(file, 'utf8'); age = Date.now() - fs.statSync(file).mtimeMs; } catch (e) { continue; }
      const pid = Number(String(seen).split(':')[0]);
      if ((Number.isInteger(pid) && pid > 0 && !alive(pid)) || age > LOCK_STALE_MS) {
        const aside = `${file}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(file, aside);
          if (fs.readFileSync(aside, 'utf8') !== seen) { try { fs.linkSync(aside, file); } catch (e) { /* slot taken */ } }
          fs.unlinkSync(aside);
        } catch (e) { /* lost the race */ }
        continue;
      }
      if (Date.now() >= deadline) {
        if (o.waitMs !== undefined) return o.busy ? o.busy() : undefined;
        throw new Error(`another operator command on this host holds the store lock (${file}, pid ${pid || '?'}) for over ${wait / 1000} s; retry in a moment, or remove the lock file if no operator command is running`);
      }
      sleepMs(20 + Math.floor(Math.random() * 30));
    }
  }
  try { return fn(); } finally {
    try { if (fs.readFileSync(file, 'utf8') === token) fs.unlinkSync(file); } catch (e) { /* gone */ }
  }
}

// ---- small git helpers (store only) ----

function firstLine(s) {
  return String(s || '').split('\n').map((l) => l.replace(/^(?:fatal|error|remote|hint|warning):\s*/i, '').trim()).find(Boolean) || '';
}

function blobSha(loc, buf) {
  return crypto.createHash(loc.fmt === 'sha256' ? 'sha256' : 'sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function revParse(dir, rev) {
  const r = run(dir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return r.ok && r.out ? r.out : null;
}

// path -> blob sha for the operator files of a commit (or {} for none).
function treeOf(dir, rev) {
  if (!rev) return {};
  const r = run(dir, ['ls-tree', '-r', '-z', rev, '--', OP]);
  const out = {};
  if (!r.ok) return out;
  for (const e of r.out.split('\0')) {
    const tab = e.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = e.slice(0, tab).split(' ');
    if (type === 'blob') out[e.slice(tab + 1)] = sha;
  }
  return out;
}

// sha -> Buffer for many blobs in one process.
function readBlobs(dir, shas) {
  const want = [...new Set(shas.filter(Boolean))];
  const out = new Map();
  if (!want.length) return out;
  const r = run(dir, ['cat-file', '--batch'], { input: want.join('\n') + '\n', buffer: true });
  if (!r.ok) throw new Error(`cannot read the private operator store: ${firstLine(r.err)}`);
  let pos = 0;
  const buf = r.out;
  for (const sha of want) {
    const nl = buf.indexOf(0x0a, pos);
    const head = buf.subarray(pos, nl).toString('utf8').split(' ');
    pos = nl + 1;
    if (head[1] === 'missing') continue;
    const size = Number(head[2]);
    out.set(sha, buf.subarray(pos, pos + size));
    pos += size + 1;
  }
  return out;
}

const startsWith = (buf, prefix) => buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
const lineCount = (buf) => { let n = 0; for (const b of buf) if (b === 0x0a) n++; return n; };
// the complete lines of a chain file: a torn last line (a writer that crashed mid-append) is never committed
const complete = (buf) => buf.subarray(0, buf.lastIndexOf(0x0a) + 1);

// Every chain file and the ledger in the store's working directory, as store paths.
function workingFiles(loc) {
  const out = [];
  const walk = (rel) => {
    let ents;
    try { ents = fs.readdirSync(path.join(loc.store, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      const p = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(p);
      else if (d.isFile() && isChain(p)) out.push(p);
    }
  };
  walk(`${OP}/inputs`);
  walk(`${OP}/records`);
  if (fs.existsSync(path.join(loc.store, LEDGER))) out.push(LEDGER);
  return out.sort();
}
const readWorking = (loc, p) => { try { return fs.readFileSync(path.join(loc.store, p)); } catch (e) { return null; } };
const opRel = (p) => p.slice(OP.length + 1);

// The lock the chain's own writer appends under (chain.appendEntry, operator-log syncTranscript).
function writerLock(loc, p) {
  if (p.startsWith(`${OP}/inputs/`)) return path.join(loc.store, path.dirname(p), '.host.lock');
  if (p.startsWith(`${OP}/records/`)) return path.join(loc.store, p) + '.lock';
  return null;
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

function tempIndex(loc) { return path.join(loc.store, '.git', `delivery-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`); }

// ---- commit: this host's new lines become a store commit ----

// Commit every chain file whose complete lines grew since HEAD. A committed file must only ever grow:
// a file that no longer starts with its committed copy is refused (nothing is committed), as is a
// changed chain that fails opts.check. Returns { ok, committed, entries, sha, reason?, paths? }.
function commitLocal(loc, opts) {
  const head = revParse(loc.store, 'HEAD');
  const tree = treeOf(loc.store, head);
  const changes = [];
  for (const p of workingFiles(loc)) {
    const raw = readWorking(loc, p);
    if (raw === null) continue;
    const body = p === LEDGER ? raw : complete(raw);
    if (!body.length && !tree[p]) continue;
    const sha = blobSha(loc, body);
    if (tree[p] === sha) continue;
    changes.push({ path: p, body, sha });
  }
  if (!changes.length) return { ok: true, committed: false, entries: 0, sha: head };
  const old = readBlobs(loc.store, changes.filter((c) => c.path !== LEDGER).map((c) => tree[c.path]));
  const rewritten = changes.filter((c) => c.path !== LEDGER && tree[c.path] && !startsWith(c.body, old.get(tree[c.path]) || Buffer.alloc(0)));
  if (rewritten.length) {
    const p = rewritten[0].path;
    return { ok: false, committed: false, code: 'rewritten', paths: rewritten.map((c) => opRel(c.path)),
      reason: `${opRel(p)} no longer starts with the copy already committed in the private operator store (it was edited, truncated or replaced). Nothing was committed or pushed. A published chain only grows: keep the current file as evidence, then restore the committed copy with \`git -C ${loc.store} checkout -- ${p}\`; a chain that cannot be restored is set aside with operator.js quarantine and its instance records under a new instance id (the chief of staff decides)` };
  }
  const chains = changes.filter((c) => c.path !== LEDGER).map((c) => opRel(c.path));
  if (opts.check && chains.length) {
    const bad = opts.check(chains);
    if (bad) return { ok: false, committed: false, code: 'check_failed', paths: [bad.path], reason: `${bad.path} fails verification (${bad.error}). Nothing was committed or pushed; run operator.js problems, then repair a torn tail (operator.js repair --instance <i>) or have the chief of staff quarantine the chain` };
  }
  const entries = changes.filter((c) => c.path !== LEDGER)
    .reduce((n, c) => n + lineCount(c.body) - (tree[c.path] ? lineCount(old.get(tree[c.path]) || Buffer.alloc(0)) : 0), 0);
  const idx = tempIndex(loc);
  const env = { GIT_INDEX_FILE: idx };
  try {
    const rt = run(loc.store, ['read-tree', head || emptyTree(loc)], { env });
    if (!rt.ok) return { ok: false, committed: false, reason: `cannot stage in the private operator store: ${firstLine(rt.err)}` };
    for (const c of changes) {
      const w = run(loc.store, ['hash-object', '-w', '--stdin'], { input: c.body });
      if (!w.ok) return { ok: false, committed: false, reason: `cannot write to the private operator store: ${firstLine(w.err)}` };
    }
    const ui = run(loc.store, ['update-index', '--add', '--index-info'], { env, input: changes.map((c) => `100644 ${c.sha}\t${c.path}\n`).join('') });
    if (!ui.ok) return { ok: false, committed: false, reason: `cannot stage in the private operator store: ${firstLine(ui.err)}` };
    const t = run(loc.store, ['write-tree'], { env });
    if (!t.ok) return { ok: false, committed: false, reason: `cannot write a tree in the private operator store: ${firstLine(t.err)}` };
    const msg = `operator: ${entries} ${entries === 1 ? 'entry' : 'entries'}${opts.host ? ` from ${opts.host}` : ''}`;
    const c = run(loc.store, ['commit-tree', '--no-gpg-sign', t.out, ...(head ? ['-p', head] : []), '-m', msg], { env: IDENTITY });
    if (!c.ok) return { ok: false, committed: false, reason: `cannot commit in the private operator store: ${firstLine(c.err)}` };
    const u = run(loc.store, ['update-ref', REF, c.out, head || zero(loc)]);
    if (!u.ok) return { ok: false, committed: false, reason: `cannot advance the private operator store: ${firstLine(u.err)}` };
    run(loc.store, ['read-tree', c.out]); // the store's own index follows, so `git -C <store> status` reads clean
    return { ok: true, committed: true, entries, sha: c.out };
  } finally {
    try { fs.unlinkSync(idx); } catch (e) { /* gone */ }
  }
}

// ---- merge: the remote's commits into the store ----

// Every chain in either side must reach the result whole: the result's copy starts with ours and with
// theirs. A missing file (a deletion), a shortened or rewritten copy, or two copies that both grew
// differently (a fork) is refused. [{ path, kind: 'fork'|'deleted'|'rewritten' }] (empty when fine).
function verifyMerge(loc, ours, theirs, merged) {
  const paths = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].filter(isChain);
  const need = [];
  for (const p of paths) {
    if (!merged[p]) continue;
    for (const side of [ours[p], theirs[p]]) if (side && side !== merged[p]) need.push(side, merged[p]);
  }
  const blobs = readBlobs(loc.store, need);
  const bad = [];
  for (const p of paths.sort()) {
    const m = merged[p];
    if (!m) { bad.push({ path: opRel(p), kind: 'deleted', side: ours[p] ? 'remote' : 'local' }); continue; }
    const o = ours[p] && ours[p] !== m ? startsWith(blobs.get(m), blobs.get(ours[p])) : true;
    const t = theirs[p] && theirs[p] !== m ? startsWith(blobs.get(m), blobs.get(theirs[p])) : true;
    if (!o && !t) bad.push({ path: opRel(p), kind: 'fork' });
    else if (!o) bad.push({ path: opRel(p), kind: 'rewritten', side: 'remote' });
    else if (!t) bad.push({ path: opRel(p), kind: 'fork' });
  }
  return bad;
}

// The merged tree of ours and theirs, built in a temporary index (never the working directory). Paths
// differ by writer, so a merge is a union; a chain both sides grew is taken when one copy extends the
// other, the derived LEDGER.md keeps ours. { tree } or { conflicts: [{ path, kind }] }.
function mergeTrees(loc, ours, theirs) {
  const base = run(loc.store, ['merge-base', ours, theirs]);
  const idx = tempIndex(loc);
  const env = { GIT_INDEX_FILE: idx };
  try {
    const rt = run(loc.store, ['read-tree', '-i', '-m', base.ok && base.out ? base.out : emptyTree(loc), ours, theirs], { env });
    if (!rt.ok) return { error: `cannot merge in the private operator store: ${firstLine(rt.err)}` };
    const u = run(loc.store, ['ls-files', '-u', '-z'], { env });
    const stages = {};
    for (const e of u.out.split('\0')) {
      const tab = e.indexOf('\t');
      if (tab < 0) continue;
      const [, sha, stage] = e.slice(0, tab).split(' ');
      (stages[e.slice(tab + 1)] = stages[e.slice(tab + 1)] || {})[stage] = sha;
    }
    const conflicts = [];
    const resolved = [];
    const blobs = readBlobs(loc.store, Object.values(stages).flatMap((s) => [s['2'], s['3']]));
    for (const [p, s] of Object.entries(stages)) {
      const o = s['2'];
      const t = s['3'];
      if (!isChain(p)) { resolved.push([p, o || t]); continue; } // the derived ledger (or a stray file): ours
      if (o && t && startsWith(blobs.get(o), blobs.get(t))) resolved.push([p, o]);
      else if (o && t && startsWith(blobs.get(t), blobs.get(o))) resolved.push([p, t]);
      else conflicts.push({ path: opRel(p), kind: o && t ? 'fork' : 'deleted', side: o ? 'remote' : 'local' });
    }
    if (conflicts.length) return { conflicts };
    if (resolved.length) {
      const ui = run(loc.store, ['update-index', '--index-info'], { env, input: resolved.map(([p, sha]) => `100644 ${sha}\t${p}\n`).join('') });
      if (!ui.ok) return { error: `cannot merge in the private operator store: ${firstLine(ui.err)}` };
    }
    const t = run(loc.store, ['write-tree'], { env });
    if (!t.ok) return { error: `cannot merge in the private operator store: ${firstLine(t.err)}` };
    return { tree: t.out };
  } finally {
    try { fs.unlinkSync(idx); } catch (e) { /* gone */ }
  }
}

function divergedReason(loc, bad) {
  // the records chain is named first: it is the one writes are refused on
  const b = bad.find((x) => x.path.startsWith('records/')) || bad[0];
  const take = `\`git -C ${loc.store} checkout ${TRACKING} -- ${OP}/${b.path}\` and commit it in the store`;
  if (b.kind === 'deleted' && b.side === 'remote') {
    return `the remote delivery-operator branch no longer has ${b.path}, which this store holds; a published chain is never deleted, so nothing was merged or pushed. Tell the chief of staff: someone removed it from the remote (inspect with \`git -C ${loc.store} log --stat ${TRACKING}\`); the next publish from a store that holds it restores it once the remote is put back`;
  }
  if (b.kind === 'rewritten') {
    return `the remote copy of ${b.path} no longer starts with this store's copy: published history was rewritten. Nothing was merged or pushed. Tell the chief of staff; inspect with \`git -C ${loc.store} log -p ${TRACKING} -- ${OP}/${b.path}\`. To accept the remote copy after keeping this one as evidence: ${take}`;
  }
  const kind = b.path.startsWith('inputs/') ? 'inputs' : 'records';
  return `${kind} chain forked: another writer appended to ${b.path}, a chain only one writer appends to (a forked instance, two clones using one host label, or a line pushed by someone else)${b.note ? `: ${b.note}` : ''}. Nothing was merged or pushed. Tell the chief of staff: operator.js problems lists it; operator.js quarantine --file ${b.path} sets this copy aside as evidence (the chief of staff, or the instance that owns the chain), and refuses to take the remote's extra lines unless --adopt-remote is given after reviewing them. One working copy per host label and instance is assumed`;
}

// Bring the working files from tree `from` to commit `to`, file by file under each chain's writer
// lock. A working copy that already holds lines the target lacks is never replaced. A file the
// working directory no longer has but `from` does (set aside by quarantine) stays absent.
// Returns { updated: [paths], conflicts: [{ path, kind }] }.
function applyToWorking(loc, fromTree, toTree) {
  const changed = Object.keys(toTree).filter((p) => toTree[p] !== fromTree[p]).sort();
  const blobs = readBlobs(loc.store, changed.flatMap((p) => [toTree[p], fromTree[p]]));
  const plan = [];
  const conflicts = [];
  for (const p of changed) {
    const target = blobs.get(toTree[p]);
    const before = fromTree[p] ? blobs.get(fromTree[p]) : null;
    const wc = readWorking(loc, p);
    if (wc === null && before) continue; // quarantined here
    if (wc === null || (before && wc.equals(before)) || startsWith(target, wc)) { plan.push(p); continue; }
    if (p === LEDGER || startsWith(wc, target)) continue; // local copy is ahead (lines not committed yet)
    conflicts.push({ path: opRel(p), kind: 'fork' });
  }
  if (conflicts.length) return { updated: [], conflicts };
  const updated = [];
  for (const p of plan) {
    const target = blobs.get(toTree[p]);
    const before = fromTree[p] ? blobs.get(fromTree[p]) : null;
    const write = () => {
      const wc = readWorking(loc, p);
      if (wc !== null && !(before && wc.equals(before)) && !startsWith(target, wc)) return; // appended meanwhile: keep
      if (wc !== null && wc.equals(target)) return;
      writeAtomic(path.join(loc.store, p), target);
      updated.push(opRel(p));
    };
    const lock = writerLock(loc, p);
    if (lock) require('./chain.js').withLock(lock, write); else write();
  }
  return { updated, conflicts: [] };
}

// ---- ownership: the chains this store writes ----

// Every line of a chain buffer hashes to the next ([] of entries, or null when it does not verify).
function chainEntries(buf) {
  const { hashEntry } = require('./chain.js');
  const out = [];
  let prev = '0';
  for (const l of buf.toString('utf8').split('\n')) {
    if (!l.trim()) continue;
    let e;
    try { e = JSON.parse(l); } catch (x) { return null; }
    const { hash, ...rest } = e;
    if (rest.prev !== prev || hashEntry(prev, rest) !== hash) return null;
    prev = hash;
    out.push(e);
  }
  return out;
}

// The host the COMMITTED manifest (team.json in the project's HEAD; read-only `git show`) places an
// instance on, or null when it cannot be read. An uncommitted edit of team.json does not count.
function manifestHost(loc, instance) {
  if (!loc.manifestHosts) {
    loc.manifestHosts = new Map();
    const r = run(loc.root, ['show', 'HEAD:./.delivery/team/team.json'], { plain: true });
    try {
      const { expandInstances, normalizeAliases } = require('./manifest.js');
      for (const i of expandInstances(normalizeAliases(JSON.parse(r.out)))) if (i.role && i.role.host) loc.manifestHosts.set(i.instance, safeLabel(i.role.host));
    } catch (e) { /* no committed manifest: no rehost is authorised by it */ }
  }
  return loc.manifestHosts.get(instance) || null;
}

// A records chain an instance of this host writes may grow elsewhere only after the instance moved:
// the latest rehost of that instance in a chain that verifies, recorded by the chief of staff or by
// the instance itself, names another host, AND either that destination is the host the committed
// manifest gives the instance, or the rehost is already in this store's own copy (it was written or
// accepted here). { moved, rehost? } — rehost: the latest rehost seen, so a refusal can name it.
function movedAway(loc, ours, tree, instance, host) {
  const files = Object.keys(tree).filter((p) => p.startsWith(`${OP}/records/`) && isChain(p));
  const blobs = readBlobs(loc.store, [...files.map((p) => tree[p]), ...files.map((p) => ours[p])]);
  let last = null;
  let lastFile = null;
  for (const p of files) {
    const entries = chainEntries(blobs.get(tree[p]) || Buffer.alloc(0));
    if (!entries) continue;
    for (const e of entries) {
      if (e.kind !== 'rehost' || e.instance !== instance || !e.to || typeof e.to.host !== 'string') continue;
      const by = e.by || {};
      if (by.role !== 'chief-of-staff' && by.instance !== instance) continue;
      if (!last || Date.parse(e.ts) > Date.parse(last.ts)) { last = e; lastFile = p; }
    }
  }
  if (!last || safeLabel(last.to.host) === safeLabel(host)) return { moved: false, rehost: last };
  const known = ours[lastFile] && blobs.get(ours[lastFile]) && blobs.get(ours[lastFile]).toString('utf8').includes(`"hash":"${last.hash}"`);
  const placed = manifestHost(loc, instance) === safeLabel(last.to.host);
  return { moved: !!(known || placed), rehost: last, unauthorised: !(known || placed) };
}
const safeLabel = (h) => String(h || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[-.]+/, '');

// The owner-side rule. A chain this store writes has one writer, this store: the remote may hold fewer
// of its lines (not pushed yet), never more or other ones. Which chains those are follows from the
// content, not from the manifest (so a rehost needs no manifest change on every host):
//  - inputs/<opts.host>/*: this host's inputs chains;
//  - a records chain whose last line in this store was written from this host (by.host), until a valid
//    rehost moves its instance elsewhere (the latest rehost in a chain that verifies, recorded by the
//    chief of staff or the instance itself);
//  - and any records chain the remote extends with lines that claim to come from this host.
// Any of those growing on the remote is a fork, refused, except when the store is new (no history
// shared with the remote yet) and neither holds nor writes that chain yet: a fresh clone of a host
// that published before adopts its own published chains. [{ path, kind: 'fork' }].
function ownerConflicts(loc, opts, ours, oursTree, theirs, theirsTree) {
  if (!opts.host) return [];
  const host = safeLabel(opts.host);
  const paths = Object.keys(theirsTree).filter((p) => isChain(p) && theirsTree[p] !== oursTree[p]).sort();
  if (!paths.length) return [];
  const base = ours ? run(loc.store, ['merge-base', ours, theirs]) : null;
  const newStore = !ours || !base.ok || !base.out;
  const blobs = readBlobs(loc.store, paths.flatMap((p) => [oursTree[p], theirsTree[p]]));
  const parse = (buf) => buf.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } });
  const fromHere = (e) => !!e && !!e.by && safeLabel(e.by.host) === host;
  const out = [];
  for (const p of paths) {
    const o = oursTree[p] ? blobs.get(oursTree[p]) : null;
    const t = blobs.get(theirsTree[p]);
    if (o && startsWith(o, t)) continue; // the remote is behind: lines not pushed yet
    if (o && !startsWith(t, o)) continue; // not an extension: verifyMerge names the rewrite or fork
    const adopt = !o && newStore && readWorking(loc, p) === null;
    if (p.startsWith(`${OP}/inputs/${host}/`)) { if (!adopt) out.push({ path: opRel(p), kind: 'fork' }); continue; }
    const rm = new RegExp(`^${OP}/records/(.+)\\.ndjson$`).exec(p);
    if (!rm) continue;
    const mine = o ? parse(o) : [];
    const added = parse(o ? t.subarray(o.length) : t);
    const writtenHere = mine.length > 0 && fromHere(mine[mine.length - 1]);
    const claims = added.some(fromHere) && !adopt;
    if (!writtenHere && !claims) continue;
    const mv = movedAway(loc, oursTree, theirsTree, rm[1], host);
    if (mv.moved) continue;
    const ids = added.filter(Boolean).map((e) => `${e.id} (by ${e.by && e.by.instance || '?'} from ${e.by && e.by.host || '?'})`);
    const note = mv.unauthorised
      ? `the remote moves ${rm[1]} to ${mv.rehost.to.host} with ${mv.rehost.id}, but the committed .delivery/team/team.json places it on ${manifestHost(loc, rm[1]) || 'no host'}; that rehost is not authorised. Lines not written here: ${ids.join(', ')}`
      : `lines not written here: ${ids.join(', ')}`;
    out.push({ path: opRel(p), kind: 'fork', note, rehost: mv.unauthorised ? mv.rehost.id : undefined });
  }
  return out;
}

// Merge the fetched remote branch into the store. { ok, updated, diverged?, reason? }.
function mergeRemote(loc, opts = {}) {
  loc.manifestHosts = null; // read the committed manifest afresh for each merge
  const theirs = revParse(loc.store, TRACKING);
  if (!theirs) return { ok: true, updated: [] };
  const ours = revParse(loc.store, 'HEAD');
  if (ours && run(loc.store, ['merge-base', '--is-ancestor', theirs, ours]).ok) return { ok: true, updated: [] };
  const oursTree = treeOf(loc.store, ours);
  const theirsTree = treeOf(loc.store, theirs);
  const owned = ownerConflicts(loc, opts, ours, oursTree, theirs, theirsTree);
  if (owned.length) return { ok: false, updated: [], diverged: owned.map((c) => c.path), diverged_detail: owned.map((c) => ({ path: c.path, note: c.note, rehost: c.rehost })), reason: divergedReason(loc, owned) };
  let target;
  let mergedTree;
  if (!ours || run(loc.store, ['merge-base', '--is-ancestor', ours, theirs]).ok) {
    target = theirs;
    mergedTree = theirsTree;
  } else {
    const m = mergeTrees(loc, ours, theirs);
    if (m.error) return { ok: false, updated: [], reason: m.error };
    if (m.conflicts) return { ok: false, updated: [], diverged: m.conflicts.map((c) => c.path), reason: divergedReason(loc, m.conflicts) };
    mergedTree = treeOf(loc.store, m.tree);
    target = m.tree;
  }
  const bad = verifyMerge(loc, oursTree, theirsTree, mergedTree);
  if (bad.length) return { ok: false, updated: [], diverged: bad.map((b) => b.path), reason: divergedReason(loc, bad) };
  if (target !== theirs) {
    const c = run(loc.store, ['commit-tree', '--no-gpg-sign', target, '-p', ours, '-p', theirs, '-m', 'operator: merge'], { env: IDENTITY });
    if (!c.ok) return { ok: false, updated: [], reason: `cannot commit the merge in the private operator store: ${firstLine(c.err)}` };
    target = c.out;
  }
  const w = applyToWorking(loc, oursTree, mergedTree);
  if (w.conflicts.length) return { ok: false, updated: [], diverged: w.conflicts.map((c) => c.path), reason: divergedReason(loc, w.conflicts) };
  const u = run(loc.store, ['update-ref', REF, target, ours || zero(loc)]);
  if (!u.ok) return { ok: false, updated: w.updated, reason: `cannot advance the private operator store: ${firstLine(u.err)}` };
  run(loc.store, ['read-tree', target]);
  return { ok: true, updated: w.updated };
}

// Before every push: what HEAD would add to the remote. Every chain that differs from the fetched remote
// copy must still start with it (nothing deleted, shortened or rewritten), and must verify as committed
// (opts.check on the committed blobs, written to a scratch directory), however it reached the store:
// operator.js, a refresh, or a commit made by hand in the store. { ok, entries, reason?, paths? }.
function verifyOutgoing(loc, opts) {
  const head = revParse(loc.store, 'HEAD');
  const H = treeOf(loc.store, head);
  const T = treeOf(loc.store, revParse(loc.store, TRACKING));
  const delta = [...new Set([...Object.keys(H), ...Object.keys(T)])].filter((p) => isChain(p) && H[p] !== T[p]).sort();
  if (!delta.length) return { ok: true, entries: 0 };
  const gone = delta.filter((p) => !H[p]);
  const how = `Nothing was pushed. Inspect it with \`git -C ${loc.store} log -p -- <path>\`; restore the published copy with \`git -C ${loc.store} checkout ${TRACKING} -- <path>\` and commit it in the store, or have the chief of staff set it aside with operator.js quarantine`;
  if (gone.length) return { ok: false, code: 'outgoing_invalid', paths: gone.map(opRel), reason: `the private operator store no longer holds ${opRel(gone[0])}, which the remote has; a published chain is never deleted. ${how}` };
  const blobs = readBlobs(loc.store, delta.flatMap((p) => [H[p], T[p]]));
  let entries = 0;
  for (const p of delta) {
    const mine = blobs.get(H[p]);
    const theirs = T[p] ? blobs.get(T[p]) : null;
    if (theirs && !startsWith(mine, theirs)) {
      return { ok: false, code: 'outgoing_invalid', paths: [opRel(p)], reason: `${opRel(p)} in the private operator store no longer starts with the published copy (it was rewritten or shortened). ${how}` };
    }
    entries += lineCount(mine) - (theirs ? lineCount(theirs) : 0);
  }
  if (opts.check) {
    const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'operator-outgoing-'));
    try {
      const dir = path.join(scratch, LEGACY_REL);
      const hosts = new Set(delta.map((p) => (/^operator\/inputs\/([^/]+)\//.exec(p) || [])[1]).filter(Boolean));
      const files = Object.keys(H).filter((p) => (hosts.has((/^operator\/inputs\/([^/]+)\//.exec(p) || [])[1]) && isChain(p)) || (delta.includes(p) && p.startsWith(`${OP}/records/`)));
      const all = readBlobs(loc.store, files.map((p) => H[p]));
      for (const p of files) {
        fs.mkdirSync(path.join(dir, path.dirname(opRel(p))), { recursive: true });
        fs.writeFileSync(path.join(dir, opRel(p)), all.get(H[p]));
      }
      const bad = opts.check(delta.map(opRel), scratch);
      // the scratch copy's own restore hint would point at the scratch directory: ours replaces it
      const why = bad ? String(bad.error || '').replace(/; restore the file[\s\S]*$/, '') : '';
      if (bad) return { ok: false, code: 'outgoing_invalid', paths: [bad.path], reason: `${bad.path} as committed in the private operator store fails verification (${why}). ${how}` };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { ok: true, entries };
}

// ---- the remote ----

// The project's origin URL and push URL (read-only), resolved when they are relative local paths.
function projectRemote(loc, key = 'url') {
  const r = run(loc.root, ['config', '--get', `remote.origin.${key}`], { plain: true });
  if (!r.ok || !r.out) return null;
  const url = r.out.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) || /^[^/\\]+@[^/\\]+:/.test(url) || path.isAbsolute(url)) return url;
  if (/^[^/\\]+:[^/\\]/.test(url) && !/^[A-Za-z]:[\\/]/.test(url)) return url; // host:path (scp-like without a user)
  return path.resolve(loc.root, url);
}

function setOrigin(loc, url) {
  const cur = run(loc.store, ['config', '--get', 'remote.origin.url']);
  if (!url) {
    if (cur.ok) run(loc.store, ['remote', 'remove', 'origin']);
    return;
  }
  if (!(cur.ok && cur.out === url)) {
    run(loc.store, ['config', 'remote.origin.url', url]);
    run(loc.store, ['config', '--replace-all', 'remote.origin.fetch', `+${REF}:${TRACKING}`]);
  }
  const push = projectRemote(loc, 'pushurl');
  const curPush = run(loc.store, ['config', '--get', 'remote.origin.pushurl']);
  if (push && !(curPush.ok && curPush.out === push)) run(loc.store, ['config', 'remote.origin.pushurl', push]);
  if (!push && curPush.ok) run(loc.store, ['config', '--unset-all', 'remote.origin.pushurl']);
}

const UNREACHABLE = /could not resolve host|unable to access|connection refused|timed out|ETIMEDOUT|network is unreachable|could not connect|connection reset|no route to host|operation timed out/i;

// What a failed fetch or push means, in words a person can act on. Never repeats the URL (it can hold
// a token).
function humanReason(op, err, timedOut) {
  const e = String(err || '');
  if (timedOut) {
    return `the project remote (origin) did not answer within ${Math.round(NET_TIMEOUT_MS() / 1000)} s (${op} timed out); the records stay committed in the private operator store and publish on the next operator command. Check the network and \`git remote -v\` in the project (DELIVERY_GIT_TIMEOUT_MS raises the limit)`;
  }
  if (UNREACHABLE.test(e)) {
    return `the project remote (origin) is not reachable for ${op}; the records stay committed in the private operator store and publish on the next operator command once the network is back`;
  }
  if (/permission denied|authentication failed|could not read username|could not read password|403|access denied|denied to|not authorized|invalid credentials|terminal prompts disabled/i.test(e)) {
    return `this session may not ${op === 'fetch' ? 'read' : 'push to'} the project remote (origin); a session publishes operator records only with push access to the project repository (cloud and SSH sessions included). The records stay committed in the private operator store`;
  }
  if (/protected branch|declined|pre-receive hook|rule violations|GH006|GH013/i.test(e)) {
    return 'the project remote refused the delivery-operator branch (a branch rule or server hook declined it); the repository\'s branch rules must allow pushes to delivery-operator. The records stay committed in the private operator store';
  }
  if (/repository not found|does not appear to be a git repository|no such file or directory/i.test(e)) {
    return `the project remote (origin) was not found or is not a git repository (${op}); check \`git remote -v\` in the project`;
  }
  return `git ${op} in the private operator store failed: ${firstLine(e) || 'unknown error'}`;
}

const retryable = (err) => /\[rejected\]|non-fast-forward|fetch first|cannot lock ref|incorrect old value|failed to update ref|stale info|but expected/i.test(String(err || ''))
  && !/protected branch|declined|pre-receive hook/i.test(String(err || ''));

// "Remote down" is remembered for DOWN_MS across processes (a stamp in the store's local state), so
// the next commands on this host report unpublished at once instead of each waiting on the remote.
// Only a timeout or a transport failure sets it, never a refusal (permission, branch rule).
const DOWN_MS = 60 * 1000;
const downFile = (loc) => path.join(loc.opDir, 'cursors', 'remote-down.json');
function noteNetwork(loc, r, reason) {
  if (!(r.timedOut || UNREACHABLE.test(r.err))) return;
  networkDown = reason;
  // keyed by a hash of the URL (never the URL itself): another remote is not known to be down
  try { fs.mkdirSync(path.dirname(downFile(loc)), { recursive: true }); fs.writeFileSync(downFile(loc), JSON.stringify({ at: Date.now(), reason, url: urlKey(loc) })); } catch (e) { /* best effort */ }
}
const urlKey = (loc) => crypto.createHash('sha256').update(String(projectRemote(loc) || '')).digest('hex').slice(0, 16);
function remoteDown(loc) {
  if (networkDown) return `${networkDown} (not tried again in this command)`;
  try {
    const j = JSON.parse(fs.readFileSync(downFile(loc), 'utf8'));
    const age = Date.now() - j.at;
    if (j.url === urlKey(loc) && age >= 0 && age < DOWN_MS) return `${j.reason} (seen ${Math.round(age / 1000)} s ago; tried again after ${Math.round((DOWN_MS - age) / 1000)} s)`;
  } catch (e) { /* none */ }
  return null;
}
function remoteUp(loc) { try { fs.unlinkSync(downFile(loc)); } catch (e) { /* none */ } }

function fetchRemote(loc, timeoutMs) {
  const f = runNet(loc, ['fetch', '--quiet', '--prune', '--no-tags', 'origin', `+${REF}:${TRACKING}`], timeoutMs);
  if (f.ok) { remoteUp(loc); return { ok: true }; }
  if (!f.timedOut && /couldn't find remote ref|no such ref|not our ref|remote ref does not exist/i.test(f.err)) {
    run(loc.store, ['update-ref', '-d', TRACKING]);
    remoteUp(loc);
    return { ok: true };
  }
  const reason = humanReason('fetch', f.err, f.timedOut);
  noteNetwork(loc, f, reason);
  return { ok: false, reason, network: !!networkDown };
}

// ---- publish / refresh ----

// One round under the store lock: commit this store's new lines, fetch the remote branch, merge it
// (owner rule, append-only, verified), and with opts.push verify what would be pushed and push it,
// retrying a rejected push (another host pushed first) up to PUSH_ATTEMPTS times, all within
// the publish budget. opts: { push, check, host, lockWaitMs, netTimeoutMs }.
// { ok, published, entries, updated, diverged?, no_remote?, reason?, committed?, refused? }.
function syncStore(projectRoot, opts = {}) {
  let loc;
  try { loc = ensureStore(projectRoot); } catch (e) { return { ok: false, published: false, reason: String(e.message || e), updated: [] }; }
  if (!loc) return { ok: false, published: false, no_remote: true, reason: 'not a git repository', updated: [] };
  const deadline = Date.now() + PUBLISH_BUDGET_MS();
  const left = () => Math.min(opts.netTimeoutMs || NET_TIMEOUT_MS(), deadline - Date.now());
  try {
    return withStoreLock(loc, () => {
      const url = projectRemote(loc);
      setOrigin(loc, url);
      const c = commitLocal(loc, opts);
      // a refused commit stops a publish; a refresh still merges (the uncommitted lines stay in place)
      if (!c.ok && opts.push) return { ok: false, published: false, reason: c.reason, code: c.code, paths: c.paths, updated: [] };
      const refused = c.ok ? undefined : { reason: c.reason, paths: c.paths };
      if (!url) return { ok: false, published: false, no_remote: true, reason: 'no remote', committed: c.committed, entries: c.entries, updated: [], refused };
      const down = remoteDown(loc);
      if (down) return { ok: false, published: false, network: true, reason: down, remote: 'origin', updated: [], refused };
      const updated = [];
      for (let attempt = 1; attempt <= (opts.push ? PUSH_ATTEMPTS : 1); attempt++) {
        if (left() < 1000) {
          return { ok: false, published: false, remote: 'origin', updated, refused,
            reason: `publishing took longer than ${Math.round(PUBLISH_BUDGET_MS() / 1000)} s (the remote is slow or kept moving); the records stay committed in the private operator store and the next operator command publishes them` };
        }
        const f = fetchRemote(loc, left());
        if (!f.ok) return { ok: false, published: false, reason: f.reason, network: f.network, remote: 'origin', updated, refused };
        const m = mergeRemote(loc, opts);
        updated.push(...m.updated);
        if (!m.ok) return { ok: false, published: false, reason: m.reason, diverged: m.diverged || [], diverged_detail: m.diverged_detail, remote: 'origin', updated, refused };
        if (!opts.push) return { ok: true, published: false, updated, diverged: [], remote: 'origin', refused };
        const head = revParse(loc.store, 'HEAD');
        const remote = revParse(loc.store, TRACKING);
        if (!head || (remote && run(loc.store, ['merge-base', '--is-ancestor', head, remote]).ok)) {
          return { ok: true, published: true, entries: 0, nothing_new: true, updated, diverged: [], remote: 'origin' };
        }
        const out = verifyOutgoing(loc, opts);
        if (!out.ok) return { ok: false, published: false, reason: out.reason, code: out.code, paths: out.paths, remote: 'origin', updated };
        if (left() < 1000) continue;
        const p = runNet(loc, ['push', '--quiet', '--no-verify', 'origin', `${head}:${REF}`], left());
        if (p.ok) {
          run(loc.store, ['update-ref', TRACKING, head]);
          return { ok: true, published: true, entries: out.entries, updated, diverged: [], remote: 'origin', attempts: attempt };
        }
        if (p.timedOut || !retryable(p.err)) {
          const reason = humanReason('push', p.err, p.timedOut);
          noteNetwork(loc, p, reason);
          return { ok: false, published: false, reason, network: !!networkDown, remote: 'origin', updated };
        }
        sleepMs(50 + Math.floor(Math.random() * 200));
      }
      return { ok: false, published: false, remote: 'origin', updated,
        reason: `the remote delivery-operator branch kept moving (pushes were rejected because other hosts pushed first); the records stay committed in the private operator store and the next operator command publishes them` };
    }, opts.lockWaitMs === undefined ? {} : { waitMs: opts.lockWaitMs, busy: () => ({ ok: false, published: false, busy: true, reason: 'another operator command is using the store', updated: [] }) });
  } catch (e) {
    return { ok: false, published: false, reason: String(e && e.message || e), updated: [] };
  }
}

function publish(projectRoot, opts = {}) { return syncStore(projectRoot, { ...opts, push: true }); }

function refresh(projectRoot, opts = {}) {
  const r = syncStore(projectRoot, { ...opts, push: false });
  const out = { ok: r.ok, updated: r.updated || [], diverged: r.diverged || [] };
  if (r.reason) out.reason = r.reason;
  if (r.no_remote) out.no_remote = true;
  if (r.network) out.network = true;
  if (r.remote) out.remote = r.remote;
  if (r.refused) out.refused = r.refused;
  if (r.diverged_detail) out.diverged_detail = r.diverged_detail;
  return out;
}

// A store that has never seen the remote fetches it once before its first capture, so a fresh clone of
// a host that published before continues that host's chain instead of starting a second one (which
// would be a fork). Best effort: no wait for the store lock, at most one attempt per 10 minutes.
function bootstrap(projectRoot, opts = {}) {
  try {
    const loc = locate(projectRoot);
    if (!loc.git || fs.existsSync(path.join(loc.store, '.git', 'HEAD')) && revParse(loc.store, 'HEAD')) return null;
    if (!projectRemote(loc)) return null;
    const stamp = path.join(operatorDir(projectRoot), 'cursors', 'bootstrap.json');
    let last = 0;
    try { last = JSON.parse(fs.readFileSync(stamp, 'utf8')).at || 0; } catch (e) { last = 0; }
    if (Date.now() - last < 10 * 60 * 1000) return null;
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify({ at: Date.now() }));
    // a capture hook has a 10-15 s budget: the fetch gets 5 s of it
    return refresh(projectRoot, { ...opts, lockWaitMs: 0, netTimeoutMs: 5000 });
  } catch (e) { return null; }
}

// Entries in this store that the remote branch does not hold yet (as last fetched; read-only, no
// network), and when the oldest of them was captured. Without a remote every entry is local only.
// opts.filter(path relative to the operator directory) limits the chains counted.
// { count, commits, oldest, reason, no_remote? }.
function unpublished(projectRoot, opts = {}) {
  try {
    const loc = locate(projectRoot);
    if (!loc.git) return { count: 0, commits: 0, oldest: null, reason: 'not a git repository', no_remote: true };
    const noRemote = !projectRemote(loc);
    const born = fs.existsSync(path.join(loc.store, '.git', 'HEAD')) && revParse(loc.store, 'HEAD');
    const remote = born && !noRemote ? revParse(loc.store, TRACKING) : null;
    const rt = treeOf(loc.store, remote);
    const files = workingFiles(loc).filter((p) => p !== LEDGER && (!opts.filter || opts.filter(opRel(p))));
    const blobs = readBlobs(loc.store, files.map((p) => rt[p]));
    let count = 0;
    let oldest = null;
    for (const p of files) {
      const mine = complete(readWorking(loc, p) || Buffer.alloc(0));
      const theirs = rt[p] ? blobs.get(rt[p]) : null;
      const skip = theirs && startsWith(mine, theirs) ? lineCount(theirs) : 0;
      const lines = mine.toString('utf8').split('\n').filter(Boolean);
      if (lines.length <= skip) continue;
      count += lines.length - skip;
      try {
        const e = JSON.parse(lines[skip]);
        const t = Date.parse(e.captured_at || e.ts);
        if (!Number.isNaN(t) && (oldest === null || t < oldest)) oldest = t;
      } catch (e) { /* unparsable: counted, not dated */ }
    }
    let commits = 0;
    if (born) {
      const head = revParse(loc.store, 'HEAD');
      const r = run(loc.store, ['rev-list', '--count', remote ? `${remote}..${head}` : head]);
      commits = r.ok ? Number(r.out) || 0 : 0;
    }
    const out = { count, commits, oldest: oldest === null ? null : new Date(oldest).toISOString() };
    if (noRemote) return { ...out, reason: 'no remote', no_remote: true };
    return { ...out, reason: count ? 'not pushed to the delivery-operator branch of origin' : null };
  } catch (e) {
    return { count: 0, commits: 0, oldest: null, reason: String(e && e.message || e) };
  }
}

// The lines of `remote` this copy does not have, as { id, instance, host, ts }.
function linesNotIn(remote, mine) {
  const have = new Set(mine.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).hash; } catch (e) { return null; } }));
  return remote.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter((e) => e && !have.has(e.hash)).map((e) => ({ id: e.id, instance: e.by && e.by.instance, host: (e.by && e.by.host) || e.host, ts: e.ts }));
}

// Before quarantine moves a chain aside (read-only): what taking the remote copy would bring.
// { extension: the remote copy is this copy plus more lines, adopted: [those lines] }.
function asideCheck(projectRoot, rel, current) {
  const loc = locate(projectRoot);
  if (!loc.git || !fs.existsSync(path.join(loc.store, '.git', 'HEAD'))) return { extension: false, adopted: [] };
  const r = treeOf(loc.store, revParse(loc.store, TRACKING))[`${OP}/${rel}`];
  if (!r) return { extension: false, adopted: [] };
  const remote = readBlobs(loc.store, [r]).get(r);
  const mine = complete(current);
  const extension = remote.length > mine.length && startsWith(remote, mine);
  return { extension, adopted: extension ? linesNotIn(remote, mine) : [] };
}

// After operator.js quarantine moved a chain file aside (rel: its path in the operator directory,
// evidence: where it was moved), make the store agree so the set-aside copy stops blocking merges:
// - the remote holds the very copy that was set aside: it stays absent here (it keeps failing
//   verification wherever it is read);
// - the remote holds another copy (the other side of a fork, or the published lines before a local
//   corruption): the store and the working directory take it;
// - the remote holds none: the never-published copy leaves the store's next commit.
// { ok, adopted?, reason? }.
function setAside(projectRoot, rel, evidence) {
  const loc = locate(projectRoot);
  if (!loc.git || !fs.existsSync(path.join(loc.store, '.git', 'HEAD'))) return { ok: true };
  try {
    return withStoreLock(loc, () => {
      const p = `${OP}/${rel}`;
      const head = revParse(loc.store, 'HEAD');
      if (!head) return { ok: true };
      const h = treeOf(loc.store, head)[p];
      const r = treeOf(loc.store, revParse(loc.store, TRACKING))[p];
      let q = null;
      try { q = blobSha(loc, complete(fs.readFileSync(evidence))); } catch (e) { q = null; }
      if (r && r === q) return { ok: true, adopted: false };
      if (h !== r) {
        const idx = tempIndex(loc);
        const env = { GIT_INDEX_FILE: idx };
        try {
          run(loc.store, ['read-tree', head], { env });
          const ui = r ? run(loc.store, ['update-index', '--add', '--cacheinfo', `100644,${r},${p}`], { env })
            : run(loc.store, ['update-index', '--force-remove', p], { env });
          const t = ui.ok ? run(loc.store, ['write-tree'], { env }) : ui;
          const c = t.ok ? run(loc.store, ['commit-tree', '--no-gpg-sign', t.out, '-p', head, '-m', `operator: set aside ${rel}`], { env: IDENTITY }) : t;
          const u = c.ok ? run(loc.store, ['update-ref', REF, c.out, head]) : c;
          if (!u.ok) return { ok: false, reason: `the private operator store still holds ${rel}: ${firstLine(u.err)}` };
          run(loc.store, ['read-tree', c.out]);
        } finally {
          try { fs.unlinkSync(idx); } catch (e) { /* gone */ }
        }
      }
      if (r) {
        const body = readBlobs(loc.store, [r]).get(r);
        const write = () => { if (readWorking(loc, p) === null) writeAtomic(path.join(loc.store, p), body); };
        const lock = writerLock(loc, p);
        if (lock) require('./chain.js').withLock(lock, write); else write();
      }
      let lines = [];
      if (r) { try { lines = linesNotIn(readBlobs(loc.store, [r]).get(r), complete(fs.readFileSync(evidence))); } catch (e) { lines = []; } }
      return { ok: true, adopted: !!r, lines };
    });
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

module.exports = { operatorDir, storeDir, ensureStore, publish, refresh, bootstrap, unpublished, setAside, asideCheck, BRANCH, STORE_NAME, LEGACY_REL, _locate: locate };
