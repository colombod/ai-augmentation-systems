---
description: Fold what a sprint taught back into the plan — update invalidated assumptions, recalibrate estimates, re-stage priorities and adjust the roadmap. Use after /delivery:sprint-review. Closes the loop so the next cycle starts from what is now known.
---

# Re-align the plan

Sprint: **$ARGUMENTS** (defaults to the most recently reviewed sprint)

The closing step of a cycle. A retrospective that produces insight and changes no
document is a retrospective nobody acts on — this is where the learning lands.

## Gate check

Read the sprint review in `docs/product/sprints/`, plus `prd.md`, `prioritization.md`,
`roadmap.md`, `architecture.md`, `personas/` and open findings in `reviews/`.

If no sprint review exists, stop and run `/delivery:sprint-review` first. Re-planning
from a sprint's own self-report rather than an independent verdict re-uses the optimism
you ran the review to remove.

## Run

Work through what the review found, and **change the documents** rather than noting the
change. Each edit records what it was before and why it changed — the history is what
makes the next estimate better than this one.

**1. Invalidated assumptions.** The review listed assumptions the sprint disproved. For
each, find its source document and update it. An assumption left standing in the PRD or
architecture after being disproved means every downstream phase inherits a known-false
premise, which is worse than never having stated it.

Where an assumption came from a persona, update the persona — and consider whether its
grounding grade should change. An `assumed` attribute that turned out true is still
`assumed`; one that turned out false should be corrected and marked.

**2. Estimates.** The review recorded which sizings were wrong and in which direction.
Apply the correction to the remaining roadmap items of similar shape. Do not just fix the
one that was wrong — the bias usually generalises, and a team that under-sizes integration
work under-sizes all of it.

**3. Re-stage.** Delegate to `delivery:product-owner`. The sprint may have changed what is
worth doing next: a feature turned out cheap, a persona need turned out shallow, a
dependency turned out to block more than expected. Re-check the MVP boundary against what
is now known, applying the same rule as before — **a stage must let at least one persona
finish a journey end to end.**

If the review found that personas could not complete their journey, that outcome dominates
this step: the next stage's job is to close that gap, not to add scope.

**4. Re-sequence.** Delegate to `delivery:program-manager` to update the roadmap: revised
sizes, new dependencies the sprint exposed, and the critical path recomputed. Carried debt
from the review is work — it goes in a phase with an owner, or it is explicitly accepted
as permanent. Debt that is neither is debt that never gets paid.

**5. Calibrate the persona phases.** The review compared predicted friction against real
friction. If simulation missed things the real implementation hit, say so in
`personas/README.md` — it is the only feedback loop those phases have, and it should make
the next `/delivery:simulate` output trusted more or less accordingly.

**6. Close or carry findings.** Every finding the sprint resolved gets marked `fixed` in
`docs/product/reviews/`. Anything still open stays open and keeps appearing in
`/delivery:status`.

## Write

Write the cycle record to `docs/product/sprints/<n>-realign.md`, listing every document
changed and why. Then make the actual edits to those documents.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every invalidated assumption updated at its source, not just noted
- Estimate corrections applied to comparable remaining work, not only the item that missed
- MVP staging re-checked against end-to-end persona coverage
- Carried debt scheduled with an owner or explicitly accepted as permanent
- Simulation calibration recorded
- Findings closed or explicitly still open

## Language

Read `docs/product/glossary.md` first and use its terms exactly. If it does not exist, run
`/delivery:glossary` — or, for a small effort, collect terms as you go and propose the file
at the end. Do not coin synonyms for concepts it already names.

Any term you need that is missing gets **proposed explicitly**, with a definition in the
business's vocabulary and a concrete referent. Any term carrying two meanings gets raised as
a defect, not resolved silently.

**Questions go out in the vocabulary of whoever must answer them**, with a worked example in
their world. A question for the business owner written in engineering terms is a blocker
with a name on it, not a question. If a question is really an engineering call, decide it
here rather than routing it to them.

## Writing, then revising

**Budget: 600 words target, 1000 hard cap** (excludes code, YAML and data tables).

**Compose first. Do not try to hit the budget while writing.** Restraint during
composition trades substance for brevity in the wrong order — the findings get thinner
while the scaffolding survives. Write what the artifact needs, then cut what it does not.

**Then measure, do not estimate.** The budget counts **prose only**. Data tables, code
blocks and YAML are excluded, so measure with them stripped:

```bash
grep -v '^|' <the file you just wrote> | wc -w
```

A plain `wc -w` counts the tables and will overstate the total, often by several times.
Measuring the wrong number leads to cutting the wrong thing.

**Rows in a data table can never help you meet the budget, because they are not counted.**
Deleting them is pure loss for zero benefit. The term table, the requirement table, the
findings table, the friction map — these *are* the artifact. If a revision pass is removing
rows, it has misunderstood the rule and should stop.

**If the count exceeds 1000, you are not finished.** Make a revision pass over the file and
delete, in this order, until it fits:

1. Preamble, recap, and any sentence describing what the document is about to say
2. **Restatement** — the same fact as prose *and* a table row *and* a summary bullet. Keep the form that carries it best; delete the others. This is almost always the biggest win.
3. Process narration — "I examined X and found Y" becomes Y
4. Hedging — either you know it, or it is labelled an assumption. Both are shorter.
5. Citations past the first for a given claim
6. Examples past the first, unless the next one shows a *different* failure mode

Then re-measure with the same command and confirm.

**Never delete** any row of a data table, findings and their failure scenarios, one citation per claim, grounding
and confidence labels, synthetic-output warnings, open questions, or IDs a later phase
reads. If the artifact cannot fit without losing those, keep them, exceed the cap, and
**write the final count and the reason into the document**. A declared overrun is a
judgement. A silent one is a habit.


## Hand off

Report what changed and what it means for the plan — particularly any change to the MVP
boundary or the end date, since those are the originator's to accept.

Next step: `/delivery:sprint` to scope the following wave, or the specific repair the
review named if personas still cannot complete their journey.
