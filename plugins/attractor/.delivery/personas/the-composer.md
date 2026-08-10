---
id: P-3
slug: the-composer
name: The Composer
grounding: reported
segment: wants to share, reuse, and combine existing pipelines into larger, compound-value workflows
status: active
introduced: 2026-08-05, this feature
source: derived
---

> **Grounding: reported.** Directly from the owner's stated intent: "those users want to
> be able to share reuse and compose established and useful pipelines generating proper
> compound value making flows deterministic and use the generative power of ai where
> needed." This is the least-supported persona of the four by the current product —
> almost every specific mechanism it needs is confirmed absent, not merely difficult.
> No observed evidence exists; see `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/research.md`'s Gaps.

## In one line

Has one or more working pipelines and wants to combine them, or share one with someone
else, to build something bigger than any single pipeline — without re-deriving the whole
thing by hand each time, and while keeping the deterministic parts deterministic and the
generative parts generative rather than blurring the two.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | composes/reuses rather than authors from zero | reported (owner, verbatim) |
| Motivation | "proper compound value" — deliberate framing that composition is worth more than the sum of the pipelines composed | reported (owner, verbatim) |
| Constraints | wants determinism where the process demands it, generative AI only where it earns its place | reported (owner, verbatim) — this is exactly the tier discipline amplifier's own `PIPELINE_DESIGN_PRINCIPLES.md` independently documents (verified read) |
| Expertise | assumed more sophisticated than P-1 — already has working pipelines, is thinking about how they fit together | assumed |

## Context

**Trigger:** has two or more pipelines (own, or shared by someone else) that each do part of a larger job, and wants them to work together — assumed.
**Frequency:** assumed lower than P-2 but higher-value per instance — this is where the "compound value" the owner named actually accrues.
**Stakes:** assumed high — a composed pipeline inherits every correctness property (or failure mode) of its parts, so this persona is exposed to compounding risk, not just compounding value.
**Who else decides:** assumed a team, more often than P-1 or P-2 — sharing implies someone else will run or extend what this persona built.
**Alternatives they weigh:** copy-pasting and hand-editing a `.dot` file per new composition — the only mechanism that exists today — or abandoning composition and running pipelines separately, losing the compound value entirely. Assumed.

## Constraints they carry

Assumed: needs a stable way to reference another pipeline's behavior without inlining its full text every time; needs to trust that a shared pipeline still means what its author intended when reused in a new context.

## What they already believe

Assumed, informed directly by verified technical findings: might reasonably expect a DOT subgraph to function as a reusable unit (the specification's own §2.10 syntax invites this reading), or might expect §4.12's stated extensibility mechanism (a custom handler registry) to be the path to packaging a reusable capability. Both expectations are wrong for this engine today, confirmed directly: subgraphs are a pure defaults-scoping construct with no instantiation or macro facility (`spec-conformance.md`, feature-critic finding on subgraphs), and no handler-registration API exists at all (`spec-conformance.md`, §4.12 finding).

## Abandonment condition

**They leave when:** composing two pipelines turns out to mean manually merging DOT text by hand, node ID collisions and all, with no tooling support — the current, confirmed reality (no transform pipeline, no graph-merge mechanism, no subgraph-as-macro).
**They go to:** building one large, unmaintainable monolithic pipeline instead of several composed ones, defeating the "share and reuse" half of what they wanted, or abandoning attractor for the composition layer specifically while still using it for single pipelines.

## Where this persona diverges from the others

The only persona whose primary need — reuse and composition — has **no implemented mechanism at all**, as opposed to P-1 (authoring layer: absent but architecturally straightforward to add) and P-2 (installability: absent but a known, scoped packaging task). This is the persona the product currently serves worst: not "missing a feature," but missing the category of feature.

## What would falsify this persona

**This persona is wrong if:** real users never attempt composition — every real pipeline stays a single, self-contained unit, and "compound value" turns out to mean something else the owner intended (e.g., composing pipeline *outputs* downstream in a separate system, not composing pipeline *definitions*).
**We would find out by:** the first real attempt to combine two pipelines, and what the person actually tried before giving up or working around it.

## Quotes

"Those users want to be able to share reuse and compose established and useful pipelines generating proper compound value" — project owner, this session, `illustrative paraphrase of a direct instruction, not a transcribed quote`.
