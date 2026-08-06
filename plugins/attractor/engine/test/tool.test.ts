import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { ToolHandler, TOOL_OUTPUT_KEYS } from '../src/handlers/tool.ts'

const G = parseDot(`
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  green [shape=parallelogram, tool_command="printf green"]
  red   [shape=parallelogram, tool_command="printf red; exit 1"]
  subst [shape=parallelogram, tool_command="printf $flavour"]
  multi [shape=parallelogram, tool_command="echo noise; printf chosen"]
  start -> green -> red -> subst -> multi -> done
}
`)

// runDir and cwd are two genuinely separate sibling temp directories: a
// regression that swapped them in HandlerCtx would be invisible if the two
// were ever the same path.
function run(nodeId: string, ctx: Context) {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-tool-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-tool-cwd-'))
  const handler = new ToolHandler()
  return handler
    .execute({
      node: G.nodes.get(nodeId)!,
      graph: G,
      context: ctx,
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    .finally(() => {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    })
}

test('exit zero succeeds and records the last stdout line', async () => {
  const ctx = Context.from({})
  const outcome = await run('green', ctx)
  assert.equal(outcome.status, Status.SUCCESS)
  assert.equal(ctx.get('tool.last_line'), 'green')
})

test('only the final non-empty line becomes the routing label', async () => {
  const ctx = Context.from({})
  await run('multi', ctx)
  assert.equal(ctx.get('tool.last_line'), 'chosen')
})

test('non-zero exit fails', async () => {
  const ctx = Context.from({})
  const outcome = await run('red', ctx)
  assert.equal(outcome.status, Status.FAIL)
})

test('a failing tool node does NOT refresh tool.last_line', async () => {
  const ctx = Context.from({})
  await run('green', ctx)
  assert.equal(ctx.get('tool.last_line'), 'green')
  await run('red', ctx)
  assert.equal(
    ctx.get('tool.last_line'),
    'green',
    'stale label rule: a failed tool node leaves the previous label in place',
  )
})

test('the command is substituted from context before execution', async () => {
  const ctx = Context.from({ flavour: 'vanilla' })
  await run('subst', ctx)
  assert.equal(ctx.get('tool.last_line'), 'vanilla')
})

// ---------------------------------------------------------------------------
// Sections 4.10 and 5.6 -- tool.output, and the node's status.json.
// ---------------------------------------------------------------------------

/** Runs one node against a scratch runDir that is NOT deleted, so the
 *  artifacts section 5.6 describes can be inspected. */
async function runKeeping(nodeId: string, ctx: Context) {
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-tool-keep-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-tool-keep-cwd-'))
  const outcome = await new ToolHandler().execute({
    node: G.nodes.get(nodeId)!,
    graph: G,
    context: ctx,
    runDir,
    cwd,
    events: new EventLog(runDir),
  })
  return { outcome, runDir, cwd }
}

// Section 4.10: on success the handler returns
// `context_updates={"tool.output": result.stdout}`. We wrote only
// `tool.last_line`, so the full stdout of a tool node was unreachable from
// context -- a node that printed a JSON document could hand on only its last
// line.
//
// ADDED, NOT SUBSTITUTED. `tool.last_line` is load-bearing for the stale-label
// rule in plugins/attractor/AGENTS.md and both the key and its
// not-written-on-failure behaviour are unchanged below.
test('section 4.10 writes tool.output as well as tool.last_line', async () => {
  const ctx = Context.from({})
  const { outcome, runDir, cwd } = await runKeeping('multi', ctx)
  try {
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(ctx.get('tool.output'), 'noise\nchosen', 'the whole stdout, untrimmed of lines')
    assert.equal(ctx.get('tool.last_line'), 'chosen', 'and the existing key is untouched')
    assert.equal(outcome.contextUpdates?.['tool.output'], 'noise\nchosen')
    assert.equal(outcome.contextUpdates?.['tool.last_line'], 'chosen')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// The stale-label rule extended to the new key, and this is the half that
// matters: a failing tool node must not overwrite what a previous run left
// behind, or a gate's earlier label does not survive a failed re-entry.
test('a failing tool node refreshes neither tool.last_line nor tool.output', async () => {
  const ctx = Context.from({ 'tool.last_line': 'green', 'tool.output': 'green\n' })
  const { outcome, runDir, cwd } = await runKeeping('red', ctx)
  try {
    assert.equal(outcome.status, Status.FAIL)
    assert.equal(ctx.get('tool.last_line'), 'green', 'the stale-label rule is unchanged')
    assert.equal(ctx.get('tool.output'), 'green\n', 'and the new key obeys it too')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// Section 5.6's run directory structure gives every `{node_id}/` a
// `status.json` -- "Node execution outcome". Tool nodes wrote command.sh,
// stdout.txt and stderr.txt and no status.json at all, so the one artifact an
// external reader is told to look for was missing for half the node kinds.
test('a tool node writes status.json on success (section 5.6)', async () => {
  const ctx = Context.from({})
  const { runDir, cwd } = await runKeeping('green', ctx)
  try {
    const st = JSON.parse(readFileSync(join(runDir, 'green', 'status.json'), 'utf8'))
    assert.equal(st.outcome, 'success')
    assert.equal(st.context_updates['tool.last_line'], 'green')
    assert.equal(st.context_updates['tool.output'], 'green')
    assert.equal(st.failure_reason, undefined, 'a success carries no reason (section 5.2)')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a tool node writes status.json on failure, with failure_reason (sections 5.2, 5.6)', async () => {
  const ctx = Context.from({})
  const { runDir, cwd } = await runKeeping('red', ctx)
  try {
    const st = JSON.parse(readFileSync(join(runDir, 'red', 'status.json'), 'utf8'))
    assert.equal(st.outcome, 'fail')
    assert.match(st.failure_reason, /exit 1/)
    assert.equal(
      st.context_updates,
      undefined,
      'a failed tool node claims no updates -- the stale-label rule, on disk too',
    )
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a tool node with no command still leaves a status.json (section 5.6)', async () => {
  // The one early return that produced no artifacts at all, so an operator
  // debugging a misconfigured node found an empty directory -- or none.
  const g = parseDot(`
    digraph N {
      start [shape=Mdiamond]  done [shape=Msquare]
      empty [shape=parallelogram]
      start -> empty -> done
    }
  `)
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-tool-nocmd-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-tool-nocmd-cwd-'))
  try {
    const outcome = await new ToolHandler().execute({
      node: g.nodes.get('empty')!, graph: g, context: Context.from({}),
      runDir, cwd, events: new EventLog(runDir),
    })
    assert.equal(outcome.status, Status.FAIL)
    const st = JSON.parse(readFileSync(join(runDir, 'empty', 'status.json'), 'utf8'))
    assert.match(st.failure_reason, /no tool_command/)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

// The anti-drift pin, matching the one lint.test.ts already has. `dot/graph.ts`
// derives a tool node's inferred output set from this constant, so a key the
// handler starts writing must appear here the same day or the dataflow layer
// silently stops knowing about it.
test('TOOL_OUTPUT_KEYS names every key the handler writes on success', async () => {
  const ctx = Context.from({})
  const { outcome, runDir, cwd } = await runKeeping('green', ctx)
  try {
    assert.deepEqual(
      Object.keys(outcome.contextUpdates ?? {}).sort(),
      [...TOOL_OUTPUT_KEYS].sort(),
      'the declared set and the written set are the same set',
    )
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
