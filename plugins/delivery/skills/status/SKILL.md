---
description: Report where a product effort stands across the whole pipeline — gates passed, open review findings, sprint state, and drift between documents. Use to orient at the start of a session or after time away. Read-only.
---

# Delivery status

Read-only. This skill reports and recommends; it changes nothing.

## Gather

Read whichever exist, and note which do not:

| Phase | Artifact |
| :-- | :-- |
| 1 Brief | `docs/product/brief.md` |
| 2 Research | `docs/product/research.md` |
| 3 Personas | `docs/product/personas/` |
| 4a Interviews | `docs/product/interviews/` |
| 4b Simulation | `docs/product/simulations/` |
| 5 PRD | `docs/product/prd.md` |
| 6 Prioritisation | `docs/product/prioritization.md` |
| 7 Design | `docs/product/design-system.md` |
| 8 Architecture | `docs/product/architecture.md`, `decisions/` |
| 9 Roadmap | `docs/product/roadmap.md` |
| 10 Stories | `docs/product/stories/` |
| 11 Sprints | `docs/product/sprints/` |
| — Reviews | `docs/product/reviews/` |

If none exist, say the pipeline has not started and point at `/delivery:brief`.

## Assess

**Gate status.** For each phase: not started, in progress, or complete — judged against
that phase's exit criteria, not merely on whether the file exists. A file that exists but
fails its exit criteria is **in progress**; saying otherwise gives false confidence, which
is the specific failure this skill exists to prevent.

**Open findings.** Read `docs/product/reviews/`. Report every finding still `open`,
blocking ones first, with the artifact they target. This is the highest-value section:
an adversarial review whose findings are ignored is worse than no review, and this is
what stops that happening. Findings marked `rejected` are fine — note the count, since
the stated reasons are the assumptions to revisit when something goes wrong.

**Evidence grounding.** Report the persona grounding mix (`observed` / `reported` /
`assumed`). If prioritisation and staging rest mostly on `assumed` personas, say so
here — it changes how every downstream decision should be read.

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
  edited after the architecture was written means the architecture may be stale

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
