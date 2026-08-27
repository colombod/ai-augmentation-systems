# Product brief: Context management — observe the observer, then measure before building

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-08-27

**Mode:** frame · **Word count:** 730 excluding tables (cap 900)

## Coverage

| Lens | Ran | Found material the others missed? |
| :-- | :-- | :-- |
| value | yes, isolated | yes — staleness propagation into copies, ledger's missing context-health fields |
| precision | yes, isolated | yes — blackout window falsified in part, multi-clone merge semantics, measured sizes |
| absence | yes, isolated | yes — memory-surface contradiction, glossary gaps, panel-isolation invariant |

**Findings by convergence:** 4 found by all 3 lenses · 7 by 2 · 4 by one only.
Every lens surfaced material the others missed — the space is **not exhausted**; a later pass (research, challenge) should expect new findings, not confirmation.

| ID | Finding (merged) | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| F-1 | Observer silence is undetectable by design: a dead or declining hook produces the same byte pattern as an idle session. Decline (`record-invocation.js:220`) writes nothing, and status's Untraceable state covers only a missing directory | 3 | live incident below |
| F-2 | The 08-10→08-14 blackout is undiagnosed: 17 commits of attractor-handoff Governed artifacts, zero ledger lines — yet the hook fired in that window for `plugins/attractor` (24 lines), so "hook globally broken" is falsified. Hypotheses: ambiguous-cwd decline; plugin not loaded; artifacts written without governed calls; ledger lost in another checkout | 3 | commit dates verified; both ledgers read |
| F-3 | Compaction and context loss are unmodeled and unevidenced: zero mentions across skills/agents/templates/`.delivery`, no documented incident, nothing that could even detect one | 3 | grep verified |
| F-4 | No context baseline exists. Measured: prompts are small (largest SKILL.md 2,330 words), the load is artifacts (82 files, 1.1 MB; largest 5,451 words) plus status's unbounded "read every ledger" rule. Challenge-panel reviewer isolation is a hard invariant any sharing design must not cross | 3 | sizes verified |
| F-5 | Status's read cost grows monotonically with project age | 2 | `skills/status/SKILL.md` |
| F-6 | Ledger records calls, not artifacts or initiatives: with 4 initiatives live, initiative A's real `delivery:prd` line lets initiative B's Narrated prd.md pass as Invoked; one future re-run silently heals past gaps | 2 | ledger schema verified |
| F-7 | Three memory surfaces already exist, contradictory: repo CLAUDE.md mandates `bd remember` and forbids MEMORY.md; Claude Code auto-memory maintains MEMORY.md for this project; `.delivery/` is the plugin's declared persistence. No precedence rule | 2 | CLAUDE.md read |
| F-8 | Ownership unresolved: the failed observer was built and marked complete by `harden`; its field failure is realign input for harden, not automatically this initiative's scope | 2 | harden roadmap |
| F-9 | Each seed feature has different epistemic status: subagent isolation observed; compaction observed but plugin-reachable controls unverified; "memory tool" names three different things; context editing not known to be plugin-reachable at all | 2 | unverified — spike |
| F-10 | Installed-hook vs repo version skew has no owner or record; hook firing reliability self-declares "re-verify after any Claude Code upgrade" and was never re-verified | 2 | `record-invocation.js` header |
| F-11 | Session-boundary state has never been enumerated; sprint interruption is inferred heuristically | 2 | status skill |
| F-12 | Stale citations propagate downstream and get corrected in story copies while sources stay wrong | 1 | attractor-handoff notes.md |
| F-13 | Multi-clone, git-tracked, append-only ledgers have undefined merge semantics | 1 | cross-clone lines verified |
| F-14 | No glossary terms for context/memory/compaction; "Session" is deliberately excluded but would become a product concept | 1 | glossary |
| F-15 | Ledger captures no context state (compaction, resume), so future Narrated-style incidents can't be diagnosed from records | 1 | ledger schema |

## Problem

The plugin's provenance mechanism — its answer to its own founding incident, an agent Narrating work it never Invoked — fails silently, and its silence is indistinguishable from idleness. Verified live during this brief: this session's `delivery:status` invocation was declined at an ambiguous cwd and left no trace, while the same session's later calls from `plugins/delivery` were recorded. The decline branch also has a bootstrap dead-end: its tiebreaker requires a session ledger file that the decline itself prevents from existing (`record-invocation.js:208-220`), so a repo-root session is permanently unobserved. Separately, the pipeline has no model of harness context behavior — compaction, memory, session boundaries — but also no evidence that context loss has ever cost it anything: the harness opportunity is real, the incident is missing, and nothing measures either.

## Who has it

The operator — one person, running multi-day, multi-session pipelines. Secondarily: later-phase agents and story implementers who inherit Untraceable or stale artifacts, and `/delivery:sprint-review`, which certifies against records this initiative shows can be silently absent.

## Cost of the status quo

An entire initiative (attractor-handoff: brief through 8 stories, 17 commits) reports Untraceable; gap-to-detection was 14+ days, found incidentally. Workaround observed: none existed — nobody noticed. Staleness workaround observed: story writers correct citations in their own copies (F-12), the compressed requirement being "downstream needs a way to flag upstream." Status's orientation read grows without bound (F-5), against a 1.1 MB and growing tree.

## What changes if we solve it

The operator can trust silence: an unobserved governed call becomes a visible, dated state in `/delivery:status`, same-session. Provenance claims bind to the initiative and artifact they belong to. And any future context-feature work starts from a measured baseline, not an assumed one.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Gap-to-detection of observation failure | ledger + status report | 14+ days (blackout); ∞ for declines | same session |
| Governed calls leaving a record (line **or** explicit decline) | ledger vs session transcript | unknown — declines invisible | 100% |
| Status distinguishes "observer silent/declined" from Narrated | status output | no such state | reported per artifact |
| Cross-initiative Invoked false positives | ledger↔artifact linkage audit | possible by design (F-6) | 0 |
| Context baseline for one full phase | token totals + compaction count from transcripts | never measured | measured, written down |
| Blackout root cause | diagnosis spike verdict | 4 open hypotheses | 1, evidenced |

The last two cannot be measured with data collected today — producing that data is itself MVP scope.

## MVP boundary

Tracked as beads under epic `ai-augmentation-systems-gy5` (operator decision: bd is the task/working-memory surface).

1. **Diagnose the blackout** (spike, `gy5.1`): discriminate F-2's hypotheses against session transcripts; the live decline incident already supports the ambiguous-cwd one.
2. **Make silence visible** (`gy5.2`): declines and liveness recorded somewhere status can read; fix the bootstrap dead-end; status gains the third state.
3. **Bind ledger lines to initiative + artifact version** (`gy5.3`): per-artifact-**version** provenance — operator decision 2026-08-27 — tied to an ADR-005 version marker or content hash (closes F-6, including silent healing).
4. **Measure the context baseline** (`gy5.4`): one full phase's token cost, compaction events across historical pipeline transcripts, per-feature plugin-reachability table (F-9 spike).
5. **Context-engineering pass over instructions** (`gy5.5`, operator-directed 2026-08-27): apply current Anthropic context-engineering guidance to `skills/*/SKILL.md`, `agents/*.md`, and `AGENTS.md`, grounded in a live-docs research pass, with the panel-isolation invariant held.

Items 1–4 keep the measurement-first boundary; item 5 is an explicit operator override of it for instruction files only — no memory or compaction *machinery* ships in the MVP.

## Explicitly out of scope

- Context editing integration (not known to be plugin-reachable; F-9 spike gates any future scope)
- Memory-tool integration and any fourth memory surface (OQ-2 resolved: bd-first, auto-memory fallback — no new surface gets built)
- Any change to challenge-panel reviewer isolation — named invariant, not a tuning knob
- Attractor plugin internals (standing scope discipline)
- Status read-cost optimization (F-5) — real, but staged after the baseline exists
- Fixing stale-citation propagation (F-12) — recorded for prioritization, single-lens

## Current-state workflow

Operator opens a session, runs `/delivery:status`, which re-reads the artifact tree and all ledgers. Governed calls are recorded only when cwd resolution succeeds; failures and declines vanish. Between sessions, only artifact files carry state; on resume the operator re-reads or re-derives. Nothing observes compaction, version skew, or the hook's own health.

## Open questions

| # | Question | Owner | Status |
| :-- | :-- | :-- | :-- |
| 1 | Does the observation fix live here or under `harden`'s lineage? | operator | **Resolved 2026-08-27: fixed here.** Harden's realign carries an addendum recording the field failure so its calibration record stops overstating |
| 2 | Memory-surface precedence? | operator | **Resolved 2026-08-27: bd (beads) is primary for task tracking, creation and working memory; Claude Code auto-memory only if bd is unavailable.** `.delivery/` remains the artifact store — it is not a memory surface. bd database initialized this session |
| 3 | Provenance per-artifact-version or per-artifact? | operator | **Resolved 2026-08-27: per-artifact-version** (`gy5.3`) |
| 4 | Which context features are plugin-reachable (hooks/skills/agent frontmatter), verified against current docs? | solution-architect spike (`gy5.4`) | open — blocks post-MVP feature scope; research pass in flight also feeds `gy5.5` |
| 5 | Do historical pipeline transcripts show any compaction event at all? If zero, the compaction workstream stays speculative | qa-strategist spike (`gy5.4`) | open — blocks post-MVP staging |

**Glossary proposals** (via `/delivery:glossary`, not silently): *Observer silence* (governed call left no record — dead hook, decline, or lost ledger; distinct from Narrated), *Memory surface* (any store an agent may read/write across sessions), *Compaction* (harness-side context summarization), and a formal revisit of the excluded term *Session*.
