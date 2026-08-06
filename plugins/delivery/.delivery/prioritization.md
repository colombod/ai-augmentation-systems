# Prioritisation and MVP staging

> Phase 6 artifact. Owned by Product Owner, with Program Manager and User Researcher.
> Value pass — effort figures here are pre-architecture estimates and get reconciled
> against real cost in `roadmap.md`.
> Evidence basis: real transcript evidence (not synthetic simulation — none was run; see
> Confidence) for the two observed personas; zero real coverage for the assumed one.
> **Re-aligned 2026-08-05** per `.delivery/sprints/1-harden-mvp-review.md` (verdict:
> Accepted with debt) — see the MVP section below for what changed.

## Staging rule

A stage is not a batch of features. A stage is a set of features that lets at least one
persona complete a journey end to end and get value. A stage serving nobody completely is
a project milestone, not a release.

## Requirement scoring

| FR | Personas served | Load-bearing? | Severity | Objection answered | Effort (est.) | Confidence |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| FR-1 | the operator who insists on spec-traceable proof | yes | blocks trust in the pipeline | "makes all this work unreliable" | M | observed |
| FR-2 | same | yes | blocks trust in the pipeline | Skill tool fired once in 4 days despite a full artifact set existing | S | observed |
| FR-3 | same | yes | blocks trust in the pipeline | "I only wrote the text... without actually invoking the Skill tool" | S | observed |
| FR-4 | same | reinforcing | blocks trust in the pipeline | same incident, display requirement | S | observed |
| FR-5 | the operator who checks in periodically | reinforcing | degrades product decisions | 4/5 elba-dreaming personas unconfirmed, staging still read "ready" | S–M | observed |
| FR-6 | same | reinforcing | degrades product decisions | same | S | observed |
| FR-7 | same | reinforcing (guards FR-5 against over-flagging) | degrades product decisions | none directly | S | observed |
| FR-8 | same | reinforcing | degrades product decisions | `personas/README.md`'s own caveat, "ignored in practice" | S | observed |
| FR-9 | same | yes | fails on elba-dreaming's own most common work type | "it must be visible, not on f***ing dom" | M | observed |
| FR-10 | same | yes | same | "you are not performing any visual quality assessment" | M | observed |
| FR-11 | same | yes | same | "I SHOULD NOT BE LOOKING... HOW ARE YOU NOT CHECKING THAT?" | S | observed |
| FR-12 | same | yes | same | the shared-baseline defect the operator had to flag by eye | S | observed |
| FR-13 | the operator who reads only the verdict | unconfirmed — no observed instance | safety net exists but isn't systematic | none real | M–L | assumed |
| FR-14 | same | unconfirmed | same | none real | S–M | assumed |
| FR-15 | same | unconfirmed | same | replays elba-dreaming's zero-check pattern, but that's the other operator's evidence | S | assumed |
| FR-16 | same | unconfirmed | same | none real | S | assumed |

Load-bearing beats enhancement. FR-5–FR-8 are marked reinforcing, not load-bearing, because
no transcript shows evidence-grade drift alone triggering abandonment — but Stage design
below overrides pure load-bearing ranking for FR-5–FR-8, and says why.

## Stages

### MVP

**Includes:** FR-1–FR-12 (all three findings with real, observed-grade evidence).

An adversarial pass on an earlier draft that excluded FR-5–FR-8 found a real gap, not a
preference: the operator who checks in periodically is named in the PRD's own goal as
needing to stop noticing *two* things — unconfirmed evidence behind a stage, and a wrong
verification channel. Shipping only the second half delivers half a stated goal without
saying so. FR-5–FR-8 is also confirmed zero-dependency (the `Confidence` column it needs
already exists), so it is a parallel quick win, not a scheduling cost — excluding it saved
nothing and broke a promise.

**Personas who can complete a journey end to end:**

| Persona | Journey completed | Evidence |
| :-- | :-- | :-- |
| The operator who checks in periodically | Reads a staging decision or a UI acceptance verdict and can trust it without personally re-checking persona grades or the actual render | Both triggers named in her persona file addressed (FR-5–FR-8, FR-9–FR-12) |
| The operator who insists on spec-traceable proof | Confirms a claimed phase actually ran without auditing raw tool-call logs | FR-1–FR-4 directly answers her defining objection |

**Personas NOT served yet:** the operator who reads only the verdict — deferred to Stage 2.
This is the plugin's only fully `assumed`-grade persona; deferring her is deferring a
hypothesis, not a confirmed need, which is a different and cheaper kind of risk than
deferring an observed one.

**What this stage lets us learn:** whether the invocation-provenance mechanism (Open
Question 1) actually holds under real long-session use, and — a genuine open risk, not
resolved here — whether it can itself be narrated past the same way Finding A describes.
That depends entirely on whether it's built on Claude Code's `Stop`/`SubagentStop`/
`TaskCompleted` hooks (passive, not narratable) or as an invokable skill (narratable, and
then Stage 2's self-correction gate — deferred — is the only thing that would have caught
it). **This MVP is only safe to ship without Stage 2 if the hooks-based mechanism is what
gets built.** Recorded as a hard architecture constraint, not a preference, below.

**Excluded, and why they can wait:** FR-13–FR-16 defend against a persona with zero real
transcript evidence in either engagement studied — the honest move is to ship the
evidenced findings first and treat her as provisional, conditional on the constraint above.

**Status, post-build (sprint-review verdict: Accepted with debt).** The MVP boundary
itself does not change — no scope was cut or added. What changed is confidence: FR-1–FR-8
and FR-11 are proven by real, live testing (21/21 invocations logged correctly, a real
`.delivery/`-resolution defect found and fixed in the process). FR-9/FR-10/FR-12 are built
and unit-tested but their live-fire behavior in a real interactive session is unconfirmed
— carried as debt **D-1** (mid-run-error firing, low risk, closes opportunistically) and
**D-2** (capture-tool live-fire, higher risk — a false "not-met" on real correct work is
possible until confirmed). Neither is a blocker; both are named, owned, and scheduled in
`roadmap.md`'s new Phase 4, not silently dropped.

### Stage 2

**Includes:** FR-13–FR-16 (self-correction gate).

Structurally cannot start before FR-1–FR-4 ships — FR-14 references its invocation record
directly. Pulls forward, out of stage order, if architecture chooses an invokable-skill
mechanism for FR-1–FR-4 rather than a hooks-based one (see MVP's learning note) — in that
case Stage 2 is not really deferrable and this staging should be revisited.

**Personas who can complete a journey end to end:** adds the operator who reads only the
verdict — conditionally, since her existence is unconfirmed (Open Question 4).

**What this stage lets us learn:** whether this persona is real. A concrete design-lead
follow-up is `/delivery:interview` against real usage once the MVP has shipped and been
used at least once by someone other than this document's own author.

### Explicitly not doing

| FR | Reason | Revisit if |
| :-- | :-- | :-- |
| — | No FR is cut outright — all 16 are staged, none dropped | — |

## Milestones

| # | Type | Demonstrable outcome | Shown to | Depends on |
| :-- | :-- | :-- | :-- | :-- |
| M1 | Learning | **Done** — ADR-001 resolved hooks-based (passive); Stage 2 confirmed safely deferrable | solution-architect | — |
| M2 | Release | **Done, live-verified** — 21/21 real invocations correctly logged | The operator who insists on spec-traceable proof | FR-1–FR-4 |
| M3 | Release | **Done with debt (D-1, D-2)** — evidence marker proven; channel/rubric logic built and unit-tested, live-fire unconfirmed | The operator who checks in periodically | FR-5–FR-12 |
| M4 | Learning | **Now the active next milestone** — real usage data on whether anyone behaves like the operator who reads only the verdict, and the natural venue to close D-1/D-2 | product-owner | M2, M3 shipped — met; blocked only on an actual real project to run this on (see `roadmap.md` Phase 4) |
| M5 | Release | A session cannot report "done" without a real self-correction check behind it | The operator who reads only the verdict, if M4 confirms her | Stage 2 |

## Confidence

FR-1–FR-12 (the entire MVP) rest on `observed`-grade evidence — real, verbatim, repeated
operator quotes from two long, real sessions. FR-13–FR-16 (Stage 2, all of it) rest on
`assumed`-grade evidence — a hypothesis reasoned from the brief's Findings A and D, with no
real instance in either transcript. This is not a plan built on invented users for its MVP;
it is one whose *second* stage might be, pending confirmation.

## Open questions for the originator

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **Answered** — ADR-001: hooks-based. Stage 2 confirmed safely deferrable. | solution-architect | resolved |
| 2 | Is it acceptable to ship a design-rubric requirement (FR-9–FR-12) for a project that has never authored a `design-system.md`, effectively forcing that authorship as a prerequisite this plugin didn't previously require? | product-owner | M3's real timeline |
| 3 | Given the sprint review's process finding — `/delivery:sprint-review`/`/delivery:realign` both gate on a formal sprint artifact this directly-implemented wave never produced — should the pipeline accept "stories built directly, no external handoff" as a valid alternate entry path? | this project | Whether future waves like this one need a retroactive sprint-review workaround again |
