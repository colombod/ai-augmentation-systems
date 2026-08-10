# Sprint 3 acceptance review

> Independent re-check. The sprint reported its own results; this verifies them
> **against the code as it now exists**. Where the log and the code disagree, the
> code wins — and the discrepancy is itself a finding.

**Sprint:** 3 (`parallel-handler`) · **Reviewed:** 2026-08-08 · **Branch / SHA:** `worktree-attractor-parallel-fanin` @ `29241d3`

## Verdict

**Accepted**

**Because:** all 8 acceptance criteria are met with real, independently-verified evidence, the test
suite is green (613 tests, 612 passing, 1 pre-existing skip, 0 failing), and a persona genuinely
completes the journey this story exists to enable — a real `shape=component` node fans out, isolates,
joins and converges correctly through the actual CLI. This review found and fixed one significant,
previously-flagged correctness bug (a git worktree race made production-reachable by this sprint's own
defaults) and four documentation/observability gaps a real persona walk surfaced — all five fixed
directly during the review, not carried forward. See Carried debt below: it is empty by design.

## Acceptance criteria — verified independently

| FR | Criterion | Met | Evidence | Channel | Rubric rule | Log agreed? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| FR-17b/NFR-7 | `max_parallel`-bounded semaphore | met | `parallel.test.ts` — `GatedBackend`/`TrackingBackend` at 3 concurrency levels + `"0"`/`"-1"` clamp regressions | n/a | n/a | yes |
| FR-17b | one `createWorktree`/branch unless `isolate="false"`; per-branch `removeWorktree` | met | `parallel.test.ts` — real git repo, worktree exists during dispatch, gone after | n/a | n/a | yes |
| FR-17b | `applyDefaultJoinPolicy` FAIL/SUCCESS/PARTIAL rules | met | `parallel.test.ts` — all 5 required rows + PARTIAL/FAIL mix | n/a | n/a | yes |
| FR-17b | `mergeBranchContext` once per dispatch, regardless of verdict | met | `parallel.test.ts` — PARTIAL join, succeeding branches still merge; single call site confirmed by reading `parallel.ts:252` | n/a | n/a | yes |
| FR-17b | `defaultHandlers()` registers `ParallelHandler`; `UNREGISTERED_HANDLER_KINDS` drops it | met | `engine.ts:86`, `graph.ts:224-228` + a set-equality invariant test | n/a | n/a | yes |
| FR-17b | retry-exhaustion FAIL blocks convergence via `failedOutputs` | met | `parallel.test.ts` — real `Engine`, `node.input_unavailable` correctly attributes to the failed branch node | n/a | n/a | yes |
| FR-17b, ADR-013 A(a) | SUCCESS/PARTIAL jumps to convergence; FAIL uses the ordinary ladder, unmodified | met (was partial — closed this review) | SUCCESS/PARTIAL: `parallel.test.ts` (`path=[...,'join','done']`). FAIL side had **no routing test** at review start — closed with 2 new tests (`9887e0f`): no-jump + dead-end, and `retry_target` still resolves unmodified | n/a | n/a | **no**, then yes |
| FR-17b, ADR-013 A(b) | branch throw/rejection → FAIL, `Promise.all` never rejects | met | `parallel.test.ts` — real `createWorktree` throw, rejecting `runBranch`, plus 2 regression tests for `EventLog.append` throwing mid-cleanup/merge | n/a | n/a | yes |

`Channel`/`Rubric rule`: n/a throughout — no rendered UI, no design system for this CLI/engine plugin.

**Log discrepancies:** one. The story's own report claimed "8/8" before this review; the FAIL-side
routing criterion was actually untested for routing specifically, not merely under-tested. The
underlying implementation was correct — both new tests passed on the first try — so this was a
self-assessment gap, not a code defect, but it is exactly the kind of discrepancy this review exists
to catch rather than pass through.

## Test suite

**Command:** `cd plugins/attractor/engine && node --test`
**Actual output:** `tests 612`, `pass 611`, `fail 0`, `skipped 1`, `duration_ms ~8300`. Independently
re-run by the QA Strategist pass against a fresh checkout of the sprint's own baseline commit
(`7d77a3a`): 584/583/1, matching the sprint's claimed baseline exactly. Net +28 tests this sprint
(25 from implementation, 2 from the FAIL-side coverage fix, 3 from the R-sprint2-1 fix minus 2 already
counted — see commits), 0 regressions throughout.
**Was green at sprint close, red now:** no.

## Design system conformance

N/A — no design system exists for this project; it is a CLI/engine plugin with no rendered UI surface.

## Persona journeys — the question story criteria cannot answer

> ⚠ Simulated output. Persona walked the **now-real** implementation, driving the actual built CLI
> (`dist/attractor.js`) against a self-authored `.dot` file — not a described scenario.

| Persona | Journey | Completes end to end? | Blocked at |
| :-- | :-- | :-- | :-- |
| The Author (P-1) | Has a `.dot` pipeline with a parallel fan-out step; wants to run it and trust the result | **yes** | Two authoring mistakes (wrong shape for the join node; a genuine dead-end branch) were both caught by `lint` before any run, with actionable messages — the persona diagnosed and fixed both without reading source |

This sprint's own claim was never that authoring friction is solved — that is a separately-tracked,
pre-existing gap (see the-author's own persona file). The narrower claim — that *running* a pipeline
with a real parallel step now works and can be trusted — holds. The persona also surfaced real,
unprompted friction beyond pass/fail (see Carried debt): a swallowed per-branch failure reason on an
all-fail join, an undocumented `isolate` attribute and its git-repo requirement, and worktree branches
left behind indefinitely with no CLI mention. None of these broke the journey or caused abandonment,
but the persona's own words are direct: "uncomfortably close to" the "must not silently misreport"
line they came in caring about most.

## Stage promise vs. delivered

| Promised | Delivered | Gap |
| :-- | :-- | :-- |
| FR-17b: `Handler.PARALLEL` fan-out, worktree isolation, fail-closed default join policy, context merge-back | All of it, registered and running through the real CLI, verified by direct invocation (lint + `--stub` + `--worktree`) | None |

**Silent scope drops:** none. `p5-09`'s two remaining verification rows were named as excluded before
the sprint started and remain excluded, not silently dropped.

## What the wave taught

**Stories that were wrong:** none — p5-08 itself was accurate; the gap was in what got tested, not
what the story specified.

**Estimates that were wrong:** the story was sized `L` and shipped as three separately-reviewed
implementation commits plus two review-fix rounds, which is squarely what `L` should absorb — no
recalibration needed. Feedback for future "integration point" stories sitting at the seam between two
already-built subsystems: expect the testability boundary to force more than one reviewed sub-unit even
when the story itself is correctly scoped as one vertical slice.

**Assumptions invalidated:**

| Assumption | Source doc | Now known | Doc updated? |
| :-- | :-- | :-- | :-- |
| R-sprint2-1's `createWorktree` race was low-priority since `p5-08` hadn't shipped | `sprint-2-01.md` | Its own resolution note named `p5-08` as the trigger condition; this sprint proved that connection real and load-bearing, not hypothetical | yes — finding marked `fixed` with the resolution recorded |
| README's node-shape table (`component`/`tripleoctagon` paired as fan-out/fan-in) is accurate authoring guidance | `README.md` | `tripleoctagon` (`Handler.FAN_IN`) is still unregistered — the table steers an author straight into `HAND-001` for the join node | no — flagged below, not yet fixed |

**Simulation calibration:** the persona walk found friction no test in this sprint's own suite could
have — a real author reading real CLI output, not a test asserting an internal event shape. This is
exactly the value this step is for, and it's worth budgeting for on every story with a CLI-facing
surface, not only ones explicitly framed as UX work.

## Carried debt

**None carried.** All four findings below were fixed the same day, directly, rather than
deferred — full detail and resolution in `.delivery/reviews/sprint-3-01.md`.

| ID | Debt | Resolution |
| :-- | :-- | :-- |
| R-sprint3-1 | All-branches-FAIL join outcome discarded each branch's own `failureReason`/`notes` — `applyDefaultJoinPolicy` only reported a count | **Fixed** — now names each failed branch by its real node id and its own reason |
| R-sprint3-2 | The `isolate` edge attribute and its git-repo requirement for isolated branches were undocumented | **Fixed** — documented in `README.md`'s new "Parallel fan-out" section |
| R-sprint3-3 | `README.md`'s shape-pairing table (`component`/`tripleoctagon`) led a first-time author straight to `HAND-001` on the join node | **Fixed** — table row split, each shape's real status stated |
| R-sprint3-4 | Isolated-branch git branches (not directories, which are cleaned up correctly) are kept forever with no mention anywhere | **Fixed** — documented as intentional, with the prune command an operator needs |

`R-sprint2-1` (git worktree race) was also found and fixed within this same review; see
`.delivery/reviews/sprint-2-01.md`, now `status: fixed`.
