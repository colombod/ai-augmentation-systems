import { resolve } from 'node:path'
import {
  type Edge,
  type Graph,
  Handler as Kind,
  effectiveOutputs,
  outgoingEdges,
  resolveMaxParallel,
} from '../dot/graph.ts'
import { type Context, ENGINE_MANAGED_KEYS } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { createWorktree, removeWorktree, type Worktree } from '../run/worktree.ts'
import { type Handler, type HandlerCtx } from './types.ts'

interface BranchResult {
  edge: Edge
  /**
   * The node id right before the branch's walk stopped, because it resolved
   * to Handler.FAN_IN and was never dispatched -- or null on a dead end / an
   * unrouted FAIL inside the branch. See ADR-007, "Reaching the join node".
   */
  convergedTo: string | null
  /** Every node id this branch's walk actually dispatched, in walk order. */
  visited: string[]
  /** This branch's own cloned Context, after its walk finished. */
  finalContext: Context
}

/**
 * FR-17b, ADR-007 + ADR-008: fans out to every outgoing edge of a
 * `Handler.PARALLEL` (`component`-shaped) node as an independent branch,
 * walked concurrently (bounded by `max_parallel`) through the exact same
 * per-node machinery the main path uses -- `HandlerCtx.runBranchNode`, a
 * closure over `Engine`'s own private `visitNode()`. See ADR-007 for why:
 * re-deriving the eager-input-check/retry-ladder/ledger-update machinery
 * here instead would be a second implementation that can silently drift
 * from the first.
 *
 * `Outcome.status` is SUCCESS whenever every branch was dispatched and all
 * (that reached a convergence target at all) converged on ONE
 * `Handler.FAN_IN` node -- individual branch failures are `FanInHandler`'s
 * business (OQ5), not this node's. FAIL is reserved for orchestration-level
 * defects: no outgoing edges, branches converging on more than one node (or
 * on zero), or on a node that isn't `Handler.FAN_IN`.
 */
export class ParallelHandler implements Handler {
  /**
   * ADR-008: the ONLY fix for GitHub issue #15 (`createWorktree` racing on
   * `.git/worktrees/` administrative state under concurrent calls) this
   * change set makes -- at this call site, not inside `createWorktree`
   * itself, which stays untouched. Keyed by the resolved absolute repo path
   * so two different repositories never serialize against each other.
   */
  private repoLocks = new Map<string, Promise<unknown>>()

  private withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
    const key = resolve(repoDir)
    const prior = this.repoLocks.get(key) ?? Promise.resolve()
    // `fn` still runs even if a previous call in the chain rejected -- one
    // branch's worktree-creation failure must not permanently jam every
    // later branch's turn at the lock.
    const next = prior.then(fn, fn)
    this.repoLocks.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  private async runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        results[i] = await fn(items[i])
      }
    }
    const workerCount = Math.max(1, Math.min(limit, items.length))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
  }

  /**
   * ADR-007, "Per-branch context isolation": walk one branch from its edge
   * target through to (but not including) the shared join node, using a
   * `Context.clone()` no other branch ever touches.
   *
   * ADR-008, "switch on first sight": the branch starts in the run's shared
   * `cwd`. The first node in its walk whose `attrs.branch_worktree ===
   * 'true'` is seen, ParallelHandler creates (under the per-repo mutex) an
   * isolated worktree and every remaining node in THIS branch dispatches
   * there instead. The worktree is removed in a `finally`, exactly once,
   * whether the branch converged, dead-ended, or threw.
   */
  private async walkBranch(ctx: HandlerCtx, edge: Edge): Promise<BranchResult> {
    const runBranchNode = ctx.runBranchNode
    if (runBranchNode === undefined) {
      // Only Engine.run() populates this. A hand-built HandlerCtx exercising
      // ParallelHandler directly (a unit test) must supply a stub -- this is
      // a caller-contract violation, not a graph-authoring or runtime error.
      throw new Error(
        'ParallelHandler requires HandlerCtx.runBranchNode; only Engine.run() populates it',
      )
    }

    const branchContext = ctx.context.clone()
    const visited: string[] = []
    let currentId: string | null = edge.to
    let branchCwd = ctx.cwd
    let usingIsolatedWorktree = false
    let worktree: Worktree | undefined

    try {
      while (currentId !== null) {
        const node = ctx.graph.nodes.get(currentId)
        if (node === undefined) {
          // TOPO-003 (dot/lint.ts) refuses an edge naming an unknown node at
          // design time; this is unreachable for a lint-clean graph and is
          // defensive only.
          return { edge, convergedTo: null, visited, finalContext: branchContext }
        }

        // Stop BEFORE dispatching the join node -- it is not part of this
        // branch's own walk, and it is Engine, not ParallelHandler, that
        // dispatches it (see ADR-007, "FanInHandler needs no handoff
        // channel"). Handler.EXIT stops the walk here too: a branch routing
        // into the run's own exit node is a graph-authoring error (a branch
        // is supposed to converge on the shared join, not the pipeline's own
        // terminal -- see StepResult's own doc comment in handlers/types.ts,
        // "a branch walk that reaches EXIT ... is caught by the caller, not
        // this type"). Reporting it as a convergence target that then fails
        // the "must resolve to Handler.FAN_IN" check below gives that error
        // a precise, loud message, naming the exit node, instead of letting
        // it disappear into the generic dead-end/orchestration-FAIL bucket a
        // silently-dispatched EXIT would otherwise fall into.
        if (node.handler === Kind.FAN_IN || node.handler === Kind.EXIT) {
          return { edge, convergedTo: currentId, visited, finalContext: branchContext }
        }

        if (!usingIsolatedWorktree && node.attrs.branch_worktree === 'true') {
          usingIsolatedWorktree = true
          const repoDir = ctx.repoDir ?? ctx.cwd
          worktree = await this.withRepoLock(repoDir, () => createWorktree(repoDir, `${ctx.node.id}-${edge.to}`))
          branchCwd = worktree.path
          ctx.events.append({
            type: 'node.parallel.branch_worktree',
            node: ctx.node.id,
            branch: edge.to,
            at: node.id,
            path: worktree.path,
          })
        }

        const step = await runBranchNode(currentId, branchContext, branchCwd)
        visited.push(currentId)
        currentId = step.nextId
      }
      // Dead end / unrouted FAIL inside the branch -- ordinary fail-fast /
      // dead-end handling for a branch's own nodes, exactly as it would be
      // for any node on the main path. Not this handler's own FAIL.
      return { edge, convergedTo: null, visited, finalContext: branchContext }
    } finally {
      if (worktree !== undefined) {
        const repoDir = ctx.repoDir ?? ctx.cwd
        const removal = removeWorktree(repoDir, worktree)
        if (removal.warning !== undefined) {
          ctx.events.append({
            type: 'node.parallel.worktree_warning',
            node: ctx.node.id,
            branch: edge.to,
            warning: removal.warning,
          })
        }
      }
    }
  }

  /**
   * ADR-007, "Why scoped to effectiveOutputs(), not every written key": the
   * union of `effectiveOutputs(n)` over every node `n` this branch actually
   * visited, intersected with the keys whose value in the branch's own final
   * context differs from the shared pre-branch baseline. Bare engine-managed
   * keys are excluded entirely -- they are per-node-visit routing signals,
   * about to be overwritten by FanInHandler's own dispatch regardless.
   */
  private contribution(
    graph: Graph,
    baseline: Record<string, string>,
    visited: string[],
    finalContext: Context,
  ): Map<string, string> {
    const declaredKeys = new Set<string>()
    for (const nodeId of visited) {
      const node = graph.nodes.get(nodeId)
      if (node === undefined) continue
      for (const key of effectiveOutputs(node)) {
        // Bare engine-managed keys only (ENGINE_MANAGED_KEYS -- 'outcome',
        // 'preferred_label', 'current_node'), NOT the full
        // isEngineManagedKey() namespace check. The full check ALSO covers
        // the 'tool.'/'graph.'/'internal.' PREFIXES, and 'tool.' is exactly
        // where ToolHandler's own legitimate, inferred dataflow contract
        // lives (TOOL_OUTPUT_KEYS) -- excluding it here would silently
        // refuse the one handler-owned output set this addendum's own Test
        // strategy names explicitly as required to survive merge-back.
        if (ENGINE_MANAGED_KEYS.includes(key)) continue
        declaredKeys.add(key)
      }
    }
    const result = new Map<string, string>()
    for (const key of declaredKeys) {
      const value = finalContext.get(key)
      if (value === undefined) continue
      if (value !== baseline[key]) result.set(key, value)
    }
    return result
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    const branches = outgoingEdges(ctx.graph, ctx.node.id)
    if (branches.length === 0) {
      // PAR-001 (dot/lint.ts) refuses this at design time; defended here too
      // since ParallelHandler can be exercised directly, bypassing lint.
      const msg = `node ${ctx.node.id} resolves to Handler.PARALLEL but has no outgoing edges to fan out to`
      return { status: Status.FAIL, notes: msg, failureReason: msg }
    }

    const maxParallel = resolveMaxParallel(ctx.node)
    ctx.events.append({
      type: 'node.parallel.start',
      node: ctx.node.id,
      branches: branches.length,
      maxParallel,
    })

    // Taken ONCE, before any branch dispatches -- every branch clones from
    // this same starting point, so it is the single correct "before" value
    // every branch's own contribution is diffed against.
    const baseline = ctx.context.snapshot()

    const results = await this.runPool(branches, maxParallel, (edge) => this.walkBranch(ctx, edge))

    // ADR-007, "Reaching the join node": every branch that reached a
    // convergence target at all must agree on the SAME one, and it must
    // resolve to Handler.FAN_IN. A branch that dead-ended (convergedTo ===
    // null) is not required to agree with anything -- its own FAIL is
    // FanInHandler's business via the nodeStatus ledger, not an
    // orchestration-level defect.
    const survived = results.filter((r) => r.convergedTo !== null)
    const targets = new Set(survived.map((r) => r.convergedTo as string))

    if (targets.size !== 1) {
      const msg =
        targets.size === 0
          ? `no branch of node ${ctx.node.id} reached a convergence target`
          : `branches of node ${ctx.node.id} converged on ${targets.size} distinct nodes: ${[...targets].join(', ')}`
      ctx.events.append({ type: 'node.parallel.end', node: ctx.node.id, status: Status.FAIL })
      return { status: Status.FAIL, notes: msg, failureReason: msg }
    }

    const fanInId = [...targets][0]
    const fanInNode = ctx.graph.nodes.get(fanInId)
    if (fanInNode === undefined || fanInNode.handler !== Kind.FAN_IN) {
      const msg = `branches of node ${ctx.node.id} converge on ${fanInId}, which does not resolve to Handler.FAN_IN`
      ctx.events.append({ type: 'node.parallel.end', node: ctx.node.id, status: Status.FAIL })
      return { status: Status.FAIL, notes: msg, failureReason: msg }
    }

    // ADR-007, "Conflict policy": branches reconciled in `outgoingEdges()`
    // (DOT source) order. The first branch, in that order, to write a given
    // key wins; a later branch writing a DIFFERENT value to the same key
    // does not overwrite it, and a node.parallel.context_conflict event
    // names the key, the winning branch, and the losing branch/value.
    const contextUpdates: Record<string, string> = {}
    const winningBranch: Record<string, string> = {}
    for (const r of results) {
      const contribution = this.contribution(ctx.graph, baseline, r.visited, r.finalContext)
      for (const [key, value] of contribution) {
        if (Object.hasOwn(contextUpdates, key)) {
          if (contextUpdates[key] !== value) {
            ctx.events.append({
              type: 'node.parallel.context_conflict',
              node: ctx.node.id,
              key,
              winningBranch: winningBranch[key],
              losingBranch: r.edge.to,
              losingValue: value,
            })
          }
          continue
        }
        contextUpdates[key] = value
        winningBranch[key] = r.edge.to
      }
    }
    if (Object.keys(contextUpdates).length > 0) ctx.context.merge(contextUpdates)

    ctx.events.append({
      type: 'node.parallel.end',
      node: ctx.node.id,
      status: Status.SUCCESS,
      fanIn: fanInId,
    })

    // ADR-007, "a targeted suggestedNextIds bypass, not a graph edge":
    // Engine's visitNode() special-cases exactly this handler kind, reading
    // nextId from suggestedNextIds[0] rather than selectEdge().
    return {
      status: Status.SUCCESS,
      suggestedNextIds: [fanInId],
      contextUpdates,
      notes: `${branches.length} branch(es) converged on ${fanInId}`,
    }
  }
}
