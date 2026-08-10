<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-02
title: Extract Engine#executeNodeStep as the one shared per-node step implementation
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b, NFR-1]
depends_on: []
size: L
---

# Extract Engine#executeNodeStep as the one shared per-node step implementation

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`Engine.run()`'s existing loop is refactored onto one new shared private method,
`executeNodeStep()`, plus a new `stepCount` instance field replacing the loop's local `step`
variable — with **zero observable behavior change**. This is one of Phase 5's two load-bearing
prerequisites (alongside p5-01): it is what lets the not-yet-built `runBranch` (p5-05) reuse the
exact per-node step logic the main loop already runs, rather than a second, independently
maintained copy that can silently drift from the first.

## Context

The main loop (`engine.ts:643-1088`, confirmed today) is a flat sequential `for` loop over one
`currentId`. Two findings from the architecture's adversarial review (F5, F6) share one root
cause: nothing about "the per-node step" was ever factored out as its own unit.

**F5.** Without a real shared counter, a **branch** (p5-05) containing a routing cycle that never
reaches its stop frontier has no stated bound — the loop's `for (let step = 0; step < maxSteps;
step++)` enforces the 500-step cap (NFR-1) by construction; a hand-written `runBranch` loop built
independently would need its own limit, kept in sync by hand. Left unfixed, `max_parallel`
branches each independently capped at `maxSteps` would multiply the run-wide ceiling.

**F6.** The per-node step does more than "retry, eager-input-check, `recordOutcome`" — it also
writes a checkpoint (hardwired today to `this.opts.runDir` via the private `this.checkpoint()`
wrapper, `engine.ts:247-262`), handles the graph's real EXIT node (`engine.ts:972-1043` —
goal-gate check, `this.checkpoint(null)`, terminal `RunResult`), and handles a dead end
(`engine.ts:1071-1084`), each carrying a hard-won ordering invariant (two `recordOutcome` calls
per step; a retry `continue`s *before* `this.checkpoint()`). A second, independently written
`runBranch` loop could get any of these subtly wrong — this codebase already extracts
`findConvergenceNode`/`SUBSTITUTABLE_ATTRS` once rather than risking two copies drifting; ADR-012
(binding) applies the same precedent here, over the rejected parity-tested-duplication alternative.

**What this story does NOT build.** `runBranch` does not exist after this story — that is p5-05's
job. This story's exit condition is narrower: the *existing* test suite passes unchanged against
the refactored `run()`, since this is a refactor of tested code, not an additive change.

**Caveat, not resolved here.** This story's "closed, refactor-only" status is conditional on how
the still-open Solution Architect decision (roadmap item A) resolves — whether a `PARALLEL`
node's join-FAIL outcome routes via the ordinary fail-edge/`retry_target` ladder, or via an
unconditional jump mutating the loop-local `currentId` inside `run()` directly. The latter
reading, if chosen, can only be implemented inside `run()` itself — reopening this story's exit
criteria as an additive change later, not a pure refactor. Not blocked on it today; do not treat
this story as permanently closed once A is answered.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/core/engine.ts` | modify — extract `executeNodeStep()` from the existing loop body; add `private stepCount = 0`; refactor `run()`'s loop into a thin caller interpreting `StepResult` |

No other file changes — a self-contained refactor with no public API surface change
(`EngineOptions`, `RunResult`, `defaultHandlers()` unaffected).

## Interfaces and contracts to honor

```ts
// core/engine.ts — private, no public surface change (ADR-012)
private stepCount = 0   // NEW instance field, replaces the loop-local `step` variable

type StepResult =
  | { kind: 'continue'; nextId: string }
  | { kind: 'stop'; reason: 'exit' | 'frontier' | 'deadend' | 'stepcap'; nodeId: string; outcome: Outcome }

private async executeNodeStep(
  currentId: string,
  opts: { runDir: string; cwd: string; maxSteps: number; stopAt?: ReadonlySet<string> },
): Promise<StepResult>
```

`executeNodeStep` does exactly what the loop body currently does for one node — dispatch
(eager-input-check via `unavailableInput`, `runs_on` skip logic, handler call or skip, the RETRY
ladder with its two `recordOutcome` calls) — then checkpoints via the **exported**
`saveCheckpoint(opts.runDir, cp)` (`checkpoint.ts:90`) directly, not the private `this.checkpoint()`
wrapper (stays hardwired to `this.opts.runDir`, called after this story only by `run()`'s own
top-level EXIT/dead-end/step-cap paths). Stop reasons: `stepcap` when `++this.stepCount` exceeds
`opts.maxSteps` (checked before dispatch); `exit` when the dispatched node's handler is
`Kind.EXIT` (never the goal-gate check/final checkpoint/`RunResult` — those stay exclusively in
`run()`'s own interpretation of `'stop'`); `frontier` when `opts.stopAt` is supplied and the
edge-selected next id is in it (inert for `run()`, which never supplies `stopAt` — the same
"additive, inert for every current call site" pattern ADR-008/ADR-009 established); `deadend`
when no edge is found. `{ kind: 'continue', nextId }` otherwise (including a retry-target jump).

`run()`'s own loop calls `executeNodeStep(currentId, { runDir: this.opts.runDir, cwd:
this.opts.cwd, maxSteps, stopAt: undefined })`. On `'continue'`, loop. On `'stop'`: `'exit'` runs
the existing goal-gate check/`this.checkpoint(null)`/`RunResult` return (`engine.ts:972-1043`,
substance unchanged, reached via the descriptor); `'deadend'`/`'stepcap'` produce the existing
FAIL `RunResult` paths (`engine.ts:1071-1084`, `:1090-1093`); `'frontier'` never occurs here.

## Relevant design decisions

- **ADR-012 (binding).** One shared private method and step counter, not a parity-tested
  reimplementation — rejected because it proves agreement today, not after a future one-sided edit.
- **Not resolved here:** the "Component-node FAIL routing" Risks-table row (roadmap item A).
  Neither this refactor nor `run()`'s interpretation of `'stop'` assumes either answer.

## Acceptance criteria

- [ ] `FR-17b`/`NFR-1` — `private stepCount = 0` exists on `Engine`, incremented once per dispatch
      inside `executeNodeStep`, entirely replacing the loop's local `step` variable.
- [ ] `FR-17b` — `executeNodeStep` is the sole place `run()`'s loop dispatches a node, checks
      retry, calls `recordOutcome` (twice, existing order), and writes a checkpoint via
      `saveCheckpoint`.
- [ ] `FR-17b` — `run()`'s EXIT handling (goal-gate check, `this.checkpoint(null)`, terminal
      `RunResult`) is reached only via `{ kind: 'stop', reason: 'exit' }` and is otherwise
      textually unchanged from today's `engine.ts:972-1043`.
- [ ] `FR-17b` — `this.checkpoint()` is called only by `run()`'s own EXIT/dead-end/step-cap paths
      after this refactor, never from inside `executeNodeStep`.
- [ ] `FR-17b` — `node --test` (full regression) passes with **zero assertion changes** anywhere
      outside `engine.ts` itself — the story's actual exit condition.

## Test approach

**Level:** regression only — the existing suite (`engine.test.ts` and every file exercising
`Engine.run()` indirectly, e.g. `box.test.ts`, `tool.test.ts`, `cli.test.ts`) is the test
approach, not a new fixture set. The real "`executeNodeStep` is genuinely one implementation, not
two" parity assertion (same fixture graph via `run()` and via `runBranch`, comparing `path`/
`attempts`/checkpoint shape) **cannot be written until `runBranch` exists** — that row belongs to
p5-05, exactly as the architecture's own verification mapping states.

**Cases:** none new. Run the existing suite before touching anything (baseline today: 508 tests,
507 passing, 1 skipped, 0 failing) and again after; any diff beyond `engine.ts`'s own internal
structure is a regression to fix before this story is done.

**Run with (from `plugins/attractor/engine`):** `node --test` (full suite — the exit condition is
explicitly the whole suite, since the refactor touches the shared dispatch path every other test
exercises indirectly).

## Out of scope

- `runBranch`, `HandlerCtx.runBranch`, `BranchRunOptions`/`BranchRunResult` — p5-05 (item F).
- Resolving roadmap item A's FAIL-routing question, or any change depending on its answer (e.g.
  mutating `currentId` from outside `run()`'s own loop).
- Any change to `checkpoint.ts`'s wire shape, `Context`, `retry.ts`, `edge-select.ts` — reused
  unchanged, per the architecture's Codebase-context table.

## Dependencies

None — mergeable in parallel with p5-01 (the roadmap names B and C as the phase's two
prerequisites, touching disjoint files). p5-05 (item F) depends on this story: `runBranch` is a
thin caller of `executeNodeStep`, not an independent loop.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
