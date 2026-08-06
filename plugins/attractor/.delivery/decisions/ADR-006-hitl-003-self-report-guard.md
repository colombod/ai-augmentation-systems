# ADR-006: HITL-003 traces self-report only through a direct Handler.CODERGEN predecessor

**Status:** accepted
**Date:** 2026-08-06
**Deciders:** Solution Architect

## Context

Plan 4's reconciliation review (`.superpowers/carry-forward.md`) found a gap in the planned
`agent` human-gate channel: nothing stops a graph author from setting `human.context=` to a
key written by the very node the gate exists to check, so a fresh, session-isolated `agent`
channel can still end up rubber-stamping a self-report. `AGENTS.md`'s doctrine names this
directly: "verification inside the context that produced the evidence is not verification."

FR-18 (`.delivery/prd.md`) asks for a lint-time guard. The open question this ADR resolves:
does "traced to a single, structurally-provable direct predecessor" mean *any* predecessor
whose declared or effective output could match, or specifically a `Handler.CODERGEN`
(box/LLM) predecessor?

## Decision

`Handler.CODERGEN` only. A new rule, `HITL-003` (WARNING), fires when a human-gate node's
`human.channel` contains the token `"agent"`, its `human.context=` is non-empty, and its
sole direct predecessor (in-degree exactly 1) resolves to `Handler.CODERGEN`.

The `human.channel`/`human.context` attribute names this rule reads are not this ADR's to
invent — they are defined by
`.superpowers/specs/2026-08-05-human-gate-channels-design.md` §5 ("Graph attributes"), a
design that converged 5/5 and is treated here as resolved, not open prose. If a future
implementation of those attributes diverges from what is assumed here (e.g. the shape of
`human.context`, or the meaning of the `"agent"` channel token), this ADR should be
revisited.

`handlers/box.ts`'s `BoxHandler.execute` merges `{last_stage, last_response}` into context
unconditionally, on every execution regardless of outcome (lines 179-183) — `last_response`
is the model's own prose (`outcome.notes`, truncated), so a `CODERGEN` predecessor can be
proven, statically, to have written *something* to context: the exact self-report evidence
this rule cares about. (`outcome.contextUpdates` is merged earlier in the same handler,
lines 122-141, but only conditionally — when the backend returns `contextUpdates` at all,
and after the `isEngineManagedKey` filter — so it is not itself a sound basis for "this
predecessor definitely wrote something"; the unconditional `last_stage`/`last_response`
merge is.) `handlers/tool.ts`'s `ToolHandler.execute` (lines 139-151) writes
`tool.last_line`/`tool.output` only when `result.code === 0` — a `TOOL` predecessor's write
is conditional on a runtime exit code lint cannot see, so it cannot be proven the same way.
Including `Handler.TOOL` as a provable kind would produce a false positive on the most
natural topology this feature exists to catch ("tool fails → escalate to a human/agent
gate", where the tool node by construction did *not* write its output).

The rule does not check *which* key `human.context=` names against what the predecessor
wrote — `INFERRED_OUTPUTS_BY_HANDLER[Handler.CODERGEN]` is deliberately `[]` (`dot/graph.ts`)
because box/LLM output keys are arbitrary strings decided by the model at runtime; there is
nothing honest to cross-reference at lint time. It fires on any non-empty `human.context=`
once the two structural facts (in-degree 1, predecessor is `CODERGEN`) hold.

## Alternatives considered

### Fire for any direct predecessor whose declared or effective output matches the named key

**Why it was attractive:** narrower, fewer false positives — only fires when the specific
key is provably written.
**Why rejected:** `declaredOutputs`/`effectiveOutputs` rely on an author-written `outputs=`
attribute, which is optional. A `CODERGEN` node with no `outputs=` declared would silently
escape the check even though its `contextUpdates` are exactly the self-report risk this rule
exists to catch. Checking predecessor *kind* rather than declared *key* catches the
undeclared case, which is the more common and more dangerous one.

### Include `Handler.TOOL` as a second provable predecessor kind

**Why it was attractive:** tool-command output is also visible in `human.context=` in
principle, and excluding it looks like reduced coverage.
**Why rejected:** demonstrated false positive above — a failed tool node writes nothing, so
a rule that fired on any `TOOL` predecessor would warn on graphs where no self-report risk
exists at all. Not a coverage tradeoff; a correctness one.

## Residual risk

Named explicitly, not left as a parenthetical, so it survives this rule shipping rather than
being treated as closed:

- **Multi-hop chains.** A `CODERGEN` node two or more hops upstream of the gate, through an
  intermediate node of any other kind, is invisible to this rule — it inspects only the
  direct predecessor. Pinned by test N6.
- **`Handler.TOOL` predecessors, declared or not.** Excluded by the decision above, with or
  without an `outputs=` declaration. Pinned by test N5.
- **Multiple genuinely different direct predecessors — e.g. a rework/retry loop.** A gate fed
  by two or more edges from the SAME direct-predecessor node is now correctly resolved to
  that one predecessor (`directPredecessor` dedupes by source node and excludes self-edges);
  a gate fed by two or more edges from GENUINELY DIFFERENT predecessor nodes still silently
  disqualifies the rule, exactly like the two-distinct-predecessor case above. This is a
  common, realistic topology in this engine's own worked examples, not an exotic one — a
  rework loop where an initial review node and a later revision node both feed the same
  human/agent gate. Intentional and deferred, not a bug: lint has no way to know at analysis
  time which branch's output actually reached the gate at runtime, so disqualifying rather
  than guessing is the same "no honest cross-reference at lint time" principle that governs
  the rest of this rule. Pinned by the existing "two direct predecessors" test.
- **Embedded-`Engine` visibility.** Per ADR-004, `Engine.run()` only checks `hasErrors()`
  (ERROR-only) — a direct `new Engine(...)` embed does not see this WARNING at all today.
  This is a pre-existing gap affecting every WARNING-severity rule, not new to `HITL-003`,
  tracked under Open Question 7 / FR-12. This rule states the gap; it does not close it.

Both structural gaps and the visibility gap are tracked as Open Questions in
`.delivery/prd.md` (owner: Product Owner / Solution Architect), not left to be rediscovered:
the multi-hop gap is Open Question 11, the `Handler.TOOL` gap is Open Question 12, and the
visibility gap is the pre-existing Open Question 7.

## Consequences

**We gain:** an author who wires `human.channel="agent"` at a gate fed directly by an LLM
node's own output now sees a WARNING before the `agent` channel exists to misuse it — the
guardrail lands before the road opens.

**We accept:** this closes one instance of the self-report hazard, not all of them (see
Residual risk). It is advisory only — `HITL-003` never sets `hasErrors()`, so no run is
blocked by it, and nothing today enforces that an author reads lint output before shipping a
graph.
