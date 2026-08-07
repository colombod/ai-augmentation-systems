# Story index — plugins/attractor

> Produced by `/delivery:stories`, decomposing `plugins/attractor/.delivery/roadmap.md`.
> Roadmap: `../roadmap.md` · PRD: `../prd.md` · Architecture: `../architecture.md` · Glossary:
> `../glossary.md`. Phase 1 stories below reuse the two terms the roadmap proposed
> (**self-report gap**, **direct predecessor**); Phase 5 stories use `../glossary.md`'s five
> terms (**branch**, **branch worktree**, **convergence node**, **join policy**, **context
> merge-back**) exactly, coining nothing new.

## Phase 1 — FR-18 (HITL-003 self-report guard)

| ID | Title | Status | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [p1-01](p1-01-hitl-003-self-report-guard.md) | Add HITL-003 — warn on an agent-inclusive human gate self-reporting from its direct predecessor | ready | FR-18 | none | S |

**Decomposition note:** the roadmap's Phase 1 work-item table lists five items (ADR-006, a
`graph.ts` predecessor helper, the `lint.ts` rule, fixtures/tests, a README caveat) bound by a
hard sequencing chain — ADR-006 must resolve the CODERGEN-vs-TOOL scope reading before any
fixture can be written, and each later item has no independent, observable behavior of its own
(an ADR alone ships no behavior; a helper alone has no caller; a rule alone has no tests). All
five are sized `S` with no PM/PO estimate inversion found. Decomposed as **one story**, not five,
because splitting inseparable steps of one sitting into separate files would misrepresent a single
unit of work as independently pickable units it is not. This mirrors the ADR-005/HAND-001
precedent already shipped in Phase 0 (also one PR for helper + rule + tests).

**Coverage check:** FR-18 is Phase 1's only requirement (per the roadmap's Requirement coverage
table) and is fully covered by p1-01. No acceptance criterion in Phase 1 is left uncovered.

## Readiness

**p1-01 — ready.** Acceptance criteria are falsifiable (each names an exact diagnostic shape,
severity, node, or file-content check); every file path was verified against this repo's actual
tree (`graph.ts`, `lint.ts`, `lint.test.ts`, `README.md`, `ADR-004`/`ADR-005`, the channels-design
spec) rather than taken from the roadmap's citations blindly; dependencies are stated (none — this
is the first story in this directory, and Phase 0 already ships everything it touches
unconditionally); a full test approach is present, including the QA Strategist's 16-case coverage
matrix and TDD sequencing, with the exact commands (`cd plugins/attractor/engine && node --test
test/lint.test.ts` and `node --test`) re-verified live against this repo today (88/88 and
486/487-passing-1-skipped respectively, before any change).

No draft stories this phase — nothing is missing an element required for readiness.

## Phase 5 — FR-17b (parallel fan-out, `Handler.PARALLEL`)

Roadmap's Phase 5 decomposes into ten dependency-ordered work items, A–J. Two are not
represented by a story below, deliberately — see **Not decomposed** at the end of this section.

| ID | Title | Status | Work item | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| [p5-01](p5-01-worktree-async-conversion.md) | Convert `run/worktree.ts` to async and prove branches no longer block each other | ready | B | FR-17b, NFR-7 | none | M |
| [p5-02](p5-02-execute-node-step-extraction.md) | Extract `Engine#executeNodeStep` as the one shared per-node step implementation | ready | C | FR-17b, NFR-1 | none | L |
| [p5-03](p5-03-backend-cwd-plumbing.md) | Plumb a per-call `cwd` through `Backend.run()` | ready | D | FR-17b, NFR-4 | none | S |
| [p5-04](p5-04-convergence-lint-rules.md) | `findConvergenceNode`/`findPartialReconvergence` + PAR-001/PAR-002/PAR-004 | ready | E | FR-17b | none | M |
| [p5-05](p5-05-runbranch-seam.md) | `HandlerCtx.runBranch` seam + `Engine#runBranch` | ready | F | FR-17b, NFR-1, NFR-4 | p5-02, p5-01 | M |
| [p5-06](p5-06-par-005-branch-exit-warning.md) | PAR-005 — branch reaches EXIT before its convergence node | ready | G | FR-17b | p5-04, p5-05 | S |
| [p5-07](p5-07-context-merge-back.md) | `mergeBranchContext` + PAR-003 | ready | H | FR-17b | p5-05, p5-01 | M |
| [p5-08](p5-08-parallel-handler-integration.md) | `ParallelHandler` registration — the integration point | **draft** | I | FR-17b, NFR-7 | p5-01, p5-03, p5-04, p5-05, p5-07 | L |

**Decomposition note.** The roadmap's own dependency analysis (Critical path, Second
prioritization pass) already establishes that seven of the ten work items (B–H) do not depend
on either of item A's open Solution Architect decisions — each maps to real, independently
testable code, so each got its own story rather than being bundled the way Phase 1's five
sub-items were (those had no independent, observable behavior of their own; B–H each do). Two
corrections from the roadmap's own review pass are load-bearing and reflected above, not just
noted: `GatedBackend` (needed by p5-01, p5-05, p5-07 for non-decorative "forced overlap" tests)
is built inside p5-01, the earliest point any story needs it, rather than deferred to an
item-J-only story; and the worktree-name-collision test ships inside p5-01 rather than waiting
behind item I.

**Not decomposed:**

- **Item A** (two Solution Architect decisions: component-node FAIL routing; `Promise.all` vs.
  `allSettled` for branch rejection) is not implementation work — it is a design ruling this
  role does not have standing to make (`AGENTS.md`/this role's own boundary: raise a design gap
  to the Solution Architect rather than inventing an approach in the story text). It is named
  explicitly as the blocker inside p5-08's own frontmatter and "Why this story is `draft`"
  section, in the same one-paragraph-each shape ADR-006(b) used for a comparable prior decision.
- **Item J** (concurrency test infrastructure) is not decomposed into its own story because most
  of it needs a real `ParallelHandler` to exercise — depends on item I, which depends on item A.
  Its five originally-listed rows land across three places rather than staying one block: (1)
  `GatedBackend` itself and the worktree-name-collision test already shipped inside p5-01, per
  the roadmap's own correction; (2) ceiling enforcement (the ADR's own Layer 1) is stated as a
  p5-08 acceptance criterion directly, since it needs only `ParallelHandler`'s own semaphore, not
  a fuller integration harness; the shared-ledger race property is substantively demonstrated
  ahead of schedule by p5-05's own "goal-gate inside a branch blocks the real exit" test (two
  concurrent `ctx.runBranch` calls racing the outer engine's real ledgers via `GatedBackend`,
  with no `ParallelHandler` needed) — a full re-proof through `ParallelHandler` itself is cheap
  once p5-08 lands, not a gap; (3) real-subprocess ceiling (Layer 3, opt-in `ATTRACTOR_LIVE=1`,
  never CI), checkpoint isolation under real `ParallelHandler` dispatch, and branch-throws
  mid-flight (blocked on item A(b) directly) are the rows still needing a dedicated story, once
  p5-08 moves off `draft`.

**Coverage check.** FR-17b is Phase 5's only requirement (roadmap's Requirement coverage table).
Every Test-strategy row the roadmap's own verification mapping assigns to items B–H is covered
by the corresponding story's acceptance criteria, including the five mutation-checked rows, the
exact-F1-reproduction row, and the two "newly mapped" gap rows (retry-target-outside-branch →
p5-05; retry/partial-completion-at-convergence, which needs a real join-policy verdict and is
therefore item I's own row, not yet coverable by a ready story). The two rows the architecture
itself marks "cannot be written yet" (component-node FAIL routing; branch-throws mid-flight) are
named as explicitly **BLOCKED** acceptance criteria inside p5-08, not silently dropped.

## Readiness — Phase 5

**p5-01 through p5-07 — ready.** Each has falsifiable acceptance criteria (exact diagnostic
codes/severities, exact interface shapes, named mutation checks), file paths and line numbers
verified live against this repo today (not trusted from the roadmap/architecture's own citations
— `engine.ts`, `worktree.ts`, `cli.ts`, `graph.ts`, `lint.ts`, `handlers/{types,box,tool,stub}.ts`,
`backend/claude.ts`, `checkpoint.ts`, `context.ts` were all re-read directly), dependencies
stated and cross-checked against each other's frontmatter, and a full test approach with the
real command (`cd plugins/attractor/engine && node --test`, baseline re-verified today: 508
tests, 507 passing, 1 skipped, 0 failing).

**p5-08 — draft, not ready.** Missing element: two Solution Architect decisions (roadmap item A),
named exactly inside the story. Everything else about it — files, interfaces, the acceptance
criteria that do not depend on A — is fully specified; only the FAIL-routing and
branch-rejection-handling criteria are blocked, and both are marked `BLOCKED` rather than guessed.

## Next

`/delivery:sprint` to scope p1-01 (Phase 1) and/or p5-01 through p5-07 (Phase 5) into an
implementation wave — p5-01 through p5-04 have no dependency on each other and can be sprinted
in parallel; p5-05 needs p5-01/p5-02 done first; p5-06/p5-07 need p5-05 done first. p5-08 cannot
be sprinted until the Solution Architect resolves roadmap item A and this index is updated to
move it to `ready`. Phases 2–4 and 6 remain "named, not planned" per the roadmap; do not run
`/delivery:stories` against them until their roadmap entries carry a real work-item table.
