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

## Language

Read `docs/product/glossary.md` first and use its terms exactly. If it does not exist, run
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

**Budget: 600 words target, 900 hard cap** (excludes code, YAML and data tables).

**Compose first. Do not try to hit the budget while writing.** Restraint during
composition trades substance for brevity in the wrong order — the findings get thinner
while the scaffolding survives. Write what the artifact needs, then cut what it does not.

**Then measure, do not estimate.** After writing the file, actually run:

```bash
wc -w <the file you just wrote>
```

An estimate is always wrong and always low. If you did not run the command, you do not
know the count.

**If the count exceeds 900, you are not finished.** Make a revision pass over the file and
delete, in this order, until it fits:

1. Preamble, recap, and any sentence describing what the document is about to say
2. **Restatement** — the same fact as prose *and* a table row *and* a summary bullet. Keep the form that carries it best; delete the others. This is almost always the biggest win.
3. Process narration — "I examined X and found Y" becomes Y
4. Hedging — either you know it, or it is labelled an assumption. Both are shorter.
5. Citations past the first for a given claim
6. Examples past the first, unless the next one shows a *different* failure mode

Then re-run `wc -w` and confirm.

**Never delete** findings and their failure scenarios, one citation per claim, grounding
and confidence labels, synthetic-output warnings, open questions, or IDs a later phase
reads. If the artifact cannot fit without losing those, keep them, exceed the cap, and
**write the final count and the reason into the document**. A declared overrun is a
judgement. A silent one is a habit.


## Report

Present the package location and a summary: stories included, excluded and why, the
verification contract, and any risk you want the runner warned about.

State clearly that the next step after the external run is `/delivery:sprint-review`,
which will re-verify independently rather than trusting the run's own report.
