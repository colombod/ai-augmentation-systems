# 04 — Retry with Fallback (simplified)

**Shape:** `plan -> implement -> validate_gate`, with a `retry` back-edge to `implement`;
`max_retries`/`retry_target` stated explicitly on `implement`.

**Substantially simplified** from `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/04-retry-with-fallback.dot` (fetched 2026-08-10, ~250 lines). The
original demonstrates a full explicit-renegotiation pattern: a budget-exhaustion
trigger, a pipeline-enforced disclosure artifact (`renegotiation.md`, structurally
validated by its own gate), and a relaxed fallback path with a different, weaker
evidence gate. **That full pattern is not reproduced here** — read the original for it,
or `../reference/pipeline-patterns.md` §7 for the general routing-discipline lesson it
teaches. This adaptation keeps only the smaller, verified-safe lesson: `max_retries` and
`retry_target` stated explicitly on a node (belt-and-suspenders, matching amplifier's
own framing), alongside the drawn corrective edge that is spec §3.3's actually-active
routing mechanism — see `../reference/engine-semantics.md`'s Retry section for exactly
when the node-level retry ladder is consulted versus when a drawn edge fires first.

This is the one example in this set that is an honest, named partial port, not a full
one — see `../../../.delivery/decisions/ADR-019-example-portability-policy.md` and this
project's own "1 of 4, not 2 of 4" honesty precedent (`.superpowers/spec-conformance.md`).

## Actually executed on this engine

```
$ node dist/attractor.js run 04-retry-with-fallback.dot --run-dir <tmp> --stub --param goal="a validated regex"
VERIFIED: status=success path=start,plan,implement,validate_gate,implement,validate_gate,implement,validate_gate,done
```

Full transcript: [`04-retry-with-fallback.events.jsonl`](04-retry-with-fallback.events.jsonl).

## What this teaches

- Reference: `../reference/engine-semantics.md` — graph-level/node-level `retry_target`
  vs. a drawn edge; which one this graph actually exercises when it runs.
