<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Declared overrun, same precedent prd.md/architecture.md/roadmap.md/chief-of-staff-01/03/05
already set for this epic: S-8 is roadmap.md's own highest-risk Phase-7 item ("more
Case-table branches than S-6/S-7"), and this story must additionally specify a runtime
spike-authoring procedure with no direct precedent in a prior chief-of-staff story (chief-of-
staff-04/05 modify classification logic only; this one also writes new story files). Cutting
the spike-authoring mechanics, the corrected Open Question 14 citation, or either flagged
reasoned extension to fit the cap would re-hide exactly the context an implementer with no
memory of planning needs — the same "never cut" rule the writing standard states.
-->

---
id: chief-of-staff-06
title: "S-8: route technical unknowns to a spike, never an interrupt"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 7 — S-6/S-7/S-8 complete triage logic"
requirements: [FR-28, FR-29, FR-30, FR-31, FR-53]
depends_on: [chief-of-staff-03]
size: L
---

# S-8: route technical unknowns to a spike, never an interrupt

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work without
> reading `prd.md` or `architecture.md` separately.

## Goal

When a candidate question reaching chief of staff is answerable only by running something and
observing the result — never by the operator's own authority or preference — chief of staff
classifies it as a technical unknown and routes it to a spike: citing a matching open/answered
spike if one already covers it, or creating a new spike story under `.delivery/stories/` if
not, stating what it must answer and what it blocks. The operator never sees this as a raw
interrupt; classification and routing happen inside chief of staff's own turn.

## Context

**Where this sits in the triage pipeline** (`architecture.md`'s Component structure, "checks
for a citable source (S-6), a traced requirement (S-7), or a real-execution unknown (S-8), in
that order"). S-8 classification is reached only by a candidate question that (a) S-6 could
not answer directly — no citable source settles it — and (b) S-7 did not bounce — it *does*
trace to a stated requirement, so it is legitimate scope, not agent-invented. This story's
branch decides, for that remaining question, whether answering it needs real execution
(→ a spike) or only the operator's own judgment (→ a plain `queued` S-9 item, no spike at
all), or a mixture of both.

**Scenario, verbatim from `prd.md`.** Actor: the Spec-Literal Operator (P-2). Trigger: "a
candidate question is answerable only by running something and observing the result."
Grounding: reported — "P-2's preference for execution-traced answers."

> Chief of staff points to a matching open/answered spike if one exists in `architecture.md`'s
> spike table, or creates a new one under `.delivery/stories/` in that same convention, stating
> what it must answer and what it blocks — never sent to the operator as an interrupt. Creating/
> pointing to a spike doesn't make it run; that still requires an agent to pick it up.

**Positioning note (`prd.md`'s epic intro, `architecture.md`'s Component structure) —
deliberately not this story's concern to re-decide:** Solution Architect protects the
delivered solution's technical soundness, unchanged by this epic; "S-8 routes a technical
unknown to Solution Architect's own spike convention rather than duplicating that judgment."
`architecture.md` states the same boundary for the reverse direction: "`solution-architect.md`'s
existing spike-flagging habit already *is* S-8's own mechanism natively... consult chief of
staff only when a technical unknown surfaces outside your own spike-authoring context." This
story never adjudicates whether a spike's *answer* is technically sound — only whether the
*question* is a technical unknown at all, and where it's routed.

**Boundary note, carried into every chief-of-staff scenario (`prd.md`'s epic intro,
`harden-02`'s own finding):** `PostToolUse`/`PostToolUseFailure` fire only after a tool call
resolves — no hook can force consultation or compliance. Every "routes" below means *by
convention* only: `agents/chief-of-staff.md`'s branch produces the correct classification and
writes the correct artifact; nothing prevents a calling agent from skipping the call entirely
(that gap is `FR-51`/bypass-detection territory, out of scope here, per `chief-of-staff-05`'s
own identical framing).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `agents/chief-of-staff.md` | modify — add the S-8 branch, third after S-6/S-7: classify a question reaching this stage as technical-unknown, operator-only, or mixed; produce the `spiked` outcome (citing or creating a spike) and, for the decision half of a mixed question or a pure operator-only question, a plain `queued` outcome |
| `.delivery/stories/` | chief of staff writes new spike story files here at runtime when no matching spike exists — real files, matching `templates/story.md`'s structure and the `harden-02`/`harden-03` naming and content convention (confirmed present in this repo: `harden-02-spike-invocation-reliability.md`, `harden-03-spike-capture-tool-discrimination.md`) |
| `.delivery/chief-of-staff/queue.md` | modify at runtime — the decision half of a split question is appended as an S-8-sourced queue entry marked blocked-on-spike; an unclaimed previously-created spike gets a queue entry marked unclaimed (`FR-53`) |
| `.delivery/architecture.md` | read-only — its two Spikes tables (harden epic's Spike 1–5, this epic's own CoS-1/CoS-2) are one of two places this branch checks for a matching spike before creating a new one |

**File-path note, verified against the repo at time of writing:** `agents/chief-of-staff.md`
does not exist yet in this worktree. It is created by `chief-of-staff-01`'s walking skeleton
and upgraded by `chief-of-staff-03`'s foundational substrate — this story's dependency (see
Dependencies) — before this branch is added. `templates/story.md` (the format `harden-02`/
`harden-03` follow, and the format any spike this story creates must match) is confirmed
present at `plugins/delivery/templates/story.md`.

## Interfaces and contracts to honor

Reproduced from `architecture.md`'s Interfaces and data contracts, and from `chief-of-staff-05`'s
own story-time fix to Interface 1 — not re-derived, reused.

**Interface 1 — consultation call**, including `chief-of-staff-05`'s fix (Interface 1 as
`architecture.md` first wrote it left the calling-agent-identity field unspecified; `-05`
resolved it, and this story reuses that resolution rather than re-deciding it): the calling
agent's prompt states the candidate question verbatim, what it already checked and why nothing
settled it, which of S-6/S-7/S-8 it believes applies (chief of staff may reclassify), and its
own identity ("I am `<agent-name>`, consulting about..."). This branch reads that identity
field for two things: naming what a created spike "blocks" (the calling agent's own work item),
and populating the queue entry's Originating agent column for the decision half of a split.

**Interface 2 — return contract**, this story owns the third outcome and, for the non-technical
and split cases, reuses the fourth:

```
answered  — S-6, with citable traceback
bounced   — S-7, with originating agent and missing requirement
spiked    — S-8, with the spike story's path            <- this story (technical half)
queued    — S-9, with the queue-entry ID and Blocking flag  <- this story (decision half / non-technical)
```

**Interface 3 — queue entry columns** (`ID, Rank, Blocking (y/n), Source (S-6/S-7/S-8), Item,
Suggested default or "no-default-available", Status (open/answered/parked/pushed), Originating
agent`). `Source: S-8` for every entry this branch writes.

**Two reasoned extensions this story makes, flagged explicitly — not literal PRD/architecture
text, the same discipline `chief-of-staff-05` used for its own compound-question extension:**

1. **"Matching spike" corpus (`FR-30`).** `architecture.md`'s own two Spikes tables are fixed,
   solution-architect-curated content this branch cannot add rows to at runtime. A spike this
   branch creates lives only as a story file. For a *second* similar question to correctly cite
   the *first* runtime-created spike instead of duplicating it, the match check must also scan
   `.delivery/stories/` for existing spike story files (title prefix `"Spike:"`, `epic:
   chief-of-staff`, per `harden-02`/`harden-03`'s own naming convention) — not only
   `architecture.md`'s two tables. Flagged for solution-architect confirmation if it proves
   insufficient; not a new architecture decision, an operationalization of the PRD's own
   "matching spike... or creates a new one under `.delivery/stories/`" text.
2. **"Blocked-on-spike" / "unclaimed" marking.** Interface 3's `Status` column has exactly four
   values (`open/answered/parked/pushed`) — no fifth value for either marker. This story carries
   both markers as text inside the `Item` column (e.g. `"Blocked on spike:
   .delivery/stories/chief-of-staff-NN-<slug>.md — <one-line decision still needed once it
   resolves>"`, or `"Unclaimed spike: <path> — created, not yet picked up"`), `Status` staying
   `open`. Same pattern Interface 3 already uses for `"no-default-available"` — a text value in
   an existing column, not a new column or enum value.

## Relevant design decisions

- **ADR-002** — chief of staff is a real subagent invoked via the Agent tool. The S-8
  classification, spike-authoring, and split/unclaimed logic all live once inside
  `agents/chief-of-staff.md`, never duplicated as inline reasoning inside a calling agent's own
  turn — the narration-not-invocation failure this epic exists to make ledger-visible.
- **Positioning note (above)** — governs the boundary between this story's classification job
  and Solution Architect's spike-authoring/technical-soundness job; this story never re-decides
  the latter.
- **`chief-of-staff-05`'s Interface 1 fix** — reused, not re-specified, for the calling-agent
  identity field this branch depends on.

## Acceptance criteria

Copied verbatim from `prd.md`'s S-8 section, priority per the FR summary table (not the
table's shortened restatement):

- [ ] `FR-28` (must) — classified as a technical unknown only when answerable by real
  execution, not operator authority.
- [ ] `FR-29` (must) — routes to a spike story under `.delivery/stories/`, per
  `architecture.md`'s convention — not an ad hoc interrupt.
- [ ] `FR-30` (should) — a matching existing spike is cited instead of a duplicate.
- [ ] `FR-31` (must) — a mixed technical/decision question splits correctly; neither half
  dropped.
- [ ] `FR-53` (should) — an unclaimed spike surfaces in S-9's briefing as unclaimed, never
  sitting indefinitely with no visibility. The trigger threshold is not yet decided (**Open
  Question 14**, corrected: `prd.md`'s own S-8 prose inline-cites "Open Question 18," which
  does not exist in the Open Questions table; `architecture.md`'s Test strategy section names
  this a PRD numbering defect and gives #14, the same question the Open Questions table itself
  lists as "does a bounced question (S-7) or an unclaimed spike (S-8/`FR-53`) time out and
  escalate after a count, a duration, or never?"); what's fixed now is that it's marked, never
  silently dropped.
- [ ] Case table — matching spike already exists: cited; no duplicate created.
- [ ] Case table — part technical-unknown, part operator-only decision: splits — technical half
  to a spike (cited or created), decision half to an S-8-sourced S-9 queue item marked
  blocked-on-spike; both halves independently verifiable to exist, neither silently dropped.
- [ ] Non-technical question — a question answerable only by operator authority is **not**
  classified as a technical unknown; no spike is created or cited for it, it falls through as a
  plain `queued` outcome. *(Not a literal `prd.md` S-8 Case-table row — derived from `FR-28`'s
  own text plus `architecture.md`'s Test-strategy note naming this "the actual risk, not the
  happy path." Flagged as a reasoned extension, not a copied fact, same convention
  `chief-of-staff-05` used for its own compound-question row.)*

## Test approach

**Level:** two levels, matching `architecture.md`'s own two separate Test-strategy rows for
S-8 — do not fold them into one.
- Classification + citation (`FR-28`–30): **example-based / integration.** Risk: High —
  "misclassifying an operator-only decision as technical removes it from the operator's hands,
  the same substitution risk as S-6."
- Split + unclaimed escalation (`FR-31`, `FR-53`): **integration.** Risk: Medium-high — "a
  dropped half or an invisible unclaimed spike each defeat S-8's purpose." Exact reasoning,
  quoted: for `FR-31`, "one mixed input, confirm both outputs exist — spike AND an S-9 item
  marked blocked-on-spike, a single-output check would miss a dropped half"; for `FR-53`, "test
  only the qualitative 'marked, never silently dropped' behavior" — the exact trigger point
  stays open (Open Question 14).

**Cases:**

| Case | Fixture | Expected |
| :-- | :-- | :-- |
| Genuine technical unknown, no existing spike matches | Candidate question answerable only by running something and observing the result; neither `architecture.md`'s two Spikes tables nor `.delivery/stories/`'s existing spike files cover it | New spike story created under `.delivery/stories/`, matching `templates/story.md`'s structure (frontmatter, Goal states what it must answer, Context/Files/AC/Test-approach sections present, `status: draft`); `spiked` outcome states its path; states what it blocks (the calling agent's own work item, from Interface 1's identity field) |
| Genuine technical unknown, matching spike exists | Same kind of question, but `architecture.md`'s tables or `.delivery/stories/` already carry one covering it | `spiked` outcome cites the existing spike's path; no new story file created |
| Mixed technical/decision question | One candidate question with a real-execution-answerable half and an operator-authority-required half | Both halves exist afterward: a spike (cited or created) for the technical half, and a separate `.delivery/chief-of-staff/queue.md` entry, `Source: S-8`, `Item` text marked blocked-on-spike naming that spike's path, for the decision half |
| Non-technical question | Candidate question answerable only by the operator's own preference/authority, no execution could settle it | Not classified as technical; no spike created or cited; falls through as a plain `queued` outcome, `Source: S-8` |
| Unclaimed spike | A spike story this branch previously created remains `status: draft`, not yet picked up, on a later invocation | A `.delivery/chief-of-staff/queue.md` entry exists (created if missing, not duplicated if present), `Source: S-8`, `Item` text marked unclaimed naming the spike's path — present unconditionally on every pass that finds one, since no numeric age/count threshold exists yet (Open Question 14); never simply absent |

**Run with:** no automated test runner exists for this epic — `architecture.md`'s own
constraint, zero executable code, `agents/chief-of-staff.md` is markdown, not a function. For
each fixture, dispatch a real Agent-tool call — `subagent_type: "delivery:chief-of-staff"` —
with a prompt built to Interface 1's shape (candidate question verbatim, what was checked, the
calling agent's belief that S-8 applies, and its own identity). Inspect the actual returned
outcome and the actual file/queue writes directly — never stub the classification, the same
discipline `chief-of-staff-04`/`-05` applied. Confirm the call itself lands in
`.delivery/invocations/<session_id>.ndjson` as a real `Agent`/`chief-of-staff` entry
(`harden-05`'s already-proven ledger). For the spike-creation fixtures, additionally open the
produced story file and check it against `templates/story.md`'s section list and the
`harden-02`/`harden-03` naming precedent, not just that a file exists.

## Out of scope

- S-6/S-7's own classification logic — `chief-of-staff-04`/`-05`, both `status: ready` in this
  repo already. This story does not depend on either being `done` first — `roadmap.md`'s Phase
  7 lists S-6/S-7/S-8 as three independent work items under the same phase, not sequenced
  against each other — but all three modify the same `agents/chief-of-staff.md` file; be aware
  of that shared-file surface, not a real ordering conflict, since the S-6→S-7→S-8 call
  sequence is already fixed by `architecture.md`'s Component structure regardless of which
  story lands first.
- **Actually running a spike, or claiming it** — `prd.md`'s own boundary, verbatim: "Creating/
  pointing to a spike doesn't make it run; that still requires an agent to pick it up." This
  story only produces a correctly-formatted, correctly-routed spike story file or citation.
- **Open Question 14's exact trigger threshold** (count, duration, or never, for `FR-53`'s
  unclaimed-spike escalation) — owner qa-strategist, future work. This story ships the
  mechanism (mark unconditionally on every pass that finds one); only the number waits, same
  precedent `architecture.md` states for `NFR-6`.
- **S-9's briefing assembly** that ultimately displays a blocked-on-spike or unclaimed queue
  item to the operator — `chief-of-staff-08`/`-09`. This story verifies only that the correct
  queue entry is written with the correct marking; whether it renders correctly inside an
  assembled briefing is that story's own acceptance criteria.
- **Back-registering a chief-of-staff-created spike into `architecture.md`'s own Spikes
  tables** — not specified by `prd.md` or `architecture.md`; this story's matching-corpus
  extension (scanning `.delivery/stories/`) is how `FR-30`'s no-duplicate requirement is met
  without it. Flagged for solution-architect if the corpus proves insufficient in practice.
- **Judging a spike's technical soundness, or whether the created question is well-posed** —
  epic-wide non-goal pattern (same as S-7's scope-adjudication boundary): S-8 routes and names,
  Solution Architect's own spike convention owns the judgment.

## Dependencies

- **`chief-of-staff-03`** (foundational substrate, Phase 6) — must be `done` first. It provides
  the registered `agents/chief-of-staff.md` subagent this story modifies, the four-outcome
  return contract (`answered`/`bounced`/`spiked`/`queued`) this story's `spiked`/`queued`
  outcomes must conform to, and the `queue.md` scaffolding (Interface 3) the split and
  unclaimed-marking paths write into. Without it there is no file to modify and nowhere to
  write a queue entry.
- **`chief-of-staff-08`/`-09`** (S-9 briefing assembly, Phase 8) — needed only to verify,
  end-to-end, that a blocked-on-spike or unclaimed queue entry actually surfaces correctly
  inside S-9's assembled briefing. Non-blocking for this story: the routing logic itself —
  classifying the question, citing or creating the spike, writing the correctly-marked queue
  entry — is verified directly against Interface 3's schema without either story existing yet,
  the same posture `chief-of-staff-05` took toward `chief-of-staff-08`.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
