import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRun } from '../../skills/attractorify/verify-run.ts'
import { Status } from '../src/index.ts'

// p6-06 (FR-13): verify-run.ts is the harness a fresh-context, independent
// subagent runs to prove a drafted graph actually executes on this engine --
// not the same session that authored it. These tests exercise its core
// logic directly (verifyRun), the same idiom cli.test.ts uses for main().

const VALID = `
digraph L {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  echo [shape=parallelogram, tool_command="printf ok"]
  start -> echo -> done
}
`

const LINT_DIRTY = `
digraph D {
  a [shape=Mdiamond]
  b [shape=Mdiamond]
  done [shape=Msquare]
  a -> done
  b -> done
}
`

function withTemp(fn: (runDir: string, cwd: string) => Promise<void>): Promise<void> {
  const runRoot = mkdtempSync(join(tmpdir(), 'verify-run-rd-'))
  const cwd = mkdtempSync(join(tmpdir(), 'verify-run-cwd-'))
  const runDir = join(runRoot, 'r')
  return fn(runDir, cwd).finally(() => {
    rmSync(runRoot, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })
}

test('refuses a lint-ERROR graph without attempting to run it', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'dirty.dot')
    writeFileSync(graphPath, LINT_DIRTY, 'utf8')

    const result = await verifyRun(graphPath, { runDir, stub: true })

    assert.equal(result.harnessOk, false, 'a lint-ERROR graph must not be treated as a successful verification')
    assert.match(result.output, /TOPO-001/, 'the printed output must name the actual lint diagnostic')
    assert.equal(existsSync(runDir), false, 'no run directory should be created for a graph that never ran')
  }))

test('prints the exact VERIFIED/events contract on a valid --stub graph', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'valid.dot')
    writeFileSync(graphPath, VALID, 'utf8')

    const result = await verifyRun(graphPath, { runDir, stub: true })

    assert.equal(result.harnessOk, true)
    const lines = result.output.trim().split('\n')
    assert.equal(lines.length, 2, `expected exactly two lines, got: ${JSON.stringify(lines)}`)
    assert.match(lines[0], /^VERIFIED: status=\w+ path=[\w,]+$/)
    assert.match(lines[1], /^events: .+events\.jsonl$/)
    assert.ok(lines[0].includes(`status=${Status.SUCCESS}`), `expected status=${Status.SUCCESS} in: ${lines[0]}`)
  }))

test('the printed events path is real and parseable as newline-delimited JSON', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'valid.dot')
    writeFileSync(graphPath, VALID, 'utf8')

    const result = await verifyRun(graphPath, { runDir, stub: true })
    const eventsLine = result.output.trim().split('\n')[1]
    const eventsPath = eventsLine.replace(/^events: /, '')

    assert.ok(existsSync(eventsPath), `events file must exist at ${eventsPath}`)
    const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter((l) => l.length > 0)
    assert.ok(lines.length > 0, 'events.jsonl must record at least one event')
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `every line must be valid JSON: ${line}`)
    }
  }))

test('defaults to --stub when neither --stub nor --live is specified', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'valid.dot')
    writeFileSync(graphPath, VALID, 'utf8')

    // No `stub` option passed at all -- must still behave as --stub (no real
    // `claude` subprocess spawned, so this must complete fast and deterministically).
    const result = await verifyRun(graphPath, { runDir })

    assert.equal(result.harnessOk, true)
    assert.match(result.output, /^VERIFIED: status=/)
  }))
