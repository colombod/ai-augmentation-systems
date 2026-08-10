---
id: p6-03
title: Reference material — pipeline-design-principles.md, pipeline-patterns.md (ported near-verbatim)
status: done
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: []
depends_on: []
size: S
---

# Reference material — pipeline-design-principles.md, pipeline-patterns.md

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. Supports FR-13/16 by grounding the skill's design guidance;
carries no FR of its own (root `AGENTS.md` already committed to porting this doctrine
near-verbatim; this story executes that commitment for S7's two remaining files). See
[ADR-018](../decisions/ADR-018-reference-material-porting-split.md).

## Goal

Port `microsoft/amplifier-bundle-attractor@main`'s `docs/PIPELINE_DESIGN_PRINCIPLES.md`
and `docs/PIPELINE_PATTERNS.md` near-verbatim — confirmed engine-independent design
doctrine (the three-question test, control-plane vs recipe-plane, tier discipline,
validation-node patterns, loop-convergence patterns, LLM-output-protocol strategies
SF/MLE/V+R, parameterization, delta-assertion gates) — with exactly two corrections
applied uniformly across both files, per ADR-018.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/skills/attractorify/reference/pipeline-design-principles.md` | new — ported from `docs/PIPELINE_DESIGN_PRINCIPLES.md` |
| `plugins/attractor/skills/attractorify/reference/pipeline-patterns.md` | new — ported from `docs/PIPELINE_PATTERNS.md` |

## Content requirements

Start from amplifier's actual source at `main` (fetch fresh — do not trust a stale
local copy if one exists from earlier research). Apply exactly these two corrections,
nothing else rewritten:

1. **Strip every `model_stylesheet`/`llm_model`/`class=` reference.** PRD non-goal —
   "Multi-provider model routing (`model_stylesheet`) — architecturally out of scope,
   not merely deferred." Where a code example uses `class="maker"` purely as a
   `model_stylesheet` selector with no other purpose, remove the attribute; where prose
   discusses model routing as a parameterization option (§5 of
   `PIPELINE_DESIGN_PRINCIPLES.md`), remove that bullet, not the surrounding section.
2. **Repoint the `examples/gates/` cross-reference.** Amplifier's own gate-primitive
   library (`PIPELINE_DESIGN_PRINCIPLES.md`'s "Gate library" subsection) is not ported
   this slice — repoint to this project's own portable examples (p6-07) or, if none of
   them demonstrate the referenced pattern yet, remove the cross-reference rather than
   link to something that doesn't exist.

Every other cross-reference inside these two files (to `DOT-AUTHORING-GUIDE.md`,
`ROUTING-REFERENCE.md`, `examples/pipelines/NN-*.dot`) gets repointed to this project's
own equivalent file or example if one exists (p6-02's `routing-reference.md`; p6-07's
ported examples using the same number, e.g. `04-retry-with-fallback.dot`), or removed
if the cited amplifier file/example was excluded per
[ADR-019](../decisions/ADR-019-example-portability-policy.md) (e.g. any reference to
`task-runner.dot` needs a decision: keep the prose point, repoint the citation to
`00-convergence-loop.dot` if it illustrates the same principle, or drop the citation).

## Relevant design decisions

- **[ADR-018](../decisions/ADR-018-reference-material-porting-split.md)** — why these
  two files port near-verbatim while `dot-reference.md`/`routing-reference.md` (p6-02)
  need correction against engine behavior, and the exact two corrections to apply.
- **[ADR-019](../decisions/ADR-019-example-portability-policy.md)** — which example
  filenames are safe to keep referencing and which need repointing or removal.

## Acceptance criteria

- [x] Both files exist and their section structure matches amplifier's source
      (same headings, same order) — confirms "near-verbatim," not a rewrite.
- [x] Neither file contains `model_stylesheet`, `llm_model`, or a `class=` DOT attribute
      anywhere (`grep -c` both terms across both files returns 0).
- [x] Neither file links to `examples/gates/` or any other amplifier path that was not
      ported into this project (spot-check every relative link in both files resolves to
      a real path in this repo, or was deliberately removed).
- [x] Every `examples/pipelines/NN-*.dot` or `examples/patterns/*.dot` citation in both
      files resolves to a file this project actually ships (post-p6-07) — cross-check
      against [ADR-019](../decisions/ADR-019-example-portability-policy.md)'s table; a
      citation to an excluded example is a bug, not a stylistic nit.
- [x] The doc-consistency script from p6-02 (extend it, don't duplicate it) also checks
      these two files for stray `model_stylesheet`/`class=` references.

## Implementation notes

Extended `check-consistency.mjs` with a relative-markdown-link resolver. Links into
`../examples/` are reported as a NOTE, not a failure, since p6-02/p6-03 (reference
material) are sequenced before p6-07 (worked examples) by design — the script confirmed
exactly two forward references (`04-retry-with-fallback.dot` from both new files,
`03-conditional-routing.dot` from `pipeline-patterns.md`), both present in
[ADR-019](../decisions/ADR-019-example-portability-policy.md)'s portable-examples table,
so no citation needed correcting. All other relative links (to `dot-reference.md`,
`routing-reference.md`, `engine-semantics.md`) resolve today.

`task-runner.dot` (excluded per ADR-019 — uses `hexagon`/`model_stylesheet`) was cited
five times in the amplifier source across both files: repointed to
`../examples/00-convergence-loop.dot` where it illustrated the general control-plane
skeleton point, or replaced with a generic description where the citation depended on
`task-runner.dot`'s own specific node names (`pm_gate`, orient/attempt/verify/critique/
triage/postmortem/package) that have no equivalent in this project's smaller example set
— never left as a claim this project's own examples demonstrate something they don't.

§6 (AP-2)'s `goal_gate` note is the one section that needed more than a citation swap:
amplifier's original describes `goal_gate` as one routing option among several available
to every node via `report_outcome`; this engine's `goal_gate=true` is the *only* path any
node's LLM response becomes a routing signal at all (see `routing-reference.md`, FR-15).
Rewrote the note's framing accordingly rather than just correcting individual sentences,
since the original's overall shape ("one option among several") was itself the wrong
model for this engine, not merely one wrong fact inside a correct model.

## Test approach

**Level:** doc-consistency, extending p6-02's script rather than writing a second one.
Add: (1) zero `model_stylesheet`/`llm_model` hits across both new files, (2) every
relative markdown link in both files resolves to an existing path in this repo.

**Run with:** `node plugins/attractor/skills/attractorify/reference/check-consistency.mjs`
from the repo root (same invocation as p6-02, extended coverage).

## Out of scope

- `dot-reference.md`, `routing-reference.md`, `engine-semantics.md` — p6-02.
- Fixing a citation that depends on an example not yet written (p6-07) — repoint to a
  confirmed-portable filename per ADR-019's table even before that file exists; p6-07
  is responsible for making the filename real, not this story.

## Dependencies

None functionally, but sequence after p6-02 in practice so the doc-consistency script
(p6-02's) already exists to extend rather than being written twice.
