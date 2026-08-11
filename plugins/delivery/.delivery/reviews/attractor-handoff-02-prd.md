# Challenge findings: attractor-handoff/prd.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, qa-strategist, feature-critic, persona-simulator (The Spec-Literal Operator) · Reviewed: 2026-08-11 · Artifact version: `30ffe51`
> Version targeted: n/a — no Version-history table
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 4 | 7 | 4 | 0 |

**Independent convergence:** R-prd-1 found by 4 of 5 reviewers independently — the strongest signal any pass this initiative has produced. R-prd-2, R-prd-5 found by 3. R-prd-3, R-prd-4, R-prd-6, R-prd-7, R-prd-8, R-prd-11 found by 2.

**Reviewer quality note:** all five were substantive and independently verified claims against real files (multiple direct greps, direct reads of `sprint.md`/`sprint-review` skill/`marketplace.json`/attractor's own PRD) rather than trusting the PRD's own citations. None returned only praise or style notes. feature-critic self-filtered two low-confidence items as "not findings" rather than padding the list — respected here, not re-added.

## Findings

### R-prd-1 — FR-16's "unmodified" promise is contradicted by FR-17's own new Outcome value

**Status:** open
**Severity:** blocking
**Raised by:** product-owner, business-analyst, qa-strategist, feature-critic — independently: yes (4 of 5)

**The claim or omission:** FR-16 states `/delivery:sprint-review`'s existing procedure runs against an attractor report-back "without modification." FR-17 requires story `Outcome ∈ {done, non-convergent, blocked, not attempted}`. Verified directly: `templates/sprint.md:91-93` declares that column `done / blocked / not attempted` — three values, no fourth. `skills/sprint-review/SKILL.md` has no branch for a fourth value either.

**Concrete failure scenario:** Implementation follows FR-16 literally and touches nothing in `sprint.md` or the sprint-review procedure. The first `non-convergent` value written into that column either gets silently folded into `blocked` (destroying the distinction FR-9 exists to create) or breaks sprint-review's parsing — discovered mid-implementation that "unmodified" was never true.

**What would resolve it:** State explicitly that `sprint.md`'s Outcome enum is extended by this feature (and drop "without modification"), or specify how `non-convergent` maps onto the existing three values for sprint-review's actual procedure.

---

### R-prd-2 — FR-17's "explicitly signed-off irreducible" names an approval mechanism that exists nowhere else

**Status:** open
**Severity:** blocking
**Raised by:** product-owner, qa-strategist, feature-critic — independently: yes

**The claim or omission:** FR-17: "`n` counts `met` plus explicitly signed-off `irreducible`." This phrase appears exactly once in the entire document chain (confirmed by grep across `prd.md`, `brief.md`, `research.md`, the simulation). No FR, scenario, or open question names who signs off, when, or how.

**Concrete failure scenario (qa-strategist's worked example):** A story with 3 criteria — 2 `met`, 1 `irreducible` and never signed off — has no non-convergent criterion, so FR-17's flip rule never fires. By elimination the only Outcome value left is `done`, even though one criterion is an unresolved judgment call. This directly contradicts S-4's stated intent ("a reader who reads only the top of the report cannot miss that part of the sprint rested on a marked judgment call") — the exact self-report failure this feature exists to prevent, reproduced by its own rollup rule.

**What would resolve it:** Define the sign-off mechanism (who, when, what interface) as part of S-4, or remove "signed-off" from the `n` formula and let any unresolved `irreducible` criterion permanently exclude a story from `done`.

---

### R-prd-3 — FR-6's "documented engine substitution list" does not exist

**Status:** open
**Severity:** blocking
**Raised by:** qa-strategist, feature-critic — independently: yes (both via repo-wide grep, zero other hits)

**The claim or omission:** FR-6 (must): a compiled check may reference "the criterion text or a documented engine substitution list — no unaccounted key." No such list exists anywhere in the repo, and nothing schedules its creation or names an owner.

**Concrete failure scenario:** A `must`-priority acceptance criterion at the heart of the traceability mechanism (FR-5/6/7) is unverifiable as written — any key can be waved through by pointing at "the substitution list," which quietly reopens the exact self-report risk FR-5/6 exist to close.

**What would resolve it:** Name where the list lives and who owns it (even as an open question blocking S-2), or drop the substitution-list clause until one exists.

---

### R-prd-4 — FR-18's verdict-mapping logic is underspecified on direction and the empty-ledger case

**Status:** open
**Severity:** blocking
**Raised by:** qa-strategist, persona-simulator — independently: yes, different specific angles

**The claim or omission:** FR-18 says the `outputs=` ledger is "the deciding test" between Accepted-with-debt and Not-accepted but never states which ledger outcome maps to which verdict. Separately, `outputs=` is fully opt-in per attractor's own README — a story can be non-convergent with nothing in the ledger to test at all, and FR-18 gives no rule for that case. Persona-simulator independently found a related gap: FR-2 requires the full `depends_on` graph compiled 1:1, but FR-18's deciding test only reads the narrower `outputs=` ledger — a real dependency can exist without being wired into that ledger, and FR-18 would then silently under-classify it.

**Concrete failure scenario:** Two implementers reading FR-18 in isolation build the direction rule oppositely; a leaf story's non-convergent gate with no ledger entry gets no defined verdict at all.

**What would resolve it:** State the mapping direction explicitly; define the empty-ledger case; reconcile FR-18's ledger-only test against FR-2's broader `depends_on` graph or state why the narrower edge is the correct one.

---

### R-prd-5 — Goals claims the "who's grading the gate" objection is closed while the PRD's own open-questions table says it isn't

**Status:** open
**Severity:** significant
**Raised by:** product-owner, feature-critic, persona-simulator — independently: yes (3 of 5)

**The claim or omission:** Goals: "closing the 'who's grading the gate' objection three personas raised independently." But OQ-1 — which blocks S-2's own acceptance criteria completion — is explicitly unresolved, and the interview record splits the objection in two: P-1/P-2's half is answered by FR-5/6/7's traceability; P-4's half needs "a legible, non-technical trust signal," which no FR delivers and no Non-goal excludes.

**Concrete failure scenario:** A reader takes Goals at face value and doesn't notice the one persona this feature was meant to protect (P-4, per the simulation: "completing the journey... and that is the finding, not a clean result") still has no answer.

**What would resolve it:** Soften the Goals claim to match what's actually closed, and make an explicit, stated choice about P-4's trust-signal need (even if the choice is "deferred, and here's why") rather than leaving FR-15-18's data-only framing to stand in for it silently.

---

### R-prd-6 — S-1's "duplicate criteria" edge-case row cites FR-5 for a disambiguation mechanism FR-5 doesn't contain

**Status:** open
**Severity:** significant
**Raised by:** business-analyst, qa-strategist — independently: yes, identical finding

**The claim or omission:** The row claims "story ID + criterion identifier" disambiguates duplicate criterion text, citing FR-5 as "confirmed to already work." FR-5's actual text names only criterion text, `FR-n` reference, and derived check — never "story ID" or "criterion identifier," and `story.md`'s template has no separate per-criterion identifier field either.

**Concrete failure scenario:** Two stories share identical criterion text (e.g. "responds within 200ms"). Nothing in FR-5 as written distinguishes which story a given gate belongs to, contradicting the row's "confirmed to already work" claim.

**What would resolve it:** Either add the missing disambiguation requirement to FR-5 explicitly, or correct the edge-case row to state this is unresolved, not confirmed.

---

### R-prd-7 — Bare "gate" is used throughout, violating the glossary's own same-session ruling

**Status:** open
**Severity:** significant
**Raised by:** business-analyst, feature-critic — independently: yes, both via direct grep

**The claim or omission:** The glossary (curated the same session) requires "always say 'acceptance gate' in full" and flags bare "gate" as colliding with `Handoff readiness check` and attractor's own `goal_gate` attribute. The PRD uses bare "gate"/"gates"/"gated" 19 times, including in a scenario heading ("S-3: Gate fails..."). The glossary's own curation log claims "`prd.md` written under these terms from the start — no retroactive fix needed" — confirmed false.

**Concrete failure scenario:** A reader hits "not compiled with zero gates" and cannot tell, from the sentence alone, which of the three collision-prone senses is meant — the exact ambiguity the glossary entry exists to prevent.

**What would resolve it:** A find-and-replace pass to "acceptance gate" on first use per section; correct the curation log's false claim.

---

### R-prd-8 — The brief's promised Success signals were never carried into the PRD

**Status:** open
**Severity:** significant
**Raised by:** product-owner, business-analyst — independently: yes

**The claim or omission:** `brief.md` named two success signals, both explicitly "TBD at PRD stage." Neither appears anywhere in `prd.md` — no metrics section, no NFR, no open-question row. The load-bearing assumption underneath both ("most criteria can be mechanically compiled") is stated in Assumptions with no threshold or owner.

**Concrete failure scenario:** The feature ships 19 "must" FRs with no defined way to measure whether it delivers the value Goals claims — the same untracked-outcome failure mode `harden`'s Finding C already produced for this plugin once.

**What would resolve it:** Add an explicit success-metric section or open-question row carrying the brief's signals forward, with a stated compile-rate threshold or an owner to set one.

---

### R-prd-9 — The compiled artifact's own write location is unspecified

**Status:** open
**Severity:** significant
**Raised by:** feature-critic

**The claim or omission:** Existing runner modes have explicit paths (`docs/superpowers/specs/...`, `docs/superpowers/plans/...`). Nothing in the PRD gives the attractor artifact an equivalent — the exact gap the simulation's P-3 walk flagged as its sharpest concern ("would stop here and go read code first") and part of what left P-1/P-2's S9 return-after-being-away friction unresolved.

**Concrete failure scenario:** Architecture invents a path ad hoc, or output scatters per-run under attractor's own `--run-dir` (already flagged unsafe/undocumented by `NFR-4`); a returning operator has no fixed place to look.

**What would resolve it:** One line giving the compiled artifact an explicit write-path convention, matching Mode A/B.

---

### R-prd-10 — FR-19 silently extends to `superpowers`/`generic`, inconsistent with a Non-goal that explicitly declines the same move

**Status:** open
**Severity:** significant
**Raised by:** product-owner

**The claim or omission:** FR-19 (zero-criteria refusal) applies "for any runner mode" — modifying shared infrastructure used by the two existing runners. Out of scope explicitly declines to do this for a comparable install-precondition check ("recommended as a follow-up, not mandated here"), with no stated reason the two cases are treated differently.

**Concrete failure scenario:** A `superpowers` handoff that worked yesterday starts refusing today, for a reason nobody scoped as this initiative's blast radius.

**What would resolve it:** Either scope FR-19 to `attractor` only (matching the Out-of-scope precedent), or state explicitly why this particular shared-infrastructure change is in scope when the comparable one isn't.

---

### R-prd-11 — FR-8's per-gate bound and NFR-1's per-story bound are never reconciled

**Status:** open
**Severity:** significant
**Raised by:** business-analyst, persona-simulator — independently: yes, related angles

**The claim or omission:** FR-8 bounds each gate; NFR-1 sizes a bound "per-story, summed across a sprint." A story with multiple criteria has multiple independently-bounded gates per FR-8, but NFR-1 never defines whether its number is a shared per-story budget or a ceiling each gate gets independently.

**Concrete failure scenario:** NFR-1's own sizing method ("max attempts/story") silently under-counts for any multi-criterion story, surviving even once OQ-2 supplies a real number — a unit mismatch, not a missing value.

**What would resolve it:** State whether the bound is per-gate or per-story-shared, and adjust NFR-1's sizing formula accordingly.

---

### R-prd-12 — FR-7's fixture requirement is ungrounded and uncosted

**Status:** open
**Severity:** minor
**Raised by:** product-owner

**The claim or omission:** "Every compiled check ships a deliberately-failing fixture" is marked `must` with zero grounding anywhere in the brief/research/interview/simulation record (confirmed by search), doubling per-criterion authoring cost with no weighing against `research.md`'s own cited cost risk ("supervision costs exceeded manual development").

**Concrete failure scenario:** A 15-story sprint now needs ~45 fixtures alongside ~45 checks, uncosted and unbudgeted, marked as load-bearing as the traceability requirements beside it.

**What would resolve it:** Either cite the grounding for this requirement or downgrade it to `should` pending a cost/benefit note.

---

### R-prd-13 — Cross-plugin `ADR-008` collision, cited by bare ID

**Status:** open
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** OQ-7 cites bare `ADR-008` for delivery's "setup is a prerequisite" doctrine. Attractor has its own, unrelated `ADR-008` (branch-worktree isolation) in a different decision log, currently only on an unmerged worktree.

**Concrete failure scenario:** Whoever answers OQ-7 greps "ADR-008," finds two hits, and has a real chance of opening the wrong, topically-adjacent one.

**What would resolve it:** Cite the full path (`plugins/delivery/.delivery/decisions/ADR-008-setup-is-a-prerequisite-not-a-feature.md`) in OQ-7.

---

### R-prd-14 — Newly-coined glossary terms aren't used in the PRD text they were coined for

**Status:** open
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** The glossary's `Runner availability check` entry cites `prd.md FR-13/FR-14` as its referent; the phrase itself never appears there — S-5 describes the concept only via ad hoc phrasing.

**Concrete failure scenario:** A later document uses the governed term correctly; a reader tracing it back to this PRD has to infer the mapping rather than find it used at origin.

**What would resolve it:** Use the governed term at least once in S-5/FR-13/14.

---

### R-prd-15 — S-1's "zero stories" edge-case row's claimed backing doesn't clearly hold

**Status:** open
**Severity:** minor
**Raised by:** qa-strategist

**The claim or omission:** The row claims this is "refused at the existing readiness check" — but neither `skills/handoff/SKILL.md`'s Gate check nor `sprint.md`'s pre-flight checklist has a bullet that fires on zero stories; every bullet is vacuously satisfied. Marked **PLAUSIBLE**, not confirmed — an upstream `sprint/SKILL.md` check may or may not reliably catch this.

**Concrete failure scenario:** A genuinely empty sprint scope package reaches handoff unrefused.

**What would resolve it:** Verify whether `skills/sprint/SKILL.md`'s "no stories ready" check actually catches a zero-story scope table, or add an explicit bullet.

## Assumptions worth watching

- The panel's steelman (feature-critic): the core traceability-plus-bounded-loop design is well-defended and the two prior-review items spot-checked (`R-brief-6`, `R-brief-7`) are genuinely resolved/tracked, not just claimed to be — the defects found here are concentrated in the rollup/verdict logic (S-4/S-6), not the foundational mechanism.
- Nearly every blocking/significant finding here traces to the same root cause: `FR-17`/`FR-18`'s rollup and verdict logic was drafted at a level of complexity that outran what got cross-checked against `sprint.md`'s actual existing schema. Worth a focused revision pass on just those two FRs rather than treating the 15 findings as independent.
