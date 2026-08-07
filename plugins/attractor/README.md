# attractor

DOT-graph convergence orchestration for Claude Code.

A pipeline is a Graphviz DOT digraph: nodes are computation, edges are
dispatch. The engine walks the graph, executing each node and choosing the
next edge deterministically. Routing is never decided by a model.

## Status

Engine core. Shell nodes and LLM nodes both execute for real. LLM nodes run
as `claude -p` subprocesses, using the operator's existing Claude Code login
-- no API key is needed. Pass `--stub` to run LLM nodes against a
deterministic stand-in instead, for tests and dry runs that must not spend
money.

## Usage

    node dist/attractor.js lint pipeline.dot
    node dist/attractor.js run pipeline.dot --param goal="ship it" --stub
    node dist/attractor.js run pipeline.dot --model haiku --max-budget-usd 1 \
      --allow-tools Bash,Write
    node dist/attractor.js doctor

A real (non-`--stub`) run is isolated in a dedicated git worktree **by
default** when `--cwd` is inside a git repository -- unattended work runs
with `bypassPermissions` and `Bash,Read,Write,Edit` by default, so it must
not execute in the operator's working copy. Pass `--in-place` to opt out and
run directly in `--cwd` instead: doing so means the unattended model has
shell and write access to the current directory, so only pass it if you mean
it. When `--cwd` is not a git repository, isolation is not possible and the
run proceeds in place with a prominent warning either way. `--stub` never
touches `--cwd` this way and needs neither flag.

`run` options:

| Flag | Meaning |
|---|---|
| `--param key=value` | Seed a context value. Repeatable. |
| `--cwd dir` | Working directory for shell commands. Default: current directory. |
| `--run-dir dir` | Where checkpoints, events and node artifacts are written. Default: `.attractor/runs/<timestamp>`. |
| `--stub` | Execute LLM nodes with the deterministic stub backend instead of the real `claude` backend. |
| `--model name` | Model to pass to the `claude` backend. |
| `--max-budget-usd n` | Budget cap to pass to the `claude` backend. Must be a positive number. |
| `--allow-tools t,t,...` | Comma-separated list of tools the `claude` backend may use. |
| `--worktree` | Explicit, now-redundant request for what a real run does by default: isolate in a dedicated git worktree. Refuses if `--cwd` is not inside a git repository. |
| `--in-place` | Opt out of the default isolation. An unattended model gets `bypassPermissions` and shell/write access (`Bash,Read,Write,Edit` by default) directly in `--cwd` -- only pass this if you mean it. |

`attractor doctor` checks that `claude`, `git` and `sh` are present and
working (all required), and reports on `bun` and `dot` (both optional,
needed by later milestones).

## Node shapes

| Shape | Meaning | Status |
|---|---|---|
| `Mdiamond` | start | works |
| `Msquare` | exit | works |
| `box` | LLM task (default when no shape is given) | works |
| `parallelogram` | shell command; routes on exit code and last stdout line | works |
| `diamond` | conditional routing point | works |
| `hexagon` | human gate | parsed; **refused by lint (`HAND-001`)** |
| `component` / `tripleoctagon` | parallel fan-out / fan-in | parsed; **refused by lint (`HAND-001`)** |
| `house` | manager loop | parsed; **refused by lint (`HAND-001`)** |

Shapes marked "refused by lint" are recognised by the parser but resolve to a
handler kind this build does not register (`Handler.HUMAN`, `Handler.PARALLEL`,
`Handler.FAN_IN`, `Handler.MANAGER_LOOP` -- `dot/graph.ts`'s
`UNREGISTERED_HANDLER_KINDS`). Dispatching one would abort the run partway
through with `no handler registered for <kind> (node <id>)`, after any earlier
nodes had already spent tokens or made changes -- so `HAND-001` catches it at
**lint time instead**, before a run ever starts:

    ERROR HAND-001 pipeline.dot:gate: node gate resolves to handler "human",
    which this build does not register (known unregistered: human, parallel,
    fan_in, manager_loop); the run would abort with "no handler registered"
    mid-pipeline. Refused here instead, before anything runs.

`HAND-001` is an error, so both `attractor lint` and `attractor run` refuse a
graph containing one of these shapes; `run` refuses it at the same lint gate
every error-severity finding goes through, not with a special case of its own.
Human gates and parallel execution are on their way in later milestones --
landing them means registering the corresponding handler in `defaultHandlers()`
and removing that kind from `UNREGISTERED_HANDLER_KINDS`, at which point the
shape moves out of this table.

## Dataflow: `outputs=` and `runs_on=`

Two custom node attributes. Both are extensions -- the spec defines neither,
and section 2's design goals sanction custom attributes explicitly.

### `outputs="key,key"` -- what a node promises to produce

    build [shape=parallelogram, tool_command="make", outputs="artifact.path,artifact.sha"]
    ship  [shape=parallelogram, tool_command="deploy ${artifact.path}"]
    build -> ship [condition="outcome=success"]

If `build` fails, the engine records `artifact.path` and `artifact.sha` as
**owed and never coming**. Any later node whose prompt or command substitutes
one of those keys is **not invoked**: it returns `FAIL` with

    required input 'artifact.path' unavailable: node 'build' failed

and, because fail-fast forbids an unconditional edge from carrying a failure,
the run halts there. The blocked node's own `outputs=` then enter the ledger
against itself, so the propagation is transitive. A key is settled by the
owing node re-executing to `SUCCESS`/`PARTIAL`, or by any node actually
writing it -- so a repair loop clears the record and carries on.

**A box (LLM) node infers no outputs. None.** A tool node infers none either.
`outputs=` is the *only* way a node joins the dataflow contract. For a box
node this is not an omission that could be improved: a model's
`contextUpdates` keys are arbitrary strings, and the engine-managed namespace
guard filters them before they reach context, so there is nothing honest to
infer. **Any LLM node whose output another node depends on needs an explicit
`outputs=`.**

    review [shape=box, prompt="review the diff", outputs="review.verdict"]

**The protection is fully opt-in, and this is the part most likely to be
misread.** Only `outputs=`-declared keys enter the ledger. A graph that
declares no `outputs=` anywhere gets none of this: a node fails, a vacuously
true guard (`condition="context.k!=bad"` is *true* when nothing writes `k` --
spec section 10.3) carries the failure onward, and the run reaches its exit
reporting the success the spec's section 11.3 says it is. Declaring outputs is
what turns that into a halt.

**It covers substituted text only, and no amount of opt-in changes that.**
The check scans what a handler actually expands -- a box node's `prompt` (or
`label`), a tool node's `tool_command`. A key referenced *only in an edge
condition* is invisible to it, so the shape above with the reference moved
into the guard walks to a green exit even with `outputs=` declared on the
producer. Closing that needs a different mechanism scanning `condition`
attributes with a different tokenizer; it is recorded as residual R6.

**A declared key must be one the node can own.** `outputs="tool.last_line"` or
`outputs="outcome"` names a key a handler or the engine writes, and declaring
it would arm a halt on a key somebody else produces -- re-arming the
stale-label contradiction one attribute at a time. `DATA-002` refuses that as
an **ERROR**.

Inferred keys are excluded **deliberately**, and the reason is doctrinal
rather than a tuning choice. The stale-label rule exists precisely so a
failing tool node's previous `tool.last_line` survives to be read:

    build  [shape=parallelogram, tool_command="exit 1"]
    notify [shape=parallelogram, tool_command="printf 'build said: ${tool.last_line}'"]
    build -> notify [condition="outcome=fail"]

`tool.last_line` is a key every tool node writes. Marking it owed on failure
made `notify` -- the node whose entire job is to report the failure --
unreachable, in a graph containing no `outputs=` at all. A ledger declaring
that key unavailable contradicts a non-tradeable doctrine entry head on. A key
nobody declared is not a debt anybody owes.

### `runs_on="always|success|failure"` -- when a node runs

Default `success`.

| Value | Behaviour |
|---|---|
| `success` | Ordinary. The input check above applies. |
| `failure` | Runs only when the run is holding a failure nothing has recovered. |
| `always` | Runs regardless. |

    work    [shape=box, prompt="do the work", outputs="resource.handle"]
    cleanup [shape=parallelogram, runs_on=always, tool_command="release ${resource.handle}"]
    work -> cleanup [condition="outcome=success"]
    work -> cleanup [condition="outcome=fail"]

Both routes into `cleanup` are explicit because `runs_on` decides only what
happens once a node is *reached*; fail-fast still governs how it is reached.

`runs_on` is **not** an "ignore my own failure" knob and never becomes one. A
`runs_on=always` node that exits non-zero still returns `FAIL`, is still
recorded, and still meets fail-fast at its next edge.

It is **not a substitution knob either**. A reference the ledger owes is left
*literal* on every node, exactly as an unknown key is, so `${artifact.dir}`
reaches `sh -c` as written and a POSIX shell rejects it loudly. It used to
resolve to the empty string on a `failure`/`always` node, which turned a
cleanup node's `rm -rf ${artifact.dir}/tmp` into `rm -rf /tmp` -- the same
hazard the shell-variable exemption exists to prevent, on exactly the class of
node where `rm -rf` lives. One rule now covers both.

`runs_on` is **ignored entirely on a `goal_gate` node**, in both directions: the
gate is never skipped (a gate skipped on a healthy run would record a `SUCCESS`
it produced no evidence for), and the eager input check stays armed on it (a
gate relieved of the check could earn its verdict against an input the engine
has recorded as unavailable -- the same unearned success one level down). The
gate runs and earns its verdict against real inputs. `RUNS-002` warns about the
combination, for `failure` and `always` alike.

### What the linter can and cannot see

`DATA-001` warns about a `${key}` reference no node declares. Its coverage is
narrower than the runtime check's in two ways worth knowing:

- **It sees only substituted text** -- a box node's `prompt` (or `label`), a
  tool node's `tool_command`. A key referenced *only* in an edge condition is
  invisible to it, which includes finding I1's own worked example
  (`condition="context.k!=bad"`). **The runtime input check has the identical
  blind spot**, by construction: both read `substitutableText`, deliberately,
  so the warning and the halt cannot disagree about what counts as a
  reference. Neither guard reaches a condition-only reference at any level of
  opt-in. Residual R6.
- **Undotted references are never flagged.** This is the *shell-variable*
  exemption, not merely a `--param` convenience: `substitute` deliberately
  leaves a bare `$NAME` literal so `$HOME` and `$WORKDIR` survive into
  `sh -c`, and flagging them would false-positive on the first `tool_command`
  that mentions one. Every dataflow key in this engine is dotted. A dotted
  `--param` name is the residual gap and will still warn.

`GATE-001` reports a failure route that can reach the exit without passing
through *any* goal gate, and treats the declared gates as one wall rather than
checking each individually; a `preferred_label` failure route is invisible to
it. Both under-report rather than over-report, which is the safe direction for
a warning -- but the first one **gets worse as a pipeline grows more gates**,
since a failure route is likelier to land on some gate and silence the rule.

Nothing verifies `outputs=` against what a handler actually *wrote*. A node
that declares a key and succeeds without producing it is not reported. That is
a real contract violation and a deliberate non-goal here; it is a second
mechanism and belongs in its own change.

`HITL-003` traces self-report risk through exactly one hop, to a node's direct
predecessor, and only recognises `Handler.CODERGEN` as a provable source --
not `Handler.TOOL`, whose output is written conditionally on exit code and so
cannot be proven at lint time (ADR-006). A multi-hop chain, or a `Handler.TOOL`
node feeding the gate, is invisible to it. A gate fed by two or more edges
from the same predecessor node (e.g. separate labelled success/failure
branches) still resolves correctly, but a gate fed by edges from two or more
*genuinely different* predecessor nodes -- a rework/retry loop, for instance,
where both an initial review node and a later revision node feed the same
gate -- still silently disqualifies the rule, since lint cannot know which
branch's output actually reached the gate at runtime (see ADR-006's residual
risk section). It is also invisible on a direct `new Engine(...)` embed
today: `Engine.run()` only checks `hasErrors()` (ERROR-only, per ADR-004), so
a WARNING-severity rule reaches an embedder's own output only if that
embedder reads `lint()`'s return value directly.

## Lint rules

`TOPO-001` one start; `TOPO-002` one exit; `TOPO-003` edge targets exist;
`TOPO-004` all nodes reachable; `TOPO-005` nothing enters start or leaves
exit; `TOPO-006` every non-exit node has an outgoing edge (a dead end skips
the exit branch and its goal-gate check entirely); `COND-001` malformed edge
condition; `TYPE-001` a `type` this engine does not resolve (it would fall
back to shape); `HITL-001` a human-gate `timeout` must declare `on_timeout`;
`HITL-002` `goal_gate` must be exactly `true` and sit on a `box` or
`parallelogram` node; `CMD-001` pipe-masked exit code; `CMD-002` always-true
sentinel; `RUNS-001` an unrecognised `runs_on` value (it would fall back to
`success`); `RUNS-002` a `goal_gate` node whose `runs_on` cannot be honoured;
`DATA-001` a `${key}` no node declares; `DATA-002` an `outputs=` naming an
engine-managed or handler-owned key; `GATE-001` a failure route that reaches
the exit without passing a goal gate; `HAND-001` a node resolves to a handler
kind this build does not register (`hexagon`, `component`, `tripleoctagon`,
`house` -- see [Node shapes](#node-shapes)); `HITL-003` an agent-inclusive
human gate whose exposed context traces to a single Handler.CODERGEN direct
predecessor (self-report risk for the `agent` channel -- see ADR-006);
`PAR-001` a `component`/`Handler.PARALLEL` node that fans out to two or more
branches with no discoverable convergence node; `PAR-002` a `component` node
whose fan-out is a single-edge no-op; `PAR-004` a node other than the chosen
convergence node and other than any branch root reachable, before it, from
two or more branches (including a branch root reachable from a sibling root,
or one that merely lost a depth tie for it), or reachable from a single
branch's own shortcut into the convergence node's own downstream territory.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003` and `PAR-002` are
warnings; the rest are errors, and `attractor run` refuses a graph with any
error.

## Development

    cd engine
    npm install
    npm test          # node --test, no build step
    npm run build     # bundles to ../dist/attractor.js

## Attribution

Implements the attractor nlspec from
[strongdm/attractor](https://github.com/strongdm/attractor) (Apache-2.0).
Doctrine and pipeline patterns derive from
[microsoft/amplifier-bundle-attractor](https://github.com/microsoft/amplifier-bundle-attractor)
(MIT, (c) Microsoft Corporation).

MIT (c) 2026 Diego Colombo.
