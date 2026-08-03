---
description: Run an automated implementation wave — take a scope of ready stories, implement and test each in dependency order, and stop on conditions that need a human. Use to execute a roadmap phase or MVP stage as a sprint. Writes code; produces docs/product/sprints/.
---

# Sprint — automated implementation wave

Scope: **$ARGUMENTS** (a roadmap phase, an MVP stage, a story-ID list, or empty for the next unstarted phase)

The execution engine. A sprint takes a scope of stories and works through them autonomously, rather than one `/delivery:next-story` invocation at a time.

## Gate check

Read `docs/product/roadmap.md`, `docs/product/prioritization.md` if present, and all stories in `docs/product/stories/`.

Resolve the scope, then refuse to start in these cases — each one produces expensive, wrong work if you push through:

- **No stories are `ready`** — report what each `draft` story is missing and stop. Run `/delivery:stories`.
- **Open blocking findings against the artifacts this scope depends on** — check `docs/product/reviews/`. Implementing against a spec with an unresolved blocking finding is how a known problem gets built into the code. Report them and ask before proceeding.
- **A story in scope depends on a story outside it** that is not `done` — report the dependency and either widen the scope or drop that story.
- **The working tree is dirty** — report it. A sprint makes many commits; starting on top of unrelated uncommitted work makes the result impossible to review.

State the sprint plan before starting: which stories, in which order, and the dependency reasoning. Get confirmation unless the user has already said to run unattended.

## Set up

Create `docs/product/sprints/<n>-<slug>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/sprint.md` and record the plan. This file is the sprint's log and survives interruption — an interrupted sprint must be resumable, and this is what makes that possible.

Work on a branch, not on the default branch. Name it for the sprint.

## Run the loop

For each story, in dependency order:

**1. Set status `in-progress`** in the story frontmatter and log the start. If the process dies, this is what tells the next session where it was.

**2. Implement**, following `/delivery:next-story`'s discipline: read the story completely, read the code it names plus enough context to match conventions, honor the specified interfaces, respect the design system tokens by name, and stay inside the stated scope.

**3. Write the tests the story specifies**, at the specified level, covering its negative and boundary cases.

**4. Run the tests.** Report actual results. On failure, fix and re-run — up to a bounded number of attempts. Do not loosen a test to make it pass; if a test is wrong, say so explicitly and explain why rather than quietly editing the assertion. That distinction is the difference between a sprint that works and one that reports success falsely.

**5. Verify against acceptance criteria.** Delegate to `delivery:qa-strategist`, criteria-first — read the criteria and check each independently *before* reading the implementation, so the check is not anchored to what the code happens to do.

**6. Commit** the story's work with a message naming the story ID. One commit per story keeps the sprint reviewable.

**7. Record the outcome** in the sprint log and set story status: `done` only if every criterion is met and tests pass. Otherwise `blocked`, with what stopped it.

## Stop conditions

Stop the wave and report, rather than pressing on, when:

- A story cannot be implemented as written — the spec conflicts with reality. This belongs to the Solution Architect; do not redesign mid-sprint.
- Tests fail after the bounded retries for reasons inside the story's scope
- Implementation reveals that an acceptance criterion is wrong or unachievable
- A change would exceed the story's stated scope to make it work
- Two consecutive stories block — that pattern means the plan is wrong, not the stories

Continuing past these produces work that has to be thrown away, which costs far more than stopping did.

## Report

State honestly, per story: done, blocked, or not attempted, with test results as they actually came out. Never report a story done whose criteria are unmet.

Summarize: stories completed, criteria met versus unmet, tests passing, what blocked and why, and what a human needs to decide.

Next step: `/delivery:sprint-review` to assess acceptance of the wave.
