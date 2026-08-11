<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-01
title: Relocate runShell/lastNonEmptyLine from handlers/tool.ts to core/shell.ts
status: ready
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-8]
depends_on: []
size: S
---

# Relocate `runShell`/`lastNonEmptyLine` from `handlers/tool.ts` to `core/shell.ts`

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Move the existing, currently-private `runShell`/`lastNonEmptyLine` functions out of
`handlers/tool.ts` into a new `core/shell.ts`, exporting both, with **zero behavior change**.
This gives `channels/command.ts` (p2-05) a shared shell-spawn-and-capture-last-line primitive
without importing from `handlers/` (a non-handler concern reaching into handler-owned code — the
wrong dependency direction) or duplicating the spawn logic a second time.

## Context

`ADR-020` decided a new top-level `engine/src/channels/` directory needs its own home for a
primitive `handlers/tool.ts` already has, privately. Quoting the ADR's rejected alternative
directly: "`handlers/tool.ts`'s private `runShell` would also need exporting into a module
(`handlers/`) that a non-handler concern (`channels/`) would then depend on, an odd direction of
dependency for what's conceptually a leaf utility." The fix is a pure relocation. Today's code,
read directly (`handlers/tool.ts:1-40, 69-72`):
```ts
function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> { /* spawn('sh', ['-c', command], {cwd}), timeout via setTimeout+SIGKILL */ }
function lastNonEmptyLine(text: string): string { /* split \n, filter non-blank, take last, trim */ }
```
`ShellResult { code: number; stdout: string; stderr: string }` moves with them. `ToolHandler`'s
own class body, `TOOL_OUTPUT_KEYS`, and `writeStatus` are untouched — only the two free functions
move.

Per `ADR-020`'s own Consequences ("this move should land as its own commit, separate from
new-feature commits, so any regression is bisectable to 'the move' rather than 'the new code'")
and its Risks-table entry ("`core/shell.ts`'s relocation is a real, if mechanical, diff against
already-shipped, tested code... `tool.test.ts`'s existing assertions should pass unmodified"), the
acceptance bar for this story is regression, not new assertions.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/core/shell.ts` | create — `runShell`, `lastNonEmptyLine` (relocated verbatim, both exported), `ShellResult` |
| `plugins/attractor/engine/src/handlers/tool.ts` | modify — remove the two function bodies; import `runShell`/`lastNonEmptyLine` from `../core/shell.ts`; `ToolHandler` class, `TOOL_OUTPUT_KEYS` unchanged |
| `plugins/attractor/engine/test/tool.test.ts` | must pass unmodified — do not edit |

## Interfaces and contracts to honor

```ts
// core/shell.ts
export interface ShellResult { code: number; stdout: string; stderr: string }
export function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult>
export function lastNonEmptyLine(text: string): string
```

## Relevant design decisions

- **ADR-020** — full: this story is that ADR's shell-relocation half. New `channels/` directory
  needs `Channel` visible to non-handler code (`cli.ts`, preflight), so it can't live in
  `handlers/types.ts`; the shared shell primitive follows the same logic — relocate to a neutral
  module both `ToolHandler` and `CommandChannel` (p2-05) can import.

## Acceptance criteria

- [ ] `FR-8` (enabling) — `core/shell.ts` exports `runShell`/`lastNonEmptyLine` with identical
      signature and behavior to the versions removed from `handlers/tool.ts`.
- [ ] `ToolHandler` imports both from `core/shell.ts`; its own public behavior is byte-for-byte
      unchanged.
- [ ] `engine/test/tool.test.ts` passes with zero edits.
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions across the full
      suite.

## Test approach

**Level:** regression, not new assertions — `engine/test/tool.test.ts`'s existing suite, run
unmodified, is the acceptance test.
**Cases:**

| Case | Expected |
| :-- | :-- |
| existing `tool.test.ts` suite | passes with zero edits |
| `ToolHandler` behavior end-to-end | byte-for-byte unchanged from before the move |

**Run with:** `node --test test/tool.test.ts` (targeted, from `plugins/attractor/engine`), then
full `node --test`.

## Out of scope

- `CommandChannel` itself (p2-05, the only consumer this phase).
- Any shell-quoting logic (`ADR-026`, p2-05's job).
- Any behavioral change to `runShell`/`lastNonEmptyLine`.

## Dependencies

- None. Runs in parallel with p2-02.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
