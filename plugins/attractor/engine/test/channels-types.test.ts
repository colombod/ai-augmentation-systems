import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isChannelViable, whyNotViable, type ChannelRunContext } from '../src/channels/types.ts'

function rc(overrides: Partial<ChannelRunContext> = {}): ChannelRunContext {
  return {
    isInteractive: false,
    allowAgentGates: false,
    claudeAvailable: false,
    configuredNames: new Set(),
    ...overrides,
  }
}

test('isChannelViable("human", ...) matches isInteractive', () => {
  assert.equal(isChannelViable('human', rc({ isInteractive: true })), true)
  assert.equal(isChannelViable('human', rc({ isInteractive: false })), false)
})

test('isChannelViable("agent", ...) requires both allowAgentGates and claudeAvailable', () => {
  assert.equal(isChannelViable('agent', rc({ allowAgentGates: true, claudeAvailable: true })), true)
  assert.equal(isChannelViable('agent', rc({ allowAgentGates: true, claudeAvailable: false })), false)
  assert.equal(isChannelViable('agent', rc({ allowAgentGates: false, claudeAvailable: true })), false)
  assert.equal(isChannelViable('agent', rc({ allowAgentGates: false, claudeAvailable: false })), false)
})

test('isChannelViable(name, ...) for a named channel checks configuredNames', () => {
  assert.equal(isChannelViable('discord', rc({ configuredNames: new Set(['discord']) })), true)
  assert.equal(isChannelViable('discord', rc({ configuredNames: new Set() })), false)
})

test('whyNotViable returns a distinct, non-empty reason per failing precondition', () => {
  const humanReason = whyNotViable('human', rc({ isInteractive: false }))
  const agentFlagReason = whyNotViable('agent', rc({ allowAgentGates: false, claudeAvailable: true }))
  const agentClaudeReason = whyNotViable('agent', rc({ allowAgentGates: true, claudeAvailable: false }))
  const namedReason = whyNotViable('discord', rc({ configuredNames: new Set() }))

  for (const reason of [humanReason, agentFlagReason, agentClaudeReason, namedReason]) {
    assert.ok(reason.length > 0, `expected a non-empty reason, got ${JSON.stringify(reason)}`)
  }
  const all = [humanReason, agentFlagReason, agentClaudeReason, namedReason]
  assert.equal(new Set(all).size, all.length, `expected all four reasons to be distinct: ${JSON.stringify(all)}`)
})
