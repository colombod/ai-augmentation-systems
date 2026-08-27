# Realign — cycle 1 (epic `harden`)

> Closing step after `.delivery/sprints/1-harden-mvp-review.md` (verdict: Accepted with
> debt). What changed, in which documents, and why.

## Invalidated assumptions

None in the PRD or architecture. The live testing this cycle *confirmed* `ADR-001`'s
hooks-based choice rather than contradicting it — Open Question 1 in `prioritization.md`
is now marked answered.

## Estimate corrections

No systematic sizing bias found to correct across remaining roadmap items. The one real
miss — the `.delivery/`-resolution defect (upward-only search, missing this repo's own
subdirectory shape) — was not a sizing error; it was a coverage gap no spike or estimate
had named. Recorded as a process lesson in the sprint review, not an estimate to
recalibrate elsewhere.

## Re-staged (Product Owner)

MVP boundary unchanged — no scope cut or added. `prioritization.md` updated to record: the
milestone table (M1–M3 marked done/done-with-debt, M4 promoted to the active next
milestone), the MVP section carrying D-1/D-2 as named debt, and a new Open Question 3
capturing this cycle's own process finding (see below).

## Re-sequenced (Program Manager)

`roadmap.md` updated: Phases 0–3 marked complete with their actual results in place of
planned estimates; a new **Phase 4 (real-project usage)** added as the genuine next wave,
carrying D-1 and D-2 as its own risk-register entries with owners; critical path extended
to `Phase 4`; a new dependency row (`a real project to run this on`) added as Phase 4's
sole real blocker. Two risk rows (Spike-1-fails, hook-crash-blocks) marked resolved/closed
rather than left open after being answered.

## Persona-phase calibration

No simulation ran this cycle — real execution substituted for it throughout (see
`brief.md`'s "Coverage" discipline extended into build: prefer real evidence over
synthetic). Nothing to calibrate against a simulated prediction. The one real persona
finding: the operator who insists on spec-traceable proof completed her journey end to
end, live, for real (`sprint-review`'s persona-journey table) — stronger evidence than
this pipeline's phases normally produce this early.

## Findings closed or carried

`reviews/brief-01.md`'s 15 findings remain fixed, untouched by this cycle. No new
`/delivery:challenge` findings exist to close — this cycle's own value review (feature-critic,
via the Agent tool, not a filed `/delivery:challenge`) recommended treating `harden-01`–`07`
as effectively MVP-complete; recorded in the sprint review and here, not filed separately.

## A finding about the pipeline itself, not just this build

`/delivery:sprint-review` and `/delivery:realign` both gate on a formal sprint artifact
that a directly-implemented wave (agent builds straight from stories, no external-runner
handoff) never produces. This cycle worked around it by writing the sprint-review
retroactively rather than skipping the gate — the correct call, but a real friction point.
Recorded as Open Question 3 in `prioritization.md`, unresolved, for whoever next
encounters this shape of wave.

## What this means for the plan

No end date exists to move. The MVP boundary holds. The next command is `/delivery:sprint`
only if a formal handoff to an external runner is wanted for Phase 4 — otherwise Phase 4 is
simply: point this plugin, hook active, at a real project, and let D-1/D-2 resolve through
actual use rather than more engineering.

## Addendum — D-1/D-2 resolved opportunistically, ahead of Phase 4's original plan (2026-08-06)

This cycle's own realign plan for Phase 4 (above and in `roadmap.md`) expected D-1/D-2 to
close through use of an external real project. Instead, both closed inside this same
project's own live session, before an external project was ever identified — a genuine
mid-run tool failure and a genuine successful screenshot both fired and logged correctly
during ordinary interactive use. `roadmap.md` and `prioritization.md` are updated: Phase 4
is narrowed to its remaining, unfulfilled purpose only — gathering real evidence toward
milestone M4 (whether the reads-only-the-verdict persona shows up), which still needs an
actual external project and cannot be answered by this same closure. This addendum records
the plan-vs-actual gap rather than quietly rewriting the original Phase 4 scope.

## Addendum — field failure of the shipped observer, ownership routed elsewhere (2026-08-27)

The invocation ledger this cycle shipped (harden-05/06) failed silently in the field:
17 commits of attractor-handoff governed work (2026-08-10 → 08-14) produced zero ledger
lines while the hook demonstrably fired for a sibling `.delivery/` root in the same
window. Root cause is under diagnosis; a live reproduction on 2026-08-27 showed the
ambiguous-cwd decline branch leaving no trace, and its session-continuity tiebreaker has
a bootstrap dead-end (`record-invocation.js:208-220`). This amends this cycle's implicit
calibration — "the mechanism observes governed work" held only for unambiguous cwds, and
its failure mode is indistinguishable from idleness. The operator routed the fix to the
`context-management` initiative (brief, OQ-1, resolved 2026-08-27; beads epic
`ai-augmentation-systems-gy5`); harden's record is amended here rather than reopening its
completed phases.
