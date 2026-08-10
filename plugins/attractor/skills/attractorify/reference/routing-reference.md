# Routing Reference

> Ported from `microsoft/amplifier-bundle-attractor@main`'s `docs/ROUTING-REFERENCE.md`
> (2026-08-10), corrected against this engine's actual routing behavior — see
> [ADR-018](../../../.delivery/decisions/ADR-018-reference-material-porting-split.md).
> **This file is FR-15's home**: the verdict-contract statement below (§2) must state,
> and only state, that a routing verdict is requested for `goal_gate=true` nodes and no
> others. Lint code meanings are never restated here — see `README.md`'s own
> [`## Lint rules`](../../../README.md#lint-rules) section.

## 1. Overview

The routing system determines which node executes next after each node completes. Two
mechanisms work together — **fewer than amplifier's three**, see §2 for what this engine
does not have:

- **Edge conditions** — each outgoing edge may carry a `condition` attribute, a boolean
  expression evaluated against the completed node's outcome and the current pipeline
  context. This is the primary and, for non-gate nodes, close to the *only* routing
  mechanism.
- **Edge selection algorithm** — a deterministic, priority-ordered cascade over a node's
  outgoing edges (`engine/src/core/edge-select.ts`'s `selectEdge`), implementing spec
  §3.3. Parallel fan-out is `component`-node-based only — never triggered by plain
  multi-edge conditions.

## 2. No `report_outcome` tool — the goal_gate=true-only verdict contract (FR-15)

**Amplifier gives every node a `report_outcome` tool call**, letting any LLM node emit a
`status`/`preferred_label`/`suggested_next_ids`/`context_updates` payload. **This engine
does not.** A structured routing verdict is requested from the model, and interpreted as
one, for exactly one class of node:

```ts
// engine/src/backend/argv.ts:42-43
export function wantsVerdict(node: Node): boolean {
  return node.attrs.goal_gate === 'true'
}
```

`buildArgv` (`argv.ts`) consults this exact function to decide whether to request
`--json-schema` from the `claude` subprocess at all; `interpretResult`
(`backend/result.ts`) consults the **same** function (passed through as
`expectVerdict`, `claude.ts:129-134`) to decide whether a node's JSON-shaped output may
be read as a verdict. The request and the interpretation share one condition by
construction — they cannot drift apart. `interpretResult`'s own comment states the
consequence of getting this wrong: *"Prose deliberately produces NO preferredLabel and
NO contextUpdates"* for a non-gate node — a work node that happens to answer with a JSON
object gets no special treatment, its output is recorded as ordinary notes, not
misread as a routing verdict by accident of formatting.

**What this means for authoring a non-gate `box` node:** it has no `preferred_label` to
route on. Its only routing signal is the raw `outcome=success`/`outcome=fail` produced
by `is_error` (see §3), or a downstream `parallelogram` node reading something the box
node wrote to a file. **Amplifier's "context-driven branching" pattern (a box node
calling `report_outcome(context_updates={...})`) has no equivalent here.** Context
updates from a live model response do not exist on this engine's `ClaudeCodeBackend`
path at all — `context.<key>` branching is real, but the key must come from a
`parallelogram` (tool) node's `outputs=` declaration or from a `--param`-seeded value,
never from a `box` node's own text.

**What this means for a `goal_gate=true` node:** it receives the structured schema
(`status`, `preferred_label`, `notes`), matching `argv.ts:42-43` exactly — this is the
one place amplifier's `report_outcome` model and this engine's model actually agree.

## 3. Condition expression language

```
outcome=success              // resolves to preferredLabel if the node set one (gate only), else status
outcome!=fail
context.has_tests=true && outcome=success   // AND conjunction
```

| Key | Resolves to |
| :-- | :-- |
| `outcome` | The gate's `preferredLabel` if set (goal-gate nodes only); otherwise the raw `status` value (`success`\|`fail`\|`partial_success`\|`retry`). |
| `context.<key>` | A pipeline context variable — from a `parallelogram` node's `outputs=`/`tool.last_line`, or a `--param`-seeded value. Never from a live `box` node response. |

See `engine/src/core/condition.ts` for the exact evaluator. Values compare as strings;
whitespace is stripped.

## 4. Edge selection algorithm — corrected for this engine's fail-fast behavior

`engine/src/core/edge-select.ts`'s `selectEdge`, implementing spec §3.3:

| Step | Trigger | Candidates |
| :-- | :-- | :-- |
| 1 | Any conditional edge (`condition=` present, non-empty) whose condition evaluates `true` | Matching edges — **ends the cascade immediately** on a match, weight-then-lexical tiebreak among ties |
| **fail-fast** | **Outcome status is FAIL and no condition in step 1 matched it** | **`selectEdge` returns `null` — the run halts here.** No unconditional edge, no preferred-label match, no fallback of any kind carries a FAIL forward. This is the one point where this engine diverges hardest from amplifier's own algorithm. |
| 2 | (SUCCESS/PARTIAL/RETRY only) `outcome.preferredLabel` is set (goal-gate node) | First unconditional edge whose `label` normalizes to a match (case-insensitive, accelerator-prefix-stripped — `normaliseLabel` in `edge-select.ts`) |
| 3 | `outcome.suggestedNextIds` is set | First unconditional edge targeting a listed id, in caller order — **not currently populated by `ClaudeCodeBackend`'s response parsing (§2); reserved for a programmatic caller constructing an `Outcome` directly (e.g. a custom `Backend`)** |
| 4/5 | Nothing above matched | All unconditional edges, highest `weight` then lexical target id |

**Amplifier's "Pitfall: Silent alphabetical fallback" does not apply the same way
here.** Amplifier's algorithm falls through to a silent weight/lexical pick even on a
FAIL outcome with no matching edge — this engine's fail-fast step intercepts exactly
that case and halts loudly instead (`AGENTS.md`'s non-tradeable "Fail-fast on FAIL"
doctrine entry). The silent-fallback risk is real here only for **non-FAIL** outcomes
(SUCCESS/PARTIAL/RETRY) with no matching condition and no preferred-label/suggestion
match — still worth the same defensive-routing discipline amplifier's guide recommends
(prefer `condition="outcome!=fail"` over `condition="outcome=success"` when the node
might not always set a `preferred_label`), just not the identical failure mode amplifier
documents.

## 5. Pattern: pass/retry routing (goal-gate node)

```dot
review [shape=box, goal_gate=true, prompt="Review. Respond with a status and, if fixes are needed, preferred_label=retry."]
fix    [shape=box, prompt="Fix the issues identified in the review."]

review -> fix  [condition="outcome=retry", weight=5]
review -> done [condition="outcome!=retry", weight=10]
fix -> review
```

Defensive `!=` routing on the forward edge: if the model answers `success` with no
`preferred_label` at all, `outcome` resolves to `"success"`, and `"success" != "retry"`
is `true` — the forward path still fires correctly.

## 6. Pattern: tool-node routing (not a verdict at all)

Most routing in a well-formed graph on this engine is tool-node routing, not
goal-gate-verdict routing — `${tool.last_line}` substitution plus
`condition="context.tool.last_line=..."`, documented fully in `dot-reference.md` and
`README.md`'s Dataflow section. This is the pattern to reach for first; a `goal_gate`
node is for the specific case where only a model can judge whether the work is done.

## Further reading

- `dot-reference.md` — node shapes, attributes, `outputs=`/`runs_on=` dataflow contract
- `engine-semantics.md` — the full routing/substitution/verdict/fail-loud account, from
  this engine's own tests
- `README.md`'s [`## Lint rules`](../../../README.md#lint-rules) — every lint code's
  actual meaning; not restated in this file or `dot-reference.md`
