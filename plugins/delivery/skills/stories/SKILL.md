---
description: Decompose a roadmap phase into self-contained, implementation-ready story files that carry their full context. Use when a phase is about to start and the work needs to be broken into pickable units. Produces docs/product/stories/.
---

# Story decomposition

Phase or epic to decompose: **$ARGUMENTS** (defaults to the first phase not yet decomposed)

Phase 10 of the pipeline. Inputs: `docs/product/prd.md`, `docs/product/architecture.md`, `docs/product/roadmap.md`, plus `design-system.md` where it exists. Output: `docs/product/stories/`.

## Gate check

Read all three inputs and list any existing stories in `docs/product/stories/`.

- **Roadmap missing** — stop and run `/delivery:roadmap` first. Without it there is no defensible phase boundary to decompose along.
- **Architecture missing** — warn hard. Stories written without a design either omit the technical context (making them un-pickable) or invent a design inline (which is the Solution Architect's job, done badly). Recommend running `/delivery:architecture` first.
- Never overwrite a story whose status is `in-progress` or `done`.

Resolve the target phase from `$ARGUMENTS`, or take the first phase in the roadmap with no stories yet. State which phase you are decomposing before you start.

## Run

**1. Delivery Lead writes the stories.** Delegate to `delivery:delivery-lead` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/delivery-lead.md` and adopt the persona).

The governing rule: **the story file is the complete context.** Someone opening one story file — a teammate who missed the planning, or an agent with no memory of it — must have everything needed to finish it. Extract the relevant slices of the PRD and architecture *into* the story. Do not link out. A story requiring three other documents to be read has failed at its one job.

Each story carries: user-facing goal, real verified file paths, the interfaces and contracts it must honor, the architecture decisions that apply and why, acceptance criteria traced to `FR-n`, the test approach with the actual command to run tests in this repo, dependencies on other stories, and explicit out-of-scope notes.

**2. Carry the design system into every UI story.** Where `design-system.md` exists, each story touching UI names the **tokens by their real project name**, the component states it must implement (including error and empty), and the accessibility rules that apply. An implementer who cannot find the token reaches for a raw value, and the design system erodes one commit at a time — naming them in the story is what prevents that.

**3. Verify the file paths exist.** The Delivery Lead cites paths; you check them against the repo. A story pointing at a file that does not exist sends the implementer looking for something imaginary.

**4. QA Strategist sets the test approach** per story — the level, the negative and boundary cases, and how it is verified.

**5. Readiness check.** For each story confirm: acceptance criteria falsifiable, file paths verified, dependencies stated, test approach present, nothing missing. Stories passing get status `ready`; stories failing stay `draft` with the missing element named. Do not mark a story ready under schedule pressure — that is exactly when it costs the most.

**6. Write the stories** to `docs/product/stories/<epic>-<nn>-<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/story.md`, and update the story index at `docs/product/stories/README.md`.

## Exit criteria

- Every story is a vertical slice delivering observable behavior, or states why it cannot be
- Every acceptance criterion in the target phase is covered by at least one story
- Every story's file paths verified against the repo
- Dependencies between stories are explicit
- Each story is finishable in one focused sitting, or is split

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Hand off

Report: stories written, how many are `ready` versus `draft`, and what each draft is missing. Flag any acceptance criterion in the phase that no story covers. Next step: `/delivery:next-story` to implement.
