# ADR-004: Relocate four shared exports to break a cycle; refuse lint-dirty graphs in `run()`

**Status:** accepted
**Date:** 2026-08-05
**Deciders:** Solution Architect, verified by Feature Critic

## Context

F10: a direct `new Engine(...)` embed does not refuse a graph carrying ERROR-severity lint
diagnostics, unlike the CLI's own pre-check — silent execution of an invalid graph. The
straightforward fix, `import { lint, hasErrors } from '../dot/lint.ts'` inside `engine.ts`,
creates a genuine module cycle: `dot/lint.ts` already imports `PASSTHROUGH_KINDS,
RUNS_ON_MODES, RunsOn, runsOn` from `core/engine.ts`. ES module imports are hoisted above all
other top-level code regardless of source order, so `engine.ts` importing `lint.ts` while
`lint.ts` imports back from `engine.ts` produces `ReferenceError: Cannot access
'PASSTHROUGH_KINDS' before initialization` at module load — a crash taking down the whole CLI
and test suite, not a subtle bug. Traced and independently re-verified against the actual
import graph of every file `lint.ts` depends on; no second hidden cycle exists.

## Decision

Move `PASSTHROUGH_KINDS`, `RunsOn`, `RUNS_ON_MODES`, `runsOn()` from `core/engine.ts` to
`dot/graph.ts` (which already resolves other `type`/`shape` attributes into typed engine
concepts — `runs_on` belongs there by the same logic). `engine.ts` imports them back and
re-exports them, so no existing importer's path changes. `lint.ts`'s one import line moves
from `'../core/engine.ts'` to `'./graph.ts'`. `engine.ts` then imports `lint`/`hasErrors` with
no cycle, and `run()` calls `lint(this.opts.graph)` as its first action, refusing with a
`Status.FAIL` `RunResult` — the same shape every other precondition failure in this class
already uses — rather than throwing.

## Alternatives considered

### Constructor throws on a lint-dirty graph

**Why it was attractive:** fails as early as possible, before any run-directory I/O happens.
**Why rejected:** every other precondition failure here (no start node, unknown node, no
handler registered) is a `Status.FAIL` return from `run()`, never a thrown exception — a
throw would be a different error-handling shape an embedder has to special-case for a failure
that's the same *kind* of thing as ones already handled the FAIL-return way.

### Leave `Engine` untouched; document that callers must lint first

**Why rejected outright:** this is F10, verbatim — an embedder who doesn't know to call
`lint()` separately gets no protection, which is the exact bug this fix exists to close.

## Consequences

**We gain:** `core/engine.ts` becomes purely "execute against already-resolved values" — a
cleaner boundary — and any future embedder gets the same protection the CLI already has,
intrinsically.

**We accept:** a refused embed leaves a run directory and `events.jsonl` behind (the
constructor's I/O already ran before `run()` gets a chance to refuse), where the CLI's
pre-construction check leaves nothing — a minor, deliberate divergence, arguably a feature (a
record that an invalid graph was attempted), pinned by a test rather than left to drift.
`cli.ts` needs no changes; its check becomes a fast-path optimization, not the sole guard.

**We will need to revisit this if:** a second symbol needs to cross this same cycle in the
opposite direction, which would mean `dot/graph.ts` is accreting responsibilities that belong
elsewhere and the boundary needs re-drawing rather than one more relocation.
