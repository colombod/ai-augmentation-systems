# ADR-011 fixture results (story `attractor-handoff-01`, Spike 5)

Executed 2026-10-24 as a spike whose job was to observe, not confirm. Every block
below is real captured output from the commands shown above it; nothing is
paraphrased. Where the observation differs from what the story quoted, that is
recorded as a finding, not adjusted.

## Environment

- Repo: `ai-augmentation-systems`, worktree branch `worktree-agent-a7e9ca32d622ea9c9`,
  base commit `df0c0a5b0dba1449b6cdfef421bfe1ebc4d658c0`.
- Host: `Linux vm 6.18.44-fc-v153 x86_64`; `node v22.22.0`.
- `plugins/attractor/dist/attractor.js` used unmodified. Nothing under
  `plugins/attractor` was changed.
- Per-scenario working directories were fresh, empty directories created under the
  session scratchpad (`$SP` below =
  `/tmp/claude-0/-home-user-ai-augmentation-systems/b13c0d76-34ea-545a-8a78-69a20423da0c/scratchpad`)
  rather than `/tmp` via `mktemp -d`; each was confirmed empty (0 entries) before its
  run, so the `.attractor-demo` counter state started absent in every scenario, which is
  what the story's fresh-`mktemp -d` instruction is for.

```
$ node plugins/attractor/dist/attractor.js doctor
attractor doctor
  ok       claude: 2.1.310 (Claude Code)
  ok       git: git version 2.43.0
  ok       sh: ok
  ok       bun (optional): 1.4.4
  absent   dot (optional): not found
exit=0
```

**Divergence from the story's quoted doctor output (environment only, not a finding
against ADR-011):** different `claude`/`git` versions, Linux git rather than Apple Git,
`bun` present, `dot` absent. Doctor passes, which is the story's only entry criterion.
Node is v22, below `plugins/attractor/AGENTS.md`'s "Node >= 24" (which governs running
the engine's TypeScript sources and tests); the bundled `dist/attractor.js` ran without
error on v22.

## Fixture

`plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-fix-gate-bounded.dot`
-- extracted byte-for-byte from the story's single ```` ```dot ```` block (by `awk`
between the fences, not retyped).

## Lint

```
$ node plugins/attractor/dist/attractor.js lint plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-fix-gate-bounded.dot
plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-fix-gate-bounded.dot: no errors
exit=0
```

No warnings printed.

## Scenarios A, B, C

Command shape (one fresh cwd per scenario; `FIXTURE` as above):

```
node plugins/attractor/dist/attractor.js run "$FIXTURE" --cwd "$D" --stub --run-dir "$D/run" --param pass_at=<P> --param bound=3
grep -c '"type":"node.start"' "$D/run/events.jsonl"
grep '"type":"node.start"' "$D/run/events.jsonl" | grep -c '"s3_c2__gate"'
cat "$D/.attractor-demo/count-s3c2"; cat "$D/.attractor-demo/outcomes.log"
```

### Scenario A -- pass-first-attempt (`pass_at=1 bound=3`), `D=$SP/scA.tI9w`

```
status: success
path:   start -> s3_c2__fix -> s3_c2__gate -> done
run:    $SP/scA.tI9w/run
exit=0
node.start total: 4
gate node.start: 1
"node":"start" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"done"
counter: 1
outcomes.log:
cat: $SP/scA.tI9w/.attractor-demo/outcomes.log: No such file or directory
```

### Scenario B -- fail-then-pass (`pass_at=2 bound=3`), `D=$SP/scB.PMBJ`

```
status: success
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> done
run:    $SP/scB.PMBJ/run
exit=0
node.start total: 6
gate node.start: 2
"node":"start" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"done"
counter: 2
outcomes.log:
cat: $SP/scB.PMBJ/.attractor-demo/outcomes.log: No such file or directory
```

### Scenario C -- fail-through-bound (`pass_at=99 bound=3`), `D=$SP/scC.PG5j`

```
status: success
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> non_convergent -> done
run:    $SP/scC.PG5j/run
exit=0
node.start total: 9
gate node.start: 3
"node":"start" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"s3_c2__fix" "node":"s3_c2__gate" "node":"non_convergent" "node":"done"
counter: 3
outcomes.log:
FR-9 s3_c2 Outcome=non-convergent
```

Scenario C `events.jsonl`, event-type histogram and the routing events:

```
$ grep -o '"type":"[^"]*"' $SP/scC.PG5j/run/events.jsonl | sort | uniq -c
      8 "type":"edge.taken"
      3 "type":"node.box.end"
      3 "type":"node.box.start"
      9 "type":"node.end"
      9 "type":"node.start"
      4 "type":"node.tool.end"
      4 "type":"node.tool.start"
      1 "type":"pipeline.end"
      1 "type":"pipeline.start"

$ grep -E '"node.end"|"edge.taken"|"pipeline.end"' $SP/scC.PG5j/run/events.jsonl
{"ts":"2026-10-24T09:27:34.579Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:27:34.581Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:27:34.582Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:27:34.584Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:27:34.594Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:27:34.596Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:27:34.597Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:27:34.598Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:27:34.607Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:27:34.608Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:27:34.610Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:27:34.611Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:27:34.619Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:27:34.620Z","type":"edge.taken","node":"s3_c2__gate","to":"non_convergent"}
{"ts":"2026-10-24T09:27:34.625Z","type":"node.end","node":"non_convergent","status":"success"}
{"ts":"2026-10-24T09:27:34.627Z","type":"edge.taken","node":"non_convergent","to":"done"}
{"ts":"2026-10-24T09:27:34.627Z","type":"node.end","node":"done","status":"success"}
{"ts":"2026-10-24T09:27:34.628Z","type":"pipeline.end","node":"done","status":"success"}
```

Observation beyond the story: the third gate visit, which printed `gate_giveup`, is
recorded `node.end ... "status":"success"`. The goal gate is therefore *satisfied* in the
engine's ledger on a give-up, which is the mechanism behind the story's "status: success
in all three scenarios" gotcha: spec section 11.3 decides the run status by goal gates
alone, and this gate reached SUCCESS. Confirmed, not merely restated. A give-up is
distinguishable only by `path:` (contains `non_convergent`) and `outcomes.log`.

## Negative case -- rejected `condition=` counter

`$SP/rejected-condition-counter.dot` (content verbatim from the story):

```
digraph rejected {
    start [shape=Mdiamond]
    gate [shape=parallelogram, goal_gate=true, tool_command="printf ok"]
    done [shape=Msquare]
    start -> gate
    gate -> done [condition="context.attempt_count<3"]
}
```

```
$ node plugins/attractor/dist/attractor.js lint $SP/rejected-condition-counter.dot
ERROR COND-001 $SP/rejected-condition-counter.dot:gate: edge gate -> done has a malformed condition="context.attempt_count<3"; each &&-joined clause must be either "key=value", "key!=value", or a bare identifier (letters, digits, "_" or "." only, e.g. "context.ready") for a truthiness check -- anything else (a hyphen, a space, stray punctuation) is a typo that would otherwise resolve to an empty, always-false comparison instead of failing loudly
exit=1
```

## Additional probe -- a hang inside the compiled check (notes.md cross-story finding 1)

Not part of this story's acceptance criteria (the story puts the hanging fixture in
Spike 2's scope); run here because notes.md flags it as the open risk against ADR-011.

Two probe fixtures, committed beside the main one:

- `spikes/adr-011-hang-variant.dot` -- the ADR-011 fixture with the gate given
  `timeout="2s"` (README: "the in-flight ... shell command is aborted and the node's
  outcome becomes `FAIL` once the timeout fires") and a stand-in compiled check placed
  **before** the counter/label logic: it keeps its own invocation counter
  (`.attractor-demo/check-n`) and runs `sleep 30` when that invocation number is in
  `[${hang_from}, ${hang_to}]`. The ADR-011 counter (`count-s3c2`) is only reached if
  the check returns. Lints clean (`no errors`, exit 0).
- `spikes/adr-011-hang-variant-retry-target.dot` -- identical plus
  `retry_target="s3_c2__fix"` on the gate, to observe the README's node-level
  "on an ordinary `FAIL` ... consults the same two attributes".

All runs use `pass_at=99 bound=3` (the give-up case), so the expected bounded path is
exactly 3 gate visits. Runner: `$SP/runh.sh NAME FIXTURE hang_from hang_to`, which
creates a fresh empty `$SP/scNAME`, runs, and prints counts. Full output follows.

### H1 -- first check hangs, no `retry_target` (`hang_from=1 hang_to=1`)

```
$ node plugins/attractor/dist/attractor.js run plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-hang-variant.dot --cwd $SP/scH1 --stub --run-dir $SP/scH1/run --param pass_at=99 --param bound=3 --param hang_from=1 --param hang_to=1
WARNING: the pipeline reached its exit with unresolved node failures: s3_c2__gate. Per spec section 11.3 the run status is decided by goal gates alone, so this run reports fail, but the work of that node did not succeed and nothing re-ran it.
status: fail
path:   start -> s3_c2__fix -> s3_c2__gate
notes:  no matching edge from s3_c2__gate after failure: exit 1: 
run:    $SP/scH1/run
exit=1  wall=3s
node.start total: 3
node.start s3_c2__gate: 1
node.end s3_c2__gate fail: 1
node.fail.retry_target events: 0
check-n=1 count-s3c2=absent
outcomes.log: absent
--- events (node.end / edge.taken / retry_target / pipeline.*), first 40:
{"ts":"2026-10-24T09:30:24.032Z","type":"pipeline.start","node":"start"}
{"ts":"2026-10-24T09:30:24.033Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:30:24.035Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:24.036Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:24.038Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:26.053Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:26.057Z","type":"pipeline.end","node":"s3_c2__gate","status":"fail"}
--- last 4 events:
{"ts":"2026-10-24T09:30:24.039Z","type":"node.tool.start","node":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:26.052Z","type":"node.tool.end","node":"s3_c2__gate","exitCode":1}
{"ts":"2026-10-24T09:30:26.053Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:26.057Z","type":"pipeline.end","node":"s3_c2__gate","status":"fail"}

$ cat $SP/scH1/run/s3_c2__gate/status.json
{
  "outcome": "fail",
  "notes": "exit 1: ",
  "failure_reason": "exit 1: "
}
```

**Dead-end.** Run halts at the gate, `status: fail`, exit 1. Loud, not silent -- but no
`non_convergent` record, the ADR-011 counter is never written (the attempt is not
consumed), and the CLI's warning says "reached its exit" although the run did not (a
known, recorded wording residual, `cli.ts:396-401`).

### H2 -- second check hangs, no `retry_target` (`hang_from=2 hang_to=2`)

```
$ node plugins/attractor/dist/attractor.js run plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-hang-variant.dot --cwd $SP/scH2 --stub --run-dir $SP/scH2/run --param pass_at=99 --param bound=3 --param hang_from=2 --param hang_to=2
status: success
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> non_convergent -> done
run:    $SP/scH2/run
exit=0  wall=2s
node.start total: 11
node.start s3_c2__gate: 4
node.end s3_c2__gate fail: 1
node.fail.retry_target events: 0
check-n=4 count-s3c2=3
outcomes.log: FR-9 s3_c2 Outcome=non-convergent
--- events (node.end / edge.taken / retry_target / pipeline.*), first 40:
{"ts":"2026-10-24T09:30:26.183Z","type":"pipeline.start","node":"start"}
{"ts":"2026-10-24T09:30:26.184Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:30:26.187Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:26.188Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:26.189Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:26.201Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:26.203Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:26.204Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:26.206Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:28.211Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:28.212Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:28.214Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:28.215Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:28.226Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:28.227Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:28.227Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:28.228Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:28.244Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:28.245Z","type":"edge.taken","node":"s3_c2__gate","to":"non_convergent"}
{"ts":"2026-10-24T09:30:28.250Z","type":"node.end","node":"non_convergent","status":"success"}
{"ts":"2026-10-24T09:30:28.253Z","type":"edge.taken","node":"non_convergent","to":"done"}
{"ts":"2026-10-24T09:30:28.254Z","type":"node.end","node":"done","status":"success"}
{"ts":"2026-10-24T09:30:28.255Z","type":"pipeline.end","node":"done","status":"success"}
--- last 4 events:
{"ts":"2026-10-24T09:30:28.253Z","type":"edge.taken","node":"non_convergent","to":"done"}
{"ts":"2026-10-24T09:30:28.253Z","type":"node.start","node":"done"}
{"ts":"2026-10-24T09:30:28.254Z","type":"node.end","node":"done","status":"success"}
{"ts":"2026-10-24T09:30:28.255Z","type":"pipeline.end","node":"done","status":"success"}
```

**Something else: the FAILed gate is silently routed as a retry.** The hung second
visit ends `status":"fail"` and is immediately followed by
`edge.taken s3_c2__gate -> s3_c2__fix` -- the `retry` edge, matched by the previous
visit's stale `tool.last_line=gate_retry`. The hung attempt did not consume an attempt
(`count-s3c2=3` after 4 gate visits), so the declared bound of 3 became 4 gate visits.
No warning is printed: the later successful re-execution of the same node clears the
unresolved-failure record, so the run reads as an ordinary give-up.

### H3 -- every check from the second onward hangs, no `retry_target` (`hang_from=2 hang_to=999`)

```
$ node plugins/attractor/dist/attractor.js run plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-hang-variant.dot --cwd $SP/scH3 --stub --run-dir $SP/scH3/run --param pass_at=99 --param bound=3 --param hang_from=2 --param hang_to=999
WARNING: the pipeline reached its exit with unresolved node failures: s3_c2__gate. Per spec section 11.3 the run status is decided by goal gates alone, so this run reports fail, but the work of that node did not succeed and nothing re-ran it.
status: fail
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix
notes:  step cap of 500 reached without terminating
run:    $SP/scH3/run
exit=1  wall=500s
node.start total: 500
node.start s3_c2__gate: 249
node.end s3_c2__gate fail: 248
node.fail.retry_target events: 0
check-n=249 count-s3c2=1
outcomes.log: absent
--- events (node.end / edge.taken / retry_target / pipeline.*), first 40:
{"ts":"2026-10-24T09:30:23.893Z","type":"pipeline.start","node":"start"}
{"ts":"2026-10-24T09:30:23.894Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:30:23.897Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:23.898Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:23.900Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:23.912Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:23.914Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:23.915Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:23.916Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:25.920Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:25.922Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:25.923Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:25.925Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:27.932Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:27.934Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:27.935Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:27.936Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:29.943Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:29.945Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:29.946Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:29.947Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:31.956Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:31.958Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:31.959Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:31.960Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:33.968Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:33.970Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:33.971Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:33.973Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:35.982Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:35.983Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:35.985Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:35.986Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:38.049Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:38.052Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:38.054Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:38.056Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:40.063Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:40.064Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:40.065Z","type":"node.end","node":"s3_c2__fix","status":"success"}
--- last 4 events:
{"ts":"2026-10-24T09:38:43.107Z","type":"node.box.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:38:43.107Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:38:43.108Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:38:43.108Z","type":"pipeline.end","node":"s3_c2__gate","status":"fail"}
```

**Unbounded loop until the run-wide step cap.** Visit 1 printed `gate_retry`; every
later visit hung, FAILed, and was routed back to `s3_c2__fix` by that stale label. 249
gate visits against a declared bound of 3, `count-s3c2=1` throughout, ~500 s of wall time
(249 x the 2 s timeout), ended only by `step cap of 500 reached without terminating`,
`status: fail`, exit 1. No `non_convergent` record. With a real `timeout="5m"` this
would be roughly 20 hours of unattended looping, which is exactly what `FR-8` forbids.

### H4 -- first check hangs, gate declares `retry_target="s3_c2__fix"` (`hang_from=1 hang_to=1`)

```
$ node plugins/attractor/dist/attractor.js run plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-hang-variant-retry-target.dot --cwd $SP/scH4 --stub --run-dir $SP/scH4/run --param pass_at=99 --param bound=3 --param hang_from=1 --param hang_to=1
status: success
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> non_convergent -> done
run:    $SP/scH4/run
exit=0  wall=2s
node.start total: 11
node.start s3_c2__gate: 4
node.end s3_c2__gate fail: 1
node.fail.retry_target events: 1
check-n=4 count-s3c2=3
outcomes.log: FR-9 s3_c2 Outcome=non-convergent
--- events (node.end / edge.taken / retry_target / pipeline.*), first 40:
{"ts":"2026-10-24T09:30:28.378Z","type":"pipeline.start","node":"start"}
{"ts":"2026-10-24T09:30:28.379Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:30:28.381Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:28.382Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:28.383Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:30.392Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:30.394Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:30.394Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:30.395Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:30.406Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:30.407Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:30.409Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:30.410Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:30.421Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:30.422Z","type":"edge.taken","node":"s3_c2__gate","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:30.423Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:30.424Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:30.435Z","type":"node.end","node":"s3_c2__gate","status":"success"}
{"ts":"2026-10-24T09:30:30.437Z","type":"edge.taken","node":"s3_c2__gate","to":"non_convergent"}
{"ts":"2026-10-24T09:30:30.444Z","type":"node.end","node":"non_convergent","status":"success"}
{"ts":"2026-10-24T09:30:30.446Z","type":"edge.taken","node":"non_convergent","to":"done"}
{"ts":"2026-10-24T09:30:30.446Z","type":"node.end","node":"done","status":"success"}
{"ts":"2026-10-24T09:30:30.447Z","type":"pipeline.end","node":"done","status":"success"}
--- last 4 events:
{"ts":"2026-10-24T09:30:30.446Z","type":"edge.taken","node":"non_convergent","to":"done"}
{"ts":"2026-10-24T09:30:30.446Z","type":"node.start","node":"done"}
{"ts":"2026-10-24T09:30:30.446Z","type":"node.end","node":"done","status":"success"}
{"ts":"2026-10-24T09:30:30.447Z","type":"pipeline.end","node":"done","status":"success"}
```

**Falls through to `retry_target`** (`node.fail.retry_target` event), but again the
hung attempt is not counted: 4 gate visits for a bound of 3.

### H5 -- every check hangs, gate declares `retry_target="s3_c2__fix"` (`hang_from=1 hang_to=999`)

```
$ node plugins/attractor/dist/attractor.js run plugins/delivery/.delivery/initiatives/attractor-handoff/spikes/adr-011-hang-variant-retry-target.dot --cwd $SP/scH5 --stub --run-dir $SP/scH5/run --param pass_at=99 --param bound=3 --param hang_from=1 --param hang_to=999
WARNING: the pipeline reached its exit with unresolved node failures: s3_c2__gate. Per spec section 11.3 the run status is decided by goal gates alone, so this run reports fail, but the work of that node did not succeed and nothing re-ran it.
status: fail
path:   start -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix -> s3_c2__gate -> s3_c2__fix
notes:  step cap of 500 reached without terminating
run:    $SP/scH5/run
exit=1  wall=502s
node.start total: 500
node.start s3_c2__gate: 249
node.end s3_c2__gate fail: 249
node.fail.retry_target events: 249
check-n=249 count-s3c2=absent
outcomes.log: absent
--- events (node.end / edge.taken / retry_target / pipeline.*), first 40:
{"ts":"2026-10-24T09:30:23.940Z","type":"pipeline.start","node":"start"}
{"ts":"2026-10-24T09:30:23.941Z","type":"node.end","node":"start","status":"success"}
{"ts":"2026-10-24T09:30:23.945Z","type":"edge.taken","node":"start","to":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:23.946Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:23.947Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:25.960Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:25.964Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:25.966Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:25.969Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:27.979Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:27.981Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:27.982Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:27.983Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:29.990Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:29.992Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:29.994Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:29.995Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:32.002Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:32.003Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:32.005Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:32.009Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:34.017Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:34.018Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:34.020Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:34.021Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:36.028Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:36.029Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:36.030Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:36.031Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:38.049Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:38.055Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:38.056Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:38.074Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:40.081Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:40.082Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:40.083Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:30:40.084Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:30:42.092Z","type":"node.end","node":"s3_c2__gate","status":"fail"}
{"ts":"2026-10-24T09:30:42.093Z","type":"node.fail.retry_target","node":"s3_c2__gate","target":"s3_c2__fix"}
{"ts":"2026-10-24T09:30:42.094Z","type":"node.end","node":"s3_c2__fix","status":"success"}
--- last 4 events:
{"ts":"2026-10-24T09:38:45.118Z","type":"node.box.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:38:45.118Z","type":"node.end","node":"s3_c2__fix","status":"success"}
{"ts":"2026-10-24T09:38:45.119Z","type":"edge.taken","node":"s3_c2__fix","to":"s3_c2__gate"}
{"ts":"2026-10-24T09:38:45.119Z","type":"pipeline.end","node":"s3_c2__gate","status":"fail"}
```

**Unbounded loop via `retry_target` until the step cap.** 249 `node.fail.retry_target`
events, 249 failed gate visits, `count-s3c2` never created, ended by the step cap,
`status: fail`, exit 1. Declaring `retry_target=` converts H1's dead-end into the same
unbounded loop as H3.

### Engine source that explains the behaviour

`plugins/attractor/engine/src/core/shell.ts` -- a timeout is a SIGKILL of the process
group, and a signal-killed child is reported as plain exit code 1:

```
39	    if (timeoutMs > 0) {
40	      timer = setTimeout(() => killTree('SIGKILL'), timeoutMs)
41	    }
...
48	    child.on('close', (code) => {
49	      if (timer) clearTimeout(timer)
50	      resolve({ code: code ?? 1, stdout, stderr })
51	    })
```

So a timeout is indistinguishable from `exit 1` in `failure_reason` (`"exit 1: "`) and
in `node.tool.end` (`"exitCode":1`); nothing in the run record says "timeout".

`plugins/attractor/engine/src/handlers/tool.ts` -- a non-zero exit returns FAIL and does
**not** refresh `tool.last_line` (the stale-label rule), so the previous visit's routing
word survives:

```
101	    if (result.code !== 0) {
102	      const reason = `exit ${result.code}: ${lastNonEmptyLine(result.stderr) || lastNonEmptyLine(result.stdout)}`
103	      // No `contextUpdates` here, and that is the stale-label rule on disk as
104	      // well as in memory: a failed tool node claims to have produced nothing.
105	      const outcome: Outcome = { status: Status.FAIL, notes: reason, failureReason: reason }
```

`plugins/attractor/engine/src/core/edge-select.ts` -- a matching condition wins before
the fail-fast check, so a stale `gate_retry` routes a FAIL; only when nothing matches
does fail-fast refuse the unconditional path:

```
84	  // Step 1: conditional edges whose condition matches. RETURN immediately.
85	  const matched = edges.filter(
86	    (e) => isConditional(e) && evaluateCondition(e.attrs.condition as string, ctx, outcome),
87	  )
88	  if (matched.length > 0) return matched.sort(byWeightThenTarget)[0]
89	
90	  if (outcome.status === Status.FAIL) {
91	    // Fail-fast: with no condition explicitly matching the failure, no
92	    // unconditional edge may carry it forward.
93	    return null
94	  }
```

`plugins/attractor/engine/src/core/condition.ts` -- an unset key resolves to the empty
string, so on a first-visit hang no `tool.last_line=gate_*` condition can match:

```
47	  if (key.startsWith('context.')) {
48	    return ctx.get(key) ?? ctx.get(key.slice('context.'.length)) ?? ''
```

`plugins/attractor/engine/src/core/engine.ts` -- with no edge, a FAIL consults only the
node-level `retry_target`/`fallback_retry_target`, else dead-ends:

```
905	    const edge = selectEdge(graph, node.id, context, outcome)
906	
907	    if (!edge && outcome.status === Status.FAIL) {
908	      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
909	      if (target) {
910	        this.events.append({ type: 'node.fail.retry_target', node: node.id, target })
911	        return { kind: 'continue', nextId: target }
912	      }
913	    }
914	
915	    if (!edge) {
916	      const notes =
917	        outcome.status === Status.FAIL
918	          ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ''}`
```

and the only remaining backstop for a loop that never increments the counter is the
run-wide step cap (`engine.ts:142` `const DEFAULT_MAX_STEPS = 500`, enforced at
`engine.ts:735`).

In every case the ADR-011 counter lives after the check inside the same `sh -c`, and the
whole process group is killed, so the counter increment never runs for a hung attempt.

## Observed vs predicted

| Check | Story predicted | Observed | Verdict |
| :-- | :-- | :-- | :-- |
| Entry: `doctor` passes | passes (macOS versions quoted) | passes; different versions, `bun` present, `dot` absent | pass (environment differs, recorded) |
| `NFR-1` lint | `no errors`, exit 0, no warnings | `no errors`, exit 0, no warnings | **pass** |
| `NFR-1` Scenario A | path `start -> s3_c2__fix -> s3_c2__gate -> done`; 4 `node.start` | identical path; 4 `node.start`; counter 1 | **pass** |
| `ADR-011`/`FR-8` Scenario B | 2 cycles then `-> done`; 6 `node.start` | identical path; 6 `node.start`; counter 2 | **pass** |
| `FR-8` Scenario C | 3 cycles, `-> non_convergent -> done`; 9 `node.start`, 3 gate | identical path; 9 `node.start`, 3 gate; counter 3 | **pass** |
| `FR-9` outcomes.log | literal `FR-9 s3_c2 Outcome=non-convergent` | identical line; `status: success` as warned | **pass** |
| `ADR-011` sign-off: COND-001 | `ERROR COND-001`, non-zero exit | `ERROR COND-001`, exit 1; message text matches | **pass** |
| Results traceable | real output in this file | this file | **pass** |
| Hang probe (not a story criterion) | notes.md: dead-end or fall-through, unknown | dead-end on a first-visit hang; silent stale-label retry on a later-visit hang; `retry_target` fall-through when declared; hung attempts never counted; a persistent hang loops to the 500-step cap with or without `retry_target` (H3, H5) | **diverged** from ADR-011's bound guarantee |

## Does ADR-011 need amending?

**Yes.** The fixture proves the mechanism exactly as specified for a check that always
returns. It does not hold `FR-8`'s "halts exactly at the declared bound" or `NFR-2`'s
"a timeout counts as one consumed attempt" once the compiled check can hang or exit
non-zero before the routing `printf`:

1. **The counter is placed after the check.** ADR-011's template is
   `<compiled check>; c=$(( ... + 1 )); ...`. A timeout kills the whole `sh -c` process
   group, so a hung attempt never increments the counter. Every observed hang variant
   ran more gate visits than the bound (H2, H4: 4 for a bound of 3; H3, H5: 249, stopped only by the step cap).
2. **Routing on `tool.last_line` alone makes a FAIL look like a retry.** By the
   stale-label rule (doctrine, not a bug) a failed gate keeps the previous visit's
   `gate_retry`, and a matching condition wins before fail-fast (`edge-select.ts:84-94`).
   H2's failed gate took the `retry` edge with no warning.
3. **A first-visit hang dead-ends the run as `status: fail`** (H1): loud, but it produces
   neither `non-convergent` nor a counted attempt, so `FR-9`'s outcome vocabulary has no
   value assigned to it.
4. **A timeout is not identifiable as a timeout** in any run artifact (`shell.ts:50`).
5. **A give-up satisfies the goal gate.** Scenario C's `gate_giveup` visit is a SUCCESS
   in the engine's ledger, so the run status is `success`. The story records this as a
   gotcha; ADR-011's Consequences section does not mention it, and it should, because
   any consumer reading the run status alone will read a non-convergent run as done.

Candidate directions for the Solution Architect, **not verified in this spike**:
increment the counter *before* running the check; scope the three edges to
`outcome=success` (for example `condition="outcome=success && context.tool.last_line=gate_retry"`)
and add an explicit `outcome=fail` edge so a failed check routes on purpose; or wrap the
compiled check in a shell-level time limit so the gate itself always reaches its routing
`printf`. Each needs its own `--stub` run before ADR-011 cites it. This probe overlaps
`attractor-handoff-03` (Spike 2) and should be read alongside it.
