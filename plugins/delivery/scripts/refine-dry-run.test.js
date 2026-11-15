require('./testing/role-env.js').clearRoleEnv();
// scripts/refine-dry-run.test.js — 8l1.4.1.2: refine runs each new check command once on the installed
// plugin, prints what it saw, and refuses a command whose test files are not under the plugin root or
// whose test run finds no tests, unless --unchecked gives the reason. The andons it answers
// (ev-delivery-plugin-planning-8l1.4.1-1..3) came from commands saved without ever running.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadManifest } = require('./lib/manifest.js');
const { makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const rc = require('./reality-check.js');
const CC = require('./lib/check-command.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const ID = 'ex-vault-0n9-3';
const T = '2026-10-13T08:00:00Z';
// a file of this plugin as a command names it, version-free
const under = (rel) => ['${', 'DELIVERY_PLUGIN_ROOT', '}/', rel].join('');
// a command that sets the sealed runner's file list
const files = (...paths) => `DELIVERY_TEST_FILES=${paths.join(':')}`;
const BD_TEST = 'scripts/lib/bd.test.js';

function setup() {
  const root = makeProject();
  const bd = memBd([storyBead({ assignee: 't@pc/builder-1' })]);
  const who = { root, team: loadManifest(root).team, instance: 'delivery-lead', roleId: 'delivery-lead', actor: 't@pc/delivery-lead' };
  const dm = (...argv) => rc.main(argv, { cwd: root, env: { PATH: process.env.PATH, DELIVERY_ROLE: 'delivery-lead' }, bd, now: T, who });
  assert.equal(dm('plan', ID).code, 0);
  const script = () => JSON.parse(fs.readFileSync(path.join(root, rc.scriptRel(ID)), 'utf8'));
  const step = (n = 1) => script().criteria.find((g) => g.criterion === n).steps[0];
  return { root, dm, script, step };
}

test('test file paths: a file under the plugin root passes; a missing, outside, relative or unreadable path is named', () => {
  const p = (cmd) => CC.testFileProblems(cmd, PLUGIN_ROOT);
  assert.deepEqual(p(`${files(under(BD_TEST))} node x`), []);
  // the $VAR form, quoted, with two files
  assert.deepEqual(p(`${files(`"$DELIVERY_PLUGIN_ROOT/${BD_TEST}`, `${under('scripts/reality-check.test.js')}"`)} node x`), []);
  assert.deepEqual(p(`cd "${under('').slice(0, -1)}" && ${files(BD_TEST)} node x`), [], 'relative after a cd into the plugin');
  // the andon's form: a path that exists only under the plugin root, given relative to nowhere
  assert.match(p(`${files(`checkout/${BD_TEST}`)} node x`).join(), /is relative and no cd before it names where it runs.*name it \$\{DELIVERY_PLUGIN_ROOT\}\/checkout\/scripts\/lib\/bd\.test\.js/);
  assert.match(p(`${files(under('scripts/lib/nope.test.js'))} node x`).join(), /scripts\/lib\/nope\.test\.js is not a file under the plugin root/);
  assert.match(p(`${files('/etc/hosts')} node x`).join(), /\/etc\/hosts is not under the plugin root/);
  assert.match(p(`${files(under('scripts/../../outside.test.js'))} node x`).join(), /is not under the plugin root/);
  assert.match(p(`${files('$HOME/x.test.js')} node x`).join(), /names a variable other than/);
  assert.match(p(`cd /tmp && ${files(BD_TEST)} node x`).join(), /is not under the plugin root/, 'a cd elsewhere');
  assert.equal(p(`${files(under(BD_TEST), under('scripts/gone.test.js'))} node x`).length, 1, 'one bad path of two');
  assert.deepEqual(p('echo no test files here'), []);
});

test('a command that ends in a pipe is told apart from one that only holds a pipe', () => {
  assert.equal(CC.endsInPipe('node x | tail -12'), true);
  assert.equal(CC.endsInPipe('a && b | grep ok'), true);
  assert.equal(CC.endsInPipe('a | b; c'), false);
  assert.equal(CC.endsInPipe('a | b && c'), false);
  assert.equal(CC.endsInPipe('a || b'), false);
  assert.equal(CC.endsInPipe("echo 'x | y'"), false);
  assert.equal(CC.endsInPipe('echo "x | y"'), false);
  assert.equal(CC.endsInPipe('node x'), false);
});

test('the dry run runs in a scratch directory of its own, removed after, with the role cleared and the plugin root named, under a time cap', () => {
  const r = CC.dryRun('pwd; echo "root=$DELIVERY_PLUGIN_ROOT role=${DELIVERY_ROLE:-none}"', 'root=', { pluginRoot: PLUGIN_ROOT, env: { PATH: process.env.PATH, DELIVERY_ROLE: 'delivery-lead' } });
  assert.equal(r.code, 0);
  assert.equal(r.matched, true);
  assert.equal(r.tail[1], `root=${PLUGIN_ROOT} role=none`);
  assert.notEqual(r.tail[0], process.cwd());
  assert.equal(fs.existsSync(r.tail[0]), false, 'the scratch directory is gone');
  // inside the sealed runner: its temporary directory is the run's own, never the host's /tmp
  assert.match(CC.dryRun('echo "tmp=$TMPDIR"', null, { pluginRoot: PLUGIN_ROOT }).tail.join(), /^tmp=\/tmp\/delivery-tests-\w+$/);
  const slow = CC.dryRun('sleep 5', null, { pluginRoot: PLUGIN_ROOT, minutes: 0.005 });
  assert.equal(slow.timedOut, true);
  assert.match(slow.warnings.join(), /did not finish within/);
  const zero = CC.dryRun('echo "# tests 0"; echo "# pass 0"', null, { pluginRoot: PLUGIN_ROOT });
  assert.match(zero.problems.join(), /reports zero tests/);
  assert.deepEqual(CC.dryRun('echo "# tests 12"', null, { pluginRoot: PLUGIN_ROOT }).problems, []);
});

test('refine --command runs the command once and prints its last lines and whether the match holds', () => {
  const { dm, step } = setup();
  const r = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo one; echo "root=$DELIVERY_PLUGIN_ROOT"', '--match', 'root=/');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /criterion 1 step 1: ran it once on the installed plugin: exit 0, match \/root=\/\/ holds; last lines:\n {2}\| one\n {2}\| root=\//);
  assert.equal(step().command, 'echo one; echo "root=$DELIVERY_PLUGIN_ROOT"');
  assert.equal(step().unchecked, undefined);
  // what it cannot refuse, it says: a match that does not hold, a failing exit, a trailing pipe
  const w = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo nope | tail -1; exit 3', '--match', 'yes');
  assert.equal(w.code, 0, w.out);
  assert.match(w.out, /warning: it exits 3 on the installed plugin/);
  assert.match(w.out, /warning: its output on the installed plugin does not match \/yes\//);
  const pipe = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo ok | tail -1');
  assert.match(pipe.out, /warning: the command ends in a pipe/);
});

test('refine refuses a command whose test files are not under the plugin root, or whose run finds no tests, and saves nothing', () => {
  const { dm, script } = setup();
  const before = JSON.stringify(script());
  const andon = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', `${files(`checkout/${BD_TEST}`)} node scripts/testing/run-tests.js`, '--match', 'pass');
  assert.equal(andon.code, 1);
  assert.match(andon.out, /^reality-check\.js: criterion 1 step 1: checkout\/scripts\/lib\/bd\.test\.js is relative and no cd before it names where it runs/);
  assert.match(andon.out, /\nFix the command, or save it as it is with --unchecked '<why it cannot be checked here>'$/);
  const zero = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo "# tests 0"');
  assert.equal(zero.code, 1);
  assert.match(zero.out, /reports zero tests/);
  assert.equal(JSON.stringify(script()), before, 'nothing saved');
});

test('--unchecked saves a refused command with its reason, and a later checked refine clears it', () => {
  const { dm, step } = setup();
  assert.match(dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo "# tests 0"', '--unchecked', '  ').out, /--unchecked needs the reason/);
  const r = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo "# tests 0"', '--unchecked', 'the tests it runs ship with this deploy');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /saved unchecked \(the tests it runs ship with this deploy\): criterion 1 step 1: the test run it starts reports zero tests/);
  assert.equal(step().unchecked, 'the tests it runs ship with this deploy');
  assert.equal(dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo "# tests 3"').code, 0);
  assert.equal(step().unchecked, undefined);
});

test('refine --from checks every command before it applies any', () => {
  const { root, dm, script, step } = setup();
  const write = (body) => { const f = path.join(root, 'commands.json'); fs.writeFileSync(f, JSON.stringify(body)); return f; };
  const before = JSON.stringify(script());
  const bad = { 1: { command: 'echo fine', match: 'fine' }, 2: { command: `${files(under('scripts/gone.test.js'))} node x`, match: 'x' } };
  const r = dm('refine', ID, '--from', write(bad));
  assert.equal(r.code, 1);
  assert.match(r.out, /criterion 2 step 1: \$\{DELIVERY_PLUGIN_ROOT\}\/scripts\/gone\.test\.js is not a file under the plugin root/);
  assert.equal(JSON.stringify(script()), before, 'criterion 1 is not applied either');
  const ok = dm('refine', ID, '--from', write({ 1: { command: 'echo fine', match: 'fine' } }));
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /criterion 1 step 1: ran it once on the installed plugin: exit 0, match \/fine\/ holds/);
  const forced = dm('refine', ID, '--from', write(bad), '--unchecked', 'criterion 2 ships its test with this deploy');
  assert.equal(forced.code, 0, forced.out);
  assert.equal(step(2).unchecked, 'criterion 2 ships its test with this deploy');
});
