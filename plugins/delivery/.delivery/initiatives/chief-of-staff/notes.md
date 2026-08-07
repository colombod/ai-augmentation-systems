# Stories notes: chief-of-staff

> Initiative: `chief-of-staff`. Per `ADR-004`, the story ID/title/phase/requirements/status
> table that used to live here is retired as a hand-maintained file — it's fully derivable
> from each story's own frontmatter, and `/delivery:status` computes it live. This file keeps
> only the authored narrative judgment that isn't derivable data — moved 2026-08-07 from the
> shared `.delivery/stories/README.md`, content unchanged. All 10 stories trace `FR-20`–`FR-55`
> (minus retired `FR-26`) from `prd.md`'s MVP-1 scenarios (S-6/S-7/S-8/S-9/S-11) — 27 of 27
> requirements covered, no gaps. `FR-36`–`39` (S-10) and `FR-44`–`47` (S-12) are Stage-2,
> deferred, no stories yet — see "Not covered here" below.

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

**Post-`ADR-004` incident note:** this epic's own PRD/architecture/roadmap collided with
`harden`'s independently-numbered Phase 5 work at merge time (`S-5`/`FR-17`–19 meant two
different things) — reconciled by renumbering this epic to `S-6`–`S-12`/`FR-20`–`55`
(commit `236e70a`) before the branches could merge. `ADR-004` is the structural fix so this
class of incident can't recur; this epic's own content is the real case that motivated it.

## Build order

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

## Not covered here

`FR-36`–`FR-39` (S-10, learns the operator's decision pattern) and `FR-44`–`FR-47` (S-12,
keeps `AGENTS.md`/`CLAUDE.md` adequate) — Stage-2 in `prd.md`, deferred for two different
reasons (S-10 has zero data to learn from until S-6–S-9 ship; S-12 is the epic's
weakest-precedented scenario and mechanically a distinct verification capability). No
stories exist for either yet; decomposing them is future work, contingent on MVP-1
shipping and, for S-10 specifically, accumulating real logged decision-log instances.
