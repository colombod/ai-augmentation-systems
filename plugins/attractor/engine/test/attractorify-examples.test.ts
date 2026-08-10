import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { lint, hasErrors, parseDot } from '../src/index.ts'
import { verifyRun } from '../../skills/attractorify/verify-run.ts'

// FR-16: no worked example may be described as working without having been
// executed on this engine. This is the falsifiability check -- every .dot
// under skills/attractorify/examples/ must (a) lint clean and (b) actually
// re-run to the SAME terminal status its committed events.jsonl records, so
// a stale or hand-edited transcript is caught, not just a missing one.

const EXAMPLES_DIR = join(import.meta.dirname, '..', '..', 'skills', 'attractorify', 'examples')

const dotFiles = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith('.dot'))
  .sort()

test('at least one example exists', () => {
  assert.ok(dotFiles.length > 0, 'skills/attractorify/examples/ must contain at least one .dot file')
})

function committedTerminalStatus(name: string): string {
  const eventsPath = join(EXAMPLES_DIR, `${name}.events.jsonl`)
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n')
  const events = lines.map((l) => JSON.parse(l) as { type: string; status?: string })
  const terminal = [...events].reverse().find((e) => e.type === 'pipeline.end')
  assert.ok(terminal, `${name}.events.jsonl has no pipeline.end event`)
  assert.ok(typeof terminal.status === 'string', `${name}.events.jsonl's pipeline.end has no status`)
  return terminal.status as string
}

function needsGitRepoCwd(dotPath: string): boolean {
  const graph = parseDot(readFileSync(dotPath, 'utf8'))
  for (const node of graph.nodes.values()) {
    if (node.handler === 'parallel') return true
  }
  return false
}

for (const file of dotFiles) {
  const name = basename(file, '.dot')
  const dotPath = join(EXAMPLES_DIR, file)

  test(`${name}: lints clean`, () => {
    const graph = parseDot(readFileSync(dotPath, 'utf8'))
    const diagnostics = lint(graph)
    assert.equal(
      hasErrors(diagnostics),
      false,
      `expected no ERROR diagnostics, got: ${JSON.stringify(diagnostics.filter((d) => d.severity === 'error'))}`,
    )
  })

  test(`${name}: a fresh --stub run reaches the SAME terminal status as the committed transcript`, async () => {
    const runDir = mkdtempSync(join(tmpdir(), `attractorify-example-${name}-`))
    let cwd: string | undefined
    try {
      if (needsGitRepoCwd(dotPath)) {
        cwd = mkdtempSync(join(tmpdir(), `attractorify-example-${name}-cwd-`))
        execFileSync('git', ['init', '-q'], { cwd })
        execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], {
          cwd,
        })
      }
      const result = await verifyRun(dotPath, { runDir, cwd, stub: true })
      assert.equal(result.harnessOk, true, `verify-run itself failed: ${result.output}`)

      const expected = committedTerminalStatus(name)
      const statusMatch = result.output.match(/status=(\w+)/)
      assert.ok(statusMatch, `could not parse status from: ${result.output}`)
      assert.equal(
        statusMatch[1],
        expected,
        `fresh run reached status=${statusMatch[1]}, but the committed transcript records status=${expected} -- the transcript may be stale`,
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      if (cwd) rmSync(cwd, { recursive: true, force: true })
    }
  })
}
