---
description: Establish and curate the project's ubiquitous language — one agreed term per concept, defined in the business's own words, that every document, question and conversation must use. Run early and re-run whenever a new term appears. Produces .delivery/glossary.md.
---

# Ubiquitous language

Terms or area to curate: **$ARGUMENTS**

Cross-cutting. Runs after `/delivery:brief`, before `/delivery:prd`, and again whenever a
phase coins a term. Output: `.delivery/glossary.md`.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Why this exists

Every other artifact in this pipeline is written by someone fluent in a different dialect.
The Business Analyst says *booking window*, the architect says *date range*, the PRD says
*band*, the code says `dateRanges`, and the owner says *the price list*. They are the same
thing. Nobody notices, because each document is internally consistent.

The damage shows up at the edges:

- **Questions the owner cannot answer.** A question tagged "Owner: business owner" written in
  engineering vocabulary is not a question — it is a blocker with a name attached. This is
  the most common and most expensive failure, because it stalls the pipeline and looks like
  the owner being slow rather than the question being wrong.
- **Requirements that drift.** Two terms for one concept become two concepts by the time they
  reach a story, and the implementation grows a distinction nobody asked for.
- **A hand-off the runner has to guess at.** `writing-plans` assumes an engineer who "knows
  almost nothing about our problem domain". Undefined vocabulary is where it invents.

One agreed term per concept, used everywhere, is the cheapest fix available. It is also the
one that decays fastest without curation, which is why this is a skill and not a one-off.

## Gate check

Read `.delivery/brief.md` if it exists — the originator's own words are the highest-value
source, because they are the words the product is actually discussed in.

If `.delivery/glossary.md` exists, this run **curates** it. Never regenerate: a glossary's
value is that terms stay stable, and rewriting definitions silently changes what every prior
document meant.

## Run

**1. Harvest the terms actually in use.** Read the existing artifacts and the codebase. Pull
every domain noun: from the brief, the PRD, the personas, the architecture, and from real
identifiers in code and data files. Include the words the originator used in conversation —
those outrank everything else.

**2. Find the collisions.** Two kinds, and both matter:

- **Synonyms** — several words, one concept. Pick one and record the rest as *aliases, not
  to be used*. Say which document each alias came from so the correction can be applied.
- **Homonyms** — one word, several concepts. Worse, and easy to miss. Split them into
  distinct terms and rename at least one.

**3. Let the business word win.** Where the domain and the code disagree, the domain term is
the entry and the code identifier is recorded as its implementation name. Do not rename the
code as a side effect — just record the mapping, and note the divergence as a smell worth
fixing later.

**4. Define in the owner's words, not the model's.** Each definition must be one the
originator would recognise and could have written. If a definition needs engineering
vocabulary to be precise, give both: the plain sentence first, the precise one after it,
clearly marked.

**5. Ground each term in something real.** A worked example, a file path, or a value from the
data. A definition with no referent drifts back into ambiguity within two documents.

**6. Record the questions each term raises.** A term nobody can define crisply is usually an
unresolved product decision wearing a noun. Flag it rather than inventing a definition.

## Write

Write `.delivery/glossary.md` using `${CLAUDE_PLUGIN_ROOT}/templates/glossary.md`.

Terms are stable. Changing a definition requires saying what it was, what it is now, and
which documents were written under the old meaning.

## Exit criteria

- Every domain noun in the existing artifacts appears, or is deliberately excluded
- No synonyms remain unresolved — each has one canonical term and its aliases listed
- Homonyms split and at least one renamed
- Each definition is plain enough for the originator to confirm
- Each term has a concrete referent — example, path, or value
- Code identifiers mapped where they differ from the domain term
- Terms nobody can define are listed as open questions, not invented

## Writing, then revising

**Budget: 500 words target, 900 hard cap** (excludes code, YAML and data tables).

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


## Hand off

Report new terms, resolved synonyms, and any term that could not be defined — those are
product decisions, and they belong to the originator.

Every later phase reads this file. `/delivery:status` reports terms used in documents that
are not in the glossary, which is how drift gets caught rather than accumulating.
