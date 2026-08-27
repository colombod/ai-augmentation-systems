# Product brief: Context management — observe the observer, then measure before building

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: agreed · Last updated: 2026-08-27 (revision 2, post-challenge)
> Version history: r1 written pre-diagnosis (`198545e`, OQs resolved `7fa20ae`); r2 this
> revision, applying `.delivery/reviews/context-management-01-brief.md` (R-cm-1..11).
> The findings table below is the r1 evidence record and is deliberately unrevised.

**Mode:** frame · **Word count:** 1,037 excluding tables and quote blocks (cap 900) — declared overrun: r2 carries the post-challenge state (execution mode, per-item resolutions, dispositions), and findings, dispositions and IDs are kept over budget per template rule.

**Execution mode (recorded per R-cm-9):** spike-mode initiative under the operator's
park-over-polish bias — implementation proceeds from this brief plus beads (epic
`ai-augmentation-systems-gy5`), design decisions land as ADRs rather than a full
architecture phase, and `.delivery/reviews/context-management-01-brief.md` is the
challenge gate of record for this brief.

## Coverage

| Lens | Ran | Found material the others missed? |
| :-- | :-- | :-- |
| value | yes, isolated | yes — staleness propagation into copies, ledger's missing context-health fields |
| precision | yes, isolated | yes — blackout window falsified in part, multi-clone merge semantics, measured sizes |
| absence | yes, isolated | yes — memory-surface contradiction, glossary gaps, panel-isolation invariant |

**Findings by convergence:** 4 found by all 3 lenses · 7 by 2 · 4 by one only.
Every lens surfaced material the others missed — the space is **not exhausted**; the
post-write challenge (R-cm-1..11) confirmed this by finding more.

| ID | Finding (merged, as found at r1 — see per-item dispositions after the table) | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| F-1 | Observer silence was undetectable by design: a dead or declining hook produced the same byte pattern as an idle session; the decline branch wrote nothing and status's Untraceable state covered only a missing directory | 3 | live incident, 2026-08-27 |
| F-2 | The 08-10→08-14 blackout was then-undiagnosed: 17 commits of attractor-handoff Governed artifacts, zero ledger lines — yet the hook fired in that window for `plugins/attractor` (24 lines), falsifying "hook globally broken" | 3 | commit dates verified; both ledgers read |
| F-3 | Compaction and context loss are unmodeled and unevidenced: zero mentions across skills/agents/templates/`.delivery`, no documented incident, nothing that could detect one | 3 | grep verified; baseline.md census |
| F-4 | No context baseline existed. Measured: prompts are small (largest SKILL.md 2,330 words at r1), the load is artifacts (82 files at r1, 86 at r2; 1.1 MB) plus status's unbounded read rule. Challenge-panel reviewer isolation is a hard invariant any sharing design must not cross | 3 | sizes verified |
| F-5 | Status's read cost grows monotonically with project age | 2 | `skills/status/SKILL.md` |
| F-6 | Ledger records calls, not artifacts or initiatives: initiative A's real `delivery:prd` line lets initiative B's Narrated prd.md pass as Invoked; a future re-run silently heals past gaps | 2 | ledger schema verified |
| F-7 | Three memory surfaces exist, contradictory: repo CLAUDE.md mandates `bd remember` and forbids MEMORY.md; Claude Code auto-memory maintains MEMORY.md; `.delivery/` is the plugin's declared persistence. No precedence rule | 2 | CLAUDE.md read |
| F-8 | Ownership unresolved: the failed observer was built and marked complete by `harden` | 2 | harden roadmap |
| F-9 | Each seed feature has different epistemic status; context editing not known to be plugin-reachable at all | 2 | baseline.md reachability table |
| F-10 | Installed-hook vs repo version skew has no owner; hook firing reliability self-declares "re-verify after any Claude Code upgrade" and was never re-verified | 2 | `record-invocation.js` header |
| F-11 | Session-boundary state has never been enumerated; sprint interruption is inferred heuristically | 2 | status skill |
| F-12 | Stale citations propagate downstream and get corrected in story copies while sources stay wrong | 1 | attractor-handoff notes.md |
| F-13 | Multi-clone, git-tracked, append-only ledgers have undefined merge semantics | 1 | cross-clone lines verified |
| F-14 | No glossary terms for context/memory/compaction; "Session" is deliberately excluded but would become a product concept | 1 | glossary |
| F-15 | Ledger captures no context state (compaction, resume), so future Narrated-style incidents can't be diagnosed from records | 1 | ledger schema |

**Dispositions of previously unstaged findings (R-cm-4, R-cm-11):** F-10 → owned by the
liveness bead (see MVP 2b). F-11 → out of scope this initiative; revisit at the next
initiative touching session state; no carrier is currently missing a critical fact that
`.delivery/` + bd do not hold. F-13 → named design constraint on `gy5.3`, with a union
merge driver for `invocations/*.ndjson` shipped now as mitigation (`.gitattributes`).
F-15 → decided at `gy5.3` design time, since it touches the same schema — one migration,
not two.

## Problem

At r1: the plugin's provenance mechanism — its answer to its founding incident, an agent
Narrating work it never Invoked — failed silently, and its silence was indistinguishable
from idleness. Verified live during the r1 write: this session's `delivery:status`
invocation was declined at an ambiguous cwd and left no trace. The decline branch also
had a bootstrap dead-end (then `record-invocation.js:208-220`): its tiebreaker required a
session ledger file the decline itself prevented, so a repo-root session was permanently
unobserved.

**State at r2:** the decline class is fixed and shipped (`29b0129`): ambiguous calls are
recorded to every candidate ledger as `Ambiguously observed`; the dead-end is gone; the
blackout is root-caused (gy5.1: session `5b97831e` ran the entire attractor-handoff
pipeline from ambiguous cwds — those artifacts are **Invoked-but-unledgered, not
Narrated**). What remains open: dead-hook silence (a hook that never fires still looks
like idleness — MVP 2b), zero-candidate cwds (bead `vox`), and provenance binding
(`gy5.3`). The harness-opportunity half stays parked: the measured baseline
(`baseline.md`) found one compaction event in the project's entire history.

## Who has it

The operator — one person, running multi-day, multi-session pipelines. Secondarily:
later-phase agents and story implementers who inherit unattributed or stale artifacts,
and `/delivery:sprint-review`, which certifies against records this initiative showed can
be silently absent.

## Cost of the status quo (as measured at r1, 2026-08-27, pre-fix)

An entire initiative (attractor-handoff: brief through 8 stories, 17 commits) reported
**Not-invoked** — the state whose gloss is "narration standing in for a real step" — a
false implication, as gy5.1 later proved; the exoneration mechanism is a `gy5.3` design
input (R-cm-8). Gap-to-detection was 14+ days, found incidentally. No workaround existed:
nobody noticed. Staleness workaround observed: story writers correct citations in their
own copies (F-12) — the compressed requirement being "downstream needs a way to flag
upstream." Status's orientation read grows without bound (F-5) against a 1.1 MB tree.

## What changes if we solve it

The operator can trust silence: an unobserved governed call becomes a visible, dated
state, detectable same-session via `/delivery:status`. Provenance claims bind to the
initiative, artifact and version they belong to. Context-feature work starts from a
measured baseline, not an assumed one.

## Success signals

| Signal | How measured | At r1 (2026-08-27 pre-fix) | At r2 | Target |
| :-- | :-- | :-- | :-- | :-- |
| Gap-to-detection of observation failure | ledger + status run | 14+ days; ∞ for declines | declines recorded same-call | detectable same-session via status |
| Governed calls leaving a record (line or ambiguous record), **for sessions with ≥1 reachable `.delivery/`** — zero-candidate cwds are the accepted residual (bead `vox`); dead-hook silence excluded until MVP 2b ships | ledger vs session transcript, deduplicated by `tool_use_id` (one call = one identity across N candidate ledgers) | unknown — declines invisible | decline class: 100% by construction; unaudited | 100%, audited |
| Status distinguishes ambiguous observation from Narrated | status output | no such state | fourth state shipped | shipped |
| Cross-initiative Invoked false positives | ledger↔artifact-version audit | possible by design (F-6) | possible until `gy5.3` | 0 |
| Context baseline exists | `baseline.md` | never measured | measured, era-tagged | done |
| Blackout root cause | diagnosis spike | 4 open hypotheses | 1, evidenced (gy5.1) | done |

## MVP boundary

Tracked as beads under epic `ai-augmentation-systems-gy5`.

1. **Diagnose the blackout** (`gy5.1`) — **done**: ambiguous-cwd decline confirmed; three hypotheses eliminated.
2. **Make decline-silence visible** (`gy5.2`) — **done**: ambiguous records to every candidate, tiebreaker on attributed lines, status fourth state, glossary term. Shipped for the **decline class only**.
   2b. **Liveness** (new bead): dead-hook silence — the hook not firing at all — is still invisible; ships a transcript-vs-ledger audit or heartbeat, and owns F-10's re-verify-after-upgrade obligation.
3. **Bind ledger lines to initiative + artifact version** (`gy5.3`, open): per-artifact-**version** provenance (operator decision 2026-08-27). Version unit decided per R-cm-2: **content hash at ledger-write time** for artifacts without a version marker (ADR-005 is `proposed`, cited as input only); edit-after-invocation semantics, backfill/exoneration of the blackout artifacts, `tool_use_id` as cross-ledger call identity, and F-13 merge semantics are the four named design inputs; lands as an ADR.
4. **Measure the context baseline** (`gy5.4`) — **done**: `baseline.md`, era-tagged (R-cm-10).
5. **Context-engineering pass over instructions** (`gy5.5`) — **done** (`f15a61f`), recorded operator override of measurement-first for instruction files only.

## Explicitly out of scope

- Context editing integration (not plugin-reachable; `baseline.md` reachability table)
- Memory-tool integration and any fourth memory surface (OQ-2: bd-first — a stated operator **convention**, checkable only by review, not an enforced mechanism; auto-memory remains harness behavior the plugin cannot gate)
- Any change to challenge-panel reviewer isolation — named invariant, not a tuning knob
- Attractor plugin internals — with one recorded, narrow exception: ambiguous-cwd records land in every candidate ledger, including attractor's (`ADR-014`)
- Status read-cost optimisation (F-5) — staged after `gy5.3`
- Fixing stale-citation propagation (F-12) — recorded for prioritisation
- Session-boundary state enumeration (F-11) — revisit at the next initiative touching session state
- Dropped-skill detection (the combined post-compaction skill budget): guidance shipped in gy5.5; a detector is not justified by the baseline's one-compaction census — reopen if the census ever shows drops

## Current-state workflow (r2)

Operator opens a session, runs `/delivery:status`, which re-reads the artifact tree and
all ledgers. Governed calls are recorded when resolution succeeds and recorded-as-ambiguous
when it cannot choose between candidates; zero-candidate cwds and dead hooks remain
silent (bead `vox`; MVP 2b). Between sessions, state carries in artifact files and bd
(synced via `bd dolt push` at session close — adopted this session per R-cm-3; a failed
push is reported, never silent). Nothing yet observes version skew or hook health.

## Open questions

| # | Question | Owner | Status |
| :-- | :-- | :-- | :-- |
| 1 | Observation fix ownership | operator | **Resolved 2026-08-27: fixed here.** Harden's realign carries the addendum |
| 2 | Memory-surface precedence | operator | **Resolved 2026-08-27: bd-first; auto-memory only if bd unavailable.** A convention, not a mechanism — see out-of-scope. bd sync obligation adopted (R-cm-3) |
| 3 | Provenance granularity | operator | **Resolved 2026-08-27: per-artifact-version** — version unit and legacy rule fixed per R-cm-2; residual semantics are `gy5.3` design inputs |
| 4 | Which context features are plugin-reachable | resolved | **Answered in `baseline.md`** (reachability table, live-verified) |
| 5 | Do transcripts show compaction at all | resolved | **Answered in `baseline.md`**: one event in 34 sessions |
| 6 | Edit-after-invocation: what does a post-invocation edit do to an artifact's provenance state? | solution-architect, at `gy5.3` design | open |

**Glossary status (R-cm-11):** `Ambiguously observed` adopted (r1's proposed "observer
silence" was superseded and is now a banned alias — this revision uses the adopted term).
`Memory surface` and `Compaction` added to the glossary this revision; the `Session`
exclusion revisit is recorded in its curation log as deferred with F-11.
