import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWorktree, removeWorktree, isGitRepo } from '../src/run/worktree.ts'

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

test('a git directory is recognised and a plain one is not', () => {
  const r = repo()
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    assert.equal(isGitRepo(r), true)
    assert.equal(isGitRepo(plain), false)
  } finally {
    rmSync(r, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  }
})

test('a worktree is created on its own branch with the seed content', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run1')
    assert.ok(existsSync(wt.path), 'the worktree directory exists')
    assert.ok(existsSync(join(wt.path, 'seed.txt')), 'it has the repo content')
    assert.match(wt.branch, /run1/)
    removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('work in the worktree does not appear in the main tree', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run2')
    writeFileSync(join(wt.path, 'only-here.txt'), 'x', 'utf8')
    assert.equal(existsSync(join(r, 'only-here.txt')), false, 'the main tree is untouched')
    removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal leaves the main working tree intact', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run3')
    removeWorktree(r, wt)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the main tree survives removal')
    assert.equal(existsSync(wt.path), false, 'the worktree is gone')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal is safe to call twice', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run4')
    assert.equal(removeWorktree(r, wt).removed, true)
    assert.equal(removeWorktree(r, wt).removed, true, 'a second removal is a no-op, not an error')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree git has forgotten is preserved, not guessed safe to delete', () => {
  // Without git's administrative record there is no `git status` to run, so
  // there is no reliable way to prove the directory holds nothing but
  // clean, committed content -- even though in THIS case it does (only the
  // checked-out seed.txt, nothing added since). The guard cannot tell that
  // from the reviewer's scenario below, where real uncommitted work is
  // sitting there, so it must treat both the same way: preserve rather than
  // guess.
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = createWorktree(r, 'run6')
    // Simulate git losing the administrative record while the directory
    // remains. `git worktree prune` alone will NOT clean this up -- prune
    // only reconciles metadata for directories that are already gone.
    rmSync(join(r, '.git', 'worktrees', 'run6'), { recursive: true, force: true })

    const result = removeWorktree(r, wt)
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

test('the reviewer repro: uncommitted work survives even with the admin record gone', () => {
  // The exact failure Finding 2 reported: create a worktree, write an
  // uncommitted file, delete git's admin record for it, call
  // removeWorktree. Before the fix this returned {"removed":true} and
  // destroyed the file, with a warning that mentioned only git's own
  // failure -- never the lost work.
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = createWorktree(r, 'run11')
    writeFileSync(join(wt.path, 'VALUABLE-OUTPUT.txt'), 'hours of work', 'utf8')
    rmSync(join(r, '.git', 'worktrees', 'run11'), { recursive: true, force: true })

    const result = removeWorktree(r, wt)
    assert.equal(result.removed, false, 'must refuse rather than destroy')
    assert.equal(existsSync(join(wt.path, 'VALUABLE-OUTPUT.txt')), true, 'the file survives')
    assert.match(result.warning ?? '', /uncommitted work|administrative record/i)
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('the root guard survives a symlinked path to the same repository', () => {
  // resolve() is lexical, so a repo reached through a symlink compares
  // unequal to itself and slips a naive guard. On macOS /tmp and /var are
  // symlinks, so this is ordinary rather than exotic.
  const r = repo()
  const link = join(mkdtempSync(join(tmpdir(), 'attractor-link-')), 'repo-link')
  try {
    symlinkSync(r, link)
    const result = removeWorktree(link, { path: realpathSync(r), branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(link, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a directory this module did not create', () => {
  // Worktree is a plain record, so a hand-built one must not be able to aim
  // an unconditional recursive delete at an arbitrary directory.
  const r = repo()
  const stranger = mkdtempSync(join(tmpdir(), 'attractor-stranger-'))
  try {
    writeFileSync(join(stranger, 'important.txt'), 'keep me', 'utf8')
    const result = removeWorktree(r, { path: stranger, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /not a worktree this module created/)
    assert.equal(existsSync(join(stranger, 'important.txt')), true, 'the directory must survive')
  } finally {
    rmSync(stranger, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree outside our convention keeps its parent directory', () => {
  // Reached via the branch where git's own removal SUCCEEDS, which skips the
  // rmSync ownership gate entirely. The parent cleanup must be gated too.
  const r = repo()
  const parent = mkdtempSync(join(tmpdir(), 'attractor-notours-'))
  const manual = join(parent, 'child')
  try {
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'manual/branch', manual], { cwd: r })
    const result = removeWorktree(r, { path: manual, branch: 'manual/branch' })
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

test('a clean removal and a repeat call produce no warning', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run7')
    const first = removeWorktree(r, wt)
    assert.equal(first.warning, undefined, 'a clean removal has nothing to report')
    const second = removeWorktree(r, wt)
    assert.equal(second.removed, true)
    assert.equal(second.warning, undefined, 'an already-gone target is a clean no-op')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a path that is the repository root', () => {
  const r = repo()
  try {
    const result = removeWorktree(r, { path: r, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /repository root/)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('the mkdtemp parent is cleaned up after a normal removal', () => {
  // The POSITIVE half of the ownership gate. Without this, a refactor that
  // computes ownership after deletion still passes every test while silently
  // leaking a temp directory per run: realOrResolved falls back to a lexical
  // path once the directory is gone, and lexical /var/... does not match a
  // realpath'd /private/var/..., so the check answers "not ours".
  const r = repo()
  try {
    const wt = createWorktree(r, 'run8')
    const parent = dirname(wt.path)
    assert.equal(existsSync(parent), true, 'the parent exists while the worktree does')
    removeWorktree(r, wt)
    assert.equal(existsSync(parent), false, 'an emptied parent we created must not be leaked')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('uncommitted work is preserved, not deleted', () => {
  // The failure this guards: a pipeline runs for hours, its box node writes
  // real output, the goal gate passes, and cleanup deletes everything while
  // reporting success.
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = createWorktree(r, 'run9')
    writeFileSync(join(wt.path, 'VALUABLE-OUTPUT.txt'), 'hours of work', 'utf8')

    const result = removeWorktree(r, wt)
    assert.equal(result.removed, false, 'must refuse rather than destroy')
    assert.equal(existsSync(join(wt.path, 'VALUABLE-OUTPUT.txt')), true, 'work survives')
    assert.match(result.warning ?? '', /uncommitted work/)
    assert.match(result.warning ?? '', new RegExp(wt.branch), 'the warning names the branch')
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree whose work is committed is removed normally', () => {
  // The permit half: committing is what makes cleanup safe.
  const r = repo()
  try {
    const wt = createWorktree(r, 'run10')
    writeFileSync(join(wt.path, 'shipped.txt'), 'done', 'utf8')
    execFileSync('git', ['add', '-A'], { cwd: wt.path })
    execFileSync('git', ['commit', '-qm', 'ship'], { cwd: wt.path })

    const result = removeWorktree(r, wt)
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

test('a non-repository refuses rather than running in place', () => {
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    // Assert OUR message, not git's. Git also says "not a git repository",
    // so matching that phrase would pass even with our guard deleted -- the
    // test would be verifying git's behaviour rather than ours, and would
    // silently stop covering us if git ever reworded its error.
    assert.throws(() => createWorktree(plain, 'run5'), /cannot create an isolated worktree/)
  } finally {
    rmSync(plain, { recursive: true, force: true })
  }
})
