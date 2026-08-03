---
description: Assess acceptance of a completed sprint — criteria actually met, design system conformance, persona journeys now possible, and what the wave taught. Use after /delivery:sprint. Produces an acceptance verdict and feeds the next planning cycle.
---

# Sprint acceptance review

Sprint: **$ARGUMENTS** (defaults to the most recent sprint log)

The closing gate of an implementation wave. This decides whether the sprint is **accepted**, and it feeds what it learns back into planning.

## Gate check

Read the sprint log in `docs/product/sprints/`, the stories it covered, `docs/product/prd.md`, `docs/product/prioritization.md`, `docs/product/design-system.md` and `docs/product/personas/` where they exist.

If no sprint log exists, stop — there is nothing to review.

## The rule this skill exists under

The implementation was run by something else — your harness, superpowers, an agent, a team — and it reported its own results. A process that only ever grades itself drifts toward optimism, and a runner optimises for finishing. This review is deliberately independent: it re-checks acceptance criteria **against the code as it now exists**, rather than trusting the runner's report-back.

Where the report and the code disagree, the code wins and the discrepancy is itself a finding — it means that runner's self-assessment cannot be relied on, which matters more than the individual story and should change how much of its next report you believe.

Where the runner used its own task IDs rather than `FR-n` (superpowers does), use the ID mapping recorded in the scope package to trace results back to requirements. A criterion nobody can trace to a task is a criterion nobody verified.

## Run

**1. Verify acceptance criteria independently.** Delegate to `delivery:qa-strategist` (via the Agent tool; if subagents are unavailable, adopt the persona from `${CLAUDE_PLUGIN_ROOT}/agents/`). Read the criteria first, then check each against the current code — not against the sprint log. Every criterion gets met / not-met / partially-met with concrete evidence: the test that covers it, or the behavior observed.

**2. Run the test suite yourself** and report the real output. A sprint that claimed green and is now red is the single most important thing this review can catch.

**3. Check design system conformance.** Where a design system exists, delegate to `delivery:design-lead`: which tokens were used, which were bypassed with hardcoded values, which component states are missing, which contrast rules fail. Report file paths, not impressions.

**4. Check the persona journeys.** This is the question that matters most and the one story-level criteria cannot answer: *can a persona now complete a journey end to end and get value?* Delegate to `delivery:persona-simulator` for each persona whose journey this sprint was meant to enable, walking the **now-real** implementation. Label the output synthetic, as always.

A sprint where every story passed but no persona can complete a journey has delivered nothing usable, and only this check will tell you.

**5. Reconcile against the stage promise.** `prioritization.md` said what this stage would deliver and which personas it would serve. Compare what was promised to what is now true. Name any silent scope drop.

**6. Challenge the result.** Delegate to `delivery:feature-critic` (read-only) with the question: *what would make this acceptance verdict wrong?* Missing evidence, criteria passing on a technicality, tests asserting implementation rather than behavior.

## Verdict

State one of:

- **Accepted** — all criteria met with evidence, tests green, persona journeys work
- **Accepted with debt** — criteria met, but named issues are being carried forward, each recorded as a finding
- **Not accepted** — criteria unmet or journeys broken; state exactly what and what it would take

Do not soften this. A sprint review that never returns "not accepted" is not a gate, and everything downstream will be planned on a false baseline.

## Learn

Then capture what the wave taught, which is the part that improves the next one:

- **Stories that were wrong** — where the spec conflicted with reality, and what the story was missing. This is feedback for `/delivery:stories`.
- **Estimates that were wrong**, and in which direction. Feedback for `/delivery:roadmap`.
- **Assumptions invalidated** — from the PRD, architecture or personas. Anything invalidated needs those documents updated, or the next phase inherits a known-false premise.
- **Friction found in the real thing** that simulation missed, and vice versa. This calibrates how much to trust simulated output next time — genuinely valuable, because it is the only feedback the persona phases ever get.

## Write

Write to `docs/product/sprints/<n>-<slug>-review.md` using `${CLAUDE_PLUGIN_ROOT}/templates/sprint-review.md`. Record carried debt and invalidated assumptions as findings in `docs/product/reviews/` with status `open`, so `/delivery:status` keeps surfacing them until they are resolved or explicitly rejected.

## Hand off

Lead with the verdict and the persona-journey result. Then state what must be updated before the next sprint — invalidated assumptions in the PRD or architecture, stories that need rewriting, estimates that need recalibrating.

Next step: `/delivery:sprint` for the next wave if accepted, or the specific repair the verdict named.
