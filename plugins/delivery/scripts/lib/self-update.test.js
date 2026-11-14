// scripts/lib/self-update.test.js — delivery-plugin-planning-0ba: the watchdog's host job installs the
// plugin version main carries once the team's gate merged it, so the owner is never the installer. The
// marketplace clone is a real git clone of a bare origin, so the reading of main is exercised for real;
// only `claude plugin ...` is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SU = require('./self-update.js');
const WD = require('./watchdog.js');
const R = require('./reviews.js');
const KICK = require('./kick.js');
const IB = require('./inbox.js');
const { registerInstance } = require('./roster.js');
const { harness } = require('../testing/role-harness.js');
const watchdog = require('../watchdog.js');

const T0 = '2026-11-02T22:00:00.000Z';
const later = (ms) => new Date(Date.parse(T0) + ms).toISOString();
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', env: GIT_ENV }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const setVersion = (work, v) => fs.writeFileSync(path.join(work, 'plugins', 'delivery', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'delivery', version: v }));

// A product repo with the installed version, its clone as the marketplace, then main moved on by
// `commits` ([{ version?, subject }]); a config dir whose install is the installed version.
function fixture({ installed = '0.43.30', commits = [{ version: '0.43.31', subject: 'delivery 0.43.31: x (#140)' }], root, extra = [], shallow = false, padding = 0 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'self-update-'));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  spawnSync('git', ['init', '-q', '-b', 'main', work]);
  fs.mkdirSync(path.join(work, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(work, 'plugins', 'delivery', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(work, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'm', plugins: [{ name: 'delivery', source: './plugins/delivery' }] }));
  setVersion(work, installed);
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', `delivery ${installed} (#139)`);
  git(work, 'remote', 'add', 'origin', origin); git(work, 'push', '-q', 'origin', 'main');
  const installedSha = git(work, 'rev-parse', 'HEAD');
  const config = path.join(base, 'config');
  const clone = path.join(config, 'plugins', 'marketplaces', 'm');
  // commits outside the plugin between the install and the update, so a shallow clone must deepen past them
  for (let i = 0; i < padding; i++) { fs.writeFileSync(path.join(work, 'README.md'), String(i)); git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', `docs ${i}`); }
  if (padding) git(work, 'push', '-q', 'origin', 'main');
  // as Claude Code keeps it: a depth-1 clone of main's tip, made after the install, so it lacks the installed sha
  if (shallow) spawnSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, clone]);
  else spawnSync('git', ['clone', '-q', origin, clone]);
  const shaOf = {};
  for (const c of commits) {
    if (c.version) setVersion(work, c.version); else fs.writeFileSync(path.join(work, 'plugins', 'delivery', `f${Math.random()}`), 'x');
    git(work, 'add', '-A'); git(work, 'commit', '-q', '--allow-empty', '-m', c.subject);
    const pr = (/\(#(\d+)\)$/.exec(c.subject) || [])[1];
    if (pr && !shaOf[pr]) shaOf[pr] = git(work, 'rev-parse', 'HEAD');
    if (c.key) shaOf[c.key] = git(work, 'rev-parse', 'HEAD');
  }
  git(work, 'push', '-q', 'origin', 'main');
  const pluginRoot = path.join(config, 'plugins', 'cache', 'm', 'delivery', installed);
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts', 'watchdog.js'), '');
  const ipFile = path.join(config, 'plugins', 'installed_plugins.json');
  fs.writeFileSync(ipFile, JSON.stringify({ version: 2, plugins: { 'delivery@m': [{ scope: 'user', installPath: pluginRoot, version: installed, gitCommitSha: installedSha }, ...extra.map((e) => ({ installPath: pluginRoot, version: installed, gitCommitSha: installedSha, ...e }))] } }));
  fs.writeFileSync(path.join(config, 'plugins', 'known_marketplaces.json'), JSON.stringify({ m: { source: { source: 'github', repo: 'example/product' }, installLocation: clone } }));
  const project = root || fs.mkdtempSync(path.join(os.tmpdir(), 'self-update-project-'));
  return { config, pluginRoot, ipFile, project, mainSha: git(work, 'rev-parse', 'HEAD'), installedSha, shaOf };
}
// a merged row as merge-gate.js writes it; merge_commit is the commit that first names the pull request
const merged = (f, pr, gated, over = {}) => R.append(f.project, pr, { type: 'merged', repo: 'example/product', head: 'abc', merged_at: T0, merge_commit: f.shaOf[pr], beads: [], gated, by: 'delivery-lead', at: T0, ...over }, 'delivery-lead');

// the fake `claude`: records each call; a plugin update moves the matching install to `to` (at `sha`,
// main by default) unless told to fail (throws) or to leave the version as it was. `gh` answers
// `gh api .../pulls/N` with gh[N] and `gh api .../commits/SHA/pulls` with ghc[SHA] as JSON (a missing
// entry: gh fails)
function claude(f, { to = '0.43.31', fail = false, noop = false, sha, gh = {}, ghc = {} } = {}) {
  const calls = [];
  const fn = (bin, args, o) => {
    calls.push({ args: args.join(' '), cwd: o.cwd });
    const byCommit = bin === 'gh' && /commits\/([0-9a-f]+)\/pulls$/.exec(args[1]);
    if (byCommit) { assert.ok(o.timeout > 0, 'gh is bounded'); if (!ghc[byCommit[1]]) throw new Error('gh: not logged in'); return JSON.stringify(ghc[byCommit[1]]); }
    if (bin === 'gh') { const n = /pulls\/(\d+)$/.exec(args[1])[1]; if (!gh[n]) throw new Error('gh: not logged in'); assert.ok(o.timeout > 0, 'gh is bounded'); return `${gh[n]}\n`; }
    if (fail && args[1] === 'update') throw Object.assign(new Error('update failed'), { stderr: 'network down' });
    if (args[0] === 'plugin' && args[1] === 'update' && !noop) {
      const j = JSON.parse(fs.readFileSync(f.ipFile, 'utf8'));
      for (const e of j.plugins['delivery@m']) if (e.scope === args[4] && (args[4] === 'user' || path.resolve(e.projectPath) === path.resolve(o.cwd))) Object.assign(e, { version: to, gitCommitSha: sha || f.mainSha });
      fs.writeFileSync(f.ipFile, JSON.stringify(j));
    }
    return '';
  };
  fn.calls = calls;
  return fn;
}
const run = (f, exec, o = {}) => SU.selfUpdate(f.project, { pluginRoot: f.pluginRoot, configDir: f.config, exec, now: T0, alive: () => false, ...o });
const rows = (f) => WD.logRows(f.project).filter((r) => r.type === 'self-update');

test('a newer version merged through the gate is installed, verified and logged with its version and sha', () => {
  const f = fixture();
  merged(f, 140, true);
  const exec = claude(f);
  const r = run(f, exec);
  assert.equal(r.installed, true, r.lines.join('\n'));
  assert.deepEqual(exec.calls.map((c) => c.args), ['plugin marketplace update m', 'plugin update delivery@m --scope user']);
  assert.match(r.lines[0], /installed plugin delivery 0\.43\.31 .*gated through PR 140/);
  const [row] = rows(f);
  assert.equal(row.result, 'installed');
  assert.equal(row.version, '0.43.31');
  assert.equal(row.from, '0.43.30');
  assert.equal(row.sha, f.mainSha);
  assert.equal(row.pr, 140);
  // the installs it covers, by name: a refusal standing for one of them ends here (bqj.2)
  assert.deepEqual(row.targets, ['user']);
});

test('an ungated merge is refused, nothing runs, and the refusal is logged once across cycles', () => {
  const f = fixture();
  merged(f, 140, false);
  const exec = claude(f);
  const a = run(f, exec);
  const b = run(f, exec, { now: later(15 * 60e3) });
  assert.equal(a.installed, false);
  assert.match(a.lines[0], /refused: PR 140 was merged without passing the team's gate/);
  assert.match(b.lines[0], /refused/);
  assert.equal(exec.calls.length, 0, 'not even the catalog is refreshed');
  assert.deepEqual(rows(f).map((x) => [x.result, x.version, x.pr]), [['refused', '0.43.31', 140]]);
  // the plugin key it was refused for: only that marketplace's install settles it (rv-167-delivery-lead-14)
  assert.equal(rows(f)[0].key, 'delivery@m');
});

test('no merged row, or a commit that names no pull request, is refused', () => {
  const f = fixture();
  const exec = claude(f);
  assert.match(run(f, exec).lines[0], /refused: PR 140 has no merged row by the Delivery Manager/);
  const g = fixture({ commits: [{ version: '0.43.31', subject: 'delivery 0.43.31 pushed by hand' }] });
  assert.match(run(g, exec).lines[0], /refused: commit [0-9a-f]{12} names no pull request and GitHub names none/);
  assert.deepEqual(exec.calls.map((c) => c.args), [`api repos/example/product/commits/${g.mainSha}/pulls`], 'only GitHub was asked; nothing installed');
});

test('an ungated change after the gated version bump is refused: it would ride into the install', () => {
  const f = fixture({ commits: [{ version: '0.43.31', subject: 'delivery 0.43.31 (#140)' }, { subject: 'a hand edit (#141)' }] });
  merged(f, 140, true);
  merged(f, 141, false);
  const exec = claude(f);
  assert.match(run(f, exec).lines[0], /refused: PR 141 was merged without/);
  assert.equal(exec.calls.length, 0);
});

test('the same or an older version on main does nothing', () => {
  for (const v of ['0.43.30', '0.43.29']) {
    const f = fixture({ commits: [{ version: v, subject: `delivery ${v} (#140)` }] });
    merged(f, 140, true);
    const exec = claude(f);
    const r = run(f, exec);
    assert.deepEqual([r.installed, r.lines, exec.calls.length, rows(f).length], [false, [], 0, 0], v);
  }
});

test('a wake still running holds the install; it goes once the wake has ended', () => {
  const f = fixture();
  merged(f, 140, true);
  WD.log(f.project, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const exec = claude(f);
  const held = run(f, exec, { alive: (pid) => pid === 4242 });
  assert.match(held.lines[0], /held: a run is in progress \(wake pid 4242\); tried again next cycle/);
  assert.equal(exec.calls.length, 0);
  assert.deepEqual(rows(f).map((r) => r.result), ['held'], 'the hold is logged once, when it starts');
  run(f, exec, { alive: (pid) => pid === 4242 });
  assert.deepEqual(rows(f).map((r) => r.result), ['held']);
  assert.equal(run(f, exec, { alive: () => false }).installed, true);
});

// hjx.1.6.20: the running check is asked about each wake row's pid with that row's time, so a pid the
// system gave to another program after its wake ended does not hold every install
test('the install asks about each wake pid with its own row time, and installs once no pid is that wake', () => {
  const f = fixture();
  merged(f, 140, true);
  const old = '2026-11-01T22:53:39.312Z';
  WD.log(f.project, { type: 'wake', at: old, instance: 'reality-checker', pid: 2162035 });
  const exec = claude(f);
  const asked = [];
  const held = run(f, exec, { alive: (pid, since) => { asked.push([pid, since]); return true; } });
  assert.deepEqual(asked, [[2162035, old]], 'the row time goes with the pid');
  assert.match(held.lines[0], /held: a run is in progress \(wake pid 2162035\)/);
  // the same pid read as no longer that wake: the install goes
  assert.equal(run(f, exec, { alive: (pid, since) => !(pid === 2162035 && since === old) }).installed, true);
});

test('a failed update is logged, not retried within the hour, retried after it', () => {
  const f = fixture();
  merged(f, 140, true);
  const bad = claude(f, { fail: true });
  const r = run(f, bad);
  assert.equal(r.installed, false);
  assert.match(r.lines[0], /failed: network down/);
  assert.deepEqual(rows(f).map((x) => x.result), ['failed']);
  const n = bad.calls.length;
  assert.match(run(f, bad, { now: later(30 * 60e3) }).lines[0], /failed at .*tried again an hour after/);
  assert.equal(bad.calls.length, n, 'nothing ran within the hour');
  assert.equal(run(f, claude(f), { now: later(61 * 60e3) }).installed, true);
});

test('an update that reports success but leaves the old version installed is a failure', () => {
  const f = fixture();
  merged(f, 140, true);
  const r = run(f, claude(f, { noop: true }));
  assert.equal(r.installed, false);
  assert.match(r.lines[0], /failed: the install still records 0\.43\.30 after the update/);
  assert.equal(rows(f)[0].result, 'failed');
});

test('a dry run says what it would install and runs nothing; a development checkout is never updated', () => {
  const f = fixture();
  merged(f, 140, true);
  const exec = claude(f);
  const r = run(f, exec, { dryRun: true });
  assert.match(r.lines[0], /would install plugin delivery 0\.43\.31 .* for user/);
  assert.deepEqual([exec.calls.length, rows(f).length], [0, 0]);
  // even when an install record names the checkout (a directory marketplace): it is not an install
  const dev = path.join(__dirname, '..', '..');
  const j = JSON.parse(fs.readFileSync(f.ipFile, 'utf8'));
  j.plugins['delivery@m'][0].installPath = dev;
  fs.writeFileSync(f.ipFile, JSON.stringify(j));
  const checkout = run(f, exec, { pluginRoot: dev });
  assert.deepEqual([checkout.lines, exec.calls.length], [[], 0]);
});

test('a role directory with its own older install is updated too, in that directory', () => {
  const role = fs.mkdtempSync(path.join(os.tmpdir(), 'role-'));
  const f = fixture({ extra: [{ scope: 'local', projectPath: role }] });
  merged(f, 140, true);
  const exec = claude(f);
  assert.equal(run(f, exec, { roleDirs: [role] }).installed, true);
  assert.deepEqual(exec.calls.slice(1).map((c) => [c.args, c.cwd]), [['plugin update delivery@m --scope user', f.project], ['plugin update delivery@m --scope local', role]]);
  // a role directory the update could not move is not reported installed
  const g = fixture({ extra: [{ scope: 'local', projectPath: role }] });
  merged(g, 140, true);
  const userOnly = (bin, args, o) => (args[4] === 'local' ? '' : claude(g)(bin, args, o));
  assert.match(run(g, userOnly, { roleDirs: [role] }).lines[0], /failed: still on the old version: /);
});

test('a role directory a failed pass left on the old version is caught up by a later pass once the job is current', () => {
  const role = fs.mkdtempSync(path.join(os.tmpdir(), 'role-'));
  const f = fixture({ extra: [{ scope: 'local', projectPath: role }] });
  merged(f, 140, true);
  const real = claude(f);
  const userOnly = (bin, args, o) => (args[4] === 'local' ? '' : real(bin, args, o));
  assert.match(run(f, userOnly, { roleDirs: [role] }).lines[0], /failed: still on the old version: /);
  const ip = () => JSON.parse(fs.readFileSync(f.ipFile, 'utf8')).plugins['delivery@m'];
  assert.deepEqual(ip().map((e) => e.version), ['0.43.31', '0.43.30']);
  // within the hour the failure waits; after it the role directory alone is updated
  assert.match(run(f, claude(f), { roleDirs: [role], now: later(60e3) }).lines[0], /tried again an hour after/);
  const exec = claude(f);
  const r = run(f, exec, { roleDirs: [role], now: later(3700e3) });
  assert.equal(r.installed, true, r.lines.join('\n'));
  assert.deepEqual(exec.calls.map((c) => [c.args, c.cwd]), [['plugin marketplace update m', f.project], ['plugin update delivery@m --scope local', role]]);
  assert.deepEqual(ip().map((e) => e.version), ['0.43.31', '0.43.31']);
  const last = rows(f).pop();
  assert.equal(last.result, 'installed');
  assert.equal(last.from, '0.43.30');
  assert.equal(last.scope, 'local');
  // and once every install is current, a pass does nothing
  const idle = claude(f);
  assert.deepEqual(run(f, idle, { roleDirs: [role], now: later(3800e3) }).lines, []);
  assert.deepEqual(idle.calls, []);
});

test('a role directory behind a current job install passes the same gate check from its own sha', () => {
  const role = fs.mkdtempSync(path.join(os.tmpdir(), 'role-'));
  const f = fixture({ extra: [{ scope: 'local', projectPath: role }] });
  // the job's own install is already main; the role directory is not
  const j = JSON.parse(fs.readFileSync(f.ipFile, 'utf8'));
  Object.assign(j.plugins['delivery@m'][0], { version: '0.43.31', gitCommitSha: f.mainSha });
  fs.writeFileSync(f.ipFile, JSON.stringify(j));
  merged(f, 140, false);
  const exec = claude(f);
  assert.match(run(f, exec, { roleDirs: [role] }).lines[0], /refused: PR 140 was merged without passing the team's gate/);
  assert.deepEqual(exec.calls, []);
  // a role directory the job does not count as the team's is never touched
  const g = fixture({ extra: [{ scope: 'local', projectPath: role }] });
  const k = JSON.parse(fs.readFileSync(g.ipFile, 'utf8'));
  Object.assign(k.plugins['delivery@m'][0], { version: '0.43.31', gitCommitSha: g.mainSha });
  fs.writeFileSync(g.ipFile, JSON.stringify(k));
  merged(g, 140, true);
  const none = claude(g);
  assert.deepEqual(run(g, none, { roleDirs: [] }).lines, []);
  assert.deepEqual(none.calls, []);
});

// through the host job: an install wakes no one this pass and kicks the next run; a failure keeps the wakes
const memStore = (h) => { const b = Object.values(h.db().issues); return { list: () => b, ready: () => b.filter((x) => x.status === 'open'), show: (id) => b.find((x) => x.id === id) || null }; };
function jobRun(h, f, exec, { alive = () => false, now = later(2e3) } = {}) {
  registerInstance(h.root, { instance: 'delivery-lead', session_id: 'sess-dl', host: 'pc', model: 'sonnet', role_dir: h.roleDir('delivery-lead'), now: later(-30 * 60e3) });
  IB.queue(h.root, { to: 'delivery-lead', from: 'builder-1', message: 'PR ready', at: T0 });
  KICK.take(h.root);
  const woke = [];
  const r = watchdog.main(['run'], { cwd: h.root, env: { ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, '..', 'testing')}${path.delimiter}${process.env.PATH}` }, now, live: [], bd: memStore(h), sweep: () => ({ removed: [], failed: [] }), spawn: (bin, args, o) => { woke.push(o.env.DELIVERY_ROLE); return 999999999; }, update: { pluginRoot: f.pluginRoot, configDir: f.config, exec, alive } });
  return { out: r.out, woke };
}

test('the host job installs, kicks the next run and wakes no one under the old plugin', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  const { out, woke } = jobRun(h, f, claude(f));
  assert.match(out, /self-update: installed plugin delivery 0\.43\.31/);
  assert.match(out, /Wakes wait for the next run/);
  assert.deepEqual(woke, [], 'the message waits for the run under the new plugin');
  assert.equal((out.match(/ watchdog$/gm) || []).length, 1, 'this process does not take its own kick');
  assert.deepEqual(KICK.take(h.root).map((k) => k.replace(/^\S+ /, '')), ['plugin 0.43.31 installed']);
});

test('the host job keeps waking when the update fails', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  const { out, woke } = jobRun(h, f, claude(f, { fail: true }));
  assert.match(out, /self-update: .* failed: network down/);
  assert.deepEqual(woke, ['delivery-lead']);
  assert.equal(KICK.waiting(h.root), 0);
});

test('a direct push that names a gated pull request in its subject is refused: it is not that merge', () => {
  const f = fixture({ commits: [{ version: '0.43.31', subject: 'delivery 0.43.31 (#140)' }, { subject: 'pushed by hand (#140)' }] });
  merged(f, 140, true);
  const exec = claude(f);
  assert.match(run(f, exec).lines[0], /refused: commit [0-9a-f]{12} names PR 140 but is not its merge/);
  assert.equal(exec.calls.length, 0);
});

test('a merged row written before merge_commit was recorded is bound through GitHub, and refused without it', () => {
  const f = fixture();
  merged(f, 140, true, { merge_commit: undefined });
  const off = claude(f);
  assert.match(run(f, off).lines[0], /refused: PR 140's merge commit is not recorded and GitHub did not say it/);
  assert.deepEqual(off.calls.map((c) => c.args), ['api repos/example/product/pulls/140 --jq .merge_commit_sha']);
  const other = claude(f, { gh: { 140: 'a'.repeat(40) } });
  assert.match(run(f, other, { now: later(60e3) }).lines[0], /refused: commit .* names PR 140 but is not its merge \(aaaaaaaaaaaa\)/);
  const on = claude(f, { gh: { 140: f.shaOf[140] } });
  assert.equal(run(f, on, { now: later(120e3) }).installed, true);
});

test('only a merged row by the Delivery Manager for the marketplace repository counts', () => {
  for (const over of [{ by: 'builder' }, { repo: 'other/product' }]) {
    const f = fixture();
    merged(f, 140, true, over);
    assert.match(run(f, claude(f)).lines[0], /refused: PR 140 has no merged row by the Delivery Manager for example\/product/, JSON.stringify(over));
  }
  const f = fixture();
  merged(f, 140, true, { repo: 'Example/Product' });
  assert.equal(run(f, claude(f)).installed, true, 'the repository is matched without case');
});

test('an installed sha that is missing or unknown to the clone is refused: the range cannot be read', () => {
  for (const sha of [undefined, 'b'.repeat(40)]) {
    const f = fixture();
    merged(f, 140, true);
    const j = JSON.parse(fs.readFileSync(f.ipFile, 'utf8'));
    j.plugins['delivery@m'][0].gitCommitSha = sha;
    fs.writeFileSync(f.ipFile, JSON.stringify(j));
    const exec = claude(f);
    assert.match(run(f, exec).lines[0], /refused: the installed sha is not known, so the commits since it cannot be checked/, String(sha));
    assert.equal(exec.calls.length, 0);
  }
});

test('main moving between the check and the update is an ungated install: warned, not reported installed', () => {
  const f = fixture();
  merged(f, 140, true);
  const r = run(f, claude(f, { sha: 'c'.repeat(40) }));
  assert.equal(r.installed, false);
  assert.match(r.lines[0], /warning \S+: plugin delivery 0\.43\.31 .*installed cccccccccccc, not the checked [0-9a-f]{12}: main moved/);
  const [row] = rows(f);
  assert.deepEqual([row.result, row.sha, row.checked], ['ungated-install', 'c'.repeat(40), f.mainSha]);
  assert.deepEqual(require('./warnings.js').list(f.project).map((w) => w.kind), ['install-ungated']);
  // the same install at the checked sha is a plain install, with no warning
  const g = fixture();
  merged(g, 140, true);
  assert.equal(run(g, claude(g)).installed, true);
  assert.deepEqual(require('./warnings.js').list(g.project), []);
});

test('a wake whose row is in the rotated log still holds the install', () => {
  const f = fixture();
  merged(f, 140, true);
  WD.log(f.project, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const file = path.join(f.project, WD.REL, 'wakes.ndjson');
  WD.rotate(file, 0);
  assert.ok(fs.existsSync(`${file}.1`) && !fs.existsSync(file), 'the wake row is only in the rotated file');
  assert.match(run(f, claude(f), { alive: (pid) => pid === 4242 }).lines[0], /held: a run is in progress \(wake pid 4242\)/);
});


// Claude Code's marketplace clone is shallow: it held only main's tip, never the installed sha, so every
// gated update was refused with "the installed sha is not known" (wintermute, 0.43.36 to 0.43.37)
test('a shallow marketplace clone is deepened until it holds the installed sha, then the gated version installs', () => {
  const f = fixture({ shallow: true, padding: 60 });
  const clone = path.join(f.config, 'plugins', 'marketplaces', 'm');
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.notEqual(spawnSync('git', ['-C', clone, 'cat-file', '-e', `${f.installedSha}^{commit}`]).status, 0, 'the clone starts without the installed sha');
  merged(f, 140, true);
  const r = run(f, claude(f));
  assert.match(r.lines[0], /installed plugin delivery 0\.43\.31 .*gated through PR 140/, r.lines.join('\n'));
  assert.equal(spawnSync('git', ['-C', clone, 'cat-file', '-e', `${f.installedSha}^{commit}`]).status, 0, 'deepened to the installed sha');
});

test('a shallow clone deepened to the installed sha still refuses an ungated merge', () => {
  const g = fixture({ shallow: true });
  merged(g, 140, false);
  assert.match(run(g, claude(g)).lines[0], /refused: PR 140 was merged without passing the team's gate/);
});


// 07407bd on wintermute: a squash merge whose subject ends "(Refs <bead>)", not "(#141)", was refused
// as naming no pull request though the gate merged it; GitHub names the pull request it merged
const NO_PR = [{ version: '0.43.31', subject: 'delivery 0.43.31: x (Refs delivery-plugin-planning-0ba)', key: 'm' }];
const pullsOf = (sha, over = {}) => [{ number: 141, merged_at: T0, merge_commit_sha: sha, ...over }];

test('a commit whose subject names no pull request is resolved through GitHub and installs when that merge was gated', () => {
  for (const mc of [undefined, 'recorded']) {
    const f = fixture({ commits: NO_PR });
    merged(f, 141, true, { merge_commit: mc && f.shaOf.m });
    const exec = claude(f, { ghc: { [f.shaOf.m]: pullsOf(f.shaOf.m) } });
    const r = run(f, exec);
    assert.equal(r.installed, true, r.lines.join('\n'));
    assert.match(r.lines[0], /gated through PR 141/);
    assert.ok(exec.calls.some((c) => c.args === `api repos/example/product/commits/${f.shaOf.m}/pulls`), 'asked GitHub by commit');
  }
});

test('a commit resolved through GitHub to an ungated or unrecorded merge, or with no answer, is refused', () => {
  const f = fixture({ commits: NO_PR });
  merged(f, 141, false);
  assert.match(run(f, claude(f, { ghc: { [f.shaOf.m]: pullsOf(f.shaOf.m) } })).lines[0], /refused: PR 141 was merged without passing the team's gate/);
  const g = fixture({ commits: NO_PR });
  assert.match(run(g, claude(g, { ghc: { [g.shaOf.m]: pullsOf(g.shaOf.m) } })).lines[0], /refused: PR 141 has no merged row by the Delivery Manager/);
  const h = fixture({ commits: NO_PR });
  merged(h, 141, true);
  const off = claude(h);
  assert.match(run(h, off).lines[0], /refused: commit [0-9a-f]{12} names no pull request and GitHub names none/);
  assert.equal(off.calls.filter((c) => /^plugin/.test(c.args)).length, 0);
  // an open (unmerged) pull request that carries the commit is not its merge
  assert.match(run(h, claude(h, { ghc: { [h.shaOf.m]: pullsOf(h.shaOf.m, { merged_at: null }) } }), { now: later(60e3) }).lines[0], /names no pull request and GitHub names none/);
});

test('a pull request GitHub returns for a commit it did not merge as is refused', () => {
  const f = fixture({ commits: NO_PR });
  merged(f, 141, true);
  const exec = claude(f, { ghc: { [f.shaOf.m]: pullsOf('d'.repeat(40)) } });
  assert.match(run(f, exec).lines[0], /refused: commit [0-9a-f]{12} names no pull request and GitHub names none/);
  // and a recorded merge commit that is not this commit wins over GitHub's word
  const g = fixture({ commits: NO_PR });
  merged(g, 141, true, { merge_commit: 'e'.repeat(40) });
  assert.match(run(g, claude(g, { ghc: { [g.shaOf.m]: pullsOf(g.shaOf.m) } })).lines[0], /refused: commit [0-9a-f]{12} names PR 141 but is not its merge \(eeeeeeeeeeee\)/);
  assert.equal(exec.calls.filter((c) => /^plugin/.test(c.args)).length, 0);
});

// own install at the hand-pushed commit `h`, main one gated version on: [hand push, gated #142]
const LAYERED = [{ version: '0.43.31', subject: 'delivery 0.43.31 pushed by hand', key: 'h' }, { version: '0.43.32', subject: 'delivery 0.43.32 (#142)' }];
function layered(roleSha) {
  const role = fs.mkdtempSync(path.join(os.tmpdir(), 'role-'));
  const f = fixture({ commits: LAYERED, extra: [{ scope: 'local', projectPath: role }] });
  const j = JSON.parse(fs.readFileSync(f.ipFile, 'utf8'));
  Object.assign(j.plugins['delivery@m'][0], { version: '0.43.31', gitCommitSha: f.shaOf.h });
  if (roleSha) j.plugins['delivery@m'][1].gitCommitSha = roleSha;
  fs.writeFileSync(f.ipFile, JSON.stringify(j));
  merged(f, 142, true);
  return { f, role };
}

test('a role install refused over its own range does not stop the job installing its own', () => {
  const { f, role } = layered('b'.repeat(40));
  const exec = claude(f, { to: '0.43.32' });
  const r = run(f, exec, { roleDirs: [role] });
  assert.equal(r.installed, true, r.lines.join('\n'));
  assert.deepEqual(exec.calls.filter((c) => /^plugin/.test(c.args)).map((c) => c.args), ['plugin marketplace update m', 'plugin update delivery@m --scope user']);
  assert.ok(r.lines.some((l) => /installed plugin delivery 0\.43\.32 .*gated through PR 142/.test(l)), r.lines.join('\n'));
  assert.ok(r.lines.some((l) => new RegExp(`refused: the installed sha is not known.*for local ${role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)), r.lines.join('\n'));
  assert.deepEqual(rows(f).map((x) => [x.result, x.scope]), [['refused', 'local'], ['installed', 'user']]);
  // the role refusal is logged once per version, not every pass
  run(f, claude(f, { to: '0.43.32' }), { roleDirs: [role], now: later(60e3) });
  assert.equal(rows(f).filter((x) => x.result === 'refused').length, 1);
});

test('a role install behind the job own install is checked over its own range: a hand push in it is refused', () => {
  // the role sits at the original install, an ancestor of the job's; the hand push between them is in the
  // role's range and was never gated, so the role is refused while the job's own still installs
  const { f, role } = layered();
  const exec = claude(f, { to: '0.43.32' });
  const r = run(f, exec, { roleDirs: [role] });
  assert.equal(r.installed, true, r.lines.join('\n'));
  assert.deepEqual(exec.calls.filter((c) => /^plugin update/.test(c.args)).map((c) => c.args), ['plugin update delivery@m --scope user']);
  assert.ok(r.lines.some((l) => new RegExp(`refused: commit ${f.shaOf.h.slice(0, 12)} names no pull request.*for local`).test(l)), r.lines.join('\n'));
});

// delivery-plugin-planning-0ba.6: wakes ran back to back, so some wake was always running when the job
// looked and every merged release was held for hours. A held install now starts no new wake, so the
// running ones end and the next cycle installs.
test('a held install starts no new wake, and the next cycle installs once the running wake has ended', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  WD.log(h.root, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const exec = claude(f);
  const first = jobRun(h, f, exec, { alive: (pid) => pid === 4242 });
  assert.match(first.out, /self-update: plugin delivery 0\.43\.31 .* held: a run is in progress \(wake pid 4242\)/);
  assert.match(first.out, /No new wake starts until plugin delivery 0\.43\.31 \(main [0-9a-f]{12}\) is installed/);
  assert.deepEqual(first.woke, [], 'a wake started now would hold the install another cycle');
  assert.equal(exec.calls.length, 0);
  const second = jobRun(h, f, exec, { alive: () => false });
  assert.match(second.out, /self-update: installed plugin delivery 0\.43\.31 \(main [0-9a-f]{12}\)/);
  assert.deepEqual(rows(f).filter((r) => r.result === 'installed').map((r) => [r.version, r.sha]), [['0.43.31', f.mainSha]]);
});

test('a kick taken while an install is held retries the install, and wakes no one while it stays held', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  WD.log(h.root, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const exec = claude(f);
  let calls = 0;
  // alive on the first look, ended on the second: the wake ended while this run went, and its kick
  // starts a second pass under the same lock, which installs
  const r = jobRun(h, f, exec, { alive: (pid) => { if (pid !== 4242 || calls++) return false; KICK.kick(h.root, 'wake ended (pid 4242)'); return true; } });
  assert.match(r.out, /held: a run is in progress/);
  assert.match(r.out, /self-update: installed plugin delivery 0\.43\.31/);
  assert.deepEqual(r.woke, []);
});

// delivery-plugin-planning-0ba.5: the hold waited for the whole team to be idle at once, which with
// four builders and the Delivery Manager taking turns never came. Wakes overlapping without end: each
// one started before the last ended, so some wake was running at every look.
test('with wakes overlapping without end, the install lands within the bound and starts none of its own', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  const CYCLE = 15 * 60e3;
  // under the old rule every cycle started a wake that ran 40 minutes, so two always overlapped; these
  // are the ones running when the release merged, the last ending 100 minutes in
  const ends = { 5001: 40 * 60e3, 5002: 70 * 60e3, 5003: 100 * 60e3 };
  for (const pid of Object.keys(ends)) WD.log(h.root, { type: 'wake', at: T0, instance: 'builder-1', pid: Number(pid) });
  const exec = claude(f);
  let at = 0;
  let out = '';
  const woke = [];
  for (; at <= SU.HOLD_BOUND_MS && !/self-update: installed/.test(out); at += CYCLE) {
    const r = jobRun(h, f, exec, { now: later(at), alive: (pid) => ends[pid] > at });
    out = r.out;
    woke.push(...r.woke);
  }
  assert.match(out, /self-update: installed plugin delivery 0\.43\.31/);
  assert.ok(at - CYCLE <= SU.HOLD_BOUND_MS, `installed ${(at - CYCLE) / 60e3} min after the hold began`);
  // the bound holds only because a held install starts no new wake (0ba.6): with one started each
  // cycle, the overlap would never end and the install would wait without limit
  assert.deepEqual(woke, [], 'no wake started while the install was held');
  assert.equal(rows(f).filter((r) => r.result === 'held-overdue').length, 0);
});

test('a hold past the bound is logged once and the owner briefing reports it until the version installs', () => {
  const DP = require('./daily-plan.js');
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  // a wake that outlived its supervisor's stop: running at every look
  WD.log(h.root, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const exec = claude(f);
  const alive = (pid) => pid === 4242;
  const at = (ms) => jobRun(h, f, exec, { now: later(ms), alive }).out;
  assert.doesNotMatch(at(0), /past the/);
  assert.equal(DP.installHoldOf(h.root), null, 'a hold inside the bound is not news');
  assert.doesNotMatch(at(SU.HOLD_BOUND_MS - 60e3), /past the/);
  assert.equal(DP.installHoldOf(h.root), null);
  assert.match(at(SU.HOLD_BOUND_MS + 60e3), /held since .* past the 2\.5 h bound\): a run is in progress \(wake pid 4242\), a wake that outlived its timeout/);
  at(SU.HOLD_BOUND_MS + 16 * 60e3);
  assert.equal(rows(f).filter((r) => r.result === 'held-overdue').length, 1, 'logged once, not every cycle');
  const hold = DP.installHoldOf(h.root);
  assert.equal(hold.version, '0.43.31');
  const base = { now: later(SU.HOLD_BOUND_MS + 20 * 60e3), team: { roles: [] }, stalls: [], restarts: [], queue: [], questions: [], checks: [], andon: { stops: [], ci: {}, flaky: [], chains: [] }, unknowns: [], spikes: [], next: [], known: new Map(), titles: new Map(), stories: [], fixes: [], prs: {} };
  const brief = DP.brief({ ...base, installHold: hold }).join('\n');
  assert.match(brief, /^Version 0\.43\.31 of the plugin was merged but has waited since .+ to install, because a run has not stopped\.$/m, brief);
  assert.doesNotMatch(DP.brief({ ...base, installHold: null }).join('\n'), /waited since/);
  // once the wake ends the install lands and the briefing has nothing to say
  assert.match(jobRun(h, f, exec, { now: later(SU.HOLD_BOUND_MS + 31 * 60e3), alive: () => false }).out, /self-update: installed/);
  assert.equal(DP.installHoldOf(h.root), null);
});

test('a hold after a failed install is timed from its own start, not from the hold before it', () => {
  const h = harness({});
  const f = fixture({ root: h.root });
  merged(f, 140, true);
  // an earlier hold, then an install that failed: that hold is over
  const base = { type: 'self-update', from: '0.43.30', version: '0.43.31', sha: f.mainSha, pr: 140 };
  WD.log(h.root, { ...base, at: T0, result: 'held', why: 'a run is in progress (wake pid 4242)' });
  WD.log(h.root, { ...base, at: later(60e3), result: 'failed', detail: 'update failed' });
  WD.log(h.root, { type: 'wake', at: T0, instance: 'builder-1', pid: 4242 });
  const exec = claude(f);
  const alive = (pid) => pid === 4242;
  const start = SU.HOLD_BOUND_MS + 2 * 60e3;
  assert.doesNotMatch(jobRun(h, f, exec, { now: later(start), alive }).out, /past the/, 'a new hold is not overdue from the old start');
  assert.deepEqual(rows(f).filter((r) => r.result === 'held').map((r) => r.at), [T0, later(start)]);
  assert.equal(rows(f).filter((r) => r.result === 'held-overdue').length, 0);
  assert.match(jobRun(h, f, exec, { now: later(start + SU.HOLD_BOUND_MS + 60e3), alive }).out, new RegExp(`held since ${later(start).replace(/[.]/g, '\\.')} .*past the 2\\.5 h bound`));
  assert.deepEqual(rows(f).filter((r) => r.result === 'held-overdue').map((r) => r.since), [later(start)]);
});

test('a hold past the bound is no longer reported once a newer version installs', () => {
  const DP = require('./daily-plan.js');
  const h = harness({});
  WD.log(h.root, { type: 'self-update', version: '0.43.31', at: T0, result: 'held-overdue', since: T0 });
  assert.equal(DP.installHoldOf(h.root).version, '0.43.31');
  // an install from before the overdue row does not end it
  WD.log(h.root, { type: 'self-update', version: '0.43.30', at: later(-60e3), result: 'installed' });
  assert.equal(DP.installHoldOf(h.root).version, '0.43.31');
  WD.log(h.root, { type: 'self-update', version: '0.43.32', at: later(60e3), result: 'installed' });
  assert.equal(DP.installHoldOf(h.root), null);
});
