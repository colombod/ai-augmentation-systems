/**
 * Named HumanGateContext, not GateContext, to avoid colliding with goal_gate/GATE-002's
 * unrelated "gate" vocabulary -- see .delivery/glossary.md's "human gate" vs "goal gate"
 * entries. The two are never interchangeable.
 */
export interface HumanGateContext {
  nodeId: string
  label: string
  /** Unconditional outgoing edges' label= values ONLY -- see ADR-025. Advisory, not enforced. */
  legalAnswers: readonly string[]
  /** Only keys named by human.context= that are actually present in the running Context. */
  exposedContext: Readonly<Record<string, string>>
  /** human.agent_instructions=, verbatim; consumed only by the agent channel. */
  agentInstructions?: string
}

/** null = no answer this hop; escalate to the next hop in the chain. */
export interface ChannelAnswer {
  label: string | null
}

export interface Channel {
  answer(ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer>
}

/**
 * Facts fixed for the whole run, computed once by the caller -- never re-probed per gate.
 * isInteractive/claudeAvailable are plain booleans, not live-checking functions.
 */
export interface ChannelRunContext {
  isInteractive: boolean
  allowAgentGates: boolean
  claudeAvailable: boolean
  configuredNames: ReadonlySet<string>
}

/**
 * ONE viability predicate, consulted by BOTH preflight (channels/preflight.ts) and
 * HumanGateHandler's own per-hop dispatch loop -- never two independently-maintained
 * copies of "what makes a channel usable this run."
 *
 * Advisory only for the 'agent' branch: AgentChannel (ADR-022) self-enforces its own
 * two-key rule and must not rely on this predicate as its sole enforcement.
 */
export function isChannelViable(name: string, rc: ChannelRunContext): boolean {
  if (name === 'human') return rc.isInteractive
  if (name === 'agent') return rc.allowAgentGates && rc.claudeAvailable
  return rc.configuredNames.has(name)
}

/**
 * Human-readable reason a hop was skipped, shared by preflight's diagnostic text and
 * HumanGateHandler's own node.human.hop_skipped event -- one string generator, not two.
 */
export function whyNotViable(name: string, rc: ChannelRunContext): string {
  if (name === 'human') {
    return 'the "human" channel needs an interactive terminal (stdin is not a TTY this run)'
  }
  if (name === 'agent') {
    if (!rc.allowAgentGates && !rc.claudeAvailable) {
      return 'the "agent" channel needs --allow-agent-gates and a discoverable claude binary; neither is present this run'
    }
    if (!rc.allowAgentGates) {
      return 'the "agent" channel needs the operator to pass --allow-agent-gates; it was not passed this run'
    }
    return 'the "agent" channel needs a discoverable claude binary; none was found this run'
  }
  return `channel "${name}" was not configured for this run (no --channel flag named it)`
}
