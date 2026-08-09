<!--
BUDGET — target 400 words, hard cap 600 words. Excludes code, YAML and data tables.
Context, decision, alternatives, consequences — nothing else.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# ADR-008: Environment/repo/build setup is a gating prerequisite, never an `FR-n` or a roadmap phase

**Status:** proposed — spec complete, pending the template/skill edits below being made and
business-analyst curation of the glossary term proposed at the end.
**Date:** 2026-08-09
**Deciders:** Solution Architect
**Word count:** ~1140 prose-only (`grep -v '^|' | wc -w`, code fences stripped), over the
600-word cap — declared, not silent, in the same range as `ADR-005`'s own comparable overrun
(~1115). This spec touches three files (one template, two skills), and the exact heading,
table skeleton and bullet wording quoted below are the actual deliverable an implementer acts
on without re-deciding — cutting them would just move the re-deciding onto whoever edits the
files next. Alternatives and the live-evidence citation are the template's own protected
categories.

## Context

Issue #18 (split from #8, where the doctrine was first stated as a side effect of designing
an attractor-runner "bootstrap subgraph … structurally separate from story nodes — never
FR-traced, never counted toward a persona-journey/stage claim") asks for a plugin-wide rule:
setup work never scores as a functional requirement or a roadmap phase.

This is not a new principle invented here — it is the existing MVP-staging rule
(`skills/prioritize/SKILL.md:70`: *"A stage is not a batch of features. A stage is a set of
features that lets at least one persona complete a journey end to end and get value."*)
applied one phase earlier, at architecture time, and one phase later, at story-writing time.
Today that rule only fires at `/delivery:prioritize`; nothing stops setup work from entering
the pipeline before it (as an `FR-n`) or after it (as a story), because `templates/prd.md`,
`templates/architecture.md`, `templates/roadmap.md` and `skills/stories/SKILL.md` say nothing
about it.

**Searched this repo's own `initiatives/*/{prd,architecture,roadmap}.md` for a live instance
of setup miscategorized as an FR or stage — found none.** No `npm init`, framework-bootstrap
or build-tooling FR/phase exists in `harden`, `chief-of-staff` or `document-lifecycle-
versioning`. The closest real data point is `harden/roadmap.md:54` Phase 0 ("prepare the
rubric's citation slot" — add a citation column to `templates/design-system.md"), which cites
no `FR-n` at all yet was accepted as a phase — proof the phase template's "Delivers: `FR-n`"
field does not, by itself, stop an `FR`-less phase from being written. That phase is
legitimate (real, demonstrable, product-facing schema work), not setup — but it shows the gap
this doctrine needs to close is real, not hypothetical, even though no actual setup-as-FR
instance has occurred yet.

## Decision

**1. `templates/architecture.md` gains `## Setup — prerequisite, not a feature or a phase`**,
inserted between `## Codebase context` (what exists today) and `## Component structure` (the
target design) — the section is the delta between those two: what must be established before
the target design is buildable at all.

```
## Setup — prerequisite, not a feature or a phase

Environment, repository, framework and build-system work this design needs before Phase 1
can start. Never assigned an `FR-n`, never its own roadmap phase — no persona completes a
journey through "npm init ran." Gates Phase 1's entry criteria in roadmap.md.

| Setup item | Establishes | Blocks (component / spike) |
| :-- | :-- | :-- |

**None needed because:** (if so — state why, don't omit the section)
```

**Discriminator, so this doesn't collide with the existing Spikes section:** a Setup item is
known, mechanical work ("run the framework's init command"); if there is real technical
uncertainty about it ("will this framework integrate cleanly"), it is a Spike, not Setup.

**2. `skills/stories/SKILL.md`'s Gate check gains one bullet**, alongside the existing
"Roadmap missing"/"Architecture missing" bullets:

> - **Setup, not a feature** — if the item is pure environment/repo/framework/build-system
>   setup (no persona completes a journey through it), refuse to write it as a story; point
>   back to `architecture.md`'s Setup section, where it belongs as a Phase-1-gating
>   prerequisite, not a phase deliverable.

**3. `skills/roadmap/SKILL.md` also gets a line — gating at architecture.md alone is not
sufficient.** Roadmap phases are Program-Manager-authored from the PRD's `FR` list, not
mechanically derived from architecture's Setup section — nothing today tells the Program
Manager to consume that section as Phase 1 entry criteria rather than reach for the
instinct `harden` Phase 0 already shows exists (turn a real, unstaged piece of work into its
own phase). Add, in `## Run`, step 1, as a caveat on the "Phases with entry and exit
criteria" bullet:

> Setup never becomes its own phase. Fold `architecture.md`'s Setup section into Phase 1's
> entry criteria — a phase needs a persona-facing demonstrable exit and an `FR-n` it
> delivers; setup work has neither.

`templates/roadmap.md` itself needs no field change: "Entry criteria" is already freeform and
can cite the Setup section directly.

## Alternatives considered

### A — Gate only at `architecture.md`; leave `roadmap.md` untouched

**Attractive:** one file changed, not three; architecture is upstream of roadmap, so fixing
the source should be enough.
**Rejected:** the Program Manager doesn't automatically re-read architecture's Setup section
when building phases — nothing routes it there — and `harden` Phase 0 is live proof the
"invent a phase for real, unstaged work" instinct already exists in this repo. Silent
upstream gating without a downstream instruction is exactly the gap that let Phase 0 through
uncontested.

### B — Give Setup its own governed artifact / template, separate from `architecture.md`

**Attractive:** clean separation; setup work never touches the design document at all.
**Rejected:** over-scoped for what this is — a short prerequisite list, not a phased plan of
its own. It would also duplicate `architecture.md`'s existing "Codebase context → target
design" narrative arc for no second use case.

### C — A blanket rule: "any roadmap phase citing no `FR-n` is disallowed"

**Attractive:** simple, mechanically checkable.
**Rejected:** contradicts real precedent — `harden` Phase 0 has no `FR-n` and is legitimate,
demonstrable, product-facing work. The rule must name the specific category (environment/
repo/framework/build-system setup), not "FR-less," or it invalidates work this repo already
accepted correctly.

## Consequences

**We gain:** the same journey-completion test `prioritize/SKILL.md` already applies at MVP
staging now also runs at architecture (before an `FR` is minted) and at story-writing (before
a ticket is), closing both ends of the gap named in Context.

**We accept:** three files change (one template, two skills) instead of one; the Setup
section adds a table most initiatives will leave empty ("None needed because:"), which is a
correct, cheap default, not dead weight.

**We will need to revisit this if:** a genuinely large, uncertain piece of setup work (a
framework migration, say) shows up — Discriminator above routes it to Spikes instead, but
that boundary is untested against a real case yet.

## Glossary entry proposed, not written (owner: business-analyst, arbiter: product-owner)

- **Setup work** — environment, repository, framework or build-system work a design needs
  before implementation can start; never a functional requirement, never a roadmap phase,
  because no persona experiences it. Referent: `templates/architecture.md`'s new Setup
  section. Code identifier: `## Setup` heading, `templates/architecture.md`. Not currently a
  homonym risk — `templates/roadmap.md`'s "Buffer" and "Constraints" are the nearest existing
  terms and neither overlaps this meaning.
