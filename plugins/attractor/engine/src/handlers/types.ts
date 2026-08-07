import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'

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
}

export interface Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}

/**
 * The single seam between the control plane and whatever executes an LLM
 * task. Plan 2 supplies a `claude -p` implementation; tests supply a stub.
 */
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal,
      cwd?: string): Promise<Outcome>
}
