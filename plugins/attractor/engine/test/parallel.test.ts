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
import { mergeBranchContext } from '../src/handlers/parallel.ts'
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
