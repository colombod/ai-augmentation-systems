---
description: Research the feature space before specifying anything — how others solve this, what the domain requires, what users complain about today, and what the existing codebase already constrains. Use after the brief and before personas. Produces .delivery/initiatives/<initiative>/research.md.
---

# Feature research

Topic: **$ARGUMENTS** (defaults to the feature named in the brief)

Phase 2 of the pipeline. Input: `.delivery/initiatives/<initiative>/brief.md`. Output: `.delivery/initiatives/<initiative>/research.md`.

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

Read `.delivery/initiatives/<initiative>/brief.md`. If it is missing, stop and point at `/delivery:brief` — research without a framed problem produces a literature review nobody uses.

If `.delivery/initiatives/<initiative>/research.md` already exists, read it and ask whether
to **revise**, **replace**, or **start new version**. See
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the same-problem
test that chooses between revise and start new version, and the Version-history table and
Corrections log it writes. Never silently overwrite.

## Run

Research from evidence, not from recall. Where web tools are available (`WebSearch`, `WebFetch`, or Perplexity/Tavily MCP tools), use them and cite what you find. Where they are not, say so explicitly and mark the affected sections as **unresearched** rather than filling them from memory — confident, uncited claims about a market are the most dangerous output this phase can produce.

**0. Search convergently, not once.** A single sweep finds what one phrasing surfaces. Run
the prior-art and constraint searches as **at least three parallel passes with different
angles** — by product category, by the user's problem in their own words, and by the
failure people complain about. They must not share context. Merge, and record which
findings appeared in more than one pass.

Where each angle returned material the others missed, say so: the space is not exhausted,
and the document should not imply that it is.

**1. Prior art — how is this problem solved today?**
Find three to five products or projects that solve it, including at least one outside the obvious category. For each: the approach, what it gets right, what users complain about. Public reviews, forum threads and issue trackers are the highest-value source here, because complaints are unmet requirements stated by the people who have them.

**2. Domain constraints.**
What does this problem space impose regardless of implementation? Regulatory requirements, industry conventions, data standards, accessibility obligations, seasonal or geographic realities. Constraints found now are cheap; constraints found during implementation are not.

**3. The technical landscape.**
Available libraries, protocols, standard formats, integration surfaces. For each candidate: maturity, maintenance status, licence, and the reason it might not fit. Do not pick a winner — that is the Solution Architect's decision, made later with more information.

**4. What the codebase already decides.**
Read the existing project — its architecture, its stated non-goals, its conventions. Some options are already foreclosed by decisions made long ago, and knowing which saves the architect a wasted design. Cite real paths.

**5. What you could not find out.**
The gaps matter as much as the findings. List what you looked for and did not find, and what it would take to answer.

## Write

Write to `.delivery/initiatives/<initiative>/research.md` using `${CLAUDE_PLUGIN_ROOT}/templates/research.md`.

Cite every external claim with a URL. Mark each finding as **verified** (you read the source), **reported** (a secondary source says so), or **assumed** (your inference). Keep those three visually distinct — the later phases will lean on this document, and an unmarked assumption becomes a fact by the time it reaches a story.

## Exit criteria

- At least three prior-art examples with named strengths and complaints
- Domain constraints listed, or explicitly stated as none found
- Technical options with maturity and licence, and no winner declared
- Existing-codebase constraints cited with real paths
- Every external claim carries a source
- Open gaps listed
- At least three search angles run independently, with convergence recorded
- Within the template's budget, or the overrun declared in the document with its reason

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

**Budget: 900 words target, 1400 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 1400, you are not finished.** Make a revision pass over the file and
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

Report what you found that would change the brief — prior art solving it better than planned, a constraint that invalidates an assumption, a foreclosed technical option. If the research undermines the premise of the effort, say so plainly; that is the most valuable outcome this phase can have, and the cheapest moment to have it.

Next step: `/delivery:personas`.
