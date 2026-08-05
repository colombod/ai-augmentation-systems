# Stories: delivery plugin self-hardening (epic `harden`)

> Phase 10 artifact. Decomposed from `roadmap.md`'s five MVP phases (0, 1, 1b, 2, 3).
> All 7 stories cover `FR-1`–`FR-12` from `prd.md`. `FR-13`–`FR-16` are deferred to Stage 2,
> out of scope for this epic — see `roadmap.md`'s "Does executing this deliver the goal?"

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [harden-01](harden-01-rubric-citation-slot.md) | Add a citable rule-ID column to the design-system template | 0 | FR-10 | — | **done** |
| [harden-02](harden-02-spike-invocation-reliability.md) | Spike: confirm hook firing reliability, field names, crash isolation | 1 | — | — | in-progress |
| [harden-03](harden-03-spike-capture-tool-discrimination.md) | Spike: confirm capture-tool discrimination for the real toolset in evidence | 1 | — | — | in-progress |
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

**Build status, after two real rounds of live testing — reported honestly, not rounded
up.** `harden-01` and `harden-04` are complete, no execution risk. The invocation
mechanism at the center of this epic (`harden-02`, `harden-05`) was live-tested for real —
a genuine `.delivery/`-resolution bug was found and fixed (unit tests had missed it because
every fixture matched the implementation's own wrong assumption), then re-verified across
**21 real, live invocations, 21/21 correctly logged**. `harden-03`'s capture-tool logic is
real and unit-tested (31/31 tests passing across the epic) against the tools' own schemas —
confirmed empirically that headless sessions have no access to the browser tool at all, so
this one piece could not be live-fire-tested from inside this project. `harden-06` was
proven against a **real `/delivery:status` run reading a real, hook-populated ledger** —
which worked exactly as designed and, in doing so, caught four real problems in this very
build (a leftover test fixture contaminating the ledger, this exact status-inconsistency
row you're reading now, that the installed plugin is stale relative to this repo, and that
most of this epic's own planning artifacts read as "not-invoked" by its own new mechanism —
see below). `harden-07`'s rule is complete and wired to the real capture-tool matcher, one
honest gap remaining: an actual screenshot in a real interactive session has not been
directly observed producing a ledger entry. See each story's own Implementation Notes for
full detail, including exact sample sizes and what specifically remains open.

**The most important finding from this build isn't in any single story — it's what
`harden-06`'s own live test found when pointed at this project itself:** by its own new
mechanism, 8 of this project's 11 governed-artifact classes — including the PRD,
architecture, roadmap, and these very stories — read as **not-invoked**, because they were
written directly rather than through a literal `/delivery:` Skill-tool call each phase.
This is not a bug in the mechanism; it is the mechanism working exactly as designed,
holding up a mirror to this project's own process. Worth stating plainly rather than
letting a reader discover it by reading the ledger themselves.

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
