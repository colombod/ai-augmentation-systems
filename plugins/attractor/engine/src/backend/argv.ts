import { type Node } from '../dot/graph.ts'

export interface ArgvOptions {
  model?: string
  addDir?: string
  sessionId?: string
  resumeId?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  appendSystemPrompt?: string
}

/**
 * The structured verdict demanded of a goal-gate node.
 *
 * `preferred_label` is required, which is the whole point: a gate that
 * returns prose cannot satisfy the fail-closed check in BoxHandler, so
 * forcing the field at the source turns a soft convention into a schema
 * violation the CLI itself rejects.
 */
export const OUTCOME_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['success', 'fail', 'retry'] },
    preferred_label: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['status', 'preferred_label', 'notes'],
  additionalProperties: false,
} as const

/**
 * Does this node's outcome need to be a structured verdict?
 *
 * The one place this question is answered. `buildArgv` uses it to decide
 * whether to request `--json-schema`, `claude.ts` uses it to decide whether
 * to interpret the reply as a verdict, and `box.ts` uses it to decide
 * whether the fail-closed gate check applies. Two or three hand-kept copies
 * of the same condition can desync when the condition changes; one exported
 * predicate cannot.
 */
export function wantsVerdict(node: Node): boolean {
  return node.attrs.goal_gate === 'true'
}

/**
 * The prefix every non-interactive `claude -p` invocation in this engine needs, extracted
 * so `channels/agent.ts`'s hand-assembled argv (it deliberately does not call `buildArgv` --
 * see ADR-022) can share it rather than duplicating the literal flags. `--permission-mode
 * bypassPermissions` in particular must never go stale in one of the two places that need
 * it: without it, a non-interactive spawn can sit waiting for a permission grant nobody can
 * give, reintroducing ADR-002's silent-hang risk through a second, less-tested code path.
 */
export const NON_INTERACTIVE_SAFETY_ARGV: readonly string[] = [
  '-p',
  '--output-format',
  'json',
  '--permission-mode',
  'bypassPermissions',
]

/**
 * Build the argument list for `claude`.
 *
 * The prompt is deliberately NOT here. Several of these flags are variadic,
 * and a variadic flag immediately before a positional prompt consumes the
 * prompt as another value -- the CLI then exits 1 complaining that no input
 * was provided. Feeding the prompt on stdin removes the entire class.
 */
export function buildArgv(node: Node, opts: ArgvOptions): string[] {
  const argv: string[] = [...NON_INTERACTIVE_SAFETY_ARGV]

  const model = node.attrs.llm_model ?? opts.model
  if (model !== undefined) argv.push('--model', model)

  if (opts.addDir !== undefined) argv.push('--add-dir', opts.addDir)

  // Resuming an existing conversation and pinning a fresh id are mutually
  // exclusive; resuming wins because continuity is the stronger intent.
  if (opts.resumeId !== undefined) argv.push('--resume', opts.resumeId)
  else if (opts.sessionId !== undefined) argv.push('--session-id', opts.sessionId)

  if (opts.maxBudgetUsd !== undefined) argv.push('--max-budget-usd', String(opts.maxBudgetUsd))

  if (opts.allowedTools !== undefined && opts.allowedTools.length > 0) {
    // Comma-separated, never space-separated: a space makes the following
    // argument look like another tool name.
    argv.push('--allowedTools', opts.allowedTools.join(','))
  }

  if (opts.appendSystemPrompt !== undefined) {
    argv.push('--append-system-prompt', opts.appendSystemPrompt)
  }

  if (wantsVerdict(node)) {
    argv.push('--json-schema', JSON.stringify(OUTCOME_SCHEMA))
  }

  return argv
}
