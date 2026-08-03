---
description: Produce a scoped implementation package for an external runner — which stories, in what order, with acceptance criteria, design tokens, test commands and required report-back. Use before handing a wave of work to an implementation system. Writes no source code.
---

# Sprint scope package

Scope: **$ARGUMENTS** (a roadmap phase, an MVP stage, a story-ID list, or empty for the next unstarted phase)

**This skill does not implement anything.** It produces the input an implementation
run consumes — your own harness, a coding agent, a contractor, or a team. The plugin
plans, scopes, reviews and re-aligns; building is somebody else's job.

That boundary is deliberate. It keeps this package harness-agnostic, and it keeps the
thing that reviews the work separate from the thing that produced it — which is what
makes `/delivery:sprint-review` worth trusting.

## Gate check

Read `docs/product/roadmap.md`, `docs/product/prioritization.md` if present,
`docs/product/design-system.md` if present, and all stories in `docs/product/stories/`.

Resolve the scope, then refuse to package in these cases — each one ships a known
defect into the implementation run, where it is far more expensive:

- **No stories are `ready`** — report what each `draft` story is missing and stop. Run `/delivery:stories`.
- **Open blocking findings** against the artifacts this scope depends on (check `docs/product/reviews/`) — handing over a spec with an unresolved blocking finding builds the known problem into the code. Report them and ask before proceeding.
- **A story in scope depends on a story outside it** that is not `done` — report it, and either widen the scope or drop that story.
- **Acceptance criteria that are not falsifiable** — the external runner cannot self-verify against prose. Send it back to `/delivery:stories`.

## Build the package

Write `docs/product/sprints/<n>-<slug>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/sprint.md`.

The package must be **self-sufficient**: the runner should need nothing but this file and
the repository. Assume it has no memory of the planning and cannot ask you questions.

**1. Scope and order.** Which stories, in dependency order, with the reasoning. Name any
story deliberately excluded and why, so the runner does not helpfully add it.

**2. The stories themselves**, or exact paths to them. Each already carries its own full
context by construction — verify that is still true rather than assuming it.

**3. Design constraints.** Where a design system exists, the token names the runner must
use, the component states required including error and empty, and the accessibility rules.
Say explicitly that raw values are not acceptable where a token exists.

**4. Verification contract.** The exact test command, which tests must pass, and the
acceptance criteria per story with their `FR-n` IDs. This is what the runner self-checks
against and what the review will independently re-check.

**5. Stop conditions.** Tell the runner when to stop and report rather than improvising:

- A story cannot be implemented as written — the spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope
- Tests fail for reasons inside the story's scope after bounded retries
- Two consecutive stories block — that means the plan is wrong, not the stories

Say plainly that a blocked story reported honestly is a **success**, and that quietly
redesigning around a blocker is a failure. Runners optimise for finishing; this is what
counteracts that.

**6. Required report-back.** State exactly what the run must return, because
`/delivery:sprint-review` needs it:

- Per story: done / blocked / not attempted
- Per acceptance criterion: met / not met, with evidence (test name or observed behavior)
- Actual test output, not a claim about it
- Files changed, and the commit or branch
- Anything that conflicted with the spec
- Any deviation from the design system and why

**7. Working agreement.** Branch name, one commit per story, and that tests must not be
weakened to pass — if a test is wrong, report it rather than editing the assertion.

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Report

Present the package location and a summary: stories included, excluded and why, the
verification contract, and any risk you want the runner warned about.

State clearly that the next step after the external run is `/delivery:sprint-review`,
which will re-verify independently rather than trusting the run's own report.
