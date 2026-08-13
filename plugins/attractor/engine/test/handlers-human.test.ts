import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { EventLog, type RunEvent } from '../src/run/events.ts'
import { type HandlerCtx } from '../src/handlers/types.ts'
import { HumanGateHandler } from '../src/handlers/human.ts'
import { type Channel, type ChannelAnswer, type ChannelRunContext, type HumanGateContext } from '../src/channels/types.ts'

function rc(configuredNames: string[] = ['fake1', 'fake2', 'fake3']): ChannelRunContext {
  return {
    isInteractive: false,
    allowAgentGates: false,
    claudeAvailable: false,
    configuredNames: new Set(configuredNames),
  }
}

class FakeChannel implements Channel {
  calls: Array<{ ctx: HumanGateContext; timeoutMs: number | null; at: number }> = []
  private readonly label: string | null
  private readonly shouldThrow: boolean
  private readonly delayMs: number

  constructor(opts: { label?: string | null; throws?: boolean; delayMs?: number } = {}) {
    this.label = opts.label ?? null
    this.shouldThrow = opts.throws ?? false
    this.delayMs = opts.delayMs ?? 0
  }

  async answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer> {
    this.calls.push({ ctx, timeoutMs, at: Date.now() })
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (this.shouldThrow) throw new Error('fake channel exploded')
    return { label: this.label }
  }
}

function buildCtx(graphSrc: string, nodeId: string, context = Context.from({})) {
  const graph = parseDot(graphSrc)
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-human-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-human-cwd-'))
  const events = new EventLog(runDir)
  const ctx: HandlerCtx = { node: graph.nodes.get(nodeId)!, graph, context, runDir, cwd, events }
  const cleanup = (): void => {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
  const readEvents = (): RunEvent[] => events.all()
  return { ctx, cleanup, readEvents }
}

test('first-viable-hop-that-answers short-circuits: later hops never called', async () => {
  const { ctx, cleanup, readEvents } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="yes"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: 'yes' })
    const fake2 = new FakeChannel({ label: 'never' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.preferredLabel, 'yes')
    assert.equal(fake1.calls.length, 1)
    assert.equal(fake2.calls.length, 0, 'fake2 must never be called once fake1 answers')
  } finally {
    cleanup()
  }
})

test('a hop returning {label:null} escalates to the next hop', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.preferredLabel, 'ok')
    assert.equal(fake1.calls.length, 1)
    assert.equal(fake2.calls.length, 1)
  } finally {
    cleanup()
  }
})

test('a hop whose answer() throws escalates identically to null, and emits node.human.hop_error', async () => {
  const { ctx, cleanup, readEvents } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ throws: true })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.preferredLabel, 'ok')
    assert.equal(fake2.calls.length, 1, 'must not be left as an unhandled rejection -- escalation happened')
    const errorEvents = readEvents().filter((e) => e.type === 'node.human.hop_error')
    assert.equal(errorEvents.length, 1)
    assert.equal(errorEvents[0].channel, 'fake1')
    assert.match(String(errorEvents[0].message), /fake channel exploded/)
  } finally {
    cleanup()
  }
})

test('a non-viable hop is skipped without calling answer(), and emits node.human.hop_skipped', async () => {
  const { ctx, cleanup, readEvents } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: 'should-not-be-used' })
    const fake2 = new FakeChannel({ label: 'ok' })
    // fake1 not in configuredNames -> not viable -> skipped
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc(['fake2']))
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.preferredLabel, 'ok')
    assert.equal(fake1.calls.length, 0, 'a non-viable hop must never be dispatched to')
    const skipped = readEvents().filter((e) => e.type === 'node.human.hop_skipped')
    assert.equal(skipped.length, 1)
    assert.equal(skipped[0].channel, 'fake1')
  } finally {
    cleanup()
  }
})

test('chain exhausted with on_timeout present routes there', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", on_timeout="fallback", prompt="approve?"]
     gate -> done [label="fallback"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.preferredLabel, 'fallback')
  } finally {
    cleanup()
  }
})

test('chain exhausted with human.default_choice present routes there', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", human.default_choice="dflt", prompt="approve?"]
     gate -> done [label="dflt"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.preferredLabel, 'dflt')
  } finally {
    cleanup()
  }
})

test('chain exhausted with neither fallback present -> FAIL, never RETRY/PARTIAL', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    const outcome = await handler.execute(ctx)
    assert.equal(outcome.status, Status.FAIL)
  } finally {
    cleanup()
  }
})

test('human.channel_timeout: fewer values than hops -- last value repeats', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2,fake3", human.channel_timeout="1s,2s", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const fake2 = new FakeChannel({ label: null })
    const fake3 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2], ['fake3', fake3]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls[0].timeoutMs, 1000)
    assert.equal(fake2.calls[0].timeoutMs, 2000)
    assert.equal(fake3.calls[0].timeoutMs, 2000, 'shorter list than the chain -- last value repeats')
  } finally {
    cleanup()
  }
})

test('human.channel_timeout: more values than hops -- extras ignored', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", human.channel_timeout="1s,2s,3s,4s", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls[0].timeoutMs, 1000)
    assert.equal(fake2.calls[0].timeoutMs, 2000)
  } finally {
    cleanup()
  }
})

test('human.channel_timeout: a single bare value applies to every hop', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", human.channel_timeout="5s", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls[0].timeoutMs, 5000)
    assert.equal(fake2.calls[0].timeoutMs, 5000)
  } finally {
    cleanup()
  }
})

test('human.channel_timeout: attribute absent -- every hop gets null', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls[0].timeoutMs, null)
    assert.equal(fake2.calls[0].timeoutMs, null)
  } finally {
    cleanup()
  }
})

test('ADR-025: legalAnswers contains only unconditional edge labels', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", prompt="approve?"]
     gate -> done [label="unconditional_one"]
     gate -> done [label="conditional_one", condition="flag=true"]
     start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: 'unconditional_one' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls.length, 1)
    assert.deepEqual(fake1.calls[0].ctx.legalAnswers, ['unconditional_one'])
  } finally {
    cleanup()
  }
})

test('mutation check: hops are dispatched sequentially, not concurrently', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1,fake2", prompt="approve?"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null, delayMs: 80 })
    const fake2 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1], ['fake2', fake2]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls.length, 1)
    assert.equal(fake2.calls.length, 1)
    const gap = fake2.calls[0].at - fake1.calls[0].at
    assert.ok(gap >= 60, `expected fake2 to be dispatched only after fake1's ~80ms delay resolved, gap was ${gap}ms`)
  } finally {
    cleanup()
  }
})

test('label falls back through human.prompt || human.label || prompt || label || node.id', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", label="generic label"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    await handler.execute(ctx)
    assert.equal(fake1.calls[0].ctx.label, 'generic label')
  } finally {
    cleanup()
  }
})

test('human.context exposes only present, named keys', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", human.context="tool.last_line, missing_key", prompt="approve?"]
     gate -> done [label="ok"] start -> gate }`,
    'gate',
    Context.from({ 'tool.last_line': 'green' }),
  )
  try {
    const fake1 = new FakeChannel({ label: 'ok' })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    await handler.execute(ctx)
    assert.deepEqual(fake1.calls[0].ctx.exposedContext, { 'tool.last_line': 'green' })
  } finally {
    cleanup()
  }
})

test('never returns RETRY or PARTIAL', async () => {
  const { ctx, cleanup } = buildCtx(
    `digraph G { start[shape=Mdiamond] done[shape=Msquare]
     gate[shape=hexagon, human.channel="fake1", prompt="approve?"]
     gate -> done [label="x"] start -> gate }`,
    'gate',
  )
  try {
    const fake1 = new FakeChannel({ label: null })
    const handler = new HumanGateHandler(new Map([['fake1', fake1]]), rc())
    const outcome = await handler.execute(ctx)
    assert.ok(outcome.status === Status.SUCCESS || outcome.status === Status.FAIL)
  } finally {
    cleanup()
  }
})
