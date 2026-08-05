---
id: harden-03
title: "Spike: confirm capture-tool discrimination for the real toolset in evidence"
status: in-progress
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

**Update — attempted for real, with a genuine and important negative result.** Using the
fresh-session technique that unblocked `harden-02`, a headless test tried to invoke the
Claude Browser tool's screenshot action directly. **Result: the tool does not exist in
headless (`claude -p`) sessions at all** — confirmed by the session's own answer ("no
Claude Browser/computer-use tool available in this environment... only unrelated tools").
This is a real, structural limit, not a config problem to work around: browser/simulator
tools are tied to the interactive app, not exposed to headless subprocesses. There is no
way to empirically fire-test them the way `harden-02`/`harden-05` were tested.

**What this story delivers instead, and why it's still trustworthy:** the discriminating
field is not a guess — it's each tool's own JSON-schema `action` parameter, read directly
from the tool definitions available in this interactive session. `mcp__Claude_Browser__computer`
takes `action`, an enum including `screenshot` (and `zoom`, described as "take a screenshot
of a specific region" — also a capture) alongside non-capture actions like `left_click`,
`scroll`, `type`. `mcp__Claude_Code_iOS_Simulator__control` takes `action` with `screenshot`
among non-capture actions like `tap`, `swipe`. **`mcp__Claude_Browser__computer` is also
the exact tool named in the real elba-dreaming transcript evidence** this whole mechanism
was built from — not a coincidental match, the real one.

`hooks/scripts/record-invocation.js` now implements this: `CAPTURE_TOOL_ACTIONS` maps both
tool names to their capture-type actions, `captureActionFrom()` and `isGovernedToolCall()`
extend the governance filter, and 11 new unit tests (31/31 total passing) cover both tools,
both capture and non-capture actions, and the full record/no-op behavior. `hooks.json`'s
matcher was extended to include both tool names for real.

**Honestly stated limit, not hidden:** this cannot be live-fire-tested from within this
project at all right now — it needs an interactive session (not headless) with the hook
already configured *before* that session starts, which is not something achievable from
inside an already-running session (the same mid-session-doesn't-hot-reload constraint
`harden-02` found, compounded by headless mode's own tool restriction). The logic is real,
tested against the tools' own real contracts, and reused the identical governance/whitelist
pattern already live-verified for Skill/Agent calls — but the specific claim "this fires
correctly for a real screenshot in a real interactive session" remains unconfirmed by
direct observation. Also environment-dependent by design: a project using a different
capture tool (Playwright MCP, etc.) needs its own tool name added the same way.
