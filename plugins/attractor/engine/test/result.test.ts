import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretResult } from '../src/backend/result.ts'
import { Status } from '../src/core/outcome.ts'

function raw(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    is_error: false,
    result: 'did the thing',
    session_id: 'sess-1',
    total_cost_usd: 0.027,
    num_turns: 3,
    stop_reason: 'tool_use',
    subtype: 'success',
    ...over,
  })
}

test('success is decided by is_error, never by stop_reason', () => {
  // stop_reason reads tool_use even on a fully successful run.
  const { outcome } = interpretResult(raw({ stop_reason: 'tool_use' }))
  assert.equal(outcome.status, Status.SUCCESS)
})

test('is_error true fails the node', () => {
  const { outcome } = interpretResult(raw({ is_error: true, result: 'boom' }))
  assert.equal(outcome.status, Status.FAIL)
})

test('a structured verdict governs status and routing, when a verdict was requested', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'retry', preferred_label: 'iterate', notes: 'not yet' }) }),
    { expectVerdict: true },
  )
  assert.equal(outcome.status, Status.RETRY)
  assert.equal(outcome.preferredLabel, 'iterate')
  assert.equal(outcome.notes, 'not yet')
})

test('a structured verdict of fail is honoured, when a verdict was requested', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'fail', preferred_label: 'abort', notes: 'broken' }) }),
    { expectVerdict: true },
  )
  assert.equal(outcome.status, Status.FAIL)
})

test('a goal gate returning a proper verdict works exactly as before', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'success', preferred_label: 'ship', notes: 'all pass' }) }),
    { expectVerdict: true },
  )
  assert.equal(outcome.status, Status.SUCCESS)
  assert.equal(outcome.preferredLabel, 'ship')
  assert.equal(outcome.notes, 'all pass')
})

test('a work node that did not request a verdict keeps a JSON-shaped answer as its output', () => {
  // The reviewer's scenario: a box node asked to emit a JSON status report
  // returns {"status":"complete","files":3}. Without expectVerdict, this
  // must NOT be read as a routing verdict -- STATUS_BY_NAME has no
  // "complete" entry, so misreading it would map the node to FAIL despite
  // is_error: false and discard the node's real output.
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'complete', files: 3 }) }),
  )
  assert.equal(outcome.status, Status.SUCCESS, 'is_error alone decides status for a non-gate node')
  assert.equal(outcome.notes, JSON.stringify({ status: 'complete', files: 3 }))
})

test('a work node returning a preferred_label gets no routing signal', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'success', preferred_label: 'sneaky', notes: 'hi' }) }),
  )
  assert.equal(outcome.preferredLabel, undefined, 'an unrequested schema field must not route')
})

test('notes is undefined, not an empty string, when there is no text and no denial', () => {
  const { outcome } = interpretResult(raw({ result: '' }))
  assert.equal(outcome.notes, undefined)
})

test('prose produces NO routing signal so a goal gate can fail closed', () => {
  const { outcome } = interpretResult(
    raw({ result: 'NOT CONVERGED - 2 of 7 criteria pass' }),
    { expectVerdict: true },
  )
  assert.equal(outcome.preferredLabel, undefined, 'prose must not look like a verdict')
  assert.equal(outcome.contextUpdates, undefined)
  assert.equal(outcome.notes, 'NOT CONVERGED - 2 of 7 criteria pass')
})

test('cost and turns are recorded even on failure', () => {
  const { outcome } = interpretResult(raw({ is_error: true, total_cost_usd: 0.5, num_turns: 9 }))
  assert.equal(outcome.metrics?.costUsd, 0.5)
  assert.equal(outcome.metrics?.turns, 9)
})

test('the session id is returned for thread continuity', () => {
  assert.equal(interpretResult(raw()).sessionId, 'sess-1')
})

test('unparseable output fails rather than throwing', () => {
  const { outcome } = interpretResult('not json at all')
  assert.equal(outcome.status, Status.FAIL)
  assert.match(outcome.notes ?? '', /could not parse/i)
})

test('a truncated result object fails rather than throwing', () => {
  const { outcome } = interpretResult('{"is_error":fal')
  assert.equal(outcome.status, Status.FAIL)
})

test('an empty result string fails rather than reporting success', () => {
  const { outcome } = interpretResult('')
  assert.equal(outcome.status, Status.FAIL)
})

test('a top-level JSON array fails rather than reporting empty success', () => {
  // typeof [] === 'object', so a naive object check lets an array through,
  // every field reads undefined, and the result looks like a silent success.
  const { outcome } = interpretResult('[1,2,3]')
  assert.equal(outcome.status, Status.FAIL)
  assert.match(outcome.notes ?? '', /could not parse/i)
})

test('valid JSON that is not an object at all fails', () => {
  for (const raw of ['42', '"a string"', 'null', 'true']) {
    assert.equal(interpretResult(raw).outcome.status, Status.FAIL, `${raw} must fail`)
  }
})

test('permission denials surface in the notes', () => {
  const { outcome } = interpretResult(
    raw({ is_error: true, permission_denials: [{ tool_name: 'Bash' }] }),
  )
  assert.match(outcome.notes ?? '', /permission/i)
})

test('a structured verdict with an unknown status falls back to fail', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'banana', preferred_label: 'x', notes: 'y' }) }),
    { expectVerdict: true },
  )
  assert.equal(outcome.status, Status.FAIL)
})
