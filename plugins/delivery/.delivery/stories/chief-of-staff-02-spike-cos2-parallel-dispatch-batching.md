---
id: chief-of-staff-02
title: "Spike: confirm parallel subagent dispatch batches, not interleaves (CoS-2)"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — foundational spikes: CoS-1 (walking skeleton) + CoS-2"
requirements: [NFR-8]
depends_on: [chief-of-staff-01]
size: S
---

# Spike: confirm parallel subagent dispatch batches, not interleaves (CoS-2)

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A concrete, checkable answer: dispatch at least two real parallel subagent calls, each
independently invoking chief of staff, and confirm the orchestrator receives every result
together — complete and unmangled, not interleaved or silently dropped. This is
`architecture.md`'s Spike CoS-2, run for real.

## Context

`architecture.md`'s `NFR-8` row (Concurrent-arrival ordering, `FR-47`) currently reads
"resolved, not left open": Claude Code is assumed to deliver a batch of parallel Agent-tool
dispatches back to the orchestrator together, not asynchronously mid-conversation, so there
is no true race at the interaction layer — only a deterministic-merge rule chief of staff
applies when it regains control with more than one pending blocking item (rank by priority,
then arrival order). Confidence is marked **medium — reasoned from documented tool behavior,
confirmed by spike before shipping** — reasoned, not yet empirical. The Spikes table's own
CoS-2 row poses the exact question this story answers, time-boxed 0.5 day, blocking "`NFR-8`'s
deterministic-merge design — if dispatch isn't genuinely batched, a stronger serialization
primitive is needed instead."

Two later designs assume the batching holds:

- **`FR-47`** (S-8 mid-exchange pause/resume) — "a new blocking item mid-exchange pauses it
  with an explicit marker and resumes after; never a second concurrent exchange, never a
  silent queue." A "pause once, resume once" design only covers real behavior if arrivals
  genuinely land as one batch, not as a true interleaving the orchestrator has to juggle
  mid-turn.
- **`FR-49`** (queue merge on insert, Interface 2) — "an output flagged by both S-6 and S-10
  routes as one merged item citing both reasons — never two separate routings," enforced by:
  "before inserting a queue item, chief of staff checks
  `.delivery/chief-of-staff/queue.md` for an existing open item about the same output and
  merges into it rather than opening a second one." That merge check is a read-modify-write
  on a single project-scoped file (Interface 3); it only avoids a lost update if the writes
  it guards against arrive one at a time within the same turn, not truly concurrently.
  Architecture's own Risks table names this exact failure — two subagents both resolving a
  blocking item and both attempting to update `queue.md` near-simultaneously — likelihood
  "Low, single-session turn-taking mostly serializes this," impact "Medium if it happens, a
  lost update," mitigation "Spike CoS-2 confirms batching; the `FR-49` merge check
  (read-before-insert) is the same read-modify-write this risk depends on."

`roadmap.md`'s Phase 5 lists CoS-2 as its own work item, sized S, depending on the walking
skeleton (`chief-of-staff-01`), not on CoS-1's trial results. Phase 8's own work-item table
(`FR-47`'s concurrent-arrival ordering half) states it "inherits Spike CoS-2's confirmed
batching assumption; not tested ahead of it" — this spike is what that later phase inherits
from. It needs a real, invokable `chief-of-staff` `subagent_type` to dispatch against, which
is exactly what `chief-of-staff-01` builds; it does not need CoS-1's own ≥10-trial compliance
run to finish first.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/chief-of-staff.md` | none — read-only dependency. Built by `chief-of-staff-01`; this story dispatches real parallel Agent-tool calls against it, does not modify it |
| `plugins/delivery/.delivery/architecture.md` | modify — update the CoS-2 spike-table row (currently at line 424) from time-boxed/open to answered with the real observed result; update `NFR-8`'s row (currently at line 402) confidence to reflect the empirical finding |

No new production files, no code changes — same "empirical spike, not a test" framing
`architecture.md`'s Test strategy applies to both CoS-1 and CoS-2.

## Interfaces and contracts to honor

The Agent tool's own documented parallel-dispatch contract is the mechanism under test, not
assumed in advance: this harness's own tooling states that independent tasks requested in
parallel are sent as multiple tool-use blocks inside a single message, and more generally
that independent tool calls with no dependency between them belong in the same response
rather than issued one at a time across turns. The spike confirms this documented behavior
holds specifically for `subagent_type: "delivery:chief-of-staff"` calls — not taken on faith,
the same discipline `harden-02` applied to the hook contract's documented field names before
`harden-05` was built on top of them.

Chief of staff's own return contract (`architecture.md` Interface 1, `chief-of-staff-01`'s
walking-skeleton scope): each Agent-tool response states one of `answered`/`bounced`/
`spiked`/`queued`. This spike doesn't need every outcome type exercised — any response shape
the walking skeleton returns is enough to check whether N dispatched calls come back as N
complete, distinguishable responses in one batch.

## Relevant design decisions

- **`NFR-8`** — the target this spike resolves from "reasoned, medium confidence" to a real
  observed result (or the stated fallback).
- **`ADR-003`** — the decision log is per-session NDJSON, separate from `queue.md`. The
  contention risk this spike checks is specifically about `.delivery/chief-of-staff/queue.md`
  (Interface 3, a single project-scoped file), not the decision log, which this story does
  not touch.

## Acceptance criteria

- [ ] `NFR-8` — at least 2 real parallel subagent calls are dispatched in one message (per
  this harness's own documented parallel-dispatch support), each independently invoking
  `subagent_type: "delivery:chief-of-staff"` against `chief-of-staff-01`'s walking skeleton,
  each with a distinct candidate question.
- [ ] The orchestrator's next turn shows all dispatched results together, complete and
  unmangled — each call's full response present and attributable to the correct originating
  call, no truncation, corruption, or cross-call mixing.
- [ ] Both named failure modes are explicitly checked, not just the happy path: interleaving
  (one call's result mixed into another's) and dropping (a dispatched call's result missing
  entirely).
- [ ] If dispatch is confirmed batched: `architecture.md`'s CoS-2 row is updated from open to
  answered with the real observed evidence, and `NFR-8`'s confidence is updated to reflect
  the empirical result.
- [ ] If dispatch is NOT genuinely batched: stated plainly in `architecture.md`'s CoS-2 row,
  flagging — per the architecture's own stated fallback — that `NFR-8`'s deterministic-merge
  design needs a stronger serialization primitive than rank-by-priority-then-arrival-order.

## Test approach

**Level:** empirical spike, not a test — no fixture substitutes for observing real dispatch
behavior, the same reasoning `chief-of-staff-01` applies to CoS-1 and `harden-02`/`harden-03`
applied to the hook contract before building on it.
**Cases:**

| Case | Expected |
| :-- | :-- |
| ≥2 parallel Agent-tool calls to `delivery:chief-of-staff`, dispatched in one message | Orchestrator's next turn contains all results together, one per call, complete |
| Same trial, checked for interleaving | No result is mixed with, or truncated by, another call's result |
| Same trial, checked for drops | Every dispatched call has a corresponding result — none silently missing |
| (If observed) dispatch is not genuinely batched | Stated plainly; `NFR-8` flagged as needing a stronger serialization primitive, per architecture's own fallback |

**Run with:** manual — a single message in a live Claude Code session dispatching ≥2
parallel Agent-tool calls against `chief-of-staff-01`'s walking skeleton, inspecting the
orchestrator's own next-turn context for the returned results. Not scriptable as a single
command; this is the nature of a real-session spike, same as `harden-02`.

## Out of scope

- The full consultation-compliance question (Spike CoS-1, `chief-of-staff-01`'s job) —
  whether a consulting agent actually chooses to call chief of staff at all, a different,
  harder question from whether dispatched results come back batched once the call is made.
- Building the real `FR-47` pause/resume mechanism or the real `FR-49` merge check — future
  stories `chief-of-staff-08`/`chief-of-staff-09` (Phase 8), which this spike only de-risks,
  not implements.
- A stress test of `queue.md` under sustained concurrent load — this spike confirms the
  batching assumption with a small number of real parallel calls, not a load test.

## Dependencies

- `chief-of-staff-01` — must have `agents/chief-of-staff.md` built and registered as a real,
  invokable `subagent_type` before this spike can dispatch real calls against it. Per
  `roadmap.md`'s Phase 5 table, CoS-2 depends on the walking skeleton existing, not on CoS-1's
  ≥10-trial compliance run finishing — this story runs alongside `chief-of-staff-01` or right
  after the walking skeleton lands.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and
the reason, and follow-up work — anything a future reader would want.
