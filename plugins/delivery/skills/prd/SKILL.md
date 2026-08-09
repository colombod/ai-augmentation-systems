---
description: Turn a product brief into a full PRD with user scenarios, acceptance criteria and non-functional requirements. Use once the problem and users are settled and you need a specification precise enough to design against. Produces .delivery/initiatives/<initiative>/prd.md.
---

# Product requirements document

Scope note from user: **$ARGUMENTS**

Phase 5 of the pipeline. Inputs: `.delivery/initiatives/<initiative>/brief.md`, plus `research.md`, `personas/`, `interviews/` and `simulations/` where they exist. Output: `.delivery/initiatives/<initiative>/prd.md`.

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

Read `.delivery/initiatives/<initiative>/brief.md`.

- **Missing** — stop. Tell the user to run `/delivery:brief` first, and offer to run it now. Do not improvise a brief.
- **Exists but thin** (no named user segment, no measurable success signal, or unresolved blocking questions) — say specifically what is weak, and ask whether to proceed anyway or strengthen the brief first. Proceeding on a weak brief is a legitimate choice, but it should be a choice.
- If `.delivery/initiatives/<initiative>/prd.md` already exists, read it and ask whether to
  **revise**, **replace**, or **start new version**. See
  `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the
  same-problem test that chooses between revise and start new version, and the
  Version-history table and Corrections log it writes. Never silently overwrite.


**Open blocking findings.** Read `.delivery/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Product Owner drafts the scenarios.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). Each scenario needs an actor, a trigger, a sequence, and an observable outcome — not a feature-list entry. Each gets falsifiable acceptance criteria.

**2. Business Analyst stress-tests them.** Delegate to `delivery:business-analyst` with the draft scenarios. It walks the unhappy-path checklist systematically — empty, single, large, duplicate, concurrent, permission denied, resource missing, partial failure, timeout, undo — and produces the non-functional requirements as numbers.

**3. QA Strategist checks verifiability.** Delegate to `delivery:qa-strategist` to check every acceptance criterion: what would you run or observe to decide pass or fail? Rewrite any criterion that fails this test. This step catches more real defects than any later testing, so do not skip it under time pressure.

**4. Resolve or record.** Where the roles disagree or a number is unknown, put it to the user. Anything still unresolved goes in the open-questions register with an owner — never invent a latency target or a data volume.

**5. Write the PRD** to `.delivery/initiatives/<initiative>/prd.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Give every requirement a stable ID (`FR-1`, `NFR-1`) — the roadmap, stories and tests will reference these, and renumbering later breaks the chain.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every scenario has an actor, trigger, sequence and observable outcome
- Every scenario has at least one error or edge path
- Every acceptance criterion is falsifiable by someone who did not write it
- Non-functional requirements are numbers, or explicitly listed as open questions
- Requirements have stable IDs
- Out of scope is stated explicitly

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

**Budget: 1000 words target, 1600 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 1600, you are not finished.** Make a revision pass over the file and
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

Report exit criteria status honestly, including any criterion you could not make falsifiable. Recommend `/delivery:review-scenarios` before design — the adversarial pass is cheapest here. Then `/delivery:architecture`.
