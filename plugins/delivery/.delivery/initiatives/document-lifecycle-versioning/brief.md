# Product brief: document-lifecycle versioning for the plugin's own singular governed artifacts

> Initiative: `document-lifecycle-versioning` (`.delivery/initiatives/document-lifecycle-versioning/`), per `ADR-004`.
> Phase 1 artifact. Owned by Product Owner, with Business Analyst and Feature Critic (a
> 3-lens convergent analysis, per the original issue).
> Status: shipped · Started: 2026-08-09 · Shipped: 2026-08-09
> PRD: `prd.md` (this directory) · Architecture: `architecture.md` (this directory) ·
> Glossary: `../../glossary.md` (project-wide, per `ADR-004`)
> **Ported 2026-08-09 from branch `worktree-delivery-versioning`'s "## Version 2" section**
> (originally appended to the plugin's then-shared-root `brief.md`) — relocated into its own
> initiative directory per `ADR-005`, content unchanged in substance. IDs renumbered fresh:
> `S-6`–`S-8` → `S-1`–`S-3`, `FR-20`–`FR-36` → `FR-1`–`FR-17`, `NFR-6`–`NFR-10` →
> `NFR-1`–`NFR-5` — nothing on `main` ever cited the old numbers, since the source branch
> never merged.
> **No `research.md` exists for this initiative** — the source branch went brief → PRD →
> architecture directly, skipping the research phase. That gap is carried forward explicitly
> here (documented, not silently absent) rather than run retroactively now, since the design
> content itself is already substantively reviewed.

**Mode:** frame · **Word count:** 1142 (target 600, cap 900, excludes tables — measured with
`grep -v '^|' | wc -w`). **Budget overrun declared, twice:** the original lens pass was
already ~40 words over cap for resolving Open Question 5 inline (a real product decision,
not restatement) rather than protect the margin. Relocating this content into its own
initiative directory per `ADR-005` added roughly 200 further words — the provenance and
no-`research.md` callouts above — needed so a later reader isn't left guessing where this
content came from or why a normal pipeline artifact is missing; cutting either would trade
a real gap in the record for a word count, which the writing standard's own priority order
also rejects. Coverage: three
lenses (product-owner, business-analyst, feature-critic) ran independently against this
plugin's skills, templates, and this project's own `.delivery/` artifacts; convergence
marked inline, `(N lenses)`. Space counted as explored for a frame-mode pass.

**Naming resolved, not left as Open Question 5:** the concept is called **Version**, the
operator's own word from the live incident that motivated this brief. Not "cycle" —
`realign/SKILL.md`'s "cycle" already names one sprint→sprint-review→realign loop, a finer
grain than a whole new capability layered onto an already-shipped product. Not "release" —
`prioritize/SKILL.md`'s "release milestone" already names a user-facing shipping event. The
one pre-existing "version" usage in this plugin (`templates/findings.md`'s "Artifact
version: <git sha or date>," a per-document review-snapshot stamp) is a narrower, compatible
sense, not a collision.

## Problem

None of this plugin's seven singular governed artifacts (`brief.md`, `research.md`,
`prd.md`, `prioritization.md`, `design-system.md`, `architecture.md`, `roadmap.md`) has a
concept of "this closed, a new one opened." **(3 lenses)** All three independently confirmed
— by reading every `SKILL.md` and template — that no version or phase-lifecycle field exists
anywhere in this document set. Re-entry is fragmented, not one binary choice: `brief`,
`research`, `prd`, and `architecture` each gate re-entry with a different, undefined verb
pair (revise/start fresh; extend/replace; revise/replace ×2); `prioritize`, `design`, and
`roadmap` have no re-entry gate at all — a rerun proceeds silently.

**(3 lenses)** In that absence, three documents here have already improvised free-text
workarounds in their `Status:` header — `prd.md` ("S-5 added 2026-08-06, not yet built"),
`architecture.md` ("Mechanism 3's CLI/TUI extension... added 2026-08-06, planning only"),
`roadmap.md` ("Phase 5 added, challenged, and built") — three phrasings of one unmet need,
none machine-readable, none cross-checked downstream. `prioritization.md` has no `Status:`
line at all.

The operator hit this directly, live, in this session, asking for exactly this capability:
"since we are adding this should be documentation for the new version, if we keep fudging
with current document then the delivery plusing has a bug."

## Who has it

The same solo operator Version 1 scoped to, running this pipeline across more than one
unrelated wave of work against the same project — anyone who reruns `/delivery:brief`,
`/delivery:prd`, or `/delivery:roadmap` for genuinely new scope after a prior version has
shipped and closed, the situation this edit is in right now.

## Cost of the status quo

**(3 lenses)** "Revise" means editing a document whose header already asserts closure, to
insert unrelated scope — `roadmap.md`'s phases are sequenced against one dependency chain,
and a new numbered phase implies continuity that doesn't exist. **(3 lenses)** "Replace" or
"start fresh" is worse: `glossary.md` cites Findings A–D from `brief.md`'s Version 1 content
in 5 of its 11 terms — replace breaks all five, and discards a `challenge` pass that found
and fixed 12 findings, 3 blocking.

**(2 lenses)** The nearest precedent — stories' and personas' `supersedes`/`status:
active|retired` pattern — doesn't transfer: those are one-file-per-instance artifacts, where
"add a new file" is cheap. The 7 singular documents are one file holding many items
(`FR-1`…`FR-19`, phases 0–5); the fix forks between an in-document per-item marker and
directory-of-units restructuring, roughly an order of magnitude apart in cost, undecided
today.

**(2 lenses)** The blast radius exceeds the seven producing skills: `status.md`'s staleness
check ("modification time newer than downstream documents") can't distinguish a legitimate
new version from drift, and `challenge.md`'s review numbering (`reviews/<artifact>-<nn>.md`)
has no version dimension — a second version's review looks like a second pass on the same
version.

**(1 lens)** "Phase" is already a homonym: `status.md`'s pipeline phases (1–11, one per
skill) and `roadmap.md`'s implementation phases (0–5, `Phase 1b` included) are two unrelated
numbering schemes with no qualifier distinguishing them. A version concept needing "which
phase of which version" compounds an existing ambiguity rather than starting clean.

## What changes if we solve it

A singular artifact can gain new, unrelated scope without falsifying its own "closed" status
or discarding cited, reviewed content. A reader — including the operator, cold, later — can
tell which part belongs to which version without re-reading full prose. `status.md` and
`challenge.md` reason about version boundaries instead of misreading them as staleness or
duplicate review.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Re-entry into a singular artifact offers a real third path for unrelated new scope | read the gate check in the artifact's `SKILL.md` | 4 of 7 offer only revise/replace-shaped choices, 3 of 7 offer none | all 7 offer revise, replace, and start-new-version, worded consistently |
| Prior-version citations still resolve | glossary's 5 citations into `brief.md`'s Version 1 content | would break under a "replace" | all 5 resolve after Version 2 exists |
| A reader can tell versions apart without reading full prose | inspect `status.md`'s report or the document header | no field exists | version boundary visible structurally |
| The operator's own words stop applying | re-ask after the mechanism ships | "the delivery plusing has a bug" | no reasonable reading of the result is "fudging" |

## MVP boundary

The smallest real exercise of this mechanism is already underway: a **document-level version
marker** — a header table recording version number, date, status, and one-line scope,
appended per version, with prior headings retroactively labelled but never rewritten. This
Version history table is that MVP, applied to `brief.md` itself. **(1 lens)** It is
deliberately the cheapest option here — closer to `glossary.md`'s curation-log than to
stories/personas' file-per-instance machinery — because the incident motivating this
capability is a single recurrence; the heavier mechanism isn't yet justified before the
lightweight one is tried.

Deferred to architecture: whether `FR-n`/phase-n numbering resets per version or keeps
counting up (the plugin's only demonstrated behavior, collision-free); whether
`status.md`/`challenge.md` need code changes or version-aware reads of the same fields.

## Explicitly out of scope

- Restructuring the 7 singular documents into directories-of-units (stories/personas-style)
  — real, not ruled out, not this version's MVP.
- A heuristic that auto-infers "new version" versus "still this version" — the trigger stays
  a question the operator answers, the same way every existing supersession point in this
  plugin is human-gated.
- Multi-operator concurrent edits and OS-level permission failures — generic git-merge and
  filesystem conditions, not specific to this feature.
- Naming a new persona for the operator's version-boundary objection — a call for
  `/delivery:personas`, not this brief.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Backfill all 7 existing documents with a version marker now, or leave pre-Version-2 documents unmarked as legacy? | product-owner | Whether shipping this requires editing documents already declared closed |
| 2 | Is "traces back to the same originating PRD problem statement, surfaced via `/delivery:realign`" the intended same-version-vs-new-version test, or something else (time-boxed, operator-declared)? | product-owner | Defining the trigger named in Explicitly out of scope |
| 3 | Does a multi-document version-tagging operation need to be all-or-nothing, or is a named partial-completion state ("version marker present on N of M documents") acceptable? | solution-architect | Whether `status.md` needs a new reporting state |
| 4 | Is there a correction path for a version mis-tagged in error, or is advancing the version number a one-way operation? | solution-architect | Scoping the mechanism's write surface |
