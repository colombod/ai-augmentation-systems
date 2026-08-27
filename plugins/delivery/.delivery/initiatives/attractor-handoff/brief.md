# Product brief: Attractor handoff runner mode

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-08-10

**Mode:** frame · **Word count:** 899 (cap 900)

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value | yes | no — unique: no success-signal baseline, a smaller-MVP alternative |
| precision | yes | no — unique: multiple unstated senses of "deterministic," a "feature" vocabulary collision, missing NFR numbers |
| absence | yes | no — unique: `/delivery:sprint-review` re-entry point, attractor-availability pre-flight |

**Findings by convergence:** 1 found by all three lenses (the acceptance-criteria-to-gate translation gap, since resolved — see Open Question 1) · 0 found by exactly two · 7 found by one lens only

Each lens surfaced material the other two missed — not exhausted. **Revision note (1):** an earlier pass included two "convergent" findings about attractor's own engine status (parallel-fan-out merge state, human-gate support) — removed; that status is out of scope for a delivery-plugin-side contract, full stop. **Revision note (2), from `/delivery:challenge` (`R-brief-3`):** three single-lens items named above went unelaborated below — fixed here, not dropped. The smaller-MVP alternative is superseded, not rejected, by the product owner's criteria-derived-gate clarification. "Deterministic" now means gate determinism (a criteria-derived check, looped) throughout, not attractor's separate routing determinism. The "feature" vocabulary collision is flagged for Business Analyst curation.

## Problem

`delivery:handoff` has two runner modes today — `superpowers` and `generic` — and neither orchestrates execution. A human or coding agent works a sprint's stories by hand, one at a time, and the only correctness check is `/delivery:sprint-review`, run after the fact and only if invoked. This plugin's own `harden` epic shows the real cost: skill calls narrated but never invoked, acceptance checked through the wrong verification channel on a live product, and a self-correction check skipped for most of a multi-day build (`harden/brief.md` Findings A, C, D). Attractor — a separate, deterministic pipeline-orchestration engine in this repo — is a construction-and-validation engine built for exactly this. No handoff mode targets it yet.

## Who has it

**The operator** (governed term), at today's `/delivery:handoff` choice point — someone who has brought work through this plugin to shipping and wants attractor as the construction-and-validation engine, instead of `superpowers` or a plain Claude agent working the plan by hand. Same population as the existing two runner modes; a third choice at an existing decision point, not a new segment.

## Cost of the status quo

In-line, deterministic correctness checking does not exist for any runner mode today. Of this plugin's own 21 delivery-plugin story files, only 1 (`harden-05`) carries a real, pre-written automated test command; the rest are manual, N/A, or state plainly that no automated runner exists. Today's checking only reaches that 1 story. This brief's workflow (MVP boundary, below) targets exactly that gap — the other 20.

## What changes if we solve it

A sprint scope package can hand off to an attractor pipeline instead of a hand-worked plan, and the pipeline itself becomes the *workflow* that forces acceptance — a loop, not a single yes/no check. Direct product-owner framing, adopted verbatim as this MVP's mechanism; the exact shape is stated once, in MVP boundary below, not repeated here.

**Real precedent for this exact discipline exists:** [`microsoft/amplifier-bundle-reality-check`](https://github.com/microsoft/amplifier-bundle-reality-check) — the actual "reality check" repo the scenario referenced, confirmed by reading its source directly (corrected here after an earlier local-only search missed it). Its discipline: user intent compiles into a strict, schema-validated acceptance-test suite (`id`/`description`/`type`/`steps`) via an `intent-analyzer` agent, checked structurally by a deterministic CLI validator in a bounded retry loop — agent writes, CLI validates, up to 3 attempts, hard fail rather than silent acceptance. Execution then runs a tester agent that produces a pass/fail verdict with concrete evidence, never a bare claim. This MVP adopts amplifier's loop shape. Whether it also needs amplifier's session-isolation — a separately deployed instance, never the builder's own session — is narrower than the loop itself and is left to architecture, not assumed here.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Share of a sprint's stories reaching a real, checkable gate (derived from criteria, not requiring a pre-existing command) without inventing or weakening a criterion | Count against the sprint scope package's verification contract | 1 of 21 had a pre-existing command; 0 of 21 have been run through criteria-compilation yet | TBD at PRD stage |
| "Accepted with debt" verdicts traced to unverified self-report | `/delivery:sprint-review` outcomes, stories run through this mode vs. not | Not measured | TBD at PRD stage |

No signal above has a collected baseline today.

## MVP boundary

A handoff artifact — same spirit as the existing `superpowers` Mode A spec handoff, not a new templating engine — that packages a sprint scope package for attractor's own agents to consume: the story dependency graph expressed faithfully (sequential and independent work both named as such, from each story's `depends_on`), and, per story, its acceptance criteria compiled into a structured, checkable validation rather than assumed to require a pre-existing automated command. The gate is the loop — check runs, a failure routes back to a fix step, the check re-runs — not a one-shot pass/fail. A criterion genuinely not reducible to any checkable form — rare once compilation replaces "must already have a command" as the bar — is named as such, not silently backed by an unmarked judgment. What attractor's own engine can currently execute is attractor's concern at run time, not a constraint this artifact should hedge around.

## Explicitly out of scope

- Any fact about attractor's current build state — engine capability, roadmap, or whether a specific consuming component exists — governing this design. Delivery's artifact targets attractor's documented contract, never its build status (see Open Question 4).
- A reusable pipeline template catalog — none exists today; premature before real usage data exists
- Authoring or fixing anything inside the `attractor` plugin

## Current-state workflow

Today: `/delivery:sprint` produces a scope package. `/delivery:handoff` converts it to a `superpowers` spec/plan or a `generic` brief. A human or coding agent works it by hand, one story at a time. `/delivery:sprint-review` independently re-checks the result afterward, if and when it's run — nothing in the pipeline enforces that it is.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **Resolved at brief stage, 2026-08-10 (direct product-owner statement — see MVP boundary):** the gate is a loop, not a one-shot check. Residual, narrower question for PRD: for a criterion genuinely irreducible to any checkable form, does the loop still apply with a marked-judgment step standing in, or does that case fall outside this mode? | Product Owner + QA Strategist | PRD acceptance-criteria-to-gate translation |
| 2 | Who or what translates a completed attractor run's output into the report-back shape `/delivery:sprint-review` requires? Does a re-entry point exist at all? | Solution Architect | Architecture |
| 3 | "Select or create the right pipeline machinery" — from delivery's side only, what handoff payload does the artifact carry so *either* selection or creation is possible on the receiving end? (Which catalog, which agent, and whether either exists: immaterial to delivery scope, per Open Question 4's resolution.) | Product Owner | PRD scope |
| 4 | **Resolved at brief stage, 2026-08-10 (direct product-owner statement):** immaterial to delivery-plugin scope. Whether attractor's consuming agent already exists or is built later, delivery's job is unchanged — produce a well-specified handoff artifact in a documented shape, the same stance the `superpowers` mode already takes toward `writing-plans`. Struck as a blocking question. | — | — |
| 5 | What does "reused" mean for a pipeline — across later sprints of one initiative, across initiatives, or across repos — and what makes one eligible for reuse vs. staying bespoke? | Product Owner | PRD scope |
| 6 | What should `/delivery:handoff` do if the attractor plugin isn't installed when this runner mode is chosen — same shape as the existing gate check for `superpowers`/`generic`? | Business Analyst | PRD gate check |
| 7 | Does the bootstrap/setup subgraph bind explicitly to the existing "setup is a prerequisite, not a feature" doctrine (`ADR-008`), or does this mode need its own restatement? | Solution Architect | Architecture (low severity) |
| 8 | What NFR bounds apply — max stories per sprint, acceptable handoff latency, retention/replay expectation for a completed run relative to `.delivery/`'s own audit trail? | Product Owner | PRD NFRs |
