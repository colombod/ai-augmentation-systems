---
description: Turn an approved PRD into a technical design grounded in the actual codebase, with decisions, spikes, migration plan and test strategy. Use once requirements are settled and before work is broken into stories. Produces docs/product/architecture.md.
---

# Architecture and technical design

Focus note from user: **$ARGUMENTS**

Phase 8 of the pipeline. Inputs: `docs/product/prd.md`, plus `prioritization.md` and `design-system.md` where they exist. Output: `docs/product/architecture.md` and ADRs in `docs/product/decisions/`.

## Gate check

Read `docs/product/prd.md`.

- **Missing** — stop. Designing against an unwritten specification produces a design for the wrong thing. Tell the user to run `/delivery:prd` and offer to run it now.
- **Non-functional requirements are vague or absent** — flag it. The architect needs numbers to design against; without them the design cannot be checked. Ask the user for the numbers or accept explicitly that the design is unvalidated on those axes.

If `docs/product/architecture.md` exists, read it and ask whether to revise or replace.


**Open blocking findings.** Read `docs/product/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Read the codebase before designing.** This is not optional and it comes first. Identify the modules the change touches, the existing patterns and conventions, and the interfaces already in place. A design that has not been checked against the real code is a guess.

**2. Solution Architect produces the design.** Delegate to `delivery:solution-architect` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/solution-architect.md` and adopt the persona). It must deliver:
- Component structure with **real file paths**, marking what changes, what is extended, what is untouched
- Interfaces and data contracts
- How each `NFR-n` from the PRD is met, addressed one by one
- Alternatives considered and why rejected, for every consequential decision
- The **spike list**: assumptions that must be proven before committing, each with a specific question and a time box
- Migration and rollback plan for any change to persisted data or public interfaces
- Risk register

**3. QA Strategist adds the test strategy.** Delegate to `delivery:qa-strategist` for the risk-based plan: what is tested at which level, where coverage is deliberately thin and why, and how the non-functional numbers get measured.

**4. Critic passes over it.** Delegate to `delivery:feature-critic` (read-only) to find the unstated assumption. Fold the blocking findings in before writing; report the rest.

**5. Write the design** to `docs/product/architecture.md` using `${CLAUDE_PLUGIN_ROOT}/templates/architecture.md`. Write each consequential decision as its own ADR in `docs/product/decisions/ADR-NNN-<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/adr.md`.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Component structure cites real, verified file paths
- Every `NFR-n` in the PRD is addressed explicitly, or listed as unmet with the reason
- Every consequential decision has stated alternatives
- The spike list exists — or the document states plainly that nothing needs proving, which is rare enough to justify
- Migration and rollback are covered, or explicitly not applicable
- Test strategy is present

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

Report exit criteria status, and surface the spike list prominently — the Program Manager needs it to sequence the plan. If the design revealed that a requirement is disproportionately expensive, state the tradeoff for the Product Owner rather than quietly simplifying it. Next step: `/delivery:roadmap`.
