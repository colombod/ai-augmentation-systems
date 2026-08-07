---
description: Prioritise features and define MVP stages and milestones, using persona simulation data to decide what each stage must contain to be worth shipping. Use after the PRD and simulation exist and before architecture. Produces .delivery/initiatives/<initiative>/prioritization.md.
---

# Feature prioritisation and MVP staging

Constraint or focus: **$ARGUMENTS**

Phase 6 of the pipeline. Inputs: `.delivery/initiatives/<initiative>/prd.md`, `.delivery/simulations/`, `.delivery/interviews/`, `.delivery/personas/`. Output: `.delivery/initiatives/<initiative>/prioritization.md`.

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

## Gate check

Read the PRD. If it is missing, stop — you cannot prioritise requirements that have not been written down. Run `/delivery:prd` first.

Read the simulation and interview outputs if they exist. If they do not, warn clearly: **prioritisation without persona data is prioritisation by opinion.** It is a legitimate choice, but the resulting stages rest on the team's beliefs about value rather than on any model of user behavior, and the document must say so. Offer to run `/delivery:simulate` first.


**Open blocking findings.** Read `.delivery/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Establish the staging rule.** A stage is not a batch of features. A stage is a set of features that lets **at least one persona complete a journey end to end and get value**. A stage that serves nobody completely is a milestone in the project plan, not a release — and calling it an MVP is how teams ship something no one can use.

Take this directly from the simulation's per-persona coverage data: for each candidate stage, name which personas can complete which journeys. If the answer is none, the stage is wrongly cut.

**2. Score each requirement.** Delegate to `delivery:product-owner` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/product-owner.md` and adopt the persona). For every `FR-n`:

| Dimension | Source |
| :-- | :-- |
| **Personas served** | which personas need it, from the persona files |
| **Load-bearing?** | does its absence cause abandonment, from the friction map |
| **Severity** | friction-map ranking |
| **Objection addressed** | which interview objection it answers, if any |
| **Effort** | rough size, flagged as an estimate not yet architecture-informed |
| **Confidence** | grounding grade of the persona evidence behind the score |

Load-bearing beats enhancement. A feature that prevents abandonment for two personas outranks one that delights one persona, unless the delight is the differentiator — and if it is, say so explicitly rather than letting it win quietly.

**3. Cut the stages.** Typically MVP / Stage 2 / Stage 3 / explicitly-not-doing. For each stage state:

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

**4. Define milestones.** Each milestone gets a demonstrable outcome — what you would show, and to whom. Distinguish **release milestones** (users get something) from **learning milestones** (you find something out, such as a spike or a real-research checkpoint from the backlog). Both are legitimate; conflating them is not.

**5. Have the Program Manager check feasibility.** Delegate to `delivery:program-manager` for whether the stages can actually be sequenced this way, and what dependencies would force a reorder.

**6. Have the critic attack the MVP boundary.** Delegate to `delivery:feature-critic` (read-only) with one question: *is the MVP actually viable, or is it the minimum product with the viability removed?* Fold blocking findings in.

## Write

Write to `.delivery/initiatives/<initiative>/prioritization.md` using `${CLAUDE_PLUGIN_ROOT}/templates/prioritization.md`.

Where scores rest on `assumed`-grade personas, mark them. A prioritisation built on invented users is a plan for an invented market, and the reader is entitled to know how much of it is that.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every `FR-n` scored and assigned to a stage or explicitly excluded
- Every stage names the personas who can complete a journey end to end
- Personas not yet served are named per stage, with when they will be
- Each stage states what it lets you learn
- Milestones are demonstrable, and release milestones are distinguished from learning milestones
- Confidence reflects the grounding of the persona evidence

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

**Budget: 700 words target, 1100 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 1100, you are not finished.** Make a revision pass over the file and
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


## Hand off

Report the stages, and lead with the MVP's persona coverage — that is the claim everything else rests on. Flag any persona served by no stage at all.

Next step: `/delivery:architecture` to design the MVP stage, then `/delivery:roadmap` to sequence delivery.
