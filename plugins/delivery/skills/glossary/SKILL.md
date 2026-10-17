---
description: Establish and curate the project's ubiquitous language — one agreed term per concept, defined in the business's own words, that every document, question and conversation must use. Run early and re-run whenever a new term appears. Produces .delivery/glossary.md.
argument-hint: "[term-optional]"
---

# Ubiquitous language

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Terms or area to curate: **$ARGUMENTS**

Cross-cutting. Runs after `/delivery:brief`, before `/delivery:prd`, and again whenever a
phase coins a term. Output: `.delivery/glossary.md`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Writing, then revising** bind this skill as if written here.

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

Read `.delivery/initiatives/<initiative>/brief.md` if it exists — the originator's own words are the highest-value
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

**Budget: 500 words target, 900 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report new terms, resolved synonyms, and any term that could not be defined — those are
product decisions, and they belong to the originator.

Every later phase reads this file. `/delivery:status` reports terms used in documents that
are not in the glossary, which is how drift gets caught rather than accumulating.
