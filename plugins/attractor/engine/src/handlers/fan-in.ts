import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { directPredecessors } from '../dot/graph.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type Handler, type HandlerCtx } from './types.ts'

/**
 * Context keys this handler writes on every dispatch. Exported for the same
 * anti-drift reason `TOOL_OUTPUT_KEYS` is (`handlers/tool.ts`): a hand-kept
 * copy of this list anywhere else in the codebase would eventually disagree
 * with what the handler actually writes. See `dot/graph.ts`'s
 * `INFERRED_OUTPUTS_BY_HANDLER[Handler.FAN_IN]` for why this constant is
 * NOT imported there the way `TOOL_OUTPUT_KEYS` is (a circular-import
 * hazard `directPredecessors` below creates in that direction).
 */
export const FAN_IN_OUTPUT_KEYS: readonly string[] = [
  'fan_in.success_count',
  'fan_in.fail_count',
  'fan_in.total',
]

/**
 * FR-17b, ADR-007 point 4: the join node for a `Handler.PARALLEL` fan-out.
 *
 * Needs no handoff channel from `ParallelHandler` at all -- it derives its
 * verdict purely from graph structure (`directPredecessors`, the plural
 * sibling of `directPredecessor`) and `Engine`'s own per-node outcome ledger
 * (`HandlerCtx.nodeStatus`), populated by the SAME `recordOutcome`/
 * `recordAbandoned` call sites that already run for every node the engine
 * dispatches -- main path or any branch. This is deliberate: a branch's
 * chain converges on this node by ordinary graph edges (`branch_tail ->
 * join`), so whichever node was each branch's own last dispatch before
 * reaching here IS a direct predecessor of this node, and its outcome is
 * already on the ledger by the time `FanInHandler` runs.
 *
 * OQ5's formula, verbatim: `status = successCount === 0 ? FAIL : failCount
 * === 0 ? SUCCESS : PARTIAL`. SUCCESS/PARTIAL count as success; only FAIL
 * counts as failure. A predecessor never visited (nodeStatus returns
 * undefined -- e.g. its own branch dead-ended before reaching a node with an
 * edge into this one) counts as neither, but still counts toward `total`:
 * `total` is the STRUCTURAL predecessor count, not `successCount +
 * failCount`, because it answers "how many branches this join awaits", not
 * "how many branches reported an opinion".
 */
export class FanInHandler implements Handler {
  private writeStatus(ctx: HandlerCtx, outcome: Outcome): void {
    const nodeDir = join(ctx.runDir, ctx.node.id)
    mkdirSync(nodeDir, { recursive: true })
    const statusFile = {
      outcome: outcome.status,
      preferred_label: outcome.preferredLabel,
      suggested_next_ids: outcome.suggestedNextIds,
      context_updates: outcome.contextUpdates,
      notes: outcome.notes,
      failure_reason: outcome.failureReason,
    }
    writeFileSync(join(nodeDir, 'status.json'), JSON.stringify(statusFile, null, 2), 'utf8')
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    const predecessors = directPredecessors(ctx.graph, ctx.node.id)
    const statuses = predecessors.map((p) => ctx.nodeStatus?.(p.id))
    const successCount = statuses.filter((s) => s === Status.SUCCESS || s === Status.PARTIAL).length
    const failCount = statuses.filter((s) => s === Status.FAIL).length
    const total = predecessors.length

    // OQ5, verbatim.
    const status = successCount === 0 ? Status.FAIL : failCount === 0 ? Status.SUCCESS : Status.PARTIAL

    const updates: Record<string, string> = {
      'fan_in.success_count': String(successCount),
      'fan_in.fail_count': String(failCount),
      'fan_in.total': String(total),
    }
    ctx.context.merge(updates)

    const notes = `${successCount}/${total} branches succeeded (${failCount} failed)`
    const outcome: Outcome = {
      status,
      contextUpdates: updates,
      notes,
      ...(status === Status.FAIL ? { failureReason: notes } : {}),
    }

    ctx.events.append({
      type: 'node.fan_in.end',
      node: ctx.node.id,
      status,
      successCount,
      failCount,
      total,
    })

    this.writeStatus(ctx, outcome)
    return outcome
  }
}
