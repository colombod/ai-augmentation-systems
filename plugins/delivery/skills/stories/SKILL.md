---
description: Decompose a roadmap phase into self-contained, implementation-ready story files that carry their full context. Use when a phase is about to start and the work needs to be broken into pickable units. Produces .delivery/stories/.
argument-hint: "[phase-or-initiative]"
---

# Story decomposition

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Phase or epic to decompose: **$ARGUMENTS** (defaults to the first phase not yet decomposed)

CONTRACT stage. Inputs: `.delivery/initiatives/<initiative>/prd.md`, `.delivery/initiatives/<initiative>/architecture.md`, `.delivery/initiatives/<initiative>/roadmap.md`, plus `design-system.md` where it exists. Output: `.delivery/stories/`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Open blocking findings**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read all three inputs and list any existing stories in `.delivery/stories/`.

- **Roadmap missing** — stop and run `/delivery:roadmap` first. Without it there is no defensible phase boundary to decompose along.
- **Architecture missing** — warn hard. Stories written without a design either omit the technical context (making them un-pickable) or invent a design inline (which is the Solution Architect's job, done badly). Recommend running `/delivery:architecture` first.
- **Setup, not a feature** — if the item is pure environment/repo/framework/build-system setup (no persona completes a journey through it), refuse to write it as a story; point back to `architecture.md`'s Setup section, where it belongs as a Phase-1-gating prerequisite, not a phase deliverable.
- Never overwrite a story whose status is `in-progress` or `done` — supersede it instead, per the protocol below.

## When a ruling invalidates existing stories

A decision that lands mid-flight does not entitle you to rewrite history. What you do
depends on whether work has started, and **nothing is ever deleted** — a story is a record
of what was intended, and deleting it destroys the reason the code looks the way it does.

| Status | What to do |
| :-- | :-- |
| `draft` | Revise in place. No work is lost and nothing referenced it yet. |
| `ready` | Revise in place, and note in the story what changed and which ruling caused it. Someone may have read it. |
| `in-progress` | **Stop the work first.** Mark `superseded`, record what was actually built, and say whether that partial work is kept, reverted, or left for the replacement to absorb. Then write the replacement. |
| `done` | Mark `superseded`. It shipped — the record stands as the explanation for code that exists. Write a new story for the change. |

**Link both directions.** The old story gets `superseded_by: [<new-id>]` and a one-line
reason. The new story gets `supersedes: [<old-id>]`. Without both, the next reader finds a
story describing behaviour the code does not have and cannot tell whether it is stale or
broken.

**Give the reason, not just the link.** "Superseded by p1-15" says nothing. "Superseded by
p1-15: the owner ruled that out of season the estimate is disabled rather than falling back
to a minimum rate" tells a future reader why the design changed, which is the part worth
keeping.

**A superseded story is not a failed story.** It records a decision that was correct given
what was known. Treat the supersession as information about how the understanding moved,
and say so in the sprint review's calibration section — a design that supersedes often is a
design being learned, and that is worth knowing.

Resolve the target phase from `$ARGUMENTS`, or take the first phase in the roadmap with no stories yet. State which phase you are decomposing before you start.

**Open blocking findings.** Apply the conventions' *Open blocking findings* check to every artifact this phase consumes before going further.

## Run

**0. Decompose first, then write in parallel — do not write them one at a time.**

Deciding *what the stories are* is one judgement over the whole phase and must happen once,
in sequence: the slice boundaries, the dependency order, what each story owns. That is fast.

**Writing** them is not one judgement — it is N independent ones. Each story is
self-contained by construction, so nothing in story 7 depends on the prose of story 3.
Dispatch the writing as a **single parallel batch, one agent per story**, passing each the
decomposition, its own slice, and the shared context it needs.

Writing fifteen stories sequentially takes fifteen times as long as writing one and buys
nothing. This is the same fan-out already used by `/delivery:simulate` and
`/delivery:challenge`, and for the same reason.

Then reconcile centrally: interfaces named in one story must match the others, dependency
IDs must resolve, and no two stories may claim the same file for the same change. That
check is cheap and it is the only part that genuinely needs the whole set in hand.

**1. Delivery Manager decides the decomposition.** Delegate to `delivery:delivery-lead` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/delivery-lead.md` and adopt the persona).

The governing rule: **the story file is the complete context.** Someone opening one story file — a teammate who missed the planning, or an agent with no memory of it — must have everything needed to finish it. Extract the relevant slices of the PRD and architecture *into* the story. Do not link out. A story requiring three other documents to be read has failed at its one job.

Each story carries: user-facing goal, real verified file paths, the interfaces and contracts it must honor, the architecture decisions that apply and why, acceptance criteria traced to `FR-n`, the test approach with the actual command to run tests in this repo, dependencies on other stories, and explicit out-of-scope notes.

**2. Each writer carries the design system into its UI story.** Where `design-system.md` exists, each story touching UI names the **tokens by their real project name**, the component states it must implement (including error and empty), and the accessibility rules that apply. An implementer who cannot find the token reaches for a raw value, and the design system erodes one commit at a time — naming them in the story is what prevents that.

**3. Verify the file paths exist.** The Delivery Manager cites paths; you check them against the repo. A story pointing at a file that does not exist sends the implementer looking for something imaginary.

**4. QA Strategist sets the test approach** per story — the level, the negative and boundary cases, and how it is verified.

**5. Readiness check.** For each story confirm: acceptance criteria falsifiable, file paths verified, dependencies stated, test approach present, nothing missing. Stories passing get status `ready`; stories failing stay `draft` with the missing element named. Do not mark a story ready under schedule pressure — that is exactly when it costs the most.

**6. Write the stories** to `.delivery/stories/<epic>-<nn>-<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/story.md`, and update the story index at `.delivery/stories/README.md`.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every story is a vertical slice delivering observable behavior, or states why it cannot be
- Every acceptance criterion in the target phase is covered by at least one story
- Every story's file paths verified against the repo
- Dependencies between stories are explicit
- Each story is finishable in one focused sitting, or is split

## Writing, then revising

**Budget: 700 words target, 1200 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report: stories written, how many are `ready` versus `draft`, and what each draft is missing. Flag any acceptance criterion in the phase that no story covers. Next step: `/delivery:sprint` to scope a wave for an implementation runner.
