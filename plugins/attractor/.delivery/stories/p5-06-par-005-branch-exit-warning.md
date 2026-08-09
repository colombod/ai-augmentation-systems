<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-06
title: Warn (PAR-005) when a branch can reach the graph's real EXIT before its convergence node
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b]
depends_on: [p5-04, p5-05]
size: S
---

# Warn (PAR-005) when a branch can reach the graph's real EXIT before its convergence node

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`attractor lint` warns (PAR-005) when a `Handler.PARALLEL` node has a branch root from which the
graph's real EXIT node is reachable without first passing through the branches' own **convergence
node** — usually an authoring mistake, since (per p5-05's runtime decision) that branch simply
stops there, the main run is never affected, and sibling branches proceed normally. The doc
caveat this WARNING exists to reinforce — "a branch reaching EXIT never stops the whole pipeline"
— ships as a **must**, not an optional callout: architecture.md names it the one doc-only item in
this phase not eligible for the cut list.

## Context

`findConvergenceNode` (p5-04) is a static over-approximation: a branch root can have a legal,
direct or short edge to EXIT that none of the *other* branches share, so `findConvergenceNode`
correctly never selects EXIT as the shared convergence node — but that one branch's own runtime
walk (p5-05's `runBranch`) will dispatch EXIT as an ordinary node before ever reaching what the
*other* branches converge on. This is a real, legal DOT shape (`component -> exit` as one of
several outgoing edges), not a corner case.

**Why WARNING, not ERROR — the corrected rationale (ADR-007's amendment, fifth pass).** An
earlier draft justified WARNING by describing a capability this design does not have ("if this
branch alone satisfies the goal, stop the whole pipeline here"). p5-05's own Decision makes that
capability structurally impossible: a branch reaching EXIT is an ordinary dead end *for that
branch alone*, never a run-wide stop. The real reason WARNING is correct: *ending one branch's
own traversal early, without affecting siblings*, is a legitimate pattern — refusing it
structurally would be the same kind of over-restriction PAR-002 already declines for its own
surprising-but-legal shape (a fan-out with exactly one outgoing edge). WARNING says "probably not
what you meant, but nothing downstream breaks if it's fine" — it must not be read as "this is how
you stop the whole run," because that capability does not exist this slice (a genuine, separate
Product-Owner scope question, not decided here).

**Why the doc caveat is a must, not a cut-list item.** An author drawing `component -> exit`
intending "stop everything" gets a clean-enough lint pass (a WARNING they can ignore) and a run
that silently does not do what they intended — no crash, no visible sign. That is exactly the
silent-degradation class `AGENTS.md`'s doctrine exists to catch. Skipping the doc caveat would
ship a named hazard with no documented warning at all.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — add PAR-005 (WARNING) near PAR-001/002/004 (p5-04) |
| `plugins/attractor/engine/test/lint.test.ts` | modify — fixtures for the firing condition |
| `plugins/attractor/engine/test/engine.test.ts` | modify — one integration test proving the WARNING does not halt the run (uses p5-05's `ctx.runBranch` seam directly, no `ParallelHandler` needed) |
| `plugins/attractor/README.md` | modify — add PAR-005 to `## Lint rules`, and the "branch reaching EXIT never stops the run" caveat to `### What the linter can and cannot see` |

## Interfaces and contracts to honor

```ts
// dot/lint.ts — new diagnostic code, node.handler === Handler.PARALLEL,
// branchRootIds = outgoingEdges(graph, node.id).map(e => e.to)
// PAR-005, WARNING: some branch root can reach the graph's real EXIT node (via any path) without
//   first passing through findConvergenceNode(graph, branchRootIds) — reuses the SAME
//   findConvergenceNode call p5-04 already established, not a second reachability pass
```

No new `dot/graph.ts` helper is needed — PAR-005 is ordinary reachability from a branch root to
the graph's exit node, checkable with the same BFS machinery `findConvergenceNode` already uses
internally, truncated to stop expanding once the convergence node is reached (so a path that
reaches EXIT only *after* passing through convergence does not fire — that is ordinary
post-convergence routing, not the shortcut PAR-005 exists to catch).

## Relevant design decisions

- **ADR-007's EXIT amendment, fifth-pass correction** is this story's entire rationale — WARNING
  severity is correct because early branch termination is legitimate on its own, not because a
  branch can stop the whole run (it cannot, per p5-05's own Decision).
- **Not eligible for the Phase 5 cut list (roadmap):** the "branch reaching EXIT never stops the
  run" doc caveat, specifically — named a **must** by architecture.md's F2-residual amendment.
  PAR-005's own lint fixtures are ordinary and *are* eligible for the cut list if the phase runs
  late; the doc caveat is not.

## Acceptance criteria

- [ ] `FR-17b` — PAR-005 fires WARNING only when a branch root reaches EXIT via a path that never
      passes through the component node's own convergence node.
- [ ] `FR-17b` — a branch that reaches EXIT only *after* the convergence node does **not** fire
      PAR-005 — ordinary post-convergence routing, not the shortcut this rule targets.
- [ ] `FR-17b` — integration test: a branch root routes directly to EXIT (PAR-005 fires WARNING,
      lint still passes overall); using p5-05's `ctx.runBranch` seam directly (two concurrent
      calls, one routed to EXIT, one gated open via `GatedBackend`), assert the EXIT branch's own
      `BranchRunResult` is unaffected by lint's WARNING (lint is advisory, not enforced at
      runtime) and the sibling branch proceeds to its own stop point exactly as p5-05's own
      "branch reaching EXIT is a dead end" test already proves — a future reader must not be able
      to write a test asserting "PAR-005 lets an early-exit branch stop the pipeline" and have it
      pass, because that behavior does not exist.
- [ ] `FR-17b` — README names PAR-005's severity/firing condition, and states explicitly, as a
      **must**, that a branch reaching EXIT never stops the whole pipeline.
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit for the firing condition (`lint.test.ts`, no runtime needed); one integration test
for the "does not halt the run" guarantee (`engine.test.ts`, reusing p5-05's direct `ctx.runBranch`
technique — no `ParallelHandler` needed).

**Cases:**

| Case | Expected |
| :-- | :-- |
| Branch root with a direct edge to EXIT, no other branch shares it | PAR-005 fires WARNING |
| Branch root reaches EXIT only via a path through the convergence node first | no PAR-005 — ordinary routing |
| A `component` node with no branch reaching EXIT at all | no PAR-005 |
| Integration: branch A routes to EXIT, branch B gated open via `GatedBackend` | branch A's `BranchRunResult` is a trivial SUCCESS; branch B's gate release is observed independently; neither call returns an `Engine.RunResult` |

**Run with (from `plugins/attractor/engine`):** `node --test test/lint.test.ts test/engine.test.ts`
(targeted) or `node --test` (full — baseline today: 508 tests, 507 passing, 1 skipped, 0 failing).

## Out of scope

- Any future "stop the whole pipeline from inside a branch" capability — a Product-Owner scope
  question named but not decided by ADR-007's amendment; would need real cancellation plumbing
  through `ParallelHandler`'s eventual `Promise.all`-based dispatch, not built here or in p5-08.
- `handlers/parallel.ts` — p5-08 (item I).

## Dependencies

- **p5-04 (item E)** — `findConvergenceNode` must exist; PAR-005 reuses it.
- **p5-05 (item F)** — the runtime "branch reaching EXIT is a dead end" behavior this story's
  integration test asserts is p5-05's own Decision, not something this story implements.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
