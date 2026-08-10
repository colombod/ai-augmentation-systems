# ADR-019: Which amplifier canonical examples port, adapt, or get excluded — and why

**Status:** accepted
**Date:** 2026-08-10
**Deciders:** Solution Architect

## Context

FR-16 requires that no worked example in the skill's reference material is described
as working without having been executed on this engine — `spec-conformance.md`'s
"1 of 4, not 2 of 4" table is the named precedent for the honesty standard: name what
ran, name what didn't, don't let a reader assume coverage a table doesn't show. FR-14
independently requires the skill never generate a graph using an unregistered handler.
Together these mean an amplifier example is only usable as a "this works" reference
if it (a) uses only handlers this build's `defaultHandlers()` registers — `Handler.START`,
`Handler.EXIT`, `Handler.CONDITIONAL`, `Handler.TOOL`, `Handler.CODERGEN`,
`Handler.PARALLEL` — and (b) was actually run here, not just read and judged compatible.

Checked directly, not assumed from filenames: `grep -o 'shape=[a-zA-Z]*'` against every
`examples/pipelines/*.dot` and `examples/patterns/task-runner.dot` in
`microsoft/amplifier-bundle-attractor@main`, cross-referenced against
`dot/graph.ts`'s `SHAPE_TO_HANDLER` table.

## Decision

The full table is in `architecture.md`'s "Example-portability policy" subsection
(FR-13–16 addition) — not duplicated here. Summary: of amplifier's 13 canonical
examples, 5 (`00-convergence-loop`, `01-simple-linear`, `02-plan-implement-test`,
`03-conditional-routing`, `04-retry-with-fallback`) use only registered handlers and
are ported and executed verbatim; 1
(`practical/bug-fix.dot`) is a portable practical exemplar, ported and executed if
budget allows; 1 (`05-parallel-fan-out.dot`) is adapted — its `tripleoctagon`
(`Handler.FAN_IN`, unregistered) fan-in node is dropped, relying instead on this
engine's own default join policy, which already checks for zero successes
(Open Question 5's resolution, shipped in FR-17b) — so the adaptation doesn't lose the
"fail when everything fails" property amplifier's canonical example demonstrates, it
gets it from a different, already-shipped mechanism. `task-runner.dot` itself and 6
further examples are named and excluded, each for a specific, cited reason (unregistered
handler, or an explicitly out-of-scope PRD non-goal), not silently dropped.

`task-runner.dot`'s exclusion is the one worth calling out beyond the table: it is
amplifier's own canonical control-plane skeleton, referenced repeatedly by the ported
`SKILL.md` and `PIPELINE_DESIGN_PRINCIPLES.md` text. It uses `hexagon`
(`Handler.HUMAN`, unregistered) and `model_stylesheet`/`class=` selectors (PRD
non-goal) throughout, both load-bearing to its design, not incidental — a strip-down
would not be "the same example, corrected," it would be a materially different graph
wearing the same name. `00-convergence-loop.dot` — already portable verbatim, and
amplifier's own attractor-expert.md independently describes it as "the bowl: minimal
4-node convergence loop with evidence gate and corrective back-edge" — takes over as
the canonical skeleton exemplar in this project's own reference material instead.

## Alternatives considered

### Hand-adapt every excluded example (strip the unregistered handler, keep the rest)

**Why it was attractive:** more coverage; closer parity with amplifier's own
documentation surface for the amplifier-veteran persona.
**Why rejected:** for several of the excluded examples the unregistered handler (or
out-of-scope feature) is the entire point of the example — `08-human-gate.dot`,
`09-manager-supervisor.dot`, `10-full-attractor.dot` would become a different, smaller
example wearing the original's name and number, actively misleading rather than
honest. `06-model-stylesheet.dot` and `07-fidelity-modes.dot` demonstrate features that
are either out of scope by PRD non-goal or of genuinely unresolved status (Open
Question 10) — no honest "it works" claim is available regardless of handler
registration.

### Write brand-new examples instead of porting amplifier's at all

**Why it was attractive:** avoids the whole portability question.
**Why rejected:** discards the amplifier-veteran persona's actual benefit from
recognizable, numbered, named examples, and discards real design effort (these graphs
already demonstrate well-chosen patterns) for no gain — the corrected subset is
sufficient and genuinely amplifier's own.

## Consequences

**We gain:** every example in the reference material is honestly labeled — ported and
run, adapted and run, or explicitly excluded with a reason — with no example
overstating what was proven.

**We accept:** meaningfully thinner example coverage than amplifier's own 13-example
set, most visibly missing a human-gate example and a manager-supervisor example — both
genuinely valuable patterns this project simply cannot demonstrate honestly until
`Handler.HUMAN`/`Handler.MANAGER_LOOP` are registered (Stage 3 and beyond).

**We will need to revisit this if:** `Handler.HUMAN`, `Handler.FAN_IN`, or
`Handler.MANAGER_LOOP` get registered — each unblocks re-evaluating the excluded
examples that used only that one missing handler, not a wholesale re-run of this ADR.
