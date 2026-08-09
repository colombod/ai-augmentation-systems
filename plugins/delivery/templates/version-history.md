# Version-history mechanics

Every producing skill's gate check references this file instead of restating it —
`initiatives/document-lifecycle-versioning/architecture.md`'s Approach, matching how
`writing-standard.md` and `glossary.md` already work as single-source reference files
for a rule seven skills apply. Nothing here is code: every check is a judgment an agent
makes by reading Markdown.

## The three choices

If a governed artifact already exists, read it and ask whether to **revise**, **replace**,
or **start new version**. Never silently overwrite.

- **Revise** — the new scope is the same problem as the current version's own problem
  (see the same-problem test below). Edit in place; no new table row.
- **Replace** — discard the current content entirely and start over on the same problem.
  Rare; confirm before doing this, since it destroys cited content (check
  `.delivery/glossary.md` and other documents for citations into this artifact first).
- **Start new version** — the new scope is a different problem than the current version's,
  or the current version's Status cell already reads a closed value. Never edit prior
  content; append a new `## Version N` heading and a new Version-history row.

## Same-problem test

One sentence: does the new scope's problem match the problem already stated in the
current version's own Problem section? If there is a genuine match against a document
whose Status cell is already closed, state the match and ask before proceeding — never
silently comply.

**Write the result into the document, every time — not only in chat.** For a Revise, the
reasoning goes next to the addition it justifies. For a Start new version, it goes under
the new `## Version N` heading. A reasoning that only ever existed in conversation is lost
the moment the session ends.

**The operator's stated judgment overrides the test's own output.** If the operator
reacts to the test's result with a different call, follow the operator. If there is no
reaction, proceed on the test's own output rather than blocking on silence.

Only `brief.md` and `prd.md` have a literal `## Problem` / `## Summary` section. For the
other five templates, use the primary anchor below where it exists; the Scope cell
(always present, one sentence, capped per the Scope-cell rule below) is the universal
fallback for every document, and is checked for consistency with the primary anchor
rather than read alone when both exist.

| Document | Primary anchor | Universal anchor |
| :-- | :-- | :-- |
| `brief.md` | `## Problem` | Scope cell |
| `prd.md` | `## Summary` + `## Goals and non-goals` | Scope cell |
| `research.md` | `## Implications for the brief` | Scope cell |
| `prioritization.md` | `## Staging rule` | Scope cell |
| `design-system.md` | `## Intent` | Scope cell |
| `architecture.md` | `## Approach` | Scope cell |
| `roadmap.md` | `## Sequencing rationale` | Scope cell |

## Version-history table

Added only when a document starts its own second version — never baked into a
first-version template. When a tableless document starts one, all prior content is
retroactively labelled `## Version 1` and the table is inserted before it, not after
(see the diff-check note below).

```
| Version | Date | Status | Scope |
| :-- | :-- | :-- | :-- |
| 1 | YYYY-MM-DD | in progress \| shipped \| shipped · debt open \| shipped · debt closed YYYY-MM-DD | ≤20 words / ≤140 chars, never blank |
```

**Status-cell vocabulary — closed set:** `in progress` \| `shipped` \| `shipped · debt
open` \| `shipped · debt closed <ISO date>`. Anything outside this set means the test is
unable to be applied — never guess which value was meant; report it and ask. Distinct
from, and never required to match, the document's separate header `Status:` line, which
stays freer prose.

**Scope cell:** ≤20 words / ≤140 characters, never blank. Measure before writing.

**Date cell:** ISO 8601 `YYYY-MM-DD`. Records the version's opening date only — a closing
date, if different from the opening date, goes in the Status cell text
(`shipped · debt closed <ISO date>`), not the Date cell.

**Row count:** no hard limit, but reconsider this lightweight table's approach once any
one document exceeds roughly 6 rows — flag it, don't block on it.

**Version numbers strictly increase — no gaps, no duplicates.** A correction found in a
closed version's row never renumbers it; the Corrections log annotates it instead, per
below.

**Staleness keys off the current version's own Date cell, not the file's mtime.** A file
can be touched (reformatted, a typo fixed) without a new version starting, so file
modification time alone over- and under-reports staleness. Compare downstream documents'
own current-version Date cells against this one's — an old file mtime with a recent
current-version Date cell is not stale; a recent mtime with an old current-version Date
cell may still be.

**Exactly one open version at a time.** Starting version N+1 requires first closing
version N — an in-place edit of the not-yet-closed row's own Status cell, freely
permitted as routine progress. The row freezes only once that edit lands.

## Corrections log

An append-only second table, directly below Version-history, created on first use —
modeled on `glossary.md`'s own Curation log rather than inventing a new pattern for the
same shape of problem. A closed version's row is never edited or deleted; a later-found
error gets a Corrections log entry instead, and the original row keeps its version
number:

```
### Corrections log

| Date noted | Corrects version | What was wrong | Correct value |
| :-- | :-- | :-- | :-- |
```

## Diff check — two legitimate shapes

Every version-adding edit must add lines only — verify with `git diff <file>` after
writing. This has two legitimate shapes, not one:

- **Bootstrap** (a document's first table): inserts the Version-history table and a bare
  `## Version 1` heading **before** the existing first section — 0 deletions, 0 modified
  lines, but not literally "after the last heading," because prior content has no version
  label yet to insert after.
- **Steady-state** (every version after the first): the new `## Version N` section
  appends strictly after the file's last existing heading.

Both satisfy the same real promise: prior content is never rewritten. Reading the
steady-state shape as the only legitimate one and concluding the bootstrap case is
disallowed is a misreading.

## Duplicate requests

Two "start new version" requests for the same document — same session or across
sessions — resolve to one row, by re-reading the document rather than trusting session
memory. The second request re-reads the file and reports the version the first one
already opened.
