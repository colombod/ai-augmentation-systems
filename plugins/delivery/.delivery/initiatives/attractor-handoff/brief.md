# Product brief: Attractor handoff runner mode

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-08-10

**Mode:** frame · **Word count:** 867 (cap 900)

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value | yes | no — unique: no success-signal baseline, a smaller-MVP alternative |
| precision | yes | no — unique: multiple unstated senses of "deterministic," a "feature" vocabulary collision, missing NFR numbers |
| absence | yes | no — unique: `/delivery:sprint-review` re-entry point, attractor-availability pre-flight |

**Findings by convergence:** 1 found by all three lenses · 2 found by two lenses · 6 found by one lens only

Each lens surfaced material the other two missed. The space is **not exhausted** — three independent passes diverged more than they overlapped. **Revision note:** an earlier pass of this brief included two "convergent" findings about attractor's own engine status (parallel-fan-out merge state, human-gate lint support) — removed on direct product-owner correction: attractor's own capability and roadmap are out of scope for a delivery-plugin-side handoff contract, full stop, not a hedge to design around.

## Problem

`delivery:handoff` has two runner modes today — `superpowers` and `generic` — and neither orchestrates execution. A human or coding agent works a sprint's stories by hand, one at a time, and the only correctness check is `/delivery:sprint-review`, run after the fact and only if invoked. This plugin's own `harden` epic shows the real cost: skill calls narrated but never invoked, acceptance checked through the wrong verification channel on a live product, and a self-correction check skipped for most of a multi-day build (`harden/brief.md` Findings A, C, D). Attractor — a separate, deterministic pipeline-orchestration engine in this repo — is a construction-and-validation engine built for exactly this. No handoff mode targets it yet.

## Who has it

**The operator** (governed term), at the point they already choose a runner today in `/delivery:handoff` — someone who has taken a product or a story through this plugin to the shipping stage and wants attractor as the construction-and-validation engine, instead of `superpowers` or a plain Claude agent working the plan by hand. Same population as the existing two runner modes; this is a third choice at an existing decision point, not a new user segment.

## Cost of the status quo

In-line, deterministic correctness checking does not exist for any runner mode today. Of this plugin's own 21 delivery-plugin story files, only 1 (`harden-05`) carries a real automated test command; the rest are manual, N/A, or state plainly that no automated runner exists. That is not a gap this feature alone caused — it is the gap this feature can close where a real command already exists, and must flag honestly where one doesn't.

## What changes if we solve it

A sprint scope package can hand off to an attractor pipeline instead of a hand-worked plan. Stories whose acceptance criteria already reduce to a real, deterministic check get one; stories that don't are flagged as such rather than silently backed by an unmarked LLM judgment standing in for a gate.

**Real precedent for this exact discipline exists:** [`microsoft/amplifier-bundle-reality-check`](https://github.com/microsoft/amplifier-bundle-reality-check) — the actual "reality check" repo the scenario referenced, confirmed by reading its source directly (a prior research pass searched the wrong, unrelated local repo and found nothing — corrected here). Its discipline: user intent compiles into a strict, schema-validated acceptance-test suite (`id`/`description`/`type`/`steps`, `type` ∈ `browser|cli|other` selecting which specialized tester runs it), written by an `intent-analyzer` agent and checked structurally by a deterministic CLI validator in a bounded retry loop — agent writes, CLI validates, up to 3 attempts, hard fail rather than silent acceptance. Execution then runs a *separate* tester agent against a *really deployed* instance in an isolated environment, never the session that built the software, and every verdict requires concrete evidence — a screenshot, or matched command output — never a bare pass/fail. The report goes through the same agent-writes/CLI-validates loop before it counts as done. Agent judgment isn't eliminated — deriving tests, driving a UI, reading a screen all stay agent work. What's deterministic is the schema around it, the isolation from the builder's own session, and mandatory evidence per verdict.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Share of a sprint's stories reaching a real, deterministic gate without inventing or weakening a criterion | Count against the sprint scope package's verification contract | ~1 of 21 stories, this plugin's own history (~5%) | TBD at PRD stage |
| "Accepted with debt" verdicts traced to unverified self-report | `/delivery:sprint-review` outcomes, stories run through this mode vs. not | Not measured | TBD at PRD stage |

No signal above has a collected baseline today — stated here rather than implied as existing.

## MVP boundary

A handoff artifact — same spirit as the existing `superpowers` Mode A spec handoff, not a new templating engine — that packages a sprint scope package for attractor's own agents to consume: the story dependency graph expressed faithfully (sequential and independent work both named as such, from each story's `depends_on`), gating only stories whose Test approach is already a real deterministic command, and explicitly naming every story that isn't rather than silently substituting an unmarked LLM judgment for one. What attractor's own engine can currently execute is attractor's concern at run time, not a constraint this artifact should hedge around.

## Explicitly out of scope

- Attractor's own engine implementation, capabilities, or roadmap — this is a delivery-plugin-side handoff contract only
- A reusable pipeline template catalog — none exists today; premature before real usage data exists
- Authoring or fixing anything inside the `attractor` plugin

## Current-state workflow

Today: `/delivery:sprint` produces a scope package. `/delivery:handoff` converts it to a `superpowers` spec/plan or a `generic` brief. A human or coding agent works it by hand, one story at a time. `/delivery:sprint-review` independently re-checks the result afterward, if and when it's run — nothing in the pipeline enforces that it is.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | What does a deterministic gate do for a criterion that can't reduce to a real command — the common case in this plugin's own history? Refuse to gate it, or flag it and fall back to a marked agent judgment (amplifier's tester-agent pattern, with mandatory evidence)? | Product Owner + QA Strategist | PRD acceptance-criteria-to-gate translation |
| 2 | Who or what translates a completed attractor run's output into the report-back shape `/delivery:sprint-review` requires? Does a re-entry point exist at all? | Solution Architect | Architecture |
| 3 | "Select or create the right pipeline machinery" — select from what catalog (none exists today), created by which agent, using what handoff payload? | Product Owner + Solution Architect | PRD scope, architecture |
| 4 | Do "the attractor agents" that create pipelines already exist as an addressable component, or is this feature expected to define that contract for something not yet built? | Product Owner | PRD scope boundary |
| 5 | What does "reused" mean for a pipeline — across later sprints of one initiative, across initiatives, or across repos — and what makes one eligible for reuse vs. staying bespoke? | Product Owner | PRD scope |
| 6 | What should `/delivery:handoff` do if the attractor plugin isn't installed when this runner mode is chosen — same shape as the existing gate check for `superpowers`/`generic`? | Business Analyst | PRD gate check |
| 7 | Does the bootstrap/setup subgraph bind explicitly to the existing "setup is a prerequisite, not a feature" doctrine (`ADR-008`), or does this mode need its own restatement? | Solution Architect | Architecture (low severity) |
| 8 | What NFR bounds apply — max stories per sprint, acceptable handoff latency, retention/replay expectation for a completed run relative to `.delivery/`'s own audit trail? | Product Owner | PRD NFRs |
