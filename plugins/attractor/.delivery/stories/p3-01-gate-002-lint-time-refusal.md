---
id: p3-01
title: GATE-002 — refuse a zero-goal-gate graph whose edge condition is outcome-blind on an undeclared key
status: done
epic: Phase 3 — FR-9b (founding-incident-class gap, lint-time closure)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 3
requirements: [FR-9b]
depends_on: []
size: S
---

# GATE-002 — refuse a zero-goal-gate graph whose edge condition is outcome-blind on an undeclared key

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item — resolved

Open Question 9 (FR-9a vs FR-9b) is resolved: FR-9b, not FR-9a. See
[ADR-014](../decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md), authoritative here —
not re-derived. This story implements ADR-014's own `GATE-002` design exactly as specified there;
do not redesign the trigger condition, severity, or scope mid-implementation. If the real code
turns out to disagree with anything ADR-014 asserts about it, stop and report — do not silently
adjust the design to fit.

## Goal

`attractor lint` (and `attractor run`, at the same gate) refuses, with a new ERROR-severity
diagnostic `GATE-002`, a graph that declares no `goal_gate` node and contains an edge whose
condition is satisfied whether its source node succeeds or fails — because the condition depends
on a context key nothing in the graph declares, infers, or seeds. This closes the last open half
of the founding-incident-class gap (S4): a graph shaped this way can walk an unrecovered failure
straight to a green `SUCCESS` exit today, and nothing catches it. The runtime verdict is
unchanged — this is a design-time refusal, not a behavior change.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/core/edge-select.ts` | modify — export the existing private `isConditional` (`edge-select.ts:53`), no behavior change |
| `plugins/attractor/engine/src/core/condition.ts` | modify — add and export `conditionKeys(expr: string): string[]`, extracting each `&&`-joined clause's left-hand key with the same `context.`-prefix stripping `resolveKey` already performs (`condition.ts:41-51`) |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — add the `GATE-002` block as the `else` to `GATE-001`'s own `if (gates.size > 0 && exitIds.size > 0)` guard (`lint.ts:1046`), sharing `gates`, `exitIds`, `NEVER_FAILS` already in scope |
| `plugins/attractor/engine/test/lint.test.ts` | modify — add `GATE-002` fixtures/tests near the `GATE-001` block |
| `plugins/attractor/README.md` | modify — add `GATE-002` to `## Lint rules` |

## Interfaces and contracts to honor

```ts
// core/edge-select.ts — export, no behavior change
export function isConditional(edge: Edge): boolean

// core/condition.ts — NEW
export function conditionKeys(expr: string): string[]
// Splits expr on '&&' (matching splitClauses' own grammar), and for each
// non-empty clause extracts the left-hand key exactly as resolveKey would
// resolve it (context.-prefix stripped). Order and duplicates don't matter
// to GATE-002's own use -- a Set is fine at the call site.

// dot/lint.ts — GATE-002, ERROR
// Fires once per qualifying edge (node id = the edge's SOURCE node, matching
// GATE-001's own per-route diagnostic shape) when ALL of:
//   1. gates.size === 0 (graph declares no goal_gate node anywhere)
//   2. edge.attrs.condition is defined, non-empty after trim (isConditional)
//   3. edge FROM a node whose handler is not in NEVER_FAILS (PASSTHROUGH_KINDS)
//   4. at least one clause's key (via conditionKeys) is NOT 'outcome', NOT
//      'preferred_label', NOT isEngineManagedKey, and NOT in the `supplied`
//      set DATA-001 already builds (graph.attrs keys UNION every node's
//      effectiveOutputs) -- i.e. nothing in the graph declares/infers/seeds it
//   5. evaluateCondition(edge.attrs.condition, EMPTY_CONTEXT, {status: FAIL})
//      === true AND evaluateCondition(edge.attrs.condition, EMPTY_CONTEXT,
//      {status: SUCCESS}) === true -- outcome-blind, satisfiable purely
//      because the undeclared key resolves to '' against the worst case
//   6. the edge's TARGET node can reach some node in `exits` via ordinary
//      edge reachability (plain BFS -- degenerate case of bypassesGates with
//      an empty gates set, factor out the shared traversal rather than
//      re-derive it)
```

## Relevant design decisions

- **ADR-014** (this story's own spec) — full reasoning, the exact trigger condition, severity
  justification, false-positive/hazard-shape analysis (two legitimate shapes confirmed silent, two
  hazard shapes confirmed firing), interaction with `DATA-001`/`GATE-001`, alternatives considered
  and rejected (broad zero-gate trigger, `DATA-001`-keyed trigger, WARNING severity,
  `retry_target` parity), and residual risks (partial-context false negatives on multi-clause
  conditions; `retry_target` continuation out of scope; R6 closed only within `GATE-002`'s own
  zero-gate scope) all live there, not repeated here.
- **`AGENTS.md`'s "stop and ask" doctrine** — already exercised; this story is the resolved
  outcome, not a re-litigation.

## Acceptance criteria

- [x] `FR-9b` — `GATE-002` fires (ERROR) on ADR-014's hazard shape 1 verbatim: a node with no
      `outputs=` fails, a conditional edge downstream references the undeclared key, no
      `goal_gate` anywhere, target reaches exit.
- [x] `FR-9b` — `GATE-002` fires (ERROR) on ADR-014's hazard shape 2: same as above, but the
      undeclared key appears ONLY in the edge condition, never in any node's substitutable text
      (proving this closes a gap `DATA-001` itself cannot see, per residual R6).
- [x] `FR-9b` — `GATE-002` does NOT fire on ADR-014's legitimate shape 1: a plain linear pipeline,
      every edge unconditional, no `goal_gate`.
- [x] `FR-9b` — `GATE-002` does NOT fire on ADR-014's legitimate shape 2: a declared
      `condition="outcome=fail"`/`condition="outcome=success"` recovery-route pair, no
      `goal_gate`.
- [x] `FR-9b` — `GATE-002` does NOT fire when the referenced key IS in the `supplied` set (a
      declared `outputs=`, a graph attribute, or an inferred `Handler.TOOL` output key) — even
      when nothing actually substitutes it (the declared-`outputs=` variant of hazard shape 2,
      ADR-014's own "different, narrower gap `GATE-002` does not close" case).
- [x] `FR-9b` — `GATE-002` never fires on a graph that DOES declare at least one `goal_gate` node
      (`gates.size > 0`) — `GATE-001`'s own guard territory, disjoint by construction.
- [x] `FR-9b` — **corrected against reality, not satisfied as originally worded.** Of the two named
      tests, `'I1 does not reach a reference that appears only in an edge condition'`
      (`engine/test/engine.test.ts:1540`) does keep passing unmodified, exactly as predicted —
      its `outputs=`-declared key is in `supplied`, so `GATE-002` correctly stays silent. But
      `'I1 is opt-in: an undeclared key gives no protection, and DATA-001 says so'`
      (`:1474`) genuinely does trigger `GATE-002`, as ADR-014 itself says it should (this graph
      IS the hazard shape FR-9b exists to close) — the implementer correctly stopped and reported
      this per the criterion's own instruction, rather than silently weakening anything. Resolved
      by the controller: the test's own premise (this gap is real and currently accepted) is
      exactly what this story closes, so its assertions were updated to check the new, correct
      behavior (lint refusal) instead of being left pinning an intentionally-closed gap. This is
      not the outcome the criterion predicted, but it is the correct one — see Implementation
      notes.
- [x] `node --test` (from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit only, `lint.test.ts`, same idiom as `HAND-001`/`DATA-001`/`GATE-001`
(`parseDot`/`lint`/inline `digraph G {...}` fixtures, no `Engine` needed — this is pure static
analysis). ADR-014's own four analysis shapes (two legitimate, two hazard) are the core fixture
set; add the `supplied`-key exclusion and the `gates.size > 0` disjointness case as two more.

Do NOT add an integration/runtime test for this story — FR-9b is explicit that the runtime
verdict is unchanged, and `engine.test.ts:1474`/`:1540` already cover that runtime behavior;
re-proving it here would be ceremony, not coverage. Confirm those two existing tests still pass,
do not duplicate them.

**Run with (from `plugins/attractor/engine`):** `node --test test/lint.test.ts` (targeted) or
`node --test` (full regression).

## Out of scope

- Everything ADR-014's own Residual risk section names as out of scope: partial-context
  evaluation of multi-clause conditions (a real gap, not closed here); `retry_target`/
  `fallback_retry_target`-based continuation (a different, author-declared mechanism, not
  examined by `GATE-001` or `GATE-002`); Residual R6 outside `GATE-002`'s own zero-goal-gate
  scope (a graph that DOES declare a gate elsewhere, with an unrelated vacuous condition on a
  path that never reaches it, stays uncovered by any existing rule).
- Any change to `HAND-001`, `HITL-001`, `HITL-002`, `HITL-003`, `CMD-001`, `DATA-001`, `DATA-002`,
  `GATE-001`, `PAR-001` through `PAR-005`, `RUNS-001`, `RUNS-002`.
- Any runtime code change. `core/engine.ts`, `core/edge-select.ts`'s `selectEdge` itself,
  `core/condition.ts`'s `evaluateCondition` — none of these change behavior. Only new exports and
  the new lint rule.

## Dependencies

None. ADR-014 is the only prerequisite, and it is resolved.

## Implementation notes

Shipped across three commits: `GATE-002` itself + the `Handler.CODERGEN` amendment + the 3
updated tests (`1c6618a`), on top of two earlier ADR-014 revision commits (`8bc4bff` design
amendment, `414469c` adversarial-review findings).

**Real design gap found during implementation, fixed same day.** The first implementer built
`GATE-002` exactly per ADR-014's original design, then found it wrongly refused the spec's own
canonical loop-guard idiom (`review [shape=box] -> iterate [condition=
"context.loop_state!=exhausted"]`) — correctly stopped and reported rather than weakening the
rule or the test. Root cause: a `Handler.CODERGEN` node's own output keys are arbitrary at
runtime and unknowable at lint time (the same blind spot `DATA-001` already accepts), so a
condition referencing an "undeclared" key sourced from a box node's own edge is not necessarily a
hazard. Fixed with a second exclusion on condition 3: skip when the edge's own source node is
`Handler.CODERGEN`. Re-verified this doesn't reopen the hazard shapes GATE-002 exists to catch
(their own failing node is `Handler.TOOL`, whose inferred outputs are a small fixed set, not
arbitrary).

**Three existing tests updated, not weakened.** `engine.test.ts`'s `'I1 is opt-in...'` and
`'the whole-branch review fixtures...'`, and `cli.test.ts`'s `'a run holding unresolved failures
still exits 0...'` all exercised the exact graph shape this story exists to close. Their own
premise (this gap is real and currently accepted) is now obsolete by design — updated to assert
the new, correct behavior (lint refusal) instead. A new fixture/test was added to `cli.test.ts` to
keep the general "unresolved failure via WARNING, run still exits 0" mechanism covered by a
fixture that does NOT trip `GATE-002` (a genuine `outcome=fail`/`outcome=success` discriminating
route pair), since the old fixture no longer demonstrates that path.

**Adversarial review found two real, unclosed gaps — both recorded in ADR-014, not silently
shipped.** (1) A multi-clause condition mixing one `supplied`-set clause with one unsupplied
clause defeats the rule with zero diagnostic — already anticipated in the ADR's own Residual risk
section, now confirmed exploitable with a concrete repro. (2) A `retry_target` pointing at a
trivially-succeeding node bypasses `GATE-002` entirely (it only examines edge conditions, not
`resolveRetryTarget`'s own routing) — this disproves the ADR's own original reasoning for leaving
`retry_target` out of scope ("every concrete use in this codebase dispatches a real recovery
node"), which was an unverified assumption, not a proven safe skip. Both are real, load-bearing
findings — see ADR-014's own Residual risk section for the full reasoning and repros. Fixing gap
(2) properly needs a Product Owner call, the same shape of tradeoff Decision 1 itself was: nothing
at lint time can statically distinguish a `retry_target` that does real recovery work from one
that trivially rubber-stamps success, so closing it risks reopening the exact false-positive
class Decision 2 already fought to avoid.

**Final state:** 630 tests, 628 passing, 2 correctly-skipped, 0 failing.
