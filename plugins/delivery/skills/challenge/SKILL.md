---
description: Run an adversarial review panel against any pipeline artifact — brief, research, personas, PRD, prioritisation, design, architecture, roadmap or stories — and record ranked findings with tracked status. Use before committing to any artifact. Read-only; findings must be resolved or explicitly rejected, not silently dropped.
argument-hint: "[artifact-path]"
---

# Adversarial challenge

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.


Target: **$ARGUMENTS** (an artifact path, or a phase name; defaults to the most recently written artifact)

This is the pipeline's review mechanism, usable at any gate. It is read-only: it produces findings, never edits.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Which initiative

Every artifact below lives under `.delivery/initiatives/<slug>/`, never directly under
`.delivery/` — this is what lets independent initiatives (epics, sprints, parallel
workstreams) be planned in parallel branches without colliding on the same shared file
(`ADR-004`; the incident that motivated it: two initiatives independently continued the same
`S-n`/`FR-n` sequence in one shared `prd.md`, discovered only at merge). Resolve which
initiative before reading or writing anything below:

1. **Explicit signal.** The user names an initiative, or one is already established for this
   conversation — use it.
2. **Exactly one exists.** If `.delivery/initiatives/` has exactly one subdirectory, use it
   without asking — this keeps single-initiative projects exactly as simple as before this
   convention existed.
3. **Ask, don't guess.** Otherwise (zero, or more than one, with no explicit signal) — ask
   which initiative this work belongs to, or whether to start a new one. Never silently
   default to the most recently modified one.
4. **Starting a new initiative.** Confirm its slug (kebab-case, derived from the brief
   subject or what the user names) before creating `.delivery/initiatives/<slug>/` — check it
   doesn't collide with an existing initiative slug or any other top-level `.delivery/` entry.
   A genuinely new initiative needs its own `/delivery:brief`, or an explicit
   `extends: <existing-slug>` note (in this new initiative's own first artifact) declaring it
   reuses an existing initiative's problem framing instead of running its own — state which,
   don't leave it implicit.

Cross-cutting, project-wide, never per-initiative: `.delivery/glossary.md`,
`.delivery/personas/`, `.delivery/interviews/`, `.delivery/simulations/`,
`.delivery/decisions/ADR-NNN-*.md`, `.delivery/invocations/<session_id>.ndjson`.
`.delivery/stories/`, `.delivery/reviews/`, `.delivery/sprints/` stay flat but are prefixed
by initiative slug, matching `stories/<slug>-NN-<name>.md`'s existing convention.

## Why findings are tracked

An adversarial review that produces a list nobody acts on is theatre, and it is worse than no review because it manufactures the feeling of rigor. So every finding here is written to `.delivery/reviews/` with a status, and `/delivery:status` reports any that are still **open**. A finding leaves the list by being **fixed** or **rejected with a stated reason** — never by being ignored.

## Gate check

Resolve the target. If given a phase name, map it to its artifact. If nothing is given, take the most recently modified artifact under `.delivery/`. If the target does not exist, say so and stop.

If the target carries a Version-history table (per
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md`), record which version is current and
its Status cell — this review is against that version specifically, not the whole
document's history. A target with no table has no version to record.

## Choose the panel

Reviewer lenses are chosen by artifact type. Diversity of lens matters more than number of reviewers — three reviewers asking different questions beat five asking the same one.

| Target | Panel |
| :-- | :-- |
| `brief.md` | `product-owner`, `business-analyst`, `feature-critic` |
| `research.md` | `business-analyst`, `solution-architect`, `feature-critic` |
| `personas/` | `user-researcher`, `product-owner`, `feature-critic` |
| `prd.md` | `product-owner`, `business-analyst`, `qa-strategist`, `feature-critic` |
| `prioritization.md` | `product-owner`, `program-manager`, `user-researcher`, `feature-critic` |
| `design-system.md` | `design-lead`, `user-researcher`, `qa-strategist`, `feature-critic` |
| `architecture.md` | `solution-architect`, `qa-strategist`, `program-manager`, `feature-critic` |
| `roadmap.md` | `program-manager`, `product-owner`, `qa-strategist`, `feature-critic` |
| `stories/` | `delivery-lead`, `qa-strategist`, `solution-architect`, `feature-critic` |

`feature-critic` is on every panel — it is the only reviewer with no stake in the artifact moving forward.

Where personas exist and the artifact touches user-facing behavior, add one `persona-simulator` running the **skeptic** persona. A challenge from the user's side catches things no internal role will.

## Run

Read the target fully yourself before dispatching anyone — you need to judge the findings, not just relay them.

Run every reviewer **in parallel, in a single message**. They must not see each other's output: independent convergence is the signal this whole skill trades on, and shared context destroys it. Instruct each explicitly to modify no files and return findings only.

If subagents are unavailable, read each persona file under `${CLAUDE_PLUGIN_ROOT}/agents/` and work the lenses sequentially, keeping each pass isolated.

## Synthesize

Judge the findings; do not concatenate them.

1. **Deduplicate**, noting where reviewers independently agreed. Say so explicitly — convergence between reviewers who could not see each other is the strongest signal available here.
2. **Rank by expected cost** = likelihood it bites × cost of fixing it later, not by reviewer order or severity label.
3. **Classify**: **blocking** (resolve before the next phase), **significant** (resolve before implementation), **minor** (note and move on).
4. **Drop preferences.** Anything without a concrete failure scenario is not a finding. Report how many you dropped — that number is a quality signal about the panel.
5. **Check the reviewers.** A reviewer that returned nothing but praise, or nothing but style notes, did not do its job; say so rather than padding its output into the list.

For each surviving finding: the specific claim or omission, the concrete failure scenario, and what would resolve it.

## Write

Append to `.delivery/reviews/<artifact>-<nn>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/findings.md` — or `.delivery/reviews/<artifact>-v<N>-<nn>.md` (e.g. `prd-v2-01.md`) when the target carries a Version-history table at review time, recording which version the review actually covered. Unversioned targets (`stories/`, tableless documents) keep the plain `<artifact>-<nn>.md` form; pre-existing review files are not renamed retroactively. Every finding gets an ID (`R-<artifact>-<n>`) and status `open`.

Do not edit the target artifact in this skill. Present the findings and let the user decide; then apply agreed changes and mark those findings `fixed`. A finding the user declines is marked `rejected` **with their stated reason recorded** — the reason is the valuable part, because it is the assumption you will want to revisit when something goes wrong.

## Language

Read `.delivery/glossary.md` first and use its terms exactly. If it does not exist, run
`/delivery:glossary` — or, for a small effort, collect terms as you go and propose the file
at the end. Do not coin synonyms for concepts it already names.

Any term you need that is missing gets **proposed explicitly**, with a definition in the
business's vocabulary and a concrete referent. Any term carrying two meanings gets raised as
a defect, not resolved silently.

**Questions go out in the vocabulary of whoever must answer them**, with a worked example in
their world. A question for the business owner written in engineering terms is a blocker
with a name on it, not a question. If a question is really an engineering call, decide it
here rather than routing it to them.

## Writing, then revising

**Budget: 120 words target, 200 hard cap** (excludes code, YAML and data tables).

**Compose first. Do not try to hit the budget while writing.** Restraint during
composition trades substance for brevity in the wrong order — the findings get thinner
while the scaffolding survives. Write what the artifact needs, then cut what it does not.

**Then measure, do not estimate.** The budget counts **prose only**. Data tables, code
blocks and YAML are excluded, so measure with them stripped:

```bash
grep -v '^|' <the file you just wrote> | wc -w
```

A plain `wc -w` counts the tables and will overstate the total, often by several times.
Measuring the wrong number leads to cutting the wrong thing.

**Rows in a data table can never help you meet the budget, because they are not counted.**
Deleting them is pure loss for zero benefit. The term table, the requirement table, the
findings table, the friction map — these *are* the artifact. If a revision pass is removing
rows, it has misunderstood the rule and should stop.

**If the count exceeds 200, you are not finished.** Make a revision pass over the file and
delete, in this order, until it fits:

1. Preamble, recap, and any sentence describing what the document is about to say
2. **Restatement** — the same fact as prose *and* a table row *and* a summary bullet. Keep the form that carries it best; delete the others. This is almost always the biggest win.
3. Process narration — "I examined X and found Y" becomes Y
4. Hedging — either you know it, or it is labelled an assumption. Both are shorter.
5. Citations past the first for a given claim
6. Examples past the first, unless the next one shows a *different* failure mode

Then re-measure with the same command and confirm.

**Never delete** any row of a data table, findings and their failure scenarios, one citation per claim, grounding
and confidence labels, synthetic-output warnings, open questions, or IDs a later phase
reads. If the artifact cannot fit without losing those, keep them, exceed the cap, and
**write the final count and the reason into the document**. A declared overrun is a
judgement. A silent one is a habit.


## Report

Lead with blocking findings and with anything multiple reviewers found independently.

If the artifact is genuinely sound, say so and name the two or three assumptions worth watching. Do not pad — a padded critique teaches people to skim the next one, which costs more than the finding you invented was worth.
