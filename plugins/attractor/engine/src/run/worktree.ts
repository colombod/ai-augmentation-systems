import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** Every worktree directory this module creates carries this prefix. */
const WT_PREFIX = 'attractor-wt-'

export interface Worktree {
  path: string
  branch: string
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function isGitRepo(dir: string): boolean {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
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
export function createWorktree(repoDir: string, runId: string): Worktree {
  if (!isGitRepo(repoDir)) {
    throw new Error(`not a git repository: ${repoDir} -- cannot create an isolated worktree`)
  }
  const branch = `attractor/${runId}`
  const parent = mkdtempSync(join(tmpdir(), WT_PREFIX))
  const path = join(parent, runId)
  try {
    git(repoDir, ['worktree', 'add', '-q', '-b', branch, path])
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

/**
 * Remove the worktree, keeping its branch. The branch IS the deliverable --
 * a reviewable record of what the run did -- so discarding it here would
 * throw away the work the isolation existed to protect.
 *
 * Safe to call twice, so cleanup paths in `finally` need no guard. It
 * returns a result rather than throwing, for the same reason: throwing from
 * a `finally` would mask the run's real outcome.
 *
 * `git worktree prune` alone is NOT sufficient cleanup. Prune only
 * reconciles metadata for directories that are already gone; it will not
 * delete a directory git has forgotten about. Relying on it leaked the
 * worktree permanently with no diagnostic.
 */
/**
 * Resolve through symlinks where possible.
 *
 * `resolve()` alone is purely lexical -- it never consults the filesystem --
 * so two strings naming the SAME directory through different symlink chains
 * compare unequal. On macOS `/tmp` and `/var` are symlinks, so this is the
 * common case rather than an exotic one, and a lexical-only comparison let a
 * repository reach a direct rmSync in testing.
 */
function realOrResolved(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    // A path that does not exist cannot be realpath'd; lexical is the best
    // available, and a non-existent path is not one we will delete anyway.
    return abs
  }
}

/**
 * Is this a directory THIS module created?
 *
 * `createWorktree` always builds `join(mkdtempSync(join(tmpdir(), PREFIX)), runId)`,
 * so a genuine worktree lives under the OS temp directory with a parent named
 * for that prefix. Requiring both is a far tighter containment than merely
 * refusing the repository root: `Worktree` is a plain `{ path, branch }`
 * record, so any caller that hand-builds one -- from a config file, a resumed
 * run record, or a typo -- could otherwise aim an unconditional recursive
 * delete at an arbitrary directory.
 */
function isOurWorktree(target: string): boolean {
  const tmpRoot = realOrResolved(tmpdir())
  const t = realOrResolved(target)
  return t.startsWith(`${tmpRoot}${sep}`) && basename(dirname(t)).startsWith(WT_PREFIX)
}

/**
 * Does this worktree hold anything not yet committed, including untracked
 * files? `--porcelain` lists both, so an empty result means everything the
 * run produced is safely on the branch.
 */
function hasUncommittedWork(worktreePath: string): boolean {
  try {
    return git(worktreePath, ['status', '--porcelain']).trim() !== ''
  } catch {
    // If git cannot answer, assume there IS work. Guessing "nothing here"
    // would delete on exactly the reading we are least sure about.
    return true
  }
}

/**
 * Is `target` a worktree git currently has registered against `repoDir`?
 *
 * This gates when it is even meaningful to ask `hasUncommittedWork`.
 * `git status --porcelain` fails identically -- "fatal: not a git
 * repository", exit 128 -- whether `target` never was a worktree at all (a
 * hand-built record, or a stray directory) or WAS one but git's own
 * administrative link for it is gone (its `.git/worktrees/<name>` metadata
 * deleted out from under it). `hasUncommittedWork`'s conservative
 * assume-true-on-error fallback would misread either of those as "uncommitted
 * work present" and block legitimate cleanup that has nothing to do with
 * unreviewed pipeline output -- there is no worktree there for git to check.
 * `git worktree list` reads the SAME administrative records `git status`
 * needs, so a target missing from this list is exactly the set of paths
 * `hasUncommittedWork` cannot answer for, and asking it is skipped rather
 * than guessed.
 */
function isRegisteredWorktree(repoDir: string, target: string): boolean {
  try {
    const out = git(repoDir, ['worktree', 'list', '--porcelain'])
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ') && realOrResolved(line.slice('worktree '.length)) === target) {
        return true
      }
    }
    return false
  } catch {
    // Cannot enumerate worktrees at all -- treat as unregistered, the same
    // "nothing for hasUncommittedWork to check" outcome as a target absent
    // from a successfully-read list.
    return false
  }
}

/**
 * Best-effort fallback used ONLY when `isRegisteredWorktree` says no. That
 * happens for two very different reasons -- a hand-built record that was
 * never a worktree at all, or one of OURS whose git admin link
 * (`.git/worktrees/<id>`) has been lost while the directory on disk
 * survives -- and this function exists for the second case, gated by `ours`
 * at the call site. Without a registered admin link there is no `git
 * status` to run and therefore no way to ask git whether the directory is
 * clean. Any content at all is treated as work worth protecting rather than
 * guessed to be safe: a directory checked out from a branch is never empty
 * immediately after `git worktree add` succeeds, so this reliably catches
 * the case git itself can no longer vouch for.
 */
function isNonEmptyDirectory(path: string): boolean {
  try {
    return readdirSync(path).length > 0
  } catch {
    // Unreadable is not "empty" -- if it cannot even be listed, there is
    // certainly no proof there is nothing to lose.
    return true
  }
}

export function removeWorktree(repoDir: string, wt: Worktree): RemovalResult {
  const target = realOrResolved(wt.path)
  const root = realOrResolved(repoDir)

  // Decide ownership ONCE, while the directory still exists. Asking later
  // would be unreliable: realOrResolved falls back to a lexical path for
  // something already deleted, and a lexical /tmp/... does not match a
  // realpath'd /private/tmp/... -- so a just-removed worktree would look
  // like it was never ours and its parent would be left behind.
  const ours = isOurWorktree(target)

  // Belt: never touch the repository itself. `git worktree remove` refuses
  // the main working tree on its own, so this guard exists only because of
  // the direct rmSync below, which has no such protection.
  if (target === root || root.startsWith(`${target}${sep}`)) {
    return {
      removed: false,
      warning: `refusing to remove ${target}: it is, or contains, the repository root`,
    }
  }

  // Never delete unreviewed work. A box node writes into the worktree and
  // does NOT commit -- committing is the pipeline's job, as the canonical
  // task-runner does in its package node. If the pipeline omits that step,
  // deleting the directory destroys everything the run produced while
  // reporting success. Refusing to remove costs a stale directory; removing
  // costs the work itself.
  //
  // This check MUST run before `git worktree remove --force` below, not
  // after. `--force` is exactly what bypasses git's own refusal to remove a
  // dirty worktree, and it deletes the directory from disk immediately --
  // synchronously, not just the administrative record. A check placed after
  // that call finds `existsSync(target)` already false and never fires,
  // which is indistinguishable from no guard at all.
  //
  // Gated on `isRegisteredWorktree`: only ask `hasUncommittedWork` about a
  // path git currently recognises as a worktree of this repository. For
  // anything else -- never registered, or its administrative record already
  // gone -- there is no reliable answer, and the existing fallback below
  // (force remove, then the ownership-gated direct delete) already handles
  // those cases correctly.
  const registered = existsSync(target) && isRegisteredWorktree(repoDir, target)

  if (registered && hasUncommittedWork(target)) {
    return {
      removed: false,
      warning:
        `keeping ${target}: it has uncommitted work on branch ${wt.branch}. ` +
        `Commit it there, or delete the directory once you have salvaged it.`,
    }
  }

  // git's own record for this worktree is gone (its `.git/worktrees/<id>`
  // administrative link deleted out from under it, or lost some other way),
  // so `hasUncommittedWork` has nothing to ask -- `git status` needs that
  // same link and fails identically whether or not real work is sitting
  // there uncommitted. Skipping the guard in this case would read the
  // ABSENCE of a git record as evidence of safety, when it is exactly the
  // opposite: the one case we are least able to verify. Gated on `ours`,
  // because only a directory this module created is ever a candidate for
  // the direct delete below that this guard exists to stop.
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
    git(repoDir, ['worktree', 'remove', '--force', target])
  } catch (err) {
    // Keep the whole message: git puts the actual reason ("is not a working
    // tree", "is a main working tree") on a later line, so taking only the
    // first would make every failure read identically.
    gitError = (err instanceof Error ? err.message : String(err)).trim()
  }

  // Reconcile git's administrative record either way.
  try {
    git(repoDir, ['worktree', 'prune'])
  } catch {
    // Metadata only; a failure here does not affect the directory.
  }

  const survivedGit = existsSync(target)
  if (survivedGit) {
    // Braces: only a directory this module created may be deleted directly.
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

  // The mkdtemp parent holds only this worktree; drop it if it is now empty.
  // Gated by the SAME ownership check as the deletion above. Without it this
  // block still ran when git's own removal succeeded, so a git-registered
  // worktree at a non-conventional path had its parent removed too -- which
  // the "only ours" invariant exists to forbid, and which made the invariant
  // non-uniform across the function.
  if (ours) {
    const parent = dirname(target)
    try {
      if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
    } catch {
      // A shared or non-empty parent is not ours to remove.
    }
  }

  // Warn only when git actually failed AND left something behind for us to
  // clean up. A second call, or a target that was already gone, is a clean
  // no-op -- reporting a git failure there would be factually wrong and
  // would recreate the ambiguity this result type exists to remove.
  if (survivedGit && gitError !== undefined) {
    return {
      removed: true,
      warning: `git could not remove the worktree cleanly, directory was deleted directly: ${gitError}`,
    }
  }
  return { removed: true }
}
