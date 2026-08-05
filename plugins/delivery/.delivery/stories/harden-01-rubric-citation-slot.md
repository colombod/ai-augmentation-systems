---
id: harden-01
title: Add a citable rule-ID column to the design-system template
status: ready
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 0 — prepare the rubric's citation slot"
requirements: [FR-10]
depends_on: []
size: S
---

# Add a citable rule-ID column to the design-system template

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

Whenever a real design rubric gets authored for a project — on whatever schedule, by
whoever writes it — its rules are citable by a stable ID from day one, instead of the
citation slot being retrofitted onto an already-written document later.

## Context

`architecture.md`'s Mechanism 3 requires a UI acceptance verdict to cite a specific rubric
rule ID before it can be marked "met." An adversarial review of the roadmap caught a real
sequencing bug: if a rubric gets authored against the *current* template (no rule-ID
column) before this change ships, it has nothing stable to cite, and the citation has to be
retrofitted. This story removes that risk by making the template change a zero-dependency
first step, done before anything else in this phase.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/templates/design-system.md` | modify — add a `Rule ID` column to the component/token/accessibility tables |

## Interfaces and contracts to honor

None — this is a template edit, no code, no schema beyond the table's own columns.

## Relevant design decisions

- None directly — this story exists because a feature-critic review of the roadmap found
  the gap, not because of a numbered architecture decision.

## Acceptance criteria

- [ ] `FR-10` — `templates/design-system.md`'s component, token, and accessibility tables
  each have a `Rule ID` column, populated with a short, stable identifier scheme (e.g.
  `SPACING-1`, `A11Y-3`) documented in the template's own header comment.
- [ ] An existing `design-system.md` written under the old template (without the column)
  still reads as valid — the change is additive, not a forced rewrite.

## Test approach

**Level:** none needed — a template/documentation change, not logic.
**Cases:** N/A.
**Run with:** N/A — verify by inspecting the modified template file directly.

## Out of scope

- Authoring any real rubric content. This story only prepares the slot; a real
  `design-system.md` with real rules is separate, external work (design-lead), not part of
  this epic, per `roadmap.md`'s explicit removal of that dependency from the critical path.

## Dependencies

None.

## Implementation notes

*(filled in during and after implementation)*
