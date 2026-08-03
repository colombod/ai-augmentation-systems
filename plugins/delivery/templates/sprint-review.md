<!--
BUDGET — target 600 words, hard cap 1000 words. Excludes code, YAML and data tables.
Criteria and journey tables are data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Sprint <n> acceptance review

> Independent re-check. The sprint reported its own results; this verifies them
> **against the code as it now exists**. Where the log and the code disagree, the
> code wins — and the discrepancy is itself a finding.

**Sprint:** <n> · **Reviewed:** <date> · **Branch / SHA:** <ref>

## Verdict

**Accepted** | **Accepted with debt** | **Not accepted**

A review that never returns "not accepted" is not a gate. State it plainly.

**Because:**

## Acceptance criteria — verified independently

Criteria read first, then checked against code. Not against the sprint log.

| FR | Criterion | Met | Evidence | Log agreed? |
| :-- | :-- | :-- | :-- | :-- |
| FR-n | | met / not / partial | test name or observed behavior | yes / **no** |

**Log discrepancies:** any `no` above. This matters more than the individual
criterion — it means the sprint's self-assessment cannot be relied on.

## Test suite

**Command:**
**Actual output:**
**Was green at sprint close, red now:** yes / no

## Design system conformance

| Check | Result | Paths |
| :-- | :-- | :-- |
| Tokens used vs. hardcoded values | | |
| Missing component states | | |
| Contrast rules failing | | |

## Persona journeys — the question story criteria cannot answer

> ⚠ Simulated output. Personas walked the **now-real** implementation.

| Persona | Journey | Completes end to end? | Blocked at |
| :-- | :-- | :-- | :-- |

**A sprint where every story passed but no persona can complete a journey has
delivered nothing usable.** State that plainly if it is the case.

## Stage promise vs. delivered

What `prioritization.md` promised this stage would deliver and serve.

| Promised | Delivered | Gap |
| :-- | :-- | :-- |

**Silent scope drops:**

## What the wave taught

The part that improves the next one.

**Stories that were wrong** — spec conflicted with reality, and what the story was
missing. Feedback for `/delivery:stories`.

| Story | What was missing |
| :-- | :-- |

**Estimates that were wrong**, and in which direction. Feedback for `/delivery:roadmap`.

**Assumptions invalidated** — from PRD, architecture or personas. Each needs its
source document updated, or the next phase inherits a known-false premise.

| Assumption | Source doc | Now known | Doc updated? |
| :-- | :-- | :-- | :-- |

**Simulation calibration** — friction the real thing had that simulation missed, and
friction simulation predicted that did not materialise. This is the only feedback the
persona phases ever get; it decides how much to trust them next time.

## Carried debt

Recorded as findings in `docs/product/reviews/` with status `open`, so
`/delivery:status` keeps surfacing them.

| ID | Debt | Why accepted | Repay by |
| :-- | :-- | :-- | :-- |
