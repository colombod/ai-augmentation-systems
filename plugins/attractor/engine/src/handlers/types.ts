import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'

/**
 * A bounded forward traversal of the same graph a handler's dispatch is
 * itself part of, starting at `startNodeId`, stopping at `stopAt`, the
 * graph's real EXIT node, or a dead end -- populated by `Engine.run()` on
 * every dispatch, via `HandlerCtx.runBranch` below. Runs against the same
 * Engine instance's own shared ledgers (`gateOutcomes`/`nodeFailures`/
 * `failedOutputs`/the step-cap counter), never an independent nested
 * `Engine` -- see `core/engine.ts`'s private `runBranch` method for why.
 */
export interface BranchRunOptions {
  startNodeId: string
  /** The branch halts BEFORE dispatching any node in this set. */
  stopAt: ReadonlySet<string>
  /** Caller-supplied, already `Context.clone()`'d -- isolates this branch's writes. */
  context: Context
  /** Branch-scoped subdir -- own checkpoint.json and per-node artifacts. */
  runDir: string
  /** Branch worktree path, or the component node's own cwd. */
  cwd: string
}

export interface BranchRunResult {
  outcome: Outcome
  path: string[]
  /** Context.snapshot() taken from the branch's own (cloned) context at the moment it stopped. */
  context: Record<string, string>
}

export interface HandlerCtx {
  node: Node
  graph: Graph
  context: Context
  /** Directory holding this run's checkpoint, events and per-node artifacts. */
  runDir: string
  /** Working directory for shell commands and LLM workers. */
  cwd: string
  events: EventLog
  /**
   * Cancellation for whatever a handler dispatches. Unused today; the seam
   * exists so Plan 2's subprocess backend does not require touching this
   * interface, every handler and every test a second time to add it later.
   */
  signal?: AbortSignal
  /**
   * Run a bounded sub-traversal of the same graph, starting at any node id,
   * against this run's own shared ledgers. Engine-populated on every
   * dispatch; undefined only for a hand-built `HandlerCtx` a test constructs
   * without going through `Engine.run()`.
   */
  runBranch?: (opts: BranchRunOptions) => Promise<BranchRunResult>
}

export interface Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}

/**
 * The single seam between the control plane and whatever executes an LLM
 * task. Plan 2 supplies a `claude -p` implementation; tests supply a stub.
 */
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal, cwd?: string): Promise<Outcome>
}
