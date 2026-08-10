import { type Edge, type Graph, outgoingEdges } from '../dot/graph.ts'
import { type Context } from './context.ts'
import { Status, type Outcome } from './outcome.ts'
import { evaluateCondition } from './condition.ts'

/**
 * Spec section 3.3: lowercase, trim, and strip an accelerator prefix -- the
 * `[Y] `, `Y) ` and `Y - ` forms. The rest of the label is significant; the
 * previous implementation truncated at the first dash, which collapsed
 * "red - retry" and "red - abort" into one label.
 */
export function normaliseLabel(label: string): string {
  return label
    .replace(/^\s*(?:\[[A-Za-z0-9]\]|[A-Za-z0-9]\)|[A-Za-z0-9]\s+-)\s+/, '')
    .trim()
    .toLowerCase()
}

/**
 * A weight that is absent, empty, or not a finite number counts as zero.
 * Returning NaN from a sort comparator violates its contract, and the
 * resulting order falls back to edge declaration order -- so a typo like
 * `weight=heavy` would quietly make routing depend on how the DOT file was
 * written rather than on what it says.
 */
function weightOf(edge: Edge): number {
  const raw = edge.attrs.weight
  if (raw === undefined) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function byWeightThenTarget(a: Edge, b: Edge): number {
  const wa = weightOf(a)
  const wb = weightOf(b)
  if (wa !== wb) return wb - wa
  return a.to.localeCompare(b.to)
}

/**
 * An edge is conditional only when its `condition` attribute is present AND
 * non-empty after trimming. Spec section 3.3: "unconditional = [e FOR e IN
 * edges WHERE e.condition is empty]" -- the discriminator is emptiness, not
 * presence, so `condition=""` (for example from a DOT `edge [...]` default
 * block) must fall through to the unconditional path rather than becoming a
 * condition-matching edge that always evaluates true. The same applies to a
 * whitespace-only condition such as `condition="   "`: the parser preserves
 * it verbatim, and `evaluateCondition` treats it as trivially true (its own
 * trim finds nothing to compare), so without trimming here it would
 * short-circuit step 1 exactly like a real match -- and, on a FAIL outcome,
 * silently carry the failure forward where `condition=""` correctly does not.
 */
export function isConditional(edge: Edge): boolean {
  return edge.attrs.condition !== undefined && edge.attrs.condition.trim() !== ''
}

/**
 * Select the next edge deterministically, per spec section 3.3's cascade.
 *
 * Step 1: any conditional edge whose condition matches ends the cascade
 * immediately -- best_by_weight_then_lexical among the matches, full stop.
 * Steps 2 and 3 (preferred label, suggested next ids) run ONLY when no
 * conditional edge matched, and only over the unconditional edges; a
 * preferred label or suggestion never overrides a matched condition.
 *
 * Fail-fast: when the node failed and no condition explicitly matched the
 * failure, no unconditional edge may carry it forward. This is a chosen
 * reading of a spec ambiguity, not a settled requirement: section 3.3's
 * `select_edge` pseudocode has no FAIL branch (a literal reading would
 * follow unconditional edges), while section 3.7's failure ladder never
 * mentions them and terminates. We implement the 3.7 reading. See
 * "Ambiguities where we chose a reading", item 1, in
 * docs/superpowers/spec-conformance.md for the recorded deviation.
 */
export function selectEdge(
  graph: Graph,
  fromId: string,
  ctx: Context,
  outcome: Outcome,
): Edge | null {
  const edges = outgoingEdges(graph, fromId)
  if (edges.length === 0) return null

  // Step 1: conditional edges whose condition matches. RETURN immediately.
  const matched = edges.filter(
    (e) => isConditional(e) && evaluateCondition(e.attrs.condition as string, ctx, outcome),
  )
  if (matched.length > 0) return matched.sort(byWeightThenTarget)[0]

  if (outcome.status === Status.FAIL) {
    // Fail-fast: with no condition explicitly matching the failure, no
    // unconditional edge may carry it forward.
    return null
  }

  // Steps 2 and 3 are scoped to unconditional edges only.
  const unconditional = edges.filter((e) => !isConditional(e))
  if (unconditional.length === 0) return null

  // 2. Preferred label: the first unconditional edge whose label matches,
  // in declaration order -- the caller's ranking plays no part here.
  if (outcome.preferredLabel) {
    const want = normaliseLabel(outcome.preferredLabel)
    const byLabel = unconditional.find(
      (e) => e.attrs.label !== undefined && normaliseLabel(e.attrs.label) === want,
    )
    if (byLabel) return byLabel
  }

  // 3. Explicitly suggested next node ids, iterated in the CALLER's list
  // order -- the caller's ranking is authoritative here, unlike step 4/5.
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    for (const id of outcome.suggestedNextIds) {
      const bySuggestion = unconditional.find((e) => e.to === id)
      if (bySuggestion) return bySuggestion
    }
  }

  // 4 and 5. Weight descending, then lexical target id.
  return unconditional.sort(byWeightThenTarget)[0]
}
