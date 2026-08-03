---
description: Prioritise features and define MVP stages and milestones, using persona simulation data to decide what each stage must contain to be worth shipping. Use after the PRD and simulation exist and before architecture. Produces docs/product/prioritization.md.
---

# Feature prioritisation and MVP staging

Constraint or focus: **$ARGUMENTS**

Phase 6 of the pipeline. Inputs: `docs/product/prd.md`, `docs/product/simulations/`, `docs/product/interviews/`, `docs/product/personas/`. Output: `docs/product/prioritization.md`.

## Gate check

Read the PRD. If it is missing, stop — you cannot prioritise requirements that have not been written down. Run `/delivery:prd` first.

Read the simulation and interview outputs if they exist. If they do not, warn clearly: **prioritisation without persona data is prioritisation by opinion.** It is a legitimate choice, but the resulting stages rest on the team's beliefs about value rather than on any model of user behavior, and the document must say so. Offer to run `/delivery:simulate` first.


**Open blocking findings.** Read `docs/product/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Establish the staging rule.** A stage is not a batch of features. A stage is a set of features that lets **at least one persona complete a journey end to end and get value**. A stage that serves nobody completely is a milestone in the project plan, not a release — and calling it an MVP is how teams ship something no one can use.

Take this directly from the simulation's per-persona coverage data: for each candidate stage, name which personas can complete which journeys. If the answer is none, the stage is wrongly cut.

**2. Score each requirement.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). For every `FR-n`:

| Dimension | Source |
| :-- | :-- |
| **Personas served** | which personas need it, from the persona files |
| **Load-bearing?** | does its absence cause abandonment, from the friction map |
| **Severity** | friction-map ranking |
| **Objection addressed** | which interview objection it answers, if any |
| **Effort** | rough size, flagged as an estimate not yet architecture-informed |
| **Confidence** | grounding grade of the persona evidence behind the score |

Load-bearing beats enhancement. A feature that prevents abandonment for two personas outranks one that delights one persona, unless the delight is the differentiator — and if it is, say so explicitly rather than letting it win quietly.

**3. Cut the stages.** Typically MVP / Stage 2 / Stage 3 / explicitly-not-doing. For each stage state:

- Requirements included, by `FR-n`
- **Personas who can complete a journey end to end** — the test of whether it is a real stage
- Personas explicitly *not* served yet, and when they will be. Naming this prevents a segment from being silently abandoned.
- What the stage lets you learn — each stage should answer a question, since a stage that teaches nothing could have been merged into the next one
- Why the excluded features can wait, in terms of the friction map

**4. Define milestones.** Each milestone gets a demonstrable outcome — what you would show, and to whom. Distinguish **release milestones** (users get something) from **learning milestones** (you find something out, such as a spike or a real-research checkpoint from the backlog). Both are legitimate; conflating them is not.

**5. Have the Program Manager check feasibility.** Delegate to `delivery:program-manager` for whether the stages can actually be sequenced this way, and what dependencies would force a reorder.

**6. Have the critic attack the MVP boundary.** Delegate to `delivery:feature-critic` (read-only) with one question: *is the MVP actually viable, or is it the minimum product with the viability removed?* Fold blocking findings in.

## Write

Write to `docs/product/prioritization.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prioritization.md`.

Where scores rest on `assumed`-grade personas, mark them. A prioritisation built on invented users is a plan for an invented market, and the reader is entitled to know how much of it is that.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every `FR-n` scored and assigned to a stage or explicitly excluded
- Every stage names the personas who can complete a journey end to end
- Personas not yet served are named per stage, with when they will be
- Each stage states what it lets you learn
- Milestones are demonstrable, and release milestones are distinguished from learning milestones
- Confidence reflects the grounding of the persona evidence

## Writing

**Budget: 700 words target, 1100 hard cap, for the document.** Excludes code, YAML and data
tables. Count before finishing; do not estimate.

These numbers are stated here, not only in the template, because the template file may not
be readable from the working directory this runs in — a rule that lives only in a file the
model cannot open is not a rule.

Over the cap, cut in this order: preamble and recap, restatement (each fact appears once,
in the form that carries it best), process narration, hedging, redundant citations,
examples past the first. **Never cut** findings and their failure scenarios, one citation
per claim, grounding and confidence labels, synthetic-output warnings, open questions, or
IDs a later phase reads. If it will not fit without losing those, keep them, go over, and
**write the overrun and its reason into the document.**

The full standard is at `templates/writing-standard.md` in the plugin, where readable.


## Hand off

Report the stages, and lead with the MVP's persona coverage — that is the claim everything else rests on. Flag any persona served by no stage at all.

Next step: `/delivery:architecture` to design the MVP stage, then `/delivery:roadmap` to sequence delivery.
