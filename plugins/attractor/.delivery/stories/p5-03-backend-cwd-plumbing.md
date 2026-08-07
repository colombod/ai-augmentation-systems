<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-03
title: Plumb a per-call cwd through Backend.run() so isolated CODERGEN branches actually isolate
status: ready
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b, NFR-4]
depends_on: []
size: S
---

# Plumb a per-call cwd through Backend.run() so isolated CODERGEN branches actually isolate

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`Backend.run()` gains an optional trailing `cwd` parameter, `ClaudeCodeBackend` prefers it over
its constructor-bound `cwd`, and `BoxHandler` passes `ctx.cwd` through. Today a `CODERGEN` node
inside an isolated **branch worktree** (later stories) would silently keep running against the
run's single constructor-bound directory — the dominant node kind in the canonical parallel
example would share one filesystem across concurrent branches, reopening exactly the race Open
Question 4 resolved isolation-by-default to prevent.

## Context

Verified today by reading each call site directly:

- `handlers/tool.ts:125` — `ToolHandler.execute` already calls `runShell(command, ctx.cwd,
  timeoutMs)`. Shell nodes are already correctly isolated; **no change needed here.**
- `handlers/box.ts:96-102` — `BoxHandler.execute` calls `this.backend.run(ctx.node, prompt,
  ctx.context, ctx.graph, controller?.signal ?? ctx.signal)` — **`ctx.cwd` is never passed.**
- `handlers/types.ts` — `Backend.run(node, prompt, context, graph, signal?)` has no `cwd`
  parameter for `BoxHandler` to pass even if it tried.
- `backend/claude.ts:102-115` — `ClaudeCodeBackend.run()` spawns the `claude` subprocess with
  `this.opts.cwd` (line 115) unconditionally — bound once at construction, never overridden per call.
- `cli.ts:278-295` — the CLI constructs exactly one `ClaudeCodeBackend`/`Engine` per run, and
  `defaultHandlers(backend)` builds one `BoxHandler` wrapping that single `Backend` instance for
  the whole run — including every branch a later `PARALLEL` node fans out to.

Since amplifier's canonical parallel example (`05-parallel-fan-out.dot`) fans out to three
prompt-bearing (CODERGEN-equivalent) nodes — the expected dominant shape for a real branch — a
design that isolates only `TOOL` nodes while `CODERGEN` branches silently share one cwd would make
"isolated by default" true for the node kind branches will least often contain.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/handlers/types.ts` | modify — add optional trailing `cwd?: string` to `Backend.run()` |
| `plugins/attractor/engine/src/backend/claude.ts` | modify — `run()` prefers the per-call `cwd` over `this.opts.cwd` when present, falling back to the constructor value otherwise |
| `plugins/attractor/engine/src/handlers/box.ts` | modify — pass `ctx.cwd` as the new trailing argument to `this.backend.run(...)` |

## Interfaces and contracts to honor

```ts
// handlers/types.ts
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal,
      cwd?: string): Promise<Outcome>   // NEW optional trailing param, additive
}
```

TypeScript's structural typing makes this additive at the type level: `StubBackend.run(node,
prompt, context, graph)` (`handlers/stub.ts:20`, shorter parameter list) and any third-party
embedder's `Backend` remain valid implementers without modification — JS ignores a caller's extra
trailing argument. It is **not** additive at the functional level (see Risks below).

## Relevant design decisions

- **ADR-008** is this story's entire content. Rejected alternatives, do not resurrect either:
  leaving `Backend` unchanged (isolates only `TOOL` nodes, the least-likely branch workload); or
  having the CLI construct one `Backend` per branch (couples `ParallelHandler` to CLI-only
  construction options — `args.model`, `args.maxBudgetUsd`, `args.allowedTools` — it has no
  access to and should not need to reconstruct).
- **Named risk, not glossed over (architecture Migration/Risks):** an embedder-supplied `Backend`
  that ignores the new `cwd` argument keeps compiling and running, but silently keeps using its
  own bound cwd for every branch — reopening the exact cross-branch filesystem race NFR-4/Open
  Question 4 exist to prevent. `ClaudeCodeBackend` (the only shipped implementation) is fixed by
  this story; a third-party `Backend` needs its own one-line update, which this story cannot force.

## Acceptance criteria

- [ ] `FR-17b` — `Backend.run()`'s signature carries an optional trailing `cwd?: string`; every
      existing call site (with or without it) still type-checks.
- [ ] `FR-17b`/`NFR-4` — `ClaudeCodeBackend.run()` spawns the subprocess with the per-call `cwd`
      when the caller supplies one, and with `this.opts.cwd` otherwise — verified by a test that
      passes a per-call `cwd` different from the constructor-bound one and asserts the subprocess
      actually launches in the per-call directory.
- [ ] `FR-17b` — `BoxHandler.execute` passes `ctx.cwd` as `Backend.run()`'s new trailing argument.
- [ ] `FR-17b` — a `Backend.run()` call with no `cwd` argument at all (e.g. `StubBackend`, or any
      existing test double) behaves exactly as it does today — the fallback is inert.
- [ ] `node --test` (full regression, from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit. `ClaudeCodeBackend`'s subprocess-launch directory is already testable today
(`claude-backend.test.ts` exists and exercises `run()` against a scripted `command`); extend it
rather than inventing a new harness. `BoxHandler`'s pass-through is testable with a small capturing
`Backend` stub (assert the `cwd` argument it received matches `ctx.cwd`), following `box.test.ts`'s
existing pattern of constructing `HandlerCtx` by hand with a real `mkdtempSync` directory.

**Cases:**

| Case | Expected |
| :-- | :-- |
| `BoxHandler.execute` with `ctx.cwd` set to a directory different from the `Backend`'s own construction-time cwd | the capturing `Backend`'s `run()` receives that `ctx.cwd` value as its trailing argument |
| `ClaudeCodeBackend.run()` called with an explicit per-call `cwd` | subprocess spawns with that `cwd`, not `this.opts.cwd` |
| `ClaudeCodeBackend.run()` called with `cwd` omitted (existing call shape) | subprocess spawns with `this.opts.cwd`, unchanged from today |
| `StubBackend.run()` (4-arg call shape, no `cwd` parameter in its own signature) | continues to compile and run exactly as today — proves the additive change is inert for shorter implementers |

**Run with (from `plugins/attractor/engine`):** `node --test test/box.test.ts test/claude-backend.test.ts`
(targeted) or `node --test` (full regression — baseline today: 508 tests, 507 passing, 1 skipped).

## Out of scope

- `run/worktree.ts`'s async conversion — p5-01 (item B); this story only plumbs `cwd`, it does not
  decide what directory a branch worktree lives at.
- `HandlerCtx.runBranch`, branch dispatch — p5-05/p5-08 (items F/I); those are what will actually
  set `ctx.cwd` to a branch worktree's path per call.
- Updating any third-party `Backend` implementation — named as a residual gap in Relevant design
  decisions above, not this story's to close.

## Dependencies

None. Independent of every other Phase 5 story — touches `handlers/types.ts`, `backend/claude.ts`,
`handlers/box.ts` only, disjoint from p5-01/p5-02's files. p5-08 (item I, draft) will rely on this
story having landed so `ParallelHandler` can pass a branch worktree's path as `ctx.cwd` and have it
actually reach the `claude` subprocess.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
