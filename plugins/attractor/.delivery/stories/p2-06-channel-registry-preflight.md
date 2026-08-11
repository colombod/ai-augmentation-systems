<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-06
title: defaultChannels() + preflightHumanGates()
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-5, FR-6, FR-8]
depends_on: [p2-03, p2-04]
size: M
---

# Channel registry + preflight

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Implement `channels/defaults.ts`'s `defaultChannels()` (the one place `AgentChannel`'s
self-enforced `allowed` flag and `isChannelViable`'s advisory `allowAgentGates` check are
computed from the **same two booleans**, guaranteed to agree by construction) and
`channels/preflight.ts`'s `preflightHumanGates()` — a static, condition-blind check that refuses
a run **before any node dispatches** if a reachable human gate has no viable hop anywhere in its
channel chain, closing the "blocks forever with nothing that will ever answer it" risk one layer
earlier than the runtime dispatch loop.

## Context

The architecture's own doc comment on `defaultChannels()`: "the one place the two independent
checks (self-enforcement in `AgentChannel`, advisory filtering in `isChannelViable`) are
guaranteed to agree, because both are derived from the same two booleans at construction time,
not asserted equal separately." `ADR-021` (full rationale for `reachableFrom`'s placement):
relocating it into `dot/graph.ts` (mirroring `findConvergenceNode`'s precedent) would create a
`graph.ts`↔`argv.ts` import cycle, since `reachableFrom` calls `wantsVerdict` and `argv.ts`
already imports `type Node` from `graph.ts`; writing a second, independent reachability walk was
rejected as "exactly the 'two mechanisms answering the same question' drift this codebase's own
doctrine refactors away every time it recurs." `reachableFrom` (`lint.ts:53-100`, read directly)
is a plain BFS over `outgoingEdges` with one goal-gate-conditional seeding rule for
`retry_target`/`fallback_retry_target`, no node-kind-specific logic — a human gate nested inside a
`Handler.PARALLEL` branch is already reachable with no special-casing, since a `component`
node's branches are ordinary outgoing edges to it.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/channels/defaults.ts` | create — `defaultChannels()` |
| `plugins/attractor/engine/src/channels/preflight.ts` | create — `preflightHumanGates()`, `GateViabilityDiagnostic` |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — `reachableFrom` (line 53) gains `export`; zero body change |
| `plugins/attractor/engine/test/lint.test.ts` | must pass unmodified |

## Interfaces and contracts to honor

```ts
// channels/defaults.ts
export function defaultChannels(opts?: { agent?: Omit<AgentChannelOptions, 'allowed'> }): Map<string, Channel>
// Seeds { human: new HumanChannel(), agent: new AgentChannel({...opts?.agent, allowed: <computed>}) }
// where <computed> is derived from the SAME allowAgentGates+claudeAvailable pair
// isChannelViable('agent', rc) will be evaluated against for the same run.

// channels/preflight.ts
export interface GateViabilityDiagnostic {
  node: string
  chain: readonly string[]
  reasons: readonly string[]   // one per hop, from whyNotViable()
}
export function preflightHumanGates(
  graph: Graph, channels: ReadonlyMap<string, Channel>, runContext: ChannelRunContext,
): GateViabilityDiagnostic[]
```

Required behavior: compute `reachableFrom(graph, startNodeId)` (the graph's real `Handler.START`
node), filter to `Handler.HUMAN` nodes, read each gate's `human.channel` chain (comma-split+
trimmed, default `["human"]`), check every hop via `isChannelViable`; a gate is refused (produces
one diagnostic) **iff every hop is non-viable**. A gate behind a conditional branch is inspected
anyway (condition-blind, matching every other TOPO-family rule's own over-approximation). An
unreachable gate is not inspected at all.

## Relevant design decisions

- **ADR-021** — full, both rejected alternatives (relocate into `graph.ts`; write a second
  reachability walk).
- **ADR-022** — `defaultChannels()` is where `AgentChannel`'s `allowed` and `isChannelViable`'s
  advisory check are derived together, closing the agreement gap that ADR names.

## Acceptance criteria

- [ ] `FR-8` — `defaultChannels()`'s `agent` entry's `allowed` value is demonstrably derived from
      the same `(allowAgentGates, claudeAvailable)` pair a parallel `isChannelViable('agent', rc)`
      call would use.
- [ ] `FR-5`/`FR-6` — one reachable `Handler.HUMAN` node, only hop (`"human"`, default) non-viable
      → exactly one diagnostic naming that node.
- [ ] `FR-5`/`FR-6` — mixed viable/non-viable chain (e.g. `human.channel="human,agent"`,
      `isInteractive:false`, `allowAgentGates:true`, `claudeAvailable:true`) → no diagnostic.
- [ ] `FR-5`/`FR-6` — every hop non-viable → refused.
- [ ] `FR-5`/`FR-6` — no `human.channel` attribute → defaults to `["human"]`, evaluated normally.
- [ ] `FR-5`/`FR-6` — a gate unreachable from the start node → no diagnostic, regardless of its
      own viability.
- [ ] `FR-5`/`FR-6` — a gate behind a conditional edge is still inspected (condition-blind) —
      tested explicitly, not merely omitted.
- [ ] Mutation-checked: a mutant inverting "every hop non-viable" to "any hop non-viable" turns
      at least one test red.
- [ ] `node --test` passes; `lint.test.ts` passes unmodified.

## Test approach

**Level:** unit, `Graph` fixtures built via `parseDot(src)` the same way `lint.test.ts`'s own
fixtures are.
**Cases:**

| Case | Expected |
| :-- | :-- |
| single hop, non-viable | one diagnostic |
| mixed viable/non-viable chain | no diagnostic |
| every hop non-viable | refused |
| no `human.channel` attribute | defaults to `["human"]` |
| unreachable gate | not inspected, no diagnostic |
| gate behind conditional edge | still inspected |
| `defaultChannels()`'s agent `allowed` | matches `isChannelViable('agent', rc)`'s own computation |

**Run with:** `node --test test/channels-preflight.test.ts test/lint.test.ts` (from
`plugins/attractor/engine`; `defaultChannels()` tests may share the file or split), then full
`node --test`.

## Out of scope

- `HumanGateHandler`'s own dispatch loop (p2-07) — a separate call site consulting the same
  `isChannelViable`.
- Wiring preflight into `Engine.run()` (p2-08).
- The "preflight + dispatch agreement" integration test — needs a real dispatching
  `HumanGateHandler` wired via `Engine`; lives in p2-08.

## Dependencies

- **p2-03** — `HumanChannel`.
- **p2-04** — `AgentChannel`.
- **Not p2-05** — `CommandChannel` is never constructed inside `defaultChannels()`, and
  `preflightHumanGates()` needs only the `Channel` interface; p2-05 proceeds fully in parallel
  with this story.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
