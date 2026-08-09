# ADR-008: `branch_worktree=true` reuses `run/worktree.ts` unmodified; the issue #15 race is avoided by serializing `ParallelHandler`'s own calls into it, per repository, not by fixing the function

**Status:** accepted
**Date:** 2026-08-09
**Deciders:** Solution Architect

## Context

OQ4 (`plugins/attractor/.delivery/prd.md`, resolved 2026-08-09) settles the product behavior:
branches share the run's one git worktree by default; a branch node whose work writes opts
into its own isolated worktree via `branch_worktree=true`. The PRD's own citation for *why*
grounds this in the engine's existing, already-shipped mechanism — "every real run already
gets one dedicated git worktree today," `run/worktree.ts` and `README.md:25–33` — and this
task's own instructions are explicit: reuse that mechanism, don't invent a second one.

`run/worktree.ts`'s `createWorktree(repoDir, runId)` (worktree.ts:36–53) and `removeWorktree`
(worktree.ts:184–316) are the only worktree-creation/removal code in this codebase.
`cli.ts:224–344` is their only production caller today, invoked exactly once per `attractor
run` invocation, never concurrently.

**GitHub issue #15** (`createWorktree: concurrent git worktree add races on
.git/worktrees/ administrative state`, confirmed open via `gh issue view 15`) documents that
`createWorktree` has no locking, retry, or serialization, and that concurrent calls against the
same repository race on git's own `.git/worktrees/` administrative state — reproduced by
`worktree.test.ts`'s own "several concurrent createWorktree calls" test at roughly a
1-in-15-to-25 flake rate, with the exact failure `fatal: failed to read
.git/worktrees/concurrent-1/commondir: Undefined error: 0`. The issue's own text states why
this is latent today and names exactly the moment it stops being latent:

> This is exactly the scenario `p5-08`'s own `max_parallel` concurrent branches will need once
> `ParallelHandler` lands: several branches, each requesting their own isolated worktree,
> against one operator repository, at the same time.

Its own "Suggested fix" section is equally explicit that fixing `createWorktree` itself is
**out of scope for this work**:

> Deliberately not attempted as part of the parallel-fanin sprint's own final-review fix pass,
> since it touches `createWorktree` — code the CLI's existing, non-parallel worktree-isolation
> feature already depends on today — and deserves its own focused design and adversarial
> verification rather than being folded into an unrelated batch of fixes.

This creates a real tension this ADR has to resolve: this task's instructions say "account for
[issue #15] in your design rather than building the same race into a new concurrent-by-
construction code path," while the issue's own text says fixing `createWorktree` internals is
explicitly not this work's job.

## Decision

**Fix it at the call site, not the function.** `run/worktree.ts` is not modified at all.
`ParallelHandler` — the first and only production code path this codebase will have that can
generate concurrent `createWorktree` calls against one repository — serializes its own calls
into that function with a small, private, per-instance async mutex keyed by the resolved
absolute `repoDir` path:

```ts
// inside handlers/parallel.ts, illustrative shape, not literal code
private repoLocks = new Map<string, Promise<unknown>>()
private withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repoDir)
  const prior = this.repoLocks.get(key) ?? Promise.resolve()
  const next = prior.then(fn, fn)   // fn still runs even if a previous call rejected
  this.repoLocks.set(key, next.then(() => undefined, () => undefined))
  return next
}
```

Only the `git worktree add` call itself — `createWorktree`'s own invocation — is serialized.
Everything else about a branch (its actual dispatched work, `removeWorktree`'s own removal
call, which is not subject to the same race since it targets a distinct, already-created
worktree path) proceeds at full `max_parallel` concurrency. This closes the *specific,
concurrent-calls-within-one-process* shape issue #15 describes for the *one new code path*
that can trigger it, without touching the function issue #15 itself is tracking.

**Two `repoDir` needed, not one, and both come from the run's own `cwd`, not a new
top-level flag.** `EngineOptions.repoDir?: string` (new, optional, defaults to `cwd`) and
`HandlerCtx.repoDir?: string` — see the architecture addendum's Interfaces section for the
exact type. The CLI passes `repoDir: args.cwd` explicitly (cli.ts:288–295, one new line)
because by the time `Engine` is constructed, `cli.ts`'s own local `cwd` variable may already
have been replaced with `worktree.path` (the run's own top-level isolation, cli.ts:243/261) —
`args.cwd`, the pre-substitution value, is the stable repository path `createWorktree` needs,
matching exactly what `cli.ts` itself already passes to both `createWorktree` and
`removeWorktree` for the run's own worktree (cli.ts:243, 338). Every existing hand-built
`HandlerCtx` test fixture is unaffected — the field is optional.

**Branch-worktree isolation is evaluated lazily, "switch on first sight."** OQ4's own language
— "nodes that write opt in to a per-branch worktree" — places the attribute on whichever node
in a branch's chain actually writes, not necessarily the branch's first node. `ParallelHandler`
walks a branch with a local `usingIsolatedWorktree` flag, initially `false` and `branchCwd`
initially the run's shared `cwd`. The first node in that branch's walk whose
`attrs.branch_worktree === 'true'` is seen, and only then, `ParallelHandler` (via
`withRepoLock`) calls `createWorktree(ctx.repoDir, \`${parallelNodeId}-${branchHeadId}\`)`
(node ids, already unique per graph — no new run-id field needed for uniqueness), sets
`branchCwd` to the new worktree's path, and dispatches every remaining node in that branch with
this `branchCwd`. `removeWorktree` runs once, in a `finally`, when the branch finishes — using
the existing function's own uncommitted-work safety checks unmodified (worktree.ts:184–254).

**Named, documented gotcha:** a node earlier in the same branch that ran in the shared worktree
before the switch may have left uncommitted changes there; `git worktree add` only inherits
*committed* history, so those uncommitted changes are not visible in the newly-created isolated
worktree. This is a real authoring consideration, not an engine defect — the recommendation
(documented for whoever writes the skill/authoring guidance, not a lint rule this ADR builds)
is to place `branch_worktree=true` on the branch's first writing node, as far upstream in that
branch as practical.

## Alternatives considered

### Fix the race inside `createWorktree` itself (retry-with-backoff or a lock, per issue #15's own "Suggested fix")

**Why attractive:** the more general fix — would also protect the CLI's own top-level
worktree creation against a hypothetical future concurrent-runs scenario, and closes issue #15
outright rather than working around it.
**Why rejected:** issue #15's own text scopes this out explicitly ("deserves its own focused
design and adversarial verification rather than being folded into an unrelated batch of
fixes"). Bundling a fix to shared, already-shipped, non-parallel infrastructure into this
feature's own change set is exactly the "unrelated batch of fixes" the issue asks not to
happen. The call-site mitigation fully closes the race for the only new concurrent-call source
this design introduces, without that risk.

### Isolate every branch unconditionally, no opt-in

**Why attractive:** simpler — no lazy-switch semantics, no "which node in the branch" question.
**Why rejected:** already rejected once, by the Product Owner, in OQ4 itself: "would tax every
fan-out with worktree-creation cost even for read-only, non-writing branches ... the majority
realistic use of `box`/`parallelogram` branches today." Re-litigating a resolved product
decision is out of scope for this ADR.

### Require `branch_worktree=true` only on a branch's first node

**Why attractive:** simpler mechanically — checked once, upfront, no per-node walk needed.
**Why rejected:** contradicts OQ4's own wording ("set on the specific branch node whose work
writes") and would force awkward re-authoring for the realistic shape of "a read-only critic
runs first, then a node that writes" within one branch.

## Consequences

**We gain:** `branch_worktree=true` is implementable today, against the existing, working
`run/worktree.ts`, with zero changes to a module a separately-tracked issue is already
watching. The concurrent-`git worktree add` race issue #15 describes cannot occur through this
new code path, verified by running `worktree.test.ts`'s own existing concurrent-calls
stress test through the new mutex (Spike 2 in the architecture addendum).

**We accept:** the mutex is scoped to one `ParallelHandler` instance (one per `Engine`, one per
run, in the CLI's own one-process-per-invocation model) — it does not serialize
`createWorktree` calls across two separate `Engine`/process instances hitting the same
repository concurrently. That broader case is exactly what issue #15 itself remains open to
track; this ADR does not close it, and does not claim to.

**We will need to revisit this if:** issue #15 is fixed inside `createWorktree` itself (a
repo-scoped lock or retry built into the function) — at that point `ParallelHandler`'s own
`withRepoLock` wrapper becomes redundant belt-and-suspenders, not wrong, and can be simplified
away in a follow-up cleanup, not urgently.
