import { ENGINE_MANAGED_KEYS, type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'
import { type BranchRunResult } from './types.ts'

/**
 * Called once per PARALLEL dispatch (by a future ParallelHandler, p5-08 --
 * not built yet), after every branch has settled. For each branch IN
 * BRANCH-ROOT DECLARATION ORDER whose outcome.status is SUCCESS or PARTIAL:
 * merge every key in its context snapshot that differs from
 * preforkSnapshot, except the three bare ENGINE_MANAGED_KEYS, into
 * parentContext. A later branch's value for a key an earlier branch already
 * merged wins and is logged via node.parallel.context_collision -- never
 * silent.
 *
 * DECLARATION order, not completion order (ADR-010): completion order
 * depends on real subprocess timing, not reproducible run-to-run, so a
 * collision's winner would be nondeterministic -- the same defect class
 * `gateOutcomes`/`nodeFailures` already avoid by being keyed to first-visit
 * order rather than completion order (F3).
 *
 * Only SUCCESS/PARTIAL branches merge, mirroring `recordOutcome`'s own rule
 * that only a SUCCESS/PARTIAL re-execution settles a debt -- a FAILED
 * branch's partial writes are not trusted evidence, applied here to a
 * branch's aggregate result rather than one node.
 *
 * `tool.`-prefixed keys ARE merged; the three bare ENGINE_MANAGED_KEYS are
 * not. A TOOL node inside a branch writing `tool.last_line` is exactly as
 * much branch evidence as an author's own `outputs=` key -- blanket-excluding
 * it would reopen finding F1's own gap for that namespace. The filter is the
 * bare-key list, NOT `isEngineManagedKey`'s broader prefix check -- those
 * three are per-traversal-position bookkeeping the branch's own reuse of
 * `executeNodeStep` necessarily wrote, and the outer run overwrites all
 * three immediately after a real ParallelHandler returns regardless (p5-08,
 * not this task).
 *
 * `results[i]` MUST be the `BranchRunResult` for `branchRootIds[i]` -- pure
 * positional pairing, not carried by any id inside `BranchRunResult` itself.
 * A caller that builds `results` out of order (e.g. `Promise.allSettled`
 * with a rejected branch filtered out before the results array reaches
 * here, rather than mapped to a FAIL outcome and kept in place) would
 * silently misattribute a collision to the wrong branch id, or merge the
 * wrong branch's value, with no error until the arrays' lengths happen to
 * diverge. The length check below turns the length-mismatch half of that
 * into a loud failure; it cannot catch a same-length reorder, which is why
 * this stays a documented calling contract, not something this function can
 * fully self-defend -- p5-08's own ParallelHandler must build `results` by
 * mapping over `branchRootIds` (e.g. `branchRootIds.map((id, i) =>
 * settled[i].status === 'fulfilled' ? settled[i].value : failResultFor(id))`),
 * never by filtering.
 */
export function mergeBranchContext(
  parentContext: Context,
  preforkSnapshot: Record<string, string>,
  branchRootIds: readonly string[],
  results: readonly BranchRunResult[],
  events: EventLog,
): void {
  if (branchRootIds.length !== results.length) {
    throw new Error(
      `mergeBranchContext: branchRootIds.length (${branchRootIds.length}) !== ` +
        `results.length (${results.length}) -- results must be positionally paired ` +
        `with branchRootIds, one BranchRunResult per branch root, in the same order`,
    )
  }
  const mergedBy = new Map<string, string>()
  for (let i = 0; i < branchRootIds.length; i++) {
    const rootId = branchRootIds[i]
    const result = results[i]
    if (result.outcome.status !== Status.SUCCESS && result.outcome.status !== Status.PARTIAL) continue
    for (const [key, value] of Object.entries(result.context)) {
      if (ENGINE_MANAGED_KEYS.includes(key)) continue
      if (preforkSnapshot[key] === value) continue
      const previousOwner = mergedBy.get(key)
      if (previousOwner !== undefined) {
        events.append({
          type: 'node.parallel.context_collision',
          key,
          previousBranch: previousOwner,
          winningBranch: rootId,
        })
      }
      mergedBy.set(key, rootId)
      parentContext.set(key, value)
    }
  }
}

/**
 * FR-17b's default join policy: FAIL iff zero branches SUCCEED/PARTIAL,
 * SUCCESS iff every branch SUCCEED/PARTIAL (zero FAIL), PARTIAL otherwise.
 * A zero-branch dispatch is FAIL -- vacuously zero branches SUCCEED/PARTIAL.
 */
export function applyDefaultJoinPolicy(results: readonly BranchRunResult[]): Outcome {
  const settled = results.filter(
    (r) => r.outcome.status === Status.SUCCESS || r.outcome.status === Status.PARTIAL,
  )
  if (settled.length === 0) {
    const notes = `all ${results.length} branch(es) failed`
    return { status: Status.FAIL, notes, failureReason: notes }
  }
  if (settled.length === results.length) {
    return { status: Status.SUCCESS, notes: `all ${results.length} branch(es) succeeded` }
  }
  return {
    status: Status.PARTIAL,
    notes: `${settled.length}/${results.length} branch(es) succeeded or partially succeeded`,
  }
}

/**
 * A minimal counting semaphore -- bounds how many of a fixed batch of async
 * tasks run concurrently. JS's single-threaded run-to-completion semantics
 * make acquire/release race-free without any lock: release() always
 * finishes its own synchronous increment-then-wake before a woken acquire()
 * gets to run its decrement.
 */
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(permits: number) {
    this.available = permits
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.available--
  }

  release(): void {
    this.available++
    const next = this.waiters.shift()
    if (next) next()
  }
}
