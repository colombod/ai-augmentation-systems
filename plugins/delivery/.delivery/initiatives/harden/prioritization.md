# Prioritisation and MVP staging

> Phase 6 artifact. Owned by Product Owner, with Program Manager and User Researcher.
> Value pass — effort figures here are pre-architecture estimates and get reconciled
> against real cost in `roadmap.md`.
> Evidence basis: real transcript evidence (not synthetic simulation — none was run; see
> Confidence) for the two observed personas; zero real coverage for the assumed one.
> **Re-aligned 2026-08-05** per `.delivery/sprints/1-harden-mvp-review.md` (verdict:
> Accepted with debt, since closed) — see the MVP section below for what changed.
> **Stage 1.5 added 2026-08-06** (FR-17–FR-19, CLI/TUI channel generalization) — kept
> separate from the MVP label per `/delivery:challenge`'s review; CLI shipped in two tiers,
> TUI held. See the Stages section below.

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
| FR-17 | the operator who checks in periodically | yes | same failure mode as FR-9, different surface | direct product-owner direction, this session — no transcript incident for CLI/TUI in either engagement studied | S | reported |
| FR-18 | same | yes | same | same | S | reported |
| FR-19 | same | yes | same, contingent on a real capture channel existing at all (Spike 6) | same | S–M | reported |

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

**Status, post-build (sprint-review verdict: Accepted with debt; debt since closed
2026-08-06).** The MVP boundary itself never changed — no scope was cut or added. FR-1–FR-8
and FR-11 were proven first by real, live testing (21/21 invocations logged correctly, a
real `.delivery/`-resolution defect found and fixed in the process). FR-9/FR-10/FR-12 were
built and unit-tested with live-fire behavior initially unconfirmed — carried as debt
**D-1** (mid-run-error firing) and **D-2** (capture-tool live-fire, the higher-risk item: a
false "not-met" on real correct work was possible until confirmed). **Both are now closed**:
a genuine browser-tool failure produced a correctly-logged `PostToolUseFailure`/
`outcome: "error"` entry (closing D-1), and a genuine screenshot produced a correctly-logged
`capture_action: "screenshot"` entry (closing D-2) — both observed live, in an actual
interactive session, not synthesized. Full evidence in `roadmap.md`'s Phase 2/3 sections and
each story's own Implementation Notes.

### Stage 1.5: verification channel generalization (added 2026-08-06)

**Includes:** FR-17–FR-19 (CLI and TUI verification channels).

**Given its own stage number, not folded into the MVP label — a direct fix from
`/delivery:challenge`'s review (`R-phase5-7`).** The MVP was already reported "Accepted,
debt closed" before this work existed; quietly extending that same label risked exactly the
untraceable, moving-target state `S-1`/`FR-1`–`4` exist to catch elsewhere. `FR-13`–`16`
(Stage 2) got real staging and explicit gating despite tracing to a *stronger* evidence base
(real brief findings) — this gets the same discipline, not less.

Extends the MVP's already-accepted verification-channel mechanism (`FR-9`–`FR-12`) to
surfaces beyond a rendered GUI, per direct product-owner direction this session, once the
GUI case's own "prove it works first" gate (the PRD's original scope decision) was actually
met. Graded `reported`, not `observed` — honestly: no CLI/TUI verification failure exists in
either transcript studied, unlike the GUI case's direct elba-dreaming evidence. Real, but a
different evidence basis, stated plainly rather than rounded up to match `FR-9`–`12`.

**Status, post-`/delivery:challenge` (2026-08-06).** The review found the original plan
wasn't buildable as scoped (`R-phase5-1`, all 5 reviewers independently) and surfaced real,
separate problems with the TUI half specifically (`R-phase5-2/3/5`). Presented to the
product owner directly, two calls made:
- **CLI (`FR-17`, `FR-18`):** build a spike first (`harden-11`) rather than drop tracking.
  Result — no safe ledger-based cross-check exists yet (no closed-enum field on `Bash` the
  way capture tools have `action`; the safe alternatives all cost either real ledger noise
  or lose precision). **Shipped in two tiers:** direct in-turn observation is required now
  (real, buildable, done); the durable ledger cross-check stays explicitly open, not
  silently dropped — recorded as debt, the same pattern as `D-1`/`D-2`.
- **TUI (`FR-19`):** held. No downstream story anywhere needs a TUI check yet, a tool
  confirmed in this session doesn't ship to other installs of this plugin, and the named
  fallback capture tool is confirmed unable to drive keystrokes at all. Revisit when a real
  TUI need exists rather than spend real integration effort validating an unneeded channel.

**Personas who can complete a journey end to end:** extends the operator who checks in
periodically's journey (already served for GUI verdicts by `FR-9`–`FR-12`) to CLI verdicts,
on a narrower basis (direct observation, not a durable ledger record) than the GUI case —
stated honestly, not claimed as parity it doesn't have yet.

**What this lets us learn:** whether a real visual-capture channel exists for a terminal at
all, and whether a real downstream need for one ever appears — both genuinely open, deferred
rather than answered under pressure to ship something.

**Sequencing:** independent of Stage 2 below — neither blocks the other.

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
| M3 | Release | **Done, debt closed** — evidence marker proven; channel/rubric logic built, unit-tested, and now live-fire-confirmed (D-1, D-2 both closed 2026-08-06) | The operator who checks in periodically | FR-5–FR-12 |
| M4 | Learning | **Active, narrowed** — D-1/D-2 closed opportunistically in this project's own session, not via an external one; M4's actual question (does the reads-only-the-verdict persona show up in real, independent usage) is still open | product-owner | M2, M3 shipped — met; blocked on a real external project to run this on (see `roadmap.md` Phase 4) |
| M5 | Release | A session cannot report "done" without a real self-correction check behind it | The operator who reads only the verdict, if M4 confirms her | Stage 2 |
| M6 | Learning | **Held, 2026-08-06** — product-owner call: no real downstream need for a TUI check exists yet, so Spike 6 (`harden-08`) isn't being spent on now. Revisit when one does | product-owner | A real project or story that actually needs TUI verification |

## Confidence

FR-1–FR-12 (the entire MVP) rest on `observed`-grade evidence — real, verbatim, repeated
operator quotes from two long, real sessions. FR-13–FR-16 (Stage 2, all of it) rest on
`assumed`-grade evidence — a hypothesis reasoned from the brief's Findings A and D, with no
real instance in either transcript. FR-17–FR-19 (added 2026-08-06) rest on `reported`-grade
evidence — a direct, current product-owner requirement, not a transcript incident like the
GUI case; real, but a different kind of real than FR-1–FR-12's. This is not a plan built on
invented users for its MVP; it is one whose later additions are graded honestly by how they
actually arrived, not rounded up to match the MVP's strongest evidence.

## Open questions for the originator

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **Answered** — ADR-001: hooks-based. Stage 2 confirmed safely deferrable. | solution-architect | resolved |
| 2 | Is it acceptable to ship a design-rubric requirement (FR-9–FR-12) for a project that has never authored a `design-system.md`, effectively forcing that authorship as a prerequisite this plugin didn't previously require? | product-owner | M3's real timeline |
| 3 | Given the sprint review's process finding — `/delivery:sprint-review`/`/delivery:realign` both gate on a formal sprint artifact this directly-implemented wave never produced — should the pipeline accept "stories built directly, no external handoff" as a valid alternate entry path? | this project | Whether future waves like this one need a retroactive sprint-review workaround again |
