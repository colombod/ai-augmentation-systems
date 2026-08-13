# ADR-024: `Handler.HUMAN` registers unconditionally; `defaultHandlers()`'s new parameters are optional with safe, zero-I/O defaults

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect

## Context

`defaultHandlers(backend)` needs two new inputs to construct a `HumanGateHandler`: a channel map
and a `ChannelRunContext`. `defaultHandlers` has 47 existing call sites across
`engine/test/{parallel,engine,lint,index,live}.test.ts` and `skills/attractorify/verify-run.ts`
(confirmed by grep), none of which exercise `Handler.HUMAN`. Whether these two new parameters are
required or optional determines whether every one of those call sites needs a mechanical edit.

## Decision

Both `channels` and `channelRunContext` are optional, defaulting to `defaultChannels()` and a
literal, zero-I/O-by-default `ChannelRunContext` (`isInteractive` computed live via
`Boolean(process.stdin.isTTY)`; `allowAgentGates`/`claudeAvailable` both `false`; no `probeTool`
subprocess spawned unless a caller explicitly opts in). `Handler.HUMAN` is always present in the
returned `Map` regardless of these arguments — only a given gate's runtime *viability* varies by
configuration, never whether the kind exists at all, matching `Handler.PARALLEL`'s own
unconditional-registration precedent from `p5-08`.

## Alternatives considered

### Require `channels`/`channelRunContext`, mirroring `handlers`'s own required status in `EngineOptions`

**Why it was attractive:** consistency — every other required input to `Engine` construction is,
in fact, required; making these two optional is an inconsistency an unfamiliar reader has to
learn.
**Why rejected:** forces a mechanical edit to all 47 existing call sites for zero behavioral
benefit — exactly the "changing many files for one likely future change" shape this role pushes
back on. The chosen default is independently verified safe, not merely convenient: `process.stdin.isTTY`
reads `undefined` under `node --test`'s non-interactive runner (Spike 15, confirmed empirically
in this pass, not merely reasoned about), so the "live" default naturally evaluates to
`isInteractive: false` for every existing test — the same inert value a hand-picked dummy would
have provided, without needing one.

## Consequences

**We gain:** zero mechanical churn across the existing suite; a new `Handler.HUMAN`-exercising
test opts in explicitly by passing real values, rather than every other test needing to opt out.

**We accept:** two call sites (`defaultHandlers`'s own default, and `cli.ts`'s explicit
construction) must independently compute the same shape of `ChannelRunContext` — named and
accepted as a small, narrow duplication in the FR-5–8 architecture's Risks section, not silently
trusted to stay in sync.

**We will need to revisit this if:** `process.stdin.isTTY`'s behavior under `node --test` changes
in a future Node version, invalidating the empirical basis for calling the live default "safe" —
at that point the default should switch to an explicit, hard-coded-false `isInteractive` rather
than continuing to rely on ambient runtime behavior.
