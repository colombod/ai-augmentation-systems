---
id: harden-04
title: Flag stages backed entirely by unconfirmed evidence
status: done
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1b — evidence-only marker"
requirements: [FR-5, FR-6, FR-7, FR-8]
depends_on: []
size: S
---

# Flag stages backed entirely by unconfirmed evidence

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A staging decision that reads "ready" can no longer silently rest entirely on unconfirmed
guesses about users — a visible marker appears instead, so the operator scanning the
document sees it directly without reopening the persona files.

## Context

`prioritization.md`'s `Confidence` column (`observed`/`assumed`, already present in
`templates/prioritization.md`) records evidence quality per persona but nothing today
enforces it. The real elba-dreaming project shipped a staging decision as plain "ready"
while four of five backing personas were `assumed`-grade — the project's own
`personas/README.md` warned this shouldn't be trusted as a finding, and the warning was
ignored in practice. This story makes that warning structural instead of advisory.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/skills/prioritize/SKILL.md` | modify — step 3 ("Cut the stages") gains a check: if every persona backing a stage reads `assumed` in the `Confidence` column, render the evidence-only marker directly under the stage heading |
| `plugins/delivery/templates/prioritization.md` | modify — add a fixed marker slot immediately after `**Includes:**` in each stage, so the marker has a guaranteed place, not a footnote it could be buried in |

## Interfaces and contracts to honor

Reads the existing `Confidence` column (`observed`/`assumed`) already defined in
`templates/prioritization.md`'s requirement-scoring table — no new schema.

## Relevant design decisions

- None numbered — this mechanism was confirmed zero-dependency directly in
  `research.md` and `architecture.md`'s codebase-context table: the field it needs already
  exists.

## Acceptance criteria

- [ ] `FR-5` — a stage whose supporting evidence is entirely `assumed`-grade never renders
  as plain "ready"; the marker always appears.
- [ ] `FR-6` — the marker appears in `prioritization.md` itself (the document actually
  scanned for the decision), not only recoverable by separately opening persona files.
- [ ] `FR-7` — a stage backed by at least one `observed` or `reported` persona (mixed
  evidence) triggers no marker — proving the rule discriminates rather than flags
  everything.
- [ ] `FR-8` — replaying elba-dreaming's real persona set (four of five `assumed`) against
  this rule produces the marker on exactly the stage(s) backed 100% by unconfirmed
  personas, per that project's own `personas/README.md`, and on no other stage.
- [ ] The marker is re-evaluated on every read, not stamped once — if a persona's grade is
  later upgraded from `assumed` to `observed`, the next read clears the marker
  automatically.

## Test approach

**Level:** example-based / unit-equivalent — this is a deterministic prose rule applied by
the orchestrating agent, not compiled code; "test" here means fixture scenarios an
implementer or reviewer walks through by hand.
**Cases:**

| Case | Expected |
| :-- | :-- |
| All backing personas `assumed` | Marker appears |
| Mixed evidence (one `observed`, rest `assumed`) | No marker |
| Zero personas cited for a stage | Marker appears — "nothing" is stricter than "all unconfirmed," not exempt from it |
| A previously-`assumed` persona is upgraded to `observed` | Marker clears on next read, no manual re-stamp needed |
| elba-dreaming's real persona set replayed | Marker lands on exactly the stage(s) that were 100% `assumed`, none other |

**Run with:** manual walkthrough — there is no automated test runner for this plugin's
prose-rule skills; verification is running `/delivery:prioritize` against the fixture
scenarios above and inspecting the output.

## Out of scope

- Any change to how personas themselves are graded (`skills/personas/SKILL.md`) — this
  story only consumes the existing grade, does not change how it's assigned.

## Dependencies

None.

## Implementation notes

*(filled in during and after implementation)*
