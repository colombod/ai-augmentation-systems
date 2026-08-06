# Human-gate channels — design

> **UNRECONCILED, 2026-08-05:** this design was written without first reading
> `plugins/attractor/.superpowers/specs/2026-08-03-attractor-claude-code-plugin-design.md` §7-8, which
> already specifies a materially different architecture for the identical problem — park +
> checkpoint + cross-restart resume via `attractor resume`, answered via `/attractor approve`,
> Discord via Anthropic's official `discord@claude-plugins-official` channel plugin and a
> monitor session (needs `bun`), not the `Channel`/`CommandChannel` abstraction below. Full
> comparison and candidate resolutions recorded in `plugins/attractor/.superpowers/carry-forward.md` under
> "Plan 4". **Do not implement from this document alone until that is resolved.**

**Status:** DRAFT, not yet implemented. Extends the already-committed ADR-002 (`plugins/attractor/.delivery/decisions/ADR-002-human-gate-blocking.md`) rather than replacing it — `StdinHumanGateWait`/`HumanGateHandler`'s TTY-based block-vs-fail-fast logic becomes this design's `human` channel implementation, unchanged in behavior. The `GateContext.legalAnswers`/edge-routing mechanics (§1) were verified directly against `core/edge-select.ts`, `core/condition.ts`, and `dot/lint.ts` on 2026-08-05, not assumed — see the "Verified against source" note in §1.
**Resolves:** PRD Open Question 1 (S2 answer-delivery channel) and Open Question 2 (`--unattended` preflight refusal), `plugins/attractor/.delivery/prd.md`. Both were left blocked by the PRD's own adversarial review; this design is the follow-on that unblocks FR-8.
**Grounded on:** live design conversation with the project owner (2026-08-05); `plugins/attractor/AGENTS.md` doctrine (human gates never time out by default, loud aborts over silent degradation, verification inside the context that produced the evidence is not verification); `plugins/attractor/.delivery/amplifier-precedent.md` §1 (amplifier's own Interviewer mechanism, and specifically what it does *not* have).

---

## The problem

Today (post-ADR-002), a human gate does one of two things depending on whether stdin is a
real terminal: block indefinitely (a person is plausibly present) or fail immediately with a
named reason (nobody is). That is a correct, minimal safety net, but it is binary and gives an
author no way to say "this gate can be handled by an external system" or "if nobody answers in
30 minutes, let an agent decide." The project owner wants three things this design commits to
building together, because they share the same underlying attribute surface and splitting them
risks building it twice:

1. A pipeline with a human gate that has no viable non-interactive answer path should be
   **refused before it runs at all**, not discovered by hanging or by an unattended process
   dying mid-wait.
2. A gate should be answerable through an **external channel** — Discord, a bespoke ticketing
   system, anything — without attractor's core ever depending on a specific platform's API.
3. A gate should be answerable by an **agent acting on the human's behalf**, when the pipeline
   author explicitly says that's acceptable for that specific gate.

## What we take from amplifier, and what we deliberately don't

Amplifier's `Interviewer` protocol (amplifier-precedent.md §1) is architecturally close to
this project's own `human` channel below — synchronous, attended, one mechanism per run. Two
things it does *not* have, confirmed by reading its source rather than assumed: a durable,
external answer-delivery implementation (only a docstring-level hint of one, never built), and
any notion of a **chain** — trying one channel, escalating to another on timeout. Both are new
ground for this design, not ported from anywhere.

## Design

### 1. The `Channel` interface

```ts
interface GateContext {
  nodeId: string
  label: string                 // human.label or human.prompt, node's own attrs
  legalAnswers: readonly string[]  // see "Verified against source" below -- unconditional
                                    // outgoing edges' label= values ONLY
  exposedContext: Readonly<Record<string, string>>  // only keys named by human.context=,
                                                       // never the full running context
}

interface ChannelAnswer { label: string | null }  // null = no answer this hop; escalate

interface Channel {
  answer(ctx: GateContext, timeoutMs: number | null): Promise<ChannelAnswer>
}
```

**Verified against source, not assumed** (`core/edge-select.ts`, `core/condition.ts`,
`dot/lint.ts` HITL-001, read in full): this engine has two independent, differently-behaved
edge-eligibility mechanisms, and only one of them is enumerable. `condition="..."` is an
arbitrary `key=value && key!=value` boolean expression evaluated against the full running
context — there is no structured way to ask "what value would make this edge match," so a
conditional edge cannot contribute to `legalAnswers`. Plain `label="..."` is a different,
unrelated mechanism: `selectEdge` (edge-select.ts step 2) compares it — case-insensitively,
after stripping a leading accelerator like `"Y) "`/`"[Y] "`/`"Y - "` — against
`outcome.preferredLabel`, but **only** for edges with no `condition=` at all, and only after
the condition cascade has produced no match. This is already exactly how a `hexagon`-adjacent
routing decision is expected to work in this codebase — `engine.test.ts`'s own C9 fixture
(`gate -> ship [label="Y) Yes"]`, driven by a stand-in node's `preferredLabel: 'Yes'`) is
precisely this pattern, just not yet driven by a real human-gate handler.

**Consequence for this design:** `GateContext.legalAnswers` is the `label=` values of `gate`'s
**unconditional** outgoing edges only (the same enumeration `dot/lint.ts`'s existing HITL-001
rule already does — reused, not reinvented), and a `Channel`'s answer becomes
`outcome.preferredLabel` for that step. **No new edge-selection code is needed anywhere in
this design** — `selectEdge` already routes a `preferredLabel` correctly, accelerator-stripping
included, with zero changes. One pre-existing, unrelated inconsistency worth flagging but not
fixing here: `HITL-001`'s own label enumeration does a raw, non-normalized `Array.includes`,
while `selectEdge`'s actual routing match normalizes first — a future lint-time validation of
channel answers against declared labels should mirror `selectEdge`'s normalization (the real
runtime behavior an answer is judged against), not HITL-001's stricter raw check.

`defaultChannels(): Map<string, Channel>` seeds two built-ins, `human` and `agent` (below),
plus zero or more `CommandChannel`s constructed from `--channel <name>=<command>` CLI flags
(mirroring `defaultHandlers(backend)`'s own construction pattern). An embedder constructing
`Engine` directly may pass a custom channel map, or extend the default one, exactly like the
existing `handlers.set(Handler.HUMAN, new HumanGateHandler(fakeWait))` override pattern
already used for tests. **This is the code-level extension point** for anyone embedding the
engine who wants tighter integration than shelling out to a script.

### 2. `human` channel

Wraps ADR-002's already-built `HumanGateHandler`/`StdinHumanGateWait` behind this interface,
unchanged: blocks on a real TTY, returns `{label: null}` (never, in this build — it never
resolves) if interactive; if `isInteractive()` is false, this channel is **not viable** at
all and preflight (§5) treats it as absent from the chain, not as a hop that will fail — the
existing ADR-002 fail-fast-on-non-TTY behavior is superseded by preflight catching this case
earlier, for any gate whose chain is provably `human`-only.

### 3. `agent` channel — the built-in agent proxy

**Two-key requirement, decided rather than left open:** a gate being agent-answerable requires
both the graph author's opt-in (`human.channel` names `agent`) **and** the operator's, via a
new `--allow-agent-gates` CLI flag, absent by default. Without the flag, `agent` is treated as
not viable — for preflight (§6) and at runtime alike — exactly as if `claude` weren't
installed, falling through to the next hop or to the unmodified HITL-001 backstop. This
follows the same pattern already used everywhere else in this design and in ADR-003
(`resolveRetryTarget`'s required argument): an explicit, unignorable signal over a convenient
default, so a graph cannot unilaterally decide its own gates are agent-answerable without the
person actually running it also agreeing. A graph is portable across operators; this flag is
how an operator keeps the final word.

A specific `Channel`, viable only when both keys are present and `claude` is discoverable
(reuses `doctor.ts`'s existing `probeTool` rather than a new PATH check). `answer()` spawns `claude -p`
via the same subprocess machinery box nodes already use (`backend/argv.ts`, `backend/claude.ts`),
**fresh and isolated per invocation** — no access to the running pipeline's context beyond
`GateContext.exposedContext`, per this project's own doctrine ("verification inside the
context that produced the evidence is not verification"; the same anti-self-dealing rule
already applied to FR-13/S7). The prompt is assembled from `ctx.label`, `ctx.legalAnswers`,
`ctx.exposedContext`, and a new node attribute `human.agent_instructions=` (inline text, the
author's guidance for how the agent should decide). The response is parsed into a routing
label the same way box-node verdicts already are (`backend/result.ts`'s `parseVerdict`, or a
narrowly-scoped sibling of it if the shapes diverge enough to warrant one — a decision for
implementation, not this design).

### 4. `CommandChannel` — the no-code extension point

Constructed from an operator-supplied command string (via `--channel name=command`, never
committed in a `.dot` file — config, not graph). `answer()` substitutes `${...}` tokens from
`GateContext` into the command exactly like `tool_command` nodes already do, spawns it, and
waits up to `timeoutMs`. **Reuses the existing routing-label convention verbatim**: the last
non-empty stdout line is the answer, matching how every other command-driven routing decision
in this engine already works — deliberately not a new format. Non-zero exit, or no output
within the timeout, means this hop produced no answer: `{label: null}`, escalate.

This is how Discord, Slack, or a bespoke ticketing system plug in: as a script satisfying this
contract, with zero platform-specific code anywhere in attractor's core, and zero new
dependencies (a Discord webhook needs nothing but an HTTP POST, which the *script* makes, not
this project). A first-party, dependency-free reference script for Discord (plain webhook
HTTP, no SDK) ships as a worked example, not as production code this project maintains.

### 5. Graph attributes

| Attribute | Meaning | Default |
| :-- | :-- | :-- |
| `human.channel` | Ordered, comma-separated channel chain, e.g. `"human,agent"` or `"discord,agent"`. Each name is `human`, `agent`, or a name an operator's `--channel` flag supplies for this run. | `"human"` — the opt-in decision: a gate is human-only, and thus subject to §6's refusal when unattended, unless the author explicitly names another channel. |
| `human.channel_timeout` | Duration per hop (reuses `duration.ts`'s existing parser — bare int = seconds, `ms`/`s`/`m`/`h` suffixes). One value applies to every hop, or a comma-separated list matches the chain position-by-position (last value repeats if the list is shorter than the chain). | Absent = no timeout on the first hop — waits on it exactly as today, matching "escalation is itself opt-in, not forced." |
| `human.context` | Comma-separated context keys exposed to every channel in the chain via `GateContext.exposedContext`. | Absent = no context exposed beyond the gate's own label. |
| `human.agent_instructions` | Author guidance text, used only by the `agent` channel. | Absent = the agent decides from `label`/`legalAnswers`/`exposedContext` alone. |

**Falling off the end of the chain** (last hop times out or returns `{label: null}`) falls
through to the **existing, completely unchanged** `timeout`/`on_timeout`/`human.default_choice`
doctrine — HITL-001 keeps enforcing "must name a real edge, no implicit fallback" exactly as
it does today. This design adds a layer in front of that rule; it does not touch the rule
itself, and no existing HITL-001 test needs to change.

### 6. Preflight refusal — resolves Open Question 2

**Not a `lint()`-time diagnostic** — `lint()` is invocation-independent pure static analysis,
and whether a gate's chain is viable depends on *this run's* actual attendance (is stdin a
TTY, was `--channel` supplied, is `claude` on PATH). This is instead a new preflight step,
run by `Engine.run()`/`cli.ts` immediately after the existing lint-refusal gate (ADR-004) and
before the first node dispatches — same "refuse before anything executes" principle as
HAND-001, applied with run-time context lint itself doesn't have.

For every human-gate node reachable from the start node (full static reachability — reuse
whatever traversal the TOPO-family lint rules already use rather than write a second one; a
node is "reachable" if *some* path of edges could reach it, regardless of which conditions
evaluate true at runtime, since preflight cannot know that in advance), resolve its
`human.channel` chain and check: is at least one hop viable for this invocation? `human` is
viable iff `isInteractive()`. `agent` is viable iff `--allow-agent-gates` was passed **and**
`claude` is discoverable (`probeTool`) — either missing makes it not viable, same treatment as
either one alone. A named channel is viable iff `--channel <name>=...` was supplied. **If no
hop in the chain is
viable, refuse the run** with a diagnostic naming the node, its declared chain, and why each
hop failed — before any node executes, any subprocess spawns, or any cost is incurred.

**Forward note, not scoped into this design:** `MANAGER_LOOP` sub-pipelines are still in
`UNREGISTERED_HANDLER_KINDS` (HAND-001 already refuses any graph containing one), so a human
gate reachable only through a not-yet-implemented subgraph cannot occur today. When manager_loop
ships, this reachability check needs to recurse into sub-pipeline graphs too — flagged for that
future design, not solved here.

## Error handling

- Chain names a channel not configured for this run → preflight refusal (§6), not a runtime
  surprise.
- Every hop in a configured chain is exhausted (timed out / no answer) with no `on_timeout`
  on the node → **already refused at lint time by existing, unmodified HITL-001** — a
  give-up edge is still mandatory, exactly as today.
- A `CommandChannel`'s script crashes mid-flight → non-zero exit, same as a timeout: this hop
  produced no answer, escalate.
- A channel returns a `label` that matches none of `GateContext.legalAnswers` → **not an
  error at the channel layer.** The answer still becomes `outcome.preferredLabel` and reaches
  `selectEdge` unmodified; since no unconditional edge's `label=` matches, `selectEdge`'s own
  existing steps 3-5 (suggested-next-id, then weight/lexical fallback) decide the edge exactly
  as they already do for any other node's unmatched `preferredLabel` today. `legalAnswers` is
  advisory (helps a channel implementation prompt correctly); it is not a validated contract
  enforced by the engine, and this design does not add such enforcement.

## Testing (detail deferred to the architecture pass that follows this spec)

Preflight reachability: fixture graphs with a gate behind various branch conditions, chains
mixing viable/non-viable hops, mutation-tested to the same standard as HAND-001 (independent,
non-self-referential derivation; both directions — fires when it should, silent when it
shouldn't). `CommandChannel`: fake scripts for fast unit coverage, one real end-to-end shell
script for realism, mirroring `StubBackend`'s role for tool nodes. `agent` channel: reuses the
box-handler test patterns (backend swap) already established. Escalation timing: an injectable
clock/fake timers, matching the existing retry-backoff test approach.

## Consequences

**We gain:** a complete, coherent answer to FR-8 and Open Questions 1-2, an extensibility
model with no core dependency growth, and a design that makes ADR-002's existing code the
`human` channel rather than discarding it.

**We accept:** this is real new surface — a new interface, two new built-in channels, four new
node attributes, a new CLI flag, and a new preflight step — sized closer to S2's original
FR-5/6/7/8 scope than to a single FR. It should be planned and implemented as its own unit,
not folded silently into the already-shipped architecture for the unblocked FRs. The agent
channel requires both the graph's opt-in and the operator's (`--allow-agent-gates`) — a
deliberate two-key decision, not left as an open question.

**We will need to revisit this if:** manager_loop subgraphs ship (reachability must recurse),
or a channel needs richer input/output than a single label (today's contract is deliberately
minimal, matching existing routing-label conventions).
