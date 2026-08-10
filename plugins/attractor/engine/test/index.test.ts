import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Engine,
  defaultHandlers,
  Context,
  lint,
  hasErrors,
  parseDot,
  Handler,
  StubBackend,
  EventLog,
  Status,
} from '../src/index.ts'

// p6-01: the library entry point must be sufficient on its own -- no import in this
// file reaches into core/, dot/, handlers/, backend/, or run/ directly.

const LINEAR = `
digraph L {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="first"]
  start -> a -> done
}
`

test('index.ts exports a lint-and-run surface sufficient to execute a graph end to end', async () => {
  const graph = parseDot(LINEAR)
  const diagnostics = lint(graph)
  assert.equal(hasErrors(diagnostics), false, 'a valid linear graph must not lint-error')

  const runDir = mkdtempSync(join(tmpdir(), 'attractor-index-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-index-cwd-'))
  try {
    const engine = new Engine({
      graph,
      context: Context.from({}),
      runDir,
      cwd,
      handlers: defaultHandlers(new StubBackend()),
    })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.path, ['start', 'a', 'done'])

    const events = new EventLog(runDir)
    const recorded = events.all()
    assert.ok(recorded.length > 0, 'the run produced at least one recorded event')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('index.ts exports Handler with the six registered kinds available for graph authoring', () => {
  assert.equal(Handler.START, 'start')
  assert.equal(Handler.EXIT, 'exit')
  assert.equal(Handler.CONDITIONAL, 'conditional')
  assert.equal(Handler.TOOL, 'tool')
  assert.equal(Handler.CODERGEN, 'codergen')
  assert.equal(Handler.PARALLEL, 'parallel')
})

test('a lint-dirty graph is reported by the same lint() this index re-exports', () => {
  const dirty = parseDot(`
digraph D {
  a [shape=Mdiamond]
  b [shape=Mdiamond]
  done [shape=Msquare]
  a -> done
  b -> done
}
`)
  const diagnostics = lint(dirty)
  assert.equal(hasErrors(diagnostics), true, 'two start nodes must lint-error (TOPO-001)')
})
