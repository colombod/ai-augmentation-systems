---
description: Report where a product effort stands across the whole pipeline — which phase gates are passed, what is stale, what is inconsistent between documents, and what to do next. Use to orient at the start of a session or after time away. Read-only.
---

# Delivery status

Read-only. This skill reports and recommends; it changes nothing.

## Gather

Read whichever of these exist, and note which do not:

- `docs/product/brief.md`
- `docs/product/prd.md`
- `docs/product/architecture.md`
- `docs/product/roadmap.md`
- `docs/product/stories/` (all stories, with their frontmatter status)
- `docs/product/decisions/`

If none exist, say the pipeline has not started and point at `/delivery:brief`.

## Assess

**Gate status.** For each of the five phases report: not started, in progress, or complete. Judge completeness against the exit criteria in that phase's skill, not merely on whether the file exists. A file that exists but fails its exit criteria is in progress, and saying otherwise gives false confidence.

**Story progress.** Count by status — `draft`, `ready`, `in-progress`, `done`. Name any story stuck `in-progress`, which usually means an interrupted session.

**Roadmap position.** Which phase is active, what its exit criteria are, and how much of it is done.

**Consistency.** Documents drift apart between sessions, and the drift is where work falls through. Check specifically:
- `FR-n` in the PRD with no covering story
- Stories referencing requirement IDs that no longer exist in the PRD
- Roadmap phases whose sequence contradicts the architecture's dependencies
- Architecture decisions superseded by later ADRs but still cited in stories
- Documents whose git modification time is much older than the ones downstream of them — a PRD edited after the architecture was written means the architecture may be stale

**Open items.** Unresolved open questions, unaddressed blocking review findings, and spikes from the architecture that were never run.

## Report

Lead with a short summary: the active phase, and the one thing most worth doing next.

Then give the gate table, the story counts, and the consistency findings. Be accurate about what is incomplete — the value of this report is that it can be trusted when it says something is done.

Close with a specific recommended next command and why that one. If the pipeline is blocked on a decision only the user can make, say so plainly instead of recommending a command that would run into the same wall.
