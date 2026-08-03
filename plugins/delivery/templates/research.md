<!--
BUDGET — target 900 words, hard cap 1400 words. Excludes code, YAML and data tables.
Prior-art rows and constraint tables are data, not prose.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Feature research: <topic>

> Phase 2 artifact. Owned by the pipeline, informed by web research where available.
> Last updated: <date>
> Every claim is marked **verified** (source read), **reported** (secondary), or
> **assumed** (inference). Unmarked claims are not permitted.

## Research method

Which tools were available and used. **If no web access was available, say so here
and mark every external section `unresearched`** — recalled facts about a market are
the most dangerous output of this phase.

## Prior art

How this problem is solved today. At least one example from outside the obvious
category.

### <Product / project>

**Approach:**
**Gets right:**
**Users complain about:** (complaints are unmet requirements stated by people who have them)
**Source:** <url> · verified / reported

## Domain constraints

What the problem space imposes regardless of implementation — regulatory, industry
convention, data standards, accessibility obligations, seasonal or geographic reality.

| Constraint | Applies because | Source | Confidence |
| :-- | :-- | :-- | :-- |

## Technical landscape

Candidates only. **Do not declare a winner** — that is the Solution Architect's
decision, made later with more information.

| Option | Maturity | Maintained | Licence | Might not fit because |
| :-- | :-- | :-- | :-- | :-- |

## What the existing codebase already decides

Options foreclosed by decisions already made. Cite real paths.

| Path | Constraint it imposes |
| :-- | :-- |

## Implications for the brief

Anything here that changes the premise of the effort — prior art solving it better
than planned, a constraint that invalidates an assumption, a foreclosed option.
If the research undermines the effort, say so here; that is this phase's most
valuable possible outcome.

## Gaps

What was looked for and not found, and what it would take to answer.

| Question | Why it matters | How to answer |
| :-- | :-- | :-- |
