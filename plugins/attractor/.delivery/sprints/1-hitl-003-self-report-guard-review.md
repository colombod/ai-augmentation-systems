<!--
BUDGET — target 600 words, hard cap 1000 words. Excludes code, YAML and data tables.
Criteria and journey tables are data.
-->

# Sprint 1 acceptance review

> Independent re-check. The sprint reported its own results; this verifies them
> **against the code as it now exists**. Where the log and the code disagree, the
> code wins — and the discrepancy is itself a finding.

**Sprint:** 1 · **Reviewed:** 2026-08-07 · **Branch / SHA:** worktree-attractor-hitl-003-selfreport / f2303df

## Verdict

**Accepted with debt**

**Because:** all 8 acceptance criteria are met, independently verified against the code
(not the sprint log), with real test output reproduced twice by two different reviewers
plus the controller. The sprint's own report-back honestly disclosed a real defect it
found and fixed mid-implementation (an unsatisfiable acceptance criterion that caused a
correctness bug); this review independently confirmed both the defect and the fix, and
closed the one consequence of it that mattered — no regression test would have caught
that exact defect recurring. Four items the review's own qa-strategist and feature-critic
passes surfaced were fixed immediately rather than carried (see `f2303df`). One
low-severity, low-cost item remains open (`.delivery/reviews/sprint-1-01.md`,
`R-sprint-1-01-1`) — not blocking, tracked per this project's own findings discipline.

## Acceptance criteria — verified independently

| FR | Criterion | Met | Evidence | Channel | Rubric rule |
| :-- | :-- | :-- | :-- | :-- | :-- |
| FR-18 | ADR-006 exists (CODERGEN-only decision, citations, `## Residual risk`, FR-12 caveat) | met | `.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`, all four elements present and citation-verified | n/a | n/a |
| FR-18 | `directPredecessor` exported, correct semantics | met | `graph.ts:151-156`; condition-agnostic confirmed (no `condition` filtering in body) | n/a | n/a |
| FR-18 | P1 fires: length 1, WARNING, `node:"gate"`, message names gate/predecessor/`agent` | met (see R-sprint-1-01-1) | `lint.test.ts` P1 test, all assertions pass; gate-name-in-message not independently pinned | n/a | n/a |
| FR-18 | B1 advisory-only: every `HITL-003` diagnostic is WARNING | met | `lint.test.ts` B1, now also asserts `length===1` (strengthened this round) | n/a | n/a |
| FR-18 | N1–N8 none fire, P2–P5 all do | met | full 13-case matrix walked and confirmed against shipped code, line-by-line | n/a | n/a |
| FR-18 | B2/B3 co-firing and message-content bar | met | `lint.test.ts` B2, B3 | n/a | n/a |
| FR-18 | README documents `HITL-003`, severity, FR-12 gap | met (see R-sprint-1-01-2, rejected) | `README.md:226-263`; gap described in full prose, no literal "FR-12" string (consistent with file-wide convention) | n/a | n/a |
| FR-18 | `node --test` passes, zero regressions | met | 508 tests, 507 pass, 1 skipped, 0 fail — reproduced independently by qa-strategist, feature-critic, and the controller, all matching | n/a | n/a |

**Log discrepancies:** none. The sprint's own report-back table (`sprints/1-...md`) and the
independently-verified state agree on every criterion.

No design system exists for this project (CLI/engine, no UI) — that section of the template
is not applicable and is omitted.

## Test suite

**Command:** `cd plugins/attractor/engine && node --test`
**Actual output:** `tests 508, pass 507, fail 0, cancelled 0, skipped 1, todo 0`
**Was green at sprint close, red now:** no — green throughout, reproduced three times independently across this review.

## Persona journeys

> ⚠ Not run. `prioritization.md`'s Stage 2 states plainly, in its own words, that this
> stage "does not complete a new persona journey" — the `agent` channel it guards has no
> runtime yet (FR-8 is uncoded), so no persona gets new capability to walk through. This is
> a disclosed, intentional limitation, not a gap this review found. `Accepted with debt` is
> still the correct verdict category: the debt is a tracked test-coverage nicety, not a
> missing capability.

## Stage promise vs. delivered

| Promised (`prioritization.md`, Stage 2) | Delivered | Gap |
| :-- | :-- | :-- |
| FR-18 only, zero new persona journeys, a required precondition before the `agent` channel ships | Exactly FR-18, as scoped | None |
| "Whether a lint-time, single-hop predecessor trace is sufficient in practice" (the stated learning goal) | Learned: no — the initial in-degree-raw-count implementation had a real false-negative blind spot (duplicate/self-loop edges), closed mid-sprint; a further, larger gap (genuinely-distinct predecessors, e.g. rework loops) remains open by design, now tracked as PRD Open Question 13 | None — this is the learning goal being satisfied, not missed |

**Silent scope drops:** none.

## What the wave taught

**Stories that were wrong:** `p1-01`'s original B1 acceptance criterion (`hasErrors()===false`
on a firing fixture) was unsatisfiable — `HAND-001` always co-fires on any real `Handler.HUMAN`
node while it stays unregistered. This is a plan defect, not an implementation one: chasing
the unsatisfiable assertion by reshaping the test fixture is what silently dropped the
`Handler.HUMAN` gating check in the first implementation attempt. Feedback for
`/delivery:stories`: when a story's acceptance criterion depends on a co-occurring diagnostic
from an unrelated rule, verify the criterion is actually satisfiable against the rules that
will really coexist, not just the rule under test in isolation.

**Estimates that were wrong:** none — `S` held for the whole phase, including both fix rounds.

**Assumptions invalidated:**

| Assumption | Source doc | Now known | Doc updated? |
| :-- | :-- | :-- | :-- |
| `directPredecessor`'s raw in-degree count was a sufficient definition of "single predecessor" | `p1-01`'s original Interfaces section | False — needed dedupe-by-source and self-edge exclusion to avoid false negatives on realistic topologies | yes, `p1-01`, ADR-006, README, `graph.ts` all corrected |

**Simulation calibration:** n/a — no simulation phase exists for this project.

## Carried debt

| ID | Debt | Why accepted | Repay by |
| :-- | :-- | :-- | :-- |
| R-sprint-1-01-1 | P1's message-content test doesn't independently assert the gate's own id appears in the message | Low cost, low risk (message template has one interpolation site, unlikely to regress silently); tracked rather than blocking sprint close | One-line `assert.match` addition, next time `lint.test.ts`'s HITL-003 block is touched |
