import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'

/**
 * The result of running one node through `Engine`'s own per-node machinery
 * (`private visitNode()`, `core/engine.ts`): eager-input-check, `runs_on`
 * handling, dispatch, the retry ladder, and every ledger update a node
 * visited on the main path already gets.
 *
 * FR-17b (`ParallelHandler`, `handlers/parallel.ts`) is the reason this type
 * exists at all -- see `plugins/attractor/.delivery/decisions/ADR-007-parallel-branch-execution-model.md`.
 */
export interface StepResult {
  node: Node
  outcome: Outcome
  /**
   * Where the run would go next: an edge-selected or retry-target node id,
   * or null on a dead end / unrouted FAIL. Reaching Handler.EXIT is reported
   * like any other node -- EXIT's own goal-gate handling stays in
   * Engine.run(), not here; a branch walk that reaches EXIT (a graph-
   * authoring error -- see ADR-007) is caught by the caller, not this type.
   */
  nextId: string | null
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
   * The git repository directory worktree operations should target.
   * Optional so every existing hand-built HandlerCtx test fixture
   * (box.test.ts, tool.test.ts, ...) keeps compiling and passing unchanged.
   * Engine.run() always populates it (opts.repoDir ?? opts.cwd) for a real
   * dispatch; only ParallelHandler reads it.
   */
  repoDir?: string
  /**
   * Run one node through Engine's OWN per-node machinery -- eager-input-
   * check, runs_on handling, dispatch, retry ladder, ledger updates -- using
   * the given `context` and `cwd` instead of the run's shared ones.
   * Populated only by Engine.run(); consumed only by ParallelHandler, which
   * calls it once per node in each branch's walk. Every other handler
   * ignores it. `checkpoint` is never called for these dispatches --
   * see ADR-007's "Checkpointing branches" section.
   */
  runBranchNode?: (nodeId: string, context: Context, cwd: string) => Promise<StepResult>
  /**
   * The most recently recorded TERMINAL Outcome status for a given node id,
   * across the whole run so far (main path or any branch). Populated by the
   * same two call sites that already maintain nodeFailures/failedOutputs
   * (recordOutcome, recordAbandoned), so it can never disagree with them.
   * Populated only by Engine.run(); consumed only by FanInHandler.
   */
  nodeStatus?: (nodeId: string) => Status | undefined
}

export interface Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}

/**
 * The single seam between the control plane and whatever executes an LLM
 * task. Plan 2 supplies a `claude -p` implementation; tests supply a stub.
 */
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal): Promise<Outcome>
}
