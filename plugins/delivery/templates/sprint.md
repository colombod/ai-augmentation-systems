<!--
BUDGET — target 600 words, hard cap 900 words. Excludes code, YAML and data tables.
The scope, verification and report-back tables are data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

---
sprint: <n>
slug: <kebab-case>
scope: <roadmap phase or MVP stage>
status: scoped | handed-off | returned | reviewed
runner: <who or what will implement — external to this plugin>
branch: <branch the run should use>
---

# Sprint <n> scope package: <name>

> **Input for an implementation run.** This plugin does not implement — it scopes,
> reviews and re-aligns. Whatever runs this (your harness, a coding agent, a team)
> should need nothing but this file and the repository.
>
> Assume the runner has no memory of the planning and cannot ask questions.

## Scope

**Stage promise:** what `prioritization.md` says this stage delivers, and which personas
it serves. `/delivery:sprint-review` checks the result against exactly this.

| Order | Story | Path | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- |
| 1 | | `docs/product/stories/...` | | |

**Deliberately excluded** — do not add these; they were scoped out on purpose.

| Story / feature | Why excluded |
| :-- | :-- |

## Pre-flight (verified before hand-off)

- [ ] Every story in scope is `ready`
- [ ] Every acceptance criterion is falsifiable
- [ ] No open **blocking** findings against the specs this scope depends on
- [ ] No story depends on unfinished work outside the scope
- [ ] Story file paths verified to exist

## Design constraints

Where a design system exists. **Raw values are not acceptable where a token exists.**

| Need | Token to use | Notes |
| :-- | :-- | :-- |

**Required component states:** default, hover, focus, active, disabled, loading, error, empty
**Accessibility rules that apply:**

## Verification contract

What the runner self-checks against, and what the review will independently re-check.

**Test command:** `<exact command>`
**Must pass:** `<which suites>`

| Story | FR | Acceptance criterion | How verified |
| :-- | :-- | :-- | :-- |

## Stop conditions

Stop and report rather than improvising. **A blocked story reported honestly is a
success. Quietly redesigning around a blocker is a failure.**

- The story cannot be implemented as written — spec conflicts with reality
- An acceptance criterion turns out wrong or unachievable
- Making it work would exceed the story's stated scope
- Tests fail for reasons inside the story's scope after bounded retries
- Two consecutive stories block — the plan is wrong, not the stories

Design decisions belong to the Solution Architect. Do not redesign mid-run.

## Working agreement

- Branch: `<name>` — not the default branch
- One commit per story, message naming the story ID
- **Do not weaken a test to make it pass.** If a test is wrong, report it and say why.

## Required report-back

`/delivery:sprint-review` needs all of this. Return it verbatim rather than summarised.

| Story | Outcome | Criteria met | Evidence | Commit |
| :-- | :-- | :-- | :-- | :-- |
| | done / blocked / not attempted | n of m | test name or observed behavior | sha |

**Actual test output** (the output itself, not a claim about it):

```
```

**Conflicts with the spec encountered:**

**Design system deviations, and why:**

**Anything the next planning cycle should know:**
