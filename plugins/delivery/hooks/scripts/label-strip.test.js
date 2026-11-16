require('../../scripts/testing/role-env.js').clearRoleEnv();
// hooks/scripts/label-strip.test.js — m7y: bd 1.1.2 copies a parent's labels onto a child it creates, so a
// child of a merged and deployed bead was born state-merged and state-deployed with no pull request. After
// a `bd create --parent` the hook removes every state label the command did not ask for.
const test = require('node:test');
const assert = require('node:assert/strict');
const { check, parseCreate, createdId } = require('./label-strip.js');
const { memBd } = require('../../scripts/testing/gate-fixture.js');

const store = () => memBd([
  { id: 'ex-p', title: 'parent', status: 'closed', labels: ['plugin', 'story', 'state-merged', 'state-deployed'], metadata: { merged_pr: '200', deployed_sha: 'a'.repeat(40) } },
  // as bd 1.1.2 leaves a new child: the parent's labels, none of its record
  { id: 'ex-p.1', title: 'child', status: 'open', parent: 'ex-p', labels: ['plugin', 'story', 'state-merged', 'state-deployed'], metadata: {} },
]);
const run = (command, stdout, bd) => check({ tool_name: 'Bash', tool_input: { command }, tool_response: { stdout } }, { bd });

test('a bd create with a parent is read, with the labels it asked for; anything else is not', () => {
  assert.deepEqual(parseCreate('bd create "a fix" --parent ex-p --type bug'), { parent: 'ex-p', asked: [] });
  assert.deepEqual(parseCreate("cd x && bd create 'a fix' --parent=ex-p --labels bug,state-merged -l plugin"), { parent: 'ex-p', asked: ['bug', 'state-merged', 'plugin'] });
  assert.equal(parseCreate('bd create "top" --type task'), null, 'no parent');
  assert.equal(parseCreate('bd update ex-p.1 --parent ex-p'), null, 'not a create');
  assert.equal(parseCreate('echo bd create --parent ex-p'.replace('echo ', 'echo x; ')).parent, 'ex-p');
  assert.equal(createdId({ stdout: '✓ Created issue: ex-p.1 — a fix\n' }), 'ex-p.1');
  assert.equal(createdId({ stdout: '{"id": "ex-p.1", "title": "a fix"}' }), 'ex-p.1');
  assert.equal(createdId({ stdout: 'ex-p.1\n' }), 'ex-p.1', '--silent');
  assert.equal(createdId({ stdout: '' }), null);
});

test('after bd create --parent, the state labels bd copied come off the new child, and the session is told', () => {
  const bd = store();
  const r = run('bd create "a fix" --parent ex-p --type bug', '✓ Created issue: ex-p.1 — a fix', bd);
  assert.match(r.context, /^Removed state-merged, state-deployed from ex-p\.1: bd copied them from its parent ex-p\./);
  assert.deepEqual(bd.show('ex-p.1').labels, ['plugin', 'story'], 'the other labels stay');
  assert.deepEqual(bd.show('ex-p').labels, ['plugin', 'story', 'state-merged', 'state-deployed'], 'the parent is untouched');
});

test('the other direction: a state label the command asked for stays, and a create with no parent or nothing copied changes nothing', () => {
  const bd = store();
  assert.equal(run('bd create "a fix" --parent ex-p --labels state-merged', 'ex-p.1', bd).context, 'Removed state-deployed from ex-p.1: bd copied them from its parent ex-p. A bead is merged or deployed only by its own record (evidence.js state ex-p.1 merged --pr <n>, or deployed --sha <sha>).');
  assert.deepEqual(bd.show('ex-p.1').labels, ['plugin', 'story', 'state-merged']);
  const bd2 = store();
  assert.equal(run('bd create "top" --type task', 'ex-p.1', bd2), null, 'no parent: not this hook\'s');
  assert.deepEqual(bd2.show('ex-p.1').labels, ['plugin', 'story', 'state-merged', 'state-deployed']);
  assert.equal(run('bd create "x" --parent ex-p', '', bd2), null, 'no id printed: nothing to strip');
  const bd3 = store();
  bd3.update('ex-p.1', { removeLabels: ['state-merged', 'state-deployed'] });
  assert.equal(run('bd create "a fix" --parent ex-p', 'ex-p.1', bd3), null, 'nothing copied');
  assert.equal(check({ tool_name: 'Write', tool_input: {} }), null);
});
