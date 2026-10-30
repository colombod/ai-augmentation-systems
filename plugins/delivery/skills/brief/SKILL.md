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

DEFINE stage, the entry point. Output: `.delivery/initiatives/<initiative>/brief.md`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Language** bind this skill as if written here.

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

**4b. The owner's lens, what must survive, and the proposition.** Methods ported from
michaeljabbour's Taste and Sizzle skills (MIT; see `${CLAUDE_PLUGIN_ROOT}/NOTICE`).

- *Lens.* What the owner values here and why, in at most three questions, put in step 5's batch:
  what experience taught them to value this; what they admire or dislike in a concrete example,
  and which choice creates that reaction; what someone should feel, understand or do, and what
  must not be lost. Skip any question the owner's own words already answer. Reflect it back in
  one line ("you value X because Y, while wanting to preserve Z") and let them correct it. With
  no answer, write the lens **assumed**: the team's reading, never written as the owner's words or
  quoted, and keep the questions open.
- *What must survive.* The few things any later cut or change must keep, in the owner's words.
  The PRD's staging cannot drop one without the owner's record. Only an item in the owner's own
  words binds; one the team assumed is labelled **assumed**, is a proposal like any other, and goes
  to the owner with the lens questions.
- *Proposition.* The one thing the named user must believe or be able to do at the end, in one
  sentence. If it needs "and also", there are two products: say so, and propose which one this is.
- *Gates first.* Correctness, safety, accessibility, feasibility: each pass, fail, unknown or not
  applicable, with a reason. A fail is critical when it would make the product wrong, unsafe,
  unusable by its named users, or unbuildable. A critical fail is not the team's veto: it goes to
  the owner as a decision, with its evidence and a recommendation; a critical
  unknown is an open question.

**5. Ask what you cannot determine.** Collect open questions, drop the ones the codebase
answers, put the rest (with step 4b's lens questions) to the user in one batch. Record what stays unanswered. Never invent
an answer, and never quietly drop a question because it is inconvenient.

**6. Write** to `.delivery/initiatives/<initiative>/brief.md` using `${CLAUDE_PLUGIN_ROOT}/templates/brief.md`.

## Exit criteria

- Mode stated, and the document within that mode's cap — **or the overrun declared in the document with its reason**. Count the words; do not estimate.
- At least three lenses ran independently, and convergence is recorded per finding
- Coverage stated: whether the finders agreed enough to call the space explored
- Every numeric claim verified against its source
- A named user segment, not "users"
- The owner's lens and what must survive, in their words or labelled **assumed**
- One proposition in one sentence, and the four gates each marked with a reason
- The problem stated as something happening today, with its cost
- At least one measurable success signal
- Explicit out-of-scope list
- Open questions with owners, where any remain

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
