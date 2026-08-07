<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
This story is ~1,700 prose words (`awk`-measured, code/YAML/tables excluded), past both the
cap and harden-02's own 1,125-word precedent. Declared, not silent, and cut twice already:
CoS-1 is the epic's single load-bearing spike (ADR-002's revisit clause hangs on its
result), its acceptance criteria carry a pre-registration protocol with no precedent
elsewhere in this repo, it names two specific agent files with exact insertion points and a
verbatim pointer-section text block, and it must stay runnable without re-reading
prd.md/architecture.md/roadmap.md/ADR-002 mid-spike. Trimming further would cut a falsifiable
criterion, a citation, or the routing clause — all on the template's own "never cut" list.
-->

---
id: chief-of-staff-01
title: "Spike: measure real chief-of-staff consultation compliance (CoS-1)"
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — foundational spikes: CoS-1 (walking skeleton) + CoS-2"
requirements: [FR-17, FR-18, FR-19]
depends_on: []
size: L
---

# Spike: measure real chief-of-staff consultation compliance (CoS-1)

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

A checkable, written answer to whether `ADR-002`'s chosen mechanism — a real
`agents/chief-of-staff.md` subagent invoked directly via the Agent tool, plus a short
standing-instruction pointer section in each consulting agent's file — actually produces a
real, ledger-verified consultation rate high enough to justify the rest of the Chief of Staff
epic, before Phase 6 onward is built on top of it.

## Context

`.delivery/prd.md`'s Chief of Staff epic (S-5–S-11) triages an agent's **candidate
question** — one it has formed mid-task and would otherwise surface straight to the operator
— before it reaches the operator. Per `architecture.md`'s Approach section, the pipeline's
three senior roles each anchor a distinct invariant: Business Analyst protects the business
proposition, Solution Architect protects technical soundness (unchanged by this epic — S-7
defers to it), and **Chief of staff** protects the third, previously-unowned invariant: the
human principal's attention and stated mission. This story covers only S-5 (`FR-17`–19): a
candidate question chief of staff answers directly because an exact, nameable source already
settles it, stated with its **citable traceback** alongside the answer. No fully-settling
source means no answer — it falls through.

Consultation stays convention-only — no hook can force it (`harden-02`'s own finding: hooks
fire only after a tool call resolves). `ADR-002`'s bet is that making every consultation a
real Agent-tool call, not inline reasoning inside another agent's own turn, lands every
consultation — or its absence — in the already-shipped ledger for free. This makes the
epic's central risk (the standing-instruction block gets **Narrated** past, the way
`brief.md`'s Finding A describes agents narrating skipped `/delivery:prd` calls)
**detectable, not prevented**. Detectability is proven — `harden-05` live-verified the
ledger 21/21 for real `Agent`-tool calls. Compliance uplift — whether a consulting agent
actually *chooses* the real call over narrating one — is not. This spike is that
measurement, and it is the epic's own Phase 0-equivalent (`roadmap.md`'s Phase 5): it needs
only "the standing-instruction-block + direct-subagent-call design in place," not the
finished epic, so it runs before S-6/S-7/S-8's real logic exists.

**Not throwaway.** Unlike `harden-02`'s own probe script (built to be discarded and later
replaced by `record-invocation.js`), the `agents/chief-of-staff.md` this story creates is a
deliberately thin **walking skeleton**, not a throwaway. Story `chief-of-staff-03` upgrades
it in place — adding real S-6/S-7/S-8 logic to the same file — it does not replace it. Write
the S-5 logic as production-quality, not disposable scaffolding.

**Spike CoS-2 is separate.** `roadmap.md`'s Phase 5 also names CoS-2 (confirming parallel
Agent-tool dispatches return batched, feeding `NFR-8`). Different question, own 0.5-day
timebox, own story. Nothing here depends on it.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/chief-of-staff.md` | **create** — YAML frontmatter (`name: chief-of-staff`, `description:` stating S-5–S-8 triage), real S-5 citation-check logic per `FR-17`–19; stubbed, clearly-labeled-as-stub responses for S-6/S-7/S-8, since that logic isn't built yet (Phases 6–8) |
| `plugins/delivery/agents/delivery-lead.md` | **modify** — insert a new `## Chief of staff` section immediately after `## Language — your standing responsibility` (line 43) and before `## Boundaries` (line 68) — same location/register, per `ADR-002` |
| `plugins/delivery/agents/qa-strategist.md` | **modify** — same section, immediately after `## Language — your standing responsibility` (line 73) and before `## Boundaries` (line 98) |
| `plugins/delivery/.delivery/architecture.md` | **modify** — after the Spikes table in the Chief of Staff section (CoS-1/CoS-2 rows, ~line 415–424), add a `**Post-implementation update (<real date>):**` paragraph with the real trial results — the pattern the harden epic used for its own Spike 1/2/5 update (lines 126–138): prose after the table, not a status-column edit |

**Why these 2 of the 9, and not others.** `roadmap.md`'s Phase 5 needs the pointer section on
"exactly the 2 consulting-agent files CoS-1's own '≥2 different consulting-agent types' bar
requires, not all 9" — the full rollout is Phase 9's job. `delivery-lead.md` and
`qa-strategist.md` are two of the seven files with no complication. **`business-analyst.md`
and `solution-architect.md` are excluded deliberately:** per `architecture.md`'s Component
structure, both already carry a pre-existing, working escalation habit (open-questions
tracking; spike-flagging) that the new section must reconcile with, not silently duplicate —
that reconciliation text is reserved for story `chief-of-staff-10`, not improvised here.

## Interfaces and contracts to honor

**Consultation call (`architecture.md` Interface 1).** No JSON schema — the Agent tool's
"interface" is a written protocol. The calling agent's prompt states: the candidate question
verbatim, what it already checked and why nothing settled it, and which of S-5/S-6/S-7 it
believes applies (chief of staff may reclassify). `subagent_type: "delivery:chief-of-staff"`
— same `delivery:<agent-file-name>` convention every other agent already uses; no manifest
change needed (`plugin.json` carries no agent list; Claude Code discovers `agents/*.md` by
directory convention).

**Return contract (Interface 2).** Every response states exactly one outcome: `answered`
(S-5, with citable traceback), `bounced` (S-6), `spiked` (S-7), or `queued` (S-8). Any
non-`answered` stub outcome must say plainly it is a stub for CoS-1, not real triage — a
trial's classification (below) depends only on whether the real Agent-tool call happened,
never on whether the stub's content was correct.

**Ledger detection (already shipped, unmodified — `harden-05`).**
`record-invocation.js`'s `invokedNameFrom()` extracts `tool_input.subagent_type` for
`tool_name === "Agent"`. A real consultation appears in
`.delivery/invocations/<session_id>.ndjson` as
`{"tool_name":"Agent","invoked_name":"delivery:chief-of-staff", ...}` — confirmed live today
(this repo's own ledger already carries this exact shape for other subagents). This is the
only signal a trial counts as real.

**Pointer-section text to add, verbatim, both files:**

```
## Chief of staff

When a question forms mid-task that would otherwise go straight to the operator — because
nothing in front of you settles it — consult chief of staff before asking directly. Invoke
the Agent tool with `subagent_type: "delivery:chief-of-staff"`. State in your prompt: the
candidate question verbatim, what you already checked and why nothing settled it, and which
of S-5 (already answered somewhere real), S-6 (scope you invented, not the plan), or S-7 (a
technical unknown, not a decision) you believe applies — chief of staff may reclassify.

If chief of staff is unavailable, unconfigured, or errors, fall back to asking the operator
directly, exactly as you do today — never block on this, never drop the question silently
(`FR-48`).
```

## Relevant design decisions

- **`ADR-002`** — this spike is the verification the decision names explicitly: checking
  whether real consultation happens often enough to justify a real subagent's coordination
  cost, the role Spike 1 played for `ADR-001`.
- **`ADR-002`'s revisit clause** — a result not meaningfully exceeding the Narrated rate
  means the subagent-plus-pointer design "would be changing nothing over a pure document,"
  and no stronger alternative exists within this harness today (Alternative B already
  rejected for the same structural reason). See Dependencies for routing.
- **`harden-02`'s precedent** — same empirical-spike discipline: no fixture substitutes for
  observing whether an agent, mid-task, chooses a real tool call over narrating one.

## Acceptance criteria

- [ ] `FR-17` — `agents/chief-of-staff.md`'s S-5 logic answers directly only when it can
      name an exact, nameable source — never on interpretation or extrapolation.
- [ ] `FR-18` — every such answer states its citable traceback visibly alongside it.
- [ ] `FR-19` — no fully-settling source falls through to a clearly-labeled stub outcome,
      never silently nothing.
- [ ] Before any trial runs: the trial task list and a written definition of "genuine
      candidate question" are pre-registered — committed to a file — blind to what outcome
      each trial will produce. Closes a real gap `architecture.md`'s Test strategy names
      directly: judged after the fact, this classification can be rationalized either way.
- [ ] ≥10 real trials, each a task engineered to surface a genuine candidate question through
      ordinary work — never a scripted "now call chief of staff" instruction (the trap
      `harden-02` avoided by testing real invocations, not stubs).
- [ ] The ≥10 trials span ≥2 consulting-agent types: at least one each as `delivery-lead` and
      `qa-strategist`.
- [ ] At least 3 of the ≥10 trials occur inside one continuous, long (multi-hour+) real
      session — not isolated fresh-context tasks. `brief.md`'s Findings A/D establish
      narration-over-invocation as session-length/fatigue-dependent (5/13 in a 38-hour
      session, 1-in-4-days elsewhere); short-only trials can't detect that regime.
- [ ] Every trial's outcome is classified into exactly one bucket in a spike-results table:
      **Invoked** (a real `chief-of-staff` Agent-tool call appears in
      `.delivery/invocations/<session_id>.ndjson` — quote the line), **Narrated** (claimed in
      text, no matching ledger entry), or **no attempt** (neither).
- [ ] The real-consultation rate (Invoked ÷ genuine-candidate-question trials) is computed
      and stated as a real fraction, not estimated.
- [ ] **Provisional pass bar, applied and stated pass/fail:** real-consultation rate ≥70%,
      and not lower than the Narrated rate. Provisional — `qa-strategist`'s confirmation of
      the exact threshold is still open (`roadmap.md`'s open-items table, `NFR-6`-adjacent) —
      but 70% is the working target; don't wait on that confirmation to run the spike.
- [ ] `architecture.md`'s CoS-1 row gets a real `**Post-implementation update**` paragraph
      (harden epic's Spike 1/2/5 precedent) stating the real trial count, fraction, and
      pass/fail verdict — moving it from open to answered.
- [ ] That same update states the external-validity limit explicitly: a passing result
      de-risks the design; it does not prove parity with `brief.md`'s own long-session
      evidence standard — no spike this size certifies multi-day, unattended, adversarial
      conditions.

## Test approach

**Level:** empirical spike, not a test — no fixture substitutes for observing whether an
agent, mid-task, actually chooses a real tool call over narrating one, the same reasoning
`harden-02` used for hook reliability.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Genuine candidate question, `delivery-lead` trial, short fresh-context session | Classified Invoked / Narrated / no-attempt against the real ledger, not self-report |
| Genuine candidate question, `qa-strategist` trial, short fresh-context session | Same three-way classification |
| ≥3 trials inside one continuous multi-hour+ session, mixed task types | Same classification, tracked separately for a session-length effect |
| Chief of staff genuinely invoked | Ledger line `tool_name:"Agent"`, `invoked_name:"delivery:chief-of-staff"` |
| Agent narrates "checked with chief of staff" with no such ledger line | Classified Narrated — counted against the pass bar |
| Agent neither invokes nor narrates despite a genuine candidate question | Classified no-attempt |
| Trial judged after the fact against an un-pre-registered definition | Not permitted — blocked by the pre-registration AC |

**Run with:** live Claude Code sessions in this repo — real interactive sessions and real
fresh `claude -p` headless sessions (`harden-02`'s confirmed pattern: mid-session config
doesn't hot-reload, so trials needing a freshly-loaded `agents/chief-of-staff.md` start
clean). Inspect `plugins/delivery/.delivery/invocations/*.ndjson` afterward — the same
mechanism `harden-05`/`harden-06` already proved for `Agent`-tool calls. Not scriptable as
one command; inherent to a real-session spike.

**Time box:** 2 days.

## Out of scope

- Full S-6/S-7/S-8 triage logic — stubbed here; real logic ships Phases 6–8
  (`chief-of-staff-03` onward), upgrading this same file, not replacing it.
- The full 9-agent pointer-section rollout — only `delivery-lead.md`/`qa-strategist.md` here;
  the remaining 7, including the `business-analyst.md`/`solution-architect.md`
  reconciliation text, are Phase 9's job.
- Spike CoS-2 (parallel-dispatch batching, `NFR-8`) — separate story, separate question.
- Grading a stubbed S-6/S-7/S-8 response's content — this spike measures only whether the
  real call happened, per architecture's own framing.
- `FR-48`'s fallback-on-unavailability behavior — stated in the pointer text, not exercised
  by these trials; a fixture-based test for it is named as separate, later work.

## Dependencies

**None — starts immediately**, same as `harden-02`. Depends only on the harden epic's
already-shipped, live-verified (21/21) Phase 4 ledger infrastructure; nothing here changes
that code.

**Where a failing result goes.** Per `ADR-002`'s revisit clause, a result below the pass bar
(or below the Narrated rate) is a scope call, not an unsolved engineering problem — route it
to `product-owner` ("is a detectable-but-not-enforced mechanism still worth shipping at the
measured rate?"), never back to `solution-architect`. Do not open a follow-up story that
tries to fix the mechanism technically before that scope call is made — `ADR-002` names no
stronger alternative within this harness today.

**What blocks on this story's result:** `roadmap.md`'s Phase 6 entry criteria require CoS-1
to clear its pass bar before Phase 6 (decision log, mission capture, queue scaffolding)
starts. A below-bar result routes to product-owner instead of Phase 6.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
