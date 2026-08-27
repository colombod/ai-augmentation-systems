<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
-->

---
id: attractor-handoff-05
title: "Spike: drift-precheck judgment call (OQ-10)"
status: ready
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: []
depends_on: []
size: S
---

# Spike: drift-precheck judgment call (OQ-10)

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

A recorded, reasoned decision that resolves `OQ-10`: whether a cheap file-existence precheck
is worth adding per story group in the compiled attractor pipeline, to catch a cited resource
(a file path, a branch) drifting away — being deleted, renamed, or moved — during a long
unattended run. **The deliverable is the decision itself, documented with its reasoning — not
necessarily any code.** The roadmap's own Phase 1 cut list already names "document the
residual risk instead of building a precheck" as the likely outcome; do not treat "write a
precheck" as the default just because writing code feels more like real work than writing a
decision down. Either outcome — build, with an exact shape, or don't build, with the risk
documented — is a complete, valid close of this story.

## Context

`prd.md`'s S-1 (Happy path handoff) error/edge-path table has two related but distinct rows.
"Resource missing" — a cited file that's already absent at compile time — is already handled:
"Refused by the existing readiness check bullet ('every cited file path exists'), inherited
unmodified." "Resource missing mid-run (drift during a long unattended run)" is the separate,
still-open row this spike closes: **not addressed; open question, `OQ-10`.** The distinction
matters — this spike is only about resources that exist and pass the compile-time check, then
change or disappear later, while attractor is unattended and running a long pipeline.

`architecture.md`'s spike table lists this as Spike 4: *"`OQ-10`: is a cheap file-existence
pre-check worth adding per story group, or does real drift mostly show as content change
rather than absence?"* — 0.5 day time box, **Low confidence, "a judgment spike."**
`roadmap.md`'s Phase 1 work-item table gives it the same Low confidence rating and lists it as
running alongside Spikes 1–3, concurrent with (not blocked by) Spike 5. Phase 1's cut list
names it explicitly as cut candidate #1: **"Spike 4 (`OQ-10` drift precheck) — document the
residual risk instead of building a precheck."** This is the roadmap's own stated bias, not a
constraint that forecloses building one — the point of this story is to make that call for
real, with reasoning, not to rubber-stamp the cut-list guess.

**A real cost that should weigh into the decision, not just intuition:** `FR-17`'s Outcome
enum is closed and PRD-`must`: a story's `Outcome` is exactly one of `done`,
`non-convergent`, `blocked`, `not attempted`. `Non-convergent` (glossary term) means
specifically "its gate/fix loop exhausted its declared attempt bound without passing" — a
precheck failing mid-run because a file vanished is a different failure shape entirely, one
that doesn't obviously fit any of the four existing values without its own design work
(a fifth outcome, or folding it awkwardly into an existing one). Building a precheck is not
just "add a cheap `test -f`" — it also means deciding what a precheck failure *is*, in terms
this feature's own closed vocabulary already committed to. That downstream cost is real
grounding for why "document the risk" might genuinely be the right call, not just the cheap
one — but it's a reason to weigh, not a foregone conclusion.

`NFR-3` (no resume path; a non-convergent story means a full pipeline re-run, stated to the
operator plainly) also bears on the decision: if a precheck-shaped failure meant a full
unattended run has to restart from scratch anyway, that changes how much a precheck actually
saves versus just letting the acceptance gate itself fail loudly against a resource that's
gone.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/architecture.md` | modify — Spike table row 4 (`OQ-10`) marked answered, with the decision and its one-line rationale. If **build**: add the precheck's design (what it checks, where it sits in the `.dot`, what its failure produces) to the "Interfaces and data contracts" section, near the existing per-gate node structure. If **don't build**: add the residual-risk disclosure as a new line in the manifest's "Fixed disclosures" content, alongside the existing `NFR-3`/`NFR-4` disclosures. |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/prd.md` | modify — `OQ-10` removed from the open Open Questions table via a dated "Resolved" note, following the exact pattern already used for `OQ-14`–`OQ-17` (decision recorded where it actually lives, not restated in two places). S-1's edge-path table row "Resource missing mid-run" updated from "Not addressed; open question, `OQ-10`" to state the actual outcome (or a short pointer to where it's documented). |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/roadmap.md` | read-only reference — Phase 1's cut list already anticipates this outcome; no edit needed here unless the decision changes Phase 2's scope, which is a Program Manager call, out of scope for this story. |

## Interfaces and contracts to honor

The manifest's existing section structure (`architecture.md`, "Interfaces and data
contracts"), reproduced here since any addition — build or don't-build — has to slot into it,
not invent a new shape:

```
| Section              | Content                                                          | FR             |
| Irreducible criteria | Story, criterion, FR-n, reason                                   | FR-12          |
| Per-gate table        | Story ID, criterion ID, criterion text, FR-n, derived check       | FR-5,6,7,20    |
|                        | summary, node-ID prefix, attempt bound, timeout, gate shape       |                |
| Dependency graph      | depends_on edges, verbatim                                        | FR-2           |
| Sizing declaration    | stories × criteria × bound → projected node-visits vs. ceiling    | NFR-1          |
| Fixed disclosures     | No resume path (NFR-3); do not share --run-dir (NFR-4)            | NFR-3, NFR-4   |
| Literal next command  | attractor run <path> --run-dir .attractor/runs/<slug>-<timestamp> | S-1            |
```

A "don't build" disclosure is a new bullet under **Fixed disclosures**, in the same plain,
load-bearing style as the existing two — not a hedge, a stated fact the operator reads every
sprint.

If **build**, the node-ID convention it must extend is `<story-id>__<criterion-id>__{fix,gate}`
(architecture.md's own convention for gate/fix pairs) — a precheck node needs its own place in
that scheme, e.g. `<story-id>__precheck`, and its cost must be added to `NFR-1`'s sizing
formula, currently `projected_visits ≈ 2 × Σ(attempt_bound per gate) + fixed_overhead`
(`validate-attractor-pipeline.js`, Spike 1's concern) — one more node per story group is a real,
countable addition to that formula, not free.

## Relevant design decisions

- **ADR-010** — one compiled pipeline per sprint, no per-story resume mechanism. This is why
  `NFR-3` says a non-convergent story costs a full re-run: it directly bears on how much value
  a precheck actually buys versus just letting the acceptance gate fail against the vanished
  resource later in the same run.
- **ADR-009** — the manifest writes to `.delivery/sprints/`, never the gitignored
  `.attractor/` tree. A "don't build" disclosure has to land in this durable file to count as
  documented — not in a comment attractor's own run artifacts would carry, since those aren't
  committed.
- **ADR-011** — the acceptance gate's bounded retry is built entirely from attractor's own
  **documented interface** (glossary term — `plugins/attractor/README.md`, never undocumented
  engine internals), the same discipline that found and got a real gap fixed upstream
  (`#40`→`#42`). If build is chosen and the precheck needs any attractor-side primitive beyond
  a plain shell `test -f`/`git` check, it must be grounded the same way — checked against the
  README directly, not assumed.

## Acceptance criteria

- [ ] `architecture.md`'s Spike table, row 4 (`OQ-10`), reads "answered" with a one-sentence
  decision and its rationale — not left at "Low — a judgment spike" with no resolution.
- [ ] `prd.md`'s Open Questions table no longer lists `OQ-10` as open; a dated "Resolved" note
  names where the decision now lives (matching the existing `OQ-14`–`OQ-17` pattern).
- [ ] `prd.md`'s S-1 edge-path table row "Resource missing mid-run" no longer reads "Not
  addressed; open question, `OQ-10`" — it states the outcome or points to where it's recorded.
- [ ] The reasoning is grounded in an actual assessment of how drift manifests for the two
  concrete resource types this feature cites (sprint-package file paths; branches/run-dirs per
  `NFR-4`) — absence vs. content change — not asserted without support.
- [ ] **If build:** the design states exactly what the precheck node checks, where it sits in
  the `.dot` (per story group, ahead of that story's own fix/gate nodes), what result a failure
  produces given `FR-17`'s closed Outcome enum (a genuine open sub-decision, not glossed over),
  and its `NFR-1` sizing impact.
- [ ] **If don't build:** the residual risk is written into the manifest's Fixed disclosures
  content in the same plain, load-bearing style as the existing `NFR-3`/`NFR-4` lines.

## Test approach

**Level:** judgment-call spike — not a code change unless build is chosen, and even then this
story ships the *design*, not an implementation (see Out of scope). "Testing" this story means
verifying the decision is actually recorded, with its reasoning, in the two edited documents —
not running a command.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Reader opens `architecture.md`'s Spike table | Row 4 shows a stated decision and rationale, not the original open question |
| Reader opens `prd.md`'s Open Questions table | `OQ-10` no longer appears open; a Resolved note points to where the decision lives |
| Reader opens `prd.md`'s S-1 edge-path table | "Resource missing mid-run" no longer reads "Not addressed" |
| (build only) Reader opens the design | Can state, unaided, exactly what command the precheck node runs, where it sits, and what its failure produces |
| (don't-build only) Reader opens the manifest's Fixed disclosures | The mid-run drift risk reads as plainly as the existing `NFR-3`/`NFR-4` disclosures, not vaguer |

**Run with:** N/A — no test command. Verification is a direct read of `architecture.md` and
`prd.md` against the acceptance criteria above.

## Out of scope

- Implementing precheck code — a compiled `.dot` node's real shell command, or any
  `hooks/scripts/*.js` change — if the decision is build. This story specifies the design only;
  wiring it into the real compiler is follow-on work for Phase 2's acceptance-gate compilation
  item, sized and scoped there.
- `OQ-9` (Spike 3 — `attractor doctor` + permission/tooling precondition). A related but
  distinct precondition question about install/permission drift, not resource drift.
- Changing `FR-17`'s Outcome enum itself, even if build surfaces the need for a fifth value —
  that's a PRD-level change (Product Owner call), only flagged here as a real cost to weigh.
- Retrofitting this decision onto the existing `superpowers`/`generic` runner modes — same
  non-goal pattern the PRD's Out of scope section already applies to other precondition checks.

## Dependencies

None. Entry criteria only: `attractor` plugin installed, `attractor doctor` passes (`ADR-008`,
roadmap Phase 1 entry criteria) — the same entry bar every Phase 1 spike shares. Per the
roadmap's own critical-path text, this spike runs concurrently with Spikes 1–3 (not blocked by
Spike 5, unlike Spike 1).

## Implementation notes

Filled in during and after implementation. Record which way the decision went and why, and any
follow-up work it created (e.g., a Phase 2 story to actually build the precheck, or a PRD
change to `FR-17`'s enum) — anything a future reader would want.
