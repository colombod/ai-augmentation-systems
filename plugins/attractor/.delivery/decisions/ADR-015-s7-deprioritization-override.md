# ADR-015: Build S7 (FR-13–16) now, overriding `prioritization.md`'s Stage-3-first sequencing

**Status:** accepted
**Date:** 2026-08-10
**Deciders:** Project owner (this session)

## Context

`prioritization.md`'s "Explicitly not doing this cycle" section defers FR-13–16 (S7,
the authoring skill) behind Stage 3 (human-gate core: `Handler.HUMAN` registered,
`Channel → GateContext → preferredLabel → selectEdge` wired): "committing now would
optimize for P-1/P-4 before Stage 3 proves the channels design for the persona already
in production" (P-2). [Issue #17](https://github.com/colombod/ai-augmentation-systems/issues/17),
opened by the project owner, asks to plan and implement S7 anyway.

Before doing anything, this was checked rather than assumed stale, per the issue's own
instruction: `grep -rn "Handler.HUMAN" plugins/attractor/engine/src/` returns zero hits
in `defaultHandlers()` (`core/engine.ts:105-112`) — Stage 3 is still unbuilt, confirmed
by reading the code directly, not by trusting the roadmap's own status column. The
deferral's stated condition has not been met; the backlog ordering is not stale.

## Decision

Build S7 now anyway. Presented as an explicit choice — full plan + implement now /
plan only, hold implementation / stop here, take no action — the project owner chose
to override the deferral outright, not to hedge with a partial build.

## Alternatives considered

### Plan only, hold implementation until Stage 3 ships

**Why it was attractive:** respects the recorded sequencing exactly; produces
shovel-ready stories with zero risk of building on a still-unbuilt human-gate channel
this work doesn't depend on anyway (S7 has no dependency on `Handler.HUMAN` — the two
are independent surfaces that happened to be sequenced by persona-value judgment, not
by a technical blocker).
**Why not chosen:** the project owner had standing to make this call and made it in the
other direction, having been shown the confirmation evidence first.

### Treat the deferral as stale and proceed without confirming

**Why rejected outright:** this is the exact failure mode the issue's own instruction
("confirm that's still the right call before building anything, don't assume the
backlog ordering is stale") exists to prevent, and the project convention this repo
already burned real effort on once (FR-17b built twice, `#28`/`#29`) is "check before
building," not "assume checked."

## Consequences

**We gain:** S7 lands without waiting on Stage 3, which — confirmed above — has no
technical dependency relationship with it anyway; the override is recorded with its
own evidence trail rather than silently overriding a documented product decision.

**We accept:** `prioritization.md`'s own stage table is now out of sync with reality
until updated (tracked — see the roadmap/prioritization update at the end of this
initiative's S7 work) and this ADR is the record of *why* the sequence in that document
was not followed, for anyone who reads the prioritization doc first and the roadmap
second and finds them disagreeing.

**We will need to revisit this if:** a future session assumes this ADR means Stage 3's
own reasoning was wrong. It wasn't — P-2 (the persona MVP already serves) still needs
none of S7, and Stage 3 is still the higher-value next slice for that persona. This ADR
records an explicit override by the person with standing to make it, not a correction.
