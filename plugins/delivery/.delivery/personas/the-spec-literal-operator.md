---
id: P-2
slug: the-spec-literal-operator
name: The Spec-Literal Operator
grounding: observed
segment: solo operator building against a formal specification, who treats grounding-in-source as the only legitimate form of verification
status: active
introduced: 2026-08-05, delivery plugin self-assessment brief
source: refined:2026-08-10
---

> **Grounding: observed.** Drawn directly from the attractor-orchestration-claude
> transcript — a real, 38-hour session implementing a spec-conformance engine. Quotes are
> verbatim. **Same real individual as P-1 (The Unwitnessed Operator), a different working
> mode — not a second person.** Modeled separately because the plugin must serve both modes
> and they diverge sharply in what counts as evidence; see divergence below.

## In one line

Wants every claim traced to a specification or real execution, and explicitly rejects being
asked to personally bless something the agent could have verified itself.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | solo operator, spec-conformance work, adversarial toward "plausible" reasoning | observed |
| Motivation | correctness traceable to a named source, not to the agent's own confidence | observed |
| Constraints | working unattended for stretches, expects the agent to self-verify rather than wait for sign-off | observed |
| Expertise | reads specifications directly, holds the agent to the same standard | observed |

## Context

**Trigger:** notices a claim ("runs clean", "conforms") that turns out to be reasoned, not
executed or cited.
**Frequency:** repeatedly across a single long session — 15 distinct corrections in the
final four hours.
**Stakes:** a spec-conformance engine whose whole value proposition is that the *engine*,
not the model, decides success — a false "conforms" claim defeats the product's own thesis.
**Who else decides:** explicitly nobody — this persona refuses to be the decision-maker
the agent defers to instead of verifying.
**Alternatives they weigh:** trusting the agent's self-report, versus demanding a citation
or an execution trace — chooses the latter, forcefully.

## Constraints they carry

Wants unattended operation ("do this work and be unattended") but that raises the stakes of
every unverified claim, since nobody is present to catch it in the moment it's made.

## What they already believe

Arrives expecting the agent to ground itself in the specification and its own doctrine
without needing to be walked through it — treats a request for approval as itself a symptom
of the agent not having done that grounding work.

## Abandonment condition

**They leave when:** the gap between claimed and actual conformance repeats often enough
that "unreliable" becomes the working description of the whole effort — evidenced directly:
"how comes you keep making implementation that violates the doctrine? this is wrong and
makes all this work unreliable."
**They go to:** doing the verification personally, turn by turn, which is the exact
opposite of the unattended operation this persona wants.

## Where this persona diverges from the others

Diverges from **The Unwitnessed Operator (P-1)** on what evidence satisfies them: P-1 wants
proof the rendered, real thing works for an end user; this persona wants proof a claim
traces to a specification or a real execution, and treats a request for their personal
sign-off as a red flag, not a courtesy — "why do you need my sign off when you have access
to the doctrine, official specs... i want you to make sure you are not making up stupid
things."

## What would falsify this persona

**This persona is wrong if:** the sign-off rejection is specific to one
easily-source-verifiable question rather than a general stance — a lightweight checkpoint
might still be welcome elsewhere (brief's Open Question 3).
**We would find out by:** asking directly, later, where the line actually is.

## Refinement, 2026-08-10 — attractor-handoff initiative

*Budget note: ~720 words against a 600-word cap. Original content was already near budget; this note adds evidence-grading content the writing standard protects from cutting (grounding distinction, open-finding citation, falsification test), not restatement. Declared rather than silently exceeded.*

**What changed:** a hypothesis, not new evidence. This persona's observed disposition
motivates the `attractor-handoff` brief's deterministic-gate design, but no observed instance
exists of choosing that runner mode — it didn't exist during either source transcript.
**"Would choose attractor over `superpowers`/`generic`" is `assumed`, layered on this file's
otherwise `observed` grounding** — tracked as open finding `R-brief-7`,
`.delivery/reviews/attractor-handoff-01-brief.md`.
**Falsifies if:** given the choice, picks `superpowers`/`generic` anyway (e.g. attractor's
sequential-only, no-human-gate constraints cost more than the gate is worth). Find out by
asking once the artifact exists to choose.

## Quotes

- "do not write plausible things (that is ai slop) implement correctly the specifications." — real, attractor-orchestration transcript.
- "must be driven by specs and HOW IS USED, not coming up with test without a proper QA and USER ACCEPTANCE PLANS" — real, same transcript.
- "ALWAYS TEST REALITY do not make up success from a set of green tests." — real, same transcript.
