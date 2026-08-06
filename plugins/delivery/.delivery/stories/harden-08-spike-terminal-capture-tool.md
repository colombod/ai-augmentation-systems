---
id: harden-08
title: "Spike: confirm whether a real terminal-visual-capture tool exists in this environment"
status: draft
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — verification channel generalization (CLI/TUI)"
requirements: [FR-19]
depends_on: []
size: S
---

# Spike: confirm whether a real terminal-visual-capture tool exists in this environment

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A concrete, checked answer to whether any tool available in a real Claude Code session can
produce a genuine visual capture of a rendered terminal (color, alignment, layout,
animation) — the channel `FR-19` requires for a TUI acceptance verdict.

## Context

`prd.md`'s `S-5` generalizes the verification-channel rule (`harden-07`'s original GUI-only
mechanism) to CLI and TUI surfaces. The CLI half needs no new tool — a real process
invocation with observed output is already how any agent runs a command. The TUI half is
different: `architecture.md`'s Mechanism 3 extension already found that
`mcp__terminal__read_terminal`, the one terminal-reading tool confirmed present in this
environment, explicitly strips ANSI codes — a text-level read, not a visual one, and
therefore not sufficient by itself. `mcp__computer-use__screenshot` is named as a plausible
candidate (a desktop screenshot that happens to include a terminal panel's real rendered
pixels), but this is unconfirmed — the same epistemic state Spike 4 started in for the
browser tool before `harden-03` confirmed it for real. This spike closes that gap the same
way.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/.delivery/architecture.md` | modify — record Spike 6's findings in the Spikes table, matching the existing pattern for Spikes 1–5 |

## Interfaces and contracts to honor

None — this produces a finding, not code. Whatever tool (if any) is confirmed, its actual
capability and limits get recorded from direct observation, not assumed from its name or
description alone.

## Relevant design decisions

- **`architecture.md`'s Mechanism 3 extension** — this spike answers the open question that
  section already names rather than assumes an answer either way.

## Acceptance criteria

- [ ] `FR-19` — a concrete determination exists: either a specific tool is confirmed able to
  produce a real visual capture of a rendered terminal (name it, and show one real capture
  as evidence), or no such tool is confirmed available in this environment today (state that
  plainly, so `qa-strategist.md`'s "unable to be checked" path has something concrete to
  point to instead of an open question).
- [ ] If a candidate tool is confirmed, at least one real example distinguishes a genuinely
  color/layout-bearing terminal capture from what `mcp__terminal__read_terminal`'s
  ANSI-stripped text would have shown for the same moment — a real side-by-side, not an
  assumption that they'd differ.
- [ ] Findings are written into `architecture.md`'s Spikes table (Spike 6's row), marked
  answered, following the same evidence standard Spikes 1–5 were held to (real, not
  synthetic-in-name-only).

## Test approach

**Level:** empirical spike, not a test — same shape as Spikes 1, 4, and 5.
**Cases:**

| Case | Expected |
| :-- | :-- |
| A real terminal panel with visibly non-default state (color output, a TUI-style layout) is captured with the candidate tool | Capture shows the real visual state, not just the text content |
| The same moment is read with `mcp__terminal__read_terminal` for comparison | Text-only, ANSI stripped — confirms the gap this spike exists to close |
| No candidate tool can be confirmed in the available environment | Recorded as a real negative result, not left silent or assumed positive |

**Run with:** manual — this needs an interactive session with a real terminal panel visible
and a capture tool available; a headless session cannot exercise this, per the same
structural limit `harden-03` found for browser tools.

## Out of scope

- Building the TUI channel enforcement itself (`harden-10`) — this story only produces the
  confirmed tool answer that depends on.
- Any capture tool not already present in this environment — no new MCP server integration
  work is in scope here.

## Dependencies

None — can run independently of `harden-09`.

## Implementation notes

Not yet run. `architecture.md`'s current Spikes table (Spike 6 row) reflects the
unconfirmed state as of 2026-08-06 — `mcp__computer-use__screenshot` named as the one
plausible candidate, not yet live-fire tested.
