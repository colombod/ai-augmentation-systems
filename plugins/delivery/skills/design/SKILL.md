---
description: Turn a design seed — a brand, a feeling, a reference, a colour — into a concrete design system with tokens, component specs, states and accessibility rules that implementation can build against. Use after personas and before architecture. Produces .delivery/design-system.md.
---

# Design system

Design seed from the originator: **$ARGUMENTS**

Phase 7 of the pipeline. Inputs: `.delivery/brief.md`, `.delivery/personas/`, plus any existing tokens in the codebase. Output: `.delivery/design-system.md`.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Gate check

Read the brief and the personas.

- **Brief missing** — stop, run `/delivery:brief`.
- **Personas missing** — warn. Look and feel is a claim about who the product is for; without personas you are designing for an imagined average user and no choice can be justified. Offer to run `/delivery:personas` first.
- **Existing design system in the codebase** — find it before proposing anything. Look for token files, theme configuration, a component library, established conventions. Read them and cite real paths. Extending an existing system beats introducing a second, parallel one, even when the existing one is imperfect.

If `$ARGUMENTS` is empty and no seed is on record, ask the originator for one before proceeding: what should this feel like, who should feel welcomed by it, is there a reference they admire, and are there fixed brand constraints such as a logo, a colour or a typeface. A design system invented with no seed will be arbitrary, and arbitrary decisions are the hardest to defend later.


**Open blocking findings.** Read `.delivery/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Run

**1. Extract rules from the seed.** Delegate to `delivery:design-lead` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/design-lead.md` and adopt the persona). A seed is a direction, not a design — the job is to make the rules it implies explicit.

Be scrupulous about the boundary between **seeded** and **inferred**. If the originator gave one accent colour, the rest of the palette is your extrapolation and must be labelled as such, with what it was optimised for. They may care deeply about something you treated as free, and they can only tell you if they can see which is which.

**2. Tie identity to personas.** Every significant choice names the persona it serves and what it signals to them. Where a choice serves one persona and alienates another, surface it as a decision rather than resolving it silently.

**3. Define the tokens.** Colour, type scale, spacing scale, radii, elevation, motion. Named with stated intent, not raw values. Map onto the project's real token file names where one exists. Cover the cases implementers will actually hit — a missing token is the reason hardcoded values appear.

**4. Specify component states.** Default, hover, focus, active, disabled, loading, **error and empty**. The last two are where design most often supplies nothing and users most need direction.

**5. Compute accessibility, do not assert it.** State actual contrast ratios for every text/background pairing, specify focus indicators, touch target sizes, reduced-motion behavior, and the text-scaling policy. If a seeded brand colour fails contrast, say so plainly and give the accessible variant — this is exactly the finding the originator needs early, since it is nearly impossible to retrofit.

**6. Say what is deliberately unstyled**, so nobody fills the gap with an invention.

**7. Challenge it.** Run `/delivery:challenge .delivery/design-system.md`, which puts `design-lead`, `user-researcher`, `qa-strategist` and `feature-critic` on it, plus the skeptic persona. Fold blocking findings in.

## Write

Write to `.delivery/design-system.md` using `${CLAUDE_PLUGIN_ROOT}/templates/design-system.md`.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Seeded versus inferred is marked on every significant decision
- Tokens are named with intent and mapped to real project token names where they exist
- Every component spec covers error and empty states
- Contrast ratios are computed and stated, not asserted
- Each identity decision names the persona it serves
- Existing codebase design conventions are cited and either extended or explicitly superseded

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

**Budget: 600 words target, 1000 hard cap** (excludes code, YAML and data tables).

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

**If the count exceeds 1000, you are not finished.** Make a revision pass over the file and
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

Report the system, and lead with anything the seed forced that you would push back on — a brand colour failing contrast, an identity that conflicts with a persona the product needs. Those are the originator's decisions to make, and now is when they are cheap.

Stories will reference these tokens by name, so implementation builds against the system rather than approximating it. Next step: `/delivery:architecture`.
