require('./testing/role-env.js').clearRoleEnv();
// scripts/refine-dry-run.test.js — 8l1.4.1.2: refine checks each new check command without running it
// (its lane runs no product code), refuses a command whose test files are not under the plugin root
// unless --unchecked gives the reason, and warns on a trailing pipe. The run-time checks (no test found)
// are verify-run.js's, in verify-run.test.js. The andons this answers (ev-delivery-plugin-planning-8l1.4.1-1..3)
// came from commands saved without ever being checked.
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

test('rv-217 F1 F2: no test found is judged only for a command that runs tests, and a missing test file counts', () => {
  const runner = `${files(under(BD_TEST))} node ${under('scripts/testing/run-tests.js')}`;
  assert.equal(CC.zeroTests(runner, '# tests 0\n# pass 0'), true);
  assert.equal(CC.zeroTests(runner, 'Could not find \'/x/a.test.js\''), true, 'F1: node found no file');
  assert.equal(CC.zeroTests(runner, 'Error: no test files found'), true);
  assert.equal(CC.zeroTests('node --test scripts', '# tests 0'), true, 'node --test is a test run too');
  assert.equal(CC.zeroTests(runner, '# tests 12\n# pass 12'), false);
  // F2: any other command may print the same words
  assert.equal(CC.zeroTests('echo "# tests 0"', '# tests 0'), false);
  assert.equal(CC.zeroTests('grep -c "Could not find" log', 'Could not find'), false);
});

test('refine checks a command without running it: a good one is saved with no warning, a trailing pipe is warned', () => {
  const { root, dm, step } = setup();
  const marker = path.join(root, 'ran');
  // refine runs nothing: a command that would write a file leaves no file
  const r = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', `touch ${marker}`, '--match', 'x');
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.existsSync(marker), false, 'the command did not run');
  assert.doesNotMatch(r.out, /warning|ran it/);
  assert.equal(step().command, `touch ${marker}`);
  assert.equal(step().unchecked, undefined);
  const pipe = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo ok | tail -1');
  assert.match(pipe.out, /warning: criterion 1 step 1: the command ends in a pipe/);
});

test('refine refuses a command whose test files are not under the plugin root, and saves nothing', () => {
  const { dm, script } = setup();
  const before = JSON.stringify(script());
  const andon = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', `${files(`checkout/${BD_TEST}`)} node scripts/testing/run-tests.js`, '--match', 'pass');
  assert.equal(andon.code, 1);
  assert.match(andon.out, /^reality-check\.js: criterion 1 step 1: checkout\/scripts\/lib\/bd\.test\.js is relative and no cd before it names where it runs/);
  assert.match(andon.out, /\nFix the command, or save it as it is with --unchecked '<why it cannot be checked here>'$/);
  assert.equal(JSON.stringify(script()), before, 'nothing saved');
});

test('--unchecked saves a refused command with its reason, and a later clean refine clears it', () => {
  const { dm, step } = setup();
  const bad = `${files(under('scripts/gone.test.js'))} node x`;
  assert.match(dm('refine', ID, '--criterion', '1', '--step', '1', '--command', bad, '--unchecked', '  ').out, /--unchecked needs the reason/);
  const r = dm('refine', ID, '--criterion', '1', '--step', '1', '--command', bad, '--unchecked', 'the test it runs ships with this deploy');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /saved unchecked \(the test it runs ships with this deploy\): criterion 1 step 1: \$\{DELIVERY_PLUGIN_ROOT\}\/scripts\/gone\.test\.js is not a file under the plugin root/);
  assert.equal(step().unchecked, 'the test it runs ships with this deploy');
  assert.equal(dm('refine', ID, '--criterion', '1', '--step', '1', '--command', 'echo fine').code, 0);
  assert.equal(step().unchecked, undefined);
});

test('refine --from checks every command before it applies any, and --unchecked marks only the steps that had a problem (rv-217 F3)', () => {
  const { root, dm, script, step } = setup();
  const write = (body) => { const f = path.join(root, 'commands.json'); fs.writeFileSync(f, JSON.stringify(body)); return f; };
  const before = JSON.stringify(script());
  const bad = { 1: { command: 'echo fine', match: 'fine' }, 2: { command: `${files(under('scripts/gone.test.js'))} node x`, match: 'x' } };
  const r = dm('refine', ID, '--from', write(bad));
  assert.equal(r.code, 1);
  assert.match(r.out, /criterion 2 step 1: \$\{DELIVERY_PLUGIN_ROOT\}\/scripts\/gone\.test\.js is not a file under the plugin root/);
  assert.equal(JSON.stringify(script()), before, 'criterion 1 is not applied either');
  const forced = dm('refine', ID, '--from', write(bad), '--unchecked', 'criterion 2 ships its test with this deploy');
  assert.equal(forced.code, 0, forced.out);
  assert.equal(step(2).unchecked, 'criterion 2 ships its test with this deploy');
  assert.equal(step(1).unchecked, undefined, 'the clean step is not marked');
});
