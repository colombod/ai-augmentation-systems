# 01 — Simple Linear

**Shape:** `start -> implement -> done`

The "hello world" of attractor pipelines: one worker node, no gate, no loop. Not every
pipeline needs a cycle — this is the deliberate one-pass shape
(`../reference/pipeline-design-principles.md` §0).

**Ported near-verbatim** from `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/01-simple-linear.dot` (fetched 2026-08-10). Only change: `${goal}`
is filled from `--param goal=...` at invocation, not a graph-level `goal=` attribute
(this engine does not read one — see `../reference/dot-reference.md`).

## Actually executed on this engine

```
$ node dist/attractor.js run 01-simple-linear.dot --run-dir <tmp> --stub --param goal="print hello world"
VERIFIED: status=success path=start,implement,done
```

Full transcript: [`01-simple-linear.events.jsonl`](01-simple-linear.events.jsonl).

## What this teaches

- Reference: `../reference/pipeline-design-principles.md` §0 — the "probably a recipe"
  heuristic for a graph with no cycle at all.
