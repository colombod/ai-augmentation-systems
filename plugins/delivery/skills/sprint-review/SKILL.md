---
description: Assess acceptance of a completed sprint — criteria actually met, design system conformance, persona journeys now possible, and what the wave taught. Use after /delivery:sprint. Produces an acceptance verdict and feeds the next planning cycle.
---

# Sprint acceptance review

Sprint: **$ARGUMENTS** (defaults to the most recent sprint log)

The closing gate of an implementation wave. This decides whether the sprint is **accepted**, and it feeds what it learns back into planning.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Gate check

Read the sprint log in `.delivery/sprints/`, the stories it covered, `.delivery/prd.md`, `.delivery/prioritization.md`, `.delivery/design-system.md` and `.delivery/personas/` where they exist.

If no sprint log exists, stop — there is nothing to review.

## The rule this skill exists under

The implementation was run by something else — your harness, superpowers, an agent, a team — and it reported its own results. A process that only ever grades itself drifts toward optimism, and a runner optimises for finishing. This review is deliberately independent: it re-checks acceptance criteria **against the code as it now exists**, rather than trusting the runner's report-back.

Where the report and the code disagree, the code wins and the discrepancy is itself a finding — it means that runner's self-assessment cannot be relied on, which matters more than the individual story and should change how much of its next report you believe.

Where the runner used its own task IDs rather than `FR-n` (superpowers does), use the ID mapping recorded in the scope package to trace results back to requirements. A criterion nobody can trace to a task is a criterion nobody verified.

## Run

**1. Verify acceptance criteria independently.** Delegate to `delivery:qa-strategist` (via the Agent tool; if subagents are unavailable, adopt the persona from `${CLAUDE_PLUGIN_ROOT}/agents/`). Read the criteria first, then check each against the current code — not against the sprint log. Every criterion gets met / not-met / partially-met with concrete evidence: the test that covers it, or the behavior observed.

For any criterion describing rendered, visible behavior, this delegation applies
`delivery:qa-strategist`'s standing rule for verifying a UI-facing claim (see that agent's
own file — the channel must be a real capture, cross-checked against the invocation
ledger, and a visual "met" verdict must cite a `design-system.md` `Rule ID` or state
plainly that none exists). This is the same rule whether or not the work was checked ad
hoc before this formal review ever ran — it does not get a lighter version here.

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

Write to `.delivery/sprints/<n>-<slug>-review.md` using `${CLAUDE_PLUGIN_ROOT}/templates/sprint-review.md`. Record carried debt and invalidated assumptions as findings in `.delivery/reviews/` with status `open`, so `/delivery:status` keeps surfacing them until they are resolved or explicitly rejected.

## Language

Read `.delivery/glossary.md` first and use its terms exactly. If it does not exist, run
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

Lead with the verdict and the persona-journey result. Then state what must be updated before the next sprint — invalidated assumptions in the PRD or architecture, stories that need rewriting, estimates that need recalibrating.

Next step: `/delivery:sprint` for the next wave if accepted, or the specific repair the verdict named.
