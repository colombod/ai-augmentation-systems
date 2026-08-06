---
id: harden-10
title: Require a real visual capture, not an ANSI-stripped text read, for TUI acceptance verdicts
status: draft
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — verification channel generalization (CLI/TUI)"
requirements: [FR-17, FR-19]
depends_on: [harden-08]
size: S-M
---

# Require a real visual capture, not an ANSI-stripped text read, for TUI acceptance verdicts

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A TUI-facing acceptance verdict can't be marked "met" from a text read of terminal output —
it must come from a real visual capture of the rendered terminal, showing color, alignment,
and layout, or state plainly that it's unable to be checked if no such capture channel
exists.

## Context

This is the TUI counterpart to `harden-09`'s CLI story, but with a real dependency `harden-09`
doesn't have: whether a genuine visual-capture channel exists for a terminal at all is not
yet known. `architecture.md`'s Mechanism 3 extension already found that this environment's
one confirmed terminal-reading tool, `mcp__terminal__read_terminal`, explicitly strips ANSI
codes — text-level, not visual, and not sufficient alone. `harden-08` is the spike that
answers whether any real alternative exists. This story cannot specify its own build shape
correctly until that answer is in, the same relationship `harden-05` had to `harden-02`.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/qa-strategist.md` | already carries the TUI row of the channel table this wave — this story is the enforcement half |
| Wherever the channel cross-check from `harden-07`/`harden-09` lives | modify — add the TUI branch, shaped by `harden-08`'s actual finding |

## Interfaces and contracts to honor

Depends entirely on `harden-08`'s outcome:

- **If a real capture tool is confirmed:** mirrors `harden-07`'s ledger cross-check shape —
  a claimed TUI capture with no matching real capture-tool ledger entry is not taken on
  trust, same as a claimed screenshot today.
- **If no real capture tool is confirmed:** this story's scope narrows to enforcing the
  honest fallback only — every TUI-visual criterion is stated **unable to be checked**,
  the same pattern `FR-11` already established for a missing design rubric. No verdict may
  silently pass a TUI-visual criterion on a text read alone, regardless of which branch
  applies.

## Relevant design decisions

- **`architecture.md`'s Mechanism 3 extension** — the TUI row this story builds.
- **`FR-11`'s honesty pattern** — reused here rather than invented fresh, per the plugin's
  own doctrine against duplicating an existing rule under a new name.

## Acceptance criteria

- [ ] `FR-17` — a verdict for a TUI-surfaced criterion states that the TUI surface applies,
  distinct from a GUI or CLI verdict.
- [ ] `FR-19` — a "met" verdict for a TUI-visual criterion (color, alignment, layout,
  animation) requires a real visual capture; a text-only read (ANSI-stripped or not) never
  satisfies it, regardless of `harden-08`'s outcome.
- [ ] If `harden-08` confirms a real capture channel: a claimed TUI capture with no matching
  ledger entry is recorded **not met**, the same discipline `harden-07` applies to GUI
  screenshots.
- [ ] If `harden-08` finds no real capture channel: every TUI-visual criterion is recorded
  **unable to be checked** — never silently passed, never silently dropped from the report.
- [ ] A TUI criterion describing only textual content (not visual layout/color) may still be
  checked via a real text read — this rule governs the *visual* claim specifically, not
  every claim about a terminal's output.

## Test approach

**Level:** example-based; exact shape depends on `harden-08`'s answer (integration if a real
capture tool exists and needs cross-checking against a ledger, otherwise a simpler
honesty-path check mirroring `FR-11`'s existing test cases).
**Cases (capture-tool-confirmed branch):**

| Case | Expected |
| :-- | :-- |
| Real terminal capture in ledger, criterion describes visual state matching the capture | Met |
| Real terminal capture in ledger, visual state doesn't match | Not met |
| Claimed capture, no matching ledger entry | Not met |
| Text-only read of terminal output, no capture claimed | Not met for a visual criterion |

**Cases (no-capture-tool branch):**

| Case | Expected |
| :-- | :-- |
| Any TUI-visual criterion, no confirmed capture channel exists | Unable to be checked — stated plainly |
| A criterion about textual content only, no visual claim | Can still be checked via a real text read |

**Run with:** no automated test runner exists for this plugin's skill logic, same as
`harden-07`/`harden-09`.

## Out of scope

- The CLI channel (`harden-09`) — independent, already scoped separately.
- Confirming the capture tool itself — that's `harden-08`'s job, not this story's.

## Dependencies

- `harden-08` must be `done` first — this story's actual shape (which branch above applies)
  is not known until the spike answers.

## Implementation notes

Not yet built — blocked on `harden-08`.
