import { isConditional } from '../core/edge-select.ts'
import { parseDuration } from '../core/duration.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { substitute } from '../core/substitute.ts'
import { outgoingEdges } from '../dot/graph.ts'
import {
  isChannelViable,
  type Channel,
  type ChannelRunContext,
  type HumanGateContext,
} from '../channels/types.ts'
import { type Handler, type HandlerCtx } from './types.ts'

/**
 * ADR-025: unconditional outgoing edges' label= values ONLY -- matches selectEdge's
 * actual step-2 scope, NOT HITL-001's own (laxer) enumeration. See ADR-025 for why
 * the two are not the same set.
 */
function legalAnswers(ctx: HandlerCtx): readonly string[] {
  return outgoingEdges(ctx.graph, ctx.node.id)
    .filter((e) => !isConditional(e))
    .map((e) => e.attrs.label)
    .filter((label): label is string => label !== undefined)
}

/**
 * human.context= is a comma-separated list of context KEY NAMES (same convention
 * HITL-003 already established) -- include a key only if it's actually present in
 * the running Context, never the full running context.
 */
function exposedContext(ctx: HandlerCtx): Record<string, string> {
  const raw = ctx.node.attrs['human.context']
  if (raw === undefined || raw.trim() === '') return {}
  const result: Record<string, string> = {}
  for (const key of raw.split(',').map((t) => t.trim()).filter((t) => t !== '')) {
    if (ctx.context.has(key)) result[key] = ctx.context.get(key) as string
  }
  return result
}

function buildGateContext(ctx: HandlerCtx): HumanGateContext {
  const attrs = ctx.node.attrs
  const rawLabel = attrs['human.prompt'] || attrs['human.label'] || attrs.prompt || attrs.label || ctx.node.id
  // Matches SUBSTITUTABLE_ATTRS[Handler.HUMAN] (dot/graph.ts) -- the same fallback
  // chain substitutableText() reads, so DATA-001's eager-input-check statically
  // predicts exactly what this handler substitutes at runtime, not just a claim.
  const label = substitute(rawLabel, ctx.context)
  return {
    nodeId: ctx.node.id,
    label,
    legalAnswers: legalAnswers(ctx),
    exposedContext: exposedContext(ctx),
    agentInstructions: attrs['human.agent_instructions'],
  }
}

function parseChain(ctx: HandlerCtx): string[] {
  const raw = ctx.node.attrs['human.channel']
  if (raw === undefined || raw.trim() === '') return ['human']
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

/**
 * human.channel_timeout: comma-separated durations (parseDuration), position-matched
 * one-to-one against the chain; shorter than the chain repeats the last value; longer
 * has its extras ignored; a single bare value applies to every hop; entirely absent
 * means every hop gets null (no timeout -- waits on it exactly as today).
 */
function parseHopTimeouts(ctx: HandlerCtx, chainLength: number): Array<number | null> {
  const raw = ctx.node.attrs['human.channel_timeout']
  if (raw === undefined || raw.trim() === '') {
    return new Array<number | null>(chainLength).fill(null)
  }
  const values = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => parseDuration(t))
  const result: Array<number | null> = []
  for (let i = 0; i < chainLength; i++) {
    const value = values[i] ?? values[values.length - 1]
    result.push(value)
  }
  return result
}

/**
 * The leaf handler for Handler.HUMAN -- architecturally identical to BoxHandler/
 * ToolHandler (dispatch, call out, return one Outcome; no ctx.runBranch, no fan-out).
 * Walks the configured channel chain in order via the shared isChannelViable
 * predicate, short-circuits on the first non-null answer, falls through to
 * on_timeout/human.default_choice (unchanged HITL-001 doctrine) or FAILs once the
 * chain is exhausted. Never returns RETRY/PARTIAL. Writes no context beyond the
 * generic outcome/preferred_label every dispatch already gets.
 */
export class HumanGateHandler implements Handler {
  private readonly channels: ReadonlyMap<string, Channel>
  private readonly runContext: ChannelRunContext

  constructor(channels: ReadonlyMap<string, Channel>, runContext: ChannelRunContext) {
    this.channels = channels
    this.runContext = runContext
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    const gateContext = buildGateContext(ctx)
    const chain = parseChain(ctx)
    const timeouts = parseHopTimeouts(ctx, chain.length)

    for (let i = 0; i < chain.length; i++) {
      const hopName = chain[i]
      const hopTimeoutMs = timeouts[i]

      if (!isChannelViable(hopName, this.runContext)) {
        ctx.events.append({ type: 'node.human.hop_skipped', node: ctx.node.id, channel: hopName })
        continue
      }

      const channel = this.channels.get(hopName)
      if (channel === undefined) {
        ctx.events.append({ type: 'node.human.hop_skipped', node: ctx.node.id, channel: hopName })
        continue
      }

      try {
        const answer = await channel.answer(gateContext, hopTimeoutMs)
        if (answer.label !== null) {
          return { status: Status.SUCCESS, preferredLabel: answer.label }
        }
        ctx.events.append({ type: 'node.human.hop_timeout', node: ctx.node.id, channel: hopName })
      } catch (err) {
        ctx.events.append({
          type: 'node.human.hop_error',
          node: ctx.node.id,
          channel: hopName,
          message: String(err instanceof Error ? err.message : err),
        })
      }
    }

    const onTimeout = ctx.node.attrs.on_timeout
    const defaultChoice = ctx.node.attrs['human.default_choice']
    if (onTimeout !== undefined && onTimeout !== '') {
      return { status: Status.SUCCESS, preferredLabel: onTimeout }
    }
    if (defaultChoice !== undefined && defaultChoice !== '') {
      return { status: Status.SUCCESS, preferredLabel: defaultChoice }
    }

    const reason = `human gate ${ctx.node.id} exhausted its channel chain (${chain.join(', ')}) with no on_timeout/human.default_choice fallback declared`
    return { status: Status.FAIL, notes: reason, failureReason: reason }
  }
}
