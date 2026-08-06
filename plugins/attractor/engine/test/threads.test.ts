import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadStore, isFullFidelity } from '../src/backend/threads.ts'
import { Handler, type Node } from '../src/dot/graph.ts'

function node(attrs: Record<string, string>): Node {
  return { id: 'n', attrs, handler: Handler.CODERGEN }
}

const full = node({ thread_id: 'work', fidelity: 'full' })

test('full fidelity is recognised, other modes are not', () => {
  assert.equal(isFullFidelity(full), true)
  assert.equal(isFullFidelity(node({ thread_id: 'work', fidelity: 'compact' })), false)
  assert.equal(isFullFidelity(node({ thread_id: 'work' })), false)
  assert.equal(isFullFidelity(node({ fidelity: 'full' })), false, 'a thread id is required')
})

test('the first node in a thread has nothing to resume', () => {
  assert.equal(new ThreadStore().resumeIdFor(full), undefined)
})

test('a later node in the same thread resumes the recorded session', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(full), 'sess-1')
})

test('a different thread does not resume another thread session', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(node({ thread_id: 'other', fidelity: 'full' })), undefined)
})

test('a non-full node never resumes even within a recorded thread', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(node({ thread_id: 'work', fidelity: 'compact' })), undefined)
})

test('recording is ignored for a non-full node', () => {
  const s = new ThreadStore()
  s.record(node({ thread_id: 'work', fidelity: 'compact' }), 'sess-x')
  assert.equal(s.resumeIdFor(full), undefined)
})

test('a clone does not leak new sessions back to its parent', () => {
  const parent = new ThreadStore()
  parent.record(full, 'sess-1')
  const branch = parent.clone()
  branch.record(full, 'sess-branch')
  assert.equal(parent.resumeIdFor(full), 'sess-1', 'the parent must be unaffected')
  assert.equal(branch.resumeIdFor(full), 'sess-branch')
})
