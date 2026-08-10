import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { Context } from '../src/core/context.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'
import { parseDot } from '../src/dot/parse.ts'
import { type Backend } from '../src/handlers/types.ts'

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

/**
 * Delegates to a real `Backend` (a real `ClaudeCodeBackend`, spawning genuine
 * `claude` subprocesses -- one per branch) while tracking how many of its
 * `run()` calls are simultaneously in flight. The mock-level tests in
 * parallel.test.ts prove the same ceiling property against `GatedBackend`,
 * which can hold a call open indefinitely on command; a real subprocess
 * cannot be gated that way, so this instead just counts genuine concurrent
 * `run()` calls around a real, uncontrolled amount of subprocess wall-clock
 * time -- the same shape as `GatedBackend.inFlight`/`maxObserved`
 * (test/fixtures.ts) and `TrackingBackend` (parallel.test.ts), just
 * delegating to something real instead of gating.
 */
class ConcurrencyTrackingBackend implements Backend {
  private readonly inner: Backend
  inFlight = 0
  maxObserved = 0

  constructor(inner: Backend) {
    this.inner = inner
  }

  async run(
    node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal, cwd?: string,
  ): Promise<Outcome> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    try {
      return await this.inner.run(node, prompt, context, graph, signal, cwd)
    } finally {
      this.inFlight--
    }
  }
}

test(
  'a real ParallelHandler fan-out of N real ClaudeCodeBackend subprocesses never exceeds max_parallel ' +
  'concurrent subprocesses (NFR-7, Layer 3)',
  { skip: !LIVE },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'attractor-live-'))
    const runDir = mkdtempSync(join(tmpdir(), 'attractor-live-run-'))
    try {
      const branchCount = 3
      const maxParallel = 2
      // Same convention as the single-call test above (model haiku, a small
      // maxBudgetUsd, Bash allowed) -- a real `sleep` is cheap, deterministic
      // wall-clock work, long enough (2s) that three branches genuinely
      // overlap under a real OS scheduler rather than racing to finish
      // before the next one is even dispatched.
      const inner = new ClaudeCodeBackend({
        cwd: dir,
        addDir: dir,
        model: 'haiku',
        maxBudgetUsd: 1,
        allowedTools: ['Bash'],
      })
      const backend = new ConcurrencyTrackingBackend(inner)
      const handlers = defaultHandlers(backend)
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component, max_parallel="${maxParallel}"]
          r1 [shape=box, prompt="Run the shell command sleep 2 using the Bash tool. Then reply DONE."]
          r2 [shape=box, prompt="Run the shell command sleep 2 using the Bash tool. Then reply DONE."]
          r3 [shape=box, prompt="Run the shell command sleep 2 using the Bash tool. Then reply DONE."]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          fan -> r3 [isolate="false"]
          r1 -> done
          r2 -> done
          r3 -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd: dir, handlers })
      const result = await engine.run()

      assert.equal(result.status, Status.SUCCESS, 'all three real branches complete their trivial sleep-and-reply task')
      assert.ok(
        backend.maxObserved <= maxParallel,
        `observed ${backend.maxObserved} concurrent real subprocesses, but max_parallel was ${maxParallel}`,
      )
      assert.ok(
        backend.maxObserved >= 2,
        'the ceiling was genuinely exercised by real concurrent subprocesses, not accidentally serialized',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(runDir, { recursive: true, force: true })
    }
  },
)
