import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDuration } from '../core/duration.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { substitute } from '../core/substitute.ts'
import { runShell, lastNonEmptyLine } from '../core/shell.ts'
import { type Handler, type HandlerCtx } from './types.ts'

/**
 * Context keys this handler writes on SUCCESS. Exported so `dot/graph.ts`'s
 * `inferredOutputs()` can derive a tool node's dataflow contract from this
 * handler's actual behaviour rather than a hand-copied list that could
 * silently drift from it.
 *
 * `tool.output` is spec section 4.10's own key: on success the handler
 * returns `context_updates={"tool.output": result.stdout}`. It was missing,
 * so the full stdout of a tool node was unreachable from context and a node
 * that printed a JSON document could hand on only its last line.
 *
 * `tool.last_line` is OURS, it is load-bearing, and it is not going anywhere:
 * the stale-label rule in plugins/attractor/AGENTS.md depends on it, and
 * section 4.10 neither defines nor forbids it. `tool.output` was ADDED beside
 * it, not substituted for it -- this list grew by one entry and lost nothing.
 *
 * NEITHER key is written on FAIL. That is the stale-label rule, and it now
 * covers both: a failing tool node must not overwrite what a previous run
 * left behind, or a gate's earlier label does not survive a failed re-entry.
 * So this list describes the contract a SUCCESSFUL run honours, the same
 * sense `outputs=` declares in for any other node.
 *
 * `tool.exit_code` is still not written; `result.code` is used locally to
 * branch to FAIL and goes no further. The spec defines no such key.
 */
export const TOOL_OUTPUT_KEYS: readonly string[] = ['tool.last_line', 'tool.output']

/**
 * Executes a `parallelogram` node: a deterministic shell command whose exit
 * code and final stdout line drive routing.
 *
 * STALE-LABEL RULE: on a non-zero exit the handler returns early WITHOUT
 * writing `tool.last_line`. Pipelines rely on this — a gate's previous label
 * must survive a failed re-entry rather than being overwritten with the
 * failure's output.
 */
export class ToolHandler implements Handler {
  /**
   * Section 5.6's run directory structure gives every `{node_id}/` a
   * `status.json` -- "Node execution outcome". Tool nodes wrote command.sh,
   * stdout.txt and stderr.txt and no status.json at all, so the one artifact
   * the spec tells an external reader to look for was missing for an entire
   * node kind. Section 4.5's status-file contract names it as the channel
   * external tools use to communicate outcomes back, which cannot work if
   * half the nodes never produce one.
   *
   * The wire shape is the same one `handlers/box.ts` writes, field for field,
   * because a reader parsing a run directory must not need to know which
   * handler produced a given node's file.
   */
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
    const raw = ctx.node.attrs.tool_command
    if (!raw) {
      // This early return produced no artifacts at all, so an operator
      // debugging a misconfigured node found an empty directory or none.
      const reason = `node ${ctx.node.id} has no tool_command`
      const outcome: Outcome = { status: Status.FAIL, notes: reason, failureReason: reason }
      this.writeStatus(ctx, outcome)
      return outcome
    }
    const command = substitute(raw, ctx.context)
    const timeoutMs = parseDuration(ctx.node.attrs.timeout)

    ctx.events.append({ type: 'node.tool.start', node: ctx.node.id })
    const result = await runShell(command, ctx.cwd, timeoutMs)

    const nodeDir = join(ctx.runDir, ctx.node.id)
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(join(nodeDir, 'command.sh'), command, 'utf8')
    writeFileSync(join(nodeDir, 'stdout.txt'), result.stdout, 'utf8')
    writeFileSync(join(nodeDir, 'stderr.txt'), result.stderr, 'utf8')

    ctx.events.append({
      type: 'node.tool.end',
      node: ctx.node.id,
      exitCode: result.code,
    })

    if (result.code !== 0) {
      const reason = `exit ${result.code}: ${lastNonEmptyLine(result.stderr) || lastNonEmptyLine(result.stdout)}`
      // No `contextUpdates` here, and that is the stale-label rule on disk as
      // well as in memory: a failed tool node claims to have produced nothing.
      const outcome: Outcome = { status: Status.FAIL, notes: reason, failureReason: reason }
      this.writeStatus(ctx, outcome)
      return outcome
    }

    const label = lastNonEmptyLine(result.stdout)
    // Section 4.10's `tool.output` is the RAW stdout, not the trimmed last
    // line -- that is the whole reason for having both keys.
    const updates = { 'tool.last_line': label, 'tool.output': result.stdout }
    ctx.context.merge(updates)
    const outcome: Outcome = {
      status: Status.SUCCESS,
      contextUpdates: updates,
      notes: label,
    }
    this.writeStatus(ctx, outcome)
    return outcome
  }
}
