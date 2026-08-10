# 05 — Parallel Fan-Out (adapted convergence)

**Shape:** `plan -> parallel_tests` (`component`) fans out to three branches, all
converging at `collect_results -> done`.

**Adapted from** `microsoft/amplifier-bundle-attractor`'s own
`examples/pipelines/05-parallel-fan-out.dot` (fetched 2026-08-10). The original's
`collect_results` node is `shape=tripleoctagon` (`Handler.FAN_IN`) — this build does not
register that handler (`HAND-001` refuses it). Adapted to an ordinary `box` node as the
convergence point instead: this engine's own default join policy already fails the
whole fan-out when every branch fails (Open Question 5's resolution, shipped with
FR-17b) — no separate fan-in node is needed for that property. Everything else (the
fan-out structure, `max_parallel`) is unchanged.

**Needs a git-repository `--cwd`** (branch worktree isolation is the default; see
`README.md`'s "Parallel fan-out" section).

## Actually executed on this engine

```
$ node dist/attractor.js run 05-parallel-fan-out.dot --cwd <git-repo> --run-dir <tmp> --stub --param goal="a calculator module"
VERIFIED: status=success path=start,plan,parallel_tests,collect_results,done
```

Full transcript: [`05-parallel-fan-out.events.jsonl`](05-parallel-fan-out.events.jsonl).
`verify-run.ts`'s own `--cwd` flag was added while producing this transcript — its
default `cwd` (the OS temp directory) is not a git repository, and the harness had no
way to point it at one until this example needed it (see
`../../.delivery/stories/p6-06-delegated-execution-verification.md`'s Implementation
notes for the fix, found by actually running this example, not by inspection).

## What this teaches

- Reference: `../reference/dot-reference.md` — fan-out with no separate fan-in node.
- Reference: `../../README.md`'s "Parallel fan-out" section — worktree isolation,
  `isolate="false"` opt-out, leftover branch pruning.
