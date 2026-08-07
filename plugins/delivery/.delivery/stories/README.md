# Stories: delivery plugin

> Phase 10 artifact. Two independent epics, each decomposed from its own `roadmap.md`
> section — additive, neither touches the other's stories.

## Epic: harden

> Decomposed from `roadmap.md`'s five MVP phases (0, 1, 1b, 2, 3).
> All 7 stories cover `FR-1`–`FR-12` from `prd.md`. `FR-13`–`FR-16` are deferred to Stage 2,
> out of scope for this epic — see `roadmap.md`'s "Does executing this deliver the goal?"

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [harden-01](harden-01-rubric-citation-slot.md) | Add a citable rule-ID column to the design-system template | 0 | FR-10 | — | **done** |
| [harden-02](harden-02-spike-invocation-reliability.md) | Spike: confirm hook firing reliability, field names, crash isolation | 1 | — | — | **done** |
| [harden-03](harden-03-spike-capture-tool-discrimination.md) | Spike: confirm capture-tool discrimination for the real toolset in evidence | 1 | — | — | **done** |
| [harden-04](harden-04-evidence-only-marker.md) | Flag stages backed entirely by unconfirmed evidence | 1b | FR-5–FR-8 | — | **done** |
| [harden-05](harden-05-invocation-ledger.md) | Record real skill invocations to a durable, per-session ledger | 2 | FR-1–FR-3 | harden-02 | **done** |
| [harden-06](harden-06-status-invocation-reporting.md) | Report invoked, not-invoked, and untraceable per governed artifact | 2 | FR-1, FR-2, FR-4 | harden-05 | **done** |
| [harden-07](harden-07-verification-channel-rubric-gate.md) | Require a real render and an honest rubric citation for UI verdicts | 3 | FR-9–FR-12 | harden-05, harden-03, harden-01 | **done** |

All 7 stories: **done.** All 7 passed a QA-strategist readiness check before the build
started, with two real gaps found and fixed at that stage (`harden-05`'s exit-code
contradiction, `harden-07`'s missing corrupt-capture case).

**What "done" actually rests on, in order — nothing here was rounded up.** A genuine
`.delivery/`-resolution bug was found live and fixed (unit tests had missed it because
every fixture matched the implementation's own wrong assumption). The core mechanism was
then live-tested **21/21** real invocations. A real `/delivery:status` run against a real,
hook-populated ledger worked exactly as designed and caught four real problems in this
build along the way (a leftover test fixture, a status-inconsistency row, a stale
installed-plugin version, and — most tellingly — that most of this epic's own planning
artifacts read as "not-invoked" by its own new mechanism; see below). The two gaps that
stayed open the longest — a genuine mid-run tool failure, and a real screenshot firing in
an actual interactive session — were closed last, for real, during live interactive use of
this plugin: a browser navigation to an unreachable domain left a tab broken, and the
resulting screenshot attempt was both a real failure (`PostToolUseFailure`, correctly
logged) and, on a working page moments later, a real success (`capture_action:
"screenshot"`, correctly logged). Every acceptance criterion across all 7 stories now has
a real, live-observed instance behind it. See each story's own Implementation Notes for
the exact evidence.

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

## Epic: chief-of-staff

> Decomposed from `roadmap.md`'s "Chief of Staff epic (additive)" section, Phases 5–9.
> All 10 stories trace `FR-17`–`FR-52` (minus retired `FR-23`) from `prd.md`'s MVP-1
> scenarios (S-5/S-6/S-7/S-8/S-10) — 27 of 27 requirements covered, no gaps. `FR-33`–`36`
> (S-9) and `FR-41`–`44` (S-11) are Stage-2, deferred, no stories yet — see below.

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [chief-of-staff-01](chief-of-staff-01-spike-cos1-consultation-compliance.md) | Spike: measure real chief-of-staff consultation compliance (CoS-1) | 5 | FR-17–FR-19 (thin) | — | **ready** |
| [chief-of-staff-02](chief-of-staff-02-spike-cos2-parallel-dispatch-batching.md) | Spike: confirm parallel subagent dispatch batches, not interleaves (CoS-2) | 5 | NFR-8 | chief-of-staff-01 | **ready** |
| [chief-of-staff-03](chief-of-staff-03-foundational-infrastructure.md) | Build the chief-of-staff foundational substrate — decision log, mission/queue scaffolding, FR-48 fallback | 6 | FR-48, FR-20, FR-52 | chief-of-staff-01 | **ready** |
| [chief-of-staff-04](chief-of-staff-04-s5-citation-or-nothing.md) | S-5: answer only from a citable source, or fall through | 7 | FR-17–FR-20 | chief-of-staff-03 | **ready** |
| [chief-of-staff-05](chief-of-staff-05-s6-bounce-invented-scope.md) | S-6: bounce agent-invented scope back to its originating agent | 7 | FR-21, FR-22, FR-24 | chief-of-staff-03 | **ready** |
| [chief-of-staff-06](chief-of-staff-06-s7-technical-unknown-routing.md) | S-7: route technical unknowns to a spike, never an interrupt | 7 | FR-25–FR-28, FR-50 | chief-of-staff-03 | **ready** |
| [chief-of-staff-07](chief-of-staff-07-s10-mission-capture-drift-check.md) | S-10: capture and defend the original mission | 7b | FR-37–FR-40, FR-52 | chief-of-staff-03 | **ready** |
| [chief-of-staff-08](chief-of-staff-08-s8-briefing-core.md) | S-8: assemble one ranked briefing, never fabricate a default, merge duplicates | 8 | FR-29–FR-32, FR-49 | chief-of-staff-04, -05, -06, -07 | **ready** |
| [chief-of-staff-09](chief-of-staff-09-s8-push-pause-scale.md) | S-8: push exception, pause/resume, concurrent-arrival ordering, briefing at scale | 8 | FR-45–FR-47, FR-51 | chief-of-staff-08, chief-of-staff-02 | **draft** |
| [chief-of-staff-10](chief-of-staff-10-nine-agent-rollout.md) | Roll out the "Chief of staff" pointer section to the remaining 7 consulting agents | 9 | FR-48 | chief-of-staff-08, chief-of-staff-09 | **ready** |

**9 of 10 ready. One (`chief-of-staff-09`) is honestly `draft`, not rounded up:** its
`FR-47` concurrent-arrival-ordering criterion isn't falsifiable yet — `NFR-8`'s exact
mechanism is genuinely open (owner: solution-architect) and the story's own proposed rule is
explicitly contingent on `chief-of-staff-02`'s (Spike CoS-2) real result, which hasn't run.
Every other acceptance criterion in that story is falsifiable now; only the one gated
criterion holds the whole story back from `ready`. Promotes the moment CoS-2's result lands.

**Reconciliation across the batch, done centrally after all 10 were written in parallel:**
two real architecture gaps were found independently by different story-writers and fixed in
`architecture.md` rather than worked around locally — the consultation-call interface never
specified the calling agent identifying itself (needed by `FR-22`'s "names the originating
agent" and S-6's "provenance unknown" case; found by `chief-of-staff-05`), and the briefing
queue's `Source` column omitted S-10 despite `FR-40`/`FR-49` requiring S-10-sourced and
merged-S-6+S-10 entries (found by `chief-of-staff-08`). Two smaller implementation-level
gaps were resolved locally as flagged reasoned extensions rather than architecture edits
(both in `chief-of-staff-06`): `FR-27`'s "matching spike" check must scan `.delivery/stories/`
directly, since a runtime-created spike is never a row in `architecture.md`'s
solution-architect-curated Spikes table; and the queue schema has no dedicated
`unclaimed`/`blocked-on-spike` status value, so both ride in the existing `Item` column text,
the same pattern already used for `"no-default-available."`

## Build order (chief-of-staff epic)

```
chief-of-staff-01 (CoS-1) ─┬─→ chief-of-staff-02 (CoS-2)
                            └─→ chief-of-staff-03 (infra)
                                     │
                    ┌────────────────┼────────────────┬──────────────────┐
                    ▼                ▼                ▼                  ▼
         chief-of-staff-04   chief-of-staff-05   chief-of-staff-06   chief-of-staff-07
              (S-5)               (S-6)               (S-7)          (S-10, parallel — Phase 7b)
                    └────────────────┴────────────────┴──────────────────┘
                                              ▼
                                   chief-of-staff-08 (S-8 core)
                                     │                    │
                                     ▼                    │
                          chief-of-staff-09 (S-8 ext) ←────┘ (also needs chief-of-staff-02)
                                     │
                                     ▼
                          chief-of-staff-10 (9-agent rollout)
```

## Not covered here (chief-of-staff epic)

`FR-33`–`FR-36` (S-9, learns the operator's decision pattern) and `FR-41`–`FR-44` (S-11,
keeps `AGENTS.md`/`CLAUDE.md` adequate) — Stage-2 in `prd.md`, deferred for two different
reasons (S-9 has zero data to learn from until S-5–S-8 ship; S-11 is the epic's
weakest-precedented scenario and mechanically a distinct verification capability). No
stories exist for either yet; decomposing them is future work, contingent on MVP-1
shipping and, for S-9 specifically, accumulating real logged decision-log instances.
