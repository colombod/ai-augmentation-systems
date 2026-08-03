<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

---
id: <epic>-<nn>
title: <short imperative title>
status: draft | ready | in-progress | done | superseded
epic: <epic name>
supersedes: []          # story IDs this replaces, if any
superseded_by: []       # story IDs that replace this, if any
superseded_reason:      # one line — WHY the design changed, not just what replaced it
phase: <roadmap phase>
requirements: [FR-1]
depends_on: []
size: S
---

# <title>

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

The user-facing outcome, in one or two sentences. What becomes possible.

## Context

Why this story exists and where it sits in the feature. Enough that the
implementer understands the intent, not just the instruction.

## Files and modules

Real paths, verified against the repo.

| Path | What to do |
| :-- | :-- |
| `src/...` | modify — |
| `src/...` | create — |
| `tests/...` | add tests for — |

## Interfaces and contracts to honor

Reproduced here from the architecture, not linked.

```
<signatures, schemas, shapes>
```

## Relevant design decisions

Which architecture decisions apply here and why they constrain this work.

- **ADR-00n** — decision, and what it means for this story

## Acceptance criteria

Traced to the PRD. Each falsifiable by someone who did not write it.

- [ ] `FR-1` — 
- [ ] 

## Test approach

**Level:** unit / integration / e2e, and why that level for this risk
**Cases:**

| Case | Expected |
| :-- | :-- |
| happy path | |
| empty / zero | |
| boundary / max | |
| invalid input | |
| permission denied | |
| concurrent | |

**Run with:** `<the actual command in this repo>`

## Out of scope

Deliberate boundaries. These were decided, not forgotten.

- 

## Dependencies

Stories that must be `done` first, and why.

- 

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the
plan and the reason, and follow-up work — anything a future reader would want.

