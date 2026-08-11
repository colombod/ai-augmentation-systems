# ADR-021: The new preflight reachability check exports and reuses `dot/lint.ts`'s existing `reachableFrom`, rather than relocating or reimplementing it

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect

## Context

`preflightHumanGates()` (new, `channels/preflight.ts`) needs to know which `Handler.HUMAN` nodes
are reachable from the graph's start node, so it can restrict its viability check to gates a run
could actually reach — an unreachable gate with no viable channel shouldn't refuse a run that
would never dispatch it. `dot/lint.ts` already has exactly this traversal, `reachableFrom`
(`lint.ts:53-100`), module-private, used once internally by a TOPO-family rule (`lint.ts:373`).
It is a plain BFS over `outgoingEdges`, with one piece of domain-specific seeding
(`retry_target`/`fallback_retry_target`, gated on `hasGoalGate`) and no node-kind-specific logic —
verified by reading it in full, not assumed from its name. It has no awareness of
`Handler.PARALLEL`/`findConvergenceNode` either; a `component` node's branches are ordinary
outgoing edges to it, the same as everything else, so a human gate nested inside a parallel
branch is already reachable by this same walk with no special-casing needed.

## Decision

`reachableFrom` gains `export`. `channels/preflight.ts` imports it directly, with zero changes to
its body or behavior.

## Alternatives considered

### Relocate `reachableFrom` into `dot/graph.ts`, mirroring `findConvergenceNode`'s precedent

**Why it was attractive:** `graph.ts` is this codebase's existing home for pure graph-structural
functions consumed by multiple modules (`findConvergenceNode`/`findPartialReconvergence` moved
there for exactly this reason during FR-17b), and it would put preflight's dependency in the
"more foundational" layer rather than reaching into `lint.ts`.
**Why rejected:** `reachableFrom` calls `wantsVerdict` (`backend/argv.ts:42`) to conditionally
seed graph-level retry-target reachability, and `backend/argv.ts` already imports `type Node`
from `dot/graph.ts`. Moving `reachableFrom` into `graph.ts` would make `graph.ts` import
`wantsVerdict` from `argv.ts` — a new `graph.ts`↔`argv.ts` cycle. The `Node` import is type-only
and erased at build time (no runtime cycle), and ADR-004's own precedent shows this project has
tolerated a type-only cycle before when the alternative was worse — but here the alternative
(export in place) is strictly smaller and introduces no new cycle at all, so there's no reason to
accept even a tooling-visible one for a marginal purity gain.

### Write a second, independent reachability walk inside `channels/preflight.ts`

**Why it was attractive:** zero coupling to `dot/lint.ts`'s internals.
**Why rejected:** exactly the "two mechanisms answering the same question" drift this codebase's
own doctrine (cited throughout ADR-013) refactors away every time it recurs. Two reachability
walks that are supposed to agree but are maintained separately will eventually disagree.

## Consequences

**We gain:** preflight's reachability semantics are identical to every other reachability-
dependent lint rule in this codebase, verified sound for the PARALLEL-branch interaction by
direct reading rather than assumed.

**We accept:** `dot/lint.ts` now exports a function whose name and doc comment describe only its
original TOPO-family purpose; a future edit to that rule's own needs could silently change
preflight's behavior too, since both now depend on the identical implementation.

**We will need to revisit this if:** a future change to TOPO-004 or `reachableFrom` needs to
special-case something preflight should NOT inherit (or vice versa) — at that point split into
a shared, explicitly-named helper both call, rather than letting one caller's need distort the
other's.
