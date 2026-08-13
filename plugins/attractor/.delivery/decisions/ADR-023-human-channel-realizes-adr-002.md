# ADR-023: The `human` channel realizes ADR-002 exactly, and has no code path that can itself deliver an FR-8 answer this slice

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect

## Context

ADR-002 (accepted 2026-08-05, not yet implemented) decided: block only when `process.stdin.isTTY`
is true; fail fast otherwise. Its 2026-08-06 addendum already states plainly that this is a
decision, not shipped code, and that the channels design's `human` channel is what implements it.
The adopted design doc's own §2 (`human-gate-channels-design.md:104-111`) already says the
`human` channel "blocks... returns `{label: null}` (never, in this build — it never resolves) if
interactive" — i.e. it was never meant to produce a real answer this slice. That fact is easy to
lose once `HumanGateHandler`'s chain-walk, escalation, and fallback machinery exist around it —
a reader skimming the new code could reasonably assume the whole apparatus, `human` included,
closes FR-8 end to end.

## Decision

`HumanChannel.answer()` blocks via `StdinHumanGateWait` (`resume()` + heartbeat, per ADR-002),
bounded only by an optional `human.channel_timeout`. It resolves `{label: null}` if and only if
that timeout fires; if no timeout is set, it never resolves at all — matching a real, present
person's session lasting as long as it lasts. There is no branch, present or planned this slice,
where it produces a non-null `label`. FR-8 ("an answer reaches the gate and takes the matching
edge") is satisfiable this slice only via the `agent` channel or a `CommandChannel` — never via
`human` alone, and the architecture states this explicitly rather than leaving it to be
discovered by whoever writes the first end-to-end test for a `human`-only graph.

## Alternatives considered

### Build real stdin-answer parsing (a human types a label into the blocked terminal)

**Why it was attractive:** would make the `human` channel actually able to answer, closing FR-8
without depending on `agent`/`CommandChannel` at all — arguably the most literal reading of "a
human gate" as a concept.
**Why rejected:** out of scope for this slice. No scenario in the PRD or the adopted design specifies
this mechanism; `.superpowers/carry-forward.md`'s Plan 4 entry explicitly files "free-form-input
collection for unlabelled edges" as future, additive work. Building it now would be scope the PRD
never asked for.

### Have `HumanChannel.answer()` self-check `isInteractive` and return `{label: null}` when not a TTY

**Why it was attractive:** would make the channel self-contained, needing no external viability
check before being invoked — arguably a cleaner encapsulation.
**Why rejected:** conflates two distinct questions the design deliberately keeps separate: "not
viable, exclude from the chain silently" (preflight's job, checked before dispatch) versus
"viable but exhausted, escalate" (`ChannelAnswer`'s actual runtime contract). Moving the TTY check
into `HumanChannel` itself would let the same predicate answer both questions inconsistently
depending on which code path asked. `isChannelViable` staying the single source of truth for
viability, checked once by the caller before `.answer()` is ever invoked, keeps the two questions
distinct.

## Consequences

**We gain:** ADR-002's already-accepted behavior lands unchanged, wrapped in the new interface
rather than reimplemented; no reader is left to infer FR-8's actual answer-delivery mechanism
from silence.

**We accept:** the `human` channel, alone, cannot demonstrate FR-8 — any acceptance demo or test
claiming to show FR-8 working must use `agent` or a `CommandChannel`, and skill/demo materials
need to say so explicitly rather than let a `human.channel="human"` example be mistaken for a
complete answer-delivery story.

**We will need to revisit this if:** a future slice decides to build real stdin-answer collection
for the `human` channel — at that point this ADR's central claim ("no code path produces a real
answer") is what changes, and the FR-8 acceptance demo should be revisited to use `human` as a
first-class option alongside `agent`/`CommandChannel`.
