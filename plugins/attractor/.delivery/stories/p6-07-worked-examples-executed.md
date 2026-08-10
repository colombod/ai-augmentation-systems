---
id: p6-07
title: Worked examples — ported/adapted from amplifier, each actually executed on this engine (FR-16)
status: done
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-16]
depends_on: [p6-01, p6-02, p6-03]
size: M
---

# Worked examples — each actually executed on this engine

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. See
[ADR-019](../decisions/ADR-019-example-portability-policy.md), authoritative for which
examples port/adapt/exclude — do not redecide portability mid-implementation; if an
example that ADR-019 marked portable turns out not to lint clean on this engine, stop
and report (a real discrepancy between the ADR's analysis and reality), don't silently
drop it from the set without recording why.

## Goal

Port the five directly-portable amplifier examples (`00-convergence-loop`,
`01-simple-linear`, `02-plan-implement-test`, `03-conditional-routing`,
`04-retry-with-fallback`) plus, if budget allows, `practical/bug-fix.dot`, and adapt
`05-parallel-fan-out.dot` (drop its unregistered `tripleoctagon` fan-in node, rely on
this engine's own default zero-success-checking join policy). **Every one of these must
actually be run on this engine** (`node dist/attractor.js run <path> --stub` or the
`verify-run.ts` harness from p6-06) with the real `events.jsonl` transcript committed
alongside the `.dot` file — not described as working, proven working. This is FR-16's
literal requirement and the "1 of 4, not 2 of 4" honesty precedent it cites.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/skills/attractorify/examples/00-convergence-loop.dot` (+`.md`, +`events.jsonl`) | new |
| `plugins/attractor/skills/attractorify/examples/01-simple-linear.dot` (+`.md`, +`events.jsonl`) | new |
| `plugins/attractor/skills/attractorify/examples/02-plan-implement-test.dot` (+`.md`, +`events.jsonl`) | new |
| `plugins/attractor/skills/attractorify/examples/03-conditional-routing.dot` (+`.md`, +`events.jsonl`) | new |
| `plugins/attractor/skills/attractorify/examples/04-retry-with-fallback.dot` (+`.md`, +`events.jsonl`) | new |
| `plugins/attractor/skills/attractorify/examples/05-parallel-fan-out.dot` (+`.md`, +`events.jsonl`) | new — adapted, not verbatim |
| `plugins/attractor/skills/attractorify/examples/practical/bug-fix.dot` (+`.md`, +`events.jsonl`) | new, stretch — only if budget allows |
| `plugins/attractor/skills/attractorify/examples/README.md` | new — the portability table from `architecture.md`, restated here as the examples directory's own index (link back to `architecture.md`'s Example-portability policy as the source, per ADR-019) |
| `plugins/attractor/engine/test/attractorify-examples.test.ts` (or colocated under `skills/attractorify/`) | new — table-driven: every `.dot` in `examples/` lints clean and its committed `events.jsonl` matches a fresh re-run's terminal status |

## Content requirements

For each of the five directly-portable examples: fetch amplifier's actual `.dot` source
(`microsoft/amplifier-bundle-attractor@main`), adapt only what's required to run on
this engine (parameter/prompt text may need light adjustment if it references
amplifier-specific tooling the graph's own `parallelogram` tool_command shells out to —
check each one individually, do not assume zero changes needed just because the shapes
are all registered). Keep the accompanying `.md` guide, corrected the same way p6-02/03
correct reference docs (no `model_stylesheet`, no stray amplifier-only cross-references).

For `05-parallel-fan-out.dot`: port the fan-out structure (the `component` node and its
branches), drop the `tripleoctagon` fan-in node entirely, and route branches directly to
the graph's convergence node — the adapted `.md` guide must say explicitly, in its own
words, that this differs from amplifier's original (which relies on an optional,
separately-wired fan-in node for the zero-success check) because this engine's default
join policy already performs that check unconditionally (cite
[Open Question 5's resolution](../initiatives/spec-conformance-mvp/prd.md), FR-17b).

For each example, run it for real:

```
node dist/attractor.js lint <path>          # must show zero ERROR
node dist/attractor.js run <path> --stub --run-dir <tmp>   # or verify-run.ts, p6-06
```

Commit the resulting `events.jsonl` (copy from the run directory into the example's own
directory, next to the `.dot`) and record the terminal `status`/final node path in the
example's `.md` guide, quoting the actual `RunResult`, not a description of expected
behavior.

## Relevant design decisions

- **[ADR-019](../decisions/ADR-019-example-portability-policy.md)** — the full
  portability table and reasoning; this story executes it, does not re-decide it.
- **[ADR-017](../decisions/ADR-017-delegated-execution-verification.md)** — `verify-run.ts`
  (p6-06) is the preferred way to produce each example's transcript, since it already
  produces the exact `VERIFIED:`/`events:` contract; using it here (rather than the raw
  CLI) keeps the example transcripts produced the same way a real authoring session's
  handback would produce one.

## Acceptance criteria

- [x] `FR-16` — every `.dot` file under `examples/` lints clean (`hasErrors` false).
- [x] `FR-16` — every `.dot` file under `examples/` has a real, committed `events.jsonl`
      that is the actual output of a `--stub` run of that exact file — verified by a test
      that re-runs each example fresh (in a temp run dir) and asserts the terminal
      status matches what the committed `events.jsonl`'s last `pipeline.end` event
      records (catches a stale or hand-edited transcript, not just a missing one) —
      mutation-checked by corrupting a committed transcript and confirming the test fails.
- [x] `FR-16` — `examples/README.md` names every excluded amplifier example and why
      (mirrors `architecture.md`'s table — this is the reader-facing copy of it, one
      level closer to where an author actually looks).
- [x] `05-parallel-fan-out.dot`'s `.md` guide explicitly states the fan-in adaptation and
      why (does not present itself as an unmodified port).
- [x] No example `.dot` file uses `hexagon`, `tripleoctagon`, or `house` — confirmed both
      by `attractor lint` (which would refuse via `HAND-001` if one did) and by the
      doc-consistency script now covering the examples directory's own `.md` files too.
- [x] `node --test` passes, zero regressions, including the new table-driven examples
      test (663 tests, 661 pass, 2 skipped, 0 fail).

## Implementation notes

**Scope note, recorded rather than silently narrowed.** `practical/bug-fix.dot` (the
stretch item, "if budget allows") was not shipped this pass — `examples/README.md`
names this explicitly as a legitimate, un-attempted stretch item, not a silent drop.

**A real bug in p6-06's own harness was found by actually running these examples, not
by inspection** — matching this project's own doctrine ("the worst bug in this project
... was found by executing a real pipeline"). `05-parallel-fan-out.dot` needs a
git-repository `--cwd` (branch-worktree isolation), but `verify-run.ts`'s CLI wrapper
had no `--cwd` flag at all — only the library-level `VerifyRunOptions.cwd` existed,
unreachable by the one caller (a delegated subagent) that only ever sees the CLI. Fixed
with a red test first (`cliMain` wasn't even exported), then `--cwd` parsing added; the
fix and its test are attributed to this story in the commit, with a cross-reference
added to p6-06's own Implementation notes so the story that shipped the original gap and
the story that found it both point at each other.

**Content adaptation, not just handler adaptation.** Four of the five directly-portable
examples (00/02/03/05) needed more than a shape swap to be honestly executable: their
amplifier originals gate on real `pytest`/file-existence checks that only a live LLM
writing real files can satisfy, which is a `--live` claim this pass does not make.
Adapted each to a self-contained deterministic gate (a counter file) that preserves the
exact DOT structure and routing pattern being taught while being provably convergent
under `--stub` — recorded explicitly in each example's own `.md` guide, not left for a
reader to discover by diffing against the amplifier original themselves. `04` required
the largest adaptation (amplifier's original is a ~250-line explicit-renegotiation
pattern) and is labeled as substantially simplified, not merely content-swapped, with an
explicit pointer to the original for the full pattern.

**Every `VERIFIED: status=...` line quoted in an example's `.md` guide is the literal
output of the actual run that produced its committed transcript** — not retyped from
memory or hand-formatted to look right.

## Test approach

**Level:** integration, table-driven over every file in `examples/*.dot` (and
`examples/practical/*.dot` if the stretch example ships): for each, (1) `lint()` returns
no ERROR diagnostic, (2) a fresh `--stub` run's terminal `RunResult.status` matches the
last recorded status in the committed `events.jsonl`. Use `engine/src/index.ts` (p6-01)
directly rather than spawning the CLI as a subprocess, for speed and direct access to
`RunResult`.

Follow TDD per-example: for each new `.dot` file, write its test row (in the
table-driven file) referencing the not-yet-committed `events.jsonl` first is not
meaningful red/green in the usual sense (the file doesn't exist to compare against yet)
— instead, treat "run it once, commit the transcript, then the re-run-matches-transcript
test passes" as this story's actual TDD loop: the test asserting a *fresh* run doesn't
error and produces SOME terminal status is the meaningful red-first case (fails before
the `.dot` file exists at all), and the transcript-matches-commit assertion is added once
the first real transcript is committed.

**Run with:** `node --test test/attractorify-examples.test.ts` (or the equivalent path
if colocated under `skills/attractorify/`).

## Out of scope

- Any example using `Handler.HUMAN`/`Handler.FAN_IN`/`Handler.MANAGER_LOOP`,
  `model_stylesheet`, fidelity modes, or cross-restart resume — all excluded per
  ADR-019, not this story's problem to work around.
- A `--live` transcript for any example — `--stub` is the committed evidence; a `--live`
  run is a manual, non-automated stretch an operator could do later, not required here.

## Dependencies

Depends on p6-01 (library entry point, used by the table-driven test and optionally by
`verify-run.ts` if p6-06 has landed first — if p6-06 hasn't landed yet, use the raw CLI
instead and switch to `verify-run.ts` in a follow-up, don't block this story on p6-06).
Depends on p6-02/p6-03 for the reference material these examples are cited from
(`README.md`'s example index cross-references them) — soft dependency, sequence after
if possible but not a hard blocker on file existence.
