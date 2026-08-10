# Engine Semantics

> Written from scratch, from this engine's own tests and source
> (`plugins/attractor/engine/`, 2026-08-10) — **not a port of
> `microsoft/amplifier-bundle-attractor`'s own `context/engine-semantics.md`**, per
> `AGENTS.md`'s explicit instruction: this file is the declared source of truth for how
> the *shipped* engine behaves, and a ported one would describe a different engine. See
> [ADR-018](../../../.delivery/decisions/ADR-018-reference-material-porting-split.md).
> Every claim below cites a real file, line, or test — a claim with no citation does not
> belong in this file.

This is the reference the `attractor-expert` agent and the `attractorify` skill both
load first, before DOT syntax — reasoning from syntax or the spec alone makes you
confidently wrong about the running engine (the same warning amplifier's own expert
agent gives, kept because it's true here too).

## Registered handlers — the only ones a graph may use

`defaultHandlers()` (`core/engine.ts:105-112`) registers exactly six:
`Handler.START`, `Handler.EXIT`, `Handler.CONDITIONAL` (all three passthrough —
`PASSTHROUGH_KINDS`, `dot/graph.ts:248`), `Handler.TOOL`, `Handler.CODERGEN`,
`Handler.PARALLEL`. `Handler.HUMAN`, `Handler.FAN_IN`, `Handler.MANAGER_LOOP` are
recognized shapes (`hexagon`, `tripleoctagon`, `house`) that resolve correctly at parse
time but have no registered handler — `HAND-001` refuses them at lint time
(`dot/lint.ts`) rather than letting a run abort mid-pipeline with `no handler
registered`. **Confirm this list against `defaultHandlers()` directly before trusting
it** — the moment a future change registers `Handler.HUMAN`, this document (and
`dot-reference.md`, and the `attractor-expert` agent) go stale in the same instant and
all three need updating together.

## Routing: the verdict contract is goal_gate=true-only

See `routing-reference.md` for the full account — this section states the one-line
version because every other engine-semantics claim depends on it. A structured routing
verdict is requested from the model, and interpreted as one, only for a node where
`node.attrs.goal_gate === 'true'` (`backend/argv.ts:42-43`, `wantsVerdict`). A non-gate
`box` node's routing signal is the raw `outcome=success`/`outcome=fail` derived from
`is_error` alone (`backend/result.ts`'s `interpretResult`) — never a `preferred_label`,
never a `context_updates` payload from a live model response (that field is not
populated anywhere on the `ClaudeCodeBackend` path).

## Fail-closed goal gates

A `goal_gate=true` node whose outcome carries no routing signal (empty
`preferredLabel`, empty `suggestedNextIds`, no allowed context updates) is downgraded —
`carriesVerdict()` in `handlers/box.ts`. Prose from a model cannot satisfy a gate; this
closes the documented upstream incident where a fail-open default recorded a judge's
prose "NOT CONVERGED" as a success. `runs_on` is inert on a gate in both directions — a
gate is never skipped and its eager input check stays armed regardless of `runs_on`
(`AGENTS.md`'s own "Fail-closed goal gates" doctrine entry, non-tradeable).

## Fail-fast on FAIL

`selectEdge` (`core/edge-select.ts`) returns `null` — halting the run — when a node's
outcome is FAIL and no conditional edge explicitly matched it. No unconditional edge,
no preferred-label match, no weight/lexical fallback carries a FAIL forward silently.
This is a chosen reading of a spec ambiguity (§3.3's pseudocode has no FAIL branch;
§3.7's failure ladder terminates) — this engine implements the §3.7 reading. See
`routing-reference.md` §4 for why this makes amplifier's own "silent alphabetical
fallback" pitfall not apply the same way here.

## Retry: node-level and graph-level targets are consulted at different times

`resolveRetryTarget(node, graph, opts)` (`core/retry.ts:107-121`) checks, in order:
node-level `retry_target`, node-level `fallback_retry_target`, then — **only when
`opts.includeGraphLevel` is true** — graph-level `retry_target`/`fallback_retry_target`.
Graph-level targets are consulted **only on an unsatisfied-goal-gate-at-exit** (spec
§3.4), never on an arbitrary per-node failure (spec §3.7) — a node-level target or a
conditional edge is the only way to catch a specific node's own failure. Relying on the
graph-level target to catch an ordinary node failure is off-spec and the engine will
halt loud instead (same conclusion amplifier's own `ROUTING-REFERENCE.md` §6 draws,
confirmed independently true here too).

## Dataflow: `outputs=`/`runs_on=` — opt-in, and box nodes infer nothing

Full account in `README.md`'s own Dataflow section (`../../../README.md`) and
`dot-reference.md` — not restated here beyond the one fact every design decision rests
on: **a `box` node infers zero outputs, always.** `outputs=` is the only way any node —
including an LLM node — joins the dataflow contract, and the protection is fully
opt-in: a graph declaring no `outputs=` anywhere gets none of it.

## An unresolved failure is recorded, but never changes the run's verdict

Quoted verbatim from `AGENTS.md`, because paraphrasing this one has already gone wrong
once in this project's own history: *"An unresolved failure is recorded and said out
loud — but it does not change the verdict. A run can reach its exit holding a node
whose work failed and which nothing re-ran. §11.3 decides the run status purely by goal
gates ... so such a run is a conformant success."* `RunResult.unresolvedFailures` names
the nodes; nothing about this changes `RunResult.status`. Do not design a graph (or
write reference material) that implies an unresolved failure alone fails a run — only a
goal gate that never reached SUCCESS/PARTIAL does that.

## Loud aborts over silent degradation

An unimplemented shape (`HAND-001`) fails at lint time with the exact handler kind
named, not a generic error and not a silent fallback to some other handler. This is the
engine-wide posture every lint rule in `README.md`'s `## Lint rules` section follows —
worth internalizing before authoring a graph that relies on any attribute or shape not
explicitly documented in `dot-reference.md`: an unsupported one is refused loudly, not
silently ignored.

## Substitution: unresolved references are left literal, never blanked

`core/substitute.ts`'s M5 contract: `$key`/`${key}` is replaced with the context value
for `key`; a key absent from context is left as **literal text**, not replaced with an
empty string. This matters most for a `parallelogram` node's `tool_command`, which
feeds a real shell — a blanked reference inside `rm -rf ${artifact.dir}/tmp` would
silently become `rm -rf /tmp`, one of the incidents `README.md`'s Dataflow section
documents directly. `$$` is preserved verbatim (the shell process-id idiom), not
collapsed.

## What amplifier has that this engine does not (a quick-reference table)

For the amplifier-veteran persona specifically — every row below is a real gap, not an
oversight in this document:

| Amplifier feature | This engine |
| :-- | :-- |
| `report_outcome` tool available to every node | Only `goal_gate=true` nodes get a structured verdict (§ above) |
| `context_updates` from a live model response | Not populated on `ClaudeCodeBackend`'s path at all |
| `model_stylesheet` / `llm_provider` / `llm_model` | Does not exist — PRD non-goal, architecturally out of scope |
| `fidelity` modes | Open Question 10, unresolved status — not usable |
| `folder` shape (nested sub-pipeline) | Does not exist |
| `stack.steer`/`stack.observe` pseudo-types | Does not exist — an unrecognized `type=` is a lint ERROR (`TYPE-001`), not a WARNING |
| Silent alphabetical fallback on any unmatched outcome | Only applies to non-FAIL outcomes here — a FAIL halts instead (§ above) |
| `tripleoctagon` fan-in node, optional | Unregistered, refused by `HAND-001` — the default join policy already fails on zero successes |
