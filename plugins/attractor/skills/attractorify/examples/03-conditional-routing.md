# 03 — Conditional Routing

**Shape:** `implement -> test -> gate`, gate routes to `done` (pass) or `fix` (fail);
`fix` loops back to `test`.

Evidence-based routing with a tool gate. **The correct pattern**: the gate runs a real
check and prints a token as its last stdout line; edges condition on
`context.tool.last_line`. NOT `shape=diamond` with `outcome=` conditions — the
conditional handler always returns SUCCESS, so outcome-based edges from a `diamond` are
dead (`../reference/routing-reference.md`).

**Adapted from** `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/03-conditional-routing.dot` (fetched 2026-08-10), same
deterministic-gate substitution as examples 00/02.

## Actually executed on this engine

```
$ node dist/attractor.js run 03-conditional-routing.dot --run-dir <tmp> --stub --param goal="build a small service"
VERIFIED: status=success path=start,implement,test,gate,fix,test,gate,done
```

The path shows the `fail` edge to `fix` firing once before the `pass` edge — both
outgoing conditions from `gate` are actually exercised, not just the happy path. Full
transcript: [`03-conditional-routing.events.jsonl`](03-conditional-routing.events.jsonl).

## What this teaches

- Reference: `../reference/routing-reference.md` — `weight=` tiebreak, why `diamond` is
  the wrong shape for this pattern.
