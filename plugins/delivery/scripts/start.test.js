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

function start(args, { path: binDir = bin(), config = claudeConfig(), cwd, env: extra = {} } = {}) {
  const env = {
    ...extra,
    PATH: `${binDir}${path.delimiter}/bin`, HOME: os.tmpdir(), CLAUDE_CONFIG_DIR: config, BD_FAKE_STORE: extra.BD_FAKE_STORE || path.join(mk('start-bd-'), 'store.json'),
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

test('start: names the product\'s test command for any language (the reviewer runs it on each pull request)', () => {
  for (const [file, want] of [['go.mod', /product tests: `go test \.\/\.\.\.` \(detected: Go\)/], ['App.sln', /product tests: `dotnet test` \(detected: \.NET\)/]]) {
    const repo = productRepo();
    fs.writeFileSync(path.join(repo, file), '');
    const r = start(['--project', path.join(mk('start-tc-'), 'acme'), '--host', 'laptop', '--product-repo', repo, '--dry-run']);
    assert.match(r.out, want, r.out);
  }
});

test('start: the team\'s permission mode is kept across runs unless --permission-mode changes it', () => {
  const base = mk('start-mode-');
  const project = path.join(base, 'acme');
  assert.equal(start(['--project', project, '--host', 'laptop']).status, 0);
  assert.equal(manifestOf(project).team.permission_mode, 'auto');
  assert.equal(start(['--project', project, '--host', 'laptop', '--permission-mode', 'acceptEdits']).status, 0);
  assert.equal(manifestOf(project).team.permission_mode, 'acceptEdits');
  const again = start(['--project', project, '--host', 'laptop']);
  assert.equal(manifestOf(project).team.permission_mode, 'acceptEdits', 'a run without the flag keeps the recorded mode');
  assert.ok(again.out.includes('--permission-mode acceptEdits'), again.out);
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
  // an empty product has no test setup: said at start, with the one-line fix
  assert.match(r.out, /product tests: not known: no test setup found in the repository root\.\n {4}Set it once: "test_command" in \.delivery\/team\/team\.json/);
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
  // the watchdog resumes each session in this mode (a resumed session does not keep its own)
  assert.equal(team.permission_mode, 'acceptEdits');
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

test('full preset: eight instances, the Reality Checker among them, and a valid manifest', () => {
  const base = mk('start-full-');
  const project = path.join(base, 'shop');
  const r = start(['--project', project, '--host', 'box', '--preset', 'full', '--prefix', 'sh', '--runner', 'superpowers']);
  assert.equal(r.status, 0, r.out);
  const { team, hosts } = manifestOf(project);
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.equal(team.prefix, 'sh');
  assert.equal(team.roles.find((x) => x.id === 'builder').runner, 'superpowers');
  const ids = expandInstances(team).map((i) => i.instance);
  assert.deepEqual(ids.slice().sort(), ['builder', 'chief-of-staff', 'delivery-lead', 'product-manager', 'progress-observer', 'reality-checker', 'spike-researcher', 'staffing']);
  for (const i of ids) assert.ok(fs.existsSync(path.join(base, 'shop-team', i, '.delivery-role.json')), i);
  assert.match(r.out, /no product worktree/);
  // auto by default (team rule 0: the operator is not the team's approver)
  assert.match(r.out, /claude --permission-mode auto --name chief-of-staff/);
  assert.match(r.out, /--permission-mode auto: the sessions run without asking you to approve each step/);
});

test('--permission-mode default is still available and prints no flag', () => {
  const project = path.join(mk('start-default-mode-'), 'acme');
  const r = start(['--project', project, '--host', 'laptop', '--permission-mode', 'default']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /cd \S+ && claude --name chief-of-staff/);
  assert.doesNotMatch(r.out, /claude --permission-mode/);
  assert.match(r.out, /--permission-mode default: each session uses your own Claude Code default and may ask you/);
});

test('a second run changes nothing; it prepares only a missing role', () => {
  const base = mk('start-idem-');
  const project = path.join(base, 'acme');
  assert.equal(start(['--project', project, '--host', 'laptop']).status, 0);
  const before = fs.readFileSync(path.join(project, '.delivery/team/team.json'), 'utf8');
  const again = start(['--project', project, '--host', 'other', '--preset', 'full']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /keeping the existing/);
  assert.match(again.out, /beads: database present/);
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
  assert.match(r.out, /beads: skipped: bd is not on PATH\. Install it \(docs\/quickstart\.md, "Setting up beads"\), then run start\.js again/);
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
  assert.deepEqual(models('balanced'), { 'chief-of-staff': 'opus', staffing: 'sonnet', 'product-manager': 'opus', 'delivery-lead': 'sonnet', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', 'reality-checker': 'sonnet', builder: 'sonnet' });
  assert.deepEqual(models('quality'), { 'chief-of-staff': 'opus', staffing: 'sonnet', 'product-manager': 'opus', 'delivery-lead': 'opus', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', 'reality-checker': 'sonnet', builder: 'sonnet' });
  assert.deepEqual(models('economy'), { 'chief-of-staff': 'sonnet', staffing: 'haiku', 'product-manager': 'sonnet', 'delivery-lead': 'sonnet', 'progress-observer': 'haiku', 'spike-researcher': 'sonnet', 'reality-checker': 'sonnet', builder: 'sonnet' });
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
  assert.match(first.out, /then run start\.js again: it sets up beads and re-prepares the roles/);
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

// ---- beads setup: Windows and sync (docs/quickstart.md, "Setting up beads") ----

const { checkPrerequisites } = require('./start.js');

// A PATH for checkPrerequisites run in this process: bd that works or fails, and a reg that
// answers the Smart App Control query with a given DWORD (null: no reg at all).
function winBin({ bd = 'blocked', sac = 1 } = {}) {
  const dir = bin({ bd: bd === 'ok' });
  if (bd === 'blocked') fs.writeFileSync(path.join(dir, 'bd'), '#!/bin/sh\necho "An Application Control policy has blocked this file." >&2\nexit 1\n', { mode: 0o755 });
  if (bd === 'missing') fs.rmSync(path.join(dir, 'bd'), { force: true });
  if (sac !== null) {
    fs.writeFileSync(path.join(dir, 'reg'), `#!/bin/sh\nprintf '\\nHKEY_LOCAL_MACHINE\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\CI\\\\Policy\\n    VerifiedAndReputablePolicyState    REG_DWORD    0x${sac}\\n\\n'\n`, { mode: 0o755 });
  }
  return dir;
}
const bdRow = (rows) => rows.find((r) => r.name === 'bd (beads)');
const check = (dir, platform = 'win32') => checkPrerequisites({ env: { PATH: `${dir}${path.delimiter}/bin`, HOME: os.tmpdir(), CLAUDE_CONFIG_DIR: claudeConfig(), BD_FAKE_STORE: path.join(mk('start-bd-'), 's.json') }, platform });

test('--check on Windows: Smart App Control on or in evaluation names the block and recommends WSL2', () => {
  for (const [sac, word] of [[1, 'on'], [2, 'in evaluation mode']]) {
    const r = bdRow(check(winBin({ sac })));
    assert.equal(r.status, 'fail');
    assert.equal(r.hard, true);
    assert.match(r.detail, new RegExp(`Smart App Control is ${word}, and it blocks unsigned programs such as bd\\.exe`));
    assert.match(r.detail, /An Application Control policy has blocked this file/);
    assert.match(r.fix, /^run the team inside WSL2 and install the Linux bd there/);
    assert.match(r.fix, /turn Smart App Control off \(machine-wide; it can be turned back on only on Windows 11 25H2/);
  }
});

test('--check on Windows: Smart App Control off or unreadable offers the installer, not the Smart App Control advice', () => {
  for (const [sac, word] of [[0, 'off'], [null, 'unknown']]) {
    const r = bdRow(check(winBin({ bd: 'missing', sac })));
    assert.equal(r.status, 'fail');
    assert.match(r.detail, new RegExp(`^not found on PATH; Smart App Control is ${word}$`));
    assert.match(r.fix, /checksum-verified PowerShell installer/);
    assert.doesNotMatch(r.fix, /turn Smart App Control off/);
  }
});

test('--check on Windows: a bd that runs passes and the Smart App Control state is not consulted', () => {
  const dir = winBin({ bd: 'ok', sac: 1 });
  const rows = check(dir);
  assert.equal(bdRow(rows).status, 'pass');
  assert.doesNotMatch(JSON.stringify(rows), /Smart App Control/);
  assert.match(rows.find((r) => r.name === 'platform').fix, /run the team inside WSL2/);
  assert.equal(check(dir, 'freebsd').find((r) => r.name === 'platform').fix, 'run the team on macOS or Linux');
});

test('--check off Windows: a failing bd keeps the plain install advice', () => {
  const r = bdRow(check(winBin({ bd: 'missing', sac: 1 }), 'linux'));
  assert.equal(r.detail, 'not found on PATH');
  assert.doesNotMatch(r.fix, /Smart App Control|WSL2/);
});

function beadsProject() {
  const root = productRepo();
  fs.mkdirSync(path.join(root, '.beads'));
  return root;
}
const syncLine = (out) => (out.split('\n').find((l) => l.includes('beads sync')) || '').trim();

test('--check: a beads database with no sync remote warns that its issues live on one machine', () => {
  const r = start(['--check', '--project', beadsProject()]);
  assert.equal(r.status, 0, r.out);
  assert.match(syncLine(r.out), /^\[warn\] beads sync: no sync remote: these issues exist on this machine only.*Fix: in the project repo: `bd dolt remote add origin <its private git URL>`, then `bd dolt push`/);
});

test('--check: a beads sync remote passes; an unreadable answer is unknown; no .beads, no row', () => {
  const remotes = JSON.stringify([{ name: 'origin', url: 'git+https://example.test/acme/planning.git', status: 'ok' }]);
  assert.equal(syncLine(start(['--check', '--project', beadsProject()], { env: { BD_FAKE_DOLT_REMOTES: remotes } }).out),
    '[pass] beads sync: origin git+https://example.test/acme/planning.git');
  assert.match(syncLine(start(['--check', '--project', beadsProject()], { env: { BD_FAKE_DOLT_REMOTES: 'fail' } }).out),
    /^\[\?\?\?\?\] beads sync: `bd dolt remote list --json` could not be read: fake-bd: dolt remote list failed/);
  assert.equal(syncLine(start(['--check', '--project', productRepo()]).out), '');
});

// ---- beads set up by start.js for any project, on any machine ----

const { doltUrlOf } = require('./start.js');
const fakeCfg = (root) => { const f = path.join(root, '.beads', 'fake-config.json'); return fs.existsSync(f) ? readJson(f) : null; };
function projectWithOrigin() {
  const root = productRepo();
  const bare = mk('start-origin-');
  cp.execFileSync(GIT, ['init', '-q', '--bare', bare]);
  cp.execFileSync(GIT, ['remote', 'add', 'origin', bare], { cwd: root });
  return { root, bare };
}
const scaffold = (root, opts = {}) => start(['--project', root, '--host', 'laptop'], opts);

test('doltUrlOf: https, scp-style ssh, ssh, absolute paths and git+ URLs; anything else is null', () => {
  assert.equal(doltUrlOf('https://github.com/acme/plan.git'), 'git+https://github.com/acme/plan.git');
  assert.equal(doltUrlOf('git@github.com:acme/plan.git'), 'git+ssh://git@github.com/acme/plan.git');
  assert.equal(doltUrlOf('ssh://git@gitea.local:2222/acme/plan.git'), 'git+ssh://git@gitea.local:2222/acme/plan.git');
  assert.equal(doltUrlOf('/srv/git/plan.git'), 'git+file:///srv/git/plan.git');
  assert.equal(doltUrlOf('git+https://x.test/a.git'), 'git+https://x.test/a.git');
  assert.equal(doltUrlOf('relative/dir'), null);
});

test('start: a new project with an origin gets beads, the origin as sync remote, and a publish', () => {
  const { root, bare } = projectWithOrigin();
  const r = scaffold(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: run bd init --prefix /);
  assert.match(r.out, new RegExp(`beads: set the sync remote to the project repo \\(git\\+file://${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.match(r.out, /beads: issues published to the project repo/);
  const cfg = fakeCfg(root);
  assert.deepEqual(cfg.remotes.map((x) => x.url), [`git+file://${bare}`]);
  assert.equal(cfg.pushes, 1);
});

test('start: a new project with no origin keeps beads local and says so; nothing is pushed', () => {
  const root = productRepo();
  const r = scaffold(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: no sync remote, and the project repo has no origin to sync through: its issues stay on this machine/);
  assert.equal(fakeCfg(root).pushes, undefined);
});

test('start: a fresh clone (.beads without a database) is bootstrapped, never re-initialised', () => {
  const root = productRepo();
  fs.mkdirSync(path.join(root, '.beads'));
  fs.writeFileSync(path.join(root, '.beads', 'config.yaml'), 'sync.remote: "x"\n');
  const r = scaffold(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: \.beads is here but this machine has no database \(a fresh clone\); run bd bootstrap to fetch them/);
  assert.match(r.out, /beads: database fetched from the project repo/);
  assert.doesNotMatch(r.out, /bd init/);
  assert.equal(fakeCfg(root).bootstrapped, true);
  assert.equal(readJson(path.join(path.dirname(root), `${path.basename(root).toLowerCase()}-team`, 'builder', '.claude', 'settings.local.json')).env.BEADS_DIR, path.join(root, '.beads'));
});

test('start: a bootstrap that fails is reported with the fix and does not stop the scaffold', () => {
  const root = productRepo();
  fs.mkdirSync(path.join(root, '.beads'));
  const r = scaffold(root, { env: { BD_FAKE_BOOTSTRAP: 'fail' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: bd bootstrap failed: fake-bd: nothing to bootstrap from\. Fix: docs\/quickstart\.md/);
  assert.equal(fakeCfg(root), null);
});

test('start: an existing database with no remote is connected and published; one with a remote is left alone', () => {
  const { root, bare } = projectWithOrigin();
  fs.mkdirSync(path.join(root, '.beads'));
  fs.writeFileSync(path.join(root, '.beads', 'fake-config.json'), JSON.stringify({ prefix: 'acme' }));
  const r = scaffold(root);
  assert.match(r.out, /beads: database present/);
  assert.match(r.out, /beads: issues published to the project repo/);
  assert.equal(fakeCfg(root).pushes, 1);
  assert.equal(fakeCfg(root).remotes[0].url, `git+file://${bare}`);
  const again = scaffold(root);
  assert.doesNotMatch(again.out, /set the sync remote|published/);
  assert.equal(fakeCfg(root).pushes, 1);
});

test('start: a refused publish is reported; the scaffold still completes', () => {
  const { root } = projectWithOrigin();
  const r = scaffold(root, { env: { BD_FAKE_PUSH: 'fail' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: publish failed: fake-bd: push refused\. The database works here; run `bd dolt push`/);
});

test('start: a product repo with its own beads is noted as not imported; one without is not mentioned', () => {
  const project = productRepo();
  const product = productRepo();
  fs.mkdirSync(path.join(product, '.beads'));
  const r = start(['--project', project, '--host', 'laptop', '--product-repo', product]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: the product repo has its own beads workspace .*; it is not imported and nothing waits on it/);
  const plain = start(['--project', productRepo(), '--host', 'laptop', '--product-repo', productRepo()]);
  assert.doesNotMatch(plain.out, /its own beads workspace/);
});

test('start: a clone without .beads whose project repo already holds issues is bootstrapped, not initialised', () => {
  const { root, bare } = projectWithOrigin();
  const sha = cp.execFileSync(GIT, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  cp.execFileSync(GIT, ['push', '-q', 'origin', 'HEAD:main'], { cwd: root });
  cp.execFileSync(GIT, ['update-ref', 'refs/dolt/data', sha], { cwd: bare });
  const r = scaffold(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: the project repo already holds the team's issues; run bd bootstrap to fetch them/);
  assert.doesNotMatch(r.out, /bd init/);
  assert.equal(fakeCfg(root).bootstrapped, true);
});

test('start: bd init leaves the customer agent files alone and commits only the beads files', () => {
  const { root } = projectWithOrigin();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# ours\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'staged by the customer\n');
  cp.execFileSync(GIT, ['add', 'notes.txt'], { cwd: root });
  const r = scaffold(root);
  assert.equal(r.status, 0, r.out);
  assert.equal(fakeCfg(root).skipAgents, true);
  assert.match(r.out, /beads: committed \.beads/);
  const files = cp.execFileSync(GIT, ['log', '--name-only', '--format=%s', '--grep=^beads:'], { cwd: root, encoding: 'utf8' });
  assert.match(files, /beads: initialise issue tracking/);
  assert.match(files, /\.beads\/fake-config\.json/);
  assert.match(files, /beads: sync through the project repo/);
  assert.doesNotMatch(files, /notes\.txt|CLAUDE\.md/);
  assert.match(cp.execFileSync(GIT, ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), /^A  notes\.txt$/m);
});

test('start: a publish refused with HTTP 403 names the network policy and where to publish from; a dry run says it would publish', () => {
  const { root } = projectWithOrigin();
  const dry = start(['--project', root, '--host', 'laptop', '--dry-run']);
  assert.match(dry.out, /beads: would set the project repo's origin as the sync remote and publish the issues/);
  const r = scaffold(root, { env: { BD_FAKE_PUSH: '403' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: publish refused \(HTTP 403\): this machine's network does not allow pushing beads' refs\/dolt\/data .*publish once from a machine with ordinary git access/);
  assert.doesNotMatch(r.out, /publish failed:/);
});

// ---- --launch: the team starts itself ----

// a stand-in claude that records each start (cwd, args, DELIVERY_ROLE) as one JSON file per call
function recordingClaude() {
  const dir = mk('start-launch-rec-');
  const bin = path.join(dir, 'claude-rec');
  fs.writeFileSync(bin, `#!/bin/sh\nf="${dir}/$DELIVERY_ROLE.json"\n"${process.execPath}" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), role: process.env.DELIVERY_ROLE, parent: process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_CODE_REMOTE_SESSION_ID || process.env.CLAUDECODE || null, args: process.argv.slice(2) }))' "$f" "$@"\n`, { mode: 0o755 });
  return { bin, dir };
}
function waitFor(files, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until && !files.every((f) => fs.existsSync(f))) cp.spawnSync('sleep', ['0.1']);
  return files.every((f) => fs.existsSync(f));
}

test('--launch starts every role on this host in its role directory, in auto mode, with the join prompt', () => {
  const project = path.join(mk('start-launch-'), 'acme');
  const rec = recordingClaude();
  // launched from inside a Claude Code session: the roles must not inherit its identity
  const r = start(['--project', project, '--host', 'laptop', '--launch'], { env: { DELIVERY_CLAUDE_BIN: rec.bin, CLAUDE_CODE_SESSION_ID: 'parent-sess', CLAUDE_CODE_REMOTE_SESSION_ID: 'parent-remote', CLAUDECODE: '1' } });
  assert.equal(r.status, 0, r.out);
  const roles = ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder'];
  assert.ok(waitFor(roles.map((i) => path.join(rec.dir, `${i}.json`))), r.out);
  for (const i of roles) {
    const call = readJson(path.join(rec.dir, `${i}.json`));
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(path.join(path.dirname(project), 'acme-team', i)), i);
    assert.equal(call.role, i);
    assert.equal(call.parent, null, `${i} inherited the launching session's identity`);
    assert.deepEqual(call.args, ['-p', '/delivery:team join', '--permission-mode', 'auto', '--name', i]);
    assert.match(r.out, new RegExp(`${i}: started \\(pid \\d+\\), joining the team`));
  }
  assert.match(r.out, /The team is starting: each role on this machine runs its first turn/);
  assert.doesNotMatch(r.out, /Start each session in its own terminal/);
});

test('--launch skips a role already on the roster, starts nothing for other hosts, and a dry run starts nothing', () => {
  const project = path.join(mk('start-launch2-'), 'acme');
  const rec = recordingClaude();
  const dry = start(['--project', project, '--host', 'laptop', '--launch', '--dry-run'], { env: { DELIVERY_CLAUDE_BIN: rec.bin } });
  assert.match(dry.out, /chief-of-staff: would start in \S+: \S+ -p "\/delivery:team join" --permission-mode auto --name chief-of-staff/);
  assert.equal(start(['--project', project, '--host', 'laptop'], { env: { DELIVERY_CLAUDE_BIN: rec.bin } }).status, 0);
  require('./lib/roster.js').registerInstance(project, { instance: 'chief-of-staff', session_id: 'sess-cos-1', host: 'laptop', model: 'opus', role_dir: '/x', now: new Date().toISOString() });
  const r = start(['--project', project, '--host', 'laptop', '--launch'], { env: { DELIVERY_CLAUDE_BIN: rec.bin } });
  assert.match(r.out, /chief-of-staff: already started \(session sess-cos-1\)/);
  assert.ok(waitFor(['product-manager', 'delivery-lead', 'builder'].map((i) => path.join(rec.dir, `${i}.json`))), r.out);
  assert.ok(!fs.existsSync(path.join(rec.dir, 'chief-of-staff.json')), 'a started role is not started twice');
  const other = start(['--project', project, '--host', 'elsewhere', '--launch'], { env: { DELIVERY_CLAUDE_BIN: rec.bin } });
  assert.equal(other.status, 1, other.out);
  assert.match(other.out, /nothing to start: no role of this team runs on host "elsewhere"/);
});

test('a project repo start.js creates starts on main, whatever the machine\'s git default', () => {
  const project = path.join(mk('start-main-'), 'acme');
  const r = start(['--project', project, '--host', 'laptop']);
  assert.equal(r.status, 0, r.out);
  assert.equal(cp.execFileSync(GIT, ['symbolic-ref', '--short', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(), 'main');
});

// ---- --import-beads: a product's existing backlog comes into the project once ----

// The worked example: prefix vault, 3 issues (one closed, one depending on another).
const VAULT_ISSUES = [
  { id: 'vault-a1', title: 'Cut the first release', status: 'closed', issue_type: 'task' },
  { id: 'vault-b2', title: 'Write the changelog', status: 'open', issue_type: 'task', dependencies: [{ issue_id: 'vault-b2', depends_on_id: 'vault-a1', type: 'blocks' }] },
  { id: 'vault-c3', title: 'Plan the next quarter', status: 'in_progress', issue_type: 'task' },
];
function exportFile(rows = VAULT_ISSUES, name = 'vault-export.jsonl') {
  const f = path.join(mk('start-export-'), name);
  fs.writeFileSync(f, rows.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
  return f;
}
const storeIn = () => path.join(mk('start-bd-'), 'store.json');
const issuesIn = (store) => (fs.existsSync(store) ? Object.values(readJson(store).issues) : []);
const importRun = (root, file, store, extra = [], opts = {}) => start(['--project', root, '--host', 'laptop', '--prefix', 'vault', '--import-beads', file, ...extra], { ...opts, env: { BD_FAKE_STORE: store, ...(opts.env || {}) } });

test('import 1: a 3-issue export lands with the same ids, titles, statuses and dependencies', () => {
  const root = productRepo();
  const store = storeIn();
  const r = importRun(root, exportFile(), store);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /imported 3 issues/);
  const s = readJson(store);
  assert.deepEqual(Object.values(s.issues).map((x) => [x.id, x.title, x.status]).sort(), VAULT_ISSUES.map((x) => [x.id, x.title, x.status]).sort());
  assert.deepEqual(s.deps, [{ id: 'vault-b2', blocked_by: 'vault-a1' }]);
});

test('import 2: the same import again adds nothing and keeps an edit made in between', () => {
  const root = productRepo();
  const store = storeIn();
  const file = exportFile();
  assert.equal(importRun(root, file, store).status, 0);
  const s = readJson(store);
  s.issues['vault-b2'].title = 'Write the changelog (edited)';
  fs.writeFileSync(store, JSON.stringify(s));
  const r = importRun(root, file, store);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 new, 3 already present/);
  assert.doesNotMatch(r.out, /imported 3 issues/);
  assert.equal(issuesIn(store).length, 3);
  assert.equal(readJson(store).issues['vault-b2'].title, 'Write the changelog (edited)');
});

test('import 3: a wrong prefix, a missing file and a line that is not JSON are refused; nothing changes', () => {
  const root = productRepo();
  const store = storeIn();
  assert.equal(importRun(root, exportFile(), store).status, 0);
  const before = JSON.stringify(readJson(store));
  const bad = [
    [exportFile([...VAULT_ISSUES, { id: 'dlv-abc', title: 'Foreign', status: 'open' }]), /dlv-abc.*"dlv".*"vault"/],
    [path.join(os.tmpdir(), 'no-such-export.jsonl'), /no-such-export\.jsonl cannot be read \(no such file\)/],
    [exportFile([JSON.stringify(VAULT_ISSUES[0]), 'this is not json']), /line 2 of .* is not JSON/],
  ];
  for (const [file, words] of bad) {
    const r = importRun(root, file, store);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /import refused/);
    assert.match(r.out, words);
    assert.equal(JSON.stringify(readJson(store)), before);
  }
});

test('import 3: a refused import into a new project writes nothing at all, and mixed prefixes are refused', () => {
  const root = productRepo();
  const store = storeIn();
  const r = importRun(root, exportFile([VAULT_ISSUES[0], { id: 'dlv-abc', title: 'x' }, { id: 'zz-1', title: 'y' }]), store);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /\(2 lines do not match\)/);
  assert.equal(fs.existsSync(path.join(root, '.beads')), false);
  assert.equal(fs.existsSync(path.join(root, '.delivery')), false);
  assert.equal(fs.existsSync(store), false);
});

test('import 4: a second machine starting from a fresh clone finds the same 3 issues', () => {
  const { root, bare } = projectWithOrigin();
  const store = storeIn();
  const r = importRun(root, exportFile(), store);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /beads: issues published to the project repo/);
  cp.execFileSync(GIT, ['push', '-q', 'origin', 'HEAD:main'], { cwd: root });
  const clone = path.join(mk('start-clone-'), 'vault-planning');
  cp.execFileSync(GIT, ['clone', '-q', '-b', 'main', bare, clone]);
  fs.rmSync(path.join(clone, '.beads', 'fake-config.json'), { force: true }); // the database is never in git
  const store2 = storeIn();
  const r2 = start(['--project', clone, '--host', 'laptop'], { env: { BD_FAKE_STORE: store2 } });
  assert.equal(r2.status, 0, r2.out);
  assert.match(r2.out, /database fetched from the project repo/);
  assert.deepEqual(issuesIn(store2).map((x) => x.id).sort(), ['vault-a1', 'vault-b2', 'vault-c3']);
  assert.match(start(['--check', '--project', clone], { env: { BD_FAKE_STORE: store2 } }).out, /\[pass\] beads issues: 3 issues in /);
});

test('import 5: --check shows the issue count; 0 on a new project; no row without .beads', () => {
  const root = productRepo();
  const store = storeIn();
  assert.equal(start(['--project', root, '--host', 'laptop', '--prefix', 'vault'], { env: { BD_FAKE_STORE: store } }).status, 0);
  assert.match(start(['--check', '--project', root], { env: { BD_FAKE_STORE: store } }).out, /\[pass\] beads issues: 0 issues in .*\.beads/);
  assert.equal(importRun(root, exportFile(), store).status, 0);
  assert.match(start(['--check', '--project', root], { env: { BD_FAKE_STORE: store } }).out, /\[pass\] beads issues: 3 issues in .*\.beads/);
  assert.doesNotMatch(start(['--check', '--project', productRepo()]).out, /beads issues/);
});

test('import 6: --dry-run says what it would import and changes nothing', () => {
  const snapshot = (root) => JSON.stringify([
    cp.execFileSync('find', [root, '-not', '-path', '*/.git/*'], { encoding: 'utf8' }),
    cp.execFileSync(GIT, ['log', '--oneline'], { cwd: root, encoding: 'utf8' }),
    cp.execFileSync(GIT, ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
  ]);
  const root = productRepo();
  const store = storeIn();
  const before = snapshot(root);
  const r = importRun(root, exportFile(), store, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /would import 3 issues/);
  assert.equal(snapshot(root), before);
  assert.equal(fs.existsSync(store), false);
  // a refusal under --dry-run is the same refusal
  const refused = importRun(root, exportFile([{ id: 'dlv-abc', title: 'x' }]), store, ['--dry-run']);
  assert.equal(refused.status, 1, refused.out);
  assert.match(refused.out, /dlv-abc.*"dlv".*"vault"/);
  assert.equal(snapshot(root), before);
  // on an existing database it counts what is new and what is there
  assert.equal(importRun(root, exportFile(), store).status, 0);
  const again = importRun(root, exportFile(), store, ['--dry-run']);
  assert.match(again.out, /would import 0 new, 3 already present/);
});

test('import: an empty export imports 0 issues and succeeds; an issue the database already had is kept beside the new ones', () => {
  const root = productRepo();
  const store = storeIn();
  const empty = importRun(root, exportFile([]), store);
  assert.equal(empty.status, 0, empty.out);
  assert.match(empty.out, /imported 0 issues/);
  const s = fs.existsSync(store) ? readJson(store) : { issues: {}, deps: [] };
  s.issues['vault-own'] = { id: 'vault-own', title: 'Already here', status: 'open', type: 'task', labels: [], metadata: {}, notes: '', priority: 2, description: '', assignee: '' };
  fs.writeFileSync(store, JSON.stringify(s));
  const r = importRun(root, exportFile(), store);
  assert.match(r.out, /imported 3 issues/);
  assert.deepEqual(issuesIn(store).map((x) => x.id).sort(), ['vault-a1', 'vault-b2', 'vault-c3', 'vault-own']);
});

test('import: a publish refused with HTTP 403 keeps the import locally and prints the existing 403 message', () => {
  const { root } = projectWithOrigin();
  const store = storeIn();
  const r = importRun(root, exportFile(), store, [], { env: { BD_FAKE_PUSH: '403' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /imported 3 issues/);
  assert.match(r.out, /beads: publish refused \(HTTP 403\)/);
  assert.equal(issuesIn(store).length, 3);
});

test('import: without the beads tool on PATH the import is refused before anything is written', () => {
  const root = productRepo();
  const r = start(['--project', root, '--host', 'laptop', '--prefix', 'vault', '--import-beads', exportFile()], { path: bin({ bd: false }) });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /import refused: bd is not on PATH/);
  assert.equal(fs.existsSync(path.join(root, '.delivery')), false);
});

test('import: the product repo\'s own beads message names the flag', () => {
  const root = productRepo();
  const product = productRepo();
  fs.mkdirSync(path.join(product, '.beads'));
  const r = start(['--project', root, '--host', 'laptop', '--product-repo', product]);
  assert.match(r.out, /not imported and nothing waits on it.*--import-beads <file>/);
});
