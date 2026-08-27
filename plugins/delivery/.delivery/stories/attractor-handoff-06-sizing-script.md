<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.

This story is ~1,380 prose words (excluding code/YAML/tables), over the 1200 cap.
Declared, not silent, and already trimmed once from ~1,590: it reproduces a real formula
and CLI/function contract in full (per the assigning brief's explicit instruction, "not
vague"), carries eight falsifiable acceptance criteria mapped one-to-one to
architecture's QA-strategist-mandated boundary cases (exactly-at-bound, bound+1,
malformed `.dot`, an `outputs=`-unowned-key case), and cites four real, load-bearing
sources (`ADR-011`, architecture's `NFR-1` row, its Test strategy row, and a corrected
path to the 500-node-visit ceiling's real citation). Trimming further would cut exactly
the content this budget note's own exception list protects.
-->

---
id: attractor-handoff-06
title: Build validate-attractor-pipeline.js (NFR-1 sizing script)
status: ready
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: [NFR-1]
depends_on: [attractor-handoff-01]
size: M
---

# Build validate-attractor-pipeline.js (NFR-1 sizing script)

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Goal

Given one compiled attractor `.dot` pipeline, get a real, computed answer — not an
agent's estimate — to whether its worst-case attempt exhaustion would exceed
attractor's shared 500-node-visit step ceiling, with a declared safety margin. When it
doesn't fit, the script says so clearly and exits non-zero, so nothing downstream ever
writes a handoff artifact sized past a bound the engine will simply cut off mid-run.

## Context

`NFR-1` requires a sprint's total attempt bound — summed across **every acceptance
gate**, not just per story — to stay under attractor's real, confirmed 500-node-visit
step cap (`plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md:88`,
`engine.ts:199`; the PRD row for this initiative cites this loosely as
`plugins/attractor/.delivery/prd.md`, a path that doesn't exist — corrected here).
Architecture's `NFR-1` row demands "real code, not agent arithmetic": an LLM estimating
whether a pipeline fits under budget is exactly the unverifiable claim this initiative's
`Traceable`/`Untraceable` distinction (glossary) exists to rule out. This story builds
that code.

The formula corrects an earlier, wrong estimate — architecture's Test strategy table
names this a QA-strategist correction: sizing must count **runtime step-visits**, every
pass through the retry loop, never the **static** node count in the `.dot` source. A
`.dot` with one `fix`/`gate` pair bound at 5 attempts declares 2 static nodes, but a
worst-case run visits `fix` and `gate` five times each — 10 visits, not 2. `ADR-011`
fixes the multiplier at exactly 2 node-visits per attempt (`fix`+`gate`, no separate
bound-check node), replacing an earlier four-node estimate. Confirming "2" is real, not
assumed, is exactly what `attractor-handoff-01` (Spike 5) does: build the loop as a real
fixture, lint it clean, run three real `attractor run --stub` cycles, and read actual
node-visit counts from `events.jsonl`. This story hard-depends on that result — a
different real count means the constant `2` below must change first.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/scripts/validate-attractor-pipeline.js` | create — sizing script: parses a compiled `.dot`, extracts each acceptance gate's declared attempt bound, computes projected worst-case node-visits, exits non-zero with a clear refusal message when that exceeds the declared safety margin below the ceiling |
| `plugins/delivery/hooks/scripts/validate-attractor-pipeline.test.js` | create — `node --test` unit tests covering the formula and every boundary case below |
| `plugins/delivery/hooks/scripts/record-invocation.js` | reference only — this plugin's real precedent for standalone Node tooling under `hooks/scripts/`: CommonJS, small pure functions exported via `module.exports` for direct unit testing, a thin `main()` wrapping I/O, a top-level guard so a failure never throws past its own boundary |
| `plugins/delivery/hooks/scripts/record-invocation.test.js` | reference only — this plugin's `node --test` style: `node:test` + `node:assert/strict`, one `fs.mkdtempSync` scratch fixture per test, no shared mutable state |
| `plugins/delivery/.delivery/decisions/ADR-011-bounded-retry-mechanism.md` | read — defines the exact two-node (`fix`+`gate`) generated `.dot` shape this script parses |
| `plugins/attractor/README.md` | read — documents `goal_gate=`, `shape=parallelogram`, `tool_command=`, `outputs=` attribute syntax and quoting this script's parser must handle |

## Interfaces and contracts to honor

```
Formula (ADR-011 / architecture.md's NFR-1 row):

  projected_visits ≈ 2 × Σ(attempt_bound per gate) + fixed_overhead
  budget            = ceiling − safety_margin
  refuse when         projected_visits > budget

  ceiling        = 500   (attractor's real step cap; confirmed at
                           plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md:88,
                           engine.ts:199 — DEFAULT_MAX_STEPS)
  safety_margin  = caller-supplied, no invented default   (OQ-2 / Spike 1 territory)
  fixed_overhead = caller-supplied, no invented default   (bootstrap subgraph cost,
                                                            OQ-2 / Spike 1 territory)

Only "2" and "500" are load-bearing constants this story may hardcode — both are
independently confirmed (attractor-handoff-01 for the 2; attractor's own PRD for the
500). safety_margin and fixed_overhead are explicit parameters, never silently
defaulted to an invented number.
```

Gate node shape this script targets, reproduced verbatim from `ADR-011`:

```
s3_c2__fix  [shape=box, prompt="<criterion text, FR-n, prior failure evidence>"]
s3_c2__gate [shape=parallelogram, goal_gate=true,
             tool_command="<compiled check>; c=$(( $(cat <ctr> 2>/dev/null || echo 0)+1 )); echo $c > <ctr>;
                            if <passed>; then printf gate_pass;
                            elif [ \"$c\" -ge <BOUND> ]; then printf gate_giveup;
                            else printf gate_retry; fi",
             outputs="s3_c2.result"]
```

A node is a sizeable acceptance gate iff it declares `goal_gate=true` **and**
`shape=parallelogram` — matching the node-ID convention
`<story-id>__<criterion-id>__gate` (architecture's Interfaces section). `<BOUND>` is the
integer literal following `-ge` inside that node's `tool_command=` value.

Function signatures (small pure functions + a thin CLI wrapper, `record-invocation.js`'s
own pattern):

```js
// Parse a compiled .dot's text and return every goal-gate node found. Never throws.
// Input that cannot be read as node statements at all (malformed .dot) returns
// { gates: [], parseError: <string> }. A goal_gate=true node that is NOT
// shape=parallelogram, or is parallelogram with no "-ge <N>" bound in tool_command,
// comes back with attemptBound: null, unsizable: true — never silently dropped.
function extractGateBounds(dotText)
  -> { gates: [{ nodeId, shape, attemptBound: number|null, unsizable: boolean }],
       parseError: string|null }

// projected_visits ≈ 2 × Σ(attempt_bound per gate) + fixed_overhead
function computeProjectedVisits(gates, fixedOverhead) -> number

// Full check. Never throws — always returns a result; the CLI turns it into an exit code.
function evaluateSizing({ dotText, ceiling, safetyMargin, fixedOverhead })
  -> { ok: boolean,                 // true only if parsed clean, every goal_gate node
                                     // was sizable, and projectedVisits <= budget
       projectedVisits: number|null,
       budget: number,              // ceiling - safetyMargin
       gateCount: number,
       reason: string|null,         // null when ok; else "malformed .dot" |
                                     // "unsizable gate: <nodeId>" | "over budget"
       message: string }            // human-readable, always populated

module.exports = { extractGateBounds, computeProjectedVisits, evaluateSizing };
```

CLI shape:

```
node hooks/scripts/validate-attractor-pipeline.js <path-to-compiled.dot> \
  --ceiling=500 --safety-margin=<N> --fixed-overhead=<N>

Exit 0 — stdout: "OK: projected <X> node-visits <= budget <Y> (<gateCount> gates)."
Exit 1 — stderr: "REFUSED: <reason>. <message>. Handoff artifact was not written."
```

This script only reads the given path and prints to stdout/stderr — it never writes,
deletes, or touches the handoff artifact itself. Its exit code is the enforcement
contract a caller must check before writing the artifact (see Out of scope).

## Relevant design decisions

- **`ADR-011`** — fixes the generated `.dot` shape (`fix` box + `parallelogram` gate,
  `-ge <BOUND>` shell test, `outputs=`) this script parses, and the "2 node-visits per
  attempt" constant: "Two node-visits per attempt (fix + gate), no separate bound-check
  or per-attempt record node."
- **`architecture.md`'s NFR-1 row** — states the formula this story implements
  verbatim, and this script's purpose as "real code, not agent arithmetic."
- **`architecture.md`'s Test strategy row** for this script — "must measure runtime
  step-visits, not static node count (QA correction)" is the defect this story exists
  to prevent; exactly-at-bound / bound+1 / malformed-`.dot` are load-bearing tests, not
  suggestions.
- **`ADR-008`** (setup is a prerequisite) — explains why this script never checks "is
  attractor installed": Setup is satisfied before Phase 1 work starts.

## Acceptance criteria

- [ ] `NFR-1` — Given a `.dot` with N goal-gate nodes (`goal_gate=true`,
      `shape=parallelogram`) each bound at B via `-ge B` in `tool_command`,
      `evaluateSizing` computes `projectedVisits === 2*N*B + fixedOverhead` for at
      least two distinct `(N, B)` pairs in the test suite.
- [ ] `NFR-1` — Given inputs where `projectedVisits === ceiling - safetyMargin`
      exactly (exactly-at-bound), `evaluateSizing` returns `ok: true`, CLI exits `0`.
- [ ] `NFR-1` — Given the same inputs but one bound pushed so `projectedVisits ===
      ceiling - safetyMargin + 1` (bound+1), `evaluateSizing` returns `ok: false`,
      `reason: "over budget"`, CLI exits `1` with a message naming both figures.
- [ ] `NFR-1` — Given a `.dot` unparseable as node statements (malformed — unbalanced
      brackets, empty file, non-DOT text), `evaluateSizing` returns `ok: false`,
      `reason: "malformed .dot"`, CLI exits `1` — never a thrown exception, never a
      silent pass.
- [ ] `NFR-1` — Given a `.dot` with a `goal_gate=true` node that is not
      `shape=parallelogram`, or is `parallelogram` with no `-ge <N>` bound,
      `evaluateSizing` returns `ok: false` with `reason` naming that node's ID as
      unsizable — never silently omitted from the sum.
- [ ] `NFR-1` — Given a `.dot` with a gate whose `outputs=` names a key no node owns
      (a `DATA-002`-shaped defect, `plugins/attractor/README.md`'s lint rules) but is
      otherwise well-formed with a valid `-ge <N>` bound, `evaluateSizing` still
      computes the correct `projectedVisits` — sizing, not `outputs=` semantics, which
      stays `attractor lint`'s job.
- [ ] `NFR-1` — `safetyMargin` and `fixedOverhead` are required, explicit parameters;
      the test suite exercises at least two different values of each, proving neither
      is hardcoded into the formula.
- [ ] `NFR-1` — The CLI's exit code matches `evaluateSizing`'s `ok` field in every case
      above, and a test confirms the input `.dot` file's contents/mtime are unchanged
      after a run — the script never writes to its own input.

## Test approach

**Level:** unit — pure functions over in-memory strings and objects. No `attractor
lint`/`--stub` run belongs here; that's `attractor-handoff-01`'s job. This script
assumes structurally-generated input from the future Phase 2 compiler and handles only
its own parsing/arithmetic edge cases.

**Cases:**

| Case | Expected |
| :-- | :-- |
| happy path — 3 gates, bounds `[5,3,4]`, `fixedOverhead=10` | `projectedVisits = 2*(5+3+4)+10 = 34`; `ok: true` under a generous budget |
| empty / zero — `.dot` with zero goal-gate nodes | `projectedVisits = fixedOverhead` only; `ok: true` if within budget |
| boundary — exactly-at-bound | `projectedVisits === budget`; `ok: true`, exit `0` |
| boundary — bound+1 | `projectedVisits === budget+1`; `ok: false`, exit `1`, message names both figures |
| invalid input — malformed `.dot` | `ok: false`, `reason: "malformed .dot"`, exit `1`, no thrown exception |
| invalid input — unsizable gate (`goal_gate=true`, not `parallelogram`, or no `-ge` bound) | `ok: false`, `reason` names the offending node ID, exit `1` |
| semantic edge case — `outputs=` referencing an unowned key, otherwise well-formed | sizing still computed correctly (separation of concerns from `attractor lint`) |
| permission denied | N/A — script only reads the caller-supplied path and writes nothing; an unreadable path is treated the same as malformed input: exit `1`, clear message, no stack trace |
| concurrent | N/A — pure function of one input file per invocation, no shared mutable state, safe to run any number of times in parallel by construction |

**Run with:** `node --test plugins/delivery/hooks/scripts/validate-attractor-pipeline.test.js`

## Ship readiness

Applies: this story adds new tooling under `hooks/scripts/`, code other sessions load.

- [ ] Branch was fetched and compared against the real current `main` immediately before
      merge: `git fetch origin main && git log --oneline main..origin/main` (empty
      output = current).
- [ ] Plugin version: `plugins/delivery/.claude-plugin/plugin.json`'s `version`
      (currently `0.13.0`) is bumped as this plugin's own separate, dedicated commit
      ("bump plugin version to X.Y.Z"), per real history (`git log --oneline`) — not
      necessarily one bump per story. Confirm at merge time whether a bump is due.
- [ ] This story's `node --test` verification is fully runnable in this session — no
      external tool, no live `attractor` run, no fresh session needed. No environment
      gap to name.

## Out of scope

- Wiring this script into `skills/handoff/SKILL.md`'s compilation step so a failing
  check blocks the artifact write. Roadmap Phase 2's "Acceptance-gate compilation" item
  lists this script wired in as its own dependency — this story delivers the callable
  script and its exit-code contract; Phase 2 is the caller.
- Determining the real, production `safety_margin`/`fixed_overhead` numbers (`OQ-2`,
  Spike 1). This story implements the formula with both as named, overridable
  parameters — never a fabricated default presented as final.
- Sizing box-shaped (self-report) fallback gates. Architecture's "Gate preference" text
  allows a criterion to fall back to `box` when no deterministic command exists; such a
  node can carry its own `max_retries=`/`RETRY` bound (`plugins/attractor/README.md`),
  which neither `ADR-011` nor `NFR-1`'s formula addresses. This script refuses on any
  such node (`unsizable: true`) instead of guessing its cost. Extending the formula to
  size box gates is a Solution Architect decision, not made here.
- A general-purpose DOT grammar parser. This script targets exactly the
  compiler-generated shape `ADR-011` defines; `attractor lint` stays the authority on
  full syntactic/semantic `.dot` validity.
- `NFR-1`'s "How verified" column (a test sprint at assumed max scale, confirming one
  dimension past it truncates) — Spike 1's job, not this story's verification.

## Dependencies

- **`attractor-handoff-01`** must be `done` first. That story runs Spike 5: builds the
  `ADR-011` fix/gate loop as a real fixture, lints it clean, and confirms via three real
  `attractor run --stub` cycles (pass-first-attempt, fail-then-pass, fail-through-bound)
  that each retry attempt costs exactly two node-visits. This story's formula hardcodes
  that confirmed "2" — a different real result means the formula changes first.

## Implementation notes

_Filled in during and after implementation._
