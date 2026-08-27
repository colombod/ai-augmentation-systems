---
id: attractor-handoff-08
title: Widen the Outcome enum in sprint.md and sprint/SKILL.md
status: ready
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite
requirements: [FR-17]
depends_on: []
size: S
---

# Widen the Outcome enum in sprint.md and sprint/SKILL.md

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work.

## Goal

A story's report-back `Outcome` can be recorded as `non-convergent`, a fourth value,
everywhere `/delivery:sprint` states or restates that contract. Today only three values
exist (`done`, `blocked`, `not attempted`); a runner reporting an attractor-sourced
acceptance-gate exhaustion has no correct value to write.

## Context

`attractor-handoff` adds an `attractor` runner mode to `/delivery:handoff` that compiles
acceptance criteria into gate/fix loops with a bounded attempt count (`ADR-011`). A loop
that exhausts its bound without passing is neither `blocked` (external blocker) nor
`not attempted` nor `done` — the glossary names it precisely: **Non-convergent** — "A story
or criterion outcome: its gate/fix loop exhausted its declared attempt bound without
passing" (`.delivery/glossary.md`; code identifier `Outcome = non-convergent`; not "timed
out" — that is a different axis, attempt count vs. wall-clock, `NFR-2`).

`FR-17` (`prd.md` line 156) requires `Outcome ∈ {done, non-convergent, blocked, not
attempted}`. The enum is declared in exactly two places, both must widen together:

1. `templates/sprint.md` — the template every sprint scope package is written from; the
   literal table a runner fills in and returns.
2. `skills/sprint/SKILL.md` — restates the same enum in prose independently of the
   template, in its "Required report-back" step. Found during QA-strategist review of the
   architecture phase, not the original design pass — a second, easy-to-miss restatement.

Both are named in `architecture.md`'s Migration and rollback section (lines 128–139) as the
two edits this feature needs. This story is the roadmap's Phase 1 exit-bar item: *"A diff
shows `templates/sprint.md` and `skills/sprint/SKILL.md`'s enum both carrying the fourth
value."* It does not wire `non-convergent` into any consumer — see Out of scope.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/templates/sprint.md` | modify — line 93, Required report-back table's Outcome-column cell |
| `plugins/delivery/skills/sprint/SKILL.md` | modify — line 106, Required report-back bullet restating the same enum |

## Interfaces and contracts to honor

Verbatim from `architecture.md` lines 130–133:

**`templates/sprint.md` line 93**, inside the `## Required report-back` table:

```
Old: | | done / blocked / not attempted | n of m | test name or observed behavior | sha |
New: | | done / non-convergent / blocked / not attempted | n of m | test name or observed behavior | sha |
```

**`skills/sprint/SKILL.md` line 106**, inside step "6. Required report-back":

```
Old: - Per story: done / blocked / not attempted
New: - Per story: done / non-convergent / blocked / not attempted
```

Insert `non-convergent` in the second position at both sites — `done`, `non-convergent`,
`blocked`, `not attempted` — matching `FR-17`'s stated order. Do not reorder or alphabetize.

## Relevant design decisions

- **`FR-17`** — defines the four-value set. This story only makes the value representable
  in these two sites; the rollup logic (a `non-convergent` criterion flipping the story's
  Outcome, the `m`/`n` counting rule) is `compute-sprint-verdict.js`, a separate Phase 1/2
  item, and Phase 3's Report-back wiring.
- **Migration and rollback** (`architecture.md`) — verified zero blast radius on existing
  `superpowers`/`generic` sprint logs: no script under `hooks/scripts/*.js` parses this
  column, and `sprint-review/SKILL.md`'s procedure re-derives met/not-met from code rather
  than switching on the column's literal string (confirmed directly by reading that skill,
  not only cited). Rollback: revert both edits; a log already written with `non-convergent`
  needs no data transformation, it's a plain historical record.

## Acceptance criteria

- [ ] `FR-17` — `templates/sprint.md:93` reads
      `done / non-convergent / blocked / not attempted`.
- [ ] `FR-17` — `skills/sprint/SKILL.md:106` reads
      `- Per story: done / non-convergent / blocked / not attempted`.
- [ ] Both sites use identical order and separator style (` / `).
- [ ] No other file under `plugins/delivery/` independently restates the old **three**-value
      enum as a closed-set description of the Outcome contract. Repo-wide
      `grep -rn "not attempted" plugins/delivery --include="*.md"` returns exactly: the two
      edited lines (now four-valued), plus these confirmed non-sites, unchanged —
      `.delivery/reviews/attractor-handoff-02-prd.md` (historical finding record, quotes the
      old enum as evidence of a since-fixed defect); `architecture.md` and `prd.md`
      themselves (describe the change, not a live restatement); `.delivery/initiatives/
      harden/architecture.md:179` (unrelated: a spike that wasn't run); `skills/status/
      SKILL.md:124` (mentions "done, blocked" in passing, never enumerates `not attempted`,
      not a closed-set restatement); any `.delivery/stories/*.md` file (this one included)
      that already cites `FR-17`'s target four-value set including `non-convergent` — e.g.
      `attractor-handoff-05-oq10-drift-precheck-spike.md:57-59` — describes the target contract,
      not the stale one, and is not a defect. A grep hit asserting a closed **three**-value
      set as current, on a file not covered above, is a new finding — stop and report it, do
      not silently edit or skip it.

## Test approach

**Level:** none — documentation-only text change; no `node --test` suite covers prose, and
none should be added here. `FR-17`'s consumer wiring (Phase 3) is where behavioral tests
belong.

| Case | Expected |
| :-- | :-- |
| Before edit | grep shows both live sites at three values, four non-sites unchanged |
| After edit | grep shows both live sites at four values, non-sites still unchanged |
| Order/format | Edited lines match `architecture.md`'s Old/New diff byte-for-byte except the inserted value |
| No collateral edit | `git diff` touches exactly two files, one line each |

**Run with:**
```
grep -rn "not attempted" plugins/delivery --include="*.md"
```
Run before editing to capture the baseline and after to confirm only the two target lines
changed.

## Ship readiness

- [ ] Branch fetched and compared against real current `main` immediately before merge:
      `git fetch origin main && git log --oneline main..origin/main` (empty = current).
- [ ] Plugin version bumped if this project's convention requires one for a template/skill
      change (check actual history, don't assume).
- [ ] No runtime component to reload — static text edit, no fresh-session/hot-reload gap
      applies. State this plainly rather than leaving it unaddressed.

## Out of scope

- **Wiring `non-convergent` into any consumer** — this story makes the value representable
  only. Not touched: `compute-sprint-verdict.js`'s rollup (Phase 1/2 item); `skills/
  sprint-review/SKILL.md` (confirmed by direct reading it re-derives verdicts from code, not
  the column string — needs zero changes); any `attractor`-runner behavior (Phase 2/3).
- **`skills/handoff/SKILL.md`'s frontmatter/section edits** — a separate architecture-named
  change, not part of this story's two files.
- **Any real sprint log** — no `.delivery/sprints/*.md` file is created or edited; only the
  template and skill prose future logs are written from.

## Dependencies

None. Nothing in Phase 1 requires this story to land first or last relative to the others.

## Implementation notes

Filled in during and after implementation.
