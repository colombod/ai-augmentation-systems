# ADR-003: `resolveRetryTarget` takes a required `includeGraphLevel` option, no default

**Status:** accepted
**Date:** 2026-08-05
**Deciders:** Solution Architect

## Context

D7 (`spec-conformance.md`): a plain node's FAIL wrongly consults the graph-level
`retry_target`/`fallback_retry_target` fallback, which §3.7 reserves for the goal-gate exit
ladder (§3.4) only. Three call sites resolve a retry target today: `engine.ts`'s
`gateRetryTarget` (~423, correctly wants graph-level fallback), the retry-exhaustion branch
(~1021, must not), and the plain-FAIL branch (~1165, must not) — plus a fourth found during
design, `lint.ts`'s GATE-001 rule (~829), which deliberately mirrors the same ladder so lint
and runtime can't disagree about what a §3.7 failure route is.

## Decision

`resolveRetryTarget(node, graph, opts: { includeGraphLevel: boolean })` — the option is
**required**, no default value. Three of four call sites pass `false`; `gateRetryTarget` alone
passes `true`. GATE-001's own call site is fixed in the same change, not deferred.

## Alternatives considered

### Default `includeGraphLevel` to `true`, three call sites opt out

**Why it was attractive:** preserves today's two-argument call sites at the three that keep
the graph-level behavior unintentionally.
**Why rejected:** a future fifth call site that forgets to opt out silently reintroduces D7 —
exactly the bug this fix exists to close, just moved one call site later.

### Default to `false`, one call site opts in

**Why it was attractive:** the safer default in isolation — most call sites want `false`.
**Why rejected:** a future gate-ladder call site that forgets to opt in silently breaks §3.4
instead. Swaps which mistake is silent; doesn't remove the silent-mistake class.

### No default either way — required argument

**Chosen.** Removes "which default is safer" as a question at all: every call site must say,
explicitly, which ladder it's climbing. Matches this codebase's existing preference for an
explicit, unignorable signal over a convenient default (HITL-001's "no implicit fallback, no
first-edge rule" is the same instinct on a different attribute).

## Consequences

**We gain:** a fix that cannot silently regress by omission at a future call site, and lint/
runtime agreement restored at GATE-001.

**We accept:** the `own`/`graphLevel` split inside `resolveRetryTarget` becomes dead code once
every non-gate call site passes `false` — needs pruning, not just the option bolted on, or a
future reader inherits an unreachable branch that looks live. `lint.test.ts`'s existing
`'GATE-001 fires for a graph-level fallback_retry_target that bypasses the gate'` test
(~line 872) goes red the moment this lands and needs a rewrite to assert zero diagnostics for
that shape, not a mechanical recompile — this is a real, traced consequence, not a guess.

**We will need to revisit this if:** a fifth call site to `resolveRetryTarget` is ever added
(the required argument forces a decision at that point, which is the design working as
intended) or if the spec's own retry-ladder scope changes.
