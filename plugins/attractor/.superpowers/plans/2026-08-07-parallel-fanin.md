# Parallel fan-out/fan-in prerequisites (FR-17b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every prerequisite FR-17b (parallel fan-out/fan-in) needs before `Handler.PARALLEL` itself can be built — an async `worktree.ts`, one shared per-node step implementation, per-call `cwd` plumbing, convergence-node discovery plus three lint rules, a `runBranch` seam on `HandlerCtx`, an early-EXIT lint warning, and deterministic context merge-back plus a fourth lint rule — with zero observable behavior change to any graph that has no `component` node today.

**Architecture:** Seven independently-testable, dependency-ordered slices land directly in `plugins/attractor/engine/src/{run,core,handlers,dot}`. `Engine#executeNodeStep` (Task 2) becomes the single per-node dispatch path both today's `run()` loop and tomorrow's `runBranch` (Task 5) call — never two independently-maintained copies. `findConvergenceNode`/`findPartialReconvergence` (Task 4) are written once in `dot/graph.ts` and reused by both the lint rules in this plan and (later, out of scope) the runtime `ParallelHandler`. None of this plan builds `Handler.PARALLEL` or `ParallelHandler` itself — that is `p5-08`, a future sprint blocked on two still-open Solution Architect decisions.

**Tech Stack:** TypeScript (native Node type stripping, no build step), `node:test`/`node:assert/strict`, `node:child_process` (`execFile` via `node:util`'s `promisify`), `@ts-graphviz/ast` (DOT parsing, untouched by this plan).

## Global Constraints

- Runtime: Node ≥ 24, native TypeScript type stripping, no build step (`AGENTS.md`).
- Dependency count stays at 2 (`@ts-graphviz/ast`, `esbuild`) — this plan adds zero new dependencies.
- Test command: `cd plugins/attractor/engine && node --test` (full suite) / a per-task targeted file (named in each task).
- Baseline today: 508 tests, 507 passing, 1 skipped, 0 failing. Every task's own final regression run must still show 0 failing.
- One commit per task.
- Do not weaken a test to make it pass — if a step's expected result does not hold, stop and report instead of loosening the assertion.
- Do not touch `HAND-001`, `HITL-001`, `HITL-002`, `HITL-003`, `GATE-001`, `DATA-001`, `DATA-002`, `TOPO-*`, `RUNS-*`, `CMD-*`, or any other existing lint rule's logic.
- Do not remove `Handler.PARALLEL` from `UNREGISTERED_HANDLER_KINDS` (`dot/graph.ts`) — that is `p5-08`'s own last line, a future sprint, not this plan. Every `PAR-*` lint rule this plan adds must co-fire alongside `HAND-001` on a `component`/`Handler.PARALLEL` node, never suppress or replace it.

---

### Task 1: Convert run/worktree.ts to async and prove branches no longer block each other

**Files:**
- Modify: `plugins/attractor/engine/src/run/worktree.ts` (whole file — `git()` and all five exported/internal functions)
- Modify: `plugins/attractor/engine/src/cli.ts:237,243,260,261,338`
- Modify: `plugins/attractor/engine/test/worktree.test.ts` (whole file — every existing call site gains `await`; two new test blocks added)
- Modify: `plugins/attractor/engine/test/fixtures.ts` (new `GatedBackend` test double)
- Test: `plugins/attractor/engine/test/worktree.test.ts`

**Interfaces:**
- Consumes: `type Backend` from `plugins/attractor/engine/src/handlers/types.ts` (existing, unmodified by this task — `Backend.run(node, prompt, context, graph, signal?)`); `Status`/`type Outcome` from `plugins/attractor/engine/src/core/outcome.ts` (existing).
- Produces (for Tasks 5 and 7, which reuse `GatedBackend`; for the CLI and every later story that calls worktree functions):
  ```ts
  // run/worktree.ts — same shapes, now async
  export function isGitRepo(dir: string): Promise<boolean>
  export function createWorktree(repoDir: string, runId: string): Promise<Worktree>
  export function removeWorktree(repoDir: string, wt: Worktree): Promise<RemovalResult>
  export interface Worktree { path: string; branch: string }
  export interface RemovalResult { removed: boolean; warning?: string }

  // test/fixtures.ts — NEW, reused verbatim by Task 5 and Task 7's tests
  export class GatedBackend implements Backend {
    inFlight: number
    maxObserved: number
    run(node: Node): Promise<Outcome>          // gates on node.id until release()/reject() is called
    release(nodeId: string): void
    reject(nodeId: string, err: Error): void
  }
  ```

- [ ] **Step 1: Add `GatedBackend` to `test/fixtures.ts`**

This is shared test infrastructure the rest of this task's new tests exercise, and that Tasks 5 and 7 also reuse verbatim — building it first (rather than test-first) matches how the existing `LINT_FAILS_BUT_WOULD_RUN` fixture in the same file was added, as plain infrastructure with no test of its own beyond what consumes it.

Read the current file first (it is 20 lines, a single DOT-string export) so the edit is additive:

```ts
import { type Context } from '../src/core/context.ts'
import { type Graph, type Node } from '../src/dot/graph.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { type Backend } from '../src/handlers/types.ts'

// ... existing LINT_FAILS_BUT_WOULD_RUN export stays exactly as-is above this line ...

/**
 * A `Backend` whose `run()` never resolves on its own -- it blocks on an
 * internal per-node gate until the test explicitly `release()`s or
 * `reject()`s that node id. `StubBackend` resolves on the next microtask,
 * which cannot force two branches to genuinely overlap; this can, and is
 * what every Phase 5 concurrency test (this file, and later `engine.test.ts`/
 * `parallel.test.ts`) is built on. Do not duplicate this class elsewhere --
 * import it from here.
 */
export class GatedBackend implements Backend {
  inFlight = 0
  maxObserved = 0
  private gates = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  async run(node: Node): Promise<Outcome> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    try {
      await new Promise<void>((resolve, reject) => {
        this.gates.set(node.id, { resolve, reject })
      })
    } finally {
      this.inFlight--
    }
    return { status: Status.SUCCESS }
  }

  /** Test drives interleaving: let a specific gated node's run() resolve. */
  release(nodeId: string): void {
    this.gates.get(nodeId)?.resolve()
  }

  /** Rejects instead of resolving -- for later stories' branch-throws tests. */
  reject(nodeId: string, err: Error): void {
    this.gates.get(nodeId)?.reject(err)
  }
}
```

Note: `GatedBackend.run(node: Node)` declares fewer parameters than `Backend.run(node, prompt, context, graph, signal?, cwd?)` (the `cwd?` param does not exist yet — Task 3 adds it). TypeScript's structural typing accepts a method with fewer declared parameters as satisfying an interface requiring more; a caller invoking through the `Backend` type (e.g., `BoxHandler`) may pass all six arguments and JavaScript silently ignores the extra ones. This stays valid unchanged after Task 3 lands.

- [ ] **Step 2: Write the failing tests — mutation-checked interleaving proof, worktree-name-collision, and async-conversion of every existing test**

Replace the entire contents of `plugins/attractor/engine/test/worktree.test.ts` with the version below. Every existing `test('...', () => {...})` becomes `test('...', async () => {...})` with `await` added before each `isGitRepo`/`createWorktree`/`removeWorktree` call (no assertion text changes — this is the "existing suite passes unmodified" acceptance criterion, satisfied mechanically). Three new tests are appended at the end.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWorktree, removeWorktree, isGitRepo } from '../src/run/worktree.ts'
import { Handler, type Node } from '../src/dot/graph.ts'
import { GatedBackend } from './fixtures.ts'

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-wt-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'seed.txt'), 'seed', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

test('a git directory is recognised and a plain one is not', async () => {
  const r = repo()
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    assert.equal(await isGitRepo(r), true)
    assert.equal(await isGitRepo(plain), false)
  } finally {
    rmSync(r, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  }
})

test('a worktree is created on its own branch with the seed content', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run1')
    assert.ok(existsSync(wt.path), 'the worktree directory exists')
    assert.ok(existsSync(join(wt.path, 'seed.txt')), 'it has the repo content')
    assert.match(wt.branch, /run1/)
    await removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('work in the worktree does not appear in the main tree', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run2')
    writeFileSync(join(wt.path, 'only-here.txt'), 'x', 'utf8')
    assert.equal(existsSync(join(r, 'only-here.txt')), false, 'the main tree is untouched')
    await removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal leaves the main working tree intact', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run3')
    await removeWorktree(r, wt)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the main tree survives removal')
    assert.equal(existsSync(wt.path), false, 'the worktree is gone')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal is safe to call twice', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run4')
    assert.equal((await removeWorktree(r, wt)).removed, true)
    assert.equal((await removeWorktree(r, wt)).removed, true, 'a second removal is a no-op, not an error')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree git has forgotten is preserved, not guessed safe to delete', async () => {
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = await createWorktree(r, 'run6')
    rmSync(join(r, '.git', 'worktrees', 'run6'), { recursive: true, force: true })

    const result = await removeWorktree(r, wt)
    assert.equal(existsSync(wt.path), true, 'the directory must not be guessed safe to delete')
    assert.equal(result.removed, false)
    assert.match(
      result.warning ?? '',
      /administrative record.*gone/,
      'the operator is told git cannot verify this worktree, not just that removal failed',
    )
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('the reviewer repro: uncommitted work survives even with the admin record gone', async () => {
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = await createWorktree(r, 'run11')
    writeFileSync(join(wt.path, 'VALUABLE-OUTPUT.txt'), 'hours of work', 'utf8')
    rmSync(join(r, '.git', 'worktrees', 'run11'), { recursive: true, force: true })

    const result = await removeWorktree(r, wt)
    assert.equal(result.removed, false, 'must refuse rather than destroy')
    assert.equal(existsSync(join(wt.path, 'VALUABLE-OUTPUT.txt')), true, 'the file survives')
    assert.match(result.warning ?? '', /uncommitted work|administrative record/i)
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('the root guard survives a symlinked path to the same repository', async () => {
  const r = repo()
  const link = join(mkdtempSync(join(tmpdir(), 'attractor-link-')), 'repo-link')
  try {
    symlinkSync(r, link)
    const result = await removeWorktree(link, { path: realpathSync(r), branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(link, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a directory this module did not create', async () => {
  const r = repo()
  const stranger = mkdtempSync(join(tmpdir(), 'attractor-stranger-'))
  try {
    writeFileSync(join(stranger, 'important.txt'), 'keep me', 'utf8')
    const result = await removeWorktree(r, { path: stranger, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /not a worktree this module created/)
    assert.equal(existsSync(join(stranger, 'important.txt')), true, 'the directory must survive')
  } finally {
    rmSync(stranger, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree outside our convention keeps its parent directory', async () => {
  const r = repo()
  const parent = mkdtempSync(join(tmpdir(), 'attractor-notours-'))
  const manual = join(parent, 'child')
  try {
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'manual/branch', manual], { cwd: r })
    const result = await removeWorktree(r, { path: manual, branch: 'manual/branch' })
    assert.equal(result.removed, true, 'git removes a worktree it registered')
    assert.equal(
      existsSync(parent),
      true,
      'a parent outside our naming convention is not ours to delete',
    )
  } finally {
    rmSync(parent, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a clean removal and a repeat call produce no warning', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run7')
    const first = await removeWorktree(r, wt)
    assert.equal(first.warning, undefined, 'a clean removal has nothing to report')
    const second = await removeWorktree(r, wt)
    assert.equal(second.removed, true)
    assert.equal(second.warning, undefined, 'an already-gone target is a clean no-op')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a path that is the repository root', async () => {
  const r = repo()
  try {
    const result = await removeWorktree(r, { path: r, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /repository root/)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('the mkdtemp parent is cleaned up after a normal removal', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run8')
    const parent = dirname(wt.path)
    assert.equal(existsSync(parent), true, 'the parent exists while the worktree does')
    await removeWorktree(r, wt)
    assert.equal(existsSync(parent), false, 'an emptied parent we created must not be leaked')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('uncommitted work is preserved, not deleted', async () => {
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = await createWorktree(r, 'run9')
    writeFileSync(join(wt.path, 'VALUABLE-OUTPUT.txt'), 'hours of work', 'utf8')

    const result = await removeWorktree(r, wt)
    assert.equal(result.removed, false, 'must refuse rather than destroy')
    assert.equal(existsSync(join(wt.path, 'VALUABLE-OUTPUT.txt')), true, 'work survives')
    assert.match(result.warning ?? '', /uncommitted work/)
    assert.match(result.warning ?? '', new RegExp(wt.branch), 'the warning names the branch')
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree whose work is committed is removed normally', async () => {
  const r = repo()
  try {
    const wt = await createWorktree(r, 'run10')
    writeFileSync(join(wt.path, 'shipped.txt'), 'done', 'utf8')
    execFileSync('git', ['add', '-A'], { cwd: wt.path })
    execFileSync('git', ['commit', '-qm', 'ship'], { cwd: wt.path })

    const result = await removeWorktree(r, wt)
    assert.equal(result.removed, true, 'committed work leaves nothing to protect')
    assert.equal(existsSync(wt.path), false)

    const onBranch = execFileSync('git', ['ls-tree', '-r', '--name-only', wt.branch], {
      cwd: r, encoding: 'utf8',
    })
    assert.match(onBranch, /shipped\.txt/, 'the work is on the branch')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a non-repository refuses rather than running in place', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    await assert.rejects(() => createWorktree(plain, 'run5'), /cannot create an isolated worktree/)
  } finally {
    rmSync(plain, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// NEW for Phase 5 (FR-17b, NFR-7): worktree.ts must no longer block the
// event loop for the duration of a git subprocess.
// ---------------------------------------------------------------------------

// Mutation-checked: a `GatedBackend`-held branch A stays mid-flight while a
// real `createWorktree` call for branch B runs against a real repo. Ordering
// (not wall-clock timing) is what proves the claim: `backend.release()` is
// called SYNCHRONOUSLY, in the same tick, immediately after `createWorktree`
// is invoked but before it is awaited. With an async `git()`, `createWorktree`
// spawns branch B's subprocess and returns a pending promise almost
// instantly -- well before the real child process exits -- so control
// returns to this test in time for `release()` to run, and branch A's
// resolution is observed BEFORE branch B's git call resolves. A mutant that
// reverts `git()` to `execFileSync` makes `createWorktree`'s entire
// synchronous prefix (including the blocking git call) run to completion
// BEFORE `release()` is ever reached, flipping the observed order.
test('git worktree operations no longer block a GatedBackend-held sibling branch (mutation-checked, NFR-7)', async () => {
  const r = repo()
  try {
    const backend = new GatedBackend()
    const order: string[] = []
    const nodeA: Node = { id: 'branchA', attrs: {}, handler: Handler.CODERGEN }

    const aPromise = backend.run(nodeA).then(() => {
      order.push('branchA-released')
    })
    const bPromise = createWorktree(r, 'branchB').then((wt) => {
      order.push('branchB-worktree-created')
      return wt
    })
    // Fires while branch B's real `git worktree add` subprocess may still be
    // running at the OS level -- with a synchronous git(), createWorktree's
    // whole synchronous prefix would already have consumed this test's
    // execution before this line ever ran.
    backend.release('branchA')

    await Promise.all([aPromise, bPromise])
    assert.deepEqual(
      order,
      ['branchA-released', 'branchB-worktree-created'],
      "branch A's release must be observed before branch B's git call resolves",
    )
    const wt = await bPromise
    await removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('several concurrent createWorktree calls against one repo succeed with distinct branches and paths', async () => {
  const r = repo()
  try {
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => createWorktree(r, `concurrent-${i}`)),
    )
    const paths = new Set(results.map((wt) => wt.path))
    const branches = new Set(results.map((wt) => wt.branch))
    assert.equal(paths.size, 5, 'every worktree got a distinct path')
    assert.equal(branches.size, 5, 'every worktree got a distinct branch')
    for (const wt of results) assert.ok(existsSync(wt.path), `${wt.path} exists`)
    await Promise.all(results.map((wt) => removeWorktree(r, wt)))
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('two concurrent createWorktree calls sharing one runId: one succeeds, the other fails loudly, no corrupted state', async () => {
  const r = repo()
  try {
    const settled = await Promise.allSettled([
      createWorktree(r, 'dup-run'),
      createWorktree(r, 'dup-run'),
    ])
    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'exactly one of the two colliding calls succeeds')
    assert.equal(rejected.length, 1, 'the other fails loudly rather than silently corrupting state')

    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: r, encoding: 'utf8' })
    const branchLines = list.split('\n').filter((l) => l.includes('attractor/dup-run'))
    assert.equal(branchLines.length, 1, 'git registers exactly one worktree for the branch, not a corrupted duplicate')

    if (fulfilled[0].status === 'fulfilled') await removeWorktree(r, fulfilled[0].value)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/worktree.test.ts`
Expected: the three new tests fail. The mutation-checked interleaving test fails because `createWorktree`/`isGitRepo`/`removeWorktree` still return plain values, not promises, so `.then(...)` on the return of `createWorktree(...)` throws `TypeError: bPromise.then is not a function` (or similar) — a legitimate red state driven by the sync/async shape mismatch, not a typo. The two collision tests fail for the same reason (`Promise.all`/`Promise.allSettled` over non-promise values behave differently than intended, and the `.then` chains throw). Every pre-existing test (now `await`-ed) still passes, since `await` on a non-promise value resolves to that same value after one microtask tick.

- [ ] **Step 4: Implement — convert `run/worktree.ts` to async**

Replace the entire contents of `plugins/attractor/engine/src/run/worktree.ts` with:

```ts
import { execFile } from 'node:child_process'
import {
  existsSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Every worktree directory this module creates carries this prefix. */
const WT_PREFIX = 'attractor-wt-'

export interface Worktree {
  path: string
  branch: string
}

/**
 * ADR-011: `execFile`, promisified via `node:util`'s `promisify` -- zero new
 * dependency (AGENTS.md's "exactly two, non-tradeable" constraint preserved).
 * `execFileSync` blocked the whole process for a child's full duration;
 * composed into a `Promise.all`-based branch fan-out, one branch's worktree
 * setup/teardown would freeze every sibling's already-spawned subprocess I/O
 * and its `timeout=` abort timer (a correctness gap, not merely a
 * performance one -- `handlers/box.ts`'s `setTimeout`-driven abort cannot
 * fire while Node is blocked). Spike 12: `execFile`'s promisified rejection
 * carries the same `Error` shape execFileSync's thrown Error did -- `.message`
 * still includes the child's stderr text on a non-zero exit, so every
 * message-matching assertion below keeps passing unmodified.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return stdout
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Create a dedicated worktree for a run.
 *
 * Unattended work runs with permissions bypassed, so it must not execute in
 * the operator's working copy. Refusing outright in a non-repository is
 * deliberate: falling back to in-place execution would silently remove the
 * isolation the caller asked for.
 */
export async function createWorktree(repoDir: string, runId: string): Promise<Worktree> {
  if (!(await isGitRepo(repoDir))) {
    throw new Error(`not a git repository: ${repoDir} -- cannot create an isolated worktree`)
  }
  const branch = `attractor/${runId}`
  const parent = mkdtempSync(join(tmpdir(), WT_PREFIX))
  const path = join(parent, runId)
  try {
    await git(repoDir, ['worktree', 'add', '-q', '-b', branch, path])
  } catch (err) {
    // The temp parent already exists by now. Leaving it behind on a failed
    // add -- a branch-name collision being the likely cause -- would leak a
    // directory per failed attempt.
    rmSync(parent, { recursive: true, force: true })
    throw err
  }
  return { path, branch }
}

export interface RemovalResult {
  removed: boolean
  /** Set when something went wrong the operator should see. */
  warning?: string
}

function realOrResolved(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

function isOurWorktree(target: string): boolean {
  const tmpRoot = realOrResolved(tmpdir())
  const t = realOrResolved(target)
  return t.startsWith(`${tmpRoot}${sep}`) && basename(dirname(t)).startsWith(WT_PREFIX)
}

async function hasUncommittedWork(worktreePath: string): Promise<boolean> {
  try {
    return (await git(worktreePath, ['status', '--porcelain'])).trim() !== ''
  } catch {
    // If git cannot answer, assume there IS work. Guessing "nothing here"
    // would delete on exactly the reading we are least sure about.
    return true
  }
}

async function isRegisteredWorktree(repoDir: string, target: string): Promise<boolean> {
  try {
    const out = await git(repoDir, ['worktree', 'list', '--porcelain'])
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ') && realOrResolved(line.slice('worktree '.length)) === target) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

function isNonEmptyDirectory(path: string): boolean {
  try {
    return readdirSync(path).length > 0
  } catch {
    return true
  }
}

export async function removeWorktree(repoDir: string, wt: Worktree): Promise<RemovalResult> {
  const target = realOrResolved(wt.path)
  const root = realOrResolved(repoDir)

  const ours = isOurWorktree(target)

  if (target === root || root.startsWith(`${target}${sep}`)) {
    return {
      removed: false,
      warning: `refusing to remove ${target}: it is, or contains, the repository root`,
    }
  }

  const registered = existsSync(target) && (await isRegisteredWorktree(repoDir, target))

  if (registered && (await hasUncommittedWork(target))) {
    return {
      removed: false,
      warning:
        `keeping ${target}: it has uncommitted work on branch ${wt.branch}. ` +
        `Commit it there, or delete the directory once you have salvaged it.`,
    }
  }

  if (existsSync(target) && ours && !registered && isNonEmptyDirectory(target)) {
    return {
      removed: false,
      warning:
        `keeping ${target}: git's administrative record for this worktree is gone, so its status ` +
        `cannot be verified, and the directory is not empty. Treating it as uncommitted work on ` +
        `branch ${wt.branch} rather than guessing it is safe to delete.`,
    }
  }

  let gitError: string | undefined
  try {
    await git(repoDir, ['worktree', 'remove', '--force', target])
  } catch (err) {
    gitError = (err instanceof Error ? err.message : String(err)).trim()
  }

  try {
    await git(repoDir, ['worktree', 'prune'])
  } catch {
    // Metadata only; a failure here does not affect the directory.
  }

  const survivedGit = existsSync(target)
  if (survivedGit) {
    if (!ours) {
      return {
        removed: false,
        warning:
          `refusing to delete ${target}: it is not a worktree this module created ` +
          `(expected a ${WT_PREFIX}* directory under the system temp directory)`,
      }
    }
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (err) {
      return { removed: false, warning: `could not remove worktree ${target}: ${String(err)}` }
    }
  }

  if (ours) {
    const parent = dirname(target)
    try {
      if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
    } catch {
      // A shared or non-empty parent is not ours to remove.
    }
  }

  if (survivedGit && gitError !== undefined) {
    return {
      removed: true,
      warning: `git could not remove the worktree cleanly, directory was deleted directly: ${gitError}`,
    }
  }
  return { removed: true }
}
```

Every doc comment retained from the original (worktree-root guard, uncommitted-work guard, `isRegisteredWorktree`'s reasoning, etc.) stays verbatim above the function it documents — only omitted here for brevity where unchanged; carry them over in full when editing the real file rather than dropping them.

- [ ] **Step 5: Update the five `cli.ts` call sites**

`plugins/attractor/engine/src/cli.ts`'s enclosing function (`export async function main(...)`, confirmed at line 187) is already `async` and already `await`s `engine.run()`, so this introduces no new async boundary.

```ts
// cli.ts:237 -- was: if (!isGitRepo(args.cwd)) {
      if (!(await isGitRepo(args.cwd))) {

// cli.ts:243 -- was: worktree = createWorktree(args.cwd, runId)
      worktree = await createWorktree(args.cwd, runId)

// cli.ts:260 -- was: } else if (isGitRepo(args.cwd)) {
      } else if (await isGitRepo(args.cwd)) {

// cli.ts:261 -- was: worktree = createWorktree(args.cwd, runId)
        worktree = await createWorktree(args.cwd, runId)

// cli.ts:338 -- was: const removal = removeWorktree(args.cwd, worktree)
        const removal = await removeWorktree(args.cwd, worktree)
```

- [ ] **Step 6: Run the targeted test file to verify it passes**

Run: `cd plugins/attractor/engine && node --test test/worktree.test.ts`
Expected: all tests pass, including the three new ones. If any pre-existing message-matching assertion (e.g. `/administrative record.*gone/`, `/could not remove worktree/`) fails because `execFile`'s rejection message text drifted from `execFileSync`'s, this is Spike 12's named risk materializing — read the actual thrown message, confirm it is still factually accurate (names the same cause), and if so update ONLY that assertion's expected substring to match the real (still correct) wording. Do not weaken what the assertion proves (e.g. do not loosen a specific regex to `/.*/. `); if the message is actually wrong or missing information the original had, stop and report rather than patching the test.

- [ ] **Step 7: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing. Total test count increases by 3 (the two new worktree tests plus the collision test) relative to the 508 baseline; every other file's assertions are unchanged (confirms `cli.ts`'s worktree-creation/cleanup/stderr-warning behavior, exercised indirectly by any CLI-level test, is unaffected).

- [ ] **Step 8: Commit**

```bash
git add plugins/attractor/engine/src/run/worktree.ts \
        plugins/attractor/engine/src/cli.ts \
        plugins/attractor/engine/test/worktree.test.ts \
        plugins/attractor/engine/test/fixtures.ts
git commit -m "$(cat <<'EOF'
engine: convert worktree.ts to async, add GatedBackend (p5-01)

git() now uses execFile via node:util's promisify instead of execFileSync,
so one branch's worktree setup/teardown can no longer block a sibling
branch's already-spawned subprocess I/O or its timeout= abort timer
(ADR-011). Adds GatedBackend, the forced-overlap test double every later
Phase 5 concurrency test reuses, and proves both claims with mutation-checked
tests: worktree operations no longer block the event loop, and concurrent
createWorktree calls against one repo never silently corrupt git's worktree
registry.
EOF
)"
```

---

### Task 2: Extract Engine#executeNodeStep as the one shared per-node step implementation

**Files:**
- Modify: `plugins/attractor/engine/src/core/engine.ts` (whole `run()` method, `engine.ts:605-1094`; new private field and method)
- Test: `plugins/attractor/engine/test/engine.test.ts` (no new assertions — full-suite regression is the exit condition)

**Interfaces:**
- Consumes: nothing new from another task (independent of Task 1, mergeable in parallel). Reuses existing `saveCheckpoint`/`type Checkpoint` (`core/checkpoint.ts`), `selectEdge` (`core/edge-select.ts`), `resolveRetryPolicy`/`resolveRetryTarget`/`backoffMs` (`core/retry.ts`), `wantsVerdict` (`backend/argv.ts`), `runsOn`/`RunsOn` (`dot/graph.ts`) — all unchanged.
- Produces (Task 5's `runBranch` is a thin caller of this, verbatim):
  ```ts
  // core/engine.ts — private, no public surface change (ADR-012)
  private stepCount = 0   // replaces the loop's local `step` variable

  type StepResult =
    | { kind: 'continue'; nextId: string }
    | { kind: 'stop'; reason: 'exit' | 'frontier' | 'deadend' | 'stepcap'; nodeId: string; outcome: Outcome }

  private async executeNodeStep(
    currentId: string,
    opts: { runDir: string; cwd: string; maxSteps: number; stopAt?: ReadonlySet<string>; context: Context },
  ): Promise<StepResult>
  ```

  **Design refinement beyond the story's own literal contract block, applied consistently in this task and reused verbatim by Task 5:** the story's own "Interfaces and contracts to honor" section, and its own restatement of `run()`'s call site ("`run()`'s own loop calls `executeNodeStep(currentId, { runDir: this.opts.runDir, cwd: this.opts.cwd, maxSteps, stopAt: undefined })`"), omit a `context` field from `opts`. Read literally, `executeNodeStep` would always read/write `this.opts.context` directly. That is correct and sufficient for `run()`'s own single-context loop (this task's whole scope), but it does **not** work for Task 5's `runBranch`, whose `BranchRunOptions.context` is a per-branch `Context.clone()`: if `executeNodeStep` always touched `this.opts.context`, a branch's dispatch would silently write into the run's real context instead of its own clone (defeating the entire point of cloning), and the alternative — `runBranch` temporarily reassigning the mutable `this.opts.context` field around its own loop — is a genuine data race the moment two branches run concurrently (each call's reassignment can clobber the other's between `await` points). Adding `context: Context` as a required field of `executeNodeStep`'s own `opts` avoids both: every caller supplies its own context by value, `run()`'s call passes `this.opts.context` (identical behavior to today), and Task 5's `runBranch` passes the branch's own clone with zero shared mutable state. This is the single most load-bearing deviation from the story text in this whole plan — call it out in the commit message.

- [ ] **Step 1: Run the full suite to record the exact baseline**

Run: `cd plugins/attractor/engine && node --test`
Expected: 508 tests, 507 passing, 1 skipped, 0 failing (today's baseline). This is the refactor's own before-snapshot; the after-snapshot (Step 5) must match it exactly outside `engine.ts`'s own internal structure.

- [ ] **Step 2: Read the two tests this refactor must reproduce exactly**

Two existing tests in `engine.test.ts` pin behavior this refactor must not disturb, and are worth having open while writing the refactor:

- `'engine.ts's own no-handler-registered abort fires for a lint-clean graph whose Engine instance was built without that node's handler'` (around line 1240): asserts `result.notes === 'no handler registered for tool (node work)'` and `result.path` equals `['start', 'work']` — i.e. `this.path.push(node.id)` must have already happened for the node whose handler lookup then fails.
- `'a dead-end node fails the run instead of reporting silent success'` (around line 1114): asserts `/no outgoing edges/i` and that the message names the dead-end node.

Both drive this task's design decision below: node lookup, `path.push`, `current_node` write, and handler lookup all move **inside** `executeNodeStep` (not left in `run()`'s outer wrapper), because `path` must already contain the node by the time the handler-lookup failure is detected.

- [ ] **Step 3: Implement — add `stepCount`, the `StepResult` type, and `executeNodeStep`**

In `plugins/attractor/engine/src/core/engine.ts`, add the new instance field next to the existing `private failedOutputs` field (after line 240):

```ts
  /**
   * Steps taken across the WHOLE run, main loop and every branch (p5-05)
   * alike -- one shared instance field, not a loop-local variable. Without
   * this, a branch containing a routing cycle that never reaches its stop
   * frontier has no bound of its own, and `max_parallel` branches each
   * independently capped at maxSteps would multiply the run-wide ceiling
   * NFR-1 exists to hold. Incremented once per `executeNodeStep` call,
   * whether that call continues to a new node or retries the same one.
   */
  private stepCount = 0
```

Add the `StepResult` type at module scope, above the `Engine` class:

```ts
type StepResult =
  | { kind: 'continue'; nextId: string }
  | { kind: 'stop'; reason: 'exit' | 'frontier' | 'deadend' | 'stepcap'; nodeId: string; outcome: Outcome }
```

Change `private setManaged(key: string, value: string): void` (today's private wrapper, `engine.ts:595-603`) to take the target context explicitly, since it is about to be called from inside `executeNodeStep` against a context that is not always `this.opts.context`:

```ts
  private setManaged(context: Context, key: string, value: string): void {
    if (!isEngineManagedKey(key)) {
      throw new Error(
        `engine built-in context key ${key} is not covered by isEngineManagedKey; ` +
          'register it there so a backend cannot forge it',
      )
    }
    context.set(key, value)
  }
```

Change `private recordOutcome(nodeId: string, outcome: Outcome): void` (`engine.ts:549-580`) to also take the target context, for the same reason (it calls `this.setManaged(...)` internally):

```ts
  private recordOutcome(nodeId: string, outcome: Outcome, context: Context): void {
    const node = this.opts.graph.nodes.get(nodeId)
    if (node !== undefined && wantsVerdict(node)) {
      this.gateOutcomes.set(nodeId, outcome.status)
    }
    if (outcome.status === Status.FAIL) {
      this.nodeFailures.set(nodeId, true)
      this.recordFailedOutputs(nodeId)
    } else if (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) {
      if (this.nodeFailures.has(nodeId)) this.nodeFailures.set(nodeId, false)
      this.clearFailedOutputs(nodeId)
    }
    this.setManaged(context, 'outcome', outcome.status)
    if (outcome.preferredLabel !== undefined && outcome.preferredLabel !== '') {
      this.setManaged(context, 'preferred_label', outcome.preferredLabel)
    }
  }
```

(Every doc comment on `recordOutcome`/`setManaged` in the original stays — only the signature and body's two `context.set`/`this.setManaged` call sites change; carry the comments over verbatim in the real edit.)

Now add the new private method, placed after `recordOutcome`/`recordAbandoned`/`result` and before `run()`:

```ts
  /**
   * Runs exactly one node's step: dispatch (eager-input-check, `runs_on`
   * skip logic, handler call or skip, the RETRY ladder with its two
   * `recordOutcome` calls), then a per-node checkpoint via the exported
   * `saveCheckpoint` directly -- never the private `this.checkpoint()`
   * wrapper, which after this refactor is called only by `run()`'s own
   * EXIT/dead-end/step-cap terminal paths (ADR-012). The ONE seam both
   * `run()`'s own loop and `runBranch` (p5-05) call.
   *
   * Node lookup, `this.path.push`, the `current_node` context write, and
   * handler lookup all live HERE rather than in a caller's wrapper -- see
   * this task's own Step 2: an existing test requires `path` to already
   * contain a node by the moment its handler-lookup failure is reported.
   * Folded into the `'deadend'` stop reason alongside the ordinary
   * "no outgoing edge" case, since from a caller's point of view all three
   * are "this step produced no next node to continue to"; the one accepted,
   * documented behavioural delta is that `run()`'s uniform handling of
   * `'deadend'` always calls `this.checkpoint(null)`, where today's
   * unknown-node/no-handler-registered paths did not -- an extra, harmless
   * checkpoint write on an already-terminal FAIL that no existing test
   * observes.
   */
  private async executeNodeStep(
    currentId: string,
    opts: { runDir: string; cwd: string; maxSteps: number; stopAt?: ReadonlySet<string>; context: Context },
  ): Promise<StepResult> {
    const { graph } = this.opts
    const context = opts.context

    // Checked FIRST, before ANY work for this node -- matches today's
    // `for (let step = 0; step < maxSteps; step++)` loop condition, which
    // skipped the whole iteration body (no path push, no dispatch, nothing)
    // the instant the cap was reached.
    if (++this.stepCount > opts.maxSteps) {
      const capped = `step cap of ${opts.maxSteps} reached without terminating`
      return {
        kind: 'stop',
        reason: 'stepcap',
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: capped, failureReason: capped },
      }
    }

    const node = graph.nodes.get(currentId)
    if (!node) {
      const msg = `unknown node ${currentId}`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg },
      }
    }

    this.path.push(node.id)
    this.setManaged(context, 'current_node', node.id)

    const handler = this.opts.handlers.get(node.handler)
    if (!handler) {
      const msg = `no handler registered for ${node.handler} (node ${node.id})`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: node.id,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg },
      }
    }

    const attempt = this.attempts.get(node.id) ?? 0
    this.events.append({ type: 'node.start', node: node.id })
    context.takeWritten()
    let outcome: Outcome
    const mode = runsOn(node)
    const checksInputs = mode === RunsOn.SUCCESS || wantsVerdict(node)
    const unavailable = checksInputs ? this.unavailableInput(node) : undefined
    if (unavailable) {
      this.events.append({
        type: 'node.input_unavailable',
        node: node.id,
        key: unavailable.key,
        owedBy: unavailable.owedBy,
      })
      outcome = {
        status: Status.FAIL,
        notes: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
        failureReason: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
      }
    } else if (mode === RunsOn.FAILURE && !wantsVerdict(node) && !this.holdsUnresolvedFailure()) {
      this.events.append({ type: 'node.runs_on.skipped', node: node.id, runsOn: mode })
      outcome = {
        status: Status.SUCCESS,
        notes: `${node.id} did not run: runs_on=failure and no failure is outstanding`,
      }
    } else {
      try {
        outcome = await handler.execute({
          node,
          graph,
          context,
          runDir: opts.runDir,
          cwd: opts.cwd,
          events: this.events,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.events.append({ type: 'node.error', node: node.id, message })
        outcome = { status: Status.FAIL, notes: message, failureReason: message }
      }
    }

    for (const key of context.takeWritten()) this.failedOutputs.delete(key)
    this.events.append({ type: 'node.end', node: node.id, status: outcome.status })
    this.recordOutcome(node.id, outcome, context)

    if (outcome.status === Status.RETRY) {
      const policy = resolveRetryPolicy(node, graph)
      if (attempt < policy.maxRetries) {
        this.attempts.set(node.id, attempt + 1)
        const delay = backoffMs(policy, attempt)
        this.events.append({
          type: 'node.retry',
          node: node.id,
          attempt: attempt + 1,
          delayMs: delay,
        })
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        return { kind: 'continue', nextId: node.id }
      }
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      this.events.append({ type: 'node.retry.exhausted', node: node.id, target })
      if (target) {
        this.recordAbandoned(node.id)
        this.attempts.set(node.id, 0)
        return { kind: 'continue', nextId: target }
      }
      outcome = {
        ...outcome,
        status: Status.FAIL,
        notes: `retries exhausted for ${node.id} with no retry target`,
        failureReason: 'max retries exceeded',
      }
    }

    this.recordOutcome(node.id, outcome, context)
    this.attempts.set(node.id, 0)
    if (!this.completed.includes(node.id)) this.completed.push(node.id)

    const cp: Checkpoint = {
      runId: this.opts.runId ?? 'run',
      currentNode: node.id,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: context.snapshot(),
      goalGatesSatisfied: [...this.gateOutcomes]
        .filter(([, s]) => s === Status.SUCCESS || s === Status.PARTIAL)
        .map(([id]) => id),
    }
    saveCheckpoint(opts.runDir, cp)

    if (node.handler === Kind.EXIT) {
      return { kind: 'stop', reason: 'exit', nodeId: node.id, outcome }
    }

    const edge = selectEdge(graph, node.id, context, outcome)

    if (!edge && outcome.status === Status.FAIL) {
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      if (target) {
        this.events.append({ type: 'node.fail.retry_target', node: node.id, target })
        return { kind: 'continue', nextId: target }
      }
    }

    if (!edge) {
      const notes =
        outcome.status === Status.FAIL
          ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ''}`
          : `run terminated at ${node.id}, which has no outgoing edges and is not the exit`
      return {
        kind: 'stop',
        reason: 'deadend',
        nodeId: node.id,
        // status is forced to FAIL here (even when the dispatch's own
        // outcome was SUCCESS/PARTIAL with simply no matching edge) --
        // run()'s own interpretation of 'deadend' never reads
        // outcome.status (it hardcodes Status.FAIL onto its own RunResult
        // regardless), so this is inert for run(); it matters for
        // runBranch (Task 5), whose BranchRunResult.outcome is this object
        // verbatim and whose own contract requires status === FAIL for a
        // true dead end unconditionally.
        outcome: { ...outcome, status: Status.FAIL, notes, failureReason: outcome.failureReason ?? notes },
      }
    }

    if (opts.stopAt?.has(edge.to)) {
      return { kind: 'stop', reason: 'frontier', nodeId: node.id, outcome }
    }

    this.events.append({ type: 'edge.taken', node: node.id, to: edge.to })
    return { kind: 'continue', nextId: edge.to }
  }
```

- [ ] **Step 4: Implement — replace `run()`'s loop with a thin `StepResult` interpreter**

Replace the body of `async run(): Promise<RunResult>` (`engine.ts:605-1094`) with:

```ts
  async run(): Promise<RunResult> {
    const { graph, context } = this.opts
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS

    const diagnostics = lint(graph)
    if (hasErrors(diagnostics)) {
      const detail = diagnostics
        .filter((d) => d.severity === Severity.ERROR)
        .map((d) => `${d.code}${d.node ? ` (${d.node})` : ''}: ${d.message}`)
        .join('; ')
      const msg = `graph carries error-severity lint diagnostics and will not run: ${detail}`
      this.events.append({ type: 'pipeline.end', status: Status.FAIL })
      return this.result(Status.FAIL, msg, msg)
    }

    const startNode = [...graph.nodes.values()].find((n) => n.handler === Kind.START)
    if (!startNode) {
      this.events.append({ type: 'pipeline.end', status: Status.FAIL })
      return this.result(Status.FAIL, 'graph has no start node', 'graph has no start node')
    }

    for (const [k, v] of Object.entries(graph.attrs)) {
      if (!context.has(k)) context.set(k, v)
      const qualified = `graph.${k}`
      if (!context.has(qualified)) this.setManaged(context, qualified, v)
    }

    let currentId: string | null = startNode.id
    this.events.append({ type: 'pipeline.start', node: startNode.id })

    while (currentId !== null) {
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: this.opts.runDir,
        cwd: this.opts.cwd,
        maxSteps,
        stopAt: undefined,
        context,
      })

      if (stepResult.kind === 'continue') {
        currentId = stepResult.nextId
        continue
      }

      // 'stop'. 'frontier' never occurs here: run() never supplies stopAt,
      // so executeNodeStep can never produce it for this caller -- the same
      // "additive, inert for every current call site" pattern ADR-008/
      // ADR-009 established elsewhere in this codebase.
      const { reason, nodeId, outcome } = stepResult

      if (reason === 'exit') {
        const unsatisfied = this.unsatisfiedGoalGates()
        if (unsatisfied.length > 0) {
          const target = this.gateRetryTarget(unsatisfied)
          this.events.append({
            type: 'pipeline.goal_gate_block',
            node: nodeId,
            unsatisfied,
            target,
          })
          if (target) {
            currentId = target
            continue
          }
          this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.FAIL })
          this.checkpoint(null)
          return this.result(
            Status.FAIL,
            `exit reached with unsatisfied goal gates: ${unsatisfied.join(', ')}`,
            'Goal gate unsatisfied and no retry target',
          )
        }

        const failed = this.unresolvedFailures()
        if (failed.length > 0) {
          this.events.append({ type: 'pipeline.unresolved_failure', node: nodeId, failed })
        }

        this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.SUCCESS })
        this.checkpoint(null)
        return this.result(
          Status.SUCCESS,
          failed.length > 0
            ? `exit reached with unresolved node failures: ${failed.join(', ')}`
            : outcome.notes,
        )
      }

      // 'deadend' and 'stepcap' both carry a fully-formatted
      // outcome.notes/failureReason from executeNodeStep -- 'deadend'
      // pre-formats the exact text the old inline `!edge` block built
      // locally (including the two pre-dispatch pathological cases); the
      // checkpoint argument is the one place the two still differ, matching
      // engine.ts's own pre-refactor behaviour exactly (a step-cap
      // checkpoint names the not-yet-dispatched node; a dead-end checkpoints
      // null).
      this.events.append({ type: 'pipeline.end', node: nodeId, status: Status.FAIL })
      this.checkpoint(reason === 'stepcap' ? nodeId : null)
      return this.result(Status.FAIL, outcome.notes, outcome.failureReason)
    }

    // currentId === null: dead code today (nothing in this method ever
    // assigns it), kept only because the type allows it and a defensive
    // guard costs nothing.
    return this.result(
      Status.FAIL,
      'run terminated with no current node',
      'run terminated with no current node',
    )
  }
```

- [ ] **Step 5: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 508 tests, 507 passing, 1 skipped, 0 failing — identical to Step 1's baseline, in particular:
- `'engine.ts's own no-handler-registered abort fires...'` still asserts `result.notes === 'no handler registered for tool (node work)'` and `result.path` equals `['start', 'work']`.
- `'a dead-end node fails the run instead of reporting silent success'` still asserts `/no outgoing edges/i` and `result.path` equals `['start', 'a']`.
- Every checkpoint-content, retry-ladder, goal-gate, and step-cap test in `engine.test.ts`, `box.test.ts`, `tool.test.ts`, and `cli.test.ts` passes unmodified.

If anything outside `engine.ts` needed a changed assertion to pass, that is a real regression — stop and report it rather than editing the test.

- [ ] **Step 6: Commit**

```bash
git add plugins/attractor/engine/src/core/engine.ts
git commit -m "$(cat <<'EOF'
engine: extract Engine#executeNodeStep as the one shared per-node step (p5-02)

run()'s loop is now a thin StepResult interpreter over a new private
executeNodeStep method -- the single place a node is dispatched, retried,
recordOutcome'd (twice, existing order) and checkpointed. A new stepCount
instance field replaces the loop-local step variable, closing an unbounded
single-branch-cycle hang risk for the not-yet-built runBranch (p5-05), which
will be a thin caller of this same method rather than a second,
independently maintained copy (ADR-012).

Extends executeNodeStep's opts with a required `context: Context` field
beyond the story's own literal contract -- necessary so a future branch's
per-call context stays isolated by value rather than racing on a shared
mutable this.opts.context swap point once branches run concurrently.

Zero observable behaviour change: full regression suite passes with no
assertion changes outside engine.ts itself.
EOF
)"
```

---

### Task 3: Plumb a per-call cwd through Backend.run() so isolated CODERGEN branches actually isolate

**Files:**
- Modify: `plugins/attractor/engine/src/handlers/types.ts:31-33` (`Backend.run()` signature)
- Modify: `plugins/attractor/engine/src/backend/claude.ts:102-137` (`ClaudeCodeBackend.run()`)
- Modify: `plugins/attractor/engine/src/handlers/box.ts:96-102` (`BoxHandler.execute`'s `this.backend.run(...)` call)
- Test: `plugins/attractor/engine/test/claude-backend.test.ts`, `plugins/attractor/engine/test/box.test.ts`

**Interfaces:**
- Consumes: nothing new from another task (independent of Tasks 1, 2, 4 — touches only `types.ts`, `claude.ts`, `box.ts`).
- Produces (relied on by `p5-08`, a future sprint, not by any task in this plan):
  ```ts
  // handlers/types.ts
  export interface Backend {
    run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal,
        cwd?: string): Promise<Outcome>   // NEW optional trailing param, additive
  }
  ```

- [ ] **Step 1: Write the failing test — `ClaudeCodeBackend` prefers a per-call cwd**

Add to `plugins/attractor/engine/test/claude-backend.test.ts` (the file already imports `mkdtempSync`/`rmSync`/`join`/`tmpdir`, `ClaudeCodeBackend`, `Context`, `Status`, `Handler`/`Graph`/`Node`, and has the `fakeClaude`/`withDir`/`node`/`GRAPH` helpers at the top — reuse them, do not duplicate):

```ts
test('a per-call cwd overrides the constructor-bound cwd', async () => {
  await withDir(async (dir) => {
    const other = mkdtempSync(join(tmpdir(), 'attractor-claude-other-'))
    try {
      const cmd = fakeClaude(
        dir,
        `pwd > "${join(dir, 'cwd-used.txt')}"\nprintf '{"is_error":false,"result":"ok"}'`,
      )
      const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
      await backend.run(node(), 'p', Context.from({}), GRAPH, undefined, other)

      const { readFileSync, realpathSync } = await import('node:fs')
      const used = readFileSync(join(dir, 'cwd-used.txt'), 'utf8').trim()
      assert.equal(used, realpathSync(other), 'the subprocess ran in the per-call cwd, not the constructor one')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

test('ClaudeCodeBackend falls back to the constructor-bound cwd when no per-call cwd is given', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(
      dir,
      `pwd > "${join(dir, 'cwd-used.txt')}"\nprintf '{"is_error":false,"result":"ok"}'`,
    )
    const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
    await backend.run(node(), 'p', Context.from({}), GRAPH)

    const { readFileSync, realpathSync } = await import('node:fs')
    const used = readFileSync(join(dir, 'cwd-used.txt'), 'utf8').trim()
    assert.equal(used, realpathSync(dir), 'the existing 4-arg call shape is unchanged')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/claude-backend.test.ts`
Expected: `'a per-call cwd overrides the constructor-bound cwd'` fails — `Backend.run()`'s call today only accepts 5 positional arguments and `ClaudeCodeBackend.run()`'s implementation ignores a 6th, spawning the fake `claude` in `this.opts.cwd` (i.e. `dir`) regardless, so `used` equals `realpathSync(dir)`, not `realpathSync(other)`. The fallback test passes already (it exercises today's existing behavior) — that is fine; it becomes the pinned regression case once the new parameter exists.

- [ ] **Step 3: Implement — add the optional `cwd` parameter**

`plugins/attractor/engine/src/handlers/types.ts:31-33`, change:

```ts
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal,
      cwd?: string): Promise<Outcome>
}
```

`plugins/attractor/engine/src/backend/claude.ts:102-137`, change the `run` method's signature and its one use of `this.opts.cwd`:

```ts
  async run(
    node: Node,
    prompt: string,
    _context: Context,
    _graph: Graph,
    signal?: AbortSignal,
    cwd?: string,
  ): Promise<Outcome> {
    const command = this.opts.command ?? 'claude'
    const argv = buildArgv(node, {
      ...this.opts,
      resumeId: this.threads.resumeIdFor(node),
    })

    const proc = await runProcess(command, argv, prompt, cwd ?? this.opts.cwd, signal)
    // ... rest of the method is unchanged ...
```

(Only the `run(...)` parameter list and the `runProcess(...)` call's fourth argument change, from `this.opts.cwd` to `cwd ?? this.opts.cwd`; everything else in the method is untouched.)

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/claude-backend.test.ts`
Expected: both new tests pass.

- [ ] **Step 5: Write the failing test — `BoxHandler` passes `ctx.cwd` through**

Add to `plugins/attractor/engine/test/box.test.ts` (which already imports `Graph`/`Node` from `dot/graph.ts`, `Context`, `Status`/`Outcome`, `EventLog`, `type Backend`, `BoxHandler`, and has the module-level `G` fixture with a `plain` box node):

```ts
test("BoxHandler passes ctx.cwd through to Backend.run's new trailing argument", async () => {
  const received: (string | undefined)[] = []
  class CapturingBackend implements Backend {
    async run(
      _node: Node, _prompt: string, _context: Context, _graph: Graph,
      _signal?: AbortSignal, cwd?: string,
    ): Promise<Outcome> {
      received.push(cwd)
      return { status: Status.SUCCESS, notes: 'ok' }
    }
  }
  const runDir = mkdtempSync(join(tmpdir(), 'attractor-box-cwdpass-run-'))
  const cwd = mkdtempSync(join(tmpdir(), 'attractor-box-cwdpass-cwd-'))
  try {
    await new BoxHandler(new CapturingBackend()).execute({
      node: G.nodes.get('plain')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir,
      cwd,
      events: new EventLog(runDir),
    })
    assert.equal(received[0], cwd, "Backend.run's cwd argument matches HandlerCtx.cwd")
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a Backend.run() call with no cwd argument (StubBackend\'s 4-arg shape) is unaffected', async () => {
  // StubBackend.run(node, prompt, context, graph) has no cwd parameter at
  // all -- proves the additive change is inert for a shorter implementer,
  // the same way the existing suite already proves it for every other
  // StubBackend-driven box.test.ts case.
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'ok' } })
  const outcome = await run('plain', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})
```

- [ ] **Step 6: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/box.test.ts`
Expected: `"BoxHandler passes ctx.cwd through to Backend.run's new trailing argument"` fails — `received[0]` is `undefined` because `BoxHandler.execute` does not yet pass a sixth argument. The `StubBackend` 4-arg-shape test passes already (nothing changed for it yet); it is included here as the explicit pin for that acceptance-criteria row, not as a new red case.

- [ ] **Step 7: Implement — `BoxHandler` passes `ctx.cwd`**

`plugins/attractor/engine/src/handlers/box.ts:96-102`, change:

```ts
    let outcome: Outcome
    try {
      outcome = await this.backend.run(
        ctx.node,
        prompt,
        ctx.context,
        ctx.graph,
        controller?.signal ?? ctx.signal,
        ctx.cwd,
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
```

(Only the trailing `ctx.cwd` argument is added; every other line in `execute` is untouched.)

- [ ] **Step 8: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/box.test.ts`
Expected: both new tests pass; every pre-existing `box.test.ts` test (all built on `StubBackend`, a 4-arg implementer) still passes unmodified.

- [ ] **Step 9: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing, test count up by 4 relative to baseline (two `claude-backend.test.ts` cases, two `box.test.ts` cases).

- [ ] **Step 10: Commit**

```bash
git add plugins/attractor/engine/src/handlers/types.ts \
        plugins/attractor/engine/src/backend/claude.ts \
        plugins/attractor/engine/src/handlers/box.ts \
        plugins/attractor/engine/test/claude-backend.test.ts \
        plugins/attractor/engine/test/box.test.ts
git commit -m "$(cat <<'EOF'
engine: plumb a per-call cwd through Backend.run() (p5-03)

Backend.run() gains an optional trailing cwd parameter; ClaudeCodeBackend
prefers it over its constructor-bound cwd, falling back when omitted;
BoxHandler now passes ctx.cwd through. Closes a real, previously-latent gap:
without this, a CODERGEN node inside a future isolated branch worktree would
silently keep running against the run's single constructor-bound directory
-- the dominant node kind in a parallel fan-out sharing one filesystem
across concurrent branches, reopening the exact race worktree-per-branch
isolation exists to prevent (ADR-008). Additive at the type level
(structural typing keeps every shorter existing Backend implementer, e.g.
StubBackend, valid unmodified) -- verified functionally inert for it too.
EOF
)"
```

---

### Task 4: Add findConvergenceNode/findPartialReconvergence and lint rules PAR-001/PAR-002/PAR-004

**Files:**
- Modify: `plugins/attractor/engine/src/dot/graph.ts` (new exported functions, appended after `effectiveOutputs`)
- Modify: `plugins/attractor/engine/src/dot/lint.ts` (new block in the per-node loop, immediately after the `HAND-001` block at `lint.ts:514-529`, before `HITL-003`)
- Modify: `plugins/attractor/engine/test/lint.test.ts`
- Modify: `plugins/attractor/README.md` (`## Lint rules`, `lint.ts:242-263`-equivalent section)

**Interfaces:**
- Consumes: nothing new from another task (independent of Tasks 1, 2, 3, 5 — touches only `graph.ts`/`lint.ts`/tests/README).
- Produces (`p5-06`/Task 6 and any later `p5-08` reference call these verbatim):
  ```ts
  // dot/graph.ts — NEW
  export function findConvergenceNode(graph: Graph, branchRootIds: readonly string[]): string | null
  export function findPartialReconvergence(
    graph: Graph, branchRootIds: readonly string[], convergenceId: string | null,
  ): string[]
  ```

- [ ] **Step 1: Write the failing tests for `findConvergenceNode`/`findPartialReconvergence`**

Add a new `import` and test block to `plugins/attractor/engine/test/lint.test.ts` (which already imports `parseDot`, `lint`/`hasErrors`/`Severity`, `Handler`, and has the `codes()` helper — reuse it):

```ts
import {
  Handler,
  INFERRED_OUTPUTS_BY_HANDLER,
  UNREGISTERED_HANDLER_KINDS,
  findConvergenceNode,
  findPartialReconvergence,
  type Graph,
  type Node,
} from '../src/dot/graph.ts'

// ---------------------------------------------------------------------------
// findConvergenceNode / findPartialReconvergence (dot/graph.ts) -- pure
// functions, no lint() involved yet.
// ---------------------------------------------------------------------------

test('findConvergenceNode: multi-hop convergence returns the shallowest common descendant', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan  [shape=component]
    a [shape=box]  b [shape=box]  mid [shape=box]  join [shape=box]
    start -> fan
    fan -> a -> mid -> join -> done
    fan -> b -> join
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), 'join')
})

test('findConvergenceNode: branches that never reconverge return null', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan  [shape=component]
    a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), null)
})

test('findConvergenceNode: single-branch degenerate returns the one root\'s nearest descendant', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]
    start -> fan -> a -> done
  }`)
  assert.equal(findConvergenceNode(g, ['a']), 'done')
})

test('findConvergenceNode: convergence at the graph\'s real EXIT node', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done
    fan -> b -> done
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), 'done')
})

test('findConvergenceNode: a root reachable from another root resolves past it, not to it', () => {
  // root1 -> root2 is a legal DOT shape (one branch's own path happens to
  // pass through another branch's root). Roots are never valid convergence
  // candidates, so the function must skip over root2 and find `shared`, the
  // real non-root common descendant -- not error, and not return root2.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    root1 [shape=box]  root2 [shape=box]  shared [shape=box]
    start -> fan
    fan -> root1 -> root2
    fan -> root2
    root2 -> shared -> done
  }`)
  assert.equal(findConvergenceNode(g, ['root1', 'root2']), 'shared')
})

test('findPartialReconvergence: the "normalize" shared-step shape (F3)', () => {
  // Two of three branches share `normalize` before the real convergence
  // node `combine` -- a node reachable from 2 of 3 roots, not all.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  r3 [shape=box]
    normalize [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> normalize
    fan -> r2 -> normalize
    fan -> r3 -> combine
    normalize -> combine -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2', 'r3'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['r1', 'r2', 'r3'], convergenceId), ['normalize'])
})

test('findPartialReconvergence: tied full-common-descendant shape (F3 residual, ADR-007 amendment)', () => {
  // Both X and Y are common to EVERY root at the same depth -- the "diamond
  // of diamonds" shape. findConvergenceNode picks one (whichever wins the
  // unspecified tie-break); findPartialReconvergence must still flag the
  // other, because it too is reachable from every branch root and could
  // still be double-dispatched.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]
    x [shape=box]  y [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> x
    fan -> r1 -> y
    fan -> r2 -> x
    fan -> r2 -> y
    x -> combine -> done
    y -> combine
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.ok(convergenceId === 'x' || convergenceId === 'y', 'the shallower tied node wins the tie-break')
  const other = convergenceId === 'x' ? 'y' : 'x'
  const partial = findPartialReconvergence(g, ['r1', 'r2'], convergenceId)
  assert.ok(
    partial.includes(other),
    'the sibling that lost the tie-break must still be flagged -- a pre-amendment ' +
      '("but not all") rule would miss it, since it is reachable from EVERY root',
  )
})

test('findPartialReconvergence: disjoint branches produce no false positive', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> combine
    fan -> r2 -> combine
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['r1', 'r2'], convergenceId), [])
})

test('findPartialReconvergence: a node genuinely downstream of convergence is never flagged', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  mid [shape=box]  after [shape=box]
    start -> fan
    fan -> r1 -> mid
    fan -> r2 -> mid
    mid -> after -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.equal(convergenceId, 'mid')
  assert.deepEqual(
    findPartialReconvergence(g, ['r1', 'r2'], convergenceId), [],
    'after is only reachable BY GOING THROUGH mid -- the truncated BFS never expands past it, so it is dead code by construction',
  )
})

test('findPartialReconvergence: a null convergenceId returns empty, not an error', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`)
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], null), [])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every new test above fails with an import/reference error (`findConvergenceNode`/`findPartialReconvergence` do not exist in `dot/graph.ts` yet). Every pre-existing `lint.test.ts` test still passes.

- [ ] **Step 3: Implement — add the two functions to `dot/graph.ts`**

Append to `plugins/attractor/engine/src/dot/graph.ts`, after `effectiveOutputs` (the current last export, ending at line 461):

```ts
/**
 * Nodes reachable from `startId` via ONE OR MORE edges (never `startId`
 * itself, unless a genuine cycle leads back to it), mapped to the shortest
 * distance at which each was first reached. Condition-independent --
 * follows every outgoing edge regardless of whether its condition would
 * actually fire at runtime, the same conservative-lint-over-precise-runtime
 * tradeoff `directPredecessor`/DATA-001 already accept.
 */
function reachableWithDepth(graph: Graph, startId: string): Map<string, number> {
  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const e of outgoingEdges(graph, startId)) {
    if (!depth.has(e.to)) {
      depth.set(e.to, 1)
      queue.push(e.to)
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string
    const curDepth = depth.get(cur) as number
    for (const e of outgoingEdges(graph, cur)) {
      if (!depth.has(e.to)) {
        depth.set(e.to, curDepth + 1)
        queue.push(e.to)
      }
    }
  }
  return depth
}

/**
 * Earliest node reachable from EVERY branch root (excluding the roots
 * themselves -- a root is never a valid convergence candidate, even one
 * reachable from a sibling root), by static reachability over ALL outgoing
 * edges regardless of condition truth. Shallowest common descendant wins
 * ties, ranked by the FURTHEST root's distance to it (its own worst case);
 * the exact tie-break among equally-shallow candidates is otherwise
 * unspecified -- safe because `findPartialReconvergence` refuses every graph
 * where a tie would matter (ADR-007's amendment). `null` if branches never
 * reconverge.
 */
export function findConvergenceNode(graph: Graph, branchRootIds: readonly string[]): string | null {
  if (branchRootIds.length === 0) return null
  const rootSet = new Set(branchRootIds)
  const depthMaps = branchRootIds.map((id) => reachableWithDepth(graph, id))

  let candidates: string[] = [...depthMaps[0].keys()].filter((id) => !rootSet.has(id))
  for (let i = 1; i < depthMaps.length; i++) {
    candidates = candidates.filter((id) => depthMaps[i].has(id))
  }
  if (candidates.length === 0) return null

  let best: string | null = null
  let bestDepth = Infinity
  for (const id of candidates) {
    const worstCase = Math.max(...depthMaps.map((dm) => dm.get(id) as number))
    if (worstCase < bestDepth) {
      bestDepth = worstCase
      best = id
    }
  }
  return best
}

/**
 * Nodes reachable from two or more of the given branch roots -- of ANY
 * count, including every root -- where reachability from each root is
 * truncated at (does not expand past) `convergenceId`. Excludes the roots
 * and `convergenceId` itself. Empty when `convergenceId` is `null` (PAR-001
 * already refuses that graph) or every branch's truncated reachable set is
 * disjoint from every other's.
 */
export function findPartialReconvergence(
  graph: Graph,
  branchRootIds: readonly string[],
  convergenceId: string | null,
): string[] {
  if (convergenceId === null) return []
  const rootSet = new Set(branchRootIds)

  const truncatedSets = branchRootIds.map((rootId) => {
    const seen = new Set<string>([rootId])
    const queue = [rootId]
    while (queue.length > 0) {
      const cur = queue.shift() as string
      if (cur === convergenceId) continue // do not expand past convergence
      for (const e of outgoingEdges(graph, cur)) {
        if (!seen.has(e.to)) {
          seen.add(e.to)
          queue.push(e.to)
        }
      }
    }
    return seen
  })

  const counts = new Map<string, number>()
  for (const set of truncatedSets) {
    for (const id of set) {
      if (id === convergenceId || rootSet.has(id)) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([id]) => id)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every test from Step 1 passes.

- [ ] **Step 5: Write the failing tests for PAR-001/PAR-002/PAR-004**

Append to `plugins/attractor/engine/test/lint.test.ts`:

```ts
// ---------------------------------------------------------------------------
// PAR-001 / PAR-002 / PAR-004: Handler.PARALLEL fan-out shape, reusing
// findConvergenceNode/findPartialReconvergence above. Co-fire with HAND-001
// -- Handler.PARALLEL stays in UNREGISTERED_HANDLER_KINDS until p5-08.
// ---------------------------------------------------------------------------

test('PAR-001 fires ERROR when a component node has no discoverable convergence node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`
  const found = codes(src)
  assert.ok(found.includes('PAR-001'))
  assert.ok(found.includes('HAND-001'), 'PAR-001 co-fires with HAND-001, never suppresses it')
  const diag = lint(parseDot(src)).find((d) => d.code === 'PAR-001')
  assert.equal(diag?.severity, Severity.ERROR)
})

test('PAR-001 does not fire when a genuine convergence node exists; HAND-001 still fires alone', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]  join [shape=box]
    start -> fan
    fan -> a -> join
    fan -> b -> join
    join -> done
  }`
  const found = codes(src)
  assert.ok(!found.includes('PAR-001'))
  assert.ok(found.includes('HAND-001'))
})

test('PAR-002 fires WARNING only on exactly one outgoing edge, never with PAR-001/PAR-004, and co-fires with HAND-001 without either suppressing the other', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]
    start -> fan -> a -> done
  }`
  const diags = lint(parseDot(src))
  const par002 = diags.find((d) => d.code === 'PAR-002')
  assert.ok(par002)
  assert.equal(par002?.severity, Severity.WARNING)
  assert.ok(!diags.some((d) => d.code === 'PAR-001'))
  assert.ok(!diags.some((d) => d.code === 'PAR-004'))
  assert.ok(
    diags.some((d) => d.code === 'HAND-001'),
    'the negative-control row: PAR-002 (WARNING) must not suppress HAND-001 (ERROR), and vice versa -- Handler.PARALLEL is still unregistered',
  )
})

test('a component node with zero outgoing edges fires neither PAR-001 nor PAR-002 nor PAR-004', () => {
  // TOPO-006 already refuses a non-exit node with no outgoing edge --
  // deliberately not a PAR-* concern.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    start -> fan
  }`
  const found = codes(src)
  assert.ok(!found.includes('PAR-001'))
  assert.ok(!found.includes('PAR-002'))
  assert.ok(!found.includes('PAR-004'))
})

test('PAR-004 fires ERROR on the exact "normalize" shared-step fixture (F3)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  r3 [shape=box]
    normalize [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> normalize
    fan -> r2 -> normalize
    fan -> r3 -> combine
    normalize -> combine -> done
  }`
  const diags = lint(parseDot(src))
  const par004 = diags.find((d) => d.code === 'PAR-004')
  assert.ok(par004, 'a rule that only checks findConvergenceNode() === null misses this -- convergence DOES exist (combine)')
  assert.equal(par004?.severity, Severity.ERROR)
  assert.ok(diags.some((d) => d.code === 'HAND-001'))
})

test('PAR-004 fires ERROR on the tied-full-common-descendant fixture (ADR-007 amendment)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]
    x [shape=box]  y [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> x
    fan -> r1 -> y
    fan -> r2 -> x
    fan -> r2 -> y
    x -> combine -> done
    y -> combine
  }`
  const diags = lint(parseDot(src))
  assert.ok(
    diags.some((d) => d.code === 'PAR-004'),
    'a pre-amendment ("but not all") rule would NOT fire here -- the sibling that lost the ' +
      'tie-break is reachable from EVERY root, not a proper subset -- proving the broadening is real',
  )
})

test('PAR-004 does not false-positive on disjoint branches', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> combine
    fan -> r2 -> combine
  }`
  assert.ok(!codes(src).includes('PAR-004'))
})

test('PAR-004 does not fire for a node genuinely downstream of the convergence node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  mid [shape=box]  after [shape=box]
    start -> fan
    fan -> r1 -> mid
    fan -> r2 -> mid
    mid -> after -> done
  }`
  assert.ok(!codes(src).includes('PAR-004'))
})
```

- [ ] **Step 6: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every PAR-001/PAR-002/PAR-004 test fails (the codes never appear, since `lint.ts` does not emit them yet); the negative-control tests (`PAR-002 fires... never with PAR-001/PAR-004`, `zero outgoing edges`, `PAR-004 does not false-positive...`, `does not fire for a node genuinely downstream...`) already pass vacuously today (the codes are absent because nothing emits them at all yet) — they become real once the rule exists, and Step 8's full pass is what proves they hold for the RIGHT reason.

- [ ] **Step 7: Implement — add the PAR-001/PAR-002/PAR-004 block to `dot/lint.ts`**

Add the import in `plugins/attractor/engine/src/dot/lint.ts`'s existing `from './graph.ts'` import block (`lint.ts:1-17`):

```ts
import {
  type Graph,
  Handler,
  INFERRED_OUTPUTS_BY_HANDLER,
  TYPE_TO_HANDLER,
  PASSTHROUGH_KINDS,
  RUNS_ON_MODES,
  RunsOn,
  runsOn,
  declaredOutputs,
  directPredecessor,
  effectiveOutputs,
  findByHandler,
  findConvergenceNode,
  findPartialReconvergence,
  outgoingEdges,
  substitutableText,
  UNREGISTERED_HANDLER_KINDS,
} from './graph.ts'
```

Insert the new block into the per-node loop (`for (const node of graph.nodes.values()) { ... }`), immediately after the existing `HAND-001` block (which ends at `lint.ts:529`) and before the `HITL-003` block:

```ts
    // PAR-001 / PAR-002 / PAR-004: a Handler.PARALLEL (`component`/
    // `type="parallel"`) node's fan-out shape. Pure static analysis over
    // findConvergenceNode/findPartialReconvergence (dot/graph.ts) -- the
    // SAME functions the runtime (p5-05's runBranch, p5-08's eventual
    // ParallelHandler) reuses, so lint and runtime cannot disagree about
    // where branches reconverge. Fires alongside HAND-001 above
    // (Handler.PARALLEL stays in UNREGISTERED_HANDLER_KINDS until p5-08
    // removes it) -- this refuses the SHAPE of a fan-out regardless of
    // whether a handler exists yet to run it.
    if (node.handler === Handler.PARALLEL) {
      const branchRootIds = outgoingEdges(graph, node.id).map((e) => e.to)
      if (branchRootIds.length === 1) {
        diags.push({
          code: 'PAR-002',
          severity: Severity.WARNING,
          node: node.id,
          message:
            `node ${node.id} is a parallel fan-out (Handler.PARALLEL) with exactly one ` +
            `outgoing edge, to ${branchRootIds[0]} -- a fan-out of one branch runs no ` +
            `differently than an ordinary edge would, so this is likely not what was intended`,
        })
      } else if (branchRootIds.length >= 2) {
        const convergenceId = findConvergenceNode(graph, branchRootIds)
        if (convergenceId === null) {
          diags.push({
            code: 'PAR-001',
            severity: Severity.ERROR,
            node: node.id,
            message:
              `node ${node.id} fans out to ${branchRootIds.join(', ')}, but no node is ` +
              `reachable from every branch -- there is nowhere for the pipeline to resume ` +
              `after the fan-out. Add a node every branch's path leads to, or route two of ` +
              `the branches back together`,
          })
        } else {
          const partial = findPartialReconvergence(graph, branchRootIds, convergenceId)
          if (partial.length > 0) {
            diags.push({
              code: 'PAR-004',
              severity: Severity.ERROR,
              node: node.id,
              message:
                `node ${node.id} fans out to ${branchRootIds.join(', ')}, converging on ` +
                `${convergenceId} -- but ${partial.join(', ')} ` +
                `${partial.length === 1 ? 'is' : 'are'} also reachable from two or more of ` +
                `those branches before ${convergenceId}. A node reached this way could be ` +
                `dispatched twice, once per branch that reaches it -- route every branch ` +
                `through a single shared node before ${convergenceId}, or restructure so ` +
                `only ${convergenceId} is shared`,
            })
          }
        }
      }
    }
```

- [ ] **Step 8: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every test added in Steps 1 and 5 passes.

- [ ] **Step 9: Update `README.md`'s `## Lint rules` section**

In `plugins/attractor/README.md`, extend the existing dense rule-list paragraph (`README.md:242-260`) by inserting a new sentence after the `HITL-003` clause and before the closing period, and add `PAR-002` to the warnings sentence that follows it:

```
Old:
predecessor (self-report risk for the `agent` channel -- see ADR-006).

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001` and `HITL-003` are warnings; the
rest are errors, and `attractor run` refuses a graph with any error.

New:
predecessor (self-report risk for the `agent` channel -- see ADR-006);
`PAR-001` a `component`/`Handler.PARALLEL` node with no discoverable
convergence node; `PAR-002` a `component` node whose fan-out is a
single-edge no-op; `PAR-004` partial reconvergence -- a node other than the
chosen convergence node (including one that merely lost a depth tie for it)
reachable from two or more branch roots.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003` and `PAR-002` are
warnings; the rest are errors, and `attractor run` refuses a graph with any
error.
```

- [ ] **Step 10: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing, test count up by 18 relative to baseline (10 from Step 1, 8 from Step 5).

- [ ] **Step 11: Commit**

```bash
git add plugins/attractor/engine/src/dot/graph.ts \
        plugins/attractor/engine/src/dot/lint.ts \
        plugins/attractor/engine/test/lint.test.ts \
        plugins/attractor/README.md
git commit -m "$(cat <<'EOF'
engine: add findConvergenceNode/findPartialReconvergence, PAR-001/002/004 (p5-04)

findConvergenceNode discovers the earliest node reachable from every branch
root of a Handler.PARALLEL fan-out -- where the pipeline resumes after the
fan-out, computed once by static reachability rather than declared by an
attribute (ADR-007). findPartialReconvergence catches a node reachable from
two or more (not necessarily all) branch roots before that point, including
-- per ADR-007's fifth-pass amendment -- one reachable from EVERY root that
merely lost a depth tie for the chosen convergence node itself (a real
double-dispatch race the pre-amendment "but not all" wording missed).

PAR-001 (ERROR) refuses a fan-out with no discoverable convergence node;
PAR-002 (WARNING) flags a structurally no-op single-edge fan-out; PAR-004
(ERROR) refuses partial reconvergence. All three co-fire with HAND-001 --
Handler.PARALLEL stays in UNREGISTERED_HANDLER_KINDS until a future sprint
(p5-08) builds ParallelHandler and removes it.
EOF
)"
```

---

### Task 5: Give handlers a runBranch seam that runs a bounded sub-traversal on the run's own ledgers

**Files:**
- Modify: `plugins/attractor/engine/src/handlers/types.ts` (new `BranchRunOptions`/`BranchRunResult` interfaces, new `HandlerCtx.runBranch` field)
- Modify: `plugins/attractor/engine/src/core/engine.ts` (new private `runBranch` method; one edit to `executeNodeStep`'s existing dispatch call, added in Task 2)
- Test: `plugins/attractor/engine/test/engine.test.ts` (new section, appended at the end of the file)

**Interfaces:**
- Consumes: `executeNodeStep(currentId, opts)` (Task 2, verbatim signature including the `context: Context` field); `GatedBackend` (Task 1, from `test/fixtures.ts`).
- Produces (Task 7 extends `BranchRunResult` with a `context` field — do not add it here):
  ```ts
  // handlers/types.ts
  export interface BranchRunOptions {
    startNodeId: string
    stopAt: ReadonlySet<string>
    context: Context
    runDir: string
    cwd: string
  }
  export interface BranchRunResult {
    outcome: Outcome
    path: string[]
    // Task 7 (p5-07) adds a `context: Record<string, string>` field here.
  }
  export interface HandlerCtx {
    // ...unchanged fields...
    runBranch?: (opts: BranchRunOptions) => Promise<BranchRunResult>
  }
  ```

  **Design note, applied consistently and documented here rather than silently: `BranchRunOptions.runDir` is genuinely branch-scoped for `saveCheckpoint`'s own output (`executeNodeStep`'s existing `saveCheckpoint(opts.runDir, cp)` call, Task 2) and for whatever per-node artifacts a handler itself writes under `join(ctx.runDir, ctx.node.id)` (e.g. `BoxHandler`'s `prompt.md`/`status.json`/`response.md`) — but NOT for `EventLog`: `this.events` is constructed once, in `Engine`'s constructor, bound to the run's own `runDir` for the whole lifetime of the instance, and both `run()`'s own steps and every branch's steps append to that SAME `EventLog` (via the SAME `this.events.append(...)` calls already inside `executeNodeStep`). Unlike `Context` (Task 2's reasoning), interleaved writes from concurrent branches are harmless here — `EventLog.append` is a single synchronous `appendFileSync` call per event, so concurrent callers merely interleave distinguishable lines in one shared, append-only audit trail, never corrupt one. A single unified `events.jsonl` for the whole run, branches included, is also more useful to an operator than fragmented per-branch logs they would otherwise have to stitch back together. No code change follows from this — it is purely a clarification of what "branch-scoped runDir" does and does not cover.**

- [ ] **Step 1: Add `BranchRunOptions`/`BranchRunResult`/`HandlerCtx.runBranch` to `handlers/types.ts`**

Read `plugins/attractor/engine/src/handlers/types.ts` first (32 lines today). Replace its contents with:

```ts
import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'

/**
 * A bounded forward traversal of the same graph a handler's dispatch is
 * itself part of, starting at `startNodeId`, stopping at `stopAt`, the
 * graph's real EXIT node, or a dead end -- populated by `Engine.run()` on
 * every dispatch, via `HandlerCtx.runBranch` below. Runs against the same
 * Engine instance's own shared ledgers (`gateOutcomes`/`nodeFailures`/
 * `failedOutputs`/the step-cap counter), never an independent nested
 * `Engine` -- see `core/engine.ts`'s private `runBranch` method for why.
 */
export interface BranchRunOptions {
  startNodeId: string
  /** The branch halts BEFORE dispatching any node in this set. */
  stopAt: ReadonlySet<string>
  /** Caller-supplied, already `Context.clone()`'d -- isolates this branch's writes. */
  context: Context
  /** Branch-scoped subdir -- own checkpoint.json and per-node artifacts. */
  runDir: string
  /** Branch worktree path, or the component node's own cwd. */
  cwd: string
}

export interface BranchRunResult {
  outcome: Outcome
  path: string[]
}

export interface HandlerCtx {
  node: Node
  graph: Graph
  context: Context
  /** Directory holding this run's checkpoint, events and per-node artifacts. */
  runDir: string
  /** Working directory for shell commands and LLM workers. */
  cwd: string
  events: EventLog
  /**
   * Cancellation for whatever a handler dispatches. Unused today; the seam
   * exists so Plan 2's subprocess backend does not require touching this
   * interface, every handler and every test a second time to add it later.
   */
  signal?: AbortSignal
  /**
   * Run a bounded sub-traversal of the same graph, starting at any node id,
   * against this run's own shared ledgers. Engine-populated on every
   * dispatch; undefined only for a hand-built `HandlerCtx` a test constructs
   * without going through `Engine.run()`.
   */
  runBranch?: (opts: BranchRunOptions) => Promise<BranchRunResult>
}

export interface Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}

/**
 * The single seam between the control plane and whatever executes an LLM
 * task. Plan 2 supplies a `claude -p` implementation; tests supply a stub.
 */
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal, cwd?: string): Promise<Outcome>
}
```

- [ ] **Step 2: Write the failing tests**

Append to `plugins/attractor/engine/test/engine.test.ts`. It already imports `Engine`/`defaultHandlers` from `core/engine.ts`, `StubBackend`, `type Backend`, `Handler`, `Context`, `Status`/`type Outcome`, `parseDot`, `loadCheckpoint`, `EventLog`, and has `tempDir()`/`tempDirs()`/`cleanup(...)` helpers — reuse all of them. Add one new import and the test block:

```ts
import { GatedBackend } from './fixtures.ts'
import { type HandlerCtx, type Handler as HandlerIface } from '../src/handlers/types.ts'

// ---------------------------------------------------------------------------
// HandlerCtx.runBranch (p5-05). handlers/parallel.ts / ParallelHandler do not
// exist yet (p5-08) -- every test here drives ctx.runBranch directly from a
// hand-built test-only Handler, registered against Handler.TOOL (so it never
// collides with Handler.CODERGEN, which stays the REAL BoxHandler wrapping a
// GatedBackend for the branch's own nodes -- proving genuine concurrency,
// not a same-tick stub).
// ---------------------------------------------------------------------------

/** Launches whatever the test wants when its one designated node dispatches. */
class BranchLaunchingHandler implements HandlerIface {
  constructor(private readonly launch: (ctx: HandlerCtx) => Promise<Outcome>) {}
  async execute(ctx: HandlerCtx): Promise<Outcome> {
    return this.launch(ctx)
  }
}

test('a branch root routed straight to the real EXIT node is an ordinary dead end for that branch alone (mutation-checked)', async () => {
  const backend = new GatedBackend()
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-exit')
  const siblingRunDir = join(runDir, 'branch-sibling')
  const handlers = defaultHandlers(backend)
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const exitPromise = ctx.runBranch!({
        startNodeId: 'sideEntry',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      const siblingPromise = ctx.runBranch!({
        startNodeId: 'sibling',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: siblingRunDir,
        cwd: ctx.cwd,
      })
      // Both branches are now gated open (their own CODERGEN dispatch is
      // blocked inside GatedBackend.run) -- release only the EXIT one.
      backend.release('sideEntry')
      const exitResult = await exitPromise

      // Observable proxy for "unsatisfiedGoalGates()/this.checkpoint(null)
      // were never called during that runBranch call": this.checkpoint()
      // always targets the OUTER run's own runDir. A mutant letting
      // runBranch fall through to run()'s own EXIT block would flip THIS
      // checkpoint to currentNode: null mid-detour-dispatch, before this
      // handler ever returns -- the correct implementation leaves it
      // exactly as `start`'s own per-node checkpoint left it.
      const midFlightCheckpoint = loadCheckpoint(runDir)
      assert.equal(midFlightCheckpoint?.currentNode, 'start')
      assert.equal(exitResult.outcome.status, Status.SUCCESS, 'EXIT is a trivial passthrough SUCCESS')
      assert.deepEqual(exitResult.path, ['sideEntry', 'done'])

      assert.ok(backend.maxObserved >= 2, 'both branches were genuinely in flight at once')
      backend.release('sibling')
      await siblingPromise

      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      sideEntry [shape=box, prompt="x"]
      sibling [shape=box, prompt="y"]
      start -> detour -> done
      detour -> sideEntry [condition="context.never_true=x"]
      detour -> sibling [condition="context.never_true=x"]
      sideEntry -> done
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.path, ['start', 'detour', 'done'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('a branch retry-target cycle with maxSteps set low ends FAIL rather than hanging (mutation-checked, NFR-1)', async () => {
  const handlers = defaultHandlers(new StubBackend({ cyc: { status: Status.RETRY, notes: 'again' } }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-cyc')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const result = await ctx.runBranch!({
        startNodeId: 'cyc',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      assert.equal(result.outcome.status, Status.FAIL)
      assert.match(result.outcome.notes ?? '', /step cap/i)
      return { status: Status.SUCCESS, notes: 'observed the branch fail cleanly' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      cyc [shape=box, prompt="x", max_retries=0, retry_target="cyc"]
      start -> detour -> done
      detour -> cyc [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers, maxSteps: 25 })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS, "the OUTER run is unaffected by its branch's own FAIL")
  } finally {
    cleanup(runDir, cwd)
  }
})

test('run() and runBranch produce identical path/attempts/checkpoint shape for the same fixture (proves executeNodeStep is one implementation)', async () => {
  const script = {
    x: { status: Status.SUCCESS, notes: 'x done', contextUpdates: { 'stage.x': 'done' } },
    y: { status: Status.SUCCESS, notes: 'y done', contextUpdates: { 'stage.y': 'done' } },
  }

  const { result: mainResult, runDir: mainRunDir, cwd: mainCwd } = await execute(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      x [shape=box, prompt="x"]  y [shape=box, prompt="y"]
      start -> x -> y -> done
    }
  `, script)
  assert.equal(mainResult.status, Status.SUCCESS)

  const { runDir: branchRunDir, cwd: branchCwd } = tempDirs()
  const handlers = defaultHandlers(new StubBackend(script))
  let branchResult: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      branchResult = await ctx.runBranch!({
        startNodeId: 'x',
        stopAt: new Set(['done']), // stops before dispatching the graph's natural end
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const branchGraph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      x [shape=box, prompt="x"]  y [shape=box, prompt="y"]
      start -> detour -> done
      detour -> x [condition="context.never_true=x"]
      x -> y -> done
    }
  `)
  try {
    const engine = new Engine({
      graph: branchGraph, context: Context.from({}), runDir: branchRunDir, cwd: branchCwd, handlers,
    })
    const outerResult = await engine.run()
    assert.equal(outerResult.status, Status.SUCCESS)

    assert.deepEqual(mainResult.path.slice(1, -1), branchResult!.path, 'x, y in the same order')

    const mainCheckpoint = loadCheckpoint(mainRunDir)
    const branchCheckpoint = loadCheckpoint(branchRunDir)
    assert.deepEqual(mainCheckpoint?.attempts, branchCheckpoint?.attempts)
    assert.equal(mainCheckpoint?.context['stage.x'], branchCheckpoint?.context['stage.x'])
    assert.equal(mainCheckpoint?.context['stage.y'], branchCheckpoint?.context['stage.y'])
  } finally {
    cleanup(mainRunDir, mainCwd)
    cleanup(branchRunDir, branchCwd)
  }
})

test('a goal-gate node inside a branch correctly blocks the outer run\'s real exit', async () => {
  const handlers = defaultHandlers(new StubBackend({
    gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - no verdict' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-gate')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      await ctx.runBranch!({
        startNodeId: 'gate',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      gate [shape=box, goal_gate=true, prompt="judge", max_retries=0]
      start -> detour -> done
      detour -> gate [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL, "the branch's own unearned goal gate blocks the real exit")
    assert.match(result.notes ?? '', /unsatisfied goal gates.*gate/)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch dispatches a retry_target outside its own stopAt-truncated reachable set exactly like any other next node (named, accepted risk)', async () => {
  const handlers = defaultHandlers(new StubBackend({
    branchRoot: { status: Status.RETRY, notes: 'jump out' },
    siblingRoot: { status: Status.SUCCESS, notes: 'reached' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-escape')
  let outcome: Outcome | undefined
  let path: string[] | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const result = await ctx.runBranch!({
        startNodeId: 'branchRoot',
        stopAt: new Set(['stopHere']),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      outcome = result.outcome
      path = result.path
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      branchRoot [shape=box, prompt="x", max_retries=0, retry_target="siblingRoot"]
      siblingRoot [shape=box, prompt="y"]
      stopHere [shape=box, prompt="z"]
      start -> detour -> done
      detour -> branchRoot [condition="context.never_true=x"]
      siblingRoot -> stopHere
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.deepEqual(path, ['branchRoot', 'siblingRoot'], "the jump to siblingRoot happened, unblocked -- not this story's gap to close")
    assert.equal(outcome?.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch reaches a dead end (no outgoing edge, not EXIT) with a FAIL BranchRunResult', async () => {
  const handlers = defaultHandlers(new StubBackend({
    lonely: { status: Status.SUCCESS, notes: 'nowhere to go' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-lonely')
  let result: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      result = await ctx.runBranch!({
        startNodeId: 'lonely',
        stopAt: new Set(),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      lonely [shape=box, prompt="x"]
      start -> detour -> done
      detour -> lonely [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(result?.outcome.status, Status.FAIL)
    assert.deepEqual(result?.path, ['lonely'])
  } finally {
    cleanup(runDir, cwd)
  }
})

test('runBranch stops before dispatching a stopAt frontier node', async () => {
  const handlers = defaultHandlers(new StubBackend({
    entry: { status: Status.SUCCESS, notes: 'ok' },
  }))
  const { runDir, cwd } = tempDirs()
  const branchRunDir = join(runDir, 'branch-frontier')
  let result: BranchRunResultShape | undefined
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      result = await ctx.runBranch!({
        startNodeId: 'entry',
        stopAt: new Set(['frontier']),
        context: ctx.context.clone(),
        runDir: branchRunDir,
        cwd: ctx.cwd,
      })
      return { status: Status.SUCCESS, notes: 'ok' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      entry [shape=box, prompt="x"]  frontier [shape=box, prompt="y"]
      start -> detour -> done
      detour -> entry [condition="context.never_true=x"]
      entry -> frontier
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()
    assert.equal(result?.outcome.status, Status.SUCCESS)
    assert.deepEqual(result?.path, ['entry'], 'stops before dispatching frontier; frontier is not in path')
  } finally {
    cleanup(runDir, cwd)
  }
})

test('two concurrent ctx.runBranch calls via Promise.all over GatedBackend both resolve independently, and the outer ledgers reflect both', async () => {
  const backend = new GatedBackend()
  const handlers = defaultHandlers(backend)
  const { runDir, cwd } = tempDirs()
  const runDirA = join(runDir, 'branch-a')
  const runDirB = join(runDir, 'branch-b')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const [a, b] = await Promise.allSettled([
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'a', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirA, cwd: ctx.cwd,
          })
          backend.release('a')
          return p
        })(),
        (async () => {
          const p = ctx.runBranch!({
            startNodeId: 'b', stopAt: new Set(), context: ctx.context.clone(), runDir: runDirB, cwd: ctx.cwd,
          })
          backend.reject('b', new Error('branch b exploded'))
          return p
        })(),
      ])
      assert.equal(a.status, 'fulfilled')
      assert.equal(b.status, 'fulfilled', 'a rejected GatedBackend call is caught by executeNodeStep and turned into a FAIL outcome, not a thrown exception')
      if (a.status === 'fulfilled') assert.equal(a.value.outcome.status, Status.SUCCESS)
      if (b.status === 'fulfilled') assert.equal(b.value.outcome.status, Status.FAIL)
      return { status: Status.SUCCESS, notes: 'both branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      a [shape=box, prompt="x"]  b [shape=box, prompt="y"]
      start -> detour -> done
      detour -> a [condition="context.never_true=x"]
      detour -> b [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS)
  } finally {
    cleanup(runDir, cwd)
  }
})
```

Add a small type alias near the top of the new section (used only for the local `branchResult`/`result` variable annotations above, since `BranchRunResult` is not imported by name in every case — import it explicitly instead):

```ts
import { type BranchRunResult as BranchRunResultShape } from '../src/handlers/types.ts'
```

- [ ] **Step 3: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts`
Expected: every new test fails — `ctx.runBranch` is `undefined` (`HandlerCtx` does not populate it yet; `handler.execute(...)`'s dispatch call inside `executeNodeStep` does not pass a `runBranch` field), so each `ctx.runBranch!({...})` call throws `TypeError: ctx.runBranch is not a function` (or similar). `BranchRunOptions`/`BranchRunResult` import successfully (added in Step 1), so the failures are all at the call site, not at import time.

- [ ] **Step 4: Implement — add `runBranch` to `Engine` and wire it into `executeNodeStep`'s dispatch**

Add the new private method to `plugins/attractor/engine/src/core/engine.ts`, placed directly after `executeNodeStep` (Task 2) and before `run()`:

```ts
  /**
   * A bounded forward traversal of the SAME graph, starting at
   * opts.startNodeId, using the exact per-node step logic executeNodeStep
   * (Task 2) already implements -- against this Engine's own shared
   * gateOutcomes/nodeFailures/failedOutputs/stepCount ledgers. REJECTED: one
   * independent `new Engine(...)` per branch -- a fresh instance would own
   * its own empty ledgers, so a goal gate inside a branch would satisfy or
   * fail a map nothing outside that branch's own instance ever reads,
   * silently reopening the fail-open hole those ledgers exist to close
   * (ADR-009).
   *
   * Treats EVERY stop reason -- 'exit', 'frontier', 'deadend', 'stepcap' --
   * identically: stop looping and return whatever outcome/path the branch
   * ended with. In particular, dispatching the graph's real EXIT node is an
   * ORDINARY DEAD END for this branch alone (ADR-007's amendment): this
   * method never calls unsatisfiedGoalGates(), never calls
   * this.checkpoint(null), and never returns an Engine.RunResult -- that
   * logic lives EXCLUSIVELY in run()'s own interpretation of a
   * `{ kind: 'stop', reason: 'exit' }` result, a branch this uniform
   * handling structurally cannot reach.
   */
  private async runBranch(opts: BranchRunOptions): Promise<BranchRunResult> {
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS
    const path: string[] = []
    let currentId = opts.startNodeId
    for (;;) {
      path.push(currentId)
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: opts.runDir,
        cwd: opts.cwd,
        maxSteps,
        stopAt: opts.stopAt,
        context: opts.context,
      })
      if (stepResult.kind === 'continue') {
        currentId = stepResult.nextId
        continue
      }
      return { outcome: stepResult.outcome, path }
    }
  }
```

Add the import for the two new types at the top of `engine.ts`, alongside the existing `import { type Backend, type Handler } from '../handlers/types.ts'`:

```ts
import { type Backend, type BranchRunOptions, type BranchRunResult, type Handler } from '../handlers/types.ts'
```

Edit `executeNodeStep`'s existing dispatch call (added in Task 2) to populate `runBranch`:

```ts
      try {
        outcome = await handler.execute({
          node,
          graph,
          context,
          runDir: opts.runDir,
          cwd: opts.cwd,
          events: this.events,
          runBranch: (o: BranchRunOptions) => this.runBranch(o),
        })
      } catch (err) {
```

- [ ] **Step 5: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts`
Expected: every test added in Step 2 passes.

- [ ] **Step 6: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing, test count up by 8 relative to baseline.

- [ ] **Step 7: Commit**

```bash
git add plugins/attractor/engine/src/handlers/types.ts \
        plugins/attractor/engine/src/core/engine.ts \
        plugins/attractor/engine/test/engine.test.ts
git commit -m "$(cat <<'EOF'
engine: add HandlerCtx.runBranch, a bounded sub-traversal seam (p5-05)

HandlerCtx gains an optional runBranch callback, populated by Engine.run()
on every dispatch, that runs a bounded forward traversal of the same graph
via executeNodeStep (p5-02) -- against this run's own shared gateOutcomes/
nodeFailures/failedOutputs/stepCount ledgers, never an independent nested
Engine, which would silently reopen the fail-closed goal-gate hole those
ledgers exist to close (ADR-009).

A branch reaching the graph's real EXIT node is treated as an ordinary dead
end for that branch alone: runBranch's handling of every stop reason is
uniform, so it structurally cannot reach run()'s own goal-gate-check/
checkpoint(null)/RunResult logic (ADR-007's amendment) -- proven
mutation-checked, with a GatedBackend-held sibling branch proving the
run-wide ledgers are genuinely shared, not just type-compatible.

Named, accepted risk (not closed by this commit): a retry_target resolving
outside a branch's own stopAt-truncated reachable set is dispatched exactly
like any other next node -- proven by a test, not silently left unproven.

ParallelHandler itself, the code that will actually call ctx.runBranch from
a real dispatch, does not exist yet (p5-08, a future sprint) -- every test
here drives the seam directly from a hand-built test-only Handler.
EOF
)"
```

---

### Task 6: Warn (PAR-005) when a branch can reach the graph's real EXIT before its convergence node

**Files:**
- Modify: `plugins/attractor/engine/src/dot/lint.ts` (extends the `Handler.PARALLEL` block Task 4 added)
- Modify: `plugins/attractor/engine/test/lint.test.ts`
- Modify: `plugins/attractor/engine/test/engine.test.ts`
- Modify: `plugins/attractor/README.md` (`## Lint rules`, and the **must-ship** doc caveat in `### What the linter can and cannot see`)

**Interfaces:**
- Consumes: `findConvergenceNode` (Task 4, verbatim); `ctx.runBranch`/`GatedBackend` (Task 5/Task 1, for the integration test).
- Produces: no new exported function — `PAR-005` is a new diagnostic code only, reusing `findConvergenceNode` and ordinary BFS (no new `dot/graph.ts` helper needed, per the story's own note).

- [ ] **Step 1: Write the failing lint tests**

Append to `plugins/attractor/engine/test/lint.test.ts`:

```ts
// ---------------------------------------------------------------------------
// PAR-005: a branch root that can reach the graph's real EXIT node without
// first passing through the component node's own convergence node.
// ---------------------------------------------------------------------------

test('PAR-005 fires WARNING when a branch root has a direct edge to EXIT that no other branch shares', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    early [shape=box]  other [shape=box]  join [shape=box]
    start -> fan
    fan -> early -> done
    fan -> other -> join -> done
  }`
  const diags = lint(parseDot(src))
  const par005 = diags.find((d) => d.code === 'PAR-005')
  assert.ok(par005)
  assert.equal(par005?.severity, Severity.WARNING)
  assert.ok(!lint(parseDot(src)).some((d) => d.code === 'PAR-001'), 'a genuine convergence node (join, reached via other) still exists')
})

test('PAR-005 does not fire when a branch reaches EXIT only after its own convergence node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    a [shape=box]  b [shape=box]  join [shape=box]
    start -> fan
    fan -> a -> join
    fan -> b -> join
    join -> done
  }`
  assert.ok(!codes(src).includes('PAR-005'), 'reaching EXIT via join, the real convergence node, is ordinary post-convergence routing')
})

test('PAR-005 does not fire when no branch reaches EXIT at all', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    a [shape=box]  b [shape=box]  join [shape=box]  rest [shape=box]
    start -> fan
    fan -> a -> join
    fan -> b -> join
    join -> rest -> done
  }`
  assert.ok(!codes(src).includes('PAR-005'))
})

test('PAR-005 does not fire when the convergence node IS the exit node itself', () => {
  // findConvergenceNode: convergence at the graph's real EXIT node (Task 4's
  // own test case). Reaching `done` here is reaching convergence, not
  // shortcutting past it -- PAR-005 must not fire on ordinary convergence.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done
    fan -> b -> done
  }`
  assert.ok(!codes(src).includes('PAR-005'))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: the first test fails (`PAR-005` never appears); the other three already pass vacuously (nothing emits `PAR-005` yet) and become real pins once the rule exists.

- [ ] **Step 3: Implement — extend the `Handler.PARALLEL` block in `dot/lint.ts`**

Add the helper function near `bypassesGates` (`lint.ts:247-261`):

```ts
/**
 * Can `fromId` reach any node in `targets` without expanding past `avoid`?
 * `avoid` itself is reached but never expanded further, so reaching `avoid`
 * alone -- e.g. when the convergence node IS the exit node -- does not
 * count as "reaching an exit before convergence": that is ordinary
 * post-convergence routing, not the shortcut this check exists to catch.
 */
function canReachWithoutPassing(
  graph: Graph, fromId: string, targets: ReadonlySet<string>, avoid: string,
): boolean {
  if (targets.has(fromId) && fromId !== avoid) return true
  const seen = new Set<string>([fromId])
  const queue = [fromId]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    if (cur === avoid) continue
    for (const e of outgoingEdges(graph, cur)) {
      if (seen.has(e.to)) continue
      if (targets.has(e.to) && e.to !== avoid) return true
      seen.add(e.to)
      queue.push(e.to)
    }
  }
  return false
}
```

Replace the `if (node.handler === Handler.PARALLEL) { ... }` block Task 4 added with this extended version (the `PAR-002`/`PAR-001`/`PAR-004` bodies are unchanged text, only the surrounding control flow and the new `PAR-005` loop are new):

```ts
    if (node.handler === Handler.PARALLEL) {
      const branchRootIds = outgoingEdges(graph, node.id).map((e) => e.to)
      if (branchRootIds.length === 1) {
        diags.push({
          code: 'PAR-002',
          severity: Severity.WARNING,
          node: node.id,
          message:
            `node ${node.id} is a parallel fan-out (Handler.PARALLEL) with exactly one ` +
            `outgoing edge, to ${branchRootIds[0]} -- a fan-out of one branch runs no ` +
            `differently than an ordinary edge would, so this is likely not what was intended`,
        })
      }
      if (branchRootIds.length >= 1) {
        const convergenceId = findConvergenceNode(graph, branchRootIds)
        if (branchRootIds.length >= 2 && convergenceId === null) {
          diags.push({
            code: 'PAR-001',
            severity: Severity.ERROR,
            node: node.id,
            message:
              `node ${node.id} fans out to ${branchRootIds.join(', ')}, but no node is ` +
              `reachable from every branch -- there is nowhere for the pipeline to resume ` +
              `after the fan-out. Add a node every branch's path leads to, or route two of ` +
              `the branches back together`,
          })
        } else if (convergenceId !== null) {
          if (branchRootIds.length >= 2) {
            const partial = findPartialReconvergence(graph, branchRootIds, convergenceId)
            if (partial.length > 0) {
              diags.push({
                code: 'PAR-004',
                severity: Severity.ERROR,
                node: node.id,
                message:
                  `node ${node.id} fans out to ${branchRootIds.join(', ')}, converging on ` +
                  `${convergenceId} -- but ${partial.join(', ')} ` +
                  `${partial.length === 1 ? 'is' : 'are'} also reachable from two or more of ` +
                  `those branches before ${convergenceId}. A node reached this way could be ` +
                  `dispatched twice, once per branch that reaches it -- route every branch ` +
                  `through a single shared node before ${convergenceId}, or restructure so ` +
                  `only ${convergenceId} is shared`,
              })
            }
          }

          // PAR-005: reuses the SAME convergenceId this block already
          // computed, not a second reachability pass.
          const exitIds = new Set(findByHandler(graph, Handler.EXIT).map((n) => n.id))
          for (const rootId of branchRootIds) {
            if (canReachWithoutPassing(graph, rootId, exitIds, convergenceId)) {
              diags.push({
                code: 'PAR-005',
                severity: Severity.WARNING,
                node: node.id,
                message:
                  `node ${node.id}'s branch root ${rootId} can reach the graph's real exit ` +
                  `node without first passing through the fan-out's own convergence node ` +
                  `${convergenceId}. This branch alone stops there -- it does NOT stop the ` +
                  `whole pipeline, and sibling branches proceed normally; there is no way to ` +
                  `stop the whole run from inside a branch in this build. If an early stop for ` +
                  `just this branch is intended, this warning can be ignored`,
              })
            }
          }
        }
      }
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every test from Step 1 passes, and every Task 4 `PAR-001`/`PAR-002`/`PAR-004` test still passes unmodified.

- [ ] **Step 5: Write the failing integration test**

Append to `plugins/attractor/engine/test/engine.test.ts` (reuses `GatedBackend`, `BranchLaunchingHandler`, `tempDirs`/`cleanup` already added by Task 5, plus `lint`/`hasErrors` — both already imported at the top of this file, no import change needed):

```ts
test('PAR-005 integration: an early-exit branch neither halts the run nor lets lint block it, and a sibling proceeds normally', async () => {
  const src = `
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      fan [shape=component]
      early [shape=box]  other [shape=box]  join [shape=box]
      start -> fan
      fan -> early -> done
      fan -> other -> join -> done
    }
  `
  const diags = lint(parseDot(src))
  assert.ok(diags.some((d) => d.code === 'PAR-005'), 'the fixture is the one PAR-005 exists to catch')
  assert.ok(!hasErrors(diags), 'PAR-005 is advisory -- it must not block the run')

  const backend = new GatedBackend()
  const handlers = defaultHandlers(backend)
  const { runDir, cwd } = tempDirs()
  const earlyRunDir = join(runDir, 'branch-early')
  const otherRunDir = join(runDir, 'branch-other')
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const earlyPromise = ctx.runBranch!({
        startNodeId: 'early', stopAt: new Set(), context: ctx.context.clone(), runDir: earlyRunDir, cwd: ctx.cwd,
      })
      const otherPromise = ctx.runBranch!({
        startNodeId: 'other', stopAt: new Set(['join']), context: ctx.context.clone(), runDir: otherRunDir, cwd: ctx.cwd,
      })
      backend.release('early')
      const earlyResult = await earlyPromise
      assert.equal(earlyResult.outcome.status, Status.SUCCESS, "the early branch's own EXIT dispatch is a trivial SUCCESS")
      assert.deepEqual(earlyResult.path, ['early', 'done'])

      backend.release('other')
      const otherResult = await otherPromise
      assert.equal(otherResult.outcome.status, Status.SUCCESS, "the sibling proceeds to its own stop point, unaffected by the other branch's early exit")
      assert.deepEqual(otherResult.path, ['other'], 'stops before dispatching the join frontier')

      return { status: Status.SUCCESS, notes: 'detour done' }
    }),
  )
  const runnableGraph = parseDot(src.replace('fan [shape=component]', 'fan [shape=parallelogram, tool_command="unused"]'))
  try {
    const engine = new Engine({ graph: runnableGraph, context: Context.from({}), runDir, cwd, handlers })
    const result = await engine.run()
    assert.equal(result.status, Status.SUCCESS, 'the whole pipeline is never halted by the early-exit branch')
  } finally {
    cleanup(runDir, cwd)
  }
})
```

Note: the test lints the ORIGINAL `component`-shaped fixture (to pin `PAR-005`/`hasErrors` against the real, eventual shape) but *runs* a copy with `fan` swapped to `parallelogram` (registered, dispatchable today) so `Engine.run()`'s own lint gate does not refuse it before the hand-built `Handler.TOOL` override can fire — the same "no `ParallelHandler` needed" technique every Task 5 test already uses.

- [ ] **Step 6: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts`
Expected: fails only on `ctx.runBranch!({...startNodeId: 'other'...})`'s frontier assertion or the overall shape if anything is miswired — in practice this test should mostly just PASS once Task 5 has landed, since it exercises the same seam with a fixture Task 4/6's own lint already proves fires `PAR-005` correctly; treat any failure here as a signal to re-check the fixture against Step 1's lint assertions before treating it as a real regression.

- [ ] **Step 7: Implement (if Step 6 revealed anything) and run to pass**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts`
Expected: the new integration test passes.

- [ ] **Step 8: Update `README.md`**

In `## Lint rules` (extend the sentence Task 4 already added, inserting `PAR-005` before the closing period, and add it to the warnings list):

```
Old (as left by Task 4):
chosen convergence node (including one that merely lost a depth tie for it)
reachable from two or more branch roots.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003` and `PAR-002` are
warnings; the rest are errors, and `attractor run` refuses a graph with any
error.

New:
chosen convergence node (including one that merely lost a depth tie for it)
reachable from two or more branch roots; `PAR-005` a branch root that can
reach the graph's real exit node before the fan-out's own convergence node.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003`, `PAR-002` and
`PAR-005` are warnings; the rest are errors, and `attractor run` refuses a
graph with any error.
```

In `### What the linter can and cannot see` (`README.md:194-240`), append a new paragraph after the existing `HITL-003` paragraph and before the `## Lint rules` heading — this caveat is a **must**, not eligible for any later cut list:

```
`PAR-005` warns when a branch can shortcut straight to the graph's real exit
node before the fan-out's own convergence node. **A branch reaching the exit
node never stops the whole pipeline** -- it is an ordinary dead end for that
one branch alone; every sibling branch proceeds normally, and the run
resumes at the real convergence node once every branch (early-exiting or
not) has settled. Drawing an edge straight to the exit node to mean "stop
everything from inside a branch" is a common intuition and does not do
that in this build -- there is no such capability today. `PAR-005`'s WARNING
says "probably not what you meant, but nothing downstream breaks if it is
fine," never "this is how you stop the whole run."
```

- [ ] **Step 9: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing, test count up by 5 relative to baseline (4 from Step 1, 1 from Step 5).

- [ ] **Step 10: Commit**

```bash
git add plugins/attractor/engine/src/dot/lint.ts \
        plugins/attractor/engine/test/lint.test.ts \
        plugins/attractor/engine/test/engine.test.ts \
        plugins/attractor/README.md
git commit -m "$(cat <<'EOF'
engine: add PAR-005, branch-reaches-EXIT-early lint warning (p5-06)

Reuses findConvergenceNode (p5-04) -- no new dot/graph.ts helper needed.
WARNING, not ERROR: per p5-05's own Decision, a branch reaching the graph's
real EXIT node is an ordinary dead end for that branch alone and never stops
the whole pipeline, so ending one branch's own traversal early without
affecting siblings is a legitimate pattern (the same reasoning PAR-002
already applies to its own surprising-but-legal shape).

README's "branch reaching EXIT never stops the run" caveat ships as a MUST,
per architecture.md's own F2-residual amendment -- an author drawing
component -> exit intending "stop everything" gets a clean-enough lint pass
and a run that silently does not do what they intended, with no crash and no
visible sign, which is exactly the silent-degradation class this project's
own doctrine exists to catch.
EOF
)"
```

---

### Task 7: Merge a branch's Context writes back deterministically after it settles, plus PAR-003

**Files:**
- Modify: `plugins/attractor/engine/src/handlers/types.ts` (`BranchRunResult` gains `context`)
- Modify: `plugins/attractor/engine/src/core/engine.ts` (`runBranch`, added in Task 5, populates `context`)
- Create: `plugins/attractor/engine/src/handlers/parallel.ts` (exports only `mergeBranchContext`)
- Modify: `plugins/attractor/engine/src/dot/lint.ts` (extends the `Handler.PARALLEL` block Tasks 4/6 built, adding `PAR-003`)
- Create: `plugins/attractor/engine/test/parallel.test.ts`
- Modify: `plugins/attractor/engine/test/lint.test.ts`
- Modify: `plugins/attractor/README.md`

**Interfaces:**
- Consumes: `BranchRunResult{outcome, path}` and `runBranch` (Task 5, extended here — full final shape below, not a contradictory redefinition); `GatedBackend` (Task 1) is reused for the two completion-order-dependent test rows, plus a small file-local `GatedValueBackend` (defined in this task's own test file — see Step 2's note on why `GatedBackend` alone cannot serve these two rows).
- Produces:
  ```ts
  // handlers/types.ts — BranchRunResult, EXTENDED from Task 5's {outcome, path}
  export interface BranchRunResult {
    outcome: Outcome
    path: string[]
    context: Record<string, string>   // NEW — Context.snapshot() at the moment the branch stopped
  }

  // handlers/parallel.ts (NEW file — this task's only export; a future
  // ParallelHandler class, p5-08, adds to this same file, not this task)
  export function mergeBranchContext(
    parentContext: Context,
    preforkSnapshot: Record<string, string>,
    branchRootIds: readonly string[],
    results: readonly BranchRunResult[],
    events: EventLog,
  ): void
  ```

- [ ] **Step 1: Extend `BranchRunResult` and populate it in `runBranch`**

In `plugins/attractor/engine/src/handlers/types.ts`, change:

```ts
export interface BranchRunResult {
  outcome: Outcome
  path: string[]
}
```

to:

```ts
export interface BranchRunResult {
  outcome: Outcome
  path: string[]
  /** Context.snapshot() taken from the branch's own (cloned) context at the moment it stopped. */
  context: Record<string, string>
}
```

In `plugins/attractor/engine/src/core/engine.ts`, edit `runBranch`'s (Task 5) return statement:

```ts
      if (stepResult.kind === 'continue') {
        currentId = stepResult.nextId
        continue
      }
      return { outcome: stepResult.outcome, path, context: opts.context.snapshot() }
    }
  }
```

(Only the `return` line's object literal changes — everything else in `runBranch` is unchanged from Task 5.)

- [ ] **Step 2: Write the failing tests for `mergeBranchContext`**

Create `plugins/attractor/engine/test/parallel.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { type Graph, type Node, Handler } from '../src/dot/graph.ts'
import {
  type Backend, type BranchRunResult, type HandlerCtx, type Handler as HandlerIface,
} from '../src/handlers/types.ts'
import { mergeBranchContext } from '../src/handlers/parallel.ts'
import { EventLog } from '../src/run/events.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-parallel-'))
}

/** Hand-built BranchRunResult -- no runBranch/Engine needed for these rows. */
function branchResult(status: Status, context: Record<string, string>): BranchRunResult {
  return { outcome: { status }, path: ['x'], context }
}

class BranchLaunchingHandler implements HandlerIface {
  constructor(private readonly launch: (ctx: HandlerCtx) => Promise<Outcome>) {}
  async execute(ctx: HandlerCtx): Promise<Outcome> {
    return this.launch(ctx)
  }
}

/**
 * `GatedBackend` (Task 1, test/fixtures.ts) always resolves a bare
 * `{status: SUCCESS}` -- perfect for proving CONCURRENCY, useless for proving
 * this task's collision rows, which need each branch to write a DIFFERENT,
 * chosen context value while completion order is still driven independently
 * of declaration order. This is a small, file-local variant built only for
 * that need -- not a duplicate of GatedBackend, and not reused outside this
 * file.
 */
class GatedValueBackend implements Backend {
  private gates = new Map<string, () => void>()
  constructor(private readonly outcomes: Record<string, Outcome>) {}
  async run(node: Node, _prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    await new Promise<void>((resolve) => {
      this.gates.set(node.id, resolve)
    })
    return this.outcomes[node.id] ?? { status: Status.SUCCESS }
  }
  release(nodeId: string): void {
    this.gates.get(nodeId)?.()
  }
}

test('mergeBranchContext: happy path -- three branches declare distinct keys, each merges through', () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, { 'a.path': 'A' }),
    branchResult(Status.SUCCESS, { 'b.path': 'B' }),
    branchResult(Status.SUCCESS, { 'c.path': 'C' }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1', 'r2', 'r3'], results, events)
  assert.equal(parent.get('a.path'), 'A')
  assert.equal(parent.get('b.path'), 'B')
  assert.equal(parent.get('c.path'), 'C')
  assert.equal(events.all().filter((e) => e.type === 'node.parallel.context_collision').length, 0)
})

test('mergeBranchContext: exact F1 reproduction -- three branches declare the SAME key, completion out of declaration order', async () => {
  const backend = new GatedValueBackend({
    r1: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r1' } },
    r2: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r2' } },
    r3: { status: Status.SUCCESS, contextUpdates: { 'implementation.path': 'r3' } },
  })
  const handlers = defaultHandlers(backend)
  const runDir = tempDir()
  const cwd = tempDir()
  let capturedResults: BranchRunResult[] = []
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const rootIds = ['r1', 'r2', 'r3']
      const promises = rootIds.map((id) =>
        ctx.runBranch!({
          startNodeId: id, stopAt: new Set(), context: ctx.context.clone(),
          runDir: join(ctx.runDir, `branch-${id}`), cwd: ctx.cwd,
        }),
      )
      // Completion order deliberately reversed from declaration order.
      backend.release('r3')
      backend.release('r2')
      backend.release('r1')
      capturedResults = await Promise.all(promises)
      return { status: Status.SUCCESS, notes: 'branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      r1 [shape=box, prompt="x", outputs="implementation.path"]
      r2 [shape=box, prompt="x", outputs="implementation.path"]
      r3 [shape=box, prompt="x", outputs="implementation.path"]
      start -> detour -> done
      detour -> r1 [condition="context.never_true=x"]
      detour -> r2 [condition="context.never_true=x"]
      detour -> r3 [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()

    const parent = Context.from({})
    const pre = parent.snapshot()

    // Pre-fix: nothing has copied any branch's writes back yet -- the
    // convergence node would read nothing. Asserted BEFORE the real merge
    // call, so the scenario is proven load-bearing, not merely described.
    assert.equal(parent.get('implementation.path'), undefined)

    const events = new EventLog(tempDir())
    mergeBranchContext(parent, pre, ['r1', 'r2', 'r3'], capturedResults, events)
    assert.equal(
      parent.get('implementation.path'), 'r3',
      "the THIRD (last-declared) branch's value wins, regardless of completion order",
    )
    const collisions = events.all().filter((e) => e.type === 'node.parallel.context_collision')
    assert.equal(collisions.length, 2, 'not zero, not one -- r2 collides with r1, then r3 collides with r2')
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("mergeBranchContext: two-branch collision, completion order opposite declaration order -- the later-declared branch's value wins", async () => {
  const backend = new GatedValueBackend({
    r1: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-r1' } },
    r2: { status: Status.SUCCESS, contextUpdates: { 'shared.key': 'from-r2' } },
  })
  const handlers = defaultHandlers(backend)
  const runDir = tempDir()
  const cwd = tempDir()
  let capturedResults: BranchRunResult[] = []
  handlers.set(
    Handler.TOOL,
    new BranchLaunchingHandler(async (ctx) => {
      const rootIds = ['r1', 'r2']
      const promises = rootIds.map((id) =>
        ctx.runBranch!({
          startNodeId: id, stopAt: new Set(), context: ctx.context.clone(),
          runDir: join(ctx.runDir, `branch-${id}`), cwd: ctx.cwd,
        }),
      )
      // r2 (later-declared) completes FIRST -- opposite of declaration order.
      backend.release('r2')
      backend.release('r1')
      capturedResults = await Promise.all(promises)
      return { status: Status.SUCCESS, notes: 'branches settled' }
    }),
  )
  const graph = parseDot(`
    digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      detour [shape=parallelogram, tool_command="unused"]
      r1 [shape=box, prompt="x", outputs="shared.key"]
      r2 [shape=box, prompt="x", outputs="shared.key"]
      start -> detour -> done
      detour -> r1 [condition="context.never_true=x"]
      detour -> r2 [condition="context.never_true=x"]
    }
  `)
  try {
    const engine = new Engine({ graph, context: Context.from({}), runDir, cwd, handlers })
    await engine.run()

    const parent = Context.from({})
    const pre = parent.snapshot()
    const events = new EventLog(tempDir())
    mergeBranchContext(parent, pre, ['r1', 'r2'], capturedResults, events)
    assert.equal(parent.get('shared.key'), 'from-r2', 'r2 is declared LAST, so it wins even though it completed FIRST')
    assert.equal(events.all().filter((e) => e.type === 'node.parallel.context_collision').length, 1)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("mergeBranchContext: a branch's tool.last_line write IS merged; current_node/outcome/preferred_label are NOT", () => {
  const parent = Context.from({})
  parent.set('current_node', 'outer')
  parent.set('outcome', Status.SUCCESS)
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, {
      'tool.last_line': 'green',
      current_node: 'r1',
      outcome: Status.FAIL,
      preferred_label: 'ship',
    }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('tool.last_line'), 'green', "a branch's own tool.* write IS branch evidence, merged like any outputs= key")
  assert.equal(parent.get('current_node'), 'outer', 'the outer run\'s own post-return value is still in effect')
  assert.equal(parent.get('outcome'), Status.SUCCESS, 'the outer run\'s own post-return value is still in effect')
  assert.equal(parent.get('preferred_label'), undefined, 'never set to begin with, and still not merged from the branch')
})

test("mergeBranchContext: a FAILED branch's partial key write is not merged", () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [branchResult(Status.FAIL, { 'artifact.path': 'partial-work' })]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('artifact.path'), undefined, 'unproven partial work from a failed branch is not trusted evidence')
})

test("mergeBranchContext: a PARTIAL-status branch DOES merge, mirroring recordOutcome's own SUCCESS/PARTIAL rule", () => {
  const parent = Context.from({})
  const pre = parent.snapshot()
  const results = [branchResult(Status.PARTIAL, { 'artifact.path': 'partial-but-trusted' })]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1'], results, events)
  assert.equal(parent.get('artifact.path'), 'partial-but-trusted')
})

test('mergeBranchContext: a key unchanged from the pre-fork snapshot is not re-merged or logged as a collision', () => {
  const parent = Context.from({ 'stable.key': 'unchanged' })
  const pre = parent.snapshot()
  const results = [
    branchResult(Status.SUCCESS, { 'stable.key': 'unchanged', 'new.key': 'added-by-r1' }),
    branchResult(Status.SUCCESS, { 'stable.key': 'unchanged', 'new.key': 'added-by-r2' }),
  ]
  const events = new EventLog(tempDir())
  mergeBranchContext(parent, pre, ['r1', 'r2'], results, events)
  assert.equal(parent.get('new.key'), 'added-by-r2')
  assert.equal(
    events.all().filter((e) => e.type === 'node.parallel.context_collision').length, 1,
    'only new.key collides -- stable.key, unchanged from prefork in both branches, is never even considered',
  )
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/parallel.test.ts`
Expected: every test fails at the `import { mergeBranchContext } from '../src/handlers/parallel.ts'` line — the file does not exist yet.

- [ ] **Step 4: Implement — create `handlers/parallel.ts`**

Create `plugins/attractor/engine/src/handlers/parallel.ts`:

```ts
import { ENGINE_MANAGED_KEYS, type Context } from '../core/context.ts'
import { Status } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'
import { type BranchRunResult } from './types.ts'

/**
 * Called once per PARALLEL dispatch (by a future ParallelHandler, p5-08 --
 * not built yet), after every branch has settled. For each branch IN
 * BRANCH-ROOT DECLARATION ORDER whose outcome.status is SUCCESS or PARTIAL:
 * merge every key in its context snapshot that differs from
 * preforkSnapshot, except the three bare ENGINE_MANAGED_KEYS, into
 * parentContext. A later branch's value for a key an earlier branch already
 * merged wins and is logged via node.parallel.context_collision -- never
 * silent.
 *
 * DECLARATION order, not completion order (ADR-010): completion order
 * depends on real subprocess timing, not reproducible run-to-run, so a
 * collision's winner would be nondeterministic -- the same defect class
 * `gateOutcomes`/`nodeFailures` already avoid by being keyed to first-visit
 * order rather than completion order (F3).
 *
 * Only SUCCESS/PARTIAL branches merge, mirroring `recordOutcome`'s own rule
 * that only a SUCCESS/PARTIAL re-execution settles a debt -- a FAILED
 * branch's partial writes are not trusted evidence, applied here to a
 * branch's aggregate result rather than one node.
 *
 * `tool.`-prefixed keys ARE merged; the three bare ENGINE_MANAGED_KEYS are
 * not. A TOOL node inside a branch writing `tool.last_line` is exactly as
 * much branch evidence as an author's own `outputs=` key -- blanket-excluding
 * it would reopen finding F1's own gap for that namespace. The filter is the
 * bare-key list, NOT `isEngineManagedKey`'s broader prefix check -- those
 * three are per-traversal-position bookkeeping the branch's own reuse of
 * `executeNodeStep` necessarily wrote, and the outer run overwrites all
 * three immediately after a real ParallelHandler returns regardless (p5-08,
 * not this task).
 */
export function mergeBranchContext(
  parentContext: Context,
  preforkSnapshot: Record<string, string>,
  branchRootIds: readonly string[],
  results: readonly BranchRunResult[],
  events: EventLog,
): void {
  const mergedBy = new Map<string, string>()
  for (let i = 0; i < branchRootIds.length; i++) {
    const rootId = branchRootIds[i]
    const result = results[i]
    if (result.outcome.status !== Status.SUCCESS && result.outcome.status !== Status.PARTIAL) continue
    for (const [key, value] of Object.entries(result.context)) {
      if (ENGINE_MANAGED_KEYS.includes(key)) continue
      if (preforkSnapshot[key] === value) continue
      const previousOwner = mergedBy.get(key)
      if (previousOwner !== undefined) {
        events.append({
          type: 'node.parallel.context_collision',
          key,
          previousBranch: previousOwner,
          winningBranch: rootId,
        })
      }
      mergedBy.set(key, rootId)
      parentContext.set(key, value)
    }
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/parallel.test.ts`
Expected: every test from Step 2 passes.

- [ ] **Step 6: Write the failing PAR-003 lint tests**

Append to `plugins/attractor/engine/test/lint.test.ts`:

```ts
// ---------------------------------------------------------------------------
// PAR-003: two or more of a component node's branch-ROOT nodes declaring the
// same outputs= key -- design-time complement to the runtime
// node.parallel.context_collision log (mergeBranchContext, above).
// ---------------------------------------------------------------------------

test('PAR-003 fires WARNING when two branch roots declare the same outputs= key', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box, outputs="implementation.path"]
    r2 [shape=box, outputs="implementation.path"]
    join [shape=box]
    start -> fan
    fan -> r1 -> join
    fan -> r2 -> join
    join -> done
  }`
  const diags = lint(parseDot(src))
  const par003 = diags.find((d) => d.code === 'PAR-003')
  assert.ok(par003)
  assert.equal(par003?.severity, Severity.WARNING)
})

test('PAR-003 does not fire when branch roots declare distinct keys', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box, outputs="a.path"]
    r2 [shape=box, outputs="b.path"]
    join [shape=box]
    start -> fan
    fan -> r1 -> join
    fan -> r2 -> join
    join -> done
  }`
  assert.ok(!codes(src).includes('PAR-003'))
})

test('PAR-003 is blind to inferred (not declared) key collisions -- named, not a defect', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=parallelogram, tool_command="printf a"]
    r2 [shape=parallelogram, tool_command="printf b"]
    join [shape=box]
    start -> fan
    fan -> r1 -> join
    fan -> r2 -> join
    join -> done
  }`
  // Both r1 and r2 infer tool.last_line/tool.output on success
  // (TOOL_OUTPUT_KEYS) -- a real collision at runtime -- but neither
  // DECLARES outputs=, so PAR-003 (declared-only) does not see it.
  assert.ok(!codes(src).includes('PAR-003'))
})
```

- [ ] **Step 7: Run to verify failure**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: the first new test fails (`PAR-003` never appears); the other two already pass vacuously and become real pins once the rule exists.

- [ ] **Step 8: Implement — add `PAR-003` to the existing `Handler.PARALLEL` block**

`plugins/attractor/engine/src/dot/lint.ts`'s import block gains `declaredOutputs` — it is already imported (used by `DATA-002`, `lint.ts:10`), so no import change is needed here.

Extend the `if (node.handler === Handler.PARALLEL) { ... }` block (as left by Task 6) by appending a new, independent statement right after its closing `if (branchRootIds.length >= 1) { ... }` block and before the block's own closing brace:

```ts
      // PAR-003: two or more branch ROOTS declaring the same outputs= key.
      // Design-time complement to mergeBranchContext's own runtime
      // node.parallel.context_collision log (handlers/parallel.ts, p5-07) --
      // sees only each branch root's own DECLARED outputs=, not the whole
      // branch sub-path and not inferred keys like tool.last_line (a future
      // PAR-006, not this rule).
      const declaredBy = new Map<string, string>()
      for (const rootId of branchRootIds) {
        const rootNode = graph.nodes.get(rootId)
        if (!rootNode) continue
        for (const key of declaredOutputs(rootNode)) {
          const owner = declaredBy.get(key)
          if (owner !== undefined && owner !== rootId) {
            diags.push({
              code: 'PAR-003',
              severity: Severity.WARNING,
              node: node.id,
              message:
                `node ${node.id}'s branches ${owner} and ${rootId} both declare ` +
                `outputs="${key}" -- whichever branch is declared LAST wins when their ` +
                `writes merge back after the fan-out (branch declaration order, not ` +
                `completion order). This rule only sees each branch root's own declared ` +
                `outputs=, not inferred keys like tool.last_line -- a collision on those is ` +
                `caught only at runtime, logged as node.parallel.context_collision`,
            })
          } else if (owner === undefined) {
            declaredBy.set(key, rootId)
          }
        }
      }
```

- [ ] **Step 9: Run to verify pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: every test from Step 6 passes, and every Task 4/6 `PAR-001`/`PAR-002`/`PAR-004`/`PAR-005` test still passes unmodified.

- [ ] **Step 10: Update `README.md`**

In `## Lint rules` (extend the sentence Tasks 4/6 already built, inserting `PAR-003` before the closing period, and add it to the warnings list):

```
Old (as left by Task 6):
reach the graph's real exit node before the fan-out's own convergence node.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003`, `PAR-002` and
`PAR-005` are warnings; the rest are errors, and `attractor run` refuses a
graph with any error.

New:
reach the graph's real exit node before the fan-out's own convergence node;
`PAR-003` two or more of a component node's branch-root nodes declaring the
same `outputs=` key.

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001`, `HITL-003`, `PAR-002`,
`PAR-003` and `PAR-005` are warnings; the rest are errors, and `attractor
run` refuses a graph with any error.
```

- [ ] **Step 11: Run the full regression suite**

Run: `cd plugins/attractor/engine && node --test`
Expected: 0 failing, test count up by 10 relative to baseline (7 from Step 2, 3 from Step 6).

- [ ] **Step 12: Commit**

```bash
git add plugins/attractor/engine/src/handlers/types.ts \
        plugins/attractor/engine/src/core/engine.ts \
        plugins/attractor/engine/src/handlers/parallel.ts \
        plugins/attractor/engine/src/dot/lint.ts \
        plugins/attractor/engine/test/parallel.test.ts \
        plugins/attractor/engine/test/lint.test.ts \
        plugins/attractor/README.md
git commit -m "$(cat <<'EOF'
engine: merge a branch's Context writes back deterministically, add PAR-003 (p5-07)

Closes a real, previously-latent silent-data-loss bug (finding F1): nothing
in the design as first written ever copied a branch's writes back out of its
clone. Three branches all declaring outputs="implementation.path" would each
succeed inside their own isolated Context, clearing failedOutputs and
leaving nothing to flag a problem -- but the convergence node, dispatched
afterward in the run's own real, un-cloned Context, would substitute an
empty or stale value. mergeBranchContext closes it: each SUCCESS/PARTIAL
branch's diff against its pre-fork snapshot merges into the parent Context
in BRANCH-DECLARATION order (never completion order, which depends on real
subprocess timing and would make a collision's winner nondeterministic --
ADR-010), logging every collision via node.parallel.context_collision rather
than letting the last write silently win.

BranchRunResult (p5-05) gains a context field, populated by runBranch via
Context.snapshot() at the moment its traversal stops. PAR-003 (WARNING) is
the design-time complement: flags two branch roots declaring the same
outputs= key before a run starts, though -- named, not hidden -- it is blind
to inferred-key collisions (tool.last_line) the runtime merge still catches.

handlers/parallel.ts is created with only mergeBranchContext exported;
ParallelHandler itself, which will actually call it from a real dispatch, is
p5-08's own addition to this same file, not this task's.
EOF
)"
```

