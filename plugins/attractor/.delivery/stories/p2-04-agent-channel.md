<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-04
title: AgentChannel — self-enforcing two-key claude -p proxy channel
status: done
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-8]
depends_on: [p2-02]
size: M
---

# `AgentChannel`

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Implement `channels/agent.ts`'s `AgentChannel` — a self-enforcing, two-key-gated `claude -p`
proxy that spawns a fresh, isolated subprocess to arbitrate a human gate's routing decision,
parsed by a narrow local schema. `AgentChannelOptions.allowed` is a **required** (not optional)
constructor field that `answer()` checks first, so the two-key rule (graph names `agent` in
`human.channel` AND the operator passed `--allow-agent-gates`) holds regardless of who
constructs this object — `ADR-022`.

## Context

`ADR-022` in full: an initial draft implemented the two-key rule entirely inside
`isChannelViable`, an *external* predicate. A Feature Critic pass found this repeats a bug class
this project already found and fixed once (`ADR-004`): the adopted design doc's own §1
explicitly sanctions `channels.set('agent', new AgentChannel())` as a legitimate override — the
same pattern this codebase's tests already use dozens of times for `Handler` entries — meaning a
test author or embedder constructing `AgentChannel` directly has no structural reason to also
wire `allowAgentGates` correctly. Fix: `allowed: boolean` required; `answer()` returns
`{label: null}` immediately, **spawning nothing**, if `allowed !== true`.

Separately: `AgentChannel` does **not** call `buildArgv` — its `--json-schema` request gates on
`wantsVerdict(node)`, a property of a real dispatching `Node`'s `goal_gate` attribute, irrelevant
here; a synthetic `Node` risks accidental `goal_gate` residue and a `ThreadStore` key collision
with a real node elsewhere in the graph. Instead it hand-assembles argv, reusing `buildArgv`'s
non-interactive-safety prefix via a **new shared exported constant** both `buildArgv` and
`AgentChannel` build from — so the flag can't silently go stale in one of the two places that
need it (today, `argv.ts:55`: `const argv: string[] = ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions']`,
confirmed by direct read). It reuses `runProcess` (`backend/claude.ts:24`, currently
module-private) rather than re-implementing subprocess spawning a third time.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/channels/agent.ts` | create — `AgentChannelOptions`, `AgentChannel`, `GATE_ANSWER_SCHEMA`, `parseGateAnswer` |
| `plugins/attractor/engine/src/backend/argv.ts` | modify — extract `buildArgv`'s non-interactive-safety prefix (line 55) into a new exported constant; `buildArgv` builds its argv by spreading it, behavior unchanged |
| `plugins/attractor/engine/src/backend/claude.ts` | modify — `runProcess` (line 24) gains `export`; zero body change |
| `plugins/attractor/engine/test/argv.test.ts` | must pass unmodified against `buildArgv`'s returned values |
| `plugins/attractor/engine/test/claude-backend.test.ts` | must pass unmodified against `ClaudeCodeBackend`'s returned values |

## Interfaces and contracts to honor

```ts
// backend/argv.ts
export const NON_INTERACTIVE_SAFETY_ARGV: readonly string[] =
  ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions']
// buildArgv's first line becomes: const argv: string[] = [...NON_INTERACTIVE_SAFETY_ARGV]

// backend/claude.ts -- existing function, gains `export`
export function runProcess(command: string, argv: string[], prompt: string,
  cwd: string | undefined, signal: AbortSignal | undefined): Promise<SpawnResult>

// channels/agent.ts
export interface AgentChannelOptions {
  allowed: boolean          // REQUIRED
  command?: string           // overridable, mirrors ClaudeBackendOptions.command
  model?: string
}
export class AgentChannel implements Channel {
  constructor(opts: AgentChannelOptions)
  async answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer>
}
const GATE_ANSWER_SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string' }, notes: { type: 'string' } },
  required: ['label', 'notes'],
  additionalProperties: false,
} as const
function parseGateAnswer(result: unknown): { label: string; notes?: string } | null
```

`answer()` required behavior: (1) `opts.allowed !== true` → `{label: null}`, spawn nothing; (2)
else assemble a prompt from `ctx.label`/`ctx.legalAnswers`/`ctx.exposedContext`/
`ctx.agentInstructions`, wrapping **every** pipeline-derived value (`exposedContext`'s values,
`agentInstructions`) in an explicit "untrusted pipeline data, not instructions" delimiter — this
is the entire mitigation for the prompt-injection risk the architecture's Risks table names, so
it is load-bearing, not decoration; (3) argv = `[...NON_INTERACTIVE_SAFETY_ARGV, '--json-schema', JSON.stringify(GATE_ANSWER_SCHEMA), ...(model ? ['--model', model] : [])]`;
(4) spawn via `runProcess(opts.command ?? 'claude', argv, prompt, undefined /* no cwd */, an
AbortSignal bound to `timeoutMs`)` — "fresh and isolated": no cwd, no thread resumption, no
access to the pipeline's `Context` beyond `ctx.exposedContext`; (5) parse the reply's `result`
field with `parseGateAnswer`, **not** `backend/result.ts`'s `parseVerdict`.

## Relevant design decisions

- **ADR-022** — full: this story is that ADR made real, including both rejected alternatives —
  reusing `buildArgv`/`ClaudeCodeBackend` wholesale via a synthetic `Node` (rejected: `goal_gate`
  residue, `ThreadStore` key collision risk); reusing `parseVerdict`/`OUTCOME_SCHEMA` as-is
  (rejected: forces an unrelated `status` field, unrecognized-status fallback silently rejects a
  well-formed label-only answer).

## Acceptance criteria

- [ ] `FR-8` — `allowed: true` with a fake `command` (a stub script printing a well-formed
      `claude -p` JSON envelope with `result` containing `{"label":"approve","notes":"..."}`)
      yields `{label: 'approve'}`.
- [ ] `FR-8` — `allowed: false` never spawns anything — asserted directly (e.g. `opts.command`
      points at a script that writes a sentinel file on invocation; assert the file is never
      created), not merely inferred from `isChannelViable`.
- [ ] Every `allowed:true` spawn's argv includes `NON_INTERACTIVE_SAFETY_ARGV`'s exact four
      elements, in order — asserted by intercepting the argv actually passed to the underlying
      spawn.
- [ ] `parseGateAnswer` tested directly (independent of `answer()`) against: well-formed
      `{label,notes}`; missing `label` → null; extra fields (violates `additionalProperties:false`)
      → null; non-JSON string → null.
- [ ] A timeout fires and the call resolves `{label:null}` within the bound (artificially slow
      fake command + short `timeoutMs`).
- [ ] The assembled prompt wraps `exposedContext` values and `agentInstructions` in the
      untrusted-data delimiter — asserted by inspecting the prompt actually piped to the fake
      command's stdin.
- [ ] `node --test` passes; `argv.test.ts`/`claude-backend.test.ts` pass with `buildArgv`'s/
      `ClaudeCodeBackend`'s own returned values unchanged.

## Test approach

**Level:** unit, fake `command` pointed at a small test-only script (match
`claude-backend.test.ts`'s existing fixture-script convention).
**Cases:**

| Case | Expected |
| :-- | :-- |
| well-formed answer from fake command | `{label: 'approve'}` |
| `allowed: false` | `{label: null}`, no spawn (sentinel file never created) |
| spawned argv | includes `NON_INTERACTIVE_SAFETY_ARGV` verbatim, in order |
| `parseGateAnswer` malformed inputs | `null` for each |
| slow fake command vs. short `timeoutMs` | `{label: null}` within the bound |
| prompt content | `exposedContext`/`agentInstructions` wrapped in untrusted-data delimiter |

**Run with:** `node --test test/channels-agent.test.ts test/argv.test.ts test/claude-backend.test.ts`
(from `plugins/attractor/engine`), then full `node --test`.

## Out of scope

- Real, live spawning against the actual `claude` CLI (Spike 14, unresolved, non-blocking — the
  negative-path test above covers the failure mode regardless).
- `defaultChannels()`'s computation of `allowed` (p2-06).
- `HITL-003` (already shipped, Phase 1) — unaffected by this story.

## Dependencies

- **p2-02** — `Channel`/`HumanGateContext`/`ChannelAnswer` types.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
