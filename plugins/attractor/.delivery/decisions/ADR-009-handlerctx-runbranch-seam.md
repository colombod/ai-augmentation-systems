# ADR-009: `ParallelHandler` gets a branch-execution seam via an optional `HandlerCtx.runBranch` callback, not an `Engine` reference or a nested `Engine` instance

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect

## Context

`ParallelHandler.execute(ctx: HandlerCtx)` needs to run bounded sub-traversals starting at each
branch root (ADR-007). Amplifier's own handler resolves the equivalent need by taking the
owning engine as an explicit extra argument: `ParallelHandler.execute(self, node, context,
graph, logs_root, *, engine: "PipelineEngine | None" = None)` (`handlers/parallel.py:58-66`),
then calling `engine.run_subgraph(...)` (`parallel.py:166` / `:172`) — a method that lives on
the engine, not the handler, precisely because it must read and write engine-owned state.

`core/engine.ts`'s `Handler` interface (`handlers/types.ts:23-25`) is
`execute(ctx: HandlerCtx): Promise<Outcome>` — one argument, no engine reference. Every
existing handler (`PassthroughHandler`, `ToolHandler`, `BoxHandler`) is constructed independent
of any `Engine` instance, and `defaultHandlers(backend)` (`engine.ts:77-84`) builds the whole
handler `Map` **before** `new Engine({..., handlers})` is called — the handler map cannot
contain a reference to the `Engine` that does not exist yet.

Separately: a branch's own goal-gate outcomes, unresolved-failure ledger, and eager-input-check
state must land in the *same* maps the main path already uses (`gateOutcomes`, `nodeFailures`,
`failedOutputs` — `engine.ts:117,184,240`), or a `goal_gate=true` node inside a branch stops
correctly blocking the real exit, and a `runs_on=failure` node elsewhere stops correctly
reacting to a branch's failure. Those maps are `private` fields on `Engine`.

## Decision

`HandlerCtx` gains one new optional field: `runBranch?: (opts: BranchRunOptions) =>
Promise<BranchRunResult>`. `Engine.run()` populates it, bound to a new private method, on every
dispatch (the same pattern `ctx.signal?: AbortSignal` already establishes — "the seam exists so
[a later plan] does not require touching this interface, every handler and every test a second
time to add it later," `handlers/types.ts:15-20`). Ordinary handlers ignore the field entirely.
`ParallelHandler` is the only consumer; it needs **no constructor argument at all** —
`defaultHandlers(backend)`'s own signature and every existing call site of it are unchanged,
gaining only one more `Map` entry.

`Engine`'s new private `runBranch` implementation reuses the exact per-node step logic the main
loop already runs (retry resolution, the eager-input-check, `recordOutcome`) against `this`'s
own `gateOutcomes`/`nodeFailures`/`failedOutputs`, scoped to a caller-supplied `runDir`/`cwd`/
`stopAt` frontier instead of the run's own. Concretely: it is the *same* `Engine` instance's
state being extended, not a second instance's private copy.

## Alternatives considered

### Hand `ParallelHandler` a direct `Engine` reference, amplifier-style

**Why it was attractive:** closest fidelity to the read source; one obvious dependency
injection point.
**Why rejected:** the same construction-order problem named in Context — `defaultHandlers`
builds the `Map` before the `Engine` exists — would force either (a) a two-step registration
convention (`const engine = new Engine({...handlers}); handlers.set(Kind.PARALLEL, new
ParallelHandler(engine))`), which every embedder must remember and which fails silently (a
skipped second step just leaves PARALLEL unregistered, no compile error), or (b) a mutable
`Handler` field set post-construction, which makes `ParallelHandler`'s validity depend on
initialization order in a way nothing in the type system enforces. The optional-`ctx`-field
seam requires no ordering discipline from any caller.

### One independent `new Engine(...)` per branch, each with its own state

**Why it was attractive:** the cleanest-looking recursion — "a branch is just a smaller run" —
and the shape the orchestrator's own framing suggested as the default guess for this
codebase's patterns.
**Why rejected, specifically:** each fresh `Engine` instance owns its **own** empty
`gateOutcomes`/`nodeFailures`/`failedOutputs` maps (`engine.ts:117,184,240` are per-instance
private fields, not module state). A `goal_gate=true` node inside a branch would satisfy or
fail a map nothing outside that branch's own instance ever reads — the pipeline's real exit
gate check (`unsatisfiedGoalGates()`, consulted only at the graph's actual EXIT node, on the
*outer* instance) would never see it, silently reopening exactly the fail-open hole the
existing `gateOutcomes` doc comment (`engine.ts:94-117`) was written to close. This is not a
hypothetical edge case this design chooses to accept — it is a correctness regression the
independent-instance shape introduces by construction, and it is why this ADR exists rather
than folding into ADR-007.

## Consequences

**We gain:** `ParallelHandler` is an ordinary, dependency-free `Handler`; `defaultHandlers`
stays a single self-contained call; goal-gate and unresolved-failure tracking stay globally
correct across concurrent branches without a merge-back step.

**We accept:** the outer engine's bookkeeping maps are now written from concurrently-awaited
branch callbacks rather than one sequential loop. JS's single-threaded execution model makes
this race-free at the data-structure level (no torn writes), but ordering guarantees some
existing doc comments make — `nodeFailures`'s FIRST-FAILURE-order promise (`engine.ts:184`) in
particular — are worth re-verifying empirically under real concurrency rather than assumed;
tracked as Spike 8 in the architecture document, not silently trusted.

**Scope note, added 2026-08-07 (finding F1):** the shared-ledger sharing this ADR decides is
scoped to `gateOutcomes`/`nodeFailures`/`failedOutputs`/`attempts` — engine-owned bookkeeping,
never per-branch. It is deliberately **not** an answer to how a branch's ordinary `Context`
writes (an `outputs=`/`contextUpdates` key a node inside the branch produced) reach the run's
real `Context` after `Context.clone()` isolated them. That is a genuinely separate question —
evidence a node produced, in the author's own namespace, versus control-plane bookkeeping the
engine owns — answered in ADR-010, not here. Conflating the two was the shape of finding F1:
reading this ADR's shared-ledger guarantee as covering *all* branch state, when it only ever
covered the four maps named above.

**`executeNodeStep`, added 2026-08-07 (findings F5, F6):** the "same per-node step logic" this
ADR says `runBranch` reuses is, as of ADR-012, a single shared private method
(`Engine#executeNodeStep`) both the main loop and `runBranch` call — not two hand-kept copies.
This ADR's own reasoning for sharing state (a second, independent implementation drifting from
the first without anyone noticing) is exactly why ADR-012 makes that decision too; see it for
the seam and the rejected alternative (a parity-tested reimplementation).

**Attempts-ledger race, added 2026-08-08 (Task 5's own first fix-loop round):**
Spike 8 (this ADR's own Consequences section) asked whether the shared-ledger
ordering guarantees this ADR assumes hold up under real concurrency rather than
being merely assumed. The first empirical answer: `attempts` did NOT hold up.
`executeNodeStep` read `this.attempts.get(node.id)` before the handler dispatch's
own `await`, then wrote `attempt + 1` only after -- two branches concurrently
dispatching the SAME node id both read the same stale count and both wrote
the same incremented value, losing an update (reproduced: 7 real backend dispatches
where exactly 6 should occur, for two branches racing a `max_retries=2` node).
Fixed by moving the write to be synchronous, immediately after the read, closing
the lost-update. `gateOutcomes`/`nodeFailures`/`failedOutputs` were checked and
are NOT vulnerable to this same pattern -- every write to them is an unconditional
`.set()`/`.delete()` driven by the freshly-resolved post-await outcome, never a
stale pre-await read. `stepCount` (NFR-1's own ceiling) is a single synchronous
statement with no read-before-await gap either.

A narrower piece of Spike 8 remains open, deliberately not closed by this round:
the retries-exhausted paths unconditionally reset `this.attempts` to 0 for a node
id, which can clobber a DIFFERENT, concurrently in-flight branch's own reserved
count on that SAME node id. This is not a data race in the read/write sense above
(no lost update, no torn state) -- it is a semantic question of what "attempts for
this node" means when two independent branches concurrently and repeatedly
dispatch the identical node id, which is exactly the double-dispatch shape PAR-004
(ADR-007) already exists to refuse at the graph-lint level. Not reachable today:
`HAND-001` blanket-refuses every `Handler.PARALLEL` node, and any graph that did
enable it would need to independently defeat PAR-004's own detection (which has 2
narrower, already-tracked gaps, GitHub issue #14) before two branches could even
reach the same node id concurrently. Tracked as a named, accepted limitation
rather than closed here; revisit alongside p5-08 (`ParallelHandler` itself) if
PAR-004's own remaining gaps are ever closed and this stops being purely
theoretical.
