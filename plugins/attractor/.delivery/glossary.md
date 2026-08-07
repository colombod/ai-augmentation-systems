# Glossary: attractor

> Seeded 2026-08-07, during resolution of the FR-17b adversarial-critic findings (F1-F7).
> One agreed term per concept, in the vocabulary this project's own documents already lean
> toward — not invented from scratch. Every document (architecture, ADRs, PRD, skill copy)
> uses the term on the left; a synonym found anywhere is a defect in that document, not a
> second valid spelling. Re-run/extend whenever a new ambiguous term surfaces — this file
> started with the two terms F7 named as ambiguous or newly load-bearing; it is not meant to
> stay that short.

| Term | Definition | Referent (where it's real) |
| :-- | :-- | :-- |
| **branch** | A sub-path of node-to-node traversal inside a `Handler.PARALLEL` (`shape=component`) node's fan-out: one outgoing edge from the component node, plus everything reachable forward from it, executed with the same per-node step logic as the main run. **Not** a git branch — see *branch worktree* below for that sense, and never write bare "branch" when the git sense is meant. | `ParallelHandler`'s fan-out roots; `BranchRunOptions.startNodeId`; `dot/graph.ts#findConvergenceNode`'s `branchRootIds` parameter |
| **branch worktree** | The isolated git worktree `run/worktree.ts#createWorktree` creates for one *branch* (previous sense), so that branch's `TOOL`/`CODERGEN` nodes execute against their own filesystem copy rather than the run's shared working tree. Created under a git branch named `attractor/${runId}` — the exact template string `createWorktree(repoDir, runId)` builds at `run/worktree.ts:36-40`; the git-branch identifier is an implementation detail of how a branch worktree is realized, not a term this glossary needs on its own. (`runId` here is `createWorktree`'s own parameter name, not `branchRunId` — that spelling is architecture.md's caller-side variable name for the value passed into it, not a second naming scheme.) | `run/worktree.ts#createWorktree`/`#removeWorktree`; the `isolate` edge attribute (`"true"` default) that opts a branch out of getting one |
| **convergence node** | The single node id, computed once by static reachability *before* any branch runs, that every branch of a given `PARALLEL` node reaches in common — the point where the fanned-out branches rejoin the main pipeline. A branch halts *before* dispatching it; the main run dispatches it exactly once, in the run's own (non-cloned) context, immediately after the component node's handler returns. `null` when no such node exists (refused at lint time by PAR-001). | `dot/graph.ts#findConvergenceNode`; `BranchRunOptions.stopAt` |
| **join policy** | The rule `ParallelHandler` applies to a `PARALLEL` node's own set of `BranchRunResult`s to produce the single `Outcome` the main run records for the component node itself. This slice ships exactly one, the default: FAIL iff zero branches ended SUCCESS or PARTIAL. | `applyDefaultJoinPolicy` (`handlers/parallel.ts`) |
| **context merge-back** | The step, run by `ParallelHandler` after every branch resolves and before it returns, that copies each SUCCESS/PARTIAL branch's own context writes (its `Context.clone()`'s final snapshot, diffed against the pre-fork snapshot) into the run's real, shared `Context` — in branch-root declaration order, logging any key two or more branches touched. Without this step a branch's `outputs=`/`contextUpdates` evidence never reaches the convergence node; see ADR-010. | `mergeBranchContext` (`handlers/parallel.ts`) |

## Terms considered and deliberately not added

- **"fan-in"** — not seeded here because `Handler.FAN_IN` (`shape=tripleoctagon`) stays
  lint-refused this slice (FR-17a); the concept a reader might reach for it (an explicit node
  that joins branches) is not something this build has. *Convergence node* is the term for the
  thing this build actually has instead, and the two must not be used interchangeably once
  `FAN_IN` ships — revisit this entry then, not before.
