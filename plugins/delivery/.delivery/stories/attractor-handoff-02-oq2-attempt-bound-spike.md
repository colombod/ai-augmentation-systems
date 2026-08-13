<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
-->

---
id: attractor-handoff-02
title: "Spike — real attempt-bound number (OQ-2)"
status: ready
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: [NFR-1]
depends_on: [attractor-handoff-01]
size: S
---

# Spike — real attempt-bound number (OQ-2)

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

**Cap 1200 words, this is ~1400.** Two real, source-verified corrections to the task's own
assumptions had to be kept, each with its full citation chain: the cited attractor PRD path
doesn't exist (real path differs) and its `engine.ts:199` citation is stale; the truncation
string lives in CLI stdout, not `events.jsonl` as assumed. Cutting either would hand the
implementer a spike that greps the wrong file for a day. The worked arithmetic and generalized
DOT fixture template are what make the story executable without further research — also kept.

## Goal

Turn `NFR-1` from "Open — sized to assumed max stories/sprint × max criteria/story × max
attempts/gate; must stay safely under the engine's 500-node-visit ceiling" into a real,
evidenced number. **The deliverable is the number and the evidence behind it — not necessarily
new production code.** Two real `attractor run --stub` executions must happen: one at an
assumed-max scale that completes on its own terms, one with exactly one of {stories,
criteria/story, attempts/gate} pushed past that max and genuinely hitting the shared step
ceiling. Arithmetic alone does not close this story — truncation must be observed, not
predicted.

## Context

`NFR-1` (`prd.md` line 167) bounds the sprint-wide attempt total — summed across **every**
acceptance gate in a sprint, not per story — against attractor's shared, pipeline-wide step
ceiling. Its "How verified" cell is the procedure this story executes verbatim: *"Run a test
sprint at the assumed max scale (stories × criteria × attempts) to completion without
truncation; confirm one dimension pushed past its assumed max does truncate, proving the bound
was sized, not accidentally safe."* `OQ-2` (line 183, Product Owner + QA Strategist, blocking
Architecture) is this number. `OQ-5` (line 186, max stories/sprint, Product Owner-owned) is
related but distinct — this spike produces evidence `OQ-5` can be ratified against, not a
closure of `OQ-5` itself.

`architecture.md`'s NFR table (line 103) gives the formula: `projected_visits ≈ 2 ×
Σ(attempt_bound per gate) + fixed_overhead`, built on `ADR-011`'s two-node-per-attempt gate/fix
structure (down from an earlier four-node estimate). Its Confidence cell reads plainly: *"High
on mechanism (now simpler and cheaper); number unproven."* This story proves it, the way Spike
1's own row (line 122) frames it: run the formula against an assumed max, confirm one dimension
past it truncates.

**Real ceiling, verified against source, not trusted secondhand.** The task's citation
`plugins/attractor/.delivery/prd.md` does not exist — the real file is
`plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md`, whose `NFR-1` row
(line 88) reads: `500 node-visits (engine.ts:199)`. That `engine.ts:199` citation is stale
against the current repo: the real constant is `DEFAULT_MAX_STEPS = 500` at `engine/src/core/
engine.ts:142`, enforced by `if (++this.stepCount > opts.maxSteps)` at `engine.ts:735`, inside
`executeNodeStep` — every dispatched node, including the graph's own `Mdiamond` start and
`Msquare` exit, passes through this check once. 500 is a fixed constant; no `cli.ts` flag
raises it.

**The truncation string does not live where the task assumed.** `events.jsonl`
(`engine/src/run/events.ts`) only ever receives `{ type: 'pipeline.end', node, status: 'FAIL'
}` on a step-cap stop — identical to a plain dead-end stop. The literal message —
`` `step cap of ${opts.maxSteps} reached without terminating` `` (engine.ts:736) — lives in
`RunResult.notes`, asserted directly by `engine.ts`'s own tests (`engine/test/
engine.test.ts:358,695,1469,4592,4616`, all `assert.match(result.notes ?? '', /step cap/i)`),
and printed to **stdout**: `` process.stdout.write(`notes:  ${result.notes}\n`) `` in `cli.ts`.
Grep captured stdout, not `events.jsonl`, for the truncation string.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/prd.md` | modify — `NFR-1`'s Target cell (line 167) replaces "Open" with the real number and the observed margin; `OQ-2` (line 183) closed with a dated Resolved note, same pattern as `OQ-14`–`OQ-17` (line 197); `OQ-5` (line 186) gets an evidence pointer, not a ratified answer — that's still Product Owner's call. |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/architecture.md` | modify — NFR table's `NFR-1` row (line 103), Confidence cell: "number unproven" → the real result; Spikes table row 1 (line 122) marked answered. |
| A scratch working directory (e.g. this session's scratchpad, or `/tmp`) | create — the two synthetic `.dot` fixtures and their `--run-dir` outputs. **Not** `.delivery/sprints/` — per `ADR-009` that path is for real compiled handoff artifacts; these are throwaway sizing fixtures with no real acceptance criteria behind them, and must not be mistaken for one later. |
| `plugins/delivery/hooks/scripts/validate-attractor-pipeline.js` | **if it already exists** (`attractor-handoff-06`), use it to compute `projected_visits` for both scenarios instead of hand-arithmetic. **If it does not exist yet**, apply the formula directly as shown below — do not wait for that story; it is not a dependency of this one. |

## Interfaces and contracts to honor

The sizing formula, reproduced from `architecture.md` line 103:

```
projected_visits ≈ 2 × Σ(attempt_bound per gate) + fixed_overhead
```

`ADR-011`'s gate/fix shape (`s{story}_c{criterion}__fix` / `__gate`), parameterized with a
bound so one template builds every synthetic gate in both fixtures. Each gate passes on
exactly its bound-th attempt, never earlier — the true worst case `NFR-1` must survive, not a
lucky early pass:

```
s{S}_c{C}__fix  [shape=box, prompt="sizing-spike node — content irrelevant under --stub"]
s{S}_c{C}__gate [shape=parallelogram, goal_gate=true,
   tool_command="c=$(( $(cat .sizing/s{S}_c{C} 2>/dev/null || echo 0) + 1 )); \
     echo $c > .sizing/s{S}_c{C}; \
     if [ \"$c\" -ge <BOUND> ]; then printf gate_pass; \
     elif [ \"$c\" -ge <BOUND> ]; then printf gate_giveup; \
     else printf gate_retry; fi",
   outputs="s{S}_c{C}.result"]

s{S}_c{C}__fix -> s{S}_c{C}__gate
s{S}_c{C}__gate -> <next pair's __fix, or exit if last> [condition="context.tool.last_line=gate_pass"]
s{S}_c{C}__gate -> s{S}_c{C}__fix                        [condition="context.tool.last_line=gate_retry"]
s{S}_c{C}__gate -> exit                                  [condition="context.tool.last_line=gate_giveup"]
```

`gate_giveup` is unreachable by construction (pass fires first the moment `c` reaches
`<BOUND>`) — routed to `exit` only so the graph is lint-legal, never actually taken. Chain
pairs linearly (`s1_c1 → s1_c2 → … → s10_c10 → exit`); `depends_on` topology doesn't affect a
pure node-**count** question, so a linear chain is an honest stand-in for Phase 2's real
dependency graph.

`RunEvent` written to `events.jsonl` (`events.ts`): `{ ts, type, node?, [key]: unknown }`.
Grep `"type":"node.start"` — one line per node genuinely dispatched, emitted only *after* the
step-cap check passes (`engine.ts:788`).

## Relevant design decisions

- **`ADR-011`** — the gate/fix shape and its two-node-per-attempt cost is what this formula is
  built on. This arithmetic is only as trustworthy as `attractor-handoff-01`'s confirmation the
  shape is real and lint-clean; if Spike 5 found a different per-attempt count, use that
  number, not 2.
- **`ADR-009`** — real handoff artifacts write to `.delivery/sprints/`, never elsewhere. These
  fixtures aren't real handoff artifacts and belong in scratch space, not that tree.

## Acceptance criteria

- [ ] `NFR-1` — A specific attempt-bound number (or a small table of stories × criteria/story
  × attempts/gate that fits) is decided and written into `prd.md`'s `NFR-1` Target cell,
  replacing "Open," together with the real observed node-visit count and margin below 500.
- [ ] A real `node dist/attractor.js run <max-scale-fixture>.dot --stub --run-dir <dir>`
  reaches its own natural exit — captured stdout contains `status: SUCCESS` (or a FAIL whose
  `notes:` line is **not** the step-cap string) and exit code matches; no `step cap` substring
  appears anywhere in stdout.
- [ ] A second real run, identical except exactly one of {stories, criteria/story,
  attempts/gate} pushed one past its assumed max, produces exit code `1` and stdout containing
  the literal string `step cap of 500 reached without terminating`.
- [ ] `events.jsonl` corroborates both runs independently of stdout: the max-scale run's
  `"type":"node.start"` line count is below 500 by a stated real margin; the pushed-past-max
  run's count is exactly 500 (the 501st dispatch is blocked before its own `node.start`).
- [ ] `prd.md`'s `OQ-2` row is closed with a dated Resolved note (pattern: line 197's
  `OQ-14`–`OQ-17` note) pointing at `NFR-1`'s Target cell.
- [ ] `architecture.md`'s NFR-1 Confidence cell and Spikes table row 1 no longer read "number
  unproven" / open — both state the real result.
- [ ] `OQ-5` gets a one-line evidence pointer to this spike's numbers (still open, still
  Product Owner-owned — this criterion is "evidence attached," not "OQ-5 resolved").

## Test approach

**Level:** Integration — real `attractor run --stub` executions against real `.dot` fixtures,
no LLM cost (pass/fail is pure shell arithmetic, the README's own `00-convergence-loop.dot`
technique). Matches `architecture.md`'s Test strategy row for "gate/fix loop convergence,
exhaustion" (line 152): integration, real `--stub`, no reimplemented checker.

**Worked scenario** — this story's proposed assumed-max, grounded in this repo's own largest
real sprint to date (`plugins/attractor/.delivery/sprints/4-human-gate-core.md`: 10 stories,
largest single story 10/10 criteria). Attempt bound 2 is a reasoned starting point — no real
`ADR-011` gate/fix pair has run at scale before `attractor-handoff-01`. `fixed_overhead = 2` is
this spike's own minimal `Mdiamond`/`Msquare` pair, not Phase 2's real bootstrap subgraph (out
of scope). Attempts/gate is the pushed dimension: it multiplies the full stories×criteria
product, the formula's biggest lever. If the real run disagrees with this table, the real run
is authoritative — report actual numbers, not the prediction.

| Scenario | Stories | Criteria/story | Attempts/gate | `Σ(attempt_bound)` | `projected_visits = 2×Σ + 2` | vs. 500 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Assumed max | 10 | 10 | 2 | 100 × 2 = 200 | 402 | under, 98 margin (19.6%) |
| Pushed past max (attempts/gate) | 10 | 10 | 3 | 100 × 3 = 300 | 602 | over — real run truncates at exactly 500 |

**Cases:**

| Case | Expected |
| :-- | :-- |
| Assumed-max fixture, `--stub` run | Reaches natural exit; stdout has no `step cap` text; `events.jsonl` node.start count ≈ 402, under 500 |
| One dimension (+1) past assumed max, `--stub` run | Exit code 1; stdout `notes:  step cap of 500 reached without terminating`; `events.jsonl` node.start count = exactly 500 |
| `events.jsonl` cross-check | Both runs' `"type":"node.start"` counts match the formula's prediction within the margin stated above — a mismatch means "must measure runtime step-visits, not static node count" (architecture.md's own QA correction, line 149) was right to worry |

**Run with:**
```
node <attractor-plugin-root>/dist/attractor.js run <fixture>.dot --stub \
  --run-dir <scratch-dir>/<scenario>-run > <scratch-dir>/<scenario>.stdout.txt 2>&1
grep -c "step cap" <scratch-dir>/<scenario>.stdout.txt
grep -c '"type":"node.start"' <scratch-dir>/<scenario>-run/events.jsonl
```

## Out of scope

- Writing or wiring `hooks/scripts/validate-attractor-pipeline.js` for real — separate Phase 1
  work item `attractor-handoff-06`; use it if already done, else do the arithmetic directly.
- Ratifying `OQ-5`'s final max-stories-per-sprint policy — Product Owner's call; this story
  hands over evidence, not a decision.
- Phase 2's real compiled bootstrap subgraph and its real `fixed_overhead` cost — this spike's
  `fixed_overhead = 2` is a minimal stand-in, not Phase 2's actual compiler output.
- `gate_giveup` / `FR-9`'s real non-convergent recording semantics — unreachable by
  construction in both fixtures (see Interfaces).
- `OQ-3` (timeout duration, Spike 2) — a distinct open question with its own story.

## Dependencies

- **`attractor-handoff-01` (hard, blocking).** This formula assumes `ADR-011`'s confirmed
  two-node-per-attempt structure and a lint-clean, actually-run gate/fix fixture. Do not start
  before `attractor-handoff-01` is `done`; if Spike 5's real result differs from 2 nodes/attempt,
  recompute the worked scenario from the confirmed shape first.
- **Not a dependency:** `attractor-handoff-06`. Use it if it exists when this story is picked
  up; if not, apply the formula directly — do not wait.

## Implementation notes

Record the real observed node-visit counts for both runs, the final decided attempt-bound
number, any divergence from this story's worked scenario (and why), and whether the
`events.jsonl` cross-check matched the formula's prediction — a mismatch is itself a finding
worth recording even if the spike's overall conclusion holds.
