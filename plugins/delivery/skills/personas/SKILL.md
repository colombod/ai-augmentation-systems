---
description: Derive customer and end-user personas grounded in whatever evidence exists, graded by how much evidence there actually is. Use after research and before writing scenarios, so the product is specified against real user segments rather than an imagined average user. Produces docs/product/personas/.
---

# End-user personas

Focus or segment hint: **$ARGUMENTS**

Phase 3 of the pipeline. Inputs: `docs/product/brief.md`, `docs/product/research.md`. Output: `docs/product/personas/`.

These are **customer personas** — the people who use the product. They are a different thing from the plugin's internal role agents (Product Owner, Architect, and so on), which represent the team.

## Where personas live, and why

`docs/product/personas/` **in the project being built**, versioned in git next to the code.
They are project documentation, not a global asset — a persona is modelled on a specific
product, its constraints and its market, and none of that travels. A persona set kept
outside the repo drifts away from the product it describes and quietly becomes fiction.

Keeping them in-repo is also what makes them **instrumentation**: they carry stable IDs
(`P-1`, `P-2`) that the PRD, prioritisation stages, stories and sprint reviews reference,
so "which personas can complete this journey" is a question the pipeline can actually
answer rather than a matter of opinion.

## Gate check

Read the brief, and the research if it exists.

- **Brief missing** — stop, run `/delivery:brief` first.
- **Research missing** — warn. Personas built without research are `assumed`-grade at best, which sharply limits what they can be used for later. Offer to run `/delivery:research` first; proceed if the user chooses to.

**If personas already exist in this project, the default is to reuse and refine them, not
to regenerate.** A product has one persona set; each new feature is evaluated against it.
Regenerating from scratch per feature produces a set that quietly re-segments the same
market a different way each time, and then nothing downstream can be compared across
features. Read the existing set and report it, then:

- **Refine** — update attributes the new brief or research changes. Record what changed and why; a persona's history is what shows whether the team's model of its users is converging or thrashing.
- **Add** — a genuinely new segment this feature reaches. Justify it against the existing set by naming the behavioural divergence, exactly as for a new set.
- **Retire** — a segment the product no longer serves. Mark it retired in place rather than deleting; the reasoning stays useful.
- **Replace** — only on a real product pivot. Say plainly that comparability with prior features is being discarded.

Never silently overwrite an existing persona. Ask before replacing.

### Seeding from another project

You may be pointed at an existing persona set from a different product to start from — a
sibling product, a previous engagement, a template set. That is a legitimate shortcut, with
one hard rule:

**Grounding does not transfer.** A persona graded `observed` from another product's
analytics is `assumed` here until re-grounded against *this* product's evidence. The
evidence supported a claim about that product's users, not this one's. Downgrade every
imported grade on arrival, record where it came from, and re-ground what you can.

Importing a persona set and keeping its grades is the single easiest way to manufacture
false confidence with this pipeline. Do not do it.

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

One file per persona at `docs/product/personas/<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/persona.md`, plus an index at `docs/product/personas/README.md` listing each with its ID and grounding grade.

**The frontmatter fields are mandatory and machine-readable** — `id`, `grounding`, `status`,
`source`. `/delivery:status` reports the grounding mix from them and `/delivery:prioritize`
checks per-stage persona coverage by them. Writing the grade only in the body, however
prominently, breaks both silently. Do both: frontmatter for the tools, prose for the reader.

IDs are stable and never reused. A retired `P-2` stays `P-2`.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every persona has complete frontmatter: `id`, `grounding`, `status`, `source`
- Three to five active personas, each with a named behavioral divergence from the others
- Existing personas were reused or refined rather than regenerated, unless a replace was explicitly agreed
- Any seeded persona has been downgraded and its origin recorded
- At least one persona the product currently serves badly
- Every persona and key attribute carries a grounding grade
- Every persona has an abandonment condition and a falsification test
- The research backlog exists: what simulation cannot answer and needs real people

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Hand off

Report the personas with their grades. State plainly how much of this set is `assumed` — if most of it is, say that the phases downstream are generating hypotheses rather than validating a design, because that changes how their output should be read.

Next step: `/delivery:interview` to probe them, or `/delivery:simulate` to walk them through journeys.
