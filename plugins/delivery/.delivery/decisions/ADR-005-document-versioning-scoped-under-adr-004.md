<!--
BUDGET — target 400 words, hard cap 600 words. Excludes code, YAML and data tables.
-->

# ADR-005: Document-lifecycle versioning becomes its own initiative; the Version mechanism narrows to intra-initiative reopening

**Status:** proposed — pending operator confirmation of the initiative slug
(`document-versioning`, recommended below) and business-analyst curation of the glossary
terms below.
**Date:** 2026-08-08
**Deciders:** solution-architect
**Word count:** ~1115 prose-only (`grep -v '^|' | wc -w`), over the 600-word cap — declared,
not silent, smaller than `ADR-004`'s own larger overrun for a comparable reason: this
reconciles two designs (where the content lives, where the mechanism still applies), fixes
a live cited bug (#19) with a worked correction, and carries a full ID-renumbering table.
Three alternatives, the routed question and the glossary entries are the template's own
protected categories.

## Context

On 2026-08-07, branch `worktree-delivery-versioning` (based off `2147af7`, predates
`ADR-004`) ran a full brief → PRD → architecture cycle for "document-lifecycle versioning" —
a Version-history marker so a closed governed artifact can gain new scope without
falsifying its closed status or discarding cited content. It appended this as "## Version 2"
to the plugin's then-shared-root `brief.md`/`prd.md`/`architecture.md`, plus two ADRs
(`ADR-002-version-lifecycle-is-prose-not-code`, `ADR-003-shared-version-history-reference-file`,
numbered against a sequence `main` no longer has). `ADR-004` (accepted, shipped) then gave
every initiative its own `.delivery/initiatives/<slug>/` directory. The versioning branch
never merged and still targets the deleted shared-root paths.

`ADR-004` already gives "genuinely new, unrelated scope" a mechanism: start a new
initiative, optionally `extends:`-linked. But it fixes a *concurrent, cross-initiative*
collision (`harden` and `chief-of-staff` both continuing `S-n` in one shared file); it says
nothing about a *single* initiative's own already-closed document reopening for related
work — real and current: `initiatives/harden/roadmap.md:5-6` reads "Phases 0–3 complete, all
debt closed · Phase 4's ... M4 evidence-gathering remains · Phase 5's CLI half complete ..."
— one free-text line encoding mixed closed/open state, un-versioned, the exact defect the
source branch diagnosed; `harden/prd.md`'s header shows the same pattern. `ADR-004`'s
migration never touched either, because it doesn't reach this problem. Separately, `prd.md`'s
own Version-history table on the source branch violates the Status-cell vocabulary (`NFR-9`)
that same design defines — issue #19.

## Decision

**1. Relocate, don't discard.** Ported content becomes its own initiative,
`.delivery/initiatives/document-versioning/{brief,prd,architecture}.md`, written as that
initiative's real, standalone **Version 1** — not "Version 2" of `harden`'s files, which
stay untouched. The scenario that forced "Version 2" onto a shared file — genuinely new,
unrelated scope, nowhere else to put it — is now `ADR-004`'s own worked example.

**2. Not redundant — the trigger composes with `ADR-004`, not duplicates it.**
`ADR-004`'s initiative-resolution runs first: new initiative, or this one. Only once that
keeps new scope inside one initiative's own document does the Version marker apply —
reopening a *closed* document honestly (new `## Version N` heading, append-only Corrections
log) instead of silent in-place editing. Scenario `S-1` (was `S-6`)'s trigger now fires only
after `ADR-004`'s resolution has already placed the scope in *this* initiative.

**3. Renumber IDs fresh** — nothing on `main` cites the old ones (the branch never merged),
and reused numbers would misleadingly echo `chief-of-staff/prd.md`'s own `S-6`–`S-12`:

| Old (branch) | New (`document-versioning`) |
| :-- | :-- |
| S-6, S-7, S-8 | S-1, S-2, S-3 |
| FR-20 … FR-36 | FR-1 … FR-17 (same order) |
| NFR-6, NFR-7, NFR-8, NFR-9, NFR-10 | NFR-1, NFR-2, NFR-3, NFR-4, NFR-5 |
| `ADR-002-version-lifecycle-is-prose-not-code.md` | `ADR-006-version-lifecycle-is-prose-not-code.md` |
| `ADR-003-shared-version-history-reference-file.md` | `ADR-007-shared-version-history-reference-file.md` |

**4. Fix issue #19 by not reproducing it.** `NFR-4`'s (was `NFR-9`) vocabulary was always
correct; the bug was worked examples citing `prd.md`'s real, non-conforming row. Per `FR-12`
(was `FR-31`), the vocabulary constrains only a Version-history **table's** Status cell,
never the free-text header `Status:` line — `harden/prd.md`'s and `harden/roadmap.md`'s
header prose need no change; they were never in scope. Corrected worked example
(illustrative — `harden` gets no table until it starts its own second version, `FR-3`, was
`FR-22`):

| Version | Date | Status (`NFR-4`) | Scope |
| :-- | :-- | :-- | :-- |
| 1 | 2026-08-05 | in progress | Self-hardening — invocation provenance, evidence grading, verification channels, self-correction; `S-5` in-version revision added 2026-08-06, not yet built |

## Alternatives considered

### A — Treat `ADR-004` as making the Version marker fully redundant; drop the design
**Attractive:** one mechanism, not two. **Rejected:** `harden/roadmap.md:5-6` and
`harden/prd.md`'s header are live, un-versioned evidence the intra-initiative reopening
problem survives `ADR-004` untouched — dropping the design leaves issue #22's own
"Discovered live" case with no fix.

### B — Port unmodified into `harden`'s own directory as its literal "Version 2"
**Attractive:** zero renumbering. **Rejected:** document-lifecycle versioning isn't
`harden`'s problem (invocation provenance, evidence grading) — it's independently
plannable and deliverable for all seven artifact types, the glossary's own definition of
**Initiative**. Forcing it under `harden` misfiles it the way `chief-of-staff` was misfiled
before `ADR-004`.

### C — Keep it as a project-wide convention doc under `templates/`, owned by no initiative
**Attractive:** matches `templates/version-history.md`'s real role as shared mechanics.
**Rejected:** the *template* is correctly project-wide; the *brief/PRD/architecture that
justify and design it* are planning artifacts with their own scenarios and open questions —
exactly what forks per initiative. Mechanics (shared) and the planning doc that designed
them (initiative-owned) split the same way `glossary.md` already sits beside the
per-initiative PRDs that cite it.

## Consequences

**We gain:** issue #19 closed without re-committing its own bug; `ADR-004` demonstrated
against real content, not only asserted; the two mechanisms' boundary made explicit so a
future reader doesn't reintroduce either rejected alternative.

**We accept:** a mechanical renumbering pass across three files and two ADRs before issue
#22's rollout can cite stable IDs; the slug and glossary terms still need real sign-off —
this ADR is `proposed`, not `accepted`, until they land.

**We will need to revisit this if:** a same-problem addition arrives for a version whose
Status already reads `shipped` — see the routed question below; `S-1` (was `S-6`) only
describes the *different*-problem closed-reopen path today.

## Open question routed to product-owner (in their vocabulary)

`harden`'s own Version 1, if it ever gets a table, sits at `in progress` above because `S-5`
is unfinished, same-problem, follow-on work. Suppose it *had* already shipped before `S-5`
came up: does more of the same work un-close it back to `in progress`, or does even
same-problem follow-on work to an already-shipped version always need a new version number?
The source design's edge case ("new scope matches the closed version's own problem → ask
before proceeding") says this needs a human answer but never says which action it produces.

## Glossary entries proposed, not written (owner: business-analyst, arbiter: product-owner)

Carried forward from the source branch, kept distinct from `ADR-004`'s **Initiative**
(directory-level, cross-initiative) rather than colliding with it (document-level,
single-initiative):

- **Version** — a numbered, dated chapter of one governed artifact's own life, recorded in
  that artifact's Version-history table; narrower than **Initiative**, never a substitute
  for starting one. Referent: this ADR's worked example, above.
- **Revise / Replace / Start new version** — the three re-entry choices a producing skill's
  gate check offers once `ADR-004`'s initiative-resolution has already settled which
  initiative's document is being edited.
- **Same-problem test** — the one-sentence check distinguishing Revise from Start new
  version, run only after, and separate from, `ADR-004`'s own new-initiative test.
- **Corrections log** — the append-only table fixing an error in a closed version's row
  without editing it in place.
