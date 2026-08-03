---
description: Run discovery on a feature idea and produce a product brief. Use at the very start, when the idea is still a sentence and the problem, users and success measures have not been pinned down. Produces docs/product/brief.md.
---

# Product brief

Feature idea: **$ARGUMENTS**

Phase 1 of 5 in the delivery pipeline. Output: `docs/product/brief.md`.

## Gate check

No prerequisites — this is the entry point. If `docs/product/brief.md` already exists, read it, tell the user it exists, and ask whether to revise it or start fresh. Do not silently overwrite.

## Run

**1. Understand the ground truth first.** If this is an existing codebase, look at what is already there before writing anything about what should be. Note the current behavior the idea would change.

**2. Elicit with the Business Analyst.** Delegate to the `business-analyst` agent (via the Agent tool, `subagent_type: delivery:business-analyst`; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/business-analyst.md` and adopt the persona directly). Have it separate the stated request from the underlying need, map the current-state workflow including workarounds, and produce the open-questions register.

**3. Frame the value with the Product Owner.** Delegate to `delivery:product-owner` for: who specifically has this problem, what it costs them today, what changes if we solve it, and how we would measure that. The Product Owner must state a defensible MVP boundary.

**4. Ask the user the questions you cannot answer.** Discovery that invents its own answers produces a confident, wrong brief. Collect the open questions from both roles, drop the ones you can resolve from the codebase, and put the rest to the user in one batch. Record what remains unanswered as open questions rather than filling them in.

**5. Write the brief** to `docs/product/brief.md` using `${CLAUDE_PLUGIN_ROOT}/templates/brief.md`. Create parent directories as needed.

## Exit criteria

Do not report this phase complete unless the brief has:
- A named user segment, not "users"
- The problem stated as something that happens today, with its cost
- At least one measurable success signal
- An explicit out-of-scope list
- Open questions with owners, where any remain

## Hand off

Report which exit criteria are met and which are not. If open questions are blocking, say what is blocked. Then tell the user the next step is `/delivery:prd`.
