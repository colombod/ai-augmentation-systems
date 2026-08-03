---
description: Run simulated interviews with end-user personas about a product, feature or concept, to surface unmet needs and objections before building. Use after personas exist. Output is labelled synthetic — hypotheses to test, never presented as research findings. Produces docs/product/interviews/.
---

# Persona interviews

Topic to probe: **$ARGUMENTS** (defaults to the feature in the brief)

Phase 4a. Inputs: `docs/product/personas/`, `docs/product/brief.md`. Output: `docs/product/interviews/`.

## The rule this skill exists under

Everything produced here is **synthetic**. A simulated persona's answer is a prediction generated from a persona file, not something a user said. It is worth what the persona's grounding is worth and no more.

Every artifact this skill writes carries that label at the top, and you repeat it when reporting. If simulated output ever gets cited as "users told us", the plugin has done harm rather than good — so be pedantic about this even when it is tedious.

## Gate check

Read `docs/product/personas/`.

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
> Generated from `docs/product/personas/<slug>.md`, grounding: **<grade>**.
> Nothing here is something a real user said. Do not cite as "users told us".
```

Write per-persona transcripts to `docs/product/interviews/<persona-slug>-<topic>.md` and the synthesis to `docs/product/interviews/README.md`, using `${CLAUDE_PLUGIN_ROOT}/templates/interview.md`. The synthetic-output label goes at the top of every file.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Interview guide written before the interviews, questions non-leading
- Every persona interviewed independently, in parallel
- Synthesis separates convergent from divergent, with confidence tied to grounding
- The research backlog names what simulation cannot settle

## Language

Read `docs/product/glossary.md` first and use its terms exactly. If it does not exist, run
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

**Budget: 500 words target, 800 hard cap, for each transcript.** Excludes code, YAML and data
tables. Count before finishing; do not estimate.

These numbers are stated here, not only in the template, because the template file may not
be readable from the working directory this runs in — a rule that lives only in a file the
model cannot open is not a rule.

Over the cap, cut in this order: preamble and recap, restatement (each fact appears once,
in the form that carries it best), process narration, hedging, redundant citations,
examples past the first. **Never cut** findings and their failure scenarios, one citation
per claim, grounding and confidence labels, synthetic-output warnings, open questions, or
IDs a later phase reads. If it will not fit without losing those, keep them, go over, and
**write the overrun and its reason into the document.**

The full standard is at `templates/writing-standard.md` in the plugin, where readable.


## Hand off

Report the synthesis with the synthetic label attached. Lead with the divergences and the fatal objections — the comfortable findings are not what this phase is for.

Next step: `/delivery:simulate` to walk personas through the actual journey.
