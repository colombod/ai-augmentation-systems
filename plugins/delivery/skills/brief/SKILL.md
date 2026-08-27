---
description: Frame a feature idea, or assess an existing product, and produce a brief. Use at the very start — when the idea is still a sentence, or when you need an honest account of what a working product gets wrong today. Produces .delivery/initiatives/<initiative>/brief.md.
argument-hint: "[subject-or-initiative]"
---

# Product brief

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.


Subject: **$ARGUMENTS**

Phase 1 of the pipeline. Output: `.delivery/initiatives/<initiative>/brief.md`.

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

## Pick the mode first, and say which

The two jobs are different sizes and different documents. State the mode in the brief's header.

| Mode | When | Budget |
| :-- | :-- | :-- |
| **Frame** | A new feature or product. The problem is ahead of you. | target 600 words, cap 900 |
| **Assess** | An existing, working product. The problems are already in the code. | target 1200 words, cap 2000 |

If the target is an existing codebase and the request is to evaluate it, that is **assess**.
A new capability for an existing product is **frame** — the existing product is context,
not the subject.

## Gate check

No prerequisites — this is the entry point. If `.delivery/initiatives/<initiative>/brief.md`
already exists, read it and ask whether to **revise**, **replace**, or **start new version**.
See `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the
same-problem test that chooses between revise and start new version, and the
Version-history table and Corrections log it writes. Never silently overwrite.

## Run

**1. Understand the ground truth.** If a codebase exists, read it before writing anything
about what should be. Note the current behavior, and how you would verify a claim about it.

**2. Find, convergently — this is the part that determines whether the brief is any good.**

A single analytical pass finds *some* of what is there, not the most important of it. Two
passes over the same code, prompted the same way, return overlapping-but-different sets, and
the difference is not correlated with severity. Running once and reporting the result as
"the problems" overstates what one pass knows.

So dispatch **at least three finders in parallel, in a single message**, each with a
different lens. They must not see each other's output — independent convergence is the only
signal here worth trusting.

| Lens | Agent | Asks |
| :-- | :-- | :-- |
| Value | `delivery:product-owner` | Who has this problem, what does it cost them, what would success look like |
| Precision | `delivery:business-analyst` | What is ambiguous, what cases are unhandled, what numbers are missing |
| Absence | `delivery:feature-critic` | What is *not* here that should be — the unasked question, the missing state |

In **assess** mode add a fourth:

| Decay | `delivery:qa-strategist` | What was true when written and is not true now — dated data, expiring calendars, stale rates, assumptions with a shelf life |

That lens exists because temporal defects are invisible to structural review. A test suite
checks whether data has the right shape, never whether it is still true.

If subagents are unavailable, work the lenses sequentially from the persona files under
`${CLAUDE_PLUGIN_ROOT}/agents/`, keeping each pass isolated and not reading back the
previous one's output.

**3. Merge and mark convergence.** Deduplicate. For every finding record **how many lenses
found it independently**. Report the single-lens findings *as* single-lens — they are the
ones most likely to be wrong, and equally the ones another pass would have missed.

Then state the coverage honestly: if each lens surfaced material the others did not, the
space is **not exhausted**, and the brief should say so rather than implying completeness.

**4. Verify before asserting.** Any finding with a number in it — a count, a price, a date —
gets checked against the source before it enters the brief. Specific, confident and wrong is
the worst thing this phase can produce, because precision reads as authority.

**5. Ask what you cannot determine.** Collect open questions, drop the ones the codebase
answers, put the rest to the user in one batch. Record what stays unanswered. Never invent
an answer, and never quietly drop a question because it is inconvenient.

**6. Write** to `.delivery/initiatives/<initiative>/brief.md` using `${CLAUDE_PLUGIN_ROOT}/templates/brief.md`.

## Exit criteria

- Mode stated, and the document within that mode's cap — **or the overrun declared in the document with its reason**. Count the words; do not estimate.
- At least three lenses ran independently, and convergence is recorded per finding
- Coverage stated: whether the finders agreed enough to call the space explored
- Every numeric claim verified against its source
- A named user segment, not "users"
- The problem stated as something happening today, with its cost
- At least one measurable success signal
- Explicit out-of-scope list
- Open questions with owners, where any remain

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

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`.

The budget above is a hard check, not an aspiration. Before finishing, count the words
excluding code, YAML and data tables. Over the cap, cut restatement, process narration and
hedging — never findings, citations, grounding labels, open questions or IDs. If it still
does not fit, keep the substance and **write the overrun and its reason into the document**.
A declared overrun is a judgement; a silent one is a habit.

## Hand off

Report exit criteria status, the convergence picture, and anything found by only one lens.
If the finders disagreed enough that the space looks unexplored, say so — that is a reason
to run again, not to proceed.

Next step: `/delivery:challenge .delivery/initiatives/<initiative>/brief.md`, then `/delivery:research`.
