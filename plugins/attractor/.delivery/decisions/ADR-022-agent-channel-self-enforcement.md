# ADR-022: `AgentChannel` enforces its own two-key gate and reuses `buildArgv`'s safety flags via a shared constant — neither depends solely on an external caller checking first

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect (original draft), Feature Critic (found the gap this ADR closes)

## Context

The adopted design's §3 states the `agent` channel is "viable only when both keys are present" —
the graph's `human.channel` naming `agent`, and the operator's `--allow-agent-gates` flag — and
describes this as "an explicit, unignorable signal." An initial architecture draft implemented
that safety property entirely inside `isChannelViable`, an *external* predicate consulted by
`HumanGateHandler`'s dispatch loop and by preflight — never by `AgentChannel` itself.

A Feature Critic pass found this repeats a bug class this exact project already found and fixed
once, this same slice: ADR-004 (`.delivery/decisions/ADR-004-embedded-engine-lint-refusal.md`).
There, "leave `Engine` untouched, document that callers must lint first" was rejected outright —
"an embedder who doesn't know to call `lint()` separately gets no protection" — and the fix moved
the check into `Engine.run()` itself, so it holds regardless of construction path. The design
doc's own §1 explicitly sanctions constructing channels outside `defaultChannels()`/`isChannelViable`
entirely: "An embedder constructing `Engine` directly may pass a custom channel map... exactly
like the existing `handlers.set(Handler.HUMAN, ...)` override pattern already used for tests" — a
pattern confirmed real and heavily used (`engine/test/engine.test.ts`, dozens of call sites). A
test author or embedder writing `channels.set('agent', new AgentChannel())` and calling `.answer()`
directly has no structural reason to also wire `allowAgentGates` correctly; nothing stops it.

Separately: `AgentChannel` deliberately does not call `buildArgv` (its schema-request gating on
`wantsVerdict(node)` doesn't apply to a synthetic gate prompt), so it must hand-assemble its own
`claude -p` argv. `buildArgv` unconditionally includes `--permission-mode bypassPermissions`
(`backend/argv.ts:55`) — without that flag, a non-interactive spawn can sit waiting for a
permission grant nobody can give, reintroducing ADR-002's silent-hang risk through a second,
less-tested code path.

## Decision

`AgentChannel`'s constructor takes a required `allowed: boolean` field (not optional, not
defaulted to `true`). `answer()` checks it first and returns `{label: null}` immediately,
spawning nothing, if `allowed !== true` — self-enforcing, not caller-trusting. `defaultChannels()`
is the one place `allowed` is computed, from the same `allowAgentGates`/`claudeAvailable` inputs
`isChannelViable` uses, so the two checks are derived together rather than asserted equal
separately. `AgentChannel`'s argv construction reuses `buildArgv`'s non-interactive-safety prefix
(`-p`, `--output-format json`, `--permission-mode bypassPermissions`) via a shared exported
constant, not hand-duplicated literals — so the flag can't silently go stale in one of the two
places that need it. `AgentChannel` does not reuse `buildArgv`/`wantsVerdict`/`OUTCOME_SCHEMA`/
`parseVerdict` wholesale; a narrow local `GATE_ANSWER_SCHEMA`/`parseGateAnswer` (fields: `label`,
`notes`) replaces them.

## Alternatives considered

### Enforce the two-key rule only via `isChannelViable`, as the design doc's own §3 text implies

**Why it was attractive:** simpler — one predicate, consulted twice (preflight, dispatch), no
duplication of the check inside the channel itself.
**Why rejected:** demonstrated unsafe by direct precedent (ADR-004) and by the design doc's own
sanctioned override pattern, which routes around `isChannelViable` entirely. A safety property
that lives outside the object performing the dangerous action is not actually enforced by that
object at all.

### Reuse `ClaudeCodeBackend`/`buildArgv` wholesale via a synthetic `Node`

**Why it was attractive:** zero new argv-construction code, one code path for every `claude -p`
invocation in this engine.
**Why rejected:** `wantsVerdict(node)` gates the schema request on a real dispatching node's
`goal_gate` attribute — unrelated to "should this call return a routing label." A synthetic
`Node` risks accidental `goal_gate` residue from whatever placeholder is built, and
`ClaudeCodeBackend`'s `ThreadStore` keys resumption off a node id that could collide with a real
node elsewhere in the graph.

### Reuse `parseVerdict`/`OUTCOME_SCHEMA` as-is, ignore the unused `status` field

**Why it was attractive:** one less schema, one less parser to maintain.
**Why rejected:** forces the agent to answer a `status` (success/fail/retry) that doesn't map onto
"pick one of `legalAnswers`," and `parseVerdict`'s unrecognized-status fallback (`result.ts:106`)
would silently reject a well-formed label-only answer that was never asked to fill that field.

## Consequences

**We gain:** the two-key rule holds no matter who constructs `AgentChannel` or calls `.answer()`,
matching ADR-004's precedent exactly; the non-interactive-safety argv prefix can't drift between
`buildArgv` and `AgentChannel` because both read it from one constant.

**We accept:** `AgentChannel`'s constructor signature is slightly more awkward for a caller who
"just wants an agent channel" — they must explicitly pass `allowed: true`, mirroring the
deliberate friction `--allow-agent-gates` itself is meant to impose. This is the point, not a
cost to minimize.

**We will need to revisit this if:** a future channel type needs a different two-key (or
n-key) opt-in shape that this pattern doesn't generalize to cleanly — not anticipated by either
of this slice's other two channels (`human` needs no opt-in beyond TTY presence; `CommandChannel`
is entirely operator-configured, no graph-side key at all).
