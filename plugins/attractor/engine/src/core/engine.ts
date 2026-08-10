import { lint, hasErrors, Severity, type Diagnostic } from '../dot/lint.ts'
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
import { type Backend, type Handler } from '../handlers/types.ts'
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
  /**
   * WARNING-severity lint diagnostics `run()` already computes internally
   * (the same `lint(graph)` call `hasErrors()` checks to decide whether to
   * refuse the run) but, before this field existed, threw away once that
   * check passed.
   *
   * FR-12 / Open Question 7 (`colombod/ai-augmentation-systems#16`): a
   * direct `new Engine(...)` embed had no way to observe a WARNING-severity
   * rule like `HITL-003` at all -- `Engine` writes nothing to stdout/stderr
   * (that stays true; this field adds no I/O), and only the CLI's own
   * `reportDiagnostics` called `lint()` a second time to print warnings a
   * human could read. An embedder not already calling `lint(graph)`
   * independently -- which nothing forces it to know to do -- got silent
   * parity with an unattended run, not with the CLI's own attended one.
   *
   * Present only when the run's graph carries at least one WARNING,
   * matching `unresolvedFailures`' own absent-when-empty convention.
   * ERROR-severity diagnostics are deliberately excluded: those already
   * have a channel (`hasErrors()` refuses the run and `failureReason` names
   * them), and duplicating them here would be two representations of the
   * same fact drifting apart, the exact failure mode `AGENTS.md`'s shared
   * `condition.ts` grammar comments warn against for a different pair of
   * functions.
   */
  lintWarnings?: Diagnostic[]
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
   * WARNING-severity diagnostics from `run()`'s own `lint(graph)` call, set
   * once at the top of `run()` and read by every `result()` call site
   * (`RunResult.lintWarnings`, FR-12 / issue #16). A plain field rather than
   * re-deriving it inside `result()` itself, because `result()` has no
   * access to the graph's diagnostics beyond what `run()` already computed
   * once -- re-linting there would be a second, redundant `lint()` call for
   * data already in hand.
   */
  private lintWarnings: Diagnostic[] = []

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
    if (this.lintWarnings.length > 0) result.lintWarnings = this.lintWarnings
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
  private recordOutcome(nodeId: string, outcome: Outcome): void {
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
    this.setManaged('outcome', outcome.status)
    if (outcome.preferredLabel !== undefined && outcome.preferredLabel !== '') {
      this.setManaged('preferred_label', outcome.preferredLabel)
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
  private setManaged(key: string, value: string): void {
    if (!isEngineManagedKey(key)) {
      throw new Error(
        `engine built-in context key ${key} is not covered by isEngineManagedKey; ` +
          'register it there so a backend cannot forge it',
      )
    }
    this.opts.context.set(key, value)
  }

  async run(): Promise<RunResult> {
    const { graph, context } = this.opts
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS

    const diagnostics = lint(graph)
    this.lintWarnings = diagnostics.filter((d) => d.severity === Severity.WARNING)
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

    // Seed context with graph-level values so $goal expands everywhere.
    //
    // Both spellings, deliberately. Section 5.1 names the built-in key
    // `graph.goal`, so `condition="context.graph.goal=..."` must resolve; the
    // bare name is what `$goal` substitution and every pipeline written
    // against this engine already read, and it is a documented superset we do
    // not retreat from. Mirroring ADDS a name, it does not move one. Neither
    // spelling overwrites a value the caller passed in as a run parameter.
    for (const [k, v] of Object.entries(graph.attrs)) {
      if (!context.has(k)) context.set(k, v)
      const qualified = `graph.${k}`
      if (!context.has(qualified)) this.setManaged(qualified, v)
    }

    let currentId: string | null = startNode.id
    this.events.append({ type: 'pipeline.start', node: startNode.id })

    for (let step = 0; step < maxSteps; step++) {
      if (currentId === null) break
      const node = graph.nodes.get(currentId)
      if (!node) {
        this.events.append({ type: 'pipeline.end', node: currentId, status: Status.FAIL })
        return this.result(Status.FAIL, `unknown node ${currentId}`, `unknown node ${currentId}`)
      }

      this.path.push(node.id)
      // Section 5.1: `current_node` is the id of the currently executing
      // node. This is the CONTEXT key, and it is a different thing from the
      // checkpoint's `current_node` FIELD, which section 5.3 defines as the
      // last COMPLETED node. Both spellings are correct at the moment the
      // checkpoint is now written -- step 5, after this node has completed --
      // because the context key still names the node that just finished and
      // has not yet been advanced.
      this.setManaged('current_node', node.id)

      const handler = this.opts.handlers.get(node.handler)
      if (!handler) {
        this.events.append({ type: 'pipeline.end', node: node.id, status: Status.FAIL })
        const noHandler = `no handler registered for ${node.handler} (node ${node.id})`
        return this.result(Status.FAIL, noHandler, noHandler)
      }

      const attempt = this.attempts.get(node.id) ?? 0
      // The generic node lifecycle lives here, not in individual handlers, so
      // every node -- including PassthroughHandler ones (start, exit,
      // diamond) that emit no detail events of their own -- leaves a
      // node.start/node.end pair in the log. Handler-specific events such as
      // node.box.end remain supplementary detail, not the record itself.
      this.events.append({ type: 'node.start', node: node.id })
      // Drain the write record so what comes back after the dispatch is THIS
      // node's writes and nothing else. What is discarded here is the engine's
      // own bookkeeping -- `current_node` just above, and the graph-attribute
      // mirroring on the first iteration -- which is not a node producing an
      // output and must not settle anyone's debt.
      context.takeWritten()
      let outcome: Outcome
      // The eager input check, BEFORE dispatch. A node whose declared input a
      // failed node owed cannot do its work, so it does not get to try: no
      // subprocess, no model call, no side effects on the operator's tree.
      //
      // FAIL and not SKIPPED. Section 5.2 defines SKIPPED as "Proceed without
      // recording an outcome", which cannot also mean "stop", so amplifier's
      // R12 M3 SKIPPED-propagation is a contradiction we do not port. FAIL is
      // both honest -- the node cannot do its work, for a precise and
      // reportable reason -- and spec-defined, so it routes through section
      // 3.7's ladder unchanged and the fail-fast doctrine is what actually
      // halts the run. No new status, no new routing rule.
      //
      // The node is still VISITED: it is on the path, it is checkpointed, it
      // gets an outcome and it routes. That is what keeps section 3.4's
      // visited-scoped goal-gate check applicable to it, so a goal gate
      // blocked this way blocks the exit instead of quietly not counting.
      //
      // `recordOutcome` below then puts this node's OWN DECLARED outputs into
      // the ledger, keyed to itself, which is what makes the propagation
      // transitive: the next node referencing what this one was contracted to
      // produce is blocked by the same check, one hop further on.
      //
      // A blocked node DOES still re-record, and that survived fix round 2 on
      // purpose. The objection was that a node which never executed recorded a
      // debt -- but for a DECLARED key that is exactly right: the author said
      // this node produces that key, and it did not, whether it declined to run
      // or ran and failed. A successor cannot tell the difference and should
      // not have to. What was wrong was re-recording INFERRED keys, which put
      // `tool.last_line` in the ledger against a node that never ran and
      // poisoned it downstream; with inference gone, a node that declares
      // nothing now records nothing here.
      // Only the DISPATCH is skipped. Everything after this block -- the
      // node.end event, both `recordOutcome` calls, the retry machine (a FAIL
      // is not a RETRY, so it passes straight through), edge selection and
      // section 3.7's ladder -- runs exactly as it does for any other FAIL. A
      // separate routing tail for this case would be a second copy of the
      // failure ladder, and the two would eventually disagree.
      //
      // `runs_on` gates this check rather than sitting beside it. The check IS
      // the `success` contract -- "my inputs must be there" -- so an ordinary
      // cleanup or failure-handler node is not asking for it, and its
      // unresolved references stay literal, exactly as an unknown key's do.
      //
      // A GOAL GATE IS CHECKED WHATEVER ITS `runs_on` SAYS, and that exemption
      // is not symmetry-breaking tidiness -- it is the fail-closed doctrine.
      // Task 5 stopped `runs_on` from SKIPPING a gate; the whole-branch review
      // then showed the same attribute switching off the EAGER CHECK on one, and
      // demonstrated the consequence on identical A/B graphs. Without `runs_on`:
      // the gate is blocked, the run halts, `status: fail`. With
      // `runs_on="failure"`: the check was skipped, the owed `${artifact.path}`
      // blanked, the gate printed `verified ` and returned SUCCESS, SATISFIED
      // ITSELF, and the run reached `done` at exit 0. A gate earning its verdict
      // against an input the engine itself recorded as unavailable is precisely
      // the unearned false-success the doctrine exists to prevent -- the entry
      // in plugins/attractor/AGENTS.md cites a real run that claimed victory
      // with zero work product. A gate is a claim about evidence, so it is never
      // earned on inputs known to be missing, and `runs_on` gets no vote.
      //
      // Consequence, stated so nobody reads it as a bug later: `runs_on` is now
      // wholly INERT on a goal gate -- it cannot skip one and it cannot relax
      // one. RUNS-002 in `dot/lint.ts` is what says so at design time.
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
          // Section 3.5's `failure_reason` is carried by `notes` throughout
          // this engine -- see the retry-exhaustion rewrite below, which
          // writes that same spec field here. The reason therefore lands
          // where every existing consumer already reads it (the terminal
          // `notes` string, the CLI's message, the event log) instead of in a
          // second field only this path writes.
          notes: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
          // Section 5.2's field, now that it exists. The comment above
          // described `notes` as carrying section 3.5's `failure_reason`
          // "throughout this engine" because there was nowhere else to put
          // it; both are written now, so a consumer no longer has to parse
          // the sentence a SUCCESS also writes to.
          failureReason: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
        }
      } else if (mode === RunsOn.FAILURE && !wantsVerdict(node) && !this.holdsUnresolvedFailure()) {
        // A failure handler on a healthy run. The dispatch is skipped and
        // NOTHING ELSE is: the node is on the path, it is checkpointed, it gets
        // an outcome and it routes, exactly as the blocked-input case above.
        //
        // SUCCESS, and not SKIPPED. Section 5.2 defines SKIPPED as "Proceed
        // without recording an outcome", so it cannot be the status of a node
        // that must then route; the same reading that made the eager check
        // return FAIL rather than port amplifier's M3. This node did not fail
        // -- there was simply nothing for it to do -- so SUCCESS is the honest
        // remaining status, and the event below is what distinguishes "ran and
        // succeeded" from "did not run" for anyone reading the log.
        //
        // A GOAL GATE IS NEVER SKIPPED, which is why `wantsVerdict` is in the
        // condition. Skipping one would put a SUCCESS in `gateOutcomes` for a
        // node that produced no evidence at all, and a gate satisfied by not
        // running is precisely the unearned false-success the fail-closed
        // doctrine exists to stop -- a new bypass, opened by a node attribute,
        // for the guard that cost this project a 2.4-hour run reporting
        // victory with no work product. The combination is an authorial
        // contradiction ("this gate only runs when things are broken"), and the
        // engine resolves it in the FAIL-CLOSED direction: the gate runs and has
        // to earn its verdict, exactly as it does without `runs_on`. RUNS-002 in
        // `dot/lint.ts` is what names it out loud at design time.
        //
        // THIS LINE IS HALF OF THAT RESOLUTION, NOT ALL OF IT, and the earlier
        // comment here claimed otherwise -- "this line is what makes the
        // combination safe rather than dangerous". It was not: `runs_on` also
        // switched off the eager input check above, so a gate could still earn a
        // verdict against an input the engine had recorded as unavailable. The
        // other half now lives in `checksInputs`. WARNING remains the right
        // severity for RUNS-002, but it rests on both halves being present.
        //
        // `recordOutcome` also treats this SUCCESS as a re-execution and would
        // clear this node's own debts. Unreachable by construction: a node
        // holding an unresolved failure of its own makes
        // `holdsUnresolvedFailure()` true, so it takes the dispatch branch.
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
            runDir: this.opts.runDir,
            cwd: this.opts.cwd,
            events: this.events,
          })
        } catch (err) {
          // Section 4.12, handler contract: "Handler panics/exceptions MUST be
          // caught by the engine and converted to FAIL outcomes." Section 3.5's
          // CATCH block says the same thing in code: "ELSE: RETURN
          // Outcome(status=FAIL, failure_reason=str(exception))".
          //
          // Catching at all is still the first requirement, and unchanged: an
          // uncaught throw rejects Engine.run() outright, skipping the terminal
          // event, the final checkpoint and everything below.
          //
          // WHAT CHANGED is the status. This produced RETRY, which cost two
          // things. The exception text was overwritten by "retries exhausted
          // for <node> with no retry target" and survived only in
          // events.jsonl, so an operator reading the run result learned nothing
          // about what actually broke. And a node with retries re-ran a handler
          // that had already thrown, once per retry, with a backoff between --
          // pure latency for a configuration or validation error, which is what
          // a throw here almost always is.
          //
          // NO `should_retry` PREDICATE, and that is a recorded decision rather
          // than an omission. Section 3.5 only retries an exception when
          // `retry_policy.should_retry(exception)` is true, and section 3.6
          // scopes that to "network errors, rate limit errors (HTTP 429),
          // server errors (HTTP 5xx), and provider-reported transient
          // failures". OUR BACKEND CANNOT PRODUCE ONE. `ClaudeCodeBackend`
          // converts its whole transport surface -- spawn failure, abort,
          // non-zero exit, unparseable output -- into a FAIL Outcome before it
          // can throw (`runProcess` resolves, never rejects; `interpretResult`
          // catches its own throw). So everything that reaches this catch is a
          // handler bug or a filesystem error, all of which are on section
          // 3.6's `false` list. A predicate matching guessed HTTP shapes would
          // be dead code that could only ever fire on a string coincidence, and
          // the doctrine's own rule is that guessed error shapes are worse than
          // none. Section 4.12's MUST is unconditional and this is its ELSE
          // branch; if a future backend throws transient errors, the predicate
          // goes in `retry.ts` and is derived from what that backend throws.
          const message = err instanceof Error ? err.message : String(err)
          this.events.append({ type: 'node.error', node: node.id, message })
          outcome = { status: Status.FAIL, notes: message, failureReason: message }
        }
      }
      // A key some node has actually PRODUCED is available, so it is no longer
      // owed -- whoever owed it. Keyed on the key, not on the owner, and this
      // is a bug fix rather than a refinement: `tool.last_line` is in EVERY
      // tool node's inferred output set, so owner-only clearing left an
      // ordinary graph (`build` fails onto a routed failure edge, `note` later
      // succeeds and writes `tool.last_line`) reporting that key as owed by
      // `build` forever. The eager check above then refused every downstream
      // node substituting `${tool.last_line}` -- a FALSE HALT on an input that
      // was demonstrably present, which is worse than the walk-past behaviour
      // this whole change replaces.
      //
      // What is cleared is what REACHED CONTEXT, taken from `Context` itself.
      // Not `effectiveOutputs`, which is a contract rather than evidence and
      // would mark keys available that nobody wrote; not the presence of a
      // value, which the stale-label doctrine deliberately leaves behind on a
      // failed tool node; and not the Outcome's `contextUpdates`, which
      // `handlers/box.ts` returns UNFILTERED while merging only the allowed
      // subset -- so reading those would let a model forge a clear with a key
      // the namespace guard had just thrown away. See `Context.written`.
      //
      // Before `recordOutcome`, deliberately: a node that wrote a key and then
      // FAILED clears it here, and then `recordFailedOutputs` re-records the
      // keys THIS node was contracted to produce. So a partial write does not
      // let a failing node declare its own contract fulfilled, while a key it
      // genuinely produced for someone else still counts.
      //
      // This does NOT replace the owner-level clearing in `recordOutcome`. The
      // two answer different questions and the ledger needs both: a tool node
      // declaring `outputs="artifact.path"` can never write that key itself,
      // so only "the node that owed it re-executed green" can settle that
      // debt. Dropping owner-level clearing would break the repair loop the
      // ledger was built around.
      for (const key of context.takeWritten()) this.failedOutputs.delete(key)
      this.events.append({ type: 'node.end', node: node.id, status: outcome.status })
      // Recorded here, before the retry machine, so the paths that `continue`
      // out of this iteration -- an in-place retry and a retry-target jump --
      // still leave the gate's latest outcome behind them. A gate that
      // RETRYs away to a retry target and never returns must keep blocking
      // the exit; recording only on fall-through would silently reopen the
      // fail-open hole C4 exists to close.
      this.recordOutcome(node.id, outcome)

      // RETRY re-executes this node until the policy is exhausted.
      if (outcome.status === Status.RETRY) {
        const policy = resolveRetryPolicy(node, graph)
        if (attempt < policy.maxRetries) {
          this.attempts.set(node.id, attempt + 1)
          const delay = backoffMs(policy, attempt)
          this.events.append({
            type: 'node.retry',
            node: node.id,
            attempt: attempt + 1,
            delayMs: delay,
          })
          if (delay > 0) await new Promise((r) => setTimeout(r, delay))
          continue
        }
        const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
        this.events.append({ type: 'node.retry.exhausted', node: node.id, target })
        if (target) {
          // The run has given up on this node's work. It never reaches a FAIL
          // status -- the rewrite below is skipped by this `continue` -- so
          // the ledger has to be told here or the abandonment is invisible to
          // the verdict, which is how a backend crash on a node with a
          // fallback route reported SUCCESS at exit 0.
          this.recordAbandoned(node.id)
          this.attempts.set(node.id, 0)
          currentId = target
          continue
        }
        outcome = {
          ...outcome,
          status: Status.FAIL,
          notes: `retries exhausted for ${node.id} with no retry target`,
          // Section 3.5's own string for this case: "RETURN
          // Outcome(status=FAIL, failure_reason='max retries exceeded')".
          failureReason: 'max retries exceeded',
        }
      }

      // Second call: an exhausted RETRY with no target was just rewritten to
      // FAIL above, and that rewritten status is what edge selection and the
      // goal-gate check both see.
      this.recordOutcome(node.id, outcome)

      this.attempts.set(node.id, 0)
      if (!this.completed.includes(node.id)) this.completed.push(node.id)

      // Section 3.2, "-- Step 5: Save checkpoint", which sits AFTER step 3
      // appends to `completed_nodes` and step 4 applies the outcome. Section
      // 5.3 then defines the field it writes: "`current_node : String` -- ID
      // of the LAST COMPLETED node", and its resume rule reads it that way --
      // "Determine the next node to execute (the one AFTER `current_node`)".
      //
      // This used to run at the TOP of the iteration with the node about to
      // execute, which broke both halves at once. The file said
      // `current_node: "b"` while `b` was still running, so it never held the
      // value section 5.3 describes at any instant of the run, and a
      // conformant resume would start after `b` and SKIP IT -- the node whose
      // crash caused the resume. The context snapshot was taken pre-dispatch
      // too, so a resumed run also lost every key the node produced.
      //
      // The paths that `continue` above this line -- an in-place retry, and a
      // retry-target jump after exhaustion -- deliberately write no
      // checkpoint. Neither completed the node, so under section 5.3 the
      // previous checkpoint, naming the last node that genuinely did complete,
      // is still the correct answer. The old placement asserted the opposite
      // for both.
      this.checkpoint(node.id)

      if (node.handler === Kind.EXIT) {
        const unsatisfied = this.unsatisfiedGoalGates()
        if (unsatisfied.length > 0) {
          const target = this.gateRetryTarget(unsatisfied)
          this.events.append({
            type: 'pipeline.goal_gate_block',
            node: node.id,
            unsatisfied,
            target,
          })
          if (target) {
            currentId = target
            continue
          }
          this.events.append({ type: 'pipeline.end', node: node.id, status: Status.FAIL })
          this.checkpoint(null)
          return this.result(
            Status.FAIL,
            `exit reached with unsatisfied goal gates: ${unsatisfied.join(', ')}`,
            // Section 3.4 step 4's own wording for this terminal case:
            // "RETURN Outcome(status=FAIL, failure_reason='Goal gate
            // unsatisfied and no retry target')". `notes` keeps naming the
            // gates, which the spec's string does not.
            'Goal gate unsatisfied and no retry target',
          )
        }

        // A run can reach the exit holding a node failure that nothing
        // recovered, and the spec says that run is still a SUCCESS.
        //
        // Section 11.3: "Pipeline outcome is 'success' if all goal_gate nodes
        // reached SUCCESS or PARTIAL_SUCCESS, 'fail' otherwise." That is the
        // ONLY normative statement of the run verdict, and it decides it
        // purely by goal gates. Section 3.7 agrees by omission: only step 4,
        // "no failure route found", terminates the pipeline -- a failure the
        // author DID route is carried onward by design. And section 3.5's
        // `allow_partial` is per-node on retry exhaustion, never run-level,
        // so there is no run-level knob the spec expects here either.
        //
        // An earlier version of this branch returned FAIL instead, on the
        // reasoning that a run holding an unrecovered failure should not
        // claim success. That reasoning is defensible and it is not ours to
        // apply: it reports FAIL where section 11.3 reports SUCCESS, which is
        // a CONTRADICTION, and this plugin extends the spec and never
        // contradicts it. It was withdrawn, and the real fix turned out to be
        // one level down: findings I1 and I2 in
        // docs/superpowers/spec-conformance.md were settled by the eager input
        // check and by a lint rule respectively, with this branch untouched.
        //
        // What stays is purely additive, and is the whole reason the failure
        // is visible at all: the event below, the `notes` string, and
        // `RunResult.unresolvedFailures`. Silence is what the doctrine
        // forbids; a spec-conformant `status` beside a loud record is an
        // extension that contradicts nothing.
        const failed = this.unresolvedFailures()
        if (failed.length > 0) {
          this.events.append({
            type: 'pipeline.unresolved_failure',
            node: node.id,
            failed,
          })
        }

        this.events.append({ type: 'pipeline.end', node: node.id, status: Status.SUCCESS })
        this.checkpoint(null)
        return this.result(
          Status.SUCCESS,
          failed.length > 0
            ? `exit reached with unresolved node failures: ${failed.join(', ')}`
            : outcome.notes,
        )
      }

      const edge = selectEdge(graph, node.id, context, outcome)

      // Spec section 3.7's failure ladder: 1. fail edge, 2. node retry
      // target, 3. fallback retry target, 4. pipeline termination.
      //
      // Step 1 is `edge` above: on a FAIL outcome selectEdge returns an edge
      // only when a condition explicitly matched the failure, so a non-null
      // edge here IS the fail edge and it wins -- an author's explicit
      // failure route is never pre-empted by a retry target. Steps 2 and 3
      // were previously unreachable: resolveRetryTarget was consulted only
      // when a RETRY status exhausted its attempts, so a node with a
      // retry_target that returned FAIL ended the run instead of jumping.
      //
      // Fail-fast is unchanged. It is a statement about *edges* -- no
      // unconditional edge may carry a failure forward -- and section 3.7
      // puts the retry target below the fail edge precisely because the
      // graph author declared it as the failure route.
      if (!edge && outcome.status === Status.FAIL) {
        const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
        if (target) {
          this.events.append({ type: 'node.fail.retry_target', node: node.id, target })
          currentId = target
          continue
        }
      }

      if (!edge) {
        // A non-exit node with no route forward is a dead end, not a success:
        // the run stops here and unsatisfiedGoalGates() is never consulted,
        // so silently reporting SUCCESS would let a graph route around its
        // own goal gates just by lacking an outgoing edge. Only a genuine
        // FAIL outcome with no matching failure route keeps its own message.
        const notes =
          outcome.status === Status.FAIL
            ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ''}`
            : `run terminated at ${node.id}, which has no outgoing edges and is not the exit`
        this.events.append({ type: 'pipeline.end', node: node.id, status: Status.FAIL })
        this.checkpoint(null)
        return this.result(Status.FAIL, notes, outcome.failureReason ?? notes)
      }

      this.events.append({ type: 'edge.taken', node: node.id, to: edge.to })
      currentId = edge.to
    }

    this.checkpoint(currentId)
    this.events.append({ type: 'pipeline.end', node: currentId ?? undefined, status: Status.FAIL })
    const capped = `step cap of ${maxSteps} reached without terminating`
    return this.result(Status.FAIL, capped, capped)
  }
}
