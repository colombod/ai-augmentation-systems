<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-08
title: Register Handler.HUMAN — dot/graph.ts + core/engine.ts, migration repoints
status: done
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-5, FR-6, FR-7, FR-8]
depends_on: [p2-06, p2-07]
size: M
---

# `Handler.HUMAN` registration wiring

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Register `Handler.HUMAN` as a real, dispatchable kind — remove it from `dot/graph.ts`'s
`UNREGISTERED_HANDLER_KINDS`, populate `SUBSTITUTABLE_ATTRS[Handler.HUMAN]`, add
`core/engine.ts`'s `defaultHandlers()` two new optional parameters plus its `HumanGateHandler`
map entry, and add `Engine.run()`'s new preflight-refusal block — turning p2-07's already-tested
logic into live behavior for the first time. Because this registration change is what breaks two
pre-existing, currently-passing tests (whose premise was "`Handler.HUMAN` is always
unregistered"), **this story repoints both in the same commit** — the test suite must never sit
red between stories.

## Context

The architecture's Migration section states, quoted directly: "removing `HUMAN` from
`UNREGISTERED_HANDLER_KINDS` before a real handler is registered would leave a gap" — a graph
with a `hexagon` node would lint clean (`HAND-001` no longer fires) but `Engine.run()` would
still abort mid-dispatch with "no handler registered," since `defaultHandlers()` wouldn't yet
have a map entry. Both edits land together. `ADR-024` (full, binding): both new
`defaultHandlers()` params are **optional** with safe, zero-I/O defaults — 47 existing call sites
across `engine/test/{parallel,engine,lint,index,live}.test.ts` and `skills/attractorify/verify-run.ts`,
none exercising `Handler.HUMAN` (confirmed by grep), would otherwise need a mechanical edit for
zero behavioral benefit; Spike 15 empirically confirmed `process.stdin.isTTY` reads `undefined`
under `node --test`, so the "live" `isInteractive` default is provably inert for the whole
existing suite, not merely convenient.

Three specific test breaks/additions, verified directly against current source:
1. `lint.test.ts`'s `UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually registers`
   — self-updating, needs no edit.
2. `lint.test.ts`'s `HAND-001 fires for Handler.HUMAN too, since it is unregistered in this
   build` (`lint.test.ts:1690-1697`) — premise breaks. **Delete**, and add `gate [shape=hexagon,
   prompt="approve?"]` (with a routing edge) to the adjacent `HAND-001 does not fire for any
   registered handler kind` fixture (`lint.test.ts:1711-1721`), testing the flip side directly
   rather than a bare deletion.
3. `engine.test.ts`'s `NO_HANDLER` fixture (`gate [shape=hexagon]`, `engine.test.ts:1214-1245`,
   feeding the `'the embedded Engine refuses a HAND-001-dirty graph...'` test) — once
   `Handler.HUMAN` registers, this graph lints clean and is instead refused by the **new
   preflight step** (the default `human` hop isn't viable under `node --test`'s non-TTY stdin).
   `result.status===FAIL`/`result.path.length===0` (lines 1234, 1236) still hold;
   `assert.match(result.notes, /HAND-001/)` (line 1235) breaks. Fix: change `NO_HANDLER`'s node
   shape to `tripleoctagon`/`house` (still genuinely unregistered — `Handler.FAN_IN`/
   `MANAGER_LOOP`), preserving the existing test's FR-11×FR-17a intent unchanged; **add a new,
   separate test** using a `hexagon` fixture asserting the preflight-refusal path instead.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/dot/graph.ts` | modify — `UNREGISTERED_HANDLER_KINDS` loses `Handler.HUMAN` (stays `[Handler.FAN_IN, Handler.MANAGER_LOOP]`); `SUBSTITUTABLE_ATTRS[Handler.HUMAN]` → `['human.prompt', 'human.label', 'prompt', 'label']`; correct the two inline comments at ~lines 206/400 |
| `plugins/attractor/engine/src/core/engine.ts` | modify — `defaultHandlers()` gains two optional params; `run()` gains the preflight-refusal block after the existing lint-refusal block (`engine.ts:977`) |
| `plugins/attractor/engine/test/lint.test.ts` | modify — delete the `HAND-001 fires for Handler.HUMAN too` test; add a `hexagon` line to the adjacent "does not fire" fixture |
| `plugins/attractor/engine/test/engine.test.ts` | modify — repoint `NO_HANDLER`'s shape; add a new `hexagon`-fixture preflight-refusal test |

## Interfaces and contracts to honor

```ts
// dot/graph.ts
export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[] = [Handler.FAN_IN, Handler.MANAGER_LOOP]
// SUBSTITUTABLE_ATTRS[Handler.HUMAN]: ['human.prompt', 'human.label', 'prompt', 'label']

// core/engine.ts
export function defaultHandlers(
  backend: Backend,
  channels: ReadonlyMap<string, Channel> = defaultChannels(),
  channelRunContext: ChannelRunContext = {
    isInteractive: Boolean(process.stdin.isTTY),
    allowAgentGates: false,
    claudeAvailable: false,
    configuredNames: new Set(['human', 'agent']),
  },
): Map<HandlerKind, Handler>   // gains [Kind.HUMAN, new HumanGateHandler(channels, channelRunContext)]
```
`Engine.run()` gains, between the existing lint-refusal block (`hasErrors(diagnostics)`,
`engine.ts:977`) and the start-node lookup that follows:
```ts
const gateDiagnostics = preflightHumanGates(graph, this.opts.channels, this.opts.channelRunContext)
if (gateDiagnostics.length > 0) { /* same result()/events shape as the lint-refusal block:
     append 'pipeline.end' FAIL, return this.result(Status.FAIL, msg, msg) built from gateDiagnostics */ }
```
`EngineOptions` gains `channels?: ReadonlyMap<string, Channel>` and `channelRunContext?:
ChannelRunContext`. **Implementer decision required and must be documented**: since `Engine`'s
constructor doesn't currently default `EngineOptions` fields the way `defaultHandlers()`'s own
parameters do, a bare `new Engine({..., handlers: someMap})` with neither field supplied must not
throw or behave unsafely — it must degrade to the same non-interactive, non-agent-gate default
`defaultHandlers()`'s own defaults describe.

## Relevant design decisions

- **ADR-024** — full, binding (optional-params rationale, 47-call-site count, Spike 15).
- Architecture's Migration section — the atomic-together constraint (binding — this is why
  `graph.ts` and `engine.ts` land in one story).

## Acceptance criteria

- [ ] `FR-7` — `lint.test.ts`'s full 8-test HITL-001 suite (lines ~305–421, untouched by this
      story) passes unmodified.
- [ ] `FR-7` — `UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually registers`
      passes with zero edit.
- [ ] The repointed "does not fire for any registered handler kind" fixture lints clean of
      `HAND-001` with the added `hexagon` line.
- [ ] The deleted test's coverage intent (HAND-001 does NOT fire for `Handler.HUMAN` once
      registered) is now covered by the fixture change — confirmed by reading the merged test.
- [ ] The repointed `NO_HANDLER` fixture (shape → `tripleoctagon`/`house`) still asserts the
      original FR-11×FR-17a intent (`FAIL`, `/HAND-001/`, `path.length===0`).
- [ ] A new `hexagon`-fixture test asserts `FAIL`, `path.length===0`, and the refusal is
      attributable to preflight (not `/HAND-001/`).
- [ ] `FR-5`/`FR-6` — preflight+dispatch agreement (integration): a chain preflight approves must
      never subsequently FAIL at dispatch for the identical reason within one `Engine.run()` call
      — asserted via a real `Engine` with a hand-built `channels`/`channelRunContext` making
      exactly one hop viable, confirming the run proceeds past preflight AND that hop's
      `channel.answer()` is invoked.
- [ ] `FR-8` — unmatched channel answer (integration): a `HumanGateHandler` dispatch producing a
      `preferredLabel` matching no edge label still reaches `selectEdge`'s weight/lexical
      fallback rather than erroring — asserted via a real `Engine.run()`.
- [ ] `SUBSTITUTABLE_ATTRS[Handler.HUMAN]` wiring: a `human.prompt` referencing an owed/failed key
      trips DATA-001, matching `engine.test.ts:2834`'s existing exhaustiveness style, confirming
      the array's contents actually wire into `substitutableText()`.
- [ ] `node --test` passes with zero known-failing tests at the end of this story.

## Test approach

**Level:** integration — real `Engine.run()`, hand-built `channels`/`channelRunContext`,
`StubBackend`. The migration repoints/additions land in their existing home files (`lint.test.ts`,
`engine.test.ts`). The preflight+dispatch-agreement and unmatched-answer tests are new — add as
either a new section in `engine.test.ts` (matching `p5-05`'s own precedent) or a new
`engine/test/human-gate-integration.test.ts`; state the choice in Implementation notes.
**Cases:**

| Case | Expected |
| :-- | :-- |
| existing 8-test HITL-001 suite | passes unmodified |
| repointed "does not fire" fixture | lints clean of HAND-001 with `hexagon` added |
| repointed `NO_HANDLER` | still asserts original FR-11×FR-17a intent |
| new `hexagon` preflight test | FAIL, path empty, refusal is preflight-attributed, not HAND-001 |
| preflight-approved chain | dispatch reaches and invokes that hop's `channel.answer()` |
| unmatched `preferredLabel` | `selectEdge` fallback chosen, no error |
| `human.prompt="${owed.key}"` | DATA-001 fires |

**Run with:** `node --test test/lint.test.ts test/engine.test.ts` (from
`plugins/attractor/engine`), then full `node --test`.

## Out of scope

- `cli.ts` wiring (p2-09).
- Real-subprocess FR-5 test against the built CLI (p2-10).
- `core/edge-select.ts` itself (pre-existing, unmodified).

## Dependencies

- **p2-06** — `defaultChannels`/`preflightHumanGates`.
- **p2-07** — `HumanGateHandler`.

## Implementation notes

**A third test broke, not just the two the architecture named.** `lint.test.ts`'s "HITL-003
co-fires with HAND-001 without interference, since Handler.HUMAN is still unregistered" had the
same stale premise as the two documented breaks — its own name said why. Repointed: dropped the
now-false `HAND-001` assertion, kept the real one (HITL-003 fires), renamed the test. A reminder
that even a thorough architecture/QA/critic pass can miss an incidental co-firing assertion buried
in an unrelated rule's test; implementation is where the last of these actually surface.

Also fixed p2-07's `buildGateContext` to call `substitute()` on the resolved label (see p2-07's
own Implementation notes) — required for the new `SUBSTITUTABLE_ATTRS[Handler.HUMAN]` wiring to
be true, not just declared.

Two new integration tests added beyond the architecture's named rows: "preflight + dispatch
agreement" and "unmatched channel answer falls through to selectEdge's fallback" — both explicitly
named in the architecture's Test-strategy table but not pre-assigned to a specific story; landed
here since this is the first story with a real, dispatchable `Handler.HUMAN` to exercise them
against.

Final state: `lint.test.ts` (177 tests), `engine.test.ts`, `graph.test.ts`, `handlers-human.test.ts`
(345 combined) all green; full suite 722/720/0/2 (pass/fail/skip accounting: 720 pass, 2 skipped).
