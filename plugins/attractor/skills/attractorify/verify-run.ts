#!/usr/bin/env node
// The delegated execution-verification harness (FR-13, ADR-017).
//
// A fresh-context subagent -- launched via the Task tool by the authoring
// session, with no memory of why the graph looks the way it does -- runs
// this and reports its exact stdout verbatim. That subagent's isolation is
// what makes this "verification": AGENTS.md's own rule ("verification
// inside the context that produced the evidence is not verification"),
// applied to the graph's actual execution rather than only to the decision
// to build it (attractorify's Step 1 diagnosis-verifier covers that
// separate claim -- see SKILL.md, Step 3 item 7).
//
// Usage (delegation instruction the authoring session gives the subagent):
//   node verify-run.ts <graph-path> [--run-dir <dir>] [--cwd <dir>] [--stub | --live]
//                       [--allow-agent-gates] [--channel name=command]...
// --cwd matters for any graph using a `component` (PARALLEL) node: branch
// worktree isolation needs a real git repository, and this harness's own
// default cwd (the OS temp dir) is not one.
// --channel/--allow-agent-gates matter for any graph using a `hexagon`
// (Handler.HUMAN) node: without them, every human gate's channel chain is
// unconditionally non-viable under this harness's own default
// ChannelRunContext (non-interactive, no agent-gate opt-in, no named
// channels), and preflight refuses the graph before anything dispatches --
// found by actually trying to verify 08-human-gate.dot through this harness,
// the same way p6-07 found the --cwd gap.
// Default: --stub. Prints exactly two lines on success:
//   VERIFIED: status=<RunResult.status> path=<comma-joined final node path>
//   events: <run-dir>/events.jsonl
// A lint-ERROR graph is refused before any run is attempted (mirrors FR-11's
// existing embedder guarantee) -- the lint diagnostics are printed instead.
//
// Imports the library entry point (engine/src/index.ts, p6-01/ADR-016)
// rather than shelling out to the CLI and parsing its prose stdout.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Engine,
  defaultHandlers,
  Context,
  lint,
  hasErrors,
  parseDot,
  StubBackend,
  ClaudeCodeBackend,
  defaultChannels,
  CommandChannel,
  type Channel,
  type ChannelRunContext,
} from '../../engine/src/index.ts'

export interface VerifyRunOptions {
  runDir?: string
  cwd?: string
  /** Defaults to true -- --stub is the "ready" bar (ADR-017); --live is opt-in. */
  stub?: boolean
  /** Mirrors cli.ts's --allow-agent-gates. Default false. */
  allowAgentGates?: boolean
  /** Mirrors cli.ts's --channel name=command, pre-parsed. Default {}. */
  channelCommands?: Record<string, string>
}

export interface VerifyRunResult {
  /** Did the HARNESS succeed at verifying (lint passed, the engine ran to a
   *  terminal RunResult)? A graph that correctly reaches FAIL is a
   *  successful verification of a graph that fails -- harnessOk is about
   *  whether verification itself completed, not the graph's own outcome. */
  harnessOk: boolean
  /** The exact text a caller should treat as the verification transcript. */
  output: string
}

export async function verifyRun(graphPath: string, opts: VerifyRunOptions = {}): Promise<VerifyRunResult> {
  const src = readFileSync(graphPath, 'utf8')
  const graph = parseDot(src)

  const diagnostics = lint(graph)
  if (hasErrors(diagnostics)) {
    const lines = diagnostics.map((d) => `${d.severity} ${d.code} ${d.node ?? ''}: ${d.message}`)
    return {
      harnessOk: false,
      output: `LINT REFUSED: this graph carries ERROR-severity diagnostics and was not run.\n${lines.join('\n')}`,
    }
  }

  const runDir = opts.runDir ?? mkdtempSync(join(tmpdir(), 'attractor-verify-run-'))
  const cwd = opts.cwd ?? tmpdir()
  const stub = opts.stub ?? true

  // claudeAvailable is deliberately hardcoded false, not probed -- this harness has no
  // doctor.ts import today, and --stub (the "ready" bar, ADR-017) never needs the agent
  // channel anyway. A graph relying on --allow-agent-gates gets an honest, named
  // limitation (agent stays non-viable here even with the flag set), not a silent gap.
  const channels: Map<string, Channel> = defaultChannels({
    allowAgentGates: opts.allowAgentGates ?? false,
    claudeAvailable: false,
  })
  for (const [name, command] of Object.entries(opts.channelCommands ?? {})) {
    channels.set(name, new CommandChannel(command))
  }
  const channelRunContext: ChannelRunContext = {
    isInteractive: Boolean(process.stdin.isTTY),
    allowAgentGates: opts.allowAgentGates ?? false,
    claudeAvailable: false,
    configuredNames: new Set(channels.keys()),
  }

  const engine = new Engine({
    graph,
    context: Context.from({}),
    runDir,
    cwd,
    handlers: defaultHandlers(stub ? new StubBackend() : new ClaudeCodeBackend(), channels, channelRunContext),
    channels,
    channelRunContext,
  })
  const result = await engine.run()

  // The engine itself already appended every event during engine.run() --
  // EventLog's constructor is used here only to know the exact file path
  // it wrote to (FILE = 'events.jsonl'), not to write anything new.
  const eventsPath = join(runDir, 'events.jsonl')

  return {
    harnessOk: true,
    output: `VERIFIED: status=${result.status} path=${result.path.join(',')}\nevents: ${eventsPath}`,
  }
}

export async function cliMain(argv: string[]): Promise<number> {
  const [graphPath, ...rest] = argv
  if (!graphPath) {
    console.error(
      'usage: verify-run.ts <graph-path> [--run-dir <dir>] [--cwd <dir>] [--stub | --live] ' +
        '[--allow-agent-gates] [--channel name=command]...',
    )
    return 2
  }
  let runDir: string | undefined
  let cwd: string | undefined
  let stub = true
  let allowAgentGates = false
  const channelCommands: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--run-dir') {
      runDir = rest[++i]
    } else if (rest[i] === '--cwd') {
      cwd = rest[++i]
    } else if (rest[i] === '--stub') {
      stub = true
    } else if (rest[i] === '--live') {
      stub = false
    } else if (rest[i] === '--allow-agent-gates') {
      allowAgentGates = true
    } else if (rest[i] === '--channel') {
      const pair = rest[++i] ?? ''
      const eq = pair.indexOf('=')
      if (eq > 0) channelCommands[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  const result = await verifyRun(graphPath, { runDir, cwd, stub, allowAgentGates, channelCommands })
  console.log(result.output)
  return result.harnessOk ? 0 : 1
}

if (import.meta.main) {
  cliMain(process.argv.slice(2)).then((code) => process.exit(code))
}
