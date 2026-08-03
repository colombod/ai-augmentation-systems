---
description: Turn a design seed — a brand, a feeling, a reference, a colour — into a concrete design system with tokens, component specs, states and accessibility rules that implementation can build against. Use after personas and before architecture. Produces docs/product/design-system.md.
---

# Design system

Design seed from the originator: **$ARGUMENTS**

Phase 7 of the pipeline. Inputs: `docs/product/brief.md`, `docs/product/personas/`, plus any existing tokens in the codebase. Output: `docs/product/design-system.md`.

## Gate check

Read the brief and the personas.

- **Brief missing** — stop, run `/delivery:brief`.
- **Personas missing** — warn. Look and feel is a claim about who the product is for; without personas you are designing for an imagined average user and no choice can be justified. Offer to run `/delivery:personas` first.
- **Existing design system in the codebase** — find it before proposing anything. Look for token files, theme configuration, a component library, established conventions. Read them and cite real paths. Extending an existing system beats introducing a second, parallel one, even when the existing one is imperfect.

If `$ARGUMENTS` is empty and no seed is on record, ask the originator for one before proceeding: what should this feel like, who should feel welcomed by it, is there a reference they admire, and are there fixed brand constraints such as a logo, a colour or a typeface. A design system invented with no seed will be arbitrary, and arbitrary decisions are the hardest to defend later.

## Run

**1. Extract rules from the seed.** Delegate to `delivery:design-lead` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/design-lead.md` and adopt the persona). A seed is a direction, not a design — the job is to make the rules it implies explicit.

Be scrupulous about the boundary between **seeded** and **inferred**. If the originator gave one accent colour, the rest of the palette is your extrapolation and must be labelled as such, with what it was optimised for. They may care deeply about something you treated as free, and they can only tell you if they can see which is which.

**2. Tie identity to personas.** Every significant choice names the persona it serves and what it signals to them. Where a choice serves one persona and alienates another, surface it as a decision rather than resolving it silently.

**3. Define the tokens.** Colour, type scale, spacing scale, radii, elevation, motion. Named with stated intent, not raw values. Map onto the project's real token file names where one exists. Cover the cases implementers will actually hit — a missing token is the reason hardcoded values appear.

**4. Specify component states.** Default, hover, focus, active, disabled, loading, **error and empty**. The last two are where design most often supplies nothing and users most need direction.

**5. Compute accessibility, do not assert it.** State actual contrast ratios for every text/background pairing, specify focus indicators, touch target sizes, reduced-motion behavior, and the text-scaling policy. If a seeded brand colour fails contrast, say so plainly and give the accessible variant — this is exactly the finding the originator needs early, since it is nearly impossible to retrofit.

**6. Say what is deliberately unstyled**, so nobody fills the gap with an invention.

**7. Challenge it.** Run `/delivery:challenge docs/product/design-system.md`, which puts `design-lead`, `user-researcher`, `qa-strategist` and `feature-critic` on it, plus the skeptic persona. Fold blocking findings in.

## Write

Write to `docs/product/design-system.md` using `${CLAUDE_PLUGIN_ROOT}/templates/design-system.md`.

## Exit criteria

- Seeded versus inferred is marked on every significant decision
- Tokens are named with intent and mapped to real project token names where they exist
- Every component spec covers error and empty states
- Contrast ratios are computed and stated, not asserted
- Each identity decision names the persona it serves
- Existing codebase design conventions are cited and either extended or explicitly superseded

## Hand off

Report the system, and lead with anything the seed forced that you would push back on — a brand colour failing contrast, an identity that conflicts with a persona the product needs. Those are the originator's decisions to make, and now is when they are cheap.

Stories will reference these tokens by name, so implementation builds against the system rather than approximating it. Next step: `/delivery:architecture`.
