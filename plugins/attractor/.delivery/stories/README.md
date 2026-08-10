# Story index — plugins/attractor

> Produced by `/delivery:stories`, decomposing `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/roadmap.md`'s
> Phase 1. Roadmap: `../roadmap.md` · PRD: `../prd.md` · Architecture: `../architecture.md`
> No `.delivery/glossary.md` exists yet for this project; stories below reuse the two terms
> the roadmap already proposed (**self-report gap**, **direct predecessor**) rather than
> coining synonyms. No new term was needed for Phase 1.

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

## Next

`/delivery:sprint` to scope p1-01 into an implementation wave. Phases 2–6 remain "named, not
planned" per the roadmap — each is blocked on an architecture pass or an open product/scope
question, not on story decomposition; do not run `/delivery:stories` against them until their
roadmap entries carry a real work-item table the way Phase 1's does.
