<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-08
title: Register Handler.PARALLEL — ParallelHandler fans out, bounds, joins, and merges branches
status: draft
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

## Why this story is `draft`, not `ready`

This is Phase 5's true integration point — the only work item that composes nearly every other
one (p5-01, p5-03, p5-04, p5-05, p5-07 all feed it) — and it is deliberately last. It cannot be
marked `ready` because **two narrow Solution Architect decisions, named explicitly in
`roadmap.md`'s own work-item A, are still unresolved**, and this handler's own observable behavior
differs depending on which way each one goes. Writing falsifiable acceptance criteria for the
parts that depend on them would mean this Delivery Lead inventing the answer in the story text —
exactly the boundary this role does not cross ("raise it with the Solution Architect rather than
inventing an approach"). Everything else below — the parts of `ParallelHandler` that do **not**
depend on either decision — is fully specified and could be built today; only two acceptance
criteria (marked **BLOCKED** below) are missing.

**What is blocking, stated for the Solution Architect to answer, one paragraph each, same shape as
ADR-006(b):**

- **A(a) — component-node FAIL routing.** When `ParallelHandler.execute()`'s join policy returns
  FAIL, does the outcome route via the ordinary fail-edge/`retry_target` ladder (§3.7, the same
  ladder every other node's FAIL uses), or via an unconditional jump that mutates the main loop's
  `currentId` straight to the convergence node regardless of status? The design's own text gives
  both answers in different places and they cannot both be true for the same run (architecture's
  Risks table, "QA finding, blocking"). **Note for whoever resolves this:** if the answer is the
  unconditional-jump reading, it also reopens p5-02's "closed, refactor-only" status, since that
  jump can only be implemented inside `core/engine.ts`'s own `run()` loop, not this handler.
- **A(b) — branch rejection handling.** `ParallelHandler.execute()`'s branch dispatch is
  `Promise.all`-awaited (Spike 8's own wording). If one branch's `runBranch` call *rejects*
  (as opposed to resolving with a FAIL `Outcome`) — e.g. `createWorktree` throwing on a name
  collision, or a backend crash — `Promise.all` rejects immediately and does not cancel or
  continue awaiting the still-pending sibling branches; their worktree cleanup and checkpoint
  become orphaned, and the rejection propagates out of `Engine.run()` itself, a public surface
  `cli.ts` does not handle as anything but a FAIL `RunResult` today. Resolve by either wrapping
  each branch call so nothing thrown escapes uncaught (converted to that branch's own FAIL
  `Outcome`), or switching to `Promise.allSettled` with an explicit reject-to-FAIL mapping.

## Goal (once A(a)/A(b) resolve)

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
| `plugins/attractor/engine/src/handlers/parallel.ts` | modify — add `ParallelHandler` class to the file p5-07 already created (`mergeBranchContext` lives there) |
| `plugins/attractor/engine/src/core/engine.ts` | modify — `defaultHandlers()` gains the `PARALLEL` entry |
| `plugins/attractor/engine/src/dot/graph.ts` | modify — remove `Handler.PARALLEL` from `UNREGISTERED_HANDLER_KINDS`, **last line of this story** |

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
- **Not resolved here:** roadmap item A. This story's remaining acceptance criteria are written
  against the parts of `ParallelHandler.execute()` that do not depend on A(a)/A(b).

## Acceptance criteria

- [ ] `FR-17b`/`NFR-7` — a semaphore bounded by `max_parallel` (default 4) admits at most that
      many concurrent `runBranch` calls; verified with `GatedBackend` at `max_parallel=1`,
      `=branch count`, `=branch count - 1` (one branch queues and picks up the freed slot).
- [ ] `FR-17b` — one `createWorktree` per branch unless the edge's `isolate="false"`; `removeWorktree`
      runs per-branch immediately after that branch's own `runBranch` resolves, not deferred to a
      top-level `finally`.
- [ ] `FR-17b` — `applyDefaultJoinPolicy` returns FAIL iff zero branches SUCCEED/PARTIAL, SUCCESS
      iff zero FAIL, PARTIAL otherwise — all-fail/all-success/mixed/one-branch/zero-branch cases.
- [ ] `FR-17b` — `mergeBranchContext` is called exactly once per dispatch, after every branch has
      settled, regardless of the join verdict — not gated on the component node's own outcome.
- [ ] `FR-17b` — `defaultHandlers()` registers `ParallelHandler` for `Kind.PARALLEL`;
      `UNREGISTERED_HANDLER_KINDS` no longer includes it (this story's last line).
- [ ] `FR-17b` — **retry/partial-completion interacting with convergence** (not blocked on A — a
      join-policy/merge-back interaction, not a FAIL-routing one): three branches, one exhausts
      retries and fails a node with a declared `outputs=` key the convergence node consumes;
      assert the convergence node is correctly blocked by the existing `failedOutputs`
      eager-input-check (exercised under branch partiality for the first time here), not silently
      fed a stale or empty value by `mergeBranchContext`'s own FAIL-branch exclusion (p5-07).
- [ ] **BLOCKED on A(a)** — a join-FAIL outcome's routing behavior (fail-edge/`retry_target` ladder
      vs. unconditional convergence-node jump) — cannot be written until resolved.
- [ ] **BLOCKED on A(b)** — a rejecting (not FAIL-resolving) branch's effect on `Engine.run()`'s
      public contract and sibling-branch cleanup — cannot be written until resolved.

## Test approach

**Level:** integration, `GatedBackend`-driven (p5-01) — concurrency ceiling, worktree lifecycle,
join-policy verdicts, merge-back-after-join-regardless-of-verdict. **Two rows cannot be written at
all** until A resolves: "Component-node FAIL routing" and "branch throws mid-flight" — the
architecture's own Test-strategy table marks both this way today, not as an oversight.

**Run with (from `plugins/attractor/engine`):** `node --test test/parallel.test.ts` (targeted,
once it exists) or `node --test` (full).

## Out of scope

- Resolving A(a)/A(b) — Solution Architect's decision, one paragraph each, same shape as
  ADR-006(b); this story consumes the answer, does not produce it.
- Item J (concurrency test infrastructure beyond what this story's own acceptance criteria list)
  — not yet decomposed into a story; it depends on this item existing, which depends on A. Once
  A resolves and this story moves to `ready`/`in-progress`, item J becomes story-able and should
  be decomposed then, not guessed at now.

## Dependencies

p5-01, p5-03, p5-04, p5-05, p5-07 — all must be `done` first; this handler is their sole
integration point. **Additionally blocked on roadmap item A** (not a story; a Solution Architect
decision) — this story cannot move to `ready` until both A(a) and A(b) are answered and recorded
(new ADR paragraphs, or amendments to ADR-007).

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
