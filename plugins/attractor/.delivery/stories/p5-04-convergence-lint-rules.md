<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p5-04
title: Add findConvergenceNode/findPartialReconvergence and lint rules PAR-001/PAR-002/PAR-004
status: done
epic: Phase 5 — FR-17b (parallel fan-out)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 5
requirements: [FR-17b]
depends_on: []
size: M
---

# Add findConvergenceNode/findPartialReconvergence and lint rules PAR-001/PAR-002/PAR-004

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

`attractor lint` refuses, before any run starts, the two double-dispatch/race shapes a
`Handler.PARALLEL` (`shape=component`) node can create — no discoverable **convergence node**
(PAR-001, ERROR) and partial reconvergence, where a node other than the convergence node is
reachable from two or more branch roots (PAR-004, ERROR) — and flags a fan-out that is
structurally a no-op (PAR-002, WARNING). This ships as pure static analysis, testable against
hand-built fixtures with no runtime handler behind it, the same lint-first posture HAND-001 and
HITL-003 already established in this codebase (`ADR-005`, `ADR-006`) — the design work (ADR-007)
is fully resolved and does not wait on the runtime pieces later stories build.

## Context

`Handler.PARALLEL` fans out to every outgoing edge as a **branch** (Open Question 3, resolved).
That leaves unanswered where the main pipeline resumes: not one of the component node's own
edges, but a **convergence node** — the earliest node reachable from every branch root, computed
once by static reachability, never declared by an attribute (ADR-007). Two hazards follow, both
demonstrated concretely in ADR-007's own worked examples:

- **No convergence node exists.** The component node has ≥2 outgoing edges but no common
  descendant — the run would fail loudly at execution time (a later story); PAR-001 refuses it at
  lint time instead, matching HAND-001's "refused here instead of aborting mid-run" precedent.
- **Partial reconvergence.** A node other than the selected convergence node is independently
  reachable from two or more branch roots — the "normalize" shape (F3: two of three branches pass
  through one shared step before the real convergence node) and, broadened in ADR-007's fifth-pass
  amendment, a **tied full common descendant** that lost `findConvergenceNode`'s own tie-break
  (F3's residual: `root1/root2 -> {X, Y} -> combine`, both `X` and `Y` common to every root at the
  same depth — the "diamond of diamonds" shape, ordinary, not exotic). Either shape means a real
  subprocess could run twice, or a goal-gate ledger entry gets racily overwritten by two
  independent `runBranch` calls (a later story) dispatching the same node. PAR-004 refuses both.

`Handler.PARALLEL` stays in `UNREGISTERED_HANDLER_KINDS` (`graph.ts:224-228`) until p5-08 (item
I) removes it as that story's own last line — HAND-001 keeps firing on every `component` node
this story touches, alongside whichever PAR code also fires. Fixtures must expect **both** codes
together, the same pattern HITL-003's own B2 test established for `Handler.HUMAN`.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/dot/graph.ts` | modify — add `findConvergenceNode` and `findPartialReconvergence` (pure functions, ~40–60 lines combined); do **not** touch `UNREGISTERED_HANDLER_KINDS` (p5-08's job) |
| `plugins/attractor/engine/src/dot/lint.ts` | modify — add PAR-001, PAR-002, PAR-004 blocks in the per-node loop, near HAND-001 (`lint.ts:514-528`) |
| `plugins/attractor/engine/test/lint.test.ts` | modify — fixtures/tests for all three codes, using the file's existing `codes()` helper and inline `digraph G {...}` idiom |
| `plugins/attractor/README.md` | modify — add PAR-001/PAR-002/PAR-004 to `## Lint rules` (`README.md:242-245`) |

## Interfaces and contracts to honor

```ts
// dot/graph.ts — NEW
/** Earliest node reachable from EVERY branch root (excluding the roots), by static reachability
 * over ALL outgoing edges regardless of condition truth. Shallowest common descendant wins ties
 * (tie-break itself unspecified — safe because PAR-004 refuses every graph where a tie would
 * matter). null if branches never reconverge. */
export function findConvergenceNode(graph: Graph, branchRootIds: readonly string[]): string | null

/** Node ids reachable from two or more of the given branch roots — of ANY count, including every
 * root — where reachability from each root is truncated at (does not expand past) convergenceId.
 * Excludes the roots and convergenceId itself. Empty when convergenceId is null (PAR-001 already
 * refuses that graph) or every branch's truncated reachable set is disjoint from every other's. */
export function findPartialReconvergence(
  graph: Graph, branchRootIds: readonly string[], convergenceId: string | null,
): string[]

// dot/lint.ts — new diagnostic codes, per-node loop, node.handler === Handler.PARALLEL,
// branchRootIds = outgoingEdges(graph, node.id).map(e => e.to)
// PAR-001, ERROR: >=2 outgoing edges AND findConvergenceNode(graph, branchRootIds) === null
// PAR-002, WARNING: exactly 1 outgoing edge (fan-out is a no-op, not refused, just noted)
// PAR-004, ERROR: findPartialReconvergence(graph, branchRootIds, findConvergenceNode(...)) is non-empty
```

`branchRootIds` is every outgoing edge's target from the `component` node — reuse `outgoingEdges`
(`graph.ts:131-133`), already imported by `lint.ts`. A component node with 0 outgoing edges fires
neither PAR-001 nor PAR-002 nor PAR-004 (existing `TOPO-006` already refuses a non-exit node with
no outgoing edge, so this shape is refused elsewhere, not silently unhandled here).

## Relevant design decisions

- **ADR-007 (core decision + both amendments)** is this story's whole content: branch = sub-path,
  convergence = statically-discovered common descendant, computed once and reused by lint and
  runtime (the runtime reuse is p5-05/p5-08's job, not this story's — `findConvergenceNode` is
  written once, here, for both consumers).
- **ADR-007's second amendment (fifth pass, F3 residual)** is binding, not optional: the "but not
  all" qualifier in `findPartialReconvergence`'s original wording is gone. A node reachable from
  *every* branch root that lost the tie-break is exactly as hazardous as one reachable from a
  proper subset — do not implement the narrower, pre-amendment version.
- **Accepted imprecision, stated not hidden:** both functions are condition-independent —
  reachability ignores whether a conditional edge would actually fire at runtime — the same
  conservative-lint-over-precise-runtime tradeoff `directPredecessor`/DATA-001 already accept.

## Acceptance criteria

- [ ] `FR-17b` — `findConvergenceNode`/`findPartialReconvergence` exported from `graph.ts` exactly
      as specified above; `UNREGISTERED_HANDLER_KINDS` is untouched by this story.
- [ ] `FR-17b` — PAR-001 fires ERROR only when a `component` node has ≥2 outgoing edges and no
      discoverable convergence node; a fixture with a genuine convergence node lints clean of PAR-001.
- [ ] `FR-17b` — PAR-002 fires WARNING only on exactly one outgoing edge; never co-fires with PAR-001.
- [ ] `FR-17b` — PAR-004 fires ERROR on the exact "normalize" shared-step fixture (F3) **and**
      separately on the tied-full-common-descendant fixture (`root1/root2 -> {X,Y} -> combine`,
      F3 residual) — a rule implementing only the pre-amendment ("but not all") wording must fail
      the second fixture, proving the broadening is real, not vacuous.
- [ ] `FR-17b` — every PAR-001/PAR-004 fixture also carries HAND-001 (both are ERROR-severity on
      the same unregistered `Handler.PARALLEL` node); a negative-control fixture proves PAR-002
      (WARNING) does not suppress or get suppressed by HAND-001 either.
- [ ] `FR-17b` — README's `## Lint rules` names PAR-001/PAR-002/PAR-004 with severity and firing condition.
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions.

## Test approach

**Level:** unit only, `lint.test.ts`, same idiom as HAND-001/HITL-003 — no integration test, `lint()` needs no runtime.

**Cases (the architecture's own Test-strategy rows for this item):**

| Case | Expected |
| :-- | :-- |
| `findConvergenceNode`: multi-hop convergence | returns the correct shallowest common descendant |
| `findConvergenceNode`: no convergence (branches never reconverge) | `null` |
| `findConvergenceNode`: single-branch degenerate (1 outgoing edge) | returns that edge's target if reachable from itself trivially, or per the function's own contract for one root |
| `findConvergenceNode`: convergence at the graph's real EXIT node | returns EXIT's id (no special-casing — see p5-06 for what happens to a branch that reaches EXIT *before* this point) |
| `findConvergenceNode`: convergence node == one of the branch roots itself | resolves correctly, not treated as a degenerate error |
| PAR-001: no discoverable convergence node | ERROR, co-fires with HAND-001 |
| PAR-001: real convergence node exists | no PAR-001; HAND-001 still fires alone |
| PAR-002: exactly one outgoing edge | WARNING only, no PAR-001/PAR-004 |
| PAR-004: the exact "normalize" fixture (2 of 3 branches share a step before the real convergence node) | ERROR — fails red against a pre-fix rule that only checks `findConvergenceNode() === null` |
| PAR-004: `root1/root2 -> {X,Y} -> combine` tied-descendant fixture | ERROR — fails red against the pre-broadening ("but not all") wording specifically |
| PAR-004: disjoint branches, no false positive | no PAR-004 |
| PAR-004: node genuinely downstream of the convergence node on every path | no PAR-004 (safe, dead code by construction — truncated BFS never expands past `convergenceId`) |

**Run with (from `plugins/attractor/engine`):** `node --test test/lint.test.ts` (targeted) or
`node --test` (full — baseline today: 508 tests, 507 passing, 1 skipped, 0 failing).

## Out of scope

- PAR-003 (declared-`outputs=` collision) and PAR-005 (branch reaches EXIT early) — p5-07/p5-06;
  both need runtime pieces (`BranchRunResult`/`runBranch`) this story does not build.
- Removing `Handler.PARALLEL` from `UNREGISTERED_HANDLER_KINDS` — p5-08 (item I)'s own last line.
- Any runtime consumption of `findConvergenceNode`/`findPartialReconvergence` — p5-05/p5-08 call
  these same functions later; this story only defines and lint-tests them.

## Dependencies

None. Independent of every other Phase 5 story — pure additions to `dot/graph.ts`/`dot/lint.ts`,
disjoint from p5-01/p5-02/p5-03's files. p5-06 (PAR-005) and p5-08 (item I) both depend on
`findConvergenceNode` existing here.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
