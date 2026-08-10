# 02 — Plan / Implement / Test

**Shape:** `plan -> implement -> test_gate (evidence) -> done`, with a `gate_fail`
back-edge to `implement`.

Staged pipeline with a convergence loop: explicit `plan`/`implement` phases feeding a
deterministic evidence gate, with `goal_gate=true` + `retry_target` on the gate. Staged
nodes are acceptable here specifically because the convergence skeleton around them is
load-bearing (`../reference/pipeline-design-principles.md` §0's own warning about the
opposite failure mode).

**Adapted from** `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/02-plan-implement-test.dot` (fetched 2026-08-10), same reason and
same fix as example 00: the real-`pytest` gate is replaced with a deterministic counter
so this example is provably convergent under `--stub`.

## Actually executed on this engine

```
$ node dist/attractor.js run 02-plan-implement-test.dot --run-dir <tmp> --stub --param goal="build a small feature"
VERIFIED: status=success path=start,plan,implement,test_gate,implement,test_gate,implement,test_gate,done
```

Full transcript: [`02-plan-implement-test.events.jsonl`](02-plan-implement-test.events.jsonl).

## What this teaches

- Reference: `../reference/dot-reference.md` — `goal_gate=true` + `retry_target` pairing.
- Reference: `../reference/engine-semantics.md` — fail-closed goal gates.
