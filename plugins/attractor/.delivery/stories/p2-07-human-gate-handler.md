<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-07
title: HumanGateHandler — per-hop dispatch, escalation, timeout parsing, fallback
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-5, FR-6, FR-8]
depends_on: [p2-02]
size: L
---

# `HumanGateHandler` chain-walk logic

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Implement `handlers/human.ts`'s `HumanGateHandler` — the leaf handler (architecturally identical
in shape to `BoxHandler`/`ToolHandler`: dispatch, call out, return one `Outcome`; no
`ctx.runBranch`, no fan-out) that walks a human gate's *channel chain* in order, trying each
*hop*'s viability, dispatching viable hops to `Channel.answer()`, escalating on a null answer OR
a thrown error, and falling back to `on_timeout`/`human.default_choice` or a hard FAIL once the
chain is exhausted. Built and fully unit-tested via hand-built `HandlerCtx` and fake `Channel`
doubles — no `Engine`, no `lint()`, no registration — mirroring `p5-05`'s own precedent of
testing a seam (`HandlerCtx.runBranch`) before its consumer existed.

## Context

Registration (making this handler reachable from a real run) is deliberately **p2-08**'s job, not
this story's — this story's own scope is large enough (six independently falsifiable dispatch
behaviors) to be a full sitting on its own, and separating it means this logic can be built,
reviewed, and fully green *before* the registration change that simultaneously makes it live and
breaks two pre-existing tests (p2-08).

**`ADR-025` (binding correction, full).** The adopted design doc claimed `legalAnswers` "is the
same enumeration HITL-001's existing rule already does." Re-verified against source and found
**false** — HITL-001's own enumeration (`lint.ts:508`, `outgoingEdges(graph, node.id).map(e => e.attrs.label)`)
has no `isConditional` filter; it collects every outgoing edge's label, conditional or not.
`selectEdge`'s real routing (`core/edge-select.ts:97-108`) only ever matches a `preferredLabel`
against **unconditional** edges (step 2, after the condition cascade has already either claimed
the edge or fail-fast-terminated the node). Literal reuse would advertise a conditional edge's
label as an answerable option the engine can structurally never route to. Binding formula:
```ts
legalAnswers = outgoingEdges(graph, node.id).filter(e => !isConditional(e)).map(e => e.attrs.label).filter(l => l !== undefined)
```
(`outgoingEdges` from `dot/graph.ts:131`, `isConditional` from `core/edge-select.ts:53`, both
already exported.)

**`human.channel_timeout` parsing** — "comma-split, position-matched, last-value-repeats
semantics have no precedent elsewhere in this codebase" (architecture's own words):
comma-separated list of duration strings (each through existing `parseDuration`,
`core/duration.ts:12` — bare int=seconds, `ms`/`s`/`m`/`h` suffix, unparseable=0/no-timeout),
**position-matched one-to-one** against the chain's hops; shorter than the chain → last value
repeats for the remainder; longer → extras ignored; a single bare value → applies to every hop;
entirely absent → every hop gets `timeoutMs: null`.

**`exposedContext` construction:** `human.context=` is a comma-separated list of context **key
names** (same parsing convention `HITL-003` already established for `human.channel`, verified at
`lint.ts:695`: `.split(',').map(t => t.trim())`) — include a named key only if
`ctx.context.has(key)` is true ("only PRESENT keys," using `Context.get`/`Context.has`,
`core/context.ts:89-95`).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/handlers/human.ts` | create — the only file this story touches |

## Interfaces and contracts to honor

```ts
export class HumanGateHandler implements Handler {
  constructor(channels: ReadonlyMap<string, Channel>, runContext: ChannelRunContext)
  async execute(ctx: HandlerCtx): Promise<Outcome>
}
```

Constructor-injected, exactly like `BoxHandler(backend)` — **not** delivered via `HandlerCtx`. A
test constructs `new HumanGateHandler(fakeChannelsMap, fakeRunContext)` directly and calls
`.execute(handCraftedCtx)`.

`execute(ctx)` required steps:
1. Build `HumanGateContext` once: `label` = `human.prompt || human.label || prompt || label ||
   node.id` (mirrors `BoxHandler`'s own prompt/label fallback); `legalAnswers` per the `ADR-025`
   formula above; `exposedContext` per the `human.context=` parsing above; `agentInstructions` =
   `human.agent_instructions` verbatim, `undefined` if absent.
2. Read `human.channel`, comma-split+trimmed, default `["human"]`.
3. Read `human.channel_timeout`, comma-split+trimmed+`parseDuration`'d, position-matched per the
   rule above.
4. For each `(hopName, hopTimeoutMs)` in order: (a) `!isChannelViable(hopName, runContext)` →
   skip, emit `{type: 'node.human.hop_skipped', node: ctx.node.id, channel: hopName}`, continue;
   (b) resolve `channels.get(hopName)` (a name absent from the map is treated identically to
   non-viable — skip+emit, defense in depth); (c) `await channel.answer(hCtx, hopTimeoutMs)` in
   try/catch — a **throw** is caught and treated identically to `{label: null}` (escalate),
   logged via `{type: 'node.human.hop_error', node: ctx.node.id, channel: hopName, message:
   String(err)}`, never left to propagate as an unhandled rejection; (d) non-null label → return
   `{status: Status.SUCCESS, preferredLabel: label}` immediately, no further hops tried; (e)
   null/caught-throw → emit `node.human.hop_timeout`/`node.human.hop_error` as appropriate,
   continue.
5. Chain exhausted: `on_timeout` or `human.default_choice` present → `{status: Status.SUCCESS,
   preferredLabel: <that value>}` (pre-existing, unchanged HITL-001 doctrine — `selectEdge`
   routes it). Neither present → `{status: Status.FAIL, notes: <names the node, that the chain
   was exhausted>}`.
6. Never returns `RETRY`/`PARTIAL`. Writes no context beyond generic per-dispatch bookkeeping.

## Relevant design decisions

- **ADR-025** — binding, full (legalAnswers formula above).
- **ADR-023** — this handler's dispatch loop is channel-agnostic — no special-casing per channel
  kind; that `human` specifically never answers is a property of `channels/human.ts`, not this
  file.
- **NFR-3** — this handler inherits `parseDuration`'s existing absent/`"0"` collision unchanged —
  an author cannot express "time out this hop immediately" via `=0`, they omit that hop instead.

## Acceptance criteria

- [ ] `FR-8` — first-viable-hop-that-answers short-circuits: hop 2's `channel.answer()` is never
      called when hop 1 (viable) answers non-null (call-count spy).
- [ ] `FR-8` — a hop returning `{label: null}` escalates (hop 2's `answer()` is called).
- [ ] `FR-8`/`FR-6` — a hop whose `channel.answer()` throws escalates identically to null, AND
      emits `node.human.hop_error` naming the channel and the caught message; not left as an
      unhandled rejection.
- [ ] `FR-6` — a non-viable hop is skipped without calling `answer()`, emits `node.human.hop_skipped`.
- [ ] `FR-5`/`FR-6` — chain exhausted with `on_timeout`/`human.default_choice` present → SUCCESS
      with that value.
- [ ] `FR-5`/`FR-6` — chain exhausted with neither → FAIL, never RETRY/PARTIAL.
- [ ] `human.channel_timeout` parsing, all four shapes as separate test cases: fewer values than
      hops; more values than hops; single bare value; attribute absent.
- [ ] `ADR-025` — a fixture with one conditional and one unconditional outgoing edge from the
      gate produces `legalAnswers` containing only the unconditional label (inspect the `ctx` a
      fake `Channel` actually receives) — the fixture must include both edge kinds; an
      all-unconditional fixture is decorative for this specific correction.
- [ ] Mutation-checked via a controlled race (fake wait + timer), not a final-value check alone,
      for the escalation/timeout logic specifically.
- [ ] `node --test` passes (new file, no pre-existing consumer, zero regression risk from this
      story alone).

## Test approach

**Level:** unit, fake `Channel` doubles. `HandlerCtx` hand-constructed directly (`node`, `graph`,
`context`, `runDir`, `cwd`, a real `EventLog` pointed at a temp dir — matching `tool.test.ts`/
`box.test.ts`'s own setup pattern). No `Engine`, `lint()`, or `defaultHandlers()` anywhere in this
story's tests.
**Cases:**

| Case | Expected |
| :-- | :-- |
| hop 1 viable, answers | hop 2 never called |
| hop 1 `{label:null}` | escalates to hop 2 |
| hop 1 throws | escalates to hop 2, `node.human.hop_error` emitted |
| hop non-viable | skipped, `node.human.hop_skipped` emitted, `answer()` not called |
| chain exhausted, `on_timeout` set | SUCCESS with that label |
| chain exhausted, neither fallback | FAIL |
| `human.channel_timeout` — 4 shapes | fewer/more/single/absent all resolve per position-match rule |
| mixed conditional/unconditional edges | `legalAnswers` excludes the conditional one's label |

**Run with:** `node --test test/handlers-human.test.ts` (new file, from `plugins/attractor/engine`).

## Out of scope

- Registering `Handler.HUMAN` anywhere (p2-08).
- Wiring into `defaultHandlers()`/`Engine.run()` (p2-08).
- Any test constructing a real `Engine` or dispatching via `lint()`/`parseDot()` end-to-end
  (p2-08).
- `preflightHumanGates` (p2-06, separate call site).

## Dependencies

- **p2-02 only** (`Channel`/`HumanGateContext`/`ChannelAnswer`/`ChannelRunContext`/
  `isChannelViable`) — fakes stand in for every other channel-shaped input, so p2-03/04/05/06 are
  **not** dependencies despite the conceptual relationship.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
