import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { type Graph, type Node } from '../src/dot/graph.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { type Backend } from '../src/handlers/types.ts'
import { BoxHandler } from '../src/handlers/box.ts'

const G = parseDot(`
digraph G {
  graph [goal="ship the thing"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  plain [shape=box, prompt="Advance $goal now"]
  gate  [shape=box, goal_gate=true, prompt="Judge it"]
  slow  [shape=box, timeout="150ms", prompt="hang please"]
  start -> plain -> gate -> done
}
`)

// runDir and cwd are two genuinely separate sibling temp directories: a
// regression that swapped them in HandlerCtx would be invisible if the two
// were ever the same path.
async function run(nodeId: string, backend: StubBackend, ctx = Context.from({ goal: 'ship the thing' })) {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-cwd-'))
  try {
    return await new BoxHandler(backend).execute({
      node: G.nodes.get(nodeId)!,
      graph: G,
      context: ctx,
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('the prompt is expanded from context before dispatch', async () => {
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'ok' } })
  await run('plain', backend)
  assert.equal(backend.calls()[0].prompt, 'Advance ship the thing now')
})

test('context updates from the backend are merged', async () => {
  const backend = new StubBackend({
    plain: { status: Status.SUCCESS, contextUpdates: { phase: 'built' } },
  })
  const ctx = Context.from({ goal: 'g' })
  await run('plain', backend, ctx)
  assert.equal(ctx.get('phase'), 'built')
})

test('an ordinary node ending in prose succeeds', async () => {
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'I did the thing' } })
  const outcome = await run('plain', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})

test('a goal gate ending in bare prose returns RETRY, not SUCCESS', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
  })
  const outcome = await run('gate', backend)
  assert.equal(
    outcome.status,
    Status.RETRY,
    'fail-closed: a goal gate cannot be satisfied by prose',
  )
})

test('a goal gate carrying an explicit verdict is honoured', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'all criteria pass' },
  })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})

test('a goal gate is satisfied by suggested next ids alone', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, suggestedNextIds: ['package'], notes: 'done' },
  })
  assert.equal((await run('gate', backend)).status, Status.SUCCESS)
})

test('a goal gate is satisfied by context updates alone', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, contextUpdates: { verdict: 'ship' }, notes: 'done' },
  })
  assert.equal((await run('gate', backend)).status, Status.SUCCESS)
})

test('an empty preferred label does not satisfy a goal gate', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, preferredLabel: '', notes: 'looks fine to me' },
  })
  assert.equal((await run('gate', backend)).status, Status.RETRY)
})

test('a PARTIAL goal gate ending in prose is also downgraded', async () => {
  const backend = new StubBackend({ gate: { status: Status.PARTIAL, notes: 'mostly there' } })
  assert.equal((await run('gate', backend)).status, Status.RETRY)
})

test('the persisted outcome records the downgraded status, not the raw one', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-artifact-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-artifact-cwd-'))
  try {
    const backend = new StubBackend({
      gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
    })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('gate')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    const persisted = JSON.parse(readFileSync(join(runDir, 'gate', 'status.json'), 'utf8'))
    assert.equal(
      persisted.outcome,
      Status.RETRY,
      'the artifact must not claim success when the gate was downgraded',
    )
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a goal gate reporting failure stays failed', async () => {
  const backend = new StubBackend({ gate: { status: Status.FAIL, notes: 'broken' } })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.FAIL)
})

test('a box node cannot forge the tool namespace via contextUpdates', async () => {
  // ToolHandler owns the `tool.` namespace. A box node writing
  // 'tool.last_line' must not be able to satisfy
  // condition="context.tool.last_line=green" without a tool node ever
  // having run.
  const backend = new StubBackend({
    plain: {
      status: Status.SUCCESS,
      contextUpdates: { 'tool.last_line': 'green', phase: 'built' },
    },
  })
  const ctx = Context.from({ goal: 'g' })
  await run('plain', backend, ctx)
  assert.equal(ctx.get('tool.last_line'), undefined, 'the tool.* key must be rejected')
  assert.equal(ctx.get('phase'), 'built', 'a non-tool.* key in the same update still merges')
})

// The `tool.` guard was written when `tool.*` was the only routing-visible
// namespace a model could reach. Task 6 made `current_node`, `outcome`,
// `preferred_label` and `graph.*` routing-visible too, which reopened exactly
// the hazard the original guard closed. The guard is now driven by
// isEngineManagedKey, the same predicate the engine writes its own built-ins
// through, so the two cannot drift apart.
test('a box node cannot forge any engine-managed key via contextUpdates', async () => {
  const forged = {
    current_node: 'start',
    outcome: 'fail',
    preferred_label: 'ship',
    'graph.goal': 'forged',
    'internal.retry_count.plain': '9',
    'tool.last_line': 'green',
  }
  const backend = new StubBackend({
    plain: { status: Status.SUCCESS, contextUpdates: { ...forged, phase: 'built' } },
  })
  const ctx = Context.from({ goal: 'g' })
  await run('plain', backend, ctx)
  for (const key of Object.keys(forged)) {
    assert.equal(ctx.get(key), undefined, `the engine-managed key ${key} must be rejected`)
  }
  assert.equal(ctx.get('phase'), 'built', 'an ordinary key in the same update still merges')
  assert.equal(ctx.get('goal'), 'g', 'a bare graph attribute name is NOT reserved')
})

// The fail-closed verdict check read the RAW contextUpdates, so a gate whose
// only "evidence" was keys the guard had just thrown away still counted as
// having produced a routing signal. Pre-existing for `tool.*`; widening the
// reserved set widened the hole, so it is closed here. Evidence the control
// plane refused to accept is not evidence.
test('a goal gate whose only context evidence was rejected does not earn its verdict', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, contextUpdates: { 'tool.last_line': 'green' } },
  })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.RETRY, 'rejected keys are not a verdict')
})

test('a goal gate still earns its verdict with a context update the guard allows', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, contextUpdates: { criteria_met: '7 of 7' } },
  })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.SUCCESS, 'a real context update is still a verdict')
})

test('a rejected tool.* update is recorded as a node.box.rejected_update event', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-reject-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-reject-cwd-'))
  try {
    const backend = new StubBackend({
      plain: { status: Status.SUCCESS, contextUpdates: { 'tool.last_line': 'green' } },
    })
    const events = new EventLog(runDir)
    await new BoxHandler(backend).execute({
      node: G.nodes.get('plain')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events,
    })
    const rejected = events.all().find((e) => e.type === 'node.box.rejected_update')
    assert.ok(rejected, 'a node.box.rejected_update event was recorded')
    assert.deepEqual(rejected?.keys, ['tool.last_line'])
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('prompt.md is written to disk before the backend is dispatched', async () => {
  // A real subprocess backend can hang or need to be killed; an operator
  // debugging a hung node needs the prompt on disk while it is still
  // running, not only after it returns.
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-order-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-order-cwd-'))
  let existedDuringDispatch = false
  class ProbeBackend implements Backend {
    async run(node: Node, _prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
      existedDuringDispatch = existsSync(join(runDir, node.id, 'prompt.md'))
      return { status: Status.SUCCESS, notes: 'ok' }
    }
  }
  try {
    await new BoxHandler(new ProbeBackend()).execute({
      node: G.nodes.get('plain')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    assert.ok(existedDuringDispatch, 'prompt.md must exist before backend.run is called')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a short timeout aborts a hanging claude rather than hanging the run', async () => {
  // A real subprocess backend, not the stub: the stub can never hang, so it
  // cannot exercise the abort wiring this test is checking. The fake
  // `claude` sleeps far longer than the node's timeout; the sleep length
  // itself is bounded (not e.g. 30s) so that if BoxHandler's timeout wiring
  // ever regresses, this test fails slowly rather than hanging the suite.
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-timeout-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-timeout-cwd-'))
  const binDir = mkdtempSync(join(tmpdir(), 'attractor-box-timeout-bin-'))
  try {
    const script = join(binDir, 'fake-claude.sh')
    writeFileSync(script, '#!/bin/sh\nsleep 5\n', 'utf8')
    chmodSync(script, 0o755)

    const backend = new ClaudeCodeBackend({ command: script, cwd })
    const start = Date.now()
    const outcome = await new BoxHandler(backend).execute({
      node: G.nodes.get('slow')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    const elapsed = Date.now() - start

    assert.equal(outcome.status, Status.FAIL, 'an aborted node must not report success')
    assert.match(outcome.notes ?? '', /abort/i)
    assert.ok(elapsed < 4000, `the timeout must cut the run short, took ${elapsed}ms`)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
    rmSync(binDir, { recursive: true, force: true })
  }
})

test('a node with no timeout is not affected by the timeout wiring', async () => {
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'ok' } })
  const outcome = await run('plain', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})

test('the per-node artifact is status.json with the spec field names', async () => {
  // Appendix C. An external agent writes and reads status.json; outcome.json
  // with internal camelCase names is unreadable to a spec-conformant consumer.
  const dir = mkdtempSync(join(tmpdir(), 'attractor-status-'))
  try {
    const backend = new StubBackend({
      gate: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'all good' },
    })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('gate')!, graph: G, context: Context.from({ goal: 'g' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    const raw = JSON.parse(readFileSync(join(dir, 'gate', 'status.json'), 'utf8'))
    assert.equal(raw.outcome, 'success', 'field is `outcome`, not `status`')
    assert.equal(raw.preferred_label, 'ship', 'snake_case, not preferredLabel')
    assert.equal(raw.notes, 'all good')
    assert.equal(existsSync(join(dir, 'gate', 'outcome.json')), false, 'old name is gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the response is written to response.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-resp-'))
  try {
    const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'the answer' } })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('plain')!, graph: G, context: Context.from({ goal: 'g' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(readFileSync(join(dir, 'plain', 'response.md'), 'utf8'), 'the answer')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a promptless node falls back to its own label, not the graph goal', async () => {
  // Spec section 4.5. Previously every promptless node got the same prompt.
  const g = parseDot(`
    digraph P {
      graph [goal="the shared goal"]
      start [shape=Mdiamond]  done [shape=Msquare]
      alpha [shape=box, label="do the alpha thing"]
      start -> alpha -> done
    }
  `)
  const backend = new StubBackend({})
  const dir = mkdtempSync(join(tmpdir(), 'attractor-label-'))
  try {
    await new BoxHandler(backend).execute({
      node: g.nodes.get('alpha')!, graph: g, context: Context.from({ goal: 'the shared goal' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(backend.calls()[0].prompt, 'do the alpha thing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an explicitly empty prompt also falls back to the label', async () => {
  // `??` treated prompt="" as set and dispatched a blank prompt.
  const g = parseDot(`
    digraph E {
      start [shape=Mdiamond]  done [shape=Msquare]
      beta [shape=box, prompt="", label="beta label"]
      start -> beta -> done
    }
  `)
  const backend = new StubBackend({})
  const dir = mkdtempSync(join(tmpdir(), 'attractor-empty-'))
  try {
    await new BoxHandler(backend).execute({
      node: g.nodes.get('beta')!, graph: g, context: Context.from({}),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(backend.calls()[0].prompt, 'beta label')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scripted sequences advance on each call', async () => {
  const backend = new StubBackend({
    plain: [
      { status: Status.FAIL, notes: 'first' },
      { status: Status.SUCCESS, notes: 'second' },
    ],
  })
  assert.equal((await run('plain', backend)).status, Status.FAIL)
  assert.equal((await run('plain', backend)).status, Status.SUCCESS)
})

// ---------------------------------------------------------------------------
// Section 2.6 / 4.5 -- a bare box node must not dispatch an empty prompt.
// ---------------------------------------------------------------------------

/** Runs one node against a scratch runDir that is NOT deleted, so the
 *  artifacts section 5.6 describes can be inspected. */
async function runKeeping(src: string, nodeId: string, backend: Backend, ctx = Context.from({})) {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-keep-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-keep-cwd-'))
  const g = parseDot(src)
  const outcome = await new BoxHandler(backend).execute({
    node: g.nodes.get(nodeId)!,
    graph: g,
    context: ctx,
    runDir,
    cwd,
    events: new EventLog(runDir),
  })
  return { outcome, runDir, cwd, ctx }
}

const BARE = `
digraph B {
  start [shape=Mdiamond]  done [shape=Msquare]
  bare_node [shape=box]
  start -> bare_node -> done
}
`

// Section 4.5: "IF prompt is empty: prompt = node.label". Section 2.6 gives
// `label` the default "node ID". Composed, a node declaring neither still has
// a prompt -- its own id. Ours ended the chain at `''`, so `bare_node
// [shape=box]` dispatched a BLANK prompt to a live model: it spends money and
// a turn to ask nothing, and whatever comes back is routed on.
test('a bare box node prompts with its node id, never the empty string (sections 2.6, 4.5)', async () => {
  const backend = new StubBackend({})
  const { runDir, cwd } = await runKeeping(BARE, 'bare_node', backend)
  try {
    assert.equal(backend.calls()[0].prompt, 'bare_node')
    assert.equal(
      readFileSync(join(runDir, 'bare_node', 'prompt.md'), 'utf8'),
      'bare_node',
      'and the on-disk record agrees with what was dispatched',
    )
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('an explicit label still outranks the node id', async () => {
  // The fix ADDS a rung below `label`; it must not displace it.
  const backend = new StubBackend({})
  const src = BARE.replace('bare_node [shape=box]', 'bare_node [shape=box, label="do the thing"]')
  const { runDir, cwd } = await runKeeping(src, 'bare_node', backend)
  try {
    assert.equal(backend.calls()[0].prompt, 'do the thing')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Section 4.5 -- last_stage and last_response context updates.
// ---------------------------------------------------------------------------

// Section 4.5 step 5: `context_updates={"last_stage": node.id,
// "last_response": truncate(response_text, 200)}`. Neither was ever written,
// so a pipeline had no engine-supplied way to reference the previous stage or
// its answer.
//
// `context.ts` records why these two keys are deliberately NOT in
// `isEngineManagedKey`: section 5.1 attributes both to HANDLERS, not the
// engine, so a handler writing them is conformant and a model overwriting them
// is not forging a control-plane token.
test('section 4.5 writes last_stage and last_response into context', async () => {
  const ctx = Context.from({})
  const backend = new StubBackend({ bare_node: { status: Status.SUCCESS, notes: 'the answer' } })
  const { runDir, cwd, outcome } = await runKeeping(BARE, 'bare_node', backend, ctx)
  try {
    assert.equal(ctx.get('last_stage'), 'bare_node')
    assert.equal(ctx.get('last_response'), 'the answer')
    assert.equal(outcome.contextUpdates?.last_stage, 'bare_node')
    assert.equal(outcome.contextUpdates?.last_response, 'the answer')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('last_response is truncated to 200 characters (section 4.5)', async () => {
  const ctx = Context.from({})
  const long = 'x'.repeat(500)
  const backend = new StubBackend({ bare_node: { status: Status.SUCCESS, notes: long } })
  const { runDir, cwd } = await runKeeping(BARE, 'bare_node', backend, ctx)
  try {
    assert.equal(ctx.get('last_response')?.length, 200)
    // response.md keeps the WHOLE response -- section 4.5 truncates only the
    // context copy, and an operator debugging a node needs the full text.
    assert.equal(readFileSync(join(runDir, 'bare_node', 'response.md'), 'utf8').length, 500)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// THE DOCTRINE GUARD FOR THE ABOVE, and the reason the two keys are written
// after the gate decision rather than before it.
//
// `carriesVerdict` treats a non-empty allowed-update map as a routing signal.
// If the handler's own last_stage/last_response were merged into that map
// before the check, EVERY goal gate would carry a verdict and the fail-closed
// downgrade would never fire again -- reopening the exact upstream
// false-success (a judge writing "NOT CONVERGED" and being recorded a success)
// that the doctrine entry in plugins/attractor/AGENTS.md exists to prevent.
// Evidence the handler manufactured about itself is not evidence.
const GATE_ONLY = `
digraph GO {
  start [shape=Mdiamond]  done [shape=Msquare]
  judge [shape=box, goal_gate=true, prompt="judge it"]
  start -> judge -> done
}
`

test('handler-written last_stage and last_response never satisfy a goal gate', async () => {
  const backend = new StubBackend({
    judge: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
  })
  const ctx = Context.from({})
  const { outcome, runDir, cwd } = await runKeeping(GATE_ONLY, 'judge', backend, ctx)
  try {
    assert.equal(outcome.status, Status.RETRY, 'fail-closed: prose still cannot pass the gate')
    // And the keys were still written -- the guard is about ORDER, not about
    // withholding section 4.5's updates from gates.
    assert.equal(ctx.get('last_stage'), 'judge')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Section 5.2 -- failure_reason reaches status.json.
// ---------------------------------------------------------------------------

test('status.json carries failure_reason for an external reader (sections 4.5, 5.2)', async () => {
  const backend = new StubBackend({
    bare_node: { status: Status.FAIL, notes: 'it broke', failureReason: 'exit 2' },
  })
  const { runDir, cwd } = await runKeeping(BARE, 'bare_node', backend)
  try {
    const st = JSON.parse(readFileSync(join(runDir, 'bare_node', 'status.json'), 'utf8'))
    assert.equal(st.failure_reason, 'exit 2')
    assert.equal(st.outcome, 'fail')
    assert.equal(st.notes, 'it broke', 'notes is unchanged beside it')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("BoxHandler passes ctx.cwd through to Backend.run's new trailing argument", async () => {
  const received: (string | undefined)[] = []
  class CapturingBackend implements Backend {
    async run(
      _node: Node, _prompt: string, _context: Context, _graph: Graph,
      _signal?: AbortSignal, cwd?: string,
    ): Promise<Outcome> {
      received.push(cwd)
      return { status: Status.SUCCESS, notes: 'ok' }
    }
  }
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-cwdpass-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-cwdpass-cwd-'))
  try {
    await new BoxHandler(new CapturingBackend()).execute({
      node: G.nodes.get('plain')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    assert.equal(received[0], cwd, "Backend.run's cwd argument matches HandlerCtx.cwd")
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a Backend.run() call with no cwd argument (StubBackend\'s 4-arg shape) is unaffected', async () => {
  // StubBackend.run(node, prompt, context, graph) has no cwd parameter at
  // all -- proves the additive change is inert for a shorter implementer,
  // the same way the existing suite already proves it for every other
  // StubBackend-driven box.test.ts case.
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'ok' } })
  const outcome = await run('plain', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})
