import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { type Graph, type HandlerKind, type Node, Handler as Kind } from '../src/dot/graph.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { ParallelHandler } from '../src/handlers/parallel.ts'
import { type Handler, type HandlerCtx, type StepResult } from '../src/handlers/types.ts'

/**
 * Matching box.test.ts/tool.test.ts's own convention: a `run(...)`-shaped
 * helper building fresh runDir/cwd temp directories, plus (FR-17b's own
 * addition) a REAL `Engine` instance underneath so `ctx.runBranchNode`/
 * `ctx.nodeStatus` are the genuine `visitNode`/`nodeStatus` machinery, not a
 * hand-rolled approximation of it -- exactly the machinery ADR-007 says
 * ParallelHandler must reuse. `visitNode`/`nodeStatus` are private, so this
 * reaches them via a cast, the same convention engine.test.ts's own
 * `setManaged` test already established for exercising engine internals a
 * unit test needs direct access to.
 */
function makeCtx(opts: {
  graph: Graph
  node: Node
  handlers: Map<HandlerKind, Handler>
  context?: Context
  cwd?: string
  repoDir?: string
}): { ctx: HandlerCtx; runDir: string; cwd: string } {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-parallel-run-'))
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), 'attractor-parallel-cwd-'))
  const context = opts.context ?? Context.from({})
  const engine = new Engine({
    graph: opts.graph,
    context,
    runDir,
    cwd,
    handlers: opts.handlers,
    repoDir: opts.repoDir,
  })
  const internal = engine as unknown as {
    visitNode(nodeId: string, context: Context, cwd: string, opts: { checkpoint: boolean }): Promise<StepResult>
    nodeStatus(nodeId: string): Status | undefined
  }
  const ctx: HandlerCtx = {
    node: opts.node,
    graph: opts.graph,
    context,
    runDir,
    cwd,
    events: new EventLog(runDir),
    repoDir: opts.repoDir,
    runBranchNode: (nodeId, branchContext, branchCwd) =>
      internal.visitNode(nodeId, branchContext, branchCwd, { checkpoint: false }),
    nodeStatus: (id) => internal.nodeStatus(id),
  }
  return { ctx, runDir, cwd }
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Branch discovery: every outgoing edge of the component node is a branch.
// ---------------------------------------------------------------------------

function fanoutGraph(branchCount: number, attrs = ''): Graph {
  const branches = Array.from({ length: branchCount }, (_, i) => `b${i}`)
  const src = `
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component${attrs ? `, ${attrs}` : ''}]
      ${branches.map((b) => `${b} [shape=box, prompt="${b}"]`).join('\n')}
      join [shape=tripleoctagon]
      start -> fanout
      ${branches.map((b) => `fanout -> ${b}`).join('\n')}
      ${branches.map((b) => `${b} -> join`).join('\n')}
      join -> done
    }
  `
  return parseDot(src)
}

for (const count of [1, 2, 5]) {
  test(`branch discovery: ${count} outgoing edge(s) from a component node dispatches exactly ${count} branch(es)`, async () => {
    const graph = fanoutGraph(count)
    const backend = new StubBackend({})
    const { ctx, runDir, cwd } = makeCtx({
      graph,
      node: graph.nodes.get('fanout')!,
      handlers: defaultHandlers(backend),
    })
    try {
      const outcome = await new ParallelHandler().execute(ctx)
      assert.equal(outcome.status, Status.SUCCESS)
      assert.deepEqual(outcome.suggestedNextIds, ['join'])
      assert.equal(backend.calls().length, count, 'branch count == outgoing edge count, no separate attribute consulted')
    } finally {
      cleanup(runDir, cwd)
    }
  })
}

test('a component node with no outgoing edges is a runtime FAIL, not a crash', async () => {
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component]
      start -> fanout
    }
  `)
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(new StubBackend({})),
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /no outgoing edges/)
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// max_parallel concurrency cap (NFR-7's own required test).
// ---------------------------------------------------------------------------

/** Tracks a running high-water mark of concurrent execute() calls. */
class ConcurrencyTrackingHandler implements Handler {
  private inFlight = 0
  private delayMs: number
  maxObserved = 0
  callCount = 0

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  async execute(): Promise<Outcome> {
    this.callCount++
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    await new Promise((r) => setTimeout(r, this.delayMs))
    this.inFlight--
    return { status: Status.SUCCESS, notes: 'ok' }
  }
}

test('max_parallel caps the number of branches with an in-flight dispatch at once', async () => {
  const maxParallel = 3
  const branchCount = maxParallel * 2
  const graph = fanoutGraph(branchCount, `max_parallel=${maxParallel}`)
  const tracker = new ConcurrencyTrackingHandler(30)
  const handlers = defaultHandlers(new StubBackend({}))
  handlers.set(Kind.CODERGEN, tracker)

  const { ctx, runDir, cwd } = makeCtx({ graph, node: graph.nodes.get('fanout')!, handlers })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(tracker.callCount, branchCount, 'every branch was dispatched exactly once')
    assert.ok(
      tracker.maxObserved <= maxParallel,
      `observed ${tracker.maxObserved} concurrent dispatches, max_parallel is ${maxParallel}`,
    )
    assert.ok(
      tracker.maxObserved >= 2,
      'the delay must force REAL overlap -- a maxObserved of 1 would mean this test cannot ' +
        'tell bounded concurrency from accidental serialization',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// Per-branch context isolation under REAL concurrent writes.
//
// The highest-value test in this file (per the architecture addendum's own
// Test strategy): two branches each write a DIFFERENT-declared context key
// that happens to share the SAME name, to DIFFERENT values, and one of them
// is genuinely still in flight while the other has already finished and
// merged its own write. A version of this test where both branches finish
// instantly would not force the two Context.clone()s to coexist at all and
// would not catch a regression to "one shared Context".
// ---------------------------------------------------------------------------

/** A Backend whose response (and an optional artificial delay) is scripted per node id. */
class ScriptedDelayBackend implements Backend {
  private script: Record<string, { outcome: Outcome; delayMs?: number }>

  constructor(script: Record<string, { outcome: Outcome; delayMs?: number }>) {
    this.script = script
  }

  async run(node: Node): Promise<Outcome> {
    const entry = this.script[node.id]
    if (entry === undefined) return { status: Status.SUCCESS }
    if (entry.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs))
    return entry.outcome
  }
}

test('two concurrent branches writing the same declared key to different values resolve by declared-edge order, with a loud conflict event', async () => {
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component, max_parallel=2]
      a1 [shape=box, prompt="a", outputs="shared.key,a.only"]
      b1 [shape=box, prompt="b", outputs="shared.key,b.only"]
      join [shape=tripleoctagon]
      start -> fanout
      fanout -> a1
      fanout -> b1
      a1 -> join
      b1 -> join
      join -> done
    }
  `)
  // a1 is the FIRST-declared branch edge (fanout -> a1 appears before
  // fanout -> b1) and finishes INSTANTLY. b1 is SLOWER (delayed), so it is
  // still in flight when a1 has already finished and its walk has already
  // reached `join`. Declared-edge order says a1 must win regardless of who
  // finished first -- if a regression shared one Context object instead of
  // cloning, the LAST writer (b1, since it is slower) would silently win
  // instead, and this test is built to fail loudly in exactly that case.
  const backend = new ScriptedDelayBackend({
    a1: { outcome: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-a', 'a.only': 'A' } } },
    b1: {
      outcome: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-b', 'b.only': 'B' } },
      delayMs: 60,
    },
  })
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(backend),
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(
      outcome.contextUpdates?.['shared.key'],
      'from-a',
      'declared-edge order (a1 is first), not completion order, decides the winner',
    )
    assert.equal(outcome.contextUpdates?.['a.only'], 'A', "a1's own non-colliding key survives")
    assert.equal(
      outcome.contextUpdates?.['b.only'],
      'B',
      "b1's own non-colliding key ALSO survives -- b1's work was not lost or corrupted " +
        'just because it collided with a1 on a different key',
    )

    const events = new EventLog(runDir).all()
    const conflict = events.find((e) => e.type === 'node.parallel.context_conflict')
    assert.ok(conflict, 'a node.parallel.context_conflict event was recorded')
    assert.equal(conflict?.key, 'shared.key')
    assert.equal(conflict?.winningBranch, 'a1')
    assert.equal(conflict?.losingBranch, 'b1')
    assert.equal(conflict?.losingValue, 'from-b')

    // The value actually reached the shared context too, not just the
    // reported Outcome -- ParallelHandler must merge it itself, the same way
    // ToolHandler/BoxHandler merge their own updates.
    assert.equal(ctx.context.get('shared.key'), 'from-a')
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// Declared/inferred-only merge-back.
// ---------------------------------------------------------------------------

test('an undeclared, uninferred key written inside a branch does not survive past the branch boundary; an inferred key does', async () => {
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component]
      leaky [shape=box, prompt="leaky"]
      tool1 [shape=parallelogram, tool_command="printf survives"]
      join [shape=tripleoctagon]
      start -> fanout
      fanout -> leaky
      fanout -> tool1
      leaky -> join
      tool1 -> join
      join -> done
    }
  `)
  // `leaky` declares no outputs= at all; BoxHandler merges its
  // contextUpdates into its own (cloned) context regardless -- that is
  // BoxHandler's normal behaviour and unrelated to FR-17b. What FR-17b's
  // own merge-back must refuse is CARRYING that undeclared key back OUT of
  // the branch, since dot/graph.ts's CODERGEN entry in
  // INFERRED_OUTPUTS_BY_HANDLER is deliberately empty.
  const backend = new StubBackend({
    leaky: { status: Status.SUCCESS, contextUpdates: { 'undeclared.key': 'sneaky' } },
  })
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(backend),
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(
      outcome.contextUpdates?.['undeclared.key'],
      undefined,
      'an undeclared, uninferred key must not cross the branch boundary',
    )
    assert.equal(ctx.context.get('undeclared.key'), undefined)

    // tool.last_line/tool.output ARE inferred (TOOL_OUTPUT_KEYS) and DO
    // cross the boundary, pinning that the scoping is to effectiveOutputs(),
    // not "nothing ever crosses".
    assert.equal(outcome.contextUpdates?.['tool.last_line'], 'survives')
    assert.equal(ctx.context.get('tool.last_line'), 'survives')
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// branch_worktree=true isolation (integration, real git repo).
// Reuses worktree.test.ts's own repo() fixture-building convention.
// ---------------------------------------------------------------------------

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-parallel-wt-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'seed.txt'), 'seed', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

test('branch_worktree=true isolates one branch while a sibling branch shares the run cwd', async () => {
  const repoDir = repo()
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component, max_parallel=2]
      isolated [shape=parallelogram, branch_worktree=true,
                tool_command="echo isolated > iso-output.txt && git add -A && git commit -qm iso"]
      sharedb  [shape=parallelogram, tool_command="echo shared > shared-output.txt"]
      join [shape=tripleoctagon]
      start -> fanout
      fanout -> isolated
      fanout -> sharedb
      isolated -> join
      sharedb -> join
      join -> done
    }
  `)
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(new StubBackend({})),
    cwd: repoDir,
    repoDir,
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)

    // The isolated branch's write is invisible in the shared repo/cwd...
    assert.equal(existsSync(join(repoDir, 'iso-output.txt')), false, 'isolated write must not reach the shared cwd')
    // ...but IS on its own branch, matching ADR-008's naming
    // (`${parallelNodeId}-${branchHeadId}`) and worktree.ts's own
    // "the branch IS the deliverable" contract.
    const onBranch = execFileSync('git', ['ls-tree', '-r', '--name-only', 'attractor/fanout-isolated'], {
      cwd: repoDir,
      encoding: 'utf8',
    })
    assert.match(onBranch, /iso-output\.txt/)

    // The shared branch's write IS directly visible in the run's shared cwd.
    assert.equal(existsSync(join(repoDir, 'shared-output.txt')), true)
  } finally {
    cleanup(runDir, repoDir)
  }
})

// ---------------------------------------------------------------------------
// Issue #15 is closed on this new path (ADR-008, Spike 2).
//
// max_parallel-many branches, ALL setting branch_worktree=true against ONE
// real repository, repeated 80+ times to get statistical confidence against
// issue #15's own documented ~1-in-15-to-25 flake rate on unserialized
// concurrent `git worktree add` calls. Run CONCURRENTLY (not one iteration
// after another) through ONE shared ParallelHandler instance, so the
// per-repo mutex (ADR-008) is stressed by every iteration's branches at
// once, not just within a single execute() call.
// ---------------------------------------------------------------------------

test('the issue #15 worktree race does not reproduce on this code path (80+ concurrent iterations)', async () => {
  const repoDir = repo()
  const iterations = 80
  const branchesPerIteration = 3
  const handler = new ParallelHandler()
  const runDirs: string[] = []

  try {
    const attempts = Array.from({ length: iterations }, (_, i) => {
      const nodeIds = Array.from({ length: branchesPerIteration }, (_, b) => `n${i}_${b}`)
      const src = `
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fanout${i} [shape=component, max_parallel=${branchesPerIteration}]
          ${nodeIds
            .map(
              (id) =>
                `${id} [shape=parallelogram, branch_worktree=true, ` +
                `tool_command="echo ${id} > ${id}.txt && git add -A && git commit -qm ${id}"]`,
            )
            .join('\n')}
          join${i} [shape=tripleoctagon]
          start -> fanout${i}
          ${nodeIds.map((id) => `fanout${i} -> ${id}`).join('\n')}
          ${nodeIds.map((id) => `${id} -> join${i}`).join('\n')}
          join${i} -> done
        }
      `
      const graph = parseDot(src)
      const { ctx, runDir } = makeCtx({
        graph,
        node: graph.nodes.get(`fanout${i}`)!,
        handlers: defaultHandlers(new StubBackend({})),
        cwd: repoDir,
        repoDir,
      })
      runDirs.push(runDir)
      // All iterations share ONE ParallelHandler (and therefore one
      // withRepoLock mutex instance), calling execute() directly rather than
      // through Engine.run() -- the branch walk still goes through a REAL
      // per-iteration Engine's visitNode via ctx.runBranchNode.
      return handler.execute(ctx)
    })

    const results = await Promise.all(attempts)

    for (const outcome of results) {
      assert.equal(
        outcome.status,
        Status.SUCCESS,
        `expected SUCCESS, got ${outcome.status}: ${outcome.notes ?? outcome.failureReason ?? ''}`,
      )
    }
  } finally {
    cleanup(repoDir, ...runDirs)
  }
})

// ---------------------------------------------------------------------------
// The join-node routing bypass, end to end via Engine.run().
// ---------------------------------------------------------------------------

for (const branchCount of [1, 3]) {
  test(`join-node routing bypass: Engine.run() reaches the fan-in node exactly once with ${branchCount} branch(es)`, async () => {
    const graph = fanoutGraph(branchCount)
    const runDir = mkdtempSync(join(tmpdir(), 'attractor-parallel-e2e-run-'))
    const cwd = mkdtempSync(join(tmpdir(), 'attractor-parallel-e2e-cwd-'))
    try {
      const engine = new Engine({
        graph,
        context: Context.from({}),
        runDir,
        cwd,
        handlers: defaultHandlers(new StubBackend({})),
      })
      const result = await engine.run()
      assert.equal(result.status, Status.SUCCESS)
      const joinVisits = result.path.filter((id) => id === 'join')
      assert.equal(joinVisits.length, 1, 'the join node is reached exactly once regardless of branch count')
      assert.ok(result.path.includes('done'), 'the run continued past the join to the exit')

      const events = new EventLog(runDir).all()
      const bypassEdge = events.find(
        (e) => e.type === 'edge.taken' && e.node === 'join' && (e as { to?: string }).to === 'done',
      )
      assert.ok(bypassEdge, 'join -> done is an ordinary edge, taken normally after the bypass lands on join')
    } finally {
      cleanup(runDir, cwd)
    }
  })
}

// ---------------------------------------------------------------------------
// Convergence mismatch is a loud FAIL.
// ---------------------------------------------------------------------------

test('branches routing to two different nodes is an orchestration-level FAIL, not a silent pick', async () => {
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component]
      a1 [shape=box, prompt="a"]
      b1 [shape=box, prompt="b"]
      join1 [shape=tripleoctagon]
      join2 [shape=tripleoctagon]
      start -> fanout
      fanout -> a1
      fanout -> b1
      a1 -> join1
      b1 -> join2
      join1 -> done
      join2 -> done
    }
  `)
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(new StubBackend({})),
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.FAIL)
    assert.equal(outcome.suggestedNextIds, undefined)
    assert.match(outcome.notes ?? '', /distinct nodes|converge/)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('branches converging on a node that is not Handler.FAN_IN is also a loud FAIL', async () => {
  // Both branches route directly into `done`, the run's own EXIT node --
  // a graph-authoring error the walker treats as a stop condition (alongside
  // Handler.FAN_IN, see walkBranch's own comment on why), which is what
  // makes the "must resolve to Handler.FAN_IN" validation actually
  // observable here rather than just a defensive check.
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=component]
      a1 [shape=box, prompt="a"]
      b1 [shape=box, prompt="b"]
      start -> fanout
      fanout -> a1
      fanout -> b1
      a1 -> done
      b1 -> done
    }
  `)
  const { ctx, runDir, cwd } = makeCtx({
    graph,
    node: graph.nodes.get('fanout')!,
    handlers: defaultHandlers(new StubBackend({})),
  })
  try {
    const outcome = await new ParallelHandler().execute(ctx)
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /does not resolve to Handler\.FAN_IN/)
  } finally {
    cleanup(runDir, cwd)
  }
})
