import { Context } from '../core/context.ts'
import { substitute } from '../core/substitute.ts'
import { runShell, lastNonEmptyLine } from '../core/shell.ts'
import { type Channel, type ChannelAnswer, type HumanGateContext } from './types.ts'

/**
 * POSIX single-quote escaping: wrap in '...', replace each embedded ' with '\''.
 *
 * ADR-026: diverges deliberately from tool_command's unescaped reuse of the same
 * substitute() engine. tool_command's command is graph-author-written, substituted
 * with same-trust-domain values; CommandChannel's command is operator-supplied, but
 * its values (HumanGateContext.exposedContext) can trace to upstream TOOL/CODERGEN
 * output the operator never reviewed. Quoting each value before splicing closes that
 * gap without touching core/substitute.ts itself.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * The no-code, operator-supplied external-script extension point. `${...}` tokens in
 * `command` are substituted from a flattened HumanGateContext, each value shell-quoted
 * before splicing (ADR-026). cwd is deliberately process.cwd() -- the operator's own
 * invocation directory, not any per-node cwd (HumanGateContext has none) -- "fresh and
 * isolated", mirroring AgentChannel's own framing.
 */
export class CommandChannel implements Channel {
  private readonly command: string

  constructor(command: string) {
    this.command = command
  }

  async answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer> {
    const record: Record<string, string> = {
      nodeId: ctx.nodeId,
      label: ctx.label,
      legal_answers: ctx.legalAnswers.join(','),
      ...ctx.exposedContext,
      agent_instructions: ctx.agentInstructions ?? '',
    }
    const quoted: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) quoted[key] = shellQuote(value)

    const command = substitute(this.command, Context.from(quoted))
    const result = await runShell(command, process.cwd(), timeoutMs ?? 0)

    if (result.code !== 0) return { label: null }
    const label = lastNonEmptyLine(result.stdout)
    return { label: label === '' ? null : label }
  }
}
