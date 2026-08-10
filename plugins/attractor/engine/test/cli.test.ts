import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.ts'
import { LINT_FAILS_BUT_WOULD_RUN } from './fixtures.ts'

// cwd and runDir are two genuinely separate sibling temp directories, not
// one directory playing both roles. A regression that swapped them would be
// invisible if the two ever happened to be the same path or nested inside
// one another -- and Plan 2's worktree isolation depends on that not being
// possible. runDir itself is a path under a fresh, otherwise-empty sibling
// directory rather than a directory created up front, so tests that assert
// "no run state was created" (existsSync(runDir) === false) still work.
function withTemp(fn: (cwd: string, runDir: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-cli-cwd-'))
  const runRoot = mkdtempSync(join(tmpdir(), 'attractor-cli-run-'))
  const runDir = join(runRoot, 'r')
  return fn(cwd, runDir).finally(() => {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(runRoot, { recursive: true, force: true })
  })
}

const GOOD = `
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  echo [shape=parallelogram, tool_command="printf ok"]
  start -> echo -> done
}
`

const BAD = `
digraph B {
  done [shape=Msquare]
  a [shape=box]
  a -> done
}
`

test('lint exits 0 for a valid graph', async () => {
  await withTemp(async (cwd) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    assert.equal(await main(['lint', file]), 0)
  })
})

test('lint exits 1 for a graph with errors', async () => {
  await withTemp(async (cwd) => {
    const file = join(cwd, 'bad.dot')
    writeFileSync(file, BAD, 'utf8')
    assert.equal(await main(['lint', file]), 1)
  })
})

test('run refuses to execute a graph that fails lint', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'lintfail.dot')
    writeFileSync(file, LINT_FAILS_BUT_WOULD_RUN, 'utf8')

    assert.equal(await main(['run', file, '--cwd', cwd, '--run-dir', runDir, '--stub']), 1)
    assert.equal(
      existsSync(runDir),
      false,
      'refusing must happen before any run state is created',
    )
  })
})

test('run executes a valid graph and exits 0', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main(['run', file, '--cwd', cwd, '--run-dir', runDir, '--stub'])
    assert.equal(code, 0)
  })
})

test('--param values reach the graph as context', async () => {
  await withTemp(async (cwd, runDir) => {
    const src = `
      digraph P {
        start [shape=Mdiamond]
        done  [shape=Msquare]
        w [shape=parallelogram, tool_command="printf $flavour > out.txt; printf ok"]
        start -> w -> done
      }
    `
    const file = join(cwd, 'p.dot')
    writeFileSync(file, src, 'utf8')
    const code = await main([
      'run', file, '--param', 'flavour=vanilla',
      '--cwd', cwd, '--run-dir', runDir, '--stub',
    ])
    assert.equal(code, 0)
    const { readFileSync } = await import('node:fs')
    assert.equal(readFileSync(join(cwd, 'out.txt'), 'utf8'), 'vanilla')
  })
})

test('an unknown command exits 2', async () => {
  assert.equal(await main(['wat']), 2)
})

test('a missing pipeline file exits 2 rather than throwing', async () => {
  await withTemp(async (cwd, runDir) => {
    const missing = join(cwd, 'nope.dot')
    assert.equal(await main(['lint', missing]), 2)
    assert.equal(await main(['run', missing, '--run-dir', runDir, '--stub']), 2)
  })
})

test('a malformed --param is a usage error, not silently dropped', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--param', 'flavour',
      '--cwd', cwd, '--run-dir', runDir, '--stub',
    ])
    assert.equal(code, 2, 'a typo in --param must stop the run, not start it short a value')
  })
})

/** Capture what the CLI writes to stderr while `fn` runs. */
async function captureStderr(fn: () => Promise<number>): Promise<{ code: number; err: string }> {
  const original = process.stderr.write.bind(process.stderr)
  let err = ''
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stderr.write
  try {
    return { code: await fn(), err }
  } finally {
    process.stderr.write = original
  }
}

// `Context.from(args.params)` seeds context without consulting
// `isEngineManagedKey`, so `--param current_node=x` writes a key a model would
// be refused. The recorded decision is to warn rather than refuse -- an
// operator is the same authority that wrote the graph, and refusing would
// delete the documented `--param graph.goal` override -- but the bypass must
// not be SILENT.
test('a --param naming an engine-managed key warns and still runs', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const { code, err } = await captureStderr(() =>
      main(['run', file, '--param', 'current_node=x', '--cwd', cwd, '--run-dir', runDir, '--stub']),
    )
    assert.equal(code, 0, 'the operator is not refused')
    assert.match(err, /WARNING: --param current_node names a context key the engine owns/)
  })
})

test('an ordinary --param produces no warning', async () => {
  // The permitting direction: a guard that warns about everything says nothing.
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const { code, err } = await captureStderr(() =>
      main(['run', file, '--param', 'flavour=vanilla', '--cwd', cwd, '--run-dir', runDir, '--stub']),
    )
    assert.equal(code, 0)
    assert.doesNotMatch(err, /WARNING: --param/)
  })
})

// Finding I1's shape at the CLI boundary, in the form the fix does NOT cover:
// no `outputs=` anywhere, so nothing enters the failed-output ledger and the
// eager input check has nothing to say. Spec section 11.3 decides the run
// status by goal gates alone, this graph declares none, so `status: success`
// and exit 0 are CONFORMANT and must not change. The diagnostic is the
// extension -- an operator on a green run must still be told that a node's
// work failed and nothing re-ran it.
//
// This is the case the CLI warning still exists for, and it is why "I1 is
// closed" must never be read as "protection is automatic": declaring outputs
// is what arms the halt, and this graph declares none.
const UNRESOLVED_FAILURE = `
digraph UF {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  build   [shape=parallelogram, tool_command="exit 1"]
  publish [shape=box]
  start -> build
  build -> publish [condition="context.build_error!=fatal"]
  publish -> done
}
`

// p3-01/ADR-014 update: this fixture is exactly GATE-002's own hazard shape
// (an undeclared key -- `build_error` -- referenced by an outcome-blind
// conditional edge, no goal_gate anywhere, `publish` reaches exit), so
// `attractor run` now refuses it at the lint gate before dispatching
// anything, matching the established lint-refusal shape asserted by 'run
// refuses to execute a graph that fails lint' above. See ADR-014
// (.delivery/decisions/) for the full reasoning.
test('a run holding unresolved failures still exits 0, and says so loudly', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'uf.dot')
    writeFileSync(file, UNRESOLVED_FAILURE, 'utf8')
    const { code, err } = await captureStderr(() =>
      main(['run', file, '--cwd', cwd, '--run-dir', runDir, '--stub']),
    )
    assert.equal(code, 1, 'GATE-002 now refuses this exact graph shape at the lint gate')
    assert.match(err, /ERROR GATE-002/)
    assert.match(err, /refusing to run a graph with lint errors/)
    assert.equal(
      existsSync(runDir),
      false,
      'refusing must happen before any run state is created',
    )
  })
})

// The general "unresolved failure reported via WARNING, run still exits 0"
// mechanism (spec section 11.3: status is decided by goal gates alone) still
// needs coverage now that UNRESOLVED_FAILURE above is refused at lint time.
// This fixture keeps a real unresolved failure -- `build` fails and is never
// re-run -- but the downstream edge discriminates genuinely on `outcome`
// (ADR-014's "legitimate shape 2": `condition="outcome=fail"` is never
// vacuous, since `outcome` resolves live from the Outcome object, never from
// context), so GATE-002's condition 4 (outcome-blind) fails and it does not
// fire, leaving this path's WARNING behaviour exercised the way it would be
// in the wild.
const UNRESOLVED_FAILURE_WITH_DISCRIMINATING_ROUTE = `
digraph UF2 {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  build          [shape=parallelogram, tool_command="exit 1"]
  notify_failure [shape=box, prompt="notify"]
  start -> build
  build -> notify_failure [condition="outcome=fail"]
  notify_failure -> done
}
`

test('a run holding an unresolved failure behind a genuinely discriminating route still exits 0, and says so loudly', async () => {
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'uf2.dot')
    writeFileSync(file, UNRESOLVED_FAILURE_WITH_DISCRIMINATING_ROUTE, 'utf8')
    const { code, err } = await captureStderr(() =>
      main(['run', file, '--cwd', cwd, '--run-dir', runDir, '--stub']),
    )
    assert.equal(code, 0, 'section 11.3 decides status by goal gates; this graph has none')
    assert.match(err, /WARNING: the pipeline reached its exit with unresolved node failures: build/)
    // The warning must name the section it is deferring to, so an operator who
    // thinks this should have failed can find out why it did not.
    assert.match(err, /section 11\.3/)
  })
})

test('a clean run produces no unresolved-failure warning', async () => {
  // The permitting direction. A warning that fires on every run is noise.
  await withTemp(async (cwd, runDir) => {
    const file = join(cwd, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const { code, err } = await captureStderr(() =>
      main(['run', file, '--cwd', cwd, '--run-dir', runDir, '--stub']),
    )
    assert.equal(code, 0)
    assert.doesNotMatch(err, /unresolved node failures/)
  })
})
