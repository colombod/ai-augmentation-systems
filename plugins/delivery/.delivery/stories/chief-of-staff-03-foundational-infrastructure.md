<!--
BUDGET — target 700 words, hard cap 1200 words (excludes code/YAML/tables).
Declared overrun below, same reasoning prd.md/architecture.md/roadmap.md already state for
this epic: four interfaces with an exact schema each cannot be thinned without losing content
a later story reads as input.
-->

---
id: chief-of-staff-03
title: Build the chief-of-staff foundational substrate — decision log, mission/queue scaffolding, FR-51 fallback
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 6 — foundational infrastructure"
requirements: [FR-51, FR-23, FR-55]
depends_on: [chief-of-staff-01]
size: L
---

# Build the chief-of-staff foundational substrate

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.
>
> **Word-budget note: ~2,100 prose-only words, past the template's 1200-word cap** (`awk`
> excluding table rows and code fences over this file — same method `architecture.md`'s own
> header uses). Declared, not silent, same reasoning `prd.md`/`architecture.md`/`roadmap.md`
> already state for this epic — and a smaller overrun ratio than any of those three (~1.75x
> here vs. `architecture.md`'s ~2.4x, `roadmap.md`'s ~3.5x). Four interfaces, each with an
> exact schema or column set a later story (04–08) reads as input, cannot be thinned without
> deleting content the implementer needs — cutting any one to fit the budget would just move
> the missing context into a future story's own rediscovery.

## Goal

Turn `chief-of-staff-01`'s thin walking skeleton — a real S-6 citation check, everything else
stubbed, per `roadmap.md`'s Phase 5 — into the real foundational substrate every later
chief-of-staff story reads or writes: the full four-outcome return contract
(`answered`/`bounced`/`spiked`/`queued`), the decision log, `mission.md`/`queue.md`
scaffolding, and the `FR-51` unavailability fallback made concretely testable. Nothing here is
end-user-visible triage behavior yet — it is the substrate S-6–S-9/S-11's real logic (stories
04–08) gets built on top of, per `roadmap.md`'s own Phase 6 entry: "the shared substrate every
later scenario reads or writes."

## Context

`roadmap.md`'s dependency map is explicit: `Phase 5 (CoS-1, CoS-2) → Phase 6 (subagent +
decision log + mission.md + queue.md + FR-51) → Phase 7 (S-6/S-7/S-8) / Phase 7b (S-11) →
Phase 8 (S-9)`. S-6's `FR-23`, S-11 entirely, and S-9's queue-reading all read or write what
this story builds — none of Phase 7/7b/8's real logic can start without it.

**Why `chief-of-staff-01` is a hard gate, not a soft preference:** `roadmap.md`'s Phase 6 entry
criteria state plainly — "Phase 5's CoS-1 result clears its pass bar (≥70% real-consultation
rate, not lower than the narrated-without-invocation rate). A result below bar does not enter
this phase — it goes to product-owner instead, per `ADR-002`." `ADR-002`'s own revisit clause
is stronger than an ordinary risk: a bad CoS-1 result means "the epic's core premise — a
convention-only mechanism can raise consultation rates enough to matter — is unworkable as
scoped," routed back to product-owner as a scope call, not to solution-architect as an
engineering problem to solve harder. If `chief-of-staff-01`'s CoS-1 result comes back below
bar, **this story does not proceed as scoped** — see Dependencies.

**Positioning, restated because it explains why this substrate exists at all** (full framing:
`prd.md`'s epic intro): chief of staff is the third of three senior lenses — alongside
Business Analyst (the business proposition) and Solution Architect (the delivered solution's
soundness, unchanged by this epic) — protecting the previously-unowned invariant: the human
principal's attention and stated mission. The decision log is how a wrong chief-of-staff
judgment gets recorded rather than silently corrected; `mission.md` is how "the reason the
effort exists" gets a stable, checkable location instead of living only in the operator's head
or a paraphrase.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/chief-of-staff.md` | modify — upgrade `chief-of-staff-01`'s walking-skeleton return shape to the full four-outcome contract (Interface 1 below); everything else in this file (S-6/S-7/S-8 classification logic itself) is out of scope — stories 04–08 |
| `.delivery/chief-of-staff/decision-log/<session_id>.ndjson` | new, runtime-created, one file per session, git-tracked with the consuming project (in this repo, that resolves to `plugins/delivery/.delivery/chief-of-staff/decision-log/`, mirroring how `plugins/delivery/.delivery/invocations/` already exists from `harden-05`'s own dogfooding) — schema per Interface 2 |
| `plugins/delivery/templates/mission.md` | create — the template `.delivery/chief-of-staff/mission.md` is instantiated from; schema per Interface 4 |
| `.delivery/chief-of-staff/mission.md` | new, runtime-created — current captured mission + revision-history table |
| `plugins/delivery/templates/chief-of-staff-queue.md` | create — modeled on `templates/findings.md`'s tracked-status pattern (verified: `plugins/delivery/templates/findings.md` exists — ID/Status/Severity per-row tracking, a summary table, items that leave the list only by being resolved or explicitly rejected, never by silent omission); columns per Interface 3 |
| `.delivery/chief-of-staff/queue.md` | new, runtime-created — instantiated from the template above |

**Not in this story's file list, and why that matters for `FR-51`:** the `FR-51` fallback
*text* — "the trigger condition, the exact call to make, and the `FR-51` fallback" — was
already written by `chief-of-staff-01` into the pointer sections of the ≥2 consulting-agent
files CoS-1's own bar required (per `architecture.md`'s Component structure: every
per-file pointer section states the fallback from the start, not added later). This story
does not re-author that text. What Phase 6 adds is making it **verifiable**: a fixture that
simulates the chief-of-staff Agent-tool call failing/erroring/unconfigured, run against
whichever ≥2 files `chief-of-staff-01` actually touched, confirming the fallback fires as
written. Open `chief-of-staff-01`'s own Implementation Notes once it exists to find which
files those are — this story cannot name them in advance.

## Interfaces and contracts to honor

Reproduced from `architecture.md`'s Interfaces and data contracts section (Chief of Staff
epic), not linked.

**Interface 1 — consultation return contract**, resolving feature-critic finding 5
(`FR-48`/49 had no described invocation path). The Agent tool's own contract is a
natural-language prompt, not a schema — chief of staff's response always states exactly one
of four outcomes:

```
answered  — S-6, with citable traceback
bounced   — S-7, with originating agent + missing requirement
spiked    — S-8, with the spike story's path
queued    — S-9, with the queue-entry ID and its Blocking flag (y/n)
```

The push mechanic this return contract feeds (`FR-48`/49: a `queued` outcome with `Blocking:
y` and no open counterpart leads the calling agent's own next reply) is Phase 8's job, not
this story's — this story only needs the outcome shape to exist and be stable, since Phase
7/7b/8's real classification logic writes into it.

**Interface 2 — decision-log entry**, resolving Open Question 7 (own store — `ADR-003`):

```json
// .delivery/chief-of-staff/decision-log/<session_id>.ndjson — one line per event
{"ts":"2026-08-07T10:00:00Z","session_id":"...","category":"inference-not-citation",
 "fr":"FR-23","scenario":"S-6",
 "citable_traceback":"none — inferred from a general pattern, not a cited line",
 "summary":"answered a scope question by inference instead of falling through to S-7",
 "raised_by":"qa-strategist","resolution":"open"}
```

**Minimum required fields, per the glossary's own definition of Decision log:** `category`,
`citable_traceback` (or the answer text it's absent from), `ts`. `fr`, `scenario`,
`raised_by`, `resolution` are the proposed remaining shape, revisable at story time — this is
that story-time revision; ship them, but they are the first thing to cut under pressure per
`roadmap.md`'s own Phase 6 cut list ("the three minimum-required fields... are not cuttable,
they are the glossary's own definition of a decision-log entry" — the rest are). `resolution`
starts `open`, moves to `reviewed-accepted` or `corrected` — never deleted, same "flagged,
reviewed, accepted" precedent S-2's marker already set.

**Interface 3 — briefing queue entry**, modeled on `templates/findings.md`'s tracked-status
pattern:

| Column | Values |
| :-- | :-- |
| ID | stable identifier |
| Rank | ordering within the briefing |
| Blocking | y / n |
| Source | S-6 / S-7 / S-8 |
| Item | the candidate question or flagged output |
| Suggested default | text, or `no-default-available` — never a fabricated default |
| Status | open / answered / parked / pushed |
| Originating agent | which agent's turn produced this item |

A single project-scoped file, not per-session — a delegation period spans multiple sessions,
unlike a ledger event.

**Interface 4 — mission capture**, resolving Open Question 11: `.delivery/chief-of-staff/
mission.md`, a standalone file, not `brief.md`'s frontmatter (different mutation lifecycle)
and not the decision log (a current-value lookup needs one stable location, not a per-session
append log to scan). Contains the current captured mission (verbatim excerpt or citable
pointer, never chief of staff's own paraphrase — `FR-40`, enforced starting Phase 7b; this
story ships only the container) and a revision-history table: prior text, replaced-on
timestamp, `requested_by`, and a `status` column (`pending` / `confirmed`) this story adds to
carry the mechanism below.

**Open Question 10 is a product-owner call, not an architecture one** (who has standing to
recapture the mission) — this story does not resolve it. What it commits to, so the answer has
somewhere to land either way: the revision-history table always records `requested_by`,
regardless of policy. If product-owner's eventual answer is "operator only," an agent-proposed
recapture is written with `status: pending` and does not update `mission.md`'s current value
until confirmed; if the answer is broader, `status: confirmed` applies immediately. The
`status` column is this story's mechanism for supporting either answer without hardcoding one
— exactly what `architecture.md` specifies.

## Relevant design decisions

- **`ADR-002`** — chief of staff is a real subagent, invoked directly via the Agent tool. This
  is why `chief-of-staff.md`'s return contract (Interface 1) matters for `FR-51`: a failed or
  erroring call is a real, ledger-visible Agent-tool failure the calling agent's fallback text
  can detect — not a swallowed exception inside another agent's own reasoning. `ADR-002`'s
  revisit clause is this story's hard gate (see Context and Dependencies).
- **`ADR-003`** — the decision log is its own append-only NDJSON store, per session, distinct
  from `.delivery/invocations/`. It never shares a file or a schema with the invocation
  ledger — a free-text `citable_traceback` field would break `ADR-001`'s binding whitelist if
  it landed in the ledger instead. Directly governs Interface 2's file location and schema
  independence.
- **Naming-collision risk, named in both `architecture.md` and `roadmap.md`'s Risks tables:**
  `.delivery/chief-of-staff/decision-log/` reads as easily confused with `.delivery/decisions/`
  (ADR files) by an implementer skimming the tree. Distinct nesting and naming is the stated
  mitigation — do not nest this story's new directory under `.delivery/decisions/` by mistake.

## Acceptance criteria

- [ ] `FR-51` — a fixture simulates the chief-of-staff Agent-tool call failing, erroring, or
  being unconfigured, run against the ≥2 consulting-agent pointer-section files
  `chief-of-staff-01` authored; the calling agent's stated behavior is to ask the operator
  directly — never blocks indefinitely, never silently drops the candidate question.
- [ ] `FR-23`/`FR-55` (schema only — trigger logic is Phase 7/7b's job, not this story's) — a
  hand-authored decision-log entry validates as well-formed NDJSON carrying at minimum
  `category`, `citable_traceback`, `ts`, at the path `.delivery/chief-of-staff/decision-log/
  <session_id>.ndjson`, structurally distinct from `.delivery/invocations/<session_id>.ndjson`
  (no shared file, no shared schema, per `ADR-003`).
- [ ] `agents/chief-of-staff.md` states the full four-outcome return contract (Interface 1) —
  every outcome names its own required content (`answered`: citable traceback; `bounced`:
  originating agent + missing requirement; `spiked`: spike story path; `queued`: queue-entry
  ID + Blocking flag).
- [ ] `templates/mission.md` defines the schema in Interface 4: current mission value +
  revision-history table with `requested_by` and `status` (`pending`/`confirmed`) columns. A
  hand-fired fixture captures a verbatim mission excerpt, then records one recapture, and the
  resulting `.delivery/chief-of-staff/mission.md` shows `requested_by` populated regardless of
  who proposed it — the mechanism does not hardcode Open Question 10's unresolved answer.
- [ ] `templates/chief-of-staff-queue.md` defines the 8 columns in Interface 3. A hand-fired
  fixture appends one real entry to `.delivery/chief-of-staff/queue.md` with all 8 columns
  populated (or `no-default-available` where that's the honest value).

## Test approach

**No vertical slice is possible yet.** Every demonstrable-exit bullet in this story is a
hand-fired fixture — a canned decision-log write, a canned mission.md recapture, a canned
queue append, a simulated chief-of-staff-unavailable case — not real S-6/S-7/S-8 triage
behavior, because that classification logic does not exist until stories 04–07 (Phase 7/7b)
run against it. This is the same posture `harden-05` took before `harden-02` gave the
invocation ledger real live traffic: unit/fixture coverage on the mechanism's own logic and
shape, explicitly not re-testing a claim ("does chief of staff correctly classify, does it get
consulted often enough") that belongs to a later, live-session-dependent story. Stated plainly
here rather than left implicit, per `architecture.md`'s own Test strategy section: "no fixture
substitutes for a real session" for the compliance question, and — specific to this story —
"no code to feed a canned payload to" for the decision-log format check, since `ADR-003` names
no shared writer script the way the invocation ledger has `record-invocation.js`.

**Level:** example-based (fixture-driven). No integration or e2e level applies — there is no
real classification pipeline yet to integrate against.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Canned decision-log entry, all 3 minimum fields present | Valid NDJSON, parses, fields match Interface 2 |
| Canned decision-log entry, a required field missing | Fails the fixture check — confirms the check is real, not a rubber stamp |
| Chief-of-staff Agent-tool call simulated as failing/erroring/unconfigured | Calling agent's fallback text (in `chief-of-staff-01`'s pointer sections) directs asking the operator directly — never blocks, never drops the question |
| Canned mission.md recapture, `requested_by` populated by an agent | Revision-history row records it with `status: pending`, current mission value unchanged until a separate confirm fixture runs |
| Canned mission.md recapture, `requested_by` populated by the operator directly | Row records `status: confirmed`, current mission value updates |
| Canned queue.md append, all 8 columns populated | Entry appears with `Status: open`, no columns silently blank |
| Canned queue.md append, no suggested default exists | `Suggested default` column reads `no-default-available`, never fabricated |

**Run with:** no automated command exists for this — per `architecture.md`'s own Test
strategy ("no shared writer script exists per `ADR-003`... there is no code to feed a canned
payload to"), every case above is verified by hand-authoring the fixture input, running the
relevant agent/template convention against it, and inspecting the actual file written —
never stubbing the judgment. This matches the harden epic's own precedent of not inventing a
test command that doesn't correspond to real code.

## Out of scope

- S-6/S-7/S-8's actual triage logic (citation classification, bounce classification, technical-
  unknown routing) — stories 04–07, Phase 7.
- S-9's briefing assembly, the push mechanic (`FR-48`/49), and `skills/chief-of-staff/
  SKILL.md` (the operator-facing pull entry point) — story 08, Phase 8.
- S-11's drift-check logic (checking new output against the captured mission, the Case-table
  behaviors, `FR-40`–43 in full) — Phase 7b, a separate story. This story ships only the
  storage container `FR-40` will later write correctness rules against.
- The 9-agent pointer-section rollout — story 10, Phase 9. This story's `FR-51` fixture tests
  only the ≥2 files `chief-of-staff-01` already touched.
- `NFR-6`'s non-blocking-default threshold number, `NFR-11`'s decision-log retention policy —
  both open numbers/policy calls owned by qa-strategist/product-owner, mechanism-only here.
- Re-authoring the `FR-51` fallback text itself — already written by `chief-of-staff-01`; see
  Files and modules.

## Dependencies

- `chief-of-staff-01` must be `done` first, and specifically its CoS-1 spike result must clear
  the pass bar `roadmap.md`'s Phase 6 entry criteria state (≥70% real-consultation rate, not
  lower than the narrated-without-invocation rate). **If CoS-1 came back below that bar, this
  story does not proceed as scoped** — per `ADR-002`'s revisit clause, that result routes back
  to product-owner as a scope call (is a detectable-not-enforced mechanism still worth shipping
  at the measured rate?), not to solution-architect as an engineering problem to solve harder.
  Do not begin this story's build against an unresolved or failing CoS-1 result.
- This story also needs to know which ≥2 consulting-agent files `chief-of-staff-01` added a
  pointer section to, for the `FR-51` fixture's target — read that from `chief-of-staff-01`'s
  own Implementation Notes once it exists.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
