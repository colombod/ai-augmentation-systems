<!--
BUDGET — target 600 words, hard cap 900 words. Excludes code, YAML and data tables.
-->

---
sprint: 3
slug: parallel-handler
scope: Phase 5 remainder (plugins/attractor/.delivery/roadmap.md)
status: completed
runner: superpowers (subagent-driven-development)
branch: worktree-attractor-parallel-fanin
---

# Sprint 3 scope package: ParallelHandler integration (FR-17b, closing Phase 5)

> **Input for an implementation run.** This plugin does not implement — it scopes,
> reviews and re-aligns. Whatever runs this (superpowers' `subagent-driven-development`)
> should need nothing but this file, the one story below, and the repository.
>
> Assume the runner has no memory of the planning and cannot ask questions.

## Scope

**Stage promise:** Phase 5 delivers FR-17b — `Handler.PARALLEL` fan-out with worktree
isolation, a fail-closed default join policy, and branch context merge-back. Sprint 2
("parallel-fanin") shipped every prerequisite. This sprint lands the integration point
itself: `ParallelHandler`, registered, so a `component`-shaped node actually runs. Roadmap
item A's two blocking Solution Architect decisions are resolved
([ADR-013](../decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md)) —
`p5-08` is `ready`, no longer `draft`.

| Order | Story | Path | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- |
| 1 | p5-08 — Register `Handler.PARALLEL` (`ParallelHandler`) | `.delivery/stories/p5-08-parallel-handler-integration.md` | p5-01, p5-03, p5-04, p5-05, p5-07 (all `done`, sprint 2) | L |

**Deliberately excluded** — do not add these; they were scoped out on purpose.

| Story / feature | Why excluded |
| :-- | :-- |
| `p5-09` — concurrency verification under a real `ParallelHandler` | `status: draft`, not `ready` — its own two remaining rows (checkpoint isolation under real fan-out; the opt-in `ATTRACTOR_LIVE=1` ceiling test) need `p5-08` to exist to be non-decorative, and the story itself needs a readiness pass this sprint doesn't include. Natural next sprint once `p5-08` ships. |
| Roadmap item J's other rows | Already closed elsewhere (`GatedBackend`/worktree-collision in p5-01, shared-ledger race in p5-05) or covered by `p5-08`'s own acceptance criteria (concurrency ceiling, branch-throws) — see `p5-08`'s own "Out of scope" section. |

## Pre-flight (verified before hand-off)

- [x] `p5-08` is `ready` (frontmatter confirmed; two previously-BLOCKED acceptance criteria
      filled in from ADR-013, verified against the current repo, not the story's own stale
      draft citations)
- [x] Every acceptance criterion is falsifiable — exact test names/fixtures cited in the
      story's own "Test approach" section
- [x] No open **blocking** findings — checked `.delivery/reviews/`; sprint 2's own review
      (`sprint-2-01.md`) has 8 open findings, none `blocking` severity (3 significant, 5 minor)
- [x] No story in scope depends on unfinished work — all 5 dependencies (p5-01/03/04/05/07)
      are `done`, shipped in sprint 2, independently re-verified in that sprint's own review
- [x] Story file path verified to exist: `plugins/attractor/.delivery/stories/p5-08-parallel-handler-integration.md`

## Design constraints

No `.delivery/design-system.md` exists for this project — it is a CLI/engine plugin with
no UI surface. Not applicable to this sprint.

## Verification contract

**Test command:** `cd plugins/attractor/engine && node --test` (full suite) — targeted
loop during TDD: `cd plugins/attractor/engine && node --test test/parallel.test.ts`.
**Must pass:** the full suite, zero regressions (baseline today: 584 tests, 583 passing, 1
intentionally skipped, 0 failing — same shape, plus the story's own new tests, must hold at
the end of the sprint).

| Story | FR | Acceptance criterion | How verified |
| :-- | :-- | :-- | :-- |
| p5-08 | FR-17b, NFR-7 | `max_parallel`-bounded semaphore admits at most that many concurrent `runBranch` calls | `GatedBackend` at 3 concurrency levels, `node --test test/parallel.test.ts` |
| p5-08 | FR-17b | One `createWorktree` per branch unless `isolate="false"`; `removeWorktree` runs per-branch, not deferred | story's own test |
| p5-08 | FR-17b | `applyDefaultJoinPolicy`: FAIL iff zero SUCCEED/PARTIAL, SUCCESS iff zero FAIL, PARTIAL otherwise | all-fail/all-success/mixed/one-branch/zero-branch fixtures |
| p5-08 | FR-17b | `mergeBranchContext` called exactly once per dispatch, after every branch settles, regardless of join verdict | story's own test |
| p5-08 | FR-17b | `defaultHandlers()` registers `ParallelHandler`; `UNREGISTERED_HANDLER_KINDS` no longer includes `Handler.PARALLEL` (story's last line) | `node --test`, full suite |
| p5-08 | FR-17b | Retry/partial-completion interacting with convergence: a branch's exhausted-retry FAIL with a declared `outputs=` key correctly blocks the convergence node via the existing eager-input check | story's own test |
| p5-08 | FR-17b, ADR-013 A(a) | SUCCESS/PARTIAL join outcome jumps unconditionally to `findConvergenceNode`'s result (bypassing `selectEdge`); FAIL uses the ordinary `retry_target`/dead-end ladder, unchanged | story's own test, 3-branch fixture across 3 join outcomes |
| p5-08 | FR-17b, ADR-013 A(b) | A real `createWorktree` throw on one branch doesn't reject `Promise.all`; converts to that branch's own FAIL; siblings unorphaned; `ParallelHandler.execute()` never itself rejects | story's own test |

## Stop conditions

Stop and report rather than improvising. **A blocked story reported honestly is a
success. Quietly redesigning around a blocker is a failure.**

- The story cannot be implemented as written — spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope (see Deliberately excluded, above)
- Tests fail for reasons inside the story's scope after bounded retries
- Anything in this sprint turns out to actually need a THIRD Solution Architect decision not
  named in ADR-013 — stop and report rather than guessing at it

Design decisions belong to the Solution Architect. Do not redesign mid-run — in particular,
do not re-derive ADR-013's own A(a)/A(b) answers; consume them as given.

## Working agreement

- Branch: `worktree-attractor-parallel-fanin` — the same worktree/branch sprint 2 used,
  already clean and fully committed through sprint 2's own acceptance review; this session's
  own harness is restricted to this worktree, so a new one is not created for this sprint
- One commit per story (this sprint has exactly one story; expect one or more commits plus
  any fix-loop rounds, matching this project's own established `subagent-driven-development`
  practice — never more than one implementer subagent live at a time)
- **Do not weaken a test to make it pass.** If a test is wrong, report it and say why.

## Required report-back

`/delivery:sprint-review` needs all of this. Return it verbatim rather than summarised.

| Story | Outcome | Criteria met | Evidence | Commit |
| :-- | :-- | :-- | :-- | :-- |
| p5-08 | done | 8/8 | See `.delivery/stories/p5-08-parallel-handler-integration.md`'s own "Acceptance criteria" (all `[x]`) and "Implementation notes" sections | `030c927`, `03b0d8b`, `0951929`, `6391286`, `0baeb64` |

Five commits, not one, because this story was implemented as three sequentially-reviewed
sub-units (foundations → `ParallelHandler` itself → registration/convergence-jump) plus one
review-fix round and one final coverage addition — matching this sprint's own working
agreement that a story may take more than one commit, never more than one implementer live
at a time. Two independent adversarial review passes ran against this code (not merely the
implementer's own self-report): the first, after `ParallelHandler` itself landed, found and
led to fixing two real bugs (`max_parallel="0"` deadlocking `Promise.all` forever; an
`EventLog.append` failure escaping `execute()` and rejecting the whole dispatch instead of
degrading gracefully) — both reproduced concretely, both now permanently regression-tested.
The second pass, after registration + the ADR-013 A(a) convergence-jump landed, found no
defects, including a concrete reproduction of a nested-`PARALLEL` double-dispatch scenario
against the real engine. One acceptance criterion (retry-exhaustion inside a branch
interacting with the convergence node's eager-input check) was not assigned to any of the
three dispatched implementation tasks — caught during this sprint's own close-out, closed
with one additional test proving the pre-existing `failedOutputs` mechanism already handled
it correctly by construction; no source fix was needed.

**Actual test output** (the output itself, not a claim about it):

```
$ cd plugins/attractor/engine && node --test
ℹ tests 609
ℹ suites 0
ℹ pass 608
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 8851.880584
```

Baseline at sprint start: 584 tests, 583 passing, 1 skipped. End of sprint: 609 tests, 608
passing, 1 skipped (the same pre-existing environment-gated `live.test.ts` test, ungated by
a live credential in this environment) — net +25 tests, 0 regressions throughout.

**Conflicts with the spec encountered:** None. All of ADR-013's own decisions (A(a), A(b))
were consumed as given, never re-derived, matching this sprint's own working agreement.

**Design system deviations, and why:** N/A — no design system for this project.

**Anything the next planning cycle should know:**

- `p5-09` (concurrency verification under a now-real `ParallelHandler`) is the natural next
  story — still `status: draft`, needs its own readiness pass before it can be scoped.
- Two new event types were added as part of this story, neither previously named in the PRD
  or architecture docs: `node.parallel.worktree_warning` (a branch's `removeWorktree` call
  returned `removed: false`) and the pre-existing `node.parallel.context_collision` (p5-07)
  is now exercised by a real handler for the first time. Neither changes routing or `Outcome`
  shape — purely additive observability, but worth a line in `architecture.md` if that
  document is revisited.
- The story-decomposition process (this sprint scoped exactly one story, "L"-sized) turned
  out to need three separately-reviewed implementation sub-units in practice, not because the
  story was mis-sized but because the underlying testability boundary genuinely split that
  way (a fan-out/join/worktree unit testable via a `Handler.TOOL`-registration workaround,
  independent of the registration+routing unit that could only be tested once real
  registration existed). Worth naming as a pattern for future "integration point" stories
  that sit at the seam between two already-built subsystems.
