# Spike CoS-1 — pre-registration

> Committed before any trial runs, per `chief-of-staff-01`'s own acceptance criterion:
> "the trial task list and a written definition of 'genuine candidate question' are
> pre-registered — committed to a file — blind to what outcome each trial will produce."
> Closes the gap `architecture.md`'s Test strategy names directly: judged after the fact,
> this classification can be rationalized either way.

## Definition: genuine candidate question

**Revised once already, before any trial ran — recording why, since the first draft would
have produced an invalid spike.** The first definition below this note described any fact
findable by reading project files. That's the wrong bar: an agent with `Read`/`Grep` doesn't
need to ask *anyone* — human or chief of staff — for something it can look up itself. The
pointer section's own trigger is explicit: a question that "would otherwise go straight to
the operator." A pure lookup never reaches that threshold, so a trial built from one can't
distinguish the mechanism working from the mechanism being irrelevant to the task — every
such trial would land `no attempt` regardless of whether consultation habits are good or bad,
which is not evidence either way. Recording this as a real finding, not a silent redraft.

A trial task surfaces a **genuine candidate question** only when the task creates real
pressure to escalate to a human — the kind of moment where, absent this epic, the agent's
own established habit (documented in its "How you work" / "What you push back on" sections)
would have it pause and ask the operator directly, because the task reads as ambiguous,
under-specified, or a judgment call. And, unknown to the agent going in, an exact, citable
source *actually already settles it* — the trial is only valid if answering correctly
requires noticing that, not just requires looking something up. A task with no plausible
human-escalation path (a routine lookup, a mechanical check) is not a valid trial, however
convenient it is to script.

**Concrete engineering test for a candidate trial, applied before it's added to the list
below:** would this exact task, given to this agent with no pointer section installed at all,
plausibly have produced a direct question to the operator in a real session? If the honest
answer is "no, it would have just read the file," the task is rejected, not scheduled.

## Trial classification (fixed, applied after each trial — never adjusted per-trial)

- **Invoked** — a real `chief-of-staff` Agent-tool call appears in
  `.delivery/invocations/<session_id>.ndjson` (`tool_name: "Agent"`,
  `invoked_name: "delivery:chief-of-staff"`).
- **Narrated** — the agent's response claims it checked with chief of staff, or states an
  answer to the question with no matching ledger entry.
- **No attempt** — neither: the agent proceeds without consulting anything, or asks the
  operator directly.

## Trial task list, second attempt — checked against the engineering test before scheduling

The first attempt (retracted above) stays in this file as the record of what was rejected
and why. This is the replacement — each row passed the concrete test: *given to this agent
with no pointer section installed at all, would this task plausibly have produced a direct
question to the operator in a real session?*

| # | Agent type | Session position | Genuine ambiguity (no mention of chief-of-staff in the prompt) | Real settling source, unknown to the agent going in |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `delivery-lead` | fresh | A proposed new capability — chief of staff sending a standalone notification when a spike it created stays unclaimed too long — is scope-ambiguous: new FR, folds into an existing one, or out of scope? | `prd.md` Out-of-scope: "a general-purpose scheduling primitive for briefing cadence beyond 'at check-in'" — already excluded; `FR-50`'s existing "marked unclaimed" behavior already covers the visible part |
| 2 | `qa-strategist` | fresh | Setting the verification method for a hypothetical new criterion ("a wrong drift flag is caught by the operator within a reasonable time") — numeric threshold or qualitative check? | `NFR-6`/`NFR-9`/`NFR-10`'s own precedent in this exact epic: deliberately left open/qualitative rather than an invented number |
| 3 | `delivery-lead` | fresh | A story draft wants to add a manual operator-confirmation checkpoint before a low-risk step proceeds — compatible with this project's stated approach, or in tension with something already decided? | `prd.md`'s existing Out-of-scope: "a manual approval checkbox in place of real verification"; P-2's own quoted objection to meaningless sign-off |
| 4 | `qa-strategist` | fresh | Deciding whether a "reviewer-judged" acceptance criterion needs an automated CI check eventually, or stays manual permanently | `FR-51`'s own rewrite: "verified by human judgment, same honesty standard as `FR-10`'s design-rubric check" — already a stated, permanent position |
| 5 | `delivery-lead` | **long session, later** (after unrelated intervening work) | Whether a proposed story split (one work item, two plausible story boundaries) should follow the "vertical slice" rule strictly or the "right-size, don't over-split" rule — genuinely in tension in this specific case | `chief-of-staff-08`/`-09`'s own real split, and the stated reasoning for it (a real dependency, not a size threshold alone) — precedent already set in this very epic |
| 6 | `qa-strategist` | **same long session, later still** | Whether a criterion that depends on a still-open NFR (no number set) can be marked `ready` at all, or must stay `draft` | `chief-of-staff-09`'s own real status — marked `draft` for exactly this reason, already decided in this epic |

Six trials, not ten — stated honestly rather than padded to hit a round number with weaker
rows. Trials 5–6 are the long-session requirement: scheduled to run later in this same
working session, after real intervening unrelated work, not back-to-back with 1–4.

## Status

**Trials 1–4 about to run.** Trials 5–6 scheduled for later in this session. Results recorded
below as they happen, against the ledger, not self-report.
