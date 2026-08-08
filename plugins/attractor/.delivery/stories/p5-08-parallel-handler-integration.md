<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-08
title: Register Handler.PARALLEL — ParallelHandler fans out, bounds, joins, and merges branches
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b, NFR-7]
depends_on: [p5-01, p5-03, p5-04, p5-05, p5-07]
size: L
---

# Register Handler.PARALLEL — ParallelHandler fans out, bounds, joins, and merges branches

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item A — resolved

This is Phase 5's true integration point, deliberately last, and was drafted rather than ready
because two narrow Solution Architect decisions (roadmap's work-item A) were open. Both are now
resolved in
[ADR-013](../decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md) (accepted
2026-08-08), authoritative here — not re-derived:

- **A(a).** On a SUCCESS or PARTIAL join outcome, the engine jumps unconditionally to the
  statically-computed **convergence node** (`findConvergenceNode`'s own result). On FAIL, no jump
  — the ordinary §3.7 `retry_target`/`fallback_retry_target`/dead-end ladder runs, exactly as for
  any other node.
- **A(b).** Each branch's entire dispatch — worktree creation (if isolated), the `ctx.runBranch`
  call, and worktree removal — is wrapped in one try/catch/finally converting any thrown
  exception into that branch's own FAIL `Outcome`, before it can reach `Promise.all`.
  `Promise.all` stays the aggregation primitive; nothing switches to `Promise.allSettled`.

**Not optional scope, corrected by the ADR:** A(a) needs an additive branch inside the *shared*
`executeNodeStep` (`core/engine.ts`), not something `ParallelHandler.execute()` can do alone —
`selectEdge` (`edge-select.ts:75`), called on the component node's own outgoing edges, can never
select the convergence node, since those edges are the branch roots. Reflected below.

## Goal

`ParallelHandler` — a new, dependency-free `Handler` — fans out to every **branch** root bounded
by `max_parallel` (default 4), creates one **branch worktree** per branch unless the edge's
`isolate` attribute is `"false"`, applies the default **join policy** (FAIL iff zero branches
SUCCEED/PARTIAL), calls `mergeBranchContext` (p5-07) after every branch settles regardless of the
join verdict, and returns the aggregate `Outcome` like any other handler. `defaultHandlers()`
gains `[Kind.PARALLEL, new ParallelHandler()]`; `UNREGISTERED_HANDLER_KINDS` loses
`Handler.PARALLEL` as this story's own **last** line, not an earlier one — lint must keep
refusing `PARALLEL` nodes until a real handler exists to run them (HAND-001's own posture).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/handlers/parallel.ts` | modify — add `ParallelHandler` class to the file p5-07 already created (`mergeBranchContext` lives there); each branch's dispatch function wraps `createWorktree` → `ctx.runBranch` → `removeWorktree` in one try/catch/finally converting any thrown exception to that branch's own FAIL `Outcome` (ADR-013 A(b)) before the per-branch promises reach `Promise.all` |
| `plugins/attractor/engine/src/core/engine.ts` | modify — `defaultHandlers()` gains the `PARALLEL` entry; `executeNodeStep` (private method, `engine.ts:656-853` today) gains one additive branch (ADR-013 A(a)): on a `Handler.PARALLEL` node's SUCCESS/PARTIAL outcome, bypass `selectEdge` and continue at `findConvergenceNode(graph, branchRootIds, node.id)`'s own result instead — placed after the existing `Kind.EXIT` check (`engine.ts:812-814`), before the existing `selectEdge` call (`engine.ts:816`); FAIL is unchanged — the existing ladder at `engine.ts:816-824` already does the right thing |
| `plugins/attractor/engine/src/dot/graph.ts` | modify — remove `Handler.PARALLEL` from `UNREGISTERED_HANDLER_KINDS`, **last line of this story** |
| `plugins/attractor/engine/test/parallel.test.ts` | modify — add `ParallelHandler`-level tests, including the two rows ADR-013 unblocks |

## Interfaces and contracts to honor

```ts
// handlers/parallel.ts
export class ParallelHandler implements Handler {
  // No constructor args -- everything from HandlerCtx (ctx.cwd, ctx.runBranch, ctx.graph,
  // ctx.node, ctx.events). defaultHandlers(backend)'s own signature is unchanged.
  async execute(ctx: HandlerCtx): Promise<Outcome>
}
export function applyDefaultJoinPolicy(results: readonly BranchRunResult[]): Outcome
// FAIL iff zero results have status SUCCESS or PARTIAL; else SUCCESS iff zero FAIL; else PARTIAL.

// New node attribute: max_parallel (int, default 4)
// New edge attribute: isolate ("true" default | "false") -- opts one branch out of its own
//   branch worktree
```

## Relevant design decisions

- **ADR-007, ADR-008, ADR-009, ADR-010, ADR-011** all converge here — this handler is the sole
  consumer of every seam the other Phase 5 stories built.
- **ADR-013** (roadmap item A) — see "Roadmap item A — resolved" above; full reasoning,
  alternatives considered and residual risks live in the ADR, not repeated here.

## Acceptance criteria

- [x] `FR-17b`/`NFR-7` — a semaphore bounded by `max_parallel` (default 4) admits at most that
      many concurrent `runBranch` calls; verified with `GatedBackend` at `max_parallel=1`,
      `=branch count`, `=branch count - 1` (one branch queues and picks up the freed slot).
- [x] `FR-17b` — one `createWorktree` per branch unless the edge's `isolate="false"`; `removeWorktree`
      runs per-branch immediately after that branch's own `runBranch` resolves, not deferred to a
      top-level `finally`.
- [x] `FR-17b` — `applyDefaultJoinPolicy` returns FAIL iff zero branches SUCCEED/PARTIAL, SUCCESS
      iff zero FAIL, PARTIAL otherwise — all-fail/all-success/mixed/one-branch/zero-branch cases.
- [x] `FR-17b` — `mergeBranchContext` is called exactly once per dispatch, after every branch has
      settled, regardless of the join verdict — not gated on the component node's own outcome.
- [x] `FR-17b` — `defaultHandlers()` registers `ParallelHandler` for `Kind.PARALLEL`;
      `UNREGISTERED_HANDLER_KINDS` no longer includes it (this story's last line).
- [x] `FR-17b` — **retry/partial-completion interacting with convergence** (not blocked on A — a
      join-policy/merge-back interaction, not a FAIL-routing one): three branches, one exhausts
      retries and fails a node with a declared `outputs=` key the convergence node consumes;
      assert the convergence node is correctly blocked by the existing `failedOutputs`
      eager-input-check (exercised under branch partiality for the first time here), not silently
      fed a stale or empty value by `mergeBranchContext`'s own FAIL-branch exclusion (p5-07).
- [x] `FR-17b` — **A(a):** join outcome SUCCESS or PARTIAL (one branch fails, others succeed) —
      `executeNodeStep` bypasses `selectEdge` for the component node and continues at
      `findConvergenceNode(graph, branchRootIds, node.id)`'s own result, appearing in `path`
      exactly once, immediately after the component node. Join outcome FAIL (every branch
      fails) — the convergence node is never dispatched; with a `retry_target` on the component
      node the run continues there (`engine.ts:816-824`, unmodified); without one it dead-ends
      FAIL, same as any other node.
- [x] `FR-17b` — **A(b):** a real `createWorktree` throw on one isolated branch (forced via a
      non-git-repo `cwd`) does not reject `Promise.all`; that branch's `BranchRunResult` is FAIL
      with the caught error's message in `failureReason`, and an `isolate="false"` sibling
      completes normally, unorphaned. Separately: a hand-built `HandlerCtx` whose `runBranch`
      rejects for one branch root — `ParallelHandler.execute()` still resolves (never rejects),
      folding the rejected branch into the join policy as FAIL.

## Test approach

**Level:** integration, `GatedBackend`-driven (p5-01) — concurrency ceiling, worktree lifecycle,
join-policy verdicts, merge-back-after-join-regardless-of-verdict, plus the two rows ADR-013
unblocks (architecture's own Test-strategy table marked both "cannot be written until A resolves"
— not an oversight). One 3-branch fixture, reused across three join outcomes (all SUCCEED; one
FAILs + two SUCCEED; all FAIL), covers A(a). A(b)'s real-throw row needs one branch's `cwd`
pointed at a non-git-repo temp dir (isolated, forces a real `createWorktree` throw) beside an
`isolate="false"` sibling completing via `GatedBackend.release`; its rejecting-`runBranch` row
needs a hand-built `HandlerCtx` (no real `Engine`) with a stub `runBranch` — the real
`Engine.runBranch` cannot currently be made to reject (`executeNodeStep` already catches a
handler-level throw; `engine.test.ts:4644`), so this is the only way to exercise
`ParallelHandler`'s own catch. `removeWorktree` cannot itself throw (`worktree.ts:201` returns a
`RemovalResult`) — its `finally` coverage there is defensive, not independently testable, the
same reasoning ADR-013 gives against switching to `Promise.allSettled`.

**Run with (from `plugins/attractor/engine`):** `node --test test/parallel.test.ts` (targeted,
once it exists) or `node --test` (full).

## Out of scope

- **Re-deriving A(a)/A(b).** Already resolved — ADR-013 is authoritative; this story consumes
  the answer.
- **Item J's remaining rows, spun into `p5-09`.** Most of item J is already covered elsewhere:
  `GatedBackend` and the worktree-name-collision test shipped in p5-01; the shared-ledger race
  property is substantively demonstrated by p5-05's own test; concurrency-ceiling enforcement and
  branch-throws mid-flight are this story's own acceptance criteria above. Two rows still need a
  real `ParallelHandler` to be non-decorative and don't fit this story's own vertical slice
  (registration/fan-out/join/merge-back): checkpoint isolation under a real fan-out, and the
  opt-in `ATTRACTOR_LIVE=1` real-subprocess ceiling test. `p5-09` covers exactly those two.
- **PAR-005/A(a) authoring guidance** (a component node's outgoing edge cannot be a
  distinguishable fail edge — ADR-013's own residual risk) — doc-only, roadmap cut-list item 3,
  not this story.

## Dependencies

p5-01, p5-03, p5-04, p5-05, p5-07 must be `done` first; this handler is their sole integration
point. Roadmap item A (the two Solution Architect decisions above) is resolved via ADR-013 and no
longer a blocker.

## Implementation notes

Shipped across three sequential commits on `worktree-attractor-parallel-fanin`, each independently
tested and reviewed before the next began:

- `030c927` — `applyDefaultJoinPolicy` + a minimal counting `Semaphore`, both in `handlers/parallel.ts`.
- `03b0d8b` — `ParallelHandler` itself (fan-out, worktree lifecycle with ADR-013 A(b) catch/convert,
  join policy, merge-back). Tested end-to-end via the established `Handler.TOOL`-override workaround
  (registering `ParallelHandler` against an already-lint-clean handler kind), since `Handler.PARALLEL`
  was still unregistered at this point.
- `0951929` — two review-fix commits' worth of fixes in one: **(1)** `max_parallel="0"` (or negative)
  previously deadlocked `Promise.all` forever — a non-positive value survived `intAttr(...) ??
  DEFAULT_MAX_PARALLEL` unchanged, starting the semaphore with zero permits; fixed with a
  `Math.max(1, ...)` floor. **(2)** an `EventLog.append` failure while logging a worktree-removal
  warning, or inside `mergeBranchContext`'s own collision logging, could escape `execute()` entirely
  and reject the whole dispatch — violating "one branch's failure never escapes the dispatch," ADR-013's
  entire point. Fixed by locally swallowing the worktree-warning append and converting a merge-back
  throw into a `FAIL` `Outcome` instead of letting it propagate. Both were found by an independent
  adversarial review agent with concrete, reproduced failure scenarios (not merely suspected), and
  both are now permanently pinned by regression tests.
- `6391286` — registration (`defaultHandlers()` gains `[Kind.PARALLEL, new ParallelHandler()]`) and the
  ADR-013 A(a) convergence-jump inside `executeNodeStep`, together in one commit (registration without
  the jump would let a SUCCESS/PARTIAL outcome fall through to `selectEdge`, which can never select the
  convergence node). `UNREGISTERED_HANDLER_KINDS` loses `Handler.PARALLEL` last, as specified. This
  commit also fixed nine existing tests whose premise ("`Handler.PARALLEL` is unregistered, so HAND-001
  co-fires") became false, plus two more the same run surfaced that weren't in the original list, and
  added a real `Engine.run()` end-to-end test over a genuine `shape=component` node.

**Two adversarial review passes ran against `handlers/parallel.ts`/`engine.ts`**, matching the discipline
established across sprint 2: one after `03b0d8b` (which is what found the two bugs above), and one after
`6391286` (spec-compliance + a dedicated bug hunt). The second pass's report claimed a "concrete
reproduction of a nested-PARALLEL double-dispatch scenario against the real engine" with no defects
found — this sprint's own formal `/delivery:sprint-review` later found that claim left no test artifact
and could not be independently confirmed from it alone (`nested`/`double-dispatch` greps across the test
suite find nothing). The review's own `feature-critic` pass built three independent nested-component-node
graphs and reproduced "no double dispatch" itself, directly — so the underlying claim holds, but the
lesson is process, not code: an adversarial review that reports a reproduction should leave the
reproduction as an artifact, not merely a narrative, even for a negative result.

**One coverage gap and one real, previously-flagged bug were caught during the formal sprint review, both closed before acceptance — not carried as debt:**

- **ADR-013 A(a)'s FAIL side was untested for routing**, not merely under-tested — the only all-FAIL
  fixture predated real registration, used the `Handler.TOOL` workaround, and checked only a status
  field, never `result.path` or a `retry_target` scenario. Found by the review's own independent QA
  pass; closed with two new tests against the real registered handler (`9887e0f`) — both passed
  immediately against the existing implementation, so this was a coverage gap, not a bug.
- **R-sprint2-1** (`.delivery/reviews/sprint-2-01.md`) — a concurrent-`git worktree add` race,
  `open`/`significant` since sprint 2, whose own resolution note said it had to be fixed "before p5-08's
  `max_parallel` branches makes this reachable in production." It arrived, unfixed, in this story's own
  first four commits — `ParallelHandler` ships concurrent, isolated worktree creation as its *default*.
  Found by the sprint review's own `feature-critic` pass, fixed in `src/run/worktree.ts` (`8a50506`):
  a bounded, short-backoff retry on the exact race pattern, `-b`→`-B` on retry (the failed attempt
  already creates the branch ref). Verified empirically at amplified concurrency: ~15% trial failure
  pre-fix, 0 failures across 6300+ calls post-fix. Finding marked `fixed`.

**No deviations from ADR-013.** All 8 acceptance criteria verified met by direct code reading and test
execution, not merely by trusting the implementer's own report — first by the controller, then
independently re-verified by a dedicated QA Strategist pass during the formal sprint review.

**Follow-up, out of this story's scope by design:** `p5-09` (concurrency verification under this now-real
`ParallelHandler` — checkpoint isolation under real fan-out, the opt-in `ATTRACTOR_LIVE=1` ceiling test),
still `status: draft`, needs its own readiness pass before it can be scoped into a sprint.

**Final state:** 612 tests, 611 passing, 1 pre-existing environment-gated skip, 0 failing.
