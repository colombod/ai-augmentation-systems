# ADR-007: Version-lifecycle mechanics live in one shared reference file, not duplicated across seven skills

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect

## Context

`FR-13` requires all seven producing skills' gate checks to offer the identical three
choices (revise, replace, start new version), and `FR-1`/`2`/`5`/`7`/`15`/`16` define
mechanics — the same-problem test, the Corrections log, the diff check — that all seven
must apply consistently. The PRD (`initiatives/document-lifecycle-versioning/prd.md`)'s
own Assumptions list this exact question as unresolved: "whether the seven producing
skills' own gate-check prose is the right place to surface the third path, rather than a
shared, referenced snippet."

## Decision

A new file, `templates/version-history.md`, holds the table schema, the same-problem test
checklist, the three-choice wording, the Corrections-log schema, and `NFR-2`/`4`/`5`'s
hard rules once. Each of the seven skills' gate checks gains one line pointing at it, in
the same style every skill already uses for `templates/writing-standard.md` and
`.delivery/glossary.md`.

## Alternatives considered

### Duplicate the full mechanics prose in each of the seven `SKILL.md` gate checks

**Why it was attractive:** no new file; a reader of one skill sees the complete rule
without following a reference.
**Why rejected:** seven copies of the same checklist drift the first time any one of them
is edited without the other six — precisely the fragmentation the PRD's own Problem
section already documents for the pre-existing two-choice gate checks (`brief`, `research`,
`prd`, `architecture` each use "a different, undefined verb pair" today). Duplication would
reproduce the defect this capability exists to fix, one layer down.

### A machine-readable config (JSON/YAML) the seven skills all read

**Why it was attractive:** a single parseable source of truth, closer to how
`hooks/hooks.json` centralizes configuration for Version 1's ledger.
**Why rejected:** nothing downstream of this file parses it programmatically — every
consumer is an agent reading Markdown prose, the same as every other `.delivery/`
convention (`ADR-006`). A config format buys nothing here and adds a translation step
between the rule and the prose that states it.

## Consequences

**We gain:** one place to edit when `NFR-4`'s vocabulary, `NFR-2`'s length cap, or the
same-problem test's wording changes; the seven skills' gate checks stay one line long.

**We accept:** a reader of a single `SKILL.md` file in isolation does not see the full
mechanics without also opening `templates/version-history.md` — the same cost
`writing-standard.md`'s reference pattern already carries, not a new one.

**We will need to revisit this if:** a skill needs version-lifecycle behavior that
genuinely differs from the other six. None does today — `FR-13` requires identical wording
specifically to prevent this from happening quietly.
