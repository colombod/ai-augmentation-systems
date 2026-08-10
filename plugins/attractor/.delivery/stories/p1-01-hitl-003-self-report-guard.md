<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

> **Budget overrun declared:** ~1330 prose words against the 1200-word hard cap. The final
> whole-branch review found a real defect in this story's original B1 acceptance criterion
> (an unsatisfiable `hasErrors()` assertion — see Implementation notes) and required both a
> correction and a factual record of what went wrong and why; cutting either back to fit the
> cap would remove the citation/grounding/reasoning the writing standard says never to cut.
> Kept whole rather than thinned further.
---
id: p1-01
title: Add HITL-003 — warn on an agent-inclusive human gate self-reporting from its direct predecessor
status: done
epic: Phase 1 — FR-18 (HITL-003 self-report guard)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 1
requirements: [FR-18]
depends_on: []
size: S
---

# Add HITL-003 — warn on an agent-inclusive human gate self-reporting from its direct predecessor

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

When a graph author writes a human-gate node whose `human.channel` includes `"agent"` and whose
`human.context=` exposes any context key, `attractor lint` — and any embedder calling `lint(graph)`
directly — emits a new WARNING diagnostic, `HITL-003`, whenever the gate's context traces to a
single, structurally-provable direct predecessor: in-degree exactly 1, resolving to
`Handler.CODERGEN`. The author sees the self-report risk (an LLM node's own free-form output may
be the "evidence" the agent channel judges) before the `agent` channel ships.

## Context

FR-18 closes one instance of the **self-report gap**: a gate whose displayed evidence traces back
to the node the gate exists to check, so approval verifies nothing independent
(`roadmap.md`, "Terms this roadmap needed"). Plan 4's reconciliation review
(`.superpowers/carry-forward.md`) names it a required follow-up before the `agent` channel ships.
`Handler.HUMAN` is still unregistered (`defaultHandlers()`, `core/engine.ts`); `agent`/
`human.channel`/`human.context` are attributes defined in
`.superpowers/specs/2026-08-05-human-gate-channels-design.md` §5, not yet wired to runtime. Not a
blocker — `HITL-001`/`HAND-001` already lint `hexagon` nodes with `Handler.HUMAN` unregistered,
and `lint()` is pure static analysis needing no running handler.

**Why one story, not five.** The roadmap's work-item table lists five items (ADR-006, a
`graph.ts` helper, the `lint.ts` rule, fixtures+tests, a doc caveat) in a hard sequencing chain —
none but the last is independently observable, and none is choosable alone. All are `S`-sized
with no PM/PO inversion found. Bundled, this stays one focused-sitting task, matching the
ADR-005/HAND-001 precedent (also one PR). ADR-006 transcribes a decision already made below, not
a new design call.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/.delivery/decisions/ADR-006-hitl-003-self-report-guard.md` | create — the CODERGEN-only decision, citations, and Residual Risk section below |
| `plugins/attractor/engine/src/dot/graph.ts` | modify — add `directPredecessor` (~5 lines), mirroring `graph.edges.filter((e) => e.to === nodeId)`, already used by GATE-001 and `outgoingEdges` (`graph.ts:131-133`) |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — add an `HITL-003` block (~50–80 lines) in the per-node loop, near `HAND-001` (`lint.ts:513-528`) and `HITL-001`'s `node.handler === Handler.HUMAN` check (`lint.ts:461`) |
| `plugins/attractor/engine/test/lint.test.ts` | modify — 16 fixtures/tests near the `HAND-001` block (from `lint.test.ts:1370`), using its `codes()` helper (`lint.test.ts:15-17`) and inline `digraph G {...}` idiom |
| `plugins/attractor/README.md` | modify — add `HITL-003` to `## Lint rules` (`README.md:226-245`) and a caveat in `### What the linter can and cannot see` (`README.md:194-224`) |

`skills/attractor/SKILL.md` (29 lines, names no code today) is out of scope — README is where
every other code is already documented.

## Interfaces and contracts to honor

```ts
// dot/lint.ts — existing, unchanged
export interface Diagnostic { code: string; severity: Severity; node?: string; message: string }
export function lint(graph: Graph): Diagnostic[]
export function hasErrors(diags: Diagnostic[]): boolean   // diags.some(d => d.severity === 'error')

// dot/graph.ts — existing, unchanged
export const Handler = {
  START: 'start', EXIT: 'exit', CODERGEN: 'codergen', TOOL: 'tool',
  CONDITIONAL: 'conditional', HUMAN: 'human', PARALLEL: 'parallel',
  FAN_IN: 'fan_in', MANAGER_LOOP: 'manager_loop',
} as const
export interface Node { id: string; attrs: Record<string, string>; handler: HandlerKind }
export interface Graph { name: string; attrs: Record<string, string>; nodes: Map<string, Node>; edges: Edge[] }
export function outgoingEdges(graph: Graph, nodeId: string): Edge[]
export function declaredOutputs(node: Node): string[]      // from outputs= attribute
export function effectiveOutputs(node: Node): string[]     // inferred ∪ declared

// dot/graph.ts — NEW, this story. Corrected during implementation (see
// Implementation notes): dedupes incoming edges by source node and excludes
// self-edges, so two edges from the SAME predecessor (or a self-loop plus
// one real predecessor) still resolve correctly. Two edges from GENUINELY
// DIFFERENT predecessor nodes still return null (Open Question 13).
export function directPredecessor(graph: Graph, nodeId: string): Node | null
// The node with the sole DISTINCT source node among edges into nodeId
// (self-edges excluded), or null for zero or ≥2 distinct sources.
// Condition-agnostic: counts every edge into nodeId regardless of its own
// `condition` attribute — unlike GATE-001's routes, do not filter by isFailureRoute.
```

`declaredOutputs`/`effectiveOutputs` are listed because both the roadmap and PRD reference this
area, but **the firing condition below consults neither** (see Verifiability, below).
`declaredOutputs` appears only in test fixture N5, to pin that a `Handler.TOOL` node's `outputs=`
does not change the verdict.

**HITL-003 fires when all four hold:**
1. `node.handler === Handler.HUMAN` (resolved, honoring `type=`, same precedent as `HAND-001`/`HITL-001`/`HITL-002`).
2. `node.attrs['human.channel']`, split on `,` and trimmed per token, includes the exact token `"agent"` — not a substring match on the raw string (N8).
3. `node.attrs['human.context']`, trimmed, is non-empty.
4. `directPredecessor(graph, node.id)?.handler === Handler.CODERGEN`.

## Relevant design decisions

- **ADR-005** is the direct precedent: a small `graph.ts` helper plus a fixture-tested `lint.ts`
  rule. Unlike `HAND-001`, HITL-003 needs no anchor test against `defaultHandlers()` —
  `directPredecessor` is pure graph-shape logic with nothing in the runtime to drift against.
- **ADR-006 (created by this story)** must record, before any fixture is written:
  - **CODERGEN-only, not any predecessor whose output matches.** `handlers/box.ts`
    (`BoxHandler.execute`) merges `outcome.contextUpdates` into context *before* any
    success/failure branching ("Context updates are merged BEFORE the gate check") — unconditional
    on outcome. `handlers/tool.ts` (`ToolHandler.execute:139-151`) writes `tool.last_line`/
    `tool.output` *only* when `result.code === 0`; on failure it writes nothing. A condition-free
    check cannot prove a `TOOL` predecessor wrote anything; it can for `CODERGEN` — the
    "structurally-provable" bar FR-18 sets.
  - **A `## Residual risk` section**, naming the two gaps FR-18's text admits and this story does
    not close: multi-hop chains, and `Handler.TOOL` predecessors with or without `outputs=`. This
    also resolves `prd.md:80,102`'s dead "design doc's Residual Risk section" citation — ADR-006
    becomes that document; no `prd.md` edit needed. Each gap gets an Open Questions row, owner
    PO/SA.
  - **The WARNING is invisible on a direct-embed `Engine` path today.** Per ADR-004,
    `Engine.run()` calls `lint()` only to check `hasErrors()` (ERROR-only); it does not expose the
    diagnostics array to the caller — not new to this rule (every WARNING code has this gap, per
    FR-12/Open Question 7) — state it, do not resolve it here.
- **Verifiability (QA Strategist, load-bearing):** "traced to a direct predecessor" pins to one
  algorithm — in-degree exactly 1 (condition-agnostic) and that predecessor resolves to
  `Handler.CODERGEN`. The rule cannot verify *which* key that predecessor wrote — box outputs are
  arbitrary — so it fires on any non-empty `human.context=` once both structural facts hold. Do
  not cross-reference key names against `declaredOutputs`/`effectiveOutputs`; unbuildable at
  design time.

## Acceptance criteria

- [x] `FR-18` — `ADR-006-hitl-003-self-report-guard.md` exists: CODERGEN-only decision with
      citations, a `## Residual risk` section, the FR-12 visibility caveat.
- [x] `FR-18` — `directPredecessor` is exported from `graph.ts`: sole predecessor at in-degree 1,
      `null` otherwise, condition-agnostic.
- [x] `FR-18` — fixture P1 produces exactly one `HITL-003` diagnostic, severity `warning`, `node`
      set to the gate id, message naming the gate, the predecessor, and `"agent"`.
- [x] `FR-18` — every diagnostic `HITL-003` reports on P1 is `Severity.WARNING` (B1) — not
      graph-wide `hasErrors(lint(graph)) === false`, which is unsatisfiable on P1 since
      `HAND-001` (ERROR) always co-fires on a real `Handler.HUMAN` fixture.
- [x] `FR-18` — none of N1–N8 fire `HITL-003`; P2–P5 all do, per the matrix below.
- [x] `FR-18` — `HITL-003`/`HAND-001` both appear on one unregistered-`Handler.HUMAN` fixture (B2);
      P1's message meets B3's content bar.
- [x] `FR-18` — `README.md` names `HITL-003`, its severity, and the FR-12 embedded-`Engine` gap.
- [x] `FR-18` — `node --test` (no path, from `engine/`) passes, zero regressions.

## Test approach

**Level:** unit only, `lint.test.ts`, same idiom as `HAND-001`/`DATA-001`/`GATE-001`. No
integration test — `lint()` needs no runtime.

**Coverage matrix — 16 tests** (QA Strategist's pass over FR-18; extend only if TDD surfaces a
real gap):

| # | Case | Expected |
| :-- | :-- | :-- |
| P1 | `box[CODERGEN] -> gate[HUMAN, human.channel="agent", human.context="k"]`, box the sole predecessor | fires; WARNING; `node:"gate"`; names `box` and `"agent"` |
| P2 | `human.channel="human,agent"` (agent not first hop) | fires |
| P3 | Gate via `type=` override on a non-`hexagon` shape | fires — keyed off resolved handler |
| P4 | Predecessor via `type="codergen"` on a non-`box` shape | fires |
| P5 | Two independent qualifying gates in one graph | 2 diagnostics, one per node |
| N1 | `human.channel="human"` only | does not fire |
| N2 | `human.channel="agent"`, no `human.context=` at all | does not fire |
| N3 | `human.context="   "` (whitespace only) | does not fire |
| N4 | Gate has two direct predecessors, one `CODERGEN` | does not fire — in-degree ≠ 1 |
| N5 | Sole predecessor is `Handler.TOOL`: (a) no `outputs=`, (b) `outputs=` matching the exposed key | neither fires — pins CODERGEN-only |
| N6 | `CODERGEN` two hops back, through an intermediate node that is the gate's real direct predecessor. Build the intermediate so it does **not** itself resolve to `CODERGEN` (e.g. `type="tool"` or a `diamond` shape) — a bare/`box`-shaped intermediate defaults to `CODERGEN` too (`graph.ts:79-88`) and would silently collapse this into P1 | does not fire — paired with P1, proves the rule inspects the direct predecessor only; named in ADR-006's Residual risk |
| N7 | Sole predecessor is `Handler.START` | does not fire — in-degree 1 but not `CODERGEN` |
| N8 | `human.channel="agentic_reviewer"` | does not fire — guards the substring trap (`CMD-001` precedent) |
| B1 | Every diagnostic `HITL-003` reports on P1 (`hitl003(src).every(d => d.severity === Severity.WARNING)`) | `true` — advisory only, per-diagnostic (graph-wide `hasErrors(lint(graph)) === false` is unsatisfiable here: `HAND-001` (ERROR) always co-fires on a real `Handler.HUMAN` fixture) |
| B2 | `HITL-003` + `HAND-001` on one unregistered-`Handler.HUMAN` fixture | both codes present |
| B3 | Message content on P1 | names predecessor id; states advisory/non-blocking; claims no multi-hop/`TOOL` detection |

**TDD sequencing** (in order, not batched): (1) run `node --test test/lint.test.ts` once, green,
to lock the baseline — re-verified today: 88/88 passing. (2) Write P1 red, then the minimal rule
body green; it will also wrongly fire on N1–N8, expected. (3) Add N1–N8 one at a time, red then
green with one guard clause each, re-running after every addition. (4) Add B1/B2 once the rule is
structurally complete. (5) Add P2–P5 and B3 last, as polish over already-correct logic. (6) Run
the full suite (`node --test`, no path) before calling this done — re-verified today: 487 tests,
486 passing, 1 intentionally skipped, 0 failing; confirm this shape still holds.

**Run with (from `plugins/attractor/engine`):** `node --test test/lint.test.ts` (targeted) or
`node --test` (full regression).

## Out of scope

- Runtime enforcement — `HITL-003` is advisory; `Handler.HUMAN` stays unregistered.
- Multi-hop chains and `Handler.TOOL` predecessors — residual, tracked in ADR-006, pinned by N5/N6.
- Resolving FR-12/Open Question 7 — this story states the visibility gap, does not close it.
- `SKILL.md` changes.
- Any change to `HAND-001`, `HITL-001`, `HITL-002`, `GATE-001`, `DATA-001`, `DATA-002`.

## Dependencies

None. First story in `plugins/attractor/.delivery/stories/`. Phase 1 has zero open product or
architecture questions; Phase 0 already ships `declaredOutputs`/`effectiveOutputs`, `Handler`,
and the `HAND-001` pattern, with no dependency on `Handler.HUMAN` being registered.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.

- **B1's original assertion was unsatisfiable — a plan defect, not an implementation
  defect.** The plan/spec/story/sprint all described B1 as asserting
  `hasErrors(lint(graph)) === false` on the P1 fixture. Unsatisfiable: `HAND-001` (ERROR)
  always co-fires on a real `Handler.HUMAN` node while the handler stays in
  `UNREGISTERED_HANDLER_KINDS`. Discovered during the first implementation attempt, and
  initially worked around by reshaping the fixture instead of the assertion — which
  incidentally dropped the separate `Handler.HUMAN` gating check from the rule body, since
  the reshaped fixture no longer exercised it. The two defects were connected, not
  independent: chasing the unsatisfiable assertion by mutating the fixture is what silently
  broke the gating check. Both were caught and fixed together in a later commit: the
  `Handler.HUMAN` gating check was restored, and B1 was corrected to its real, satisfiable
  shape — `HITL-003`'s own diagnostics are never ERROR-severity
  (`hitl003(src).every(d => d.severity === Severity.WARNING)`), the actual "advisory only"
  guarantee, rather than a graph-wide `hasErrors()` claim. The fix was the assertion shape,
  not the fixture.
