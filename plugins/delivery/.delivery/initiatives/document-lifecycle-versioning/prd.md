# PRD: document-lifecycle versioning for the plugin's own singular governed artifacts

> Initiative: `document-lifecycle-versioning` (`.delivery/initiatives/document-lifecycle-versioning/`), per `ADR-004`.
> Phase 5 artifact. Owned by Product Owner, with Business Analyst and Feature Critic (a
> 3-lens convergent analysis, per the original issue).
> Status: shipped · Started: 2026-08-09 · Shipped: 2026-08-09
> Brief: `brief.md` (this directory) · Architecture: `architecture.md` (this directory) ·
> Glossary: `../../glossary.md` (project-wide, per `ADR-004`)
> **Ported 2026-08-09 from branch `worktree-delivery-versioning`'s "## Version 2" section**
> (originally appended to the plugin's then-shared-root `prd.md`) — relocated into its own
> initiative directory per `ADR-005`, content unchanged in substance. IDs renumbered fresh:
> `S-6`–`S-8` → `S-1`–`S-3`, `FR-20`–`FR-36` → `FR-1`–`FR-17`, `NFR-6`–`NFR-10` →
> `NFR-1`–`NFR-5` — nothing on `main` ever cited the old numbers, since the source branch
> never merged.

**Word count:** 1584 (target 1000, cap 1600, excludes tables — `grep -v '^|' | wc -w`, counted
for this section only, matching `brief.md`'s own per-version practice). Over target: 17
requirements resolve three roles' worth of conflicts (Status-field identity, grading,
document structure) that a shorter pass would leave unresolved — see Assumptions.

## Summary

A document-lifecycle version marker for this plugin's seven singular governed artifacts,
so a closed document can gain genuinely new scope without editing content already marked
closed or discarding what cites it. Three scenarios: reopening a closed version, extending
an open one, and telling versions apart without reading full prose.

## Goals and non-goals

**Goals**

- The operator who catches a document being fudged mid-closure gets a structural third path
  — start a new version — instead of revise-or-replace being the only choices.
- The operator returning after time away can tell, from a table alone, whether new scope
  belongs to the version they left open or a new one, without re-reading it.

**Non-goals**

- Backfilling all seven documents with a version marker now — added per-document only when
  that document starts its own second version, matching `brief.md`'s own precedent.
- Cross-document atomic version-bumping — no lockstep requirement across the seven documents;
  each advances independently.
- An auto-inferred version boundary with no human declaration — the operator's stated
  judgment always governs the same-problem test's output.
- Restructuring the seven documents into directories-of-units — real, not this MVP.
- Multi-operator concurrent edits and OS-level permission failures — generic git-merge and
  filesystem conditions, not specific to this feature.

## User scenarios

## S-1: A closed version reopens for genuinely new scope

**Actor:** the Spec-Literal Operator
**Trigger:** new scope is requested for a governed artifact whose current version's
Version-history Status cell already reads a closed value (`NFR-4`).
**Preconditions:** the artifact has, or gains on this pass (`FR-3`), a Version-history
table. Its Status column — not the document's separate header `Status:` line — is the only
field this test reads. A Status cell outside `NFR-4`'s vocabulary routes to `FR-8` instead.

**Main path**

1. Operator asks for new scope on a document whose current version's Status cell is closed.
2. Agent applies the same-problem test: does the new scope's problem, in one sentence, match
   the problem already stated in that version's own Problem section?
3. It doesn't: agent appends a new row (number, ISO date, "in progress," scope) and opens a
   new `## Version N` heading below all prior content, with the test's result and reasoning
   written under it (`FR-2`).
4. Nothing under a prior heading is edited — checked by diff (`FR-15`).
5. Report cites the new row as the record.

**Observable outcome:** from the table alone, the operator confirms a genuinely new version
opened and prior content is untouched.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Document has no Version-history table yet | Table is created now; all prior content is retroactively labelled "Version 1"; new heading begins the current version |
| New scope actually matches the closed version's own problem | Agent states the match and asks before proceeding — never silently complies |
| Two "start new version" requests land for the same document, same session or across sessions | The second re-reads the document and reports the version the first already opened — resolved by re-reading, never session memory; one row, not two |
| Closed version still has unresolved questions from its own scope | Does not block a new version — closure and unresolved items are independent facts |
| A closed version's row is later found to have an error (wrong date, wrong scope text) | Fixed only by an append-only correction note; the original row is never edited or deleted, and keeps its version number |

**Acceptance criteria**

- `FR-1` — A closed-version scope mismatch appends a new row and heading; prior content,
  including a closed row later found to be in error, is never edited in place (`NFR-1`).
- `FR-2` — The same-problem test's result and reasoning are written into the document under
  the new heading, not only stated in chat.
- `FR-3` — A tableless document, pre-existing or new, gets a Version-history table only when
  it starts its own second version; prior content is then retroactively labelled "Version 1."
- `FR-4` — Duplicate "start new version" requests, same session or across sessions, resolve
  to one row, by re-reading the document rather than session memory.
- `FR-13` — Each of the seven producing skills' gate-check names the same three literal
  choices — revise, replace, start new version; the three currently ungated skills
  (`prioritize`, `design`, `roadmap`) gain the gate on first re-entry.
- `FR-15` — A version-adding edit is verified by diff to add only lines after the last
  existing heading — the mechanism's core "never rewritten" promise (`FR-1`), made checkable.
- `FR-16` — Version numbers are strictly increasing, no gaps or duplicates; a correction never
  renumbers an existing version, only annotates it.
- `FR-17` — The Scope cell is never blank.

## S-2: Extending the current open version versus starting a new one

**Actor:** the Unwitnessed Operator
**Trigger:** new scope surfaces — via `/delivery:realign`, direct instruction, or a
`challenge` finding — for a document whose current version's Status cell reads "in
progress."
**Preconditions:** current version open, per `NFR-4`. A Status cell outside that vocabulary
routes to `FR-8`.

**Main path**

1. New scope surfaces for an open-version document.
2. Agent applies the same-problem test against that version's own Problem section.
3. Same problem: Revise — new ID added, Status cell updated in place as routine progress,
   distinct from a correction (`FR-6`); no new row.
4. Different problem: `FR-1`'s new-row/new-heading mechanics apply, regardless of whether
   the current version is open or closed. Whether starting version N+1 requires first
   closing the still-open version N is unresolved (Open Questions).
5. The test's result and reasoning are written next to the addition every time. If the
   operator doesn't react, the agent proceeds on the test's own output (`FR-7`).

**Observable outcome:** reading `prd.md`'s real `S-5` case reproduces "Revise, not new
version," with the reasoning visible in the document, not only inferable from prose.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| New scope is a close call — related area, materially different problem | Agent states the test's actual output, never defaults to "current version" because it's cheaper |
| Operator's declared judgment disagrees with the test's result, either direction | The operator's declaration is recorded as the outcome |
| Operator doesn't react to the stated test result at all | Agent proceeds on the test's own output by default; correction stays available later, append-only |
| Current version's Status cell is missing, or outside `NFR-4`'s vocabulary | Test reported unable-to-be-applied — never guesses "same version" |
| New scope is a mix — partly same problem, partly not | The two parts may split; one outcome does not have to travel with the other |

**Acceptance criteria**

- `FR-5` — Every addition to an open-version document states the same-problem test's result
  and reasoning, written next to the addition.
- `FR-6` — A same-problem addition is recorded as a Revision (new ID, in-place Status-cell
  update), no new row; the open version's own Status cell stays freely editable, distinct
  from an append-only correction (`NFR-1`) to a version's number, date, or scope.
- `FR-7` — The operator's declared judgment overrides the test result whenever stated; no
  reaction defaults to the test's own output, correction available later via `NFR-1`.
- `FR-8` — A Status cell missing or outside `NFR-4`'s vocabulary reports the test as
  unable-to-be-applied, never a default "same version."

## S-3: A reader tells versions apart without full-prose reading

**Actor:** the Trusting Delegator
**Grade:** `assumed` — the persona itself is `assumed`-grade, no observed instance, matching
`S-4`'s precedent for the same actor.
**Trigger:** reads `/delivery:status` output, or opens a governed artifact's header
directly, needing to know which version currently applies.
**Preconditions:** at least one artifact carries a Version-history table (`brief.md`, and
now `prd.md`, today).

**Main path**

1. Reader runs `/delivery:status` or opens the document directly.
2. `/delivery:status` reports each table-bearing artifact's version, Status-cell value, and
   scope, read structurally; a tableless document reads "Version 1 (implicit, no table)"
   (`FR-9`).
3. Staleness compares modification time against the current version's own start date, not
   the document's original creation date (`FR-10`).
4. `challenge` review filenames state which version they targeted; a review whose target no
   longer resolves is flagged like an existing dangling `superseded_by` link (`FR-11`).
5. Reader states the current version and scope from this structural read alone.

**Observable outcome:** reader correctly states the current version and its scope without
reading full document prose.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Version-history row count doesn't match the count of `## Version N` headings in the body | Reported as an explicit structural inconsistency, the same way other `status.md` defects already are |
| Multiple artifacts sit on different versions at once | Reported as a normal, expected mixed state, never a failed operation |
| A `challenge` review predates the version concept | Reported unable to attribute to a specific version — never assumed current |
| Document read directly, no `/delivery:status` call | The same version boundary is visible from the header alone |
| A review's target document path no longer resolves (renamed/deleted) | Flagged the same way a dangling `superseded_by` reference is flagged today |

**Acceptance criteria**

- `FR-9` — `/delivery:status` reports current version, Status-cell value, and scope per
  artifact with a table, read structurally; a tableless artifact is reported as "Version 1
  (implicit, no table)," a distinct stated state.
- `FR-10` — Staleness compares against the current version's own start date, not the
  document's original creation date.
- `FR-11` — `challenge` reviews state which version of the target they reviewed; a target
  path that no longer resolves is flagged the same way a dangling `superseded_by` reference
  is flagged.
- `FR-12` — A governed artifact's header alone is sufficient to state its current version and
  scope, read from the table's Status column — independent of, and never required to match,
  the document's separate header `Status:` line.
- `FR-14` — A table's row count always equals the count of `## Version N` headings, in
  matching order; a mismatch is reported as an explicit inconsistency.

## Functional requirements

| ID | Requirement | Scenario | Priority | Grade |
| :-- | :-- | :-- | :-- | :-- |
| FR-1 | Closed-version scope mismatch opens a new Version row/heading; closed content, including a later-found error in it, is never edited in place | S-1 | must | reported |
| FR-2 | Same-problem test result + reasoning written into the document, not only chat | S-1 | must | reported |
| FR-3 | First-time version table creation retroactively labels all prior content; applies identically to pre-existing and newly created documents | S-1 | must | reported |
| FR-4 | Duplicate/concurrent new-version requests, same or across sessions, resolve to one row | S-1 | should | reported |
| FR-5 | Test result + reasoning written next to every in-open-version addition | S-2 | must | reported |
| FR-6 | Same-problem addition recorded as Revision, no new Version row; open version's Status cell stays freely editable | S-2 | must | reported |
| FR-7 | Operator's declared judgment overrides the test output; no-reaction defaults to the test's own output | S-2 | must | reported |
| FR-8 | Missing or unrecognized Status-cell value reports the test as unable-to-be-applied | S-2 | should | reported |
| FR-9 | `/delivery:status` reports version/status/scope per artifact from its table; tableless artifacts get a distinct stated state | S-3 | must | assumed |
| FR-10 | Staleness check keys off the current version's own start date | S-3 | must | assumed |
| FR-11 | `challenge` reviews state which version they targeted; a dangling target path is flagged | S-3 | must | assumed |
| FR-12 | Document header alone is sufficient to state current version and scope | S-3 | must | assumed |
| FR-13 | The seven producing skills' gate-check text offers revise/replace/start-new-version, identically worded | S-1 | must | reported |
| FR-14 | Version-history row count matches heading count, in order; mismatch is flagged | S-3 | must | assumed |
| FR-15 | A version-adding edit is verified, by diff, to add lines only — the mechanism's core "never rewritten" promise made checkable | S-1 | must | reported |
| FR-16 | Version numbers strictly increasing, no gaps or duplicates; a correction never renumbers | S-1 | should | reported |
| FR-17 | Scope cell is never blank | S-1 | should | reported |

## Non-functional requirements

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Version-history retention | A row is never deleted or edited once written; a correction adds a new row/note, the original stays visible | Inspect any correction event — the original row must still be present alongside it |
| NFR-2 | One-line Scope field length | ≤ 20 words / ≤ 140 characters per cell | Measure the Scope cell text on write |
| NFR-3 | Version count per document before reconsidering the MVP's lightweight approach | No hard limit; flag for reconsideration once any one document exceeds ~6 versions | Count rows in the table |
| NFR-4 | Status-cell vocabulary | Closed set: `in progress` \| `shipped` \| `shipped · debt open` \| `shipped · debt closed <ISO date>`; anything else triggers `FR-8`'s fallback | Compare the cell text against the set |
| NFR-5 | Date-cell format and semantics | ISO 8601 `YYYY-MM-DD`; records the version's opening date only — a closing date, if different, goes in the Status cell text | Parse the cell; matches `brief.md`'s existing real precedent |

## Assumptions

- That the Version-history table's Status column and the document's separate header
  `Status:` line remaining independent, unsynchronized fields causes no real confusion —
  untested against an actual drift case.
- That `NFR-3`'s ~6-version threshold is the right point to reconsider the lightweight
  table in favor of directories-of-units — reasoned from one document's two rows today, not
  measured at scale.
- That the seven producing skills' own gate-check prose (`FR-13`) is the right place to
  surface the third path, rather than a shared, referenced snippet — an implementation
  choice, not confirmed here.

## Terms proposed for glossary curation

Not yet written into `glossary.md` — routed to Business Analyst curation.

| Term | Definition | Referent |
| :-- | :-- | :-- |
| Version | A numbered, dated, retroactively-labelled chapter of a governed artifact's life, recorded in its own Version-history table | `brief.md`'s Version history table |
| Revise | Edit the current open version because new scope matches its own problem statement | `prd.md`'s `S-5` |
| Replace | Discard and rewrite a version's content — costly, breaks downstream citations | `glossary.md`'s citation risk |
| Start new version | Open a new version because new scope traces to a different problem statement | This section |
| Same-problem test | The one-sentence check distinguishing Revise from Start new version; the operator's declaration overrides its output | `S-1`/`S-2` |

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Can a document have more than one simultaneously "in progress" version, or must the current open version close before a new one starts? | solution-architect | `S-2`'s different-problem path when the current version is still open |
| 2 | Does a single skill's write to one document (row + heading) need file-write atomicity if interrupted mid-write, and how does `/delivery:status` technically aggregate each document's independent table into one summary view? | solution-architect | `FR-14`'s mismatch-detection mechanism; `FR-9`'s aggregation |
| 3 | What is the exact field/row syntax an append-only correction uses (a new row referencing the corrected one, or an inline note on the original)? | solution-architect | `NFR-1`'s implementation |

## Out of scope

- Restructuring the seven singular documents into directories-of-units.
- A heuristic that auto-infers "new version" versus "still this version" — the operator's
  declaration always governs.
- Multi-operator concurrent edits and OS-level permission failures.
- Naming a new persona for the operator's version-boundary objection.
