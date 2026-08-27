<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Over cap, declared: this spike's Context and acceptance criteria reproduce exact source
behavior (attractor's `runShell`/`selectEdge`/`tool.ts`) that the implementer needs to
avoid re-deriving from scratch, and ADR-011's own compiled acceptance-gate template — cutting either
would just move the re-derivation cost onto whoever picks this story up.
-->

---
id: attractor-handoff-03
title: "Spike — real timeout duration + hang fixture (OQ-3)"
status: draft
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: [NFR-2]
depends_on: []
size: S
---

# Spike — real timeout duration + hang fixture (OQ-3)

> This file is the complete context. Someone opening only this file — a teammate who
> missed the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

Answer `OQ-3` for real: pick attractor's per-attempt `timeout=` duration for a compiled
acceptance gate, with stated reasoning, and prove — with a real `attractor run --stub`
invocation, not a read of the docs — that an acceptance gate whose check hangs past that
duration terminates as `FAIL` and is treated as one consumed attempt, never a silent drop
and never an unbounded hang.

## Context

`NFR-2` (`prd.md`) requires a wall-clock timeout per acceptance-gate attempt, independent of
the attempt-count bound (`NFR-1`, a different story's job). Its target is "sized to realistic
check turnaround, not an arbitrary large number"; its verification method, verbatim: "a
fixture attempt engineered to hang terminates at the declared timeout and counts as one
consumed attempt." `architecture.md` already names the mechanism — attractor's own
documented `timeout=` node attribute (`plugins/attractor/README.md`, added via
`github.com/colombod/ai-augmentation-systems#40`→`#42`, closed during this initiative) —
and rates it "High" confidence because it's now native and merged. What's still open is the
actual number, and whether the mechanism composes cleanly with `ADR-011`'s specific compiled
acceptance-gate shape (not just a bare shell node) — the architecture doc doesn't say, and
this is the one story positioned to check.

**A real finding from reading the engine source, not a hunch:** `ADR-011`'s acceptance gate
is a `parallelogram` whose `tool_command=` runs the compiled check, *then* increments a
counter file, *then* prints `gate_pass`/`gate_retry`/`gate_giveup` on the last stdout
line — three edges route on `condition="context.tool.last_line=<label>"` string equality.
`core/shell.ts`'s `runShell` kills the whole process tree with `SIGKILL` when `timeout=`
fires, and resolves `code: 1` (non-zero). `handlers/tool.ts` returns `Status.FAIL` the
moment `result.code !== 0` — before ever reading `tool.last_line`, and the stale-label rule
means `tool.last_line` is **not written** on `FAIL`. So a hang inside the compiled check
(before the counter/label logic even runs) produces a `FAIL` whose `tool.last_line` never
equals any of the three labels. `core/edge-select.ts`'s own doc comment states the routing
rule plainly: *"when the node failed and no condition explicitly matched the failure, no
unconditional edge may carry it forward."* None of `ADR-011`'s three edges are unconditional
— all three are conditional and none match. Whether the run then dead-ends, or falls
through to a node-level `retry_target=`/`fallback_retry_target=` (README's Retries
section: consulted once on an ordinary `FAIL` with no matching edge, "instead of
dead-ending") is exactly what "counts as one consumed attempt" needs to be true against —
and `ADR-011` as currently written declares neither attribute on the acceptance gate's own
pass/fail node (the glossary's own term for the `goal_gate=true` node). This story observes
the real behavior and reports it; it does not redesign `ADR-011` — a genuine gap found here
routes to the Solution Architect, per this role's own boundary.

**Fixture location — this story's own choice, no shared convention exists yet** (verified:
`find` turned up no spike-fixtures directory for this initiative). `oq3`-prefixed filenames
in a dedicated subdirectory avoid colliding with `attractor-handoff-01`'s (Spike 5's)
fixtures even if it independently picks the same directory — both are parallel writers with
no shared state.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-hang.dot` | create — minimal 3-node pipeline: a bare `parallelogram` node with `tool_command="sleep 60"` and a short `timeout=`, proving the base mechanism |
| `plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-gate-loop.dot` | create — minimal `ADR-011`-shaped 2-node cycle (a fix step plus the acceptance gate's own pass/fail node) whose check hangs, proving (or disproving) the "counts as one consumed attempt" claim against the real compiled acceptance-gate shape |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/architecture.md` | modify — `NFR-2` row (target/confidence columns) and Spikes table row 2, both currently "Open"/pending, updated with the real chosen duration, real observed hang-interaction behavior, and a citable pointer if a gap is found |

## Interfaces and contracts to honor

Reproduced from `plugins/attractor/README.md` and engine source, not re-derived:

```
timeout="30s"   # bare integer = seconds; ms/s/m/h suffix accepted (core/duration.ts)
                # enforced in-process for both box and parallelogram nodes
                # absent/empty/unparseable = no timeout, not a default one
```

CLI: `node plugins/attractor/dist/attractor.js run <file>.dot --stub --cwd <scratch-dir> --run-dir <scratch-dir>/runs/<name>`
(committed bundle — rebuild via `cd plugins/attractor/engine && npm run build` only if it
looks stale). `--stub` replaces LLM (`box`) execution only; `parallelogram`/shell nodes
always run for real — so a bare `sleep 60` under `--stub` is a real, trustworthy test of
`timeout=`, not a simulated one.

CLI output contract (`cli.ts`): `status: <SUCCESS|FAIL>` / `path: ...` / `run: <dir>` on
stdout; process exit code `0` on `SUCCESS`, `1` on `FAIL`. `<run-dir>/events.jsonl` carries
`node.tool.start` / `node.tool.end` events, each timestamped (`ts`, ISO 8601); `node.tool.end`
carries `exitCode`. `<run-dir>/<node-id>/status.json` carries `outcome` (`"FAIL"`/`"SUCCESS"`).

## Relevant design decisions

- **`ADR-011`** — fixture 2 replicates its exact compiled shape in miniature (see Context's
  finding above for what specifically gets tested and why). This story verifies, it does not
  redesign: a genuine gap escalates to the Solution Architect, not a patch here.
- **`architecture.md`'s NFR-2 row** — currently "Open"/pending on this story; this is the
  cited spike (#2) its "High" mechanism-confidence rests on.

## Acceptance criteria

- [ ] `NFR-2` — A real per-attempt timeout duration is chosen with stated reasoning: time at
  least three representative real check commands this feature will realistically compile to
  (e.g. `node --test` against a single fixture file in this repo, `attractor lint` against a
  compiled `.dot`, a small `npm test`/build-style command), record the real elapsed times,
  and pick a value with comfortable headroom above the slowest measured case (proposed
  starting point: 120s / 2 minutes — confirm or adjust against real measurements, don't keep
  it un-evidenced). The final number and its reasoning are written into `architecture.md`'s
  `NFR-2` row, replacing "Open."
- [ ] `NFR-2` — `oq3-timeout-hang.dot` (`tool_command="sleep 60"`, `timeout="5s"`) run via
  real `attractor run --stub`: total wall-clock is close to 5s, not close to 60s (checked two
  ways — wall-clock around the CLI invocation, and the `node.tool.start`/`node.tool.end`
  timestamp delta in `events.jsonl` for the hung node); the node's outcome is `FAIL`
  (`status.json`'s `outcome` field, `node.tool.end`'s non-zero `exitCode`); the CLI reports
  `status: FAIL` and exits `1` — not a silent `SUCCESS`, not a process that never returns.
- [ ] `NFR-2` — `oq3-timeout-gate-loop.dot` run via real `attractor run --stub`: the actual
  routing behavior on the hang's `FAIL` is observed and recorded plainly — dead-end (no edge
  taken, per Context's finding) vs. resolved by a `retry_target=`/`fallback_retry_target=`
  added to the pass/fail node. A dead-end is written up as a real `ADR-011` gap and flagged
  to the Solution Architect by name — not silently patched here to make the test pass.
- [ ] Both fixtures pass `attractor lint` clean before being run (no `COND-001`, `HITL-002`,
  `DATA-002`, or `GATE-001` findings).
- [ ] `architecture.md`'s Spikes table row 2 (`OQ-3`) is marked answered with a one-line
  pointer to this story's real results, not left as an open row.

## Test approach

**Level:** empirical spike — a real `attractor run --stub` invocation is the oracle, no
synthetic substitute (consistent with this initiative's own accepted test strategy: `--stub`
is the integration oracle throughout `architecture.md`).
**Cases:**

| Case | Expected |
| :-- | :-- |
| Bare `parallelogram` hang, `timeout="5s"`, `tool_command="sleep 60"` | `FAIL`, wall-clock ≈5s not ≈60s, CLI exits 1 |
| Same, no `timeout=` set (control) | Command actually runs the full 60s — confirms the fixture's own baseline isn't already bounded by something else (e.g. a shell/CI default) |
| `ADR-011`-shaped acceptance gate, compiled check hangs before counter/label logic, `timeout=` set | Routing behavior observed and recorded (dead-end or fallback-resolved) — not assumed either way |
| `ADR-011`-shaped acceptance gate, compiled check hangs, `timeout=` **and** `retry_target="fix"` set on its pass/fail node | Confirms whether the documented fallback mechanism actually closes the gap, if case 3 found one |
| Three-plus real representative check commands, timed | Real elapsed times recorded, feeding the chosen duration's reasoning |

**Run with:**
```
node plugins/attractor/dist/attractor.js lint plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-hang.dot
node plugins/attractor/dist/attractor.js run  plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-hang.dot \
  --stub --cwd <scratch-dir> --run-dir <scratch-dir>/runs/oq3-hang
node plugins/attractor/dist/attractor.js lint plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-gate-loop.dot
node plugins/attractor/dist/attractor.js run  plugins/delivery/hooks/scripts/fixtures/attractor-handoff/oq3-timeout-gate-loop.dot \
  --stub --cwd <scratch-dir> --run-dir <scratch-dir>/runs/oq3-gate-loop
```
`<scratch-dir>` should be a disposable directory, not the repo working copy — the
`tool_command=`s here are harmless (`sleep`, a counter file) but this keeps the habit
consistent with the rest of this initiative's spikes.

## Out of scope

- `NFR-1`'s attempt-count bound and `validate-attractor-pipeline.js` (`OQ-2`, Spike 1) —
  that story depends on Spike 5's structure, not on this one.
- Redesigning `ADR-011` if a dead-end is found — reported with a citable pointer; the
  Solution Architect owns whether/how the pass/fail node's template changes.
- Whether `ADR-011`'s own file-based attempt counter under-counts a killed attempt (its
  increment line never runs if the hang happens before it) — a real, related residual, noted
  in findings but not chased further; a Phase-2-template concern once fallback routing is
  decided.
- Building Phase 2's compiler timeout wiring — this story proves the mechanism and lands the
  number; wiring it onto every generated pass/fail node is that phase's own work item.

## Dependencies

None. Entry criteria only: `attractor` plugin installed, `attractor doctor` passes
(`ADR-008`). Explicitly does not depend on `attractor-handoff-01` (Spike 5) — this story
builds its own minimal `ADR-011`-shaped fixture inline rather than reusing Spike 5's, so it
can genuinely run in parallel, per the roadmap's own sequencing note ("Entry criteria; can
run alongside Spike 5").

## Implementation notes

None yet — filled in during execution with the real measured durations, the real observed
routing behavior on fixture 2, and (if found) the citable escalation to the Solution
Architect.
