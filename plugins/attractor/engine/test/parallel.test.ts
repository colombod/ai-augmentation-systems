import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { loadCheckpoint } from '../src/core/checkpoint.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { type Graph, type Node, Handler } from '../src/dot/graph.ts'
import {
  type Backend, type BranchRunResult, type HandlerCtx, type Handler as HandlerIface,
} from '../src/handlers/types.ts'
import { mergeBranchContext, applyDefaultJoinPolicy, ParallelHandler, Semaphore } from '../src/handlers/parallel.ts'
import { EventLog, type RunEvent } from '../src/run/events.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { createWorktree } from '../src/run/worktree.ts'
import { GatedBackend } from './fixtures.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-parallel-'))
}

/** Hand-built BranchRunResult -- no runBranch/Engine needed for these rows. */
function branchResult(status: Status, context: Record<string, string>): BranchRunResult {
  return { outcome: { status }, path: ['x'], context }
}

class BranchLaunchingHandler implements HandlerIface {
  // NOT a TypeScript parameter property (`constructor(private readonly x)`) --
  // Node's native strip-only TS mode does not support that syntax. Explicit
  // field + explicit assignment, matching the fix already applied in the
  // committed test/engine.test.ts (BranchLaunchingHandler there hit the exact
  // same issue).
  private readonly launch: (ctx: HandlerCtx) => Promise<Outcome>

  constructor(launch: (ctx: HandlerCtx) => Promise<Outcome>) {
    this.launch = launch
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    return this.launch(ctx)
  }
}

/**
 * `GatedBackend` (Task 1, test/fixtures.ts) always resolves a bare
 * `{status: SUCCESS}` -- perfect for proving CONCURRENCY, useless for proving
 * this task's collision rows, which need each branch to write a DIFFERENT,
 * chosen context value while completion order is still driven independently
 * of declaration order. This is a small, file-local variant built only for
 * that need -- not a duplicate of GatedBackend, and not reused outside this
 * file.
 */
class GatedValueBackend implements Backend {
  private gates = new Map<string, () => void>()
  // Same non-parameter-property fix as BranchLaunchingHandler above.
  private readonly outcomes: Record<string, Outcome>

  constructor(outcomes: Record<string, Outcome>) {
    this.outcomes = outcomes
  }

  async run(node: Node, _prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    await new Promise<void>((resolve) => {
      this.gates.set(node.id, resolve)
    })
    return this.outcomes[node.id] ?? { status: Status.SUCCESS }
  }
  release(nodeId: string): void {
    this.gates.get(nodeId)?.()
  }
}

test('mergeBranchContext: happy path -- three branches declare distinct keys, each merges through', () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, { 'a.path': 'A' }),
    branchResult(Status.SUCCESS, { 'b.path': 'B' }),
    branchResult(Status.SUCCESS, { 'c.path': 'C' }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1', 'r2', 'r3'], results, events)
  assert.equal(parent.get('a.path'), 'A')
  assert.equal(parent.get('b.path'), 'B')
  assert.equal(parent.get('c.path'), 'C')
  assert.equal(events.all().filter((e) => e.type === 'node.parallel.context_collision').length, 0)
})

test('mergeBranchContext: exact F1 reproduction -- three branches declare the SAME key, completion out of declaration order', async () => {
  const backend = new GatedValueBackend({
    r1: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r1' } },
    r2: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r2' } },
    r3: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r3' } },
  })
  const handlers = defaultHandlers(backend)
  const runDir = tempDir()
  const cwd = tempDir()
  let capturedResults: BranchRunResult[] = []
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const rootIds = ['r1', 'r2', 'r3']
      const promises = rootIds.map((id) =>
        ctx.runBranch!({
          startNodeId: id, stopAt: new Set(), context: ctx.context.clone(),
          runDir: join(ctx.runDir, `branch-${id}`), cwd: ctx.cwd,
        }),
      )
      // Completion order deliberately reversed from declaration order.
      backend.release('r3')
      backend.release('r2')
      backend.release('r1')
      capturedResults = await Promise.all(promises)
      return { status: Status.SUCCESS, notes: 'branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      r1 [shape=box, prompt="x", outputs="implementation.path"]
      r2 [shape=box, prompt="x", outputs="implementation.path"]
      r3 [shape=box, prompt="x", outputs="implementation.path"]
      start -> detour -> done
      detour -> r1 [condition="context.never_true=x"]
      detour -> r2 [condition="context.never_true=x"]
      detour -> r3 [condition="context.never_true=x"]
      r1 -> done
      r2 -> done
      r3 -> done
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()

    const parent = Context.from({})
    const pre = parent.snapshot()

    // Pre-fix: nothing has copied any branch's writes back yet -- the
    // convergence node would read nothing. Asserted BEFORE the real merge
    // call, so the scenario is proven load-bearing, not merely described.
    assert.equal(parent.get('implementation.path'), undefined)

    const events = new EventLog(tempDir())
    mergeBranchContext(parent, pre, ['r1', 'r2', 'r3'], capturedResults, events)
    assert.equal(
      parent.get('implementation.path'), 'r3',
      "the THIRD (last-declared) branch's value wins, regardless of completion order",
    )
    // Scoped to implementation.path -- BoxHandler (spec section 5) also
    // unconditionally writes last_stage/last_response on every dispatch
    // (BOX_CONTEXT_KEYS), and since each branch writes a DIFFERENT value for
    // those (its own node id / response text), they legitimately collide
    // too. Real branch evidence, correctly merged and logged -- just not
    // this test's own concern, which is implementation.path specifically.
    const collisions = events.all().filter(
      (e) => e.type === 'node.parallel.context_collision' && e.key === 'implementation.path',
    )
    assert.equal(collisions.length, 2, 'not zero, not one -- r2 collides with r1, then r3 collides with r2')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("mergeBranchContext: two-branch collision, completion order opposite declaration order -- the later-declared branch's value wins", async () => {
  const backend = new GatedValueBackend({
    r1: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-r1' } },
    r2: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-r2' } },
  })
  const handlers = defaultHandlers(backend)
  const runDir = tempDir()
  const cwd = tempDir()
  let capturedResults: BranchRunResult[] = []
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const rootIds = ['r1', 'r2']
      const promises = rootIds.map((id) =>
        ctx.runBranch!({
          startNodeId: id, stopAt: new Set(), context: ctx.context.clone(),
          runDir: join(ctx.runDir, `branch-${id}`), cwd: ctx.cwd,
        }),
      )
      // r2 (later-declared) completes FIRST -- opposite of declaration order.
      backend.release('r2')
      backend.release('r1')
      capturedResults = await Promise.all(promises)
      return { status: Status.SUCCESS, notes: 'branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      r1 [shape=box, prompt="x", outputs="shared.key"]
      r2 [shape=box, prompt="x", outputs="shared.key"]
      start -> detour -> done
      detour -> r1 [condition="context.never_true=x"]
      detour -> r2 [condition="context.never_true=x"]
      r1 -> done
      r2 -> done
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()

    const parent = Context.from({})
    const pre = parent.snapshot()
    const events = new EventLog(tempDir())
    mergeBranchContext(parent, pre, ['r1', 'r2'], capturedResults, events)
    assert.equal(parent.get('shared.key'), 'from-r2', 'r2 is declared LAST, so it wins even though it completed FIRST')
    // Scoped to shared.key -- see the 3-branch test above for why
    // last_stage/last_response also legitimately collide and are excluded
    // from this count.
    const collisions = events.all().filter(
      (e) => e.type === 'node.parallel.context_collision' && e.key === 'shared.key',
    )
    assert.equal(collisions.length, 1)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("mergeBranchContext: a branch's tool.last_line write IS merged; current_node/outcome/preferred_label are NOT", () => {
  const parent = Context.from({})
  parent.set('current_node', 'outer')
  parent.set('outcome', Status.SUCCESS)
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, {
      'tool.last_line': 'green',
      current_node: 'r1',
      outcome: Status.FAIL,
      preferred_label: 'ship',
    }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('tool.last_line'), 'green', "a branch's own tool.* write IS branch evidence, merged like any outputs= key")
  assert.equal(parent.get('current_node'), 'outer', 'the outer run\'s own post-return value is still in effect')
  assert.equal(parent.get('outcome'), Status.SUCCESS, 'the outer run\'s own post-return value is still in effect')
  assert.equal(parent.get('preferred_label'), undefined, 'never set to begin with, and still not merged from the branch')
})

test("mergeBranchContext: a FAILED branch's partial key write is not merged", () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [branchResult(Status.FAIL, { 'artifact.path': 'partial-work' })]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('artifact.path'), undefined, 'unproven partial work from a failed branch is not trusted evidence')
})

test("mergeBranchContext: a PARTIAL-status branch DOES merge, mirroring recordOutcome's own SUCCESS/PARTIAL rule", () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [branchResult(Status.PARTIAL, { 'artifact.path': 'partial-but-trusted' })]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('artifact.path'), 'partial-but-trusted')
})

test('mergeBranchContext: a key unchanged from the pre-fork snapshot is not re-merged or logged as a collision', () => {
  const parent = Context.from({ 'stable.key': 'unchanged' })
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, { 'stable.key': 'unchanged', 'new.key': 'added-by-r1' }),
    branchResult(Status.SUCCESS, { 'stable.key': 'unchanged', 'new.key': 'added-by-r2' }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1', 'r2'], results, events)
  assert.equal(parent.get('new.key'), 'added-by-r2')
  assert.equal(
    events.all().filter((e) => e.type === 'node.parallel.context_collision').length, 1,
    'only new.key collides -- stable.key, unchanged from prefork in both branches, is never even considered',
  )
})

test('applyDefaultJoinPolicy: all branches SUCCEED -> SUCCESS', () => {
  const results = [
    branchResult(Status.SUCCESS, {}),
    branchResult(Status.SUCCESS, {}),
    branchResult(Status.SUCCESS, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.SUCCESS)
  assert.equal(outcome.failureReason, undefined)
})

test('applyDefaultJoinPolicy: all branches FAIL -> FAIL', () => {
  const results = [
    branchResult(Status.FAIL, {}),
    branchResult(Status.FAIL, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.FAIL)
  assert.equal(outcome.failureReason, 'all 2 branch(es) failed -- branch 0: no reason given; branch 1: no reason given')
})

test('applyDefaultJoinPolicy: mixed SUCCESS + FAIL -> PARTIAL', () => {
  const results = [
    branchResult(Status.SUCCESS, {}),
    branchResult(Status.FAIL, {}),
    branchResult(Status.SUCCESS, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.PARTIAL)
  assert.equal(outcome.notes, '2/3 branch(es) succeeded or partially succeeded -- failed: branch 1: no reason given')
})

test('applyDefaultJoinPolicy: mixed PARTIAL + FAIL -> PARTIAL (PARTIAL counts as settled)', () => {
  const results = [
    branchResult(Status.PARTIAL, {}),
    branchResult(Status.FAIL, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.PARTIAL)
  assert.equal(outcome.notes, '1/2 branch(es) succeeded or partially succeeded -- failed: branch 1: no reason given')
})

test('applyDefaultJoinPolicy: single branch SUCCEEDS -> SUCCESS', () => {
  const outcome = applyDefaultJoinPolicy([branchResult(Status.SUCCESS, {})])
  assert.equal(outcome.status, Status.SUCCESS)
})

test('applyDefaultJoinPolicy: single branch FAILS -> FAIL', () => {
  const outcome = applyDefaultJoinPolicy([branchResult(Status.FAIL, {})])
  assert.equal(outcome.status, Status.FAIL)
  assert.equal(outcome.failureReason, 'all 1 branch(es) failed -- branch 0: no reason given')
})

test(
  'applyDefaultJoinPolicy: R-sprint3-1 -- failed branches are named by their real id, with their ' +
  'own failureReason, not swallowed into a bare count',
  () => {
    const results = [
      { outcome: { status: Status.FAIL, failureReason: 'timeout after 30s' }, path: ['x'], context: {} },
      { outcome: { status: Status.SUCCESS }, path: ['x'], context: {} },
      { outcome: { status: Status.FAIL, notes: 'no notes-only fallback needed here' }, path: ['x'], context: {} },
    ]
    const outcome = applyDefaultJoinPolicy(results, ['security-review', 'style-review', 'perf-review'])
    assert.equal(outcome.status, Status.PARTIAL)
    assert.equal(
      outcome.notes,
      '1/3 branch(es) succeeded or partially succeeded -- failed: security-review: timeout after 30s; ' +
        'perf-review: no notes-only fallback needed here',
      'each failed branch is named by its own id and its own reason, not a bare index or a count',
    )
  },
)

test('applyDefaultJoinPolicy: zero branches -> FAIL (vacuously zero SUCCEED/PARTIAL)', () => {
  const outcome = applyDefaultJoinPolicy([])
  assert.equal(outcome.status, Status.FAIL)
  assert.equal(outcome.failureReason, 'all 0 branch(es) failed')
})

test('Semaphore: permits are granted immediately up to the permit count, then block', async () => {
  const sem = new Semaphore(2)
  const order: string[] = []

  await sem.acquire()
  order.push('a1-acquired')
  await sem.acquire()
  order.push('a2-acquired')

  let a3Acquired = false
  const p3 = sem.acquire().then(() => {
    a3Acquired = true
    order.push('a3-acquired')
  })

  // Flush pending microtasks -- if acquire() incorrectly granted a permit
  // it hadn't earned, a3Acquired would already be true here. Nothing in
  // Semaphore ever resolves a waiter's promise except release(), which we
  // have not called yet, so this is deterministic, not a timing race.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(a3Acquired, false, 'a third acquire() must block when only 2 permits exist and both are held')

  sem.release()
  await p3
  assert.equal(a3Acquired, true, 'release() must wake the blocked acquire()')
  assert.deepEqual(order, ['a1-acquired', 'a2-acquired', 'a3-acquired'])
})

test('Semaphore: release() wakes exactly one waiter, in FIFO order', async () => {
  const sem = new Semaphore(1)
  await sem.acquire() // consumes the only permit

  const order: string[] = []
  const p1 = sem.acquire().then(() => order.push('w1'))
  const p2 = sem.acquire().then(() => order.push('w2'))

  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(order, [], 'neither waiter can run before any release()')

  sem.release()
  await p1
  assert.deepEqual(order, ['w1'], 'exactly the FIRST-queued waiter woke, not both')

  // w2 must still be blocked -- only one permit was released, and w1 just
  // reclaimed it via its own post-wake decrement.
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(order, ['w1'], 'second waiter is still blocked after only one release()')

  sem.release()
  await p2
  assert.deepEqual(order, ['w1', 'w2'], 'second release() wakes the second-queued waiter')
})

// ---------------------------------------------------------------------------
// ParallelHandler (p5-08 part 2). Registered against Handler.TOOL, exactly
// like every BranchLaunchingHandler test above and in engine.test.ts --
// Handler.PARALLEL stays in UNREGISTERED_HANDLER_KINDS until a later story
// registers the real handler kind and adds the engine-side convergence-jump
// (out of THIS story's scope, per ADR-013). ParallelHandler itself only ever
// reads ctx.node/ctx.graph/outgoingEdges(graph, node.id), so it does not
// care which handler kind actually dispatched it.
//
// Every branch-root edge below carries condition="context.never_true=x" and
// the fan-out node has NO other outgoing edge. ParallelHandler computes
// branchRootIds from EVERY outgoing edge of the fan-out node, condition-
// independent (ADR-013's own model: a branch root is an edge, not a
// condition match) -- so a spurious extra edge would become a spurious
// extra branch. The never-true condition keeps selectEdge (engine.ts:816,
// unmodified by this story) from ALSO picking a branch-root edge as the
// ordinary next node once ParallelHandler returns -- the convergence-jump a
// SUCCESS/PARTIAL outcome would otherwise need is core/engine.ts's own
// separate, later task. With no edge ever selectable, the OUTER run
// predictably dead-ends at the fan-out node every time, whatever
// ParallelHandler itself returned -- irrelevant to every assertion below,
// which all inspect ParallelHandler's own effects (events, context,
// GatedBackend, the filesystem) directly, never engine.run()'s own overall
// RunResult.status.
// ---------------------------------------------------------------------------

/**
 * Poll a real condition with real time between checks (setTimeout, not a
 * fixed count of microtask flushes). ParallelHandler's dispatch chain runs
 * through several real async layers (Engine.runBranch -> executeNodeStep ->
 * BoxHandler -> Backend.run), so a microtask-count-based flush (fine for the
 * Semaphore's own unit tests above, which have no such chain) would be
 * guessing how many ticks are enough and would break the moment any layer
 * gains or loses an intervening await. A real setTimeout only returns once
 * the whole synchronous-plus-microtask backlog up to that point has
 * genuinely drained, so this is robust to the exact shape of that chain.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition was not met within the timeout')
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
}

/** A real git repository, for the worktree-lifecycle row -- same setup test/worktree.test.ts already uses. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-parallel-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'seed.txt'), 'seed', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

function concurrencyGraph(maxParallel: number): string {
  return `
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=parallelogram, tool_command="unused", max_parallel="${maxParallel}"]
      r1 [shape=box, prompt="x"]
      r2 [shape=box, prompt="x"]
      r3 [shape=box, prompt="x"]
      start -> fanout
      fanout -> r1 [condition="context.never_true=x", isolate="false"]
      fanout -> r2 [condition="context.never_true=x", isolate="false"]
      fanout -> r3 [condition="context.never_true=x", isolate="false"]
      r1 -> done
      r2 -> done
      r3 -> done
    }
  `
}

// ---------------------------------------------------------------------------
// Row 1 -- FR-17b/NFR-7 concurrency ceiling.
// ---------------------------------------------------------------------------

/**
 * Wraps GatedBackend with a monotonically-growing set of node ids that have
 * actually reached run() (and therefore have a live gate that release() can
 * act on). Needed because GatedBackend.inFlight alone is a bare NUMBER that
 * cannot distinguish "still counting the branch we just released, mid
 * decrement" from "a NEW branch has started" when both states read the
 * identical value -- true whenever max_parallel is small enough that inFlight
 * only ever toggles between the same one or two numbers (e.g. max_parallel=1,
 * where it is always 0 or 1). Polling `inFlight === N` a second time for the
 * SAME N is therefore a real race, not a hypothetical one: release() called
 * before the next branch's own gate exists is a silent no-op
 * (test/fixtures.ts's own documented contract), which was observed to hang a
 * whole test run -- the very first version of these three tests used
 * `inFlight === N` for every wait and deadlocked on the second branch every
 * time, confirmed with a standalone repro before switching to this. `started`
 * only ever grows, so waiting for its SIZE to advance has no such ambiguity.
 */
class TrackingBackend implements Backend {
  private readonly inner = new GatedBackend()
  readonly started = new Set<string>()

  get inFlight(): number {
    return this.inner.inFlight
  }

  get maxObserved(): number {
    return this.inner.maxObserved
  }

  async run(
    node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal, cwd?: string,
  ): Promise<Outcome> {
    this.started.add(node.id)
    return this.inner.run(node, prompt, context, graph, signal, cwd)
  }

  release(nodeId: string): void {
    this.inner.release(nodeId)
  }
}

test('ParallelHandler: max_parallel=1 admits exactly one concurrent branch at a time', async () => {
  const backend = new TrackingBackend()
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(concurrencyGraph(1))
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const runPromise = engine.run()

    await waitFor(() => backend.started.size === 1)
    assert.equal(backend.maxObserved, 1)
    backend.release('r1')

    await waitFor(() => backend.started.size === 2)
    assert.equal(backend.maxObserved, 1, 'r2 only started once r1 fully released its slot')
    backend.release('r2')

    await waitFor(() => backend.started.size === 3)
    assert.equal(backend.maxObserved, 1, 'r3 only started once r2 fully released its slot')
    backend.release('r3')

    await runPromise
    assert.equal(backend.maxObserved, 1, 'never more than one branch ran concurrently')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('ParallelHandler: max_parallel=3 (branch count) admits all three branches concurrently', async () => {
  const backend = new TrackingBackend()
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(concurrencyGraph(3))
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const runPromise = engine.run()

    await waitFor(() => backend.started.size === 3)
    assert.equal(backend.maxObserved, 3, 'all three branches were genuinely in flight at once')
    backend.release('r1')
    backend.release('r2')
    backend.release('r3')

    await runPromise
    assert.equal(backend.maxObserved, 3)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('ParallelHandler: max_parallel=2 (branch count - 1) admits two concurrently; the third queues and backfills the freed slot', async () => {
  const backend = new TrackingBackend()
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(concurrencyGraph(2))
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const runPromise = engine.run()

    await waitFor(() => backend.started.size === 2)
    assert.equal(
      backend.maxObserved, 2,
      'only two of the three branches got a permit -- the third is queued behind the semaphore',
    )

    backend.release('r1')
    await waitFor(() => backend.started.size === 3)
    assert.equal(
      backend.maxObserved, 2,
      'the queued branch backfilled the slot r1 freed -- concurrency never exceeded 2',
    )

    backend.release('r2')
    backend.release('r3')
    await runPromise
    assert.equal(backend.maxObserved, 2)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test(
  'ParallelHandler: max_parallel="0" is clamped to 1 -- branches run one at a time and the dispatch genuinely completes, rather than deadlocking forever',
  async () => {
    const backend = new TrackingBackend()
    const handlers = defaultHandlers(backend)
    handlers.set(Handler.TOOL, new ParallelHandler())
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(concurrencyGraph(0))
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const runPromise = engine.run()

      await waitFor(() => backend.started.size === 1)
      assert.equal(backend.maxObserved, 1, 'max_parallel="0" behaves like max_parallel=1, not zero permits')
      backend.release('r1')

      await waitFor(() => backend.started.size === 2)
      assert.equal(backend.maxObserved, 1)
      backend.release('r2')

      await waitFor(() => backend.started.size === 3)
      assert.equal(backend.maxObserved, 1)
      backend.release('r3')

      // The whole point of the regression: pre-fix, this Promise never
      // settles (a zero-permit Semaphore admits nothing, so Promise.all
      // inside execute() hangs forever). waitFor above is only a bounded
      // backstop against a true hang -- this await is the real assertion
      // that the run genuinely completes.
      await runPromise
      assert.equal(backend.maxObserved, 1, 'never more than one branch ran concurrently')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

test(
  'ParallelHandler: max_parallel="-1" is clamped to 1 -- branches run one at a time and the dispatch genuinely completes, rather than deadlocking forever',
  async () => {
    const backend = new TrackingBackend()
    const handlers = defaultHandlers(backend)
    handlers.set(Handler.TOOL, new ParallelHandler())
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(concurrencyGraph(-1))
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const runPromise = engine.run()

      await waitFor(() => backend.started.size === 1)
      assert.equal(backend.maxObserved, 1, 'max_parallel="-1" behaves like max_parallel=1, not a negative/zero permit count')
      backend.release('r1')

      await waitFor(() => backend.started.size === 2)
      assert.equal(backend.maxObserved, 1)
      backend.release('r2')

      await waitFor(() => backend.started.size === 3)
      assert.equal(backend.maxObserved, 1)
      backend.release('r3')

      await runPromise
      assert.equal(backend.maxObserved, 1, 'never more than one branch ran concurrently')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Row 2 -- FR-17b worktree lifecycle: isolate default true creates and
// removes a real branch worktree; isolate="false" runs directly in the
// parent cwd and is never touched.
// ---------------------------------------------------------------------------

/** Records the cwd each branch-root node actually dispatched in, and whether that cwd existed at that moment. */
class CwdCapturingBackend implements Backend {
  readonly cwdByNode = new Map<string, string>()
  readonly existedDuringDispatch = new Map<string, boolean>()

  async run(
    node: Node, _prompt: string, _context: Context, _graph: Graph, _signal?: AbortSignal, cwd?: string,
  ): Promise<Outcome> {
    this.cwdByNode.set(node.id, cwd ?? '')
    this.existedDuringDispatch.set(node.id, cwd !== undefined && existsSync(cwd))
    return { status: Status.SUCCESS }
  }
}

test(
  'ParallelHandler: an isolated branch gets its own worktree, removed after it settles; ' +
  'an isolate="false" sibling runs directly in the parent cwd and is never touched',
  async () => {
    const repoDir = repo()
    const backend = new CwdCapturingBackend()
    const handlers = defaultHandlers(backend)
    handlers.set(Handler.TOOL, new ParallelHandler())
    const runDir = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fanout [shape=parallelogram, tool_command="unused"]
          iso [shape=box, prompt="x"]
          plain [shape=box, prompt="x"]
          start -> fanout
          fanout -> iso [condition="context.never_true=x"]
          fanout -> plain [condition="context.never_true=x", isolate="false"]
          iso -> done
          plain -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd: repoDir, handlers })
      await engine.run()

      const isoCwd = backend.cwdByNode.get('iso')
      assert.ok(isoCwd, 'iso dispatched with a cwd')
      assert.notEqual(isoCwd, repoDir, "the isolated branch ran in its OWN worktree, not the parent's cwd")
      assert.equal(
        backend.existedDuringDispatch.get('iso'), true,
        'the worktree existed on disk while iso was actually running in it',
      )
      assert.equal(existsSync(isoCwd as string), false, 'removeWorktree ran after iso settled -- the worktree is gone')

      assert.equal(backend.cwdByNode.get('plain'), repoDir, 'the isolate="false" sibling ran directly in the parent cwd')
      assert.equal(existsSync(repoDir), true, 'the parent repo itself was never touched by any cleanup')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(repoDir, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Rows 3 and 4 -- join-policy integration and merge-back-regardless-of-verdict.
// One 3-branch fixture, driven by StubBackend (no gating needed -- these rows
// are about the join VERDICT and the context MERGE, not concurrency).
// ---------------------------------------------------------------------------

function joinGraph(): string {
  return `
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fanout [shape=parallelogram, tool_command="unused"]
      r1 [shape=box, prompt="x"]
      r2 [shape=box, prompt="x"]
      r3 [shape=box, prompt="x"]
      start -> fanout
      fanout -> r1 [condition="context.never_true=x", isolate="false"]
      fanout -> r2 [condition="context.never_true=x", isolate="false"]
      fanout -> r3 [condition="context.never_true=x", isolate="false"]
      r1 -> done
      r2 -> done
      r3 -> done
    }
  `
}

/**
 * executeNodeStep (engine.ts:765) appends a node.end event with the
 * dispatched handler's own outcome.status immediately after handler.execute()
 * resolves, unconditionally -- so this reads ParallelHandler's own join
 * outcome back out, proving applyDefaultJoinPolicy's result is what actually
 * came back from execute(), not merely what applyDefaultJoinPolicy returns in
 * isolation (already covered above).
 */
function joinOutcomeFor(runDir: string): unknown {
  const events = new EventLog(runDir)
  return events.all().find((e) => e.type === 'node.end' && e.node === 'fanout')?.status
}

test("ParallelHandler: all branches SUCCEED -> the fan-out node's own join outcome is SUCCESS", async () => {
  const backend = new StubBackend({
    r1: { status: Status.SUCCESS }, r2: { status: Status.SUCCESS }, r3: { status: Status.SUCCESS },
  })
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(joinGraph())
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(joinOutcomeFor(runDir), Status.SUCCESS)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("ParallelHandler: one branch FAILs, two SUCCEED -> the fan-out node's own join outcome is PARTIAL", async () => {
  const backend = new StubBackend({
    r1: { status: Status.FAIL, notes: 'boom', failureReason: 'boom' },
    r2: { status: Status.SUCCESS },
    r3: { status: Status.SUCCESS },
  })
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(joinGraph())
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(joinOutcomeFor(runDir), Status.PARTIAL)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("ParallelHandler: all branches FAIL -> the fan-out node's own join outcome is FAIL", async () => {
  const backend = new StubBackend({
    r1: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
    r2: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
    r3: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
  })
  const handlers = defaultHandlers(backend)
  handlers.set(Handler.TOOL, new ParallelHandler())
  const runDir = tempDir()
  const cwd = tempDir()
  try {
    const graph = parseDot(joinGraph())
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(joinOutcomeFor(runDir), Status.FAIL)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test(
  "ParallelHandler: merge-back happens regardless of the join verdict -- a succeeding branch's " +
  'context reaches the parent even when the join outcome is not SUCCESS',
  async () => {
    const backend = new StubBackend({
      r1: { status: Status.FAIL, notes: 'boom', failureReason: 'boom' },
      r2: { status: Status.SUCCESS, contextUpdates: { 'r2.result': 'from-r2' } },
      r3: { status: Status.SUCCESS, contextUpdates: { 'r3.result': 'from-r3' } },
    })
    const handlers = defaultHandlers(backend)
    handlers.set(Handler.TOOL, new ParallelHandler())
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(joinGraph())
      const context = Context.from({})
      const engine = new Engine({ graph, context, runDir, cwd, handlers })
      await engine.run()

      assert.equal(joinOutcomeFor(runDir), Status.PARTIAL, 'the overall join verdict is NOT success')
      assert.equal(
        context.get('r2.result'), 'from-r2',
        "r2's context reached the parent even though the join verdict is PARTIAL, not SUCCESS",
      )
      assert.equal(context.get('r3.result'), 'from-r3')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// End-to-end (p5-08 whole story): a REAL Engine.run() over a graph with a
// genuine shape=component node -- not the Handler.TOOL-registered-as-
// ParallelHandler workaround every fixture above this point uses (necessary
// while Handler.PARALLEL was still in UNREGISTERED_HANDLER_KINDS and the
// engine had no convergence-jump). Now that both have landed, this proves
// core/engine.ts's defaultHandlers() registration and the ADR-013 A(a)
// convergence-jump work TOGETHER, the way a real graph author would actually
// trigger them: fan out to three branch roots, converge on a real join node,
// continue to done.
// ---------------------------------------------------------------------------

test(
  'end-to-end: a real shape=component node fans out to three branch roots, converges on a real ' +
  'join node, and the run completes (p5-08 registration + ADR-013 A(a))',
  async () => {
    const backend = new StubBackend({})
    const handlers = defaultHandlers(backend)
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component]
          r1 [shape=box, prompt="x"]
          r2 [shape=box, prompt="x"]
          r3 [shape=box, prompt="x"]
          join [shape=box, prompt="x"]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          fan -> r3 [isolate="false"]
          r1 -> join
          r2 -> join
          r3 -> join
          join -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const result = await engine.run()

      assert.equal(
        result.status, Status.SUCCESS,
        'all three branches succeed -> applyDefaultJoinPolicy -> SUCCESS -> the run continues past fan',
      )
      assert.deepEqual(
        result.path, ['start', 'fan', 'join', 'done'],
        'join immediately follows fan (the A(a) jump, not selectEdge) exactly once, with no branch-internal ' +
        'node (r1/r2/r3 -- dispatched only inside runBranch, never the outer path) and no phantom re-dispatch',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Row 5 -- ADR-013 A(b), row 1: a real createWorktree throw (forced via a
// non-git-repo cwd) does not reject Promise.all; an isolate="false" sibling
// in the same dispatch completes unaffected.
// ---------------------------------------------------------------------------

test(
  'ParallelHandler ADR-013 A(b) row 1: a real createWorktree throw on an isolated branch is caught ' +
  'and folded into FAIL; an isolate="false" sibling in the same dispatch completes unaffected',
  async () => {
    const backend = new GatedBackend()
    const handlers = defaultHandlers(backend)
    handlers.set(Handler.TOOL, new ParallelHandler())
    // Deliberately NOT a git repository -- createWorktree's own isGitRepo
    // check fails for real, and createWorktree throws for real
    // (run/worktree.ts:53-56), before ctx.runBranch is ever called for this
    // branch.
    const notAGitRepo = mkdtempSync(join(tmpdir(), 'attractor-parallel-notgit-'))
    const runDir = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fanout [shape=parallelogram, tool_command="unused"]
          isoFail [shape=box, prompt="x"]
          plainOk [shape=box, prompt="x"]
          start -> fanout
          fanout -> isoFail [condition="context.never_true=x"]
          fanout -> plainOk [condition="context.never_true=x", isolate="false"]
          isoFail -> done
          plainOk -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd: notAGitRepo, handlers })
      const runPromise = engine.run()

      // isoFail never reaches the backend at all (its createWorktree call
      // throws before ctx.runBranch is ever invoked) -- only plainOk gates.
      await waitFor(() => backend.inFlight === 1)
      backend.release('plainOk')

      // The whole point of ADR-013 A(b): Promise.all inside
      // ParallelHandler.execute() must still resolve here, never reject or
      // hang, even though one branch's own dispatch genuinely threw.
      await runPromise

      assert.equal(
        joinOutcomeFor(runDir), Status.PARTIAL,
        'exactly one of two branches failed (the caught createWorktree throw), the other succeeded',
      )

      // ParallelHandler exposes no per-branch BranchRunResult externally, by
      // design -- ADR-013's own residual-risk note: the failureReason string
      // is lost at the BranchRunResult boundary, same as every other caught
      // failure in this engine. The join outcome's own text is generic
      // ("1/2 branch(es) succeeded...") and not branch-specific, so it
      // cannot be read back through applyDefaultJoinPolicy either -- there is
      // no hook (no event; the finally guard in the handler's dispatchBranch
      // only runs removeWorktree, and thus only appends an event, when a
      // worktree was actually created, which never happened here) that
      // surfaces the exact string this branch's own catch block put into
      // failureReason. The strongest corroboration available from OUTSIDE
      // ParallelHandler.execute() is that the SAME createWorktree call this
      // handler makes internally, against the SAME non-git cwd, throws for
      // real with exactly the message run/worktree.ts's own catch block
      // would have captured verbatim (err.message) into that branch's own
      // failureReason.
      await assert.rejects(
        () => createWorktree(notAGitRepo, 'corroboration-only'),
        /cannot create an isolated worktree/,
        "the exact error text isoFail's own catch block received as err.message",
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(notAGitRepo, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Row 6 -- ADR-013 A(b), row 2: a hand-built HandlerCtx (no real Engine) whose
// runBranch rejects for one branch root. The real Engine.runBranch cannot
// currently be made to reject (executeNodeStep already catches a
// handler-level throw), so this is the only way to exercise ParallelHandler's
// own catch around ctx.runBranch! itself, independent of createWorktree.
// ---------------------------------------------------------------------------

test(
  'ParallelHandler ADR-013 A(b) row 2: a hand-built HandlerCtx whose runBranch rejects for one branch ' +
  'root still resolves; that branch folds into the join policy as FAIL, the resolving sibling is honored normally',
  async () => {
    const graph: Graph = {
      name: 'G',
      attrs: {},
      nodes: new Map<string, Node>([
        ['fanout', { id: 'fanout', attrs: {}, handler: Handler.PARALLEL }],
        ['boomRoot', { id: 'boomRoot', attrs: {}, handler: Handler.CODERGEN }],
        ['okRoot', { id: 'okRoot', attrs: {}, handler: Handler.CODERGEN }],
      ]),
      edges: [
        { from: 'fanout', to: 'boomRoot', attrs: { isolate: 'false' } },
        { from: 'fanout', to: 'okRoot', attrs: { isolate: 'false' } },
      ],
    }
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const ctx: HandlerCtx = {
        node: graph.nodes.get('fanout') as Node,
        graph,
        context: Context.from({}),
        runDir,
        cwd,
        events: new EventLog(runDir),
        runBranch: async (opts) => {
          if (opts.startNodeId === 'boomRoot') throw new Error('boom')
          return { outcome: { status: Status.SUCCESS, notes: 'ok' }, path: [opts.startNodeId], context: {} }
        },
      }
      const outcome = await new ParallelHandler().execute(ctx)
      assert.equal(
        outcome.status, Status.PARTIAL,
        'the rejecting branch folds in as FAIL, the resolving sibling as SUCCESS -- 1/2 settled',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Row 7 -- a fan-out node with zero outgoing edges short-circuits to FAIL
// without ever touching runBranch or worktree code.
// ---------------------------------------------------------------------------

test(
  'ParallelHandler: a fan-out node with zero outgoing edges short-circuits to FAIL without touching runBranch or worktree code',
  async () => {
    const graph: Graph = {
      name: 'G',
      attrs: {},
      nodes: new Map<string, Node>([['fanout', { id: 'fanout', attrs: {}, handler: Handler.PARALLEL }]]),
      edges: [],
    }
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      let runBranchCalled = false
      const ctx: HandlerCtx = {
        node: graph.nodes.get('fanout') as Node,
        graph,
        context: Context.from({}),
        runDir,
        cwd,
        events: new EventLog(runDir),
        runBranch: async () => {
          runBranchCalled = true
          throw new Error('must never be called for a zero-branch dispatch')
        },
      }
      const outcome = await new ParallelHandler().execute(ctx)
      assert.equal(outcome.status, Status.FAIL)
      assert.equal(outcome.failureReason, 'all 0 branch(es) failed')
      assert.equal(runBranchCalled, false, 'zero branches means dispatchBranch is never even constructed, let alone called')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Row 8 -- a real EventLog.append failure must never escape execute() and
// turn a genuinely-settled branch's own outcome into an unhandled rejection
// for every sibling in the same Promise.all.
//
// Both rows below subclass the REAL EventLog (src/run/events.ts) and override
// only `append`, exercising ParallelHandler's actual try/catch guards rather
// than a reimplementation of them.
// ---------------------------------------------------------------------------

/** Throws only for the specific event type finally-block worktree cleanup appends; every other event is logged normally. */
class ThrowsOnWorktreeWarningEventLog extends EventLog {
  append(event: RunEvent): void {
    if (event.type === 'node.parallel.worktree_warning') {
      throw new Error('disk full -- cannot write worktree_warning event')
    }
    super.append(event)
  }
}

test(
  'ParallelHandler regression: an events.append throw inside the finally-block worktree_warning write is ' +
  "swallowed -- the branch's own already-computed SUCCESS outcome survives, and execute() still resolves " +
  '(not reject) with the correct join verdict',
  async () => {
    const repoDir = repo()
    const runDir = tempDir()
    try {
      // Two branch roots off one fan-out: `dirtyRoot` is isolated (gets its
      // own real worktree via the real createWorktree/removeWorktree) and
      // deliberately leaves an uncommitted file behind, so the real
      // removeWorktree genuinely returns `removed: false` and the
      // worktree_warning append path is actually reached -- not simulated.
      // `cleanRoot` runs isolate="false", directly in repoDir, and is a
      // plain control to prove the sibling and the overall join verdict are
      // unaffected by the swallowed throw.
      const graph: Graph = {
        name: 'G',
        attrs: {},
        nodes: new Map<string, Node>([
          ['fanout', { id: 'fanout', attrs: {}, handler: Handler.PARALLEL }],
          ['dirtyRoot', { id: 'dirtyRoot', attrs: {}, handler: Handler.CODERGEN }],
          ['cleanRoot', { id: 'cleanRoot', attrs: {}, handler: Handler.CODERGEN }],
        ]),
        edges: [
          { from: 'fanout', to: 'dirtyRoot', attrs: {} },
          { from: 'fanout', to: 'cleanRoot', attrs: { isolate: 'false' } },
        ],
      }
      const ctx: HandlerCtx = {
        node: graph.nodes.get('fanout') as Node,
        graph,
        context: Context.from({}),
        runDir,
        cwd: repoDir,
        events: new ThrowsOnWorktreeWarningEventLog(runDir),
        runBranch: async (opts) => {
          if (opts.startNodeId === 'dirtyRoot') {
            writeFileSync(join(opts.cwd, 'uncommitted.txt'), 'never committed', 'utf8')
          }
          return { outcome: { status: Status.SUCCESS, notes: 'ok' }, path: [opts.startNodeId], context: {} }
        },
      }

      // Not asserted via assert.rejects -- the point IS that this resolves.
      const outcome = await new ParallelHandler().execute(ctx)

      assert.equal(
        outcome.status, Status.SUCCESS,
        "both branches' own real outcomes were SUCCESS -- the swallowed worktree_warning append throw " +
        'must not have overridden dirtyRoot\'s own already-computed result',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(repoDir, { recursive: true, force: true })
    }
  },
)

/** Throws for every event, unconditionally -- the "even best-effort logging is completely unavailable" case. */
class AlwaysThrowingEventLog extends EventLog {
  append(_event: RunEvent): void {
    throw new Error('disk full -- cannot write any event')
  }
}

test(
  'ParallelHandler regression: an events.append throw during mergeBranchContext\'s own collision logging is ' +
  'converted to a FAIL Outcome mentioning the thrown message, rather than rejecting execute()',
  async () => {
    const graph: Graph = {
      name: 'G',
      attrs: {},
      nodes: new Map<string, Node>([
        ['fanout', { id: 'fanout', attrs: {}, handler: Handler.PARALLEL }],
        ['r1', { id: 'r1', attrs: {}, handler: Handler.CODERGEN }],
        ['r2', { id: 'r2', attrs: {}, handler: Handler.CODERGEN }],
      ]),
      edges: [
        // isolate="false" on both -- no worktree involved, so the ONLY
        // events.append call either branch's own dispatch could trigger is
        // mergeBranchContext's own node.parallel.context_collision write
        // below, isolating this test to fix (2) specifically.
        { from: 'fanout', to: 'r1', attrs: { isolate: 'false' } },
        { from: 'fanout', to: 'r2', attrs: { isolate: 'false' } },
      ],
    }
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const ctx: HandlerCtx = {
        node: graph.nodes.get('fanout') as Node,
        graph,
        context: Context.from({}),
        runDir,
        cwd,
        events: new AlwaysThrowingEventLog(runDir),
        runBranch: async (opts) => ({
          outcome: { status: Status.SUCCESS, notes: 'ok' },
          path: [opts.startNodeId],
          // Both branches write the SAME key with DIFFERENT values -- r2
          // (declared last) collides with r1, forcing mergeBranchContext to
          // call events.append(node.parallel.context_collision), which this
          // fake EventLog throws on unconditionally.
          context: { 'shared.key': `from-${opts.startNodeId}` },
        }),
      }

      const outcome = await new ParallelHandler().execute(ctx)

      assert.equal(
        outcome.status, Status.FAIL,
        'a merge-back bookkeeping failure folds into FAIL rather than rejecting execute(), even though both ' +
        'branches themselves genuinely succeeded',
      )
      assert.match(
        outcome.failureReason ?? '', /disk full -- cannot write any event/,
        'the thrown message is preserved in failureReason, matching the fix\'s own shape',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Story's own acceptance criterion: retry/partial-completion interacting
// with convergence. Not covered by any task above -- exercised here for the
// first time, now that Handler.PARALLEL is genuinely registered (a real
// shape=component node, no Handler.TOOL workaround needed).
// ---------------------------------------------------------------------------

test(
  "retry/partial-completion interacting with convergence: a branch's exhausted-retry FAIL with a " +
  "declared outputs= key correctly blocks the convergence node via the existing eager-input check, " +
  "not silently fed a stale or empty value by mergeBranchContext's own FAIL-branch exclusion",
  async () => {
    const backend = new StubBackend({
      // RETRY, not a bare FAIL -- max_retries="0" means attempt(0) <
      // maxRetries(0) is false, so this exhausts on the very first dispatch,
      // converting to FAIL internally (engine.ts's own RETRY-handling
      // ladder) and recording shared.artifact into failedOutputs, owed by
      // r1 -- exactly the "exhausted-retry FAIL" this criterion names.
      r1: { status: Status.RETRY, notes: 'r1 needs another pass' },
      r2: { status: Status.SUCCESS },
    })
    const handlers = defaultHandlers(backend)
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component]
          r1 [shape=box, prompt="x", outputs="shared.artifact", max_retries="0"]
          r2 [shape=box, prompt="x"]
          join [shape=box, prompt="use \${shared.artifact}"]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          r1 -> join
          r2 -> join
          join -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const result = await engine.run()

      // r1's FAIL (no condition-matched edge, no retry_target) dead-ends
      // inside its own branch -- selectEdge's fail-fast rule refuses the
      // plain unconditional r1->join edge on a FAIL outcome, so r1's branch
      // never itself dispatches join. r2 succeeds. applyDefaultJoinPolicy
      // therefore returns PARTIAL (1 of 2 branches settled), so the A(a)
      // jump fires and the OUTER run continues at join directly.
      const events = new EventLog(runDir).all()
      const unavailable = events.find((e) => e.type === 'node.input_unavailable')
      assert.ok(unavailable, 'join is blocked by the eager-input check before its own handler ever runs')
      assert.equal(unavailable?.node, 'join')
      assert.equal(unavailable?.key, 'shared.artifact')
      assert.equal(
        unavailable?.owedBy, 'r1',
        "the check correctly attributes the missing key to r1 -- the failure happened INSIDE a branch, " +
        "not the main run, and this is the first time that distinction is exercised end-to-end",
      )
      assert.equal(result.status, Status.FAIL, "join's own dispatch fails on the unavailable input")
      assert.deepEqual(
        result.path, ['start', 'fan', 'join'],
        'the A(a) jump still fired -- join immediately follows fan in the OUTER path -- this is a ' +
        'join-node-level failure (blocked input), not a routing failure',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// ADR-013 A(a), the FAIL side. The SUCCESS/PARTIAL jump is well covered above
// (the end-to-end test and the retry/convergence test both assert `path`),
// but nothing yet proves the OTHER half: a component node's all-FAIL join
// outcome must never jump to the convergence node -- it must fall through to
// the ordinary retry_target/dead-end ladder, completely unmodified, exactly
// like any other node. Sprint 3's own review found this gap: the pre-existing
// "all branches FAIL -> the fan-out node's own join outcome is FAIL" test
// (above) only checks the node.end event's status field, never routing, and
// predates real Handler.PARALLEL registration. Both rows below use a real
// shape=component node -- no Handler.TOOL workaround needed.
// ---------------------------------------------------------------------------

test(
  'ADR-013 A(a) FAIL side: all branches FAIL, no retry_target -- the convergence node is never ' +
  'dispatched; the run dead-ends FAIL at the component node itself, exactly like any other node',
  async () => {
    const backend = new StubBackend({
      r1: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
      r2: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
    })
    const handlers = defaultHandlers(backend)
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component]
          r1 [shape=box, prompt="x"]  r2 [shape=box, prompt="x"]  join [shape=box, prompt="x"]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          r1 -> join
          r2 -> join
          join -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const result = await engine.run()

      const events = new EventLog(runDir).all()
      assert.ok(
        !events.some((e) => e.type === 'node.start' && e.node === 'join'),
        'the convergence node is NEVER dispatched on an all-FAIL join outcome -- no jump fired',
      )
      assert.equal(result.status, Status.FAIL)
      assert.deepEqual(
        result.path, ['start', 'fan'],
        'fan dead-ends on its own FAIL outcome -- selectEdge refuses the plain unconditional fan->* ' +
        'edges (there are none here, fan only has branch-root edges) and there is no retry_target',
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

test(
  'ADR-013 A(a) FAIL side: all branches FAIL, WITH a retry_target on the component node -- the run ' +
  'continues there, not at the convergence node -- the ordinary ladder is completely unmodified',
  async () => {
    const backend = new StubBackend({
      r1: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
      r2: { status: Status.FAIL, notes: 'x', failureReason: 'x' },
    })
    const handlers = defaultHandlers(backend)
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component, retry_target="recover"]
          r1 [shape=box, prompt="x"]  r2 [shape=box, prompt="x"]  join [shape=box, prompt="x"]
          recover [shape=box, prompt="x"]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          r1 -> join
          r2 -> join
          join -> done
          recover -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const result = await engine.run()

      const events = new EventLog(runDir).all()
      assert.ok(
        !events.some((e) => e.type === 'node.start' && e.node === 'join'),
        'the convergence node is still never dispatched -- retry_target wins, not the A(a) jump',
      )
      assert.ok(
        events.some((e) => e.type === 'node.fail.retry_target' && e.node === 'fan' && e.target === 'recover'),
        "engine.ts's own pre-existing retry_target ladder fired for fan, completely unmodified by this story",
      )
      assert.deepEqual(
        result.path, ['start', 'fan', 'recover', 'done'],
        'the run continues at retry_target, never at the convergence node',
      )
      assert.equal(result.status, Status.SUCCESS, 'recover succeeds via StubBackend\'s default entry')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// p5-09: checkpoint isolation through the REAL dispatch path. The property
// itself (distinct runDir per branch/run -- closed by construction, per
// architecture.md's own Component structure item 6) was already proven once,
// in test/engine.test.ts ("a branch root routed straight to the real EXIT
// node is an ordinary dead end for that branch alone (mutation-checked)"),
// but that test predates Handler.PARALLEL's own registration and had to
// drive ctx.runBranch! by hand through a Handler.TOOL-registered
// BranchLaunchingHandler. Now that Kind.PARALLEL is genuinely wired into
// defaultHandlers() (p5-08), this is the same property proven through a real
// shape=component node dispatching a real ParallelHandler end to end -- no
// test double standing in for it.
// ---------------------------------------------------------------------------

test(
  "checkpoint isolation under a real fan-out (NFR-7): while a real ParallelHandler's branches are " +
  "still gated open, the OUTER run's own checkpoint.json never names a branch-interior node, and " +
  "each branch's own checkpoint.json is a distinct, uncontaminated file",
  async () => {
    const backend = new TrackingBackend()
    const handlers = defaultHandlers(backend)
    const runDir = tempDir()
    const cwd = tempDir()
    try {
      // Each branch is TWO nodes deep (root -> hold -> join) rather than one,
      // deliberately: the checkpoint write for a node only happens AFTER its
      // own handler.execute() resolves (engine.ts's executeNodeStep), so a
      // one-node branch whose only node is the one TrackingBackend gates open
      // would have no checkpoint file to read yet -- there would be nothing
      // written mid-flight to prove isolation against. Releasing the root
      // lets each branch advance one hop further, into its OWN second node,
      // which then stays gated open -- giving each branch's own
      // checkpoint.json a real, already-written entry to read back while its
      // sibling and the outer run are still in flight.
      const graph = parseDot(`
        digraph G {
          start [shape=Mdiamond]  done [shape=Msquare]
          fan [shape=component]
          r1 [shape=box, prompt="x"]
          r1hold [shape=box, prompt="x"]
          r2 [shape=box, prompt="x"]
          r2hold [shape=box, prompt="x"]
          join [shape=box, prompt="x"]
          start -> fan
          fan -> r1 [isolate="false"]
          fan -> r2 [isolate="false"]
          r1 -> r1hold -> join
          r2 -> r2hold -> join
          join -> done
        }
      `)
      const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
      const runPromise = engine.run()

      await waitFor(() => backend.started.size === 2)
      assert.ok(
        backend.started.has('r1') && backend.started.has('r2'),
        'both branch roots genuinely reached the real backend at once',
      )
      backend.release('r1')
      backend.release('r2')

      await waitFor(() => backend.started.size === 4)
      assert.ok(
        backend.started.has('r1hold') && backend.started.has('r2hold'),
        "both branches advanced one hop further, into their OWN second node, still gated open",
      )

      // The OUTER run's own checkpoint.json: fan's own handler
      // (ParallelHandler.execute()) is still awaiting both branches inside
      // its own Promise.all -- the checkpoint write for fan's OWN dispatch
      // (engine.ts's executeNodeStep, immediately after handler.execute()
      // resolves) has therefore not happened yet, so the outer run's
      // checkpoint.json is still whatever 'start' (the node immediately
      // before fan) left it as.
      const outerMidFlight = loadCheckpoint(runDir)
      assert.equal(
        outerMidFlight?.currentNode, 'start',
        "the outer run's own checkpoint stays at 'start' throughout -- never 'fan' and never a branch-interior node id",
      )

      // Each branch's own checkpoint.json, at its own branch-scoped runDir.
      // src/handlers/parallel.ts's ParallelHandler.execute() (dispatchBranch)
      // passes `runDir: join(runDir, rootId)` into ctx.runBranch! per branch
      // -- so r1's own file lives at join(runDir, 'r1'), r2's at
      // join(runDir, 'r2'), each distinct from the outer run's own runDir
      // and from its sibling's.
      const r1RunDir = join(runDir, 'r1')
      const r2RunDir = join(runDir, 'r2')
      assert.notEqual(r1RunDir, r2RunDir)
      assert.notEqual(r1RunDir, runDir)
      assert.notEqual(r2RunDir, runDir)

      const r1MidFlight = loadCheckpoint(r1RunDir)
      const r2MidFlight = loadCheckpoint(r2RunDir)
      assert.ok(r1MidFlight, "r1's own checkpoint.json exists independently, mid-flight")
      assert.ok(r2MidFlight, "r2's own checkpoint.json exists independently, mid-flight")
      assert.equal(
        r1MidFlight?.currentNode, 'r1',
        "r1's own checkpoint reflects only r1's own interior progress (its root node, already settled) -- " +
        "not r2's, and not the outer run's",
      )
      assert.equal(
        r2MidFlight?.currentNode, 'r2',
        "r2's own checkpoint reflects only r2's own interior progress -- not r1's, and not the outer run's",
      )

      backend.release('r1hold')
      backend.release('r2hold')

      // Both branches have now fully settled inside ParallelHandler's own
      // Promise.all -- fan's own dispatch resolves, its OWN checkpoint write
      // happens (currentNode: 'fan'), and the A(a) convergence jump dispatches
      // 'join' next (still through the same gated backend). Caught here,
      // gated open, before 'join' itself resolves: exactly the window where
      // the outer run's own checkpoint has advanced past 'start' to 'fan',
      // and each branch's own final checkpoint is already settled and
      // stable, unaffected by anything happening at 'join' or the outer run.
      await waitFor(() => backend.started.has('join'))

      const r1Final = loadCheckpoint(r1RunDir)
      const r2Final = loadCheckpoint(r2RunDir)
      assert.equal(
        r1Final?.currentNode, 'r1hold',
        "r1's own FINAL checkpoint reflects only r1's own interior progress ('r1hold', its last dispatched " +
        "node before the join frontier) -- never r2's",
      )
      assert.equal(
        r2Final?.currentNode, 'r2hold',
        "r2's own FINAL checkpoint reflects only r2's own interior progress -- never r1's",
      )
      assert.equal(
        loadCheckpoint(runDir)?.currentNode, 'fan',
        "the outer run's own checkpoint only advances to 'fan' AFTER ParallelHandler.execute() -- and " +
        "therefore both branches -- have fully resolved",
      )

      backend.release('join')
      const result = await runPromise
      assert.equal(result.status, Status.SUCCESS, 'both branches settle, the join succeeds, the run completes normally')
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)
