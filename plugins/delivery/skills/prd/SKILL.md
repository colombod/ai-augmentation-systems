---
description: Turn a product brief into a full PRD with user scenarios, acceptance criteria and non-functional requirements, then stage it into an MVP and later stages that each let a persona finish a journey. Use once the problem and users are settled and you need a specification precise enough to design against. Produces .delivery/initiatives/<initiative>/prd.md and prioritization.md; --stage re-runs only the MVP staging.
argument-hint: "[initiative] [--stage]"
---

# Product requirements document

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Scope note from user: **$ARGUMENTS**

DEFINE stage. Inputs: `.delivery/initiatives/<initiative>/brief.md`, plus `research.md`, `personas/`, `interviews/` and `simulations/` where they exist. Output: `.delivery/initiatives/<initiative>/prd.md`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Open blocking findings**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read `.delivery/initiatives/<initiative>/brief.md`.

- **Missing** — stop. Tell the user to run `/delivery:brief` first, and offer to run it now. Do not improvise a brief.
- **Exists but thin** (no named user segment, no measurable success signal, or unresolved blocking questions) — say specifically what is weak, and ask whether to proceed anyway or strengthen the brief first. Proceeding on a weak brief is a legitimate choice, but it should be a choice.
- If `.delivery/initiatives/<initiative>/prd.md` already exists, read it and ask whether to
  **revise**, **replace**, or **start new version**. See
  `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the
  same-problem test that chooses between revise and start new version, and the
  Version-history table and Corrections log it writes. Never silently overwrite.

**Open blocking findings.** Apply the conventions' *Open blocking findings* check to every artifact this phase consumes before going further.

## Run

**1. Product Owner drafts the scenarios.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). Each scenario needs an actor, a trigger, a sequence, and an observable outcome — not a feature-list entry. Each gets falsifiable acceptance criteria.

**2. Business Analyst stress-tests them.** Delegate to `delivery:business-analyst` with the draft scenarios. It walks the unhappy-path checklist systematically — empty, single, large, duplicate, concurrent, permission denied, resource missing, partial failure, timeout, undo — and produces the non-functional requirements as numbers.

**3. QA Strategist checks verifiability.** Delegate to `delivery:qa-strategist` to check every acceptance criterion: what would you run or observe to decide pass or fail? Rewrite any criterion that fails this test. This step catches more real defects than any later testing, so do not skip it under time pressure.

**4. Resolve or record.** Where the roles disagree or a number is unknown, put it to the user. Anything still unresolved goes in the open-questions register with an owner — never invent a latency target or a data volume.

**5. Write the PRD** to `.delivery/initiatives/<initiative>/prd.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prd.md`. Give every requirement a stable ID (`FR-1`, `NFR-1`) — the roadmap, stories and tests will reference these, and renumbering later breaks the chain.

## Step 6 — MVP staging

Output: `.delivery/initiatives/<initiative>/prioritization.md`. Inputs: the PRD just written,
plus `.delivery/simulations/`, `.delivery/interviews/` and `.delivery/personas/` where they
exist. With `--stage`, run only this step against an existing `prd.md`: skip the PRD's own
revise/replace question and steps 1–5, keep the blocking-findings gate, and stop if `prd.md`
is missing. Value is ranked here with rough effort; the real-cost
pass comes later, in `/delivery:roadmap`.

Read the simulation and interview outputs if they exist. If they do not, warn clearly: **prioritisation without persona data is prioritisation by opinion.** It is a legitimate choice, but the resulting stages rest on the team's beliefs about value rather than on any model of user behavior, and the document must say so. Offer to run `/delivery:simulate` first.

If `.delivery/initiatives/<initiative>/prioritization.md` already exists, read it and ask
whether to **revise**, **replace**, or **start new version**. See
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the same-problem
test that chooses between revise and start new version, and the Version-history table and
Corrections log it writes. Never silently overwrite.

**6.1 Establish the staging rule.** A stage is not a batch of features. A stage is a set of features that lets **at least one persona complete a journey end to end and get value**. A stage that serves nobody completely is a milestone in the project plan, not a release — and calling it an MVP is how teams ship something no one can use.

Take this directly from the simulation's per-persona coverage data: for each candidate stage, name which personas can complete which journeys. If the answer is none, the stage is wrongly cut.

**6.2 Score each requirement.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). For every `FR-n`:

| Dimension | Source |
| :-- | :-- |
| **Personas served** | which personas need it, from the persona files |
| **Load-bearing?** | does its absence cause abandonment, from the friction map |
| **Severity** | friction-map ranking |
| **Objection addressed** | which interview objection it answers, if any |
| **Effort** | rough size, flagged as an estimate not yet architecture-informed |
| **Confidence** | grounding grade of the persona evidence behind the score |

Load-bearing beats enhancement. A feature that prevents abandonment for two personas outranks one that delights one persona, unless the delight is the differentiator — and if it is, say so explicitly rather than letting it win quietly.

**6.3 Cut the stages.** Typically MVP / Stage 2 / Stage 3 / explicitly-not-doing. For each stage state:

- Requirements included, by `FR-n`
- **Personas who can complete a journey end to end** — the test of whether it is a real stage
- Personas explicitly *not* served yet, and when they will be. Naming this prevents a segment from being silently abandoned.
- What the stage lets you learn — each stage should answer a question, since a stage that teaches nothing could have been merged into the next one
- Why the excluded features can wait, in terms of the friction map

**Evidence-only marker — check this for every stage, every run, not just the first time.**
Look at the `Confidence` column for every persona the stage names as completing a journey
end to end. If **every one** of them reads `assumed` — no `observed`, no `reported`, not
even one — the stage cannot be written as plain "ready." Render the marker
`**⚠ Evidence-only — every supporting persona is `assumed`-grade.**` immediately under the
stage's `**Includes:**` line in `templates/prioritization.md`, not as a footnote or an aside
buried in prose. A stage with even one `observed` or `reported` persona backing it gets no
marker — this only fires when *nothing* behind the stage is confirmed, including the case
where a stage cites no personas at all (that is stricter than "all assumed," not an
exemption from it). This is a check you re-run every time this skill runs against an
existing `prioritization.md`, not a stamp applied once: if a persona's grounding is later
upgraded from `assumed` to `observed` or `reported`, the marker on any stage that depended
on it is removed on the next run, without anyone having to remember to clear it by hand.

**6.4 Define milestones.** Each milestone gets a demonstrable outcome — what you would show, and to whom. Distinguish **release milestones** (users get something) from **learning milestones** (you find something out, such as a spike or a real-research checkpoint from the backlog). Both are legitimate; conflating them is not.

**6.5 Have the Program Manager check feasibility.** Delegate to `delivery:program-manager` for whether the stages can actually be sequenced this way, and what dependencies would force a reorder.

**6.6 Have the critic attack the MVP boundary.** Delegate to `delivery:feature-critic` (read-only) with one question: *is the MVP actually viable, or is it the minimum product with the viability removed?* Fold blocking findings in.

Write to `.delivery/initiatives/<initiative>/prioritization.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prioritization.md`.

Where scores rest on `assumed`-grade personas, mark them. A prioritisation built on invented users is a plan for an invented market, and the reader is entitled to know how much of it is that.

**Staging exit criteria**

- Every `FR-n` scored and assigned to a stage or explicitly excluded
- Every stage names the personas who can complete a journey end to end
- Personas not yet served are named per stage, with when they will be
- Each stage states what it lets you learn
- Milestones are demonstrable, and release milestones are distinguished from learning milestones
- Confidence reflects the grounding of the persona evidence

**Staging budget: 700 words target, 1100 hard cap** (excludes code, YAML and data tables), in `prioritization.md`, measured separately from the PRD's.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every scenario has an actor, trigger, sequence and observable outcome
- Every scenario has at least one error or edge path
- Every acceptance criterion is falsifiable by someone who did not write it
- Non-functional requirements are numbers, or explicitly listed as open questions
- Requirements have stable IDs
- Out of scope is stated explicitly

## Writing, then revising

**Budget: 1000 words target, 1600 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report exit criteria status honestly, including any criterion you could not make falsifiable. Then report the stages, and lead with the MVP's persona coverage — that is the claim everything else rests on. Flag any persona served by no stage at all.

Recommend `/delivery:challenge .delivery/initiatives/<initiative>/prd.md` (and `prioritization.md`) before design — the adversarial pass is cheapest here. Then `/delivery:design` if the product has a UI worth a design system, and `/delivery:architecture` to design the MVP stage.
