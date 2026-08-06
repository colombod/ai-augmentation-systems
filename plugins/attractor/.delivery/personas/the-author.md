---
id: P-1
slug: the-author
name: The Author
grounding: reported
segment: wants a new pipeline for a task that doesn't have one yet, has not read the specification
status: active
introduced: 2026-08-05, this feature
source: derived
---

> **Grounding: reported.** Core motivation and job description come directly from the
> project owner's own stated intent ("people using this package to create attractor
> pipelines to implement and create what they need... those users want to leverage the
> agents and skills to help create correct pipelines") — second-hand relative to any
> real author, but first-hand from the person who commissioned this product. Behavioral
> detail beyond that (frequency, stakes, alternatives weighed) is **assumed**, reasoned
> from the amplifier comparison and the existing engine, and marked so per attribute.
> No observed evidence exists for this persona or any other — confirmed by a dedicated
> evidence hunt (`plugins/attractor/.delivery/research.md`'s Gaps section): zero telemetry, zero issue
> reports, and the closest comparable product's own issue tracker contains no issues at
> all, only internal team PRs.

## In one line

Wants to automate a process — data processing, a review pass, a build-fix loop — as a
deterministic, auditable pipeline, but has never written DOT and does not want to learn
a 93KB grammar to get there.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | first-time or occasional pipeline author, no DOT experience | reported (owner) |
| Motivation | "create what they need" — an application or automated workflow, correct on the first attempt | reported (owner) |
| Constraints | wants to leverage agents/skills to get a *correct* pipeline, not just a syntactically valid one | reported (owner) |
| Expertise | competent at describing a process in natural language; not a DOT or Graphviz user | assumed |

## Context

**Trigger:** has a repeatable task (review a PR, process a batch of files, run a build-fix loop) currently done by hand or with an ad hoc script — assumed.
**Frequency:** assumed low-to-occasional per new pipeline, since a working pipeline is meant to be reused, not re-authored (see The Composer, P-3).
**Stakes:** assumed moderate-to-high — the whole reason to reach for attractor over a plain script is that the process must not silently misreport success (this project's own founding incident, `AGENTS.md:60-64`).
**Who else decides:** assumed none for a solo user; a team lead if the pipeline becomes shared infrastructure (overlaps P-3).
**Alternatives they weigh:** a hand-rolled shell script or a plain Claude Code conversation, no orchestration layer at all — assumed, and the honest baseline this product must beat.

## Constraints they carry

Assumed: works inside a Claude Code session most of the time, wants the option to run standalone later (owner's own stated requirement — "use it from a claude session or as a standalone program"); time-boxed — will not read the 93KB specification to get a first pipeline working.

## What they already believe

Assumed, informed by amplifier's own documented authoring flow (`skills/attractorify/SKILL.md`, verified read): arrives expecting a conversational, question-driven path to a working pipeline — "describe the problem, get a graph back" — because that is the shape a comparable product already delivers. Does **not** expect to hand-write DOT from a grammar reference.

## Abandonment condition

**They leave when:** no skill or agent exists to generate a pipeline for them, and the only path is the raw specification with zero committed examples to copy — the exact current state, confirmed directly (`find . -iname '*.dot'` outside `node_modules`, zero results).
**They go to:** a plain, unstructured Claude Code conversation with no control-plane guarantees, silently reintroducing the exact failure mode this product exists to prevent.

## Where this persona diverges from the others

Blocked by **authoring**, specifically — not by installability (P-2's blocker) or by reuse/composition (P-3's blocker). Give this persona a working `plugin.json` and nothing else, and they still cannot get a first pipeline built.

## What would falsify this persona

**This persona is wrong if:** real early users turn out to arrive already fluent in DOT (e.g., from Graphviz or a prior attractor/amplifier project) and skip straight to hand-authoring without friction.
**We would find out by:** the first real usage signal — which this product cannot currently generate, since it isn't installable (see research.md's Gaps).

## Quotes

"Those users want to leverage the agents and skills to help create correct pipelines" — project owner, this session, `illustrative paraphrase of a direct instruction, not a transcribed quote`.
