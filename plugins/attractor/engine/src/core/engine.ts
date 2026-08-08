import { lint, hasErrors, Severity } from '../dot/lint.ts'
import {
  type Graph,
  type HandlerKind,
  type Node,
  Handler as Kind,
  PASSTHROUGH_KINDS,
  RunsOn,
  type RunsOnMode,
  RUNS_ON_MODES,
  runsOn,
  declaredOutputs,
  substitutableText,
} from '../dot/graph.ts'
import { Context, isEngineManagedKey } from './context.ts'
import { referencedKeys } from './substitute.ts'
import { wantsVerdict } from '../backend/argv.ts'
import { Status, type Outcome } from './outcome.ts'
import { selectEdge } from './edge-select.ts'
import { resolveRetryPolicy, resolveRetryTarget, backoffMs } from './retry.ts'
import { saveCheckpoint, type Checkpoint } from './checkpoint.ts'
import { EventLog } from '../run/events.ts'
import { type Backend, type BranchRunOptions, type BranchRunResult, type Handler } from '../handlers/types.ts'
import { ToolHandler } from '../handlers/tool.ts'
import { BoxHandler } from '../handlers/box.ts'

export { PASSTHROUGH_KINDS, RunsOn, RUNS_ON_MODES, runsOn }
export type { RunsOnMode }

export interface EngineOptions {
  graph: Graph
  context: Context
  runDir: string
  cwd: string
  handlers: Map<HandlerKind, Handler>
  maxSteps?: number
  runId?: string
}

export interface RunResult {
  status: Status
  path: string[]
  notes?: string
  /**
   * Nodes whose work the run gave up on and never recovered, in first-failure
   * order. A node qualifies by ending FAIL, or by exhausting its retries and
   * being abandoned to a retry target, and is cleared only by a later
   * re-execution of that same node to SUCCESS or PARTIAL.
   *
   * The run result used to retain nothing about a failure that routing
   * carried past, so the only record was a `node.end` line in the event log
   * and every consumer above it -- the CLI's `status:` line, its exit code,
   * a caller embedding the Engine -- saw an unqualified success. Present
   * whenever the run holds one, whatever the run's own status, so a FAIL
   * that WAS recovered is distinguishable from one that was not by this
   * field being absent rather than by reading the log.
   */
  unresolvedFailures?: string[]
  /**
   * Spec section 5.2's `failure_reason`, lifted to the run. Set whenever the
   * run ends FAIL for a reason the engine can name; absent on a SUCCESS.
   *
   * `notes` is unchanged and remains the fuller human sentence -- this is the
   * bare cause, so a consumer no longer has to parse prose that a SUCCESS also
   * writes.
   */
  failureReason?: string
}

/** A no-op handler: start, exit and diamond nodes exist to shape routing. */
class PassthroughHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: Status.SUCCESS }
  }
}

export function defaultHandlers(backend: Backend): Map<HandlerKind, Handler> {
  const passthrough = new PassthroughHandler()
  return new Map<HandlerKind, Handler>([
    ...PASSTHROUGH_KINDS.map((kind) => [kind, passthrough] as [HandlerKind, Handler]),
    [Kind.TOOL, new ToolHandler()],
    [Kind.CODERGEN, new BoxHandler(backend)],
  ])
}

const DEFAULT_MAX_STEPS = 500

type StepResult =
  | { kind: 'continue'; nextId: string }
  | { kind: 'stop'; reason: 'exit' | 'frontier' | 'deadend' | 'stepcap'; nodeId: string; outcome: Outcome }

export class Engine {
  private opts: EngineOptions
  private events: EventLog
  private path: string[] = []
  private completed: string[] = []
  private attempts: Map<string, number> = new Map()
  /**
   * The LATEST outcome status of every goal gate the run has actually
   * visited, in first-visit order.
   *
   * Spec section 3.4: "Check all *visited* nodes that have `goal_gate=true`.
   * If any goal gate node has a non-success outcome (not SUCCESS or
   * PARTIAL_SUCCESS), the pipeline cannot exit." Two properties of that
   * sentence are load-bearing and were both missing:
   *
   * - *visited*. Iterating every declared node made a gate on a branch the
   *   run legitimately never took permanently unsatisfiable, so the exit
   *   bounced to its retry target until the step cap and then failed a run
   *   the spec exits successfully. A gate absent from this map was never
   *   reached and is not consulted.
   * - *latest*. This replaces a sticky satisfied-Set that was never cleared,
   *   under which a gate that passed on iteration 1 and failed on iteration 3
   *   still permitted exit -- a fail-OPEN divergence, and the exact shape of
   *   the false-success this plugin's fail-closed doctrine exists to stop.
   *
   * Nothing here weakens what counts as satisfaction: the set of statuses
   * that satisfy a gate (SUCCESS, PARTIAL) is unchanged, and BoxHandler's
   * fail-closed downgrade of an unearned verdict to RETRY is untouched.
   */
  private gateOutcomes: Map<string, Status> = new Map()

  /**
   * Nodes holding an UNRESOLVED failure: they ended FAIL and have not since
   * been re-executed to SUCCESS or PARTIAL.
   *
   * This exists because routing and honesty are two different questions, and
   * the whole-branch review found the engine answering only the first. Two
   * individually-correct corrections compose into a run that reaches the exit
   * and reports SUCCESS while a node's FAIL sits unrecovered in the log:
   *
   * - A vacuously-true `!=` guard. Spec section 10.3 makes a missing key the
   *   empty string, so `condition="context.build_error!=fatal"` is TRUE when
   *   nothing ever writes `build_error`. Section 3.3 step 1 returns a matched
   *   conditional edge immediately, before fail-fast is ever consulted -- so
   *   the failure is carried forward by an edge the author did write, and
   *   fail-fast is not violated, it simply never runs.
   * - A FAIL `retry_target` whose route reaches the exit without passing the
   *   goal gate. Section 3.4 scopes the gate check to *visited* nodes, so an
   *   unvisited gate is correctly not consulted, and the fallback route is
   *   exactly the failure route section 3.7 says to take.
   *
   * This ledger is a RECORD, not a verdict. Section 11.3 decides the run
   * verdict purely by goal gates, so both shapes above legitimately report
   * SUCCESS. What was missing was not a different status; it was that nothing
   * above the event log could see the failure at all.
   *
   * Both findings are settled now and neither settlement was verdict-level:
   * I1 is CLOSED by the eager input check, which stops the first shape at the
   * consuming node -- but only for keys some node DECLARED via `outputs=`, so
   * an undeclared graph still lands here. I2 is RECLASSIFIED, not closed: the
   * engine was always conformant and the hazard is a graph shape, now caught
   * by the GATE-001 lint rule. See docs/superpowers/spec-conformance.md. This is what `RunResult.unresolvedFailures`, the
   * `pipeline.unresolved_failure` event and the CLI's stderr warning are all
   * built from.
   *
   * "Unresolved" is re-execution-based, not first-occurrence-based, so a
   * legitimate repair loop leaves nothing behind: `build` fails, routes to
   * `fix`, `fix` repairs, `build` re-runs green and clears itself here. RETRY
   * and SKIPPED neither add nor clear -- only an actual SUCCESS or PARTIAL
   * re-execution resolves a failure. Without that, the record would name
   * every node that ever stumbled and be worth nothing.
   *
   * There are TWO ways a node's work is given up on, and an accurate record
   * has to see both. The obvious one is a FAIL outcome. The other is an
   * exhausted RETRY that has a retry target: `Engine.run` rewrites an
   * exhausted RETRY to FAIL only when there is NO target, so with one the
   * node never reaches a FAIL status here at all -- it is abandoned mid-retry
   * and the run jumps away. The spec's own model says that node failed:
   * section 3.5's `execute_with_retry` returns `Outcome(status=FAIL,
   * failure_reason="max retries exceeded")` on exhaustion unconditionally,
   * and section 3.7's retry-target jump happens AFTER that, as failure
   * routing. So recording it is faithful to the spec, not an extension of it;
   * omitting it made `unresolvedFailures` silently wrong for the most
   * reachable failure there is -- a backend crash, malformed output or budget
   * abort on a node with a node- or graph-level retry target.
   * `recordAbandoned` is that second entry point.
   *
   * A `Map<string, boolean>` rather than a `Set`, because the documented
   * contract is FIRST-failure order and a Set does not deliver it: deleting a
   * recovered node and re-inserting it on a later failure moves it to the end,
   * so `a` fails, `b` fails, `a` recovers, `a` fails again reported
   * `[b, a]`. `Map.set` on an existing key preserves its original position, so
   * flipping the flag instead of deleting the entry keeps the order the
   * comment promises -- and first-failure order is the useful one, because it
   * points at the earliest thing that went wrong rather than the latest.
   */
  private nodeFailures: Map<string, boolean> = new Map()

  /**
   * The context keys the run is now MISSING, and the id of the node that owed
   * each one: `key -> owing node id`.
   *
   * `nodeFailures` answers "which nodes did the run give up on". That is not
   * enough for finding I1, whose defect is about KEYS rather than nodes: a
   * successor cannot distinguish "my producer failed and this key is never
   * arriving" from "this key is legitimately empty", because section 10.3
   * resolves a missing key to the empty string and a `!=` guard on it is then
   * vacuously true. This ledger is the missing half. A later task turns it
   * into an eager input check that refuses to invoke a handler whose
   * referenced keys appear here.
   *
   * Populated on exactly the two events `nodeFailures` already treats as
   * giving up on a node, and deliberately through the same two call sites --
   * `recordOutcome` and `recordAbandoned` -- rather than a parallel mechanism
   * beside them, so the two records cannot drift into disagreeing about what
   * counts as a failure. Those two events are one event in the spec's model:
   * section 3.5's `execute_with_retry` returns `Outcome(status=FAIL,
   * failure_reason="max retries exceeded")` on exhaustion unconditionally, and
   * section 3.7's retry-target jump happens AFTER that, as failure routing. In
   * our loop the abandoned node never reaches a FAIL status at all, so a
   * ledger keyed on FAIL alone would be silently empty for the most reachable
   * failure there is -- a backend crash on a node with a retry target.
   *
   * The keys are `declaredOutputs(node)` -- what the node's author declared it
   * would produce via `outputs=`, and nothing else. Imported from
   * `dot/graph.ts`, never re-derived here: a second opinion about what a node
   * produces is exactly the drift that design exists to eliminate.
   *
   * DECLARED and not EFFECTIVE, since fix round 2. The inferred half made the
   * failure-reporting branch of every tool pipeline unreachable, because
   * `tool.last_line` is inferred for every tool node and the stale-label rule
   * exists precisely so that key survives a failure to be read. See
   * `recordFailedOutputs` for the full argument.
   *
   * Cleared per NODE, by re-execution: when a node later executes to SUCCESS
   * or PARTIAL, the entries it owns are dropped. Same rule as `nodeFailures`,
   * so a repair loop leaves both empty. Ownership is checked by value rather
   * than by recomputing the node's outputs, so if two nodes declare the same
   * key the recovery of the one that does NOT currently own the entry cannot
   * erase the other's debt.
   *
   * A RECORD, NOT ROUTING STATE, and this one is not a preference. Plan 3
   * demonstrated -- not theorised -- that engine state a condition can read is
   * forgeable by a model through `contextUpdates`: `{current_node: 'start'}`
   * took a `condition="context.current_node=start"` branch, which is why
   * `isEngineManagedKey` covers the engine's built-ins today. This ledger
   * could not be defended that way even in principle, because its keys come
   * from `outputs=` and therefore live in the AUTHOR's namespace, which the
   * guard deliberately does not reserve. So it stays out of `Context`
   * entirely: nothing here is ever written through `setManaged` or `set`, and
   * the only way out is `outputsOwedByFailedNodes`, which hands back a copy.
   */
  private failedOutputs: Map<string, string> = new Map()

  /**
   * Steps taken across the WHOLE run, main loop and every branch (p5-05)
   * alike -- one shared instance field, not a loop-local variable. Without
   * this, a branch containing a routing cycle that never reaches its stop
   * frontier has no bound of its own, and `max_parallel` branches each
   * independently capped at maxSteps would multiply the run-wide ceiling
   * NFR-1 exists to hold. Incremented once per `executeNodeStep` call,
   * whether that call continues to a new node or retries the same one.
   */
  private stepCount = 0

  constructor(opts: EngineOptions) {
    this.opts = opts
    this.events = new EventLog(opts.runDir)
  }

  private checkpoint(current: string | null): void {
    const cp: Checkpoint = {
      runId: this.opts.runId ?? 'run',
      currentNode: current,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: this.opts.context.snapshot(),
      // Derived, not stored: the checkpoint's section 5.3 wire field stays
      // exactly what Task 2 defined, while the engine's own state is now the
      // richer per-gate outcome map.
      goalGatesSatisfied: [...this.gateOutcomes]
        .filter(([, s]) => s === Status.SUCCESS || s === Status.PARTIAL)
        .map(([id]) => id),
    }
    saveCheckpoint(this.opts.runDir, cp)
  }

  private unsatisfiedGoalGates(): string[] {
    const gates: string[] = []
    for (const [id, status] of this.gateOutcomes) {
      if (status !== Status.SUCCESS && status !== Status.PARTIAL) gates.push(id)
    }
    return gates
  }

  /**
   * Where a run blocked at its exit by unsatisfied goal gates should jump.
   *
   * Spec section 3.4 step 3: "Instead, jump to the `retry_target` OF THE
   * UNSATISFIED GOAL GATE NODE. If that is not set, try
   * `fallback_retry_target`. If that is also not set, try the graph-level
   * `retry_target` and `fallback_retry_target`." That is exactly
   * `resolveRetryTarget`'s four-rung ladder -- applied to the GATE.
   *
   * This branch passed the EXIT node instead. Rungs 1 and 2 are the node's own
   * two attributes, so a gate's own repair loop could never fire; rungs 3 and 4
   * read `graph.attrs` whatever node they are handed, which is why the ladder
   * appeared to work at all and why the defect survived. The precedence was not
   * merely incomplete, it was INVERTED: a gate naming one target and a graph
   * naming another jumped to the graph's.
   *
   * WHICH GATE, when several are unsatisfied, IS NOT STATED BY THE SPEC, so
   * this is a recorded choice. Section 3.4's own `check_goal_gates` iterates
   * `node_outcomes` and RETURNS on the first gate it finds unsatisfied -- it
   * hands the caller one gate, the first in traversal order -- so taking the
   * FIRST-VISITED unsatisfied gate is the reading closest to the pseudocode.
   * It is also the useful one: it points at the earliest stage that failed to
   * converge rather than the last, which is the same ordering
   * `unresolvedFailures` already promises, and it is deterministic, which
   * "any unsatisfied gate" would not be.
   *
   * `unsatisfiedGoalGates()` derives from `gateOutcomes`, a Map in first-visit
   * order, so `unsatisfied[0]` IS that gate.
   *
   * The exit node's own `retry_target` is deliberately no longer consulted:
   * section 3.4's ladder does not contain it, and section 2.6 defines
   * `retry_target` as where to jump "if THIS NODE fails" -- a terminal node
   * does not fail. The graph-level rungs are unchanged, which is what keeps
   * every pipeline that relied on them working.
   */
  private gateRetryTarget(unsatisfied: string[]): string | null {
    const gate = this.opts.graph.nodes.get(unsatisfied[0])
    if (gate === undefined) return null
    return resolveRetryTarget(gate, this.opts.graph, { includeGraphLevel: true })
  }

  /** Nodes whose failure nothing has resolved, in first-failure order. */
  private unresolvedFailures(): string[] {
    const ids: string[] = []
    for (const [id, unresolved] of this.nodeFailures) if (unresolved) ids.push(id)
    return ids
  }

  /**
   * The context keys no node is going to produce any more, each mapped to the
   * node that owed it. A COPY, so a caller cannot edit the engine's record by
   * mutating what it reads -- the ledger is evidence about a run, and evidence
   * a reader can rewrite is not evidence.
   *
   * Public because the ledger is otherwise unobservable, and a test that
   * reached into the private field with a cast would be testing the field
   * rather than the behaviour: it would keep passing if the engine started
   * leaking these keys into `Context`, which is the one thing that must never
   * happen. Returning it here rather than on `RunResult` is deliberate too --
   * `RunResult` crosses into the CLI and the event log, and this is engine
   * state that later tasks consume in-process.
   */
  outputsOwedByFailedNodes(): Map<string, string> {
    return new Map(this.failedOutputs)
  }

  /**
   * The run gave up on this node, so every key it DECLARED it would produce is
   * now owed and never coming.
   *
   * `declaredOutputs` and NOT `effectiveOutputs`. This read `effectiveOutputs`
   * until fix round 2, and the inferred half of that union made the
   * failure-reporting branch of every tool pipeline unreachable:
   *
   *     build  [shape=parallelogram, tool_command="exit 1"]
   *     notify [shape=parallelogram, tool_command="printf 'said: ${tool.last_line}'"]
   *     build -> notify [condition="outcome=fail"]
   *
   * `tool.last_line` is inferred for EVERY tool node, so `build` failing
   * recorded it as owed, and the eager input check then refused `notify` --
   * the node whose entire job is to report the failure. No `outputs=` appears
   * anywhere in that graph, so no author opt-in was required to hit it, and
   * `notify` then re-recorded the key against ITSELF without ever executing,
   * poisoning it for everything downstream.
   *
   * The reason this is doctrine and not tuning: THE STALE-LABEL RULE EXISTS
   * PRECISELY SO THAT A FAILING TOOL NODE'S PREVIOUS `tool.last_line` SURVIVES
   * TO BE READ. That is the whole point of the rule and it is in the
   * non-tradeable list in AGENTS.md. A ledger marking the same key
   * "unavailable" contradicts it head on -- the two mechanisms were arguing,
   * and the doctrine wins. The old comment here had the argument exactly
   * backwards: it cited the stale-label rule as the REASON `tool.last_line` is
   * owed, when that rule is the reason the key is still worth reading.
   *
   * It also puts the ledger where the design always said it belonged.
   * `outputs=` is a node DECLARING A CONTRACT; inference exists so DATA-001 can
   * reason about what a graph supplies, and was never evidence that anyone
   * promised anything. A key nobody declared is not a debt anybody owes, so
   * the ledger has nothing to say about it and the eager check stays silent.
   *
   * The consequence an author should know: a box node infers nothing and now a
   * tool node contributes nothing either, so `outputs=` is the ONLY way a node
   * joins the dataflow contract. That is the design's own position, stated in
   * its open question 2, and DATA-001 is the design-time hint that says so.
   *
   * Re-recording an entry this node already owns is a no-op by construction,
   * which matters because `recordOutcome` runs twice per step.
   */
  private recordFailedOutputs(nodeId: string): void {
    const node = this.opts.graph.nodes.get(nodeId)
    if (node === undefined) return
    for (const key of declaredOutputs(node)) this.failedOutputs.set(key, nodeId)
  }

  /**
   * This node re-executed successfully, so it has settled its own debts.
   *
   * Deletes by OWNER, not by recomputing the node's output set: if two nodes
   * declare the same key, only the one currently recorded as owing it can
   * clear it. Recomputing would let a node that never owed the entry erase the
   * debt of the node that did.
   */
  private clearFailedOutputs(nodeId: string): void {
    for (const [key, owner] of this.failedOutputs) {
      if (owner === nodeId) this.failedOutputs.delete(key)
    }
  }

  /**
   * The EAGER INPUT CHECK: the first key this node references that a node the
   * run gave up on was contracted to produce, and the id of that node.
   *
   * This is finding I1's fix. A node fails; a later node's edge guards on a
   * key the failed node owed; section 10.3 resolves the missing key to the
   * empty string, so `context.artifact.path!=bad` is vacuously TRUE, section
   * 3.3 step 1 returns that matched conditional edge before fail-fast is ever
   * consulted, and the run walks into a node whose inputs do not exist.
   * Section 10.3 is correct and is untouched: the missing half was that a
   * successor could not tell "my producer failed and this key is never
   * arriving" from "this key is legitimately empty". `failedOutputs` is that
   * half, and this is what reads it.
   *
   * The reference set comes from `substitutableText` in `dot/graph.ts`, not
   * from a list of attribute names kept here, and the tokenizer is
   * `referencedKeys`, which walks `substitute`'s own pattern. Both are shared
   * with the DATA-001 lint rule on purpose: the design-time warning and the
   * runtime halt must agree about what counts as a reference, or a graph lints
   * clean and then dies on a key lint could have named.
   *
   * FIRST match, in the order the reference appears in the text, so the
   * message is deterministic when several inputs are missing at once. Naming
   * one key precisely is more use to an operator than naming a set.
   *
   * A key this node OWES ITSELF is skipped, and that exemption is
   * load-bearing rather than tidy. The node that would settle such a debt is
   * this one; blocking it on its own debt makes the debt permanently
   * unsettleable, so a node whose command mentions its own `outputs=` key
   * (`tool_command="make ${artifact.path}", outputs="artifact.path"`) could
   * never be retried after its first failure -- the repair loop that
   * `clearFailedOutputs` exists to support would deadlock instead.
   */
  private unavailableInput(node: Node): { key: string; owedBy: string } | undefined {
    for (const key of referencedKeys(substitutableText(node))) {
      const owedBy = this.failedOutputs.get(key)
      if (owedBy !== undefined && owedBy !== node.id) return { key, owedBy }
    }
    return undefined
  }

  /**
   * Is the run currently holding a failure nothing has recovered? This is what
   * `runs_on=failure` asks.
   *
   * TWO RECORDS EXIST AND THEY ANSWER DIFFERENT QUESTIONS. `failedOutputs` is
   * keyed by context KEY and answers "which inputs are missing, and who owed
   * them" -- a DATAFLOW question, and the eager input check's business.
   * `nodeFailures` is keyed by NODE and answers "which nodes did the run give
   * up on" -- a CONTROL-FLOW question. "Should this node run at all" is control
   * flow, so it reads the node record, through the same `unresolvedFailures()`
   * the run result and the CLI warning are built from rather than a second
   * scan of the same map.
   *
   * The design says a `runs_on=failure` node "runs only if one of its
   * REFERENCED producers failed", which would be the key-scoped reading. The
   * handlers were read instead of the design transcribed, and the key-scoped
   * reading does not survive contact with them:
   *
   * - A box node's inferred output set is deliberately EMPTY -- a model's
   *   `contextUpdates` keys are arbitrary and filtered, so there is nothing
   *   honest to infer. A failing box node with no `outputs=` therefore puts
   *   NOTHING in the ledger, and that is the single most common failure this
   *   engine has. A key-scoped `runs_on=failure` would silently never fire
   *   after it.
   * - It leaves a node with no references at all -- `notify [runs_on=failure,
   *   tool_command="send-alert"]`, which references nothing by nature --
   *   permanently dead code, decided by whether the author happened to write a
   *   `${}` anywhere. That is not predictable from reading the graph.
   *
   * So there is ONE rule with no cases: a `runs_on=failure` node runs when the
   * run is holding an unrecovered failure. A reader predicts it from the
   * attribute name alone, and the degenerate no-reference case is not
   * degenerate because references play no part in the decision.
   *
   * The cost is accepted deliberately: a `runs_on=failure` node fires for a
   * failure elsewhere in the run rather than only for one it consumes from. It
   * is the same "unresolved" the whole plugin already reports, cleared the same
   * way -- by re-executing the failed node to SUCCESS or PARTIAL -- so a repair
   * loop that fixed everything leaves this false, and a failure the author
   * routed around but never repaired leaves it true. That is the honest state
   * of the run at the moment the node is reached.
   */
  private holdsUnresolvedFailure(): boolean {
    return this.unresolvedFailures().length > 0
  }

  /**
   * The run gave up on this node without it ever reaching a FAIL status.
   *
   * Reached when a RETRY exhausts its policy and a retry target exists, which
   * is the engine abandoning the node's work and routing elsewhere. The
   * record must not depend on whether a fallback happened to be declared: an
   * identical run whose graph declares no `retry_target` is rewritten to FAIL
   * and recorded, and it would be incoherent for adding a fallback route to
   * erase the node from the record of what failed.
   *
   * Record-only. The node's `Outcome` is NOT rewritten to FAIL on this path,
   * even though section 3.5's pseudocode does rewrite it, because doing so
   * here would push `fail` into the routing-visible `context.outcome` before
   * the jump and could change which edge the target node takes. That is a
   * routing change and is out of scope; the divergence is recorded in
   * docs/superpowers/spec-conformance.md.
   */
  private recordAbandoned(nodeId: string): void {
    this.nodeFailures.set(nodeId, true)
    // The key-level half of the same event. Section 3.5 calls this exhaustion
    // a FAIL outcome, so the node's outputs are as absent here as on the FAIL
    // path -- and this is the ONLY place that can say so, because the
    // `continue` below this call site skips the rewrite-to-FAIL that
    // `recordOutcome` would otherwise see.
    this.recordFailedOutputs(nodeId)
  }

  /**
   * Build every terminal RunResult through one place, so the unresolved-FAIL
   * record cannot be attached to some exit paths and forgotten on others --
   * which is how the record would quietly become "present when we remembered"
   * instead of "present when the run holds one".
   */
  private result(status: Status, notes?: string, failureReason?: string): RunResult {
    const result: RunResult = { status, path: this.path }
    if (notes !== undefined) result.notes = notes
    // Section 5.2 scopes `failure_reason` to "when status is FAIL or RETRY",
    // so a SUCCESS never carries one even if a caller passed one in.
    if (failureReason !== undefined && status === Status.FAIL) {
      result.failureReason = failureReason
    }
    const unresolved = this.unresolvedFailures()
    if (unresolved.length > 0) result.unresolvedFailures = unresolved
    return result
  }

  /**
   * Spec section 3.2 step 4 and section 5.1's built-in keys.
   *
   * `outcome` is set unconditionally; `preferred_label` only when non-empty,
   * which is the spec's own wording ("IF outcome.preferred_label is not
   * empty") and means the last non-empty label survives a node that offered
   * none. Note that a *bare* `outcome`/`preferred_label` in a condition is
   * answered from the live Outcome object by condition.ts, not from here;
   * these keys are what makes the `context.`-qualified spelling resolve.
   *
   * Called both immediately after a handler returns and again after the retry
   * machine has had its say, because an exhausted RETRY is rewritten to FAIL
   * before edge selection -- recording only the first would leave
   * `context.outcome` saying "retry" while the edge being selected sees
   * "fail".
   */
  private recordOutcome(nodeId: string, outcome: Outcome, context: Context): void {
    const node = this.opts.graph.nodes.get(nodeId)
    // `wantsVerdict`, not a second hand-kept `attrs.goal_gate === 'true'`.
    // That predicate was extracted into one place for exactly this reason,
    // and a restated copy here is how the argv layer, the box handler and
    // the engine would eventually disagree about what a goal gate is.
    if (node !== undefined && wantsVerdict(node)) {
      this.gateOutcomes.set(nodeId, outcome.status)
    }
    // The unresolved-FAIL ledger. Safe to run on both of this method's two
    // calls per step: adding a node already present is a no-op, and the
    // statuses that clear are the same either way.
    // The failed-output ledger rides the SAME two branches, rather than being
    // maintained somewhere else against its own idea of what a failure is.
    if (outcome.status === Status.FAIL) {
      this.nodeFailures.set(nodeId, true)
      this.recordFailedOutputs(nodeId)
    } else if (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) {
      // set(id, false), never delete(id): a Map keeps an existing key's
      // position when its value is replaced, which is what preserves
      // first-failure order across a recover-then-fail-again cycle.
      if (this.nodeFailures.has(nodeId)) this.nodeFailures.set(nodeId, false)
      // The ledger DOES delete, because it carries no ordering contract --
      // it is a lookup keyed by context key, and a settled debt is simply
      // gone. RETRY and SKIPPED neither add nor clear, in both records.
      this.clearFailedOutputs(nodeId)
    }
    this.setManaged(context, 'outcome', outcome.status)
    if (outcome.preferredLabel !== undefined && outcome.preferredLabel !== '') {
      this.setManaged(context, 'preferred_label', outcome.preferredLabel)
    }
  }

  /**
   * Write a built-in context key, refusing any key the model-facing guard in
   * `handlers/box.ts` would not already reject.
   *
   * This is the mechanism that keeps the two ends of `isEngineManagedKey`
   * honest. Making a key routing-visible without reserving it is precisely
   * how this task's own correction opened forgeable routing surface; adding
   * the next built-in without registering it would do the same silently. A
   * throw rather than an event because this can only fire on a developer
   * mistake, never on run data -- a loud abort is right for the one case
   * where the control plane has caught itself, and any test touching the new
   * key will surface it immediately.
   */
  private setManaged(context: Context, key: string, value: string): void {
    if (!isEngineManagedKey(key)) {
      throw new Error(
        `engine built-in context key ${key} is not covered by isEngineManagedKey; ` +
          'register it there so a backend cannot forge it',
      )
    }
    context.set(key, value)
  }

  /**
   * Runs exactly one node's step: dispatch (eager-input-check, `runs_on`
   * skip logic, handler call or skip, the RETRY ladder with its two
   * `recordOutcome` calls), then a per-node checkpoint via the exported
   * `saveCheckpoint` directly -- never the private `this.checkpoint()`
   * wrapper, which after this refactor is called only by `run()`'s own
   * EXIT/dead-end/step-cap terminal paths (ADR-012). The ONE seam both
   * `run()`'s own loop and `runBranch` (p5-05) call.
   *
   * Node lookup, the `current_node` context write, and handler lookup all
   * live HERE rather than in a caller's wrapper -- see this task's own
   * Step 2: an existing test requires `RunResult.path` to already contain a
   * node by the moment its handler-lookup failure is reported. `path.push`
   * itself does NOT live here (p5-05 addendum): once runBranch (p5-05)
   * became a second caller of this same method, an unconditional
   * `this.path.push` here would leak every branch-internal node id into the
   * outer run's own `this.path` -- the SAME shared, instance-level array
   * `RunResult.path` reads directly. Each caller instead pushes to its OWN
   * path variable immediately before calling this method: `run()`'s loop
   * pushes to `this.path` (below); `runBranch`'s loop pushes to its own
   * local `path` array. The pre-dispatch-failure invariant above still
   * holds either way, since the push now happens in the caller, strictly
   * before this method can return any `'stop'` result for that node.
   * Folded into the `'deadend'` stop reason alongside the ordinary
   * "no outgoing edge" case, since from a caller's point of view all three
   * are "this step produced no next node to continue to"; the one accepted,
   * documented behavioural delta is that `run()`'s uniform handling of
   * `'deadend'` always calls `this.checkpoint(null)`, where today's
   * unknown-node/no-handler-registered paths did not -- an extra, harmless
   * checkpoint write on an already-terminal FAIL that no existing test
   * observes.
   */
  private async executeNodeStep(
    currentId: string,
    opts: { runDir: string; cwd: string; maxSteps: number; stopAt?: ReadonlySet<string>; context: Context },
  ): Promise<StepResult> {
    const { graph } = this.opts
    const context = opts.context

    // Checked FIRST, before ANY work for this node -- matches today's
    // `for (let step = 0; step < maxSteps; step++)` loop condition, which
    // skipped the whole iteration body (no path push, no dispatch, nothing)
    // the instant the cap was reached.
    if (++this.stepCount > opts.maxSteps) {
      const capped = `step cap of ${opts.maxSteps} reached without terminating`
      return {
        kind: 'stop',
        reason: 'stepcap',
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: capped, failureReason: capped },
      }
    }

    const node = graph.nodes.get(currentId)
    if (!node) {
      const msg = `unknown node ${currentId}`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg },
      }
    }

    this.setManaged(context, 'current_node', node.id)

    const handler = this.opts.handlers.get(node.handler)
    if (!handler) {
      const msg = `no handler registered for ${node.handler} (node ${node.id})`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: node.id,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg },
      }
    }

    const attempt = this.attempts.get(node.id) ?? 0
    // Reserved SYNCHRONOUSLY, before the handler dispatch's own await below --
    // NOT deferred to the post-await write the RETRY branch used to do. Two
    // concurrent branches (Promise.all/allSettled) dispatching the SAME node id
    // both used to read this identical value here, then both write the identical
    // attempt+1 after their own await resolved, silently losing one increment.
    // A read immediately followed by a write, with no await between them, is
    // atomic under JS's single-threaded run-to-completion semantics -- whichever
    // call's synchronous prefix runs first reserves the correct count before
    // yielding, so the next concurrent call's own read (in ITS synchronous
    // prefix) always sees the up-to-date value. If this dispatch turns out not
    // to need it (no RETRY, or retries exhausted), the unconditional resets
    // below (`this.attempts.set(node.id, 0)`) overwrite it harmlessly either way.
    this.attempts.set(node.id, attempt + 1)
    this.events.append({ type: 'node.start', node: node.id })
    context.takeWritten()
    let outcome: Outcome
    const mode = runsOn(node)
    const checksInputs = mode === RunsOn.SUCCESS || wantsVerdict(node)
    const unavailable = checksInputs ? this.unavailableInput(node) : undefined
    if (unavailable) {
      this.events.append({
        type: 'node.input_unavailable',
        node: node.id,
        key: unavailable.key,
        owedBy: unavailable.owedBy,
      })
      outcome = {
        status: Status.FAIL,
        notes: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
        failureReason: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
      }
    } else if (mode === RunsOn.FAILURE && !wantsVerdict(node) && !this.holdsUnresolvedFailure()) {
      this.events.append({ type: 'node.runs_on.skipped', node: node.id, runsOn: mode })
      outcome = {
        status: Status.SUCCESS,
        notes: `${node.id} did not run: runs_on=failure and no failure is outstanding`,
      }
    } else {
      try {
        outcome = await handler.execute({
          node,
          graph,
          context,
          runDir: opts.runDir,
          cwd: opts.cwd,
          events: this.events,
          runBranch: (o: BranchRunOptions) => this.runBranch(o),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.events.append({ type: 'node.error', node: node.id, message })
        outcome = { status: Status.FAIL, notes: message, failureReason: message }
      }
    }

    for (const key of context.takeWritten()) this.failedOutputs.delete(key)
    this.events.append({ type: 'node.end', node: node.id, status: outcome.status })
    this.recordOutcome(node.id, outcome, context)

    if (outcome.status === Status.RETRY) {
      const policy = resolveRetryPolicy(node, graph)
      if (attempt < policy.maxRetries) {
        const delay = backoffMs(policy, attempt)
        this.events.append({
          type: 'node.retry',
          node: node.id,
          attempt: attempt + 1,
          delayMs: delay,
        })
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        return { kind: 'continue', nextId: node.id }
      }
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      this.events.append({ type: 'node.retry.exhausted', node: node.id, target })
      if (target) {
        this.recordAbandoned(node.id)
        this.attempts.set(node.id, 0)
        return { kind: 'continue', nextId: target }
      }
      outcome = {
        ...outcome,
        status: Status.FAIL,
        notes: `retries exhausted for ${node.id} with no retry target`,
        failureReason: 'max retries exceeded',
      }
    }

    this.recordOutcome(node.id, outcome, context)
    this.attempts.set(node.id, 0)
    if (!this.completed.includes(node.id)) this.completed.push(node.id)

    const cp: Checkpoint = {
      runId: this.opts.runId ?? 'run',
      currentNode: node.id,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: context.snapshot(),
      goalGatesSatisfied: [...this.gateOutcomes]
        .filter(([, s]) => s === Status.SUCCESS || s === Status.PARTIAL)
        .map(([id]) => id),
    }
    saveCheckpoint(opts.runDir, cp)

    if (node.handler === Kind.EXIT) {
      return { kind: 'stop', reason: 'exit', nodeId: node.id, outcome }
    }

    const edge = selectEdge(graph, node.id, context, outcome)

    if (!edge && outcome.status === Status.FAIL) {
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      if (target) {
        this.events.append({ type: 'node.fail.retry_target', node: node.id, target })
        return { kind: 'continue', nextId: target }
      }
    }

    if (!edge) {
      const notes =
        outcome.status === Status.FAIL
          ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ''}`
          : `run terminated at ${node.id}, which has no outgoing edges and is not the exit`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: node.id,
        // status is forced to FAIL here (even when the dispatch's own
        // outcome was SUCCESS/PARTIAL with simply no matching edge) --
        // run()'s own interpretation of 'deadend' never reads
        // outcome.status (it hardcodes Status.FAIL onto its own RunResult
        // regardless), so this is inert for run(); it matters for
        // runBranch (Task 5), whose BranchRunResult.outcome is this object
        // verbatim and whose own contract requires status === FAIL for a
        // true dead end unconditionally.
        outcome: { ...outcome, status: Status.FAIL, notes, failureReason: outcome.failureReason ?? notes },
      }
    }

    if (opts.stopAt?.has(edge.to)) {
      return { kind: 'stop', reason: 'frontier', nodeId: node.id, outcome }
    }

    this.events.append({ type: 'edge.taken', node: node.id, to: edge.to })
    return { kind: 'continue', nextId: edge.to }
  }

  /**
   * A bounded forward traversal of the SAME graph, starting at
   * opts.startNodeId, using the exact per-node step logic executeNodeStep
   * (Task 2) already implements -- against this Engine's own shared
   * gateOutcomes/nodeFailures/failedOutputs/stepCount ledgers. REJECTED: one
   * independent `new Engine(...)` per branch -- a fresh instance would own
   * its own empty ledgers, so a goal gate inside a branch would satisfy or
   * fail a map nothing outside that branch's own instance ever reads,
   * silently reopening the fail-open hole those ledgers exist to close
   * (ADR-009).
   *
   * Treats EVERY stop reason -- 'exit', 'frontier', 'deadend', 'stepcap' --
   * identically: stop looping and return whatever outcome/path the branch
   * ended with. In particular, dispatching the graph's real EXIT node is an
   * ORDINARY DEAD END for this branch alone (ADR-007's amendment): this
   * method never calls unsatisfiedGoalGates(), never calls
   * this.checkpoint(null), and never returns an Engine.RunResult -- that
   * logic lives EXCLUSIVELY in run()'s own interpretation of a
   * `{ kind: 'stop', reason: 'exit' }` result, a branch this uniform
   * handling structurally cannot reach.
   */
  private async runBranch(opts: BranchRunOptions): Promise<BranchRunResult> {
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS
    const path: string[] = []
    let currentId = opts.startNodeId
    for (;;) {
      path.push(currentId)
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: opts.runDir,
        cwd: opts.cwd,
        maxSteps,
        stopAt: opts.stopAt,
        context: opts.context,
      })
      if (stepResult.kind === 'continue') {
        currentId = stepResult.nextId
        continue
      }
      return { outcome: stepResult.outcome, path }
    }
  }

  async run(): Promise<RunResult> {
    const { graph, context } = this.opts
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS

    const diagnostics = lint(graph)
    if (hasErrors(diagnostics)) {
      const detail = diagnostics
        .filter((d) => d.severity === Severity.ERROR)
        .map((d) => `${d.code}${d.node ? ` (${d.node})` : ''}: ${d.message}`)
        .join('; ')
      const msg = `graph carries error-severity lint diagnostics and will not run: ${detail}`
      this.events.append({ type: 'pipeline.end', status: Status.FAIL })
      return this.result(Status.FAIL, msg, msg)
    }

    const startNode = [...graph.nodes.values()].find((n) => n.handler === Kind.START)
    if (!startNode) {
      this.events.append({ type: 'pipeline.end', status: Status.FAIL })
      return this.result(Status.FAIL, 'graph has no start node', 'graph has no start node')
    }

    for (const [k, v] of Object.entries(graph.attrs)) {
      if (!context.has(k)) context.set(k, v)
      const qualified = `graph.${k}`
      if (!context.has(qualified)) this.setManaged(context, qualified, v)
    }

    let currentId: string | null = startNode.id
    this.events.append({ type: 'pipeline.start', node: startNode.id })

    while (currentId !== null) {
      this.path.push(currentId)
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: this.opts.runDir,
        cwd: this.opts.cwd,
        maxSteps,
        stopAt: undefined,
        context,
      })

      if (stepResult.kind === 'continue') {
        currentId = stepResult.nextId
        continue
      }

      // 'stop'. 'frontier' never occurs here: run() never supplies stopAt,
      // so executeNodeStep can never produce it for this caller -- the same
      // "additive, inert for every current call site" pattern ADR-008/
      // ADR-009 established elsewhere in this codebase.
      const { reason, nodeId, outcome } = stepResult

      if (reason === 'exit') {
        const unsatisfied = this.unsatisfiedGoalGates()
        if (unsatisfied.length > 0) {
          const target = this.gateRetryTarget(unsatisfied)
          this.events.append({
            type: 'pipeline.goal_gate_block',
            node: nodeId,
            unsatisfied,
            target,
          })
          if (target) {
            currentId = target
            continue
          }
          this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.FAIL })
          this.checkpoint(null)
          return this.result(
            Status.FAIL,
            `exit reached with unsatisfied goal gates: ${unsatisfied.join(', ')}`,
            'Goal gate unsatisfied and no retry target',
          )
        }

        const failed = this.unresolvedFailures()
        if (failed.length > 0) {
          this.events.append({ type: 'pipeline.unresolved_failure', node: nodeId, failed })
        }

        this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.SUCCESS })
        this.checkpoint(null)
        return this.result(
          Status.SUCCESS,
          failed.length > 0
            ? `exit reached with unresolved node failures: ${failed.join(', ')}`
            : outcome.notes,
        )
      }

      // 'deadend' and 'stepcap' both carry a fully-formatted
      // outcome.notes/failureReason from executeNodeStep -- 'deadend'
      // pre-formats the exact text the old inline `!edge` block built
      // locally (including the two pre-dispatch pathological cases); the
      // checkpoint argument is the one place the two still differ, matching
      // engine.ts's own pre-refactor behaviour exactly (a step-cap
      // checkpoint names the not-yet-dispatched node; a dead-end checkpoints
      // null).
      this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.FAIL })
      this.checkpoint(reason === 'stepcap' ? nodeId : null)
      return this.result(Status.FAIL, outcome.notes, outcome.failureReason)
    }

    // currentId === null: dead code today (nothing in this method ever
    // assigns it), kept only because the type allows it and a defensive
    // guard costs nothing.
    return this.result(
      Status.FAIL,
      'run terminated with no current node',
      'run terminated with no current node',
    )
  }
}
