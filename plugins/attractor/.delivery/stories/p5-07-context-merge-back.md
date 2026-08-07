<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-07
title: Merge a branch's Context writes back deterministically after it settles, plus PAR-003
status: ready
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b]
depends_on: [p5-05, p5-01]
size: M
---

# Merge a branch's Context writes back deterministically after it settles, plus PAR-003

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

A **branch**'s ordinary `Context` writes — an author's `outputs=`/`contextUpdates` evidence —
actually reach the run's real `Context` and everything dispatched after the **convergence node**,
via a new `mergeBranchContext` function applied deterministically, in branch-declaration order,
logging every collision rather than silently letting the last one win unlogged. Ships alongside
PAR-003 (WARNING), the design-time complement that flags a *declared* collision between two
branches before a run starts.

## Context

Nothing in the design as first written ever copied a branch's writes back out — `Context.clone()`
(`context.ts:125-127`) produces a fully independent `Map` with no merge-back method. Finding F1's
concrete demonstration: three branches each run a `CODERGEN` node declaring
`outputs="implementation.path"`. All three succeed inside their own clones; `recordOutcome`
(shared ledger, p5-05) sees SUCCESS and clears `failedOutputs`, so nothing flags a problem — but
the convergence node, dispatched afterward in the run's own **un-cloned** `Context`, substitutes
an empty or stale value for `${implementation.path}`. No branch's clone was ever the real
`Context`, and nothing ever moved the value across. A `goal_gate=true` node downstream can be
"satisfied" against evidence that was never delivered — the exact silent-success class
`AGENTS.md`'s doctrine exists to prevent, one layer below where the eager-input check and
`isEngineManagedKey` already look. This is a genuine gap in amplifier too — no port to make; this
is new design (ADR-010).

**Declaration order, not completion order.** Completion order depends on real subprocess timing,
not reproducible run-to-run — a collision's winner would be nondeterministic, the exact defect F3
describes for `gateOutcomes` reintroduced here for ordinary context keys. Declaration order is
fixed by the graph text and is the same order branches are dispatched in.

**Only SUCCESS/PARTIAL branches merge.** Mirrors `recordOutcome`'s own rule that only a
SUCCESS/PARTIAL re-execution settles a debt — a FAILED branch's partial writes are not trusted
evidence, applied here to a branch's aggregate result rather than one node.

**`tool.`-prefixed keys ARE merged; the three bare `ENGINE_MANAGED_KEYS` are not.** A `TOOL` node
inside a branch writing `tool.last_line` is exactly as much branch evidence as an author's own
`outputs=` key — blanket-excluding it would reopen F1's own gap for that namespace. The filter is
the bare-key list (`context.ts:31` — `outcome`, `preferred_label`, `current_node`), **not**
`isEngineManagedKey`'s broader prefix check — those three are per-traversal-position bookkeeping
the branch's own reuse of `executeNodeStep` necessarily wrote, and the outer run overwrites all
three immediately after `ParallelHandler` returns regardless (p5-08, not this story).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/handlers/types.ts` | modify — `BranchRunResult` gains `context: Record<string, string>` (extends the `{outcome, path}` interface p5-05 created) |
| `plugins/attractor/engine/src/core/engine.ts` | modify — `runBranch` (p5-05) populates `context` via `Context.snapshot()` at the moment its traversal stops |
| `plugins/attractor/engine/src/handlers/parallel.ts` | **create** — exports only `mergeBranchContext`; `ParallelHandler` class itself is p5-08's addition to this same file |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — add PAR-003 (WARNING) near PAR-001/002/004 (p5-04) |
| `plugins/attractor/engine/test/parallel.test.ts` | **create** — unit tests for `mergeBranchContext`, driven by hand-built `BranchRunResult`s (no `ParallelHandler` needed) |
| `plugins/attractor/engine/test/lint.test.ts` | modify — PAR-003 fixtures |
| `plugins/attractor/README.md` | modify — add PAR-003 to `## Lint rules` |

## Interfaces and contracts to honor

```ts
// handlers/types.ts — BranchRunResult, extended (p5-05 created {outcome, path})
export interface BranchRunResult {
  outcome: Outcome
  path: string[]
  context: Record<string, string>   // NEW — Context.snapshot() at the moment the branch stopped
}

// handlers/parallel.ts (NEW file, this story's own exported function)
/** Called once per PARALLEL dispatch (by p5-08's ParallelHandler, not built yet), after every
 * branch has settled. For each branch IN BRANCH-ROOT DECLARATION ORDER whose outcome.status is
 * SUCCESS or PARTIAL: merge every key in its context snapshot that differs from
 * preforkSnapshot, except the three bare ENGINE_MANAGED_KEYS, into parentContext. A later
 * branch's value for a key an earlier branch already merged wins and is logged via
 * node.parallel.context_collision -- never silent. */
export function mergeBranchContext(
  parentContext: Context,
  preforkSnapshot: Record<string, string>,   // parentContext.snapshot(), taken BEFORE any clone
  branchRootIds: readonly string[],          // declaration order = merge order
  results: readonly BranchRunResult[],       // same order as branchRootIds
  events: EventLog,
): void

// dot/lint.ts — new diagnostic code
// PAR-003, WARNING: two or more of a component node's branches' own declaredOutputs() sets
//   intersect -- design-time complement to the runtime collision log; blind to inferred keys
//   like tool.last_line, sees only declared outputs=
```

## Relevant design decisions

- **ADR-010** is this story's entire content, including both rejected alternatives: merging every
  branch regardless of status (rejected — trusts unproven partial work), and merging in
  completion order (rejected — nondeterministic winner).
- **Scope boundary with p5-08:** this story creates `handlers/parallel.ts` with only
  `mergeBranchContext`; p5-08 adds the `ParallelHandler` class to the same file and is the one
  that actually *calls* `mergeBranchContext` from a real dispatch. No merge conflict expected —
  additive to the same file, different exports.

## Acceptance criteria

- [ ] `FR-17b` — `BranchRunResult.context` is populated by `runBranch` via `Context.snapshot()`.
- [ ] `FR-17b` — happy path: three branches each declare a **distinct** key; the convergence
      node's `${key}` substitution (tested by calling `mergeBranchContext` then reading the
      merged `Context`) reads each branch's real value.
- [ ] `FR-17b` — **exact F1 reproduction:** three branches each declare the SAME key
      (`outputs="implementation.path"`), all SUCCEED, completion driven out of declaration order
      via `GatedBackend`; pre-fix (no `mergeBranchContext` call) fails red; post-fix the merged
      value is the THIRD (last-declared) branch's, and exactly two `node.parallel.context_collision`
      events are logged — not zero, not one.
- [ ] `FR-17b` — two-branch collision, completion order driven opposite declaration order via
      `GatedBackend`: the later-by-**declaration**-order branch's value wins; one collision event logged.
- [ ] `FR-17b` — a branch's `tool.last_line` write IS merged and readable; a branch's
      `current_node`/`outcome`/`preferred_label` writes are NOT merged (the outer run's own
      post-return values are asserted still in effect).
- [ ] `FR-17b` — a FAILED branch's partial key write is NOT merged (contrast with the happy path).
- [ ] `FR-17b` — PAR-003 fires WARNING when two or more branches' `declaredOutputs()` sets
      intersect; does not see `tool.last_line`-class inferred collisions (named, not a defect).
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit, `test/parallel.test.ts` (new) for `mergeBranchContext` — driven by hand-built
`BranchRunResult[]` arrays and a real `Context`, no `ParallelHandler` required; `lint.test.ts` for
PAR-003. Two rows (exact F1 reproduction, two-branch collision) need `GatedBackend` (p5-01) to
drive completion order out of declaration order — a synchronous fixture cannot distinguish the two
orderings, per the architecture's own mutation-check note.

**Cases:** the seven rows in Acceptance criteria above are the QA-strategist-equivalent coverage
matrix this story ships against — each is independently load-bearing per the architecture's own
Test-strategy table (none is eligible for a later cut list).

**Run with (from `plugins/attractor/engine`):** `node --test test/parallel.test.ts test/lint.test.ts`
(targeted) or `node --test` (full — baseline today: 508 tests, 507 passing, 1 skipped, 0 failing).

## Out of scope

- `ParallelHandler` class, `max_parallel` semaphore, branch worktree creation, calling
  `mergeBranchContext` from a real dispatch — p5-08 (item I).
- Extending PAR-003 to catch inferred-key collisions (`tool.last_line`) — named residual risk in
  ADR-010's own Consequences, a future PAR-006, not this slice.

## Dependencies

- **p5-05 (item F)** — `BranchRunResult`/`runBranch` must exist; this story extends the interface.
- **p5-01 (item B)** — `GatedBackend` needed for the two completion-order-independence rows above.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
