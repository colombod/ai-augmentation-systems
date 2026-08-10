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

// ---------------------------------------------------------------------------
// R-sprint2-1 (`.delivery/reviews/sprint-2-01.md`): concurrent createWorktree
// calls against the SAME repo occasionally corrupted git's own administrative
// state instead of refusing cleanly -- `fatal: failed to read
// .git/worktrees/<sibling>/commondir: Undefined error: 0`, reproduced live at
// roughly 1-in-15 to 1-in-25 FULL-SUITE runs by the 5-way test above. That
// finding's own resolution note said this had to be fixed "before p5-08's
// `max_parallel` branches makes this reachable in production" -- p5-08's
// `ParallelHandler` (`src/handlers/parallel.ts`) has since shipped with
// concurrent worktree creation as the DEFAULT, unconfigured path, so this is
// no longer theoretical. `createWorktree` now retries this specific error
// pattern (see the block comment above `RACE_ERROR_PATTERN` in
// `src/run/worktree.ts`); the test below is the permanent regression guard.
//
// A single repo at even 30-way concurrency only occasionally reproduced the
// race pre-fix (measured ~2.5% per test run against the pre-fix code, via a
// scratch repro script, not committed) -- what actually raised the odds was
// TOTAL system-wide `git` process contention, not the call count against one
// repo alone. Ten repos hammered concurrently, 30 concurrent createWorktree
// calls against EACH -- still "several concurrent createWorktree calls
// against one repo", ten times over, all at once -- reliably reproduced the
// race pre-fix in this environment (individual repo batches failed often
// enough that a single test invocation had a strong, non-coin-flip chance of
// catching it: multiple batches of ten such repo-groups averaged more than
// one failure per group). Post-fix, thousands of calls at this exact
// amplification produced zero failures in the verification that shipped this
// fix. This is a genuine race, so a clean run here is evidence, not proof --
// but a red run is real signal that the retry has regressed.
test('ten repos hammered concurrently, 30-way createWorktree each: the race stays fixed under heavy load (R-sprint2-1)', async () => {
  const REPO_COUNT = 10
  const CONCURRENCY = 30
  const repos = Array.from({ length: REPO_COUNT }, () => repo())
  try {
    const perRepoResults = await Promise.all(
      repos.map((r, ri) => Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => createWorktree(r, `stress-${ri}-${i}`)),
      )),
    )
    for (const [ri, results] of perRepoResults.entries()) {
      const paths = new Set(results.map((wt) => wt.path))
      const branches = new Set(results.map((wt) => wt.branch))
      assert.equal(paths.size, CONCURRENCY, `repo ${ri}: every worktree got a distinct path`)
      assert.equal(branches.size, CONCURRENCY, `repo ${ri}: every worktree got a distinct branch`)
      for (const wt of results) assert.ok(existsSync(wt.path), `${wt.path} exists`)
    }
    await Promise.all(
      perRepoResults.flatMap((results, ri) => results.map((wt) => removeWorktree(repos[ri], wt))),
    )
  } finally {
    for (const r of repos) rmSync(r, { recursive: true, force: true })
  }
})

// A second, DETERMINISTIC test alongside the amplified stress test above was
// considered and deliberately not added. `GatedBackend` (`test/fixtures.ts`)
// can force deterministic interleaving because `Backend` is a pluggable
// interface `Engine` already depends on through injection -- there is
// somewhere to put a test double. `worktree.ts`'s `git()` helper has no such
// seam: it is a private, unexported function, and `createWorktree` calls it
// directly rather than through an injectable dependency. The one built-in
// mechanism that could substitute a builtin module without changing
// `worktree.ts`'s shape, `node:test`'s `mock.module`, is unavailable in this
// runtime without `--experimental-test-module-mocks` -- confirmed directly:
// `mock.module` is `undefined` under a plain `node --test` invocation, which
// is what this suite's own verification command uses, so a test relying on
// it would silently not do what it claims under the command that actually
// runs it. Exporting `git()` (or the whole retry helper) purely so a test
// could inject a fake failure would widen this module's public surface for
// no reason a real caller needs -- exactly the "awkward test double" this
// module's own existing tests avoid elsewhere. The amplified stress test
// above is the regression guard.
