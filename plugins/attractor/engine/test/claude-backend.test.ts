import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { ThreadStore } from '../src/backend/threads.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'

const GRAPH: Graph = { name: 'g', attrs: {}, nodes: new Map(), edges: [] }
function node(attrs: Record<string, string> = {}): Node {
  return { id: 'work', attrs, handler: Handler.CODERGEN }
}

/** A stand-in for the claude CLI: prints a canned payload, echoes stdin to a file. */
function fakeClaude(dir: string, body: string): string {
  const path = join(dir, 'fake-claude.sh')
  writeFileSync(path, `#!/bin/sh\ncat > "${join(dir, 'stdin.txt')}"\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
  return path
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-claude-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('the prompt is delivered on stdin, not as an argument', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok","session_id":"s1"}'`)
    const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
    await backend.run(node(), 'ADVANCE THE GOAL', Context.from({}), GRAPH)

    const { readFileSync } = await import('node:fs')
    assert.equal(readFileSync(join(dir, 'stdin.txt'), 'utf8'), 'ADVANCE THE GOAL')
  })
})

test('a successful payload becomes a successful outcome', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"done","total_cost_usd":0.03}'`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.metrics?.costUsd, 0.03)
  })
})

test('a CLI that exits non-zero with no JSON fails with its stderr', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `echo "usage error" >&2\nexit 2`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /usage error/)
  })
})

test('a missing binary fails cleanly rather than throwing', async () => {
  await withDir(async (dir) => {
    const backend = new ClaudeCodeBackend({ command: join(dir, 'does-not-exist'), cwd: dir })
    const outcome = await backend.run(node(), 'p', Context.from({}), GRAPH)
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /could not run|ENOENT/i)
  })
})

test('a work node whose answer happens to be JSON does not get read as a verdict', async () => {
  // node() below carries no goal_gate attribute, so claude.ts must NOT ask
  // interpretResult to treat the JSON-shaped `result` string as a routing
  // verdict -- an unrecognised "status" would otherwise map the node to FAIL
  // despite is_error: false, and the real output would be discarded.
  await withDir(async (dir) => {
    const payload = JSON.stringify({ status: 'complete', files: 3 })
    const outer = JSON.stringify({ is_error: false, result: payload })
    const cmd = fakeClaude(dir, `printf '%s' '${outer}'`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.notes, payload)
    assert.equal(outcome.preferredLabel, undefined)
  })
})

test('a goal gate node still gets its structured verdict interpreted', async () => {
  await withDir(async (dir) => {
    const payload = JSON.stringify({ status: 'retry', preferred_label: 'iterate', notes: 'not yet' })
    const outer = JSON.stringify({ is_error: false, result: payload })
    const cmd = fakeClaude(dir, `printf '%s' '${outer}'`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node({ goal_gate: 'true' }), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.RETRY)
    assert.equal(outcome.preferredLabel, 'iterate')
    assert.equal(outcome.notes, 'not yet')
  })
})

test('the session id is recorded against the node thread', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok","session_id":"s-42"}'`)
    const threads = new ThreadStore()
    const n = node({ thread_id: 'work', fidelity: 'full' })
    await new ClaudeCodeBackend({ command: cmd, cwd: dir, threads }).run(
      n, 'p', Context.from({}), GRAPH,
    )
    assert.equal(threads.resumeIdFor(n), 's-42')
  })
})

test('an already-aborted signal with a missing binary fails, it does not crash', async () => {
  // The dangerous combination: a long-lived signal aborted by an earlier node,
  // then reused for a node whose command does not exist. If the abort path
  // returns before the error listener is attached, Node emits an unlistened
  // 'error' event, which is an uncaught exception that kills the whole
  // orchestrator instead of failing this one node.
  await withDir(async (dir) => {
    const controller = new AbortController()
    controller.abort()
    const backend = new ClaudeCodeBackend({ command: join(dir, 'nope'), cwd: dir })
    const outcome = await backend.run(
      node(), 'p', Context.from({}), GRAPH, controller.signal,
    )
    assert.equal(outcome.status, Status.FAIL)
  })
})

test('an already-aborted signal with a real binary still fails cleanly', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok"}'`)
    const controller = new AbortController()
    controller.abort()
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH, controller.signal,
    )
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /abort/i)
  })
})

test('an aborted call fails rather than hanging', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `sleep 30`)
    const controller = new AbortController()
    const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
    const running = backend.run(node(), 'p', Context.from({}), GRAPH, controller.signal)
    controller.abort()
    const outcome = await running
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /abort/i)
  })
})
