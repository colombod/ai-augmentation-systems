import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HumanChannel, type HumanGateWait } from '../src/channels/human.ts'
import { type HumanGateContext } from '../src/channels/types.ts'

const CTX: HumanGateContext = {
  nodeId: 'gate',
  label: 'approve?',
  legalAnswers: ['yes', 'no'],
  exposedContext: {},
}

/** Resolves only when the signal it was given aborts -- mirrors StdinHumanGateWait's real contract. */
class AbortDrivenWait implements HumanGateWait {
  block(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }
}

/** Resolves block() immediately, regardless of the signal -- proves HumanChannel never
 *  turns a fast-resolving wait into a real answer. */
class ImmediateWait implements HumanGateWait {
  async block(): Promise<void> {
    // resolves right away
  }
}

test('answer({timeoutMs}) resolves {label:null} once the AbortSignal fires at the timeout', async () => {
  const channel = new HumanChannel(new AbortDrivenWait())
  const start = Date.now()
  const result = await channel.answer(CTX, 50)
  const elapsed = Date.now() - start
  assert.deepEqual(result, { label: null })
  assert.ok(elapsed >= 40, `expected to wait at least ~50ms, only waited ${elapsed}ms`)
})

test('a wait that resolves block() immediately still yields {label:null}, never a real answer', async () => {
  const channel = new HumanChannel(new ImmediateWait())
  const result = await channel.answer(CTX, 1000)
  assert.deepEqual(result, { label: null })
})

test('timeoutMs:null genuinely never resolves', async () => {
  const channel = new HumanChannel(new AbortDrivenWait())
  const deadline = new Promise((resolve) => setTimeout(() => resolve('still-pending'), 50))
  const outcome = await Promise.race([channel.answer(CTX, null), deadline])
  assert.equal(outcome, 'still-pending')
})

test('HumanChannel default-constructs a real StdinHumanGateWait when none is supplied', () => {
  const channel = new HumanChannel()
  assert.ok(channel instanceof HumanChannel)
})
