# ADR-005: HAND-001 refuses unregistered handler kinds via a hand-authored, anchor-tested constant

**Status:** accepted
**Date:** 2026-08-05
**Deciders:** Solution Architect

## Context

FR-17a: lint should refuse, before a run starts, any node resolving to a handler kind this
build doesn't register — today such a node aborts mid-run with "no handler registered," after
earlier nodes may have already spent tokens or made changes. `dot/graph.ts`'s
`INFERRED_OUTPUTS_BY_HANDLER` already carries per-entry comments distinguishing "genuinely
writes nothing" from "not registered" for `PARALLEL`, `FAN_IN`, `MANAGER_LOOP` (and, until
S2 lands, `HUMAN`). The ideal source of truth — deriving the unregistered set directly from
`defaultHandlers()` — isn't reachable from `dot/lint.ts` without cost: `defaultHandlers(backend:
Backend)` needs a `Backend` to construct `BoxHandler`, and forcing that dependency into a pure,
I/O-free static-analysis module (or changing `lint()`'s public signature to accept one) is a
worse trade than a hand-authored list closed by a runtime check.

## Decision

A new exported constant, `UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[]`, hand-listed in
`dot/graph.ts` as `[Handler.PARALLEL, Handler.FAN_IN, Handler.MANAGER_LOOP]` (excluding
`HUMAN`, registered by FR-5/6/7 in this same slice). A new `HAND-001` ERROR-severity lint rule
in `dot/lint.ts` flags any node resolving to one of these. A dedicated anchor test — modeled on
the existing, already-endorsed pattern at `lint.test.ts:1186`, not a self-referential check —
constructs `defaultHandlers()` and asserts the constant equals its actual unregistered keys, so
the hand-authored list cannot drift silently as handlers are added.

## Alternatives considered

### Derive the set from `defaultHandlers()` directly at lint time

**Why it was attractive:** single source of truth, zero drift risk by construction.
**Why rejected:** `dot/lint.ts` is deliberately pure and I/O-free; giving it a `Backend`
dependency (even an unused stub) to construct a handler map purely to read its keys inverts
this module's own layering for no functional gain over a hand-list plus an anchor test, which
achieves the same drift protection without the dependency.

### WARNING severity instead of ERROR

**Why it was attractive:** matches TOPO-006's (dead-end nodes) precedent — the runtime
already handles the failure safely (a loud FAIL, never silent success), so an ERROR might seem
like it's costing false positives for no safety gain.
**Why rejected:** TOPO-006's second justification — "the shape sometimes reflects a
legitimate authoring choice" — doesn't hold here. No committed `.dot` file anywhere in this
repo uses these three shapes (verified: `git ls-files "*.dot"` returns zero files at all), and
there is no legitimate reason to author one against this build today. ERROR costs nothing in
false positives and matches the PRD's own text ("Lint refuses").

## Consequences

**We gain:** a run that would have wasted real, metered work before hitting an unimplemented
handler mid-pipeline is refused instead, before anything executes — directly serving this
project's own P-2 persona (an unattended, walk-away operator who pays for that wasted work).

**We accept:** the constant must be authored (or re-verified) *after* FR-5/6/7 registers
`Handler.HUMAN` — landing FR-17a first means writing the list including `HUMAN` and editing it
again once S2 ships. This sequencing dependency is enforced by the anchor test (which would
fail if `HUMAN` were included after registration) but is not otherwise mechanically ordered.

**We will need to revisit this if:** `defaultHandlers()`'s signature changes to not require a
`Backend`, at which point deriving the set directly becomes strictly better than the
hand-list-plus-anchor-test pair and this ADR should be superseded.

> **Correction, 2026-08-06 (final whole-branch review).** The Decision above states the
> constant is hand-listed as `[Handler.PARALLEL, Handler.FAN_IN, Handler.MANAGER_LOOP]`
> "(excluding `HUMAN`, registered by FR-5/6/7 in this same slice)". That was the plan at
> the time this ADR was written, but it is not what shipped: FR-5/6/7 (S2, human gates) is
> on hold, tracked separately in `carry-forward.md`'s Plan 4 section, and never landed in
> this slice. `defaultHandlers()` (`core/engine.ts`) does not register `Handler.HUMAN`
> today, so `UNREGISTERED_HANDLER_KINDS` (`dot/graph.ts`) as actually implemented and
> shipped is `[Handler.HUMAN, Handler.PARALLEL, Handler.FAN_IN, Handler.MANAGER_LOOP]` --
> `HUMAN` included, not excluded. The anchor test this ADR describes (constructing
> `defaultHandlers()` and asserting the constant equals its actual unregistered keys)
> confirms this is correct for what is registered today, not a bug: with `HUMAN`
> unregistered, a `hexagon` node genuinely does resolve to an unregistered handler kind,
> and `HAND-001` is right to refuse it.
>
> This needs revisiting whenever Plan 4's human-gate work eventually registers
> `Handler.HUMAN` in `defaultHandlers()`: at that point `HUMAN` must be removed from
> `UNREGISTERED_HANDLER_KINDS`, and the anchor test (and its companion in
> `test/lint.test.ts`) will fail loudly if that edit is missed, which is what makes this a
> loud trap rather than a silent one. The "We accept" paragraph above, read literally,
> already anticipated an edit "after FR-5/6/7 registers `Handler.HUMAN`" -- what it did
> not anticipate is that FR-5/6/7 would still not have landed by the time this ADR's own
> claimed initial membership was checked against the shipped code.
