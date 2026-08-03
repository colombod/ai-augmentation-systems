# Writing standard

Every artifact in this pipeline obeys this. Skills reference it; do not restate it in them.

## The problem this exists to prevent

These documents are written by an agent that has just read a great deal and wants to show
its work. Left alone it produces something exhaustive, accurate and unread. **An artifact
nobody finishes has failed, no matter how correct it is.** A 25-page brief and a 2-page
brief containing the same six decisions are not equally good.

The failure is not length as such. It is **restatement**: the same fact appearing as a
narrative sentence, then a table row, then a summary bullet, then a recap.

## Budgets

Each template states a target and a hard cap in its header. The target is what a good
artifact costs; the cap is where you stop and cut.

Budgets exclude code blocks, YAML and data tables — a table of twelve tokens is twelve
facts, not padding.

If you exceed the cap, **say so in the document and say why** — "cap 800 words, this is
1,400 because the estimator defect needed six worked examples." An explicit overrun is a
judgement call. A silent one is a habit.

## What to cut, in order

Cut in this order until you are within budget. **Never reorder it to protect prose.**

1. **Preamble and recap.** No "in this document we will", no summary of what you just said. The reader can scroll up.
2. **Restatement.** Each fact appears once, in the form that carries it best. If it is in a table, it is not also a sentence.
3. **Narration of process.** "I examined the codebase and found that…" → the finding. How you got there matters only when it affects confidence.
4. **Hedging.** "It may possibly be the case that this could potentially…" Either you know, or you mark it as an assumption with a grade. Both are shorter.
5. **Redundant citations.** One file:line proves a claim. Five prove the same claim.
6. **Illustrative examples beyond the first.** The second example earns its place only when it shows a *different* failure mode.

## What never gets cut

Cutting these to hit a budget defeats the purpose. If the artifact cannot fit without
losing them, overrun and say why.

- **Findings and their concrete failure scenarios**
- **Citations** — one per claim, but never zero
- **Grounding and confidence labels**, and the synthetic-output warnings
- **Open questions and unknowns.** These are the first thing a tired writer drops and the most expensive thing to lose.
- **Anything a downstream phase reads as input** — requirement IDs, persona IDs, token names, acceptance criteria

## Form

- **Tables over prose** for anything with repeating structure. A finding with five attributes is a row.
- **One idea per sentence.** Long sentences hide unexamined joins.
- **Lead with the conclusion.** The reason follows it, if it is needed at all.
- **No adverbial throat-clearing** — "importantly", "notably", "it is worth noting that".
- **Prose is for reasoning**: a tradeoff, a judgement, why a decision went one way. Never for data.

## The test

Before writing the artifact, ask: *what are the decisions or findings here?* Count them.
That count is what the document is for. Everything else is scaffolding, and scaffolding
should be as thin as it can be while still holding the thing up.

After writing, ask of each paragraph: *if I deleted this, what would the reader no longer
know?* If the answer is "nothing", delete it.
