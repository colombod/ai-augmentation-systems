# 08 — Human-Gate Checkpoint

**Shape:** `worker -> human-approval gate -> ship`

A deterministic worker step, then a human-approval checkpoint (`Handler.HUMAN`,
`shape=hexagon`) whose answer decides the edge taken. Newly portable as of Phase 2
(FR-5-8, S2, 2026-08-11) — `Handler.HUMAN` was unregistered when the rest of this
example set shipped (S7), which is why this row moved from "excluded" to shipped: see
`architecture.md`'s Example-portability policy for the re-verified table.

**Adapted, not ported verbatim.** Unlike 00/02/03/05, this project has no committed
`microsoft/amplifier-bundle-attractor` source for a human-gate example to adapt from —
the exclusion predates any fetch of one. This is a fresh example built against this
engine's own `Channel`/`HumanGateHandler` machinery (`channels/*.ts`,
`handlers/human.ts`), teaching the same routing pattern any human-gate example would:
a gate node whose `Channel.answer()` becomes `outcome.preferredLabel`, routed by the
same `selectEdge` every other node's `preferredLabel` uses (`.superpowers/specs/2026-08-05-human-gate-channels-design.md`).

**Why `--channel`, not `--stub` alone.** `--stub` only ever affects the box/tool
backend — the built-in `human` channel itself can *never* answer a gate in this build
(ADR-023: no code path in `channels/human.ts` produces a real label). Answering a gate
at all needs `agent` or a `CommandChannel`; this example uses a `CommandChannel`
(`--channel mock_approval=...`) pointed at a small, deterministic script
(`08-human-gate.mock-approval.sh`) that always answers `approve` — matching this set's
own established "self-contained deterministic replacement" convention (00/02/03/05),
just for a channel's answer instead of a `tool_command` gate.

## Actually executed on this engine

```
$ node dist/attractor.js run 08-human-gate.dot --cwd <tmp> --run-dir <tmp> --stub \
    --param goal="add a health check endpoint" \
    --channel mock_approval=<plugin-root>/skills/attractorify/examples/08-human-gate.mock-approval.sh
status: success
path:   start -> prepare -> gate -> ship
```

Full transcript: [`08-human-gate.events.jsonl`](08-human-gate.events.jsonl) — a real
`--stub` run, not hand-written. The `human.context="tool.last_line"` attribute exposes
`prepare`'s own output to the channel (empty here, since `prepare` is a stub box node
with nothing in `tool.last_line`), demonstrating the `exposedContext` wiring without
needing a real value to make the point.

## What this teaches

- Reference: `.superpowers/specs/2026-08-05-human-gate-channels-design.md` (the
  `Channel -> GateContext -> preferredLabel -> selectEdge` design this example
  exercises end to end).
- Reference: `../reference/routing-reference.md` (edge selection on a channel's
  answered label, the same mechanism as any other `preferredLabel`).
- `human.channel` names one or more channels, tried in order (`,`-separated) —
  this example uses exactly one; see the design doc for chains, timeouts
  (`human.channel_timeout`), and the `agent` channel's two-key opt-in
  (`--allow-agent-gates` + the graph naming `agent`).
- What this does **not** demonstrate: escalation across multiple hops, the `agent`
  channel, or the interactive `human` channel's real blocking behavior (needs a real
  TTY, out of scope for an automated `--stub` example — see ADR-023).
