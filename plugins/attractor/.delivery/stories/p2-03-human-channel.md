<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-03
title: HumanGateWait / StdinHumanGateWait / HumanChannel (realizes ADR-002)
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-5, FR-6]
depends_on: [p2-02]
size: S
---

# `HumanChannel`

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Implement `channels/human.ts` — `HumanGateWait`, `StdinHumanGateWait` (`resume()` + heartbeat per
`ADR-002`), and `HumanChannel` implementing `Channel` — realizing `ADR-002`'s already-accepted
TTY-check block-vs-fail-fast decision as the `human` hop. Per `ADR-023`, this channel has **no
code path in this build that ever resolves with a real, human-typed answer** — every acceptance
criterion below must make that fact falsifiable, not merely assumed.

## Context

`ADR-002` (accepted, this is its implementation): block via `resume()`+heartbeat if
`process.stdin.isTTY`; that TTY check is **not this channel's own job** — `isChannelViable('human', rc)`
is checked by the caller *before* `.answer()` is ever invoked (p2-06/p2-07). `ADR-023`'s two
rejected alternatives, both binding constraints on this story: (1) *build real stdin-answer
parsing* — out of scope, `.superpowers/carry-forward.md`'s Plan 4 entry files this as future
work, not this slice; (2) *have `HumanChannel` self-check `isInteractive`* — rejected because it
"conflates two distinct questions the design deliberately keeps separate: 'not viable, exclude
from the chain silently' (preflight's job) versus 'viable but exhausted, escalate'
(`ChannelAnswer`'s actual runtime contract)." So `HumanChannel.answer()` must contain **no** read
of `process.stdin.isTTY` or any `ChannelRunContext` field anywhere in its own body.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/channels/human.ts` | create — the only file this story touches |

## Interfaces and contracts to honor

```ts
export interface HumanGateWait { block(signal: AbortSignal): Promise<void> }
export class StdinHumanGateWait implements HumanGateWait {
  block(signal: AbortSignal): Promise<void>
  // resume() + heartbeat, per ADR-002; resolves ONLY when `signal` aborts.
}
export class HumanChannel implements Channel {
  constructor(wait?: HumanGateWait)   // default: new StdinHumanGateWait()
  async answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer>
  // timeoutMs !== null: AbortController tied to a setTimeout(timeoutMs); call
  // wait.block(controller.signal); resolve {label: null} once block() returns
  // (block() only ever resolves via abort -- there is no other resolution to
  // distinguish). timeoutMs === null: call wait.block() with a signal never
  // aborted by this channel -- must NOT resolve at all within this build.
}
```

## Relevant design decisions

- **ADR-002** — the blocking decision this channel realizes verbatim (`resume()` + heartbeat on
  a real TTY).
- **ADR-023** — binding: no real-answer path this slice; the two rejected alternatives above.

## Acceptance criteria

- [ ] `FR-5` — a fake `HumanGateWait` proves `timeoutMs` is honored: `block()` receives an
      `AbortSignal` that becomes aborted at/after `timeoutMs`; `answer()` resolves
      `{label: null}` once that happens.
- [ ] `FR-6` — `HumanChannel` never returns a non-null label under any input this build can
      construct — asserted directly (a fake wait resolving `block()` immediately still yields
      `{label: null}`), concretely falsifying `ADR-023`'s central claim.
- [ ] `timeoutMs: null` genuinely never resolves — raced against a short (e.g. 50ms) wall-clock
      deadline via `Promise.race` inside the test itself, confirming the promise is still
      pending, not a resolved value.
- [ ] `HumanChannel.answer()` contains no read of `process.stdin.isTTY` or any `ChannelRunContext`
      field — a code-review gate, stated explicitly since a test can't easily disprove an absent
      check.
- [ ] `node --test` passes, zero regressions.

## Test approach

**Level:** unit, hand-built fake `HumanGateWait` — never spin up a real `StdinHumanGateWait` in
unit tests (that would touch real `process.stdin`, the exact ambient-read anti-pattern the
architecture's Test-strategy "Standing policy" forbids).
**Cases:**

| Case | Expected |
| :-- | :-- |
| fake wait aborts at `timeoutMs` | `answer()` resolves `{label: null}` |
| fake wait resolves `block()` immediately | still `{label: null}`, never a real label |
| `timeoutMs: null`, raced against a 50ms deadline | promise still pending |
| code review of `answer()`'s body | no `process.stdin`/`ChannelRunContext` read |

**Run with:** `node --test test/channels-human.test.ts` (new file, from `plugins/attractor/engine`).

## Out of scope

- Wiring `StdinHumanGateWait` to real `process.stdin.resume()` — implement it (`ADR-002` requires
  it exist for the interactive case) but there is no realistic automated test for it beyond the
  fake-wait tests above (NFR-6 caps runtime/dev deps at 2; no pty dependency is being added).
- Viability checking (`isChannelViable`, p2-02; preflight, p2-06).
- Constructing a real `HumanGateContext` (p2-07).

## Dependencies

- **p2-02** — `Channel`/`HumanGateContext`/`ChannelAnswer` types.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
