import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Checkpoint, saveCheckpoint, loadCheckpoint } from '../src/core/checkpoint.ts'
import { EventLog } from '../src/run/events.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-test-'))
}

test('checkpoint round-trips', () => {
  const dir = tempDir()
  try {
    const cp: Checkpoint = {
      runId: 'r1',
      currentNode: 'verify',
      completed: ['start', 'attempt'],
      attempts: { attempt: 2 },
      context: { 'tool.last_line': 'green' },
      goalGatesSatisfied: ['verify'],
    }
    saveCheckpoint(dir, cp)
    assert.deepEqual(loadCheckpoint(dir), cp)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loading from a directory with no checkpoint returns null', () => {
  const dir = tempDir()
  try {
    assert.equal(loadCheckpoint(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('event log appends and reads back in order', () => {
  const dir = tempDir()
  try {
    const log = new EventLog(dir)
    log.append({ type: 'node.start', node: 'attempt' })
    log.append({ type: 'node.end', node: 'attempt', status: 'success' })
    const all = log.all()
    assert.equal(all.length, 2)
    assert.equal(all[0].type, 'node.start')
    assert.equal(all[1].status, 'success')
    assert.ok(typeof all[0].ts === 'string' && all[0].ts.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second EventLog on the same directory appends rather than truncating', () => {
  const dir = tempDir()
  try {
    new EventLog(dir).append({ type: 'a' })
    new EventLog(dir).append({ type: 'b' })
    assert.deepEqual(
      new EventLog(dir).all().map((e) => e.type),
      ['a', 'b'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a crash-truncated final line does not make the whole log unreadable', () => {
  const dir = tempDir()
  try {
    const log = new EventLog(dir)
    log.append({ type: 'first' })
    log.append({ type: 'second' })
    // Simulate a crash mid-append: a non-empty, unparseable trailing line.
    appendFileSync(join(dir, 'events.jsonl'), '{"type":"thi', 'utf8')

    assert.deepEqual(
      new EventLog(dir).all().map((e) => e.type),
      ['first', 'second'],
      'events written before the crash must still be readable',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the checkpoint uses the spec field names and carries a timestamp', () => {
  const dir = tempDir()
  try {
    saveCheckpoint(dir, {
      runId: 'r1', currentNode: 'verify', completed: ['start'],
      attempts: { verify: 1 }, context: { k: 'v' }, goalGatesSatisfied: [],
    })
    const raw = JSON.parse(readFileSync(join(dir, 'checkpoint.json'), 'utf8'))
    assert.equal(raw.current_node, 'verify')
    assert.deepEqual(raw.completed_nodes, ['start'])
    assert.deepEqual(raw.node_retries, { verify: 1 })
    assert.equal(typeof raw.timestamp, 'string')
    assert.ok(loadCheckpoint(dir), 'and it still round-trips')
    assert.equal(loadCheckpoint(dir)?.currentNode, 'verify')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saveCheckpoint leaves no temp file behind and overwrites cleanly', () => {
  const dir = tempDir()
  try {
    const base: Checkpoint = {
      runId: 'r1',
      currentNode: 'a',
      completed: [],
      attempts: {},
      context: {},
      goalGatesSatisfied: [],
    }
    saveCheckpoint(dir, base)
    saveCheckpoint(dir, { ...base, currentNode: 'b', completed: ['a'] })

    assert.equal(loadCheckpoint(dir)?.currentNode, 'b', 'the later write wins')
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.includes('.tmp')),
      [],
      'no temp file may survive a completed write',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
