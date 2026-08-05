<!--
BUDGET — target 700 words, hard cap 1100 words. Excludes code, YAML and data tables.
Phase, dependency and coverage tables are data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Delivery roadmap: <feature name>

> Phase 4 artifact. Owned by Program Manager, with QA Strategist.
> Status: draft | agreed  ·  Last updated: <date>
> PRD: `.delivery/prd.md` · Architecture: `.delivery/architecture.md`

## Constraints

**Team:** size and composition
**Fixed dates:** and what makes them fixed
**Fixed variable:** scope or date — one of them is, and the plan optimizes for the other

## Sequencing rationale

Why this order. Specifically: what is being proven early, and why the risky work
sits where it does. A plan that front-loads the easy work has to justify itself.

## Phases

### Phase 1: <name>

**Entry criteria:**
**Delivers:** `FR-n`, `FR-m`
**Demonstrable exit:** what you would actually show someone — not "backend complete"

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| | S / M / L | high / med / low | |

**Verification in this phase:** (from the test strategy)

**Cut list — dropped first if late, in this order:**
1. 

Deciding this now beats deciding it under pressure.

### Phase 2: <name>

...

## Critical path

The chain that determines the end date:

```
<item> → <item> → <item>
```

**To shorten it, one of these would have to change:**

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |

## Requirement coverage

Every `FR-n` lands in a phase, or is explicitly deferred. An FR in no phase is a
silent scope drop.

| FR | Phase | Notes |
| :-- | :-- | :-- |

**Deferred:** FR-n — reason

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |

## Buffer

Where it is and how much. Named explicitly — buffer hidden inside estimates
cannot be managed.
