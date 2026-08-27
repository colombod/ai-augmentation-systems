---
description: Run simulated interviews with end-user personas about a product, feature or concept, to surface unmet needs and objections before building. Use after personas exist. Output is labelled synthetic — hypotheses to test, never presented as research findings. Produces .delivery/interviews/.
argument-hint: "[topic-or-initiative]"
---

# Persona interviews

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.


Topic to probe: **$ARGUMENTS** (defaults to the feature in the brief)

Phase 4a. Inputs: `.delivery/personas/`, `.delivery/initiatives/<initiative>/brief.md`. Output: `.delivery/interviews/`.

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

## The rule this skill exists under

Everything produced here is **synthetic**. A simulated persona's answer is a prediction generated from a persona file, not something a user said. It is worth what the persona's grounding is worth and no more.

Every artifact this skill writes carries that label at the top, and you repeat it when reporting. If simulated output ever gets cited as "users told us", the plugin has done harm rather than good — so be pedantic about this even when it is tedious.

## Gate check

Read `.delivery/personas/`.

- **Missing** — stop, run `/delivery:personas` first. Interviewing a persona you invent on the spot to answer a question you are holding is a machine for confirming what you already believe.
- Note each persona's grounding grade; it determines how the answers should be read, and you will report it.

## Run

**1. Write the interview guide first, before talking to anyone.** Questions must be non-leading. "Would this feature be useful?" invites a yes; "walk me through the last time you had this problem — what did you do?" produces information. Ask about past behavior rather than future intent, since predicted intent is close to worthless even from real people.

Cover: the problem in their own words, what they do today and what it costs them, what they have tried and abandoned, what would have to be true for them to switch, and what would make them stop using it.

Do not describe your solution until the end. Once you do, the persona starts responding to your framing instead of their situation.

**2. Interview each persona independently and in parallel.** Delegate to `delivery:persona-simulator` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/persona-simulator.md` and adopt it, one persona at a time, keeping each strictly separate). Pass the full persona file and the guide.

Run them **in a single parallel batch** — they must not see each other's answers. Independent agreement between personas is a meaningful signal; convergence caused by shared context is not, and it is indistinguishable in the output.

**3. Probe the objections rather than resolving them.** When a persona raises a concern, follow it — how much does that matter, what would it take to overcome, what would you do instead. The instinct is to argue back or design a fix mid-interview. Don't. The objection is the finding.

**4. Interview the skeptic properly.** The persona who is served badly gets the same care as the enthusiast, not a token pass. That transcript is usually the most useful one.

## Synthesize

Do not just concatenate transcripts.

- **Convergent needs** — raised independently by multiple personas. Note how many, and their grounding grades. This is your strongest signal, and it is still a hypothesis.
- **Divergent needs** — where personas want incompatible things. These are the real product decisions; surface them for the Product Owner rather than splitting the difference yourself.
- **Objections**, ranked by how many personas hold them and how fatal each is.
- **Unmet needs** nobody had planned for.
- **Confidence** per finding: derived from `observed` persona attributes, or extrapolated from `assumed` ones.
- **What this cannot tell you** — the questions that genuinely need real people, added to the research backlog.

## Write

Every interview file opens with this banner, verbatim — reproduced here because the
template may not be readable:

```markdown
> ⚠ **SIMULATED PERSONA OUTPUT — a hypothesis to test, not a research finding.**
> Generated from `.delivery/personas/<slug>.md`, grounding: **<grade>**.
> Nothing here is something a real user said. Do not cite as "users told us".
```

Write per-persona transcripts to `.delivery/interviews/<persona-slug>-<topic>.md` and the synthesis to `.delivery/interviews/README.md`, using `${CLAUDE_PLUGIN_ROOT}/templates/interview.md`. The synthetic-output label goes at the top of every file.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Interview guide written before the interviews, questions non-leading
- Every persona interviewed independently, in parallel
- Synthesis separates convergent from divergent, with confidence tied to grounding
- The research backlog names what simulation cannot settle

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

**Budget: 500 words target, 800 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 800, you are not finished.** Make a revision pass over the file and
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

Report the synthesis with the synthetic label attached. Lead with the divergences and the fatal objections — the comfortable findings are not what this phase is for.

Next step: `/delivery:simulate` to walk personas through the actual journey.
