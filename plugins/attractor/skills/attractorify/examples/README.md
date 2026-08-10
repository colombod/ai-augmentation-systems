# Worked examples — every one actually executed on this engine

FR-16: no example here is described as working without having been executed on this
engine. Every `.dot` file below lints clean and has a real, committed
`<name>.events.jsonl` transcript from a `--stub` run of that exact file — not a
hand-written or hypothetical one. See
[`architecture.md`'s Example-portability policy](../../../.delivery/initiatives/spec-conformance-mvp/architecture.md)
and [ADR-019](../../../.delivery/decisions/ADR-019-example-portability-policy.md) for
the full portability analysis this table summarizes.

| # | Example | Ported/adapted from amplifier | Status |
| :-- | :-- | :-- | :-- |
| [00](00-convergence-loop.md) | Convergence loop (canonical skeleton) | adapted (deterministic gate) | executed, `status=success` |
| [01](01-simple-linear.md) | Simple linear | ported near-verbatim | executed, `status=success` |
| [02](02-plan-implement-test.md) | Plan / implement / test | adapted (deterministic gate) | executed, `status=success` |
| [03](03-conditional-routing.md) | Conditional routing | adapted (deterministic gate) | executed, `status=success` |
| [04](04-retry-with-fallback.md) | Retry with fallback | **substantially simplified** — see its own guide | executed, `status=success` |
| [05](05-parallel-fan-out.md) | Parallel fan-out | adapted (no fan-in node, our default join policy) | executed, `status=success` |

**Why "adapted," not "ported verbatim," for 00/02/03/05:** amplifier's own gates in
these examples run real `pytest`/real file checks that only converge when a real LLM
writes real files — that needs a `--live` run, which costs real API calls and is not
part of this automated set. Each adaptation replaces the illustrative task with a
self-contained deterministic gate (00/02/03) or drops an unregistered handler (05),
preserving the DOT structure and the routing pattern being taught. See each example's
own `.md` guide for exactly what changed and why.

**Not in this set — named, not silently dropped** (see `architecture.md`'s full table
for every excluded amplifier example and its specific reason):

- `examples/patterns/task-runner.dot` — uses `hexagon` (unregistered) and
  `model_stylesheet` (out of scope)
- `06-model-stylesheet.dot`, `07-fidelity-modes.dot` — out-of-scope feature / unresolved
  status, not merely an unregistered handler
- `08-human-gate.dot`, `09-manager-supervisor.dot`, `10-full-attractor.dot` — use
  `Handler.HUMAN`/`Handler.MANAGER_LOOP`/`Handler.FAN_IN`, all unregistered
- `12-graph-resume.dot` — depends on cross-restart resume, a PRD non-goal
- `examples/pipelines/practical/bug-fix.dot` — confirmed portable (only registered
  handlers) but not shipped this pass; a legitimate stretch item, not attempted

Re-verify this table before trusting it past this document's date — the moment a future
change registers a new handler (`Handler.HUMAN`, closing Stage 3, is the most likely
next one), some of the "not in this set" rows above may become portable.
