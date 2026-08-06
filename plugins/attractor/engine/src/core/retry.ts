import { type Graph, type Node } from '../dot/graph.ts'

export interface RetryPolicy {
  maxRetries: number
  initialDelayMs: number
  factor: number
  maxDelayMs: number
  /**
   * Spec section 3.6, `jitter : Boolean ... (default: true)`. Optional on the
   * type so a caller can build a policy literal without it, but ABSENT MEANS
   * ON -- `backoffMs` tests `!== false`. Defaulting an omitted field to OFF
   * would make the spec's default depend on how the object happened to be
   * constructed, and every policy the engine actually runs comes from
   * `resolveRetryPolicy`, which sets it explicitly.
   */
  jitter?: boolean
}

const DEFAULT_POLICY: RetryPolicy = {
  // Spec section 3.5: "If neither is set, the built-in default is 0 (no
  // retries)." A node that declares no retry attributes runs exactly once.
  maxRetries: 0,
  initialDelayMs: 200,
  factor: 2,
  // Section 3.6: "`max_delay_ms : Integer -- cap on delay in milliseconds
  // (default: 60000)`". This read 30_000, which is not a value the spec
  // offers anywhere -- it halved the ceiling on every long backoff.
  maxDelayMs: 60_000,
  jitter: true,
}

/**
 * Section 3.6 also defines five PRESET policies -- `none`, `standard`,
 * `aggressive`, `linear`, `patient`. They are deliberately NOT implemented
 * here, and this is a recorded decision rather than an omission.
 *
 * Nothing can select one. Section 2.5's graph-attribute table and section
 * 2.6's node-attribute table were both read in full: neither defines an
 * attribute naming a retry policy, and the only retry knobs a DOT author has
 * are `max_retries` and `default_max_retries`, which `resolveRetryPolicy`
 * already honours. Five exported constants no graph can reach would be dead
 * code that a reader would reasonably mistake for a feature.
 *
 * If a later spec revision adds the selecting attribute, the presets are four
 * lines each and belong beside `DEFAULT_POLICY`.
 */

function intAttr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

/** `max_retries=N` permits N+1 total attempts: one initial plus N retries. */
export function resolveRetryPolicy(node: Node, graph: Graph): RetryPolicy {
  const maxRetries =
    intAttr(node.attrs.max_retries) ??
    intAttr(graph.attrs.default_max_retries) ??
    intAttr(graph.attrs.default_max_retry) ??
    DEFAULT_POLICY.maxRetries
  return { ...DEFAULT_POLICY, maxRetries }
}

/**
 * Spec section 3.6's `delay_for_attempt`, with `attempt` 0-indexed here where
 * the spec's is 1-indexed -- `initial * factor^attempt` against the spec's
 * `initial * factor^(attempt - 1)`, which is the same series named from a
 * different origin, and is the convention `Engine.run` already passes in.
 *
 * The cap is applied BEFORE jitter, exactly as the pseudocode orders it, so a
 * capped delay still varies rather than every node in a stampede waking at
 * the same 60s mark -- which is the whole reason jitter exists.
 *
 * `rand` is injectable so the mapping from a uniform sample to a delay can be
 * asserted exactly. Production always uses `Math.random`.
 */
export function backoffMs(
  policy: RetryPolicy,
  attempt: number,
  rand: () => number = Math.random,
): number {
  const raw = policy.initialDelayMs * policy.factor ** attempt
  const capped = Math.min(raw, policy.maxDelayMs)
  // Absent means ON: see the `jitter` field's comment.
  if (policy.jitter === false) return capped
  // random_uniform(0.5, 1.5).
  return Math.round(capped * (0.5 + rand()))
}

export interface ResolveRetryTargetOptions {
  /**
   * True only for section 3.4's goal-gate-exit ladder (Engine.gateRetryTarget).
   * Section 3.7's ordinary node-failure ladder (retry-exhaustion and plain-FAIL)
   * names only the node's own two attributes -- consulting the graph-level
   * fallback there was D7. No default: every call site must say which ladder
   * it is climbing.
   */
  includeGraphLevel: boolean
}

/**
 * Resolve where a node should route. Node-level declarations always win over
 * graph-level ones; a target naming a node that does not exist is treated as
 * absent rather than crashing the run. `includeGraphLevel` gates whether the
 * graph-level rungs are consulted at all -- see `ResolveRetryTargetOptions`.
 */
export function resolveRetryTarget(
  node: Node,
  graph: Graph,
  opts: ResolveRetryTargetOptions,
): string | null {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    ...(opts.includeGraphLevel ? [graph.attrs.retry_target, graph.attrs.fallback_retry_target] : []),
  ]
  for (const c of candidates) {
    if (c && graph.nodes.has(c)) return c
  }
  return null
}
