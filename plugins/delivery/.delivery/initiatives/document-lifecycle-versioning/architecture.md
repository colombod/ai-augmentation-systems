# Architecture: document-lifecycle versioning for the plugin's own singular governed artifacts

> Initiative: `document-lifecycle-versioning` (`.delivery/initiatives/document-lifecycle-versioning/`), per `ADR-004`.
> Phase 8 artifact. Owned by Product Owner, with Business Analyst and Feature Critic (a
> 3-lens convergent analysis, per the original issue).
> Status: shipped · Started: 2026-08-09 · Shipped: 2026-08-09
> Brief: `brief.md` (this directory) · PRD: `prd.md` (this directory) ·
> Glossary: `../../glossary.md` (project-wide, per `ADR-004`) · ADRs:
> `../../decisions/ADR-006-version-lifecycle-is-prose-not-code.md`,
> `../../decisions/ADR-007-shared-version-history-reference-file.md`
> **Ported 2026-08-09 from branch `worktree-delivery-versioning`'s "## Version 2" section**
> (originally appended to the plugin's then-shared-root `architecture.md`) — relocated into
> its own initiative directory per `ADR-005`, content unchanged in substance. IDs renumbered
> fresh: `S-6`–`S-8` → `S-1`–`S-3`, `FR-20`–`FR-36` → `FR-1`–`FR-17`, `NFR-6`–`NFR-10` →
> `NFR-1`–`NFR-5` — nothing on `main` ever cited the old numbers, since the source branch
> never merged.

**Word count:** 1531 (target 1000, cap 1600, excludes tables — `grep -v '^|' | wc -w`,
counted for this section only, matching `prd.md`'s and `brief.md`'s own per-version
practice). Over target: the design resolves three open questions the PRD routed here
(`OQ1`–`OQ3`) and one real defect found while grounding the original design — the source
branch's `prd.md` Version-history table violated the vocabulary this same design defines
(GitHub issue #19) — fixed by this port's corrected worked example (see Migration) rather
than reproduced, cheaper to close now than to leave for a later reader to rediscover.

## Approach

Seven Markdown skill files gain identical gate-check wording; one new shared reference
file holds the mechanics all seven, plus `status` and `challenge`, need to interpret
consistently; nothing else in the plugin's shape changes. Two decisions carry the design.
First: the mechanics live in one file, referenced by pointer, not duplicated seven times —
this plugin already solves "one rule, many skills" this way for `glossary.md` and
`writing-standard.md`, and reusing that seam is cheaper than inventing a new one
(`ADR-007`). Second: nothing here is code. Every check — the same-problem test, the
table/heading match, staleness-by-version-date — is a judgment an agent makes by reading
Markdown, the same 100%-prose pattern every `.delivery/` convention already uses except
Version 1's own unrelated invocation ledger (`ADR-006`).

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `skills/brief/SKILL.md:35-36` | Gate check: "ask whether to revise or start fresh" | modified — three-choice wording |
| `skills/research/SKILL.md:24` | Gate check: "ask whether to extend or replace" | modified — three-choice wording |
| `skills/prd/SKILL.md:26` | Gate check: "ask whether to revise or replace" | modified — three-choice wording |
| `skills/architecture/SKILL.md:27` | Gate check: "ask whether to revise or replace" | modified — three-choice wording (this file's own producing skill) |
| `skills/prioritize/SKILL.md:20-35` | Gate check has no re-entry check at all | modified — new gate paragraph added after line 35 |
| `skills/design/SKILL.md:20-26` | Gate check covers brief/personas/codebase design system only, no re-entry check for `.delivery/design-system.md` itself | modified — new gate paragraph added after line 26 |
| `skills/roadmap/SKILL.md:20-25` | Gate check covers PRD/architecture only, no re-entry check for `.delivery/roadmap.md` itself | modified — new gate paragraph added after line 25 |
| `skills/status/SKILL.md:41-113` (Assess) | Reports gate status, invocation status, findings, consistency; no version-boundary reporting | modified — new "Version boundaries" report + one `Consistency` bullet |
| `skills/challenge/SKILL.md:24-26` (Gate check), `:68-72` (Write) | Resolves target artifact; writes `.delivery/reviews/<artifact>-<nn>.md` | modified — records target version; filename gains a version segment for versioned targets |
| `templates/findings.md:9-15` (header) | `Artifact version: <git sha or date>` field only | modified — add a `Version targeted:` field alongside it |
| `templates/version-history.md` | does not exist | **new** — table schema, same-problem test, gate-check wording, Corrections log |
| `templates/{brief,research,prd,prioritization,design-system,architecture,roadmap}.md` | fill-in-the-blank templates, no Version-history placeholder | **untouched** — `FR-3` adds the table only at second-version time, never baked into a first-version template |
| `.delivery/glossary.md` | Curated terms; PRD Version 2 already proposed 5 (`Version`, `Revise`, `Replace`, `Start new version`, `Same-problem test`), pending Business Analyst curation | untouched here — one more term proposed below, added to that same pending set, not curated by this document |
| `.delivery/decisions/` | `ADR-001` only | modified — `ADR-006`, `ADR-007` added |
| `plugins/attractor/.delivery/*` | Independent artifact tree, consumes the same shared skill files | untouched now; covered automatically going forward — see Migration |

## Component structure

No new component in the software sense — this plugin ships zero runtime code for
`.delivery/` document conventions, unchanged from Version 1's own finding (the invocation
ledger is the one exception, and it solves an unrelated problem: detecting whether a tool
call happened, not comparing two pieces of prose). Three prose-guided procedures:

1. **Gate-check three-choice (`FR-13`).** Each of the seven producing skills' gate check,
   on finding its own artifact exists, states the three literal choices and points at the
   shared mechanics file. A text change to seven files, nothing else.
2. **Same-problem test (`FR-1`/`FR-2`/`FR-5`/`FR-7`).** A checklist in
   `templates/version-history.md`, invoked by reference. Not code: like `prioritize/SKILL.md`'s
   existing evidence-only-marker check, it is a judgment an agent makes by reading two
   pieces of prose and comparing them — no parser, because neither side is structured data.
3. **Structural read (`FR-9`/`FR-10`/`FR-11`/`FR-12`/`FR-14`).** `/delivery:status` reads
   each governed artifact's Version-history table (≤6 rows per `NFR-3`) and counts
   `## Version N` headings in the body — the same scale of read `status/SKILL.md` already
   does for `FR-n` cross-referencing and dangling `superseded_by` links.
   `challenge/SKILL.md` performs the equivalent single-document read before naming a
   review file.

No script, hook or MCP tool is proposed anywhere in this design, answering the question
the PRD itself asked (`architecture` OQ2b): this stays consistent with the zero-code
posture of every `.delivery/` mechanism except the unrelated Version 1 ledger.

## Interfaces and data contracts

**Version-history table** (unchanged from the real schema already in `brief.md` and
`prd.md`; now formalized):

```
| Version | Date | Status | Scope |
| :-- | :-- | :-- | :-- |
| 1 | YYYY-MM-DD | in progress \| shipped \| shipped · debt open \| shipped · debt closed YYYY-MM-DD | ≤20 words / ≤140 chars, never blank |
```

**Corrections log** (`NFR-1`, `FR-1`, resolving `OQ3`) — a second, append-only table
directly below Version-history, created on first use, modeled on `glossary.md`'s own
Curation log (`glossary.md:79-84`) rather than inventing a new pattern for the same shape
of problem:

```
### Corrections log

| Date noted | Corrects version | What was wrong | Correct value |
| :-- | :-- | :-- | :-- |
```

**Gate-check wording**, identical across all seven skills (`FR-13`):

```
If `.delivery/<doc>.md` already exists, read it and ask whether to **revise**,
**replace**, or **start new version**. See `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md`
for what each means, the same-problem test that chooses between revise and start new
version, and the Version-history table and Corrections log it writes. Never silently
overwrite.
```

**Same-problem test's anchor, generalized across all seven templates** — only `brief.md`
and `prd.md` have a literal `## Problem`/`## Summary` section; the other five don't, so
the test needs a uniform fallback. The Scope cell (always present, one sentence, capped by
`NFR-2`) is that fallback for every document; where a richer section exists, it is the
primary source and the Scope cell is checked for consistency with it, not read alone:

| Document | Primary anchor | Universal anchor |
| :-- | :-- | :-- |
| `brief.md` | `## Problem` | Scope cell |
| `prd.md` | `## Summary` + `## Goals and non-goals` | Scope cell |
| `research.md` | `## Implications for the brief` | Scope cell |
| `prioritization.md` | `## Staging rule` | Scope cell |
| `design-system.md` | `## Intent` | Scope cell |
| `architecture.md` | `## Approach` | Scope cell |
| `roadmap.md` | `## Sequencing rationale` | Scope cell |

**`FR-15`'s diff check has two legitimate shapes, not one.** *Bootstrap* (`FR-3`, a
document's first table): inserts the Version-history table and a bare `## Version 1`
heading **before** the existing first section — 0 deletions, 0 modified lines, but not
literally "after the last heading," because prior content has no version label yet to
insert after (this document's own Version 1 section, above, is that bootstrap, performed
by this edit). *Steady-state* (every version after the first): the new `## Version N`
section appends strictly after the file's last existing heading, satisfying `FR-15`
literally. Both satisfy `FR-1`'s real promise — stated explicitly so a future reader
does not read `FR-15` narrowly and conclude the bootstrap case is disallowed.

**`/delivery:status`'s per-artifact report** (`FR-9`, resolving `OQ2b` — no cross-document
join, one row per artifact):

```
| Artifact | Current version | Status | Scope | Table/heading check |
| :-- | :-- | :-- | :-- | :-- |
| brief.md | 2 | in progress | Document-lifecycle versioning... | OK (2/2) |
| prd.md | 2 | in progress | ... | OK (2/2) |
| architecture.md | 2 | in progress | Document-lifecycle versioning mechanics... | OK (2/2) |
| roadmap.md | 1 (implicit, no table) | — | — | n/a |
```

**`challenge` review target versioning (`FR-11`).** `templates/findings.md`'s header gains
a field alongside the existing `Artifact version` (a git sha/date stamp, a narrower,
already-compatible sense — not a collision): `Version targeted: <N> (<Status-cell value at
review time>) | n/a — no Version-history table`. Review filenames gain a version segment
for a target that carries a table at review time: `.delivery/reviews/<artifact>-v<N>-<nn>.md`
(e.g. `prd-v2-01.md`); unversioned targets (`stories/`, tableless documents) keep the
existing `<artifact>-<nn>.md` form. Pre-existing files (`brief-01.md`,
`phase-5-cli-tui-01.md`) are not renamed.

**Term proposed for glossary curation:** *Corrections log* — the append-only table
recording an error found in a closed version's row, added to Business Analyst's pending
queue alongside PRD Version 2's own five proposed terms.

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | Version-history rows never edited/deleted; a correction adds a new row/note | The Corrections log above — a second table, modeled on `glossary.md:79-84`'s working precedent | high |
| NFR-2 | Scope cell ≤20 words / ≤140 chars | Stated as a hard rule in `templates/version-history.md`; a one-line length check any agent performs before writing the row | high |
| NFR-3 | Reconsider the lightweight table past ~6 versions | `/delivery:status`'s per-artifact report counts rows every run; 6+ triggers a flagged reconsideration, not a block | medium — unexercised until a real document reaches that count |
| NFR-4 | Closed Status-cell vocabulary | Enumerated once in the shared file; `FR-8`'s fallback fires outside it | high |
| NFR-5 | ISO 8601 date, opening date only | Stated as a hard rule in the same file; matches `brief.md`'s real existing usage | high |

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-006 | Version-lifecycle mechanics (same-problem test, table/heading match, staleness date) are agent-judged prose, no code | A validation script (rejected: NFR-3's volume is trivially small; a second definition of "well-formed" to keep synced); a blocking hook (rejected: Claude Code hooks fire on tool calls, not reply content — no attachable event exists) |
| ADR-007 | Mechanics live once in `templates/version-history.md`, referenced by all seven skills | Duplicating full prose in each `SKILL.md` (rejected: reproduces the exact fragmentation the PRD's own Problem section documents for today's two-choice gates); a machine-readable config (rejected: nothing here is parsed by anything but an agent reading prose) |

**Resolving PRD Version 2's three open questions routed here:**

- *`OQ1`* — exactly one open version per document at a time. `NFR-4`'s vocabulary and the
  same-problem test's own wording ("the current version's own Problem section," singular)
  only make sense with one unambiguous open version. Starting version N+1 requires first
  closing version N — an in-place edit of the *not-yet-closed* row's own Status cell,
  already permitted freely by `FR-6`; the row freezes only once that edit lands.
- *`OQ2a`* (write atomicity) — no new mechanism needed. An interrupted edit leaves a
  visibly incomplete, git-tracked file that reverts cleanly, the same exposure every other
  `.delivery/` write already has; `FR-15`'s diff check is the correctness safeguard, not
  atomicity.
- *`OQ2b`* (status aggregation) — answered above: one row per artifact, no join.
- *`OQ3`* (correction syntax) — the Corrections log, above.

## Spikes — what must be proven before committing

None. Every mechanism here is a Markdown convention an agent reads and follows — the same
kind of thing `prioritize/SKILL.md`'s evidence-only marker and `status/SKILL.md`'s `FR-n`
cross-referencing already do today, with no spike behind either. The one real empirical
unknown — whether the same-problem test's generalization to the five non-Problem-section
templates (Interfaces, above) produces sane judgments — is small enough to settle with the
worked examples in Test strategy below, not a time-boxed spike: nothing here depends on an
external tool, an undocumented platform behavior, or a library, the three things Version
1's six real spikes existed to de-risk.

## Migration and rollback

**Forward:** additive only. The new shared file and the seven gate-check lines change no
existing persisted format — the Version-history schema is the first write of itself, not a
migration. Documents that never start a second version stay untouched indefinitely
(`FR-3`), matching the PRD's own non-goal against backfilling.

**`plugins/attractor/.delivery/` is out of scope to retrofit, and cannot be retrofitted
separately even if it were in scope.** The mechanism lives entirely in the shared skill
files and `templates/version-history.md`, both of which `plugins/attractor/.delivery/`
already consumes via the same plugin. The next time any of attractor's seven documents
starts a genuine second version, it gets the identical table with zero extra action —
there is no per-project copy of the mechanics to install separately. Attractor's existing
documents are not touched now, matching the same non-goal.

**Worked example — the Status cell's vocabulary, illustrated, not cited from a live defect
in this initiative's own files:** a Version-history table's Status cell must stay within
`NFR-4`'s vocabulary, kept distinct from the document-header `Status:` line's freer prose —
the exact ambiguity `FR-12` exists to prevent. A conforming row:

| Version | Date | Status (`NFR-4`) | Scope |
| :-- | :-- | :-- | :-- |
| 1 | 2026-08-05 | in progress | Self-hardening — invocation provenance, evidence grading, verification channels, self-correction; `S-5` in-version revision added 2026-08-06, not yet built |

An open version's row stays freely editable (`FR-6`) until it closes; once closed, any
later-found error is fixed only by a Corrections log entry, never an in-place edit.

**Back:** delete `templates/version-history.md` and revert the seven gate-check lines to
their prior wording. Any Version-history tables already written are inert Markdown;
`status.md` degrades to its pre-existing file-exists/exit-criteria reporting — the same
graceful degradation Version 1's own rollback already established for the invocation
ledger.

## Test strategy

| Area | Risk | Test level | Notes |
| :-- | :-- | :-- | :-- |
| Well-formed table, real case | Low | Example-based, real fixture | `brief.md`'s and `prd.md`'s own existing tables are the golden fixtures — no invented data |
| `FR-14` table/heading mismatch | Medium | Example-based, synthetic fixture | Hand-build a doc with 2 table rows but 3 `## Version N` headings; confirm `/delivery:status` reports an explicit inconsistency |
| `FR-4` duplicate start-new-version request | Medium | Example-based, session replay | Ask twice in one reply, then once more in a fresh session against the same doc; confirm one row each time, by re-reading the file |
| `FR-9` tableless artifact | Low | Example-based | Point `/delivery:status` at a governed artifact with no table; confirm "Version 1 (implicit, no table)" |
| `FR-10` staleness by version start date | Low | Example-based | A doc with an old file mtime but a recent current-version Date cell, and the reverse; confirm the Date cell wins |
| Same-problem test on the 5 non-Problem-section templates | Medium | Example-based, one per template | One worked case per row of the anchor table above — the one genuinely new judgment this design asks an agent to make |
| Corrections log (`NFR-1`/`FR-1` error case) | Low | Example-based | Deliberately wrong closed-version row; confirm a Corrections log entry is added and the original row is byte-for-byte unchanged |
| `FR-15` diff-only-additions check | Medium | Manual verification step, every version-adding edit | `git diff <file>` after the edit; 0 deletions, additions positioned per the bootstrap/steady-state distinction above |

**Deliberately thin:** cross-session concurrent edits to the same table are untested,
matching the PRD's own out-of-scope; `NFR-3`'s ~6-version reconsideration trigger is
unexercised until a real document reaches that count.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| An agent picks "replace" from two-choice habit instead of "start new version" for a closed document | Medium | High — defeats the mechanism silently | Identical three-choice wording across all seven skills (`ADR-007`); `/delivery:status`'s version report is the after-the-fact backstop, via a discontinuous table | product-owner |
| The same-problem test's generalization to non-Problem-section documents is this design's own extension, not confirmed by the PRD's own worked scenarios (`brief.md`/`prd.md` only) | Medium | Medium | Named here; Test strategy requires one worked example per document type before this is trusted | solution-architect |
| `templates/version-history.md` itself drifts from the seven skills' actual behavior if a future skill edit skips updating it | Low | Medium | The shared-file decision (`ADR-007`) exists to prevent seven-way drift; this residual risk is the same class already accepted for `writing-standard.md` | solution-architect |
