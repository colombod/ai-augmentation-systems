# Context baseline — measured, not assumed (gy5.4)

> Evidence artifact for `context-management`. Measured 2026-08-27 from this machine's
> real session transcripts. Feeds prioritisation of any context-feature work; the brief's
> rule stands — no memory or compaction machinery ships without this file saying the
> problem exists.
>
> **Instruction-era tag (R-cm-10):** every transcript measured below ran under plugin
> ≤0.13.0 instructions — i.e. **before** gy5.5's context-engineering pass. Forward
> measurements run under 0.14.0+; never compare across the era boundary without saying
> so, and tag any future row with the plugin version it ran under.

## Compaction census

**One real compaction event in the project's entire pipeline history.** 34 main-session
transcripts scanned across the three delivery-plugin project directories; markers counted
were the harness's own `compact_boundary` / `isCompactSummary` records.

| Session | Span | Phases run | Compactions |
| :-- | :-- | :-- | :-- |
| `c7ba7f2d` (harden epic) | 08-04 → 08-07 | 13 skill invocations | **1** (2026-08-06 18:42, between realign and the evening challenge) |
| `5b97831e` (attractor-handoff, the blackout session) | 08-10 → 08-14 | 12 skill invocations, 44 agent dispatches | **0** |
| all 32 others | — | — | 0 |

**Caveat:** the census sees only marker-emitting compaction. A harness version that
summarizes context without writing `compact_boundary` is invisible to this count.

**Implication:** the brief's F-3 verdict holds with evidence now — compaction-loss
machinery is speculative. The instruction-level countermeasure shipped in gy5.5
(re-invoke a skill whose text is gone) is proportionate; anything heavier is not yet
justified. OQ-5 is answered: not zero, but one event in ~34 sessions.

## Phase token cost — session `5b97831e`, main loop only

Subagent usage lives in the subagents' own transcripts and is **not** counted here; these
are floors, not totals. `cache_read` shows how much context each phase re-reads.

| Phase | API calls | Output tokens | Cache reads (M tokens) |
| :-- | :-- | :-- | :-- |
| brief | 84 | 110,058 | 15.5 |
| challenge (brief) | 113 | 146,698 | 34.1 |
| research | 15 | 37,386 | 5.6 |
| personas | 43 | 28,118 | 16.9 |
| interview | 44 | 66,843 | 19.1 |
| simulate | 17 | 63,026 | 8.2 |
| prd | 33 | 63,399 | 16.8 |
| challenge (prd) | 159 | 166,629 | **100.1** |
| architecture | 102 | 118,407 | 77.3 |
| roadmap | 65 | 61,814 | 53.4 |
| stories | 37 | 161,259 | 33.4 |
| **12-phase total** | **767** | **~1.07M** | **~386** |

**Where the load actually is:** the two challenge panels and architecture — the phases
that re-read the whole artifact tree — account for over half the cache-read volume. This
matches the brief's F-4: prompts are small, artifacts and re-reads are the cost. Any
future optimisation targets the re-read pattern (digests for panel reviewers, bounded
status reads), not the skill prompts.

## Static sizes (from the brief, re-verified 2026-08-27)

`.delivery/`: 82 markdown files, 1.1 MB. Largest artifact 5,451 words
(`chief-of-staff/architecture.md`). Glossary 2,877 words, mandatory read for every role.
Largest SKILL.md 261 lines — every skill fits a per-skill post-compaction budget alone;
a 12-phase session's invoked-skill total exceeds the combined budget, which is why
gy5.5's re-invoke rule exists.

## Feature reachability (from the gy5.5 docs pass, live-verified 2026-08-27)

| Feature | Exists | Plugin-reachable surface | Status |
| :-- | :-- | :-- | :-- |
| Subagent context isolation | yes | agents/, Agent dispatch | in use (11 agents, panels) |
| Skill compaction budgets (per-skill + combined) | yes | SKILL.md size/ordering | exploited (gy5.5) |
| CLAUDE.md re-injection after compaction | yes | @AGENTS.md import | exploited (gy5.5) |
| Preloaded skills on agents (`skills:` frontmatter) | yes | agents/ frontmatter | available, unused |
| Agent persistent memory (`memory:` frontmatter) | yes | agents/ frontmatter | **deliberately unused** — bd-first decision |
| `PreCompact` hook / compaction-source signal | unverified in docs | — | out of scope until documented |
| API memory tool | yes (API) | none from plugin skills/hooks directly | out of scope |
| Context editing | yes (API) | none found for plugins | out of scope |

## Verdict

The measured problem is **observation and re-read volume, not context loss**. Priority
order this supports: ledger↔artifact-version binding (gy5.3), then panel/status re-read
bounding — compaction and memory machinery stay parked.
