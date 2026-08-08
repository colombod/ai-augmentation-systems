<!--
BUDGET — target 120 words per finding, hard cap 200. Excludes code, YAML and data tables.
-->

# Sprint acceptance findings: sprint-2-parallel-fanin

> Independent review, not adversarial-challenge-artifact review. Findings recorded
> here are the "Carried debt" from `.delivery/sprints/2-parallel-fanin-review.md`,
> plus one process discrepancy. Panel: `delivery:qa-strategist`, `delivery:persona-simulator`,
> `delivery:feature-critic` · Reviewed: 2026-08-08 · Artifact version: `2690ed8`
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 0 | 3 | 5 | 0 |

**Independent convergence:** `delivery:feature-critic` reproduced the p5-01 race live, independently of the SDD ledger's own prior account of it (issue #15) — the strongest form of convergence available here, since the critic did not merely agree with a written claim but re-derived it from a fresh test run.

**Reviewer quality note:** all three reviewers (qa-strategist, persona-simulator, feature-critic) returned substantive, evidence-backed findings, not praise or style notes.

## Findings

### R-sprint2-1 — p5-01's "never a race that corrupts state" AC is not reliably true

**Status:** fixed
**Severity:** significant
**Raised by:** feature-critic — independently: yes (reproduced live, not from the ledger)

**The claim or omission:** p5-01's story states the acceptance test must show "no silent collision — either all succeed with distinct branches/paths, or a collision fails loudly … never a race that corrupts state." A concurrent-`createWorktree`-calls test run reproduced `fatal: failed to read .git/worktrees/.../commondir: Undefined error: 0` — git's own administrative state corrupted mid-race, not a clean refusal.

**Concrete failure scenario:** `node --test` on `test/worktree.test.ts`, ~1-in-15 to 1-in-25 runs, real concurrent `git worktree add` against one repo.

**What would resolve it:** retry-with-backoff on this error pattern, or a repo-scoped lock around `git worktree add` in `createWorktree`, before `p5-08`'s `max_parallel` branches makes this reachable in production.

**Resolution (2026-08-08, sprint 3 review):** this finding's own stated pre-condition ("before `p5-08`... makes this reachable in production") arrived and was caught by that sprint's own `feature-critic` review pass before acceptance — `ParallelHandler` ships concurrent, isolated worktree creation as its *default*, unconfigured behavior. Fixed in `src/run/worktree.ts` (`engine` commit `8a50506`): `createWorktree` now retries exactly this error pattern, bounded (4 attempts, short flat-scale backoff), switching from `-b` to `-B` on retry since inspection showed the failed attempt already creates the branch ref before crashing (a genuine name collision still fails loudly, unretried, on the first attempt only). Verified empirically, not merely reasoned: an amplified repro (30-way concurrency across 10 repos hammered at once) measured ~15% trial failure / ~0.6% per-call pre-fix, 0 failures across 6300+ calls post-fix. A permanent regression test at this same amplification ships in `test/worktree.test.ts`.

---

### R-sprint2-2 — the whole-branch review that caught this sprint's own CRITICAL bug is not a mandatory process step

**Status:** open
**Severity:** significant
**Raised by:** feature-critic

**The claim or omission:** a CRITICAL regression (phantom node in `RunResult.path` on step-cap termination) shipped through Task 5's own per-task review (APPROVE, 0 findings) and was only caught by a later, separate whole-branch pass. Nothing in the sprint's Verification Contract or Stop Conditions requires that pass.

**Concrete failure scenario:** a future sprint runs the same per-task loop, skips the whole-branch pass as optional, ships an equivalent cross-task regression undetected.

**What would resolve it:** add "final whole-branch adversarial review" as a standing, named step in the delivery process' own sprint template, not a one-off this run happened to include.

---

### R-sprint2-3 — Task 4's differential-fuzzing claims are not independently reproducible

**Status:** open
**Severity:** significant
**Raised by:** feature-critic

**The claim or omission:** ADR-007's rounds 5–6 cite ~240,000/60,000/40,000-graph differential fuzzing as the basis for confidence in `findConvergenceNode`/`findPartialReconvergence`. No fuzz harness, seed, or script is committed anywhere in the repo.

**Concrete failure scenario:** a future reviewer cannot re-run or extend this verification; the single largest evidentiary claim in the sprint rests entirely on prose self-report.

**What would resolve it:** commit a minimal, reproducible fuzz script under `test/` or `scripts/` — the discriminating counter-examples it found are already committed as regression tests; the generator itself is not.

---

### R-sprint2-4 — `architecture.md` is stale on the exact functions this sprint's hardest saga rewrote

**Status:** open
**Severity:** minor
**Raised by:** feature-critic

**The claim or omission:** `architecture.md` lines 378, 395–397 still show `findConvergenceNode`/`findPartialReconvergence`'s pre-amendment 2-arg/3-arg signatures; the shipped code has a 3rd/4th `fanOutNodeId` parameter, added and re-justified across ADR-007's 9th–11th amendments.

**Concrete failure scenario:** whoever picks up `p5-08` reads `architecture.md` as the contract, copies the stale signature, burns a review round rediscovering what this sprint already learned.

**What would resolve it:** re-pin `architecture.md`'s code blocks before `p5-08` planning starts.

---

### R-sprint2-5 — the sprint's own mandated report-back artifact was never produced

**Status:** open
**Severity:** minor
**Raised by:** feature-critic

**The claim or omission:** `2-parallel-fanin.md`'s "Required report-back" section specifies an exact table (Story/Outcome/Criteria met/Evidence/Commit) plus raw `node --test` output. No document matching that shape exists; `progress.md` is a narrative ledger with the same facts, not the contracted artifact.

**Concrete failure scenario:** acceptance gets formed by reading the narrative ledger instead of the artifact the process itself required, quietly lowering the bar the sprint set for itself.

**What would resolve it:** produce the report-back artifact as the sprint closes, starting next sprint — it was reconstructed for this review (see `2-parallel-fanin-review.md`'s criteria table) but should not need reconstructing.

---

### R-sprint2-6 — six ADR-007 fix rounds bypassed explicit Solution Architect sign-off

**Status:** open
**Severity:** minor
**Raised by:** feature-critic

**The claim or omission:** the sprint's own Stop Conditions state "design decisions belong to the Solution Architect. Do not redesign mid-run." Six fix-loop rounds correcting `findConvergenceNode`/`findPartialReconvergence`'s own algorithm were authored and self-verified by the SDD controller; the user authorized exceeding SDD's round cap, which is adjacent to but not the same as Solution Architect ratification of the shipped algorithm.

**Concrete failure scenario:** none observed yet — the ADR trail is unusually rigorous — but the gap between the stop condition's plain text and what happened is real and could recur silently on the next multi-round saga.

**What would resolve it:** explicit SA sign-off on the shipped algorithm before `p5-08` builds on it, or a process rule distinguishing bug-fixes-within-an-adopted-ADR from new architecture.

---

### R-sprint2-7 — issue #14's two `findConvergenceNode` gaps were only named via a linked GitHub issue

**Status:** open
**Severity:** minor
**Raised by:** feature-critic

**The claim or omission:** p5-04's AC ("PAR-001/002/004 fire correctly on hand-built fixtures") is honestly scoped, but two real, confirmed input shapes exist where `findConvergenceNode` selects a provably wrong node (always a loud refusal, never a silent hazard) — previously visible only via a linked issue, not named in any acceptance-facing document.

**Concrete failure scenario:** a reader of a "criteria met" verdict alone would not know these gaps exist.

**What would resolve it:** now named explicitly in `2-parallel-fanin-review.md`; close alongside `p5-08` or a dedicated follow-up.

---

### R-sprint2-8 — all 7 story files' "Implementation notes" sections are unfilled

**Status:** open
**Severity:** minor
**Raised by:** qa-strategist

**The claim or omission:** every story file's "## Implementation notes" section is still template placeholder text, despite substantial real deviations during implementation (e.g. p5-04 gaining a parameter across six rounds).

**Concrete failure scenario:** `p5-08` needs p5-04/p5-05's actual final shape as reference and won't find it in the story files themselves, only in `progress.md`/commit messages.

**What would resolve it:** backfill before `p5-08` planning starts.

## Assumptions worth watching

- The convergence-detection algorithm (`findConvergenceNode`/`findPartialReconvergence`) is now the foundation `p5-08` builds on, carrying 2 named-but-open gaps (R-sprint2-7) and resting on unreproducible fuzz-testing confidence (R-sprint2-3). If `p5-08` surfaces a THIRD gap, re-open the question of whether this algorithm needs a from-scratch redesign rather than another fix round.
- The `createWorktree` race (R-sprint2-1) was reproduced at low frequency in this environment; its true rate under `p5-08`'s real `max_parallel` concurrency (higher than this sprint's own 5-way stress test) is unverified and could be worse.
