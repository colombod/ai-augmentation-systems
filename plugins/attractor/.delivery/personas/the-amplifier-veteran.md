---
id: P-4
slug: the-amplifier-veteran
name: The Amplifier Veteran
grounding: assumed
segment: arrives with a working mental model from a comparable product that doesn't transfer cleanly
status: active
introduced: 2026-08-05, this feature
source: derived
---

> **Grounding: assumed.** Not stated by the owner directly — constructed by reasoning
> from a verified technical fact: `microsoft/amplifier-bundle-attractor` implements the
> same specification with materially different engine semantics (documented in full in
> `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/research.md`'s Prior Art section, itself verified by direct source
> reading and execution, not inference). Anyone who has used or read about that project
> and then tries this one is a predictable, evidence-grounded failure mode, even though
> no such person has been observed yet. This is deliberately the skeptic/wrong-priors
> persona the methodology requires — someone who arrives already convinced they know how
> the product works, and is wrong in specific, citable ways.

## In one line

Has read amplifier's documentation or used its engine, brings that mental model here, and
gets tripped up by specific, real divergences rather than by not knowing DOT at all.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | prior exposure to a comparable but non-identical implementation | assumed, but the divergence points are verified |
| Motivation | wants the same authoring/routing power amplifier documents, on this engine | assumed |
| Constraints | brings specific wrong assumptions, not general unfamiliarity | assumed, itemized below |
| Expertise | higher DOT fluency than P-1, specifically the *wrong* engine's dialect | assumed |

## Context

**Trigger:** finds this project's documentation (once the amplifier-derived authoring guides are ported) or the amplifier project itself, and expects behavioral parity — assumed.
**Frequency:** assumed low today (amplifier itself has no external users per the evidence hunt), rising if the ported documentation doesn't clearly flag the divergences.
**Stakes:** assumed moderate — the failure mode is confusion and wasted authoring time, not a silent false success, since the engine's own lint/runtime guards still catch most of what this persona gets wrong.
**Who else decides:** assumed none additional beyond P-1/P-3's decision-makers.
**Alternatives they weigh:** assumes this engine is a strict clone and debugs against the wrong mental model for longer than necessary before checking; or gives up and goes back to amplifier's Python stack, if that's available to them.

## Constraints they carry

Assumed: time lost specifically to *unlearning*, not to learning from zero — arguably a worse experience than P-1's, since confident wrong beliefs are harder to self-correct than acknowledged ignorance.

## What they already believe — and where each belief is wrong, verified

- Expects a `report_outcome` tool to give any LLM node routing vocabulary. **Wrong**: this engine restricts structured verdicts to `goal_gate=true` nodes only (`research.md`, verified against `backend/argv.ts`/`backend/result.ts`).
- Expects `outputs=` to be a subgraph/folder-only attribute. **Wrong**: here it's a general per-node dataflow contract with no subgraph analogue (verified, same source).
- Expects `TOPO-001`..`005` lint codes to mean what amplifier's docs say. **Wrong**: this engine's `TOPO-001`..`006` check entirely different things under overlapping numbers — a genuine landmine if amplifier-derived lint documentation is ever ported without renumbering (flagged explicitly in the port-plan research as a dependency-order prerequisite).
- Expects `type="stack.steer"` to be a soft warning. **Wrong**: it's a hard `TYPE-001` lint ERROR here.

## Abandonment condition

**They leave when:** the ported authoring documentation doesn't clearly flag these divergences, and they spend real time debugging a "bug" that is actually a documented difference in engine semantics.
**They go to:** either back to amplifier's stack (if available to them) or a support/complaint channel that, per the evidence hunt, does not yet exist for this project.

## Where this persona diverges from the others

The only persona whose problem is **wrong confidence**, not lack of knowledge (P-1) or lack of mechanism (P-2, P-3). Correctly serving this persona is almost entirely a documentation-accuracy problem, not an engineering one — directly actionable by how the ported authoring layer is written, independent of any new engine feature.

## What would falsify this persona

**This persona is wrong if:** nobody who touches this project has ever used amplifier, making the whole divergence class moot in practice.
**We would find out by:** whoever installs and uses this plugin first — trivially checkable once real users exist, unlike P-1 through P-3, which need real usage data to grade at all.

## Quotes

None — this persona has no direct owner statement behind it, unlike P-1 through P-3. Constructed entirely from the verified engine-divergence findings in `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/research.md`.
