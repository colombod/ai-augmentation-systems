---
id: harden-03
title: "Spike: confirm capture-tool discrimination for the real toolset in evidence"
status: ready
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — foundational spikes"
requirements: []
depends_on: []
size: S
---

# Spike: confirm capture-tool discrimination for the real toolset in evidence

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A concrete, checkable list of which real tool calls count as "a real render capture" for the
purpose of verifying a UI acceptance claim — and confirmation that a hook can actually tell
a screenshot action apart from other actions on the same multi-purpose tool.

## Context

`architecture.md`'s Mechanism 3 (`harden-07`) needs to cross-check a claimed verification
channel against the invocation ledger — but only screenshot-type actions should count as
"a real render," not every call to a browser or simulator tool. This spike answers that
question concretely, scoped to the toolset actually seen in evidence (the elba-dreaming
session), not a general taxonomy — matching the PRD's own non-goal against broadening
evidence before the narrow version is proven.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/scripts/probe-invocation.js` | modify — extend the probe from `harden-02` to also capture calls to browser/simulator screenshot-taking tools |
| `plugins/delivery/.delivery/architecture.md` | modify — record Spike 4's findings in the existing spike table |

## Interfaces and contracts to honor

Whatever the real `tool_input` shape turns out to be for a screenshot action, per the
probe's captured output — not assumed in advance.

## Relevant design decisions

- **ADR-001** — indirectly: this spike determines what the Mechanism 3 hook matcher list
  actually needs to contain.

## Acceptance criteria

- [ ] A concrete list of tool names used for real render capture in the elba-dreaming
  session's evidence (e.g. browser screenshot actions, simulator screenshot actions) is
  documented, with each tool's actual name as it appears in a real `tool_input` payload.
- [ ] For at least one multi-purpose tool that can both take a screenshot and do something
  else (e.g. a browser-control tool used for both `screenshot` and `navigate` actions), the
  probe confirms a hook can distinguish the two from `tool_input` alone — a real captured
  example, not an assumption.
- [ ] Findings are written into `architecture.md`'s spike table (Spike 4's row), marked
  answered.

## Test approach

**Level:** empirical spike, not a test.
**Cases:**

| Case | Expected |
| :-- | :-- |
| A real screenshot action fires | Captured payload distinguishes it from non-screenshot actions on the same tool |
| A non-screenshot action on the same tool fires | Not misclassified as a capture |

**Run with:** manual — same real-session approach as `harden-02`; can share the same probe
session for efficiency, per `roadmap.md`.

## Out of scope

- Building the real Mechanism 3 matcher (`harden-07`) — this story only produces the
  confirmed tool-name list it depends on.
- A general taxonomy of capture tools beyond what's in evidence — explicitly deferred, per
  the PRD's non-goal.

## Dependencies

None technically, though sharing a probe session with `harden-02` is efficient.

## Implementation notes

*(filled in during and after implementation)*
