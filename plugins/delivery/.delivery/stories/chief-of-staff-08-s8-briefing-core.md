<!--
BUDGET note: this story's prose (excluding tables/code) runs past the template's 700-word
target and close to its 1200-word cap. Declared, not silent: S-8 is a 9-FR scenario
architecture.md itself calls "the scenario's core... guarantee," this story alone owns 5 of
those FRs (`FR-29`/30/31/32/49) plus the shared merge routine two earlier stories already
call into, and the PRD's S-5–S-11 scenarios (unlike S-1–S4) carry no numbered Main-path list
to link to — it has to be reconstructed here so the implementer isn't sent back to the PRD.
Cutting the reconstruction or the Case-table/FR text back to fit would remove exactly the
context this file exists to carry.
-->

---
id: chief-of-staff-08
title: "S-8: Assemble one ranked briefing, never fabricate a default, merge duplicates"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 8 — S-8 briefing assembly + FR-49 merge"
requirements: [FR-29, FR-30, FR-31, FR-32, FR-49]
depends_on: [chief-of-staff-04, chief-of-staff-05, chief-of-staff-06, chief-of-staff-07]
size: L
---

# S-8: Assemble one ranked briefing, never fabricate a default, merge duplicates

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

The operator (or the orchestrating agent pulling on their behalf) runs the chief-of-staff
skill after a stretch of delegation and gets back **one** report: everything that survived
S-5/S-6/S-7/S-10 triage since the last check-in, ranked with blocking items first, each
carrying either a suggested default or an explicit `no-default-available` marker — never a
fabricated one — and never two separate entries for one output independently flagged by both
S-6 and S-10.

## Context

**Actor:** P-1, The Unwitnessed Operator.
**Trigger:** "the operator returns after a stretch of delegation (pull) — or, narrowly, a
blocking item with no open counterpart already in a delivered briefing (push)." The push half
is quoted here for fidelity to the PRD's own Trigger line, but it is **not** this story's
scope — see Out of scope.
**Preconditions:** the PRD's S-5–S-11 scenarios, unlike S-1–S4, don't carry an explicit
Preconditions field. Inferred from the Trigger and `architecture.md`'s Component structure:
`.delivery/chief-of-staff/queue.md` holds zero or more `open` items written by S-5/S-6/S-7/S-10
triage since the last check-in.
**Grounding: observed** — upgraded from `assumed` by a real, currently active session
(`Attractor approach research for Claude`, `attractor-orchestration-claude`), quoted in the
PRD's epic intro: the assistant collapsed two parallel, multi-hour workstreams into one
consolidated checkpoint — *"Both threads have hit a natural checkpoint... here's where things
actually stand before I keep going"* — ending with one ranked question, not scattered asks.
The operator's own reply is a live instance of park-over-polish from the human side: *"we need
specialyl ythe parallelism part in attractor landing, we can postpone the delivery plugin work
btu document it as feature / list of thigns to achieve next"* — redirect priority, park the
rest, document it rather than drop it silently. This is real evidence for exactly the shape
this story builds: one collapsed report, not scattered interruptions.

**Main path (reconstructed — S-8's PRD prose is dense narrative, not a numbered list like
S-1–S4; steps 1–4 below are the in-scope sentences only, stopping before the push/pause
amendment content that belongs to `chief-of-staff-09`):**
1. Across the delegation period, S-5/S-6/S-7 (and S-10, see note below) survivors accumulate
   in the queue rather than interrupting the operator one at a time.
2. At check-in (a pull), they combine into **one** report.
3. The report is ranked, blocking items first.
4. Every item in the report states a suggested default, or is explicitly marked
   `no-default-available` — never a fabricated one.

**Why S-10 belongs alongside "S-5/S-6/S-7 survivors":** S-10 has no direct-resolution outcome
of its own the way S-5 answers, S-6 bounces, or S-7 spikes — it only flags, and its own
`FR-40` states a drift flag "surfaces through existing routing (S-8, or a bounce-style
note)," so every non-bounce-note S-10 flag reaches this story's queue directly, not only via
the `FR-49` merge case. **Flagged for solution-architect, not silently resolved:**
`architecture.md`'s Interface 3 lists the queue's `Source` column as `S-5/S-6/S-7` only,
omitting `S-10` even though Interface 2's merge text and `FR-40` both require S-10-sourced
(and merged `S-6+S-10`) items in the same queue. This story extends `Source`'s accepted
values to include `S-10` and merged `S-6+S-10` — a direct, textually-supported reading, not a
new design decision — and names the omission for confirmation at the next architecture
review rather than treating it as authoritative.

Most S-5/S-6/S-7 outcomes resolve directly and never touch `queue.md`; only specific
case-table rows do — S-5's `FR-19` fallthrough, S-6's escalations (provenance unidentifiable,
bounced twice, disputed), and S-7's blocked-on-spike split half plus (should-priority,
`FR-50`) an unclaimed spike. S-10 flags land on every fire. This matters for the "empty
queue" fixture below: a queue with no `open` items is the normal case, not an error state.

**Shared mechanism, not duplicated logic:** `agents/chief-of-staff.md` already has one
insertion routine `chief-of-staff-05` (S-6) and `chief-of-staff-07` (S-10) call to write a
queue entry once classified. This story upgrades that same routine to check before
inserting — the merge behavior then covers both existing call sites with no change to either
scenario's own classification code.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/skills/chief-of-staff/SKILL.md` | create — operator-facing pull entry point. Mirrors `plugins/delivery/skills/status/SKILL.md` and `plugins/delivery/skills/challenge/SKILL.md`'s structure: frontmatter `description`, the shared "Where `.delivery/` resolves to" boilerplate (both files carry it verbatim), then a Gather/Assemble step reading `.delivery/chief-of-staff/queue.md` and rendering the ranked briefing |
| `plugins/delivery/agents/chief-of-staff.md` | modify — add (a) briefing-assembly logic: read all `open`-status queue items, rank blocking-first, require a stated default or `no-default-available` on each; (b) upgrade the shared queue-insertion routine (already called by `chief-of-staff-05`/`-07`) with the `FR-49` check-before-insert/merge behavior |
| `plugins/delivery/.delivery/chief-of-staff/queue.md` | reads (all `open` items) and writes (merged entries; re-ranked `Rank` values) — the project-scoped convention file scaffolded by `chief-of-staff-03` |
| `plugins/delivery/templates/chief-of-staff-queue.md` | read-only reference — defines the column schema this story's read/write logic must conform to; not modified by this story |

## Interfaces and contracts to honor

Reproduced verbatim from `architecture.md`'s Interfaces and data contracts section (Chief of
Staff epic), not linked:

**Interface 2 — the `FR-49` merge-on-insert mechanism:**
> `FR-49`'s merge (S-6 and S-10 flagging the same output) is enforced structurally: before
> inserting a queue item, chief of staff checks `.delivery/chief-of-staff/queue.md` for an
> existing open item about the same output and merges into it rather than opening a second
> one.

**Interface 3 — briefing queue entry**, modeled on `templates/findings.md`'s tracked-status
pattern, a single project-scoped file (a delegation period spans multiple sessions, unlike a
ledger event):

| Column | Values / notes |
| :-- | :-- |
| ID | stable per-entry identifier |
| Rank | (re-)computed and written by this story's assembly logic on every run — blocking items first; sub-ordering *within* the blocking or non-blocking group is unspecified by `FR-30` and is not asserted by this story's acceptance criteria |
| Blocking | `y`/`n` — set by the inserting scenario (`chief-of-staff-04`–`-07`) at insert time; this story reads it, never re-derives or overrides it |
| Source | `S-5`/`S-6`/`S-7` per architecture's literal text, extended by this story to `S-10` and merged `S-6+S-10` — see the flagged gap above |
| Item | the candidate question / flagged output text |
| Suggested default, or `no-default-available` | set by the inserting scenario; this story's assembly logic requires the field be non-blank on every item it publishes — it never invents a value to fill a gap |
| Status | `open` / `answered` / `parked` / `pushed` — only `open` items are eligible for this story's briefing |
| Originating agent | which consulting agent's candidate question this traces to |

**Interface 1 note relevant here:** a `queued` outcome (chief of staff's Agent-tool return
contract) always carries "the queue-entry ID and its Blocking flag" — confirming Blocking is
decided once, at insertion, not recomputed by this story.

## Relevant design decisions

- **ADR-002** — chief of staff is a real subagent plus a thin skill wrapper for the
  pull-based briefing. This story *is* that skill wrapper (S-8's pull) and the subagent's
  assembly/merge logic — not a third mechanism layered on top.
- **ADR-003** — the decision log (`FR-20`/`FR-52`) is a separate store from `queue.md`. This
  story does not write decision-log entries: assembling a briefing or merging a duplicate
  queue item is not itself one of `FR-20`/`FR-52`'s trigger conditions. Called out explicitly
  because it is an easy, wrong thing to add speculatively.
- **Roadmap Phase 8 entry criteria** — "Phase 7 **and** Phase 7b both complete — S-8 needs
  real S-5/S-6/S-7 survivors to assemble, and `FR-49`'s merge case is not even testable until
  S-10 exists." This is the literal source of this story's four dependencies below.

## Acceptance criteria

- [ ] `FR-29` — "everything surviving S-5–S-7 accumulates into one briefing per check-in,
  never separate interrupts." ≥2 open items from different source scenarios land in one
  rendered report, never two.
- [ ] `FR-30` — "ranked, blocking first; every item states a suggested default or is
  explicitly marked no-default-available — never a fabricated one." (Exact, already-rewritten
  PRD text.) Blocking ranks first; a no-sensible-default item is marked
  `no-default-available`, never given an invented value.
- [ ] `FR-31` — "an empty briefing is stated explicitly, never silently omitted." Zero `open`
  items → the report plainly states nothing survived triage, never a blank response.
- [ ] `FR-32` — "a non-blocking item unconfirmed past a stated point proceeds on default; a
  blocking item never does." `NFR-6`'s threshold is open (owner qa-strategist) — not invented
  here. Testable now, mechanism-only: a blocking item held indefinitely never silently
  converts to a default (no ceiling, by design). The non-blocking timeout ships as one named
  constant, value TBD.
- [ ] `FR-49` — "an output flagged by both S-6 and S-10 routes as one merged item citing both
  reasons — never two separate routings." An S-6 escalation and an S-10 flag about the same
  output, inserted in either order, produce exactly one queue entry citing both.
- [ ] Case-table row — "Blocking item's operator never returns at all" → "No stated ceiling —
  intentional: proceeding on a fabricated default for a genuinely blocking decision is exactly
  what `FR-32` forbids." No tested duration auto-resolves a stale blocking item to a default.

## Test approach

**Level:** Integration, fixture-driven for `FR-29` and `FR-49` (per `architecture.md`'s own
Test-strategy table: "`FR-29`: ≥2 survivors from different scenarios must land in ONE report,
not two interrupts" and "Queue merge on `FR-49` ... Confirm one merged item, not two"), and
example-based for `FR-30`/`FR-31`/`FR-32`'s mechanism-only half. `FR-49`'s merge case is the
story's own highest-risk case among the mechanisms it directly owns — the risk register's
queue-write-contention entry ("Two subagents dispatched in parallel both resolve a blocking
item and both attempt to update `queue.md` near-simultaneously... the `FR-49` merge check
(read-before-insert) is the same read-modify-write this risk depends on") names this exact
mechanism as what a lost update would corrupt.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Empty queue (no `open` items) | Briefing states plainly that nothing survived triage — never silently absent (`FR-31`) |
| Single open survivor | One-item briefing; states its default or `no-default-available` |
| Multiple open survivors, mixed blocking/non-blocking, mixed sources (S-5 fallthrough, S-6 escalation, S-7 blocked-on-spike, S-10 flag) | One report; blocking items ranked first; non-blocking after (`FR-29`/`FR-30`) |
| An item with no sensible default | Marked `no-default-available` explicitly — never a fabricated placeholder value (`FR-30`) |
| An item missing both a default and the `no-default-available` marker (malformed upstream write) | Assembly surfaces this as a defect, not a silently-passed item and not an assembler-invented default |
| Two items — one from S-6 (untraceable-scope escalation), one from S-10 (mission drift) — about the same output, inserted in either order | Exactly one merged queue item/briefing entry citing both reasons, never two (`FR-49`) |
| A blocking item with no default, unresolved past any tested duration | Never silently converts to a fabricated default — no ceiling, by design |

**Run with:** no automated test runner exists for this plugin's skill/agent logic (same
convention as `harden-06`/`harden-07`); verification is invoking `plugins/delivery/skills/chief-of-staff/SKILL.md`'s
briefing assembly against hand-authored `queue.md` fixtures placed at
`.delivery/chief-of-staff/queue.md` in a scratch test project, and inspecting the rendered
briefing and the resulting `queue.md` state (for the merge cases, confirming the file itself
ends with one entry, not two).

## Out of scope

- **The push exception (`FR-45`/`FR-46`)** — a blocking item with no open counterpart pushed
  outside a pull, delivered alone. `chief-of-staff-09`, built on this story's core.
- **Mid-exchange pause/resume (`FR-47`)** and **concurrent-arrival ordering** (`FR-47`/`NFR-8`,
  inherits Spike CoS-2's batching assumption) — both `chief-of-staff-09`.
- **Grouped/summarized display at volume (`FR-51`)** — "should," not "must"; drops first per
  the roadmap's Phase 8 cut list. `chief-of-staff-09`.
- **`NFR-6`'s exact non-blocking threshold number** — open, owner qa-strategist; not invented
  here.
- **Open Question 15** (is briefing delivery itself atomic?) — flagged, not resolved; owner
  qa-strategist.
- **Decision-log writes on merge or assembly** — no FR requires one; not added speculatively.
- **Semantic/near-duplicate dedup beyond the exact `FR-49` same-output case** — S-6's Case
  table already excludes broader dedup as an MVP-1 non-goal; this merge check is
  exact/near-exact matching only, same discipline.

## Dependencies

- `chief-of-staff-04` (S-5 complete triage) — must be `done`: this story needs real `FR-19`
  fallthrough survivors to accumulate, not stubs.
- `chief-of-staff-05` (S-6 bounce logic) — must be `done`: supplies the escalation-case
  survivors and the queue-insertion call site this story's merge check upgrades.
- `chief-of-staff-06` (S-7 technical-unknown logic) — must be `done`: supplies the
  blocked-on-spike/unclaimed-spike survivors.
- `chief-of-staff-07` (S-10 mission capture + drift-check) — must be `done`: `FR-49`'s merge
  case is not testable until real S-10 flags exist, and `FR-40`'s routing depends on it.
- Transitively via all four: `chief-of-staff-03`'s queue scaffolding (`templates/chief-of-staff-queue.md`,
  `.delivery/chief-of-staff/queue.md`) must already exist — this story reads/writes it but
  does not create it.

This is the literal roadmap Phase 8 entry criterion: "Phase 7 **and** Phase 7b both
complete."

## Implementation notes

Not yet started — `status: ready`, no implementation notes yet.
