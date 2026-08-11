import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandChannel } from '../src/channels/command.ts'
import { type HumanGateContext } from '../src/channels/types.ts'

function baseCtx(overrides: Partial<HumanGateContext> = {}): HumanGateContext {
  return {
    nodeId: 'gate',
    label: 'approve?',
    legalAnswers: ['yes', 'no'],
    exposedContext: {},
    ...overrides,
  }
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-command-channel-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

function script(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
  return path
}

test('a benign value substitutes and the script\'s last stdout line becomes the label', async () => {
  await withDir(async (dir) => {
    const echoer = script(dir, 'echoer.sh', 'printf "%s" "$1"')
    const channel = new CommandChannel(`${echoer} \${payload}`)
    const answer = await channel.answer(baseCtx({ exposedContext: { payload: 'hello world' } }), null)
    assert.deepEqual(answer, { label: 'hello world' })
  })
})

test('a non-zero exit yields {label:null}', async () => {
  await withDir(async (dir) => {
    const failing = script(dir, 'failing.sh', 'exit 1')
    const channel = new CommandChannel(failing)
    const answer = await channel.answer(baseCtx(), null)
    assert.deepEqual(answer, { label: null })
  })
})

test('zero exit with empty/whitespace-only stdout yields {label:null}', async () => {
  await withDir(async (dir) => {
    const blank = script(dir, 'blank.sh', 'printf "   \\n\\n"')
    const channel = new CommandChannel(blank)
    const answer = await channel.answer(baseCtx(), null)
    assert.deepEqual(answer, { label: null })
  })
})

test('shell-quoting closes the injection path: a value with a semicolon-chained command is never executed', async () => {
  await withDir(async (dir) => {
    const marker = join(dir, 'injected.marker')
    const echoer = script(dir, 'echoer.sh', 'printf "%s" "$1"')
    const channel = new CommandChannel(`${echoer} \${payload}`)
    const payload = `; touch ${marker} ;`
    const answer = await channel.answer(baseCtx({ exposedContext: { payload } }), null)
    assert.equal(existsSync(marker), false, 'the semicolon-chained command must never have run')
    assert.equal(answer.label, payload, 'the value must reach the script literally, unexecuted')
  })
})

test('shell-quoting closes the injection path: a value with a backtick command-substitution attempt is never executed', async () => {
  await withDir(async (dir) => {
    const marker = join(dir, 'backtick.marker')
    const echoer = script(dir, 'echoer.sh', 'printf "%s" "$1"')
    const channel = new CommandChannel(`${echoer} \${payload}`)
    const payload = `\`touch ${marker}\``
    const answer = await channel.answer(baseCtx({ exposedContext: { payload } }), null)
    assert.equal(existsSync(marker), false, 'the backtick command substitution must never have run')
    assert.equal(answer.label, payload, 'the value must reach the script literally, unexecuted')
  })
})

test('timeoutMs bounds the spawned process -- a sleeping command is killed, the call resolves', async () => {
  // Deliberately an inline command, not a wrapping script file: a script invoked via its
  // own shebang forks sleep as a grandchild of the sh -c process runShell spawns, and
  // killing only the direct child leaves that grandchild holding the stdout pipe open
  // until it exits naturally -- a real, pre-existing property of runShell/core/shell.ts,
  // not something this story changes. `sleep 5` as the command itself avoids that grandchild
  // hop entirely, matching core/shell.ts's own test coverage for the same primitive (p2-01).
  await withDir(async (dir) => {
    const channel = new CommandChannel('sleep 5')
    const start = Date.now()
    const answer = await channel.answer(baseCtx(), 200)
    const elapsed = Date.now() - start
    assert.deepEqual(answer, { label: null })
    assert.ok(elapsed < 4000, `expected the timeout to cut this off well under 5s, took ${elapsed}ms`)
  })
})

test('nodeId, label, legal_answers, and agent_instructions are all substitutable', async () => {
  await withDir(async (dir) => {
    const echoer = script(dir, 'echoer.sh', 'printf "%s|%s|%s|%s" "$1" "$2" "$3" "$4"')
    const channel = new CommandChannel(`${echoer} \${nodeId} \${label} \${legal_answers} \${agent_instructions}`)
    const answer = await channel.answer(
      baseCtx({ nodeId: 'gate1', label: 'ship it?', legalAnswers: ['yes', 'no'], agentInstructions: 'be careful' }),
      null,
    )
    assert.equal(answer.label, 'gate1|ship it?|yes,no|be careful')
  })
})
