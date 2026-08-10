# ADR-010: A branch's ordinary `Context` writes are merged back deterministically, and only from branches that ended SUCCESS or PARTIAL

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect
**Resolves:** feature-critic finding F1 (serious)

## Context

`ParallelHandler` clones `Context` once per branch (ADR-007, Answer 2) so branches do not
clobber each other's writes while running concurrently. Nothing in the design as first written
ever copied a branch's writes back out. `BranchRunResult` carried only `{outcome, path}` —
no context snapshot — and `Context.clone()` (`context.ts:125-127`) produces a fully
independent `Map` with no merge-back method anywhere in `Context`.

The consequence, demonstrated concretely by the critic finding: three branches each run a
`CODERGEN` node declaring `outputs="implementation.path"`. All three succeed — inside their own
clones. `recordOutcome` (shared, per ADR-009) sees SUCCESS on the *ledger* side and clears
`failedOutputs`, so the eager-input-check has nothing to flag; DATA-001 is satisfied because the
key is declared *somewhere*. But the convergence node, dispatched afterward in the run's own
**un-cloned** `Context`, substitutes an empty or stale value for `${implementation.path}` — no
branch's clone was ever the run's real `Context`, and nothing ever moved the value across. A
`goal_gate=true` node downstream can be "satisfied" against evidence that was never actually
delivered — the exact silent-success class `AGENTS.md`'s doctrine exists to prevent,
reintroduced one layer below where the engine's existing guards (the eager-input check,
`isEngineManagedKey`) look.

This is a genuine gap in amplifier too, not a place attractor diverged from working precedent:
`amplifier-precedent.md` §2 documents amplifier's own branch isolation as "`context.clone()` per
branch plus a cloned engine/handler registry" with no merge-back step described anywhere in the
read source. There is no port to make here; this ADR is new design.

## Decision

`BranchRunResult` gains a `context: Record<string, string>` field — the branch's own `Context`,
snapshotted (`Context.snapshot()`, already exists) at the moment its traversal stopped. Full
snapshot, not a diff computed inside `runBranch`: `runBranch` should not need to know what "the
pre-fork state" was in order to report faithfully what its branch ended with; the diff is
computed by the caller that already has both snapshots, `ParallelHandler`.

`ParallelHandler` gains a new exported function, called after every branch in the fan-out has
settled and before `ParallelHandler.execute` returns:

```ts
export function mergeBranchContext(
  parentContext: Context,
  preforkSnapshot: Record<string, string>,   // parentContext.snapshot(), taken BEFORE cloning
  branchRootIds: readonly string[],          // dispatch/declaration order = merge order
  results: readonly BranchRunResult[],       // same order as branchRootIds
  events: EventLog,
): void
```

For each branch, **in branch-root declaration order** (the same order `ParallelHandler` reads
the component node's outgoing edges in, not completion order — completion order is
nondeterministic under real subprocess timing and must not be load-bearing for the merged
result):

1. Skip the branch entirely if its `outcome.status` is not `SUCCESS` or `PARTIAL`. A FAILED
   branch's partial writes are not trusted evidence — this mirrors `recordOutcome`'s own rule
   that only a SUCCESS/PARTIAL re-execution settles a debt (`engine.ts:566-575`), applied here
   to a branch's aggregate result rather than a single node's.
2. For every key present in the branch's `context` snapshot that is absent from
   `preforkSnapshot`, or whose value differs from `preforkSnapshot`'s: if the key is one of
   `ENGINE_MANAGED_KEYS` (`context.ts:31` — `outcome`, `preferred_label`, `current_node`; the
   bare-key list, **not** `isEngineManagedKey`'s prefix check), skip it — these are
   per-traversal-position bookkeeping the branch's own reuse of the shared per-node step logic
   necessarily wrote (`setManaged('current_node', ...)` etc., per ADR-009), and the outer run
   overwrites all three immediately after `ParallelHandler` returns regardless (the component
   node's own `recordOutcome` call sets `outcome`/`preferred_label` from the join policy's
   result; the next dispatched node's `setManaged('current_node', ...)` sets that). Merging them
   would be transiently wrong and permanently pointless.
3. Otherwise, call `parentContext.merge({ [key]: value })`. If a **later** branch (in
   declaration order) writes a value for a key an **earlier** branch already merged, that is a
   real collision — log it via a new `node.parallel.context_collision` event (branch id, key,
   the value being overwritten, the value replacing it) and let the later value win. Silence is
   what `AGENTS.md`'s doctrine forbids; a deterministic, logged overwrite is not the same defect
   as an unlogged race.

`tool.`-prefixed keys are **not** excluded from step 2, deliberately — a `TOOL` node inside a
branch writing `tool.last_line` is exactly as much branch evidence as an author's own
`outputs=` key, and a convergence node referencing `${tool.last_line}` would hit the same silent
gap F1 describes if this namespace were blanket-excluded. `graph.*` keys need no special case:
they are seeded once, before any branch is cloned, so a branch's snapshot never differs from
`preforkSnapshot` for them and step 2's diff already excludes them by construction.

## Alternatives considered

### Merge every branch's writes regardless of outcome status

**Why it was attractive:** simpler rule, no status check; a FAILED branch may have produced
some genuinely-real partial work before the node that failed it.
**Why rejected:** this makes an unproven, abandoned branch's mid-flight state indistinguishable
from a completed one's — a downstream node reading `${implementation.path}` from a branch that
crashed on node 3 of 5 would see whatever nodes 1-2 happened to write, presented with the same
confidence as a fully successful branch's output. `recordFailedOutputs`/`failedOutputs` already
draw exactly this line for a single node (a FAILED node's `outputs=` keys are marked owed, not
trusted); extending the same posture to a branch's aggregate result is consistency, not a new
policy.

### Merge in completion order (first branch to resolve wins ties, or writes freely as it resolves)

**Why it was attractive:** no extra bookkeeping — just apply each branch's diff as its
`Promise` settles, inside the existing `Promise.all`.
**Why rejected:** completion order depends on real subprocess timing (a `claude -p` child's
actual wall-clock duration), which is not reproducible run-to-run for the same graph and the
same inputs. A collision's winner would be nondeterministic — the exact defect finding F3
describes for `gateOutcomes` under partial reconvergence, reintroduced here for ordinary
context keys. Declaration order is fixed by the graph text and is the same order
`ParallelHandler` already iterates to dispatch branches, so it costs nothing extra to use as
the tie-break.

### Diff computed inside `runBranch`, `BranchRunResult` carries only a delta

**Why it was attractive:** smaller payload; keeps "what changed" close to where the branch
executed.
**Why rejected:** `runBranch` would need the pre-fork snapshot threaded in just to diff against
it — an extra parameter on `BranchRunOptions` whose only job is enabling a diff the caller could
compute just as well itself, since `ParallelHandler` already holds `preforkSnapshot` (it took
it before calling `Context.clone()` for every branch). Keeping `runBranch` s job to "report what
you ended with" and `ParallelHandler`'s job to "decide what counts as a diff, and in what
order" keeps the diff/collision *policy* in the one place ADR-009 already made responsible for
join policy, rather than splitting it across two files.

## Consequences

**We gain:** a branch's `outputs=`/`contextUpdates` evidence actually reaches the convergence
node and everything downstream of it — closing the exact silent-success gap F1 demonstrated —
with a deterministic, logged collision rule rather than an unstated one.

**We accept:** two or more branches writing the *same* context key (whether an author's own
`outputs=` key or a built-in-but-not-bare key like `tool.last_line`) resolves by declaration
order, silently correct but easy for a graph author to get wrong if they did not intend the
collision. A design-time complement, PAR-003 (WARNING), flags this statically wherever
possible — see the architecture document's FR-17b lint additions — but PAR-003 can only see
*declared* (`outputs=`) collisions, not ones arising from inferred keys like `tool.last_line`
that only a live run would reveal; that residual gap is named in the Risks table, not
silently accepted.

**We accept:** `mergeBranchContext` adds one more O(branches × keys) pass per `PARALLEL` node
dispatch. Bounded by `max_parallel` (default 4) and typical context sizes; not a
performance concern worth a spike on its own, but Spike 11 (architecture document) verifies the
mechanism end to end against a real collision, not just the no-collision case a happy-path unit
test would exercise.
