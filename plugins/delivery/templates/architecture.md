# Architecture: <feature name>

> Phase 3 artifact. Owned by Solution Architect, with QA Strategist.
> Status: draft | reviewed | agreed  ·  Last updated: <date>
> PRD: `docs/product/prd.md`

## Approach

The design in a paragraph, and the single most important decision behind it.

## Codebase context

What exists today in the areas this touches. Real paths, checked.

| Path | Role today | Change |
| :-- | :-- | :-- |
| `src/...` | | new / modified / extended / untouched |

## Component structure

How the pieces fit. Name the seams — module boundaries, dependency direction.
Specify interfaces, not interiors.

```
<diagram or structured list>
```

## Interfaces and data contracts

```
<signatures, schemas, event shapes>
```

## Meeting the non-functional requirements

Address every `NFR-n` from the PRD. If one cannot be met, say so here rather
than discovering it in load testing.

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | | | high / medium / low |

## Decisions

Consequential choices get an ADR in `docs/product/decisions/`. Summarize here.

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-001 | | |

## Spikes — what must be proven before committing

The most valuable output of this document. Each spike is a specific question
with a time box, not "investigate X".

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | | | |

## Migration and rollback

Required for any change to persisted data or public interfaces.

**Forward:**
**Back:**
**Not applicable because:** (if so)

## Test strategy

Owned by QA Strategist. Risk-based, not uniform.

| Area | Risk (likelihood × impact) | Test level | Notes |
| :-- | :-- | :-- | :-- |

**Deliberately thin coverage:** where, and why that is acceptable.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
