<!--
BUDGET — target 600 words, hard cap 900 words. Excludes code, YAML and data tables.
The scope, verification and report-back tables are data.
-->

---
sprint: 1
slug: hitl-003-self-report-guard
scope: Phase 1 (plugins/attractor/.delivery/roadmap.md)
status: scoped
runner: superpowers (subagent-driven-development)
branch: worktree-attractor-hitl-003-selfreport
---

# Sprint 1 scope package: HITL-003 self-report guard

> **Input for an implementation run.** This plugin does not implement — it scopes,
> reviews and re-aligns. Whatever runs this (superpowers' `subagent-driven-development`)
> should need nothing but this file, story `p1-01`, and the repository.
>
> Assume the runner has no memory of the planning and cannot ask questions.

## Scope

**Stage promise** (`prioritization.md`, Stage 2): FR-18 only. Does not complete a new
persona journey — the `agent` channel it guards has no runtime yet (FR-8 is uncoded). It
earns its stage as a required precondition before the `agent` channel ships, per
`carry-forward.md`'s Plan 4, and as this project's first exercise of a lint-time,
single-hop predecessor trace.

| Order | Story | Path | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- |
| 1 | p1-01 — HITL-003 self-report guard | `.delivery/stories/p1-01-hitl-003-self-report-guard.md` | none | S |

**Deliberately excluded** — do not add these; they were scoped out on purpose.

| Story / feature | Why excluded |
| :-- | :-- |
| Registering `Handler.HUMAN` / the `human`/`agent` channels themselves (FR-5–8) | Roadmap Phase 2 — blocked on an unstarted architecture pass, not this sprint |
| Multi-hop self-report detection | Named residual risk in `p1-01`'s ADR-006 deliverable, not closed here |
| `Handler.TOOL` predecessor detection | Rejected as unprovable at lint time (conditional write on exit code) — see ADR-006 |
| Embedder WARNING visibility fix (FR-12) | Blocked on Open Question 7 — this sprint states the gap, does not close it |

## Pre-flight (verified before hand-off)

- [x] Story `p1-01` is `ready` (frontmatter `status: ready`)
- [x] Every acceptance criterion in `p1-01` is falsifiable (exact diagnostic shape per fixture, exact test command)
- [x] No open **blocking** findings — `reviews/prd-01.md` and `reviews/brief-01.md` are both fully `fixed`
- [x] No dependency on unfinished work outside scope — `p1-01`'s `depends_on: []`, confirmed no reliance on `Handler.HUMAN` registration
- [x] File paths verified live against the repo by the Delivery Lead during story-writing (re-grepped every citation), not re-verified a second time here

## Design constraints

No `.delivery/design-system.md` exists for this project — it is a CLI/engine plugin with
no UI surface. Not applicable to this sprint.

## Verification contract

**Test command:** `cd plugins/attractor/engine && node --test` (full suite) — targeted loop
during TDD: `cd plugins/attractor/engine && node --test test/lint.test.ts`
**Must pass:** the full suite, zero regressions (baseline today: 487 tests, 486 passing, 1
intentionally skipped — same shape must hold after).

| Story | FR | Acceptance criterion | How verified |
| :-- | :-- | :-- | :-- |
| p1-01 | FR-18 | `ADR-006` exists with the CODERGEN-only decision, citations, `## Residual risk` section, FR-12 caveat | file exists, reviewed for the four required elements |
| p1-01 | FR-18 | `directPredecessor(graph, nodeId)` exported from `graph.ts`, in-degree-1 semantics | unit test, `graph.test.ts` or inline in `lint.test.ts` |
| p1-01 | FR-18 | `HITL-003` fires correctly on P1–P5, does not fire on N1–N8 | 13 of the 16-case matrix in `p1-01`'s Test approach |
| p1-01 | FR-18 | Advisory-only: `hasErrors()` stays `false` on a firing fixture (B1); co-fires cleanly with `HAND-001` (B2); message content meets the B3 bar | 3 boundary tests |
| p1-01 | FR-18 | `README.md` documents `HITL-003`, its severity, and the FR-12 gap | diff review |
| p1-01 | FR-18 | Full suite green, zero regressions | `node --test` output |

## Stop conditions

Stop and report rather than improvising. **A blocked story reported honestly is a
success. Quietly redesigning around a blocker is a failure.**

- The story cannot be implemented as written — spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope (see Deliberately excluded, above)
- Tests fail for reasons inside the story's scope after bounded retries
- The CODERGEN-only scope decision (ADR-006) turns out contentious — file the broader
  reading as a Residual Risk bullet per `roadmap.md`'s Phase 1 cut list; do not resolve it
  by expanding scope mid-run

Design decisions belong to the Solution Architect. Do not redesign mid-run.

## Working agreement

- Branch: `worktree-attractor-hitl-003-selfreport` — already checked out, fresh off
  `origin/main` (this branch's only other commits are this sprint's own delivery-pipeline
  artifacts: PRD/prioritization/roadmap/story, plus one cherry-picked commit reconciling
  the human-gate design divergence from a prior branch)
- One commit per story — story `p1-01` is one story, so one implementation commit is
  expected (TDD steps within it may commit incrementally per `superpowers:writing-plans`
  convention; squash is not required)
- **Do not weaken a test to make it pass.** If a test is wrong, report it and say why.

## Required report-back

`/delivery:sprint-review` needs all of this. Return it verbatim rather than summarised.

| Story | Outcome | Criteria met | Evidence | Commit |
| :-- | :-- | :-- | :-- | :-- |
| p1-01 | | | | |

**Actual test output** (the output itself, not a claim about it):

```
```

**Conflicts with the spec encountered:**

**Design system deviations, and why:** N/A — no design system for this project.

**Anything the next planning cycle should know:**
