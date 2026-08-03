---
description: Research the feature space before specifying anything — how others solve this, what the domain requires, what users complain about today, and what the existing codebase already constrains. Use after the brief and before personas. Produces docs/product/research.md.
---

# Feature research

Topic: **$ARGUMENTS** (defaults to the feature named in the brief)

Phase 2 of the pipeline. Input: `docs/product/brief.md`. Output: `docs/product/research.md`.

## Gate check

Read `docs/product/brief.md`. If it is missing, stop and point at `/delivery:brief` — research without a framed problem produces a literature review nobody uses.

If `docs/product/research.md` exists, read it and ask whether to extend or replace.

## Run

Research from evidence, not from recall. Where web tools are available (`WebSearch`, `WebFetch`, or Perplexity/Tavily MCP tools), use them and cite what you find. Where they are not, say so explicitly and mark the affected sections as **unresearched** rather than filling them from memory — confident, uncited claims about a market are the most dangerous output this phase can produce.

**0. Search convergently, not once.** A single sweep finds what one phrasing surfaces. Run
the prior-art and constraint searches as **at least three parallel passes with different
angles** — by product category, by the user's problem in their own words, and by the
failure people complain about. They must not share context. Merge, and record which
findings appeared in more than one pass.

Where each angle returned material the others missed, say so: the space is not exhausted,
and the document should not imply that it is.

**1. Prior art — how is this problem solved today?**
Find three to five products or projects that solve it, including at least one outside the obvious category. For each: the approach, what it gets right, what users complain about. Public reviews, forum threads and issue trackers are the highest-value source here, because complaints are unmet requirements stated by the people who have them.

**2. Domain constraints.**
What does this problem space impose regardless of implementation? Regulatory requirements, industry conventions, data standards, accessibility obligations, seasonal or geographic realities. Constraints found now are cheap; constraints found during implementation are not.

**3. The technical landscape.**
Available libraries, protocols, standard formats, integration surfaces. For each candidate: maturity, maintenance status, licence, and the reason it might not fit. Do not pick a winner — that is the Solution Architect's decision, made later with more information.

**4. What the codebase already decides.**
Read the existing project — its architecture, its stated non-goals, its conventions. Some options are already foreclosed by decisions made long ago, and knowing which saves the architect a wasted design. Cite real paths.

**5. What you could not find out.**
The gaps matter as much as the findings. List what you looked for and did not find, and what it would take to answer.

## Write

Write to `docs/product/research.md` using `${CLAUDE_PLUGIN_ROOT}/templates/research.md`.

Cite every external claim with a URL. Mark each finding as **verified** (you read the source), **reported** (a secondary source says so), or **assumed** (your inference). Keep those three visually distinct — the later phases will lean on this document, and an unmarked assumption becomes a fact by the time it reaches a story.

## Exit criteria

- At least three prior-art examples with named strengths and complaints
- Domain constraints listed, or explicitly stated as none found
- Technical options with maturity and licence, and no winner declared
- Existing-codebase constraints cited with real paths
- Every external claim carries a source
- Open gaps listed
- At least three search angles run independently, with convergence recorded
- Within the template's budget, or the overrun declared in the document with its reason

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Hand off

Report what you found that would change the brief — prior art solving it better than planned, a constraint that invalidates an assumption, a foreclosed technical option. If the research undermines the premise of the effort, say so plainly; that is the most valuable outcome this phase can have, and the cheapest moment to have it.

Next step: `/delivery:personas`.
