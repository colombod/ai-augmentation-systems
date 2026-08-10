# ADR-016: A re-export-only `index.ts` library entry point, staying `private`

**Status:** accepted
**Date:** 2026-08-10
**Deciders:** Solution Architect

## Context

`engine/package.json` is `"private": true` with no `"main"`/`"types"`/`"exports"` field
at all. Every current consumer either shells to `dist/attractor.js` (the `attractor`
skill) or reaches into `core/engine.ts` by relative path (`cli.ts`, every test file).
There is no single, stable module boundary a piece of code outside `engine/src/`'s own
directory tree can import against.

Two things now need exactly that: `verify-run.ts` (ADR-017's execution-verification
harness), which needs `Engine`, `defaultHandlers`, `lint`, and a way to read back a
`RunResult` programmatically rather than parse CLI stdout text; and the-author
persona's own stated requirement, "use it from a claude session or as a standalone
program" (`.delivery/personas/the-author.md:49`) — a requirement about the *engine*
generally, not specific to this issue, but otherwise nowhere satisfied: today
"standalone program" only really means the CLI, not a library.

## Decision

Add `engine/src/index.ts` containing only re-exports (`Engine`, `defaultHandlers`,
`EngineOptions`, `RunResult`, `lint`, `hasErrors`, `Severity`, `Diagnostic`, `parseDot`,
`Handler`, `HandlerKind`, `Graph`/`Node`/`Edge`, `EventLog`, `Backend`,
`ClaudeCodeBackend`, `StubBackend`, `Status`) — no new logic, nothing not already
exported from its own module. Add `"main"`, `"types"`, and `"exports": { ".":
"./src/index.ts" }` to `package.json`, pointing at the `.ts` source directly (no build
step, matching the existing "Node ≥ 24 native TS stripping" convention every test file
already relies on). `"private": true` stays.

## Alternatives considered

### Build a `.js`/`.d.ts` output and point `exports` at that instead

**Why it was attractive:** conventional npm-package shape; works for a consumer
without native TS support.
**Why rejected:** no consumer needing that exists — `verify-run.ts` lives inside this
same monorepo and every other current consumer already runs under Node's native TS
stripping. Adding a second build target duplicates `dist/attractor.js`'s existing job
(a bundled CLI) for a need nothing has. Revisit only if a real external, non-TS-native
consumer shows up.

### Skip the library entry point; have `verify-run.ts` shell out to `dist/attractor.js run --stub` and parse stdout

**Why it was attractive:** zero new code, reuses the already-shipped, already-tested CLI
path exactly as the `attractor` skill does today.
**Why rejected:** the CLI's stdout is prose for a human operator, not a contract — no
`RunResult` fields are typed or guaranteed stable across CLI wording changes, and
`verify-run.ts`'s entire job is to produce an unambiguous, greppable line
(ADR-017's own contract) — building that by re-parsing another program's log output is
strictly worse than reading the typed value that already exists.

## Consequences

**We gain:** one stable module boundary; `verify-run.ts` reads a real `RunResult`
object instead of parsing text; the-author persona's "standalone program" requirement
now has a real answer beyond the CLI.

**We accept:** `package.json` now carries fields (`main`/`types`/`exports`) that, taken
alone, look publish-ready — misleading without this ADR's own stated scope (in-monorepo
and direct-clone consumption only; the registry-proxy constraint in root `AGENTS.md`
is unchanged and nothing here works around it).

**We will need to revisit this if:** a consumer outside this monorepo (a different
plugin, a genuinely external project) needs to depend on this package — that would be
the point at which "private, path-based" stops being sufficient and real publishing
(or a workspace-protocol reference) becomes a live question, not before.
