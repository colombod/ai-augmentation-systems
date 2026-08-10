---
id: p6-01
title: TS-library packaging — index.ts entry point and package.json exports
status: ready
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-13]
depends_on: []
size: S
---

# TS-library packaging — index.ts entry point and package.json exports

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. See
[ADR-016](../decisions/ADR-016-ts-library-packaging.md) for the full design reasoning —
authoritative here, not re-derived.

## Goal

`plugins/attractor/engine` gains a single, stable, importable module entry point
(`src/index.ts`) re-exporting the engine's programmatic surface, and `package.json`
gains `main`/`types`/`exports` fields pointing at it. No runtime behavior changes — this
is a module-boundary addition only. This unblocks p6-06 (the execution-verification
harness needs to `import` `Engine`/`lint`/`RunResult`, not shell out and parse CLI text)
and directly answers the-author persona's own stated requirement, "use it from a claude
session or as a standalone program" (`.delivery/personas/the-author.md:49`).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/src/index.ts` | new — re-exports only, see Interfaces below |
| `plugins/attractor/engine/package.json` | modify — add `"main"`, `"types"`, `"exports"` fields; `"private": true` stays |
| `plugins/attractor/engine/test/index.test.ts` | new — imports only from `../src/index.ts`, no reach into `core/`/`dot/`/`handlers/`/`backend/` internals |

## Interfaces and contracts to honor

```ts
// engine/src/index.ts
export { Engine, defaultHandlers, type EngineOptions, type RunResult } from './core/engine.ts'
export { lint, hasErrors, Severity, type Diagnostic } from './dot/lint.ts'
export { parseDot } from './dot/parse.ts'
export { Handler, type HandlerKind, type Graph, type Node, type Edge } from './dot/graph.ts'
export { EventLog } from './run/events.ts'
export type { Backend } from './handlers/types.ts'
export { ClaudeCodeBackend } from './backend/claude.ts'
export { StubBackend } from './handlers/stub.ts'
export { Status } from './core/outcome.ts'
```

Confirm every one of these symbols is already exported from its cited module before
writing the re-export line — do not assume the names above are exact; `grep -n "export"`
each source file first (`core/engine.ts`, `dot/lint.ts`, `dot/parse.ts`, `dot/graph.ts`,
`run/events.ts`, `handlers/types.ts`, `backend/claude.ts`, `handlers/stub.ts`,
`core/outcome.ts`) and correct any mismatch — this list was compiled by reading those
files during architecture, not guaranteed letter-perfect.

```json
// engine/package.json — additions only, nothing else in the file changes
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

## Relevant design decisions

- **[ADR-016](../decisions/ADR-016-ts-library-packaging.md)** — full reasoning, why
  `.ts`-direct rather than a built `.js`/`.d.ts` output, why `"private": true` stays,
  alternatives considered (shelling to the CLI instead — rejected because CLI stdout is
  prose, not a typed contract).

## Acceptance criteria

- [ ] `FR-13` (enabling) — `engine/src/index.ts` exists and re-exports `Engine`,
      `defaultHandlers`, `EngineOptions`, `RunResult`, `lint`, `hasErrors`, `Severity`,
      `Diagnostic`, `parseDot`, `Handler`, `HandlerKind`, `Graph`, `Node`, `Edge`,
      `EventLog`, `Backend`, `ClaudeCodeBackend`, `StubBackend`, `Status`.
- [ ] A new test (`index.test.ts`) imports **only** from `../src/index.ts` — no import
      statement anywhere in the file reaches into `core/`, `dot/`, `handlers/`, `backend/`,
      or `run/` directly — and: (a) parses a small fixture graph with `parseDot`, (b)
      lints it and asserts `hasErrors(...)` is `false`, (c) constructs an `Engine` with
      `defaultHandlers(new StubBackend())` and runs it to a terminal `RunResult`, (d)
      asserts the `RunResult.status` is the expected value for that fixture.
- [ ] `engine/package.json` has `main`, `types`, and `exports` fields all pointing at
      `./src/index.ts`; `"private": true` is unchanged; no other field in the file
      changes (diff review, not just a passing test).
- [ ] `node --test` (from `plugins/attractor/engine`) passes, zero regressions — the
      new file, plus the full existing suite.

## Test approach

**Level:** integration (constructs and runs a real `Engine`, not a pure-function unit
test) — matches `box.test.ts`/`bundle.test.ts`'s own idiom of testing the shipped
surface end-to-end rather than internals. Use `StubBackend` so the test needs no `claude`
binary and stays fast/deterministic, same convention `cli.test.ts`'s `--stub` tests use.

Follow TDD: write `index.test.ts` importing from a not-yet-existing `../src/index.ts`
first (red — module not found), then create `index.ts` (green), then confirm the full
suite still passes.

**Run with (from `plugins/attractor/engine`):** `node --test test/index.test.ts`
(targeted) or `node --test` (full regression).

## Out of scope

- Any change to what `core/engine.ts`, `dot/lint.ts`, or any other module actually
  exports today — `index.ts` re-exports existing symbols, it does not add new ones to
  their source modules.
- A built `.js`/`.d.ts` output — see ADR-016's Alternatives.
- `npm publish` or any registry interaction — `"private": true` stays; this is a
  module-resolution surface for in-monorepo and direct-clone use only.

## Dependencies

None. This is the first story in Phase 6 and every other Phase 6 story that touches
code (p6-06) depends on it.
