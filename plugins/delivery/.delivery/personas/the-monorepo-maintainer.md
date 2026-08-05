---
id: P-3
slug: the-monorepo-maintainer
name: The Monorepo Maintainer
grounding: reported
segment: operator running this plugin across a multi-plugin marketplace or monorepo, where artifacts must be scoped per component
status: active
introduced: 2026-08-05, delivery plugin self-assessment brief
source: derived
---

> **Grounding: reported.** Not directly observed as a second person — this is the same
> real operator (P-1/P-2) directly stating an anticipated need in their own words, in the
> attractor-orchestration-claude transcript, which is stronger than a pure inference but
> still second-hand relative to a live multi-component-repo session. Downgrade further if
> cited outside this document.

## In one line

Needs this plugin's artifacts to land next to the component they're actually about, not in
one undifferentiated folder at the root of a repo holding several unrelated things.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | operator working in a plugin marketplace / monorepo with multiple independently-releasable components | reported |
| Motivation | avoid one component's product docs colliding with another's, or being mistaken for repo-wide documentation | reported |
| Constraints | the repo's own conventions (a plugin owns everything under its own directory) must hold for tooling output too | reported |
| Expertise | already had to hand-migrate root `docs/product/` into a scoped location once, same day it was created | observed (the migration itself, in the attractor-orchestration-claude repo, is directly observed — the *need* is reported) |

## Context

**Trigger:** the plugin defaults to writing product artifacts at the repository root in a
repo that holds more than one component.
**Frequency:** every time the pipeline is run in such a repo, until fixed.
**Stakes:** artifacts become ownerless and ambiguous — "root-level `docs/superpowers/` and
`docs/product/` held content that was 100% about one [component]... neither path named
which [component] it belonged to, which does not scale past a single [component]."
**Who else decides:** whoever else works in the same shared repo — a root-level folder with
no owner is a collision waiting to happen in a repo more than one session touches.
**Alternatives they weigh:** manually moving files after the fact (what actually happened),
versus the tool getting it right by default.

## Constraints they carry

Works in a repo explicitly structured as a marketplace (`plugins/<name>/`), where the
repo's own stated rule is that a component owns everything under its own directory and
nothing outside it.

## What they already believe

Expects tooling to respect a repo's own structural conventions rather than imposing a
single-product assumption — discovers instead (before this session's path-scoping fix) that
the plugin always wrote to root `docs/product/`, undifferentiated.

## Abandonment condition

**They leave when:** the mismatch forces a manual migration once too often, or artifacts
from two components silently collide.
**They go to:** hand-authoring the scoped structure directly, bypassing the plugin's own
default.

## Where this persona diverges from the others

Diverges from **P-1** and **P-2** entirely on the axis of concern: not verification depth
or evidence quality, but where output lives and whether it's attributable to the right
component. This persona is largely **served now** by this session's path-scoping fix
(`.delivery/`, resolved per-component) — included to keep that fix's justification alive in
the record, not because they are currently underserved.

## What would falsify this persona

**This persona is wrong if:** nobody besides this same operator, in this same repo family,
ever actually hits the multi-component case — i.e., if this plugin is mostly used in
single-product repos, this persona's severity is much lower than it's framed here.
**We would find out by:** usage data across a wider install base, which does not exist yet
for this plugin.

## Quotes

- "the root docs folder seesm pretty bad to me, this entrir work got to do wit hteh
  attracto plugin... i thin kaht using a .superpower and .delivery folders is better...
  how is the current shape... going to work with a multy plugin store" — real,
  attractor-orchestration-claude transcript (lightly reproduced with original typing
  preserved, verbatim).
