<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
-->

---
id: p2-10
title: Real-subprocess non-TTY fail-fast test (FR-5); full HITL-001 regression re-run (FR-7)
status: done
epic: Phase 2 — FR-5-8 (human-gate channels)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 2
requirements: [FR-5, FR-7]
depends_on: [p2-09]
size: S
---

# FR-5 real-subprocess verification + FR-7 acceptance confirmation

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Prove FR-5's core claim — "a pipeline reaching a human-gate node blocks the process; no `status:`
line is printed and the process remains alive until answered" — against the actual, real
OS-level built CLI (`dist/attractor.js`), not a mocked or in-process proxy, by spawning it with
ordinary piped (non-TTY) stdin against a human-gate fixture and confirming it exits promptly via
the fail-fast branch with the stderr `ADR-002` promises — extending `bundle.test.ts`'s existing
real-subprocess pattern. Re-run the full, pre-existing HITL-001 suite as the literal, final FR-7
acceptance check for the whole phase.

## Context

Per the architecture's own "Deliberately thin, stated honestly" note: "the TTY-blocking branch's
'process remains alive' claim (FR-5, the `human`-only interactive case) is verified only by the
in-process fake-wait-plus-timer unit test [p2-03], not by a real pty-backed subprocess... this
project caps runtime/dev dependencies at 2 (NFR-6) and has deliberately not taken on a pty
dependency." This story's real-subprocess test therefore targets the **other** branch — non-TTY
fail-fast — which `execFileSync`'s default piped stdio gives for free (no pty needed), and which
is the literal, sanctioned FR-2-invocation-path claim `ADR-002` exists to guarantee. Per
`ADR-023` and the architecture's Risks table's first row, state explicitly: this test — and any
FR-8 acceptance demo generally — **cannot** use `human.channel="human"` alone to demonstrate an
answer being delivered; that half is already covered by p2-04's/p2-05's own unit+real-script
tests.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/engine/test/bundle.test.ts` | extend — one new test, extending the existing `execFileSync('node', [BUNDLE, 'run', ...], {cwd, encoding:'utf8'})` pattern already in that file — or add a new file if `bundle.test.ts`'s existing scope shouldn't grow further; state the choice in Implementation notes |

## Interfaces and contracts to honor

None new — tests only, against already-shipped public surface (this story's build depends on
every prior p2 story having landed, since it exercises the real built CLI end to end).

## Relevant design decisions

- **ADR-002** — the exact behavior under test (TTY-check block-vs-fail-fast).
- **ADR-023** — why this test cannot demonstrate a real answer via `human` alone.

## Acceptance criteria

- [ ] `FR-5` — a fixture DOT graph with a reachable `hexagon` node, run via
      `execFileSync('node', [BUNDLE, 'run', file, '--cwd', dir, '--run-dir', ..., '--stub'],
      {cwd: dir, encoding: 'utf8'})` with default (piped, non-TTY) stdio, exits non-zero.
- [ ] `FR-5` — no `status:` line is ever printed; the process fails fast and returns within a
      short, explicit wall-clock bound (a genuinely hung process fails the test by timing out —
      the correct failure mode for a claim about not hanging).
- [ ] `FR-5` — stderr names the gate/its non-viable chain. Note in the test's own comment which
      refusal path is actually exercised: a `hexagon` node with default `human.channel` and no
      CLI flags is caught at the **CLI's fast-path preflight** (p2-09), not `HumanGateHandler`'s
      dispatch loop — confirm this is the actual path, don't assume it.
- [ ] `FR-7` — `lint.test.ts`'s full 8-test HITL-001 suite passes, re-run as part of this story;
      record this explicitly in Implementation notes as the literal FR-7 acceptance confirmation
      for the whole phase.
- [ ] `node --test` passes in full, zero regressions — the final gate for the phase.

## Test approach

**Level:** integration, real subprocess, extending `bundle.test.ts`'s own `execFileSync`/
`mkdtempSync`/`rmSync` pattern. Requires `npm run build` to have produced a `dist/attractor.js`
reflecting every prior story, **including p2-09's CLI wiring** — the reason this story is last
and depends on p2-09 specifically.
**Cases:**

| Case | Expected |
| :-- | :-- |
| real built CLI, non-TTY stdin, `hexagon` gate fixture | non-zero exit, fast, no `status:` line |
| stderr content | names the gate and its non-viable chain |
| refusal path attribution | confirmed to be CLI fast-path preflight, not `HumanGateHandler` |
| full HITL-001 suite | 8/8 pass |

**Run with:** `npm run build` (in `plugins/attractor/engine`), then `node --test test/bundle.test.ts`,
then full `node --test`.

## Out of scope

- Any further code change to `cli.ts`/the channels/handler stack (verification-only).
- A real pty-backed test of the interactive TTY-blocks branch (permanently out of scope this
  slice, per NFR-6).
- FR-8's answer-delivery demonstration via `agent`/`CommandChannel` (already covered, p2-04/p2-05).

## Dependencies

- **p2-09** — needs the built CLI to reflect the real `--allow-agent-gates`/`--channel` flag
  wiring, not just the earlier registration.

## Implementation notes

Extended `bundle.test.ts` (did not add a new file) — its existing `execFileSync`/`mkdtempSync`/
`rmSync` pattern needed no adaptation beyond catching the expected non-zero-exit throw.

Confirmed the refusal path directly: the `hexagon` gate fixture with default `human.channel` and
no CLI flags is caught by the CLI's own fast-path preflight (p2-09), asserted via the exact stderr
text (`refusing to run: a reachable human gate...`) that string literal is unique to `cli.ts`'s
own preflight block, distinct from `Engine.run()`'s copy (`graph has a reachable human gate...`)
and from `HumanGateHandler`'s own FAIL notes — confirming which of the three copies actually fired,
not merely that refusal happened somewhere.

**One real, unanticipated technical snag:** the FR-7 nested `node --test test/lint.test.ts`
invocation silently produced empty output the first time — Node's own test-runner recursion guard
("run() is being called recursively within a test file. skipping running files.") fired because
this test file is itself spawned as a `node --test` child (isolation mode sets
`NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` in its env), and those two vars leaked into the nested
child via inherited `process.env`. Fixed by stripping both before spawning. Not named in any prior
document — a pure implementation-time discovery.

Final: Phase 2 (FR-5-8) complete. 731 tests, 729 pass, 2 skipped, 0 fail.
