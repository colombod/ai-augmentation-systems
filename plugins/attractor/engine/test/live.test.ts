import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'

const LIVE = process.env.ATTRACTOR_LIVE === '1'

test('a real claude -p call writes a file and reports success', { skip: !LIVE }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-live-'))
  try {
    const node: Node = { id: 'work', attrs: {}, handler: Handler.CODERGEN }
    const graph: Graph = { name: 'g', attrs: {}, nodes: new Map(), edges: [] }
    const backend = new ClaudeCodeBackend({
      cwd: dir,
      addDir: dir,
      model: 'haiku',
      maxBudgetUsd: 1,
      allowedTools: ['Bash', 'Write'],
    })
    const outcome = await backend.run(
      node,
      'Write a file named live.txt containing exactly: ATTRACTOR-LIVE. Then reply DONE.',
      Context.from({}),
      graph,
    )
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(readFileSync(join(dir, 'live.txt'), 'utf8').trim(), 'ATTRACTOR-LIVE')
    assert.ok((outcome.metrics?.costUsd ?? 0) > 0, 'a real call records real spend')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
