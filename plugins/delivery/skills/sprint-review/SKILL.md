---
description: Assess acceptance of a completed sprint — criteria actually met, design system conformance, persona journeys now possible, and what the wave taught. Use after /delivery:sprint. Produces an acceptance verdict and feeds the next planning cycle.
argument-hint: "[sprint-or-initiative]"
---

# Sprint acceptance review

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Sprint: **$ARGUMENTS** (defaults to the most recent sprint log)

The closing gate of an implementation wave. This decides whether the sprint is **accepted**, and it feeds what it learns back into planning.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read the sprint log in `.delivery/sprints/`, the stories it covered, `.delivery/initiatives/<initiative>/prd.md`, `.delivery/initiatives/<initiative>/prioritization.md`, `.delivery/initiatives/<initiative>/design-system.md` and `.delivery/personas/` where they exist.

If no sprint log exists, stop — there is nothing to review.

## The rule this skill exists under

The implementation was run by something else — your harness, superpowers, an agent, a team — and it reported its own results. A process that only ever grades itself drifts toward optimism, and a runner optimises for finishing. This review is deliberately independent: it re-checks acceptance criteria **against the code as it now exists**, rather than trusting the runner's report-back.

Where the report and the code disagree, the code wins and the discrepancy is itself a finding — it means that runner's self-assessment cannot be relied on, which matters more than the individual story and should change how much of its next report you believe.

Where the runner used its own task IDs rather than `FR-n` (superpowers does), use the ID mapping recorded in the scope package to trace results back to requirements. A criterion nobody can trace to a task is a criterion nobody verified.

## Run

**1. Verify acceptance criteria independently.** Delegate to `delivery:qa-strategist` (via the Agent tool; if subagents are unavailable, adopt the persona from `${CLAUDE_PLUGIN_ROOT}/agents/`). Read the criteria first, then check each against the current code — not against the sprint log. Every criterion gets met / not-met / partially-met with concrete evidence: the test that covers it, or the behavior observed.

For any criterion describing behavior a real user would see or get back — rendered GUI
behavior, a CLI's real output, or a TUI's rendered state — this delegation applies
`delivery:qa-strategist`'s standing rule for verifying a user-facing claim (see that
agent's own file — the required channel differs by surface: a real capture for GUI,
cross-checked against the invocation ledger when that opt-in ledger is on; a directly-observed
real invocation for CLI; a real visual capture for TUI, or an honest
"unable to be checked" if none is available. A visual "met" verdict must also cite a
`design-system.md` `Rule ID` or state plainly that none exists). This is the same rule
whether or not the work was checked ad hoc before this formal review ever ran — it does
not get a lighter version here.

**2. If this sprint touched the plugin's own skills, hooks, agents, or templates — verify
ship readiness independently, not from the sprint log's word.** This is a distinct failure
class from a functional acceptance criterion: a change can be functionally correct and still
fail to actually reach anyone. Re-check, yourself, against the real current state — do not
trust a story's own "Ship readiness" checkboxes as sufficient, the same "verify against
criteria, not the builder's report" rule this whole review runs under:
- `git fetch origin main && git log --oneline main..origin/main` — empty output confirms the
  merged branch really was current with `main`, not assumed so after time passed.
- The plugin's version was actually bumped in the merged commit, if this project's own
  convention requires one (check its real history, don't assume).
- Any claim that a fix "works" is either backed by verification this session could actually
  perform, or explicitly flagged as unverified pending a fresh session/environment this one
  doesn't have — a claim resting on an environment nobody actually has access to is not
  evidence, and gets the same **not accepted** treatment as an untested functional claim.

**3. Run the test suite** and report the real output. A sprint that claimed green and is now red is the single most important thing this review can catch. In a delivery team the Delivery Manager's lane runs no product code: the independent reviewer, or a Builder asked for it, runs the suite on the commit under review and the review quotes its output; a result reported without that output is not evidence.

**4. Check design system conformance.** Where a design system exists, delegate to `delivery:design-lead`: which tokens were used, which were bypassed with hardcoded values, which component states are missing, which contrast rules fail. Report file paths, not impressions.

**5. Check the persona journeys.** This is the question that matters most and the one story-level criteria cannot answer: *can a persona now complete a journey end to end and get value?* Delegate to `delivery:persona-simulator` for each persona whose journey this sprint was meant to enable, walking the **now-real** implementation. Label the output synthetic, as always.

A sprint where every story passed but no persona can complete a journey has delivered nothing usable, and only this check will tell you.

**6. Reconcile against the stage promise.** `prioritization.md` said what this stage would deliver and which personas it would serve. Compare what was promised to what is now true. Name any silent scope drop.

**7. Challenge the result.** Delegate to `delivery:feature-critic` (read-only) with the question: *what would make this acceptance verdict wrong?* Missing evidence, criteria passing on a technicality, tests asserting implementation rather than behavior.

## Verdict

State one of:

- **Accepted** — all criteria met with evidence, tests green, persona journeys work
- **Accepted with debt** — criteria met, but named issues are being carried forward, each recorded as a finding
- **Not accepted** — criteria unmet, journeys broken, or ship-readiness failed (stale branch merged, a required version bump missing, a claim resting on unverifiable-from-here evidence); state exactly what and what it would take

Do not soften this. A sprint review that never returns "not accepted" is not a gate, and everything downstream will be planned on a false baseline.

## Learn

Then capture what the wave taught, which is the part that improves the next one:

- **Stories that were wrong** — where the spec conflicted with reality, and what the story was missing. This is feedback for `/delivery:stories`.
- **Estimates that were wrong**, and in which direction. Feedback for `/delivery:roadmap`.
- **Assumptions invalidated** — from the PRD, architecture or personas. Anything invalidated needs those documents updated, or the next phase inherits a known-false premise.
- **Friction found in the real thing** that simulation missed, and vice versa. This calibrates how much to trust simulated output next time — genuinely valuable, because it is the only feedback the persona phases ever get.

## Write

Write to `.delivery/sprints/<n>-<slug>-review.md` using `${CLAUDE_PLUGIN_ROOT}/templates/sprint-review.md`. Record carried debt and invalidated assumptions as findings in `.delivery/reviews/` with status `open`, so `/delivery:status` keeps surfacing them until they are resolved or explicitly rejected.

## Writing, then revising

**Budget: 600 words target, 1000 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Lead with the verdict and the persona-journey result. Then state what must be updated before the next sprint — invalidated assumptions in the PRD or architecture, stories that need rewriting, estimates that need recalibrating.

Next step: `/delivery:sprint` for the next wave if accepted, or the specific repair the verdict named.
