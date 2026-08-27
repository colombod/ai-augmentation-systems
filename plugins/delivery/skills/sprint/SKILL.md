---
description: Produce a scoped implementation package for an external runner — which stories, in what order, with acceptance criteria, design tokens, test commands and required report-back. Use before handing a wave of work to an implementation system. Writes no source code.
argument-hint: "[initiative]"
---

# Sprint scope package

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.


Scope: **$ARGUMENTS** (a roadmap phase, an MVP stage, a story-ID list, or empty for the next unstarted phase)

**This skill does not implement anything.** It produces the input an implementation
run consumes — your own harness, a coding agent, a contractor, or a team. The plugin
plans, scopes, reviews and re-aligns; building is somebody else's job.

That boundary is deliberate. It keeps this package harness-agnostic, and it keeps the
thing that reviews the work separate from the thing that produced it — which is what
makes `/delivery:sprint-review` worth trusting.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Which initiative

Every artifact below lives under `.delivery/initiatives/<slug>/`, never directly under
`.delivery/` — this is what lets independent initiatives (epics, sprints, parallel
workstreams) be planned in parallel branches without colliding on the same shared file
(`ADR-004`; the incident that motivated it: two initiatives independently continued the same
`S-n`/`FR-n` sequence in one shared `prd.md`, discovered only at merge). Resolve which
initiative before reading or writing anything below:

1. **Explicit signal.** The user names an initiative, or one is already established for this
   conversation — use it.
2. **Exactly one exists.** If `.delivery/initiatives/` has exactly one subdirectory, use it
   without asking — this keeps single-initiative projects exactly as simple as before this
   convention existed.
3. **Ask, don't guess.** Otherwise (zero, or more than one, with no explicit signal) — ask
   which initiative this work belongs to, or whether to start a new one. Never silently
   default to the most recently modified one.
4. **Starting a new initiative.** Confirm its slug (kebab-case, derived from the brief
   subject or what the user names) before creating `.delivery/initiatives/<slug>/` — check it
   doesn't collide with an existing initiative slug or any other top-level `.delivery/` entry.
   A genuinely new initiative needs its own `/delivery:brief`, or an explicit
   `extends: <existing-slug>` note (in this new initiative's own first artifact) declaring it
   reuses an existing initiative's problem framing instead of running its own — state which,
   don't leave it implicit.

Cross-cutting, project-wide, never per-initiative: `.delivery/glossary.md`,
`.delivery/personas/`, `.delivery/interviews/`, `.delivery/simulations/`,
`.delivery/decisions/ADR-NNN-*.md`, `.delivery/invocations/<session_id>.ndjson`.
`.delivery/stories/`, `.delivery/reviews/`, `.delivery/sprints/` stay flat but are prefixed
by initiative slug, matching `stories/<slug>-NN-<name>.md`'s existing convention.

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

**Budget: 600 words target, 900 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 900, you are not finished.** Make a revision pass over the file and
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


## Report

Present the package location and a summary: stories included, excluded and why, the
verification contract, and any risk you want the runner warned about.

State clearly that the next step after the external run is `/delivery:sprint-review`,
which will re-verify independently rather than trusting the run's own report.
