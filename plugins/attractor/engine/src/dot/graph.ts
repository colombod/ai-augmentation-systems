import { TOOL_OUTPUT_KEYS } from '../handlers/tool.ts'

export const Handler = {
  START: 'start',
  EXIT: 'exit',
  CODERGEN: 'codergen',
  TOOL: 'tool',
  CONDITIONAL: 'conditional',
  HUMAN: 'human',
  PARALLEL: 'parallel',
  FAN_IN: 'fan_in',
  MANAGER_LOOP: 'manager_loop',
} as const

export type HandlerKind = (typeof Handler)[keyof typeof Handler]

export interface Node {
  id: string
  attrs: Record<string, string>
  handler: HandlerKind
}

export interface Edge {
  from: string
  to: string
  attrs: Record<string, string>
}

export interface Graph {
  name: string
  attrs: Record<string, string>
  nodes: Map<string, Node>
  edges: Edge[]
}

const SHAPE_TO_HANDLER: Record<string, HandlerKind> = {
  Mdiamond: Handler.START,
  Msquare: Handler.EXIT,
  box: Handler.CODERGEN,
  parallelogram: Handler.TOOL,
  diamond: Handler.CONDITIONAL,
  hexagon: Handler.HUMAN,
  component: Handler.PARALLEL,
  tripleoctagon: Handler.FAN_IN,
  house: Handler.MANAGER_LOOP,
}

/**
 * The node ids the spec reserves for the two terminals, quoted:
 *
 * - Section 3.2, `find_start_node`: "Resolves by: (1) shape=Mdiamond,
 *   (2) id=\"start\" or \"Start\"".
 * - Section 4.4: "Every graph must have exactly one exit node (shape=Msquare
 *   or id matching `exit`/`end`)".
 *
 * This table listed only lowercase `start` and `exit`, so a graph written to
 * the spec failed at RUN time rather than parse time and with an error that
 * named neither cause: `Start` produced "graph has no start node", and `end`
 * produced "run terminated at end, which has no outgoing edges and is not the
 * exit".
 *
 * The capitalisation is asymmetric -- 3.2 names `Start` but 4.4 names no
 * `End` or `Exit`. That asymmetry is the spec's, and it is transcribed rather
 * than tidied into a symmetric set: inventing `End` would reserve an id the
 * spec leaves to authors, which is the same class of harm in the opposite
 * direction. Recorded as an ambiguity worth raising upstream.
 */
const RESERVED_IDS: Record<string, HandlerKind> = {
  start: Handler.START,
  Start: Handler.START,
  exit: Handler.EXIT,
  end: Handler.EXIT,
}

/**
 * Resolve a node's handler. An explicit shape always wins; otherwise the
 * reserved ids of sections 3.2 and 4.4 apply; otherwise a node is an LLM task.
 */
export function handlerForShape(shape: string | undefined, id: string): HandlerKind {
  // Object.hasOwn rather than a bare index, for the same reason as
  // handlerForNode below: both tables are plain objects, so shape="constructor"
  // or an unshaped node named `toString` would otherwise read as a known key
  // and resolve to an Object.prototype member instead of defaulting to
  // CODERGEN the way every other unrecognised shape or id does.
  if (shape && Object.hasOwn(SHAPE_TO_HANDLER, shape)) return SHAPE_TO_HANDLER[shape]
  if (!shape && Object.hasOwn(RESERVED_IDS, id)) return RESERVED_IDS[id]
  return Handler.CODERGEN
}

/**
 * Spec section 2.6 type strings, which differ from our internal handler
 * keys. Exported so the `type_known` lint rule validates against exactly
 * this table rather than a second, hand-copied list -- the two are the same
 * source, so they cannot drift the way an independently-maintained lint
 * list eventually would.
 */
export const TYPE_TO_HANDLER: Record<string, HandlerKind> = {
  start: Handler.START,
  exit: Handler.EXIT,
  codergen: Handler.CODERGEN,
  tool: Handler.TOOL,
  conditional: Handler.CONDITIONAL,
  'wait.human': Handler.HUMAN,
  parallel: Handler.PARALLEL,
  'parallel.fan_in': Handler.FAN_IN,
  'stack.manager_loop': Handler.MANAGER_LOOP,
}

/**
 * Resolve a node's handler from its attributes.
 *
 * An explicit `type` wins over shape (spec section 2.6). An unrecognised type
 * falls through to shape rather than being ignored, so a typo degrades to the
 * shape the author also wrote rather than silently becoming an LLM node.
 */
export function handlerForNode(attrs: Record<string, string>, id: string): HandlerKind {
  const declared = attrs.type
  // Object.hasOwn, not a bare `TYPE_TO_HANDLER[declared]` truthy check: a
  // plain object's lookup falls through to Object.prototype, so
  // type="constructor" or type="toString" would otherwise resolve to a
  // prototype method rather than falling through to shape as an unknown
  // type should. That is not a typo the author can see coming, and the
  // node would then die downstream with "no handler registered" against a
  // Function, not against a string the author actually wrote.
  if (declared !== undefined && Object.hasOwn(TYPE_TO_HANDLER, declared)) {
    return TYPE_TO_HANDLER[declared]
  }
  return handlerForShape(attrs.shape, id)
}

export function outgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.from === nodeId)
}

/**
 * The node's sole direct predecessor, if it has exactly one distinct
 * incoming source -- null otherwise.
 *
 * Counts distinct source nodes, not raw incoming edges: two edges from the
 * same node (e.g. separate labelled "success"/"failure" branches) are one
 * predecessor, not two, and a self-loop (`from === to`) is excluded
 * entirely rather than counted as a predecessor of itself. This closes
 * false negatives where duplicate/self-loop edges inflated the incoming
 * count even though there was really only one meaningful predecessor.
 *
 * Two or more edges from genuinely DIFFERENT source nodes still correctly
 * returns null -- that case stays disqualified by design, since lint has
 * no way to know at analysis time which branch's output actually reached
 * this node at runtime.
 */
export function directPredecessor(graph: Graph, nodeId: string): Node | null {
  const incoming = graph.edges.filter((e) => e.to === nodeId && e.from !== nodeId)
  const distinctSources = new Set(incoming.map((e) => e.from))
  if (distinctSources.size !== 1) return null
  return graph.nodes.get([...distinctSources][0]) ?? null
}

export function findByHandler(graph: Graph, kind: HandlerKind): Node[] {
  return [...graph.nodes.values()].filter((n) => n.handler === kind)
}

/**
 * Context keys a node's resolved handler is known to write, independent of
 * what any author declares. Total over `HandlerKind` -- every kind has an
 * explicit entry, not merely the ones reviewed so far, so a future
 * `HandlerKind` added without an entry here is a decision someone has to
 * make rather than a silent `[]` nobody chose. `Handler.TOOL`'s entry is
 * imported from `handlers/tool.ts` rather than retyped here -- a
 * hand-copied list is exactly the drift the dataflow design this supports
 * exists to eliminate.
 *
 * `[]` means two different things below and the comment on each entry says
 * which:
 *
 * - "genuinely writes nothing" -- START, EXIT and CONDITIONAL all resolve
 *   to `engine.ts`'s `PassthroughHandler`, whose `execute` returns
 *   `{status: SUCCESS}` with no `contextUpdates` at all (verified by
 *   reading `engine.ts`, not assumed); CODERGEN is the box handler, which
 *   infers nothing on purpose because a model's `contextUpdates` keys are
 *   arbitrary and are filtered by the engine-managed key guard, so there is
 *   nothing honest to infer -- an author of a box node whose output matters
 *   to a successor must declare it via `outputs=`.
 * - "no handler is registered for this kind yet" -- HUMAN, PARALLEL,
 *   FAN_IN and MANAGER_LOOP are absent from `engine.ts`'s
 *   `defaultHandlers()` map, so a graph containing one of these aborts with
 *   "no handler registered" before any handler runs. `[]` is correct
 *   *today* only because the kind cannot execute at all, not because a
 *   future handler for it is known to write nothing. Update the entry the
 *   moment one is registered -- the exhaustiveness test below only proves
 *   every kind has *an* entry, not that an unregistered kind's `[]` stays
 *   true once it is implemented.
 *
 * This project has no `tsc`/CI step (native type stripping only; `npm
 * test` runs `node --test` directly), so `Record<HandlerKind, ...>`'s
 * compile-time exhaustiveness is a real signal to an editor's language
 * server but nothing that actually runs enforces it. The test in
 * `graph.test.ts` that iterates `Object.values(Handler)` and asserts
 * `Object.hasOwn` on this exported table is the enforcement that does run.
 */
export const INFERRED_OUTPUTS_BY_HANDLER: Record<HandlerKind, readonly string[]> = {
  [Handler.START]: [], // PassthroughHandler: {status: SUCCESS}, no contextUpdates.
  [Handler.EXIT]: [], // PassthroughHandler, same as START.
  [Handler.CODERGEN]: [], // Deliberate -- see the box-handler note above.
  [Handler.TOOL]: TOOL_OUTPUT_KEYS,
  [Handler.CONDITIONAL]: [], // PassthroughHandler, same as START.
  [Handler.HUMAN]: [], // Not registered in defaultHandlers() -- cannot execute, let alone write.
  [Handler.PARALLEL]: [], // Not registered in defaultHandlers() -- cannot execute, let alone write.
  [Handler.FAN_IN]: [], // Not registered in defaultHandlers() -- cannot execute, let alone write.
  [Handler.MANAGER_LOOP]: [], // Not registered in defaultHandlers() -- cannot execute, let alone write.
}

/**
 * Handler kinds `defaultHandlers()` (core/engine.ts) does not register today.
 * A node resolving to one of these aborts the run with "no handler
 * registered" the moment it's reached -- HAND-001 refuses it at design time
 * instead. Hand-listed, not derived from defaultHandlers() here, because
 * that function needs a Backend to construct and importing it back into this
 * pure static-analysis module would recreate the exact circular-import
 * hazard FR-11 removed. The anchor test in lint.test.ts cross-checks this
 * against defaultHandlers()'s actual keys, so drift fails loudly instead of
 * silently -- including when a future plan registers one of these kinds and
 * this list is not updated to match.
 */
export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[] = [
  Handler.HUMAN,
  Handler.PARALLEL,
  Handler.FAN_IN,
  Handler.MANAGER_LOOP,
]

/**
 * The handler kinds `defaultHandlers` maps to `PassthroughHandler`, and
 * therefore the kinds that return SUCCESS unconditionally and have no failure
 * to route.
 *
 * Exported and used to BUILD the map below rather than restated beside it,
 * because `dot/lint.ts` needs exactly this set for GATE-001 -- a failure route
 * leaving a node that cannot fail is dead, and flagging it would be a false
 * positive. That rule kept its own hand-copied list, which is the same drift
 * `TYPE_TO_HANDLER`, `TOOL_OUTPUT_KEYS` and `SUBSTITUTABLE_ATTRS` were each
 * extracted to eliminate: the day someone registers a real handler for
 * CONDITIONAL, the copy in the linter would quietly go on claiming a diamond
 * node can never fail. Deriving the map from the list makes that impossible in
 * one direction; the test in `lint.test.ts` that recomputes the passthrough set
 * from `defaultHandlers` itself closes the other (an entry added AFTER the
 * spread would win in the Map and not appear here).
 */
export const PASSTHROUGH_KINDS: readonly HandlerKind[] = [Handler.START, Handler.EXIT, Handler.CONDITIONAL]

/**
 * `runs_on={always|success|failure}` -- WHEN a node runs.
 *
 * A custom node attribute, and legitimately so: section 2's design goals state
 * the DSL "remains predictable while being extensible through custom
 * attributes". The spec defines nothing named `runs_on` -- checked against
 * `attractor-spec.md` rather than assumed -- so this is an extension, and it
 * changes no routing rule, adds no status and touches no verdict.
 *
 * - `success` (the default) -- current behaviour. The eager input check
 *   applies, so a node whose referenced key a failed node owed returns FAIL
 *   without its handler being invoked.
 * - `failure` -- the node runs only when the run is holding a failure nothing
 *   has recovered.
 * - `always` -- the node runs regardless.
 *
 * WHAT IT DOES NOT DO: it does not change what an unresolved reference expands
 * to. `failure` and `always` originally BLANKED the keys a failed node owed,
 * so `${artifact.dir}` reached `sh -c` as the empty string. The whole-branch
 * review ran that end to end and a cleanup node's
 * `rm -rf ${artifact.dir}/tmp` executed as **`rm -rf /tmp`** -- the identical
 * hazard the shell-variable exemption in `substitute` exists to prevent, on
 * the one class of node (`runs_on=always` cleanup) where `rm -rf` actually
 * lives, and a REGRESSION on top: before the blanking, `sh` refused
 * `${artifact.dir}` with `bad substitution` and exit 1, so the failure was
 * loud. An owed key is now left LITERAL, exactly as an unknown key already
 * was, which is one rule instead of two and restores the loud failure. The
 * design specified blanking; the design was wrong.
 *
 * The cost is accepted and is small: a `runs_on={failure,always}` node that
 * legitimately references an owed key sees the reference text rather than an
 * empty string, and a POSIX shell then fails it loudly (a dotted key is not a
 * valid parameter name). That is a cleanup node reporting that its input never
 * arrived, which is true, instead of silently deleting the wrong path.
 *
 * DELIBERATELY SEPARATE from any "ignore my own failure" knob, and this is the
 * whole reason the axis is named for WHEN rather than for outcome handling.
 * Amplifier's own R12 reached the same conclusion after conflating them:
 * `continue_on_fail` means "this node failed, but route it as success", which
 * is a different question from "this node runs BECAUSE upstream failed".
 * Conflated, a cleanup node silences its own genuine failures -- so a
 * `runs_on=always` node that exits non-zero still returns FAIL, still enters
 * both failure records, and still meets fail-fast at the next edge. Nothing in
 * this engine means the first thing today, and nothing here starts to.
 */
export const RunsOn = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ALWAYS: 'always',
} as const

export type RunsOnMode = (typeof RunsOn)[keyof typeof RunsOn]

/**
 * The recognised `runs_on` values, keyed by themselves.
 *
 * Exported so the RUNS-001 lint rule validates against the very table
 * `runsOn` resolves from -- the arrangement `TYPE_TO_HANDLER` has with
 * TYPE-001, and for the same reason: a lint rule with its own copy of an
 * engine's accepted-value set eventually accepts a value the engine does not.
 */
export const RUNS_ON_MODES: Record<string, RunsOnMode> = {
  [RunsOn.SUCCESS]: RunsOn.SUCCESS,
  [RunsOn.FAILURE]: RunsOn.FAILURE,
  [RunsOn.ALWAYS]: RunsOn.ALWAYS,
}

/**
 * A node's `runs_on` mode. An unrecognised value falls back to the default,
 * `success`.
 *
 * The FALLBACK DIRECTION is the decision, not the leniency. `success` is the
 * conservative end of this axis: the eager input check still applies, the node
 * behaves like every ordinary node, and nothing is switched off. Falling back
 * to `always` would let a single typo disable the input check on a node the
 * author believed was ordinary -- silently widening what runs, which is the
 * shape of degradation the doctrine actually forbids.
 *
 * This follows the precedent `type` already set: `handlerForNode` degrades an
 * unrecognised `type` to the node's shape and the TYPE-001 lint rule is what
 * names the typo out loud, so the loudness lives where it can be delivered
 * before the pipeline runs rather than half-way through one. `fidelity` is the
 * other precedent and has no lint rule at all; this attribute deserves the
 * `type` treatment rather than the `fidelity` treatment, because getting it
 * wrong silently changes whether a cleanup node runs. **That half now exists:
 * RUNS-001 in `dot/lint.ts` validates `runs_on` against `RUNS_ON_MODES` below
 * and is an ERROR**, matching TYPE-001 rather than `fidelity`'s silence,
 * because the value set is closed and fully known at lint time -- no `--param`
 * can supply a legitimate fourth value the way DATA-001's excuse requires.
 *
 * `Object.hasOwn` rather than a bare index, for `handlerForNode`'s reason: a
 * plain object's lookup falls through to Object.prototype, so
 * `runs_on="constructor"` would otherwise resolve to a prototype member
 * instead of falling back the way every other unrecognised value does.
 */
export function runsOn(node: Node): RunsOnMode {
  const declared = node.attrs.runs_on
  if (declared !== undefined && Object.hasOwn(RUNS_ON_MODES, declared)) {
    return RUNS_ON_MODES[declared]
  }
  return RunsOn.SUCCESS
}

/**
 * The node attributes each handler passes through `substitute()`, in the
 * handler's own FALLBACK order.
 *
 * ONE definition, consumed by both the engine's eager input check and the
 * DATA-001 lint rule. Those two must agree about what even counts as a
 * dataflow reference: if lint's idea of a reference is wider, it warns about
 * text the engine never expands; if it is narrower, a graph lints clean and
 * then halts at runtime on a key lint could have named. Two lists look
 * identical on the day they are written and drift the moment either side
 * changes -- the same reason `splitClauses`, `TYPE_TO_HANDLER` and
 * `TOOL_OUTPUT_KEYS` were each extracted rather than restated.
 *
 * Keyed off the RESOLVED handler, not off attribute names, because that is
 * where substitution demonstrably happens -- and it is the only keying that
 * survives section 2.6's `type`-over-`shape` precedence (finding C13's
 * class of bug). Read from the handlers, not from a design document:
 *
 * - `BoxHandler` expands `attrs.prompt || attrs.label || ''`. Both attributes
 *   are listed, in that order, and the fallback is a fallback rather than a
 *   union: a label IS the prompt when no prompt is set, and is inert
 *   decoration otherwise. Scanning it unconditionally would block a node on
 *   text the engine never expands.
 * - `ToolHandler` expands `attrs.tool_command`.
 * - Every other kind resolves to `engine.ts`'s `PassthroughHandler` (START,
 *   EXIT, CONDITIONAL) or has no registered handler at all (HUMAN, PARALLEL,
 *   FAN_IN, MANAGER_LOOP) and substitutes nothing. As with
 *   `INFERRED_OUTPUTS_BY_HANDLER`, `[]` for an unregistered kind is correct
 *   only because the kind cannot execute -- update the entry when one is
 *   registered.
 *
 * The dataflow design names a wider set (`prompt`, `tool_command`,
 * `tool_env`, `description`). Two of those four do not exist anywhere in this
 * engine -- nothing reads `tool_env` or `description` -- and the list omits
 * `label`, which a box node with no prompt genuinely does substitute. The
 * design's list was not transcribed; the handlers were read.
 *
 * `||` and not `??` in `substitutableText` below, matching `BoxHandler`
 * exactly: an explicitly empty prompt falls back rather than dispatching a
 * blank one.
 */
export const SUBSTITUTABLE_ATTRS: Record<HandlerKind, readonly string[]> = {
  [Handler.START]: [], // PassthroughHandler: no prompt, no command, no substitution.
  [Handler.EXIT]: [], // PassthroughHandler, same as START.
  [Handler.CODERGEN]: ['prompt', 'label'], // BoxHandler: `attrs.prompt || attrs.label`.
  [Handler.TOOL]: ['tool_command'], // ToolHandler: `attrs.tool_command`.
  [Handler.CONDITIONAL]: [], // PassthroughHandler, same as START.
  [Handler.HUMAN]: [], // Not registered in defaultHandlers() -- cannot execute.
  [Handler.PARALLEL]: [], // Not registered in defaultHandlers() -- cannot execute.
  [Handler.FAN_IN]: [], // Not registered in defaultHandlers() -- cannot execute.
  [Handler.MANAGER_LOOP]: [], // Not registered in defaultHandlers() -- cannot execute.
}

/** The text a node's handler actually passes through `substitute()`. */
export function substitutableText(node: Node): string {
  for (const attr of SUBSTITUTABLE_ATTRS[node.handler] ?? []) {
    const value = node.attrs[attr]
    if (value) return value
  }
  return ''
}

/**
 * Context keys explicitly declared via the `outputs=` node attribute. This
 * is a custom attribute, not a spec-defined one -- and that is legitimate
 * rather than invented: section 2's design goals state the DSL is
 * "extensible through custom attributes", and section 9.3 sanctions custom
 * transforms. Comma-separated, each entry trimmed, empty entries dropped
 * (so `"a, b ,, c"` and trailing/doubled commas from hand-edited DOT don't
 * produce phantom keys).
 */
export function declaredOutputs(node: Node): string[] {
  const raw = node.attrs.outputs
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Context keys a node's handler is known to write regardless of what its
 * author declares. Keyed off `node.handler` -- the value `handlerForNode`
 * already resolved, honouring the spec section 2.6 `type`-over-`shape`
 * precedence -- rather than off `node.attrs.shape` directly. Keying off the
 * shape string would infer the wrong (empty) set for a node that selects
 * its handler via `type="tool"` against a `box` shape, or the wrong
 * (tool) set for the reverse: the previous plan's finding C13 was exactly
 * this class of bug.
 */
export function inferredOutputs(node: Node): string[] {
  // The `?? []` is defensive, not load-bearing: INFERRED_OUTPUTS_BY_HANDLER
  // is total over HandlerKind by construction above, and the
  // exhaustiveness test in graph.test.ts fails the moment that stops being
  // true. It stays because this project's types are stripped, not checked,
  // before tests run -- see the table's doc comment.
  return [...(INFERRED_OUTPUTS_BY_HANDLER[node.handler] ?? [])]
}

/**
 * The dataflow contract a node's successors can rely on: the union of what
 * its handler is known to write and what its author declared via
 * `outputs=`, deduplicated. Later tasks (the eager input check, DATA-001)
 * consume this and not the two halves separately.
 */
export function effectiveOutputs(node: Node): string[] {
  return [...new Set([...inferredOutputs(node), ...declaredOutputs(node)])]
}
