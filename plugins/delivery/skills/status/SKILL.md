---
description: Report where a product effort stands across the whole pipeline — gates passed, open review findings, sprint state, and drift between documents. Use to orient at the start of a session or after time away. Read-only.
argument-hint: "[initiative-optional]"
---

# Delivery status

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.


Read-only. This skill reports and recommends; it changes nothing.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Which initiative — status reports across all of them, by design

Every planning artifact lives under `.delivery/initiatives/<slug>/`, one directory per
initiative, so independent initiatives can be planned in parallel branches without
colliding on the same shared file (`ADR-004`; the incident that motivated it: two
initiatives independently continued the same `S-n`/`FR-n` sequence in one shared `prd.md`,
discovered only at merge). **This skill is the one exception to "resolve to a single
initiative first"** every other skill follows — status's whole purpose is cross-initiative
visibility, so defaulting it to one initiative would defeat the reason it exists in exactly
the scenario `ADR-004` addresses:

1. **Default: report on every initiative.** List `.delivery/initiatives/*/` and gather each
   one's state (below) independently — a project with two initiatives gets two gate tables,
   clearly separated, not merged into one.
2. **Narrowed on request.** If the user names a specific initiative, report only that one.
3. **Zero initiatives** (a project still on the pre-`ADR-004` root-level layout, or genuinely
   nothing started) — say so plainly, same as today's "pipeline has not started" case.

Cross-cutting, project-wide, never per-initiative: `.delivery/glossary.md`,
`.delivery/personas/`, `.delivery/interviews/`, `.delivery/simulations/`,
`.delivery/decisions/ADR-NNN-*.md`, `.delivery/invocations/<session_id>.ndjson`.
`.delivery/stories/`, `.delivery/reviews/`, `.delivery/sprints/` stay flat but are prefixed
by initiative slug, matching `stories/<slug>-NN-<name>.md`'s existing convention.

**Computing the story index — replaces the old hand-maintained `stories/README.md`
(retired, `ADR-004`).** For each initiative, list its `stories/<slug>-NN-*.md` files and
build the ID/title/phase/requirements/status table live from each file's own frontmatter
(`templates/story.md`'s fields: `id`, `title`, `phase`, `requirements`, `status`,
`depends_on`) — never from a hand-maintained file, which is exactly what collided before.
Cross-check `requirements` against the initiative's own `prd.md` FR table the same way the
existing Consistency check already does for `FR-n` coverage.

## Gather

Read whichever exist, and note which do not:

| Phase | Artifact |
| :-- | :-- |
| 1 Brief | `.delivery/initiatives/<initiative>/brief.md` |
| 2 Research | `.delivery/initiatives/<initiative>/research.md` |
| 3 Personas | `.delivery/personas/` |
| 4a Interviews | `.delivery/interviews/` |
| 4b Simulation | `.delivery/simulations/` |
| 5 PRD | `.delivery/initiatives/<initiative>/prd.md` |
| 6 Prioritisation | `.delivery/initiatives/<initiative>/prioritization.md` |
| 7 Design | `.delivery/initiatives/<initiative>/design-system.md` |
| 8 Architecture | `.delivery/initiatives/<initiative>/architecture.md`, `decisions/` |
| 9 Roadmap | `.delivery/initiatives/<initiative>/roadmap.md` |
| 10 Stories | `.delivery/stories/` |
| 11 Sprints | `.delivery/sprints/` |
| — Reviews | `.delivery/reviews/` |
| — Glossary | `.delivery/glossary.md` |

If none exist, say the pipeline has not started and point at `/delivery:brief`.

## Assess

**Gate status.** For each phase: not started, in progress, or complete — judged against
that phase's exit criteria, not merely on whether the file exists. A file that exists but
fails its exit criteria is **in progress**; saying otherwise gives false confidence, which
is the specific failure this skill exists to prevent.

**Invocation status — was each governed artifact actually invoked, or only narrated?**
Read every `.delivery/invocations/*.ndjson` file (one per session; read all of them, this
project's full history, not just the current session's). For each governed artifact in the
Gather table above, report one of three states, as a distinct, scannable marker — never a
blank cell someone could mistake for "invoked" by skimming past it:

- **Invoked** — a ledger line exists recording a real tool call that produced this artifact.
- **Not-invoked** — the artifact's file exists (or was claimed as produced), but no matching
  ledger line exists anywhere in this project's invocation history. This is the state that
  catches narration standing in for a real step — report it even when the file itself looks
  complete and passes its own exit criteria; those are different questions.
- **Untraceable** — the check itself could not be made (no `.delivery/invocations/` directory
  exists at all for this project, e.g. because it predates this mechanism). State this
  explicitly, distinct from a confirmed **not-invoked** — one means "we looked and found
  nothing," the other means "we could not look."

**History is preserved, not overwritten.** An artifact once flagged not-invoked, later
re-produced by a real invocation, reports as **Invoked** now — but the report also notes
that an earlier gap existed and when it closed. A retried invocation (an error followed by
a real success for the same artifact) is not a contradiction; the most recent real outcome
is the state of record, and the retry itself is visible in the ledger, not hidden.

**Keep this scannable at scale.** A long project can accumulate many governed artifacts and
many sessions' worth of ledger files. Group or summarize (e.g. "12 of 14 artifacts invoked,
2 not-invoked — listed below" rather than one unreadable row per artifact per session) —
the point is a reader can tell the state at a glance, not that every raw ledger line is
reproduced in the report.

**Open findings.** Read `.delivery/reviews/`. Report every finding still `open`,
blocking ones first, with the artifact they target. This is the highest-value section:
an adversarial review whose findings are ignored is worse than no review, and this is
what stops that happening. Findings marked `rejected` are fine — note the count, since
the stated reasons are the assumptions to revisit when something goes wrong.

**Evidence grounding.** Report the persona grounding mix (`observed` / `reported` /
`assumed`). If prioritisation and staging rest mostly on `assumed` personas, say so
here — it changes how every downstream decision should be read.

**Story lifecycle.** Count by status including `superseded`. Report:

- Stories `superseded` with no `superseded_by`, or pointing at an ID that does not exist — a dangling link leaves a reader unable to tell stale from broken
- A `superseded_reason` that is missing or says only which story replaced it. The reason the design changed is the part worth keeping
- How often stories are superseded. Frequent supersession is not failure — it is a design being learned — but it belongs in the next sprint review's calibration rather than passing unnoticed

**Sprint state.** Current and past sprints: stories done, blocked, criteria met, last
acceptance verdict. Name any story stuck `in-progress` or any sprint left `running` —
that usually means an interrupted session.

**Consistency.** Documents drift apart between sessions, and the drift is where work
falls through. Check specifically:

- `FR-n` in the PRD covered by no story
- `FR-n` in no prioritisation stage — a silent scope drop
- Personas served by no stage
- Stories referencing requirement IDs no longer in the PRD
- Roadmap sequence contradicting architecture dependencies
- ADRs superseded but still cited in stories
- Hardcoded values where the design system defines a token
- Documents whose modification time is newer than the ones downstream of them — a PRD
  edited after the architecture was written means the architecture may be stale. For an
  artifact carrying a Version-history table, key this off its current-version Date cell
  instead of raw file mtime (per `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md`) —
  a file can be touched with no new version starting, which mtime alone can't tell apart
- A governed artifact's Version-history table row count doesn't match its `## Version N`
  heading count — the table and the document body disagree about how many versions exist

**Version boundaries.** For each governed artifact carrying a Version-history table (per
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md`), one row — no cross-document join:

| Artifact | Current version | Status | Scope | Table/heading check |
| :-- | :-- | :-- | :-- | :-- |
| brief.md | 2 | in progress | Document-lifecycle versioning... | OK (2/2) |

A tableless artifact reports "1 (implicit, no table)" rather than an empty row — it has
exactly one version, just not yet a table recording that. A Status cell outside the closed
vocabulary reports as unable-to-be-applied, not guessed. Six or more rows in one table is
flagged for reconsideration, not blocked.

**Language drift.** Read `.delivery/glossary.md`. Report: domain terms used in documents
that have no glossary entry; aliases the glossary bans that are still in use, and where; and
terms listed as undefined, which are open product decisions rather than vocabulary gaps. A
glossary nobody audits is a glossary that has already decayed.

**Open items.** Unresolved open questions, un-run spikes, and the research backlog —
questions simulation cannot settle that still need real people.

## Writing

Obey `${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md`, and the budget in the
template header. An artifact nobody finishes has failed, however correct it is.

Cut restatement, process narration and hedging before anything else. Never cut findings,
citations, grounding labels, open questions, or IDs a later phase reads — if it cannot fit
without losing those, go over the cap and say so in the document, with the reason.

## Report

Lead with a short summary: the active phase, and the one thing most worth doing next.

Then: the gate table, open findings, sprint state, and consistency findings. Be accurate
about what is incomplete — this report's only value is that it can be trusted when it
says something is done.

Close with a specific recommended next command and why that one. If the pipeline is
blocked on a decision only the originator can make, say so plainly instead of
recommending a command that would hit the same wall.
