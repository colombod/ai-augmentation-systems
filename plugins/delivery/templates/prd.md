<!--
BUDGET — target 1000 words, hard cap 1600 words. Excludes code, YAML and data tables.
Scenario and requirement tables are data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# PRD: <feature name>

> Phase 2 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft | reviewed | agreed  ·  Last updated: <date>
> Brief: `docs/product/brief.md`

## Summary

Two or three sentences. What this is and who it is for.

## Goals and non-goals

**Goals**

- 

**Non-goals** — things a reader might reasonably assume are included, but are not.

- 

## User scenarios

Each scenario needs an actor, a trigger, a sequence, and an observable outcome.
A feature-list entry is not a scenario.

### S-1: <short name>

**Actor:** who, specifically
**Trigger:** what starts this
**Preconditions:** what must already be true

**Main path**

1. 
2. 

**Observable outcome:** what the actor can see or verify at the end

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Empty input | |
| Very large input | |
| Duplicate / already exists | |
| Concurrent modification | |
| Permission denied | |
| Resource missing mid-operation | |
| Partial failure | |
| Timeout / retry | |
| Undo / correction | |

**Acceptance criteria**

Each must be checkable by someone who did not write it.

- `FR-1` — 
- `FR-2` — 

## Functional requirements

| ID | Requirement | Scenario | Priority |
| :-- | :-- | :-- | :-- |
| FR-1 | | S-1 | must / should / could |

IDs are stable. The architecture, roadmap, stories and tests reference them —
renumbering breaks the chain.

## Non-functional requirements

Numbers, not adjectives. Where the number is unknown, record it as an open
question rather than inventing one.

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Latency | P95 < Xms at Y load | |
| NFR-2 | Data volume | | |
| NFR-3 | Concurrency | | |
| NFR-4 | Availability | | |
| NFR-5 | Retention / compliance | | |

## Assumptions

Stated as assumptions, not as facts. Each one is a thing that could be wrong.

- 

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |

## Out of scope

- 
