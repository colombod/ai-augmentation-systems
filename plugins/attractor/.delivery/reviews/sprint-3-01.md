# Sprint 3 review findings — `parallel-handler`

Findings from sprint 3's acceptance review (`sprints/3-parallel-handler-review.md`), split out
here so `/delivery:status` keeps tracking them by ID until each is resolved or explicitly
rejected. All four were found by a persona-simulator walking the real, built CLI with a
self-authored pipeline — not by a test, and not by reading source. All four were fixed the same
day, directly, rather than carried forward.

---

### R-sprint3-1 — all-fail join outcome discarded each branch's own failure reason

**Status:** fixed
**Severity:** significant
**Raised by:** persona-simulator (The Author) — a real CLI run, not a described scenario

**The claim or omission:** when every branch of a `Handler.PARALLEL` fan-out failed,
`applyDefaultJoinPolicy` reported only `"all N branch(es) failed"` — no branch's own
`failureReason` or `notes` reached the aggregate outcome, the event log, or the CLI's output. An
operator had to read engine source to find out what actually happened.

**Concrete failure scenario:** a real `.dot` pipeline run via the built CLI (`dist/attractor.js`)
with three failing branches; the CLI's printed `notes` line and `events.jsonl` both stopped at
the bare count.

**What resolved it:** `applyDefaultJoinPolicy` (`engine/src/handlers/parallel.ts`) gained an
optional `branchRootIds` parameter; a failed (or partial) join outcome's `notes` now lists each
non-succeeding branch by its real node id and its own `failureReason`/`notes`, e.g.
`"1/3 branch(es) succeeded or partially succeeded -- failed: security-review: timeout after
30s; perf-review: <reason>"`. `ParallelHandler.execute()` passes the real branch ids. Existing
direct unit tests of `applyDefaultJoinPolicy` (which call it with only `results`) are unaffected;
a new test pins the real-id/real-reason behavior.

---

### R-sprint3-2 — the `isolate` attribute and its git-repository requirement were undocumented

**Status:** fixed
**Severity:** significant
**Raised by:** persona-simulator (The Author)

**The claim or omission:** a branch's `isolate="false"` opt-out, and the requirement that
isolated branches run inside a real git repository, were correct in code but named nowhere in
`README.md`. The persona hit a real, avoidable failure (`--stub`/`--in-place` in a non-git
scratch directory) with nothing pointing at the cause.

**Concrete failure scenario:** a real CLI run against a freshly `mktemp`'d, non-git directory
failed with a `createWorktree`-originated error the persona could not connect to any documented
requirement.

**What resolved it:** `README.md` gained a "Parallel fan-out" section documenting
`max_parallel`, `isolate="false"`, and the git-repository requirement for isolated branches.

---

### R-sprint3-3 — README's shape table paired a working shape with an unusable one (pre-existing)

**Status:** fixed
**Severity:** significant
**Raised by:** persona-simulator (The Author)

**The claim or omission:** the node-shapes table listed `component` / `tripleoctagon` together
as "parallel fan-out / fan-in," implying both are usable. `tripleoctagon` (`Handler.FAN_IN`) is
still unregistered and refused by lint (`HAND-001`); a first-time author following the table for
a join node is led straight into that error. Predates sprint 3 — sprint 3 made it concretely
harmful for the first time, by making the fan-out half of the pairing actually work.

**Concrete failure scenario:** the persona built a pipeline exactly as the table suggested
(`tripleoctagon` for the join node); `attractor lint` refused it with `HAND-001`.

**What resolved it:** the table row split into two: `component` marked **works**, with a pointer
to the new "Parallel fan-out" section; `tripleoctagon` marked refused, with an explicit note to
use an ordinary `box`/`parallelogram` node as the join point instead.

---

### R-sprint3-4 — isolated-branch git branches accumulate silently

**Status:** fixed
**Severity:** minor
**Raised by:** persona-simulator (The Author)

**The claim or omission:** `removeWorktree` correctly deletes an isolated branch's temporary
working directory but deliberately keeps its git branch (`worktree.ts`'s own stated design: the
branch is the deliverable, so deleting it would discard real work). Nothing told an operator to
expect this — the persona found nine leftover `attractor/fan-*` branches after three runs only by
running `git branch -a` themselves.

**Concrete failure scenario:** three real fan-out runs against the same scratch repo left nine
permanent branches with no CLI or doc mention.

**What resolved it:** documented as intentional in `README.md`'s "Parallel fan-out" section,
including the prune command (`git branch -D`) an operator needs.
