<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-05
title: Give handlers a runBranch seam that runs a bounded sub-traversal on the run's own ledgers
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b, NFR-1, NFR-4]
depends_on: [p5-02, p5-01]
size: M
---

# Give handlers a runBranch seam that runs a bounded sub-traversal on the run's own ledgers

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`HandlerCtx` gains an optional `runBranch` callback, populated by `Engine.run()` on every
dispatch, that runs a bounded forward traversal of the *same* graph — starting at any node id,
stopping at a caller-given frontier, EXIT, or a dead end — using the exact per-node step logic
(`executeNodeStep`, p5-02) the main loop itself uses, against the run's own shared
`gateOutcomes`/`nodeFailures`/`failedOutputs` ledgers. This is the seam `handlers/parallel.ts`
(p5-08, not built yet) will call once per **branch**; this story ships and fully tests it without
that handler existing, the same way `Backend`/`HandlerCtx` seams have shipped ahead of their
consumers elsewhere in this codebase.

## Context

Amplifier hands its equivalent handler a direct engine reference. `core/engine.ts`'s `Handler`
interface (`handlers/types.ts`) is `execute(ctx: HandlerCtx): Promise<Outcome>` — one argument,
no engine reference — and `defaultHandlers(backend)` (`engine.ts:77-84`) builds the whole handler
`Map` **before** `new Engine({..., handlers})` is called, so the map cannot hold a reference to
an `Engine` that does not exist yet. Separately, a branch's goal-gate outcomes and unresolved-
failure ledger must land in the *same* maps the main path uses (`gateOutcomes`, `nodeFailures`,
`failedOutputs` — private `Engine` fields), or a `goal_gate=true` node inside a branch stops
correctly blocking the real exit, and a `runs_on=failure` node elsewhere stops correctly reacting
to a branch's failure (ADR-009).

**Rejected: one independent `new Engine(...)` per branch.** Each fresh instance owns its own
empty ledgers — a goal gate inside a branch would satisfy or fail a map nothing outside that
branch's own instance ever reads, silently reopening the fail-open hole those ledgers exist to
close. This is a correctness regression, not a hypothetical edge case (ADR-009).

**A branch reaching the graph's real EXIT node (ADR-007's amendment, resolves F2).** `runBranch`
treats dispatching EXIT exactly like an ordinary dead end for that branch's own traversal, and
nothing more: it never calls `unsatisfiedGoalGates()`, never calls `this.checkpoint(null)`, and
never returns an `Engine.RunResult` — that logic remains exclusively `run()`'s own interpretation
of a `{ kind: 'stop', reason: 'exit' }` result (p5-02). `Handler.EXIT` is a
`PassthroughHandler`-registered kind (`PASSTHROUGH_KINDS`, `graph.ts:248`), always side-effect-free,
always `SUCCESS` — so the branch's own `BranchRunResult.outcome` simply reflects that trivial
success and the branch stops there.

**Named, accepted risk, not closed by this story:** `stopAt` enforces exactly one boundary (the
convergence node id) — nothing stops a `retry_target` jump from landing on a node belonging to a
*sibling* branch's reachable set, since `resolveRetryTarget` (unchanged, `core/retry.ts`) has no
notion of "branch membership." Proven by a test (Acceptance criteria below) and left open —
closing it is a later-phase design question, not an implementation gap to silently patch.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/handlers/types.ts` | modify — add `BranchRunOptions`, `BranchRunResult{outcome, path}` interfaces; add `runBranch?: (opts) => Promise<BranchRunResult>` to `HandlerCtx` |
| `plugins/attractor/engine/src/core/engine.ts` | modify — `run()` populates `ctx.runBranch` on every dispatch, bound to a new private `runBranch()` method that loops on `executeNodeStep` (p5-02) |

## Interfaces and contracts to honor

```ts
// handlers/types.ts
export interface BranchRunOptions {
  startNodeId: string
  stopAt: ReadonlySet<string>   // convergence node id; branch halts before dispatching it
  context: Context               // caller-supplied, already Context.clone()'d
  runDir: string                 // branch-scoped subdir -- own checkpoint.json/events.jsonl
  cwd: string                    // branch worktree path, or the component node's own cwd
}
export interface BranchRunResult {
  outcome: Outcome
  path: string[]
  // NOTE: gains a `context` field in p5-07 (item H) -- not this story. Do not add it here;
  // that story modifies this interface, this one only creates {outcome, path}.
}
export interface HandlerCtx {
  // ...unchanged fields...
  runBranch?: (opts: BranchRunOptions) => Promise<BranchRunResult>   // NEW, Engine-populated
}
```

`Engine`'s private `runBranch(opts: BranchRunOptions)` loops on `executeNodeStep(currentId, {
runDir: opts.runDir, cwd: opts.cwd, maxSteps, stopAt: opts.stopAt })` starting at
`opts.startNodeId`. On `'continue'`, it loops. On **any** `'stop'` — `'exit'`, `'frontier'`,
`'deadend'`, or `'stepcap'` alike — it does the same thing: stop looping and build a
`BranchRunResult` from whatever outcome and path the branch ended with. It never calls
`unsatisfiedGoalGates()`, `this.checkpoint(null)`, or returns an `Engine.RunResult`.

## Relevant design decisions

- **ADR-009** — the seam itself: an optional `HandlerCtx` field, not a constructor argument or a
  direct `Engine` reference; `defaultHandlers(backend)`'s signature is unaffected.
- **ADR-007's EXIT amendment** — binding: EXIT is an ordinary dead end for `runBranch`, never the
  goal-gate/checkpoint/`RunResult` path.
- **ADR-012 (p5-02)** — `runBranch` is a thin caller of `executeNodeStep`, not a second hand-kept
  implementation; this story cannot exist before p5-02 lands.

## Acceptance criteria

- [ ] `FR-17b` — `BranchRunOptions`/`BranchRunResult{outcome, path}` exported from `handlers/types.ts`; `HandlerCtx.runBranch` is optional and Engine-populated.
- [ ] `FR-17b` — a branch root routed straight to the graph's real EXIT node ends with a trivial `SUCCESS` `BranchRunResult`; `unsatisfiedGoalGates()`/`this.checkpoint(null)` are never called during that `runBranch` call (**mutation-checked**: a mutant letting `runBranch` fall through to `run()`'s own EXIT block must turn this red). Uses `GatedBackend` (p5-01) to hold a sibling `runBranch` call mid-flight while the EXIT branch completes, proving the run-wide ledgers are genuinely shared, not just type-compatible.
- [ ] `FR-17b`/`NFR-1` — a branch containing a `retry_target` routing cycle that never reaches `stopAt`/EXIT/a dead end, with `maxSteps` set low in-test, ends with a well-formed FAIL `BranchRunResult` rather than hanging the test (**mutation-checked**: reverting `stepCount` to a per-loop-local counter must hang this test).
- [ ] `FR-17b` — the same fixture graph, run once through `run()`'s own loop and once through `runBranch` (`stopAt` past the graph's natural end), produces identical `path`/`attempts`/checkpoint-content shape (modulo the branch-scoped `runDir`) — proves `executeNodeStep` is genuinely one implementation under both calling conventions.
- [ ] `FR-17b` — a goal-gate node inside a branch correctly blocks the outer run's real exit (asserted via a full `run()` call whose graph routes a `PARALLEL`-shaped detour through a hand-built handler calling `ctx.runBranch` directly).
- [ ] `FR-17b` — **named risk, not fixed:** a `retry_target` resolving to a node outside the branch's own `stopAt`-truncated reachable set (e.g. a sibling branch's own node) is dispatched by `runBranch` exactly like any other next node — a test demonstrates this is today's actual behavior, documented as an accepted gap in Risks below, not silently left unproven.
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit/integration, `engine.test.ts` (new `describe`/section). Since `handlers/parallel.ts`
does not exist yet, every test drives `ctx.runBranch` directly from a small hand-built test-only
`Handler` registered in the `handlers` map passed to `new Engine({...})` — the same technique
`engine.test.ts` already uses to build custom fixtures (`defaultHandlers(backend)` plus manual
`Map` entries). No `ParallelHandler`, no `PARALLEL`-shaped graph node, needed for any test here.

**Cases:** see Acceptance criteria above for the six load-bearing rows; additionally:

| Case | Expected |
| :-- | :-- |
| `runBranch` reaches a dead end (no outgoing edge, not EXIT) | `BranchRunResult.outcome.status === Status.FAIL`, `path` reflects the traversal |
| `runBranch` reaches `stopAt` | stops before dispatching the frontier node; `path` does not include it |
| Two concurrent `ctx.runBranch` calls from one test `Handler`, via `Promise.all`, over `GatedBackend` | both resolve independently; the outer `nodeFailures`/`gateOutcomes` maps reflect both branches' writes |

**Run with (from `plugins/attractor/engine`):** `node --test test/engine.test.ts` (targeted) or
`node --test` (full — baseline today: 508 tests, 507 passing, 1 skipped, 0 failing).

## Out of scope

- `handlers/parallel.ts`, `ParallelHandler`, `max_parallel` semaphore, branch worktree creation —
  p5-08 (item I).
- `BranchRunResult.context`, `mergeBranchContext` — p5-07 (item H), which modifies the interface
  this story creates.
- PAR-005 — p5-06, which consumes this story's EXIT-as-dead-end behavior for its own runtime test.
- Actually closing the retry-target-outside-branch gap — named as a risk, not resolved here.

## Dependencies

- **p5-02 (item C)** — `executeNodeStep` must exist; `runBranch` is a thin caller of it, not an
  independent loop.
- **p5-01 (item B)** — `GatedBackend` (test double) is needed for the mutation-checked "branch
  reaching EXIT is a dead end" test; this story does not rebuild it.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
