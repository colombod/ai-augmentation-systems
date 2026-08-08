import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { type Graph, type Node, Handler } from '../src/dot/graph.ts'
import {
  type Backend, type BranchRunResult, type HandlerCtx, type Handler as HandlerIface,
} from '../src/handlers/types.ts'
import { mergeBranchContext, applyDefaultJoinPolicy, Semaphore } from '../src/handlers/parallel.ts'
import { EventLog } from '../src/run/events.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'

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
  assert.equal(outcome.failureReason, 'all 2 branch(es) failed')
})

test('applyDefaultJoinPolicy: mixed SUCCESS + FAIL -> PARTIAL', () => {
  const results = [
    branchResult(Status.SUCCESS, {}),
    branchResult(Status.FAIL, {}),
    branchResult(Status.SUCCESS, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.PARTIAL)
  assert.equal(outcome.notes, '2/3 branch(es) succeeded or partially succeeded')
})

test('applyDefaultJoinPolicy: mixed PARTIAL + FAIL -> PARTIAL (PARTIAL counts as settled)', () => {
  const results = [
    branchResult(Status.PARTIAL, {}),
    branchResult(Status.FAIL, {}),
  ]
  const outcome = applyDefaultJoinPolicy(results)
  assert.equal(outcome.status, Status.PARTIAL)
  assert.equal(outcome.notes, '1/2 branch(es) succeeded or partially succeeded')
})

test('applyDefaultJoinPolicy: single branch SUCCEEDS -> SUCCESS', () => {
  const outcome = applyDefaultJoinPolicy([branchResult(Status.SUCCESS, {})])
  assert.equal(outcome.status, Status.SUCCESS)
})

test('applyDefaultJoinPolicy: single branch FAILS -> FAIL', () => {
  const outcome = applyDefaultJoinPolicy([branchResult(Status.FAIL, {})])
  assert.equal(outcome.status, Status.FAIL)
  assert.equal(outcome.failureReason, 'all 1 branch(es) failed')
})

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
