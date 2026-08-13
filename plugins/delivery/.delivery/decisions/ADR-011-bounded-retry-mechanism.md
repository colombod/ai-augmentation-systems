# ADR-011: Bounded gate/fix retry enforced by the gate's own shell arithmetic and three-way string routing

**Status:** accepted
**Date:** 2026-08-13
**Deciders:** Solution Architect

## Context

`FR-8`/`FR-9` require every acceptance gate to have a declared, artifact-visible attempt bound that halts exactly there with an honest `non-convergent` outcome — never an unattended infinite loop, never a silent pass.

Three mechanisms were considered and rejected in sequence (see Alternatives), each for a directly-verified reason, not by inference — including empirically running the rejected `condition=` mechanism through `attractor lint` and reading `max_retries=`'s real semantics after `github.com/colombod/ai-augmentation-systems#40` → `#42` (filed and closed during this initiative) landed it in the README.

The README's own canonical, executed worked example (`skills/attractorify/examples/00-convergence-loop.dot`) shows the right shape — an LLM `attempt` node, a deterministic `parallelogram` `gate` node, a condition-based loop-back edge on `context.tool.last_line` — but is deliberately **unbounded**, relying on the shared 500-step ceiling as its only backstop. The README states plainly: "If you need a bounded number of gate-retry cycles, build your own counter into the graph."

## Decision

The gate node's own `tool_command` does the counting. It runs the compiled deterministic check, then increments a small per-criterion counter file it owns, and emits exactly one of three last-stdout-lines depending on outcome and count: `gate_pass`, `gate_retry`, or `gate_giveup` (bound reached without passing). Three outgoing edges route on plain string equality against `context.tool.last_line` — the one operator `condition=` actually has:

```
s3_c2__fix  [shape=box, prompt="<criterion text, FR-n reference, prior failure evidence>"]
s3_c2__gate [shape=parallelogram, goal_gate=true,
             tool_command="<compiled check>; c=$(( $(cat <counter-path> 2>/dev/null || echo 0) + 1 )); echo $c > <counter-path>; if <check-passed>; then printf gate_pass; elif [ \"$c\" -ge <BOUND> ]; then printf gate_giveup; else printf gate_retry; fi",
             outputs="s3_c2.result"]

s3_c2__fix -> s3_c2__gate
s3_c2__gate -> <next node>   [condition="context.tool.last_line=gate_pass"]
s3_c2__gate -> s3_c2__fix    [condition="context.tool.last_line=gate_retry"]
s3_c2__gate -> <non_convergent recorder> [condition="context.tool.last_line=gate_giveup"]
```

Two node-visits per attempt (`fix` + `gate`), no separate bound-check or per-attempt record node. All arithmetic lives in the shell logic inside `tool_command=` — nothing asked of attractor beyond what's documented and empirically confirmed (string-equality routing on `tool.last_line`).

## Alternatives considered

### `condition=` counter comparison (`context.attempts<N` on a `diamond` node)

**Why it was attractive:** the most direct-looking translation of "count attempts, compare to a bound."
**Why rejected:** `condition=`'s grammar (`core/condition.ts`) supports only `=`/`!=`, string equality — no `<`/`>`/`<=`/`>=`. Confirmed by reading the grammar and by empirically running the exact mechanism through `attractor lint`, which refused it: `ERROR COND-001 ...: malformed condition="context.attempt_count<3"` (error-severity; `attractor run` refuses the graph outright).

### `max_retries=`/`retry_target=`

**Why it was attractive:** real, tested, documented (once `#42` landed) node attributes purpose-built for bounding retries.
**Why rejected:** `max_retries` only matters for a **`RETRY`-status verdict**, and only a `box` (LLM) node with `goal_gate=true` making a self-assessed judgment can ever produce one — "an ordinary `box`/`parallelogram` node's outcome is always `SUCCESS` or `FAIL`, never `RETRY`" (README, verbatim). Our gate is deliberately a `parallelogram`, precisely so nothing self-grades its own check — using this attribute would mean either giving up that deterministic-check guarantee (`FR-5`/`6`/`7`) or misusing the attribute against its own documented semantics.

### Static unrolling (N discrete gate/fix pairs)

**Why it was attractive:** syntactically legal, no shell arithmetic inside `tool_command=`.
**Why rejected:** multiplies node count by the bound, worsening `NFR-1`'s ceiling exposure for no benefit once shell arithmetic was found to work.

## Consequences

**We gain:** a bounded retry loop built entirely from documented, tested, empirically-verified primitives — no dependency on an attribute that doesn't apply to our node shape, no node-count blowup, and correctness checkable by `attractor lint` plus one real `--stub` run rather than trusted secondhand.

**We accept:** the bound-and-route logic lives in a generated shell one-liner per gate — real complexity the compiler must generate correctly, covered by the QA-strategist's fixture-based `--stub` test strategy (`architecture.md`).

**We will need to revisit this if:** attractor ever extends `max_retries=`/`RETRY` semantics to deterministic node shapes, which would let a future revision drop the shell arithmetic in favor of a native attribute.
