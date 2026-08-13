<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-09
title: --allow-agent-gates / --channel flags; channels wired into Engine; index.ts exports
status: done
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-8]
depends_on: [p2-08]
size: M
---

# CLI wiring + library exports

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Add `--allow-agent-gates` (boolean) and `--channel name=command` (a repeatable, accumulating-into-
a-map flag — the first flag in this codebase whose accumulated values become real objects rather
than plain strings) to `attractor run`; construct a real `defaultChannels()` map layered with any
`--channel`-supplied `CommandChannel`s and a real `ChannelRunContext` **before** worktree
creation, so a preflight refusal is a fast-path failure that never pays the cost of creating and
tearing down a git worktree; thread both into `new Engine({...})`; re-export the six new public
symbols from `engine/src/index.ts`.

## Context

The accumulating-map shape is genuinely new in the codebase's CLI, though not entirely
unprecedented — `--param` already accumulates into a flat `Record<string,string>`; `--channel`
accumulates into names mapping to `CommandChannel` **instances**. Reserved-name collision:
`--channel human=...`/`agent=...` must be **refused**, mirroring the `--worktree`/`--in-place`
mutual-exclusivity precedent exactly (`cli.ts:118-124`: contradictory flags →
`process.stderr.write(...)`, `parseRunArgs` returns `null`, `main()` prints USAGE and exits 2) —
a `--channel human=some-script` would silently shadow the real `HumanChannel` under a name that
looks built-in, worth refusing outright. This story resolves toward the **stricter reading** for
duplicate non-reserved names too: a second `--channel` naming the same non-reserved name is also
refused, not silently overwritten; document this choice explicitly since it's a real judgment
call, not a specified requirement.

Fast-path placement, verified against current control flow: `reportDiagnostics` (lint refusal)
already runs at `cli.ts:218`, **before** any worktree logic begins at `cli.ts:224`. The new
preflight check follows the same placement — lint refusal, then preflight refusal, then worktree
creation — not deferred until after `new Engine({...})` (line 288)/`engine.run()` (line 296),
where `Engine.run()`'s own preflight (p2-08) would eventually catch it anyway, but only after a
worktree was already created and needs tearing down. This is a **deliberate duplication**:
`cli.ts`'s copy exists purely to avoid worktree-creation cost on a run that's going to be refused
anyway; `Engine.run()`'s copy is what actually protects every caller, including a direct embed
that skips `cli.ts` entirely — named explicitly, matching `ADR-024`'s own accepted Risks-table
duplication for `defaultHandlers()`'s literal default vs. `cli.ts`'s explicit construction.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/cli.ts` | modify — `parseRunArgs` gains `--allow-agent-gates`/`--channel` parsing + `RunArgs` fields; USAGE documents both; `run` command constructs channels+`ChannelRunContext` before worktree creation, does its own fast-path preflight check, threads both into `new Engine({...})` |
| `plugins/attractor/engine/src/index.ts` | modify — gains six re-exports: `Channel`, `HumanGateContext`, `ChannelAnswer`, `defaultChannels`, `CommandChannel`, `HumanGateHandler` |
| `plugins/attractor/engine/test/cli.test.ts` | extend — new tests, existing suite unaffected |
| `plugins/attractor/engine/test/index.test.ts` | extend — one or two lines per new export |

## Interfaces and contracts to honor

`RunArgs` gains `allowAgentGates: boolean` and `channelCommands: Record<string, string>`
(accumulated across repeated `--channel name=command`, same `indexOf('=')` split style
`--param` already uses at `cli.ts:80-88`). `--channel` parsing: `name` ∈ `{'human','agent'}` →
refuse; a second `--channel` for the same non-reserved `name` → refuse (per the stricter reading
above); otherwise accumulate. `run` command, after the existing lint refusal and
`warnOnManagedParams` (line 222), before any worktree logic (line 224):
```ts
const claudeAvailable = probeTool('claude', ['--version'], true).ok
const channels = defaultChannels({ agent: {} /* allowed computed from allowAgentGates+claudeAvailable */ })
for (const [name, command] of Object.entries(args.channelCommands)) channels.set(name, new CommandChannel(command))
const channelRunContext: ChannelRunContext = {
  isInteractive: Boolean(process.stdin.isTTY),
  allowAgentGates: args.allowAgentGates,
  claudeAvailable,
  configuredNames: new Set(channels.keys()),
}
const gateDiagnostics = preflightHumanGates(parseDot(source), channels, channelRunContext)
if (gateDiagnostics.length > 0) { /* print, return 1 -- same posture as the lint-error refusal above */ }
```
`claudeAvailable` must be computed **before** `defaultChannels()` is called, so the `agent`
channel's `allowed` and the `ChannelRunContext.allowAgentGates`/`claudeAvailable` used by
preflight are driven from the identical pair — do not construct `defaultChannels()` first and
patch `allowed` afterward. Then thread `channels`/`channelRunContext` into the existing
`new Engine({...})` call (`cli.ts:288-295`).

## Relevant design decisions

- **ADR-024**'s Risks-section duplication note (cited above).
- The `--worktree`/`--in-place` precedent (`cli.ts:118-124`) — the literal pattern mirrored for
  reserved-name refusal.

## Acceptance criteria

- [ ] `FR-8` — `--allow-agent-gates` parses to `true`; absence defaults to `false` (matching
      `defaultHandlers()`'s own inert default).
- [ ] `FR-8` — one `--channel foo=./script.sh` accumulates one entry; two `--channel` occurrences
      for different names accumulate both.
- [ ] `FR-8` — `--channel human=...`/`--channel agent=...` are refused — `parseRunArgs` returns
      `null`, USAGE prints, exit 2.
- [ ] A second `--channel foo=...` for the same non-reserved name is refused, not silently
      overwritten.
- [ ] `FR-5`/`FR-6` — a graph whose only reachable gate's only hop is non-viable is refused by
      the CLI's own fast-path check before any worktree is created (no `git worktree add` side
      effect; no `worktree:` line printed).
- [ ] `index.ts` exports `Channel`, `HumanGateContext`, `ChannelAnswer`, `defaultChannels`,
      `CommandChannel`, `HumanGateHandler` — a direct import succeeds and constructs a real
      instance.
- [ ] `node --test` passes; `cli.test.ts`'s existing suite is unaffected.

## Test approach

**Level:** unit, extending `cli.test.ts`'s existing `parseRunArgs`/`main([...])`-level tests
(already covers `--worktree`/`--in-place`), plus one or two integration-shaped tests using a real
tmp git repo (matching the file's existing `tempDirs()` helper) for the "refused before worktree
creation" assertion.
**Cases:**

| Case | Expected |
| :-- | :-- |
| `--allow-agent-gates` present/absent | `true`/`false` |
| `--channel foo=./script.sh` × 1 | one accumulated entry |
| `--channel foo=... --channel bar=...` | both accumulated |
| `--channel human=...` / `agent=...` | refused, USAGE, exit 2 |
| `--channel foo=a --channel foo=b` | refused (duplicate non-reserved name) |
| non-viable-only-gate graph | refused before `git worktree add` |
| `index.ts` new exports | import succeeds, constructs real instances |

**Run with:** `node --test test/cli.test.ts test/index.test.ts` (from `plugins/attractor/engine`),
then full `node --test`.

## Out of scope

- The real-subprocess end-to-end test against the built CLI (p2-10) — this story's tests run
  against `main()`/`src/cli.ts` in-process.
- `CommandChannel` actually answering a real gate end-to-end (already covered at the
  `CommandChannel` level, p2-05).

## Dependencies

- **p2-08** — `Handler.HUMAN` registration, `EngineOptions.channels`/`channelRunContext`.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
