import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { parseDot } from './dot/parse.ts'
import { lint, hasErrors } from './dot/lint.ts'
import { Context, isEngineManagedKey } from './core/context.ts'
import { Engine, defaultHandlers } from './core/engine.ts'
import { StubBackend } from './handlers/stub.ts'
import { Status } from './core/outcome.ts'
import { ClaudeCodeBackend } from './backend/claude.ts'
import { createWorktree, removeWorktree, isGitRepo, type Worktree } from './run/worktree.ts'
import { runChecks, formatChecks, checksPass } from './doctor.ts'

const USAGE = `attractor - DOT pipeline runner

Usage:
  attractor lint   <file.dot>
  attractor run    <file.dot> [--param key=value]... [--cwd dir] [--run-dir dir]
                    [--stub] [--model name] [--max-budget-usd n]
                    [--allow-tools tool,tool,...] [--worktree] [--in-place]
  attractor doctor

Options:
  --param key=value     Seed a context value. Repeatable.
  --cwd dir             Working directory for shell commands. Default: current directory.
  --run-dir dir         Where checkpoints, events and node artifacts are written.
                        Default: .attractor/runs/<timestamp>
  --stub                Execute LLM nodes with the deterministic stub backend
                        instead of the real claude backend.
  --model name          Model to pass to the claude backend.
  --max-budget-usd n    Budget cap to pass to the claude backend. Must be a
                        positive number.
  --allow-tools t,t,... Comma-separated list of tools the claude backend may use.
  --worktree            Explicit, redundant request for what a real run does by
                        default: isolate in a dedicated git worktree. Refuses
                        if --cwd is not inside a git repository.
  --in-place            Opt out of the default isolation and run the real
                        backend directly in --cwd. An unattended model gets
                        bypassed permissions and shell/write access (Bash,
                        Read, Write, Edit by default) to that directory --
                        only pass this if you mean it.

Isolation is the default for a real (non --stub) run: when --cwd is inside a
git repository, a dedicated worktree is created automatically, exactly as
--worktree requests explicitly. Pass --in-place to run directly in --cwd
instead. When --cwd is NOT a git repository, isolation is not possible and
the run proceeds in place with a warning. --stub never touches --cwd this
way and needs neither flag.
`

interface RunArgs {
  file: string
  params: Record<string, string>
  cwd: string
  runDir: string
  stub: boolean
  model?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  worktree: boolean
  inPlace: boolean
}

function parseRunArgs(argv: string[]): RunArgs | null {
  const file = argv[0]
  if (!file || file.startsWith('--')) return null
  const params: Record<string, string> = {}
  let cwd = process.cwd()
  let runDir = ''
  let stub = false
  let model: string | undefined
  let maxBudgetUsd: number | undefined
  let allowedTools: string[] | undefined
  let worktree = false
  let inPlace = false

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--param') {
      const pair = argv[++i] ?? ''
      const eq = pair.indexOf('=')
      if (eq <= 0) {
        // Silently dropping a typo'd param would run the whole pipeline with
        // a missing context value and nothing linking back to the mistake.
        process.stderr.write(`invalid --param "${pair}": expected key=value\n`)
        return null
      }
      params[pair.slice(0, eq)] = pair.slice(eq + 1)
    } else if (arg === '--cwd') {
      cwd = resolve(argv[++i] ?? '.')
    } else if (arg === '--run-dir') {
      runDir = resolve(argv[++i] ?? '.')
    } else if (arg === '--stub') {
      stub = true
    } else if (arg === '--model') {
      model = argv[++i]
    } else if (arg === '--max-budget-usd') {
      const raw = argv[++i] ?? ''
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`invalid --max-budget-usd "${raw}": expected a positive number\n`)
        return null
      }
      maxBudgetUsd = n
    } else if (arg === '--allow-tools') {
      allowedTools = (argv[++i] ?? '').split(',').filter((t) => t !== '')
    } else if (arg === '--worktree') {
      worktree = true
    } else if (arg === '--in-place') {
      inPlace = true
    } else if (arg.startsWith('--')) {
      // Ignoring an unrecognised flag would let a typo change what runs.
      process.stderr.write(`unknown option ${arg}\n`)
      return null
    }
  }

  if (worktree && inPlace) {
    // Contradictory: one asks for isolation, the other opts out of it.
    // Silently picking a winner would mean the operator's actual intent
    // depends on flag-parsing order rather than being stated.
    process.stderr.write('--worktree and --in-place are mutually exclusive\n')
    return null
  }

  if (runDir === '') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = resolve(cwd, '.attractor', 'runs', stamp)
  }
  return { file: resolve(file), params, cwd, runDir, stub, model, maxBudgetUsd, allowedTools, worktree, inPlace }
}

/**
 * Report, but do NOT refuse, a `--param` that names an engine-managed key.
 *
 * Decision, recorded because "we thought about it" and "we did not notice" are
 * indistinguishable from the code alone. `Context.from(args.params)` seeds
 * context without consulting `isEngineManagedKey`, so `--param current_node=x`
 * writes a key `handlers/box.ts` would refuse from a model. That is not a
 * doctrine breach: the engine-managed namespace guard exists so a MODEL cannot
 * forge the control plane's routing tokens, and an operator typing `--param`
 * is the same authority that wrote the graph. Authoring, not forgery.
 *
 * A hard refusal would also be a real regression. `Engine.run` mirrors graph
 * attributes only `if (!context.has(qualified))`, deliberately, so that a run
 * parameter overrides `graph.goal` -- rejecting engine-managed keys here would
 * delete that documented override.
 *
 * What was genuinely wrong is that the bypass was silent, and its effect is
 * not guessable from outside the engine: `current_node` and `outcome` are
 * rewritten before any condition reads them, so seeding those does nothing at
 * all, while `preferred_label` and `tool.*` persist until something overwrites
 * them and CAN change a route. An operator debugging a surprising branch needs
 * that said out loud, which costs a line and forbids nothing.
 */
function warnOnManagedParams(params: Record<string, string>): void {
  for (const key of Object.keys(params)) {
    if (!isEngineManagedKey(key)) continue
    process.stderr.write(
      `WARNING: --param ${key} names a context key the engine owns. It is seeded as ` +
        `asked, but the engine may overwrite it at any step, and if it survives it can ` +
        `change routing.\n`,
    )
  }
}

/** Read a pipeline file, reporting an operator-readable error instead of a stack trace. */
function readPipeline(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`cannot read ${file}: ${reason}\n`)
    return null
  }
}

function reportDiagnostics(file: string, source: string): boolean {
  const diags = lint(parseDot(source))
  for (const d of diags) {
    const where = d.node ? `${file}:${d.node}` : file
    process.stderr.write(`${d.severity.toUpperCase()} ${d.code} ${where}: ${d.message}\n`)
  }
  return hasErrors(diags)
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0]

  if (command === 'lint') {
    const file = argv[1]
    if (!file) {
      process.stderr.write(USAGE)
      return 2
    }
    const resolved = resolve(file)
    const source = readPipeline(resolved)
    if (source === null) return 2
    if (reportDiagnostics(resolved, source)) return 1
    process.stdout.write(`${file}: no errors\n`)
    return 0
  }

  if (command === 'doctor') {
    const checks = runChecks()
    process.stdout.write(formatChecks(checks))
    return checksPass(checks) ? 0 : 1
  }

  if (command === 'run') {
    const args = parseRunArgs(argv.slice(1))
    if (!args) {
      process.stderr.write(USAGE)
      return 2
    }
    const source = readPipeline(args.file)
    if (source === null) return 2
    if (reportDiagnostics(args.file, source)) {
      process.stderr.write('refusing to run a graph with lint errors\n')
      return 1
    }
    warnOnManagedParams(args.params)

    let worktree: Worktree | undefined
    let cwd = args.cwd
    // The suffix is not decoration. removeWorktree deliberately preserves
    // branches, so a bare basename would mean a second run against the same
    // --run-dir -- an ordinary retry -- collides with the branch the
    // previous run left behind, `git worktree add` fails, and the run dies
    // with an uncaught exception instead of a clean message.
    const runId = `${basename(args.runDir)}-${randomUUID().slice(0, 8)}`

    if (args.worktree) {
      // An explicit request. Honoured regardless of --stub -- an operator
      // who asked for isolation gets it, or an explicit, loud refusal, never
      // a silent downgrade to running in place.
      if (!(await isGitRepo(args.cwd))) {
        process.stderr.write(
          `--worktree requires a git repository; ${args.cwd} is not one\n`,
        )
        return 1
      }
      worktree = await createWorktree(args.cwd, runId)
      cwd = worktree.path
      process.stdout.write(`worktree: ${worktree.path} (branch ${worktree.branch})\n`)
    } else if (!args.stub) {
      // Isolation is the DEFAULT for a real run, not an opt-in. Without
      // this, the documented plain invocation runs an unattended model
      // with bypassPermissions and Bash/Read/Write/Edit directly in the
      // operator's working copy -- exactly what worktree.ts's own module
      // comment says must not happen. --stub never reaches this branch: it
      // never touches --cwd this way, so it needs neither isolation nor a
      // warning.
      if (args.inPlace) {
        process.stderr.write(
          `WARNING: --in-place was passed. This unattended run has bypassed permissions and ` +
            `shell/write access (Bash, Read, Write, Edit by default) directly in ${args.cwd}. ` +
            `Nothing isolates it from your working copy.\n`,
        )
      } else if (await isGitRepo(args.cwd)) {
        worktree = await createWorktree(args.cwd, runId)
        cwd = worktree.path
        process.stdout.write(`worktree: ${worktree.path} (branch ${worktree.branch})\n`)
      } else {
        process.stderr.write(
          `WARNING: ${args.cwd} is not a git repository, so this run cannot be isolated in a ` +
            `worktree. This unattended run has bypassed permissions and shell/write access ` +
            `(Bash, Read, Write, Edit by default) directly in ${args.cwd}.\n`,
        )
      }
    }

    // The try opens IMMEDIATELY after createWorktree, not at engine.run().
    // Engine's constructor builds an EventLog, whose constructor calls
    // mkdirSync -- real I/O that throws on a bad or inaccessible --run-dir.
    // With the guard opening later, that throw leaks the worktree it had
    // already created.
    try {
      const backend = args.stub
        ? new StubBackend({})
        : new ClaudeCodeBackend({
            cwd,
            model: args.model,
            addDir: worktree?.path,
            maxBudgetUsd: args.maxBudgetUsd,
            allowedTools: args.allowedTools ?? ['Bash', 'Read', 'Write', 'Edit'],
          })
      const engine = new Engine({
        graph: parseDot(source),
        context: Context.from(args.params),
        runDir: args.runDir,
        cwd,
        handlers: defaultHandlers(backend),
        runId,
      })
      const result = await engine.run()
      // Loud, because the alternative is silence and silence is the thing the
      // doctrine forbids. Spec section 11.3 decides `status` purely by goal
      // gates, so a run that routed around a node failure and reached the exit
      // IS a conformant success and this must not change the status or the
      // exit code. What it must not be is invisible: before this, the only
      // trace was a `node.end` line in the event log that no operator reads on
      // a green run. Findings I1 and I2 in docs/superpowers/spec-conformance.md
      // are settled -- I1 closed by the eager input check, I2 reclassified to a
      // lint rule -- but I1's protection only arms for keys a node DECLARED via
      // `outputs=`, so a graph that declares none still reaches this line and
      // this warning is still the only thing that speaks on a green run.
      //
      // KNOWN INACCURACY, pre-existing and deliberately not fixed here: the
      // text says "reached its exit", and the condition is only "the run holds
      // an unresolved failure". A run that HALTS -- a FAIL with no matching
      // edge, which is now the ordinary outcome of a blocked input -- never
      // reaches the exit and still prints it. The message is wrong about the
      // shape of the run, not about the failure. Recorded as a residual in
      // docs/superpowers/spec-conformance.md; fixing it is a message change on
      // a path with its own tests and belongs in a change that owns the CLI.
      if (result.unresolvedFailures !== undefined && result.unresolvedFailures.length > 0) {
        process.stderr.write(
          `WARNING: the pipeline reached its exit with unresolved node failures: ` +
            `${result.unresolvedFailures.join(', ')}. Per spec section 11.3 the run status ` +
            `is decided by goal gates alone, so this run reports ${result.status}, but the ` +
            `work of ${result.unresolvedFailures.length === 1 ? 'that node' : 'those nodes'} ` +
            `did not succeed and nothing re-ran it.\n`,
        )
      }
      process.stdout.write(`status: ${result.status}\n`)
      process.stdout.write(`path:   ${result.path.join(' -> ')}\n`)
      if (result.notes) process.stdout.write(`notes:  ${result.notes}\n`)
      process.stdout.write(`run:    ${args.runDir}\n`)
      if (worktree !== undefined) {
        // The branch is the deliverable; say where it is even on failure,
        // because a failed run's partial work is often what gets reviewed.
        process.stdout.write(`work is on branch ${worktree.branch}\n`)
      }
      return result.status === Status.SUCCESS ? 0 : 1
    } finally {
      if (worktree !== undefined) {
        const removal = await removeWorktree(args.cwd, worktree)
        // Surface a cleanup problem rather than leaving a stale worktree
        // behind silently; the run's own exit code is unaffected.
        if (removal.warning !== undefined) process.stderr.write(`${removal.warning}\n`)
      }
    }
  }

  process.stderr.write(USAGE)
  return 2
}

// Only run when invoked directly, so tests can import `main` freely.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      // Without this, anything thrown becomes an unhandled rejection and the
      // operator gets a stack trace with no exit code they can act on.
      process.stderr.write(`attractor: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
