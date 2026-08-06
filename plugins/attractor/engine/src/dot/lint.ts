import {
  type Graph,
  Handler,
  INFERRED_OUTPUTS_BY_HANDLER,
  TYPE_TO_HANDLER,
  PASSTHROUGH_KINDS,
  RUNS_ON_MODES,
  RunsOn,
  runsOn,
  declaredOutputs,
  directPredecessor,
  effectiveOutputs,
  findByHandler,
  outgoingEdges,
  substitutableText,
  UNREGISTERED_HANDLER_KINDS,
} from './graph.ts'
import { wantsVerdict } from '../backend/argv.ts'
import { evaluateCondition, isValidConditionSyntax } from '../core/condition.ts'
import { normaliseLabel } from '../core/edge-select.ts'
import {
  Context,
  ENGINE_MANAGED_KEYS,
  ENGINE_MANAGED_PREFIXES,
  isEngineManagedKey,
} from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { resolveRetryTarget } from '../core/retry.ts'
import { referencedKeys } from '../core/substitute.ts'

export const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const

export type Severity = (typeof Severity)[keyof typeof Severity]

export interface Diagnostic {
  code: string
  severity: Severity
  node?: string
  message: string
}

function reachableFrom(graph: Graph, startId: string): Set<string> {
  const seen = new Set<string>([startId])
  const queue = [startId]
  // Graph-level retry_target/fallback_retry_target is a legitimate jump
  // target ONLY from an unsatisfied goal-gate exit (section 3.4's ladder,
  // engine.ts's gateRetryTarget) -- D7 (ADR-003) made this precise: a plain
  // node's FAIL never consults it, only the exit's goal-gate check does. So
  // this is seeded only when the graph actually has a goal_gate=true node;
  // otherwise these two graph-level attributes are inert (dead
  // configuration, not a live route to their target) and treating them as
  // reachability would make a genuinely-unreachable node -- one with no
  // goal gate to ever consult the graph-level rung at all -- invisible to
  // TOPO-004. `wantsVerdict` is the same goal-gate predicate the engine and
  // every other rule here already use, not a restated check.
  const hasGoalGate = [...graph.nodes.values()].some(wantsVerdict)
  if (hasGoalGate) {
    for (const attr of ['retry_target', 'fallback_retry_target'] as const) {
      const target = graph.attrs[attr]
      if (target && graph.nodes.has(target) && !seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const e of outgoingEdges(graph, current)) {
      if (!seen.has(e.to)) {
        seen.add(e.to)
        queue.push(e.to)
      }
    }
    // A node's own retry_target/fallback_retry_target (section 3.7's
    // failure ladder) is a legitimate routing target the engine actually
    // takes, not a DOT edge -- TOPO-004 must not flag it as unreachable.
    const node = graph.nodes.get(current)
    if (node) {
      for (const attr of ['retry_target', 'fallback_retry_target'] as const) {
        const target = node.attrs[attr]
        if (target && graph.nodes.has(target) && !seen.has(target)) {
          seen.add(target)
          queue.push(target)
        }
      }
    }
  }
  return seen
}

const FILTERS = ['tail', 'head', 'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'wc']
const FILTER_HEAD = new RegExp(`^\\s*(${FILTERS.join('|')})\\b`)

/** `set -o pipefail`, including clustered forms such as `set -eo pipefail`. */
const PIPEFAIL = /\bset\s+-[a-zA-Z]*o\b[^;&|]*\bpipefail\b/

/**
 * Blank out `$( ... )` and backtick spans.
 *
 * A pipe inside a command substitution feeds a string into a variable; its
 * exit status never routes anything, so flagging it is a false positive.
 * The canonical task-runner pipeline hits this three times.
 *
 * Depth counting tolerates nesting, including `$(( ... ))` arithmetic. A
 * stray unbalanced paren may survive; harmless, since the caller only looks
 * for pipes and command words.
 */
function stripSubstitutions(cmd: string): string {
  let out = ''
  let depth = 0
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === '$' && cmd[i + 1] === '(') {
      depth++
      i++
      continue
    }
    if (depth > 0 && cmd[i] === ')') {
      depth--
      continue
    }
    if (depth === 0) out += cmd[i]
  }
  return out.replace(/`[^`]*`/g, ' ')
}

/**
 * A filter used as a PREDICATE reports a genuine test result, so the
 * pipeline's exit status is the intended signal rather than a masked
 * failure. `grep -q` is the common case and appears twice in the canonical
 * exemplar, both times correctly.
 */
function isPredicateFilter(segment: string): boolean {
  return /^\s*grep\b[^|]*\s-[a-zA-Z]*q/.test(segment)
}

/**
 * A pipeline whose LAST stage is a non-predicate filter swallows the real
 * exit code: under `sh` the pipeline reports the filter's status, and a
 * filter almost always succeeds.
 */
function maskingPipeline(statement: string): boolean {
  const segments = statement.split(/(?<!\|)\|(?!\|)/)
  if (segments.length < 2) return false
  const pipesIntoFilter = segments.slice(1).some((s) => FILTER_HEAD.test(s))
  if (!pipesIntoFilter) return false
  return !isPredicateFilter(segments[segments.length - 1])
}

/** Split into statements at `;` and newlines, keeping `&&` / `||` chains intact. */
function statementsOf(cmd: string): string[] {
  return cmd.split(/;|\n/).filter((s) => s.trim() !== '')
}

/** An unconditional routing sentinel chained onto a masking pipeline. */
const CHAINED_SENTINEL = /&&\s*(printf|echo)\b/
const BARE_SENTINEL = /^\s*(printf|echo)\b/
const STATUS_CAPTURE = /^\s*[A-Za-z_][A-Za-z0-9_]*=\$\?/

/** For the DATA-001 and DATA-002 messages, so the built-in set is never restated by hand. */
const ENGINE_MANAGED_DESCRIPTION = [
  ...ENGINE_MANAGED_KEYS,
  ...ENGINE_MANAGED_PREFIXES.map((p) => `${p}*`),
].join(', ')

/**
 * Every key some handler writes on its own account, across all handler kinds.
 *
 * Read out of `INFERRED_OUTPUTS_BY_HANDLER` rather than listed here, so it
 * cannot drift from what the handlers actually do -- that table in turn imports
 * `TOOL_OUTPUT_KEYS` from `handlers/tool.ts` for the same reason. DATA-002 uses
 * it to refuse an `outputs=` declaration for a key whose author is a handler,
 * and the union is taken across ALL kinds rather than the declaring node's own
 * kind: a box node declaring `tool.last_line` is making exactly the false claim
 * the rule exists to refuse, and its own inferred set (deliberately empty)
 * would say nothing about it.
 */
const HANDLER_OWNED_KEYS = new Set<string>(
  Object.values(INFERRED_OUTPUTS_BY_HANDLER).flatMap((keys) => [...keys]),
)

const EMPTY_CONTEXT = new Context()
const FAILED: Outcome = { status: Status.FAIL }
const SUCCEEDED: Outcome = { status: Status.SUCCESS }

/**
 * Is this edge condition a route the author declared FOR failure?
 *
 * Answered by asking the engine's own evaluator rather than by matching the
 * string `outcome=fail`: a clause is a failure route when it is eligible on
 * a FAIL outcome and NOT eligible on a SUCCESS one. That admits
 * `outcome!=success` on the same footing as `outcome=fail` -- both genuinely
 * carry a failure -- and it excludes the two shapes that must never count:
 *
 * - an unconditional edge (no condition, or an empty one, which section 10.7
 *   makes unconditionally true). Fail-fast doctrine says no unconditional
 *   edge carries a FAIL forward, so the exit is not reachable along it.
 * - a vacuously-true guard such as `context.build_error!=fatal`. Section
 *   10.3 makes a missing key the empty string, so it is true on success and
 *   failure alike: an ordinary edge, and finding I1's shape rather than
 *   I2's. That is the eager input check's business, not this rule's.
 *
 * Clause-wise so a conjunction (`outcome=fail && context.retryable=yes`) is
 * still recognised -- its second clause is false against an empty context,
 * which would otherwise hide the first. The `&&` split is the only piece of
 * grammar not delegated: `splitClauses` is private to `condition.ts`, and
 * this shares its exact (deliberately not quote-aware) behaviour.
 */
function isFailureRoute(condition: string | undefined): boolean {
  if (condition === undefined) return false
  return condition
    .split('&&')
    .some(
      (clause) =>
        clause.trim() !== '' &&
        evaluateCondition(clause, EMPTY_CONTEXT, FAILED) &&
        !evaluateCondition(clause, EMPTY_CONTEXT, SUCCEEDED),
    )
}

/**
 * `PassthroughHandler` (start, exit, conditional -- see `core/engine.ts`)
 * returns SUCCESS unconditionally, so it has no failure to route and any
 * failure route leaving it is dead. The remaining kinds can all reach a
 * failure route: TOOL and CODERGEN through their own outcomes, and the
 * unregistered kinds because `no handler registered` throws, which the
 * engine converts to RETRY and hands to the retry machine.
 *
 * `PASSTHROUGH_KINDS` is the list `defaultHandlers` is BUILT from, not a
 * second copy of it. This used to restate the three kinds by hand, and the
 * hazard was not hypothetical: registering a real handler for CONDITIONAL
 * would leave this rule still asserting a diamond node cannot fail, and
 * GATE-001 would silently stop reporting every failure route leaving one.
 */
const NEVER_FAILS: readonly string[] = PASSTHROUGH_KINDS

/**
 * Can `entry` reach an exit node without passing through a goal gate?
 *
 * A goal gate is a wall: reaching one means the gate is VISITED, its outcome
 * is recorded, and section 3.4's check applies at the exit. The entry node
 * itself counts, so a route that lands directly on a gate is not a bypass.
 */
function bypassesGates(graph: Graph, entry: string, gates: Set<string>, exits: Set<string>): string | null {
  if (gates.has(entry)) return null
  const seen = new Set<string>([entry])
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (exits.has(current)) return current
    for (const e of outgoingEdges(graph, current)) {
      if (gates.has(e.to) || seen.has(e.to)) continue
      seen.add(e.to)
      queue.push(e.to)
    }
  }
  return null
}

export function lint(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = []

  const starts = findByHandler(graph, Handler.START)
  const exits = findByHandler(graph, Handler.EXIT)

  if (starts.length !== 1) {
    diags.push({
      code: 'TOPO-001',
      severity: Severity.ERROR,
      message: `expected exactly one start node, found ${starts.length}`,
    })
  }
  if (exits.length !== 1) {
    diags.push({
      code: 'TOPO-002',
      severity: Severity.ERROR,
      message: `expected exactly one exit node, found ${exits.length}`,
    })
  }

  for (const e of graph.edges) {
    for (const id of [e.from, e.to]) {
      if (!graph.nodes.has(id)) {
        diags.push({
          code: 'TOPO-003',
          severity: Severity.ERROR,
          message: `edge ${e.from} -> ${e.to} references unknown node ${id}`,
        })
      }
    }
  }

  // Task 4 made a missing context key compare as the empty string (spec
  // section 10.3), which makes the loop-guard idiom work but also means a
  // typo'd condition no longer throws -- it just resolves empty and
  // silently disables (or silently re-enables) an edge. This rule is the
  // diagnostic that a missing runtime error can no longer provide: it
  // shares grammar with the engine's own parser (`isValidConditionSyntax`
  // wraps the exact `CLAUSE` regex and clause split `evaluateCondition`
  // uses, via `splitClauses`) so it never rejects a condition the engine
  // would evaluate as anything other than constant-false. The engine
  // itself never throws on a malformed condition -- the accurate claim is
  // narrower than "never rejects one the engine would run": every clause
  // this rule flags is one `evaluateCondition` would also resolve to an
  // always-false comparison, no live Context or Outcome required to know
  // that, which is exactly what keeps this a syntax check rather than an
  // evaluation.
  for (const e of graph.edges) {
    const cond = e.attrs.condition
    if (cond !== undefined && !isValidConditionSyntax(cond)) {
      diags.push({
        code: 'COND-001',
        severity: Severity.ERROR,
        node: e.from,
        message:
          `edge ${e.from} -> ${e.to} has a malformed condition="${cond}"; each ` +
          `&&-joined clause must be either "key=value", "key!=value", or a bare ` +
          `identifier (letters, digits, "_" or "." only, e.g. "context.ready") for a ` +
          `truthiness check -- anything else (a hyphen, a space, stray punctuation) is a ` +
          `typo that would otherwise resolve to an empty, always-false comparison instead ` +
          `of failing loudly`,
      })
    }
  }

  if (starts.length === 1) {
    const reachable = reachableFrom(graph, starts[0].id)
    for (const node of graph.nodes.values()) {
      if (!reachable.has(node.id)) {
        diags.push({
          code: 'TOPO-004',
          severity: Severity.ERROR,
          node: node.id,
          message: `node ${node.id} is unreachable from ${starts[0].id}`,
        })
      }
    }
    for (const e of graph.edges) {
      if (e.to === starts[0].id) {
        diags.push({
          code: 'TOPO-005',
          severity: Severity.ERROR,
          node: e.from,
          message: `edge ${e.from} -> ${e.to} enters the start node`,
        })
      }
    }
  }

  for (const exitNode of exits) {
    if (outgoingEdges(graph, exitNode.id).length > 0) {
      diags.push({
        code: 'TOPO-005',
        severity: Severity.ERROR,
        node: exitNode.id,
        message: `exit node ${exitNode.id} has outgoing edges`,
      })
    }
  }

  // TOPO-006: a non-exit node with no outgoing edges is a dead end.
  //
  // WARNING, not ERROR -- downgraded, against this rule's own original
  // severity, on the same discipline that set DATA-001 and GATE-001 to
  // WARNING. Two things were checked, not assumed, before making the call:
  //
  // - Neither section 7.2's built-in lint rule table nor the section 11.2
  //   Definition-of-Done checklist requires, or even mentions, a dead-end
  //   rule. This has always been a genuine §7.4 custom extension, never a
  //   spec requirement -- so nothing forces ERROR the way, say, TOPO-003
  //   (edge_target_exists) is forced by an explicit spec rule at ERROR.
  // - The safety property this rule exists for -- a dead end must never let
  //   a goal gate go silently unconsulted -- is ALREADY guaranteed
  //   independently, by the engine's own runtime. `Engine.run`
  //   (`core/engine.ts`) halts any run that reaches a node with no route
  //   forward: `status: FAIL`, a message naming the node ("... which has no
  //   outgoing edges and is not the exit"), no silent SUCCESS. Pinned end to
  //   end by "a dead-end node fails the run instead of reporting silent
  //   success" in `engine/test/engine.test.ts`, which asserts exactly that
  //   even when lint is skipped entirely.
  //
  // That is DATA-001's own reasoning, restated for a different guard: "the
  // engine's eager input check is the guard that actually stops the run"
  // there; here it is the engine's own dead-end halt. An ERROR at design
  // time adds nothing the runtime does not already guarantee, and it costs
  // something DATA-001 and GATE-001 both refuse to spend: refusing to
  // execute a graph the spec itself places no requirement on, over a shape
  // the engine already handles safely and loudly. WARNING keeps the
  // design-time hint -- cheaper to see before a long-running pipeline
  // reaches the dead end than after -- without that cost.
  for (const node of graph.nodes.values()) {
    if (node.handler === Handler.EXIT) continue
    if (outgoingEdges(graph, node.id).length === 0) {
      diags.push({
        code: 'TOPO-006',
        severity: Severity.WARNING,
        node: node.id,
        message:
          `node ${node.id} has no outgoing edges and is not the exit node -- a dead end. ` +
          `Neither section 7.2 nor the section 11.2 checklist requires this to be an error, ` +
          `and the engine's own runtime already refuses to treat a dead end as success (a ` +
          `run reaching this node halts with FAIL rather than silently exiting); this is a ` +
          `design-time hint, not a guarantee the runtime does not already provide`,
      })
    }
  }

  for (const node of graph.nodes.values()) {
    // Spec section 2.6: `type` "takes precedence over shape-based
    // resolution". `handlerForNode` deliberately falls through to shape on
    // an unrecognised `type` rather than aborting (a typo'd type degrades
    // to whatever the shape resolves to, possibly the box/LLM default,
    // rather than crashing) -- exactly the "silently becomes something
    // else" the doctrine's "loud aborts over silent degradation" rule
    // exists to catch. This rule is that catch: it validates against
    // `TYPE_TO_HANDLER`, the very table `handlerForNode` resolves from, so
    // an accepted `type` can never be one the engine will not run.
    //
    // Object.hasOwn, not a bare index: `TYPE_TO_HANDLER['constructor']` (or
    // 'toString' / 'valueOf' / 'hasOwnProperty' / '__proto__') resolves via
    // Object.prototype and reads as "known" to a bare `!== undefined`
    // check, even though `handlerForNode` (fixed alongside this rule) does
    // not treat it as known either -- the two must agree on what "known"
    // means, not just share the table.
    if (node.attrs.type !== undefined && !Object.hasOwn(TYPE_TO_HANDLER, node.attrs.type)) {
      diags.push({
        code: 'TYPE-001',
        severity: Severity.ERROR,
        node: node.id,
        message:
          `node ${node.id} sets type="${node.attrs.type}", which is not a handler this ` +
          `engine resolves (known: ${Object.keys(TYPE_TO_HANDLER).join(', ')}); it would ` +
          `silently fall back to shape-based resolution instead of running as intended`,
      })
    }

    // HITL-001: a human gate's timeout must name an explicit outgoing edge.
    //
    // Two spellings satisfy "an explicit target was named", and this rule
    // must accept either. `on_timeout` is this engine's own attribute name,
    // and it was the only one HITL-001 ever recognised. But section 6.5 of
    // the spec is explicit that ITS attribute for the identical purpose is
    // `human.default_choice`: "For wait.human nodes, the node attribute
    // human.default_choice specifies which edge target to select on
    // timeout." A graph written to the spec's own wording -- no
    // `on_timeout` at all -- was being refused at ERROR for using the name
    // the spec itself gives it. That is a contradiction, not an extension:
    // `on_timeout` may stay recognised (nothing in the spec forbids a
    // second, engine-native spelling), but it may not be REQUIRED to the
    // exclusion of the spec's own name.
    //
    // Both are checked independently, not one preferred over the other: an
    // author who wrote either (or both, naming the same real edge) has named
    // an explicit target and must not be refused. The safety property this
    // rule exists for -- doctrine: "human gates never time out by default,"
    // no implicit fallback, no first-edge rule -- is unchanged: a timeout
    // with NEITHER attribute present, or with the only attribute present
    // naming a label no outgoing edge carries, is still an ERROR.
    if (node.handler === Handler.HUMAN && node.attrs.timeout) {
      const onTimeout = node.attrs.on_timeout
      const defaultChoice = node.attrs['human.default_choice']
      const labels = outgoingEdges(graph, node.id).map((e) => e.attrs.label)
      // Compared normalised (accelerator-stripped, trimmed, lowercased), the
      // same way selectEdge (core/edge-select.ts) actually matches a
      // preferred label at runtime -- a raw comparison here would refuse an
      // on_timeout/human.default_choice value that WOULD match at runtime
      // whenever the edge's own label carries an accelerator prefix or
      // differs only by case, disagreeing with the engine it is meant to
      // guard.
      const normalisedLabels = labels
        .filter((l): l is string => l !== undefined)
        .map(normaliseLabel)

      if (onTimeout === undefined && defaultChoice === undefined) {
        diags.push({
          code: 'HITL-001',
          severity: Severity.ERROR,
          node: node.id,
          message:
            `human gate ${node.id} sets timeout="${node.attrs.timeout}" but declares neither ` +
            `on_timeout nor human.default_choice (spec section 6.5). A timeout must name the ` +
            `edge to take; there is no implicit fallback.`,
        })
      } else {
        const declarations: { attr: string; value: string }[] = []
        if (onTimeout !== undefined) declarations.push({ attr: 'on_timeout', value: onTimeout })
        if (defaultChoice !== undefined) {
          declarations.push({ attr: 'human.default_choice', value: defaultChoice })
        }
        const unmatched = declarations.filter(
          (d) => !normalisedLabels.includes(normaliseLabel(d.value)),
        )
        // Only a diagnostic when NONE of the declared attributes name a real
        // edge: an author who wrote both, one correct and one stale, has
        // still named an explicit target.
        if (unmatched.length === declarations.length) {
          const found = labels.filter(Boolean).join(', ') || 'none'
          const declaredText = unmatched.map((d) => `${d.attr}="${d.value}"`).join(', ')
          diags.push({
            code: 'HITL-001',
            severity: Severity.ERROR,
            node: node.id,
            message:
              `human gate ${node.id} declares ${declaredText} but no outgoing edge carries ` +
              `that label (found: ${found})`,
          })
        }
      }
    }

    // HAND-001: a node resolves to a handler kind this build does not
    // register. Today's abort ("no handler registered") happens mid-run,
    // after any earlier nodes have already spent tokens or made changes.
    // Refused here instead, before anything runs.
    if (UNREGISTERED_HANDLER_KINDS.includes(node.handler)) {
      diags.push({
        code: 'HAND-001',
        severity: Severity.ERROR,
        node: node.id,
        message:
          `node ${node.id} resolves to handler "${node.handler}", which this build does not ` +
          `register (known unregistered: ${UNREGISTERED_HANDLER_KINDS.join(', ')}); the run ` +
          `would abort with "no handler registered" mid-pipeline. Refused here instead, ` +
          `before anything runs.`,
      })
    }

    // HITL-003: an agent-inclusive human gate whose exposed context traces to
    // a single, structurally-provable direct predecessor -- a self-report
    // risk for the (not yet built) `agent` channel. WARNING, not ERROR: this
    // is advisory, catching one authoring shape of the hazard AGENTS.md names
    // ("verification inside the context that produced the evidence is not
    // verification"), not a runtime guarantee. See ADR-006 for why the check
    // is scoped to Handler.CODERGEN predecessors only, and for the residual
    // risk (multi-hop chains, Handler.TOOL predecessors) this does not close.
    if (node.handler === Handler.HUMAN) {
      const channelTokens = (node.attrs['human.channel'] ?? '').split(',').map((t) => t.trim())
      const context = (node.attrs['human.context'] ?? '').trim()
      if (channelTokens.includes('agent') && context !== '') {
        const predecessor = directPredecessor(graph, node.id)
        if (predecessor?.handler === Handler.CODERGEN) {
          diags.push({
            code: 'HITL-003',
            severity: Severity.WARNING,
            node: node.id,
            message:
              `human gate ${node.id} exposes context ("${node.attrs['human.context']}") to its ` +
              `"agent" channel, but that context traces to its sole direct predecessor, ` +
              `${predecessor.id}, which resolves to Handler.CODERGEN -- an LLM node whose own ` +
              `output may be the "evidence" the agent then judges (self-report). Advisory only: ` +
              `does not block the run, and does not detect multi-hop chains or Handler.TOOL ` +
              `predecessors (see ADR-006).`,
          })
        }
      }
    }

    // A goal gate is a fail-closed feature: the runtime match on `goal_gate`
    // is an EXACT string comparison against 'true', so 'TRUE' or '1' silently
    // disables the gate rather than enabling it -- indistinguishable at a
    // glance from a passing gate. And a gate only means something on a shape
    // whose handler can produce evidence (box, parallelogram); on a
    // PassthroughHandler shape (diamond, start, exit) it is satisfied by a
    // no-op returning SUCCESS with zero evidence. The runtime match is left
    // alone deliberately -- this rule is the enforcement point.
    //
    // "false" is NOT a near-miss: section 2.6 (Appendix A) types `goal_gate`
    // as Boolean with default `false`, and section 2.4 defines Boolean
    // syntax as exactly the literal keywords `true` and `false`. A node
    // written `goal_gate=false` is spec-legal, and at runtime `wantsVerdict`
    // (`backend/argv.ts`) reads it as "not a gate" -- precisely the spec
    // default, not a silently-disabled gate the author thought was armed.
    // Refusing it was this rule making the exact class of mistake the
    // project's own doctrine exists to prevent: rejecting a spec-legal value
    // because the rule only recognised one spelling of "off". Only a value
    // that is neither "true" nor "false" is the real hazard -- a near-miss
    // like "TRUE" or "1" that reads as armed to a human and disarmed to the
    // engine -- and that shape is still refused below, unweakened.
    if (node.attrs.goal_gate !== undefined && node.attrs.goal_gate !== 'false') {
      if (node.attrs.goal_gate !== 'true') {
        diags.push({
          code: 'HITL-002',
          severity: Severity.ERROR,
          node: node.id,
          message:
            `node ${node.id} sets goal_gate="${node.attrs.goal_gate}"; the engine only ` +
            `recognises the exact strings "true" and "false" -- any other value (including ` +
            `"TRUE" or "1") silently disables the gate`,
        })
      } else if (node.handler !== Handler.CODERGEN && node.handler !== Handler.TOOL) {
        diags.push({
          code: 'HITL-002',
          severity: Severity.ERROR,
          node: node.id,
          message:
            `node ${node.id} sets goal_gate=true but is not a box or parallelogram node; ` +
            `only those handlers can produce evidence for a gate, so this one is satisfied ` +
            `by a no-op with zero evidence`,
        })
      }
    }

    // RUNS-001: a `runs_on` value the engine does not recognise.
    //
    // ERROR, and the precedent was read rather than guessed. Three existing
    // rules bracket the choice:
    //
    // - TYPE-001 (`type`) is an ERROR. An unrecognised value there degrades
    //   silently to shape-based resolution, so the node runs as something the
    //   author did not ask for. `runsOn` degrades the same way, to `success`.
    // - HITL-002 (`goal_gate`) is an ERROR for the same shape of reason: the
    //   runtime match is an exact string comparison, so a near-miss silently
    //   disables a feature the author explicitly asked for.
    // - `fidelity` has no rule at all, and deserves none: its fallback is
    //   "start a fresh conversation", which is the conservative direction and
    //   costs context a prompt can restate.
    //
    // `runs_on` is a `type` case, not a `fidelity` case, and the engine's own
    // comment on `runsOn` says so. `runs_on=alway` on a cleanup node silently
    // becomes `runs_on=success`, which re-arms the eager input check on the one
    // node whose entire purpose is to run after something failed -- so the
    // cleanup is blocked exactly when it is needed, and the author's evidence
    // that anything was wrong is a `runs_on` attribute the engine ignored.
    //
    // DATA-001's reason for softening to WARNING does not apply here and that
    // is the deciding test: DATA-001 cannot see `--param` keys, so the question
    // it asks is genuinely unanswerable at design time. The `runs_on` value set
    // is CLOSED and fully known at lint time -- nothing supplied at runtime can
    // make a fourth value legitimate -- so there is no false-positive risk to
    // trade against, and the CMD-001 lesson (an ERROR that makes a real
    // pipeline unrunnable) has nothing to bite on.
    //
    // `Object.hasOwn` rather than a bare index, matching `runsOn` exactly:
    // `runs_on="constructor"` resolves through Object.prototype and would
    // otherwise read as a known value to both.
    const declaredRunsOn = node.attrs.runs_on
    if (declaredRunsOn !== undefined && !Object.hasOwn(RUNS_ON_MODES, declaredRunsOn)) {
      diags.push({
        code: 'RUNS-001',
        severity: Severity.ERROR,
        node: node.id,
        message:
          `node ${node.id} sets runs_on="${declaredRunsOn}", which this engine does not ` +
          `recognise (known: ${Object.keys(RUNS_ON_MODES).join(', ')}); it silently falls ` +
          `back to runs_on="${RunsOn.SUCCESS}", which re-arms the eager input check and can ` +
          `stop a cleanup node from running at the one moment it was written for`,
      })
    }

    // RUNS-002: a goal gate carrying a `runs_on` the engine ignores.
    //
    // A SEPARATE RULE rather than a second RUNS-001 diagnostic, and the
    // severity is what decides it. RUNS-001 asks "is this value one the engine
    // knows" and the answer is an ERROR; this asks "do these two individually
    // valid attributes contradict each other" and the answer is a WARNING,
    // because the engine resolves the contradiction in the fail-closed
    // direction on BOTH halves of the axis. One code carrying two severities
    // would make `hasErrors` unpredictable from the code alone, which is the
    // property an operator actually relies on.
    //
    // WARNING WAS RE-DECIDED, not inherited. Its original justification was
    // that "the engine runs it anyway and makes it earn its verdict" -- and
    // that was HALF TRUE, which is the worst kind. `Engine.run`'s
    // `runs_on=failure` skip did exclude gates, so the gate ran; but `runs_on`
    // ALSO switched off the eager input check, so the whole-branch review
    // demonstrated a gate with `runs_on="failure"` earning SUCCESS against an
    // owed `${artifact.path}` the engine had recorded as unavailable, and the
    // run exiting 0 with no work product. The engine now applies the eager
    // check to a goal gate whatever its `runs_on` says. With both halves
    // present the original claim is finally true, so WARNING stands -- nothing
    // unsafe survives, the attribute is simply inert, and refusing to run the
    // graph over an inert attribute would be the CMD-001 mistake (an ERROR
    // that makes a legitimate pipeline unrunnable). Contrast DATA-002 below,
    // which is an ERROR precisely because the engine does NOT neutralise it.
    //
    // It fires on `always` as well as `failure`, and that widening is the
    // fix's own consequence. `always` never skipped a node, so before the fix
    // its only effect on a gate WAS relaxing the input check; now that this is
    // gone, `always` on a gate does exactly nothing, silently. An author who
    // wrote it believes their gate will run when its inputs are missing. It
    // will not, and it must not.
    //
    // It stays in the RUNS family rather than joining HITL-002 because the
    // attribute that does not do what it says is `runs_on`, and an author
    // reading about `runs_on` is the one who needs to find this.
    //
    // Keyed off the RESOLVED mode, not off the raw attribute: an unrecognised
    // value resolves to `success`, where the attribute is genuinely honoured
    // (as the default) and RUNS-001 is the diagnostic that belongs.
    const gateRunsOn = runsOn(node)
    if (wantsVerdict(node) && gateRunsOn !== RunsOn.SUCCESS) {
      const skipClause =
        gateRunsOn === RunsOn.FAILURE
          ? `a gate that only ran when something else had already failed could never be ` +
            `earned on a healthy run, and skipping it would record a SUCCESS for a gate that ` +
            `produced no evidence; and `
          : ''
      diags.push({
        code: 'RUNS-002',
        severity: Severity.WARNING,
        node: node.id,
        message:
          `node ${node.id} is a goal gate with runs_on="${gateRunsOn}", which cannot be ` +
          `honoured and is ignored entirely for this node: ${skipClause}a gate relieved of ` +
          `the eager input check could earn its verdict against an input the engine has ` +
          `already recorded as unavailable, which is the same unearned success. The engine ` +
          `runs it, and makes it earn its verdict against real inputs. Drop the runs_on, or ` +
          `move the failure-only work to a node that is not a gate`,
      })
    }

    // DATA-002: an `outputs=` declaration naming a key the node does not own.
    //
    // ERROR. `outputs=` is a node saying "I am contracted to produce this key",
    // and the failed-output ledger takes it at its word: when the node fails,
    // every key it declared is recorded as owed, and the eager input check then
    // refuses every downstream node that references one. Declaring a key the
    // node cannot own therefore does not merely mislead -- it arms a halt on a
    // key somebody else writes. Both halves were verified on this engine:
    //
    // - `build [outputs="tool.last_line"]` lints clean and blocks the
    //   downstream node whose whole job is reporting the failure. That is
    //   EXACTLY the stale-label contradiction this branch removed by making the
    //   ledger declared-only -- re-armable, from the graph, one attribute at a
    //   time. The doctrine entry in plugins/attractor/AGENTS.md is explicit
    //   that a failing tool node's previous `tool.last_line` exists to be read.
    // - `build [outputs="outcome"]` blocks every downstream node substituting
    //   `$outcome`, a key the engine writes every single step. The write-clearing
    //   in `Engine.run` cannot rescue it: engine bookkeeping writes are drained
    //   and discarded before dispatch, precisely so the control plane's own
    //   writes never settle a node's debt.
    //
    // WHY ERROR, AGAINST THE PRECEDENT IN THIS FILE. DATA-001 is a WARNING
    // because `--param` supplies keys at runtime that lint cannot see, so its
    // question is genuinely unanswerable at design time. This question is
    // answerable and CLOSED: the engine-managed set and the handler-owned set
    // are both fixed at lint time, and no runtime input can make declaring one
    // legitimate -- a `--param` seeds a VALUE, while this is a DECLARATION of
    // authorship that is false however the run is invoked. That is RUNS-001's
    // deciding test, and it lands the same way.
    //
    // The CMD-001 lesson -- an ERROR that made a real pipeline unrunnable -- has
    // nothing to bite on either, and this was checked rather than assumed:
    // `outputs=` is new on this branch, so no pre-existing graph can carry a
    // declaration for this rule to refuse. A sweep of every DOT graph in the
    // repository found no node declaring an engine-managed or handler-owned
    // key. That is what makes ERROR affordable here and not for DATA-001.
    //
    // The two key sets are DERIVED, never retyped: `isEngineManagedKey` is the
    // same predicate the engine writes its built-ins through and the box
    // handler refuses model updates with, and the handler-owned set is read out
    // of `INFERRED_OUTPUTS_BY_HANDLER` (which imports `TOOL_OUTPUT_KEYS` from
    // the handler itself). The handler-owned set is a subset of the
    // engine-managed one TODAY -- `tool.last_line` matches the `tool.` prefix --
    // and is checked separately anyway, because the day a handler infers a key
    // outside a reserved namespace, this rule must already cover it.
    for (const key of declaredOutputs(node)) {
      const managed = isEngineManagedKey(key)
      const handlerOwned = HANDLER_OWNED_KEYS.has(key)
      if (!managed && !handlerOwned) continue
      const owner = managed
        ? `the engine-managed namespace (${ENGINE_MANAGED_DESCRIPTION})`
        : `a handler's own output set`
      diags.push({
        code: 'DATA-002',
        severity: Severity.ERROR,
        node: node.id,
        message:
          `node ${node.id} declares outputs="${key}", but ${key} belongs to ${owner} and no ` +
          `node can be contracted to produce it. A declaration enters the failed-output ` +
          `ledger when this node fails, so the engine would then refuse every downstream ` +
          `node referencing \${${key}} -- including one reading a value some other part of ` +
          `the system had genuinely written. Declare a key in your own namespace instead`,
      })
    }

    const cmd = node.attrs.tool_command
    if (cmd && !PIPEFAIL.test(cmd)) {
      const stmts = statementsOf(stripSubstitutions(cmd))
      for (let i = 0; i < stmts.length; i++) {
        if (!maskingPipeline(stmts[i])) continue

        diags.push({
          code: 'CMD-001',
          severity: Severity.WARNING,
          node: node.id,
          message:
            `tool_command pipes into a filter without 'set -o pipefail'; under sh the ` +
            `pipeline exits with the filter's status, masking real failure`,
        })

        // The sentinel may be chained in the same statement (`... && printf ok`)
        // or stand alone in the next one (`...; printf ok`). A deliberate
        // `rc=$?` capture means the author took the status on purpose.
        const next = stmts[i + 1] ?? ''
        const sentinel =
          CHAINED_SENTINEL.test(stmts[i]) ||
          (BARE_SENTINEL.test(next) && !STATUS_CAPTURE.test(next))
        if (sentinel) {
          diags.push({
            code: 'CMD-002',
            severity: Severity.ERROR,
            node: node.id,
            message:
              `tool_command emits a routing sentinel after a pipe to a filter; the filter ` +
              `exits 0 unconditionally so the sentinel fires regardless of real success`,
          })
        }
      }
    }
  }

  // DATA-001: a reference nothing in the graph declares.
  //
  // WARNING, never ERROR, and the reason is load-bearing rather than a
  // preference. `--param key=value` seeds context at run start and lint
  // cannot see it, so the "no node produces this key" question is genuinely
  // unanswerable at design time. An ERROR would refuse legitimate graphs --
  // the CMD-001 lesson, where an ERROR rule false-positived on the canonical
  // exemplar and would have made the flagship pipeline unrunnable. The
  // ruling there was to make the rule precise and keep ERROR; here the
  // information is not available at all, so the severity has to give. The
  // engine's eager input check is the load-bearing guard; this is the hint
  // an author gets before the run.
  //
  // Three sources supply a key, all read from where the engine reads them
  // rather than restated:
  //
  // - `effectiveOutputs(node)` -- inferred handler outputs union declared
  //   `outputs=`. Note what this means for a box (LLM) node: it infers
  //   NOTHING, deliberately, so a box node whose output a successor consumes
  //   must declare it. The message says so, because authors hit it
  //   constantly and would otherwise read the warning as a linter defect.
  // - `isEngineManagedKey` -- the same predicate the engine writes its
  //   built-ins through and the box handler refuses model updates with.
  // - `graph.attrs` -- `Engine.run` seeds context from every graph attribute
  //   under both its bare name and a `graph.`-qualified one, so `$goal` is
  //   supplied by `goal="..."` and needs no hardcoding here.
  //
  // Undotted references are never flagged. That is the `--param` heuristic,
  // and it is not arbitrary: every dataflow key in this codebase is dotted
  // (`artifact.path`, `tool.last_line`, every `outputs=` example, every
  // engine-managed prefix), and every `--param` in its tests and docs is a
  // flat identifier. `substitute.ts` draws the same line for its own reason
  // -- the bare `$key` form refuses dots because it stands in for a shell
  // variable. Flagging flat names would cry wolf on every parameterised
  // pipeline, and a WARNING that cries wolf is worse than absent.
  const supplied = new Set<string>(Object.keys(graph.attrs))
  for (const node of graph.nodes.values()) {
    for (const key of effectiveOutputs(node)) supplied.add(key)
  }
  for (const node of graph.nodes.values()) {
    for (const key of referencedKeys(substitutableText(node))) {
      if (supplied.has(key)) continue
      if (isEngineManagedKey(key)) continue
      if (!key.includes('.')) continue
      diags.push({
        code: 'DATA-001',
        severity: Severity.WARNING,
        node: node.id,
        message:
          `node ${node.id} references \${${key}}, which no node declares: it is in no ` +
          `node's effective outputs, it is not an engine built-in (${ENGINE_MANAGED_DESCRIPTION}), ` +
          `and it is not a graph attribute. Either it is a typo, or its producer never ` +
          `declared it -- note that a box (LLM) node infers NO outputs at all, because a ` +
          `model's contextUpdates keys are arbitrary and the engine-managed guard filters ` +
          `them, so a box node whose result a successor consumes must say so explicitly ` +
          `with outputs="${key}". WARNING rather than ERROR because a --param supplies ` +
          `keys at runtime that lint cannot see; the engine's eager input check is the ` +
          `guard that actually stops the run.`,
      })
    }
  }

  // GATE-001: a goal gate that does not gate.
  //
  // Finding I2's real fix, and the reason it lives here rather than in the
  // engine. Section 3.4 checks goal gates on VISITED nodes only, so a gate
  // on a branch a failure route bypasses is legitimately never consulted and
  // section 11.3 then reports the run a success. The engine is behaving
  // exactly as specified; the defect is authorial, and an author needs to be
  // told their gate is bypassable rather than left to conclude the engine is
  // broken. The message carries that reasoning for the same reason: a
  // diagnostic that only says "gate bypassed" invites a bug report against
  // the engine.
  //
  // Only graphs that DECLARE a gate are examined. A pipeline with no gate is
  // not bypassing anything, and firing on it would bury the rule in noise.
  const gates = new Set<string>(
    [...graph.nodes.values()].filter((n) => wantsVerdict(n)).map((n) => n.id),
  )
  const exitIds = new Set<string>(exits.map((n) => n.id))
  if (gates.size > 0 && exitIds.size > 0) {
    // A failure route the author declared, and where it lands. The three the
    // spec's section 3.7 ladder recognises: the fail edge, the node retry
    // target, the fallback retry target.
    const routes: { origin?: string; target: string; what: string }[] = []

    for (const e of graph.edges) {
      if (!isFailureRoute(e.attrs.condition)) continue
      const from = graph.nodes.get(e.from)
      if (from === undefined || NEVER_FAILS.includes(from.handler)) continue
      // A route leaving the gate ITSELF is not a bypass: the gate has been
      // visited and its outcome is non-success, so section 3.4 blocks the
      // exit and the run cannot claim an unearned success. Flagging it would
      // false-positive on the most ordinary way there is to write a gated
      // abort path.
      if (gates.has(e.from)) continue
      routes.push({
        origin: e.from,
        target: e.to,
        what: `the failure edge ${e.from} -> ${e.to} [condition="${e.attrs.condition}"]`,
      })
    }

    for (const node of graph.nodes.values()) {
      if (NEVER_FAILS.includes(node.handler) || gates.has(node.id)) continue
      // includeGraphLevel: false -- section 3.7's ladder (which GATE-001
      // mirrors) does not consult the graph-level retry_target/
      // fallback_retry_target for a plain node's failure route; only
      // section 3.4's goal-gate-exit ladder does (see engine.ts:423). A
      // purely graph-level fallback is therefore no longer a live bypass
      // route for a non-gate node and is not reported here.
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      if (target === null) continue
      routes.push({
        origin: node.id,
        target,
        what: `node ${node.id}'s retry_target="${target}"`,
      })
    }

    for (const route of routes) {
      const reachedExit = bypassesGates(graph, route.target, gates, exitIds)
      if (reachedExit === null) continue
      const diag: Diagnostic = {
        code: 'GATE-001',
        severity: Severity.WARNING,
        message:
          `${route.what} can reach the exit node ${reachedExit} without passing through ` +
          `any goal gate (declared: ${[...gates].join(', ')}). Spec section 3.4 checks ` +
          `goal gates on VISITED nodes only, so a gate this route skips is legitimately ` +
          `never consulted and section 11.3 then reports the run a success -- the engine ` +
          `is behaving exactly as specified, and the gate is what does not gate. Route ` +
          `the failure path through a gate, or place one on it, or the run can exit ` +
          `claiming success with the gate's work unjudged.`,
      }
      if (route.origin !== undefined) diag.node = route.origin
      diags.push(diag)
    }
  }

  return diags
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === Severity.ERROR)
}
