<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-02
title: Channel, HumanGateContext, ChannelAnswer, ChannelRunContext, isChannelViable/whyNotViable
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-8]
depends_on: []
size: S
---

# Channel core contracts

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Create `channels/types.ts`: the `Channel` interface, its three data contracts
(`HumanGateContext`, `ChannelAnswer`, `ChannelRunContext`), and the one shared viability
predicate (`isChannelViable`/`whyNotViable`) consulted by both the preflight step (p2-06) and
`HumanGateHandler`'s dispatch loop (p2-07) — pure, I/O-free, with no dependency on `engine.ts`,
`cli.ts`, or `dot/lint.ts`. This is the shared foundation every downstream piece of this phase
builds against, so it ships first and lets p2-03/p2-04/p2-05/p2-07 fan out in parallel.

## Context

Glossary terms load-bearing here (`.delivery/glossary.md`): **channel** ("one mechanism capable
of answering a *human gate*... Implements the `Channel` interface — one `answer()` method,
taking a `HumanGateContext` and returning a `ChannelAnswer`"), **channel chain**, **hop**,
**viable** ("whether its preconditions hold for *this specific run*... computed once, consulted
by both the preflight refusal check and the runtime dispatch loop via the same predicate,
`isChannelViable`"). `HumanGateContext` is named to avoid colliding with `goal_gate`/`GATE-002`'s
unrelated "gate" vocabulary (see glossary: **human gate** vs. **goal gate**, "distinct and never
interchangeable"). The PRD's own FR-8 text ("`Channel` → `GateContext` → `preferredLabel` →
`selectEdge`") uses the older, superseded name `GateContext`; the architecture renamed it to
`HumanGateContext` and that renaming is binding — do not reintroduce `GateContext` anywhere.

`isChannelViable`'s three branches, each independently testable: `'human'` → `rc.isInteractive`;
`'agent'` → `rc.allowAgentGates && rc.claudeAvailable`; anything else → `rc.configuredNames.has(name)`
(covers any `CommandChannel` name an operator wires via `--channel`, p2-09). This predicate is
**advisory only** for the agent case — `ADR-022` (p2-04) requires `AgentChannel` to *also*
self-enforce its own two-key rule; this story only builds the advisory side.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/channels/types.ts` | create — the only file this story touches |

## Interfaces and contracts to honor

```ts
export interface HumanGateContext {
  nodeId: string
  label: string
  legalAnswers: readonly string[]
  exposedContext: Readonly<Record<string, string>>
  agentInstructions?: string
}
export interface ChannelAnswer { label: string | null }
export interface Channel {
  answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer>
}
export interface ChannelRunContext {
  isInteractive: boolean
  allowAgentGates: boolean
  claudeAvailable: boolean
  configuredNames: ReadonlySet<string>
}
export function isChannelViable(name: string, rc: ChannelRunContext): boolean {
  if (name === 'human') return rc.isInteractive
  if (name === 'agent') return rc.allowAgentGates && rc.claudeAvailable
  return rc.configuredNames.has(name)
}
export function whyNotViable(name: string, rc: ChannelRunContext): string
```

`whyNotViable`'s exact message wording is not specified beyond its signature — implementer
decides, but it must produce a distinct, non-empty string per failing precondition (human
non-interactive; agent missing `--allow-agent-gates` vs. `claude` unavailable — name which; a
named channel absent from `configuredNames`), since `GateViabilityDiagnostic.reasons` (p2-06)
surfaces these directly to an operator.

## Relevant design decisions

- **Architecture's own framing** (FR-5–8 section, Interfaces): "ONE viability predicate,
  consulted by BOTH preflight and `HumanGateHandler`'s per-hop dispatch loop — never two
  independently-maintained copies of 'what makes a channel usable this run.'"
- **ADR-022** — `isChannelViable`'s `'agent'` branch is advisory only; `AgentChannel` (p2-04)
  must not rely on it as its sole enforcement.

## Acceptance criteria

- [ ] `FR-8` — `channels/types.ts` exports all six symbols above with the exact signatures shown.
- [ ] `isChannelViable('human', rc) === rc.isInteractive` for both `true`/`false`.
- [ ] `isChannelViable('agent', rc) === (rc.allowAgentGates && rc.claudeAvailable)` — all four
      boolean combinations tested.
- [ ] `isChannelViable('anything-else', rc) === rc.configuredNames.has('anything-else')` —
      tested present and absent.
- [ ] `whyNotViable` returns a distinct string per failing precondition (human/agent-flag/
      agent-claude/unconfigured-name).
- [ ] No import from `engine.ts`, `cli.ts`, or `dot/lint.ts` anywhere in `channels/types.ts` —
      checked directly (the property `ADR-020` depends on).

## Test approach

**Level:** unit — pure functions, no I/O.
**Cases:**

| Case | Expected |
| :-- | :-- |
| `isChannelViable('human', {isInteractive:true,...})` | `true` |
| `isChannelViable('human', {isInteractive:false,...})` | `false` |
| `isChannelViable('agent', ...)` all 4 boolean combos | matches `allowAgentGates && claudeAvailable` |
| `isChannelViable('discord', {configuredNames:new Set(['discord']),...})` | `true` |
| `isChannelViable('discord', {configuredNames:new Set(),...})` | `false` |
| `whyNotViable` per failing precondition | distinct, non-empty string each |

**Run with:** `node --test test/channels-types.test.ts` (new file, from `plugins/attractor/engine`).

## Out of scope

- Any `Channel` implementation (p2-03/04/05).
- Preflight logic (p2-06).
- Construction of a real `HumanGateContext` from a `Graph`/`Node` (p2-07, `ADR-025`'s job).

## Dependencies

- None. Runs in parallel with p2-01.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
