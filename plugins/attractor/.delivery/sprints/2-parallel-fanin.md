<!--
BUDGET — target 600 words, hard cap 900 words. Excludes code, YAML and data tables.
The scope, verification and report-back tables are data.
-->

---
sprint: 2
slug: parallel-fanin
scope: Phase 5 (plugins/attractor/.delivery/roadmap.md)
status: scoped
runner: superpowers (subagent-driven-development)
branch: worktree-attractor-parallel-fanin
---

# Sprint 2 scope package: parallel fan-out/fan-in (FR-17b)

> **Input for an implementation run.** This plugin does not implement — it scopes,
> reviews and re-aligns. Whatever runs this (superpowers' `subagent-driven-development`)
> should need nothing but this file, the seven story files below, and the repository.
>
> Assume the runner has no memory of the planning and cannot ask questions.

## Scope

**Stage promise:** Phase 5 delivers FR-17b — `Handler.PARALLEL` fan-out with worktree
isolation, a fail-closed default join policy, and branch context merge-back. This sprint
covers the seven stories the roadmap and story decomposition confirm are unblocked; it does
**not** cover story `p5-08` (`ParallelHandler` itself) or roadmap work item A — both are
blocked on two still-open Solution Architect decisions (component-node FAIL routing;
`Promise.all` vs `allSettled` for branch rejection), named explicitly in `roadmap.md`'s
Dependencies table. This sprint lands every prerequisite `ParallelHandler` needs; a second
sprint, scoped once those two decisions are made, lands the integration point itself.

| Order | Story | Path | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- |
| 1 | p5-01 — worktree async conversion | `.delivery/stories/p5-01-worktree-async-conversion.md` | none | M |
| 2 | p5-02 — `executeNodeStep` extraction | `.delivery/stories/p5-02-execute-node-step-extraction.md` | none | L |
| 3 | p5-03 — `Backend.run()` cwd plumbing | `.delivery/stories/p5-03-backend-cwd-plumbing.md` | none | S |
| 4 | p5-04 — convergence + lint rules PAR-001/002/004 | `.delivery/stories/p5-04-convergence-lint-rules.md` | none | M |
| 5 | p5-05 — `runBranch` seam | `.delivery/stories/p5-05-runbranch-seam.md` | p5-01, p5-02 | M |
| 6 | p5-06 — PAR-005 (branch-reaches-EXIT warning) | `.delivery/stories/p5-06-par-005-branch-exit-warning.md` | p5-04, p5-05 | S |
| 7 | p5-07 — context merge-back + PAR-003 | `.delivery/stories/p5-07-context-merge-back.md` | p5-05, p5-01 | M |

Stories 1–4 have no dependency on each other or on anything else in this sprint — the order
above is the roadmap's own stated sequencing rationale, not a hard requirement; a runner
executing sequentially (this project's established `subagent-driven-development` practice —
never more than one implementer subagent at a time, to avoid conflicting edits) should still
follow this order, since it matches dependency direction for stories 5–7.

**Deliberately excluded** — do not add these; they were scoped out on purpose.

| Story / feature | Why excluded |
| :-- | :-- |
| p5-08 — `ParallelHandler` integration | `draft`, not `ready` — blocked on two open Solution Architect decisions named in `roadmap.md` |
| Roadmap item A (the two open decisions themselves) | A design ruling, not implementation work — outside this sprint's runner's standing |
| Roadmap item J (remaining concurrency test infra) | Needs a real `ParallelHandler` to exercise; depends on p5-08 |
| Ranking-based fan-in (`Handler.FAN_IN`/`tripleoctagon`) | Not part of FR-17b's default join policy; a future extension |

## Pre-flight (verified before hand-off)

- [x] All 7 in-scope stories are `ready` (frontmatter `status: ready`, confirmed)
- [x] Every acceptance criterion in each story is falsifiable (exact test names, exact commands, exact file:line citations — verified live against the repo by the Delivery Lead during story-writing, including a baseline `node --test` run: 508 tests, 507 passing, 1 skipped, 0 failing)
- [x] No open **blocking** findings — checked `.delivery/reviews/`, none open against `architecture.md`/`roadmap.md`
- [x] No story in scope depends on a story outside it that isn't `done` — all `depends_on` entries above resolve to other stories in this same sprint
- [x] Acceptance criteria are falsifiable — each story's criteria cite exact tests/commands, not prose judgment

## Design constraints

No `.delivery/design-system.md` exists for this project — it is a CLI/engine plugin with
no UI surface. Not applicable to this sprint.

## Verification contract

**Test command:** `cd plugins/attractor/engine && node --test` (full suite) — targeted loop
during TDD: `cd plugins/attractor/engine && node --test test/<file>.test.ts` per story (each
story names its own targeted file).
**Must pass:** the full suite, zero regressions (baseline today: 508 tests, 507 passing, 1
intentionally skipped — same shape, plus each story's own new tests, must hold after each
story and at the end of the sprint).

| Story | FR | Acceptance criterion | How verified |
| :-- | :-- | :-- | :-- |
| p5-01 | FR-17b, NFR-7 | `worktree.ts`'s `git()` and call chain are async; sibling branches no longer block on worktree create/teardown; `GatedBackend` test double exists | story's own test matrix, `node --test test/worktree.test.ts` |
| p5-02 | FR-17b, NFR-1 | `Engine#executeNodeStep` is the sole per-node step implementation, used by both `run()` and (later) `runBranch`; existing suite passes unmodified | `node --test test/engine.test.ts`, full suite regression |
| p5-03 | FR-17b, NFR-4 | `Backend.run()` accepts and `BoxHandler` passes `ctx.cwd`; a CODERGEN branch actually isolates | story's own test, `node --test test/box.test.ts` |
| p5-04 | FR-17b | `findConvergenceNode`/`findPartialReconvergence` exported; PAR-001 (ERROR, no convergence), PAR-002 (WARNING), PAR-004 (ERROR, partial reconvergence including the tied-full-common-descendant case) fire correctly on hand-built fixtures | `node --test test/lint.test.ts` |
| p5-05 | FR-17b, NFR-1, NFR-4 | `runBranch` seam runs a bounded sub-traversal sharing the run's own ledgers and `stepCount`; EXIT treated as an ordinary dead end for the branch | story's own test, full suite regression |
| p5-06 | FR-17b | PAR-005 fires when a branch can reach EXIT before its convergence node; never sets `hasErrors()` | `node --test test/lint.test.ts` |
| p5-07 | FR-17b | Branch context merges back in declaration order on SUCCESS/PARTIAL; exact three-branch-same-key F1 reproduction test passes; PAR-003 fires on statically-declared collisions | story's own test, full suite regression |

## Stop conditions

Stop and report rather than improvising. **A blocked story reported honestly is a
success. Quietly redesigning around a blocker is a failure.**

- A story cannot be implemented as written — spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope (see Deliberately excluded, above)
- Tests fail for reasons inside the story's scope after bounded retries
- Two consecutive stories block — that means the plan is wrong, not the stories
- Anything in this sprint turns out to actually need `p5-08`/item A's still-open decisions —
  stop and report rather than guessing at them; they are the Solution Architect's call

Design decisions belong to the Solution Architect. Do not redesign mid-run.

## Working agreement

- Branch: `worktree-attractor-parallel-fanin` — already checked out, fresh off `origin/main`
  at the time this worktree was created; carries this sprint's own delivery-pipeline
  artifacts (PRD Open Questions 3-5 resolution, architecture with 6 ADRs across two
  adversarial-review rounds, this roadmap phase, these 8 stories) plus nothing else
- One commit per story (matches this project's own established `subagent-driven-development`
  practice — never more than one implementer subagent live at a time)
- **Do not weaken a test to make it pass.** If a test is wrong, report it and say why.

## Required report-back

`/delivery:sprint-review` needs all of this. Return it verbatim rather than summarised.

> **Filled in retroactively during `/delivery:sprint-review`** (this table was left
> empty when the runner closed the sprint — see finding R-sprint2-5). Sourced from
> `.superpowers/sdd/2026-08-07-parallel-fanin/progress.md`'s own commit-by-commit
> ledger, cross-checked against `git log` directly, not copied from prose summary.

| Story | Outcome | Criteria met | Evidence | Commit |
| :-- | :-- | :-- | :-- | :-- |
| p5-01 | Done, 1 debt carried (R-sprint2-1) | Async conversion + non-blocking: yes. "Never a race that corrupts state": no — reproducible git-level race, tracked issue #15 | `test/worktree.test.ts` mutation-checked non-blocking test; race reproduced independently during sprint-review | `318ab73` |
| p5-02 | Done | Yes | `test/engine.test.ts`, full suite regression | `b485b9d` |
| p5-03 | Done | Yes | `test/box.test.ts`, `test/claude-backend.test.ts` | `c5459f7` |
| p5-04 | Done, 1 debt carried (R-sprint2-7) | Yes, within tested fixtures; 2 narrow false-refusal gaps named, safe-direction-only, tracked issue #14 | `test/lint.test.ts`; 6 fix-loop rounds, 11 ADR-007 amendments | `e3a707f`..`c86753f` |
| p5-05 | Done | Yes | `test/engine.test.ts` mutation-checked EXIT/step-cap tests | `9625c13`..`98d9261` |
| p5-06 | Done | Yes | `test/lint.test.ts`, integration test | `2cf9e0b`..`f18e6cd` |
| p5-07 | Done | Yes | `test/parallel.test.ts` exact F1 reproduction | `5cf1074` |
| (whole-branch) | Done, 1 debt carried (R-sprint2-2) | 1 CRITICAL cross-task regression found and fixed; process gap named | `test/engine.test.ts` mutation-checked step-cap-path test | `a8f3e30`, `2690ed8` |

**Actual test output** (the output itself, not a claim about it):

```
ℹ tests 584
ℹ pass 583
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```

(Representative run at `2690ed8`. Not universally reproducible — see R-sprint2-1: an
independent re-run during this same review reproduced a real failure in
`test/worktree.test.ts`'s concurrent-creation test, a known, tracked, low-frequency
git-level race unrelated to the 6 other stories.)

**Conflicts with the spec encountered:** none requiring a story rewrite. p5-04's
`findConvergenceNode`/`findPartialReconvergence` needed a signature the story didn't
originally specify (a third `fanOutNodeId` parameter), discovered through 6 fix-loop
rounds — an estimate miss (`M` sized, `L`/`XL` actual effort), not a spec conflict.

**Design system deviations, and why:** N/A — no design system for this project.

**Anything the next planning cycle should know:** see `2-parallel-fanin-review.md`'s
own "What the wave taught" and "Carried debt" sections — in short: `p5-08` inherits a
convergence-detection algorithm with 2 named-but-open gaps and a worktree layer with
1 named-but-open race, both safely-failing/low-frequency, not silent; and this
project's own sprint process should make the whole-branch adversarial review pass
mandatory rather than optional, since it caught this sprint's only CRITICAL bug.
