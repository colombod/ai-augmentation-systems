import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { FanInHandler, FAN_IN_OUTPUT_KEYS } from '../src/handlers/fan-in.ts'
import { type HandlerCtx } from '../src/handlers/types.ts'

// Matches box.test.ts/tool.test.ts's own convention: a small parseDot-built
// fixture graph at module scope. `directPredecessors(graph, 'join')` must
// see exactly a/b/c as join's three distinct predecessors -- FanInHandler's
// own formula is derived from that structural fact, not from anything
// ParallelHandler hands it (ADR-007, "FanInHandler needs no handoff
// channel").
const G = parseDot(`
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="a"]
  b [shape=box, prompt="b"]
  c [shape=box, prompt="c"]
  join [shape=tripleoctagon]
  start -> a
  start -> b
  start -> c
  a -> join
  b -> join
  c -> join
  join -> done
}
`)

function run(statuses: Record<string, Status | undefined>): Promise<Outcome> {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-fanin-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-fanin-cwd-'))
  const ctx: HandlerCtx = {
    node: G.nodes.get('join')!,
    graph: G,
    context: Context.from({}),
    runDir,
    cwd,
    events: new EventLog(runDir),
    nodeStatus: (id) => statuses[id],
  }
  return new FanInHandler().execute(ctx).finally(() => {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })
}

test('OQ5 formula: zero successes among the predecessors is FAIL', async () => {
  const outcome = await run({ a: Status.FAIL, b: Status.FAIL, c: Status.FAIL })
  assert.equal(outcome.status, Status.FAIL)
  assert.equal(outcome.contextUpdates?.['fan_in.success_count'], '0')
  assert.equal(outcome.contextUpdates?.['fan_in.fail_count'], '3')
  assert.equal(outcome.contextUpdates?.['fan_in.total'], '3')
})

test('OQ5 formula: zero failures among the predecessors is SUCCESS', async () => {
  const outcome = await run({ a: Status.SUCCESS, b: Status.PARTIAL, c: Status.SUCCESS })
  assert.equal(outcome.status, Status.SUCCESS)
  assert.equal(outcome.contextUpdates?.['fan_in.success_count'], '3')
  assert.equal(outcome.contextUpdates?.['fan_in.fail_count'], '0')
})

test('OQ5 formula: some of each is PARTIAL', async () => {
  const outcome = await run({ a: Status.SUCCESS, b: Status.FAIL, c: Status.PARTIAL })
  assert.equal(outcome.status, Status.PARTIAL)
  assert.equal(outcome.contextUpdates?.['fan_in.success_count'], '2')
  assert.equal(outcome.contextUpdates?.['fan_in.fail_count'], '1')
})

test('a predecessor never visited counts toward total but neither success nor fail', async () => {
  // `nodeStatus` returns undefined for a predecessor the run never reached
  // (e.g. its own branch dead-ended before a node with an edge into `join`
  // was ever dispatched). It must not silently vanish from `total`.
  const outcome = await run({ a: Status.SUCCESS, b: undefined, c: Status.FAIL })
  assert.equal(outcome.contextUpdates?.['fan_in.total'], '3')
  assert.equal(outcome.contextUpdates?.['fan_in.success_count'], '1')
  assert.equal(outcome.contextUpdates?.['fan_in.fail_count'], '1')
  // successCount (1) !== 0 and failCount (1) !== 0 -> PARTIAL.
  assert.equal(outcome.status, Status.PARTIAL)
})

test('FAN_IN_OUTPUT_KEYS names every key the handler writes', async () => {
  const outcome = await run({ a: Status.SUCCESS, b: Status.SUCCESS, c: Status.SUCCESS })
  assert.deepEqual(
    Object.keys(outcome.contextUpdates ?? {}).sort(),
    [...FAN_IN_OUTPUT_KEYS].sort(),
  )
})

test('the formula result is merged into context, not just reported on the outcome', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-fanin-merge-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-fanin-merge-cwd-'))
  const context = Context.from({})
  try {
    await new FanInHandler().execute({
      node: G.nodes.get('join')!,
      graph: G,
      context,
      runDir,
      cwd,
      events: new EventLog(runDir),
      nodeStatus: (id) => ({ a: Status.SUCCESS, b: Status.FAIL, c: Status.SUCCESS })[id],
    })
    assert.equal(context.get('fan_in.success_count'), '2')
    assert.equal(context.get('fan_in.fail_count'), '1')
    assert.equal(context.get('fan_in.total'), '3')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a FAIL verdict writes status.json with a failure_reason, matching Box/ToolHandler wire shape', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-fanin-status-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-fanin-status-cwd-'))
  try {
    await new FanInHandler().execute({
      node: G.nodes.get('join')!,
      graph: G,
      context: Context.from({}),
      runDir,
      cwd,
      events: new EventLog(runDir),
      nodeStatus: () => Status.FAIL,
    })
    const raw = JSON.parse(readFileSync(join(runDir, 'join', 'status.json'), 'utf8'))
    assert.equal(raw.outcome, 'fail')
    assert.ok(raw.failure_reason, 'a FAIL carries a failure_reason')
    assert.equal(raw.context_updates['fan_in.total'], '3')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('nodeStatus absent entirely (ctx built without it) does not throw', async () => {
  // Optional field -- every existing hand-built HandlerCtx fixture that
  // omits it must keep working. A join whose engine never populated
  // nodeStatus sees every predecessor as undefined -- 0 successes -> FAIL,
  // not a crash.
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-fanin-nostatus-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-fanin-nostatus-cwd-'))
  try {
    const outcome = await new FanInHandler().execute({
      node: G.nodes.get('join')!,
      graph: G,
      context: Context.from({}),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    assert.equal(outcome.status, Status.FAIL)
    assert.equal(outcome.contextUpdates?.['fan_in.total'], '3')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
