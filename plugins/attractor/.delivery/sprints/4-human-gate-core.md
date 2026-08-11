<!--
BUDGET — target 600 words, hard cap 900 words. Excludes code, YAML and data tables.
The scope, verification and report-back tables are data.
-->

---
sprint: 4
slug: human-gate-core
scope: Phase 2 — FR-5-8 (human-gate channels, S2)
status: handed-off
runner: same session, in-process TDD implementation (not an external handoff)
branch: claude/attractor-phase-2-human-gate-227212
---

# Sprint 4 scope package: human-gate core (FR-5–8)

> **Input for an implementation run.** This plugin does not implement — it scopes,
> reviews and re-aligns. Whatever runs this (your harness, a coding agent, a team)
> should need nothing but this file and the repository.
>
> Assume the runner has no memory of the planning and cannot ask questions.

**Runner note, this sprint specifically:** the runner is the same session that just produced
this scope, implementing immediately afterward — not a memoryless external hand-off. The
document is still written to the full self-sufficient standard (every field below is real, not
elided), since `/delivery:sprint-review` re-verifies against this file independently, the same
as any other sprint.

**Baseline, captured immediately before this sprint starts (`node --test`, from
`plugins/attractor/engine`):** 663 tests, 661 pass, 2 skipped, 0 fail. Every story's own
acceptance criteria require the suite to stay at 0 fail throughout; the running total after each
story is part of that story's own commit message.

## Scope

**Stage promise:** `.delivery/initiatives/spec-conformance-mvp/prd.md`'s S2 — a human-gate
pipeline blocks and resumes correctly while waiting, closing FR-5/6/7/8 for persona P-2 (this
slice, per ADR-023, via `agent`/`CommandChannel` — never `human` alone).
`/delivery:sprint-review` checks the result against exactly this.

| Order | Story | Path | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- |
| 1 | p2-01 | `.delivery/stories/p2-01-shell-helper-relocation.md` | none | S |
| 2 | p2-02 | `.delivery/stories/p2-02-channel-core-contracts.md` | none | S |
| 3 | p2-03 | `.delivery/stories/p2-03-human-channel.md` | p2-02 | S |
| 4 | p2-04 | `.delivery/stories/p2-04-agent-channel.md` | p2-02 | M |
| 5 | p2-05 | `.delivery/stories/p2-05-command-channel.md` | p2-01, p2-02 | M |
| 6 | p2-07 | `.delivery/stories/p2-07-human-gate-handler.md` | p2-02 | L |
| 7 | p2-06 | `.delivery/stories/p2-06-channel-registry-preflight.md` | p2-03, p2-04 | M |
| 8 | p2-08 | `.delivery/stories/p2-08-handler-human-registration.md` | p2-06, p2-07 | M |
| 9 | p2-09 | `.delivery/stories/p2-09-cli-wiring-exports.md` | p2-08 | M |
| 10 | p2-10 | `.delivery/stories/p2-10-fr5-real-subprocess-verification.md` | p2-09 | S |

Order 1–6 (`p2-01`, `p2-02`, `p2-03`, `p2-04`, `p2-05`, `p2-07`) is a single-implementer
linearization of a graph the roadmap's own work-item table (A–J) documents as genuinely
parallel where marked — since this run is one implementer, one session, sequencing them by
story number within the parallel-eligible set costs nothing and keeps the commit history
readable. `p2-06` is placed after `p2-07` in this linear order (not before, despite depending
only on `p2-03`/`p2-04`) purely for narrative continuity — the handler consuming
`preflightHumanGates` reads better once the handler itself exists — but has no dependency on
`p2-07`; a reviewer should not read this ordering as a dependency claim beyond what the
Depends-on column states. `p2-08` through `p2-10` are a strict linear tail — each is the
integration point the roadmap names, and none is safely reorderable.

**Deliberately excluded** — do not add these; they were scoped out on purpose.

| Story / feature | Why excluded |
| :-- | :-- |
| Real stdin-answer parsing for the `human` channel | Out of scope this slice per ADR-023; `.superpowers/carry-forward.md` Plan 4 files it as future work |
| A pty-backed real-subprocess test of the interactive TTY-blocking branch | NFR-6 caps runtime/dev deps at 2; no pty dependency taken on, named as an accepted methodology gap in `p2-10` |
| Any Phase 4 (embedder WARNING visibility) work | Separate, unscoped roadmap phase; no dependency either direction |
| S7 example-portability revisit (`08-human-gate.dot` etc.) | Explicitly deferred to **after** this sprint ships — `Handler.HUMAN` must be registered (`p2-08`) before those exclusions can even be re-evaluated |

## Pre-flight (verified before hand-off)

- [x] Every story in scope is `ready` (`.delivery/stories/README.md`'s Phase 2 Readiness section)
- [x] Every acceptance criterion is falsifiable — each story's own criteria checked during writing
- [x] No open **blocking** findings against the specs this scope depends on (`.delivery/reviews/`
      has no architecture- or stories-scoped review yet filed; `prd-01.md`'s 11 findings are all
      `fixed`)
- [x] No story depends on unfinished work outside this scope (`p2-01`…`p2-10` depend only on each
      other; Phases 1/5/6 they touch adjacent code near are `done`)
- [x] Story file paths verified to exist against the repo (spot-checked directly during both the
      architecture and stories passes, not merely cited)

## Design constraints

Not applicable — this is engine/CLI work, no `design-system.md` exists for this initiative, and
no UI surface is touched.

## Verification contract

**Test command:** `node --test` (from `plugins/attractor/engine`), full suite, after every
story. Targeted: `node --test test/<file>.test.ts`. `p2-10` additionally requires `npm run build`
(from `plugins/attractor/engine`) before its own test run, since it exercises `dist/attractor.js`.
**Must pass:** the full suite, 0 fail, after every story's commit — never left red between
stories (binding per `p2-08`'s own "atomic together" requirement).

| Story | FR | Acceptance criterion | How verified |
| :-- | :-- | :-- | :-- |
| p2-01 | FR-8 (enabling) | `tool.test.ts` passes unmodified after relocation | `node --test test/tool.test.ts` |
| p2-02 | FR-8 | `isChannelViable`/`whyNotViable` per-branch correctness | new `channels-types.test.ts` |
| p2-03 | FR-5, FR-6 | `HumanChannel` never returns a real label; `timeoutMs:null` never resolves | new `channels-human.test.ts` |
| p2-04 | FR-8 | `allowed:false` spawns nothing; argv includes safety prefix | new `channels-agent.test.ts` + `argv.test.ts`/`claude-backend.test.ts` unchanged |
| p2-05 | FR-8 | shell-quoting closes injection (mutation-checked) | new `channels-command.test.ts` |
| p2-06 | FR-5, FR-6, FR-8 | preflight refusal matrix; `defaultChannels()`/`isChannelViable` agreement | new `channels-preflight.test.ts` + `lint.test.ts` unchanged |
| p2-07 | FR-5, FR-6, FR-8 | chain-walk escalation/timeout/fallback, `legalAnswers` (ADR-025) | new `handlers-human.test.ts` |
| p2-08 | FR-5, FR-6, FR-7, FR-8 | 8-test HITL-001 suite unmodified; migration repoints; preflight+dispatch agreement | `lint.test.ts`, `engine.test.ts` |
| p2-09 | FR-8 | CLI flag parsing/refusal; fast-path preflight before worktree creation | `cli.test.ts`, `index.test.ts` |
| p2-10 | FR-5, FR-7 | real built-CLI non-TTY fail-fast; final full-suite regression | `bundle.test.ts` against `dist/attractor.js` |

## Stop conditions

Stop and report rather than improvising. **A blocked story reported honestly is a success.
Quietly redesigning around a blocker is a failure.**

- The story cannot be implemented as written — spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope
- Tests fail for reasons inside the story's scope after bounded retries
- Two consecutive stories block — the plan is wrong, not the stories

Design decisions belong to the Solution Architect. Do not redesign mid-run — surface a conflict
against `architecture.md`/the ADRs as a stop condition, not a silent deviation.

## Working agreement

- Branch: `claude/attractor-phase-2-human-gate-227212` (already the active branch, off current
  `main`) — not `main` itself
- One commit per story, message naming the story ID
- **Do not weaken a test to make it pass.** If a test is wrong, report it and say why.

## Required report-back

`/delivery:sprint-review` needs all of this. Return it verbatim rather than summarised.

| Story | Outcome | Criteria met | Evidence | Commit |
| :-- | :-- | :-- | :-- | :-- |
| p2-01 | | | | |
| p2-02 | | | | |
| p2-03 | | | | |
| p2-04 | | | | |
| p2-05 | | | | |
| p2-06 | | | | |
| p2-07 | | | | |
| p2-08 | | | | |
| p2-09 | | | | |
| p2-10 | | | | |

**Actual test output** (the output itself, not a claim about it):

```
(filled in per story during implementation, and once at the end for the full suite)
```

**Conflicts with the spec encountered:**

**Design system deviations, and why:** n/a — no design system for this initiative.

**Anything the next planning cycle should know:**
