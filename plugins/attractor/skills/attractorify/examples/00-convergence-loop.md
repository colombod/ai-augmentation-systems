# 00 — The Convergence Loop

**Shape:** `attempt -> evidence gate -> corrective back-edge -> done`

The canonical convergence-loop skeleton — this project's own canonical exemplar (see
`architecture.md`'s Example-portability policy). A worker node produces work; a
deterministic gate checks it mechanically; on failure, the gate routes back to the
worker for another attempt. The exit is structurally unreachable until the gate reports
success — no LLM self-report can fake it.

**Adapted from** `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/00-convergence-loop.dot` (fetched 2026-08-10). The original's gate
runs real `pytest` against files a real LLM is expected to have written; that only
converges under a `--live` run. This adaptation replaces the gate with a self-contained
deterministic counter so the example is honestly, provably convergent under `--stub` —
see the `.dot` file's own header comment.

## Actually executed on this engine

```
$ node dist/attractor.js run 00-convergence-loop.dot --run-dir <tmp> --stub
VERIFIED: status=success path=start,attempt,gate,attempt,gate,attempt,gate,done
```

The path shows the gate firing three times — `attempt`/`gate` visited three times before
`done` — proving the retry edge and the pass edge are both real, not just the happy
path. Full transcript: [`00-convergence-loop.events.jsonl`](00-convergence-loop.events.jsonl).

## What this teaches

- Reference: `../reference/pipeline-design-principles.md` §0 (the three-question test,
  why the gate must stay external to the worker).
- Reference: `../reference/routing-reference.md` (edge selection on
  `context.tool.last_line`).
