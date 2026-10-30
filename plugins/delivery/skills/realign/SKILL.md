---
description: Fold what a sprint taught back into the plan — update invalidated assumptions, recalibrate estimates, re-stage priorities and adjust the roadmap. Use after /delivery:sprint-review. Closes the loop so the next cycle starts from what is now known.
argument-hint: "[sprint-or-initiative]"
---

# Re-align the plan

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Sprint: **$ARGUMENTS** (defaults to the most recently reviewed sprint)

The closing step of a cycle. A retrospective that produces insight and changes no
document is a retrospective nobody acts on — this is where the learning lands.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read the sprint review in `.delivery/sprints/`, plus `prd.md`, `prioritization.md`,
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

When it is a row of the initiative's assumption register (`assumptions.md`), settle it there with
the evidence row that disproved it (`node ${CLAUDE_PLUGIN_ROOT}/scripts/assumptions.js refute <A-n>
--evidence <ev-id>`), never by editing the status by hand: the gates read that row, and a refuted
assumption holds the stories resting on it until the design changes and ready is re-recorded.

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

Re-staging keeps `/delivery:prd`'s staging rules: what must survive in the owner's words stays in
the MVP unless the owner's record says otherwise, and a requirement newly outside the primary
picture is *proposed for not doing*, kept in its stage until the owner's record. If the journey the
storyboard's cards tell, the MVP's `FR-n` list or the proposition changes, the storyboard
(`storyboard.md`) is reopened: clear its approval, say so, and put it to the owner with every open
proposal in the same message, as `/delivery:prd` step 6.7 says; the roadmap
update in step 4 marks the phases it affects "storyboard reopened: awaiting the owner" and does
not stop.

**4. Re-sequence.** Delegate to `delivery:program-manager` to update the roadmap: revised
sizes, new dependencies the sprint exposed, and the critical path recomputed. Carried debt
from the review is work — it goes in a phase with an owner, or it is explicitly accepted
as permanent. Debt that is neither is debt that never gets paid.

**5. Calibrate the persona phases.** The review compared predicted friction against real
friction. If simulation missed things the real implementation hit, say so in
`personas/README.md` — it is the only feedback loop those phases have, and it should make
the next `/delivery:simulate` output trusted more or less accordingly.

**6. Close or carry findings.** Every finding the sprint resolved gets marked `fixed` in
`.delivery/reviews/`. Anything still open stays open and keeps appearing in
`/delivery:status`.

## Write

Write the cycle record to `.delivery/sprints/<n>-realign.md`, listing every document
changed and why. Then make the actual edits to those documents.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every invalidated assumption updated at its source, not just noted
- Estimate corrections applied to comparable remaining work, not only the item that missed
- MVP staging re-checked against end-to-end persona coverage
- Carried debt scheduled with an owner or explicitly accepted as permanent
- Simulation calibration recorded
- Findings closed or explicitly still open

## Writing, then revising

**Budget: 600 words target, 1000 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report what changed and what it means for the plan — particularly any change to the MVP
boundary or the end date, since those are the originator's to accept.

Next step: `/delivery:sprint` to scope the following wave, or the specific repair the
review named if personas still cannot complete their journey.
