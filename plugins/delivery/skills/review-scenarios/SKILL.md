---
description: Convene a review panel on features and user scenarios to find gaps, ambiguities and load-bearing assumptions before design starts. Use on a PRD, a set of scenarios, or any planning document that is about to be committed to. Read-only — produces findings, not edits.
---

# Scenario and feature review

Target: **$ARGUMENTS** (defaults to `docs/product/prd.md` if empty)

A read-only adversarial pass. This skill does not modify planning documents — it returns findings and lets you decide what to act on.

## Gate check

Resolve the target: the argument if given, otherwise `docs/product/prd.md`, otherwise `docs/product/brief.md`. If none exists, say so and stop — there is nothing to review.

## Run

Read the target document fully before dispatching anyone. Then run four independent reviews. Run them **in parallel** in a single message — they must not see each other's findings, or they will converge and you lose the independence that makes the panel worth running.

Each reviewer is explicitly read-only: instruct every one of them to modify no files and return findings only.

| Reviewer | Lens |
| :-- | :-- |
| `delivery:product-owner` | Is this worth building? Is scope honest? Do scenarios describe real user value with falsifiable criteria? |
| `delivery:business-analyst` | Ambiguities, gaps, conflicts, unstated assumptions. Which cases are missing? |
| `delivery:qa-strategist` | Which criteria cannot be verified as written? Where is real risk with no planned check? |
| `delivery:feature-critic` | What load-bearing assumption would sink this? What is absent rather than wrong? |

If subagents are unavailable, read each persona file under `${CLAUDE_PLUGIN_ROOT}/agents/` and work through the lenses sequentially, keeping each pass separate.

## Synthesize

Merge the findings yourself — do not just concatenate four reports.

1. **Deduplicate.** Where multiple reviewers found the same issue, merge them and note the agreement. Independent convergence is a strong signal; say so.
2. **Rank by expected cost**, not by reviewer order. Cost = likelihood it bites × cost of fixing it later.
3. **Classify** each as **blocking** (resolve before design), **significant** (resolve before implementation), or **minor** (note and move on).
4. **Drop the preferences.** Anything that is "I would have done it differently" without a concrete failure scenario does not make the list. Say how many you dropped.

For each surviving finding give: the specific claim or omission, the concrete failure scenario, and what would resolve it.

## Report

Present the ranked findings. If the document is genuinely sound, say so and name the two or three assumptions worth watching — do not pad the list to look thorough.

Then ask the user which findings to act on. Only after they choose, apply the agreed changes to the target document.
