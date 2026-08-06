# Challenge findings: plugins/attractor/.delivery/prd.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, qa-strategist, feature-critic, persona-simulator (skeptic: P-4 The Amplifier Veteran) · Reviewed: 2026-08-05 · Artifact version: `a04ad83`
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 4 fixed | 4 fixed | 3 fixed | 0 |

**Independent convergence:** R-prd-1 (FR-9's labeling/status) was raised in some form by all
five reviewers — the strongest signal in this panel. R-prd-2 (S2 Goal vs. FR-8) and R-prd-4
(S3 Goal vs. FR-17) were each raised independently by three reviewers. R-prd-3 (the missing
working record) and R-prd-8 (Open Q6 conflict) were each raised by two.

**Reviewer quality note:** all five did their job. Every finding below carries a concrete
failure scenario; the business-analyst and qa-strategist also independently verified the
document's citations line-by-line and reported the ones that checked out, not only the ones
that didn't — that positive-verification work is why R-prd-6 and R-prd-8 can be trusted as
real discrepancies rather than noise.

All 11 findings resolved by direct edit to `plugins/attractor/.delivery/prd.md`, applied
without a separate approval round, consistent with the standing autonomy directive already
used for `brief-01.md`'s fixes. FR-9 and FR-17 were each split into two IDs (`FR-9a`/`FR-9b`,
`FR-17a`/`FR-17b`) to separate their unblocked and blocked halves; all downstream references
(Goals, Non-goals, Out of scope, Open Questions' Blocks columns) were updated to match.

## Findings

### R-prd-1 — FR-9 is blocked exactly like FR-8/FR-12/FR-17 but carries none of their signaling, and its content is a process directive, not a checkable requirement

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner, business-analyst, qa-strategist, feature-critic, persona-simulator — independently

**The claim:** FR-9 reads "must," unqualified, while FR-8/12/17 each carry an explicit
`(blocked — see Open question N)` prefix for the same situation — an undecided Product
Owner call. Worse, FR-9's actual text ("must be decided explicitly") is checkable only as a
process step, not by execution: its two candidate resolutions (runtime-verdict change vs.
lint-time-only refusal) are incompatible test shapes, and the runtime branch requires
reopening a fix `AGENTS.md` records as already tried and withdrawn as a §11.3 contradiction.

**Concrete failure scenario:** a delivery lead filters the Priority column for `must`,
schedules FR-9 alongside genuinely-ready items, and an implementer under pressure
re-implements the runtime-verdict change — reverting the same previously-litigated call for
the third time, the exact failure mode `AGENTS.md` names twice as this project's costliest.

**What would resolve it:** label FR-9 with the same blocked convention as FR-8/12/17; split
it into two conditional, execution-checkable FRs, one per resolution branch; route the
runtime-change branch through `AGENTS.md`'s "stop and ask" doctrine explicitly rather than
Product-Owner-and-Architect sign-off alone.

**Resolution:** split into `FR-9a` (runtime-verdict branch, explicitly citing `AGENTS.md`'s
"stop and ask" rule) and `FR-9b` (lint-time-only branch), both marked `(blocked — see Open
question 9)`, priority `must, pending decision`. Open question 9 reworded to name both IDs
and quote the stop-and-ask rule directly. Goals section's S4 bullet updated to point at
FR-9a/FR-9b instead of implying a settled runtime guarantee.

---

### R-prd-2 — The S2 Goal ("runs to completion") is not achievable by any unblocked FR, and even once achievable, interpretation (a) may not serve the persona it's assigned to

**Status:** fixed · **Severity:** blocking · **Raised by:** feature-critic, persona-simulator, independently (P-2-serves-badly angle: product-owner, feature-critic, independently)

**The claim:** FR-8, the only requirement that lets a run pass the gate, is fully blocked on
Open Question 1 — no answer-delivery channel is defined at all. FR-5 requires the process to
"remain alive until answered," for an unbounded wait, and durable park/resume is an explicit
Non-goal. P-2's own persona file names walking away mid-run as the defining trait and a
crashed-run restart-from-zero as the abandonment condition.

**Concrete failure scenario:** a reader trusting the Goals section believes S2 fully closes
the loop; in fact a pipeline can deadlock permanently at the gate with no way to answer it.
Separately, P-2 launches an unattended run, walks away as their persona says they do, and any
ordinary process death during the unanswered wait loses the entire run — restart from zero,
P-2's stated #1 reason to abandon the product, reproduced by the scenario built to serve them.

**What would resolve it:** reword the Goal to state completion is contingent on Open Question
1; add an explicit risk entry (an NFR or open question) naming the crash-during-wait exposure,
the way NFR-4 already names the checkpoint-collision risk; state whether interpretation (a) is
understood as attended-mode-only rather than full P-2 coverage.

**Resolution:** Goals bullet reworded to state completion is contingent on Open Question 1.
Added `NFR-9` naming the crash-during-wait exposure explicitly, cross-referenced from a new
Non-goals line (general checkpoint crash recovery, distinct from interpretation-b park/resume)
and from S2's scenario-table row. Assumptions section now states plainly that interpretation
(a) serves an attended/in-session mode and does not resolve P-2's walk-away need, as a named
gap rather than a silent shortfall.

---

### R-prd-3 — The scenario table's rewrite/count claims cite a "working record" that does not exist anywhere in this repository

**Status:** fixed · **Severity:** blocking · **Raised by:** qa-strategist, business-analyst — independently

**The claim:** the PRD states full detail "lives in this phase's working record, not
restated here." No such file exists under `.delivery/` or `.superpowers/` — `prd.md` has
exactly one commit, touching exactly one file.

**Concrete failure scenario:** every specific compression claim (S1's "3 of 5 criteria
rewritten," S5's "coverage gap closed") is permanently unfalsifiable against its stated
source. S1's own count doesn't even reconcile internally — 5 original + 1 new criteria
implied, against 4 FR rows — and nothing in the repo can resolve which.

**What would resolve it:** commit the working record the restatement rule assumes exists, or
drop that framing and state plainly that the compressed table is the only record that exists.

**Resolution:** the "working record" framing was dropped; the User scenarios intro now states
plainly that no separate file was committed and the table is the only durable record. S1's row
was reworded off the unreconcilable "3 of 5" count to point at the actual FR IDs it maps to.

---

### R-prd-4 — The S3 Goal promises a floor ("refused at lint time") that isn't buildable without the same undecided syntax the "works" branch also needs

**Status:** fixed · **Severity:** blocking · **Raised by:** qa-strategist, feature-critic, persona-simulator — independently

**The claim:** "either works, or is refused at lint time rather than mid-run" reads as a
guaranteed floor. FR-17 shows both branches are blocked on Open Question 3 (no
branch-declaration attribute syntax exists to lint against yet) — refusing early is exactly
as impossible as working, this slice.

**Concrete failure scenario:** someone scoping around this release plans for "worst case, a
clean lint refusal" and gets neither; S3 does nothing in this slice, discoverable only by
cross-referencing the Goals section against FR-17 and Open Questions 3-5.

**What would resolve it:** reword the Goal to state S3 is fully blocked pending Q3-5, or
state explicitly why this tightens the brief's original, already-achievable bar ("working or
loudly marked unsupported").

**Resolution:** Goals bullet reworded to state S3 is fully blocked pending Open questions 3-5,
with neither branch buildable until then. Names the one thing that *is* buildable now — a lint
refusal of the other already-known-unregistered handler kinds — as `FR-17a` (see R-prd-5),
so the reworded Goal doesn't read as pure loss.

---

### R-prd-5 — FR-17 bundles a genuinely-blocked requirement with an already-buildable fallback, and the buildable half is at risk of never being scheduled

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner

**The claim:** `graph.ts` already comments the exact set of handler kinds that are known but
unregistered (HUMAN, PARALLEL, FAN_IN, MANAGER_LOOP). A lint rule refusing any node resolving
to one of these needs none of Open Questions 3-5 — it's buildable today, but FR-17 states the
whole S3 requirement as one line, "must, fully blocked."

**Concrete failure scenario:** a sprint either skips FR-17 entirely or stalls trying to
deliver all of it, and the cheap, high-value fallback the Goals section itself promises never
gets a requirement ID of its own.

**What would resolve it:** split FR-17 into the unblocked lint-refusal half (buildable now)
and the actual concurrency work (blocked on Q3-5, left as-is).

**Resolution:** split into `FR-17a` (unblocked `must` — lints `Handler.PARALLEL`,
`Handler.FAN_IN`, `Handler.MANAGER_LOOP`; `Handler.HUMAN` excluded since S2/FR-5-8 registers
it separately this same slice) and `FR-17b` (the blocked concurrency work, unchanged).
Out of scope updated to name FR-17b specifically rather than S3 as a whole.

---

### R-prd-6 — NFR-3 cites a test file that does not exist; no test in the suite exercises `parseDuration`'s parsing rules

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**The claim:** NFR-3's "How verified" column names `duration.test.ts`. No such file exists in
`engine/test/`; a repo-wide grep for `parseDuration` finds only its two production call
sites, never a test file.

**Concrete failure scenario:** a reader following the citation to verify the bare-int/suffix/
unparseable rules hits a dead path.

**What would resolve it:** write the test, or point the column at what actually exercises
this today — nothing does, precisely — and say so.

**Resolution:** replaced the dead citation with an honest statement — no dedicated test
exists; `box.test.ts` covers end-to-end timeout-abort behavior at one value, not these
parsing rules. Recorded as a gap, not a citation to trust.

---

### R-prd-7 — FR-13 requires the authoring skill to certify its own output, the exact anti-pattern this project's own doctrine rejects

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic

**The claim:** FR-13 requires an execution transcript "the skill produced itself." `AGENTS.md`
states "verification inside the context that produced the evidence is not verification," and
separately calls out this exact skill's independent-verifier delegation and anti-self-dealing
rule as worth porting near-verbatim.

**Concrete failure scenario:** S7 is allowed to ship in parallel per the Goals section; an
implementer building strictly to FR-13's text reproduces the self-certification anti-pattern
the project has already identified and rejected elsewhere.

**What would resolve it:** require the transcript come from a delegated, independent
verification step, not the authoring skill's own run.

**Resolution:** FR-13 reworded to require the transcript come from a delegated, independent
verification step, citing `AGENTS.md`'s anti-self-dealing rule and the ported `attractorify`
skill's own independent-verifier convention directly.

---

### R-prd-8 — Open Question 6's "Blocks" column conflicts with the FR table and Assumptions section over whether FR-1/FR-2 are blocked

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**The claim:** Q6 names FR-1/FR-2 under "Blocks." Both the FR table (no blocked annotation,
unlike FR-8/12/17) and the Assumptions section ("FR-1/FR-2 assume it happens here") treat
them as already-resolved starting conditions.

**Concrete failure scenario:** a reader scanning the FR table starts building FR-1/FR-2
today; a reader scanning Open Questions is told the same rows are blocked.

**What would resolve it:** reconcile the two — either bracket-annotate FR-1/FR-2 to match the
blocked convention, or reword Q6's "Blocks" to name the packaging-location decision rather
than the FRs themselves.

**Resolution:** reworded Q6's "Blocks" column to state it confirms the target repo for
FR-1/FR-2 (already written assuming this repository, per Assumptions) rather than blocking
them — the FR table and Assumptions section were correct; the Open Questions table now agrees.

---

### R-prd-9 — General checkpoint crash-recovery is absent from Goals, Non-goals, and Open Questions, though the brief covers it generically

**Status:** fixed · **Severity:** minor · **Raised by:** feature-critic

**The claim:** the brief's cost-of-status-quo and success-signal language cover any
interrupted run generically; the PRD's only resume-related Non-goal is scoped narrowly to
the human-gate case (interpretation b).

**What would resolve it:** add an explicit Non-goal or Open-Question line for general
checkpoint read-back, distinct from the human-gate case.

**Resolution:** added as its own Non-goals line and Out-of-scope line, distinguished
explicitly from interpretation (b)'s human-gate-specific park/resume, and cross-referenced
from the new `NFR-9`.

---

### R-prd-10 — NFR-4's "no lock exists" claim has no concrete two-writer reproduction, unlike D7's fixture

**Status:** fixed · **Severity:** minor · **Raised by:** business-analyst, qa-strategist — independently

**The claim:** NFR-4 is precise about the code (verified: no lock primitive anywhere under
`engine/src`) but names no worked example of the actual on-disk consequence, so Open Question
8 asks the Product Owner to weigh an abstract risk with nothing demonstrated.

**What would resolve it:** name a concrete two-writer scenario and its actual on-disk result,
or state plainly that none has been reproduced yet.

**Resolution:** added a worked example to NFR-4 — two concurrent `attractor run` invocations
on one `--run-dir`, distinct PID-suffixed temp files, last `rename()` wins silently, the
other's progress discarded with no error — stated as code-read, not yet reproduced by
execution.

---

### R-prd-11 — Brief Open Question 4 (content-differentiation fidelity tiers) is dropped between brief and PRD with no disposition

**Status:** fixed · **Severity:** minor · **Raised by:** feature-critic

**The claim:** the brief frames this as an active decision scoping whether it belongs in the
MVP. It appears nowhere in the PRD — not Open Questions, not Non-goals, not Out-of-scope.

**What would resolve it:** add a one-line disposition, even "superseded, not relevant to this
slice, because X."

**Resolution:** carried forward as Open Question 10, since the brief left it genuinely
unresolved rather than answerable by this phase — recorded as "neither in nor explicitly
out," not silently dropped a second time.

## Assumptions worth watching

- That the doctrine gap in R-prd-1 (FR-9's runtime-vs-lint-time choice) gets a real
  Product-Owner decision before any implementer picks up the requirement — nothing in the
  document currently forces that sequencing.
- That interpretation (a) for S2 is an intentional, attended-mode-only cut rather than a
  placeholder — the PRD reads ambiguously between these two right now (R-prd-2).
- That FR-10's two-call-site fix and FR-9's runtime-verdict fix stay independent — both touch
  `engine.ts`'s failure-handling paths, and neither citation was found to conflict with the
  other, but no reviewer checked that in combination.
