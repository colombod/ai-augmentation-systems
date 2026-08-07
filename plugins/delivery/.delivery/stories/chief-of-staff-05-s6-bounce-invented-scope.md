<!--
Word-budget note: target 700, hard cap 1200 — declared overrun, not silent, same precedent
prd.md/architecture.md set for this epic. This story reproduces FR-21/22/24's exact text, the
full S-6 Case table, an Interface convention this story itself must fix (Interface 1 says so
explicitly — "a convention to specify at story-time, delivery-lead"), and the reconciliation
note explaining why business-analyst.md/solution-architect.md aren't touched here. Cutting any
of it back to fit the cap would re-hide exactly the context an implementer with no memory of
planning needs. Prose-only count (`grep -v '^|' <file> | wc -w`, excluding tables/code/YAML):
over 1200 — kept anyway, per the same "never cut findings/citations/anything a downstream
phase reads" rule the writing standard itself states.
-->

---
id: chief-of-staff-05
title: Bounce agent-invented scope back to its originating agent (S-6)
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 7 — S-5/S-6/S-7 complete triage logic"
requirements: [FR-21, FR-22, FR-24]
depends_on: [chief-of-staff-03]
size: M
---

# S-6: Bounce agent-invented scope back to its originating agent

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

When an agent, working unattended, forms a candidate question that would require deciding
scope no stated requirement ever asked for, chief of staff classifies it as agent-invented
and routes it straight back to the agent that invented it — named explicitly, with the exact
missing requirement as the reason — instead of ever letting it reach the operator. The
Unwitnessed Operator's attention stays reserved for decisions someone actually has to make;
scope nobody asked for gets returned to its source instead of quietly becoming work.

## Context

**Where this sits in the triage pipeline.** A candidate question — "a question an agent has
formed, mid-work, that it would otherwise surface directly to the operator, before chief of
staff has triaged it" (glossary) — first goes through S-5's citation check. Only a question S-5
cannot answer directly (no exact, nameable source settles it) falls through to S-6. This story
implements that fall-through check and its bounce/escalation behavior only — S-5's own citation
logic is a different story's scope.

**Scenario, verbatim from `prd.md`.** Actor: the Unwitnessed Operator (P-1). Trigger: "a
candidate question would require deciding scope no stated requirement asked for." Grounding:
reported — "P-1's damage occurs in the gap between check-ins."

> Chief of staff checks whether any stated requirement (FR, scenario, architecture decision,
> story AC) traces to the question, citation-or-nothing, same as S-5. If nothing traces, it's
> routed back to the originating agent, named explicitly, with the missing requirement as the
> reason — the operator never sees it, unless S-10 also flags the same output (`FR-49`).

**Why S-6 stays narrow (from `prd.md`'s own S-10 comparison, quoted so this story's boundary is
explicit, not inferred):** "S-6 is reactive and narrow — passes anything that traces to a
stated requirement, full stop." A requirement scoped loosely enough to permit drift is still a
pass for S-6 — that broader mission-alignment check is S-10, a separate scenario and a separate
story (Phase 7b). This story does not check output against the captured mission; it checks only
whether *any* stated requirement traces to the question at all.

**The reconciliation note this story's classification logic must respect, even though it
doesn't touch either file (`architecture.md`, quoted in full — the pointer-section text itself
is `chief-of-staff-10`'s job, not this story's; this story is what those future sections will
describe):**

> Two of the nine already have a pre-existing, working escalation habit that this addition must
> reconcile with, not silently duplicate... `business-analyst.md`'s "Track open questions as
> first-class items" and `solution-architect.md`'s "Flag [unproven assumptions] as spikes with a
> specific question and a time box" both predate this epic and already route their own findings
> to a written artifact — never to a mid-work operator interruption. Neither is the failure mode
> S-5/S-6/S-7 exist to intercept... `business-analyst.md`'s existing Open Questions convention
> stays exactly as-is — that mechanism is for a role's own deliverable output (feeding `prd.md`'s
> Open Questions table via a reviewed phase, not an ad hoc mid-task interrupt), a different case
> from S-5's "candidate question that would otherwise surface directly to the operator." ...
> `solution-architect.md`'s existing spike-flagging habit already *is* S-7's own mechanism
> natively.

Practically: the classification logic this story builds must recognize a genuine candidate
question (mid-task, would otherwise go straight to the operator) as distinct from either role's
own already-served habit of writing findings to `prd.md`'s Open Questions table or a spike
story. Nothing in this story routes those writes through S-6 — they were never candidate
questions in S-5's sense to begin with.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `agents/chief-of-staff.md` | modify — add the S-6 branch: for a candidate question S-5 could not answer, check whether any stated requirement (FR, scenario, architecture decision, story AC) traces to it by citable traceback; if none does, construct the `bounced` outcome (originating agent name + missing requirement); if it does, do not classify as agent-invented and let the question continue past S-6 unaffected; handle the three escalation cases (provenance unknown, twice-bounced, disputed) by writing a queue entry per Interface 3 |

## Interfaces and contracts to honor

**Return contract (`architecture.md` Interface 1), reproduced — chief of staff's response to
every consultation states one of four outcomes; this story owns the second:**

```
answered  — S-5, with citable traceback
bounced   — S-6, with originating agent and missing requirement   <- this story
spiked    — S-7, with the spike story's path
queued    — S-8, with the queue-entry ID and its Blocking flag
```

**Consultation-prompt convention this story fixes.** `architecture.md`'s Interface 1 states the
calling agent's prompt must give the candidate question verbatim, what it already checked, and
which of S-5/S-6/S-7 it believes applies — then says explicitly: "this is a convention to
specify at story-time (`delivery-lead`), not a contract to lock here." That specification is
this story's own job, and FR-22 cannot be met without it: **the consultation prompt must also
state the calling agent's own identity** (its agent/role name — e.g. "I am
`solution-architect`, consulting about..."). That field is what the S-6 branch reads to
populate "originating agent" in both the bounce message and the queue's Originating agent
column. Provenance is "unknown" (Case table below) specifically when that field is absent or
unresolvable from the prompt — not a default, not inferred from context.

**Queue entry schema (`architecture.md` Interface 3), reproduced — escalating means appending a
row here with `Source: S-6`:**

```
Columns: ID, Rank, Blocking (y/n), Source (S-5/S-6/S-7), Item,
         Suggested default or "no-default-available", Status (open/answered/parked/pushed),
         Originating agent
```

Before inserting, `agents/chief-of-staff.md` already checks `queue.md` for an existing open item
about the same output and merges rather than duplicating (`FR-49`'s structural half, shared
plumbing this story reuses, does not rebuild).

**Full S-6 Case table, `prd.md` verbatim:**

| Case | Expected behavior |
| :-- | :-- |
| Originating agent can't be identified | Escalates to S-8 marked "provenance unknown" |
| Bounced twice without resolution | Escalates to S-8 rather than bouncing a third time |
| Originating agent disputes the bounce | Chief of staff doesn't adjudicate — routes to S-8 as a scope dispute |
| Two agents independently invent overlapping scope | Out of scope for MVP-1 — semantic dedup is disproportionately hard; exact/near-exact matching only (S-7/S-11) |

## Relevant design decisions

- **ADR-002** — chief of staff is a real subagent invoked via the Agent tool, plus a thin skill
  wrapper and per-agent pointer sections. The S-6 classification and bounce-message logic lives
  once, inside `agents/chief-of-staff.md` itself — never duplicated as inline reasoning inside
  the calling agent's own turn, which is exactly the narration-not-invocation failure mode this
  design exists to make ledger-visible instead of silent.
- **Epic framing (`prd.md`'s epic intro)** — chief of staff protects "the human principal's
  attention and the mission they actually stated." S-6 is the narrow half of that protection
  (traceability at the level of one question); this story implements only that half, not S-10's
  broader mission check.
- **Architecture's reconciliation note** (quoted in full above) — governs how this story's
  classification logic must treat questions that never should have reached chief of staff at
  all, without this story editing the two files the note is actually about.

## Acceptance criteria

- [ ] `FR-21` — classified as agent-introduced scope only when no stated requirement traces to
  it, checked by citable traceback.
- [ ] `FR-22` — names the originating agent explicitly and states the missing requirement —
  never forwarded to the operator instead.
- [ ] `FR-24` — a question bounced twice without resolution escalates to S-8 rather than
  bouncing a third time.
- [ ] Case table — originating agent can't be identified: escalates to S-8 marked "provenance
  unknown," never silently dropped and never bounced to no one.
- [ ] Case table — originating agent disputes the bounce: chief of staff does not adjudicate the
  scope question itself; it routes to S-8 as a scope dispute, stating the dispute, not a ruling.
- [ ] A compound candidate question where part traces to a stated requirement and part does not:
  only the untraceable remainder is classified and bounced; the traceable part is not. *(Not a
  literal `prd.md` S-6 Case-table row — derived by applying `FR-21`'s citable-traceback check at
  sub-question granularity, the same way `FR-28` splits a mixed S-7 question. Flagged here so
  the implementer knows this is a reasoned extension, not a copied fact.)*
- [ ] A question that does trace to a stated requirement, however loosely scoped, is not
  classified as agent-invented and is not bounced — per the S-10 comparison quoted in Context,
  S-6 passes anything that traces, full stop.
- [ ] The bounce message and every escalation state the missing requirement or the dispute as
  fact; chief of staff never unilaterally decides the scope question itself (epic-wide
  non-goal, `prd.md` Out of scope: "Chief of staff overruling a scope decision itself (S-6)...
  it routes and names; the operator/product-owner decides").

## Test approach

**Level:** two levels, matching `architecture.md`'s own two separate Test-strategy rows for
S-6 — do not fold them into one, the same mistake the architecture's first sketch made and
corrected.
- Classification + messaging (`FR-21`/`FR-22`): **example-based.** Risk: High — "same silent
  misclassification risk class as S-5, one hop later."
- Escalation paths (`FR-24`, Case table): **integration, fixture-driven.** Risk: Medium —
  "self-limiting (S-8 catches it eventually)."

**Cases:**

| Case | Expected |
| :-- | :-- |
| Candidate question with no traceable requirement | Bounced; names the originating agent explicitly, states the specific missing requirement, never forwarded to the operator |
| Candidate question that traces to a stated requirement (FR/scenario/architecture decision/story AC), citable | Not classified as agent-invented scope; not bounced |
| Compound question, part traces, part doesn't | Only the untraceable remainder is bounced; the traceable part is untouched |
| Originating agent cannot be identified (self-identification field absent/unresolvable) | Escalates to S-8's queue marked "provenance unknown" |
| Same question bounced twice on record, still unresolved | Escalates to S-8 rather than bouncing a third time |
| Originating agent disputes a bounce | Routed to S-8 as a scope dispute; chief of staff records the dispute, does not adjudicate |
| Two agents independently invent overlapping/near-duplicate scope | Not tested — explicit MVP-1 non-goal (semantic dedup; exact/near-exact matching is S-7/S-11's job) |

**Run with:** no automated test runner exists for this plugin's agent logic (`architecture.md`'s
own constraint: this epic ships zero executable code). Verification is invoking the real
`agents/chief-of-staff.md` agent — via the Agent tool, `subagent_type: "delivery:chief-of-staff"`
— against hand-authored fixture consultation prompts covering the cases above, and inspecting
its actual returned outcome and any real `queue.md` write it produces. Never stub the agent's
judgment; that is the exact distinction `architecture.md`'s Test strategy section draws between
this row and Spike CoS-1. **One case this story cannot close alone:** confirming the twice-bounced
escalation actually surfaces correctly inside S-8's assembled briefing needs `chief-of-staff-08`
to exist — that's the escalation *destination*'s own acceptance criteria, not this story's. What
this story verifies directly, without it, is that the correct queue entry (Source: S-6, right
Status/Originating-agent fields) gets written in the first place.

## Out of scope

- **Semantic dedup of overlapping invented scope** — `prd.md` Case table, verbatim: "Two agents
  independently invent overlapping scope | Out of scope for MVP-1 — semantic dedup is
  disproportionately hard; exact/near-exact matching only (S-7/S-11)."
- **Bypass detection** — `prd.md`'s own "Documented constraint, not an AC," verbatim: "nothing
  prevents an agent from skipping chief-of-staff consultation entirely; detecting that skip is
  out of scope (bypass ≠ unavailability/`FR-48`)." `FR-48` (unavailability fallback) is a
  different, already-separate case and is not built by this story.
- **The `business-analyst.md`/`solution-architect.md` pointer-section text itself** —
  `chief-of-staff-10`'s job. This story's classification logic is what those sections will
  describe once written; the sections' exact wording (including the "you already do this,
  consult only when X" language `architecture.md` specifies per file) is not authored here.
- **S-10's mission-drift check** — separate scenario, separate story (Phase 7b). This story
  checks only whether a stated requirement traces to the question, never the captured mission.
- **Chief of staff adjudicating a scope dispute or a missing-requirement judgment itself** —
  epic-wide non-goal; it routes and names, the operator/product-owner decides.

## Dependencies

- **`chief-of-staff-03`** (foundational substrate, Phase 6) — must be `done` first. It provides
  the registered `agents/chief-of-staff.md` subagent this story modifies, the four-outcome
  return contract (`answered`/`bounced`/`spiked`/`queued`) this story's `bounced` outcome must
  conform to, and the `queue.md` scaffolding (Interface 3) this story's escalation paths write
  into. Without it there is no file to modify and nowhere to escalate to.
- **`chief-of-staff-08`** (S-8 briefing assembly, Phase 8) — needed only to verify, end-to-end,
  that an escalated item (provenance-unknown / twice-bounced / disputed) actually surfaces
  correctly inside S-8's assembled briefing. That is the escalation *destination*'s own
  acceptance criteria. The bounce/escalation logic itself — classifying the question, naming the
  agent, writing the correct queue entry — is this story's own scope and is verified directly
  against Interface 3's schema without `chief-of-staff-08` existing yet.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
