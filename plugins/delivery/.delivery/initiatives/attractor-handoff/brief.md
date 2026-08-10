# Product brief: Attractor handoff runner mode

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-08-10

**Mode:** frame · **Word count:** 644 (cap 900)

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value | yes | no — unique: thin user-segment evidence, no success-signal baseline, a smaller-MVP alternative |
| precision | yes | no — unique: multiple unstated senses of "deterministic," a "feature" vocabulary collision, missing NFR numbers |
| absence | yes | no — unique: "reality check" term unresearched, no `/delivery:sprint-review` re-entry point, no install/version pre-flight |

**Findings by convergence:** 3 found by all three lenses · 2 found by two lenses · 6 found by one lens only

Each lens surfaced material the other two missed. The space is **not exhausted** — three independent passes diverged more than they overlapped, and every open question below stayed unanswered rather than guessed at.

## Problem

`delivery:handoff` has two runner modes today — `superpowers` and `generic` — and neither orchestrates execution. A human or coding agent works a sprint's stories by hand, one at a time, and the only correctness check is `/delivery:sprint-review`, run after the fact and only if invoked. This plugin's own `harden` epic shows the real cost: skill calls narrated but never invoked, acceptance checked through the wrong verification channel on a live product, and a self-correction check skipped for most of a multi-day build (`harden/brief.md` Findings A, C, D). The `attractor` plugin — a separate deterministic-orchestration engine in this repo — has a `goal_gate` mechanism built for exactly this: a node whose pass/fail is a shell exit code, not a model's self-report. No handoff mode targets it yet.

## Who has it

**The operator** (governed term) who has both `delivery` and `attractor` installed and wants a scoped sprint to run through attractor's engine instead of by hand. Evidence for this segment is thin: it traces to one real individual — the person who filed GitHub issue #21 and pre-designed the sketch this brief interrogates. No independently-observed second operator wanting this exists in this project's own persona evidence.

## Cost of the status quo

In-line, deterministic correctness checking does not exist for any runner mode today. Of this plugin's own 21 delivery-plugin story files, only 1 (`harden-05`) carries a real automated test command; the rest are manual, N/A, or state plainly that no automated runner exists. That is not a gap this feature alone caused — it is the gap this feature can close where a real command already exists, and must flag honestly where one doesn't.

## What changes if we solve it

A sprint scope package can hand off to an attractor pipeline instead of a hand-worked plan. Stories whose acceptance criteria already reduce to a real command get an inline, engine-evaluated `goal_gate` instead of relying on self-report; stories that don't are flagged as such rather than silently backed by an LLM judgment standing in for a gate.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Divergence between a `goal_gate` verdict and an independent `/delivery:sprint-review` re-run of the same command | Sampled comparison across sprints run through this mode | Not measured — no baseline exists | TBD at PRD stage |
| Share of a sprint's stories reaching a real `goal_gate` without inventing or weakening a criterion | Count against the sprint scope package's verification contract | ~1 of 21 stories, this plugin's own history (~5%) | TBD at PRD stage |
| "Accepted with debt" verdicts traced to unverified self-report | `/delivery:sprint-review` outcomes, stories run through this mode vs. not | Not measured | TBD at PRD stage |

No signal above has a collected baseline today — stated here rather than implied as existing.

## MVP boundary

A handoff artifact — same spirit as the existing `superpowers` Mode A spec handoff, not a new templating engine — that packages a sprint scope package for attractor's own agents to consume: sequential-only (matching what's actually merged to `main` today), gating only stories whose Test approach is already a real deterministic command, and explicitly naming every story that isn't rather than silently substituting an LLM judgment for one.

## Explicitly out of scope

- Attractor's own engine implementation or bug fixing — this is a delivery-plugin-side handoff contract only
- A reusable pipeline template catalog — none exists today; premature before real usage data exists
- Parallel/fan-out execution — implemented but unmerged to `main` as of this brief (commit `229ca56`, branch `attractor-21-parallel-fan-out`)
- Human-gate-dependent escalation — the shape is still refused by attractor's own lint (`HAND-001`)

## Current-state workflow

Today: `/delivery:sprint` produces a scope package. `/delivery:handoff` converts it to a `superpowers` spec/plan or a `generic` brief. A human or coding agent works it by hand, one story at a time. `/delivery:sprint-review` independently re-checks the result afterward, if and when it's run — nothing in the pipeline enforces that it is.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Scope this assuming `Handler.PARALLEL`/`FAN_IN` has landed on `main`, or assuming it hasn't? | Product Owner | PRD/architecture sequencing requirement |
| 2 | What does a `goal_gate` do for a criterion that can't reduce to a deterministic check — the common case in this plugin's own history? Refuse to gate it, fall back to a human step, or fall back to a flagged LLM judgment? | Product Owner + QA Strategist | PRD acceptance-criteria-to-gate translation |
| 3 | What does a stop condition do when attractor's human-gate shape isn't runnable? Is a hard `FAIL` an acceptable break from "an honestly-blocked task is a success"? | Product Owner | PRD error handling |
| 4 | Who or what translates an attractor run's output (checkpoints, events, `goal_gate` verdicts) into the report-back shape `/delivery:sprint-review` requires? Does a re-entry point exist at all? | Solution Architect | Architecture |
| 5 | "Select or create the right pipeline machinery" — select from what catalog (none exists today), created by which agent, using what handoff payload? | Product Owner + Solution Architect | PRD scope, architecture |
| 6 | Do "the attractor agents" that create pipelines already exist as an addressable component, or is this feature expected to define that contract for something not yet built? | Product Owner | PRD scope boundary |
| 7 | What does "reused" mean for a pipeline — across later sprints of one initiative, across initiatives, or across repos — and what makes one eligible for reuse vs. staying bespoke? | Product Owner | PRD scope |
| 8 | What does "amplifier's reality check pipelines" refer to? Zero matches anywhere in this repo, including the dedicated amplifier-precedent research doc. New research, or a different name for an already-researched topic? | Business Analyst | `/delivery:research` |
| 9 | Does the bootstrap/setup subgraph bind explicitly to the existing "setup is a prerequisite, not a feature" doctrine (`ADR-008`), or does this mode need its own restatement? | Solution Architect | Architecture (low severity) |
| 10 | What NFR bounds apply — max stories per sprint, acceptable handoff latency/cost given attractor's real per-node LLM spend, retention/replay expectation for `.attractor/runs/<timestamp>` relative to `.delivery/`'s own audit trail? | Product Owner | PRD NFRs |
