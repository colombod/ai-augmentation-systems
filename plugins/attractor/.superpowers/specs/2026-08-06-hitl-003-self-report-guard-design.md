# HITL-003: self-report guard for the agent human-gate channel — Design

**Date:** 2026-08-06
**Status:** Approved design, handed off from `.delivery/sprints/1-hitl-003-self-report-guard.md` (story `p1-01`)
**Source of truth:** `plugins/attractor/.delivery/stories/p1-01-hitl-003-self-report-guard.md` — this document restructures that story's already-verified content into `writing-plans`' expected shape. Where the two differ, the story governs.

---

## Problem and users

The attractor engine's planned `agent` human-gate channel lets an isolated `claude -p`
process answer a blocked pipeline gate on a human's behalf, reading a graph-author-declared
allowlist of context keys (`human.context=`). A prior multi-lens architectural review
(`.superpowers/carry-forward.md`, Plan 4) found a gap: nothing stops an author from setting
`human.context="worker.summary"` where `worker.summary` was written by the very node the
gate exists to check — a fresh, isolated agent can still end up rubber-stamping a self-report,
because "fresh session" and "evidence independent of the thing being checked" are different
guarantees, and only the first is currently secured. This violates
`plugins/attractor/AGENTS.md`'s doctrine: "verification inside the context that produced the
evidence is not verification."

**User:** P-2 (the Operator) — authors or runs pipelines with human gates and needs the
engine to catch this authoring mistake before the `agent` channel can be misused, not
discover it after a bad approval ships.

**This slice does not implement the `agent` channel itself** — `Handler.HUMAN` remains
unregistered, no runtime consumes these attributes yet. This is a static, lint-time guard
that fires whether or not the channel exists, matching this project's own precedent
(`HITL-001` already lints `human.default_choice` today despite `Handler.HUMAN` being
unregistered).

## Architecture

One new lint rule, `HITL-003` (WARNING severity), added to the existing flat
`lint(graph: Graph): Diagnostic[]` function in `plugins/attractor/engine/src/dot/lint.ts`
(currently ~664 lines, one `diags` array, no early return on ERROR). No new module, no new
CLI verb, no new dependency, no persisted-format change. One new pure-graph-shape helper,
`directPredecessor`, exported from `plugins/attractor/engine/src/dot/graph.ts` alongside the
existing `outgoingEdges` export.

The rule fires when **all four** hold, checked in the per-node loop `lint()` already runs:
1. `node.handler === Handler.HUMAN` (resolved handler, honoring a `type=` override — same
   precedent as `HITL-001`/`HAND-001`/`HITL-002`).
2. `node.attrs['human.channel']`, split on `,` and trimmed per token, includes the exact
   token `"agent"` — **token equality after split, not a substring match on the raw
   string**. (Guards against a channel literally named `"agentic_reviewer"` false-firing.)
3. `node.attrs['human.context']`, trimmed, is non-empty.
4. `directPredecessor(graph, node.id)?.handler === Handler.CODERGEN`.

`directPredecessor` returns the node with the single edge into `nodeId`, or `null` for
in-degree 0 or ≥2 — condition-agnostic (counts every incoming edge regardless of its own
`condition` attribute; do not filter by failure-route status the way `GATE-001` does for its
own, different purpose).

**Why CODERGEN-only, not any predecessor whose output matches (the scope decision this
design locks in):** `handlers/box.ts`'s `BoxHandler.execute` merges `outcome.contextUpdates`
into context unconditionally, before any success/failure branch. `handlers/tool.ts`'s
`ToolHandler.execute` (lines 139–151) writes `tool.last_line`/`tool.output` **only when
`result.code === 0`** — on failure it writes nothing. A condition-free static check can prove
a `CODERGEN` (box/LLM) predecessor wrote *something* to context; it cannot prove a `TOOL`
predecessor did, because that write is conditional on a runtime exit code lint can't see.
`Handler.TOOL` was considered and rejected as a "structurally-provable" predecessor kind for
exactly this reason — including it would produce a real false positive on the most natural
topology this feature exists to catch ("tool fails → escalate to a human/agent gate").

**Why this doesn't check *which* key was written:** box/CODERGEN outputs are arbitrary
strings decided by the model at runtime (`INFERRED_OUTPUTS_BY_HANDLER[Handler.CODERGEN]` is
deliberately `[]` in `graph.ts` for this reason) — there is nothing honest to cross-reference
`human.context=`'s key name against at lint time. The rule fires on any non-empty
`human.context=` once the two structural facts (in-degree 1, predecessor is `CODERGEN`) hold.

## Components

| Component | File | Change |
| :-- | :-- | :-- |
| `directPredecessor` helper | `engine/src/dot/graph.ts` | New export, ~5 lines, mirrors the existing `graph.edges.filter((e) => e.to === nodeId)` idiom already used inline by `GATE-001` |
| `HITL-003` rule block | `engine/src/dot/lint.ts` | New block in the per-node loop, ~50–80 lines, placed near `HAND-001` (lint.ts:513-528) and `HITL-001`'s `node.handler === Handler.HUMAN` check (lint.ts:461) |
| ADR-006 | `plugins/attractor/.delivery/decisions/ADR-006-hitl-003-self-report-guard.md` | New — the CODERGEN-only decision (with the `box.ts`/`tool.ts` citations above), a `## Residual risk` section (multi-hop chains; `Handler.TOOL` predecessors with or without `outputs=` — both explicitly out of scope, tracked, not silently dropped), and the FR-12 embedded-`Engine` visibility caveat. This ADR is also the fix for `prd.md`'s previously-dead "design doc's Residual Risk section" citation — it becomes that document. |
| Fixtures + tests | `engine/test/lint.test.ts` | 16 new tests near the `HAND-001` block (from line ~1370), using the existing `codes()` helper and inline `digraph G {...}` fixture idiom |
| Docs | `plugins/attractor/README.md` | Add `HITL-003` to `## Lint rules` (README.md:226-245) and a caveat in `### What the linter can and cannot see` (README.md:194-224) — states the WARNING is not visible on a direct-embed `Engine` path today (Open Question 7/FR-12, not resolved by this rule) |

## Data flow

`lint(graph)` is pure, invocation-independent static analysis over an already-parsed
`Graph` — no running engine, no backend, no subprocess. Input: the `Graph` object (nodes,
edges, each node's resolved `handler` and raw `attrs`). Output: appended `Diagnostic` objects
in the same flat array every other rule (`HITL-001`, `HAND-001`, `GATE-001`, `DATA-001`, …)
already writes to. The CLI's existing pre-run `reportDiagnostics` path prints every severity
including WARNING to stderr before a run starts (`cli.ts:178-184`); a direct `new Engine(...)`
embed does not currently see WARNING-severity diagnostics at all (`Engine.run()` only checks
`hasErrors()`, per ADR-004) — this is a pre-existing gap affecting every WARNING-level rule,
not new to `HITL-003`, and this slice states it rather than fixing it (Open Question 7/FR-12).

## Error handling

`HITL-003` is WARNING severity and must never itself report at ERROR severity — every
diagnostic `HITL-003` produces on a firing fixture must be `Severity.WARNING` (test B1). This
is *not* the same as asserting `hasErrors(lint(graph)) === false` on that fixture: `HAND-001`
(ERROR) always co-fires on any real `Handler.HUMAN` node today, since the handler is still in
`UNREGISTERED_HANDLER_KINDS`, so a graph-wide `hasErrors()` check on a P1-shaped fixture is
unsatisfiable — it is always `true`, never `false`, on a fixture where `HITL-003` actually
fires. B1 instead asserts the per-diagnostic form of the advisory-only guarantee: `HITL-003`'s
own diagnostics never carry
ERROR severity, regardless of what else co-fires on the same node. It coexists with
`HAND-001`, which today fires as an ERROR on the same node whenever a real human-gate fixture
is built (`Handler.HUMAN` is still in `UNREGISTERED_HANDLER_KINDS`) — both diagnostics must
appear without suppressing each other (test B2). This mirrors `HITL-001`'s own already-accepted
pattern of linting a human-gate node's attributes while the handler itself is unregistered.

## Testing

**Level:** unit only, in `plugins/attractor/engine/test/lint.test.ts`, same idiom as
`HAND-001`/`DATA-001`/`GATE-001`. No integration or e2e test — `lint()` needs no runtime
handler.

**Exact commands** (from `plugins/attractor/engine`):
- Targeted, during TDD: `node --test test/lint.test.ts`
- Full regression, before calling the story done: `node --test`
- Baseline today (re-verified 2026-08-06): unit file 88/88 passing; full suite 487 tests,
  486 passing, 1 intentionally skipped, 0 failing. This shape must still hold after.

**TDD sequencing (strict, not batched):**
1. Run `node --test test/lint.test.ts` once, green, to lock the FR-7 regression baseline
   ("`HITL-001`'s existing test cases pass unmodified").
2. Write fixture **P1** red, then the minimal `HITL-003` rule body green. It will also
   wrongly fire on N1–N8's shapes at this point — expected and correct for this step.
3. Add **N1 through N8** one at a time, each written red, each followed by exactly the one
   guard clause that turns it green, re-running `node --test test/lint.test.ts` after every
   single addition — never batch two guard clauses before re-running.
4. Add **B1/B2** once the rule is structurally complete.
5. Add **P2–P5** and **B3** last, as the polish/documentation pass.
6. Run the **full suite** (no path argument) before calling the story done, to catch any
   cross-file regression (an existing fixture elsewhere that happens to newly match
   `HITL-003`'s shape).

**Coverage matrix (16 cases — full detail, including exact fixture shapes and rationale for
each disqualifier, lives in `p1-01`'s Test approach section; do not re-derive, read it
directly before writing fixtures):**

| # | Case | Expected |
| :-- | :-- | :-- |
| P1 | `box[CODERGEN] -> gate[HUMAN, human.channel="agent", human.context="k"]`, box the sole predecessor | fires; WARNING; `node:"gate"`; names `box` and `"agent"` |
| P2 | `human.channel="human,agent"` (agent not first hop) | fires |
| P3 | Gate via `type=` override on a non-`hexagon` shape | fires |
| P4 | Predecessor via `type="codergen"` on a non-`box` shape | fires |
| P5 | Two independent qualifying gates in one graph | 2 diagnostics, one per node |
| N1 | `human.channel="human"` only | does not fire |
| N2 | `human.channel="agent"`, no `human.context=` at all | does not fire |
| N3 | `human.context="   "` (whitespace only) | does not fire |
| N4 | Two direct predecessors, one `CODERGEN` | does not fire — in-degree ≠ 1 |
| N5 | Sole predecessor is `Handler.TOOL`, with and without `outputs=` | neither fires — pins CODERGEN-only |
| N6 | `CODERGEN` two hops back, through an intermediate node built to **not** itself resolve to `CODERGEN` | does not fire — multi-hop residual risk, paired with P1 |
| N7 | Sole predecessor is `Handler.START` | does not fire — in-degree 1 but not `CODERGEN` |
| N8 | `human.channel="agentic_reviewer"` | does not fire — substring-trap guard |
| B1 | Every diagnostic `HITL-003` reports on P1 (`hitl003(src).every(d => d.severity === Severity.WARNING)`) | `true` — advisory only, per-diagnostic (not `hasErrors()` graph-wide, which is unsatisfiable here since `HAND-001` (ERROR) always co-fires on a real `Handler.HUMAN` fixture) |
| B2 | `HITL-003` + `HAND-001` on one unregistered-`Handler.HUMAN` fixture | both codes present |
| B3 | Message content on P1 | names predecessor id; states advisory/non-blocking; claims no multi-hop/`TOOL` detection |

## Requirements

`FR-18` (`plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md`) — the sole requirement this slice delivers.
Acceptance criteria (falsifiable, traced to `FR-18`) live in story `p1-01`'s Acceptance
criteria section — read it directly rather than duplicating here; it is the governing list.

## Scope boundary

This stage only (`.delivery/initiatives/spec-conformance-mvp/prioritization.md` Stage 2). Explicitly excluded, do not add:

- Registering `Handler.HUMAN` or building the `human`/`agent` channels themselves (FR-5–8,
  roadmap Phase 2 — blocked on an unstarted architecture pass)
- Multi-hop self-report detection (residual risk, tracked in ADR-006)
- `Handler.TOOL` predecessor detection (rejected as unprovable at lint time)
- Resolving FR-12/Open Question 7 (embedder WARNING visibility) — state the gap, don't close it
- `SKILL.md` changes
- Any change to `HAND-001`, `HITL-001`, `HITL-002`, `GATE-001`, `DATA-001`, `DATA-002`

## Global constraints

- Runtime: Node ≥ 24, native TypeScript type stripping, no build step for tests (`AGENTS.md`)
- Dependency count: 2 (`@ts-graphviz/ast`, `esbuild`) — this slice adds zero
- Test command: `cd plugins/attractor/engine && node --test` (confirmed against
  `engine/package.json`'s `"test": "node --test"` script and
  `.github/workflows/attractor-tests.yml`, which runs it identically in CI)
- One commit per story (`.delivery/sprints/1-hitl-003-self-report-guard.md`'s Working
  agreement) — incremental TDD commits within the story are fine; squash is not required
- Do not weaken a test to make it pass — report it instead

## Known risks

- **CODERGEN-scope reading is a design decision, not open prose** — locked by this document
  and ADR-006, grounded in `box.ts`/`tool.ts`'s actual write semantics. If a future FR-8
  implementation changes what "self-report" should mean, that is a new story, not a
  reinterpretation of this one.
- **Attribute names (`human.channel`, `human.context`) are prose from
  `.superpowers/specs/2026-08-05-human-gate-channels-design.md` §5, not yet consumed by any
  runtime handler.** They are a resolved, 5/5-converged architectural decision (Plan 4), not
  unstable prose — low risk of drift, but ADR-006 should cite §5 explicitly with a note to
  revisit if Phase 2's eventual implementation diverges.
- **The WARNING is invisible on a direct-embed `Engine` path** until FR-12/Open Question 7
  resolves — state this explicitly in README and ADR-006; do not let this ship read as if
  the self-report gap were uniformly closed.
