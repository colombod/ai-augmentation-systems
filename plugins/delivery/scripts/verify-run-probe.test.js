// scripts/verify-run-probe.test.js — the Reality Checker's runner for an external-host spike: a step file
// committed in the project repository, run on the host with no story, script or deploy, its capture saved
// and accepted by assumptions.js probe; every other role refused, here and in assumptions.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('./lib/assumptions.js');
const G = require('./lib/gates.js');
const { loadManifest } = require('./lib/manifest.js');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const vr = require('./verify-run.js');
const assumptions = require('./assumptions.js');

const SPIKE = 'ex-vault-spike-a-8';
const NOW = '2026-11-02T10:00:00Z';
const STEP = path.join('.delivery', 'spikes', 'a-8-step.txt');
const row = (id, kind) => `| ${id} | The host hands the tool a download link | ${kind} | vault-0n9-3#1 | assumed |  | PM |`;
const register = (...rows) => `# Assumptions: vault\n\n## Register\n\n${A.HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n${rows.join('\n')}\n`;
// a step that documents its exit codes in a comment, as a real one may
const stepText = (code) => `# Exit 0 = done; 2 = needs a login (owner step); 1 = other failure.\necho "host said: link"; echo "warn" >&2; exit ${code}\n`;

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// a project repository with a register and a spike that has no story file (materialise's spike shape)
function setup() {
  const root = makeProject();
  fs.writeFileSync(A.fileOf(root, 'vault'), register(row('A-8', 'external-host'), row('A-10', 'internal')));
  git(root, 'init', '-q', '-b', 'main');
  const commitStep = (text) => {
    fs.mkdirSync(path.join(root, path.dirname(STEP)), { recursive: true });
    fs.writeFileSync(path.join(root, STEP), text);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'step');
    return git(root, 'rev-parse', 'HEAD');
  };
  const commit = commitStep(stepText(0));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrp-role-'));
  const spike = { id: SPIKE, title: 'Spike A-8', status: 'open', assignee: 't@pc/builder-1', labels: ['spike'], metadata: { assumption: 'A-8', roadmap_ref: 'vault/roadmap.md@abc1234 phase 1' } };
  const bd = memBd([spike, storyBead(), { ...spike, id: 'ex-vault-spike-a-10', metadata: { ...spike.metadata, assumption: 'A-10' } }]);
  const team = loadManifest(root).team;
  const who = (instance) => ({ root, team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `t@pc/${instance}`, roleDir });
  const probe = (argv, { instance = 'reality-checker', spawn } = {}) => vr.main(['probe', ...argv], { cwd: root, env: {}, bd, now: NOW, who: who(instance), ...(spawn ? { spawn } : {}) });
  const record = (instance, file) => assumptions.main(['probe', SPIKE, '--host', 'this host', '--observed', 'a download link', '--artifact', file], { cwd: root, env: {}, bd, now: NOW, who: who(instance) });
  const captures = () => { const d = path.join(roleDir, 'project', '.delivery', 'evidence', 'artifacts', SPIKE); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
  return { root, roleDir, bd, commit, commitStep, probe, record, captures };
}

test('probe: a spike with no story file runs its committed step; the capture names the commit and blob, and assumptions.js probe accepts it', () => {
  const s = setup();
  assert.equal(s.bd.show(SPIKE).metadata.story_file, undefined);
  const r = s.probe([SPIKE, '--step', STEP]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /: exit 0 \(the step says: done\)/);
  assert.doesNotMatch(r.out, /owner step: message/);
  const cap = fs.readFileSync(r.file, 'utf8');
  const blob = git(s.root, 'rev-parse', `HEAD:${STEP}`);
  assert.match(cap, new RegExp(`project commit: ${s.commit}`));
  assert.match(cap, new RegExp(`step blob: ${blob}`));
  assert.match(cap, /--- stdout ---\nhost said: link/);
  assert.match(cap, /--- stderr ---\nwarn/);
  assert.match(cap, /--- exit 0 after \d+s ---/);
  assert.match(cap, new RegExp(`at: ${NOW}`));
  assert.ok(r.file.startsWith(path.join(s.roleDir, 'project', '.delivery', 'evidence', 'artifacts', SPIKE) + path.sep));
  // the printed next command is the one that records the row, and it does
  const next = /Next: node (\S+assumptions\.js) probe (\S+) .* --artifact (\S+)$/m.exec(r.out);
  assert.ok(next, r.out);
  assert.equal(next[1], path.join(__dirname, 'assumptions.js'));
  assert.deepEqual([next[2], next[3]], [SPIKE, r.file]);
  const rec = s.record('reality-checker', next[3]);
  assert.equal(rec.code, 0, rec.out);
  assert.equal(rec.row.type, 'probe');
  assert.equal(rec.row.assumption, 'A-8');
  assert.equal(G.readEvidence(s.root, SPIKE).filter((x) => x.type === 'probe').length, 1);
});

test('probe: the step runs in a fresh temporary directory, never the project, and the directory is removed', () => {
  const s = setup();
  s.commitStep('pwd\n');
  const r = s.probe([SPIKE, '--step', STEP]);
  assert.equal(r.code, 0, r.out);
  const ran = /--- stdout ---\n(.*)\n/.exec(fs.readFileSync(r.file, 'utf8'))[1];
  assert.ok(!ran.startsWith(s.root) && !ran.startsWith(fs.realpathSync(s.root)), ran);
  assert.match(path.basename(ran), /^probe-/);
  assert.equal(fs.existsSync(ran), false);
});

test('probe: a failing step still saves its capture with the exit code; exit 2 says the host needs an owner step', () => {
  const s = setup();
  s.commitStep(stepText(1));
  const one = s.probe([SPIKE, '--step', STEP]);
  assert.equal(one.code, 0, one.out);
  assert.match(one.out, /: exit 1 \(the step says: other failure\)/);
  assert.doesNotMatch(one.out, /owner step: message/);
  assert.match(fs.readFileSync(one.file, 'utf8'), /--- exit 1 after/);
  s.commitStep(stepText(2));
  const two = s.probe([SPIKE, '--step', STEP]);
  assert.match(two.out, /: exit 2 \(the step says: needs a login \(owner step\)\)\nthe host needs an owner step: message the Delivery Manager/);
  assert.match(fs.readFileSync(two.file, 'utf8'), /--- exit 2 after/);
  // a step that documents nothing: the code alone
  s.commitStep('exit 3\n');
  assert.match(s.probe([SPIKE, '--step', STEP]).out, /: exit 3\n/);
  assert.equal(s.captures().length, 3);
});

test('probe: the timeout stops the step after the given minutes (15 by default) and is still a capture', () => {
  const s = setup();
  const seen = [];
  const spawn = (cmd, args, opts) => { if (cmd !== '/bin/sh') return spawnSync(cmd, args, opts); seen.push(opts.timeout); return { status: null, error: { code: 'ETIMEDOUT' }, stdout: 'half', stderr: '' }; };
  const r = s.probe([SPIKE, '--step', STEP], { spawn });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /: stopped after 15 minutes/);
  assert.match(fs.readFileSync(r.file, 'utf8'), /result: stopped after 15 minutes[\s\S]*--- exit signal after/);
  assert.match(s.probe([SPIKE, '--step', STEP, '--minutes', '2'], { spawn }).out, /stopped after 2 minutes/);
  assert.deepEqual(seen, [15 * 60e3, 2 * 60e3]);
  assert.equal(s.probe([SPIKE, '--step', STEP, '--minutes', '0'], { spawn }).code, 2);
});

test('probe: only the Reality Checker runs it; the builder, the Delivery Manager and the Spike Researcher are refused and nothing runs', () => {
  const s = setup();
  let ran = 0;
  const spawn = (...a) => { ran++; return spawnSync(...a); };
  for (const instance of ['builder-1', 'delivery-lead', 'spike-researcher']) {
    const r = s.probe([SPIKE, '--step', STEP], { instance, spawn });
    assert.equal(r.code, 1, instance);
    assert.match(r.out, /this session is/);
  }
  assert.equal(ran, 0);
  assert.equal(s.captures().length, 0);
  // and assumptions.js still refuses any other role's external-host probe, a builder holding the spike included
  const cap = s.probe([SPIKE, '--step', STEP]).file;
  for (const instance of ['builder-1', 'spike-researcher']) {
    const r = s.record(instance, cap);
    assert.equal(r.code, 1, instance);
    assert.match(r.out, /A-8 is about an external host/);
  }
  assert.equal(G.readEvidence(s.root, SPIKE).filter((x) => x.type === 'probe').length, 0);
});

test('probe: an untracked, modified or staged step file is refused, and nothing runs', () => {
  const s = setup();
  let ran = 0;
  const spawn = (cmd, ...a) => { if (cmd === '/bin/sh') ran++; return spawnSync(cmd, ...a); };
  const other = path.join('.delivery', 'spikes', 'new-step.txt');
  fs.writeFileSync(path.join(s.root, other), 'echo new\n');
  assert.match(s.probe([SPIKE, '--step', other], { spawn }).out, /new-step\.txt is not committed in the project repository/);
  fs.writeFileSync(path.join(s.root, STEP), 'echo changed\n');
  assert.match(s.probe([SPIKE, '--step', STEP], { spawn }).out, /differs from its committed text/);
  git(s.root, 'add', STEP);
  assert.match(s.probe([SPIKE, '--step', STEP], { spawn }).out, /differs from its committed text/);
  assert.match(s.probe([SPIKE, '--step', path.join('..', 'x.txt')], { spawn }).out, /relative to its root/);
  assert.equal(ran, 0);
  assert.equal(s.captures().length, 0);
});

test('probe: a story bead, a spike on an assumption that is not about an external host, and run-shaped arguments are refused', () => {
  const s = setup();
  const story = s.probe(['ex-vault-0n9-3', '--step', STEP]);
  assert.equal(story.code, 1);
  assert.match(story.out, /is not a spike bead: a story is checked with verify-run\.js run/);
  const internal = s.probe(['ex-vault-spike-a-10', '--step', STEP]);
  assert.equal(internal.code, 1);
  assert.match(internal.out, /no external-host assumption in its register \(A-10 is internal\)/);
  assert.equal(s.probe([SPIKE]).code, 2);
  assert.equal(s.probe([SPIKE, '--step', STEP, '--criterion', '1']).code, 2);
  assert.equal(vr.main(['run', SPIKE, '--criterion', '1', '--step', STEP], { cwd: s.root, env: {}, who: { root: s.root, roleId: 'reality-checker' } }).code, 2);
  assert.equal(s.captures().length, 0);
});

// the builder's and the Spike Researcher's lanes run any command, so for them the script's own role check
// (the refusal test above) is the guard; a lane with groups admits probe only through verify-run
test('lane: the Reality Checker may run verify-run.js probe; the Delivery Manager and the Product Manager may not', () => {
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const PLUGIN_ROOT = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrp-lane-'));
  const bash = (role, command) => decideLane({ toolName: 'Bash', toolInput: { command }, policy: loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: `delivery/${role}` }), roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false }).allow;
  const cmd = `node ${PLUGIN_ROOT}/scripts/verify-run.js probe ${SPIKE} --step ${STEP}`;
  assert.equal(bash('reality-checker', cmd), true);
  for (const role of ['delivery-lead', 'product-manager']) assert.equal(bash(role, cmd), false, role);
});
