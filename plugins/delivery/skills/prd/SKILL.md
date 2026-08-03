---
description: Turn a product brief into a full PRD with user scenarios, acceptance criteria and non-functional requirements. Use once the problem and users are settled and you need a specification precise enough to design against. Produces docs/product/prd.md.
---

# Product requirements document

Scope note from user: **$ARGUMENTS**

Phase 5 of the pipeline. Inputs: `docs/product/brief.md`, plus `research.md`, `personas/`, `interviews/` and `simulations/` where they exist. Output: `docs/product/prd.md`.

## Gate check

Read `docs/product/brief.md`.

- **Missing** — stop. Tell the user to run `/delivery:brief` first, and offer to run it now. Do not improvise a brief.
- **Exists but thin** (no named user segment, no measurable success signal, or unresolved blocking questions) — say specifically what is weak, and ask whether to proceed anyway or strengthen the brief first. Proceeding on a weak brief is a legitimate choice, but it should be a choice.
- If `docs/product/prd.md` already exists, read it and ask whether to revise or replace.

## Run

**1. Product Owner drafts the scenarios.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). Each scenario needs an actor, a trigger, a sequence, and an observable outcome — not a feature-list entry. Each gets falsifiable acceptance criteria.

**2. Business Analyst stress-tests them.** Delegate to `delivery:business-analyst` with the draft scenarios. It walks the unhappy-path checklist systematically — empty, single, large, duplicate, concurrent, permission denied, resource missing, partial failure, timeout, undo — and produces the non-functional requirements as numbers.

**3. QA Strategist checks verifiability.** Delegate to `delivery:qa-strategist` to check every acceptance criterion: what would you run or observe to decide pass or fail? Rewrite any criterion that fails this test. This step catches more real defects than any later testing, so do not skip it under time pressure.

**4. Resolve or record.** Where the roles disagree or a number is unknown, put it to the user. Anything still unresolved goes in the open-questions register with an owner — never invent a latency target or a data volume.

**5. Write the PRD** to `docs/product/prd.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Give every requirement a stable ID (`FR-1`, `NFR-1`) — the roadmap, stories and tests will reference these, and renumbering later breaks the chain.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every scenario has an actor, trigger, sequence and observable outcome
- Every scenario has at least one error or edge path
- Every acceptance criterion is falsifiable by someone who did not write it
- Non-functional requirements are numbers, or explicitly listed as open questions
- Requirements have stable IDs
- Out of scope is stated explicitly

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Hand off

Report exit criteria status honestly, including any criterion you could not make falsifiable. Recommend `/delivery:review-scenarios` before design — the adversarial pass is cheapest here. Then `/delivery:architecture`.
