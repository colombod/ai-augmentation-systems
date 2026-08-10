import { spawn } from 'node:child_process'
import { type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type Graph, type Node } from '../dot/graph.ts'
import { type Backend } from '../handlers/types.ts'
import { type ArgvOptions, buildArgv, wantsVerdict } from './argv.ts'
import { interpretResult } from './result.ts'
import { ThreadStore } from './threads.ts'

export interface ClaudeBackendOptions extends ArgvOptions {
  /** Overridable so tests can substitute a stand-in without spending money. */
  command?: string
  cwd?: string
  threads?: ThreadStore
}

interface SpawnResult {
  code: number
  stdout: string
  stderr: string
  failure?: string
}

function runProcess(
  command: string,
  argv: string[],
  prompt: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (r: SpawnResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }

    const onAbort = (): void => {
      // `pid` is set synchronously on a successful spawn and never on a
      // failed one (the failure surfaces later, asynchronously, as an
      // 'error' event). On this runtime, calling kill() on a child whose
      // spawn is still in flight -- pid undefined, no OS process actually
      // exists yet -- does not throw and does not return; it hangs the
      // event loop forever. There is nothing to kill in that case, so the
      // 'error' handler above is left to finish the promise once Node
      // delivers the failure.
      if (child.pid !== undefined) child.kill('SIGKILL')
      finish({ code: 1, stdout, stderr, failure: 'aborted' })
    }

    // Listeners are attached BEFORE any abort handling, and there is no early
    // return past this point. Node throws on an 'error' event with no
    // listener, so a spawn failure reaching an unlistened child would take
    // down the whole orchestrator rather than failing one node -- strictly
    // worse than the throw this backend exists to avoid, because the engine
    // cannot even convert it to a RETRY.
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      finish({ code: 1, stdout, stderr, failure: `could not run ${command}: ${String(err)}` })
    })
    child.on('close', (code) => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      finish({ code: code ?? 1, stdout, stderr })
    })

    // A killed child's stdin can EPIPE. The outcome is already decided by
    // then, so swallow it rather than letting it surface as an unhandled
    // stream error.
    child.stdin.on('error', () => {})

    // The prompt goes on stdin. Passing it in argv risks a preceding variadic
    // flag swallowing it, which the CLI reports as "no input provided".
    child.stdin.end(prompt)

    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export class ClaudeCodeBackend implements Backend {
  private opts: ClaudeBackendOptions
  private threads: ThreadStore

  constructor(opts: ClaudeBackendOptions = {}) {
    this.opts = opts
    this.threads = opts.threads ?? new ThreadStore()
  }

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

    if (proc.failure !== undefined) {
      return { status: Status.FAIL, notes: proc.failure }
    }
    if (proc.code !== 0 && proc.stdout.trim() === '') {
      // The CLI itself refused. Its stderr is the only useful information.
      return {
        status: Status.FAIL,
        notes: `claude exited ${proc.code}: ${proc.stderr.trim() || '(no stderr)'}`,
      }
    }

    // wantsVerdict is the SAME function buildArgv called to decide whether
    // to request --json-schema, not a re-derived copy of its condition --
    // that is what keeps the request and the interpretation from drifting
    // apart if the condition ever changes.
    const { outcome, sessionId } = interpretResult(proc.stdout, {
      expectVerdict: wantsVerdict(node),
    })
    if (sessionId !== undefined) this.threads.record(node, sessionId)
    return outcome
  }
}
