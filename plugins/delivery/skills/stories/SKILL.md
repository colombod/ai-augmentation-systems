---
description: Decompose a roadmap phase into self-contained, implementation-ready story files that carry their full context. Use when a phase is about to start and the work needs to be broken into pickable units. Produces docs/product/stories/.
---

# Story decomposition

Phase or epic to decompose: **$ARGUMENTS** (defaults to the first phase not yet decomposed)

Phase 10 of the pipeline. Inputs: `docs/product/prd.md`, `docs/product/architecture.md`, `docs/product/roadmap.md`, plus `design-system.md` where it exists. Output: `docs/product/stories/`.

## Gate check

Read all three inputs and list any existing stories in `docs/product/stories/`.

- **Roadmap missing** — stop and run `/delivery:roadmap` first. Without it there is no defensible phase boundary to decompose along.
- **Architecture missing** — warn hard. Stories written without a design either omit the technical context (making them un-pickable) or invent a design inline (which is the Solution Architect's job, done badly). Recommend running `/delivery:architecture` first.
- Never overwrite a story whose status is `in-progress` or `done`.

Resolve the target phase from `$ARGUMENTS`, or take the first phase in the roadmap with no stories yet. State which phase you are decomposing before you start.


**Open blocking findings.** Read `docs/product/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Delivery Lead writes the stories.** Delegate to `delivery:delivery-lead` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/delivery-lead.md` and adopt the persona).

The governing rule: **the story file is the complete context.** Someone opening one story file — a teammate who missed the planning, or an agent with no memory of it — must have everything needed to finish it. Extract the relevant slices of the PRD and architecture *into* the story. Do not link out. A story requiring three other documents to be read has failed at its one job.

Each story carries: user-facing goal, real verified file paths, the interfaces and contracts it must honor, the architecture decisions that apply and why, acceptance criteria traced to `FR-n`, the test approach with the actual command to run tests in this repo, dependencies on other stories, and explicit out-of-scope notes.

**2. Carry the design system into every UI story.** Where `design-system.md` exists, each story touching UI names the **tokens by their real project name**, the component states it must implement (including error and empty), and the accessibility rules that apply. An implementer who cannot find the token reaches for a raw value, and the design system erodes one commit at a time — naming them in the story is what prevents that.

**3. Verify the file paths exist.** The Delivery Lead cites paths; you check them against the repo. A story pointing at a file that does not exist sends the implementer looking for something imaginary.

**4. QA Strategist sets the test approach** per story — the level, the negative and boundary cases, and how it is verified.

**5. Readiness check.** For each story confirm: acceptance criteria falsifiable, file paths verified, dependencies stated, test approach present, nothing missing. Stories passing get status `ready`; stories failing stay `draft` with the missing element named. Do not mark a story ready under schedule pressure — that is exactly when it costs the most.

**6. Write the stories** to `docs/product/stories/<epic>-<nn>-<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/story.md`, and update the story index at `docs/product/stories/README.md`.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every story is a vertical slice delivering observable behavior, or states why it cannot be
- Every acceptance criterion in the target phase is covered by at least one story
- Every story's file paths verified against the repo
- Dependencies between stories are explicit
- Each story is finishable in one focused sitting, or is split

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

**Budget: 700 words target, 1200 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 1200, you are not finished.** Make a revision pass over the file and
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

Report: stories written, how many are `ready` versus `draft`, and what each draft is missing. Flag any acceptance criterion in the phase that no story covers. Next step: `/delivery:sprint` to scope a wave for an implementation runner.
