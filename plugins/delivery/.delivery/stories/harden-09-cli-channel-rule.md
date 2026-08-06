---
id: harden-09
title: Require a real process invocation, not an internal-logic call, for CLI acceptance verdicts
status: draft
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — verification channel generalization (CLI/TUI)"
requirements: [FR-17, FR-18]
depends_on: []
size: S
---

# Require a real process invocation, not an internal-logic call, for CLI acceptance verdicts

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A CLI-facing acceptance verdict can't be marked "met" from calling the same logic through an
internal function — it must come from a real process invocation with the actual
`stdout`/`stderr`/exit code observed, the same way `harden-07` already requires a real
screenshot instead of a DOM read for a GUI.

## Context

`prd.md`'s `S-5` and `agents/qa-strategist.md`'s already-generalized standing check (from
`harden-07`, extended in this same wave) both name the CLI case, but the enforcement itself
— stating which surface applies and requiring the matching channel — needs to actually be
checked, the same way `harden-07` cross-checked a claimed screenshot against the ledger.
Unlike the TUI case (`harden-08`/`harden-10`), this needs no new tool: a real command
invocation is already how any agent runs a CLI. The requirement is a test-discipline rule,
not a capability gap.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/qa-strategist.md` | already modified this wave (the channel table is in place) — this story is the enforcement/verification half, not the rule-writing half |
| `plugins/delivery/skills/status/SKILL.md` or wherever the channel cross-check is exercised | modify — extend the existing GUI-only channel cross-check pattern (`harden-07`) to recognize a CLI surface and require its matching evidence |

## Interfaces and contracts to honor

Mirrors `harden-07`'s cross-check shape: a claimed channel is checked against real evidence,
not taken on trust. For CLI, "real evidence" means the invocation ledger (`harden-05`) shows
a real tool call that actually launched the command (e.g., a real `Bash` tool call running
the built CLI binary/script), not merely a reference to the internal function it wraps.

## Relevant design decisions

- **`architecture.md`'s Mechanism 3 extension** — this story builds the CLI row of that
  table; the TUI row is `harden-10`, separately, because it depends on `harden-08`'s spike
  and this doesn't.

## Acceptance criteria

- [ ] `FR-17` — a verdict for a CLI-surfaced criterion states that the CLI surface applies,
  distinct from a GUI or TUI verdict.
- [ ] `FR-18` — a "met" verdict for a CLI criterion requires evidence of a real process
  invocation (a real tool call that launched the actual command) with observed
  `stdout`/`stderr`/exit code; a call to the same logic via an internal function/import,
  bypassing the real command boundary, is recorded **not met**.
- [ ] A CLI verdict backed only by a unit test of the argument-parsing or handler logic,
  with no real process launch, is recorded **not met** — unit-level coverage is real and
  useful, but it is not this claim.
- [ ] Where an invocation ledger exists, a claimed real CLI invocation with no matching
  ledger entry for an actual process-launching tool call is recorded **not met**, the same
  discipline `harden-07` already applies to claimed screenshots.

## Test approach

**Level:** example-based, mirroring `harden-07`'s test approach — this rule is a written
standing check plus a cross-reference, not new hook logic.
**Cases:**

| Case | Expected |
| :-- | :-- |
| Real CLI invocation, ledger shows a matching real process-launching call, output matches the criterion | Met |
| Real CLI invocation, output doesn't match the criterion | Not met |
| Verdict backed only by calling the internal handler function directly, no process launch | Not met |
| Verdict backed only by a unit test of the argument parser | Not met — real invocation is a separate claim |
| Claimed CLI run, no matching ledger entry | Not met — claim not taken on trust |

**Run with:** no automated test runner exists for this plugin's skill logic, same as
`harden-07` — verification is walking the fixture cases above through the described
`qa-strategist` behavior and inspecting the resulting verdict text.

## Out of scope

- The TUI channel (`harden-10`) — different evidence requirement, different dependency.
- Building any new tooling — this uses tool calls already available (`Bash`, or whatever
  launches the real CLI), not a new capture mechanism.

## Dependencies

None — independent of `harden-08`/`harden-10`.

## Implementation notes

Not yet built.
