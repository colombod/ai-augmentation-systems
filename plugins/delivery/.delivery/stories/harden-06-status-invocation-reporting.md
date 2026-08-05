---
id: harden-06
title: Report invoked, not-invoked, and untraceable per governed artifact
status: ready
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 2 — invocation ledger"
requirements: [FR-1, FR-2, FR-4]
depends_on: [harden-05]
size: M
---

# Report invoked, not-invoked, and untraceable per governed artifact

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

Running `/delivery:status` tells the operator, per pipeline artifact, whether it traces to
a real invoked step or not — from one report, without reading raw session logs.

## Context

`harden-05` produces the raw ledger. This story is the human-facing half: cross-referencing
it against `/delivery:status`'s existing phase table so a reader gets a direct answer, not
a file to interpret themselves. This is the story that actually delivers value to the
operator who insists on spec-traceable proof — `harden-05` alone is invisible to a human.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/skills/status/SKILL.md` | modify — the "Gather" section's phase table gains an invoked/not-invoked/untraceable column, computed by reading all `.delivery/invocations/*.ndjson` files for the project and cross-referencing against the existing phase→artifact mapping |

## Interfaces and contracts to honor

Reads `harden-05`'s ledger format (whitelisted JSON lines, one per event) — no new schema on
this side, only a consumer of the existing one.

## Relevant design decisions

- **ADR-001** — this is the "reporting" half the ADR explicitly separates from
  "determination": reporting stays skill-based because a skipped report is independently
  visible the moment someone opens the ledger file directly, unlike a skipped action, which
  leaves no trace.

## Acceptance criteria

- [ ] `FR-1` — every governed artifact in `/delivery:status`'s phase table gets a stated
  invoked/not-invoked status; never blank, never a silent default either way.
- [ ] `FR-2` — an artifact is marked not-invoked whenever no matching ledger line exists for
  that phase, regardless of whether the artifact's file itself looks complete.
- [ ] `FR-4` — "not-invoked" renders as a distinct, scannable marker — not a blank cell a
  reader could mistake for "invoked" while skimming.
- [ ] An artifact later re-produced by a real invocation, after first being flagged
  not-invoked, keeps the earlier gap visible in the report's history — the fixed state does
  not silently erase it.
- [ ] If no ledger file is reachable for the session at all (e.g. `harden-05` never ran, or
  the project predates it), the report states the check could not be made — distinct from a
  confirmed absence of a matching call, per the reason-string convention in the report.
- [ ] Many governed artifacts in one long session still produce a scannable report (grouped
  or summarized), not an unreadable wall of rows.

## Test approach

**Level:** integration, fixture-driven — this is the acceptance criteria itself, per
`architecture.md`'s own test strategy; canned ledger files plus a canned governed-artifact
list, not live-session dependent (that reliability question was `harden-02`'s job).
**Cases:**

| Case | Expected |
| :-- | :-- |
| Ledger has a matching entry for every governed artifact | All report as invoked |
| Ledger missing an entry for one artifact | That artifact reports not-invoked, others unaffected |
| Ledger entry has `outcome: "error"` for an artifact | Reports not-invoked, not invoked-with-a-caveat |
| No ledger file reachable at all | Reports "could not check," not defaulted to either state |
| Retry: two ledger lines for one artifact, one error then one success | Most recent (success) is the state of record |
| An artifact previously flagged not-invoked is later re-produced with a real invocation | Report shows current state as invoked, but the history of the earlier gap remains visible |
| 50+ governed artifacts in one session | Report stays scannable — grouped or summarized, not one unreadable table |

**Run with:** no automated test runner exists for this plugin's skill logic; verification is
running `/delivery:status` against the fixture ledger files above (placed at
`.delivery/invocations/` in a scratch test project) and inspecting the rendered report.

## Out of scope

- Blocking anything based on the report — read-only reporting, matching `/delivery:status`'s
  existing "changes nothing" doctrine.
- Cross-project or cross-session aggregation beyond what one project's `.delivery/` already
  covers.

## Dependencies

- `harden-05` must be `done` first — this story has nothing to read without it.

## Implementation notes

*(filled in during and after implementation)*
