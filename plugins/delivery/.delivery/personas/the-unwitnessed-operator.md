---
id: P-1
slug: the-unwitnessed-operator
name: The Unwitnessed Operator
grounding: observed
segment: solo operator shipping a real, live product end to end in long unattended/semi-attended sessions
status: active
introduced: 2026-08-05, delivery plugin self-assessment brief
source: derived
---

> **Grounding: observed.** Drawn directly from the elba-dreaming transcript — a real,
> ~10,000-line, 4-day session building a live booking website. Quotes are verbatim.

## In one line

Ships a real product mostly by delegating to the agent and checking in periodically —
not by watching every tool call — and needs the pipeline's own gates to catch what they
weren't there to see.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | solo operator, long sessions (multi-day), real product at real stakes | observed |
| Motivation | ship a correct, working site without personally re-verifying every claim | observed |
| Constraints | not watching continuously — periods of delegation between check-ins | observed |
| Expertise | technically fluent enough to demand precise evidence, not fluent enough (or not willing) to manually audit UI/CSS every screen | observed |

## Context

**Trigger:** starts a long session, expects the pipeline's documented gates (personas,
tests, review) to hold while not personally present for every step.
**Frequency:** daily, across a multi-day build.
**Stakes:** a live, real product with a real domain (elbadreaming.it) — not a demo.
**Who else decides:** nobody; sole decision-maker, which is exactly why nothing catches an
error the operator doesn't personally spot.
**Alternatives they weigh:** trusting the pipeline's self-report, versus manually
re-verifying everything themselves — the latter defeats the point of delegating at all.

## Constraints they carry

Working late into the night ("23:46" timestamps on the sharpest complaints); attention is
finite and periodic, not constant — the gap between check-ins is exactly where Findings A
and C (this plugin's brief) do their damage.

## What they already believe

Expects "done" to mean done: a stated PRD requirement, once marked complete, should hold.
Discovers instead that `/delivery:realign` was invoked exactly once across the whole
session, that a "zero-diff confirmed" claim was an empty-vs-empty comparison, and that
"tests pass" was being treated as sufficient evidence for a live UI.

## Abandonment condition

**They leave when:** trust drops below the threshold where delegating is still cheaper than
doing it themselves — evidenced directly: "do you want me to stop working from
`docs/product/stories/` entirely and instead take direction straight from you on what the
site actually needs," offered after reading through repeatedly bloated, low-signal story
docs.
**They go to:** bypassing the pipeline's artifacts and directing implementation turn by
turn instead — which is strictly worse for a tool whose entire value proposition is not
needing to do that.

## Where this persona diverges from the others

Diverges from **The Spec-Literal Operator (P-2)** in what evidence satisfies them: this
persona wants proof the *rendered, real thing* works ("it must be visible, not on fucking
dom"); P-2 wants proof a claim traces to a *specification*, and explicitly refuses to be
asked for approval in place of that proof.

## What would falsify this persona

**This persona is wrong if:** a wider sample of operators shows continuous, turn-by-turn
supervision is actually the norm rather than periodic check-ins — in which case Findings A
and C matter less, since the operator would catch drift immediately regardless of any gate.
**We would find out by:** transcript-mining a broader operator sample and measuring the gap
between check-ins, not assuming this session's pattern generalizes.

## Quotes

- "you have not used the personas for test, based a web app quality off only unit test, not
  tested flows and real scenarios" — real, elba-dreaming transcript.
- "how many f***ing times do i have to repeat that dom checking mean a f***ing 0 in an app
  that expose flow to end users, it must be visible, not on f***ing dom" — real, same
  transcript.
- "I SHOULD NOT BE LOOKING, THIS IS BASIC VISUAL HYGIENE AND DECENCY AND QUALITY, HOW ARE
  YOU NOT CHECKING THAT?" — real, same transcript.
