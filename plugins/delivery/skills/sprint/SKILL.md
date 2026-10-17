---
description: Produce a scoped implementation package for a wave of work — which stories, in what order, with acceptance criteria, design tokens, test commands and required report-back — for the team's builders or an external runner. With --runner superpowers|generic, also convert it into that runner's native format (a superpowers spec or plan, or a generic self-contained brief). Use before a wave is built. Writes no source code.
argument-hint: "[scope] [--runner superpowers|generic]"
---

# Sprint scope package

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Scope: **$ARGUMENTS** (a roadmap phase, an MVP stage, a story-ID list, or empty for the next unstarted phase; `--runner superpowers|generic` adds the hand-off below)

**This skill does not implement anything.** It produces the input an implementation
run consumes — the shipping team's builders, your own harness, a coding agent, or a
contractor. Building is the builders' or the runner's job, not this skill's.

That boundary is deliberate. It keeps this package harness-agnostic, and it keeps the
thing that reviews the work separate from the thing that produced it — which is what
makes `/delivery:sprint-review` worth trusting.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read `.delivery/initiatives/<initiative>/roadmap.md`, `.delivery/initiatives/<initiative>/prioritization.md` if present,
`.delivery/initiatives/<initiative>/design-system.md` if present, and all stories in `.delivery/stories/`.

Resolve the scope, then refuse to package in these cases — each one ships a known
defect into the implementation run, where it is far more expensive:

- **No stories are `ready`** — report what each `draft` story is missing and stop. Run `/delivery:stories`.
- **Open blocking findings** against the artifacts this scope depends on (check `.delivery/reviews/`) — handing over a spec with an unresolved blocking finding builds the known problem into the code. Report them and ask before proceeding.
- **A story in scope depends on a story outside it** that is not `done` — report it, and either widen the scope or drop that story.
- **Acceptance criteria that are not falsifiable** — the external runner cannot self-verify against prose. Send it back to `/delivery:stories`.

## Build the package

Write `.delivery/sprints/<n>-<slug>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/sprint.md`.

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

## Hand off to a runner (`--runner`)

Only when `--runner` is given (`superpowers` or `generic`; if it is given with no value, ask
which). After the package is written, Read
`${CLAUDE_PLUGIN_ROOT}/skills/sprint/references/runners.md` and follow it: its pre-flight,
the section for the chosen runner, and its report. It binds this skill as if written here.
The shipping team's builders read the package itself and need no `--runner`. If a package
for this scope already exists in `.delivery/sprints/` and only the hand-off is wanted, reuse
it: re-run the gate check against it instead of building a new one.

## Writing, then revising

**Budget: 600 words target, 900 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Report

Present the package location and a summary: stories included, excluded and why, the
verification contract, and any risk you want the runner warned about.

With `--runner`, add the hand-off report that `runners.md` asks for.

State clearly that the next step after the run is `/delivery:sprint-review`,
which will re-verify independently rather than trusting the run's own report, then
`/delivery:realign`.
