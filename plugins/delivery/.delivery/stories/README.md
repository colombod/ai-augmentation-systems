# Stories: delivery plugin

> Phase 10 artifact. Two independent epics, each decomposed from its own `roadmap.md`
> section — additive, neither touches the other's stories.

## Epic: harden

> Decomposed from `roadmap.md`'s phases (0, 1, 1b, 2, 3 — the original five; Phase 5 added,
> challenged, and built 2026-08-06). Stories `harden-01`–`07` cover `FR-1`–`FR-12` from
> `prd.md`, all done. `harden-09`/`11` cover `FR-17`–`FR-18`'s CLI half, done in two tiers.
> `harden-08`/`10` cover `FR-19`'s TUI half — written, held by a real product-owner decision,
> not built. `FR-13`–`FR-16` remain deferred to Stage 2, out of scope for this epic — see
> `roadmap.md`'s "Does executing this deliver the goal?"

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [harden-01](harden-01-rubric-citation-slot.md) | Add a citable rule-ID column to the design-system template | 0 | FR-10 | — | **done** |
| [harden-02](harden-02-spike-invocation-reliability.md) | Spike: confirm hook firing reliability, field names, crash isolation | 1 | — | — | **done** |
| [harden-03](harden-03-spike-capture-tool-discrimination.md) | Spike: confirm capture-tool discrimination for the real toolset in evidence | 1 | — | — | **done** |
| [harden-04](harden-04-evidence-only-marker.md) | Flag stages backed entirely by unconfirmed evidence | 1b | FR-5–FR-8 | — | **done** |
| [harden-05](harden-05-invocation-ledger.md) | Record real skill invocations to a durable, per-session ledger | 2 | FR-1–FR-3 | harden-02 | **done** |
| [harden-06](harden-06-status-invocation-reporting.md) | Report invoked, not-invoked, and untraceable per governed artifact | 2 | FR-1, FR-2, FR-4 | harden-05 | **done** |
| [harden-07](harden-07-verification-channel-rubric-gate.md) | Require a real render and an honest rubric citation for UI verdicts | 3 | FR-9–FR-12 | harden-05, harden-03, harden-01 | **done** |
| [harden-08](harden-08-spike-terminal-capture-tool.md) | Spike: confirm whether a real terminal-visual-capture tool exists | 5 | FR-19 | — | **held** |
| [harden-09](harden-09-cli-channel-rule.md) | Require a real process invocation, not an internal-logic call, for CLI verdicts | 5 | FR-17, FR-18 | harden-11 | **done** (tier 1; tier 2 open debt) |
| [harden-10](harden-10-tui-channel-rule.md) | Require a real visual capture, not an ANSI-stripped text read, for TUI verdicts | 5 | FR-17, FR-19 | harden-08 | **held** |
| [harden-11](harden-11-spike-cli-invocation-discrimination.md) | Spike: can a real CLI invocation be safely and precisely tracked in the ledger? | 5 | FR-18 | — | **done** |

Stories `harden-01`–`07`: **done**, all 7 passed a QA-strategist readiness check before the
build started, with two real gaps found and fixed at that stage (`harden-05`'s exit-code
contradiction, `harden-07`'s missing corrupt-capture case). Stories `harden-08`–`11`: written
2026-08-06, then run through `/delivery:challenge` before any building — a real, 5-reviewer
adversarial review (`.delivery/reviews/phase-5-cli-tui-01.md`) found the original plan wasn't
buildable as scoped. `harden-11` (a new spike, not in the original three) resolved the CLI
question for real, with a genuine partial result (live confirmation blocked by an expired
auth session, real design analysis completed anyway). `harden-09` shipped in two honest
tiers off that result. `harden-08`/`harden-10` (TUI) are held — a real product-owner
decision, not a slip, made after the review found no downstream need for it yet and a named
fallback tool confirmed unable to do the one thing it was proposed for.

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

harden-11 ─→ harden-09  (CLI channel, tier 1 built; tier 2 open debt)
harden-08 ─→ harden-10  (TUI channel — both held, not built)
```

## Not covered here

`FR-13`–`FR-16` (the self-correction gate) — Stage 2 in `prioritization.md`, defends a
persona with zero real transcript evidence. No stories exist for it yet; decomposing it is
future work, contingent on the operator-who-reads-only-the-verdict persona being confirmed
real (per `roadmap.md`'s learning milestone M4).

## Epic: chief-of-staff

> Decomposed from `roadmap.md`'s "Chief of Staff epic (additive)" section, Phases 5–9.
> All 10 stories trace `FR-20`–`FR-55` (minus retired `FR-26`) from `prd.md`'s MVP-1
> scenarios (S-6/S-7/S-8/S-9/S-11) — 27 of 27 requirements covered, no gaps. `FR-36`–`39`
> (S-10) and `FR-44`–`47` (S-12) are Stage-2, deferred, no stories yet — see below.

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [chief-of-staff-01](chief-of-staff-01-spike-cos1-consultation-compliance.md) | Spike: measure real chief-of-staff consultation compliance (CoS-1) | 5 | FR-20–FR-22 (thin) | — | **ready** |
| [chief-of-staff-02](chief-of-staff-02-spike-cos2-parallel-dispatch-batching.md) | Spike: confirm parallel subagent dispatch batches, not interleaves (CoS-2) | 5 | NFR-8 | chief-of-staff-01 | **ready** |
| [chief-of-staff-03](chief-of-staff-03-foundational-infrastructure.md) | Build the chief-of-staff foundational substrate — decision log, mission/queue scaffolding, FR-51 fallback | 6 | FR-51, FR-23, FR-55 | chief-of-staff-01 | **ready** |
| [chief-of-staff-04](chief-of-staff-04-s5-citation-or-nothing.md) | S-6: answer only from a citable source, or fall through | 7 | FR-20–FR-23 | chief-of-staff-03 | **ready** |
| [chief-of-staff-05](chief-of-staff-05-s6-bounce-invented-scope.md) | S-7: bounce agent-invented scope back to its originating agent | 7 | FR-24, FR-25, FR-27 | chief-of-staff-03 | **ready** |
| [chief-of-staff-06](chief-of-staff-06-s7-technical-unknown-routing.md) | S-8: route technical unknowns to a spike, never an interrupt | 7 | FR-28–FR-31, FR-53 | chief-of-staff-03 | **ready** |
| [chief-of-staff-07](chief-of-staff-07-s10-mission-capture-drift-check.md) | S-11: capture and defend the original mission | 7b | FR-40–FR-43, FR-55 | chief-of-staff-03 | **ready** |
| [chief-of-staff-08](chief-of-staff-08-s8-briefing-core.md) | S-9: assemble one ranked briefing, never fabricate a default, merge duplicates | 8 | FR-32–FR-35, FR-52 | chief-of-staff-04, -05, -06, -07 | **ready** |
| [chief-of-staff-09](chief-of-staff-09-s8-push-pause-scale.md) | S-9: push exception, pause/resume, concurrent-arrival ordering, briefing at scale | 8 | FR-48–FR-50, FR-54 | chief-of-staff-08, chief-of-staff-02 | **draft** |
| [chief-of-staff-10](chief-of-staff-10-nine-agent-rollout.md) | Roll out the "Chief of staff" pointer section to the remaining 7 consulting agents | 9 | FR-51 | chief-of-staff-08, chief-of-staff-09 | **ready** |

**9 of 10 ready. One (`chief-of-staff-09`) is honestly `draft`, not rounded up:** its
`FR-50` concurrent-arrival-ordering criterion isn't falsifiable yet — `NFR-8`'s exact
mechanism is genuinely open (owner: solution-architect) and the story's own proposed rule is
explicitly contingent on `chief-of-staff-02`'s (Spike CoS-2) real result, which hasn't run.
Every other acceptance criterion in that story is falsifiable now; only the one gated
criterion holds the whole story back from `ready`. Promotes the moment CoS-2's result lands.

**Reconciliation across the batch, done centrally after all 10 were written in parallel:**
two real architecture gaps were found independently by different story-writers and fixed in
`architecture.md` rather than worked around locally — the consultation-call interface never
specified the calling agent identifying itself (needed by `FR-25`'s "names the originating
agent" and S-7's "provenance unknown" case; found by `chief-of-staff-05`), and the briefing
queue's `Source` column omitted S-11 despite `FR-43`/`FR-52` requiring S-11-sourced and
merged-S-7+S-11 entries (found by `chief-of-staff-08`). Two smaller implementation-level
gaps were resolved locally as flagged reasoned extensions rather than architecture edits
(both in `chief-of-staff-06`): `FR-30`'s "matching spike" check must scan `.delivery/stories/`
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
              (S-6)               (S-7)               (S-8)          (S-11, parallel — Phase 7b)
                    └────────────────┴────────────────┴──────────────────┘
                                              ▼
                                   chief-of-staff-08 (S-9 core)
                                     │                    │
                                     ▼                    │
                          chief-of-staff-09 (S-9 ext) ←────┘ (also needs chief-of-staff-02)
                                     │
                                     ▼
                          chief-of-staff-10 (9-agent rollout)
```

## Not covered here (chief-of-staff epic)

`FR-36`–`FR-39` (S-10, learns the operator's decision pattern) and `FR-44`–`FR-47` (S-12,
keeps `AGENTS.md`/`CLAUDE.md` adequate) — Stage-2 in `prd.md`, deferred for two different
reasons (S-10 has zero data to learn from until S-6–S-9 ship; S-12 is the epic's
weakest-precedented scenario and mechanically a distinct verification capability). No
stories exist for either yet; decomposing them is future work, contingent on MVP-1
shipping and, for S-10 specifically, accumulating real logged decision-log instances.
