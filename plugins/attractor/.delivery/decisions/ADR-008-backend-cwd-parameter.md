# ADR-008: `Backend.run()` gains a per-call `cwd` parameter

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect

## Context

Open Question 4 resolved: parallel branches are isolated in their own branch worktree by
default, extending `run/worktree.ts` (see the glossary for the *branch worktree* term — the
per-branch git worktree `createWorktree` builds, not the DOT-graph *branch* itself). Reading
how `cwd` actually flows through the engine today shows
that reusing `HandlerCtx.cwd` per branch — the obvious mechanism — works for exactly one of the
two node kinds that can appear inside a branch, silently.

- `handlers/tool.ts:125` — `ToolHandler.execute` calls `runShell(command, ctx.cwd, timeoutMs)`.
  **`ctx.cwd` is already the live per-call mechanism for shell nodes.** No change needed here.
- `handlers/box.ts:96-102` — `BoxHandler.execute` calls
  `this.backend.run(ctx.node, prompt, ctx.context, ctx.graph, controller?.signal ?? ctx.signal)`
  — **`ctx.cwd` is never passed.**
- `handlers/types.ts:31-33` — `Backend.run(node, prompt, context, graph, signal?)` has no `cwd`
  parameter to receive it even if `BoxHandler` did pass it.
- `backend/claude.ts:97-115` — `ClaudeCodeBackend` takes `cwd` once, in its constructor
  (`ClaudeBackendOptions.cwd`), and `run()` spawns the `claude` subprocess with
  `this.opts.cwd` (line 115) unconditionally.
- `cli.ts:278-295` — the CLI constructs exactly **one** `ClaudeCodeBackend` and one `Engine`
  per run, and `defaultHandlers(backend)` builds one `BoxHandler` wrapping that one `Backend`
  instance for the whole run.

Since `amplifier`'s canonical parallel example (`05-parallel-fan-out.dot`) fans out to three
CODERGEN-equivalent (prompt-bearing) nodes — the dominant, expected shape for a real branch —
a design that isolates only TOOL nodes while CODERGEN branches silently keep sharing one
filesystem/cwd would reintroduce exactly the race Open Question 4 exists to prevent, for the
node kind parallel fan-out will actually be used for.

## Decision

Add an optional trailing `cwd` parameter to `Backend.run()`. `BoxHandler.execute` passes
`ctx.cwd`. `ClaudeCodeBackend.run()` prefers the per-call `cwd` over its constructor-bound
`this.opts.cwd` when present, falling back to the constructor value otherwise (so a non-branch
node, or a node dispatched outside `ParallelHandler`, behaves exactly as it does today —
`ctx.cwd` at the top level is already the run's own single cwd, so the fallback is inert for
every existing call site).

TypeScript's structural typing makes this additive at the type level: any existing
`Backend` implementer with a shorter parameter list — `StubBackend.run(node, prompt, context,
graph)` (`handlers/stub.ts:20`), or a third-party embedder's own implementation — remains a
valid implementer of the widened interface without modification, since JS ignores a caller's
extra trailing argument. It is **not** additive at the functional level: an implementer that
does not read the new parameter keeps compiling and running, but silently keeps using its own
bound cwd for every branch, which is precisely the "share one filesystem, quietly" failure mode
this whole design exists to close. Recorded in the architecture document's Migration section
and Risks table as an explicit, named gap for third-party backends, not glossed as free.

## Alternatives considered

### Leave `Backend` unchanged; isolate only TOOL-node branches

**Why it was attractive:** zero interface change, zero migration note, ships faster.
**Why rejected:** it isolates the node kind least likely to be the actual workload (per the
canonical worked example) while leaving the dominant kind — CODERGEN — silently sharing one
filesystem across concurrent branches. A design that claims "isolated by default" (Open
Question 4's own wording) while only being true for shell nodes is the specific shape of
silent degradation this project's doctrine names directly.

### Have the CLI construct one `Backend` per branch and pass a per-branch handler map into a nested `Engine`

**Why it was attractive:** no `Backend` interface change at all — isolation via a fresh,
correctly-`cwd`-bound `Backend` instance per branch, constructed the same way the top-level one
already is.
**Why rejected:** `Backend` construction today happens in `cli.ts`, using CLI-only options
(`args.model`, `args.maxBudgetUsd`, `args.allowedTools`) that `Engine`/`ParallelHandler` has no
access to and should not need to reconstruct. It would also make `ParallelHandler` responsible
for knowing which concrete `Backend` implementation is in use and how to re-instantiate it —
coupling a handler to a construction concern that belongs to whoever embeds the engine (the CLI
today, something else tomorrow). The rejected nested-`Engine`-per-branch shape has the same
problem restated (see ADR-009); this alternative inherits it.

## Consequences

**We gain:** per-branch worktree isolation that actually covers the node kind branches will
mostly contain, using the shipped `Backend`, with a three-line, additive-at-the-type-level
change.

**We accept:** any custom `Backend` an embedder has already written needs a one-line update
(read the new `cwd` argument) to get real isolation for CODERGEN branches; until then it keeps
working, just without the isolation guarantee the DOT author's `isolate` attribute implies.
This is named explicitly rather than left to be discovered by an embedder debugging a
cross-branch file collision.
