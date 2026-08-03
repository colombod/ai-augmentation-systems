---
description: Run an adversarial review panel against any pipeline artifact — brief, research, personas, PRD, prioritisation, design, architecture, roadmap or stories — and record ranked findings with tracked status. Use before committing to any artifact. Read-only; findings must be resolved or explicitly rejected, not silently dropped.
---

# Adversarial challenge

Target: **$ARGUMENTS** (an artifact path, or a phase name; defaults to the most recently written artifact)

This is the pipeline's review mechanism, usable at any gate. It is read-only: it produces findings, never edits.

## Why findings are tracked

An adversarial review that produces a list nobody acts on is theatre, and it is worse than no review because it manufactures the feeling of rigor. So every finding here is written to `docs/product/reviews/` with a status, and `/delivery:status` reports any that are still **open**. A finding leaves the list by being **fixed** or **rejected with a stated reason** — never by being ignored.

## Gate check

Resolve the target. If given a phase name, map it to its artifact. If nothing is given, take the most recently modified artifact under `docs/product/`. If the target does not exist, say so and stop.

## Choose the panel

Reviewer lenses are chosen by artifact type. Diversity of lens matters more than number of reviewers — three reviewers asking different questions beat five asking the same one.

| Target | Panel |
| :-- | :-- |
| `brief.md` | `product-owner`, `business-analyst`, `feature-critic` |
| `research.md` | `business-analyst`, `solution-architect`, `feature-critic` |
| `personas/` | `user-researcher`, `product-owner`, `feature-critic` |
| `prd.md` | `product-owner`, `business-analyst`, `qa-strategist`, `feature-critic` |
| `prioritization.md` | `product-owner`, `program-manager`, `user-researcher`, `feature-critic` |
| `design-system.md` | `design-lead`, `user-researcher`, `qa-strategist`, `feature-critic` |
| `architecture.md` | `solution-architect`, `qa-strategist`, `program-manager`, `feature-critic` |
| `roadmap.md` | `program-manager`, `product-owner`, `qa-strategist`, `feature-critic` |
| `stories/` | `delivery-lead`, `qa-strategist`, `solution-architect`, `feature-critic` |

`feature-critic` is on every panel — it is the only reviewer with no stake in the artifact moving forward.

Where personas exist and the artifact touches user-facing behavior, add one `persona-simulator` running the **skeptic** persona. A challenge from the user's side catches things no internal role will.

## Run

Read the target fully yourself before dispatching anyone — you need to judge the findings, not just relay them.

Run every reviewer **in parallel, in a single message**. They must not see each other's output: independent convergence is the signal this whole skill trades on, and shared context destroys it. Instruct each explicitly to modify no files and return findings only.

If subagents are unavailable, read each persona file under `${CLAUDE_PLUGIN_ROOT}/agents/` and work the lenses sequentially, keeping each pass isolated.

## Synthesize

Judge the findings; do not concatenate them.

1. **Deduplicate**, noting where reviewers independently agreed. Say so explicitly — convergence between reviewers who could not see each other is the strongest signal available here.
2. **Rank by expected cost** = likelihood it bites × cost of fixing it later, not by reviewer order or severity label.
3. **Classify**: **blocking** (resolve before the next phase), **significant** (resolve before implementation), **minor** (note and move on).
4. **Drop preferences.** Anything without a concrete failure scenario is not a finding. Report how many you dropped — that number is a quality signal about the panel.
5. **Check the reviewers.** A reviewer that returned nothing but praise, or nothing but style notes, did not do its job; say so rather than padding its output into the list.

For each surviving finding: the specific claim or omission, the concrete failure scenario, and what would resolve it.

## Write

Append to `docs/product/reviews/<artifact>-<nn>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/findings.md`. Every finding gets an ID (`R-<artifact>-<n>`) and status `open`.

Do not edit the target artifact in this skill. Present the findings and let the user decide; then apply agreed changes and mark those findings `fixed`. A finding the user declines is marked `rejected` **with their stated reason recorded** — the reason is the valuable part, because it is the assumption you will want to revisit when something goes wrong.

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

## Writing

**Budget: 120 words target, 200 hard cap, for each finding.** Excludes code, YAML and data
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


## Report

Lead with blocking findings and with anything multiple reviewers found independently.

If the artifact is genuinely sound, say so and name the two or three assumptions worth watching. Do not pad — a padded critique teaches people to skim the next one, which costs more than the finding you invented was worth.
