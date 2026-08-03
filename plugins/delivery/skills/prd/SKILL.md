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


**Open blocking findings.** Read `docs/product/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

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

**Budget: 1000 words target, 1600 hard cap, for the document.** Excludes code, YAML and data
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

Report exit criteria status honestly, including any criterion you could not make falsifiable. Recommend `/delivery:review-scenarios` before design — the adversarial pass is cheapest here. Then `/delivery:architecture`.
