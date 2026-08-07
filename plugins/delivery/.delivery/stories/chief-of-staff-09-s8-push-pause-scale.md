<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Word-budget note: declared overrun, not silent, same precedent every chief-of-staff-epic
sibling story has already set (chief-of-staff-03/04/05/07 all exceed 1200 prose-only words
for the same reason). This story reproduces FR-45/46/47/51's exact text, the Return-contract
mechanism verbatim (the load-bearing design decision it implements), Interface 3's queue
columns, and an honest, non-hand-waved explanation of exactly which half of FR-47 is and is
not testable today, plus why. Cutting any of it to fit the cap would re-hide context an
implementer with no memory of planning needs — the same "never cut findings/citations/open
questions" rule the writing standard states. Prose-only count exceeds 1200; kept anyway.
-->

---
id: chief-of-staff-09
title: "S-8: push exception, pause/resume, concurrent-arrival ordering, briefing at scale"
status: draft
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 8 — S-8 briefing assembly + FR-49 merge"
requirements: [FR-45, FR-46, FR-47, FR-51]
depends_on: [chief-of-staff-08, chief-of-staff-02]
size: M
---

# S-8: push exception, pause/resume, concurrent-arrival ordering, briefing at scale

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

A blocking item with no open counterpart already delivered reaches the operator without
waiting for a pull — delivered alone, never bundled into the next full briefing. A new
blocking item that arrives while chief of staff is already mid-exchange over an earlier one
pauses that exchange with an explicit marker and resumes it afterward, never running a second
concurrent thread and never silently queuing the interruption. A briefing built from many
accumulated survivors still reads at a glance — grouped and summarized, not a wall of
individual rows — however large a delegation stretch has made it.

## Context

`chief-of-staff-08` builds S-8's core: `agents/chief-of-staff.md`/`skills/chief-of-staff/
SKILL.md` accumulate every S-5–S-7 survivor into one ranked, pull-delivered briefing —
blocking items first, each carrying a suggested default or an explicit no-default-available
marker (`FR-29`–32). This story is Phase 8's other half: the narrow exception to pull-only
delivery (`FR-45`/`46`), the interruption policy for a blocking item arriving mid-exchange
(`FR-47`), and the scannability rule so accumulation doesn't collapse into an unreadable list
(`FR-51`).

**The push mechanism is not a new capability chief of staff invents — it is
`architecture.md`'s own resolution of feature-critic finding 5 ("`FR-45`/46 had no described
invocation path"), and it is the load-bearing design decision this story implements: there is
no daemon in this harness, and nothing proactively messages the operator outside a running
session** (`harden-02`'s own finding). So "push" cannot mean an out-of-band interrupt. It
means: when a `queued` outcome's `Blocking` flag is `y` and no open counterpart already
exists, **the calling agent's own next reply to the operator — whatever session is currently
running — leads with that item before its own content**, rather than deferring it to a future
pull. Chief of staff's return-contract response carries this instruction; the calling agent,
not chief of staff, is the actual delivery mechanism (`architecture.md` Interface 1,
consistent with the epic's own boundary that nothing here acts unless an agent already in a
live exchange chooses to). A `queued` outcome inside a session where the calling agent never
again addresses the operator has no way to surface until an explicit pull — a named, accepted
limit, not hidden.

Two Case-table rows from `prd.md`'s S-8 scenario land here rather than in `chief-of-staff-08`:
a large briefing staying scannable (`FR-51`), and "blocking item's operator never returns at
all" — **no stated ceiling: intentional**, because proceeding on a fabricated default for a
genuinely blocking decision is exactly what `FR-32` forbids. That row interacts directly with
the push exception: a pushed blocking item with no response is never converted to a default,
never dropped from the queue, and never re-pushed as a duplicate once delivered — it stays
open, indefinitely, until the operator answers.

**`FR-47` splits into two halves this story treats differently.** The pause/marker/resume
behavior is fixture-testable now — nothing about it depends on anything unresolved. The
**concurrent-arrival ordering** half — what happens when more than one blocking item arrives
at once — depends on `NFR-8`, which `prd.md`'s own NFR table still lists **open, owner:
solution-architect**. `architecture.md` proposes a specific deterministic-merge rule (rank by
priority, then arrival order), reasoned from this harness's documented parallel-dispatch
behavior, at **medium confidence — confirmed by spike before shipping**, not yet empirical.
`chief-of-staff-02` is that spike (CoS-2): confirm whether parallel Agent-tool dispatches
genuinely batch back to the orchestrator together rather than interleaving. As of this
story's writing, `chief-of-staff-02` is `status: ready`, not `done` — the empirical result
this half depends on does not exist yet. This story does not build or test the
concurrent-ordering half ahead of that result: `architecture.md`'s own Test-strategy table
states the discipline directly — "the concurrent-arrival ordering guarantee inherits Spike
CoS-2 — do not test that half ahead of it, same discipline the harden epic applied to its own
Mechanism-3 row."

## Files and modules

| Path | What to do |
| :-- | :-- |
| `agents/chief-of-staff.md` | modify — add the push-exception check to the return contract: before returning a `queued` outcome with `Blocking: y`, check `.delivery/chief-of-staff/queue.md` for an existing item about the same output already delivered and still `Status: open` (its "open counterpart"); if none exists, the response explicitly instructs the calling agent that this item must lead its very next reply, per the Return-contract mechanism above. Add mid-exchange pause/resume: when a new blocking item arrives while a consultation exchange is already active, the current exchange is explicitly marked paused, the new blocking item is surfaced, and the original exchange resumes once addressed — never two simultaneous threads, never a silent queue |
| `skills/chief-of-staff/SKILL.md` | modify — built on `chief-of-staff-08`'s base pull-assembly logic: when assembling the briefing, exclude items already delivered by push and still open from being re-surfaced as new (reported once, not duplicated); add `FR-51`'s grouped/summarized display for a briefing with many survivors, reusing `skills/status/SKILL.md`'s existing "Keep this scannable at scale" convention rather than inventing a new one |

## Interfaces and contracts to honor

Reproduced from `architecture.md`'s Interfaces and data contracts section (Chief of Staff
epic) and `chief-of-staff-03`'s Interface 3, not linked.

**Return contract (Interface 1)** — every chief-of-staff Agent-tool response states exactly
one of:

```
answered  — S-5, with citable traceback
bounced   — S-6, with originating agent + missing requirement
spiked    — S-7, with the spike story's path
queued    — S-8, with the queue-entry ID and its Blocking flag (y/n)
```

The push mechanic this story builds: a `queued` outcome with `Blocking: y` and no open
counterpart already delivered leads the calling agent's own next reply, per the mechanism
quoted in Context above.

**Queue entry (Interface 3)** — relevant columns this story reads and writes:

| Column | Values |
| :-- | :-- |
| Blocking | y / n |
| Status | open / answered / parked / pushed |

A single project-scoped file (`.delivery/chief-of-staff/queue.md`), not per-session. Pushing
an item sets `Status: pushed`; it stays `pushed` (and open, in the sense of unanswered) until
the operator responds — never silently reverted, never auto-resolved.

**`NFR-8` (concurrent-arrival ordering, `FR-47`)** — `architecture.md`'s reasoned, unconfirmed
proposal: "rank by priority, then arrival order," medium confidence, "confirmed by spike
before shipping." Not committed until `chief-of-staff-02`'s real result lands. Do not
implement this rule as final in this story.

## Relevant design decisions

- **`ADR-002`** — chief of staff is a real subagent plus a thin skill wrapper; the calling
  agent, not chief of staff itself, is the actual push-delivery mechanism. This story's job is
  to make chief of staff's return contract carry the right instruction, not to reach into the
  operator's session directly — nothing in this harness lets it.
- **Architecture's Risks table** — "two subagents dispatched in parallel both resolve a
  blocking item and both attempt to update `queue.md` near-simultaneously," mitigated by
  Spike CoS-2 confirming batching and by the same read-before-write discipline `FR-49`'s merge
  check uses. This story's open-counterpart check (read `queue.md` before returning `queued`
  with a push instruction) is a second consumer of that identical discipline, not a new one.

## Acceptance criteria

- [ ] `FR-45` — "never proactively surfaces a non-blocking item; only a blocking item with no
  open counterpart already delivered may be pushed outside a pull." A non-blocking item is
  never pushed under any circumstance, no matter how long it has sat unanswered.
- [ ] `FR-46` — "a pushed blocking item is delivered alone, not bundled — the one exception to
  `FR-29`, reported as such." A push never bundles a second item, blocking or not, even if
  both became push-eligible in the same turn.
- [ ] `FR-47`, pause/resume half (falsifiable now) — "a new blocking item mid-exchange pauses
  it with an explicit marker and resumes after; never a second concurrent exchange, never a
  silent queue." A new blocking item arriving while an earlier consultation exchange is active
  produces an explicit, human-readable pause marker naming what is paused and why, surfaces
  the new item, and resumes the original exchange afterward.
- [ ] `FR-47`, concurrent-arrival ordering half — **not falsifiable yet, explicitly gated.**
  Same FR text applies; verification is blocked on `chief-of-staff-02`'s real spike result
  (see Dependencies). This criterion cannot be marked ready until that result lands.
- [ ] `FR-51` (priority: **should**, not must, per `prd.md`'s own FR table — the first thing
  to drop under schedule pressure, same precedent `chief-of-staff-08`'s own cut list and the
  harden epic's "a working plain report ships before a well-formatted one" both set) — "a
  briefing with many survivors is grouped/summarized so it stays scannable — the same
  qualitative principle as S-1's rule, itself unquantified. Verified by human judgment, same
  standard as `FR-10`'s design-rubric check." No numeric threshold: a reviewer reads a large,
  hand-authored briefing fixture and judges whether it reads as grouped/scannable, not a wall
  of individual rows.
- [ ] Edge case (Case table, not covered by `chief-of-staff-08`) — a pushed blocking item whose
  operator never returns stays open indefinitely: never silently converted to a default
  (`FR-32`), never dropped from the queue, never re-pushed as a duplicate once delivered.

## Test approach

**Level:** per `architecture.md`'s Test-strategy table — Example-based for the push exception
(`FR-45`/46); Integration for `FR-47`'s pause/resume half; empirical spike, inherited from
`chief-of-staff-02`, for `FR-47`'s concurrent-ordering half (not tested in this story);
Example-based, qualitative/reviewer-judged for `FR-51`, mirroring S-1's own precedent. No
fixture substitutes for the concurrent-ordering half — the same reasoning `chief-of-staff-02`
itself applies.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Blocking item, no open counterpart delivered, operator hasn't checked in | Pushed alone, leading the calling agent's next reply — not bundled, not deferred to the next pull |
| Non-blocking item, same window | Never proactively surfaced — waits for the next pull regardless of age |
| Blocking item, an open counterpart already delivered and still unanswered | Not re-pushed as a duplicate — reported once |
| New blocking item arrives mid-exchange | Active exchange pauses with an explicit marker; new item surfaces; original exchange resumes after — never a second concurrent thread, never a silent queue |
| Pushed blocking item, operator never responds | Stays open indefinitely — no ceiling, never a fabricated default, never dropped |
| Large briefing (many accumulated survivors) | Reviewer confirms it reads as grouped/scannable — reuses `skills/status/SKILL.md`'s grouping convention (e.g. "N of M items open, grouped by source" rather than one row per item) |
| Two blocking items arriving "simultaneously" (`FR-47` concurrent-ordering half) | **Gated on `chief-of-staff-02`** — not tested in this story; do not build or test ahead of the spike result |

**Run with:** no automated test runner exists for this epic's markdown-only surface
(`agents/chief-of-staff.md`, `skills/chief-of-staff/SKILL.md` — no executable code, per
`architecture.md`'s own framing). Verification is invoking the real agent/skill file against
each hand-authored fixture above and inspecting the actual reply text, briefing output, or
`queue.md` write — never stubbing the agent's judgment.

## Out of scope

- `NFR-8`'s exact concurrent-arrival mechanism — solution-architect's future call, per
  `prd.md`'s own NFR table. `architecture.md`'s rank-by-priority-then-arrival-order rule is
  reasoned, not confirmed; this story does not implement or test it ahead of
  `chief-of-staff-02`'s real result.
- `NFR-10` / `FR-51`'s exact volume threshold number — open, product-owner's call, same class
  as `NFR-6`/7/9. This story ships the qualitative, reviewer-judged path only.
- `FR-49`'s queue-merge check (S-6 + S-10 same-output dedup) — a distinct Phase 8 work item, a
  different story, not this one.
- The 9-agent pointer-section rollout that wires "lead your next reply with this item" into
  each consulting agent's own persona file — Phase 9 (`chief-of-staff-10`), which consumes
  this story's return-contract instruction; it does not author it.
- Finalizing or shipping the concurrent-ordering merge mechanism itself, for the reason stated
  throughout.

## Dependencies

- **`chief-of-staff-08`** (S-8 briefing assembly, Phase 8) — must be `done` first. It builds
  `agents/chief-of-staff.md`'s core accumulation/ranking/default-marking logic (`FR-29`–32)
  and creates `skills/chief-of-staff/SKILL.md`'s pull-based briefing assembly that this story's
  push path and grouped display extend, plus the shared queue-insertion routine's `FR-49`
  merge-on-insert check this story's push-exception open-counterpart read reuses. As of this
  story's writing, `chief-of-staff-08` exists and is `status: ready` — specified, not yet
  built. Its own Out of scope section names the push exception, `FR-47`'s pause/resume and
  concurrent-ordering halves, and `FR-51`'s grouped display as explicitly this story's scope,
  confirming the split matches on both sides.
- **`chief-of-staff-02`** (Spike CoS-2, Phase 5) — must confirm parallel-dispatch batching
  before `FR-47`'s concurrent-arrival ordering half can be tested. As of this story's writing,
  `chief-of-staff-02` is `status: ready`, not `done` — the empirical result this story's
  concurrent-ordering acceptance criterion depends on does not exist yet. This is the specific
  reason this story's own status is `draft`, not `ready`.

## Implementation notes

**Status set to `draft`, not `ready`, for one specific, named reason — not a general
hedge.** `FR-47`'s concurrent-arrival ordering acceptance criterion is not falsifiable yet:
`NFR-8`'s exact mechanism is genuinely open in `prd.md` (owner: solution-architect),
`architecture.md`'s proposed rule is reasoned but unconfirmed, and its confirming spike
(`chief-of-staff-02`) is `ready` but has not run. Forcing a `ready` status on that one
criterion would mean writing a pass/fail test against a mechanism nobody has committed to yet.

Every other acceptance criterion here — the push exception (`FR-45`/46), the pause/marker/
resume half of `FR-47`, the operator-never-returns edge case, and `FR-51`'s qualitative scale
check — is falsifiable now, has real file paths, a stated test approach, and a stated
dependency (`chief-of-staff-08`, itself specified and `status: ready` but not yet built — a
known, named blocker, not a hidden one).

Promote to `ready` once `chief-of-staff-02`'s real result lands and is folded back into the
`FR-47` concurrent-ordering criterion above, replacing "gated" with a concrete pass/fail test
(or, if CoS-2 finds dispatch is not genuinely batched, a note that `NFR-8` needs
solution-architect's follow-up decision before this criterion can be written at all).
Recommend not shipping this story's `FR-47` concurrent-ordering half under schedule pressure —
`architecture.md`'s own discipline against testing it ahead of the spike applies to building
it too.
