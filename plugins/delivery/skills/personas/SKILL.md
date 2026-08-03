---
description: Derive customer and end-user personas grounded in whatever evidence exists, graded by how much evidence there actually is. Use after research and before writing scenarios, so the product is specified against real user segments rather than an imagined average user. Produces docs/product/personas/.
---

# End-user personas

Focus or segment hint: **$ARGUMENTS**

Phase 3 of the pipeline. Inputs: `docs/product/brief.md`, `docs/product/research.md`. Output: `docs/product/personas/`.

These are **customer personas** — the people who use the product. They are a different thing from the plugin's internal role agents (Product Owner, Architect, and so on), which represent the team.

## Gate check

Read the brief, and the research if it exists.

- **Brief missing** — stop, run `/delivery:brief` first.
- **Research missing** — warn. Personas built without research are `assumed`-grade at best, which sharply limits what they can be used for later. Offer to run `/delivery:research` first; proceed if the user chooses to.
- If personas already exist, read them and ask whether to revise, add, or replace.

## Run

**1. Find the real evidence first.** Delegate to `delivery:user-researcher` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/user-researcher.md` and adopt the persona). Before constructing anything, it hunts for what already exists: analytics, support tickets, reviews of this product or its competitors, sales notes, search queries, forum complaints, the complaint threads found during research. Real quotes beat invented ones. Report what was found and what was looked for and missing.

**2. Segment by behavior, not demographics.** Segment on the job being done, the constraints, the frequency, the stakes, and who else must be convinced. "35–45, urban professional" predicts nothing; "books six months ahead, compares four tabs, must justify the spend to a partner" predicts a lot.

**3. Build three to five distinct personas.** Test distinctness by naming where each would diverge from the others in a real scenario. If you cannot name a divergence, merge them.

The set must include at least one persona the product currently serves badly. Teams construct personas that validate their plans; deliberately include the skeptic, the accessibility user, the one who arrives through an unintended path, or the one for whom the price is the problem. A persona set where everyone is enthusiastic and capable is a marketing asset, not a research tool.

**4. Grade the grounding — this is the part that matters most.** Every persona, and every significant attribute within it, is labelled:

- **observed** — traceable to real data you can cite
- **reported** — the team's or a source's belief, second-hand
- **assumed** — constructed by reasoning, with no evidence behind it

Mixed grading within one persona is normal and expected. An `assumed` persona is legitimate and useful; it is only illegitimate when its output is later cited as though it were a finding. Make the grade impossible to miss — later phases will lean on these.

**5. Give each an abandonment condition.** What makes this person leave, and what they do instead. A persona that cannot abandon cannot detect a problem, which makes it useless for the simulation phase that follows.

**6. State what would falsify each persona** and how you would find out. This is what turns a persona from decoration into a hypothesis.

## Write

One file per persona at `docs/product/personas/<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/persona.md`, plus an index at `docs/product/personas/README.md` listing each with its grounding grade in the table.

## Exit criteria

- Three to five personas, each with a named behavioral divergence from the others
- At least one persona the product currently serves badly
- Every persona and key attribute carries a grounding grade
- Every persona has an abandonment condition and a falsification test
- The research backlog exists: what simulation cannot answer and needs real people

## Hand off

Report the personas with their grades. State plainly how much of this set is `assumed` — if most of it is, say that the phases downstream are generating hypotheses rather than validating a design, because that changes how their output should be read.

Next step: `/delivery:interview` to probe them, or `/delivery:simulate` to walk them through journeys.
