// scripts/start.test.js — start.js end to end, as a separate process, with a fake bd and a fake claude
// on a PATH that holds nothing else, so every prerequisite can be present or missing on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { validateManifest, expandInstances } = require('./lib/manifest.js');

const START = path.join(__dirname, 'start.js');
const FAKE_BD = path.join(__dirname, 'testing', 'fake-bd.js');
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const GIT = cp.execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// A PATH directory with exactly the tools asked for.
function bin({ bd = true, claude = '2.1.300 (Claude Code)', git = true } = {}) {
  const dir = mk('start-bin-');
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  if (git) fs.symlinkSync(GIT, path.join(dir, 'git'));
  if (bd) fs.writeFileSync(path.join(dir, 'bd'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_BD}" "$@"\n`, { mode: 0o755 });
  if (claude !== null) fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\necho "${claude}"\n`, { mode: 0o755 });
  return dir;
}

function claudeConfig({ installed = true, enabled = true, version = '99.0.0' } = {}) {
  const dir = mk('start-cfg-');
  if (installed !== null) {
    fs.mkdirSync(path.join(dir, 'plugins'));
    const plugins = installed ? { 'delivery@ai-augmentation-systems': [{ scope: 'user', installPath: '/x', version }] } : {};
    fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'delivery@ai-augmentation-systems': enabled } }));
  }
  return dir;
}

function start(args, { path: binDir = bin(), config = claudeConfig(), cwd } = {}) {
  const env = {
    PATH: `${binDir}${path.delimiter}/bin`, HOME: os.tmpdir(), CLAUDE_CONFIG_DIR: config, BD_FAKE_STORE: path.join(mk('start-bd-'), 'store.json'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  };
  const r = cp.spawnSync(process.execPath, [START, ...args], { env, cwd: cwd || os.tmpdir(), encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

function productRepo() {
  const dir = mk('start-product-');
  const g = (...a) => cp.execFileSync(GIT, a, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' } });
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const manifestOf = (root) => ({ team: readJson(path.join(root, '.delivery/team/team.json')), hosts: readJson(path.join(root, '.delivery/team/hosts.json')) });

test('--check: everything present passes and exits 0', () => {
  const r = start(['--check']);
  assert.equal(r.status, 0, r.out);
  for (const name of ['node', 'git', 'bd (beads)', 'claude (Claude Code)', 'delivery plugin']) assert.match(r.out, new RegExp(`\\[pass\\] ${name.replace(/[()]/g, '\\$&')}:`));
  assert.match(r.out, /bd version 0\.0\.0-fake/);
  assert.match(r.out, /All hard prerequisites are met\./);
});

test('--check: missing bd and an old claude are hard failures with a fix; exit 1', () => {
  const r = start(['--check'], { path: bin({ bd: false, claude: '2.1.100 (Claude Code)' }) });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /\[FAIL\] bd \(beads\): not found on PATH\. Fix: install beads/);
  assert.match(r.out, /\[FAIL\] claude \(Claude Code\): 2\.1\.100 is older than 2\.1\.224.*Fix: run `claude update`/);
  assert.match(r.out, /2 hard prerequisite\(s\) missing: bd \(beads\), claude \(Claude Code\)\./);
});

test('--check: claude missing fails; an unreadable claude version and an unknown plugin state are not hard', () => {
  assert.match(start(['--check'], { path: bin({ claude: null }) }).out, /\[FAIL\] claude \(Claude Code\): not found on PATH/);
  const r = start(['--check'], { path: bin({ claude: 'something else' }), config: claudeConfig({ installed: null }) });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /\[\?\?\?\?\] claude \(Claude Code\): `claude --version` could not be read\. Fix: verify manually/);
  assert.match(r.out, /\[\?\?\?\?\] delivery plugin: no readable plugins\/installed_plugins\.json/);
});

test('--check: plugin not installed, disabled or older is a warning; --project without a remote warns', () => {
  assert.match(start(['--check'], { config: claudeConfig({ installed: false }) }).out, /\[warn\] delivery plugin: not listed as installed\. Fix: run \/plugin install delivery@ai-augmentation-systems/);
  assert.match(start(['--check'], { config: claudeConfig({ enabled: false }) }).out, /\[warn\] delivery plugin: installed \(99\.0\.0\) but disabled/);
  assert.match(start(['--check'], { config: claudeConfig({ version: '0.0.1' }) }).out, /\[warn\] delivery plugin: installed 0\.0\.1 is older than this copy/);
  const r = start(['--check', '--project', productRepo()]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /\[warn\] project repo remote: no origin remote/);
});

test('--dry-run prints the plan and writes nothing', () => {
  const base = mk('start-dry-');
  const project = path.join(base, 'acme');
  const r = start(['--project', project, '--host', 'laptop', '--product-repo', productRepo(), '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /would create .*acme and run git init/);
  assert.match(r.out, /would write \.delivery\/team\/team\.json and \.delivery\/team\/hosts\.json: preset minimal, models balanced, host "laptop", prefix "acme"/);
  assert.match(r.out, /would run bd init --prefix acme/);
  assert.match(r.out, /builder: would prepare \(sonnet, product worktree on team\/builder\)/);
  assert.deepEqual(fs.readdirSync(base), []);
});

test('minimal preset: a valid manifest, four prepared roles, BEADS_DIR, a builder worktree, start commands', () => {
  const base = mk('start-min-');
  const project = path.join(base, 'acme');
  const r = start(['--project', project, '--host', 'laptop', '--product-repo', productRepo(), '--permission-mode', 'acceptEdits']);
  assert.equal(r.status, 0, r.out);
  const { team, hosts } = manifestOf(project);
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.deepEqual(expandInstances(team).map((i) => i.instance), ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder']);
  assert.equal(team.prefix, 'acme');
  assert.ok(fs.existsSync(path.join(project, '.beads')));
  assert.match(r.out, /manifest: committed \([0-9a-f]+\)/);
  for (const i of ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder']) {
    const dir = path.join(base, 'acme-team', i);
    assert.equal(readJson(path.join(dir, '.delivery-role.json')).instance, i);
    assert.equal(readJson(path.join(dir, '.claude', 'settings.local.json')).env.BEADS_DIR, path.join(project, '.beads'));
    assert.ok(fs.existsSync(path.join(dir, 'project', '.delivery', 'team', 'team.json')), `${i} clone carries the committed manifest`);
    assert.ok(r.out.includes(`cd ${dir} && claude --permission-mode acceptEdits --name ${i}`), r.out);
  }
  assert.ok(fs.existsSync(path.join(base, 'acme-team', 'builder', 'product', '.git')));
  assert.ok(r.out.indexOf('--name chief-of-staff') < r.out.indexOf('--name builder'), 'the Chief of Staff starts first');
  assert.match(r.out, /Open the Chief of Staff session and talk to it/);
});

test('full preset: seven instances and a valid manifest', () => {
  const base = mk('start-full-');
  const project = path.join(base, 'shop');
  const r = start(['--project', project, '--host', 'box', '--preset', 'full', '--prefix', 'sh', '--runner', 'superpowers']);
  assert.equal(r.status, 0, r.out);
  const { team, hosts } = manifestOf(project);
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.equal(team.prefix, 'sh');
  assert.equal(team.roles.find((x) => x.id === 'builder').runner, 'superpowers');
  const ids = expandInstances(team).map((i) => i.instance);
  assert.deepEqual(ids.slice().sort(), ['builder', 'chief-of-staff', 'delivery-lead', 'product-manager', 'progress-observer', 'spike-researcher', 'staffing']);
  for (const i of ids) assert.ok(fs.existsSync(path.join(base, 'shop-team', i, '.delivery-role.json')), i);
  assert.match(r.out, /no product worktree/);
  assert.match(r.out, /claude --name chief-of-staff/);
  assert.doesNotMatch(r.out, /claude --permission-mode/);
});

test('a second run changes nothing; it prepares only a missing role', () => {
  const base = mk('start-idem-');
  const project = path.join(base, 'acme');
  assert.equal(start(['--project', project, '--host', 'laptop']).status, 0);
  const before = fs.readFileSync(path.join(project, '.delivery/team/team.json'), 'utf8');
  const again = start(['--project', project, '--host', 'other', '--preset', 'full']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /keeping the existing/);
  assert.match(again.out, /bd init skipped/);
  assert.equal((again.out.match(/already prepared/g) || []).length, 4);
  assert.equal(fs.readFileSync(path.join(project, '.delivery/team/team.json'), 'utf8'), before);
  fs.rmSync(path.join(base, 'acme-team', 'delivery-lead'), { recursive: true, force: true });
  const third = start(['--project', project]);
  assert.match(third.out, /delivery-lead: prepared/);
  assert.equal((third.out.match(/already prepared/g) || []).length, 3);
});

test('an existing manifest is never overwritten; an invalid one or a half one is refused', () => {
  const base = mk('start-exist-');
  const project = path.join(base, 'acme');
  fs.mkdirSync(path.join(project, '.delivery', 'team'), { recursive: true });
  cp.execFileSync(GIT, ['init', '-q'], { cwd: project });
  const team = { project: 'acme', prefix: 'zz', bd_host: 'h', roles: [{ id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'h', model: 'haiku', steward: true }] };
  const teamText = `${JSON.stringify(team)}\n`;
  fs.writeFileSync(path.join(project, '.delivery/team/team.json'), teamText);
  fs.writeFileSync(path.join(project, '.delivery/team/hosts.json'), JSON.stringify({ hosts: { h: { kind: 'pc' } } }));
  const r = start(['--project', project, '--preset', 'full', '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /keeping the existing .*1 instance\(s\)/);
  assert.match(r.out, /would run bd init --prefix zz/);
  assert.equal(fs.readFileSync(path.join(project, '.delivery/team/team.json'), 'utf8'), teamText);
  fs.writeFileSync(path.join(project, '.delivery/team/team.json'), JSON.stringify({ ...team, roles: [{ ...team.roles[0], model: ' ' }] }));
  const bad = start(['--project', project]);
  assert.equal(bad.status, 1);
  // A4: any model string is accepted; an empty one is invalid
  assert.match(bad.out, /manifest: invalid:\n.*invalid "model"/);
  fs.rmSync(path.join(project, '.delivery/team/hosts.json'));
  const half = start(['--project', project]);
  assert.equal(half.status, 1);
  assert.match(half.out, /refused: \.delivery\/team\/hosts\.json is missing/);
});

test('without bd the scaffold still prepares the roles and says how to finish', () => {
  const base = mk('start-nobd-');
  const project = path.join(base, 'acme');
  const r = start(['--project', project, '--host', 'laptop'], { path: bin({ bd: false }) });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: skipped: bd is not on PATH\. Install it, run `bd init --prefix acme`/);
  assert.ok(!fs.existsSync(path.join(project, '.beads')));
  const settings = readJson(path.join(base, 'acme-team', 'builder', '.claude', 'settings.local.json'));
  assert.equal(settings.env.BEADS_DIR, undefined);
});

test('a product repo URL is cloned next to the project; the manifest does not carry it (A4)', () => {
  const base = mk('start-url-');
  const project = path.join(base, 'acme');
  const url = `file://${productRepo()}`;
  const r = start(['--project', project, '--host', 'laptop', '--product-repo', url]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /clone file:\/\/.* into .*acme-product/);
  assert.ok(fs.existsSync(path.join(base, 'acme-product', '.git')));
  assert.equal(manifestOf(project).team.product_repo, undefined);
  assert.ok(fs.existsSync(path.join(base, 'acme-team', 'builder', 'product', '.git')));
});

test('usage errors exit 2', () => {
  assert.equal(start(['--project', mk('x-'), '--preset', 'huge']).status, 2);
  assert.equal(start(['--project', mk('x-'), '--permission-mode', 'yolo']).status, 2);
  assert.equal(start(['--bogus', '1']).status, 2);
  assert.equal(start([]).status, 2);
});

test('A5: --models presets set every role\'s model and the builders\' large-bead model in the generated team.json', () => {
  const { MODEL_PRESETS, buildManifest } = require('./start.js');
  const models = (preset) => Object.fromEntries(buildManifest({ project: 'acme', prefix: 'acme', host: 'h', preset: 'full', runner: 'plain', models: preset }).team.roles.map((r) => [r.id, r.model]));
  assert.deepEqual(models('balanced'), { 'chief-of-staff': 'opus', staffing: 'sonnet', 'product-manager': 'opus', 'delivery-lead': 'sonnet', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', builder: 'sonnet' });
  assert.deepEqual(models('quality'), { 'chief-of-staff': 'opus', staffing: 'sonnet', 'product-manager': 'opus', 'delivery-lead': 'opus', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', builder: 'sonnet' });
  assert.deepEqual(models('economy'), { 'chief-of-staff': 'sonnet', staffing: 'haiku', 'product-manager': 'sonnet', 'delivery-lead': 'sonnet', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', builder: 'sonnet' });
  const builder = (preset) => buildManifest({ project: 'acme', prefix: 'acme', host: 'h', preset: 'minimal', runner: 'plain', models: preset }).team.roles.find((r) => r.id === 'builder');
  assert.equal(builder('quality').large_model, 'opus');
  assert.equal(builder('economy').large_model, 'sonnet');
  assert.ok(Object.keys(MODEL_PRESETS).length === 3);
  assert.equal(start(['--project', mk('x-'), '--models', 'cheap']).status, 2);
  const project = path.join(mk('start-models-'), 'acme');
  const r = start(['--project', project, '--host', 'laptop', '--models', 'economy', '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /preset minimal, models economy/);
});

test('final M1: a manifest left uncommitted by a refused run is committed by the next run', () => {
  const project = path.join(mk('start-m1-'), 'acme');
  const bad = start(['--project', project, '--host', 'laptop', '--product-repo', '/nonexistent']);
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /refused: \/nonexistent is not a git checkout/);
  const git = (...a) => cp.execFileSync(GIT, a, { cwd: project, encoding: 'utf8' });
  assert.match(git('status', '--porcelain'), /\?\? \.delivery\//, 'the refused run left the manifest uncommitted');
  const ok = start(['--project', project, '--host', 'laptop']);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /manifest: committed/);
  assert.equal(git('status', '--porcelain', '--', '.delivery/team/team.json', '.delivery/team/hosts.json'), '');
});

test('final M2: a --product-repo value starting with - is a path, refused cleanly, never a git option', () => {
  const project = path.join(mk('start-m2-'), 'acme');
  const r = start(['--project', project, '--host', 'laptop', '--product-repo', '-uupload-pack=touch /tmp/pwned']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /is not a git checkout/);
  // a URL-shaped value that starts with - reaches git clone only after --, so it is a repository, not an option
  const r2 = start(['--project', path.join(mk('start-m2b-'), 'acme'), '--host', 'laptop', '--product-repo', '-uupload@x:y']);
  assert.equal(r2.status, 1, r2.out);
  assert.match(r2.out, /clone -uupload@x:y into/);
  assert.match(r2.out, /clone failed/);
});

test('final I3: after bd is installed and .beads exists, a re-run re-prepares the roles so each gets BEADS_DIR', () => {
  const project = path.join(mk('start-i3-'), 'acme');
  const first = start(['--project', project, '--host', 'laptop'], { path: bin({ bd: false }) });
  assert.equal(first.status, 0, first.out);
  assert.match(first.out, /then run start\.js again: it re-prepares the roles/);
  const teamDir = path.join(path.dirname(project), 'acme-team');
  const envOf = (i) => readJson(path.join(teamDir, i, '.claude', 'settings.local.json')).env;
  assert.equal(envOf('chief-of-staff').BEADS_DIR, undefined);
  fs.mkdirSync(path.join(project, '.beads')); // bd init ran
  const again = start(['--project', project, '--host', 'laptop']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /chief-of-staff: re-prepared for BEADS_DIR/);
  for (const i of ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder']) assert.equal(envOf(i).BEADS_DIR, path.join(project, '.beads'), i);
  assert.match(start(['--project', project, '--host', 'laptop']).out, /chief-of-staff: already prepared/);
});

test('final M6: an unknown model name is a warning in start.js output, not a refusal', () => {
  const project = path.join(mk('start-m6-'), 'acme');
  assert.equal(start(['--project', project, '--host', 'laptop']).status, 0);
  const file = path.join(project, '.delivery/team/team.json');
  const team = readJson(file);
  team.roles[0].model = 'claude-opus-9';
  fs.writeFileSync(file, JSON.stringify(team));
  const r = start(['--project', project, '--host', 'laptop']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /manifest: warning: team.json: role "chief-of-staff" has model "claude-opus-9"/);
  assert.match(r.out, /manifest: committed/, 'the hand edit is committed too');
});
