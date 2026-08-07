# ADR-011: `run/worktree.ts`'s `git()` helper becomes async (`execFile`, not `execFileSync`)

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect
**Resolves:** feature-critic finding F4

## Context

The FR-17b architecture originally claimed `run/worktree.ts` "needs zero code changes" to
support parallel fan-out, reused as-is per branch worktree. That claim is true at the API
level — `createWorktree(repoDir, runId)` and `removeWorktree(repoDir, wt)` do not need new
parameters or new behavior to be called once per branch — but it is false at the concurrency
level, and the difference matters specifically because this is attractor's first feature that
runs anything concurrently.

Read directly: `run/worktree.ts:16-18`'s `git()` helper is

```ts
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
```

`execFileSync` blocks Node's single thread for the full duration of the child process. Every
exported function in the file calls it, directly or through `hasUncommittedWork`/
`isRegisteredWorktree`: `isGitRepo`, `createWorktree` (one `git worktree add` per branch),
`removeWorktree` (a `git status --porcelain` check, then `git worktree remove --force`, then
`git worktree prune`, run in sequence, per branch, at teardown).

Composing an unmodified synchronous primitive into a `Promise.all`-based, semaphore-bounded
fan-out means every one of those calls freezes the *entire* event loop while it runs — not just
the branch that issued it. Concretely, while one branch's `createWorktree`/`removeWorktree` is
blocking:

- Sibling branches' already-spawned `claude -p` subprocesses keep running at the OS level, but
  Node cannot process their `stdout`/`stderr` `'data'` events or their `'close'` event
  (`backend/claude.ts:62-67`) until the block clears — the child's actual output is not lost
  (the kernel buffers it), but the moment Node learns about it is delayed by however long the
  git call takes.
- `setTimeout`-driven abort timers (a box node's `timeout=` attribute, `handlers/box.ts:93`)
  cannot fire while blocked. A node whose declared timeout should have killed a hung subprocess
  on schedule instead has that kill delayed until the blocking git call finishes — a real,
  not cosmetic, correctness gap against what `timeout=` promises.

The failure scenario named by the finding: a repository where `git worktree add`/`status`
takes even a couple of seconds turns "4 branches in parallel" into "4 branches, each
occasionally frozen while a sibling does worktree setup or teardown" — worse than sequential
execution in the worst case, and silently so, since nothing in the design named this as a risk
against NFR-7's own "concurrency ceiling" framing.

**Existing callers, read before deciding — this is not a green-field API.**
`cli.ts:237,243,260,261,338` calls `isGitRepo`/`createWorktree`/`removeWorktree` synchronously
today (no `await`, because there is nothing to await) — five call sites, not three: two
`isGitRepo` guard checks (237, 260), two `createWorktree` calls on the two branches that decide
isolation is warranted (243, 261), and one `removeWorktree` call in the `finally` block (338).
`engine/test/worktree.test.ts` has roughly twenty-five call sites, all synchronous. Converting
the public API to async is a real migration across three files, not a contained change to
`run/worktree.ts` alone.

## Decision

`git()` becomes `async function git(cwd: string, args: string[]): Promise<string>`, built on
`node:child_process`'s `execFile` promisified via `node:util`'s `promisify` — both already
Node built-ins, so this adds **zero new dependencies**, preserving `AGENTS.md`'s "exactly two,
non-tradeable" constraint. `isGitRepo`, `createWorktree`, `hasUncommittedWork`,
`isRegisteredWorktree`, and `removeWorktree` all become `async`, returning `Promise`s of their
current return types (`Worktree`, `boolean`, `RemovalResult`) instead of the values directly.
Every internal call between them gains `await`.

This reverses the original architecture document's "`run/worktree.ts`: untouched" claim for
`FR-17b`. The `Codebase context` table entry is corrected to `modified`, and the change is
named explicitly in Migration, not glossed as free. Five real call sites in `cli.ts`
(`cli.ts:237,243,260,261,338` — `isGitRepo`, `createWorktree`, `isGitRepo`, `createWorktree`,
`removeWorktree`) gain `await`; `cli.ts`'s own function is
already `async` around them (it already awaits `engine.run()`), so no new async boundary is
introduced there, only new `await` keywords. `engine/test/worktree.test.ts`'s ~25 call sites
each gain `await` and the test functions they sit in become `async` — mechanical, not a
redesign of the test file's structure or assertions.

## Alternatives considered

### Accept the serialized worktree lifecycle; restate NFR-7 to describe it explicitly

**Why it was attractive:** zero code change anywhere, the original "reuse `worktree.ts`
unchanged" claim stays true, ships faster.
**Why rejected:** the correctness gap is not only a performance one. A `timeout=` attribute
that can silently fire late during a concurrent worktree operation is a promise this design
makes elsewhere (NFR-3's `parseDuration` rules, the box handler's own abort-timer comment)
being quietly weakened by an unrelated feature. Documenting it rather than fixing it would
mean parallel fan-out — a concurrency feature — ships with a real, known way for concurrency to
regress into serialization at unpredictable moments, which is close to the opposite of what
FR-17b exists to deliver. The fix here is mechanical, not novel (a stdlib swap plus threading
`async`/`await` through five functions and their callers), which weighs against accepting a
correctness gap to avoid it.

### Wrap the existing synchronous `execFileSync` calls in a worker thread or child process pool

**Why it was attractive:** would not require changing `git()`'s call sites' signatures — callers
could still call something that "looks sync" from a Promise wrapper without touching
`isGitRepo`/`createWorktree`/`removeWorktree`'s own bodies.
**Why rejected:** worker threads are a real new piece of runtime machinery (message-passing,
thread lifecycle, serialization of args/results) to solve a problem `execFile` already solves
natively and more simply — Node's own non-blocking child-process API is the direct fix for "a
child process call blocks the event loop," and reaching for threads here would be exactly the
"abstraction that doesn't earn its complexity" this role pushes back on, for a problem `execFile`
already exists to solve.

## Consequences

**We gain:** worktree setup and teardown no longer block sibling branches' subprocess I/O or
their abort timers. `max_parallel` branches genuinely overlap in wall-clock time for the
worktree-lifecycle portion of their work, not only for the LLM-subprocess portion.

**We accept:** a real, if mechanical, migration across `run/worktree.ts`, `cli.ts`, and
`engine/test/worktree.test.ts` that the original architecture undercounted. **Not** empirically
free: `execFile`'s promisified rejection shape (an `Error` with `.stdout`/`.stderr`/`.code`
attached) is expected to closely match `execFileSync`'s thrown-`Error` shape, since Node
attaches the same fields to both, but this is verified, not assumed — Spike 12 in the
architecture document checks it against `worktree.test.ts`'s existing message-matching
assertions before this ships, because a silent format drift there would turn a passing test red
for a reason unrelated to the feature being tested.

**Not applicable to:** the git-level behavior itself — `git worktree add`/`remove`/`status`/
`prune`'s own semantics, exit codes, and `--porcelain` output are unchanged; only how Node waits
for them changes.
