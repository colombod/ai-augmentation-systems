import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentChannel, GATE_ANSWER_SCHEMA, parseGateAnswer } from '../src/channels/agent.ts'
import { NON_INTERACTIVE_SAFETY_ARGV } from '../src/backend/argv.ts'
import { type HumanGateContext } from '../src/channels/types.ts'

const CTX: HumanGateContext = {
  nodeId: 'gate',
  label: 'approve the deploy?',
  legalAnswers: ['approve', 'reject'],
  exposedContext: { 'tool.last_line': 'deploy looks clean' },
  agentInstructions: 'be conservative',
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-agent-channel-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

function envelope(resultObj: unknown): string {
  return JSON.stringify({ is_error: false, result: JSON.stringify(resultObj), session_id: 's1' })
}

/**
 * Stand-in for the claude CLI. Writes its own argv (one per line) to argv.txt, echoes stdin
 * (the prompt) to stdin.txt, optionally sleeps, optionally touches a sentinel file to prove
 * it ran, then cats a response file (written directly, no shell escaping) to stdout.
 */
function fakeClaude(
  dir: string,
  responseJson: string,
  opts: { sentinelPath?: string; sleepSeconds?: number } = {},
): string {
  const scriptPath = join(dir, 'fake-claude.sh')
  const responsePath = join(dir, 'response.json')
  writeFileSync(responsePath, responseJson, 'utf8')
  const sentinel = opts.sentinelPath ? `touch "${opts.sentinelPath}"\n` : ''
  const sleep = opts.sleepSeconds ? `sleep ${opts.sleepSeconds}\n` : ''
  writeFileSync(
    scriptPath,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${join(dir, 'argv.txt')}"`,
      sentinel + `cat > "${join(dir, 'stdin.txt')}"`,
      sleep + `cat "${responsePath}"`,
      '',
    ].join('\n'),
    'utf8',
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

test('allowed:true with a well-formed reply yields the answered label', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, envelope({ label: 'approve', notes: 'looks fine' }))
    const channel = new AgentChannel({ allowed: true, command: cmd })
    const answer = await channel.answer(CTX, null)
    assert.deepEqual(answer, { label: 'approve' })
  })
})

test('allowed:false never spawns anything', async () => {
  await withDir(async (dir) => {
    const sentinel = join(dir, 'ran.sentinel')
    const cmd = fakeClaude(dir, envelope({ label: 'approve', notes: 'x' }), { sentinelPath: sentinel })
    const channel = new AgentChannel({ allowed: false, command: cmd })
    const answer = await channel.answer(CTX, null)
    assert.deepEqual(answer, { label: null })
    assert.equal(existsSync(sentinel), false, 'the fake claude script must never have run')
  })
})

test('the spawned argv always includes the shared non-interactive-safety prefix, in order', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, envelope({ label: 'approve', notes: 'x' }))
    const channel = new AgentChannel({ allowed: true, command: cmd })
    await channel.answer(CTX, null)
    const seenArgv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n').filter((l) => l !== '')
    for (let i = 0; i < NON_INTERACTIVE_SAFETY_ARGV.length; i++) {
      assert.equal(seenArgv[i], NON_INTERACTIVE_SAFETY_ARGV[i], `argv[${i}] should match the shared safety prefix`)
    }
  })
})

test('parseGateAnswer: well-formed input', () => {
  assert.deepEqual(parseGateAnswer(JSON.stringify({ label: 'approve', notes: 'ok' })), {
    label: 'approve',
    notes: 'ok',
  })
})

test('parseGateAnswer: missing label -> null', () => {
  assert.equal(parseGateAnswer(JSON.stringify({ notes: 'ok' })), null)
})

test('parseGateAnswer: extra fields (violates additionalProperties:false) -> null', () => {
  assert.equal(parseGateAnswer(JSON.stringify({ label: 'approve', notes: 'ok', extra: 'nope' })), null)
})

test('parseGateAnswer: non-JSON string -> null', () => {
  assert.equal(parseGateAnswer('not json at all'), null)
})

test('parseGateAnswer: non-string input -> null', () => {
  assert.equal(parseGateAnswer({ label: 'approve', notes: 'ok' }), null)
})

test('GATE_ANSWER_SCHEMA requires label and notes, forbids extra properties', () => {
  assert.deepEqual(GATE_ANSWER_SCHEMA.required, ['label', 'notes'])
  assert.equal(GATE_ANSWER_SCHEMA.additionalProperties, false)
})

test('a timeout fires and the call resolves {label:null} within the bound', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, envelope({ label: 'approve', notes: 'x' }), { sleepSeconds: 5 })
    const channel = new AgentChannel({ allowed: true, command: cmd })
    const start = Date.now()
    const answer = await channel.answer(CTX, 200)
    const elapsed = Date.now() - start
    assert.deepEqual(answer, { label: null })
    assert.ok(elapsed < 4000, `expected the timeout to cut this off well under 5s, took ${elapsed}ms`)
  })
})

test('the assembled prompt wraps exposedContext values and agentInstructions in an untrusted-data delimiter', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, envelope({ label: 'approve', notes: 'x' }))
    const channel = new AgentChannel({ allowed: true, command: cmd })
    await channel.answer(CTX, null)
    const prompt = readFileSync(join(dir, 'stdin.txt'), 'utf8')
    assert.match(prompt, /untrusted/i)
    assert.ok(prompt.includes('deploy looks clean'), 'the exposed context value must reach the prompt')
    assert.ok(prompt.includes('be conservative'), 'agentInstructions must reach the prompt')
    // the untrusted-data wrapper must actually surround the value, not just appear nearby
    const contextIndex = prompt.indexOf('deploy looks clean')
    const wrapperBefore = prompt.slice(0, contextIndex).toLowerCase()
    assert.ok(wrapperBefore.includes('untrusted'), 'an untrusted-data marker must precede the exposed value')
  })
})
