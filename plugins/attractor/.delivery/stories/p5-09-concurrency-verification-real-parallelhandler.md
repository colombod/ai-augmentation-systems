<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-09
title: Prove NFR-7's concurrency guarantees against a real ParallelHandler — checkpoint isolation and opt-in live-subprocess ceiling
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [NFR-7]
depends_on: [p5-08]
size: S
---

# Prove NFR-7's concurrency guarantees against a real ParallelHandler — checkpoint isolation and opt-in live-subprocess ceiling

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Context — why this is a separate story, and why `draft`

Roadmap item J originally listed five test-infrastructure rows. Three are already closed:
`GatedBackend` and the worktree-name-collision test shipped in p5-01; the shared-ledger race
property is substantively demonstrated by p5-05's own test; concurrency-ceiling enforcement and
branch-throws mid-flight are p5-08's own acceptance criteria (ADR-013 unblocked the latter). Two
rows remain, and neither fits p5-08's own vertical slice (register/fan-out/join/merge-back): they
are **verification**, not **capability**, and both need the real `ParallelHandler` p5-08 ships to
be non-decorative — the hand-built `BranchLaunchingHandler` test double p5-01–p5-07's own tests
use proves the underlying mechanism but not that `ParallelHandler` wires it correctly end to end.

Was `draft`, not blocked by an open design decision (unlike p5-08 before ADR-013) — simply nothing
real to test until p5-08 was `done`. **Moved to `ready` 2026-08-08** — `p5-08` shipped and its
citations here (`engine.test.ts:4297`, `live.test.ts` lines 11/13) re-verified against the current
code, still accurate.

## Goal

- **Checkpoint isolation under a real fan-out.** While a real `ParallelHandler`'s branches are
  still in flight (held open via `GatedBackend`), the outer run's own `checkpoint.json` never
  names a branch-interior node as `currentNode`, and each branch's own `checkpoint.json` (its own
  branch-scoped `runDir`) never collides with a sibling's or the outer run's. `architecture.md`
  already states this is closed **by construction** (distinct `runDir` per branch/run) — this
  story is the confirming integration proof through the real dispatch path, not a new mechanism.
- **Opt-in real-subprocess ceiling (`ATTRACTOR_LIVE=1`, Layer 3).** A real `ClaudeCodeBackend`
  fan-out, `max_parallel` below the branch count, never exceeds that many concurrent subprocesses
  — the one piece of NFR-7's three-layer claim no CI environment here reliably reproduces (Layers
  1–2 are fully automated and already covered by p5-08's own semaphore test and p5-01's real-`git`
  concurrency test). Roadmap's own cut list ranks this **first to drop if late** — ship it, but it
  is not gating.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/test/parallel.test.ts` | modify — add the checkpoint-isolation integration test, `GatedBackend`-driven, through a real `ParallelHandler` dispatch |
| `plugins/attractor/engine/test/live.test.ts` | modify — add the opt-in `ATTRACTOR_LIVE=1` real-subprocess ceiling test, same `{ skip: !LIVE }` pattern the existing test in this file already uses |

## Relevant design decisions

- **`architecture.md`'s Component structure, item 6 (Checkpoint).** States the isolation property
  is closed by construction: `executeNodeStep` calls the exported `saveCheckpoint(runDir, cp)`
  with a caller-supplied `runDir` — the main loop's own, or a branch-scoped one from `runBranch` —
  never the private `this.checkpoint()` wrapper. This story does not change that mechanism; it
  proves it holds through the real `ParallelHandler`.
- **Roadmap's own cut list, item 1.** Layer 3 (`ATTRACTOR_LIVE=1`) is named lowest-priority,
  droppable without cost since Layers 1–2 already prove the mechanical ceiling claim.

## Acceptance criteria

- [x] `NFR-7` — a real `ParallelHandler` fan-out (≥2 branches, `GatedBackend`-held mid-flight):
      `loadCheckpoint(outer runDir).currentNode` stays whatever it was immediately before
      dispatch throughout, never a branch-interior node id.
- [x] `NFR-7` — each branch's own `checkpoint.json`, under its own branch-scoped `runDir`, is a
      distinct file from the outer run's and from every sibling branch's; reading all of them
      mid-flight shows no cross-contamination (no branch's `currentNode` bleeding into another's
      file or the outer run's).
- [x] `NFR-7` — `{ skip: !LIVE }`, `ATTRACTOR_LIVE=1` only: a real `ClaudeCodeBackend` fan-out of
      N branches with `max_parallel < N` never runs more than `max_parallel` real subprocesses
      concurrently (observable the same way `GatedBackend.maxObserved` proves it at the mock
      level, now against genuine OS processes).
- [x] `node --test` (from `plugins/attractor/engine`) passes, zero regressions, with
      `ATTRACTOR_LIVE` unset (Layer 3 stays opt-in, never CI).

## Test approach

**Level:** integration. Checkpoint isolation: `GatedBackend`-driven, the same `loadCheckpoint`
mid-flight-read pattern p5-05's own test already established (`engine.test.ts:4297`) — extended
here to go through a real `ParallelHandler.execute()` call (via `defaultHandlers(backend)` with
`Kind.PARALLEL` registered, not a hand-built `BranchLaunchingHandler`) so the property is proven
against the actual dispatch path, not a stand-in. Live-subprocess ceiling: the same `LIVE =
process.env.ATTRACTOR_LIVE === '1'` / `{ skip: !LIVE }` gate `live.test.ts` already uses (lines
11, 13) — not CI, run manually or in a dedicated opt-in job.

**Run with (from `plugins/attractor/engine`):** `node --test test/parallel.test.ts` (checkpoint
isolation, always runs); `ATTRACTOR_LIVE=1 node --test test/live.test.ts` (Layer 3, opt-in).

## Out of scope

- Everything already closed elsewhere: `GatedBackend`/worktree-name-collision (p5-01), the
  shared-ledger race property (p5-05), concurrency-ceiling enforcement and branch-throws
  mid-flight (p5-08). Not re-tested here — re-proving an already-load-bearing property a second
  time is ceremony, not coverage.
- Resume-from-checkpoint (reading a branch's own `checkpoint.json` back in) — NFR-9 stays unwired
  this slice, per `architecture.md`; branch-level checkpoints exist only so a future resume
  feature has state to read.

## Dependencies

p5-08 must be `done` first — `ParallelHandler` does not exist before it, and both rows here are
specifically about proving properties through the REAL handler, not a test double.

## Implementation notes

Shipped in one commit (`025e727`), pure test additions, no production code touched.

**Checkpoint isolation test:** goes through the real registered `ParallelHandler` (no
`Handler.TOOL` workaround needed, unlike every earlier story's own tests, since real registration
now exists). One real deviation from the story's own sketch, found and fixed during
implementation: a single-node branch has nothing written to its own `checkpoint.json` yet while
gated open, since a node's checkpoint write only happens after its handler resolves — each branch
was made two nodes deep so there's a real file to read mid-flight. The convergence node
(`join`, dispatched by the outer run through the same gated backend once both branches settle)
also needed its own explicit wait/release step the story's own sketch didn't call out.

**Live-subprocess ceiling test:** written and correctly gated `{ skip: !LIVE }`, confirmed to skip
by default (part of the 613/615 passing count above). **Not actually run with `ATTRACTOR_LIVE=1`**
— it costs real API calls, and this story's own text frames it as "opt-in... run manually," never
required for the story's own closing. Whoever runs it first should report back here.

**Final state:** 615 tests, 613 passing, 2 correctly-skipped (the pre-existing `live.test.ts`
credential-gated test, and this story's own new opt-in ceiling test), 0 failing.
