---
id: harden-07
title: Require a real render and an honest rubric citation for UI acceptance verdicts
status: ready
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 3 — verification channel + rubric"
requirements: [FR-9, FR-10, FR-11, FR-12]
depends_on: [harden-05, harden-03, harden-01]
size: M
---

# Require a real render and an honest rubric citation for UI acceptance verdicts

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A UI-facing acceptance verdict can't be marked "met" from reading only the page's text or
structure, and can't claim visual correctness without citing a real rubric rule — or, where
no rubric exists yet, must say so plainly instead of passing silently.

## Context

The real elba-dreaming incident this fixes had two layers, both evidenced directly: first,
"I've been checking text/DOM output, not actually looking at the rendered page" (wrong
channel); second, after switching to a real screenshot, a basic alignment defect still
shipped because nothing checked it against any rubric — "I SHOULD NOT BE LOOKING, THIS IS
BASIC VISUAL HYGIENE AND DECENCY AND QUALITY, HOW ARE YOU NOT CHECKING THAT?" A
feature-critic review of the first architecture draft found this check must not be scoped
only to a formal `/delivery:sprint-review` run — the real incident was an ad hoc mid-session
exchange, and `sprint-review` itself barely ran in that engagement. This story places the
rule where any UI-facing verification happens, in or out of a formal review.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/qa-strategist.md` | modify — add the channel+rubric rule as a standing check this role applies to any UI-facing criterion it verifies, not scoped to one skill |
| `plugins/delivery/skills/sprint-review/SKILL.md` | modify — step 1 (verify acceptance criteria) invokes the shared rule from `qa-strategist.md` rather than defining its own copy |
| `plugins/delivery/templates/sprint-review.md` | modify — criteria table gains `Channel` and `Rubric rule` columns |
| `plugins/delivery/templates/design-system.md` | already modified by `harden-01` — this story consumes the `Rule ID` column, does not add it |

## Interfaces and contracts to honor

Cross-checks a claimed verification channel against `harden-05`'s ledger, using `harden-03`'s
confirmed capture-tool matcher list — a claimed screenshot with no matching capture-tool
ledger entry is not taken on trust.

## Relevant design decisions

- **ADR-001** — the same ledger this story cross-checks against is the one `ADR-001`
  establishes; this story is a second consumer of it, not a new provenance mechanism.
- **Roadmap's inversion decision** — this story does **not** wait on real rubric content
  existing. It ships with the honest "no rubric exists yet" path from day one; a real
  `design-system.md`, whenever authored, gives the same check real teeth automatically.

## Acceptance criteria

- [ ] `FR-9` — a UI-facing verdict states its verification channel, checked against
  `harden-05`'s ledger the same way `harden-06` checks invocation — a stated screenshot with
  no matching capture-tool ledger entry is recorded not-met, not taken on trust. A verdict
  built solely on a text-only/DOM read is also recorded not-met.
- [ ] `FR-10` — a verdict cannot be marked "met" for a visual criterion without citing a
  specific `Rule ID` (per `harden-01`'s template column) from an existing `design-system.md`.
- [ ] `FR-11` — if no `design-system.md` exists for the project at verdict time, visual
  criteria are stated as unable to be checked — never silently marked met, never silently
  dropped from the report.
- [ ] `FR-12` — replaying the real elba-dreaming screenshot against a rubric containing the
  actual alignment rule that caused the defect (`align-items: end` anchoring two fields to a
  shared bottom edge, thrown off by uneven caption height) produces a not-met verdict citing
  that rule.
- [ ] The rule applies whether or not `/delivery:sprint-review` was formally invoked — an ad
  hoc UI-quality check by `qa-strategist` follows the identical rule, not a lighter one.
- [ ] A capture tool call that resolves successfully (so it appears invoked in the ledger)
  but produces an unreadable, blank, or otherwise unusable image is **not** treated as a
  satisfied channel requirement just because the ledger shows a real attempt — the ledger
  proves the attempt happened, not that its result was usable. This case is not
  automatable (per the "honest limit" below); `qa-strategist` must actually look at the
  capture and can still mark not-met on a bad one.

## Test approach

**Level:** integration for the channel cross-check (depends on `harden-05`'s ledger and
`harden-03`'s matcher, so it cannot be meaningfully unit-tested ahead of those); example-based
for the rubric-citation and no-rubric-honesty paths.
**Cases:**

| Case | Expected |
| :-- | :-- |
| Real screenshot in ledger, verdict cites a matching `Rule ID`, rule satisfied | Met |
| Real screenshot in ledger, cited rule violated | Not met, rule cited in the verdict |
| Claimed screenshot, no matching ledger entry | Not met — claim not taken on trust |
| Text-only/DOM read only, no screenshot claimed | Not met |
| No `design-system.md` exists for the project | Verdict states "unable to be checked," not silently passed or dropped |
| elba-dreaming's real screenshot + real alignment rule, replayed | Not-met verdict citing that specific rule |
| Ad hoc mid-session UI check, no formal `sprint-review` invoked | Same rule applies as a formal review would apply |
| Capture tool call succeeds (real ledger entry) but the resulting image is blank/corrupt | Not automatically "met" — `qa-strategist` inspects the actual capture and can still mark not-met; the ledger entry alone is not sufficient |

**Run with:** no automated test runner exists for this plugin's skill logic; verification is
walking the fixture cases above through `qa-strategist`'s described behavior and inspecting
the resulting verdict text. The elba-dreaming replay case is the closest thing to an
end-to-end test this story has.

## Out of scope

- Automating the *semantic* judgment of whether a screenshot actually matches a cited rule —
  `architecture.md`'s own "honest limit" section: no tool found in research fuses rule-based
  checking with vision-model scoring for first-render defects. This story makes the claim
  checkable and citation-anchored, not fully automated.
- Authoring real `design-system.md` content — external, design-lead work, not gated on by
  this story per the roadmap's inversion decision.

## Dependencies

- `harden-05` (ledger must exist to cross-check channel claims against).
- `harden-03` (capture-tool matcher list must be confirmed).
- `harden-01` (the `Rule ID` column this story cites must already exist in the template).

## Implementation notes

*(filled in during and after implementation)*
