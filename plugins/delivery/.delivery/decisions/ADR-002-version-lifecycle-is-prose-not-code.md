# ADR-002: Version-lifecycle mechanics are agent-judged prose, not code

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect

## Context

PRD Version 2 (`FR-20`–`FR-36`) needs the same-problem test, the Version-history
table/heading-count consistency check (`FR-33`), and staleness-by-version-date (`FR-29`)
evaluated correctly on every relevant skill run. This plugin ships zero runtime code for
any `.delivery/` document convention today, except the Version 1 invocation ledger
(`hooks/scripts/record-invocation.js`), which exists specifically because tool-call
history is the one signal an agent cannot narrate around (`ADR-001`) — a different problem
(detecting whether an action happened) from this one (comparing two pieces of prose, or
counting headings in a Markdown file small enough to read in full: `NFR-8` caps the volume
at roughly six version rows per document, across seven documents).

## Decision

Every version-lifecycle check — the same-problem test, the table/heading match, the
staleness date source, the Scope-cell length, the Status-cell vocabulary — is defined as a
checklist in `templates/version-history.md`, executed directly by the invoking skill's
agent reading the target document. This is the same shape `prioritize/SKILL.md`'s
evidence-only-marker check and `status/SKILL.md`'s `FR-n`-coverage check already use. No
script, hook, or MCP tool is introduced for this capability.

## Alternatives considered

### A parsing script that validates table/heading structure

**Why it was attractive:** deterministic — a broken table/heading pair would always be
caught, not only when an agent remembers to look.
**Why rejected:** the volume this ever needs to handle (`NFR-8`) is a read well inside
direct agent capability. A script becomes a second definition of "well-formed" that must
stay synced with the prose rule in `version-history.md` — the exact drift risk `ADR-003`
exists to avoid one layer down. It would also be the first `.delivery/`-convention script
in this plugin with no invocation-provenance problem to justify it; Version 1's ledger
exists because narration is otherwise undetectable, and that reason does not apply to
comparing two pieces of prose an agent already has open.

### A hook that blocks a reply until the same-problem test's output is stated

**Why it was attractive:** would make `FR-21`/`FR-24` ("result and reasoning written into
the document") structurally unskippable, not merely instructed.
**Why rejected:** Claude Code's hook surface fires on tool-call events (confirmed in
`research.md` and relied on by `ADR-001`), not on the content of an agent's chat reply —
there is no hook event to attach this to without inventing a new tool-call boundary around
ordinary conversation, a materially larger change than PRD Version 2 asked for.

## Consequences

**We gain:** zero new dependencies, zero new files that need testing as software, and a
mechanism that fails the same way (an agent skipping a step) every other `.delivery/`
convention already fails, rather than a new failure mode (a script silently miscounting).

**We accept:** the check only runs when the relevant skill actually runs — an agent that
narrates past the gate check narrates past this too, the same limitation Version 1's
Finding A already named for every prose convention in this plugin.

**We will need to revisit this if:** a document ever exceeds `NFR-8`'s ~6-version
threshold in practice, or `/delivery:status` is ever run non-interactively with no agent
reading the reply — either removes the "an agent is reading this" assumption this decision
rests on.
