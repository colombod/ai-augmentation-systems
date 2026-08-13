# ADR-013: `FR-18`'s verdict-mapping logic runs as deterministic code in handoff's Report-back step, not sprint-review, not agent prose

**Status:** accepted
**Date:** 2026-08-13
**Deciders:** Solution Architect, QA Strategist

## Context

`FR-16` requires `/delivery:sprint-review` to stay "otherwise unmodified" beyond consuming `sprint.md`'s widened Outcome enum. `FR-18` needs to know whether a `done` story's correctness depends, via the `outputs=` ledger, on a `non-convergent`/`irreducible` story's declared output — a fact only the compiler (or a reader of its own compiled `.dot`) can determine.

Two issues surfaced during review that this decision must close, not leave implicit:

1. **QA-strategist's flag:** the original design description was ambiguous between "deterministic code" and "agent-executed prose reading tables" — the latter would be the highest-consequence unverifiable logic in the whole feature, reintroducing exactly the self-grading risk this feature exists to remove (the same class of bug `research.md` found live in Argo Workflows: a retry's real outcome failing to propagate into the overall verdict).
2. **feature-critic's finding:** `FR-18` as written only defines two cases — a `done` story consuming a non-convergent story's output, and nothing consuming it. It has no rule for a `non-convergent`/`irreducible` story consuming *another* `non-convergent`/`irreducible` story's output (a chained-debt case).

## Decision

The verdict-mapping computation is **deterministic code**, not agent prose, living in the new Report-back subsection's tooling (alongside `hooks/scripts/validate-attractor-pipeline.js`, per the same real-tooling precedent this plugin already has in `hooks/scripts/record-invocation.js`). It walks the compiler's own `outputs=`-consumption graph **transitively**, not just one hop:

- A story is **debt-tainted** if it is itself `non-convergent`/unresolved-`irreducible`, or if it consumes a declared output from a debt-tainted story.
- Sprint verdict is **Not accepted** if any `done` story is debt-tainted (its claim rests on an unproven or chained-unproven input).
- Sprint verdict is **Accepted with debt** if a debt-tainted story exists but no `done` story depends on it.
- Sprint verdict is **Accepted** otherwise, per the existing, unmodified rubric.

## Alternatives considered

### Add the check to `sprint-review`, reading the run's raw event log

**Why it was attractive:** keeps all verdict logic in one file.
**Why rejected:** violates `FR-16` directly, and duplicates information the compiler already has for free — `sprint-review` would need to re-parse attractor's run output to reconstruct a fact the compiler knew when it wrote the graph.

### Agent-executed prose in the new SKILL.md section

**Why it was attractive:** no new code file.
**Why rejected:** this is the single computation deciding Accepted / Accepted-with-debt / Not-accepted — the highest-consequence output this feature produces. Prose logic of this shape is verifiable only by hand-walking fixtures against instructions, repeated on every change, forever — exactly the manual burden that argues for code.

### Two-case rule only (as originally drafted in `FR-18`), leaving chained debt undefined

**Why it was attractive:** matches the PRD's literal text without extending it.
**Why rejected:** silently drops a real case the compiler's own data already answers; a later sprint fixing a downstream story wouldn't re-surface that its earlier "pass" rested on an input the ledger should have kept marked owed.

## Consequences

**We gain:** `FR-16`'s guarantee holds literally, the highest-consequence verdict logic is unit-testable exactly like the sizing validator, and the chained-debt case feature-critic found is closed rather than silently absorbed.

**We accept:** the Report-back step is now load-bearing for verdict correctness, not just data population — a defect there silently produces a wrong sprint-level verdict, same risk class as the mechanism it replaces, mitigated by making it real, tested code instead of prose.

**We will need to revisit this if:** `FR-18`'s rule ever needs runtime information the compiled `.dot` doesn't capture statically (e.g. a dynamic edge condition attractor resolves only at run time).
