<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-05
title: CommandChannel — shell-quoted substitution, operator-supplied external script
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-8]
depends_on: [p2-01, p2-02]
size: M
---

# `CommandChannel`

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Implement `channels/command.ts`'s `CommandChannel` — the no-code, operator-supplied
external-script extension point, substituting `HumanGateContext` fields into a
`${...}`-templated command string via the existing `core/substitute.ts` engine, but — diverging
deliberately from `tool_command`'s unescaped reuse of the same mechanism — shell-quoting every
substituted **value** (POSIX single-quote escaping) before splicing, closing a real
shell-injection path `ADR-026` records.

## Context

`core/substitute.ts` (`substitute.ts:43-58`, verified by direct read) does single-pass,
**unescaped** textual token replacement — a context value containing `;`, backtick, `$(...)`,
`|` is spliced verbatim into a string later handed to `spawn('sh', ['-c', command], {cwd})`.
`tool_command`'s existing, accepted use of the same unescaped `substitute()` is safe only because
its command is graph-**author**-written and its substituted values come from the **same trust
domain**. `CommandChannel`'s trust shape differs: its command is operator-supplied (`--channel
name=command`, real config the operator wrote and trusts) but its values come from
`HumanGateContext.exposedContext` — populated by `human.context=`, explicitly meant (PRD/
`ADR-006`) to expose upstream `Handler.TOOL`/`Handler.CODERGEN` output (a fetched issue body, a
PR diff, LLM-generated prose) the operator never reviewed. Splicing that unescaped would let a
hostile or careless upstream value achieve arbitrary command execution on the operator's own
machine. Fix: wrap each substituted value in `'…'`, replace any embedded `'` with `'\''` — the
`${...}` token-replacement mechanism itself (`core/substitute.ts`) is **not modified**; only the
values reaching the shell are quoted, at the `CommandChannel` call site alone.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/channels/command.ts` | create — the only production file this story touches |
| `plugins/attractor/engine/src/core/substitute.ts` | must remain unmodified |

## Interfaces and contracts to honor

```ts
export class CommandChannel implements Channel {
  constructor(command: string)
  async answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer>
}
```

Required behavior: build a flattened substitution record — `{nodeId: ctx.nodeId, label: ctx.label,
legal_answers: ctx.legalAnswers.join(','), ...ctx.exposedContext, agent_instructions:
ctx.agentInstructions ?? ''}` — feed it through `substitute()` (adapt via a throwaway
`Context.from(record)` or equivalent), with **every substituted value** shell-quoted before
splicing (verified by a test asserting a value containing `; rm -rf /` or a backtick appears as a
literal, inert argument, never as executable syntax). Spawn via `runShell(quotedCommand,
process.cwd(), timeoutMs ?? 0)` — cwd is explicitly `process.cwd()` (the operator's own
invocation directory), **not** any per-node cwd (`HumanGateContext` has none — mirrors
`AgentChannel`'s own "fresh and isolated" framing). Non-zero exit, or zero exit with an empty
`lastNonEmptyLine(stdout)`, both map to `{label: null}`; otherwise `{label: lastNonEmptyLine(stdout)}`.

## Relevant design decisions

- **ADR-026** — full: the shell-quoting requirement is the entire point of this story.
- **ADR-020** — why `core/shell.ts` (p2-01) exists as a shared module rather than a private
  second copy here.

## Acceptance criteria

- [ ] `FR-8` — a real, committed test-only shell script that echoes a value back, invoked via
      `CommandChannel` with a benign `exposedContext` value, produces the script's last stdout
      line as the label.
- [ ] `FR-8` — non-zero exit → `{label: null}`.
- [ ] `FR-8` — zero exit + empty/whitespace-only stdout → `{label: null}`.
- [ ] Shell-quoting closes the injection path (`ADR-026`'s own falsification test): a value
      containing `; rm -rf /` (or a backtick command-substitution attempt) passed to a script
      that echoes its raw received argument(s) back appears verbatim, literally — no evidence
      the shell interpreted it as syntax. Mutation-checked: reverting the quoting must turn this
      test red.
- [ ] `core/substitute.ts` is unmodified — `tool.test.ts`/`substitute.test.ts` pass unmodified.
- [ ] `timeoutMs` bounds the spawned process (a sleeping script is killed; the call resolves, not
      hangs).
- [ ] `node --test` passes, zero regressions.

## Test approach

**Level:** unit + one real script (`runShell` genuinely calls `spawn('sh', ...)`, so the
shell-quoting test needs a real spawned shell — no amount of mocking substitutes for it).
**Cases:**

| Case | Expected |
| :-- | :-- |
| benign value, echoing script | last stdout line as label |
| non-zero exit | `{label: null}` |
| empty/whitespace stdout, zero exit | `{label: null}` |
| `; rm -rf /` / backtick in a value | appears literal in the script's received argument, not executed |
| sleeping script vs. short `timeoutMs` | killed, call resolves (not hangs) |

**Run with:** `node --test test/channels-command.test.ts` (new file, from
`plugins/attractor/engine`; fixture script matching `worktree.test.ts`'s own `mkdtempSync`-based
convention).

## Out of scope

- `cli.ts`'s `--channel name=command` parsing and construction (p2-09).
- `defaultChannels()` composition (p2-06) — `CommandChannel`s are added by `cli.ts` on top,
  never inside `defaultChannels()` itself.

## Dependencies

- **p2-01** — `core/shell.ts` (`runShell`/`lastNonEmptyLine`).
- **p2-02** — `Channel`/`HumanGateContext`/`ChannelAnswer` types.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
