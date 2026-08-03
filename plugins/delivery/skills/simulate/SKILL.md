---
description: Walk end-user personas step by step through a journey — an existing product, a proposed flow, or a live site — to find where they get stuck, confused, or leave. Produces a friction map and per-step value data that feeds MVP staging. Use after personas exist. Produces docs/product/simulations/.
---

# Journey simulation

Journey to simulate: **$ARGUMENTS** (defaults to the primary scenario in the brief or PRD)

Phase 4b. Inputs: `docs/product/personas/`, plus whatever describes the journey — the PRD, the running product, or the codebase. Output: `docs/product/simulations/`.

## The rule this skill exists under

Simulated friction is a **hypothesis about where real friction lives**, not a usability finding. It is good at generating candidates cheaply and bad at telling you which are real. Label every artifact synthetic, and never let a simulated abandonment rate become a number in a business case.

What it is genuinely good at: catching the step nobody thought about, the assumed knowledge, and the missing state — the problems that are obvious once named and invisible until someone walks the path.

## Gate check

Read `docs/product/personas/`. If missing, stop and run `/delivery:personas`.

Then establish what is being walked through, in this order of preference:

1. **A real running product** — best. Read the actual code, pages, and copy so personas react to what exists rather than what was intended. If a dev server or a deployed URL is available and browser tooling is present, use it.
2. **A specified flow** — the scenarios in `docs/product/prd.md`.
3. **A proposed flow** — described in the brief.

Say which you used. A simulation against intent rather than implementation finds different problems, and the reader needs to know which they are getting.

## Run

**1. Break the journey into concrete steps.** Every step a real person takes, including the ones teams forget: arriving from search with the wrong expectation, the language or currency being wrong, the loading state, the empty state, the error, the moment of deciding whether to trust the site, the point of entering personal data, and what happens after they act.

**2. Walk each persona through, independently and in parallel.** Delegate to `delivery:persona-simulator` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/persona-simulator.md` and run each persona separately, keeping them strictly isolated). Run all personas in **one parallel batch** so they cannot influence each other.

Each persona carries its own constraints through every step: device, connection, language, time available, budget, expertise, and whether someone else must approve. Most friction comes from constraints, not preferences.

At each step the persona reports: what they understood, what they expected next, what they actually noticed, how they felt, and whether they would continue. **Abandonment gets recorded at the exact step**, with what they would do instead.

**3. Simulate the unhappy paths too**, not just the intended route. Arriving mid-journey from a deep link. Making a mistake and needing to correct it. Coming back two days later. Being interrupted. These are where products lose people.

## Build the friction map

Aggregate into a step-by-step map:

| Step | Personas reaching it | Friction | Abandoned here | Severity |
| :-- | :-- | :-- | :-- | :-- |

**Severity** = how many personas hit it × whether it blocks or merely annoys. Rank the map by it.

Then, and this is the output that feeds staging, produce **per-step value data**:

- **Which steps are load-bearing** — remove them and the journey fails for someone. These are MVP candidates.
- **Which steps are enhancements** — their absence causes annoyance, not abandonment. These are staging candidates.
- **Which personas are fully served** by the current step set, and which are not served at all. A stage that serves nobody end to end is not a stage, and this is how you detect that.

## Write

Every simulation file opens with this banner, verbatim — it is reproduced here because
the template may not be readable:

```markdown
> ⚠ **SIMULATED OUTPUT — hypotheses about where friction lives, not usability findings.**
> Personas walked: <list, with grounding grades>. Nobody was observed.
> Never turn a simulated abandonment count into a number in a business case.
```

Write to `docs/product/simulations/<journey-slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/simulation.md`, with the synthetic label at the top. Note which basis you walked — real product, specified flow, or proposed flow.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Journey broken into concrete steps including empty, error and return states
- Every persona walked independently, in parallel
- Abandonment recorded at specific steps with the alternative they would choose
- Friction map ranked by severity
- Load-bearing versus enhancement steps separated, and per-persona end-to-end coverage stated
- Basis of the simulation stated

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

**Budget: 900 words target, 1500 hard cap, for the document.** Excludes code, YAML and data
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

Report the ranked friction map and the load-bearing step set, labelled synthetic. Flag any persona that cannot complete the journey at all — that is either a scope decision or a segment you are choosing not to serve, and it should be a choice rather than an accident.

Next step: `/delivery:prd` if scenarios are not yet written, or `/delivery:prioritize` if they are — the friction map is a direct input to MVP staging.
