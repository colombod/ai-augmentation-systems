<!--
BUDGET — target 400 words, hard cap 600 words. Excludes code, YAML and data tables.
Per persona; the index is a table plus its grounding warning.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

---
id: P-<n>
slug: <kebab-case>
name: <persona name>
grounding: observed | reported | assumed
segment: <behavioral segment, not demographic>
status: active | retired
introduced: <date or feature that first needed this persona>
source: derived | seeded-from:<project> | refined:<date>
---

> **These frontmatter fields are required, machine-readable, and not optional prose.**
> `/delivery:status` reports the grounding mix and `/delivery:prioritize` checks per-stage
> persona coverage by reading them. Stating the grade only in the body — however
> prominently — silently breaks both. Put it in the frontmatter *and* explain it in the
> body; the two serve different readers.

# <Persona name>

> **Grounding: <observed | reported | assumed>.** A persona is a hypothesis about a
> person. Anything this persona later "says" in an interview or simulation is a
> prediction, not a research finding, and is worth exactly what the evidence below
> is worth.

## In one line

The job they are trying to get done, and the constraint that makes it hard.

## Evidence

What this persona rests on. Cite real sources — tickets, reviews, analytics,
transcripts. Say what you looked for and could not find.

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | | observed / reported / assumed |
| Motivation | | |
| Constraints | | |
| Expertise | | |

## Context

**Trigger:** what makes them start looking
**Frequency:** how often this happens to them
**Stakes:** what it costs them to get it wrong
**Who else decides:** whose approval they need, if anyone
**Alternatives they weigh:** including doing nothing

## Constraints they carry

Device, connection, language, time available, budget, accessibility needs,
whether they are distracted or interrupted. Most friction lives here rather than
in preferences.

## What they already believe

What they arrive expecting, including any wrong assumptions. They are not a blank
evaluator — they have been to three competitors first.

## Abandonment condition

**They leave when:**
**They go to:**

A persona that cannot abandon cannot detect a problem. This field is mandatory.

## Where this persona diverges from the others

The specific scenario in which this persona behaves differently from every other
persona in the set. If you cannot name one, merge them.

## What would falsify this persona

**This persona is wrong if:**
**We would find out by:**

## Quotes

Real ones where they exist, marked with their source. Invented ones marked
`illustrative — not a real quote`.
