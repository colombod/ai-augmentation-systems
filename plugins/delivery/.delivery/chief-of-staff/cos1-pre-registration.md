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

## Trial task list — retracted, not designed yet

**The first attempt at this table (10 rows, all pure-lookup tasks like "does file X get a
pointer section") is retracted, not merely revised.** Every row failed the engineering test
above on inspection: each was answerable by a plain `Read`/`Grep`, with no plausible path to
a human-escalation question at all, on either side of the pointer section's existence.
Running trials shaped like that would not have measured this epic's real question — it would
have measured "does the agent have file-read access," which was never in doubt. Retracting
this before any trial ran is itself the pre-registration mechanism doing its job: it exists
precisely to force this kind of check *before* results create pressure to keep a flawed
design.

**Real replacement work, not done here:** designing ≥10 tasks that each create genuine
ambiguity-driven escalation pressure — a task shaped like the ones that actually produced
Findings A/D in `brief.md` (a judgment call under real uncertainty, not a fact lookup) —
where an existing artifact or a prior operator statement happens to settle the specific
judgment call, is real design work, harder than it looks, and not something to rush to
produce a checked box. Combined with the ≥3-inside-one-continuous-multi-hour-session
requirement, which needs real elapsed session time no synchronous pass can manufacture, this
is genuine follow-up work — not completed in this pass, and not faked to look completed.

## Status

**Not yet run — and not yet even validly designed.** One real finding survives this attempt
regardless: "genuine candidate question" needed the sharper definition above before anyone
could design a valid trial at all. That correction is itself a legitimate output of this
pass. The trial list, the actual runs, and the `architecture.md` post-implementation update
are real, separate work for whoever picks this spike up next.
