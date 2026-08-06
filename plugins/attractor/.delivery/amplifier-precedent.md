# Amplifier-bundle-attractor precedent for this project's blocked PRD decisions

> Research artifact, not a decision. Feeds Open Questions 1, 3-5, 7, 9 in `prd.md` — read
> alongside those, not instead of them. `microsoft/amplifier-bundle-attractor` is not a
> dependency of this project and this document does not recommend which option to pick; it
> lays out what a more mature implementation of the same discipline actually built, as prior
> art, per `AGENTS.md`'s own framing of amplifier as "the source of the doctrine."
>
> Method: fetched and read amplifier's actual source (not just its docs) via GitHub —
> `interviewer.py`, `handlers/human.py`, `handlers/parallel.py`, `handlers/fan_in.py`,
> `node_outputs.py`, `validation.py`, `engine.py`, `outcome.py`,
> `docs/designs/r12-node-failure-propagation.md`, `docs/ROUTING-REFERENCE.md`,
> `docs/APP-INTEGRATION-GUIDE.md`, the pipeline-runner CLI (`cli.py`), and several test files
> and worked examples. All citations are to `github.com/microsoft/amplifier-bundle-attractor`
> at `main`, 2026-08-05.

## 1. Answer-delivery channel for a human gate — informs FR-8 / Open Question 1

Amplifier's `Interviewer` is a `Protocol` (`interviewer.py:83-103`) with five shipped
implementations. The one wired into its actual CLI, `ConsoleInterviewer`
(`interviewer.py:170-229`), does exactly what our interpretation (a) does: `print()` to
stdout, then a **blocking, synchronous `sys.stdin.readline()`** in the same process, same
invocation. The runner's `--on-human-gate` flag (`cli.py:75-89`) has three values — `fail`
(default), `auto-approve`, `console` — and `console` fails loud at startup if stdin isn't
readable at all (`cli.py:117-141,236-245`). No separate answer-delivery command, no durable
park file, no polling/webhook path is shipped. `test_console_gate_integration.py:74-103`
confirms this by piping `"B\n"` into stdin and asserting the edge is taken.

`HumanGateHandler` prefers an `async_ask` method when the interviewer exposes it, "to avoid
the sync/async bridge deadlock" (`handlers/human.py:219-229`), and one docstring names a
hypothetical `InputRequestInterviewer` building a "rich three-zone A2UI schema"
(`handlers/human.py:438-439`). **This class does not exist anywhere in the repo** — only in
comments and one test's mock. It signals the protocol's shape permits an async,
externally-triggered answer source; amplifier ships none.

**Comparison:** amplifier's shipped mechanism is architecturally identical to our
interpretation (a) — attended-only, same process. Nothing shipped answers a "walks away,
comes back later" need; the `11-manager-child-dotfile-hitl` example's own README documents
interviewer-threading through nested pipelines as unreliable today, not just unbuilt for the
durable case.

## 2. Parallel fan-out — informs FR-17b / Open Questions 3, 4, 5

**Branch syntax:** no separate branch-listing attribute. A `shape=component` node triggers
`ParallelHandler`; **every outgoing DOT edge from that node is a branch** — purely structural
(`handlers/parallel.py:84`; confirmed by `examples/pipelines/05-parallel-fan-out.dot:27-35,69-72`
and `docs/ROUTING-REFERENCE.md:37-38`: "never from plain multi-edge conditions"). Execution
*policy* is attribute-driven: `max_parallel`, `join_policy`, `error_policy`, `min_success`,
`quorum_fraction` (`handlers/parallel.py:9-14`).

**Concurrency default:** `max_parallel = int(node.attrs.get("max_parallel", 4))` — **default
is 4**, real running code (`handlers/parallel.py:10,94`), directly usable evidence against our
own NFR-7's "do not invent a number" instruction — amplifier's choice, not proof of
correctness for us.

**Worktree isolation:** amplifier isolates branches at the context/backend-session level only
— `context.clone()` per branch plus a cloned engine/handler registry for isolated session
bookkeeping (`handlers/parallel.py:137,150-176`; `test_parallel_branch_nested_isolation.py`).
No mention of worktree or filesystem isolation anywhere in `ROUTING-REFERENCE.md`,
`dot-reference.md`, or `PIPELINE_DESIGN_PRINCIPLES.md`. **Branches share one
filesystem/cwd by default; no git-worktree-per-branch mechanism or opt-in exists.** A direct,
negative answer to Open Question 4's worktree half.

**Fan-in-on-all-fail — two different mechanisms, genuinely inconsistent with each other:**
- `ParallelHandler`'s own join policy (`_apply_join_policy`, `handlers/parallel.py:443-455`),
  default `wait_all`: `if fail_count == 0: SUCCESS else: PARTIAL_SUCCESS` — **never checks
  whether `success_count` is zero.** All branches failing still returns `PARTIAL_SUCCESS`.
- The separate, optional `FanInHandler` node (`shape=tripleoctagon`, `handlers/fan_in.py`)
  heuristically ranks all results and, if the best-ranked candidate is itself `fail`,
  **returns `FAIL`** with a named reason (`_heuristic_select`, lines 130-173).

Which one a graph gets depends entirely on whether the author wires a `tripleoctagon` fan-in
node downstream. The canonical worked example does. Bare reliance on the component's own
verdict does not produce FAIL on total failure — a fail-open shape worth naming for Open
Question 5's discussion.

## 3. `outputs=`/silent-success handling — informs FR-9a/FR-9b / Open Question 9

A directly analogous mechanism exists, but it is **runtime-only** — `validation.py` has zero
hits for `outputs`, confirming no lint-time rule. Design "R12"
(`docs/designs/r12-node-failure-propagation.md`): an `outputs="key1,key2"` attribute unioned
with a small inference table (`node_outputs.py:43-59`); an eager reference scan before every
node compares its `${key}` tokens against an engine-owned `failed_outputs` map
(`engine.py:141-144`); a node referencing a failed predecessor's declared key is marked
**SKIPPED without its handler running**, and SKIPPED routes like FAIL rather than silently
proceeding (`r12-node-failure-propagation.md:58-77`).

This does **not** touch the run's overall verdict — `_check_goal_gates()` remains the sole
arbiter (`engine.py:1174+`), the same §11.3 philosophy our own engine follows. What R12
changes is upstream: it makes reaching a clean exit while carrying a failed node's phantom
output structurally harder, typically halting the linear path instead. No field resembling
our `RunResult.unresolvedFailures` exists in amplifier — that specific post-hoc reporting is
our own extension.

**Load-bearing divergence worth naming directly:** our own doctrine explicitly *rejected*
SKIPPED-propagation ("SKIPPED propagation was rejected, not deferred... FAIL is used
instead," `plugins/attractor/AGENTS.md`). Amplifier's entire R12 mechanism is built on
SKIPPED. This is not a naming difference — the two projects chose opposite designs for the
same problem, and Open Question 9 should be read with that in mind, not as "amplifier already
answered this for us."

## 4. WARNING-severity diagnostic visibility for an embedder — informs FR-12 / Open Question 7

Amplifier's engine is a plain embeddable Python library
(`docs/APP-INTEGRATION-GUIDE.md`, "Path A: DirectProviderBackend", calling
`validation.validate_or_raise` directly). `Diagnostic` (`validation.py:49-61`) carries
`severity: "ERROR" | "WARNING" | "INFO"`, returned as a plain list by `validate()`, `lint()`,
and `validate_or_raise()` (`validation.py:73-154`). `validate_or_raise` **returns the
non-error diagnostics — including WARNINGs — as its return value on success**, raising only
on ERROR. No gating, no verbose flag, no privileged path: any embedder calling these functions
gets the full severity-tagged list, same as the CLI's own `lint` subcommand
(`cli.py:372-443`), which is a thin consumer of the same function.

**Comparison:** materially different starting point from ours — our `Engine` currently writes
nothing to stdout/stderr, and FR-12 is scoped as "a new capability, not a bug fix." Amplifier
never had this gap: diagnostic severity was library-native and embedder-visible from day one,
because `validate`/`lint` are ordinary data-returning functions, not something the CLI alone
consumes.

**Not addressed by amplifier:** any event-stream (mid-run) diagnostic push to an embedder —
visibility is a pre-run `validate()`/`lint()` call the embedder chooses to make, not a hook
into a running pipeline.
