import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShell, lastNonEmptyLine } from '../src/core/shell.ts'

function tmpCwd() {
  return mkdtempSync(join(tmpdir(), 'attractor-shell-'))
}

test('runShell resolves stdout/stderr/code for a successful command', async () => {
  const cwd = tmpCwd()
  try {
    const result = await runShell('printf hello', cwd, 0)
    assert.equal(result.code, 0)
    assert.equal(result.stdout, 'hello')
    assert.equal(result.stderr, '')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runShell captures a non-zero exit code', async () => {
  const cwd = tmpCwd()
  try {
    const result = await runShell('printf oops; exit 3', cwd, 0)
    assert.equal(result.code, 3)
    assert.equal(result.stdout, 'oops')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runShell kills a command that exceeds timeoutMs', async () => {
  const cwd = tmpCwd()
  try {
    const start = Date.now()
    const result = await runShell('sleep 5', cwd, 100)
    const elapsed = Date.now() - start
    assert.ok(elapsed < 4000, `expected the timeout to fire well before 5s, took ${elapsed}ms`)
    assert.notEqual(result.code, 0)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runShell timeoutMs<=0 means no timeout is applied', async () => {
  const cwd = tmpCwd()
  try {
    const result = await runShell('printf quick', cwd, 0)
    assert.equal(result.stdout, 'quick')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('lastNonEmptyLine returns the trimmed final non-blank line', () => {
  assert.equal(lastNonEmptyLine('a\nb\n\nc\n'), 'c')
  assert.equal(lastNonEmptyLine('  only line  '), 'only line')
  assert.equal(lastNonEmptyLine(''), '')
  assert.equal(lastNonEmptyLine('\n\n   \n'), '')
})
