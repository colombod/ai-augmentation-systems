# Sprint 1 acceptance review — epic `harden` (delivery plugin self-hardening MVP)

> Independent re-check against the code and live-test evidence as they now exist, not
> against this wave's own narration. **Process note, stated plainly:** this wave was never
> scoped through a formal `/delivery:sprint` package — the orchestrating agent implemented
> directly from the `harden-01`–`07` stories rather than handing off to an external runner.
> That is itself a finding, recorded below under "What the wave taught."

**Sprint:** 1 (`harden` epic, `harden-01`–`07`) · **Reviewed:** 2026-08-05 · **Branch/SHA:** `main` @ `656d8fc`

## Verdict

**Accepted with debt.**

**Because:** the core mechanism (invocation provenance) is proven — 21/21 real, live
invocations correctly logged, a real defect found and fixed during that testing, 31/31
unit tests passing. Two of seven stories are fully done with no caveats. The remaining
five carry two specific, named, low-to-moderate-risk gaps rather than unverified claims —
debt, not an unaccepted state. An independent value review (feature-critic) confirmed both
gaps are worth carrying rather than blocking on.

## Acceptance criteria — verified independently

| FR | Criterion | Met | Evidence | Channel | Rubric rule | Log agreed? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| FR-1–FR-3 | Invocation recorded, not-invoked distinguishable, real incident shape reproduced | met | 21 live invocations, 21/21 logged; `.delivery/`-resolution bug found & fixed live | n/a | n/a | yes |
| FR-4 | Not-invoked renders as a distinct marker | met | real `/delivery:status` run, correctly distinguished Invoked/Not-invoked/caveated-Invoked | n/a | n/a | yes |
| FR-5–FR-8 | Evidence-only marker, discriminates correctly | met | manual walkthrough against real elba-dreaming persona data | n/a | n/a | yes |
| FR-9 | Verification channel stated, cross-checked against ledger | partial | logic built, 31/31 unit tests, capture-tool schema-sourced; **never fired live in an interactive session** — headless has no browser tool | screenshot (unverified live) | n/a | no — story claimed "ready" logic, live-fire is the open gap |
| FR-10 | Rubric rule cited or absence stated | met (structurally) | `Rule ID` column exists and is referenced; same live-fire caveat as FR-9 | n/a | `RULE-ID` (unverified live) | partial |
| FR-11 | No-rubric state is explicit, never silent | met | unit-tested; no real `design-system.md` exists yet to exercise the positive branch, but the honest-absence path is proven | n/a | none exists (correct default) | yes |
| FR-12 | elba-dreaming defect reproduces a real not-met verdict citing the rule | **not verified this pass** | not run as a dedicated test this wave — flagged, not silently claimed | screenshot | n/a | no — genuinely untested |

**Log discrepancies:** FR-9/FR-12 — the story files' own Implementation Notes already state
these gaps; this review confirms them independently rather than surfacing anything new.

## Test suite

**Command:** `node --test plugins/delivery/hooks/scripts/record-invocation.test.js`
**Actual output:** 31 pass, 0 fail (run directly as part of this review, not recalled)
**Was green at sprint close, red now:** no — still green.

## Design system conformance

Not applicable — this plugin has no UI of its own.

## Persona journeys — the question story criteria cannot answer

> Not simulated this time — **real**, live sessions actually walking the now-real
> implementation, which is a stronger signal than the usual synthetic walk.

| Persona | Journey | Completes end to end? | Blocked at |
| :-- | :-- | :-- | :-- |
| The operator who insists on spec-traceable proof | Confirm a claimed phase really ran | **yes** | — real `/delivery:status` run correctly told the truth, including catching this project's own untraced artifacts |
| The operator who checks in periodically | Trust a UI verdict without re-checking it personally | **not yet confirmed** | FR-9's live-fire gap — the channel check exists but hasn't been proven to fire on a real screenshot in real use |
| The operator who reads only the verdict | — | out of scope | Stage 2, not built this wave |

## Stage promise vs. delivered

| Promised | Delivered | Gap |
| :-- | :-- | :-- |
| MVP (`FR-1`–`FR-12`), both observed-grade findings shipped together (`prioritization.md`) | `FR-1`–`FR-8`, `FR-11` fully proven; `FR-9`/`FR-10`/`FR-12` built and unit-tested but not live-fire-confirmed | Named above, not silent |

**Silent scope drops:** none — every gap is named in a story file, this review, or both.

## What the wave taught

**Stories that were wrong:** none needed rewriting — `harden-05`'s and `harden-07`'s
pre-build QA pass already caught the two defects (exit-code contradiction, missing
corrupt-capture case) that would otherwise have shipped wrong.

**Estimates that were wrong:** the `.delivery/`-resolution bug (upward-only search) was
not anticipated by any spike or estimate — architecture assumed the mechanism, not its
directory-walk direction, needed proving. Feedback for future architecture passes: a
"does this assumption hold against this actual repo's real shape" check belongs earlier.

**Assumptions invalidated:** none in the PRD/architecture themselves — the live testing
confirmed rather than contradicted `ADR-001`'s hook-based choice.

**Process assumption invalidated, and this is the real finding:** the pipeline assumes an
external runner receives a scoped `/delivery:sprint` package. This wave had none — the
orchestrating agent built directly from stories. `/delivery:sprint-review` and
`/delivery:realign`'s own gate checks both require a sprint artifact that this shape of
work never produces, which this review had to route around by writing one retroactively.
**Open question for the plugin itself, not resolved here:** should `/delivery:sprint-review`
accept "stories built directly, no external handoff" as a valid alternate entry path,
rather than only a formal sprint log?

**Simulation calibration:** not applicable — no simulation ran this wave; real execution
substituted for it throughout, which is a stronger signal, not a gap.

## Carried debt

| ID | Debt | Why accepted | Repay by |
| :-- | :-- | :-- | :-- |
| D-1 | `PostToolUseFailure` mid-run-error firing unconfirmed live | Every observed failure mode already degrades to the safe "not-invoked" state; closing this doesn't change any real user's outcome | Opportunistically — log the next real mid-run failure when it naturally occurs, not manufactured |
| D-2 | Capture-tool (`FR-9`/`FR-10`/`FR-12`) live-fire unconfirmed in a real interactive session | Higher-risk than D-1 (a false "not-met" on real correct work is possible) but can only be closed by real usage, which is the next wave's own purpose | Next wave — confirm during real-project usage, not a bespoke spike |

## Addendum — both debt items closed (2026-08-06)

**This does not revise the verdict above** — "Accepted with debt" was the correct call on
2026-08-05 evidence, and stays the record of what was true then. What changed since: both
D-1 and D-2 were closed, opportunistically as the table above anticipated, but by a
different route than "next wave's real-project usage" — during ordinary live interactive
use of this plugin in this same project's own session. A genuine browser-tool failure
(navigation to an unreachable domain, followed by a screenshot attempt in the resulting
broken state) produced a correctly-logged `PostToolUseFailure`/`outcome: "error"` entry,
closing D-1. A genuine successful screenshot in a working state produced a correctly-logged
`capture_action: "screenshot"`/`outcome: "success"` entry, closing D-2. Both are real,
live-observed events, not synthesized payloads. Full evidence in `roadmap.md`'s Phase 2/3
sections and in `harden-02`, `harden-03`, `harden-05`, `harden-06`, and `harden-07`'s own
Implementation Notes. `roadmap.md` and `prioritization.md` have been updated to reflect
this; this review file is left as an accurate record of the 2026-08-05 state plus this note
of what changed after.
