<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-01
title: Convert run/worktree.ts to async and prove branches no longer block each other
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b, NFR-7]
depends_on: []
size: M
---

# Convert run/worktree.ts to async and prove branches no longer block each other

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`run/worktree.ts`'s git-invoking functions stop blocking Node's event loop for the duration of a
`git` subprocess, so one **branch**'s worktree setup/teardown can no longer freeze a sibling
branch's already-spawned subprocess I/O or its `timeout=` abort timer. This is Phase 5's first
landable, independently mergeable slice — nothing else in the phase can claim "branches run
concurrently" while this file is still synchronous. Ships alongside `GatedBackend`, the
forced-overlap test double later stories need to prove their own concurrency claims are real, and
the worktree-name-collision test, automatable the moment this lands.

## Context

Today `run/worktree.ts:16-18`'s `git()` helper calls `execFileSync`, which blocks the whole
process for the child's full duration; every exported function (`isGitRepo`, `createWorktree`,
`hasUncommittedWork`, `isRegisteredWorktree`, `removeWorktree`) calls it directly or
transitively. Composed into a `Promise.all`-based, semaphore-bounded fan-out (later stories),
one branch's `git worktree add`/`remove` would freeze every sibling: their already-running
`claude -p` children keep executing at the OS level, but Node cannot process `stdout`/`stderr`
events or fire a `setTimeout`-driven `timeout=` abort (`handlers/box.ts:93`) until the block
clears — a real correctness gap against what `timeout=` promises, not merely a performance one
(ADR-011). **Real, not glossed-over, blast radius:** `cli.ts` calls these functions
synchronously at five sites, confirmed today at `cli.ts:237,243,260,261,338` (two `isGitRepo`
guards, two `createWorktree` calls, one `removeWorktree` in the `finally` block); its enclosing
function is already `async` (it already `await`s `engine.run()`), so adding `await` there
introduces no new async boundary. `engine/test/worktree.test.ts` has ~25 synchronous call sites;
each gains `await`, its `test()` callback becomes `async` — mechanical, not a redesign.

**Why `GatedBackend` and the name-collision test belong in this story, not item J's.** The
roadmap's own correction pass found `GatedBackend` named only under item J (concurrency test
infrastructure), which is gated on item I (the still-blocked `ParallelHandler`) — but this
story's own "no longer blocks sibling branches" row, plus later stories' "branch reaching EXIT
is a dead end" and merge-back completion-order rows, need `GatedBackend` (or "forced overlap")
to be non-decorative, and none of the three is gated on item I. `StubBackend`
(`handlers/stub.ts`) resolves every call on the next microtask and is shipped `--dry-run` code —
a test built only on it would pass even against a semaphore or async conversion that does
nothing. Building `GatedBackend` here, the earliest point any row needs it, means later stories
reuse it. The name-collision test needs "no live LLM backend... only real concurrent `git`
calls" (architecture's own words) — no `ParallelHandler`, no `runBranch` — so bundling it under
item J would delay a fully-automatable test behind six other work items for no reason the
architecture supports.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/run/worktree.ts` | modify — `git()` becomes `async`, built on `node:child_process`'s `execFile` promisified via `node:util`'s `promisify` (zero new dependency); `isGitRepo`, `createWorktree`, `hasUncommittedWork`, `isRegisteredWorktree`, `removeWorktree` all become `async`/`Promise`-returning; every internal call between them gains `await` |
| `plugins/attractor/engine/src/cli.ts` | modify — five call sites gain `await`: `cli.ts:237` (`isGitRepo`), `:243` (`createWorktree`), `:260` (`isGitRepo`), `:261` (`createWorktree`), `:338` (`removeWorktree`, inside the `finally` block) |
| `plugins/attractor/engine/test/worktree.test.ts` | modify — ~25 call sites gain `await`, their `test()` callbacks become `async`; add the "worktree operations no longer block sibling branches" mutation-checked test and the worktree-name-collision test |
| `plugins/attractor/engine/test/fixtures.ts` | modify — add the `GatedBackend` test-only double (reused by later Phase 5 stories; do not duplicate it elsewhere) |

## Interfaces and contracts to honor

```ts
// run/worktree.ts — public signatures change from sync to async; behavior unchanged
export function isGitRepo(dir: string): Promise<boolean>
export function createWorktree(repoDir: string, runId: string): Promise<Worktree>
export function removeWorktree(repoDir: string, wt: Worktree): Promise<RemovalResult>
// unchanged shapes, still exported as-is:
export interface Worktree { path: string; branch: string }
export interface RemovalResult { removed: boolean; warning?: string }
// internal, not exported:
// async function git(cwd: string, args: string[]): Promise<string>  -- execFile, promisified

// test/fixtures.ts — NEW test-only double (architecture document's own code block)
import { type Backend } from '../src/handlers/types.ts'
export class GatedBackend implements Backend {
  inFlight = 0
  maxObserved = 0
  private gates = new Map<string, () => void>()
  async run(node: Node): Promise<Outcome> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    await new Promise<void>((resolve) => this.gates.set(node.id, resolve))
    this.inFlight--
    return { status: Status.SUCCESS }
  }
  release(nodeId: string): void      // test drives interleaving
  reject(nodeId: string, err: Error): void   // rejects instead of resolving, for later stories' branch-throws tests
}
```

`Backend.run()`'s exact parameter list (`node, prompt, context, graph, signal?`) is defined by
`handlers/types.ts` today; `GatedBackend.run()` need only match it structurally (TypeScript
structural typing — see p5-03 for the `cwd` param this story does not add).

## Relevant design decisions

- **ADR-011** is this story's whole content: `git()` becomes `async`/`execFile`-based, zero new
  dependency (`AGENTS.md`'s "exactly two, non-tradeable" constraint preserved). Rejected
  alternatives — leaving it synchronous and documenting the gap, or a worker-thread pool — do
  not resurface here.
- **Spike 12** — verify empirically that `execFile`'s promisified rejection shape (`Error` with
  `.stdout`/`.stderr`/`.code`) matches `execFileSync`'s thrown-`Error` shape closely enough that
  `worktree.test.ts`'s message-matching assertions (e.g. "not a git repository", "could not
  remove the worktree cleanly") keep passing unmodified; triage any drift as part of this story.
- **Migration note (architecture, FR-17b Migration and rollback):** reverses the original
  architecture's "worktree.ts: untouched" claim. Reverting later means reverting `git()` and all
  three touched files in lockstep — a caller `await`ing a function that stops returning a
  `Promise` is a compile error, so this migration is **not** independently revertible file-by-file.

## Acceptance criteria

- [ ] `FR-17b`/`NFR-7` — `isGitRepo`, `createWorktree`, `removeWorktree` are `async`, returning
      `Promise<boolean>`/`Promise<Worktree>`/`Promise<RemovalResult>`; `git()` uses `execFile`,
      not `execFileSync`.
- [ ] `FR-17b` — all five `cli.ts` call sites (`237,243,260,261,338`) `await` the now-async calls;
      `cli.ts` compiles and its own existing behavior (worktree creation, cleanup-on-`finally`,
      stderr warnings) is unchanged.
- [ ] `FR-17b` — every existing `worktree.test.ts` assertion passes unmodified after gaining
      `await`, including the message-matching ones Spike 12 names — a string-shape drift is
      triaged and fixed as part of this story, not deferred.
- [ ] `NFR-7` — a new **mutation-checked** test: a `GatedBackend`-held branch A stays mid-flight
      (its gate not yet released) while a real `createWorktree`/`removeWorktree` call for branch
      B runs against a real (if small) repo; assert branch A's release is observable **while**
      branch B's git call is still in flight, not only after it returns. A mutant reverting
      `git()` to `execFileSync` must turn this test red by making branch A's release observably
      delayed.
- [ ] `FR-17b` — a new integration test: `Promise.all` over several concurrent `createWorktree`
      calls sharing a plausible `runId` naming scheme (`attractor/${runId}`) against one real
      repo; assert no silent collision — either all succeed with distinct branches/paths, or a
      collision fails loudly (`git worktree add -b` refuses), never a race that corrupts state.
- [ ] `FR-17b` — `GatedBackend` exists in `test/fixtures.ts`, implements `Backend` structurally,
      and exposes `inFlight`/`maxObserved`/`release()`/`reject()` exactly as specified above.
- [ ] `node --test` (full regression, from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** integration for the async-conversion regression and the two new concurrency-proving
tests (real `git`, no mocking — reuses `worktree.test.ts`'s existing pattern); the `GatedBackend`
class itself needs no test of its own beyond exercising it through the tests above.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Every existing `worktree.test.ts` assertion, re-run `await`ed | passes unmodified (Spike 12) |
| `isGitRepo` on a non-repository | `false`, no throw, same as today |
| `createWorktree` on a non-repository | throws with the same message text as today |
| Branch A gated open (not released) while branch B's `createWorktree`/`removeWorktree` runs | branch A's release is observed while branch B's git call is in flight (mutation-checked) |
| N `createWorktree` calls in `Promise.all`, real concurrent `git worktree add` | no silent collision; each succeeds with a distinct branch, or a colliding one fails loudly |
| `removeWorktree` called twice (existing "safe to call twice" contract) | unchanged: second call is a clean no-op |

**Run with (from `plugins/attractor/engine`):** `node --test test/worktree.test.ts` (targeted) or
`node --test` (full regression — baseline today, before this change: 508 tests, 507 passing, 1
skipped, 0 failing).

## Out of scope

- `handlers/parallel.ts`, `ParallelHandler`, the `max_parallel` semaphore — item I, not this story.
- `HandlerCtx.runBranch`, `Engine#runBranch` — p5-05 (item F). `GatedBackend` is built here so
  that story can reuse it, but this story does not call it from `Engine`.
- `Backend.run()`'s `cwd` parameter — p5-03 (item D); unrelated interface, touches different files.
- Any change to what `git worktree add`/`remove`/`status`/`prune` themselves do — only how Node
  waits for them changes (ADR-011's own "Not applicable to" note).

## Dependencies

None. First story in Phase 5 by dependency order — the roadmap names it, alongside item C, as one
of the two load-bearing prerequisites the rest of the phase builds on, and it has no dependency of
its own. p5-05 (F) and p5-07 (H) both depend on this story for `GatedBackend`, in addition to their
own stated dependencies — noted in each of those stories' own Dependencies section.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
