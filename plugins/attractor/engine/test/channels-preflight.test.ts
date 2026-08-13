import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { preflightHumanGates } from '../src/channels/preflight.ts'
import { defaultChannels } from '../src/channels/defaults.ts'
import { isChannelViable, type ChannelRunContext } from '../src/channels/types.ts'

function rc(overrides: Partial<ChannelRunContext> = {}): ChannelRunContext {
  return {
    isInteractive: false,
    allowAgentGates: false,
    claudeAvailable: false,
    configuredNames: new Set(['human', 'agent']),
    ...overrides,
  }
}

test('a reachable gate whose only (default) hop is non-viable produces exactly one diagnostic', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    gate[shape=hexagon, prompt="approve?"]
    gate -> done [label="ok"] start -> gate }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc({ isInteractive: false }))
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].node, 'gate')
  assert.deepEqual(diagnostics[0].chain, ['human'])
})

test('a mixed viable/non-viable chain produces no diagnostic', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    gate[shape=hexagon, human.channel="human,agent", prompt="approve?"]
    gate -> done [label="ok"] start -> gate }`)
  const runContext = rc({ isInteractive: false, allowAgentGates: true, claudeAvailable: true })
  const diagnostics = preflightHumanGates(graph, defaultChannels(), runContext)
  assert.equal(diagnostics.length, 0)
})

test('every hop non-viable -> refused', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    gate[shape=hexagon, human.channel="human,agent", prompt="approve?"]
    gate -> done [label="ok"] start -> gate }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc())
  assert.equal(diagnostics.length, 1)
})

test('no human.channel attribute defaults to ["human"], evaluated normally', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    gate[shape=hexagon, prompt="approve?"]
    gate -> done [label="ok"] start -> gate }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc({ isInteractive: true }))
  assert.equal(diagnostics.length, 0)
})

test('a gate unreachable from the start node is not inspected, regardless of its own viability', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare] orphan_done[shape=Msquare]
    gate[shape=hexagon, prompt="approve?"]
    gate -> orphan_done [label="ok"]
    start -> done }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc())
  assert.equal(diagnostics.length, 0, 'an unreachable gate must not be inspected at all')
})

test('a gate behind a conditional edge is still inspected (condition-blind by design)', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    branch[shape=box, prompt="x"]
    gate[shape=hexagon, prompt="approve?"]
    gate -> done [label="ok"]
    start -> branch
    branch -> gate [condition="flag=true"] }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc())
  assert.equal(diagnostics.length, 1, 'reachability is condition-blind -- the gate is inspected anyway')
})

test('reasons name a distinct cause per hop', () => {
  const graph = parseDot(`digraph G { start[shape=Mdiamond] done[shape=Msquare]
    gate[shape=hexagon, human.channel="human,agent", prompt="approve?"]
    gate -> done [label="ok"] start -> gate }`)
  const diagnostics = preflightHumanGates(graph, defaultChannels(), rc())
  assert.equal(diagnostics[0].reasons.length, 2)
  assert.notEqual(diagnostics[0].reasons[0], diagnostics[0].reasons[1])
})

test('defaultChannels()\'s agent entry is only usable when both allowAgentGates and claudeAvailable are true, matching isChannelViable', async () => {
  for (const allowAgentGates of [true, false]) {
    for (const claudeAvailable of [true, false]) {
      const channels = defaultChannels({ allowAgentGates, claudeAvailable, agent: { command: '/bin/false' } })
      const agent = channels.get('agent')!
      const answer = await agent.answer({ nodeId: 'g', label: 'x', legalAnswers: [], exposedContext: {} }, null)
      const expectedUsable = allowAgentGates && claudeAvailable
      const expectedViable = isChannelViable('agent', rc({ allowAgentGates, claudeAvailable }))
      assert.equal(expectedUsable, expectedViable, 'defaultChannels and isChannelViable must agree on the same pair')
      if (!expectedUsable) {
        assert.deepEqual(answer, { label: null }, 'a disallowed agent channel must spawn nothing and answer null')
      }
    }
  }
})

test('defaultChannels() called with no arguments defaults both booleans to false, matching defaultHandlers()\'s own inert default', async () => {
  const channels = defaultChannels()
  const agent = channels.get('agent')!
  const answer = await agent.answer({ nodeId: 'g', label: 'x', legalAnswers: [], exposedContext: {} }, null)
  assert.deepEqual(answer, { label: null })
  assert.ok(channels.get('human') !== undefined)
})
