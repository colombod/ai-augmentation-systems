import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// CI regression (Linux/dash): killing only the direct `sh` child is not enough. `sh`
// there does not reliably exec-replace itself for a `-c "command"` invocation the way
// macOS's bash-as-sh does when the command is a SCRIPT FILE with its own shebang --
// it can fork the script's own commands as genuine grandchildren, sharing the parent's
// stdout/stderr pipes. A plain child.kill() then leaves that grandchild running to
// completion, holding the pipe open, so the timeout appears to do nothing. runShell
// must kill the whole process TREE (POSIX process group), not just the direct child.
test('runShell kills a grandchild process forked by a wrapper script, not just the direct child', async () => {
  const cwd = tmpCwd()
  try {
    const scriptPath = join(cwd, 'sleeper.sh')
    writeFileSync(scriptPath, '#!/bin/sh\nsleep 5\n', 'utf8')
    chmodSync(scriptPath, 0o755)

    const start = Date.now()
    const result = await runShell(scriptPath, cwd, 300)
    const elapsed = Date.now() - start
    assert.ok(elapsed < 4000, `expected the timeout to kill the whole tree well before 5s, took ${elapsed}ms`)
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
