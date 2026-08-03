---
description: Implement the next ready story end to end — code, tests, and verification against its acceptance criteria. Use to execute the delivery plan one story at a time once stories exist. Updates story status and writes code.
---

# Implement next story

Story to implement: **$ARGUMENTS** (defaults to the first `ready` story in dependency order)

The execution loop. This is the skill that turns the plan into code.

## Gate check

List `docs/product/stories/` and read the index.

- **No stories** — stop. Run `/delivery:stories` first.
- **No story is `ready`** — report what is blocking. If stories are `draft`, say what each is missing. Do not implement a draft story: the missing element is exactly the context you would otherwise invent.
- **Dependencies unmet** — if the selected story depends on a story that is not `done`, say so and pick the next eligible one instead, or stop if none is eligible.

Select the story: `$ARGUMENTS` if given, otherwise the first `ready` story whose dependencies are all `done`. State which story you selected and why before starting.

## Run

**1. Read the story completely.** It is designed to be self-sufficient — if it is not, that is a defect in the story. Stop and say what is missing rather than filling the gap with a guess. Guessing here is how implementations drift from their specification.

**2. Set status to `in-progress`** in the story frontmatter before starting work, so an interrupted session leaves a visible trace.

**3. Read the code the story names**, plus enough surrounding context to match the existing conventions. New code should read like the code around it — same naming, same error handling, same comment density.

**4. Implement.** Follow the interfaces and contracts the story specifies. Stay inside the stated scope; the out-of-scope notes are there because someone decided those boundaries deliberately. If you find that the story cannot be implemented as written, stop and report the conflict rather than redesigning on the fly — the design belongs to the Solution Architect.

**5. Write the tests the story specifies**, at the level it specifies, covering the negative and boundary cases listed. Not "tests later."

**6. Run the tests** using the command in the story. Report the actual result. If tests fail, say so with the output and fix them — never report success on a failing suite.

**7. Verify against acceptance criteria.** Delegate to `delivery:qa-strategist` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/qa-strategist.md` and adopt the persona). Critically: it checks the criteria **first**, then the implementation. Reading the code first anchors the check to what the code does rather than what it should do. Each criterion gets an independent met / not-met verdict with evidence.

**8. Update status.** `done` only if every acceptance criterion is met and tests pass. Otherwise leave it `in-progress` and record what remains. Record the outcome in the story's implementation-notes section, including anything a future reader would want to know — surprises, deviations, follow-up work.

## Report

State plainly: which story, what changed (file paths), test results as they actually came out, each acceptance criterion met or not met, and anything deferred. If part of the story was not completed, say which part and why — do not report partial work as done.

Then say how many `ready` stories remain and offer to continue.
