<!--
BUDGET — target 700 words, hard cap 1100 words. Excludes code, YAML and data tables.
Scoring and stage tables are data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Prioritisation and MVP staging

> Phase 6 artifact. Owned by Product Owner, with Program Manager and User Researcher.
> Value pass — effort figures here are pre-architecture estimates and get reconciled
> against real cost in `roadmap.md`.
> Evidence basis: <persona grounding summary>. Last updated: <date>

## Staging rule

A stage is not a batch of features. **A stage is a set of features that lets at least
one persona complete a journey end to end and get value.** A stage serving nobody
completely is a project milestone, not a release.

## Requirement scoring

| FR | Personas served | Load-bearing? | Severity | Objection answered | Effort (est.) | Confidence |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| FR-1 | | yes / no | | | S/M/L | observed / assumed |

Load-bearing beats enhancement. Where a delighter outranks a blocker, say why
explicitly — that reasoning should not win quietly.

## Stages

### MVP

**Includes:** FR-n, FR-m
**Evidence-only marker:** *(present only if every persona this stage names below is*
*`assumed`-grade — omit this line entirely otherwise, do not write "none")*
**⚠ Evidence-only — every supporting persona is `assumed`-grade.**
**Personas who can complete a journey end to end:**

| Persona | Journey completed | Evidence |
| :-- | :-- | :-- |

**Personas NOT served yet:** — and in which stage they will be. Naming this stops a
segment being silently abandoned.

**What this stage lets us learn:** — a stage that teaches nothing could have been
merged into the next.

**Excluded, and why they can wait:** in friction-map terms, not vibes.

### Stage 2

*(same shape as MVP above — **Includes**, evidence-only marker if it applies, personas
served, personas not yet served, what it teaches, what's excluded and why)*

...

### Explicitly not doing

| FR | Reason | Revisit if |
| :-- | :-- | :-- |

## Milestones

Release milestones (users get something) versus learning milestones (we find
something out). Both legitimate; conflating them is not.

| # | Type | Demonstrable outcome | Shown to | Depends on |
| :-- | :-- | :-- | :-- | :-- |

## Confidence

How much of this rests on `assumed`-grade personas. A prioritisation built on
invented users is a plan for an invented market — the reader is entitled to know
how much of it is that.

## Open questions for the originator

Decisions only they can make — segments to drop, tradeoffs between personas.
