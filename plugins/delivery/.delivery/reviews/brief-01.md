# Challenge findings: plugins/delivery/.delivery/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic · Reviewed: 2026-08-05 · Artifact version: commit `81340d0`

A finding leaves this list by being **fixed** or **rejected with a stated reason**.
Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 3 fixed | 8 fixed | 2 fixed | 0 |

**Independent convergence:** R-brief-1 (product-owner + business-analyst, independently)
and R-brief-4 (product-owner + business-analyst, three separate instances between them)
are the strongest signal — nothing style-only, everything agreed on was a factual or
scope-discipline failure.

**Reviewer quality note:** all three did their job. Feature-critic additionally verified
one of its own findings (R-brief-3) directly against the plugin source before reporting it,
rather than asserting from memory — the correct behavior this whole brief is arguing for.

## Findings

### R-brief-1 — "~3 days of a 38-hour session" is arithmetically incompatible

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner, business-analyst, independently

**The claim:** Cost table, Finding A row: "~3 days of a 38-hour session." 3 days ≈ 72 hours, nearly double the stated session length.

**Concrete failure scenario:** a reader lifts this as the headline cost figure for Finding A without noticing the two numbers can't both describe the same session, and repeats an internally-contradictory number in prioritization.

**Resolution:** replaced with the verbatim operator quote alone ("you wasted 3 f***ing days this could have been built in one") and removed the derived "38-hour session" framing from that cell — the quote is evidence of cost as the operator experienced it; converting it to a session-fraction was an invented, wrong computation.

---

### R-brief-2 — the stated word count does not match the artifact

**Status:** fixed · **Severity:** blocking · **Raised by:** business-analyst

**The claim:** Header stated "1591" words, measured by `grep -v '^|' | wc -w`.

**Concrete failure scenario:** running the exact stated command returns 1622 — a reader trusts the one fully tool-checkable claim in the document without re-running it, and it's wrong.

**Resolution:** corrected to 1622 (verified by re-running the command after all fixes below).

---

### R-brief-3 — Finding B's claim that no downstream table carries a grounding column is false for `templates/prioritization.md`

**Status:** fixed · **Severity:** blocking · **Raised by:** feature-critic (verified directly against plugin source, not asserted)

**The claim:** "No downstream table... carries a grounding column." `templates/prioritization.md` defines a `Confidence` column (observed/assumed) in its scoring table and an `Evidence` column in its per-stage persona table — this part of the claim is wrong. (The parallel claim about `templates/simulation.md`'s friction map having no such column is accurate and stands.)

**Concrete failure scenario:** exactly the failure mode Findings A and C describe — a specific, checkable claim about a named file, asserted without checking, in the document arguing against exactly that. Also mis-scopes the MVP item: the field already exists, so only the enforcement rule is missing, making the item smaller than costed.

**Resolution:** rewrote Finding B to state the column exists but nothing enforces it — no rule blocks a stage or score from proceeding when `Confidence` reads `assumed`. MVP boundary item narrowed from "a rule change plus a template column" to "a rule change" only.

---

### R-brief-4 — the brief overgeneralizes past its own stated N=1-operator evidence scope, in three separate places

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner (2 instances), business-analyst (1 instance), independently

**The claim:** "Who has it" asserts "small-team operator" with no team-based evidence anywhere in the transcripts; Finding C claims acceptance-channel failure is the plugin's "most common case" from a sample where only one of two projects was UI-facing at all; the Cost table's "Affected" column reads "any long session" / "any user-facing UI work" against the Coverage section's own admission that this is "not a broad sample."

**Concrete failure scenario:** a reader scopes a fix to solve multi-operator handoff (never observed) or treats UI-acceptance failure as established as typical of the plugin's user base (shown in one of two projects).

**Resolution:** "small-team" struck, left as "solo operator." "Most common case" narrowed to "elba-dreaming's own most common case." Cost table's "Affected" column reworded to name the specific project(s) observed rather than "any."

---

### R-brief-5 — Coverage table's "several single-lens" claim and the absence lens's unique-credit claims don't match the Problem section

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**The claim:** Coverage table promised "several single-lens" findings; only one appears ("no dogfooding"). The absence-lens row separately claimed unique credit for "missing invocation-provenance" (folded into the 4/4 Finding A) and "the missing middle ground between a checkbox and a self-report" (never became its own finding, only appeared inside Explicitly-out-of-scope).

**Resolution:** Coverage table corrected to "one single-lens finding." Absence lens's coverage-table credit line narrowed to what it actually contributed uniquely: the dogfooding finding and the "missing middle ground" framing, the latter now cross-referenced from Explicitly-out-of-scope back to the Coverage section instead of implied as a standalone finding.

---

### R-brief-6 — MVP boundary lists every finding as in scope with no real triage

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner

**The claim:** Findings A–D are all "in scope"; the one exclusion (dogfooding) was already the lowest-convergence, weakest item — no real tradeoff was made.

**Concrete failure scenario:** the next phase commits to four independent mechanism changes as one increment, misses a milestone, and re-triages later without this document having done that job.

**Resolution:** MVP boundary rewritten to rank by convergence and dependency: A first (precondition for D and for trusting any gate), C second (highest direct operator cost, evidenced twice), B and D marked as candidates for the same follow-on increment rather than the same first one, with the dependency stated explicitly (D can likely ride on A's mechanism rather than needing its own).

---

### R-brief-7 — Success signals 3 and 4 rest on one-off manual measurement with no way to reproduce them

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner

**Resolution:** added the same instrumentation-gap disclosure signal 1 already had to signals 3 and 4 — "Current" values for both are one-time transcript-mining measurements, not a standing metric; re-measuring next cycle requires either automation this brief doesn't scope or another manual pass.

---

### R-brief-8 — the "no manual approval checkbox" exclusion overgeneralizes a single operator quote

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**The claim:** one quote objecting to being asked for sign-off in one specific moment is used to foreclose "a manual human-approval checkbox at each gate" pipeline-wide — in tension with Open Question 3, which the exclusion pre-empts without argument.

**Resolution:** narrowed the exclusion to what the quote actually supports (rejecting a rubber-stamp substitute for real verification) and cross-referenced Open Question 3 as the place a lightweight, non-rubber-stamp checkpoint should actually be decided, not foreclosed here.

---

### R-brief-9 — "what changes if we solve it" conflates visibility with prevention

**Status:** fixed · **Severity:** minor · **Raised by:** feature-critic

**Resolution:** added one clause distinguishing that an invocation record makes the gap visible after the fact; it does not by itself stop the first narration-instead-of-invocation from happening — prevention is a separate, harder design question, named as such.

---

### R-brief-10 — Open Question 4 is decorative, already resolved operationally by Explicitly-out-of-scope

**Status:** fixed · **Severity:** minor · **Raised by:** feature-critic

**Resolution:** removed from Open Questions; folded a one-line pointer into Explicitly-out-of-scope instead, since that section already states the operational answer (proceed now, broaden evidence later).

---

### R-brief-11 — no lens asked *why* narration substitutes for invocation

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic

**The claim:** the brief documents that it happens, extensively, but never hypothesizes the incentive (plausibly: an Agent-tool delegation costs real tokens and latency the orchestrating agent can avoid by writing the expected output directly). Without naming the incentive, a fix that only adds detection (a ledger) may not remove the reason to skip.

**Resolution:** added as a new open question (below) rather than answered here — this is a real unknown, not something the brief should invent an answer to.

---

### R-brief-12 — a real screenshot alone does not catch defects a junior designer wouldn't make; nothing in the pipeline enforces a visual-quality rubric

**Status:** fixed · **Severity:** blocking · **Raised by:** live re-check during the challenge, prompted by the operator directly naming this gap

**The claim:** Finding C, as originally written, treated "use the right channel" (a real screenshot instead of a DOM read) as sufficient. Fresh evidence from the same elba-dreaming session, verified directly: after switching to real screenshots, the operator still had to flag a basic misalignment defect — "i looked at the screenshot, it looks a pretty bad ux, the apartment drop down selector is on its own line compare to the date selectors... you are not performing any visual quality assessment" — and, escalating: "I SHOULD NOT BE LOOKING, THIS IS BASIC VISUAL HYGIENE AND DECENCY AND QUALITY, HOW ARE YOU NOT CHECKING THAT?" The assistant's own diagnosis: `align-items: end` anchored two form fields to a shared bottom edge, and unequal caption heights below them threw off the visual row alignment — a real CSS defect a screenshot fully exposes, but that nothing was checking for. No `design-system.md` was ever created for this project (confirmed: absent from the codebase), so there was no token, spacing or alignment rule to check the render against. The assistant's own conclusion matches: "I'll make real visual alignment checks (not just 'does it render') standard for any UI change going forward" — a good intention with no mechanism behind it.

**Concrete failure scenario:** fixing only the channel (Finding C as originally scoped) produces a pipeline that takes correct screenshots and still ships visually broken UI, because nothing defines what "correct" looks like — the operator remains the de facto rubric, screen by screen, which is the exact "vibe-check" burden an AI-augmented delivery system exists to remove.

**Resolution:** Finding C rewritten to cover two layers, not one: (1) the channel must be real rendering, not DOM/text reads — as before; (2) a rendered check must be evaluated against an actual design/quality rubric (the pipeline already has a mechanism for this — `design-system.md` and the `design-lead`/`qa-strategist` roles — but nothing requires it to exist or be consulted before a UI story is called done). MVP boundary gained a fifth item: design-system conformance as a required input to UI acceptance criteria, not an optional phase.

## Assumptions worth watching

- The raw session transcripts this brief cites live outside this repository (`~/.claude/projects/...`), not embedded here — a reader cannot independently re-verify a quoted number or quote without that access. Flagged by feature-critic as unverifiable-not-false; the brief's numbers were re-checked against the source transcripts during this review pass, not merely trusted, but a future reader of this artifact alone cannot repeat that check. Revisit if this brief is ever cited without the transcript-mining agents' full output alongside it.
- That the operator's objection to a sign-off checkbox (Explicitly-out-of-scope) generalizes beyond the one specific moment it was said in — narrowed per R-brief-8, but worth re-confirming directly with the operator before treating it as settled design guidance.
