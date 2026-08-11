# ADR-020: A new `channels/` directory holds the human-gate channel abstraction; shell helpers relocate to `core/shell.ts`

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect

## Context

The adopted `.superpowers/specs/2026-08-05-human-gate-channels-design.md` specifies a `Channel`
interface, three implementations (`human`, `agent`, `CommandChannel`), a registry
(`defaultChannels()`), and a preflight viability check — none of it code yet. It needs a home.
This codebase already has one precedent for "an interface handlers depend on, plus its
implementations, in a different module than the handlers themselves": `Backend`
(`handlers/types.ts`) with its implementations in `backend/`. But `Channel` has a wider set of
consumers than `Backend` does — `cli.ts` and the new preflight step both need it without
dispatching any handler at all, which `Backend` never has to support.

`CommandChannel` also needs a shell-spawn-and-capture-last-line primitive functionally identical
to `handlers/tool.ts`'s existing, private `runShell`/`lastNonEmptyLine`.

## Decision

New top-level `engine/src/channels/` directory: `types.ts` (interfaces + `isChannelViable`),
`human.ts`, `agent.ts`, `command.ts` (implementations), `defaults.ts` (`defaultChannels()`),
`preflight.ts` (`preflightHumanGates()`). `runShell`/`lastNonEmptyLine` move from
`handlers/tool.ts` to a new `core/shell.ts`, imported by both `ToolHandler` and `CommandChannel`.

## Alternatives considered

### Put `Channel`/`HumanGateContext` in `handlers/types.ts` beside `Backend`

**Why it was attractive:** one less top-level directory; mirrors the `Backend` precedent exactly.
**Why rejected:** `cli.ts` and `channels/preflight.ts` would then import "handler" types for code
that dispatches no handler at all — a worse fit than `Backend`'s case, where every consumer is
in fact dispatching something. `handlers/tool.ts`'s private `runShell` would also need exporting
into a module (`handlers/`) that a non-handler concern (`channels/`) would then depend on, an
odd direction of dependency for what's conceptually a leaf utility.

### Put channel implementations inside `handlers/` beside `human.ts`

**Why it was attractive:** keeps everything related to the human gate in one directory.
**Why rejected:** conflates "the leaf handler that walks a chain" with "the chain's own links,"
which are independently testable and reusable — the design doc's own extension-point framing
lets an embedder construct a bare `CommandChannel` without touching `HumanGateHandler` at all.

## Consequences

**We gain:** a module boundary that matches the real dependency shape (channels are consumed by
handler code, CLI code, and preflight code alike, not owned by any one of them), and a shared
`core/shell.ts` that keeps `ToolHandler` and `CommandChannel` from silently drifting on shell-spawn
semantics.

**We accept:** one more top-level directory under `engine/src/`, and a real (if mechanical) diff
against `handlers/tool.ts`'s existing, tested code — `tool.test.ts`'s assertions must pass
unmodified against the relocated functions, and this move should land as its own commit,
separate from new-feature commits, so any regression is bisectable to "the move" rather than
"the new code."

**We will need to revisit this if:** a future channel implementation needs handler-dispatch
machinery (`HandlerCtx`) that today's three don't — none of the three designed here touch it, so
this is speculative, not a known gap.
