---
id: p6-06
title: Delegated execution-verification gate (FR-13) — verify-run.ts harness + Step 4 wiring
status: done
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-13]
depends_on: [p6-01, p6-05]
size: M
---

# Delegated execution-verification gate (FR-13)

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. This is this project's own extension, not a port — see
[ADR-017](../decisions/ADR-017-delegated-execution-verification.md), authoritative
here, not re-derived. Do not redesign the `--stub`-by-default choice or the two-gate
structure mid-implementation; if the real code disagrees with anything ADR-017 asserts,
stop and report rather than silently adjusting the design.

## Goal

`attractorify`'s Step 4 gains a second independent-verification gate, after the ported
diagnosis-verifier (p6-05) and after the `.dot` is drafted and lint-clean: a fresh-context
Task-tool subagent runs `verify-run.ts <path> --stub` and reports its stdout verbatim.
A graph cannot be handed back as `ready` without that literal `VERIFIED: status=...
path=...` line and the `events.jsonl` path present in the handback. This is FR-13's
actual requirement — a real, engine-produced execution transcript, from a process that
did not author the graph.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/skills/attractorify/verify-run.ts` | new — the harness, imports from `engine/src/index.ts` (p6-01) |
| `plugins/attractor/engine/test/verify-run.test.ts` (or a colocated test next to the harness — see Test approach) | new |
| `plugins/attractor/skills/attractorify/SKILL.md` | modify — add the execution-verification gate to Step 4, after p6-05's diagnosis-verifier gate |

## Interfaces and contracts to honor

```ts
// skills/attractorify/verify-run.ts
// Usage: node verify-run.ts <graph-path> [--run-dir <dir>] [--stub | --live]
// Default: --stub. Imports Engine, defaultHandlers, lint, hasErrors, StubBackend,
// ClaudeCodeBackend from '../../engine/src/index.ts' (relative — no package
// resolution needed inside this monorepo, per ADR-016).
//
// Behavior:
//  1. Read and parseDot(graphPath).
//  2. lint(graph); if hasErrors(diagnostics), print the diagnostics and exit 1
//     WITHOUT running — mirrors FR-11's existing embedder guarantee (a lint-dirty
//     graph never runs, embedded or CLI).
//  3. Construct Engine with defaultHandlers(stub ? new StubBackend() : new ClaudeCodeBackend()).
//  4. run(); on completion print EXACTLY two lines to stdout, nothing else:
//       VERIFIED: status=<RunResult.status> path=<comma-joined final node path>
//       events: <run-dir>/events.jsonl
//  5. Exit 0 regardless of the graph's own terminal status (a graph that correctly
//     reaches FAIL is a successfully verified run of a graph that fails — exit 1 is
//     reserved for the harness itself failing to run the verification, e.g. the lint
//     refusal in step 2, or a thrown exception).
```

**Step 4 wiring (SKILL.md addition):** after the diagnosis-verifier gate (p6-05) returns
`VERIFIER: VALID` (or a valid `override:` skips it) AND the drafted `.dot` passes
`attractor lint` with no ERROR diagnostic, invoke the Task tool with an instruction
containing only: the graph's file path, the literal command to run
(`node <path-to>/verify-run.ts <graph-path> --stub`), and an instruction to report the
exact stdout verbatim, nothing summarized or interpreted. The authoring session must not
proceed to a `ready` handback without that subagent's literal output pasted into the
handback (per ADR-017, this mirrors the diagnosis-verifier's own isolation property).

## Relevant design decisions

- **[ADR-017](../decisions/ADR-017-delegated-execution-verification.md)** — full
  reasoning for `--stub`-by-default, the two-gate structure, and why this is not simply
  "the diagnosis-verifier, but for the graph" (a genuinely different claim being
  verified).
- **[ADR-016](../decisions/ADR-016-ts-library-packaging.md)** — why `verify-run.ts`
  imports from `index.ts` rather than shelling to the CLI and parsing stdout.

## Acceptance criteria

- [x] `FR-13` — `verify-run.ts` refuses to run a lint-ERROR graph (prints diagnostics,
      exits 1, no `Engine.run()` call attempted) — a fixture graph with a deliberate
      `TOPO-001` violation (two start nodes) proves this.
- [x] `FR-13` — on a valid graph, `verify-run.ts --stub` prints exactly the
      `VERIFIED: status=... path=...` line and the `events: <path>` line, and nothing
      else on stdout (a test asserts the exact line count / format, not just "contains
      VERIFIED somewhere").
- [x] `FR-13` — the printed `events:` path is real: the file exists after the run and
      is parseable as newline-delimited JSON.
- [x] `FR-13` — `verify-run.ts --live` (or without `--stub`) constructs a
      `ClaudeCodeBackend` instead of `StubBackend` — confirmed by code inspection (the
      `stub ? new StubBackend() : new ClaudeCodeBackend()` ternary is directly visible
      and simple enough that a dedicated test would only re-assert the same line), not by
      an actual live run, matching `p5-09`'s own precedent for the opt-in live-subprocess
      test.
- [x] `SKILL.md`'s Step 3 documents the execution-verification gate (item 7) as a
      **second, separate** gate from the diagnosis-verifier (Step 1) — both required,
      neither substitutes for the other, and the handback template (item 8) requires the
      literal verified-run output.
- [x] `node --test` (from `plugins/attractor/engine`) passes, zero regressions (649
      tests, 647 pass, 2 skipped, 0 fail).

## Implementation notes

`verify-run.ts` lives at `skills/attractorify/verify-run.ts` (not under `engine/`) since
it's part of the skill's own tooling, not the engine — but its test
(`engine/test/verify-run.test.ts`) lives under `engine/test/` and imports it by relative
path, so it runs under the existing `node --test` invocation from `engine/` without a
second test runner. `Diagnostic`'s actual field name is `node` (not `nodeId`, which the
story's own sketch used) — caught immediately by TypeScript during implementation, fixed
before the first test run.

Core logic (`verifyRun`) is a plain async function returning `{harnessOk, output}`
rather than printing directly — makes the exact-output-format assertions in the test
suite precise without mocking `console.log`, per the story's own suggested design. A
thin `cliMain`/`import.meta.main` wrapper handles the real CLI invocation and printing;
manually verified end-to-end as a real script (not just via the test's function calls)
against both a valid graph (`exit 0`, correct two-line output) and a lint-dirty one
(`exit 1`, names the actual `TOPO-001` diagnostic).

## Test approach

**Level:** integration — `verify-run.ts` is a small CLI-shaped script; test it the way
`cli.test.ts` tests `dist/attractor.js`'s CLI surface (spawn or directly invoke its
`main`-equivalent function against fixture graphs, assert stdout/exit code). Follow TDD:
write the lint-refusal test and the valid-run test against a not-yet-existing
`verify-run.ts` first (red), then implement (green).

Decide during implementation whether `verify-run.ts`'s core logic should be a plain
function exported for direct testing (preferred — avoids spawning a subprocess per test,
matching how `cli.test.ts` itself is structured per its own file) with a thin
`if (import.meta.main)`-style CLI wrapper, rather than testing only via subprocess spawn.

**Run with:** `node --test test/verify-run.test.ts` (targeted, from `engine/`, if
colocated there) or the equivalent path if the test lives under `skills/attractorify/`.

## Out of scope

- The diagnosis-verifier gate itself — p6-05 (dependency, not scope; this story only
  adds the second gate after it).
- Actually running `--live` against a real `claude` binary as part of the automated
  test suite — opt-in only, same precedent as `p5-09`.
- Any change to `engine/src/core/engine.ts`'s `run()` behavior — `verify-run.ts` is a
  thin consumer of the existing, unchanged `Engine`/`lint` surface.

## Dependencies

Depends on p6-01 (imports `engine/src/index.ts`) and p6-05 (Step 4's diagnosis-verifier
gate must already exist in `SKILL.md` for this story to add the second gate after it,
rather than inventing Step 4 from nothing).
