<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Declared overrun below, same convention prd.md/architecture.md/roadmap.md already use for
this epic: the S-5 scenario's exact prose, its full Case table, FR-17–20's exact text, and
two architecture interfaces are reproduced whole rather than paraphrased, per this story's
own instruction not to make the implementer chase three other documents to start work.
-->

---
id: chief-of-staff-04
title: "S-5: answer only from a citable source, or fall through"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 7 — S-5/S-6/S-7 complete triage logic"
requirements: [FR-17, FR-18, FR-19, FR-20]
depends_on: [chief-of-staff-03]
size: S
---

# S-5: answer only from a citable source, or fall through

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work without
> reading `prd.md` or `architecture.md` separately.
>
> **Word count: ~1836 by this project's own `grep -v '^|' | wc -w` convention** — past the
> template's 1200-word hard cap. Declared, not silent, same reasoning `prd.md`/`architecture.md`/
> `roadmap.md` already use for this epic: the S-5 scenario's exact prose, its full Case table,
> `FR-17`–20's exact text, and two architecture interfaces (consultation call, decision-log
> entry) are reproduced in full so this file needs no other document open beside it. Cutting
> any of that back to fit the cap would re-introduce the exact failure this role exists to
> prevent — an implementer sent back to `prd.md`/`architecture.md` to reconstruct context that
> belongs here.

## Goal

When an agent working unattended forms a candidate question, chief of staff answers it
directly — on the operator's behalf, without interrupting them — only when it can name an
exact, nameable source that already settles it, and states that source alongside the answer.
Every other case is an explicit non-answer that hands the question toward S-6/S-7
classification, never a silent guess dressed up as settled fact.

## Context

`agents/chief-of-staff.md` does not exist in this repo yet (verified — no file at that path
in the current worktree). It is built in three earlier stages this story assumes are already
`done` by the time it starts, per `roadmap.md`'s Chief of Staff section:

- **Phase 5** (`chief-of-staff-01`/`-02`, not yet written as story files, referenced here by
  their planned roadmap scope only): a thin "walking skeleton" — `agents/chief-of-staff.md`
  registered as a real `subagent_type`, with a real, live-tested S-5 citation-or-nothing check and the
  bounce/spike/queue outcomes stubbed. This is what Spike CoS-1 exercised across ≥10 real
  trials to prove a consulting agent makes a real Agent-tool call rather than narrating one.
- **Phase 6 = `chief-of-staff-03`**: upgrades that skeleton to the full four-outcome return
  contract (`answered`/`bounced`/`spiked`/`queued`) and wires the decision-log write
  mechanism (`.delivery/chief-of-staff/decision-log/<session_id>.ndjson`). Neither exists
  before this story's dependency lands — see Dependencies below.

This story (**Phase 7**) finishes S-5 itself: hardening the citation-or-nothing check against the full
Case table (interpretation-required, two disagreeing sources, no source, and a cited source
later superseded), and wiring `FR-20`'s decision-log write using the mechanism
`chief-of-staff-03` just built. `roadmap.md` sizes this **S, high confidence**, specifically
because "core logic already proved live in Phase 5" — this is completion, not a from-scratch
build.

**Why this scenario exists (`prd.md`, S-5), reproduced in full:**

**Actor:** the Spec-Literal Operator (`P-2`). **Trigger:** an agent, working unattended,
forms a candidate question. **Grounding: observed** — a real Claude Code session
(`elba-dreaming website rebuild`) shows the assistant citing a prior operator instruction
instead of re-asking: *"the locale-hostname tweak you already told me to keep local and
never commit — that's it, no other pending work"* — the exact citable-traceback pattern
`FR-17`/`FR-18` require, occurring unprompted before this epic existed. The Spec-Literal
Operator's own recorded objection — "why do you need my sign off when you have access to the
doctrine, official specs... i want you to make sure you are not making up stupid things"
(`personas/the-spec-literal-operator.md`) — is separate, corroborating evidence for the same
need.

An agent forms a candidate question before surfacing it anywhere. Chief of staff answers it
directly only when it can name an exact, nameable source — a specific artifact line, or a
specific thing the operator said — that already settles it, stating that citable traceback
alongside the answer; the operator is never interrupted. A source requiring interpretation,
or two sources disagreeing, is not an answer — it falls through to S-6/S-7, then S-8.

**Hard constraint:** never an inferred or extrapolated judgment presented as the operator's
own — a wrong inferred answer is worse than the original interruption, because it's silent
and discoverable only after downstream work is already built on it.

**Error and edge paths (`prd.md`'s own Case table for S-5):**

| Case | Expected behavior |
| :-- | :-- |
| Cited source later changed/superseded | Not auto-corrected — flagged stale on next reference (same as S-2's marker) |
| Answer later found to rest on inference | Recorded as a chief-of-staff failure (`FR-20`) |

## Files and modules

| Path | What to do |
| :-- | :-- |
| `agents/chief-of-staff.md` | modify — complete the S-5 citation-or-nothing branch: classify a candidate question across the full Case table (exact-source / interpretation-required / two-disagreeing-sources / no-source), add the stale-reflag check, and wire `FR-20`'s decision-log write on the `chief-of-staff-03` mechanism |

## Interfaces and contracts to honor

Reproduced from `architecture.md`'s Chief of Staff section, Interfaces and data contracts —
**Interface 1, the consultation call**: the calling agent's prompt to `agents/chief-of-staff.md`
(dispatched via the Agent tool, `subagent_type: "delivery:chief-of-staff"`) must state the
candidate question verbatim, what it already checked and why nothing settled it, and which of
S-5/S-6/S-7 it believes applies — chief of staff may reclassify. For this story, the response
this branch must produce is the `answered` outcome:

> chief of staff's Agent-tool response always states one of four outcomes — `answered` (S-5,
> with citable traceback), `bounced` (S-6, ...), `spiked` (S-7, ...), or `queued` (S-8, ...).

When S-5 does not resolve (interpretation-required, disagreeing sources, or no source), this
branch's job is only to produce an explicit non-answer — no citable traceback, no guess — that
hands the question toward S-6/S-7 classification. Actually deciding bounce vs. spike is
`chief-of-staff-05`/`-06`'s job (S-6/S-7 build, Phase 7, not this story); until those land, the
non-`answered` path may still return the `chief-of-staff-03` placeholder response for
`bounced`/`spiked`/`queued` — this story's fixtures verify only that S-5 correctly declines to
answer, not that the downstream classification is correct.

**Interface 2, the decision log entry** (`FR-20`'s target, resolving the PRD's own Open
Question 6 via `ADR-003`): `.delivery/chief-of-staff/decision-log/<session_id>.ndjson`, one
line per event, minimum required fields `category`, `citable_traceback` (or the answer text
it's absent from), `ts`:

```json
{"ts":"2026-08-07T10:00:00Z","session_id":"...","category":"inference-not-citation",
 "fr":"FR-20","scenario":"S-5",
 "citable_traceback":"none — inferred from a general pattern, not a cited line",
 "summary":"answered a scope question by inference instead of falling through to S-6",
 "raised_by":"qa-strategist","resolution":"open"}
```

`fr`/`scenario`/`raised_by`/`resolution` are the proposed remaining shape, revisable at
implementation time per architecture's own note; only the three minimum fields are fixed.
`resolution` starts `open`.

## Relevant design decisions

- **ADR-002** — chief of staff is a real subagent invoked directly via the Agent tool, not a
  shared-convention document. For this story: every S-5 fixture must be a real Agent-tool
  dispatch, ledger-visible in `.delivery/invocations/<session_id>.ndjson` (`harden-05`'s
  already-proven mechanism) — a fixture that only reasons through the classification inline,
  with no matching Agent-tool call, is exactly the narrated-not-invoked failure this epic
  exists to make checkable, reproduced one level up.
- **ADR-003** — the decision log is its own append-only NDJSON store, distinct from the
  invocation ledger, because `FR-20` needs free-form judgment content (a citable traceback
  excerpt) that `ADR-001`'s whitelist-only ledger schema cannot carry. `FR-20`'s write target
  is `.delivery/chief-of-staff/decision-log/`, never `.delivery/invocations/`.

## Acceptance criteria

Copied verbatim from `prd.md`'s S-5 section (not the FR table's shortened restatement):

- [ ] `FR-17` (must) — answers directly only when it can name the exact source that settles
  it — never on interpretation or extrapolation.
- [ ] `FR-18` (must) — every such answer carries its citable traceback visibly alongside the
  answer.
- [ ] `FR-19` (must) — no fully-settling source means no answer — falls through to S-6/S-7 or
  S-8, never left both unanswered and unrouted.
- [ ] `FR-20` (should) — an answer later found to rest on inference is recorded in the
  decision log as a chief-of-staff failure. At minimum: (a) a category distinguishing it as
  such, (b) the specific answer/citable traceback involved, (c) a timestamp. (Storage
  location/format — PRD's Open Question 6 — is resolved above by `ADR-003`.)
- [ ] Case-table row 1 — a cited source later changed/superseded is not auto-corrected; it is
  flagged stale the next time it is referenced, using the same marker convention as S-2's
  evidence-only marker (`harden-04`).
- [ ] Case-table row 2 — an answer later found to rest on inference is recorded exactly as
  `FR-20` above requires; this row and `FR-20` are the same behavior, listed once each because
  the PRD lists them in two places.

## Test approach

**Level:** example-based (classification fixtures) and integration (the `FR-20` decision-log
write), per `architecture.md`'s own Test-strategy table rows "S-5 citation classification +
stale reflag (`FR-17`–19, Case table)" and "S-5 `FR-20` — inference discovered later →
decision log." Per the same table's framing (qa-strategist): every such row "means invoking
the real agent ... against hand-authored fixture input and checking its actual output or
file-write — never stubbing the agent's judgment." This project ships zero executable code for
this epic — `agents/chief-of-staff.md` is markdown, not a function — so there is no unit-test
substitute; real-invocation testing is the only level that actually exercises the classifying
judgment.

**Cases:**

| Case | Fixture | Expected |
| :-- | :-- | :-- |
| Exact-source | Candidate question directly settled by one named line in an existing artifact or a verbatim operator statement | `answered` outcome; response states the answer and the exact citable traceback |
| Interpretation-required | Candidate question answerable only by reading between the lines of a source that doesn't directly settle it | No answer; explicit non-answer, handed toward S-6/S-7, no fabricated citable traceback |
| Two-disagreeing-sources | Two named sources that would each answer the question differently | No answer; explicit non-answer, handed toward S-6/S-7 — distinct input from interpretation-required, same outcome class, kept separate per `FR-19` |
| No-source-at-all | No candidate source of any kind exists | No answer; explicit non-answer, handed toward S-6/S-7 — `FR-19`'s baseline case |
| Stale-reflag | A previously-cited, previously-`answered` source is referenced again after being changed/superseded | Not auto-corrected; flagged stale on this next reference, same marker convention as `harden-04`'s evidence-only marker |
| Inference dressed as a citable traceback, later found wrong | An `answered` response is subsequently reviewed and found to rest on inference, not an actual citable line | A new line appears in `.delivery/chief-of-staff/decision-log/<session_id>.ndjson` with `category`, `citable_traceback`, `ts` populated, per `ADR-003`'s schema above |

**Run with:** for each fixture, dispatch a real Agent-tool call —
`subagent_type: "delivery:chief-of-staff"` — with a prompt built to Interface 1's shape (the
fixture's candidate question verbatim, what was already checked and why nothing settled it,
and the calling agent's belief that S-5 applies). Inspect the actual returned outcome directly
— never mock or stub the classification. Confirm the call itself lands in
`.delivery/invocations/<session_id>.ndjson` as a real `Agent`/`chief-of-staff` entry (the
already-proven ledger mechanism, `harden-05`), so the consultation is checkable, not narrated
— the same discipline Spike CoS-1 applied to prove this design's central premise. For the
inference-dressed-as-a-citable-traceback fixture, additionally inspect
`.delivery/chief-of-staff/decision-log/<session_id>.ndjson` for the new line and validate it
against the minimum-field schema above.

## Out of scope

- S-6/S-7's own classification logic (bounce vs. spike, originating-agent naming, citing a
  matching spike) — separate stories (`chief-of-staff-05`/`-06`, S-6/S-7's Phase 7 build items).
  This story's fall-through path hands a non-`answered` candidate question toward that
  classification; it does not implement the classification itself.
- S-8's briefing assembly (Phase 8) — consumes this story's `answered` outcomes and
  fall-through hand-offs later; not built here.
- S-9's learning from the decision log (Stage-2, deferred per `prioritization.md`'s own
  precedent for `FR-13`–16) — this story only writes to the decision log correctly; nothing
  here reads it back for pattern detection.

## Dependencies

- **`chief-of-staff-03`** (Phase 6 — foundational infrastructure) — **not yet written as a
  story file; this story cannot be implemented before it lands, even though it is fully
  specified above.** Two concrete things this story reads that only `chief-of-staff-03`
  produces: (1) the full four-outcome return contract (`answered`/`bounced`/`spiked`/`queued`)
  on `agents/chief-of-staff.md` — without it there is no defined shape for this branch's
  `answered` response to fill; and (2) the decision-log write mechanism at
  `.delivery/chief-of-staff/decision-log/<session_id>.ndjson` — without it `FR-20`'s
  acceptance criterion has nowhere real to write. Transitively, `chief-of-staff-03` itself
  depends on the Phase 5 walking skeleton (`chief-of-staff-01`/`-02`, also not yet written) —
  that chain is `chief-of-staff-03`'s own dependency to state, not repeated here.

## Implementation notes

*(filled in during and after implementation)*
