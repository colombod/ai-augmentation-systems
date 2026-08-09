# ADR-007: Parallel branches reuse Engine's per-node dispatch via a HandlerCtx callback; context is cloned per branch and merged back by declared/inferred contract only; the join is reached by a routing bypass, not selectEdge

**Status:** accepted
**Date:** 2026-08-09
**Deciders:** Solution Architect

## Context

FR-17b (`plugins/attractor/.delivery/prd.md`) resolves the product shape of parallel fan-out
(OQ3–5) but says so explicitly in its own text: "reconciling N branches converging on one join
node with the engine's single-Outcome-per-node `Handler.execute()`/`selectEdge()` dispatch
model is an undesigned Solution Architect question this decision does not answer."

`Engine.run()` (`core/engine.ts:605–1095`) walks exactly one node at a time: a `for` loop holds
one `currentId`, dispatches its handler, calls `selectEdge()` once, and advances. A branch is
not one node — it is a chain of arbitrary length (any mix of `box`, `parallelogram`, `diamond`,
etc.) that must go through the *exact same* eager-input-check (engine.ts:743–745), `runs_on`
handling, retry ladder (engine.ts:904–940), and ledger bookkeeping (`nodeFailures`,
`failedOutputs`, `gateOutcomes`, now also a new per-node status ledger — see below) that any
top-level node already gets. Re-deriving that machinery inside `ParallelHandler` would be
exactly the "duplicated machinery" failure mode this task's own brief warns against, and would
create a second implementation of eager-input-check/retry semantics that could silently drift
from the first — the same class of hazard this codebase has repeatedly extracted single
sources of truth to prevent (`TYPE_TO_HANDLER`, `TOOL_OUTPUT_KEYS`, `PASSTHROUGH_KINDS`, all
cited in `dot/graph.ts`'s own comments for exactly this reason).

Two further problems have no existing mechanism to lean on:

- **Context isolation.** `Context` (`core/context.ts:39–128`) is one mutable object with a
  flat `Map`. `BoxHandler`/`ToolHandler` both call `ctx.context.set`/`merge`/`takeWritten()`
  assuming single-node-at-a-time sequencing — `takeWritten()`'s own doc comment states this
  invariant explicitly ("the engine drains before dispatching a node and reads immediately
  after, so what it gets back is that node's writes and nothing else"). Two branches writing
  concurrently would race on this Map, and `takeWritten()`'s drain-then-read pattern breaks
  outright under concurrent callers.
- **Reaching the join node.** Every branch converges on one `Handler.FAN_IN` node, but by
  OQ3's own resolved design ("every outgoing DOT edge from a `component`-shaped node is a
  branch, structurally") the `component` node has **no direct graph edge to FAN_IN** — its
  edges ARE the branches. `selectEdge()` cannot resolve "the next node after the PARALLEL
  node" from graph edges the normal way, because those edges mean something else here.

## Decision

### 1. Extract `Engine.run()`'s per-node loop body into `private visitNode()`

```ts
private async visitNode(
  nodeId: string,
  context: Context,
  cwd: string,
  opts: { checkpoint: boolean },
): Promise<StepResult>
```

Covers everything the current loop body does from `this.path.push(node.id)` through resolving
what comes next — handler lookup, attempt tracking, `node.start`, `context.takeWritten()`
drain, eager-input-check, `runs_on` skip, dispatch (try/catch to FAIL), clearing
`failedOutputs` for written keys, `node.end`, both `recordOutcome` calls, the retry ladder
(in-place retries loop internally; an exhausted retry with a target returns that target as
`nextId` directly, bypassing edge selection — exactly today's `continue`-driven jump, now
expressed as a return), `attempts` reset, `completed` push, and a conditional `checkpoint()`
call gated by `opts.checkpoint`. It does **not** special-case `Handler.EXIT`'s goal-gate check
— that stays in `run()`, which still does its own `graph.nodes.get(currentId)` lookup and its
own EXIT branch exactly as today, calling `visitNode()` for the ordinary per-node work only.

One deliberate special case lives inside `visitNode()`'s own next-id resolution, not in
`selectEdge()` itself: **a `Handler.PARALLEL` node's next id is
`outcome.suggestedNextIds?.[0] ?? null`, not `selectEdge()`'s result.** Every other node kind
is unaffected. See "Reaching the join node" below for why.

`Engine`'s step-cap counter (today, `run()`'s local `for (let step = 0; ...)`) is promoted to
a private instance field, incremented once per `visitNode()` call — including in-place
retries, matching today's exact per-attempt accounting (a `continue` inside a `for` loop still
runs the increment clause). This is what makes NFR-1's 500-node-visit cap a true run-wide
invariant inclusive of every branch a fan-out dispatches, not a main-path-only count a
sufficiently wide fan-out could silently exceed.

`HandlerCtx` gains an optional `runBranchNode?: (nodeId, context, cwd) => Promise<StepResult>`,
populated by `Engine.run()` as a closure over `this.visitNode(nodeId, context, cwd, {
checkpoint: false })`. Only `ParallelHandler` reads it. Every other handler's `HandlerCtx` gets
the same field, unused — the same "seam exists for later, unused today" shape the interface
already has for `signal` (`handlers/types.ts:15–20`).

### 2. Per-branch context isolation: clone, don't share

`ParallelHandler` calls `ctx.context.clone()` (already exists, `context.ts:125–127`) once per
branch before dispatching it, and passes that clone — never the shared run context — into
every `runBranchNode` call for that branch's own walk. `BoxHandler`/`ToolHandler` need zero
changes: both already operate purely on whatever `Context` object `HandlerCtx.context` happens
to be.

After a branch finishes (reaches the join boundary, dead-ends, or fails), `ParallelHandler`
computes that branch's **contribution**: the union of `effectiveOutputs(n)` (`graph.ts:458–460`
— declared `outputs=` union inferred handler outputs, the exact contract the eager-input-check
already trusts) over every node `n` the branch actually visited, intersected with the keys
whose value differs between that branch's final context snapshot and the pre-branch baseline
snapshot.

**Why scoped to `effectiveOutputs()`, not every written key.** Two keys every `box` node
writes unconditionally — `last_stage`/`last_response` (`handlers/box.ts:49`, `BOX_CONTEXT_KEYS`)
— are deliberately NOT in `INFERRED_OUTPUTS_BY_HANDLER[Handler.CODERGEN]` (graph.ts:203,
"CODERGEN is the box handler, which infers nothing on purpose"). If merge-back covered every
written key, any two branches each containing a box node would "conflict" on these two
bookkeeping keys on every single run — noise on the single most common branch shape, not signal.
Scoping to `effectiveOutputs()` means only keys an author actually declared, or a handler
genuinely contracts to produce (e.g. `ToolHandler`'s `tool.last_line`/`tool.output`,
`TOOL_OUTPUT_KEYS`), cross the branch boundary — the identical contract a downstream node
already relies on for any *ordinary*, non-branched multi-node chain. **Bare engine-managed
keys** (`outcome`, `preferred_label`, `current_node` — `ENGINE_MANAGED_KEYS`, `context.ts:31`)
are excluded from merge-back entirely: they are per-node-visit routing signals, meaningless
once control returns to a shared point after N branches, and are about to be overwritten by
`FanInHandler`'s own dispatch regardless.

**Conflict policy.** Branches are reconciled in declaration order — the order `outgoingEdges()`
(graph.ts:131–133) returns them, i.e. DOT source order, the same deterministic tie-break
convention `selectEdge`'s own `byWeightThenTarget` and `directPredecessor`'s dedup rely on. The
first branch (in that order) to write a given key wins; a later branch writing a *different*
value to the same key does not overwrite it, and a `node.parallel.context_conflict` event is
appended naming the key, the winning branch, and the losing branch/value. This mirrors
`handlers/box.ts`'s own precedent for a forgery/collision the engine chooses not to treat as
fatal: "Recorded, not fatal ... The event log is the record every view over a run derives from,
so the attempt is auditable and alertable without being a denial of service" (box.ts:125–137).
A run that raced two branches into a context conflict has NOT failed because of it — the run's
own pass/fail is `FanInHandler`'s business per OQ5 — but the collision is never silent.

### 3. Reaching the join node: a targeted `suggestedNextIds` bypass, not a graph edge

A branch's own internal edges (`branch_tail -> fan_in`) are ordinary graph edges and resolve
through `selectEdge()` normally within the branch's own walk — nothing new there. What has no
edge is the `component` node's own routing to "whatever comes after the fan-out," because its
outgoing edges are branches, not routes.

`ParallelHandler` walks each branch (via `runBranchNode`, peeking at the next node's
`.handler` before dispatching it, stopping *before* calling `runBranchNode` on a node that
resolves to `Handler.FAN_IN`) and collects each branch's convergence target — the node id
`nextId` resolved to, right before the stop. It validates that every branch which reached a
non-null convergence target agrees on the *same* node id, and that this node resolves to
`Handler.FAN_IN`. If the set of distinct targets across surviving branches is not exactly one
node, or that node isn't `Handler.FAN_IN`, `ParallelHandler` returns `Status.FAIL` — an
orchestration-level defect, not a branch-level one — with no `suggestedNextIds`, and ordinary
fail-fast/dead-end handling applies exactly as it would for any other node's FAIL.

On success, `ParallelHandler` sets `Outcome.suggestedNextIds = [fanInNodeId]`. `visitNode()`
special-cases exactly this one handler kind: a `Handler.PARALLEL` node's `nextId` is read
directly from `suggestedNextIds[0]`, never from `selectEdge()`. This is not a new *category* of
bypass for this engine — `resolveRetryTarget`'s jumps already bypass `selectEdge()` entirely
(engine.ts:919–930, `currentId = target; continue`) — it is a third, narrowly-scoped instance
of the same shape: an explicit routing decision that graph edges cannot express, made by the
node itself rather than by edge conditions.

**Alternative considered and rejected: extend `selectEdge()` to understand a "structural" edge
kind.** Would have kept all routing logic in one function, but complicates `selectEdge()`'s
contract for every caller (every other handler kind) to serve exactly one handler's need. The
targeted special case in `visitNode()` is smaller, and `selectEdge()`'s existing, carefully
specified cascade (`edge-select.ts:57–74`) stays untouched and unrisked.

### 4. `FanInHandler` needs no handoff channel — it reads graph structure and a new status ledger

`FanInHandler` computes OQ5's formula from two independently-available things:

- `directPredecessors(graph, node.id)` — new, `graph.ts`, the plural sibling of the existing
  `directPredecessor` (graph.ts:151–156): every distinct source node with an edge into this
  node, self-loops excluded, no cardinality cap (FAN_IN's normal case is more than one).
- A new private `Engine` field, `lastOutcomeByNode: Map<string, Status>`, populated inside the
  *same two call sites* that already maintain `nodeFailures`/`failedOutputs`
  (`recordOutcome`, engine.ts:549–580; `recordAbandoned`, engine.ts:504–512) — so it can never
  disagree with those ledgers about what counts as a node's terminal outcome. Exposed via a new
  `HandlerCtx.nodeStatus?: (nodeId) => Status | undefined`.

`FanInHandler.execute()`: `statuses = directPredecessors(graph, node.id).map(p =>
ctx.nodeStatus?.(p.id))`; `successCount` = count of `SUCCESS`/`PARTIAL`; `failCount` = count of
`FAIL`; `status = successCount === 0 ? FAIL : failCount === 0 ? SUCCESS : PARTIAL` — OQ5's
formula verbatim. It writes `fan_in.success_count`/`fan_in.fail_count`/`fan_in.total`
(`FAN_IN_OUTPUT_KEYS`) as its own inferred outputs, mirroring `ToolHandler`'s
`TOOL_OUTPUT_KEYS` convention, and a `status.json` matching `BoxHandler`/`ToolHandler`'s
existing wire shape.

**Why not have `ParallelHandler` hand `FanInHandler` a summary directly** (via a context key,
or a file in `runDir`)? Two reasons. First, `FanInHandler` would then need to discover *which*
upstream `component` node produced the summary meant for it — nontrivial in general (multiple
fan-outs, nested fan-outs) and unnecessary. Second, a file- or single-key handoff depends on
`ParallelHandler` having run in the same process invocation immediately before — an
implicit coupling between two handler classes that this design avoids entirely by having
`FanInHandler` ask the engine itself, the one thing both share regardless of graph shape.

### Checkpointing branches

`visitNode()`'s `checkpoint: boolean` parameter is `false` for every `runBranchNode` call.
Two branches calling `saveCheckpoint()` concurrently would race on `checkpoint.ts`'s own
single-writer atomic-write mechanism (confirmed unsafe for concurrent writers — this is
precisely NFR-4's existing, documented gap, now reachable *within* one run rather than only
across two). Since resume-from-checkpoint has no reader in this slice at all (PRD non-goal:
"general checkpoint-based crash recovery ... no read-back mechanism exists"), skipping
per-branch checkpoints costs nothing this slice can use, and avoids manufacturing a new
instance of an already-known hazard. **Named limitation:** a crash mid-fan-out loses all
in-flight branch progress. This is consistent with, not worse than, today's engine losing an
in-flight node's own progress on a crash before its checkpoint — the granularity is unchanged,
just now spanning however many nodes a fan-out's branches contain instead of one.

## Alternatives considered

### A second, parallel-branch-specific copy of the dispatch loop inside `ParallelHandler`

**Why attractive:** no changes to `Engine`/`HandlerCtx` at all; fully contained in the new file.
**Why rejected:** duplicates eager-input-check, `runs_on` handling, the retry ladder, and every
ledger update — exactly the "second implementation that can silently drift from the first"
failure mode this codebase has repeatedly extracted single sources of truth to eliminate
(`TYPE_TO_HANDLER`, `TOOL_OUTPUT_KEYS`, `PASSTHROUGH_KINDS`, `SUBSTITUTABLE_ATTRS` — all cited
for this exact reason in `dot/graph.ts`'s own comments). A bug fixed in the main loop (e.g. a
future correction to the eager-input-check) would not automatically apply to branches.

### Unscoped context merge-back (every key a branch wrote, not just `effectiveOutputs()`)

**Why attractive:** simpler to state ("whatever changed, merge it").
**Why rejected:** floods the shared context with every branch's own bookkeeping
(`last_stage`/`last_response` on every box-node branch) and manufactures conflicts on keys that
were never meant to be a dataflow contract in the first place — precisely the shape
`INFERRED_OUTPUTS_BY_HANDLER`'s deliberate `[]` for `CODERGEN` exists to prevent for ordinary,
non-branched nodes too.

### `ParallelHandler` dispatches `FanInHandler` internally, bypassing the engine's own dispatch

**Why attractive:** avoids inventing `directPredecessors`/`nodeStatus`; `ParallelHandler`
already has every branch outcome in hand.
**Why rejected:** `Handler.FAN_IN` would then never go through `visitNode()`'s own
eager-input-check, ledger updates, `node.start`/`node.end` events, or checkpoint — a second,
inconsistent dispatch path for exactly one node kind, and the run's `path`/`completed` records
would need special-casing to still show the join node as visited. Letting the engine dispatch
`Handler.FAN_IN` exactly like any other node, and having it derive its verdict independently,
keeps every node in the run going through the one dispatch path this whole addendum exists to
preserve.

## Consequences

**We gain:** parallel fan-out composes with every existing engine feature for free — retries,
`runs_on`, the eager-input-check, goal gates inside a branch, checkpointing on the main path —
because branches are dispatched through the identical mechanism, not a parallel approximation
of it. Nested fan-out (a `component` node inside a branch) is not required by this slice and is
untested, but is not structurally prevented either — `runBranchNode` is just another bound
closure over `visitNode`, available to any handler a branch happens to dispatch.

**We accept:** `visitNode()`'s extraction touches the most heavily-commented, most
carefully-reasoned 300 lines in this codebase (`engine.ts:605–1095`). The refactor must be
verified behavior-preserving against the *entire* existing `engine.test.ts` suite before any
new parallel-fan-out test is trusted — see the architecture addendum's Test strategy. We also
accept that a crash mid-fan-out loses more in-flight work than a crash mid-single-node did
(bounded by however many nodes the fan-out's branches contain), a direct, named consequence of
not checkpointing branches.

**We will need to revisit this if:** checkpoint/resume is ever built out for this engine
(currently a PRD non-goal) — at that point, either branch checkpointing needs its own
concurrency-safe mechanism (a superset of what `checkpoint.ts` provides today), or resume needs
to explicitly define what "resuming into a fan-out" means, neither of which this ADR attempts
to answer.
