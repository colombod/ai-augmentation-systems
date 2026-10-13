---
name: verify-against-source
description: "The discipline of refuting a claim against the actual shipped source rather than arguing from priors — evidence or it didn't happen. Use when verifying any claim in the claim-guard gate: locate the load-bearing code, construct the counter-case, cite file:line, and never let a plausible invariant stand unchecked in the one place it matters."
---

# Verify Against Source (Evidence or It Didn't Happen)

Debates conducted in adjectives drift. The one decisive move in the incident's remediation was an
agent stopping to `grep` the actual DDL instead of arguing about what the database "probably" does.
This skill is that move, made a rule.

## The stance

The claim is a **hypothesis to disprove**, not a fact. Your question is not *"does it work?"* but
***"how is this claim false?"*** A normal review confirms; you hunt.

## The method

1. **Locate the load-bearing code.** What must be true in the source for this claim to hold? Find the
   exact function/branch/validator/write-path. Grep/Glob to find candidates; then pin the real one by
   reading the definition and following the symbol's imports, re-exports, and callers.
2. **Construct the counter-case — don't nod.** Actively look for the input/state/path that breaks it:
   - "gates degraded writes" → grep every write path for a read of the gate signal; **absence is
     refutation.**
   - "validates input" → find the validator; if none, feed the boundary value.
   - "handler uses the immutable id" → find where the id is built; is it from mutable state?
   - "we guard X" → enumerate **every** path into X; one unguarded path refutes it.
3. **Read the code. Do not argue with priors.** The dangerous claims are plausible invariants that
   are true in general and false in the one place that matters — "idempotent MERGE makes replay a
   no-op," "max_delete is a cap." Check the exception, not the rule.

## The evidence rule (structural)

Every `CONFIRMED` or `REFUTED` requires a **`file:line` anchor**. A verdict without a citation is not
a verdict — the ledger rejects it. A `REFUTED` also requires a **concrete counter-case**: the exact
input/state/sequence that makes the claim false.

**During debate:** you may move a verdict *away from* `REFUTED` **only by citing new `file:line`
evidence** not already in the ledger. Prose alone cannot clear a REFUTED. If a peer lens shows you a
path you missed, concede honestly, in your own voice, with the reason — that is the system working.

## The five root-cause patterns to hunt

1. **Detection mistaken for control** — a signal is computed and surfaced but gates nothing.
   Observability ≠ enforcement.
2. **Fix-the-instance, not-the-class** — the guard covers the path where the bug was first seen, not
   every path into the shared chokepoint ("one branch over").
3. **Liveness tested, integrity only asserted** — the test proves it runs, not that it stays correct
   in the adverse state.
4. **Plausible invariant believed without checking the exception.**
5. **Reasoning from prose, not source** — the failure this whole skill exists to prevent.

## When you cannot settle it statically

Return **UNTESTABLE** with the reason — a temporal/quantitative/concurrency property that needs
execution, or a call graph you cannot resolve. A claim you cannot test is a claim you cannot trust;
UNTESTABLE routes to human adjudication. Never guess CONFIRMED to make a claim go away.
