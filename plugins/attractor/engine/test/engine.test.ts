import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { lint, hasErrors, Severity } from '../src/dot/lint.ts'
import { Context, isEngineManagedKey } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { type Backend, type HandlerCtx, type Handler as HandlerIface } from '../src/handlers/types.ts'
import {
  Handler,
  RunsOn,
  runsOn,
  SUBSTITUTABLE_ATTRS,
  substitutableText,
  type Graph,
  type Node,
} from '../src/dot/graph.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'
import { BOX_CONTEXT_KEYS } from '../src/handlers/box.ts'
import { loadCheckpoint } from '../src/core/checkpoint.ts'
import { EventLog } from '../src/run/events.ts'
import { LINT_FAILS_BUT_WOULD_RUN, GatedBackend } from './fixtures.ts'
import { type BranchRunResult as BranchRunResultShape } from '../src/handlers/types.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-engine-'))
}

/**
 * runDir and cwd are two genuinely separate sibling temp directories, not
 * one directory serving both roles. A regression that swapped them in
 * EngineOptions would be invisible if the two were ever the same path, and
 * Plan 2's worktree isolation depends on that not being possible.
 */
function tempDirs(): { runDir: string; cwd: string } {
  return { runDir: tempDir(), cwd: tempDir() }
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}

async function execute(
  src: string,
  script: Record<string, Outcome | Outcome[]> = {},
  maxSteps?: number,
) {
  const { runDir, cwd } = tempDirs()
  const graph = parseDot(src)
  const backend = new StubBackend(script)
  const engine = new Engine({
    graph,
    context: Context.from({}),
    runDir,
    cwd,
    handlers: defaultHandlers(backend),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  })
  const result = await engine.run()
  return { result, runDir, cwd, backend }
}

const LINEAR = `
digraph L {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="first"]
  b [shape=box, prompt="second"]
  start -> a -> b -> done
}
`

test('a linear pipeline runs to the exit node', async () => {
  const { result, runDir, cwd } = await execute(LINEAR)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.path, ['start', 'a', 'b', 'done'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a checkpoint is written as the run advances', async () => {
  const { runDir, cwd } = await execute(LINEAR)
  try {
    const cp = loadCheckpoint(runDir)
    assert.ok(cp, 'checkpoint exists')
    assert.ok(cp!.completed.includes('a'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// The marker file `.ok` is written by the shell command below relative to
// the engine's cwd, which is now a directory distinct from runDir. The gate
// still converges because cwd stays constant across both visits to `verify`
// within a single run -- only the runDir/cwd split changed, not the
// semantics of where a tool_command executes.
const CONVERGENCE = `
digraph C {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  attempt [shape=box, prompt="work"]
  verify  [shape=parallelogram, tool_command="if [ -f .ok ]; then printf green; else touch .ok; printf red; exit 1; fi"]
  start -> attempt -> verify
  verify -> done    [condition="context.tool.last_line=green && outcome=success"]
  verify -> attempt [condition="outcome=fail"]
}
`

test('a convergence loop iterates until the gate goes green', async () => {
  const { result, runDir, cwd } = await execute(CONVERGENCE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(result.path.filter((n) => n === 'attempt').length, 2)
    assert.equal(result.path[result.path.length - 1], 'done')
  } finally {
    cleanup(runDir, cwd)
  }
})

const NO_ROUTE = `
digraph N {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  start -> a -> done
}
`

test('a failure with no explicit failure route terminates the run', async () => {
  const { result, runDir, cwd } = await execute(NO_ROUTE, {
    a: { status: Status.FAIL, notes: 'boom' },
  })
  try {
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /no matching edge/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

const RETRYING = `
digraph R {
  graph [default_max_retries=2]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  start -> a -> done
}
`

test('a retry status re-executes the node up to the cap then fails', async () => {
  const { result, backend, runDir, cwd } = await execute(RETRYING, {
    a: { status: Status.RETRY, notes: 'again' },
  })
  try {
    assert.equal(backend.calls().filter((c) => c.nodeId === 'a').length, 3)
    assert.equal(result.status, Status.FAIL)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a retry that later succeeds continues the run', async () => {
  const { result, backend, runDir, cwd } = await execute(RETRYING, {
    a: [
      { status: Status.RETRY, notes: 'again' },
      { status: Status.SUCCESS, notes: 'ok' },
    ],
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    // Asserting SUCCESS alone would not discriminate: RETRY is an edge-eligible
    // status, so with the retry block deleted the first outcome would simply
    // take the unconditional edge and still finish successfully. The call count
    // is what proves the node was actually re-executed.
    assert.equal(
      backend.calls().filter((c) => c.nodeId === 'a').length,
      2,
      'the node must be executed twice, not routed onward on the first RETRY',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

const GOAL_GATE = `
digraph U {
  graph [retry_target="fix"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  fix  [shape=box, prompt="fix it"]
  gate [shape=parallelogram, goal_gate=true, tool_command="if [ -f .g ]; then printf ok; else touch .g; printf ok; fi"]
  start -> fix -> gate -> done
}
`

// The gate FAILS, and an explicit failure edge carries the run to the exit
// anyway. Nothing but the goal-gate check stands between this graph and a
// false success -- which is the entire reason goal gates exist.
const UNSATISFIED_GATE = `
digraph UG {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work [shape=box, prompt="work"]
  gate [shape=parallelogram, goal_gate=true, max_retries=0,
        tool_command="printf notyet; exit 1"]
  start -> work -> gate
  gate -> done [condition="outcome=success"]
  gate -> done [condition="outcome=fail"]
}
`

test('reaching the exit with an unsatisfied goal gate fails loudly', async () => {
  const { result, runDir, cwd } = await execute(UNSATISFIED_GATE)
  try {
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /unsatisfied goal gates/i)
    assert.ok(result.notes?.includes('gate'), 'the message names the offending gate')
  } finally {
    cleanup(runDir, cwd)
  }
})

// Same shape, but the graph declares somewhere to go back to, and the gate
// succeeds on its second visit.
const UNSATISFIED_THEN_RETRIED = `
digraph UGR {
  graph [retry_target="work"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work [shape=box, prompt="work"]
  gate [shape=parallelogram, goal_gate=true, max_retries=0,
        tool_command="if [ -f .seen ]; then printf ok; else touch .seen; printf notyet; exit 1; fi"]
  start -> work -> gate
  gate -> done [condition="outcome=success"]
  gate -> done [condition="outcome=fail"]
}
`

test('an unsatisfied goal gate at the exit routes to the retry target', async () => {
  const { result, runDir, cwd } = await execute(UNSATISFIED_THEN_RETRIED)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(
      result.path.filter((n) => n === 'work').length,
      2,
      'the exit must have sent the run back to work rather than exiting unearned',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a satisfied goal gate permits exit', async () => {
  const { result, runDir, cwd } = await execute(GOAL_GATE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('done'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// C5: the retry default is now 0 (spec section 3.5), so a goal gate that
// declares no retry attributes and no retry_target gets exactly one attempt
// before the run ends -- not the two extra in-place re-invocations it got
// under the old default of 2. The doctrine itself is unaffected: the gate
// never reports SUCCESS on unearned prose either way. Only *how many times*
// and *where an exhausted RETRY goes* changed. This pins that split so a
// future change to the default (in either direction) has to make a deliberate
// decision about both halves rather than silently drifting.
const UNGUARDED_GATE = `
digraph GG1 {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  gate  [shape=box, goal_gate=true, prompt="judge"]
  start -> gate -> done
}
`

test('a fail-closed goal gate with no retry attributes and no retry_target gets exactly one attempt', async () => {
  const { result, backend, runDir, cwd } = await execute(UNGUARDED_GATE, {
    gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
  })
  try {
    assert.equal(result.status, Status.FAIL)
    assert.notEqual(result.status, Status.SUCCESS, 'fail-closed: prose can never pass the gate')
    assert.equal(
      backend.calls().filter((c) => c.nodeId === 'gate').length,
      1,
      'the default of 0 retries means the gate is invoked exactly once, not re-run in place',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// Carry-forward item, confirmed but deliberately NOT fixed here (see
// task-3-report.md): the exit-triggered goal-gate retry loop applies no
// backoff and no diagnostic. With a retry_target configured, a gate that
// never earns a verdict routes straight back to itself every time it is
// exhausted -- attempt(0) < maxRetries(0) is always false, so there is never
// an in-place retry to slow it down. Nothing bounds the loop except the
// engine's step cap (500 by default), which against a real backend is real
// spend before anything intervenes. This test only pins that the loop
// terminates and never falsely reports SUCCESS; it deliberately does not
// assert an attempt count or path length, since that would pin the step
// cap's current value rather than the behaviour it exists to bound.
//
// The self-reference is declared on `gate` itself, not the graph. Before the
// D7 fix, `gate`'s own retry-exhaustion (section 3.7's ladder) wrongly
// consulted the graph-level `retry_target` too, so a purely graph-level
// self-loop produced this exact spin. After D7, section 3.7's ladder for a
// node that is not the EXIT never reads the graph-level rungs, so the
// self-loop must be declared on the node to still exist -- and it still can
// be, which is what this test now pins.
const SELF_ROUTING_GATE = `
digraph GG2 {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  gate  [shape=box, goal_gate=true, prompt="judge", retry_target="gate"]
  start -> gate -> done
}
`

// A Task 3 reviewer flagged that this test relied on nothing but the shipped
// 500-step default to bound the loop: if the step-counter logic ever broke
// (e.g. stopped incrementing, or the comparison flipped), this test would
// hang the suite instead of failing. maxSteps=40 gives the same "it
// terminates, never SUCCESS" guarantee with a fast, deterministic bound --
// still not asserting the step-cap *number* (that would pin an implementation
// detail this test isn't about), just capping how long a broken counter can
// spin before the test itself fails loudly.
test('an unearnable goal gate with a retry_target terminates at the step cap, never SUCCESS', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(SELF_ROUTING_GATE),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(
        new StubBackend({
          gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
        }),
      ),
      maxSteps: 40,
    })
    const result = await engine.run()
    assert.notEqual(result.status, Status.SUCCESS, 'fail-closed: prose can never pass the gate')
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /step cap/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

// Spec section 10.6's own worked example of the loop-guard idiom:
// `review -> iterate [condition="context.loop_state!=exhausted"]`. Before the
// C2 fix, a missing `context.loop_state` made leftValue return undefined and
// the whole condition failed closed for `!=` as well as `=` -- so this edge
// was never eligible on the first pass, and the parallel
// `condition="context.loop_state=exhausted"` edge was (wrongly) not eligible
// either, since it hit the same fail-closed path. The graph below never sets
// `loop_state` at all, so under the old semantics neither conditional edge on
// `review` would ever match and the run would dead-end with "no matching
// edge" instead of reaching `iterate`. This test runs the idiom through
// Engine.run() end to end -- not just evaluateCondition in isolation -- to
// pin the fix at the level a pipeline author would actually notice it.
const LOOP_GUARD = `
digraph LoopGuard {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  review  [shape=box, prompt="review"]
  iterate [shape=parallelogram, tool_command="printf ok"]
  finish  [shape=parallelogram, tool_command="printf ok"]
  start -> review
  review -> iterate [condition="context.loop_state!=exhausted"]
  review -> finish  [condition="context.loop_state=exhausted"]
  iterate -> done
  finish  -> done
}
`

test('the spec loop-guard idiom routes before the key is set', async () => {
  const { result, runDir, cwd } = await execute(LOOP_GUARD, {
    review: { status: Status.SUCCESS, notes: 'ok' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('iterate'), 'the != guard must be eligible before loop_state exists')
    assert.ok(!result.path.includes('finish'), 'the = branch must not match an unset key')
  } finally {
    cleanup(runDir, cwd)
  }
})

// Same idiom, unqualified (no `context.` prefix) -- this is the C3 half of
// the fix (spec section 10.4: "direct context lookup for unqualified keys"),
// previously covered only at the evaluateCondition unit level.
const LOOP_GUARD_UNQUALIFIED = `
digraph LoopGuardUnqualified {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  review  [shape=box, prompt="review"]
  iterate [shape=parallelogram, tool_command="printf ok"]
  finish  [shape=parallelogram, tool_command="printf ok"]
  start -> review
  review -> iterate [condition="loop_state!=exhausted"]
  review -> finish  [condition="loop_state=exhausted"]
  iterate -> done
  finish  -> done
}
`

test('the spec loop-guard idiom also works unqualified, without the context. prefix (C3)', async () => {
  const { result, runDir, cwd } = await execute(LOOP_GUARD_UNQUALIFIED, {
    review: { status: Status.SUCCESS, notes: 'ok' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('iterate'), 'the != guard must be eligible before loop_state exists')
    assert.ok(!result.path.includes('finish'), 'the = branch must not match an unset key')
  } finally {
    cleanup(runDir, cwd)
  }
})

// C4, first half. Spec section 3.4 checks all *visited* nodes with
// goal_gate=true. `unreached` sits behind a condition that never matches, so
// the run legitimately never took that branch -- it is not evidence the run
// failed to earn. Iterating every *declared* node instead made this graph
// unexitable: the gate could never be satisfied, so the exit bounced to its
// retry target until the step cap and then reported FAIL.
const UNVISITED_GATE = `
digraph U {
  start [shape=Mdiamond]  done [shape=Msquare]
  work [shape=box, prompt="x"]
  unreached [shape=parallelogram, goal_gate=true, tool_command="printf ok"]
  start -> work
  work -> done
  work -> unreached [condition="context.never=1"]
  unreached -> done
}
`

test('a goal gate on an untaken branch does not block exit (C4)', async () => {
  const { result, runDir, cwd } = await execute(UNVISITED_GATE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(!result.path.includes('unreached'), 'the branch really was never taken')
  } finally {
    cleanup(runDir, cwd)
  }
})

// C4, second half. Spec section 3.4 asks whether a visited gate's outcome is
// non-success; ours recorded satisfaction in a Set that was never cleared, so
// a gate that passed on iteration 1 and failed on iteration 3 still permitted
// exit. This gate succeeds on its first visit and fails on its second, and
// the LATEST outcome is what decides.
const GATE_REGRESSES = `
digraph R {
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=parallelogram, goal_gate=true, max_retries=0,
        tool_command="if [ -f .once ]; then printf red; exit 1; else touch .once; printf ok; fi"]
  loop [shape=box, prompt="again"]
  start -> gate
  gate -> loop [condition="outcome=success"]
  loop -> gate
  gate -> done [condition="outcome=fail"]
}
`

test('a goal gate that later fails blocks exit again (C4)', async () => {
  const { result, runDir, cwd } = await execute(GATE_REGRESSES)
  try {
    assert.equal(result.status, Status.FAIL, 'the latest gate outcome was a failure')
    assert.match(result.notes ?? '', /unsatisfied goal gates/i)
    assert.ok(result.notes?.includes('gate'), 'the message names the offending gate')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The fail-open hole that scoping gates to *visited* nodes could have opened,
// pinned so it cannot. `gate` returns prose, the fail-closed doctrine
// downgrades it to RETRY, and with no retries left it jumps to its retry
// target -- which routes to the exit WITHOUT re-entering the gate. The gate
// was visited and its latest outcome is RETRY, so the exit must still be
// refused. Recording gate outcomes only on the fall-through path (rather than
// as soon as the handler returns) would leave this run reporting SUCCESS with
// an unearned gate, which is precisely the upstream false-success the
// fail-closed doctrine exists to stop.
const GATE_RETRIES_PAST_ITSELF = `
digraph GRT {
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=box, goal_gate=true, prompt="judge", retry_target="sidestep"]
  sidestep [shape=box, prompt="sidestep"]
  start -> gate
  gate -> done
  sidestep -> done
}
`

// WHAT THIS TEST ASSERTS CHANGED WHEN SECTION 3.4's LADDER WAS CORRECTED, and
// the change is the corrected behaviour rather than an accommodation.
//
// The gate declares `retry_target="sidestep"`. The exit's gate check used to
// resolve its target from the EXIT node, found none anywhere, and terminated
// with "exit reached with unsatisfied goal gates". Section 3.4 step 3 says to
// use the target OF THE GATE, so the exit now jumps to `sidestep` -- and this
// graph routes `sidestep -> done` without re-entering the gate, so the run
// bounces between the exit and `sidestep` until the step cap stops it.
//
// That bounce is the graph's defect, not the engine's: an author who names a
// repair target that does not lead back to the gate has written a loop, and
// the spec has no other answer -- its own pseudocode `CONTINUE`s to the target
// unconditionally. The step cap is what makes it terminate at all.
//
// THE CLAIM THIS TEST WAS WRITTEN TO PIN IS UNCHANGED AND STILL ASSERTED: a
// gate that retries away and never returns must never let the run report
// SUCCESS. Recording gate outcomes only on the fall-through path would still
// break it. Two assertions are ADDED to cover the new behaviour: the gate's
// own target is the one consulted, and it is consulted repeatedly rather than
// once. `maxSteps` is lowered so a deliberately non-terminating graph does not
// spend 500 checkpointed iterations proving it.
test('a goal gate that retries away and never returns still blocks the exit', async () => {
  const { result, runDir, cwd } = await execute(
    GATE_RETRIES_PAST_ITSELF,
    { gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' } },
    10,
  )
  try {
    assert.notEqual(result.status, Status.SUCCESS, 'fail-closed: prose can never pass the gate')
    assert.equal(result.status, Status.FAIL)
    assert.ok(result.path.includes('sidestep'), 'the run did route around the gate')

    // Section 3.4 step 3: the target came from the GATE, not the exit.
    const events = new EventLog(runDir).all()
    const blocks = events.filter((e) => e.type === 'pipeline.goal_gate_block')
    assert.ok(blocks.length > 0, 'the exit refused to let the run out')
    assert.deepEqual(blocks[0].unsatisfied, ['gate'])
    assert.equal(blocks[0].target, 'sidestep', "the gate's own retry_target is what the exit used")
  } finally {
    cleanup(runDir, cwd)
  }
})

// C6. Spec section 3.7's failure ladder is: 1. fail edge, 2. node retry
// target, 3. fallback retry target, 4. termination. Step 2 was unreachable --
// resolveRetryTarget was consulted only when a RETRY status exhausted its
// attempts, never on a FAIL outcome -- so this run ended at `failing` instead
// of jumping to `recover`.
const FAIL_TO_RETRY_TARGET = `
digraph F {
  start [shape=Mdiamond]  done [shape=Msquare]
  recover [shape=box, prompt="recover"]
  failing [shape=box, prompt="x", retry_target="recover", max_retries=0]
  start -> failing
  recover -> done
}
`

test('a FAIL outcome consults the node retry target (C6)', async () => {
  const { result, backend, runDir, cwd } = await execute(FAIL_TO_RETRY_TARGET, {
    failing: { status: Status.FAIL, notes: 'boom' },
  })
  try {
    assert.ok(result.path.includes('recover'), 'the run routed to the retry target')
    assert.equal(backend.calls().filter((c) => c.nodeId === 'recover').length, 1)
    assert.ok(result.path.includes('done'), 'and it reached the exit')
    // SUCCESS, per section 11.3: this graph has no goal gates, so the verdict
    // is vacuously satisfied. `failing` really did fail and nothing re-ran it,
    // which is what `unresolvedFailures` is for -- a record beside a
    // spec-conformant status, not a replacement for it.
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['failing'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// C6, the ordering half. Section 3.7 puts the fail edge FIRST: a node that has
// both an explicit `outcome=fail` edge and a retry_target must take the edge.
// Without this, correcting C6 could have quietly promoted the retry target
// over a route the graph author wrote explicitly.
const FAIL_EDGE_BEATS_RETRY_TARGET = `
digraph FE {
  start [shape=Mdiamond]  done [shape=Msquare]
  recover [shape=box, prompt="recover"]
  handled [shape=box, prompt="handled"]
  failing [shape=box, prompt="x", retry_target="recover", max_retries=0]
  start -> failing
  failing -> handled [condition="outcome=fail"]
  handled -> done
  recover -> done
}
`

// This graph is the shape the spec most clearly intends to be a success: the
// author wrote an explicit failure route, section 3.7 step 1 took it, and only
// step 4 -- "no failure route found" -- terminates a pipeline. The failure is
// still recorded, because `handled` is not a re-execution of `failing`.
test('an explicit fail edge still outranks the retry target (C6, section 3.7 step 1)', async () => {
  const { result, runDir, cwd } = await execute(FAIL_EDGE_BEATS_RETRY_TARGET, {
    failing: { status: Status.FAIL, notes: 'boom' },
  })
  try {
    assert.ok(result.path.includes('handled'), 'the explicit fail edge won')
    assert.ok(!result.path.includes('recover'), 'the retry target must not pre-empt a fail edge')
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['failing'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// Making section 3.7 step 2 reachable adds a second instance of a loop class
// this plugin already carries and has already deferred: `failing` fails,
// jumps to its retry target, comes back, fails again. Nothing bounds it but
// the step cap -- there is no in-place retry to apply backoff, because the
// FAIL never entered the retry machine at all. That is a known, deliberately
// deferred gap (it belongs to the plan that owns operator controls), so this
// test does NOT assert an attempt count or a path length, which would pin the
// step cap's value rather than the behaviour. It pins only that the loop
// terminates and never reports SUCCESS. maxSteps=40 keeps a broken step
// counter from hanging the suite instead of failing it.
//
// `failing -> done [condition="outcome=success"]` is dead in this specific
// script -- `failing` is scripted to FAIL every time, so the condition never
// matches and the loop through `recover` behaves exactly as before. It exists
// so `done` is genuinely reachable (TOPO-004, F14): a real graph author
// writing this shape would almost certainly give `failing` both a repair path
// and a success exit, and a graph that only has the former is one no author
// would actually ship. Without it `done` has no route in at all -- not
// through an edge, not through any retry_target -- so F14's reachability fix
// correctly leaves it flagged; this is the fixture catching up to that, not a
// workaround for it.
const FAIL_RETRY_TARGET_LOOP = `
digraph FRL {
  start [shape=Mdiamond]  done [shape=Msquare]
  failing [shape=box, prompt="x", retry_target="recover", max_retries=0]
  recover [shape=box, prompt="recover"]
  start -> failing
  failing -> done [condition="outcome=success"]
  recover -> failing
}
`

test('a FAIL that keeps routing to its retry target terminates at the step cap, never SUCCESS', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(FAIL_RETRY_TARGET_LOOP),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(
        new StubBackend({ failing: { status: Status.FAIL, notes: 'boom' } }),
      ),
      maxSteps: 40,
    })
    const result = await engine.run()
    assert.notEqual(result.status, Status.SUCCESS)
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /step cap/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('D7 fix: a plain FAIL does not consult the graph-level retry_target (engine.ts:1165)', async () => {
  const src = `
    digraph D7Plain {
      retry_target="graphFallback"
      start [shape=Mdiamond]  done [shape=Msquare]
      strict [shape=box, prompt="strict"]
      graphFallback [shape=box, prompt="never reached"]
      start -> strict
      strict -> done
      graphFallback -> done
    }
  `
  const { result } = await execute(src, { strict: { status: Status.FAIL, notes: 'boom' } })
  assert.equal(result.status, Status.FAIL)
  assert.ok(!result.path.includes('graphFallback'), 'must not have jumped to the graph-level target')
})

test('D7 fix: retry-exhaustion does not consult the graph-level retry_target (engine.ts:1021)', async () => {
  const src = `
    digraph D7Exhaust {
      retry_target="graphFallback"
      start [shape=Mdiamond]  done [shape=Msquare]
      strict [shape=box, prompt="strict", max_retries="1"]
      graphFallback [shape=box, prompt="never reached"]
      start -> strict
      strict -> done
      graphFallback -> done
    }
  `
  const { result } = await execute(src, {
    strict: [
      { status: Status.RETRY, notes: 'try again' },
      { status: Status.RETRY, notes: 'still failing' },
    ],
  })
  assert.equal(result.status, Status.FAIL)
  assert.ok(!result.path.includes('graphFallback'), 'must not have jumped to the graph-level target')
})

// C11. Spec section 3.2 step 4 sets `outcome` (and `preferred_label` when
// non-empty); section 5.1 lists `graph.goal` and `current_node`. We set none
// of them, and mirrored graph attributes under bare names only -- so both
// clauses below resolved to the empty string and this edge never matched.
// Task 4 made `context.<k>` fall back to the unprefixed key, so the fix is to
// set the spec's names, not to add more aliases.
const BUILTIN_KEYS = `
digraph B {
  graph [goal="the goal"]
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  start -> a
  a -> done [condition="context.outcome=success && context.graph.goal=the goal"]
}
`

test('built-in context keys outcome and graph.goal are set for conditions to read (C11)', async () => {
  const { result, runDir, cwd } = await execute(BUILTIN_KEYS)
  try {
    assert.equal(result.status, Status.SUCCESS, 'both built-in keys resolved')
    assert.ok(result.path.includes('done'))
  } finally {
    cleanup(runDir, cwd)
  }
})

const CURRENT_NODE = `
digraph CN {
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  wrong [shape=parallelogram, tool_command="printf ok"]
  start -> a
  a -> done  [condition="context.current_node=a"]
  a -> wrong [condition="context.current_node=start"]
  wrong -> done
}
`

test('the built-in current_node key names the executing node (C11)', async () => {
  const { result, runDir, cwd } = await execute(CURRENT_NODE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(!result.path.includes('wrong'), 'current_node must be the executing node, not a stale one')
  } finally {
    cleanup(runDir, cwd)
  }
})

// C11 anti-regression. Mirroring graph attributes under `graph.<name>` must
// ADD a name, never move one: the bare name is what `$goal` substitution and
// every existing pipeline read, and it is a documented superset of the spec.
const BARE_GRAPH_ATTR = `
digraph BG {
  graph [goal="the goal"]
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=parallelogram, tool_command="printf '%s' '$goal'"]
  start -> a
  a -> done [condition="goal=the goal && context.tool.last_line=the goal"]
}
`

test('mirroring graph attributes under graph.* keeps the bare name working (C11)', async () => {
  const { result, runDir, cwd } = await execute(BARE_GRAPH_ATTR)
  try {
    assert.equal(result.status, Status.SUCCESS, 'the bare name still resolves and still substitutes')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The anti-drift mechanism itself. LINEAR declares no graph attributes and
// runs no tool nodes, and the stub writes no contextUpdates, so every key in
// the context after this run is one the ENGINE introduced. If a future built-in
// is added without registering it in isEngineManagedKey, it lands here
// unreserved -- forgeable by any backend -- and this test says so. Deriving the
// assertion from what the engine actually wrote is the point; a hand-listed
// expected set would be the prose this is meant to replace.
test('every built-in key the engine writes is one the model-facing guard rejects', async () => {
  const { runDir, cwd } = await execute(LINEAR)
  try {
    // `BOX_CONTEXT_KEYS` is subtracted because those keys are NOT the engine's.
    // Spec section 4.5 has the codergen HANDLER write `last_stage` and
    // `last_response`, and section 5.1 attributes both to handlers rather than
    // to the engine -- `core/context.ts` records that carve-out and why the
    // guard deliberately leaves them unreserved, so a node overwriting them
    // forges no routing token. The set is IMPORTED from the handler that
    // writes it rather than restated here, which is the same anti-drift
    // arrangement `TOOL_OUTPUT_KEYS` has: a third key added to the handler
    // lands back in this assertion the same day.
    const handlerOwned = new Set<string>(BOX_CONTEXT_KEYS)
    const keys = Object.keys(loadCheckpoint(runDir)!.context).filter((k) => !handlerOwned.has(k))
    assert.ok(keys.length > 0, 'the run wrote built-in keys at all')
    for (const key of keys) {
      assert.ok(
        isEngineManagedKey(key),
        `the engine writes ${key} but a backend could forge it; register it in isEngineManagedKey`,
      )
    }
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the reserved set deliberately excludes handler-owned and author-owned names', async () => {
  // Section 5.1 attributes last_stage/last_response to HANDLERS, so reserving
  // them would forbid a conformant write. Bare graph attribute names live in
  // the author's namespace: `graph.goal` is the engine's mirror and is
  // reserved, `goal` is the author's and is not.
  for (const key of ['last_stage', 'last_response', 'goal', 'phase', 'internalish']) {
    assert.ok(!isEngineManagedKey(key), `${key} must stay writable`)
  }
  for (const key of ['outcome', 'preferred_label', 'current_node', 'graph.goal', 'tool.last_line', 'internal.retry_count.a']) {
    assert.ok(isEngineManagedKey(key), `${key} must be reserved`)
  }
})

// Making `current_node`, `preferred_label` and `graph.*` routing-visible put
// them in reach of a model authoring contextUpdates -- the same hazard the
// `tool.` namespace guard exists to close, on keys that had no routing meaning
// before. These three run the forgery end to end through Engine.run(): the
// deterministic layer must win. Routing is decided by code, never by a model.
const FORGE_CURRENT_NODE = `
digraph FCN {
  start [shape=Mdiamond]  done [shape=Msquare]
  liar [shape=box, prompt="x"]
  forged [shape=parallelogram, tool_command="printf ok"]
  honest [shape=parallelogram, tool_command="printf ok"]
  start -> liar
  liar -> forged [condition="context.current_node=start"]
  liar -> honest [condition="context.current_node=liar"]
  forged -> done
  honest -> done
}
`

test('a box node cannot lie about which node is executing', async () => {
  const { result, runDir, cwd } = await execute(FORGE_CURRENT_NODE, {
    liar: { status: Status.SUCCESS, contextUpdates: { current_node: 'start' }, notes: 'ok' },
  })
  try {
    assert.ok(!result.path.includes('forged'), 'a forged current_node must not route')
    assert.ok(result.path.includes('honest'))
  } finally {
    cleanup(runDir, cwd)
  }
})

const FORGE_GRAPH_ATTR = `
digraph FG {
  graph [goal="the real goal"]
  start [shape=Mdiamond]  done [shape=Msquare]
  liar [shape=box, prompt="x"]
  forged [shape=parallelogram, tool_command="printf ok"]
  honest [shape=parallelogram, tool_command="printf ok"]
  start -> liar
  liar -> forged [condition="context.graph.goal=forged"]
  liar -> honest [condition="context.graph.goal=the real goal"]
  forged -> done
  honest -> done
}
`

test('a box node cannot forge a graph.* attribute', async () => {
  const { result, runDir, cwd } = await execute(FORGE_GRAPH_ATTR, {
    liar: { status: Status.SUCCESS, contextUpdates: { 'graph.goal': 'forged' }, notes: 'ok' },
  })
  try {
    assert.ok(!result.path.includes('forged'), 'a forged graph.* key must not route')
    assert.ok(result.path.includes('honest'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// preferred_label is the one the engine does NOT overwrite on its way past:
// section 3.2 step 4 rewrites it only when the outcome carries a non-empty
// label, so a forged value written by a node that declares no label of its own
// would otherwise survive into the next node's routing.
const FORGE_PREFERRED_LABEL = `
digraph FPL {
  start [shape=Mdiamond]  done [shape=Msquare]
  liar [shape=box, prompt="x"]
  forged [shape=parallelogram, tool_command="printf ok"]
  honest [shape=parallelogram, tool_command="printf ok"]
  start -> liar
  liar -> forged [condition="context.preferred_label=ship"]
  liar -> honest
  forged -> done
  honest -> done
}
`

test('a box node cannot forge preferred_label', async () => {
  const { result, runDir, cwd } = await execute(FORGE_PREFERRED_LABEL, {
    liar: { status: Status.SUCCESS, contextUpdates: { preferred_label: 'ship' }, notes: 'ok' },
  })
  try {
    assert.ok(!result.path.includes('forged'), 'a forged preferred_label must not route')
    assert.ok(result.path.includes('honest'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// C11, the second recordOutcome call. An exhausted RETRY is rewritten to FAIL
// *after* the first call, so without the second one `context.outcome` says
// "retry" while the edge being selected sees "fail" -- and this graph, which
// routes its recovery on the spec-qualified spelling, dead-ends instead.
const REWRITTEN_OUTCOME = `
digraph SR {
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=box, prompt="x", max_retries=0]
  recovered [shape=box, prompt="r"]
  start -> a
  a -> recovered [condition="context.outcome=fail"]
  recovered -> done
}
`

test('context.outcome reflects a RETRY rewritten to FAIL, not the pre-rewrite status (C11)', async () => {
  const { result, runDir, cwd } = await execute(REWRITTEN_OUTCOME, {
    a: { status: Status.RETRY, notes: 'again' },
  })
  try {
    assert.ok(result.path.includes('recovered'), 'the rewritten FAIL must be what conditions read')
    assert.equal(result.status, Status.SUCCESS)
    // The rewritten FAIL is a real failure of `a`, and `recovered` is a
    // different node, so the record keeps it even though the run succeeds.
    assert.deepEqual(result.unresolvedFailures, ['a'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// C11, the preferred_label half of section 3.2 step 4. `labeller` offers a
// label, `quiet` offers none, and the routing decision is taken after `quiet`
// -- so this pins BOTH that the key is written at all AND the spec's "IF
// outcome.preferred_label is not empty" clause, under which the last non-empty
// label survives a node that offered none.
const PREFERRED_LABEL_KEY = `
digraph PL {
  start [shape=Mdiamond]  done [shape=Msquare]
  labeller [shape=box, prompt="label"]
  quiet [shape=box, prompt="quiet"]
  ship [shape=parallelogram, tool_command="printf ok"]
  drop [shape=parallelogram, tool_command="printf ok"]
  start -> labeller
  labeller -> quiet
  quiet -> ship [condition="context.preferred_label=ship"]
  quiet -> drop [condition="context.preferred_label=drop"]
  ship -> done
  drop -> done
}
`

test('context.preferred_label is set and survives a node that offers none (C11)', async () => {
  const { result, runDir, cwd } = await execute(PREFERRED_LABEL_KEY, {
    labeller: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'ok' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('ship'), 'the last non-empty preferred label decided the route')
    assert.ok(!result.path.includes('drop'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// Task 5 corrected edge selection but pinned it only at the selectEdge unit
// level; Task 4 set the precedent that a routing correction is also pinned
// through a real Engine.run(). Two conditional edges match the same outcome
// and the LOWER-weighted one carries the label the outcome prefers. Spec
// section 3.3 step 1 returns best_by_weight_then_lexical among the matches and
// ends the cascade there, so the preferred label never gets a say.
const CASCADE_ENDS_AT_CONDITION = `
digraph C1E {
  start [shape=Mdiamond]  done [shape=Msquare]
  pick [shape=box, prompt="pick"]
  heavy    [shape=parallelogram, tool_command="printf ok"]
  labelled [shape=parallelogram, tool_command="printf ok"]
  start -> pick
  pick -> heavy    [condition="outcome=success", weight=10, label="something else"]
  pick -> labelled [condition="outcome=success", weight=1,  label="take me"]
  heavy    -> done
  labelled -> done
}
`

test('a matching condition ends the cascade through a real run; the preferred label does not override it (C1)', async () => {
  const { result, runDir, cwd } = await execute(CASCADE_ENDS_AT_CONDITION, {
    pick: { status: Status.SUCCESS, preferredLabel: 'take me', notes: 'ok' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('heavy'), 'weight decides among matching conditions')
    assert.ok(!result.path.includes('labelled'), 'the preferred label must not re-open a settled cascade')
  } finally {
    cleanup(runDir, cwd)
  }
})

// C9 through a real run. `abort` sorts lexically before `ship`, so if the
// accelerator is not stripped and no label matches, steps 4/5 fall through to
// `abort` -- which is why this fixture can tell a working accelerator from a
// coincidence. Under the old normalisation `"Y) Yes"` was not stripped at all
// and this run aborted.
const ACCELERATOR_PAREN = `
digraph C9P {
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=box, prompt="ask"]
  abort [shape=parallelogram, tool_command="printf ok"]
  ship  [shape=parallelogram, tool_command="printf ok"]
  start -> gate
  gate -> abort [label="N) No"]
  gate -> ship  [label="Y) Yes"]
  abort -> done
  ship  -> done
}
`

test('a human-gate label written as "Y) Yes" routes through a real run (C9)', async () => {
  const { result, runDir, cwd } = await execute(ACCELERATOR_PAREN, {
    gate: { status: Status.SUCCESS, preferredLabel: 'Yes', notes: 'approved' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('ship'), 'the Y) accelerator must be stripped before matching')
    assert.ok(!result.path.includes('abort'), 'falling through to lexical order is the failure this pins')
  } finally {
    cleanup(runDir, cwd)
  }
})

// Same, for the `A - Approve` form. The old normalisation truncated at the
// first dash-separated segment, so this label became "a" and never matched.
const ACCELERATOR_DASH = `
digraph C9D {
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=box, prompt="ask"]
  abort [shape=parallelogram, tool_command="printf ok"]
  ship  [shape=parallelogram, tool_command="printf ok"]
  start -> gate
  gate -> abort [label="R - Reject"]
  gate -> ship  [label="A - Approve"]
  abort -> done
  ship  -> done
}
`

test('a human-gate label written as "A - Approve" routes through a real run (C9)', async () => {
  const { result, runDir, cwd } = await execute(ACCELERATOR_DASH, {
    gate: { status: Status.SUCCESS, preferredLabel: 'Approve', notes: 'approved' },
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('ship'), 'the A - accelerator must be stripped, the word kept')
    assert.ok(!result.path.includes('abort'), 'falling through to lexical order is the failure this pins')
  } finally {
    cleanup(runDir, cwd)
  }
})

// `a -> done [condition="outcome=fail"]` is dead in this test: the StubBackend
// script below is empty, so both `a` and `b` default to SUCCESS every time and
// the condition never matches -- the `a <-> b` ping-pong that exhausts the
// step cap is unchanged. It exists so `done` is genuinely reachable (TOPO-004,
// F14): a real author writing an intentionally-looping pair like this would
// almost certainly give it an explicit failure exit, and a graph that never
// reaches its own exit node by any route is not one an author would ship.
const STEP_CAP = `
digraph S {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  b [shape=box, prompt="y"]
  start -> a
  a -> b
  a -> done [condition="outcome=fail"]
  b -> a
}
`

// Reproduction from the whole-branch review: `a` is a dead end. selectEdge
// returns null for it exactly as it would for "no route matched", so without
// the fix the engine reports SUCCESS having never reached `done` or visited
// `zgate` -- silently bypassing the goal gate entirely. This graph is
// deliberately NOT run through lint here; TOPO-006 is covered separately in
// lint.test.ts, and this test exists to prove the engine itself refuses to
// treat a dead end as success even if a caller skips linting.
const DEAD_END = `
digraph D {
  start [shape=Mdiamond]  done [shape=Msquare]
  a     [shape=box, prompt="x"]
  zgate [shape=box, goal_gate=true, prompt="judge"]
  start -> a
  start -> zgate
  zgate -> done
}
`

test('a dead-end node fails the run instead of reporting silent success', async () => {
  const { result, runDir, cwd } = await execute(DEAD_END, {
    a: { status: Status.SUCCESS, notes: 'ok' },
  })
  try {
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /no outgoing edges/i)
    assert.ok(result.notes?.includes('a'), 'the message names the dead-end node')
    assert.deepEqual(result.path, ['start', 'a'], 'zgate must never be reached')
  } finally {
    cleanup(runDir, cwd)
  }
})

// StubBackend never throws, but a real subprocess backend's entire failure
// surface (binary missing, spawn failure, malformed JSON, a budget abort) is
// a throw. Nothing today stands between that and an unhandled rejection of
// Engine.run() -- no terminal event, no final checkpoint, no retry.
class ThrowingBackend implements Backend {
  async run(_node: Node, _prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    throw new Error('spawn ENOENT: claude not found')
  }
}

const THROWS = `
digraph T {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, max_retries=0, prompt="x"]
  start -> a -> done
}
`

test('a handler that throws terminates the run cleanly instead of rejecting', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(THROWS),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new ThrowingBackend()),
    })
    // The assertion itself is that this resolves rather than rejects.
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    const cp = loadCheckpoint(runDir)
    assert.ok(cp, 'a final checkpoint was written despite the throw')
    assert.equal(cp!.currentNode, null, 'the checkpoint reflects a terminated run')

    const events = new EventLog(runDir).all()
    const errorEvent = events.find((e) => e.type === 'node.error')
    assert.ok(errorEvent, 'a node.error event records the throw')
    assert.match(String(errorEvent?.message), /spawn ENOENT/)
    assert.ok(events.some((e) => e.type === 'pipeline.end'), 'a terminal event was emitted')
  } finally {
    cleanup(runDir, cwd)
  }
})

// This fixture resolves `gate` to Handler.HUMAN, which UNREGISTERED_HANDLER_KINDS
// (dot/graph.ts) names and HAND-001 (dot/lint.ts) therefore refuses at lint
// time. It used to be this suite's fixture for engine.ts's own internal
// "no handler registered" abort (around engine.ts:661-666) -- but since
// FR-11 (the lint-refusal gate in Engine.run()) and FR-17a (HAND-001) both
// landed, `engine.run()` now refuses this graph during its lint pass, before
// dispatch ever reaches `gate` and before that internal abort code can run.
// The single test that used to sit here asserted `/no handler registered/`
// against `result.notes`, and HAND-001's own diagnostic prose ("the run
// would abort with 'no handler registered' mid-pipeline") happens to also
// satisfy that regex -- so the old test kept passing for the wrong reason
// and stopped exercising the code path its name promised. Split in two below:
// one test pins the NEW lint-refusal behaviour on this exact fixture, the
// other restores real coverage of engine.ts's own internal abort using a
// fixture and handlers map built specifically to reach it.
const NO_HANDLER = `
digraph H {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  gate  [shape=hexagon]
  start -> gate -> done
}
`

test('the embedded Engine refuses a HAND-001-dirty graph before dispatching anything (FR-11 x FR-17a)', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(NO_HANDLER),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new StubBackend({})),
    })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /HAND-001/, 'the refusal names the rule that fired')
    assert.equal(result.path.length, 0, 'lint refusal happens before any node is dispatched')

    const events = new EventLog(runDir).all()
    const terminal = events.find((e) => e.type === 'pipeline.end')
    assert.ok(terminal, 'a lint refusal still leaves a terminal event')
    assert.equal(terminal?.status, Status.FAIL)
  } finally {
    cleanup(runDir, cwd)
  }
})

// HAND-001 only refuses handler kinds UNREGISTERED_HANDLER_KINDS knows about.
// A Handler.TOOL node is not one of them -- `defaultHandlers()` normally
// registers TOOL -- so this fixture lints clean. To reach engine.ts's own
// internal "no handler registered" abort we therefore have to build an
// Engine instance whose handlers map is deliberately incomplete: clone
// `defaultHandlers()` and delete its TOOL entry, so THIS Engine instance
// (and only this one) is missing a handler lint has no way to know about.
const TOOL_ONLY = `
digraph T {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work  [shape=parallelogram, tool_command="printf ok"]
  start -> work -> done
}
`

test("engine.ts's own no-handler-registered abort fires for a lint-clean graph whose Engine instance was built without that node's handler", async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const graph = parseDot(TOOL_ONLY)
    assert.ok(
      !hasErrors(lint(graph)),
      'the fixture must be lint-clean -- HAND-001 has no way to know this specific Engine instance is missing a TOOL handler',
    )

    const handlers = defaultHandlers(new StubBackend({}))
    handlers.delete(Handler.TOOL)

    const engine = new Engine({
      graph,
      context: Context.from({}),
      runDir,
      cwd,
      handlers,
    })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    assert.equal(
      result.notes,
      'no handler registered for tool (node work)',
      "the engine's own internal abort message, not HAND-001's",
    )
    assert.deepEqual(
      result.path,
      ['start', 'work'],
      'dispatch reached the node (past the start node, which still has its passthrough handler) before discovering no handler',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a normal run logs a node.start/node.end pair for the start and exit nodes', async () => {
  const { runDir, cwd } = await execute(LINEAR)
  try {
    const events = new EventLog(runDir).all()
    for (const id of ['start', 'done']) {
      assert.ok(
        events.some((e) => e.type === 'node.start' && e.node === id),
        `node.start missing for ${id} -- PassthroughHandler emits no detail events of its own`,
      )
      assert.ok(
        events.some((e) => e.type === 'node.end' && e.node === id),
        `node.end missing for ${id}`,
      )
    }
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the step cap terminates a non-terminating graph', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(STEP_CAP),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new StubBackend({})),
      maxSteps: 12,
    })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /step cap/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// FINDINGS I1 AND I2 of the whole-branch review. Both are settled now, and the
// two settlements are DIFFERENT IN KIND -- which is the point of keeping them
// side by side.
//
// I1 is CLOSED, by the dataflow plan's eager input check. A node that
// references a key a failed node DECLARED it would produce is not invoked; it
// returns FAIL naming the key and the owing node, and fail-fast halts the run.
//
// I2 is RECLASSIFIED, not closed, and the engine's behaviour is UNCHANGED and
// must stay that way. Section 3.4 scopes the goal-gate check to VISITED nodes,
// so a gate on a branch a failure route bypasses is legitimately never
// consulted and section 11.3 then reports the run a success. The engine is
// conformant. Filing it as an engine defect was a CATEGORY ERROR: it is a
// graph-shape hazard, and its fix is the GATE-001 lint rule, asserted below on
// the finding's own fixture.
//
// The verdict rule is untouched by both. Section 11.3 -- "Pipeline outcome is
// 'success' if all goal_gate nodes reached SUCCESS or PARTIAL_SUCCESS, 'fail'
// otherwise" -- still decides `status` by goal gates alone. I1's run reports
// FAIL because a node failed and section 3.7 step 4 found no route, which is
// the spec's own mechanism; an earlier round of this branch made these runs
// report FAIL by a run-level rule instead, and that contradicted section 11.3
// and was withdrawn.
// ---------------------------------------------------------------------------

// I1, CLOSED. The finding's own shape, with the one attribute that arms the
// protection: `build` DECLARES `outputs="build.error"`.
//
// `resolveKey` returns '' for a missing key (spec section 10.3), so
// `context.build.error!=fatal` is still TRUE when nothing ever writes it, and
// section 3.3 step 1 still returns that matched conditional edge before
// fail-fast is consulted. None of that changed and none of it needed to: the
// edge is taken, `publish` is VISITED, and the eager input check then refuses
// to invoke it because a key it substitutes is owed by a node the run gave up
// on. The run halts one node later than it "should" and for a reason an
// operator can act on, instead of walking to a green exit.
const VACUOUS_GUARD_HALTS_WHEN_DECLARED = `
digraph G {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1", outputs="build.error"]
  publish [shape=box, prompt="publish \${build.error}"]
  start -> build
  build -> publish [condition="context.build.error!=fatal"]
  publish -> done
}
`

test('I1 (CLOSED): a declared output owed by a failed node halts the run', async () => {
  const backend = new StubBackend({})
  const { result, engine, runDir, cwd } = await runObserving(
    VACUOUS_GUARD_HALTS_WHEN_DECLARED,
    backend,
  )
  try {
    // The halt. `publish` is on the path -- it is visited, checkpointed, given
    // an outcome and routed -- and the run stops there instead of reaching
    // `done`. Visiting it is what keeps section 3.4's visited-scoped gate check
    // and section 3.7's ladder applicable to it at all.
    assert.deepEqual(result.path, ['start', 'build', 'publish'])
    assert.ok(!result.path.includes('done'), 'the run reached the exit')
    assert.equal(result.status, Status.FAIL)

    // The downstream node NEVER EXECUTED. `publish` is a box node, so the
    // observable side effect is the backend invocation; before the fix it ran,
    // succeeded on a prompt still carrying a literal `${build.error}`, and the
    // run reported SUCCESS at exit 0.
    assert.deepEqual(
      backend.calls().map((c) => c.nodeId),
      [],
      'the backend was invoked for a node whose inputs do not exist',
    )

    // The reason names BOTH the key and the node that owed it. Naming only the
    // key leaves an operator hunting for the producer.
    assert.match(result.notes ?? '', /required input 'build\.error' unavailable/)
    assert.match(result.notes ?? '', /node 'build' failed/)
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some(
        (e) =>
          e.type === 'node.input_unavailable' &&
          e.node === 'publish' &&
          e.key === 'build.error' &&
          e.owedBy === 'build',
      ),
      'the log records which key was missing and who owed it',
    )
    // Fail-fast is what actually ends the run: `publish -> done` is
    // unconditional, and no unconditional edge carries a FAIL forward.
    assert.match(result.notes ?? '', /no matching edge from publish after failure/)

    // The record still exists and now names both nodes, in first-failure order.
    // No `pipeline.unresolved_failure` event, and correctly so: that event is
    // the exit branch's way of saying "this SUCCESS is holding a failure". This
    // run never reaches the exit and reports FAIL, so there is no unearned
    // success to qualify.
    assert.deepEqual(result.unresolvedFailures, ['build', 'publish'])
    assert.ok(!events.some((e) => e.type === 'pipeline.unresolved_failure'))
    // `publish` declared nothing, so it owes nothing -- only `build`'s
    // declaration is in the ledger.
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map([['build.error', 'build']]))
  } finally {
    cleanup(runDir, cwd)
  }
})

// I1's LIMIT, pinned deliberately: THE PROTECTION IS FULLY OPT-IN.
//
// The same graph with the `outputs=` declaration removed. Nothing else differs
// -- `publish` still substitutes `${build.error}`, the guard is still
// vacuously true -- and the run still walks past the failure to a conformant
// SUCCESS, exactly as the finding described. A key nobody declared is not a
// debt anybody owes, so the ledger is empty and the eager check has nothing to
// say.
//
// This is not the defect reopened; it is the boundary of the fix, and a reader
// told "I1 is closed" would otherwise assume automatic protection. Two things
// make it liveable and both are asserted here: the record still names the
// failed node, and DATA-001 warns at DESIGN TIME that the reference has no
// declared producer, naming `outputs=` as the remedy.
const VACUOUS_GUARD_CARRIES_FAILURE = `
digraph G {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1"]
  publish [shape=box, prompt="publish \${build.error}"]
  start -> build
  build -> publish [condition="context.build.error!=fatal"]
  publish -> done
}
`

test('I1 is opt-in: an undeclared key gives no protection, and DATA-001 says so', async () => {
  const { result, runDir, cwd } = await execute(VACUOUS_GUARD_CARRIES_FAILURE)
  try {
    // The walk-past, unchanged. This is what a graph that declares nothing
    // gets.
    assert.deepEqual(result.path, ['start', 'build', 'publish', 'done'])
    // Conformant per section 11.3: this graph declares no goal gates, so the
    // gate condition is vacuously satisfied and SUCCESS is correct. The verdict
    // was never the defect.
    assert.equal(result.status, Status.SUCCESS)
    // The record is the only thing that makes the failure visible above the
    // event log, and it must never regress.
    assert.deepEqual(result.unresolvedFailures, ['build'])
    assert.match(result.notes ?? '', /unresolved node failures/i)
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'),
    )
    assert.ok(events.some((e) => e.type === 'pipeline.unresolved_failure'))

    // The design-time half. An author running `attractor lint` is told before
    // the pipeline ever starts, and told what to do about it.
    const dataDiags = lint(parseDot(VACUOUS_GUARD_CARRIES_FAILURE)).filter(
      (d) => d.code === 'DATA-001',
    )
    assert.equal(dataDiags.length, 1)
    assert.equal(dataDiags[0].node, 'publish')
    assert.match(dataDiags[0].message, /outputs="build\.error"/)
  } finally {
    cleanup(runDir, cwd)
  }
})

// I1's OTHER limit, and the one the record got wrong: THE EAGER CHECK SEES
// ONLY SUBSTITUTED TEXT.
//
// `unavailableInput` intersects the ledger with `referencedKeys(substitutableText(node))`
// -- a box node's prompt, a tool node's command. A key referenced ONLY IN AN
// EDGE CONDITION appears in neither, so the check cannot see it AT ANY LEVEL OF
// OPT-IN. `build` here declares `outputs="build.error"`, the ledger is armed,
// and the run still walks to a green exit, because `publish` substitutes
// nothing.
//
// This is finding I1's OWN WORKED-EXAMPLE SHAPE -- `build -> publish
// [condition="context.build.error!=fatal"]` with no `${}` anywhere -- and
// spec-conformance.md presented it as the reproducer whose result is a halt. It
// is not. Residual R6 recorded the same blind spot as a LINT-coverage limit,
// conceding it to DATA-001 while calling the runtime check "the load-bearing
// guard"; the runtime check has the identical blind spot, by design, and both
// statements are corrected there.
//
// Pinned as a RECORDED BEHAVIOUR rather than left as an unnoticed gap. Closing
// it means scanning `condition` attributes with a different tokenizer
// (`context.` prefixes, not `${}`), which is a new mechanism, not a widening of
// this one.
const CONDITION_ONLY_REFERENCE_IS_UNPROTECTED = `
digraph COR {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1", outputs="build.error"]
  publish [shape=box, prompt="publish the artifact"]
  start -> build
  build -> publish [condition="context.build.error!=fatal"]
  publish -> done
}
`

test('I1 does not reach a reference that appears only in an edge condition', async () => {
  const { result, runDir, cwd, backend } = await execute(CONDITION_ONLY_REFERENCE_IS_UNPROTECTED)
  try {
    // Full opt-in applied, and the run still reaches the exit green.
    assert.deepEqual(result.path, ['start', 'build', 'publish', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(
      backend.calls().map((c) => c.nodeId),
      ['publish'],
      'the successor ran on a key its producer never delivered',
    )
    // Nothing was blocked, because nothing was visible to block on.
    const events = new EventLog(runDir).all()
    assert.ok(!events.some((e) => e.type === 'node.input_unavailable'))

    // The record is the only thing that speaks, exactly as in the undeclared
    // case -- which is the point: `outputs=` bought nothing here.
    assert.deepEqual(result.unresolvedFailures, ['build'])
    assert.ok(events.some((e) => e.type === 'pipeline.unresolved_failure'))

    // And DATA-001 is silent too, for the same reason (residual R6). Both the
    // design-time hint and the runtime guard scan substituted text.
    assert.deepEqual(
      lint(parseDot(CONDITION_ONLY_REFERENCE_IS_UNPROTECTED)).filter((d) => d.code === 'DATA-001'),
      [],
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// I2, RECLASSIFIED. A FAIL `retry_target` routes around an UNVISITED goal gate.
//
// C4 scoped the goal-gate check to visited nodes (section 3.4) and C6 made a
// FAIL consult `retry_target` (section 3.7 step 2). Composed, `build`'s
// fallback route reaches the exit without `verify` ever being visited, so
// `unsatisfiedGoalGates()` is legitimately empty and the run reports SUCCESS.
//
// THE ENGINE'S BEHAVIOUR HERE IS CORRECT AND DOES NOT CHANGE. Do not "fix" it:
// tightening the gate check to unvisited nodes is the exact regression C4
// exists to prevent, and it made a gate on a branch the run legitimately never
// took permanently unsatisfiable. What was wrong was the FILING -- this was
// recorded as an engine defect, and it is a graph-shape hazard. GATE-001 is
// where it belongs, and the second test below is that assertion.
const FAIL_TARGET_ROUTES_AROUND_UNVISITED_GATE = `
digraph G {
  start [shape=Mdiamond]  done [shape=Msquare]
  plan   [shape=box]
  build  [shape=parallelogram, tool_command="exit 1", retry_target="report"]
  verify [shape=box, goal_gate="true"]
  report [shape=box]
  start -> plan
  plan -> report [condition="context.mode=report_only"]
  plan -> build
  build -> verify
  verify -> done
  report -> done
}
`

test('I2 (RECLASSIFIED): the engine is conformant and its behaviour is unchanged', async () => {
  const { result, runDir, cwd } = await execute(FAIL_TARGET_ROUTES_AROUND_UNVISITED_GATE)
  try {
    assert.deepEqual(result.path, ['start', 'plan', 'build', 'report', 'done'])
    // SUCCESS because `verify` was never VISITED, and section 3.4 scopes the
    // gate check to visited nodes. This is the finding's arguable half: section
    // 11.3 and section 11.4 both say "all goal_gate nodes" instead, which would
    // make this run FAIL. We keep the section 3.4 reading -- it is the
    // normative algorithm section and it carries pseudocode -- and the
    // inconsistency is recorded in the ambiguities section of the audit.
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['build'])
    // The gate was never visited, so it must never be BLAMED either. If this
    // ever reads "unsatisfied goal gates", the visited scoping has regressed.
    assert.doesNotMatch(result.notes ?? '', /goal gate/i)
    const events = new EventLog(runDir).all()
    assert.ok(!events.some((e) => e.type === 'pipeline.goal_gate_block'))
    assert.ok(events.some((e) => e.type === 'pipeline.unresolved_failure'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// I2's actual fix, on I2's own graph. The lint sweep fires here as a TRUE
// POSITIVE, and this test is what makes that intentional rather than
// incidental: `build`'s retry target reaches `done` without passing `verify`,
// which is precisely the shape the finding described.
test('I2 (RECLASSIFIED): GATE-001 catches the finding at design time', () => {
  const diags = lint(parseDot(FAIL_TARGET_ROUTES_AROUND_UNVISITED_GATE)).filter(
    (d) => d.code === 'GATE-001',
  )
  assert.equal(diags.length, 1)
  // Blamed on the node whose retry target does the bypassing, not on the gate.
  assert.equal(diags[0].node, 'build')
  assert.equal(diags[0].severity, 'warning')
  assert.match(diags[0].message, /retry_target="report"/)
  assert.match(diags[0].message, /without passing through any goal gate/)
  // The message carries the reason the engine is NOT at fault, because a
  // diagnostic that only says "gate bypassed" invites a bug report against the
  // engine -- which is how this was filed in the first place.
  assert.match(diags[0].message, /VISITED nodes only/)
})

// The over-tightening guard. `build` fails, routes to `fix`, `fix` repairs it,
// `build` RE-RUNS green -- a legitimate repair loop, and the whole reason
// "unresolved" is defined by re-execution rather than by first occurrence. If
// this test ever reports FAIL, the verdict change is wrong, not the graph.
//
// The loop is bounded by the marker file `fixed`: `build` fails while it is
// absent and succeeds once `fix` has created it, so the second pass through
// `build` genuinely re-executes and genuinely succeeds.
//
// The repair route is an explicit `outcome=fail` edge rather than a
// `retry_target`, so the graph is LINT-CLEAN -- a `retry_target` is not an
// edge, so `fix` would be TOPO-004 unreachable and no operator could actually
// run this pipeline. A fixture the CLI would refuse is a poor regression
// fixture. The retry_target repair path is covered by the goal-gate retry
// tests above.
const REPAIR_LOOP = `
digraph RL {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, max_retries=0, tool_command="test -f fixed"]
  fix   [shape=parallelogram, tool_command="touch fixed"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> fix  [condition="outcome=fail"]
  fix -> build
}
`

test('a repair loop that re-runs the failed node green still reports SUCCESS', async () => {
  const { result, runDir, cwd } = await execute(REPAIR_LOOP)
  try {
    assert.deepEqual(result.path, ['start', 'build', 'fix', 'build', 'done'])
    assert.equal(result.path.filter((n) => n === 'build').length, 2, 'build really re-ran')
    assert.equal(result.status, Status.SUCCESS, 'a repaired failure must not sink the run')
    assert.equal(result.unresolvedFailures, undefined, 'nothing is left unresolved')
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'),
      'the failure really happened -- this is a recovery, not an absence of failure',
    )
    assert.ok(!events.some((e) => e.type === 'pipeline.unresolved_failure'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// A failure resolved by a re-run of a DIFFERENT node does not count. This is
// the boundary of the rule above, stated as a test so "unresolved" cannot be
// quietly widened to "some later node succeeded" -- which is every one of the
// false-SUCCESS runs this change exists to stop.
const OTHER_NODE_SUCCEEDS = `
digraph ON {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, tool_command="exit 1"]
  note  [shape=parallelogram, tool_command="printf ok"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> done
}
`

test('a later node succeeding does not remove an earlier failure from the record', async () => {
  const { result, runDir, cwd } = await execute(OTHER_NODE_SUCCEEDS)
  try {
    assert.deepEqual(result.path, ['start', 'build', 'note', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates, so success')
    assert.deepEqual(result.unresolvedFailures, ['build'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// The engine-level half of the `preferred_label` spelling fix. This is
// PREFERRED_LABEL_KEY with `context.` removed from both conditions: `labeller`
// offers a label, `quiet` offers none, and the routing decision is taken after
// `quiet`. Before the fix the qualified spelling routed to `ship` and this
// bare one dead-ended, from the same graph and the same run.
const PREFERRED_LABEL_BARE = `
digraph PLB {
  start [shape=Mdiamond]  done [shape=Msquare]
  labeller [shape=box, prompt="label"]
  quiet [shape=box, prompt="quiet"]
  ship [shape=parallelogram, tool_command="printf ok"]
  drop [shape=parallelogram, tool_command="printf ok"]
  start -> labeller
  labeller -> quiet
  quiet -> ship [condition="preferred_label=ship"]
  quiet -> drop [condition="preferred_label=drop"]
  ship -> done
  drop -> done
}
`

test('the bare preferred_label spelling routes identically to the qualified one', async () => {
  const script = { labeller: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'ok' } }
  const bare = await execute(PREFERRED_LABEL_BARE, script)
  const qualified = await execute(PREFERRED_LABEL_KEY, script)
  try {
    assert.equal(bare.result.status, Status.SUCCESS)
    assert.ok(bare.result.path.includes('ship'), 'the sticky label decided the route')
    assert.ok(!bare.result.path.includes('drop'))
    // The point of the fix, stated directly: one graph, two spellings of one
    // key, and the same run-level answer.
    assert.deepEqual(bare.result.path, qualified.result.path)
  } finally {
    cleanup(bare.runDir, bare.cwd, qualified.runDir, qualified.cwd)
  }
})

// The anti-drift mechanism's OTHER half. `isEngineManagedKey` is read from two
// directions -- `box.ts` refuses a backend key it covers, and `setManaged`
// refuses an engine key it does NOT -- and only the first half was tested, so
// the throw could be deleted with the suite green. It is reached only on a
// developer mistake (a new built-in made routing-visible without being
// reserved), so there is no graph that provokes it; calling it directly is the
// honest way to pin it.
test('setManaged refuses a built-in key isEngineManagedKey does not cover', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(LINEAR),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new StubBackend({})),
    })
    const managed = engine as unknown as { setManaged(context: Context, key: string, value: string): void }
    assert.throws(
      () => managed.setManaged(Context.from({}), 'last_verdict', 'ship'),
      /not covered by isEngineManagedKey/,
      'a routing-visible built-in that is not reserved is forgeable by a backend',
    )
    // And the permitting direction, so this is not a one-way test: a key the
    // predicate does cover must go through.
    managed.setManaged(Context.from({}), 'current_node', 'a')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The three fixtures above are regression fixtures for an operator-facing
// defect, so they must be graphs an operator could actually run. `attractor
// run` refuses a graph with lint errors, and a fixture the CLI would refuse
// pins nothing an operator can reach.
test('the whole-branch review fixtures are graphs the CLI would accept', () => {
  for (const src of [
    VACUOUS_GUARD_HALTS_WHEN_DECLARED,
    VACUOUS_GUARD_CARRIES_FAILURE,
    FAIL_TARGET_ROUTES_AROUND_UNVISITED_GATE,
    REPAIR_LOOP,
    OTHER_NODE_SUCCEEDS,
  ]) {
    const diags = lint(parseDot(src))
    assert.equal(
      hasErrors(diags),
      false,
      `lint errors: ${diags.filter((d) => d.severity === 'error').map((d) => d.code).join(', ')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Round 2 of the whole-branch review: the ledger was keyed on FAIL, and an
// exhausted RETRY with a retry target never reaches a FAIL status.
// ---------------------------------------------------------------------------

/**
 * Returns RETRY on one named node, so the run reaches the retry machine and
 * -- with a target declared -- the ABANDONMENT path rather than the FAIL path.
 *
 * IT USED TO THROW, and the comment here used to say the throw "becomes RETRY,
 * which is the entire point". That was true of the engine and is no longer:
 * spec section 4.12 requires "Handler panics/exceptions MUST be caught by the
 * engine and converted to FAIL outcomes", so a throw is now a FAIL and can
 * never reach abandonment. Section 4.12 is pinned separately, by 'a handler
 * exception becomes FAIL and is not retried'.
 *
 * The MECHANISM these tests exist for is untouched and still fully reachable:
 * an exhausted RETRY with a retry target is abandoned without ever holding a
 * FAIL status. What changed is only how a test gets a node to return RETRY,
 * and returning it directly is the honest way -- section 5.2 defines RETRY as
 * a status a handler returns, and `BoxHandler`'s fail-closed gate downgrade
 * produces exactly this shape in a real run.
 */
class RetryingBackend implements Backend {
  private victim: string
  private retries: number
  private seen = 0
  constructor(victim: string, retries = Number.POSITIVE_INFINITY) {
    this.victim = victim
    this.retries = retries
  }
  async run(node: Node, _prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    if (node.id === this.victim && this.seen++ < this.retries) {
      return { status: Status.RETRY, notes: 'spawn claude ENOENT' }
    }
    return { status: Status.SUCCESS, preferredLabel: 'ok', notes: 'ok' }
  }
}

// I2's exact shape with a box node instead of a tool node, and a NODE-level
// fallback_retry_target on `build`. `build` never returns FAIL: the throw
// becomes RETRY, the policy exhausts at the default of zero retries, and
// because a target exists `Engine.run` jumps away BEFORE the rewrite-to-FAIL
// below it. So the node was abandoned without ever entering a FAIL status,
// the run routed around an unvisited goal gate, and it reported
// `status: success`, exit 0.
//
// More reachable than either I1 or I2: no vacuous condition is required, only
// a backend crash, malformed output or budget abort on a node with a retry
// target. It reported success before this branch too.
//
// The fallback used to be declared graph-level (`graph
// [fallback_retry_target="report"]`), which worked before the D7 fix because
// `build` has no retry attributes of its own and the graph-level rungs were
// (wrongly) still consulted for its plain-node retry-exhaustion. After D7,
// section 3.7's ladder for a non-EXIT node never reads the graph-level rungs,
// so the target is declared on `build` itself instead -- the abandonment
// mechanism under test is otherwise identical.
const ABANDONED_VIA_RETRY_TARGET = `
digraph AR {
  start [shape=Mdiamond]  done [shape=Msquare]
  plan   [shape=box]
  build  [shape=box, fallback_retry_target="report"]
  verify [shape=box, goal_gate="true"]
  report [shape=box]
  start -> plan
  plan -> report [condition="context.mode=report_only"]
  plan -> build
  build -> verify
  verify -> done
  report -> done
}
`

async function runWith(src: string, backend: Backend, maxSteps?: number) {
  const { runDir, cwd } = tempDirs()
  const engine = new Engine({
    graph: parseDot(src),
    context: Context.from({}),
    runDir,
    cwd,
    handlers: defaultHandlers(backend),
    maxSteps,
  })
  return { result: await engine.run(), runDir, cwd }
}

test('a node abandoned by retry exhaustion is in the record too', async () => {
  const { result, runDir, cwd } = await runWith(
    ABANDONED_VIA_RETRY_TARGET,
    new RetryingBackend('build'),
  )
  try {
    // Routing is untouched and asserted, exactly as for I1 and I2.
    assert.deepEqual(result.path, ['start', 'plan', 'build', 'report', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: verdict is goal gates alone')
    assert.deepEqual(
      result.unresolvedFailures,
      ['build'],
      'the run gave up on build; a record that omits it is simply wrong',
    )
    const events = new EventLog(runDir).all()
    // The node never reached a FAIL status. This is what a ledger keyed on
    // FAIL alone could not see, and asserting its ABSENCE is what stops the
    // fix from being "re-key it on FAIL and hope".
    assert.ok(!events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'))
    assert.ok(events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'retry'))
    assert.ok(events.some((e) => e.type === 'node.retry.exhausted' && e.node === 'build'))
    // And the gate was correctly never visited, so it must not be blamed.
    assert.doesNotMatch(result.notes ?? '', /goal gate/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('declaring a retry target does not erase the node from the record', async () => {
  // The coherence argument for recording an abandonment, stated as a test. The
  // same graph WITHOUT the fallback route has its exhausted RETRY rewritten to
  // FAIL and recorded; with the route it never reaches a FAIL status at all.
  // The two runs route differently and end differently, and that is fine --
  // what would not be fine is `unresolvedFailures` disagreeing about whether
  // `build` failed depending on whether an escape route was declared.
  const withoutTarget = ABANDONED_VIA_RETRY_TARGET.replace(
    '  build  [shape=box, fallback_retry_target="report"]',
    '  build  [shape=box]',
  )
  const a = await runWith(ABANDONED_VIA_RETRY_TARGET, new RetryingBackend('build'))
  const b = await runWith(withoutTarget, new RetryingBackend('build'))
  try {
    assert.deepEqual(a.result.unresolvedFailures, ['build'])
    assert.deepEqual(b.result.unresolvedFailures, ['build'])
    // And the statuses differ for a spec reason, not an accident: `a` reaches
    // the exit (section 11.3, no visited gates -> success) while `b` dead-ends
    // at a failure with no route out (section 3.7 step 4 -> the pipeline fails).
    assert.equal(a.result.status, Status.SUCCESS)
    assert.equal(b.result.status, Status.FAIL)
  } finally {
    cleanup(a.runDir, a.cwd, b.runDir, b.cwd)
  }
})

// The over-tightening guard for the NEW path, matching the one the FAIL path
// already has. `build` crashes once, exhausts, is abandoned to `fix`, and the
// graph routes back so `build` re-runs green. Abandonment must be resolvable
// by re-execution exactly like a FAIL.
const ABANDONED_THEN_REPAIRED = `
digraph ATR {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=box, retry_target="fix"]
  fix   [shape=box]
  start -> build
  build -> done [condition="outcome=success"]
  fix -> build
}
`

test('a node abandoned by retry exhaustion and then re-run green reports SUCCESS', async () => {
  const { result, runDir, cwd } = await runWith(
    ABANDONED_THEN_REPAIRED,
    new RetryingBackend('build', 1),
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'fix', 'build', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'an abandonment a re-run repaired is resolved')
    assert.equal(result.unresolvedFailures, undefined)
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some((e) => e.type === 'node.retry.exhausted' && e.node === 'build'),
      'build really was abandoned once -- this is recovery, not absence of failure',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// `unresolvedFailures` is documented as FIRST-failure order, and a Set does not
// deliver it: deleting a recovered node and re-inserting it on a later failure
// moves it to the end. This fixture drives the ONLY sequence that can tell the
// two apart -- a fails, b fails, a RECOVERS, a fails AGAIN, run ends -- because
// anything shorter gives the same answer either way. `phase` is a plain context
// key the nodes set through contextUpdates, used only to make the third visit
// to `a` route somewhere different from the first.
const ORDER = `
digraph O {
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=box]
  b [shape=box]
  c [shape=box]
  start -> a
  a -> b    [condition="outcome=fail && context.phase=one"]
  a -> c    [condition="outcome=success"]
  a -> done [condition="outcome=fail && context.phase=three"]
  b -> a    [condition="outcome=fail"]
  c -> a
}
`

test('unresolvedFailures is in first-failure order across a recover-then-fail-again cycle', async () => {
  const { result, runDir, cwd } = await execute(ORDER, {
    a: [
      { status: Status.FAIL, contextUpdates: { phase: 'one' }, notes: 'a first' },
      { status: Status.SUCCESS, notes: 'a recovered' },
      { status: Status.FAIL, notes: 'a failed again' },
    ],
    b: { status: Status.FAIL, notes: 'b failed' },
    c: { status: Status.SUCCESS, contextUpdates: { phase: 'three' }, notes: 'c ok' },
  })
  try {
    // The path IS the test setup: without these six steps in this order the
    // assertion below passes under a Set too and pins nothing.
    assert.deepEqual(result.path, ['start', 'a', 'b', 'a', 'c', 'a', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates in this graph')
    assert.deepEqual(
      result.unresolvedFailures,
      ['a', 'b'],
      'a failed first, so it is reported first even after recovering and failing again',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// The failed-output LEDGER: which context keys the run is now missing, and
// which node owed each one.
//
// `unresolvedFailures` answers "which nodes did the run give up on". That is
// not enough to fix I1, because the defect there is about KEYS: a successor
// cannot tell "the producer failed and this key will never arrive" from "the
// key is legitimately empty" (section 10.3 makes a missing key the empty
// string, so a `!=` guard on it is vacuously true). The ledger is the missing
// half -- key -> the id of the node that owed it -- and a later task turns it
// into an eager input check.
//
// It is populated on exactly the two events `unresolvedFailures` already
// treats as giving up on a node, because they are the same event: a FAIL
// outcome, and a RETRY that exhausts its policy and is abandoned to a
// retry_target. Section 3.5's `execute_with_retry` returns
// `Outcome(status=FAIL, failure_reason="max retries exceeded")` on exhaustion
// unconditionally; section 3.7's jump happens afterwards, as failure routing.
// So a node abandoned to a target owes its outputs just as much as one that
// reached a FAIL status -- and in our loop it never reaches that status at all.
//
// It is a RECORD, NOT ROUTING STATE. It lives in a private field and is never
// written into Context, which the last test in this block demonstrates rather
// than asserts. Plan 3 already learned that lesson the expensive way: making
// engine state routing-visible let a model forge it through `contextUpdates`
// (`{current_node: 'start'}` taking a `condition="context.current_node=start"`
// branch), which is why `isEngineManagedKey` exists. A ledger keyed on
// AUTHOR-chosen names from `outputs=` could not be protected by that guard at
// all -- those names live in the author's namespace by design -- so the only
// safe answer is that it never reaches Context in the first place.
// ---------------------------------------------------------------------------

/**
 * Runs a graph and keeps BOTH the engine and the context it ran against.
 *
 * `execute` and `runWith` above discard both, and the ledger is observable
 * only through the engine while the "not routing-visible" claim is observable
 * only through the context. Reading the private field directly with an `as
 * unknown as` cast would test the field rather than the behaviour, and would
 * keep passing if the engine started leaking the ledger into Context.
 */
async function runObserving(src: string, backend: Backend) {
  const { runDir, cwd } = tempDirs()
  const context = Context.from({})
  const engine = new Engine({
    graph: parseDot(src),
    context,
    runDir,
    cwd,
    handlers: defaultHandlers(backend),
  })
  const result = await engine.run()
  return { result, engine, context, runDir, cwd }
}

// A repair loop, so a recovery really clears the keys the failure recorded.
// Same shape as REPAIR_LOOP above (marker file `fixed`, explicit `outcome=`
// edges so the graph is lint-clean) with `outputs=` added: `build` fails while
// the marker is absent, `fix` creates it, `build` RE-EXECUTES and succeeds.
const LEDGER_REPAIR_LOOP = `
digraph LRL {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, max_retries=0, tool_command="test -f fixed", outputs="artifact.path,artifact.sha"]
  fix   [shape=parallelogram, tool_command="touch fixed"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> fix  [condition="outcome=fail"]
  fix -> build
}
`

test('a repair loop leaves nothing owed: re-executing the node green clears its keys', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    LEDGER_REPAIR_LOOP,
    new StubBackend({}),
  )
  try {
    // The setup IS the test: without a genuine second execution of `build`
    // there is nothing for the clearing branch to clear.
    assert.deepEqual(result.path, ['start', 'build', 'fix', 'build', 'done'])
    assert.equal(result.path.filter((n) => n === 'build').length, 2, 'build really re-ran')
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(result.unresolvedFailures, undefined, 'the node record agrees')
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map(),
      'build produced its outputs on the re-run, so nothing is owed',
    )
    // And the failure really happened -- this is a recovery, not an absence.
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'),
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// The same node, never repaired. The run routes around it to the exit and
// reports a section 11.3-conformant SUCCESS (no goal gates), so the ledger is
// the only thing that knows `artifact.path` is never arriving.
//
// `note` is a plain tool node again. It was briefly a box node in fix round 1,
// to stop it writing `tool.last_line` and settling that debt; fix round 2 kept
// inferred keys out of the ledger entirely, so there is no such debt to settle
// and the original ordinary-graph fixture is back.
const LEDGER_STAYS_OWED = `
digraph LSO {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, tool_command="exit 1", outputs="artifact.path,artifact.sha"]
  note  [shape=parallelogram, tool_command="printf ok"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> done
}
`

test('a node that stays failed owes its declared outputs, attributed to it', async () => {
  const { result, engine, runDir, cwd } = await runObserving(LEDGER_STAYS_OWED, new StubBackend({}))
  try {
    assert.deepEqual(result.path, ['start', 'build', 'note', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates, so success')
    assert.deepEqual(result.unresolvedFailures, ['build'])
    // DECLARED outputs, and BOTH of them. This asserted the effective set --
    // the union with the handler's inferred `tool.last_line` -- until fix round
    // 2 withdrew inferred keys from the ledger, because `tool.last_line` is
    // inferred for every tool node and the stale-label rule exists precisely so
    // that key survives a failure to be READ, not to be marked unavailable.
    //
    // Asserting the WHOLE MAP rather than two `.has()` calls is what keeps the
    // NARROWING direction discriminating: narrow `recordFailedOutputs` any
    // further than this ruling intends -- record only the first declared key,
    // or stop recording on this path at all -- and a declared entry goes
    // missing, so this fails. That is the sensitivity that caught an earlier
    // narrowing and it is deliberately preserved: TWO declared keys, so
    // dropping either is visible.
    //
    // THE WIDENING DIRECTION IS NOT OBSERVABLE HERE, and the comment that used
    // to claim it was wrong. It read "re-widen it back to `effectiveOutputs`
    // and `tool.last_line` reappears as a third entry, so this fails too". It
    // does not: `note` is a tool node that SUCCEEDS after `build` fails, so it
    // writes `tool.last_line`, and the write-based clearing in `Engine.run`
    // removes the entry before this assertion ever runs. A test-quality audit
    // ran that mutation and this test stayed green, `.has()` call included.
    // The ruling is pinned by `an inferred key never enters the ledger, even
    // when nothing later writes it` below, on a fixture where nothing later
    // writes the key; this fixture keeps the ordinary-tool-graph shape and the
    // "another node's success does not settle this debt" property, and now
    // claims only what it can see.
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map([
        ['artifact.path', 'build'],
        ['artifact.sha', 'build'],
      ]),
    )
    // A different node succeeding does not settle another node's debt -- the
    // boundary the node-level record has, stated for the key-level one. Since
    // fix round 1 the precise statement is "does not settle it unless it
    // actually WRITES the key": `note` writes only `tool.last_line`, which is
    // nobody's debt, so both of `build`'s declared keys are still owed.
    assert.ok(result.path.includes('note'), 'note ran and succeeded')
  } finally {
    cleanup(runDir, cwd)
  }
})

// THE DECLARED-ONLY RULING, on a fixture that can actually see it.
//
// Identical to LEDGER_STAYS_OWED except that the node on the failure route is a
// BOX node. That one change is the whole point: a box node's StubBackend
// outcome carries no `contextUpdates`, so NOTHING in this run ever writes
// `tool.last_line`, and the write-based clearing has nothing to clear. If
// `recordFailedOutputs` reads `effectiveOutputs` instead of `declaredOutputs`,
// `build`'s inferred `tool.last_line` is recorded when it fails and is STILL IN
// THE LEDGER at the end of the run.
//
// The ruling this pins settled a live argument and is in the non-tradeable list
// in plugins/attractor/AGENTS.md: the stale-label rule exists precisely so a
// failing tool node's previous `tool.last_line` survives to be READ, so a
// ledger marking that key unavailable contradicts it head on. A key nobody
// declared is not a debt anybody owes.
//
// The box node also has to be reachable and lint-clean, hence the explicit
// `outcome=` edges either side of `build`.
const LEDGER_INFERRED_NEVER_OWED = `
digraph LIN {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, tool_command="exit 1", outputs="artifact.path,artifact.sha"]
  note  [shape=box, prompt="record what happened"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> done
}
`

test('an inferred key never enters the ledger, even when nothing later writes it', async () => {
  const backend = new StubBackend({})
  const { result, engine, context, runDir, cwd } = await runObserving(
    LEDGER_INFERRED_NEVER_OWED,
    backend,
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'note', 'done'])
    assert.deepEqual(result.unresolvedFailures, ['build'])

    // The setup IS the test, so it is asserted rather than assumed: nothing in
    // this run wrote `tool.last_line`. `build` failed, and the stale-label rule
    // means a failing tool node does not refresh it; `note` is a box node whose
    // stub outcome carries no contextUpdates. So the write-based clearing is
    // out of the picture and the ledger's own content is what is on show.
    assert.ok(
      backend.calls().some((c) => c.nodeId === 'note'),
      'the box node never ran, so this fixture proves nothing',
    )
    assert.equal(context.has('tool.last_line'), false, 'something wrote the key after all')

    // The ruling. Exactly the two DECLARED keys -- widening to the effective
    // set puts `tool.last_line` here as a third entry and both of these fail.
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map([
        ['artifact.path', 'build'],
        ['artifact.sha', 'build'],
      ]),
    )
    assert.equal(
      engine.outputsOwedByFailedNodes().has('tool.last_line'),
      false,
      'an inferred key is not a declared contract and must never enter the ledger',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// Abandonment. `build` crashes, the throw becomes RETRY, the policy exhausts
// at the default of zero retries, and because a fallback target exists the
// run jumps away BEFORE the rewrite-to-FAIL. So `build` never reaches a FAIL
// status and a ledger keyed on FAIL alone would record nothing -- while
// section 3.5 says that node failed, and its outputs are just as absent. A
// box node, so the owed set is exactly what its author declared (a model's
// `contextUpdates` keys are arbitrary, so box infers nothing).
//
// The target used to be declared graph-level; after the D7 fix, `build`'s own
// retry-exhaustion (section 3.7's ladder) no longer consults the graph-level
// rungs, so the target is declared on `build` itself. See
// ABANDONED_VIA_RETRY_TARGET above for the same change with fuller rationale.
const LEDGER_ABANDONED = `
digraph LAB {
  start [shape=Mdiamond]  done [shape=Msquare]
  plan   [shape=box]
  build  [shape=box, outputs="plan.md,review.md", fallback_retry_target="report"]
  report [shape=box]
  start -> plan
  plan -> report [condition="context.mode=report_only"]
  plan -> build
  build -> done
  report -> done
}
`

test('a node abandoned to a retry target after exhausting retries owes its keys too', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    LEDGER_ABANDONED,
    new RetryingBackend('build'),
  )
  try {
    assert.deepEqual(result.path, ['start', 'plan', 'build', 'report', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: verdict is goal gates alone')
    assert.deepEqual(result.unresolvedFailures, ['build'], 'the node record already sees this')
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map([
        ['plan.md', 'build'],
        ['review.md', 'build'],
      ]),
      'the run gave up on build; its declared outputs will never arrive',
    )
    const events = new EventLog(runDir).all()
    // The node never reached a FAIL status. Asserting the ABSENCE is what
    // stops the fix from being "populate on FAIL and hope".
    assert.ok(
      !events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'),
    )
    assert.ok(events.some((e) => e.type === 'node.retry.exhausted' && e.node === 'build'))
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a failing node that declares no outputs and infers none owes nothing', async () => {
  // The boundary of the rule above: the ledger records what a node was
  // CONTRACTED to produce, and invents nothing. A box node with no `outputs=`
  // has an empty effective set, so a failure of it is in the node record and
  // absent from the key record -- which is exactly the gap `outputs=` exists
  // to let an author close.
  const src = LEDGER_ABANDONED.replace(', outputs="plan.md,review.md"', '')
  const { result, engine, runDir, cwd } = await runObserving(src, new RetryingBackend('build'))
  try {
    assert.deepEqual(result.unresolvedFailures, ['build'], 'the node still failed')
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map(), 'but it owed no declared key')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The ledger is NOT routing state, demonstrated rather than asserted.
//
// `forged` is reachable only by an edge whose condition reads the ledger's own
// key as though it were context (`context.artifact.path=build` -- the key, and
// the exact value the ledger holds for it). If the engine ever wrote the
// ledger into Context, that edge would match and the run would route to
// `forged`. It must instead fall through to the author's real failure edge.
//
// This is the `{current_node: 'start'}` demonstration from Plan 3 turned
// around: there, engine state that WAS routing-visible got forged by a model.
// Here the requirement is the reverse direction -- engine state that must
// never become routing-visible in the first place, because these keys are
// author-chosen and `isEngineManagedKey` cannot reserve the author's own
// namespace.
const LEDGER_NOT_ROUTING_VISIBLE = `
digraph LNRV {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  forged [shape=parallelogram, tool_command="printf forged"]
  note   [shape=parallelogram, tool_command="printf ok"]
  start -> build
  build -> forged [condition="context.artifact.path=build"]
  build -> note   [condition="outcome=fail"]
  forged -> done
  note -> done
}
`

test('the ledger is not readable from a condition and never enters context', async () => {
  const { result, engine, context, runDir, cwd } = await runObserving(
    LEDGER_NOT_ROUTING_VISIBLE,
    new StubBackend({}),
  )
  try {
    // First: the ledger really does hold that key with that value, so the
    // condition below is a real attempt at reading it and not a vacuous one.
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
    // And routing did not see it. `forged` is unreachable by any other edge.
    assert.ok(!result.path.includes('forged'), 'the ledger decided no route')
    assert.deepEqual(result.path, ['start', 'build', 'note', 'done'])
    // The mechanism, checked directly: nothing wrote the key into Context.
    // Section 10.3 leaves a missing key as the empty string, which is what
    // made the condition false.
    assert.equal(context.has('artifact.path'), false)
    // Every entry, with no exemption. This skipped `tool.` keys until fix round
    // 2, because the handler legitimately writes `tool.last_line` into context
    // and the ledger used to carry it. Only declared keys reach the ledger now,
    // so there is nothing left to exempt and the loop is stricter for it.
    for (const key of engine.outputsOwedByFailedNodes().keys()) {
      assert.equal(context.has(key), false, `${key} leaked from the ledger into context`)
    }
    // The accessor hands out a copy: a caller mutating what it returns must
    // not be able to edit the engine's record.
    // Both probes use `artifact.path`, the one key still owed at the end of
    // this run. `tool.last_line` was the delete-probe's key until fix round 1,
    // when the ledger started clearing a key that some node has actually
    // written -- and `note` succeeds here, so it writes `tool.last_line` and
    // the entry is legitimately gone. The subject of the probe is that the
    // accessor hands back a COPY, which either key demonstrates.
    const stolen = engine.outputsOwedByFailedNodes()
    stolen.set('artifact.path', 'somewhere-else')
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
    stolen.delete('artifact.path')
    assert.equal(engine.outputsOwedByFailedNodes().has('artifact.path'), true)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the ledger fixtures are graphs the CLI would accept', () => {
  // Same standard the whole-branch review fixtures are held to: `attractor
  // run` refuses a graph with lint errors, so a fixture the CLI would reject
  // pins nothing an operator can reach. LEDGER_ABANDONED is excluded on
  // purpose -- like the abandonment fixtures above it routes by
  // `fallback_retry_target`, which is not an edge.
  for (const src of [
    LEDGER_REPAIR_LOOP,
    LEDGER_STAYS_OWED,
    LEDGER_INFERRED_NEVER_OWED,
    LEDGER_NOT_ROUTING_VISIBLE,
  ]) {
    const diags = lint(parseDot(src))
    assert.equal(
      hasErrors(diags),
      false,
      `lint errors: ${diags.filter((d) => d.severity === 'error').map((d) => d.code).join(', ')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// The EAGER INPUT CHECK. This is finding I1's fix, and the tests below are the
// first in this file to assert the run HALTS on that shape rather than walking
// past it.
//
// I1: a node fails; a later node's edge guards on a key the failed node was
// contracted to produce. Section 10.3 resolves a missing key to the empty
// string, so `context.artifact.path!=bad` is TRUE, section 3.3 step 1 returns
// that matched conditional edge before fail-fast is ever consulted, and the run
// walks into a node whose inputs do not exist. Section 10.3 is CORRECT and is
// not touched here. The defect was that a successor had no way to tell "my
// producer failed and this key is never arriving" from "this key is empty".
//
// The fix reads the Task-3 ledger before invoking a handler: the keys the
// node's handler would substitute, intersected with the keys owed by nodes the
// run gave up on. A non-empty intersection means the handler is NOT invoked and
// the node's outcome is FAIL, naming the key and the node that owed it.
//
// FAIL, and deliberately not SKIPPED. Section 5.2 defines SKIPPED as "Proceed
// without recording an outcome", which cannot also mean "halt" -- so
// amplifier's R12 M3 SKIPPED-propagation was rejected in the design. FAIL is
// honest (the node cannot do its work), is spec-defined, routes through section
// 3.7's ladder unchanged, and composes with the fail-fast doctrine, which is
// what actually stops the run.
//
// Nothing here changes the run VERDICT rule. Section 11.3 still decides status
// by goal gates alone; these runs report FAIL because a node failed and section
// 3.7 step 4 found no failure route, which is the spec's own mechanism.
// ---------------------------------------------------------------------------

// The I1 shape itself. `build` owes `artifact.path` and fails; the guard on the
// edge to `deploy` is vacuously true, so `deploy` is still reached.
//
// `deploy`'s command SUCCEEDS when it runs -- `${artifact.path}` sits inside
// single quotes, so the shell never tries to expand what our own substitution
// left literal. That is what makes this test discriminating: before the fix
// `deploy` ran, exited 0, and the run reached `done` reporting SUCCESS. A
// command that failed on its own would halt the run for the wrong reason and
// the test would pass with the feature deleted.
//
// `touch deployed` is the side effect that proves invocation. Asserting the
// absence of a real file is stronger than asserting the absence of an event:
// an event could be dropped by a refactor that still ran the command.
const I1_INPUT_UNAVAILABLE = `
digraph I1F {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  deploy [shape=parallelogram, tool_command="touch deployed && printf 'ship \${artifact.path}'"]
  start -> build
  build -> deploy [condition="context.artifact.path!=bad"]
  deploy -> done
}
`

test('a node whose input a failed node owed is not invoked, and the run halts', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    I1_INPUT_UNAVAILABLE,
    new StubBackend({}),
  )
  try {
    // The halt. `deploy` is VISITED -- it is the current node, it gets an
    // outcome, and it routes -- but it never executes. Visiting it is what
    // keeps section 3.4's visited-scoped goal-gate check and section 3.7's
    // failure ladder applicable to it at all.
    assert.deepEqual(result.path, ['start', 'build', 'deploy'], 'the run stopped at deploy')
    assert.ok(!result.path.includes('done'), 'the run did not reach the exit')
    assert.equal(result.status, Status.FAIL)

    // It never ran. The marker is the load-bearing assertion.
    assert.equal(
      existsSync(join(cwd, 'deployed')),
      false,
      'deploy executed: the handler was invoked with inputs that do not exist',
    )
    const events = new EventLog(runDir).all()
    assert.ok(
      !events.some((e) => e.type === 'node.tool.start' && e.node === 'deploy'),
      'the tool handler was entered',
    )

    // The reason names BOTH the key and the node that owed it. A message
    // naming only the key leaves an operator hunting for the producer.
    assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)
    assert.match(result.notes ?? '', /node 'build' failed/)
    assert.ok(
      events.some(
        (e) =>
          e.type === 'node.input_unavailable' &&
          e.node === 'deploy' &&
          e.key === 'artifact.path' &&
          e.owedBy === 'build',
      ),
      'the log records which key was missing and who owed it',
    )
    // Routing is unchanged: no edge matched a FAIL from `deploy`, so section
    // 3.7 step 4 terminated the pipeline. `deploy -> done` is unconditional
    // and fail-fast forbids it carrying a failure.
    assert.match(result.notes ?? '', /no matching edge from deploy after failure/)

    // Both records agree that two nodes are now unrecovered, in first-failure
    // order, and the ledger has grown `deploy`'s own debt.
    assert.deepEqual(result.unresolvedFailures, ['build', 'deploy'])
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
    // `deploy` is a TOOL node that never executed. Before fix round 2 it
    // re-recorded the inferred `tool.last_line` against itself anyway, which
    // poisoned that key for every node downstream of a blocked one. It
    // declared no outputs, so it now owes nothing.
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map([['artifact.path', 'build']]),
      'a blocked node recorded a debt it never declared',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// Transitivity. `verify` depends on `deploy.url`, which `deploy` declares and
// -- because `deploy` itself never ran -- never produces. The blocked node's
// own effective outputs have to enter the ledger keyed to ITSELF, or the
// failure stops propagating after exactly one hop and the run walks into
// `verify` instead.
const TRANSITIVE_INPUT_UNAVAILABLE = `
digraph TIU {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  deploy [shape=parallelogram, tool_command="touch deployed && printf 'ship \${artifact.path}'", outputs="deploy.url"]
  verify [shape=parallelogram, tool_command="touch verified && printf 'check \${deploy.url}'"]
  start -> build
  build  -> deploy [condition="context.artifact.path!=bad"]
  deploy -> verify [condition="context.deploy.url!=bad"]
  verify -> done
}
`

test('the failure propagates transitively: a blocked node owes its own outputs', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    TRANSITIVE_INPUT_UNAVAILABLE,
    new StubBackend({}),
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'deploy', 'verify'])
    assert.equal(result.status, Status.FAIL)
    assert.equal(existsSync(join(cwd, 'deployed')), false, 'deploy ran')
    assert.equal(existsSync(join(cwd, 'verified')), false, 'verify ran')

    // The second hop's message attributes the key to `deploy`, not to `build`.
    // `build` never declared `deploy.url` and blaming it would send an
    // operator to the wrong node.
    assert.match(result.notes ?? '', /required input 'deploy\.url' unavailable/)
    assert.match(result.notes ?? '', /node 'deploy' failed/)

    // The ledger carries both debts, each attributed to its own owner.
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
    assert.equal(
      engine.outputsOwedByFailedNodes().get('deploy.url'),
      'deploy',
      'the blocked node did not record the outputs it will now never produce',
    )
    assert.deepEqual(result.unresolvedFailures, ['build', 'deploy', 'verify'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// The PERMITTING direction, which matters as much as the refusing one: a
// reference to a key whose producer SUCCEEDED must still run, and must still
// receive the substituted value. A check that blocked on any reference at all
// would pass every test above and break every real pipeline.
//
// A box node produces the key, because a tool node can only write
// `tool.last_line` -- an author's arbitrary `outputs=` key on a box node is
// exactly the case the design says `outputs=` exists for.
const SUCCEEDED_PRODUCER = `
digraph SP {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=box, prompt="build it", outputs="artifact.path"]
  deploy [shape=parallelogram, tool_command="printf 'ship \${artifact.path}'"]
  start -> build
  build -> deploy
  deploy -> done
}
`

test('a reference to a key whose producer succeeded runs normally, and substitutes', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    SUCCEEDED_PRODUCER,
    new StubBackend({
      build: { status: Status.SUCCESS, contextUpdates: { 'artifact.path': 'out/app' } },
    }),
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'deploy', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(result.unresolvedFailures, undefined)
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map())
    // It ran with the REAL value, not merely "it ran". The command the handler
    // actually executed is on disk.
    assert.equal(readFileSync(join(runDir, 'deploy', 'command.sh'), 'utf8'), "printf 'ship out/app'")
  } finally {
    cleanup(runDir, cwd)
  }
})

// The other permitting direction: a producer that failed and was REPAIRED.
// The check consults the ledger as it stands at the moment of dispatch, so a
// debt the repair loop settled must not keep a downstream node from running --
// otherwise the first stumble in a convergence loop would poison the rest of
// the graph permanently.
//
// Same marker-file loop as the ledger's own repair test: `build` fails while
// `fixed` is absent and succeeds once `fix` has created it.
const REPAIRED_PRODUCER = `
digraph RP {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, max_retries=0, tool_command="test -f fixed", outputs="artifact.path"]
  fix    [shape=parallelogram, tool_command="touch fixed"]
  deploy [shape=parallelogram, tool_command="touch deployed && printf 'ship \${artifact.path}'"]
  start -> build
  build -> deploy [condition="outcome=success"]
  build -> fix    [condition="outcome=fail"]
  fix -> build
  deploy -> done
}
`

test('a repaired producer unblocks its consumer: the check reads the live ledger', async () => {
  const { result, engine, runDir, cwd } = await runObserving(REPAIRED_PRODUCER, new StubBackend({}))
  try {
    assert.deepEqual(result.path, ['start', 'build', 'fix', 'build', 'deploy', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(existsSync(join(cwd, 'deployed')), true, 'deploy was blocked by a settled debt')
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map())
    assert.equal(result.unresolvedFailures, undefined)
    // And the failure really happened, so this is a recovery rather than an
    // absence -- the same guard the ledger's own repair test carries.
    const events = new EventLog(runDir).all()
    assert.ok(events.some((e) => e.type === 'node.end' && e.node === 'build' && e.status === 'fail'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// A node is never blocked by a debt it owes ITSELF, and this is not a
// nicety. The node that would settle such a debt is this one, so blocking it
// makes the debt permanently unsettleable: `build` fails on its first pass,
// records that it owes `artifact.path`, is repaired, comes back -- and would
// refuse to run for the rest of the run, deadlocking the exact repair loop
// `clearFailedOutputs` exists to support. It would also be silent: the run
// halts naming a key the node itself was going to produce.
const SELF_OWED_DEBT = `
digraph SOD {
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, max_retries=0, tool_command="test -f fixed && printf 'built \${artifact.path}'", outputs="artifact.path"]
  fix   [shape=parallelogram, tool_command="touch fixed"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> fix  [condition="outcome=fail"]
  fix -> build
}
`

test('a node is not blocked by a key it owes itself', async () => {
  const { result, engine, runDir, cwd } = await runObserving(SELF_OWED_DEBT, new StubBackend({}))
  try {
    // Without the exemption the second visit to `build` never dispatches and
    // the run halts there with `['start', 'build', 'fix', 'build']`.
    assert.deepEqual(result.path, ['start', 'build', 'fix', 'build', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map(), 'the debt was settled')
    assert.equal(result.unresolvedFailures, undefined)
  } finally {
    cleanup(runDir, cwd)
  }
})

// The boundary: a reference to a key NOTHING owes is not blocked. `build`
// fails and owes `artifact.path`, but `note` references `report.title`, which
// no failed node was contracted to produce (here it arrives as a graph
// attribute). Without this, "some node failed" would become "nothing may run".
const UNRELATED_REFERENCE = `
digraph UR {
  graph [report_title="quarterly"]
  start [shape=Mdiamond]  done [shape=Msquare]
  build [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  note  [shape=parallelogram, tool_command="touch noted && printf 'report \${report_title}'"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> done
}
`

test('a reference to a key no failed node owed is not blocked', async () => {
  const { result, runDir, cwd } = await runObserving(UNRELATED_REFERENCE, new StubBackend({}))
  try {
    assert.deepEqual(result.path, ['start', 'build', 'note', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates, so success')
    assert.equal(existsSync(join(cwd, 'noted')), true, 'the unrelated node was blocked')
    assert.equal(
      readFileSync(join(runDir, 'note', 'command.sh'), 'utf8'),
      "touch noted && printf 'report quarterly'",
    )
    // The failure is still recorded -- this is a permission, not an amnesty.
    assert.deepEqual(result.unresolvedFailures, ['build'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// A goal gate blocked by an unavailable input FAILS, and a FAIL is not a
// satisfied gate. Stated as its own test because the fail-closed doctrine is
// the one thing a "do not invoke the handler" shortcut could plausibly break:
// a node that never runs must not be treated as a node that had nothing to
// say. It is visited, it is recorded FAIL, and the exit refuses it.
const GATE_WITH_UNAVAILABLE_INPUT = `
digraph GUI {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  verify [shape=box, goal_gate="true", prompt="judge \${artifact.path}"]
  start -> build
  build -> verify [condition="context.artifact.path!=bad"]
  verify -> done
}
`

test('a goal gate whose input is unavailable fails closed and is never dispatched', async () => {
  const backend = new StubBackend({
    // Would satisfy the gate if it were ever asked. It must not be asked.
    verify: { status: Status.SUCCESS, preferredLabel: 'approved' },
  })
  const { result, runDir, cwd } = await runObserving(GATE_WITH_UNAVAILABLE_INPUT, backend)
  try {
    assert.deepEqual(result.path, ['start', 'build', 'verify'])
    assert.equal(result.status, Status.FAIL)
    assert.deepEqual(backend.calls(), [], 'the gate was dispatched to the model')
    assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)
    assert.deepEqual(result.unresolvedFailures, ['build', 'verify'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// The engine and the DATA-001 lint must agree about what even counts as a
// reference. They read ONE table -- `SUBSTITUTABLE_ATTRS` in `dot/graph.ts` --
// rather than each keeping a list, for the reason `splitClauses`,
// `TYPE_TO_HANDLER` and `TOOL_OUTPUT_KEYS` were each extracted: a second list
// looks right on the day it is written and drifts the moment one side changes.
//
// The table is keyed off the RESOLVED handler and lists attributes in the
// handler's own FALLBACK order, because that is what the handlers demonstrably
// do: `BoxHandler` expands `attrs.prompt || attrs.label`, so a label IS the
// prompt when no prompt is set and is inert decoration otherwise, and
// `ToolHandler` expands `attrs.tool_command`. Nothing else substitutes
// anything.
test('SUBSTITUTABLE_ATTRS covers every handler kind', () => {
  // Same enforcement INFERRED_OUTPUTS_BY_HANDLER gets, and for the same
  // reason: this project strips types rather than checking them, so
  // `Record<HandlerKind, ...>` exhaustiveness is an editor signal and nothing
  // that runs. A new handler kind must be a decision someone makes.
  for (const kind of Object.values(Handler)) {
    assert.ok(
      Object.hasOwn(SUBSTITUTABLE_ATTRS, kind),
      `SUBSTITUTABLE_ATTRS has no entry for handler kind ${kind}`,
    )
  }
})

test('substitutableText reproduces each handler prompt-or-label fallback exactly', () => {
  const box = (attrs: Record<string, string>): Node => ({ id: 'n', attrs, handler: Handler.CODERGEN })
  assert.equal(substitutableText(box({ prompt: 'p', label: 'l' })), 'p', 'prompt wins')
  assert.equal(substitutableText(box({ label: 'l' })), 'l', 'a label IS the prompt with no prompt')
  // `||` and not `??`: BoxHandler falls back on an EMPTY prompt rather than
  // dispatching a blank one, so an empty prompt must fall through here too.
  assert.equal(substitutableText(box({ prompt: '', label: 'l' })), 'l')
  assert.equal(substitutableText(box({})), '')
  assert.equal(
    substitutableText({ id: 'n', attrs: { tool_command: 'c', label: 'l' }, handler: Handler.TOOL }),
    'c',
    "a tool node's label is decoration; only tool_command is expanded",
  )
  // Passthrough handlers substitute nothing, so a start/exit/diamond node can
  // never be blocked by a reference it does not make.
  for (const kind of [Handler.START, Handler.EXIT, Handler.CONDITIONAL]) {
    assert.equal(substitutableText({ id: 'n', attrs: { prompt: 'p', label: 'l' }, handler: kind }), '')
  }
})

// ---------------------------------------------------------------------------
// FIX ROUND 1. The ledger cleared by OWNER only, and `tool.last_line` is in
// EVERY tool node's inferred output set. So on an entirely ordinary graph --
// `build` (tool) fails onto a routed failure edge, `note` (tool) later succeeds
// and writes `tool.last_line=ok` -- the ledger still reported
// `tool.last_line => build`, and the eager input check above then refused any
// downstream node substituting `${tool.last_line}`. A FALSE HALT, on an input
// that is demonstrably present, which is worse than the walk-past behaviour
// this plan replaces.
//
// The ledger's meaning is "this key is unavailable because the node contracted
// to produce it did not produce it". Once ANYTHING has produced it, it is
// available and the entry is stale. So a key now leaves the ledger when it is
// actually WRITTEN, keyed on the key rather than on the owner.
//
// Two things this must not become, and they pull in opposite directions:
//
// - Clearing on what a node DECLARED. `effectiveOutputs` is a contract, not
//   evidence: a node can succeed while writing only some of it. Clearing on
//   the declaration would mark keys available that nobody produced -- this
//   plan's own failure mode, inverted.
// - Clearing because a value is merely PRESENT. The stale-label doctrine
//   deliberately leaves a failed tool node's previous `tool.last_line` in
//   place, and a value being present is not evidence that this run produced
//   it.
//
// The evidence used is therefore what actually reached `Context`, recorded by
// `Context` itself as it is written (`takeWritten`), not the outcome's
// `contextUpdates`. That distinction is a security property, not a style
// choice: `BoxHandler` merges only the ALLOWED updates into context but
// returns the RAW ones on its Outcome, so a model answering
// `contextUpdates: {'tool.last_line': 'green'}` -- rejected by the
// engine-managed guard and never written -- would otherwise forge a ledger
// clear and defeat this check for that key. That is exactly the forgery Plan 3
// demonstrated. Filtering the outcome by `isEngineManagedKey` in the engine
// would not do either: it would drop `ToolHandler`'s entirely legitimate
// `tool.last_line` write, which is the very key this bug is about.
// ---------------------------------------------------------------------------

// The shape that broke, re-anchored on a DECLARED key.
//
// It originally rode on `tool.last_line`: `build` (tool) failed, `note` (tool)
// succeeded and wrote it, and the owner-only clearing rule still reported it
// owed. Fix round 2 removed inferred keys from the ledger altogether, so that
// vehicle no longer demonstrates anything -- the key was never owed to begin
// with, and this test would have kept passing for a reason unrelated to the
// clearing rule it exists to pin.
//
// So the same shape on a key both nodes DECLARE: `build` owes `artifact.path`
// and fails; `note` declares it too and actually writes it. The debt belongs to
// `build`, `note` is a different node, and owner-only clearing would leave it
// standing.
const LATER_NODE_WROTE_THE_KEY = `
digraph LNW {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  note   [shape=box, outputs="artifact.path"]
  report [shape=parallelogram, tool_command="touch reported && printf 'saw \${artifact.path}'"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> report
  report -> done
}
`

test('a key another node has since written is no longer owed, whoever owed it', async () => {
  const { result, engine, context, runDir, cwd } = await runObserving(
    LATER_NODE_WROTE_THE_KEY,
    new StubBackend({
      note: { status: Status.SUCCESS, contextUpdates: { 'artifact.path': 'out/app' } },
    }),
  )
  try {
    // Under owner-only clearing this halted at `report`: `build` owns the debt,
    // `note` is a different node, and the entry survived its write.
    assert.deepEqual(result.path, ['start', 'build', 'note', 'report', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates, so success')
    assert.equal(existsSync(join(cwd, 'reported')), true, 'report was falsely blocked')
    // It ran with the value `note` actually produced, not merely "it ran".
    assert.equal(context.get('artifact.path'), 'out/app')
    assert.equal(
      readFileSync(join(runDir, 'report', 'command.sh'), 'utf8'),
      "touch reported && printf 'saw out/app'",
    )
    // The clearing is per KEY, not an amnesty: the node record still holds the
    // failure, and the ledger is empty only because the key really arrived.
    assert.deepEqual(result.unresolvedFailures, ['build'])
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map())
  } finally {
    cleanup(runDir, cwd)
  }
})

// The negative, so the fix does not simply defeat the check it is fixing: a
// key nobody has written stays owed and still blocks.
//
// `note` DECLARES `artifact.path` and succeeds, but a tool handler cannot
// write an arbitrary key, so nothing produced it. A declaration is a contract,
// not evidence -- clearing on `effectiveOutputs` would mark this key available
// on `note`'s say-so and walk `report` into an input that does not exist.
const DECLARED_BUT_NEVER_WRITTEN = `
digraph DBW {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  note   [shape=parallelogram, tool_command="printf ok", outputs="artifact.path"]
  report [shape=parallelogram, tool_command="touch reported && printf 'saw \${artifact.path}'"]
  start -> build
  build -> done [condition="outcome=success"]
  build -> note [condition="outcome=fail"]
  note -> report
  report -> done
}
`

test('a key a later node only DECLARED, and never wrote, stays owed and still blocks', async () => {
  const { result, engine, context, runDir, cwd } = await runObserving(
    DECLARED_BUT_NEVER_WRITTEN,
    new StubBackend({}),
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'note', 'report'])
    assert.equal(result.status, Status.FAIL)
    assert.equal(existsSync(join(cwd, 'reported')), false, 'report ran on an input nobody wrote')
    assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)
    assert.match(result.notes ?? '', /node 'build' failed/)
    // The mechanism, checked directly: nothing ever put the key in context, so
    // `note` declaring it changed nothing.
    assert.equal(context.has('artifact.path'), false)
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
  } finally {
    cleanup(runDir, cwd)
  }
})

// A value being PRESENT is not evidence that this run produced it.
//
// `seed` writes `artifact.path=v1`. `build` DECLARES `artifact.path` and then
// fails, so the key is owed by `build` while "v1" still sits in context, put
// there by a node two hops back. The contract `build` signed was to refresh
// that key; it did not, and the leftover is a previous run stage's value, not
// this one's.
//
// The condition/substitution separation, proved in one fixture. These govern
// different surfaces and the fixture exercises both at once:
//
// - CONDITIONS read context directly and see the leftover. The only route out
//   of `build` is `outcome=fail && context.artifact.path=v1`, so the run
//   reaching `report` AT ALL is that value being readable.
// - SUBSTITUTION does not accept it. `report` is blocked, because `build` did
//   not write the key it owed.
//
// If the eager check ever grows to scan conditions, these two meet and the
// separation stops being free. It is deliberate today, not incidental. Note
// this fixture no longer needs `tool.last_line` to make the point: since only
// DECLARED keys enter the ledger, the stale-label rule and the ledger cannot
// argue about that key at all, which is the whole reason for that ruling.
const STALE_VALUE_IS_NOT_A_WRITE = `
digraph SVW {
  start [shape=Mdiamond]  done [shape=Msquare]
  seed   [shape=box, outputs="artifact.path"]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  report [shape=parallelogram, tool_command="touch reported && printf 'saw \${artifact.path}'"]
  start -> seed
  seed -> build
  build -> report [condition="outcome=fail && context.artifact.path=v1"]
  report -> done
}
`

test('a value an earlier node left in context does not clear the debt', async () => {
  const { result, engine, context, runDir, cwd } = await runObserving(
    STALE_VALUE_IS_NOT_A_WRITE,
    new StubBackend({
      seed: { status: Status.SUCCESS, contextUpdates: { 'artifact.path': 'v1' } },
    }),
  )
  try {
    // Reaching `report` at all proves conditions still read the leftover:
    // `build` never refreshed it, and the guard matched on "v1" anyway.
    assert.deepEqual(result.path, ['start', 'seed', 'build', 'report'])
    assert.equal(context.get('artifact.path'), 'v1', 'the earlier value survived the failure')
    // And substitution refused it: present is not produced.
    assert.equal(result.status, Status.FAIL)
    assert.equal(existsSync(join(cwd, 'reported')), false, 'a leftover value cleared the debt')
    assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)
    assert.match(result.notes ?? '', /node 'build' failed/)
    assert.equal(engine.outputsOwedByFailedNodes().has('artifact.path'), true, 'still owed')
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// FIX ROUND 2. Only DECLARED outputs enter the ledger. Inferred keys never do.
//
// `tool.last_line` is inferred for EVERY tool node, so no author opt-in was
// needed to hit this: the failure-reporting branch of any tool pipeline was
// unreachable.
//
//   build  [shape=parallelogram, tool_command="exit 1"]
//   notify [shape=parallelogram, tool_command="printf 'build said: ${tool.last_line}'"]
//   build -> notify [condition="outcome=fail"]
//
// `build` failed, the ledger recorded the inferred `tool.last_line` against it,
// and the eager check then refused `notify` -- the node whose entire job is to
// report the failure. There is no `outputs=` anywhere in that graph. Worse,
// `notify` then re-recorded `tool.last_line` against ITSELF despite never
// executing, poisoning the key for everything downstream.
//
// The reason this is a doctrine question rather than a tuning one: THE
// STALE-LABEL RULE EXISTS PRECISELY SO A FAILING TOOL NODE'S PREVIOUS
// `tool.last_line` SURVIVES TO BE READ. That is the whole point of the rule and
// it is in the non-tradeable list. A ledger marking the same key "unavailable"
// contradicts it head on. The two mechanisms were arguing; the doctrine wins.
//
// It also puts the mechanism where the design always said it was: `outputs=` is
// a node DECLARING A CONTRACT. Inference exists so DATA-001 can reason about
// what a graph supplies -- it was never evidence that anyone promised anything.
// A key nobody declared is not a debt anybody owes.
// ---------------------------------------------------------------------------

// The shape from the finding, verbatim: no `outputs=` anywhere in the graph.
const NOTIFY_ON_FAILURE = `
digraph NOF {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1"]
  notify [shape=parallelogram, tool_command="touch alerted && printf 'build said: \${tool.last_line}'"]
  start -> build
  build -> notify [condition="outcome=fail"]
  notify -> done
}
`

test('a failure-reporting node is not blocked by an inferred key nobody declared', async () => {
  const { result, engine, runDir, cwd } = await runObserving(NOTIFY_ON_FAILURE, new StubBackend({}))
  try {
    // Before this ruling: halted at `notify` with "required input
    // 'tool.last_line' unavailable: node 'build' failed".
    assert.deepEqual(result.path, ['start', 'build', 'notify', 'done'])
    assert.equal(result.status, Status.SUCCESS, 'section 11.3: no goal gates, so success')
    assert.equal(existsSync(join(cwd, 'alerted')), true, 'the failure reporter never ran')
    // The ledger is EMPTY: nothing in this graph declared anything, so nobody
    // owes anything. That is the ruling, stated directly.
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map())
    // And the failure is still recorded -- this is not an amnesty, it is the
    // key record declining to invent a debt no author signed up for.
    assert.deepEqual(result.unresolvedFailures, ['build'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// The sharper variant: an earlier successful tool node leaves a REAL value in
// `tool.last_line`, so the input the reporter substitutes is demonstrably
// present -- and it was still refused. This is the stale-label rule's own
// scenario, and the value the reporter reads is exactly the one that rule
// exists to preserve.
const NOTIFY_WITH_EARLIER_VALUE = `
digraph NEV {
  start [shape=Mdiamond]  done [shape=Msquare]
  probe  [shape=parallelogram, tool_command="printf green"]
  build  [shape=parallelogram, tool_command="exit 1"]
  notify [shape=parallelogram, tool_command="touch alerted && printf 'build said: \${tool.last_line}'"]
  start -> probe
  probe -> build
  build -> notify [condition="outcome=fail"]
  notify -> done
}
`

test('an inferred key holding a real earlier value does not block either', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    NOTIFY_WITH_EARLIER_VALUE,
    new StubBackend({}),
  )
  try {
    assert.deepEqual(result.path, ['start', 'probe', 'build', 'notify', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(existsSync(join(cwd, 'alerted')), true)
    // The stale label really was what the reporter read: `build` failed without
    // refreshing `tool.last_line`, so `probe`'s "green" survived -- which is
    // the stale-label rule doing its job, now with nothing arguing against it.
    assert.equal(
      readFileSync(join(runDir, 'notify', 'command.sh'), 'utf8'),
      "touch alerted && printf 'build said: green'",
    )
    assert.deepEqual(engine.outputsOwedByFailedNodes(), new Map())
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the eager-input-check fixtures are graphs the CLI would accept', () => {
  // `attractor run` refuses a graph with lint errors, so a fixture the CLI
  // would reject pins nothing an operator can reach.
  for (const src of [
    I1_INPUT_UNAVAILABLE,
    TRANSITIVE_INPUT_UNAVAILABLE,
    SUCCEEDED_PRODUCER,
    REPAIRED_PRODUCER,
    SELF_OWED_DEBT,
    UNRELATED_REFERENCE,
    LATER_NODE_WROTE_THE_KEY,
    DECLARED_BUT_NEVER_WRITTEN,
    STALE_VALUE_IS_NOT_A_WRITE,
    NOTIFY_ON_FAILURE,
    NOTIFY_WITH_EARLIER_VALUE,
    GATE_WITH_UNAVAILABLE_INPUT,
  ]) {
    const diags = lint(parseDot(src))
    assert.equal(
      hasErrors(diags),
      false,
      `lint errors: ${diags.filter((d) => d.severity === 'error').map((d) => d.code).join(', ')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Task 5: `runs_on={always|success|failure}`.
//
// A CUSTOM node attribute, and legitimately so: section 2's design goals state
// the DSL "remains predictable while being extensible through custom
// attributes". The spec defines nothing named `runs_on` (checked against
// attractor-spec.md, not assumed), so this is an extension and contradicts
// nothing.
//
// The axis answers "does this node run at all", and it is DELIBERATELY SEPARATE
// from any "ignore my own failure" knob. Amplifier's own design reached that
// conclusion after conflating the two: `continue_on_fail` means "this node
// failed, but route as success", which is a different question from "this node
// runs BECAUSE upstream failed". Conflated, a cleanup node silences its own
// genuine failures -- so the `runs_on=always` node that fails on its own terms
// is tested below and must still be reported as failed.
// ---------------------------------------------------------------------------

// The motivating shape, verbatim from the design: `work` declares a handle,
// `cleanup` releases it whatever happened to `work`. Both routes into `cleanup`
// are explicit, because fail-fast forbids an unconditional edge carrying a
// failure -- a cleanup node still has to be ROUTED to, and `runs_on` decides
// only what happens once it is reached.
//
// `${resource.handle}` sits inside single quotes so the shell never tries to
// expand whatever our substitution leaves behind, and the substituted command
// is read back off disk: asserting the TEXT the handler ran distinguishes "the
// reference resolved empty" from "the reference was left literal", which is
// exactly the distinction the whole-branch review turned into a Critical.
const CLEANUP_RUNS_ON_ALWAYS = `
digraph CRA {
  start [shape=Mdiamond]  done [shape=Msquare]
  work    [shape=box, prompt="do the work", outputs="resource.handle"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="printf 'release [\${resource.handle}]' > released"]
  start -> work
  work -> cleanup [condition="outcome=success"]
  work -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

// A BEHAVIOUR-UNCHANGED PIN, and labelled as one because it cannot be anything
// else. `work` succeeds, so the ledger is empty, so there is nothing for
// `runs_on` to do: this run is byte-for-byte what a default node would produce,
// and a test-quality audit confirmed it stays green with `runsOn()` hard-wired
// to SUCCESS. It is kept because "adding runs_on=always must not disturb the
// ordinary path" is worth pinning, and it is worth nothing as evidence that the
// attribute works. The `runs_on`-SENSITIVE version of "with the real value" is
// the stale-value test below, where a key is owed AND present at once.
test('runs_on=always does not disturb the ordinary path when the work SUCCEEDED', async () => {
  const { result, runDir, cwd } = await runObserving(
    CLEANUP_RUNS_ON_ALWAYS,
    new StubBackend({
      work: { status: Status.SUCCESS, contextUpdates: { 'resource.handle': 'h-1' } },
    }),
  )
  try {
    assert.deepEqual(result.path, ['start', 'work', 'cleanup', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(result.unresolvedFailures, undefined)
    assert.equal(existsSync(join(cwd, 'released')), true, 'cleanup never ran')
    assert.equal(readFileSync(join(cwd, 'released'), 'utf8'), 'release [h-1]')
  } finally {
    cleanup(runDir, cwd)
  }
})

// OWED AND PRESENT AT THE SAME TIME -- the branch nothing covered.
//
// `seed` writes `artifact.path=v1` and succeeds. `build` declares the same key,
// fails, and the stale-label rule leaves `v1` in context untouched. So when
// `cleanup` is reached the key is in the LEDGER (owed by `build`, never coming)
// and in CONTEXT (a real value some node genuinely produced) simultaneously.
//
// The audit found this branch reachable and completely uncovered: it mutated
// the old `OwedKeysReadEmpty.get` to blank an owed key even when it was
// genuinely present -- destroying the property its own doc comment claimed --
// and killed ZERO tests in the whole suite. That class is gone now (an owed key
// is left literal instead of blanked), which settles the mutation but not the
// coverage: the shape is still reachable and still needs a test that says what
// happens.
//
// Two things are asserted, and they are the two halves of what `runs_on=always`
// actually means now:
//
// - The node RUNS. `artifact.path` is owed, so the eager input check would
//   refuse an ordinary node here; `runs_on=always` is the only reason it is
//   dispatched at all. Make the check unconditional and this test dies.
// - It runs with THE REAL VALUE. Being owed does not blank, hide or literalise
//   a value that is actually in context -- `substitute` reads context and finds
//   `v1`, exactly as it would for any other node.
//
// And the debt is NOT settled by any of it: reading is not producing.
const CLEANUP_READS_A_STALE_VALUE = `
digraph CSV {
  start [shape=Mdiamond]  done [shape=Msquare]
  seed    [shape=box, prompt="seed the handle", outputs="artifact.path"]
  build   [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="printf 'release [\${artifact.path}]' > released"]
  start -> seed
  seed -> build
  build -> cleanup [condition="outcome=success"]
  build -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

test('runs_on=always: a key that is owed AND present is read at its real value', async () => {
  const { result, engine, context, runDir, cwd } = await runObserving(
    CLEANUP_READS_A_STALE_VALUE,
    new StubBackend({
      seed: { status: Status.SUCCESS, contextUpdates: { 'artifact.path': 'v1' } },
    }),
  )
  try {
    // The setup, asserted rather than assumed: owed and present at once.
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build', 'not owed')
    assert.equal(context.get('artifact.path'), 'v1', 'not present')

    // It ran -- which only `runs_on=always` permits, the key being owed.
    assert.deepEqual(result.path, ['start', 'seed', 'build', 'cleanup', 'done'])
    assert.equal(existsSync(join(cwd, 'released')), true, 'the cleanup node was blocked')
    // And it ran with the real value: not blanked, not left literal.
    assert.equal(
      readFileSync(join(cwd, 'released'), 'utf8'),
      'release [v1]',
      'a value genuinely in context must survive the key also being owed',
    )

    // Reading is not producing. The debt outlives the cleanup that read it, so
    // an ordinary successor would still be refused.
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
    assert.deepEqual(result.unresolvedFailures, ['build'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runs_on=always: cleanup runs, with the owed reference LITERAL, when the work FAILED', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    CLEANUP_RUNS_ON_ALWAYS,
    new StubBackend({ work: { status: Status.FAIL, notes: 'boom' } }),
  )
  try {
    assert.deepEqual(result.path, ['start', 'work', 'cleanup', 'done'])
    // Section 11.3 decides the verdict by goal gates alone, so a run that
    // routed its failure and reached the exit is a conformant SUCCESS -- with
    // the failure named out loud, which is the doctrine's actual requirement.
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['work'])

    // The load-bearing assertion: under the default `runs_on=success` the
    // eager input check would have refused to invoke the handler at all,
    // because `resource.handle` is owed by a node the run gave up on. What
    // `runs_on` buys is the DISPATCH, and nothing else.
    assert.equal(existsSync(join(cwd, 'released')), true, 'cleanup was blocked by its own input')
    assert.equal(
      readFileSync(join(cwd, 'released'), 'utf8'),
      'release [${resource.handle}]',
      'an owed reference must stay LITERAL, exactly as an unknown key does',
    )
    // And the debt is still on the books: cleaning up is not producing.
    assert.equal(engine.outputsOwedByFailedNodes().get('resource.handle'), 'work')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The third route in: `work` never reaches a FAIL status at all. Its throw
// becomes RETRY, the policy exhausts at the default of zero retries, and because
// a retry target exists the engine abandons the node and jumps -- so a `runs_on`
// implementation keyed on a FAIL outcome would be silently wrong for the most
// reachable failure there is.
//
// `work -> cleanup [condition="outcome=fail"]` is inert for THIS run -- the
// retry-target jump happens before edge selection ever runs -- and is present
// because a node reachable only through a `retry_target` is a TOPO-004 lint
// error, and a fixture the CLI would refuse pins nothing an operator can reach.
const CLEANUP_RUNS_ON_ALWAYS_ABANDONED = `
digraph CRAA {
  start [shape=Mdiamond]  done [shape=Msquare]
  work    [shape=box, prompt="do the work", retry_target="cleanup", outputs="resource.handle"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="printf 'release [\${resource.handle}]' > released"]
  start -> work
  work -> done [condition="outcome=success"]
  work -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

test('runs_on=always: cleanup runs when the work was ABANDONED to a retry target', async () => {
  const { result, runDir, cwd } = await runObserving(
    CLEANUP_RUNS_ON_ALWAYS_ABANDONED,
    new RetryingBackend('work'),
  )
  try {
    assert.deepEqual(result.path, ['start', 'work', 'cleanup', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['work'], 'the abandonment is on the record')
    const events = new EventLog(runDir).all()
    assert.ok(events.some((e) => e.type === 'node.retry.exhausted' && e.node === 'work'))
    assert.ok(
      !events.some((e) => e.type === 'node.end' && e.node === 'work' && e.status === 'fail'),
      'work never reached a FAIL status -- that is what makes this case distinct',
    )
    assert.equal(existsSync(join(cwd, 'released')), true, 'cleanup never ran')
    assert.equal(readFileSync(join(cwd, 'released'), 'utf8'), 'release [${resource.handle}]')
  } finally {
    cleanup(runDir, cwd)
  }
})

// `runs_on=failure`, and the node references NOTHING -- the degenerate case the
// design's phrase "one of its referenced producers failed" does not answer.
//
// The rule implemented is the RUN-scoped one: a `runs_on=failure` node runs
// when the run is holding a failure nothing has recovered. `notify` here has no
// references AND `work` declares no `outputs=`, so the failed-output ledger is
// empty on both counts -- a key-scoped rule would never fire this node, which
// for a box node (whose inferred output set is deliberately empty) is the
// common case rather than a corner.
const NOTIFY_RUNS_ON_FAILURE = `
digraph NRF {
  start [shape=Mdiamond]  done [shape=Msquare]
  work   [shape=box, prompt="do the work"]
  notify [shape=parallelogram, runs_on=failure, tool_command="touch alerted"]
  start -> work
  work -> notify [condition="outcome=success"]
  work -> notify [condition="outcome=fail"]
  notify -> done
}
`

test('runs_on=failure does NOT run when everything succeeded', async () => {
  const { result, runDir, cwd } = await runObserving(NOTIFY_RUNS_ON_FAILURE, new StubBackend({}))
  try {
    // VISITED but not executed: it is on the path, it is checkpointed, it gets
    // an outcome and it routes onward. Only the dispatch is skipped.
    assert.deepEqual(result.path, ['start', 'work', 'notify', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(
      existsSync(join(cwd, 'alerted')),
      false,
      'the failure handler ran on a healthy run',
    )
    const events = new EventLog(runDir).all()
    assert.ok(!events.some((e) => e.type === 'node.tool.start' && e.node === 'notify'))
    assert.ok(
      events.some((e) => e.type === 'node.runs_on.skipped' && e.node === 'notify'),
      'a node that did not run must say so in the log',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runs_on=failure DOES run when the run is holding an unrecovered failure', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    NOTIFY_RUNS_ON_FAILURE,
    new StubBackend({ work: { status: Status.FAIL, notes: 'boom' } }),
  )
  try {
    assert.deepEqual(result.path, ['start', 'work', 'notify', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.unresolvedFailures, ['work'])
    assert.equal(existsSync(join(cwd, 'alerted')), true, 'the failure handler never ran')
    // The record this decision reads is the NODE record, not the key ledger --
    // and here the key ledger is empty, so a test that only asserted "it ran"
    // could not tell the two apart.
    assert.deepEqual(
      engine.outputsOwedByFailedNodes(),
      new Map(),
      'the ledger is empty: a box node with no outputs= owes nothing',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// A cleanup node must not become UNFAILABLE. `runs_on` says when a node runs;
// it says nothing about how its own outcome is treated. Conflating the two is
// exactly the mistake that makes a cleanup node swallow real failures.
const ALWAYS_STILL_REPORTS_ITS_OWN_FAILURE = `
digraph ASF {
  start [shape=Mdiamond]  done [shape=Msquare]
  work    [shape=box, prompt="do the work"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="exit 7"]
  start -> work
  work -> cleanup
  cleanup -> done
}
`

test('a runs_on=always node that fails on its own terms still reports its failure', async () => {
  const { result, runDir, cwd } = await runObserving(
    ALWAYS_STILL_REPORTS_ITS_OWN_FAILURE,
    new StubBackend({}),
  )
  try {
    assert.deepEqual(result.path, ['start', 'work', 'cleanup'], 'the run stopped at cleanup')
    // Fail-fast: `cleanup -> done` is unconditional and may not carry a FAIL.
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /no matching edge from cleanup after failure/)
    assert.deepEqual(result.unresolvedFailures, ['cleanup'])
  } finally {
    cleanup(runDir, cwd)
  }
})

// An UNRECOGNISED value falls back to the default, `success`, and the fallback
// direction is the safe one: a typo makes the node behave like every ordinary
// node (the eager input check applies) rather than silently switching the check
// off. `type` sets the precedent -- `handlerForNode` degrades to shape and the
// TYPE-001 lint rule is what names the typo -- and RUNS-001 now does the same
// for this one.
//
// This is the one fixture in this file the CLI would REFUSE, deliberately, so
// it is excluded from the acceptability sweep below and asserted the other way
// round instead -- see the RUNS-001 test immediately after this one.
const RUNS_ON_UNRECOGNISED = `
digraph ROU {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  cleanup [shape=parallelogram, runs_on=alwyas, tool_command="touch released && printf 'release \${artifact.path}'"]
  start -> build
  build -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

// This test used to pin the ENGINE's half end to end, via `engine.run()`:
// dispatch this fixture and observe that `cleanup` never actually ran against
// the owed `artifact.path`, proving the degradation to `success` mode is safe
// in practice. FR-11/F10 removed the ground that test stood on -- `run()` now
// refuses ANY lint-ERROR graph before dispatching anything, and this fixture
// is deliberately RUNS-001-dirty (that is the whole point, see the comment
// above), so `engine.run()` can no longer reach `cleanup` at all; the run now
// fails at the refusal, not at the input check. That is not a loss of
// coverage, it is the SAME claim this task exists to prove, one layer up: the
// public `Engine.run()` API no longer lets an unrecognised `runs_on` value
// reach the runtime at all. What genuinely remains untested at the integration
// level is `runsOn()`'s own fallback direction, which this test now pins
// directly, calling the function itself rather than routing around
// `Engine.run()`'s new refusal to reach it indirectly.
test('an unrecognised runs_on value falls back to success, not to always', () => {
  const node = parseDot(RUNS_ON_UNRECOGNISED).nodes.get('cleanup')
  assert.ok(node, 'the fixture declares a cleanup node')
  assert.equal(node!.attrs.runs_on, 'alwyas', 'the fixture really does carry the typo')
  assert.equal(runsOn(node!), RunsOn.SUCCESS, 'a typo must not silently switch the check off')
})

// The lint half of the same typo, on the same fixture. The engine degrades
// safely; RUNS-001 is what stops an operator ever reaching that degradation
// from a checked-in graph, because `attractor run` refuses a graph with lint
// errors. Asserted on the ENGINE's fixture rather than on a fresh one so the
// two halves cannot drift into disagreeing about which values are recognised.
test('RUNS-001 refuses the fixture whose runs_on the engine degrades', () => {
  const diags = lint(parseDot(RUNS_ON_UNRECOGNISED)).filter((d) => d.code === 'RUNS-001')
  assert.equal(diags.length, 1)
  assert.equal(diags[0].node, 'cleanup')
  assert.equal(diags[0].severity, 'error')
  assert.match(diags[0].message, /alwyas/)
  assert.ok(hasErrors(lint(parseDot(RUNS_ON_UNRECOGNISED))), 'the CLI would run this graph')
})

// Dispatching a cleanup node settles nothing. A `runs_on=always` node that was
// permitted to run against an owed key must not leave the ledger looking as
// though the key had arrived: the next ordinary node referencing it is still
// blocked.
const ALWAYS_DOES_NOT_LAUNDER_THE_LEDGER = `
digraph ADL {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="printf 'release [\${artifact.path}]' > released"]
  ship    [shape=parallelogram, tool_command="touch shipped && printf 'ship \${artifact.path}'"]
  start -> build
  build   -> cleanup [condition="outcome=fail"]
  cleanup -> ship
  ship -> done
}
`

test('a runs_on=always node referencing an owed key does not settle the debt', async () => {
  const { result, engine, runDir, cwd } = await runObserving(
    ALWAYS_DOES_NOT_LAUNDER_THE_LEDGER,
    new StubBackend({}),
  )
  try {
    assert.deepEqual(result.path, ['start', 'build', 'cleanup', 'ship'])
    assert.equal(existsSync(join(cwd, 'released')), true, 'cleanup never ran')
    assert.equal(readFileSync(join(cwd, 'released'), 'utf8'), 'release [${artifact.path}]')
    // The ordinary successor is still refused, on the same key.
    assert.equal(existsSync(join(cwd, 'shipped')), false, 'the cleanup node laundered the ledger')
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)
    assert.equal(engine.outputsOwedByFailedNodes().get('artifact.path'), 'build')
  } finally {
    cleanup(runDir, cwd)
  }
})

// An unresolved reference must not eat a PATH SEGMENT. `substitute` deliberately
// leaves an unknown `$NAME` literal so a real shell variable survives into
// `sh -c`; the same must hold for a key the ledger owes, and for the same
// reason. `runs_on=always` exists for cleanup nodes, and cleanup commands are
// where `rm -rf` lives.
//
// This is the whole-branch review's second Critical, run end to end: a cleanup
// node with `rm -rf ${artifact.dir}/tmp` after a failed producer executed with
// **`rm -rf /tmp`** substituted. `$HOME` was correctly preserved -- the
// shell-variable half of the protection worked -- and the owed-key half created
// the identical hazard, plus a SAFETY REGRESSION: before the blanking, `sh`
// refused `${artifact.dir}` with `bad substitution` and exit 1, so the failure
// was loud. One rule now covers both halves: an unresolved key stays literal.
//
// `$MARK` is OUTSIDE the single quotes on purpose: inside them `sh` would never
// expand it, and that assertion would pass with the feature deleted. As written,
// the engine leaving `$MARK` literal is what lets the shell substitute `kept`.
//
// The sentinel is created BY THE GRAPH so the fixture is self-contained, and it
// sits under a relative `sandbox/` so that restoring the blanking during a
// mutation check widens the deletion inside the test's own cwd rather than
// anywhere real. That widening is the defect: `sandbox/${artifact.dir}/tmp`
// becomes `sandbox//tmp`, deleting a path the author never wrote.
const CLEANUP_DOES_NOT_WIDEN_AN_RM = `
digraph CDW {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="mkdir -p sandbox/tmp && touch sandbox/tmp/keep && exit 1", outputs="artifact.dir"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="MARK=kept; rm -rf sandbox/\${artifact.dir}/tmp; printf %s $MARK > marked"]
  start -> build
  build -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

test('an owed key in a cleanup command stays literal: the rm is not silently widened', async () => {
  const { result, runDir, cwd } = await runObserving(
    CLEANUP_DOES_NOT_WIDEN_AN_RM,
    new StubBackend({}),
  )
  try {
    // 1. THE COMMAND TEXT IS NOT TRUNCATED. `ToolHandler` records the exact
    //    substituted command it ran, which is the surface that shows the
    //    hazard directly rather than by inference.
    assert.equal(
      readFileSync(join(runDir, 'cleanup', 'command.sh'), 'utf8'),
      'MARK=kept; rm -rf sandbox/${artifact.dir}/tmp; printf %s $MARK > marked',
      'the owed key was blanked out of the command a cleanup node ran',
    )

    // 2. NOTHING WAS DELETED. The blanked form is `rm -rf sandbox//tmp`, which
    //    removes the sentinel; the literal form is a bad substitution, so `sh`
    //    aborts the command before `rm` ever runs.
    assert.equal(
      existsSync(join(cwd, 'sandbox', 'tmp', 'keep')),
      true,
      'the cleanup deleted a path built from a key nobody produced',
    )

    // 3. THE FAILURE IS LOUD. That is the regression half: a bad substitution
    //    exits non-zero, so the node FAILs, fail-fast finds no route out of
    //    `cleanup -> done`, and the run halts instead of reporting success over
    //    a cleanup that quietly did the wrong thing.
    const events = new EventLog(runDir).all()
    assert.ok(
      events.some((e) => e.type === 'node.tool.end' && e.node === 'cleanup' && e.exitCode !== 0),
      'a cleanup on a reference that never arrived exited 0',
    )
    assert.equal(result.status, Status.FAIL)
    assert.deepEqual(result.path, ['start', 'build', 'cleanup'])
    assert.equal(existsSync(join(cwd, 'marked')), false, 'sh ran the command past the bad key')
  } finally {
    cleanup(runDir, cwd)
  }
})

// The shell-variable half, unchanged and still asserted separately: whatever
// happens to owed keys, a bare `$NAME` must reach `sh -c` untouched. Here the
// cleanup references no owed key at all, so the command runs to completion and
// the shell -- not the engine -- is what expands `$MARK`.
const ALWAYS_KEEPS_SHELL_VARIABLES = `
digraph AKS {
  start [shape=Mdiamond]  done [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  cleanup [shape=parallelogram, runs_on=always, tool_command="MARK=kept; printf 'release [%s]' $MARK > released"]
  start -> build
  build -> cleanup [condition="outcome=fail"]
  cleanup -> done
}
`

test('a shell variable reaches sh -c untouched on a runs_on=always node', async () => {
  const { result, runDir, cwd } = await runObserving(
    ALWAYS_KEEPS_SHELL_VARIABLES,
    new StubBackend({}),
  )
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(
      readFileSync(join(cwd, 'released'), 'utf8'),
      'release [kept]',
      '$MARK must reach the shell untouched',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

// The one combination `runs_on=failure` must NOT be allowed to decide: a goal
// gate. Skipping one would record a SUCCESS in the gate map for a node that
// produced no evidence at all -- a gate satisfied by not running, which is the
// unearned false-success the fail-closed doctrine exists to stop, reopened by a
// node attribute. The engine resolves the contradiction fail-closed: the gate
// runs and has to earn its verdict.
const GOAL_GATE_RUNS_ON_FAILURE = `
digraph GGRF {
  start [shape=Mdiamond]  done [shape=Msquare]
  work  [shape=box, prompt="do the work"]
  judge [shape=box, prompt="judge it", goal_gate="true", runs_on=failure]
  start -> work
  work -> judge
  judge -> done
}
`

test('a goal gate is never skipped by runs_on=failure, even on a healthy run', async () => {
  const backend = new StubBackend({
    judge: { status: Status.SUCCESS, preferredLabel: 'converged', notes: 'ok' },
  })
  const { result, runDir, cwd } = await runObserving(GOAL_GATE_RUNS_ON_FAILURE, backend)
  try {
    assert.deepEqual(result.path, ['start', 'work', 'judge', 'done'])
    assert.equal(result.status, Status.SUCCESS)
    // Dispatched. The backend saw the node, so the gate's SUCCESS was EARNED
    // by a verdict rather than manufactured by a skip.
    assert.ok(
      backend.calls().some((c) => c.nodeId === 'judge'),
      'the goal gate was skipped: its verdict would have been fabricated',
    )
    const events = new EventLog(runDir).all()
    assert.ok(!events.some((e) => e.type === 'node.runs_on.skipped' && e.node === 'judge'))
  } finally {
    cleanup(runDir, cwd)
  }
})

// The design-time half, on the same fixture. The engine resolves the
// contradiction fail-closed -- it runs the gate AND keeps the eager input check
// armed on it -- which is what makes this a WARNING rather than an ERROR:
// nothing unsafe survives, the `runs_on` is simply inert, and refusing to run
// the graph over an inert attribute would be the CMD-001 mistake. What the
// author still needs to know is that the thing they wrote is not what runs.
test('RUNS-002 warns that a goal gate ignores runs_on=failure', () => {
  const diags = lint(parseDot(GOAL_GATE_RUNS_ON_FAILURE)).filter((d) => d.code === 'RUNS-002')
  assert.equal(diags.length, 1)
  assert.equal(diags[0].node, 'judge')
  assert.equal(diags[0].severity, 'warning')
  assert.match(diags[0].message, /ignored entirely for this node/)
  assert.equal(hasErrors(lint(parseDot(GOAL_GATE_RUNS_ON_FAILURE))), false)
})

// THE WHOLE-BRANCH REVIEW'S CRITICAL, as the A/B it was demonstrated on.
//
// Task 5 stopped `runs_on` SKIPPING a goal gate. It did not stop `runs_on`
// switching off the EAGER INPUT CHECK on one -- the check was gated on
// `mode === RunsOn.SUCCESS`, so `runs_on={failure,always}` excluded a gate from
// it. The consequence, on two graphs identical but for the one attribute:
//
// - without `runs_on`: the gate is blocked, the run halts, `status: fail`.
// - with `runs_on="failure"`: the check was skipped, the owed `${artifact.path}`
//   was blanked, the gate printed `verified ` and returned SUCCESS, SATISFIED
//   ITSELF, and the run reached `done` at exit 0 with no work product.
//
// A gate earning its verdict against an input the engine itself recorded as
// unavailable is the unearned false-success the fail-closed doctrine exists to
// prevent. The eager check now applies to a goal gate whatever its `runs_on`
// says, so the two graphs below must behave IDENTICALLY -- which is the only
// assertion that can tell "fixed" from "fixed for one value".
//
// A tool gate rather than a box gate, deliberately: `printf` inside single
// quotes exits 0 whatever the substitution left behind, so the eager check is
// demonstrably the ONLY thing standing between this graph and a green exit.
function gateOnOwedInput(runsOnAttr: string): string {
  return `
digraph GOI {
  start [shape=Mdiamond]  done [shape=Msquare]
  build  [shape=parallelogram, tool_command="exit 1", outputs="artifact.path"]
  verify [shape=parallelogram, goal_gate="true"${runsOnAttr}, tool_command="printf 'verified \${artifact.path}' > verdict"]
  start -> build
  build -> verify [condition="outcome=fail"]
  verify -> done
}
`
}

const GATE_ON_OWED_INPUT = gateOnOwedInput('')
const GATE_ON_OWED_INPUT_RUNS_ON_FAILURE = gateOnOwedInput(', runs_on="failure"')
const GATE_ON_OWED_INPUT_RUNS_ON_ALWAYS = gateOnOwedInput(', runs_on="always"')

for (const [label, src] of [
  ['no runs_on', GATE_ON_OWED_INPUT],
  ['runs_on=failure', GATE_ON_OWED_INPUT_RUNS_ON_FAILURE],
  ['runs_on=always', GATE_ON_OWED_INPUT_RUNS_ON_ALWAYS],
] as const) {
  test(`a goal gate is never earned on an owed input (${label})`, async () => {
    const { result, runDir, cwd } = await runObserving(src, new StubBackend({}))
    try {
      // The gate is VISITED -- so section 3.4's visited-scoped check applies to
      // it -- and blocked before dispatch. It never reaches `done`.
      assert.deepEqual(result.path, ['start', 'build', 'verify'])
      assert.equal(result.status, Status.FAIL, `${label}: the run claimed success`)
      assert.match(result.notes ?? '', /required input 'artifact\.path' unavailable/)

      // The gate did not run, so it cannot have satisfied itself. Its command
      // would have exited 0 on a blanked reference and recorded SUCCESS.
      assert.equal(
        existsSync(join(cwd, 'verdict')),
        false,
        `${label}: the gate earned a verdict against an input recorded as unavailable`,
      )
      const events = new EventLog(runDir).all()
      assert.ok(
        events.some((e) => e.type === 'node.input_unavailable' && e.node === 'verify'),
        `${label}: the block was not recorded`,
      )
      assert.ok(!events.some((e) => e.type === 'node.tool.start' && e.node === 'verify'))
    } finally {
      cleanup(runDir, cwd)
    }
  })
}

test('the runs_on attribute changes nothing at all on a goal gate', () => {
  // The A/B stated as one assertion: RUNS-002 says the attribute is inert, and
  // this is what "inert" has to mean. Lint-clean apart from that WARNING, so
  // all three are graphs an operator could really run.
  for (const src of [GATE_ON_OWED_INPUT_RUNS_ON_FAILURE, GATE_ON_OWED_INPUT_RUNS_ON_ALWAYS]) {
    const diags = lint(parseDot(src))
    assert.equal(hasErrors(diags), false)
    assert.equal(diags.filter((d) => d.code === 'RUNS-002').length, 1)
  }
  assert.deepEqual(lint(parseDot(GATE_ON_OWED_INPUT)), [])
})

test('the runs_on fixtures are graphs the CLI would accept', () => {
  for (const src of [
    CLEANUP_RUNS_ON_ALWAYS,
    CLEANUP_RUNS_ON_ALWAYS_ABANDONED,
    NOTIFY_RUNS_ON_FAILURE,
    ALWAYS_STILL_REPORTS_ITS_OWN_FAILURE,
    // RUNS_ON_UNRECOGNISED is deliberately absent: it carries the `runs_on`
    // typo RUNS-001 exists to refuse, so the CLI would (correctly) reject it.
    // The test above asserts that directly.
    CLEANUP_READS_A_STALE_VALUE,
    ALWAYS_DOES_NOT_LAUNDER_THE_LEDGER,
    CLEANUP_DOES_NOT_WIDEN_AN_RM,
    ALWAYS_KEEPS_SHELL_VARIABLES,
    GOAL_GATE_RUNS_ON_FAILURE,
  ]) {
    const diags = lint(parseDot(src))
    assert.equal(
      hasErrors(diags),
      false,
      `lint errors: ${diags.filter((d) => d.severity === 'error').map((d) => d.code).join(', ')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// Section 2.10 subgraph scoping, through a real run.
//
// The parser-level pins live in parse.test.ts. These two exist because the two
// most damaging halves of the defect are not visible in an attribute map --
// they change what a worker is asked to do and where a failure goes.
// ---------------------------------------------------------------------------

// A bare `goal = "..."` anywhere inside a subgraph used to overwrite the
// graph's own `goal`, because bare attributes were written straight into the
// graph's attribute map with no regard for scope. Section 2.5 says graph
// attributes are declared in a `graph [ ... ]` block "or as TOP-LEVEL
// `key = value` declarations"; a subgraph's are neither. The blast radius is
// both spellings the engine seeds from `graph.attrs`: `$goal` in every prompt
// it builds, and the `graph.goal` key conditions route on. This graph pins both
// in one run -- the prompt the backend actually received, and the edge the
// engine actually took.
const SUBGRAPH_GOAL_HIJACK = `
digraph GH {
  graph [goal="real"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  wrong [shape=box, prompt="wrong branch"]
  subgraph cluster_a {
    label = "Loop A"
    goal = "hijacked"
    inside [shape=box, prompt="Advance $goal"]
  }
  start -> inside
  inside -> done  [condition="context.graph.goal=real"]
  inside -> wrong [condition="context.graph.goal=hijacked"]
  wrong -> done
}
`

test('a subgraph goal does not hijack $goal or context.graph.goal (section 2.10)', async () => {
  const { result, backend, runDir, cwd } = await execute(SUBGRAPH_GOAL_HIJACK)
  try {
    const prompt = backend.calls().find((c) => c.nodeId === 'inside')?.prompt
    assert.equal(prompt, 'Advance real', 'the worker was asked to advance the real goal')
    assert.ok(!result.path.includes('wrong'), 'context.graph.goal is the graph goal')
    assert.deepEqual(result.path, ['start', 'inside', 'done'])
    assert.equal(result.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

// The leaked `retry_target` is a ROUTING defect, not a cosmetic one. A
// subgraph's `node [retry_target="..."]` used to attach to every node in the
// graph, which hands a failure jump target to nodes whose author wrote none --
// so section 3.7 step 2 fires where step 4 (terminate) is what the graph says.
// `failing` here is outside the subgraph entirely and has no failure route of
// its own, so the run must stop at it rather than divert into `patch`.
//
// It is declared AFTER the subgraph on purpose. Declared before, the section
// 2.11 half of the fix ("subsequent") would protect it on its own and this
// test would keep passing with subgraph scoping reverted -- which is exactly
// the class of test this repository has shipped too many of. Declared after,
// only scoping stands between the subgraph's `node [...]` block and a node
// that has nothing to do with it.
const SUBGRAPH_RETRY_TARGET_LEAK = `
digraph RTL {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  subgraph cluster_a {
    node [retry_target="patch"]
    inside [shape=box, prompt="inside"]
  }
  failing [shape=box, prompt="x", max_retries=0]
  patch [shape=box, prompt="patch"]
  start -> failing
  failing -> inside
  inside -> done
  patch -> done
}
`

test('a subgraph retry_target does not reroute a failure outside it (section 2.10)', async () => {
  const { result, backend, runDir, cwd } = await execute(SUBGRAPH_RETRY_TARGET_LEAK, {
    failing: { status: Status.FAIL, notes: 'boom' },
  })
  try {
    assert.ok(!result.path.includes('patch'), 'the leaked retry target must not carry the failure')
    assert.equal(backend.calls().filter((c) => c.nodeId === 'patch').length, 0)
    assert.deepEqual(result.path, ['start', 'failing'], 'section 3.7 step 4: no failure route')
    assert.equal(result.status, Status.FAIL)
    assert.deepEqual(result.unresolvedFailures, ['failing'])
    // The node the subgraph DID scope still has its target -- the fix removes
    // a leak, it does not remove the feature.
    assert.equal(parseDot(SUBGRAPH_RETRY_TARGET_LEAK).nodes.get('inside')?.attrs.retry_target, 'patch')
    assert.equal(parseDot(SUBGRAPH_RETRY_TARGET_LEAK).nodes.get('failing')?.attrs.retry_target, undefined)
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// Section 3.4 -- the goal-gate retry ladder starts at the GATE, not the exit.
// ---------------------------------------------------------------------------

// Section 3.4 step 3: "Instead, jump to the `retry_target` OF THE UNSATISFIED
// GOAL GATE NODE. If that is not set, try `fallback_retry_target`. If that is
// also not set, try the graph-level `retry_target` and
// `fallback_retry_target`."
//
// The exit branch resolved the ladder from the EXIT node, so steps 1 and 2 --
// the gate's own two attributes -- were never consulted. Steps 3 and 4 looked
// like they worked only because `resolveRetryTarget` reads `graph.attrs` last
// whatever node it is given, which hid the defect behind every graph that
// happened to declare a graph-level target.
//
// The graph below is the minimal shape that reaches the exit with an
// unsatisfied gate: the gate FAILs and an explicit `outcome=fail` edge carries
// the run to the exit, so section 3.7's node-level ladder never fires and the
// exit's gate check is the only thing that can route.
//
// `repairNodes` declares only the repair node(s) a given variant actually
// wires up via `graphAttrs`/`gateAttrs`, rather than declaring both `fix` and
// `graph_fix` unconditionally. A repair node is reachable only through the
// `retry_target`/`fallback_retry_target` attribute a specific test sets (F14
// taught `reachableFrom` to follow those); a variant that sets only the
// gate's own target genuinely leaves the OTHER repair node with no live route
// in, and TOPO-004 flagging that as unreachable is correct, not a lint gap --
// declaring only what a variant actually uses is what a real graph author
// would do too.
function gateLadderGraph(graphAttrs: string, gateAttrs: string, repairNodes: string): string {
  return `
digraph GL {
  ${graphAttrs}
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=box, goal_gate=true, max_retries=0 ${gateAttrs}]
  ${repairNodes}
  start -> gate
  gate -> done [condition="outcome=fail"]
  gate -> done
}
`
}

const FIX_NODE = `
  fix [shape=box, prompt="repair"]
  fix -> gate`

const GRAPH_FIX_NODE = `
  graph_fix [shape=box, prompt="repair via the graph target"]
  graph_fix -> gate`

const GATE_LADDER_SCRIPT: Record<string, Outcome | Outcome[]> = {
  gate: [
    { status: Status.FAIL, notes: 'not converged' },
    { status: Status.SUCCESS, preferredLabel: 'converged' },
  ],
  fix: { status: Status.SUCCESS, preferredLabel: 'repaired' },
  graph_fix: { status: Status.SUCCESS, preferredLabel: 'repaired' },
}

test("the gate's own retry_target is consulted (section 3.4 step 1)", async () => {
  const { result, runDir, cwd } = await execute(
    gateLadderGraph('', ', retry_target="fix"', FIX_NODE),
    GATE_LADDER_SCRIPT,
  )
  try {
    assert.ok(result.path.includes('fix'), "the gate's own repair loop must fire")
    assert.equal(result.status, Status.SUCCESS, 'and the repaired gate lets the run exit')
    assert.deepEqual(result.path, ['start', 'gate', 'done', 'fix', 'gate', 'done'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test("the gate's fallback_retry_target is consulted (section 3.4 step 2)", async () => {
  const { result, runDir, cwd } = await execute(
    gateLadderGraph('', ', fallback_retry_target="fix"', FIX_NODE),
    GATE_LADDER_SCRIPT,
  )
  try {
    assert.ok(result.path.includes('fix'), 'step 2 of the ladder must be reachable too')
    assert.equal(result.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

test("the gate's retry_target outranks the graph's (section 3.4)", async () => {
  // The precedence proof. Before the fix this run jumped to `graph_fix`,
  // because the exit node carried no target of its own and
  // `resolveRetryTarget` fell straight through to `graph.attrs` -- the ladder
  // was not merely missing its first two rungs, it was INVERTED.
  const { result, runDir, cwd } = await execute(
    gateLadderGraph('graph [retry_target="graph_fix"]', ', retry_target="fix"', FIX_NODE + GRAPH_FIX_NODE),
    GATE_LADDER_SCRIPT,
  )
  try {
    assert.ok(result.path.includes('fix'), "the gate's target wins")
    assert.ok(!result.path.includes('graph_fix'), "the graph's target must not pre-empt it")
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the graph-level target still applies when the gate declares none (section 3.4 steps 3-4)', async () => {
  const { result, runDir, cwd } = await execute(
    gateLadderGraph('graph [retry_target="graph_fix"]', '', GRAPH_FIX_NODE),
    GATE_LADDER_SCRIPT,
  )
  try {
    assert.ok(result.path.includes('graph_fix'), 'the lower rungs are not removed by the fix')
    assert.equal(result.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

// Section 3.4's `check_goal_gates` iterates `node_outcomes` and RETURNS on the
// first gate it finds unsatisfied, so the spec's own pseudocode picks the
// first one in traversal order. It never states which gate wins when several
// are unsatisfied, so this is our recorded choice: the FIRST-VISITED
// unsatisfied gate chooses the target, matching that pseudocode and giving a
// deterministic answer that points at the earliest thing that went wrong --
// the same ordering `unresolvedFailures` already promises.
const TWO_UNSATISFIED_GATES = `
digraph TG {
  start [shape=Mdiamond]  done [shape=Msquare]
  first  [shape=box, goal_gate=true, max_retries=0, retry_target="fix_first"]
  second [shape=box, goal_gate=true, max_retries=0, retry_target="fix_second"]
  fix_first  [shape=box, prompt="repair the first"]
  fix_second [shape=box, prompt="repair the second"]
  start -> first
  first -> second [condition="outcome=fail"]
  second -> done [condition="outcome=fail"]
  first -> second
  second -> done
  fix_first -> done
  fix_second -> done
}
`

test('with several gates unsatisfied, the first-visited one chooses the target', async () => {
  const { result, runDir, cwd } = await execute(
    TWO_UNSATISFIED_GATES,
    {
      first: { status: Status.FAIL, notes: 'no' },
      second: { status: Status.FAIL, notes: 'also no' },
      fix_first: { status: Status.SUCCESS, preferredLabel: 'x' },
      fix_second: { status: Status.SUCCESS, preferredLabel: 'y' },
    },
    12,
  )
  try {
    assert.ok(result.path.includes('fix_first'), "the first gate's target is the one used")
    assert.ok(!result.path.includes('fix_second'), 'the later gate does not get to choose')
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// Section 5.3 -- the checkpoint names the LAST COMPLETED node.
// ---------------------------------------------------------------------------

// Section 3.2 orders the loop "-- Step 5: Save checkpoint" after step 4
// applies the outcome; section 5.3 defines the field as "`current_node :
// String` -- ID of the LAST COMPLETED node"; and its resume rule says
// "Determine the next node to execute (the one AFTER `current_node`)".
//
// Ours checkpointed at the TOP of each iteration with the node about to run,
// so the file said `current_node: "b"` while `b` was still executing. A
// conformant resume reading that would start after `b` and SKIP IT -- the
// node whose crash caused the resume in the first place.
//
// The observation has to happen from inside a running handler, because the
// wrong value only exists mid-node; reading the file after the run shows the
// terminal checkpoint and proves nothing.
class CheckpointPeekBackend implements Backend {
  runDir = ''
  seen: Array<{ node: string; wire: Record<string, unknown> }> = []
  async run(node: Node): Promise<Outcome> {
    const path = join(this.runDir, 'checkpoint.json')
    if (existsSync(path)) {
      this.seen.push({ node: node.id, wire: JSON.parse(readFileSync(path, 'utf8')) })
    } else {
      this.seen.push({ node: node.id, wire: {} })
    }
    return { status: Status.SUCCESS, notes: `ran ${node.id}` }
  }
}

test('the checkpoint names the last COMPLETED node, not the executing one (section 5.3)', async () => {
  const { runDir, cwd } = tempDirs()
  const peek = new CheckpointPeekBackend()
  peek.runDir = runDir
  try {
    const engine = new Engine({
      graph: parseDot(LINEAR),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(peek),
    })
    await engine.run()

    const duringB = peek.seen.find((s) => s.node === 'b')
    assert.ok(duringB, 'the backend observed the checkpoint while b was executing')
    assert.equal(
      duringB!.wire.current_node,
      'a',
      'while b runs, the last COMPLETED node is a -- naming b would make a resume skip it',
    )
    assert.deepEqual(
      duringB!.wire.completed_nodes,
      ['start', 'a'],
      'and b is not yet in completed_nodes',
    )

    // The same law one node earlier, so this cannot pass by an off-by-one that
    // merely lags: while `a` runs, `start` is the last completed node.
    const duringA = peek.seen.find((s) => s.node === 'a')
    assert.equal(duringA!.wire.current_node, 'start')
  } finally {
    cleanup(runDir, cwd)
  }
})

// ---------------------------------------------------------------------------
// Section 4.12 -- a handler exception becomes FAIL, not RETRY.
// ---------------------------------------------------------------------------

// Section 4.12, handler contract: "Handler panics/exceptions MUST be caught by
// the engine and converted to FAIL outcomes." Section 3.5's CATCH agrees:
// "ELSE: RETURN Outcome(status=FAIL, failure_reason=str(exception))".
//
// Ours converted every throw to RETRY, with two consequences. The exception
// text was replaced by "retries exhausted for a with no retry target" and
// survived only in `events.jsonl`; and a node with retries burned every one of
// them re-running a handler that had already thrown, which for a configuration
// or validation error is pure latency.
const THROWS_WITH_RETRIES = `
digraph TR {
  graph [default_max_retries=2]
  start [shape=Mdiamond]  done [shape=Msquare]
  a [shape=box, prompt="x"]
  start -> a -> done
}
`

class CountingThrowBackend implements Backend {
  calls = 0
  async run(): Promise<Outcome> {
    this.calls += 1
    throw new Error('backend exploded')
  }
}

test('a handler exception becomes FAIL and is not retried (section 4.12)', async () => {
  const { runDir, cwd } = tempDirs()
  const backend = new CountingThrowBackend()
  try {
    const engine = new Engine({
      graph: parseDot(THROWS_WITH_RETRIES),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(backend),
    })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    assert.equal(backend.calls, 1, 'a thrown exception is a FAIL, so the retry machine never sees it')
    assert.match(
      result.notes ?? '',
      /backend exploded/,
      'the exception text reaches the run result instead of being replaced by a retry message',
    )
  } finally {
    cleanup(runDir, cwd)
  }
})

test('the exception text is carried as failure_reason (sections 3.5 and 5.2)', async () => {
  const { runDir, cwd } = tempDirs()
  try {
    const engine = new Engine({
      graph: parseDot(THROWS_WITH_RETRIES),
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new CountingThrowBackend()),
    })
    const result = await engine.run()
    assert.equal(result.failureReason, 'backend exploded')
  } finally {
    cleanup(runDir, cwd)
  }
})

// Section 5.2: "`failure_reason : String -- reason for failure (when status is
// FAIL or RETRY)`". The engine had no such field at all -- every reason lived
// in `notes`, which is also where a SUCCESS puts its human-readable summary,
// so nothing downstream could tell a reason from a remark.
test('an engine-authored FAIL carries failure_reason as well as notes (section 5.2)', async () => {
  const { result, runDir, cwd } = await execute(THROWS_WITH_RETRIES.replace(
    'a [shape=box, prompt="x"]',
    'a [shape=box, prompt="x", max_retries=1]',
  ), { a: { status: Status.RETRY, notes: 'try again' } })
  try {
    assert.equal(result.status, Status.FAIL)
    assert.equal(result.failureReason, 'max retries exceeded')
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a direct Engine embed refuses to run a graph that fails lint (FR-11, F10)', async () => {
  const { runDir, cwd } = tempDirs()
  const graph = parseDot(LINT_FAILS_BUT_WOULD_RUN)
  const backend = new StubBackend({})
  const engine = new Engine({
    graph,
    context: Context.from({}),
    runDir,
    cwd,
    handlers: defaultHandlers(backend),
  })
  const result = await engine.run()
  assert.equal(result.status, Status.FAIL)
  assert.match(result.notes ?? '', /TOPO-004/)
  assert.ok(!result.path.includes('a'), 'the node that would otherwise run first must never dispatch')
  // Accepted, documented divergence from the CLI path (ADR-004): the
  // constructor's EventLog already created runDir before run() gets a
  // chance to refuse, so it exists with a FAIL pipeline.end event in it,
  // unlike the CLI's pre-construction check which leaves nothing.
  assert.ok(existsSync(runDir), 'run dir exists -- constructor already ran before the refusal')
  cleanup(runDir, cwd)
})

test('a direct Engine embed still runs a clean graph normally (both-directions guard)', async () => {
  const { result } = await execute(LINEAR)
  assert.equal(result.status, Status.SUCCESS)
})

// ---------------------------------------------------------------------------
// HandlerCtx.runBranch (p5-05). handlers/parallel.ts / ParallelHandler do not
// exist yet (p5-08) -- every test here drives ctx.runBranch directly from a
// hand-built test-only Handler, registered against Handler.TOOL (so it never
// collides with Handler.CODERGEN, which stays the REAL BoxHandler wrapping a
// GatedBackend for the branch's own nodes -- proving genuine concurrency,
// not a same-tick stub).
// ---------------------------------------------------------------------------

/** Launches whatever the test wants when its one designated node dispatches. */
class BranchLaunchingHandler implements HandlerIface {
  private readonly launch: (ctx: HandlerCtx) => Promise<Outcome>

  constructor(launch: (ctx: HandlerCtx) => Promise<Outcome>) {
    this.launch = launch
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    return this.launch(ctx)
  }
}

test('a branch root routed straight to the real EXIT node is an ordinary dead end for that branch alone (mutation-checked)', async () => {
  const backend = new GatedBackend()
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-exit')
  const siblingRunDir = join(runDir, 'branch-sibling')
  const handlers = defaultHandlers(backend)
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const exitPromise = ctx.runBranch!({
        startNodeId: 'sideEntry',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      const siblingPromise = ctx.runBranch!({
        startNodeId: 'sibling',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: siblingRunDir,
        cwd: ctx.cwd,
      })
      // Both branches are now gated open (their own CODERGEN dispatch is
      // blocked inside GatedBackend.run) -- release only the EXIT one.
      backend.release('sideEntry')
      const exitResult = await exitPromise

      // Observable proxy for "unsatisfiedGoalGates()/this.checkpoint(null)
      // were never called during that runBranch call": this.checkpoint()
      // always targets the OUTER run's own runDir. A mutant letting
      // runBranch fall through to run()'s own EXIT block would flip THIS
      // checkpoint to currentNode: null mid-detour-dispatch, before this
      // handler ever returns -- the correct implementation leaves it
      // exactly as `start`'s own per-node checkpoint left it.
      const midFlightCheckpoint = loadCheckpoint(runDir)
      assert.equal(midFlightCheckpoint?.currentNode, 'start')
      assert.equal(exitResult.outcome.status, Status.SUCCESS, 'EXIT is a trivial passthrough SUCCESS')
      assert.deepEqual(exitResult.path, ['sideEntry', 'done'])

      assert.ok(backend.maxObserved >= 2, 'both branches were genuinely in flight at once')
      backend.release('sibling')
      await siblingPromise

      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      sideEntry [shape=box, prompt="x"]
      sibling [shape=box, prompt="y"]
      start -> detour -> done
      detour -> sideEntry [condition="context.never_true=x"]
      detour -> sibling [condition="context.never_true=x"]
      sideEntry -> done
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.path, ['start', 'detour', 'done'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a branch retry-target cycle exhausts the run-wide step cap and the OUTER run reports it too (mutation-checked, NFR-1)', async () => {
  const handlers = defaultHandlers(new StubBackend({ cyc: { status: Status.RETRY, notes: 'again' } }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-cyc')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const result = await ctx.runBranch!({
        startNodeId: 'cyc',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      assert.equal(result.outcome.status, Status.FAIL)
      assert.match(result.outcome.notes ?? '', /step cap/i)
      return { status: Status.SUCCESS, notes: 'observed the branch fail cleanly' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      cyc [shape=box, prompt="x", max_retries=0, retry_target="cyc"]
      start -> detour -> done
      detour -> cyc [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers, maxSteps: 25 })
    const result = await engine.run()
    // stepCount is shared across run() and every branch (NFR-1, engine.ts's own
    // stepCount doc) precisely so a branch's own runaway retry loop cannot exceed
    // the run-wide ceiling by running "off the books" -- so exhausting it INSIDE
    // the branch necessarily leaves the OUTER run with nothing left to dispatch
    // `done` with either. The outer run correctly reports that shared exhaustion
    // (loud FAIL, never a hang and never a silent SUCCESS) rather than being
    // unaffected by it -- there is no separate budget for it to be unaffected in.
    assert.equal(result.status, Status.FAIL, 'the OUTER run shares the exhausted step budget, not a separate one')
    assert.match(result.notes ?? '', /step cap/i)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('run() and runBranch produce identical path/attempts/checkpoint shape for the same fixture (proves executeNodeStep is one implementation)', async () => {
  const script = {
    x: { status: Status.SUCCESS, notes: 'x done', contextUpdates: { 'stage.x': 'done' } },
    y: { status: Status.SUCCESS, notes: 'y done', contextUpdates: { 'stage.y': 'done' } },
  }

  const { result: mainResult, runDir: mainRunDir, cwd: mainCwd } = await execute(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      x [shape=box, prompt="x"]  y [shape=box, prompt="y"]
      start -> x -> y -> done
    }
  `, script)
  assert.equal(mainResult.status, Status.SUCCESS)

  const { runDir: outerRunDir, cwd: branchCwd } = tempDirs()
  // A directory OF ITS OWN for the branch's own internal dispatch -- distinct
  // from outerRunDir (the "branch engine" instance's own runDir), matching
  // every other test in this section. Reusing outerRunDir for both (as an
  // earlier version of this test did) makes 'detour' and 'done''s own later
  // checkpoint writes -- which use the OUTER, non-cloned context -- overwrite
  // x/y's own earlier checkpoint write to the SAME file, silently erasing the
  // very stage.x/stage.y evidence this test reads back below.
  const innerBranchRunDir = join(outerRunDir, 'branch-inner')
  const handlers = defaultHandlers(new StubBackend(script))
  let branchResult: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      branchResult = await ctx.runBranch!({
        startNodeId: 'x',
        stopAt: new Set(['done']), // stops before dispatching the graph's natural end
        context: ctx.context.clone(),
        runDir: innerBranchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const branchGraph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      x [shape=box, prompt="x"]  y [shape=box, prompt="y"]
      start -> detour -> done
      detour -> x [condition="context.never_true=x"]
      x -> y -> done
    }
  `)
  try {
    const engine = new Engine({
      graph: branchGraph, context: Context.from({}), runDir: outerRunDir, cwd: branchCwd, handlers,
    })
    const outerResult = await engine.run()
    assert.equal(outerResult.status, Status.SUCCESS)

    assert.deepEqual(mainResult.path.slice(1, -1), branchResult!.path, 'x, y in the same order')

    const mainCheckpoint = loadCheckpoint(mainRunDir)
    const branchCheckpoint = loadCheckpoint(innerBranchRunDir)
    // Compare only x/y -- the two graphs are NOT the same topology (the branch
    // graph adds its own detour hub so runBranch has somewhere to be launched
    // from), so their full attempts maps can never be equal: outerRunDir's own
    // checkpoint would also carry start/detour/done, which mainCheckpoint's
    // does not. x and y are the only nodes both callers actually dispatch
    // through the shared executeNodeStep, which is the property this test
    // exists to prove -- comparing the full maps was asserting graph-topology
    // equality this fixture was never designed to have.
    assert.equal(mainCheckpoint?.attempts?.x, branchCheckpoint?.attempts?.x)
    assert.equal(mainCheckpoint?.attempts?.y, branchCheckpoint?.attempts?.y)
    assert.equal(mainCheckpoint?.context['stage.x'], branchCheckpoint?.context['stage.x'])
    assert.equal(mainCheckpoint?.context['stage.y'], branchCheckpoint?.context['stage.y'])
  } finally {
    cleanup(mainRunDir, mainCwd)
    cleanup(outerRunDir, branchCwd)
  }
})

test('a goal-gate node inside a branch correctly blocks the outer run\'s real exit', async () => {
  const handlers = defaultHandlers(new StubBackend({
    gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - no verdict' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-gate')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      await ctx.runBranch!({
        startNodeId: 'gate',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      gate [shape=box, goal_gate=true, prompt="judge", max_retries=0]
      start -> detour -> done
      detour -> gate [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL, "the branch's own unearned goal gate blocks the real exit")
    assert.match(result.notes ?? '', /unsatisfied goal gates.*gate/)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch dispatches a retry_target outside its own stopAt-truncated reachable set exactly like any other next node (named, accepted risk)', async () => {
  const handlers = defaultHandlers(new StubBackend({
    branchRoot: { status: Status.RETRY, notes: 'jump out' },
    siblingRoot: { status: Status.SUCCESS, notes: 'reached' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-escape')
  let outcome: Outcome | undefined
  let path: string[] | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const result = await ctx.runBranch!({
        startNodeId: 'branchRoot',
        stopAt: new Set(['stopHere']),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      outcome = result.outcome
      path = result.path
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      branchRoot [shape=box, prompt="x", max_retries=0, retry_target="siblingRoot"]
      siblingRoot [shape=box, prompt="y"]
      stopHere [shape=box, prompt="z"]
      start -> detour -> done
      detour -> branchRoot [condition="context.never_true=x"]
      siblingRoot -> stopHere
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.deepEqual(path, ['branchRoot', 'siblingRoot'], "the jump to siblingRoot happened, unblocked -- not this story's gap to close")
    assert.equal(outcome?.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch reaches a dead end (no outgoing edge, not EXIT) with a FAIL BranchRunResult', async () => {
  const handlers = defaultHandlers(new StubBackend({
    lonely: { status: Status.SUCCESS, notes: 'nowhere to go' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-lonely')
  let result: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      result = await ctx.runBranch!({
        startNodeId: 'lonely',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      lonely [shape=box, prompt="x"]
      start -> detour -> done
      detour -> lonely [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(result?.outcome.status, Status.FAIL)
    assert.deepEqual(result?.path, ['lonely'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch stops before dispatching a stopAt frontier node', async () => {
  const handlers = defaultHandlers(new StubBackend({
    entry: { status: Status.SUCCESS, notes: 'ok' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-frontier')
  let result: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      result = await ctx.runBranch!({
        startNodeId: 'entry',
        stopAt: new Set(['frontier']),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      entry [shape=box, prompt="x"]  frontier [shape=box, prompt="y"]
      start -> detour -> done
      detour -> entry [condition="context.never_true=x"]
      entry -> frontier
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(result?.outcome.status, Status.SUCCESS)
    assert.deepEqual(result?.path, ['entry'], 'stops before dispatching frontier; frontier is not in path')
  } finally {
    cleanup(runDir, cwd)
  }
})

test('two concurrent ctx.runBranch calls via Promise.all over GatedBackend both resolve independently, and the outer ledgers reflect both', async () => {
  const backend = new GatedBackend()
  const handlers = defaultHandlers(backend)
  const { runDir, cwd } = tempDirs()
  const runDirA = join(runDir, 'branch-a')
  const runDirB = join(runDir, 'branch-b')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const [a, b] = await Promise.allSettled([
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'a', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirA, cwd: ctx.cwd,
          })
          backend.release('a')
          return p
        })(),
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'b', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirB, cwd: ctx.cwd,
          })
          backend.reject('b', new Error('branch b exploded'))
          return p
        })(),
      ])
      assert.equal(a.status, 'fulfilled')
      assert.equal(b.status, 'fulfilled', 'a rejected GatedBackend call is caught by executeNodeStep and turned into a FAIL outcome, not a thrown exception')
      if (a.status === 'fulfilled') assert.equal(a.value.outcome.status, Status.SUCCESS)
      if (b.status === 'fulfilled') assert.equal(b.value.outcome.status, Status.FAIL)
      return { status: Status.SUCCESS, notes: 'both branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      a [shape=box, prompt="x"]  b [shape=box, prompt="y"]
      start -> detour -> done
      detour -> a [condition="context.never_true=x"]
      detour -> b [condition="context.never_true=x"]
      a -> done
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('two concurrent ctx.runBranch calls retrying the SAME node id do not lose an attempts increment (mutation-checked)', async () => {
  const backend = new StubBackend({ shared: { status: Status.RETRY, notes: 'again' } })
  const handlers = defaultHandlers(backend)
  const { runDir, cwd } = tempDirs()
  const runDirA = join(runDir, 'branch-a')
  const runDirB = join(runDir, 'branch-b')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      await Promise.allSettled([
        ctx.runBranch!({
          startNodeId: 'shared', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirA, cwd: ctx.cwd,
        }),
        ctx.runBranch!({
          startNodeId: 'shared', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirB, cwd: ctx.cwd,
        }),
      ])
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      shared [shape=box, prompt="x", max_retries=2]
      start -> detour -> done
      detour -> shared [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers, maxSteps: 500 })
    await engine.run()
    // Each branch should dispatch 'shared' exactly 3 times (1 initial + 2 retries,
    // max_retries=2) -- 6 total across both branches. The pre-fix lost-update bug
    // reliably produced 7 (deterministic, not flaky -- the race is structural, not
    // timing-dependent: both branches' reads happen in their own synchronous
    // prefix, strictly before either branch's write, every run).
    assert.equal(backend.calls().length, 6, 'no attempts-increment lost update across the two concurrent branches')
  } finally {
    cleanup(runDir, cwd)
  }
})

test('PAR-005 integration: an early-exit branch neither halts the run nor lets lint block it, and a sibling proceeds normally', async () => {
  const src = `
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fan [shape=component]
      early [shape=box]  other [shape=box]  join [shape=box]
      start -> fan
      fan -> early
      early -> done
      early -> join
      fan -> other -> join
      join -> done
    }
  `
  const diags = lint(parseDot(src))
  assert.ok(diags.some((d) => d.code === 'PAR-005'), 'the fixture is the one PAR-005 exists to catch')
  assert.ok(
    !diags.some((d) => d.severity === Severity.ERROR && d.code !== 'HAND-001'),
    'PAR-005 is advisory -- it must not block the run (HAND-001 is expected and unrelated: Handler.PARALLEL stays unregistered until p5-08)',
  )

  const backend = new GatedBackend()
  const handlers = defaultHandlers(backend)
  const { runDir, cwd } = tempDirs()
  const earlyRunDir = join(runDir, 'branch-early')
  const otherRunDir = join(runDir, 'branch-other')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const [earlySettled, otherSettled] = await Promise.allSettled([
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'early', stopAt: new Set(), context: ctx.context.clone(), runDir: earlyRunDir, cwd: ctx.cwd,
          })
          backend.release('early')
          return p
        })(),
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'other', stopAt: new Set(['join']), context: ctx.context.clone(), runDir: otherRunDir, cwd: ctx.cwd,
          })
          backend.release('other')
          return p
        })(),
      ])
      assert.equal(earlySettled.status, 'fulfilled', 'early branch completes')
      assert.equal(otherSettled.status, 'fulfilled', 'other branch completes')
      if (earlySettled.status === 'fulfilled') {
        const earlyResult = earlySettled.value
        assert.equal(earlyResult.outcome.status, Status.SUCCESS, "the early branch's own EXIT dispatch is a trivial SUCCESS")
        // `early` has two unconditional outgoing edges (-> done, -> join); with
        // no condition/preferred-label/suggestion in play, selectEdge's own
        // weight-then-lexical tie-break picks `done` ('done' < 'join'
        // lexically) -- verified directly against the real selectEdge, not
        // assumed.
        assert.deepEqual(earlyResult.path, ['early', 'done'])
      }
      if (otherSettled.status === 'fulfilled') {
        const otherResult = otherSettled.value
        assert.equal(otherResult.outcome.status, Status.SUCCESS, "the sibling proceeds to its own stop point, unaffected by the other branch's early exit")
        assert.deepEqual(otherResult.path, ['other'], 'stops before dispatching the join frontier')
      }
      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const runnableGraph = parseDot(src.replace('fan [shape=component]', 'fan [shape=parallelogram, tool_command="unused"]'))
  try {
    const engine = new Engine({ graph: runnableGraph, context: Context.from({}), runDir, cwd, handlers, maxSteps: 500 })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS, 'the whole pipeline is never halted by the early-exit branch')
  } finally {
    cleanup(runDir, cwd)
  }
})
