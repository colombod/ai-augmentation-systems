---
id: harden-08
title: "Spike: confirm whether a real terminal-visual-capture tool exists in this environment"
status: held
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
therefore not sufficient by itself.

**Update — real candidates identified, not yet confirmed integrated.** A web search (not
memory alone — this space moves fast) found purpose-built tools that do exactly what this
spike needs: drive a real terminal with real keystrokes and capture its real rendered
state. See `architecture.md`'s Mechanism 3 extension for the full table. Leading
candidates: [VHS](https://github.com/charmbracelet/vhs) (Charmbracelet — scripts a real
terminal session, captures real PNG/GIF of the rendered result; mature, widely used) and
[tui_mcp](https://github.com/Fabian2000/tui_mcp) (an MCP server purpose-built for this: a
real PTY + `vt100` emulator, full keyboard/mouse input, screen readout as text **or PNG**).
Neither is confirmed installed or wired into this Claude Code session — that's this spike's
actual job now: not "does anything like this exist" (it does), but "get one working here,
for real, and show a genuine capture." `mcp__computer-use__screenshot` of a visible terminal
panel remains the fallback if integrating a dedicated tool isn't practical in this pass.

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

- [ ] `FR-19` — a concrete determination exists: either a real candidate (VHS, `tui_mcp`, or
  a fallback) is confirmed working end to end in this environment, with one genuine capture
  as evidence, or none can be integrated in this pass — state that plainly, so
  `qa-strategist.md`'s "unable to be checked" path has something concrete to point to
  instead of an open question.
- [ ] If a candidate is confirmed, at least one real example distinguishes a genuinely
  color/layout-bearing terminal capture from what `mcp__terminal__read_terminal`'s
  ANSI-stripped text would have shown for the same moment — a real side-by-side, not an
  assumption that they'd differ.
- [ ] If a candidate requires driving real keystrokes (not just capturing a static screen),
  at least one real example shows the capture reflecting a state reached by simulated typing
  — not merely a screenshot of whatever was already on screen.
- [ ] Findings are written into `architecture.md`'s Spikes table (Spike 6's row), marked
  answered, following the same evidence standard Spikes 1–5 were held to (real, not
  synthetic-in-name-only).

## Test approach

**Level:** empirical spike, not a test — same shape as Spikes 1, 4, and 5.
**Cases:**

| Case | Expected |
| :-- | :-- |
| A TUI is driven with real simulated keystrokes via a candidate tool, reaching a specific visible state | Capture shows that real reached state, not a default/idle screen |
| The same moment is read with `mcp__terminal__read_terminal` for comparison | Text-only, ANSI stripped — confirms the gap this spike exists to close |
| Integrating the leading candidate (VHS or `tui_mcp`) fails or isn't practical in this pass | Recorded as a real negative result for that candidate specifically, then the next candidate or the fallback is tried — not silently given up on |
| No candidate can be confirmed working at all | Recorded as a real negative result, not left silent or assumed positive |

**Run with:** manual — this needs an interactive session with a real terminal available and
whichever candidate tool is being evaluated actually installed/reachable; a headless session
cannot exercise this, per the same structural limit `harden-03` found for browser tools.

## Out of scope

- Building the TUI channel enforcement itself (`harden-10`) — this story only produces the
  confirmed tool answer that depends on.
- Standardizing on a final tool for every project using this plugin, or wiring it into a
  general per-project configuration mechanism — this spike confirms *one real example
  works*, matching `harden-03`'s own scope discipline against building a general taxonomy
  before the narrow case is proven.

## Dependencies

None — can run independently of `harden-09`.

## Implementation notes

**Held, 2026-08-06 — product-owner decision, not abandoned.** `/delivery:challenge`'s review
(`R-phase5-2`, `R-phase5-3`, `R-phase5-5`) found three real, blocking problems with running
this now: no downstream story anywhere needs a TUI check yet; a tool confirmed in one
session doesn't ship to other projects installing this plugin (no `.mcp.json`/`mcpServers`
registration exists); and the named fallback (`mcp__computer-use__screenshot`) is confirmed,
from this environment's own tool documentation, unable to type into a terminal at all
(Terminal apps are tier "click" — keystrokes blocked), so it can't satisfy this story's own
keystroke-driving acceptance criterion. Presented to the product owner directly: hold this
work until a real TUI need exists, rather than spend real integration effort validating a
channel nothing in evidence requires yet. **Decision: held.** The research (VHS, `tui_mcp`,
and similar candidates — see `architecture.md`'s Mechanism 3 extension) stays recorded for
whenever this is picked up again; nothing here was wasted, it just isn't being acted on now.
