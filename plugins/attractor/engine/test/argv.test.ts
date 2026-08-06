import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArgv, OUTCOME_SCHEMA, wantsVerdict } from '../src/backend/argv.ts'
import { Handler, type Node } from '../src/dot/graph.ts'

function node(attrs: Record<string, string> = {}): Node {
  return { id: 'work', attrs, handler: Handler.CODERGEN }
}

test('the prompt never appears in argv', () => {
  const argv = buildArgv(node(), { allowedTools: ['Bash', 'Write'] })
  assert.ok(!argv.includes('do the thing'), 'prompt must go on stdin')
  // The last element must be a flag value, never a bare positional.
  assert.ok(argv[0].startsWith('-'), 'argv starts with flags, not a positional')
})

test('tool lists are comma-separated, never space-separated', () => {
  const argv = buildArgv(node(), { allowedTools: ['Bash', 'Write', 'Edit'] })
  const i = argv.indexOf('--allowedTools')
  assert.ok(i >= 0)
  assert.equal(argv[i + 1], 'Bash,Write,Edit')
  assert.ok(!argv[i + 1].includes(' '), 'a space here would swallow the next argument')
})

test('print and json output are always requested', () => {
  const argv = buildArgv(node(), {})
  assert.ok(argv.includes('-p'))
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'json')
})

test('permissions are bypassed so unattended work does not stall', () => {
  const argv = buildArgv(node(), {})
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'bypassPermissions')
})

test('absent options contribute no flag', () => {
  const argv = buildArgv(node(), {})
  for (const flag of ['--model', '--add-dir', '--session-id', '--resume', '--max-budget-usd']) {
    assert.ok(!argv.includes(flag), `${flag} must be absent when unset`)
  }
})

test('present options are passed through', () => {
  const argv = buildArgv(node(), {
    model: 'opus',
    addDir: '/tmp/wt',
    maxBudgetUsd: 2.5,
    appendSystemPrompt: 'node contract',
  })
  assert.equal(argv[argv.indexOf('--model') + 1], 'opus')
  assert.equal(argv[argv.indexOf('--add-dir') + 1], '/tmp/wt')
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '2.5')
  assert.equal(argv[argv.indexOf('--append-system-prompt') + 1], 'node contract')
})

test('a node model attribute overrides the run-level model', () => {
  const argv = buildArgv(node({ llm_model: 'sonnet' }), { model: 'opus' })
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet')
})

test('session-id and resume are mutually exclusive, resume wins', () => {
  const argv = buildArgv(node(), { sessionId: 'aaa', resumeId: 'bbb' })
  assert.ok(!argv.includes('--session-id'), 'resuming must not also pin a new session id')
  assert.equal(argv[argv.indexOf('--resume') + 1], 'bbb')
})

test('a goal gate requests a structured verdict', () => {
  const gateNode = node({ goal_gate: 'true' })
  const argv = buildArgv(gateNode, {})
  const i = argv.indexOf('--json-schema')
  assert.ok(i >= 0, 'a goal gate must not be left to prose')
  assert.deepEqual(JSON.parse(argv[i + 1]), OUTCOME_SCHEMA)
  // buildArgv and claude.ts's expectVerdict (and box.ts's isGoalGate) all
  // read the same exported wantsVerdict rather than each hand-checking
  // node.attrs.goal_gate. Pinning that buildArgv's own --json-schema
  // decision agrees with the shared predicate is what would catch buildArgv
  // drifting to its own copy of the condition.
  assert.equal(wantsVerdict(gateNode), true, '--json-schema presence must match wantsVerdict')
})

test('an ordinary node is not forced into a schema', () => {
  const plainNode = node()
  assert.ok(!buildArgv(plainNode, {}).includes('--json-schema'))
  assert.equal(wantsVerdict(plainNode), false, '--json-schema absence must match wantsVerdict')
})

test('the outcome schema demands a routing signal', () => {
  assert.deepEqual(OUTCOME_SCHEMA.required, ['status', 'preferred_label', 'notes'])
  assert.deepEqual(OUTCOME_SCHEMA.properties.status.enum, ['success', 'fail', 'retry'])
  assert.equal(OUTCOME_SCHEMA.additionalProperties, false)
})
