import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from '../src/cli.ts'

const GOOD = `
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  start -> a -> done
}
`

// Writes a marker file so the test can tell WHERE the run actually executed:
// present in cwd means it ran in place, absent means it ran in the worktree.
const MARKS = `
digraph M {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf here > marker.txt; printf ok"]
  start -> a -> done
}
`

function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-cli-be-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

/** A real, minimally-configured git repository for the positive --worktree case. */
function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-cli-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'seed.txt'), 'seed', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('doctor reports the environment and exits meaningfully', async () => {
  const code = await main(['doctor'])
  assert.ok(code === 0 || code === 1, 'doctor returns a definite verdict')
})

test('--worktree in a non-repository refuses before running anything', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--worktree', '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 1, 'a non-repository must not silently run in place')
  })
})

test('an unknown flag is a usage error rather than being ignored', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main(['run', file, '--nonsense', '--cwd', dir, '--stub'])
    assert.equal(code, 2)
  })
})

test('--stub still runs a graph unchanged', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 0)
  })
})

// The refusal path is covered above; a predicate that both permits and
// forbids needs its success path exercised too, or the refusal test alone
// would still pass if --worktree were wired to always fail.
test('--worktree in a real repository isolates the run and cleans up after itself', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, MARKS, 'utf8')
    const code = await main([
      'run', file, '--worktree', '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 0, 'a real repository must let the isolated run proceed')
    assert.equal(
      existsSync(join(dir, 'marker.txt')),
      false,
      'the tool command ran in the worktree, not in the main working tree',
    )

    // The branch survives even though the worktree directory is gone --
    // it is the whole point of isolating the run in the first place.
    const branches = execFileSync('git', ['branch', '--list', 'attractor/*'], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.match(branches, /attractor\//, 'the run left its branch behind for review')
  })
})

/**
 * Run `main` while capturing everything written to stdout, so the test can
 * recover the worktree path the CLI reports without scanning the shared OS
 * temp directory -- other test FILES (worktree.test.ts in particular) create
 * their own attractor-wt-* directories there and run concurrently under
 * `node --test`, so a global directory listing is not this test's to read.
 */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  let captured = ''
  const original = process.stdout.write.bind(process.stdout)
  const spy = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    captured += chunk.toString()
    return (original as (...a: unknown[]) => boolean)(chunk, ...rest)
  }
  process.stdout.write = spy as typeof process.stdout.write
  try {
    await fn()
  } finally {
    process.stdout.write = original
  }
  return captured
}

/** Same idea as captureStdout, for the warnings Finding 4 puts on stderr. */
async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
  let captured = ''
  const original = process.stderr.write.bind(process.stderr)
  const spy = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    captured += chunk.toString()
    return (original as (...a: unknown[]) => boolean)(chunk, ...rest)
  }
  process.stderr.write = spy as typeof process.stderr.write
  try {
    await fn()
  } finally {
    process.stderr.write = original
  }
  return captured
}

// Engine's constructor builds an EventLog, whose constructor calls mkdirSync
// on --run-dir -- real I/O that throws when a path component is a plain
// file. That throw happens AFTER createWorktree already succeeded, so
// whether the worktree gets cleaned up depends entirely on where the `try`
// opens relative to `createWorktree`.
test('a --run-dir that cannot be created does not leak the worktree', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')

    // A regular file standing where a directory component is expected makes
    // mkdirSync(runDir, { recursive: true }) throw ENOTDIR.
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory', 'utf8')
    const badRunDir = join(blocker, 'r')

    let worktreePath: string | undefined
    const stdout = await captureStdout(async () => {
      await assert.rejects(
        main(['run', file, '--worktree', '--cwd', dir, '--run-dir', badRunDir, '--stub']),
        'a run directory that cannot be created must not exit cleanly with the worktree still standing',
      )
    })

    const match = /^worktree: (\S+) /m.exec(stdout)
    assert.ok(match, 'the worktree path must have been reported before the failure')
    worktreePath = match[1]

    // The mkdtemp PARENT is what createWorktree actually creates and what
    // removeWorktree is responsible for taking back down; checking only the
    // reported worktree path itself would miss a parent left behind empty.
    assert.equal(
      existsSync(dirname(worktreePath)),
      false,
      'the worktree temp directory must not survive a run that failed after it was created',
    )
  })
})

// The success-path half of the collision fix: removeWorktree deliberately
// preserves branches, so a bare basename() runId would make this ordinary
// retry collide with the branch the first run left behind.
test('two successive --worktree runs against the same --run-dir both succeed', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const runDir = join(dir, 'r')

    const first = await main([
      'run', file, '--worktree', '--cwd', dir, '--run-dir', runDir, '--stub',
    ])
    assert.equal(first, 0, 'the first run succeeds')

    const second = await main([
      'run', file, '--worktree', '--cwd', dir, '--run-dir', runDir, '--stub',
    ])
    assert.equal(second, 0, 'a retry against the same --run-dir must not collide with the first run\'s branch')
  })
})

// Finding 4: isolation must be the default for a real run, not an opt-in.
// None of GOOD/MARKS contains a box (codergen) node, so dropping --stub
// here still never calls ClaudeCodeBackend.run() -- no real `claude`
// process is spawned, only the CLI's own pre-engine isolation decision is
// exercised. That is deliberate: it is the only way to cover the default
// real-backend path without violating "no test may invoke the real claude
// binary".
test('a real run inside a repo isolates by default, with no flags at all', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, MARKS, 'utf8')
    const stdout = await captureStdout(async () => {
      const code = await main(['run', file, '--cwd', dir, '--run-dir', join(dir, 'r')])
      assert.equal(code, 0)
    })
    assert.match(stdout, /^worktree: /m, 'a worktree was created without --worktree being passed')
    assert.equal(
      existsSync(join(dir, 'marker.txt')),
      false,
      'the tool command ran in the worktree, not in the main working tree',
    )
  })
})

test('--in-place opts out of the default isolation and warns loudly', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, MARKS, 'utf8')
    const stderr = await captureStderr(async () => {
      const code = await main(['run', file, '--in-place', '--cwd', dir, '--run-dir', join(dir, 'r')])
      assert.equal(code, 0)
    })
    assert.equal(
      existsSync(join(dir, 'marker.txt')),
      true,
      '--in-place must run directly in --cwd, not in an isolated worktree',
    )
    assert.match(stderr, /WARNING/, 'the operator is warned loudly, not just told in passing')
    assert.match(stderr, /in-place/i)
  })
})

test('a real run outside a repository cannot isolate and warns instead', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const stderr = await captureStderr(async () => {
      const code = await main(['run', file, '--cwd', dir, '--run-dir', join(dir, 'r')])
      assert.equal(code, 0)
    })
    assert.match(stderr, /WARNING/)
    assert.match(stderr, /not a git repository/i)
  })
})

test('--worktree and --in-place together are a usage error', async () => {
  await withRepo(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--worktree', '--in-place', '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 2, 'contradictory flags must not silently pick a winner')
  })
})
