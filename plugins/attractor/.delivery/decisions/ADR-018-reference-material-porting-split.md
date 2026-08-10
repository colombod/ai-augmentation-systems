# ADR-018: Reference material — five files, split by how each was produced

**Status:** accepted
**Date:** 2026-08-10
**Deciders:** Solution Architect

## Context

Root `AGENTS.md`'s own porting table ("What we take from the amplifier bundle")
already commits this project to three different treatments for upstream material:
port near-verbatim (engine-independent doctrine), port then correct (engine-coupled
reference that's mostly right but needs fixing), and write from scratch (anything
claiming to describe this engine's actual runtime behavior). S7's reference material
needs all three, and getting the split wrong in either direction has a named cost:
porting engine-coupled claims verbatim manufactures exactly the wrong beliefs
`.delivery/personas/the-amplifier-veteran.md` (P-4) exists to name — most concretely,
"`TOPO-001`..`005` lint codes... this engine's `TOPO-001`..`006` check entirely
different things under overlapping numbers" (`the-amplifier-veteran.md:52`) and
"Expects a `report_outcome` tool to give any LLM node routing vocabulary. **Wrong**:
this engine restricts structured verdicts to `goal_gate=true` nodes only"
(`the-amplifier-veteran.md:50` — this is FR-15's own requirement, independently).

## Decision

Five files under `skills/attractorify/reference/`:

- **`pipeline-design-principles.md`, `pipeline-patterns.md` — port near-verbatim.**
  Confirmed by direct read (`docs/PIPELINE_DESIGN_PRINCIPLES.md`,
  `docs/PIPELINE_PATTERNS.md`, `microsoft/amplifier-bundle-attractor@main`) to be
  engine-independent design doctrine — the three-question test, control-plane vs
  recipe-plane, tier discipline, SF/MLE/V+R output strategies, the loop-convergence and
  delta-assertion patterns. Two corrections applied uniformly, not per-paragraph: strip
  every `model_stylesheet`/`llm_model`/`class=` reference (PRD non-goal — "architecturally
  out of scope, not merely deferred"), and repoint the `examples/gates/` cross-reference
  (amplifier's own gate-primitive library, not ported this slice) to this project's own
  portable examples (ADR-019).
- **`dot-reference.md`, `routing-reference.md` — port, then correct.** Structure and
  DOT-syntax framing carry over; anything stating what a lint code number *means*, or
  what nodes receive a structured verdict, is corrected against this engine specifically
  rather than carried over. Neither file restates a lint code's meaning at all — both
  link to `README.md`'s own `## Lint rules` section (already accurate, already
  maintained) instead, per the ported skill's own "link, don't restate" discipline —
  this closes the renumbering landmine by removing the duplicate source of truth rather
  than trying to keep two copies in sync. `routing-reference.md` states the verdict
  contract as: a routing verdict is requested for `goal_gate=true` nodes and only those
  nodes, matching `wantsVerdict` (`backend/argv.ts:42-43`) exactly (FR-15).
- **`engine-semantics.md` — written from scratch, from this engine's own tests.** Not a
  port of amplifier's own `context/engine-semantics.md` — same name by convention only,
  per `AGENTS.md`'s explicit instruction that this file specifically "is the expert
  agent's declared source of truth, and a ported one would describe Amplifier's
  engine." Every claim in it must cite a real test or source line in
  `plugins/attractor/engine/`, not amplifier's.

## Alternatives considered

### Port all reference material near-verbatim, correct only where a reviewer later flags a divergence

**Why it was attractive:** faster to ship; matches how a first draft of ported material
often happens.
**Why rejected:** this is the exact failure mode P-4 exists to name, and the cost isn't
hypothetical — the persona's own evidence section lists four specific wrong beliefs
already derived by comparing amplifier's shipped docs against this engine's actual
code, before any of this skill's own material existed. Shipping reference material with
the same errors reintroduces a known-bad state on day one instead of avoiding it.

### One combined file instead of five

**Why it was attractive:** fewer files, simpler for the skill to read.
**Why rejected:** the five files have different provenance and different trust levels
(near-verbatim doctrine vs. corrected-against-code vs. written-from-scratch) —
collapsing them would make it impossible for a future editor to know which parts need
re-verification against amplifier's next revision and which don't, silently
reintroducing the exact ambiguity this split exists to avoid.

## Consequences

**We gain:** a reference set where every engine-specific claim traces to this engine's
own code, and every doctrine claim traces to a confirmed engine-independent source —
no claim's provenance is ambiguous.

**We accept:** more files to keep current than a single monolith; `README.md`'s
`## Lint rules` section becomes a load-bearing dependency for two of the five files (an
existing, already-maintained section, not new maintenance burden, but now with two more
readers relying on it not drifting).

**We will need to revisit this if:** amplifier's upstream `PIPELINE_DESIGN_PRINCIPLES.md`
or `PIPELINE_PATTERNS.md` changes in a way that reopens the model_stylesheet/`examples/gates/`
corrections — the correction is applied to this snapshot (`@main`, 2026-08-10), not
mechanically re-derived from upstream on every read.
