# Parallel fan-out/fan-in (FR-17b) — Design

**Date:** 2026-08-07
**Status:** Approved design, handed off from `.delivery/sprints/2-parallel-fanin.md` (7 stories: `p5-01` through `p5-07`)
**Source of truth:** `plugins/attractor/.delivery/stories/p5-0{1..7}-*.md` — each is independently self-contained (real file paths, real interfaces, real acceptance criteria, real test commands, already verified live against the repo by the Delivery Lead). This document restructures their shared architecture into `writing-plans`' expected shape and sequences them into one plan. Where this document and a story disagree, **the story governs** — read the story before implementing its task, this document is orientation, not the source of truth for exact code.

**Full architecture record:** `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/architecture.md`'s `## FR-17b` section (component structure, all interfaces, two rounds of adversarial review) and ADR-007 through ADR-012 in `.delivery/decisions/`. Read these if a story's own citation needs more context — do not re-derive the design from first principles.

---

## Problem and users

`Handler.PARALLEL`/`Handler.FAN_IN` are unregistered — `Engine.run()` is a flat sequential `for` loop over one `currentId` (`engine.ts:643-1088`), no concurrency exists anywhere. FR-17b (this project's PRD) specifies parallel fan-out: every outgoing edge from a `component` node is a branch, `max_parallel=` caps concurrency (default 4), each branch isolates in its own git worktree by default, and the default join policy fails closed (FAIL when every branch fails) rather than amplifier's own fail-open default (a real inconsistency in amplifier's own two join mechanisms, deliberately not replicated — ADR-007).

**User:** P-2 (the Operator) — authors pipelines needing independent sub-tasks to run concurrently (parallel research branches, parallel code-review lenses) without hand-rolling orchestration.

**This sprint does not deliver `Handler.PARALLEL` itself** (`p5-08`, `draft`, blocked on two open Solution Architect decisions — component-node FAIL routing, and `Promise.all` vs `allSettled` for branch rejection). It delivers every prerequisite: an async `worktree.ts`, a shared per-node step implementation both the main loop and future branch execution use, `cwd` plumbing so isolation actually isolates CODERGEN nodes, the convergence-node/lint machinery, the `runBranch` seam, PAR-005, and context merge-back. `p5-08` and a follow-on sprint pick up the integration point once those two decisions land.

## Architecture

Seven independently-testable pieces, landing in dependency order:

1. **`p5-01` — async `worktree.ts`** (ADR-011). `run/worktree.ts`'s `git()` helper is `execFileSync` today — fully blocking. Composing that into a `Promise.all`-based fan-out would freeze sibling branches' subprocess I/O and abort timers. Convert `git()` and its whole call chain (`isGitRepo`, `createWorktree`, `hasUncommittedWork`, `isRegisteredWorktree`, `removeWorktree`) to `async`/`execFile`. Real blast radius: 5 call sites in `cli.ts` (237, 243, 260, 261, 338), ~29 in `worktree.test.ts`. Also adds the `GatedBackend` test double (a `StubBackend` that resolves same-tick can't force real overlap — every concurrency test downstream needs this) and the worktree branch-name-collision test.

2. **`p5-02` — `Engine#executeNodeStep` extraction** (ADR-012). Per-node step logic (retry, eager-input-check, `recordOutcome`, checkpoint writing, EXIT handling, dead-end handling) is currently inline in `run()`'s loop body. Extract it into one shared method both `run()` and the future `runBranch` call — a real refactor, not a parity-tested duplicate (explicitly rejected: "a parity test proves agreement today, not after a future one-sided edit"). Also introduces `this.stepCount` as a real shared instance field (was a loop-local `step` variable), closing an unbounded-single-branch-cycle hang risk. **Caveat:** if the still-open component-node FAIL-routing decision resolves toward "unconditional convergence-node jump," that logic can only live in `core/engine.ts` (not `handlers/parallel.ts`), which would reopen this extraction — noted in the story, not blocking it now.

3. **`p5-03` — `Backend.run()` cwd plumbing** (ADR-008). A real, previously-unknown bug found during architecture: `BoxHandler.execute` never passes `ctx.cwd` to `Backend.run()` (`box.ts:96-102`), and `Backend.run()`'s signature has no `cwd` param at all (`types.ts:32`) — `ClaudeCodeBackend` binds `cwd` once at construction. Without this fix, worktree-per-branch isolation would silently fail to isolate the dominant node kind (CODERGEN).

4. **`p5-04` — convergence + lint rules PAR-001/002/004** (ADR-007, two amendments). `findConvergenceNode(graph, branchRootIds)` — BFS-discovered earliest common descendant of every branch root, the node execution resumes at after a fan-out (not one of the component node's own edges). `findPartialReconvergence` catches a node reachable from 2+ but not all roots — including, after the fifth-pass fix, a node reachable from *all* roots that merely lost a depth-tie to become the chosen convergence node (a real double-dispatch race the first fix missed). PAR-001 (ERROR, no convergence exists), PAR-002 (WARNING, single-edge no-op), PAR-004 (ERROR, partial reconvergence) all reuse these two functions so lint and runtime can't disagree — this project's own established anti-drift pattern.

5. **`p5-05` — `runBranch` seam** (ADR-009). `HandlerCtx.runBranch`, Engine-populated, runs a bounded sub-traversal using `executeNodeStep` (from `p5-02`) against the run's own shared ledgers (`gateOutcomes`/`nodeFailures`/`failedOutputs`/`stepCount`) — not an independent nested `Engine` instance, which would silently lose those ledgers and reopen the fail-closed goal-gate hole they exist to close. A branch stops at: the precomputed convergence node, a dead end, or EXIT (treated as an ordinary dead end for that branch alone — the dangerous global EXIT-handling block, per `p5-02`'s extraction, lives nowhere `runBranch` can reach it).

6. **`p5-06` — PAR-005** (ADR-007 amendment). WARNING when a branch's reachable set can hit the graph's real EXIT node before its own convergence node. Advisory: ending one branch's own traversal early without affecting siblings is legitimate; "stop the whole pipeline from inside a branch" is a **different, still-open** capability this rule deliberately does not claim to provide (named explicitly in `roadmap.md`'s Risks table as a Product Owner scope call, not decided by this sprint).

7. **`p5-07` — context merge-back + PAR-003** (ADR-010). Each branch runs against a cloned `Context` (`context.ts:125-127` — already exists, no change needed there). `mergeBranchContext` merges each SUCCESS/PARTIAL branch's diff back into the parent `Context` in branch-declaration order (not completion order — deterministic), excluding only the 3 bare `ENGINE_MANAGED_KEYS`. Closes a real silent-data-loss bug an adversarial review found: without this, three branches all writing the same `outputs=` key would leave the convergence node reading stale/empty data with nothing failing or warning. PAR-003 (WARNING) catches *statically-declared* collisions at lint time; the runtime merge still logs a `node.parallel.context_collision` event for collisions lint can't see (inferred keys).

## Components

| Component | Story | File(s) |
| :-- | :-- | :-- |
| Async `git()` + `GatedBackend` | `p5-01` | `engine/src/run/worktree.ts`, `engine/test/worktree.test.ts`, new test-only backend double |
| `Engine#executeNodeStep` | `p5-02` | `engine/src/core/engine.ts` |
| `Backend.run()` cwd param | `p5-03` | `engine/src/handlers/{box,types}.ts`, `engine/src/backend/claude.ts` |
| `findConvergenceNode`/`findPartialReconvergence`, PAR-001/002/004 | `p5-04` | `engine/src/dot/graph.ts`, `engine/src/dot/lint.ts` |
| `HandlerCtx.runBranch` | `p5-05` | `engine/src/core/engine.ts`, `engine/src/handlers/types.ts` |
| PAR-005 | `p5-06` | `engine/src/dot/lint.ts` |
| `mergeBranchContext`, PAR-003 | `p5-07` | `engine/src/core/context.ts` or `engine/src/handlers/parallel.ts` (per story), `engine/src/dot/lint.ts` |

## Data flow

All seven pieces are additive to the existing sequential engine — nothing in this sprint changes `run()`'s observable behavior for a graph with no `component` node. `executeNodeStep` (`p5-02`) is the one seam both today's `run()` and tomorrow's `runBranch` (`p5-05`) call — a single per-node dispatch path, not two. Lint rules (`p5-04`, `p5-06`, `p5-07`'s PAR-003) all append to the same flat `Diagnostic[]` array every existing rule already writes to.

## Error handling

Every new lint rule follows this codebase's severity convention: PAR-001/PAR-004 are ERROR (structural refusal — `Engine.run()` won't start), PAR-002/PAR-003/PAR-005 are WARNING (advisory, never affect `hasErrors()`). `p5-01`'s async conversion must preserve `worktree.ts`'s existing error shapes (a named open item — `execFile` vs `execFileSync` rejection-shape parity is not yet empirically confirmed; the story's test approach covers this).

## Testing

Each story names its own exact test command and fixture matrix — read the story before implementing it. Universal contract for this sprint: `cd plugins/attractor/engine && node --test` (full suite) must stay green after every story, baseline today 508 tests / 507 passing / 1 skipped / 0 failing. Targeted loop per story uses that story's own named test file. `p5-01`'s `GatedBackend` is a shared asset later stories (`p5-05`, `p5-07`) also need for real-overlap (not same-tick) concurrency tests — do not reimplement it per-story.

## Requirements

FR-17b (`plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md`) — this sprint's sole requirement, delivered incrementally across 7 stories (full delivery, including `Handler.PARALLEL` itself, needs `p5-08` in a later sprint). NFR-1 (step cap), NFR-4 (worktree isolation), NFR-7 (concurrency ceiling) each touched by specific stories per the Components table above.

## Scope boundary

This sprint only (`.delivery/sprints/2-parallel-fanin.md`). Explicitly excluded — do not add:
- `p5-08` (`ParallelHandler` itself) and roadmap item A (the two open SA decisions) — a future sprint.
- Ranking-based fan-in (`Handler.FAN_IN`/`tripleoctagon`) — not part of FR-17b's default join policy.
- Any change to `HAND-001`, `HITL-001`, `HITL-002`, `HITL-003`, `GATE-001`, `DATA-001`, `DATA-002`, `TOPO-*`, `RUNS-*`, `CMD-*` — existing lint rules, untouched.

## Global constraints

- Runtime: Node ≥ 24, native TypeScript type stripping, no build step (`AGENTS.md`).
- Dependency count: 2 (`@ts-graphviz/ast`, `esbuild`) — this sprint adds zero.
- Test command: `cd plugins/attractor/engine && node --test` (full) / per-story targeted file.
- One commit per story, matching this project's established `subagent-driven-development` practice.
- Do not weaken a test to make it pass — report and explain instead.

## Known risks

Carried from `architecture.md`'s Risks table and `roadmap.md`'s Phase 5 Risks table — read both before treating any story as fully de-risked. Two worth flagging here specifically: (1) `p5-02`'s extraction may need reopening depending on how the still-open component-node FAIL-routing question resolves (not this sprint's call); (2) `p5-06`'s PAR-005 message must not imply "stops the whole pipeline" — that capability is a named, still-open Product Owner scope question, not something this sprint decides either way.
