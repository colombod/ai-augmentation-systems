import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  declaredOutputs,
  effectiveOutputs,
  Handler,
  handlerForNode,
  handlerForShape,
  INFERRED_OUTPUTS_BY_HANDLER,
  inferredOutputs,
  type Node,
} from '../src/dot/graph.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { parseDot } from '../src/dot/parse.ts'

/**
 * Minimal Node builder for output-inference tests. `handler` is resolved
 * through `handlerForNode`, exactly as `parseDot` resolves it, so a test
 * that sets `type=` exercises the same type-over-shape precedence a real
 * parsed graph would.
 */
function node(attrs: Record<string, string>, id = 'n'): Node {
  return { id, attrs, handler: handlerForNode(attrs, id) }
}

test('shape maps to handler kind', () => {
  assert.equal(handlerForShape('Mdiamond', 'begin'), Handler.START)
  assert.equal(handlerForShape('Msquare', 'finish'), Handler.EXIT)
  assert.equal(handlerForShape('box', 'attempt'), Handler.CODERGEN)
  assert.equal(handlerForShape('parallelogram', 'verify'), Handler.TOOL)
  assert.equal(handlerForShape('diamond', 'gate'), Handler.CONDITIONAL)
  assert.equal(handlerForShape('hexagon', 'escalate'), Handler.HUMAN)
  assert.equal(handlerForShape('component', 'fanout'), Handler.PARALLEL)
  assert.equal(handlerForShape('tripleoctagon', 'fanin'), Handler.FAN_IN)
})

test('missing shape defaults to codergen', () => {
  assert.equal(handlerForShape(undefined, 'plan'), Handler.CODERGEN)
})

test('reserved ids win over missing shape', () => {
  assert.equal(handlerForShape(undefined, 'start'), Handler.START)
  assert.equal(handlerForShape(undefined, 'exit'), Handler.EXIT)
})

test('explicit shape wins over reserved id', () => {
  assert.equal(handlerForShape('box', 'start'), Handler.CODERGEN)
})

test('a prototype-shaped shape falls back to codergen like any other unknown shape', () => {
  // Same hole as the type table below: SHAPE_TO_HANDLER is a plain object, so
  // a bare `SHAPE_TO_HANDLER[shape]` lookup falls through to Object.prototype
  // for these exact strings and reports a truthy "known shape" that is really
  // a Function (or the prototype object itself for '__proto__').
  for (const shape of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(
      handlerForShape(shape, 'n'),
      Handler.CODERGEN,
      `shape="${shape}" must default to codergen, not resolve via Object.prototype`,
    )
  }
})

test('a prototype-shaped node id is not treated as a reserved id', () => {
  // RESERVED_IDS has the same plain-object lookup hazard, reached whenever a
  // node carries no shape at all -- the common case in hand-written DOT.
  for (const id of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(
      handlerForShape(undefined, id),
      Handler.CODERGEN,
      `id="${id}" must default to codergen, not resolve via Object.prototype`,
    )
  }
})

test('outcome carries routing fields', () => {
  const o: Outcome = { status: Status.SUCCESS, preferredLabel: 'green' }
  assert.equal(o.status, 'success')
  assert.equal(o.preferredLabel, 'green')
})

test('an explicit type attribute overrides the shape', () => {
  // Spec section 2.6: type "takes precedence over shape-based resolution".
  assert.equal(handlerForNode({ type: 'tool', shape: 'box' }, 'n'), Handler.TOOL)
  assert.equal(handlerForNode({ type: 'wait.human' }, 'n'), Handler.HUMAN)
  assert.equal(handlerForNode({ type: 'parallel.fan_in' }, 'n'), Handler.FAN_IN)
})

test('an unrecognised type falls back to shape rather than being ignored', () => {
  assert.equal(handlerForNode({ type: 'not-a-handler', shape: 'parallelogram' }, 'n'), Handler.TOOL)
})

test('a prototype-shaped type value falls back to shape like any other unknown type', () => {
  // TYPE_TO_HANDLER is a plain object; a bare `TYPE_TO_HANDLER[declared]`
  // lookup falls through to Object.prototype for these exact strings and
  // would resolve to a prototype member (a Function, or the object itself
  // for '__proto__') instead of being treated as unknown. That is not a
  // typo an author could ever see coming, and the node would then die
  // downstream with "no handler registered" against a function object
  // rather than the string the author actually wrote in the DOT source.
  for (const declared of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(
      handlerForNode({ type: declared, shape: 'parallelogram' }, 'n'),
      Handler.TOOL,
      `type="${declared}" must fall through to shape, not resolve via Object.prototype`,
    )
  }
})

test('house maps to the manager loop, not silently to an LLM node', () => {
  // Appendix B. Previously fell through to CODERGEN, so a supervisor node ran
  // its label through the model and the pipeline reported success.
  assert.equal(handlerForNode({ shape: 'house' }, 'n'), Handler.MANAGER_LOOP)
})

test('the shape mapping is otherwise unchanged', () => {
  assert.equal(handlerForNode({ shape: 'Mdiamond' }, 'n'), Handler.START)
  assert.equal(handlerForNode({ shape: 'Msquare' }, 'n'), Handler.EXIT)
  assert.equal(handlerForNode({ shape: 'box' }, 'n'), Handler.CODERGEN)
  assert.equal(handlerForNode({ shape: 'parallelogram' }, 'n'), Handler.TOOL)
  assert.equal(handlerForNode({ shape: 'diamond' }, 'n'), Handler.CONDITIONAL)
  assert.equal(handlerForNode({ shape: 'hexagon' }, 'n'), Handler.HUMAN)
  assert.equal(handlerForNode({}, 'start'), Handler.START)
  assert.equal(handlerForNode({}, 'n'), Handler.CODERGEN)
})

// --- declaredOutputs / inferredOutputs / effectiveOutputs -----------------
//
// `outputs=` is a custom node attribute (spec section 2's design goals:
// the DSL is "extensible through custom attributes"; section 9.3 sanctions
// custom transforms). It is the author-declared half of a node's dataflow
// contract; `inferredOutputs` is the handler-known half.

test('outputs= is split, trimmed, and empty entries dropped', () => {
  const n = node({ outputs: 'a.b , c ,, d ' })
  assert.deepEqual(declaredOutputs(n), ['a.b', 'c', 'd'])
})

test('a node with no outputs attribute declares nothing', () => {
  assert.deepEqual(declaredOutputs(node({})), [])
})

test('a tool node infers the key its handler actually writes to context', () => {
  // NOTE ON THE SHAPE OF THIS SET: the design doc and the plan both say the
  // tool handler contributes {tool.output, tool.last_line, tool.exit_code}.
  // It does not. `src/handlers/tool.ts` writes exactly one context key on
  // SUCCESS -- `tool.last_line` (contextUpdates: { 'tool.last_line': label }).
  // `result.stdout` and `result.code` are used locally (to compute the label
  // and to branch on FAIL) but are never written to context under
  // `tool.output` or `tool.exit_code`; grepping the whole engine and the
  // spec's own tool-handler pseudocode (spec section 4.10, which writes only
  // `tool.output`) turns up neither key anywhere. Per this repo's own
  // doctrine ("treat a plan's reference code as the least-trusted artifact
  // ... if the brief contradicts what the code demonstrably does, report it
  // -- do not adjust the test until it passes"), this test asserts what the
  // handler actually does, sourced from the exported `TOOL_OUTPUT_KEYS`
  // constant in tool.ts, not the plan's assumed three-key list. See the
  // task-1 report for the full writeup.
  const n = node({ shape: 'parallelogram', tool_command: 'make' })
  assert.deepEqual(inferredOutputs(n).sort(), ['tool.last_line', 'tool.output'])
})

test('a box node infers nothing, because a model authors arbitrary keys', () => {
  assert.deepEqual(inferredOutputs(node({ shape: 'box' })), [])
})

test('inference is keyed off the resolved handler, not the shape string', () => {
  // Spec section 2.6: `type` takes precedence over shape-based resolution.
  // A node shaped like a box but typed as a tool must infer the tool set --
  // keying inference off `attrs.shape` directly would silently infer nothing
  // for a real tool node (the previous plan's finding C13).
  const n = node({ shape: 'box', type: 'tool', tool_command: 'make' })
  assert.equal(n.handler, Handler.TOOL)
  assert.deepEqual(inferredOutputs(n).sort(), ['tool.last_line', 'tool.output'])
})

test('a non-tool, non-box node (e.g. a conditional) infers nothing', () => {
  assert.deepEqual(inferredOutputs(node({ shape: 'diamond' })), [])
})

test('effective outputs are the union of inferred and declared, deduplicated', () => {
  // The declared set deliberately does NOT repeat 'tool.last_line': if it
  // did, the union would contain it even with inferredOutputs broken, and
  // the test would not be sensitive to that break. Overlap is covered
  // separately below.
  const n = node({ shape: 'parallelogram', outputs: 'artifact.path' })
  assert.deepEqual(effectiveOutputs(n).sort(), ['artifact.path', 'tool.last_line', 'tool.output'])
})

test('effective outputs deduplicate when declared repeats an inferred key', () => {
  const n = node({ shape: 'parallelogram', outputs: 'artifact.path,tool.last_line' })
  assert.deepEqual(effectiveOutputs(n).sort(), ['artifact.path', 'tool.last_line', 'tool.output'])
})

test('effective outputs of a box node are exactly its declared outputs', () => {
  const n = node({ shape: 'box', outputs: 'summary.text' })
  assert.deepEqual(effectiveOutputs(n), ['summary.text'])
})

test('every HandlerKind has an explicit entry in INFERRED_OUTPUTS_BY_HANDLER', () => {
  // Iterates the Handler constant itself, not a hand-listed array of kind
  // strings -- a hand-listed array here would be exactly the drift this
  // table exists to prevent in the first place: a new HandlerKind could be
  // added to `Handler` (src/dot/graph.ts) without anyone updating a second,
  // independent list of "kinds that should have entries." Object.hasOwn,
  // not a truthy/bracket check, because inferredOutputs()'s `?? []`
  // fallback would make a MISSING entry indistinguishable from a
  // deliberate `[]` one if this test called inferredOutputs() instead of
  // inspecting the table directly.
  for (const kind of Object.values(Handler)) {
    assert.ok(
      Object.hasOwn(INFERRED_OUTPUTS_BY_HANDLER, kind),
      `HandlerKind "${kind}" has no explicit entry in INFERRED_OUTPUTS_BY_HANDLER`,
    )
  }
})

test('start, exit and conditional are genuinely known-empty, not merely unregistered', () => {
  // Distinguishes the two reasons a kind can legitimately map to [] (see
  // the table's doc comment): PassthroughHandler-backed kinds write
  // nothing because their handler runs and produces no contextUpdates,
  // which is a different fact from "no handler is registered at all" (the
  // human/parallel/fan_in/manager_loop case). This test pins the
  // PassthroughHandler set specifically, so a future registration of a real
  // handler for one of these three is forced to reconsider this entry
  // rather than inheriting an [] that was true for an unrelated reason.
  for (const kind of [Handler.START, Handler.EXIT, Handler.CONDITIONAL]) {
    assert.deepEqual(INFERRED_OUTPUTS_BY_HANDLER[kind], [])
  }
})

// ---------------------------------------------------------------------------
// Sections 3.2 and 4.4: the reserved-id table was missing half its entries.
//
// 3.2's find_start_node "Resolves by: (1) shape=Mdiamond, (2) id="start" or
// "Start"". 4.4: "exactly one exit node (shape=Msquare or id matching
// `exit`/`end`)". Ours listed only lowercase `start` and `exit`, so a graph
// written to the spec died at runtime -- `Start` with "graph has no start
// node", `end` with "run terminated at end, which has no outgoing edges and
// is not the exit".
//
// The set is exactly the four ids the spec names, and no more. The
// capitalisation is asymmetric (`Start` is named, `End`/`Exit` are not); that
// is the spec's asymmetry, transcribed rather than tidied.
// ---------------------------------------------------------------------------

test('every reserved id the spec names resolves without a shape', () => {
  assert.equal(handlerForShape(undefined, 'start'), Handler.START)
  assert.equal(handlerForShape(undefined, 'Start'), Handler.START, 'section 3.2 names "Start"')
  assert.equal(handlerForShape(undefined, 'exit'), Handler.EXIT)
  assert.equal(handlerForShape(undefined, 'end'), Handler.EXIT, 'section 4.4 names `end`')
})

test('the reserved-id table is exactly the ids the spec names', () => {
  for (const id of ['End', 'Exit', 'START', 'EXIT', 'starts', 'ending']) {
    assert.equal(
      handlerForShape(undefined, id),
      Handler.CODERGEN,
      `"${id}" is not a reserved id in section 3.2 or 4.4`,
    )
  }
})

test('an explicit shape still wins over the added reserved ids', () => {
  assert.equal(handlerForShape('box', 'Start'), Handler.CODERGEN)
  assert.equal(handlerForShape('box', 'end'), Handler.CODERGEN)
})

test('a graph written with Start and end resolves both terminals', () => {
  const g = parseDot('digraph G { Start end Start -> end }')
  assert.equal(g.nodes.get('Start')?.handler, Handler.START)
  assert.equal(g.nodes.get('end')?.handler, Handler.EXIT)
})
