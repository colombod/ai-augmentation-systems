# Stories: delivery plugin self-hardening (epic `harden`)

> Phase 10 artifact. Decomposed from `roadmap.md`'s five MVP phases (0, 1, 1b, 2, 3).
> All 7 stories cover `FR-1`–`FR-12` from `prd.md`. `FR-13`–`FR-16` are deferred to Stage 2,
> out of scope for this epic — see `roadmap.md`'s "Does executing this deliver the goal?"

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [harden-01](harden-01-rubric-citation-slot.md) | Add a citable rule-ID column to the design-system template | 0 | FR-10 | — | **done** |
| [harden-02](harden-02-spike-invocation-reliability.md) | Spike: confirm hook firing reliability, field names, crash isolation | 1 | — | — | in-progress |
| [harden-03](harden-03-spike-capture-tool-discrimination.md) | Spike: confirm capture-tool discrimination for the real toolset in evidence | 1 | — | — | draft |
| [harden-04](harden-04-evidence-only-marker.md) | Flag stages backed entirely by unconfirmed evidence | 1b | FR-5–FR-8 | — | **done** |
| [harden-05](harden-05-invocation-ledger.md) | Record real skill invocations to a durable, per-session ledger | 2 | FR-1–FR-3 | harden-02 | in-progress |
| [harden-06](harden-06-status-invocation-reporting.md) | Report invoked, not-invoked, and untraceable per governed artifact | 2 | FR-1, FR-2, FR-4 | harden-05 | in-progress |
| [harden-07](harden-07-verification-channel-rubric-gate.md) | Require a real render and an honest rubric citation for UI verdicts | 3 | FR-9–FR-12 | harden-05, harden-03, harden-01 | in-progress |

All 7 stories passed a QA-strategist readiness check before this build started (falsifiable
acceptance criteria, right-altitude test approach, dependency chain verified, full FR
coverage confirmed), with two real gaps found and fixed at that stage: `harden-05` had an
internal contradiction about the recording script's exit-code behavior under a crash, and
`harden-07` was missing the case where a capture tool call succeeds but produces an
unusable image.

**Build status, reported honestly rather than marked done across the board:** `harden-01`
and `harden-04` are complete — no execution risk, fully verified. `harden-02`'s live test
found a real constraint (hook config doesn't hot-reload mid-session; a fresh session is
needed to complete the firing-reliability measurement) rather than faking a pass.
`harden-03` was left `draft` rather than built untested. `harden-05` and `harden-06` are
built and pass 15 real, executed unit tests each verified against realistic data, but the
live-session confirmation `harden-02` couldn't complete is still open. `harden-07`'s rule
is fully written but correctly conservative rather than fully functional until `harden-03`
extends the capture-tool matcher — every UI verdict reads not-met on the channel check
until then, which is the safe direction, not a hidden defect. See each story's own
Implementation Notes for the full detail.

## Build order

```
harden-01 ─┐
harden-02 ─┼─→ harden-05 → harden-06
harden-03 ─┤        │
           └─→ harden-07 (needs harden-05, harden-03, harden-01)
harden-04  (independent — ships whenever)
```

## Not covered here

`FR-13`–`FR-16` (the self-correction gate) — Stage 2 in `prioritization.md`, defends a
persona with zero real transcript evidence. No stories exist for it yet; decomposing it is
future work, contingent on the operator-who-reads-only-the-verdict persona being confirmed
real (per `roadmap.md`'s learning milestone M4).
