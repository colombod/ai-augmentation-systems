<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

---
id: chief-of-staff-07
title: "S-10: capture and defend the original mission"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 7b — S-10 mission capture + drift-check (parallel with Phase 7)"
requirements: [FR-37, FR-38, FR-39, FR-40, FR-52]
depends_on: [chief-of-staff-03]
size: M
---

# S-10: Capture and defend the original mission

> This file is the complete context. Someone opening only this file — a teammate who
> missed the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

The operator's stated reason for an effort existing is captured once, in their own words or
a direct pointer to it, and every later output — regardless of whether it separately traces
to a stated requirement — gets checked against that captured text. A mismatch is named and
routed for a human to judge; chief of staff never decides, blocks, or reverts on its own.

## Context

**Actor:** The Spec-Literal Operator (`P-2`). **Trigger:** intent is first stated, and
again whenever new output is produced anywhere in the pipeline. **Grounding:** reported —
the operator's own repeated act of restating intent during this epic's own scoping session
(`prd.md` S-10).

**Why this is a second check, not a duplicate of S-6 (`chief-of-staff-04`/`05`/`06`):**
S-6 is reactive and narrow — it passes anything that traces to a stated requirement, full
stop. S-10 is proactive and broader: it checks output against the captured mission itself,
one level above any individual requirement, and still fires even when S-6 passed the same
output, because a requirement can be scoped loosely enough to permit an implementation that
no longer serves why the effort exists.

**Where this sits in the epic's own framing (`prd.md` epic intro; reaffirmed in
`architecture.md`'s Approach):** the pipeline's three senior roles each protect a distinct
invariant, the way three independent forces converge a system in a particle filter — not
central control, each acting locally on what it alone is positioned to protect. Business
Analyst protects the business proposition; Solution Architect protects the delivered
solution's soundness (unchanged by this epic — S-7 defers to it rather than duplicating the
judgment); Chief of Staff protects the third, previously-unowned invariant: the human
principal's attention and the mission they actually stated. S-6 checks traceability
(adjacent to Business Analyst's lens, at the level of one question); **S-10 checks mission
alignment — the lens this epic adds.** This is positioning, not a separate requirement: it
explains why S-6 and S-10 are two checks, not one, and why the same output can pass one and
fail the other.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/chief-of-staff.md` | modify — add S-10's mission-capture and drift-check logic. The file, the subagent registration and its four-outcome return contract (`answered`/`bounced`/`spiked`/`queued`) already exist by this point in the epic (Phase 5–6 work); this story adds a fifth capability to the same agent, not a new file. |
| `plugins/delivery/.delivery/chief-of-staff/mission.md` | reads and writes — the current captured mission plus its revision-history table. Scaffolded by `chief-of-staff-03` from `templates/mission.md`; this story is the first consumer that writes a *revision* to it (recapture), not only the initial capture. |
| `plugins/delivery/.delivery/chief-of-staff/decision-log/<session_id>.ndjson` | writes — one entry per recapture (`category: mission-recaptured`) and one entry per wrong drift flag (`FR-52`). Mechanism built by `chief-of-staff-03` (Phase 6); this story is a second writer to an already-proven store (`ADR-003`). |
| `plugins/delivery/.delivery/chief-of-staff/queue.md` | reads — before routing a new drift flag, checked for an existing open item about the same output so a flag that also fails S-6 merges instead of opening a second item (`FR-49`, S-10's own half — see Out of scope). |

## Interfaces and contracts to honor

Reproduced from `architecture.md`'s Interface 4 (Mission capture, resolving Open Question
10) — do not redesign this shape, only implement against it:

```
.delivery/chief-of-staff/mission.md
  - Current mission: verbatim excerpt of the operator's stated intent, OR a direct citable
    pointer to brief.md's problem framing — never chief of staff's own paraphrase (FR-37).
  - Revision history table: | Prior text | Replaced-on (timestamp) | requested_by |
    Every recapture appends a row here before the current value changes.
```

```json
// .delivery/chief-of-staff/decision-log/<session_id>.ndjson — one line per event
// FR-52 entry, reusing FR-20's minimal shape (per architecture's Interface 2):
{"ts":"2026-08-07T10:00:00Z","session_id":"...","category":"mission-drift-flag-wrong",
 "fr":"FR-52","scenario":"S-10","citable_traceback":"<the mission line originally cited>",
 "summary":"drift flag against <output> found wrong on review","resolution":"open"}
// Recapture entry (architecture.md line 380):
{"ts":"...","session_id":"...","category":"mission-recaptured","fr":"FR-52","scenario":"S-10",
 "citable_traceback":"<new mission text or pointer>","summary":"mission recaptured, requested_by=<who>"}
```

Minimum required fields per the glossary's Decision log definition: `category`,
`citable_traceback` (or the text it's absent from), `ts`. The `mission-drift-flag-wrong`
category name is this story's own proposal, following `FR-20`'s `inference-not-citation`
naming pattern — architecture leaves the exact string open ("revisable at story time"), so
implement it consistently, don't treat it as already fixed elsewhere.

**Merge structural note (`FR-49`, S-10's calling side only):** architecture's Interface 2
states the rule generically — "before inserting a queue item, chief of staff checks
`queue.md` for an existing open item about the same output and merges into it rather than
opening a second one." This story's obligation is to make S-10's drift-flag insert path
call that same check before writing, citing both reasons when a merge happens. It does not
implement S-6's insert path (`chief-of-staff-04`/`05`/`06`) or prove the merge end-to-end
with a real S-6 bounce — see Test approach and Out of scope.

## Relevant design decisions

| Decision | Why it applies here |
| :-- | :-- |
| `ADR-002` | Chief of staff is a real subagent, not inline reasoning inside another agent's turn. S-10's capture-and-check logic lives inside `agents/chief-of-staff.md` itself, invoked the same way S-5/S-6/S-7 already are — not a second mechanism. |
| `ADR-003` | The decision log is its own NDJSON store, per session, distinct from the invocation ledger. `FR-52` and the recapture entry are both writes to that same store, not a new one. |
| Interface 4 / Open Question 10 (resolved) | The mission lives in a standalone file, not `brief.md`'s frontmatter (different mutation lifecycle: `brief.md` is written once and rarely revised; the mission is checked continuously and recapturable mid-effort) and not the decision log (a current-value lookup needs one stable location, not a per-session append log to scan). |

**Open Question 9 (explicitly unresolved — product-owner's call, not this story's):** who
has standing to recapture the mission. Architecture's worked example for product-owner:
*"if an agent, mid-effort, believes the original goal has shifted enough to justify
recapturing it, should that proposal go straight into effect, or sit as a flagged
suggestion until you say yes — the same way a stage backed only by `assumed` evidence gets
flagged rather than silently accepted?"* Until answered, this story implements the
conservative branch the mechanism was built to support either way: an **operator-issued**
recapture takes effect immediately (the operator's standing is never in question under any
answer); an **agent-proposed** recapture is appended to the revision-history table as a
*pending* row with `requested_by` naming the agent, and does **not** change `mission.md`'s
current value until the operator confirms it. Both branches always record `requested_by`,
regardless of which fired (Interface 4).

## Acceptance criteria

- [ ] `FR-37` — captured mission is a verbatim excerpt or a direct citable traceback — never
  chief of staff's own paraphrase.
- [ ] `FR-38` — new output checked against the captured mission regardless of S-6's verdict.
- [ ] `FR-39` — a drift flag names the specific mission line, the diverging output, and the
  connecting reason.
- [ ] `FR-40` — drift surfaces through existing routing, never unilaterally blocked or
  reverted.
- [ ] `FR-52` — a wrong drift flag is recorded in the decision log using `FR-20`'s minimal
  record content, not silently corrected.
- [ ] Every row of the Case table under Test approach is itself a falsifiable criterion, not
  merely a fixture — not restated here to avoid saying the same thing twice (per this
  plugin's own writing standard).

## Test approach

**Level:** example-based, per `architecture.md`'s own Test strategy section — this epic
ships zero executable code (`agents/chief-of-staff.md` is markdown), so every case below
means invoking the real agent against hand-authored fixture input and inspecting its actual
output and file writes, never stubbing the judgment itself.

| Case | Expected |
| :-- | :-- |
| No captured mission exists yet | States plainly drift-checking is unavailable — never fabricates one (`FR-37`, Case table) |
| Verbatim excerpt captured | Accepted, stored as the current mission text |
| Citable pointer to `brief.md`'s problem framing captured | Accepted as the alternative to a verbatim excerpt |
| Chief of staff attempts its own paraphrase instead | Rejected — the actual risk, not the happy path (architecture's own S-10 fidelity test row) |
| Output traces cleanly to a real requirement (passes S-6) but still diverges from the captured mission | **Still flagged by S-10** — the case that distinguishes S-10 from S-6 (`FR-38`) |
| A drift flag is raised | Names the specific mission line, the diverging output, and the connecting reason — not a general "this seems off" (`FR-39`) |
| A drift flag is raised | Surfaces through existing routing (S-8's queue, or a bounce-style note) — never unilaterally blocked or reverted (`FR-40`) |
| Deliberate mid-effort recapture, operator-issued | Mission.md's current value updated immediately; prior text + timestamp + `requested_by` recorded in the revision-history table; one decision-log entry, `category: mission-recaptured` |
| Deliberate mid-effort recapture, agent-proposed | Recorded as a *pending* revision-history row with `requested_by` naming the agent; current mission value unchanged until the operator confirms (Open Question 9's conservative default) |
| A flagged item later judged legitimate evolution | Flag resolved, not deleted — recorded "flagged, reviewed, accepted" |
| A wrong drift flag | Recorded in the decision log using `FR-20`'s minimal content — `category`, `citable_traceback`, `ts` — never silently corrected (`FR-52`) |
| Output failing S-6 *and* independently flagged by S-10 | `queue.md` already carries an open S-6 item for the same output; confirm S-10's insert path finds it and merges, citing both reasons, rather than opening a second item — this fixture stubs the S-6 item by hand-authoring it into `queue.md`, since `chief-of-staff-04`/`05`/`06` may not exist yet; real end-to-end proof (a live S-6 bounce merging with a live S-10 flag) needs `chief-of-staff-08` (`FR-49`, partial coverage here — say so, don't claim full) |

**Run with:** no automated test runner exists for this plugin's agent-markdown logic (same
constraint `harden-07` documents). Verification is walking each fixture above through
`agents/chief-of-staff.md`'s described behavior and inspecting the resulting `mission.md`
content, `queue.md` entry, and decision-log NDJSON line — not a passing/failing script.

## Out of scope

| Item | Why |
| :-- | :-- |
| Who has standing to approve a recapture (Open Question 9) | Product-owner's call, not resolved here. This story implements the mechanism so either answer lands correctly (operator-issued takes effect immediately; agent-proposed stays pending) — it does not pick one. |
| S-9's learning from mission-drift patterns | Stage-2, deferred per the PRD (`prd.md` S-9's own Grounding: assumed, zero data until S-5–S-8 ship). |
| Full end-to-end proof of `FR-49`'s merge with a real S-6 output | Needs a real S-6 bounce to merge against — `chief-of-staff-04`/`05`/`06` (Phase 7) — and consumption by S-8's briefing (`chief-of-staff-08`, Phase 8). This story verifies S-10's own insert-side check against a hand-authored `queue.md` fixture only. |
| The 9-agent standing-instruction rollout (each consulting agent's short "## Chief of staff" pointer section) | Phase 9's work, unrelated to this story's file list. |

## Dependencies

| Story | Relationship | Why |
| :-- | :-- | :-- |
| `chief-of-staff-03` | Blocking — must be `done` first | Creates `templates/mission.md`, scaffolds `.delivery/chief-of-staff/mission.md` (initial capture half only), and builds the decision-log write mechanism this story's `FR-52`/recapture entries reuse. This story cannot start meaningfully without that file shape already existing. |
| `chief-of-staff-04`/`05`/`06` (S-6/S-7 triage, Phase 7) | Independent — no ordering constraint | `roadmap.md`'s own Phase 7b framing: "No dependency on Phase 7 — single agent executes both serially in whatever order is convenient; nothing forces one before the other." The `FR-49` fixture below hand-authors a stand-in S-6 queue item rather than waiting on these. |
| `chief-of-staff-08` (S-8 briefing, Phase 8) | Not blocking start; blocks full `FR-49` verification | `roadmap.md`: "S-8 needs both: real S-5/S-6/S-7 survivors to assemble, and S-10 to exist at all before `FR-49`'s merge case is even testable." |

## Implementation notes

_Filled in during and after implementation._
