---
id: harden-09
title: Require a real process invocation, not an internal-logic call, for CLI acceptance verdicts
status: done
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — verification channel generalization (CLI/TUI)"
requirements: [FR-17, FR-18]
depends_on: [harden-11]
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

**Rescoped after `/delivery:challenge` (`R-phase5-1`, all 5 reviewers, independently) and
`harden-11`'s spike.** The original draft of this story assumed the ledger could cross-check
a claimed CLI invocation the way `harden-07` cross-checks a claimed screenshot. It can't,
today: `hooks.json`'s matcher doesn't include `Bash`, and `harden-11`'s spike found no safe,
closed-enum field on `Bash` to whitelist the way capture tools have `action`. Real evidence,
not assumption — see `harden-11`'s Implementation notes for the actual attempt and its
result.

This story now ships in two tiers, honestly split:

1. **Real and buildable now:** the standing rule itself — a CLI verdict needs a real,
   in-turn-observed process invocation, not an internal-logic call. The reviewer (or
   `qa-strategist`) sees the real tool call in the same conversation and can name it. This
   is a direct-observation claim, not a ledger-backed one — smaller than `harden-07`'s
   guarantee, but real.
2. **Explicitly still open, not silently dropped:** the ledger cross-check (proving a claim
   *after the fact*, for a reviewer who wasn't there) — blocked on `harden-11`'s unresolved
   design tradeoff (blanket `Bash` governance's noise cost vs. a narrower, not-yet-designed
   signaling mechanism). Recorded as open, the same way `FR-11`'s no-rubric case is recorded
   open rather than silently passed.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/qa-strategist.md` | modify — the CLI row of the channel table needs its own cross-check paragraph, written for real (mirroring the screenshot paragraph's shape, scoped to direct observation only, per tier 1 above) — the channel *table* already lists CLI; the enforcement *prose* underneath it does not yet, per `R-phase5-8` |
| `plugins/delivery/skills/sprint-review/SKILL.md` | modify — step 1 already delegates to `qa-strategist.md` for UI-facing criteria (`harden-07`'s wiring); confirm/extend its trigger wording so a CLI acceptance criterion routes into the same standing check, not just "rendered, visible behavior" |

## Interfaces and contracts to honor

Tier 1 only (tier 2 has no interface yet — it doesn't exist): a CLI verdict states which
real tool call it observed launching the command, with the real `stdout`/`stderr`/exit code
quoted or paraphrased in the verdict itself. No ledger schema change in this story.

## Relevant design decisions

- **`architecture.md`'s Mechanism 3 extension** — this story builds the CLI row's tier-1
  (direct-observation) half; tier 2 (ledger cross-check) stays an open item there too,
  cross-referenced to `harden-11`.
- **`harden-11`'s spike** — the reason this story is scoped in two tiers instead of one.

## Acceptance criteria

- [ ] `FR-17` — a verdict for a CLI-surfaced criterion states that the CLI surface applies,
  distinct from a GUI or TUI verdict.
- [ ] `FR-18`, tier 1 — a "met" verdict for a CLI criterion requires the reviewer to have
  directly observed a real process invocation (a real tool call that launched the actual
  command, in the same conversation) with real `stdout`/`stderr`/exit code named; a call to
  the same logic via an internal function/import, bypassing the real command boundary, is
  recorded **not met**.
- [ ] A CLI verdict backed only by a unit test of the argument-parsing or handler logic,
  with no real process launch, is recorded **not met** — unit-level coverage is real and
  useful, but it is not this claim.
- [ ] `FR-18`, tier 2 (ledger cross-check) is explicitly stated as **not yet available** in
  `qa-strategist.md`'s prose — a reviewer checking a claim they did not personally observe
  (e.g., a later `/delivery:sprint-review` pass) states this limit plainly rather than
  silently trusting the claim or silently pretending a ledger check occurred.

## Test approach

**Level:** example-based, mirroring `harden-07`'s test approach — this rule is a written
standing check, not new hook logic (tier 1 needs none; tier 2 has none to test yet).
**Cases:**

| Case | Expected |
| :-- | :-- |
| Real CLI invocation observed directly in the same conversation, output matches the criterion | Met |
| Real CLI invocation observed directly, output doesn't match the criterion | Not met |
| Verdict backed only by calling the internal handler function directly, no process launch | Not met |
| Verdict backed only by a unit test of the argument parser | Not met — real invocation is a separate claim |
| A reviewer checks a claim from a session they were not present for (no ledger to consult) | States the limit plainly — "cannot independently confirm, no cross-check available yet" — not silently trusted, not silently failed |

**Run with:** no automated test runner exists for this plugin's skill logic, same as
`harden-07` — verification is walking the fixture cases above through the described
`qa-strategist` behavior and inspecting the resulting verdict text.

## Out of scope

- The TUI channel (`harden-10`) — different evidence requirement, different dependency,
  and separately held per product-owner direction (see `roadmap.md` Phase 5).
- The ledger cross-check itself (tier 2) — genuinely undesigned, not merely undocumented;
  `harden-11` found no safe path yet. A follow-on story once that's resolved, not this one.

## Dependencies

- `harden-11` — this story's scope (two tiers, not one) is a direct consequence of that
  spike's result.

## Implementation notes

**Tier 1 built.** `agents/qa-strategist.md`'s cross-check paragraph now has real, distinct
CLI enforcement prose — split by surface (GUI/CLI/TUI) rather than one paragraph written
for GUI alone. `skills/sprint-review/SKILL.md`'s trigger wording was extended from
"rendered, visible behavior" to cover CLI real-output and TUI rendered-state criteria too,
so a CLI acceptance criterion now actually routes into the standing check during a formal
review, not just in the prose description of the rule. No hook/ledger code changed — tier 1
needed none.

**Tier 2 (ledger cross-check) stays explicitly open**, per `harden-11`'s spike result — not
silently dropped, recorded in `qa-strategist.md`'s own prose as "no cross-check available
yet" so a reviewer checking someone else's claim states that limit rather than either
trusting it blindly or implying a check occurred that didn't.

`status: done` reflects that this story's real, buildable half shipped for real — the same
honest-partial pattern this epic already used for carried debt (`D-1`/`D-2`), not a rounded-up
claim.
