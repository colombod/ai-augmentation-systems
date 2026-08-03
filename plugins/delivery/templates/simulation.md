<!--
BUDGET — target 900 words, hard cap 1500 words. Excludes code, YAML and data tables.
The friction map and coverage tables are data and excluded.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Journey simulation: <journey>

> ⚠ **SIMULATED OUTPUT — hypotheses about where friction lives, not usability findings.**
> Never turn a simulated abandonment count into a number in a business case.

**Basis:** real running product / specified flow (PRD) / proposed flow (brief)
**Personas walked:** <list, with grounding grades>
**Date:** <date>

## Journey steps

Every step a real person takes, including arrival with wrong expectations, loading,
empty, error, correction, and return-two-days-later.

| # | Step | What the product does |
| :-- | :-- | :-- |
| 1 | | |

## Per-persona walk

### <Persona>

| Step | Understood | Expected next | Actually noticed | Continue? |
| :-- | :-- | :-- | :-- | :-- |

**Abandoned at step:** <n or none> · **Went to:** <alternative>

## Friction map

Ranked by severity = personas affected × blocks-or-annoys.

| Step | Personas reaching | Friction | Abandoned here | Severity |
| :-- | :-- | :-- | :-- | :-- |

## Step value — input to MVP staging

**Load-bearing steps** — remove them and the journey fails for someone. MVP candidates.

| Step | Fails for | Why load-bearing |
| :-- | :-- | :-- |

**Enhancement steps** — absence annoys but does not block. Staging candidates.

| Step | Annoys | Deferrable because |
| :-- | :-- | :-- |

## End-to-end coverage

The test of whether a proposed stage is a real stage.

| Persona | Completes journey? | Blocked at |
| :-- | :-- | :-- |

**Personas served by no complete path:** — this is either a scope decision or a
segment being dropped. It should be a choice.

## What simulation likely got wrong

Where the personas' reactions were extrapolation rather than evidence, and what
real observation would settle it.
