# ADR-012: `FR-6`'s substitution list lives inline in `skills/handoff/SKILL.md`, not as a new artifact

**Status:** accepted
**Date:** 2026-08-13
**Deciders:** Solution Architect

## Context

`OQ-12` (`prd.md`) — `FR-6` requires every compiled check to reference only "the criterion text or a documented engine substitution list," but no such list existed anywhere in the repo. `delivery:chief-of-staff` was consulted first: it checked whether attractor's `DATA-002` lint rule (which refuses an `outputs=` declaration naming an engine-managed key) already settles this, and correctly declined — `DATA-002` governs `outputs=` ownership, a different mechanism than a general term-whitelist for compiled-check content.

## Decision

A three-category table lives directly inside `skills/handoff/SKILL.md`'s new `## Runner: attractor` section:

| Category | Source | Example |
| :-- | :-- | :-- |
| Criterion-text terms | Verbatim from the acceptance criterion | a cited file path, endpoint, function name |
| Compiler plumbing keys | `<story-id>.<criterion-id>.*`, defined by the compiler for bookkeeping, never asserted as criterion content | `.attempts`, `.result` |
| Engine-managed keys | Attractor's own documented dataflow-ledger keys, referenced only for routing | `outcome`, `tool.last_line` |

Any other `${key}` in a compiled check is a compiler defect, caught the same way `DATA-001` catches an undeclared reference — refused before the artifact is written.

## Alternatives considered

### A standalone reference file

**Why it was attractive:** separates a "rules" document from a "how-to" skill file.
**Why rejected:** the list is short (three rows) and stable; Mode A/B's own reference tables (spec-section sourcing, `writing-plans` needs) already live inline in the same file — a second file for one small table adds a lookup with no offsetting benefit.

## Consequences

**We gain:** one file to edit when the list changes; no drift between a rules file and the skill that enforces it.

**We accept:** the list's authority is scoped to `SKILL.md` itself, no independent versioning.

**We will need to revisit this if:** the list grows past what one section can hold without crowding the compilation rules around it.
