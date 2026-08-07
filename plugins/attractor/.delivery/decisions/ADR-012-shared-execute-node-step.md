# ADR-012: The main loop and `runBranch` share one `executeNodeStep` method and one step counter — not two hand-kept copies

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect
**Resolves:** feature-critic findings F5 and F6

## Context

The original architecture text said `runBranch` "reuses the SAME per-node step logic (retry,
eager-input-check, `recordOutcome`)" as the main loop, and separately claimed NFR-1's 500-step
cap is "shared across main path and every branch," citing a spike (Spike 7) that is actually
about branch-worktree uncommitted-changes visibility — unrelated — and no code hook: `run()`'s
loop (`engine.ts:643`, `for (let step = 0; step < maxSteps; step++)`) uses `step` as a
loop-local variable. No `this.stepCount` field, or equivalent, exists for a separately-written
`runBranch` loop to increment against.

Two problems follow, named as separate findings but sharing one root cause:

**F5.** Without a real shared counter, a branch containing a routing cycle (a `retry_target`
loop) that never reaches its `stopAt` frontier, the graph's real exit node, or a dead end has no
stated bound. The main loop fails at 500 steps *by construction* — its own `for` loop enforces
it. A hand-written `runBranch` loop, built independently, has no reason to enforce the same
limit unless someone remembers to add it and keeps it in sync with the main loop's own value —
exactly the kind of drift a second implementation invites.

**F6.** The prose list of "what's shared" — retry, eager-input-check, `recordOutcome` — omits
several pieces the main loop's actual code (`engine.ts:643-1088`) also does per step, each
carrying a hard-won ordering invariant discovered and fixed during earlier work on this engine:
checkpoint writing (hardwired to `this.opts.runDir`, `engine.ts:247-262` — cannot be reused
unmodified for a branch-scoped `runDir`), EXIT handling (`engine.ts:972-1043`, now resolved
separately by ADR-007's amendment for F2), and dead-end handling
(`engine.ts:1071-1084`). The two `recordOutcome` calls per step, and the fact that an in-place
retry or a retry-target jump both `continue` *before* reaching `this.checkpoint()`, are
invariants a second, independently-written `runBranch` loop could easily get subtly wrong —
and this codebase already has an established answer for exactly this shape of risk:
`findConvergenceNode` is shared between `dot/lint.ts` and the runtime rather than
reimplemented in each; `SUBSTITUTABLE_ATTRS`/`TYPE_TO_HANDLER` are extracted once rather than
kept as two lists that must agree by convention. This is the highest-stakes per-node logic in
the file; treating it differently than the codebase's own precedent for lower-stakes logic is
the gap.

## Decision

**Binding, not left open:** the main loop and `runBranch` are built on **one shared private
method**, `Engine#executeNodeStep`, not two implementations kept in sync by a parity test.

```ts
private stepCount = 0   // NEW instance field, replaces the main loop's local `step` variable

type StepResult =
  | { kind: 'continue'; nextId: string }
  | { kind: 'stop'; reason: 'exit' | 'frontier' | 'deadend' | 'stepcap'; nodeId: string; outcome: Outcome }

private async executeNodeStep(
  currentId: string,
  opts: { runDir: string; cwd: string; maxSteps: number; stopAt?: ReadonlySet<string> },
): Promise<StepResult>
```

`executeNodeStep` does exactly what the main loop's body already does for one node — dispatch
(eager-input-check, handler call or skip, the RETRY ladder with its two `recordOutcome` calls),
then checkpoint via the *exported* `saveCheckpoint(opts.runDir, cp)` (not the private
`this.checkpoint()` wrapper, which stays hardwired to `this.opts.runDir` and is now used only
by the top-level caller for the outer run's own file — this is what closes the checkpoint-path
collision risk the original architecture document's own Risks table already named) — and then
decides what happens next:

- Before dispatch: **`this.stepCount++`**; if it now exceeds `opts.maxSteps`, return
  `{ kind: 'stop', reason: 'stepcap', ... }` without dispatching. One field, incremented once
  per step regardless of which loop is calling — a step taken inside any branch counts against
  the same run-wide budget the main path does, closing F5's gap by construction: `max_parallel`
  cannot multiply the ceiling, and a branch stuck in a routing cycle is guaranteed to hit the
  shared cap within `maxSteps` total steps across *every* concurrently-running branch combined,
  not `maxSteps` per branch.
- After dispatch, if the dispatched node's handler is `Kind.EXIT`: return
  `{ kind: 'stop', reason: 'exit', ... }` — **not** the goal-gate check, the final checkpoint,
  or a `RunResult`. Nothing in `executeNodeStep` knows or cares whether it was called by the
  main loop or by `runBranch`.
- After dispatch, if `opts.stopAt` is supplied and the edge-selected next node id is in it:
  return `{ kind: 'stop', reason: 'frontier', ... }` without dispatching that next node. The
  main loop never supplies `stopAt`, so this branch of the check is inert for it — the existing
  "additive optional field, inert for every current call site" pattern ADR-008/ADR-009 already
  established.
- Otherwise, if an edge was found (including a retry-target jump, handled the same way the
  current code handles it — a `continue`, checkpoint skipped): return `{ kind: 'continue',
  nextId }`.
- Otherwise (no edge, not EXIT): return `{ kind: 'stop', reason: 'deadend', ... }`.

**Two thin callers, each with their own loop and their own interpretation of `'stop'`:**

- `run()`'s loop calls `executeNodeStep(currentId, { runDir: this.opts.runDir, cwd:
  this.opts.cwd, maxSteps, stopAt: undefined })`. On `'continue'`, it loops. On `'stop'`, it is
  the **only** place that inspects `reason`: `'exit'` runs the existing goal-gate
  check/`this.checkpoint(null)`/`RunResult` return (`engine.ts:972-1043`, unchanged in
  substance, now reached via the descriptor rather than an inline `if`); `'deadend'` and
  `'stepcap'` both produce the existing FAIL `RunResult` paths (`engine.ts:1071-1084` and
  `:1090-1093` respectively) — `'stepcap'` reached this way rather than via the `for` loop's own
  bound, since the bound is now `this.stepCount`, not a loop-local counter; `'frontier'` can
  never occur here, since `stopAt` is always `undefined` at the top level.
- The new private `runBranch(opts: BranchRunOptions)` calls the same method with
  `{ runDir: opts.runDir, cwd: opts.cwd, maxSteps, stopAt: opts.stopAt }`, in its own loop. On
  `'continue'`, it loops. On any `'stop'` — `'exit'`, `'frontier'`, `'deadend'`, or `'stepcap'`
  alike — it does the **same** thing: stop looping and build a `BranchRunResult` from whatever
  outcome and context state the branch ended with. It never calls `unsatisfiedGoalGates()`,
  never calls `this.checkpoint(null)`, and never returns an `Engine.RunResult`. A branch that
  hits the shared step cap ends its own traversal with a FAIL outcome, exactly as a dead end
  would, and reports that FAIL back to `ParallelHandler` through the ordinary join-policy path
  — it does not need special handling beyond what `'deadend'` already gets, because from
  `runBranch`'s point of view they are the same kind of "nothing more to do here."

## Alternatives considered

### Reimplementation with a parity test

**Why it was attractive:** does not require restructuring the main loop's existing, tested
code; a parity test (same fixture graph, same starting context, assert the main-loop path and a
`runBranch`-driven path agree) is a smaller diff to review in one sitting.
**Why rejected, specifically:** a parity test proves the two implementations agree **today**,
against whatever fixtures were written. It cannot prove they still agree after a future edit
that touches only one of the two copies — which is precisely the failure mode this ADR exists
to prevent, and precisely the reasoning this codebase already used to justify extracting
`findConvergenceNode` and `SUBSTITUTABLE_ATTRS`/`TYPE_TO_HANDLER` once rather than keeping
parallel copies with a test to catch drift after the fact. A parity test is strictly weaker
than one shared implementation: shared code makes the drift class structurally impossible for
anything not deliberately parameterized apart (`stopAt`, `runDir`), where a parity test only
detects it once someone remembers to update the test for the specific behavior that drifted.
Given F6 explicitly names this as "the highest-stakes remaining logic in the file," the weaker
guarantee is not an acceptable trade for a smaller diff.

### Keep the step counter per-loop (main loop keeps its local `step`; `runBranch` gets its own local counter, each independently capped at `maxSteps`)

**Why it was attractive:** no new instance field; each loop's bound is easy to read in
isolation.
**Why rejected:** this is exactly the shape of bug F5 describes — `max_parallel` branches each
independently capped at `maxSteps` multiplies the *effective* run-wide ceiling by up to
`max_parallel`, silently contradicting NFR-1's own "500 node-visit cap" framing, and a routing
cycle confined to one branch would still be bounded, but the *run* would not be bounded by 500
node-visits in total the way NFR-1 promises — it would be bounded by `500 × (number of branches
that happen to be cycling)`.

## Consequences

**We gain:** one place — `executeNodeStep` — that owns every ordering invariant the per-node
step logic carries (eager-check-before-dispatch, dual `recordOutcome`, checkpoint-after-
continue-paths-skip), consulted identically by the main loop and every branch; a real, run-wide
step cap that cannot be defeated by fanning out; and the existing checkpoint-collision risk
(the original architecture document's Risks table entry citing `engine.ts:247-262`'s
hardwired `runDir`) closed by construction rather than by a unit test hoping to catch a
copy-paste mistake.

**We accept:** `run()`'s loop and `private runBranch()` are now both thin — most of their
previous body moves into `executeNodeStep` — which is a larger, more mechanical refactor of
already-shipped, tested code than a purely additive `runBranch` method would have been. This
is accepted because the alternative (parity-tested duplication) does not actually close F6's
risk, only makes it detectable after the fact; a refactor of tested code, done with the
existing test suite as a regression net, is the cheaper failure mode of the two.
