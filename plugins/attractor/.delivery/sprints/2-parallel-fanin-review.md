<!--
BUDGET — target 600 words, hard cap 1000 words. Excludes code, YAML and data tables.
-->

# Sprint 2 acceptance review

> Independent re-check. The sprint reported its own results; this verifies them
> **against the code as it now exists**. Where the log and the code disagree, the
> code wins — and the discrepancy is itself a finding.

**Sprint:** 2 (parallel-fanin) · **Reviewed:** 2026-08-08 · **Branch / SHA:** `worktree-attractor-parallel-fanin` @ `2690ed8`

## Verdict

**Accepted with debt**

**Because:** all 7 in-scope stories' acceptance criteria are independently confirmed met against the running code, the suite is green, and `Handler.PARALLEL`/`p5-08` is genuinely, verifiably out of scope — no creep, no false sense that FR-17b itself shipped. But p5-01's own criterion ("never a race that corrupts state") is not reliably true: independent re-verification reproduced the exact git-level race its own acceptance test exists to rule out. That is a currently-unmet criterion inside this sprint's own scope, not a deferred p5-08 concern, and it is carried forward as debt rather than blocking acceptance, because it is rare (not every run), already root-caused, already tracked (issue #15), and unreachable by any production path today (`HAND-001` still refuses every `Handler.PARALLEL` node unconditionally). Five further debts — a review step that caught the sprint's own critical bug but isn't yet a mandatory part of the process, unreproducible fuzz-testing claims, a stale architecture doc, an un-produced report-back artifact, and a Solution-Architect sign-off gap on the algorithm six fix-rounds rewrote — are named below rather than left implicit.

## Acceptance criteria — verified independently

| FR | Criterion | Met | Evidence | Log agreed? |
| :-- | :-- | :-- | :-- | :-- |
| p5-01 | `worktree.ts` fully async; siblings don't block; `GatedBackend` exists; **no race that corrupts state** | partial | Async conversion and non-blocking behavior confirmed (`worktree.ts:29`, mutation-checked test). Race clause: reproduced live — `fatal: failed to read .git/worktrees/.../commondir` on one of several runs, not a clean refusal | yes on async/non-blocking; **no** on the race clause (log calls it "documented, not fixed," not "unmet AC") |
| p5-02 | `executeNodeStep` sole per-node step impl; zero behavior change | met | `engine.ts:656`; checkpoint calls confined to `run()`'s own terminal paths; full suite green | yes |
| p5-03 | `Backend.run()` gains `cwd`; `BoxHandler` passes it; shorter callers unaffected | met | `types.ts:84`, `claude.ts:116`, `box.ts:102`; 3 named tests | yes |
| p5-04 | `findConvergenceNode`/`findPartialReconvergence` exported; PAR-001/002/004 fire correctly on fixtures | met (scope-limited) | Exported with a 3rd `fanOutNodeId` param added across 6 fix rounds; behavior on tested fixtures correct. 2 narrow, safe-direction-only gaps remain, tracked (issue #14) | yes |
| p5-05 | `runBranch` seam; shared ledgers; EXIT = ordinary dead end; shared `stepCount` | met | `engine.ts:876`; mutation-checked tests for EXIT-as-deadend and step-cap sharing | yes |
| p5-06 | PAR-005 warns on early-EXIT branch; never blocks the run | met | `lint.ts:628`; integration test confirms advisory-only | yes |
| p5-07 | Branch context merges back in declaration order; exact F1 repro; PAR-003 | met | `parallel.ts:52`; F1 repro asserts `'r3'` wins with exactly 2 collision events | yes |

Full criteria text is in each story file under `.delivery/stories/`; the table above summarizes.

## Test suite

**Command:** `cd plugins/attractor/engine && node --test`
**Actual output (representative run):**
```
ℹ tests 584
ℹ pass 583
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```
**Was green at sprint close, red now:** No — but not reliably green either. Independent re-verification (this review) reproduced a real failure in `test/worktree.test.ts`'s concurrent-creation test on a separate run, matching the git-level race named above. Both states are real; the suite is flaky in one specific, isolated, already-diagnosed spot, not broadly red.

## Design system conformance

N/A — CLI/engine plugin, no UI surface (confirmed: no `design-system.md` exists).

## Persona journeys

> ⚠ Simulated output. Persona walked the now-real implementation.

| Persona | Journey | Completes end to end? | Blocked at |
| :-- | :-- | :-- | :-- |
| P-2, The Operator | Run a `component`-shaped (parallel fan-out) pipeline | No — expected, correctly scoped | `HAND-001` (ERROR), naming the exact unregistered handler kind and the mid-pipeline abort it prevents |

Not a "delivered nothing usable" case: this sprint was never scoped to let this journey complete. What it *does* usefully deliver today — confirmed by the walk, not assumed — is honest pre-execution feedback on a `component` node's shape: PAR-001/002/003 all fired correctly on deliberately-flawed fixtures, co-firing with `HAND-001` rather than being hidden by it. The refusal itself is loud and specific, not the silent/late failure this persona's own abandonment condition names.

## Stage promise vs. delivered

| Promised | Delivered | Gap |
| :-- | :-- | :-- |
| Phase 5 / FR-17b: `Handler.PARALLEL` fan-out, worktree isolation, fail-closed join, context merge-back | Every *prerequisite* FR-17b needs (async worktree layer, shared dispatch primitive, convergence detection + 4 lint rules, `runBranch` seam, deterministic merge-back) | `Handler.PARALLEL`/`ParallelHandler` itself (`p5-08`) — explicit, named, pre-agreed exclusion, not a silent drop |

**Silent scope drops:** none. The sprint's own scope package names the p5-08 split explicitly before work started.

## What the wave taught

**Stories that were wrong:** none needed rewriting; p5-04's story undercounted `findConvergenceNode`'s eventual signature by one parameter, discovered only through six fix-loop rounds — not a story defect, a genuinely hard algorithm.

**Estimates that were wrong:** p5-04 (sized `M`) needed 6 fix-loop rounds and 11 ADR amendments before landing clean — badly undersized for "cycle-aware reachability under an adversarial-fixture review," which is closer to `L`/`XL` in practice. Recalibrate `p5-08`'s own estimate accordingly; it inherits this exact algorithm as its foundation.

**Assumptions invalidated:** none in PRD/personas. One in practice, not yet in any doc: `architecture.md`'s own code excerpts for `findConvergenceNode`/`findPartialReconvergence` (lines 378, 395–397) still show the pre-amendment signatures — stale against the shipped 3-arg/4-arg forms.

**Simulation calibration:** the Operator walk predicted a clean, informative refusal; the real CLI matched that prediction closely, including surfacing PAR-003/001/002 unprompted. No material surprise either direction this round.

## Carried debt

| ID | Debt | Why accepted | Repay by |
| :-- | :-- | :-- | :-- |
| D-1 | p5-01's own "never a race that corrupts state" AC is not reliably true — a real git-level race in `createWorktree` under concurrent worktree creation (~1-in-15 to 1-in-25) | Rare, root-caused, tracked (issue #15), unreachable by any pipeline that can run today | Fix (retry-with-backoff or a repo-scoped lock) before `p5-08`'s `max_parallel` branches makes this reachable in production |
| D-2 | The whole-branch adversarial review that caught this sprint's own CRITICAL cross-task regression (a phantom node in `RunResult.path` on step-cap termination, shipped through Task 5's own per-task review) is not yet a mandatory, named step in this project's sprint process | It happened this time by discipline; nothing in the Verification Contract or Stop Conditions requires it next time | Add "final whole-branch adversarial review" as a standing step in the delivery process' own sprint template |
| D-3 | Task 4's own heaviest confidence claims (~240k/60k/40k-graph differential fuzzing) rest on prose self-report with no committed, re-runnable fuzz harness or seed | Individual counter-examples the fuzzing found are committed as real regression tests; the fuzzer itself is not | Commit a minimal, reproducible fuzz script under `test/` or `scripts/` before citing these numbers again |
| D-4 | `architecture.md`'s own code excerpts for `findConvergenceNode`/`findPartialReconvergence` are stale (pre-amendment signatures) | Documentation-only; the real signatures and their full rationale are correctly recorded in ADR-007 | Re-pin `architecture.md`'s code blocks before `p5-08` planning starts |
| D-5 | The sprint's own mandated "Required report-back" artifact (Story/Outcome/Criteria/Evidence/Commit table, raw test output) was never produced as its own document — reconstructed for this review instead | The execution ledger (`progress.md`) captured the same facts in narrative form; nothing was lost, just not in the contracted shape | Produce the report-back artifact as the sprint closes, not reconstructed after, starting next sprint |
| D-6 | Six of ADR-007's fix-loop rounds (real algorithm corrections to `findConvergenceNode`/`findPartialReconvergence`) were authored and self-verified by the SDD controller without a separate, explicit Solution Architect sign-off — in tension with this sprint's own stated stop condition ("design decisions belong to the Solution Architect") | The user authorized exceeding SDD's round cap mid-session; that is adjacent to, but not the same as, Solution Architect ratification of the shipped algorithm | Get explicit SA sign-off on the shipped algorithm before `p5-08` builds on it, or add a process rule distinguishing bug-fixes-within-an-adopted-ADR from new architecture |
| D-7 | Issue #14's two `findConvergenceNode` false-refusal gaps (safe-direction only, never silent) were previously named only via a linked GitHub issue | Both are real, narrow, and already loudly refuse rather than silently accept | Named explicitly here; close alongside `p5-08` or a dedicated follow-up |
| D-8 | All 7 story files' "Implementation notes" sections remain unfilled template placeholders despite substantial real deviations during implementation | The actual history is fully recorded in `progress.md` and commit messages; nothing is lost, just not where the story file itself says it should be | Backfill before `p5-08` planning needs these stories as reference |
