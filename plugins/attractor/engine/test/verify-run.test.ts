import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRun, cliMain } from '../../skills/attractorify/verify-run.ts'
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

// A component/PARALLEL node needs its cwd to be a real git repository (branch
// worktree isolation). Found by actually running the parallel-fan-out example
// (p6-07) against verify-run.ts's own default cwd (tmpdir(), not a git repo)
// -- the CLI wrapper had no way to pass a different one through. Fixed here,
// not silently patched: the delegated subagent's ENTIRE interface to this
// harness is the CLI, so a library-level `cwd` option nothing on the CLI
// side can reach is not actually usable by the one caller that matters.
test('the CLI wrapper accepts --cwd and passes it through', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'valid.dot')
    writeFileSync(graphPath, VALID, 'utf8')

    const code = await cliMain([graphPath, '--run-dir', runDir, '--cwd', cwd, '--stub'])

    assert.equal(code, 0)
  }))

// Phase 2 (FR-5-8) registered Handler.HUMAN, and 08-human-gate.dot exercises it via a
// CommandChannel -- verify-run.ts's own default ChannelRunContext (no --channel support
// at all) made every human gate's chain unconditionally non-viable, so the delegated
// execution-verification harness (FR-13, this file's whole reason to exist) could
// never actually verify a human-gate graph. Found the same way p6-07's cwd gap was:
// by actually trying to verify the new example through this harness, not by inspection.
const HUMAN_GATE = `
digraph HG {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  gate  [shape=hexagon, human.channel="mock_approval", prompt="approve?"]
  gate -> done [label="ok"]
  start -> gate
}
`

function mockApprovalScript(cwd: string): string {
  const path = join(cwd, 'mock-approval.sh')
  writeFileSync(path, '#!/bin/sh\nprintf ok\n', 'utf8')
  chmodSync(path, 0o755)
  return path
}

test('verifyRun with no channel configured correctly resolves a human-gate graph to status=fail, not a crash or a false success', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'gate.dot')
    writeFileSync(graphPath, HUMAN_GATE, 'utf8')

    const result = await verifyRun(graphPath, { runDir, cwd, stub: true })

    // Preflight refusal is a real RunResult (status=fail), not a "never ran" case like
    // a lint refusal -- harnessOk stays true (verification itself completed correctly;
    // see this file's own doc comment on what harnessOk means), matching every other
    // FAIL RunResult this harness already treats as a successful verification of a
    // graph that fails.
    assert.equal(result.harnessOk, true)
    assert.match(result.output, /^VERIFIED: status=fail path=/m)
  }))

test('verifyRun accepts channelCommands and can verify a human-gate graph end to end', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'gate.dot')
    writeFileSync(graphPath, HUMAN_GATE, 'utf8')
    const script = mockApprovalScript(cwd)

    const result = await verifyRun(graphPath, {
      runDir,
      cwd,
      stub: true,
      channelCommands: { mock_approval: script },
    })

    assert.equal(result.harnessOk, true)
    assert.match(result.output, /^VERIFIED: status=success path=start,gate,done/m)
  }))

test('the CLI wrapper accepts --channel and --allow-agent-gates', () =>
  withTemp(async (runDir, cwd) => {
    const graphPath = join(cwd, 'gate.dot')
    writeFileSync(graphPath, HUMAN_GATE, 'utf8')
    const script = mockApprovalScript(cwd)

    const code = await cliMain([
      graphPath, '--run-dir', runDir, '--cwd', cwd, '--stub',
      '--channel', `mock_approval=${script}`,
    ])

    assert.equal(code, 0)
  }))
