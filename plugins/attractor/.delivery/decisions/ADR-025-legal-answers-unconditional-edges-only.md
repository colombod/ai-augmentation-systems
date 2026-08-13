# ADR-025: `HumanGateContext.legalAnswers` enumerates only unconditional outgoing edges, correcting the adopted design doc's own citation

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect

## Context

The adopted `.superpowers/specs/2026-08-05-human-gate-channels-design.md` §1 states
`legalAnswers` "is the same enumeration `dot/lint.ts`'s existing HITL-001 rule already does —
reused, not reinvented," and that document's own header claims its edge-selection citations were
"verified against source" on 2026-08-05. Re-verifying that specific claim against current source,
per this pass's own "read the spec, don't reason about it" instruction: HITL-001's actual label
enumeration (`dot/lint.ts:508`, `const labels = outgoingEdges(graph, node.id).map((e) =>
e.attrs.label)`) has no `isConditional` filter anywhere in that block — it collects **every**
outgoing edge's label, conditional or not. `selectEdge`'s real routing mechanism
(`core/edge-select.ts:75-108`) only ever considers a `preferredLabel` match against
**unconditional** edges (step 2, after the condition cascade in step 1 has already either claimed
the edge or fail-fast-terminated the node) — `edge-select.ts:97-108`'s own `unconditional = edges.filter((e) => !isConditional(e))`.
The two enumerations are not the same set.

## Decision

`HumanGateContext.legalAnswers` = `outgoingEdges(graph, node.id).filter(e => !isConditional(e)).map(e => e.attrs.label).filter(l => l !== undefined)`
— matching `selectEdge`'s actual step-2 scope directly, not HITL-001's laxer enumeration.

## Alternatives considered

### Literally reuse HITL-001's enumeration, as the adopted design doc specifies

**Why it was attractive:** "reused, not reinvented" is exactly the kind of decision this codebase
prefers — one enumeration, one place it's computed, matching an already-shipped, tested rule.
**Why rejected:** would advertise a conditional edge's label to `agent`/`CommandChannel` as an
answerable option, when `selectEdge`'s own routing can never actually route a `preferredLabel` to
it — the condition cascade already claimed the edge, or the node was fail-fast-terminated first.
An `agent`/`CommandChannel` prompted with a legal answer the engine can structurally never honor
is a correctness gap dressed as reuse.

## Consequences

**We gain:** `legalAnswers` genuinely reflects what a channel's answer can route to, closing a
real discrepancy between the adopted design's stated intent (an accurate menu of legal answers)
and what its literal citation would have built.

**We accept:** `legalAnswers` and HITL-001's own label enumeration are now two distinct,
independently-maintained computations over the same graph structure — a future edit to one
could drift from the other if not made in both places consciously. Named here rather than
silently risked; a future refactor extracting a single shared "unconditional edge labels"
helper, consumed by both HITL-001 and `legalAnswers`, is a reasonable follow-on, not required
this slice (HITL-001's own enumeration is pre-existing, shipped, tested code — changing its
behavior is out of scope here).

**We will need to revisit this if:** HITL-001 is itself corrected to filter conditional edges
(closing the pre-existing inconsistency the adopted design doc's §1 already flagged as "worth
flagging but not fixing here") — at that point the two enumerations converge again, and the
shared-helper extraction above becomes the obvious next step.
