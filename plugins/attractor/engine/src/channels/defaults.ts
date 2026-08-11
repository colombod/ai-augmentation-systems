import { AgentChannel, type AgentChannelOptions } from './agent.ts'
import { HumanChannel } from './human.ts'
import { type Channel } from './types.ts'

export interface DefaultChannelsOptions {
  /**
   * Same pair a sibling ChannelRunContext for this run must also carry. This is the
   * one place AgentChannel's self-enforced `allowed` and isChannelViable's advisory
   * 'agent' check are derived together, from the SAME two booleans, at construction
   * time -- not asserted equal separately. Each caller (defaultHandlers()'s own
   * default, cli.ts's explicit construction) is responsible for passing the same
   * pair into both this function and its own ChannelRunContext; that is a narrow,
   * named, accepted duplication (see architecture.md's FR-5-8 Risks table), not
   * something this function can eliminate on its own across two separate call sites.
   */
  allowAgentGates?: boolean
  claudeAvailable?: boolean
  agent?: Omit<AgentChannelOptions, 'allowed'>
}

/**
 * Seeds the two built-in channels, "human" and "agent". CommandChannels are layered
 * on top by cli.ts (p2-09) for each --channel name=command -- never constructed here.
 */
export function defaultChannels(opts: DefaultChannelsOptions = {}): Map<string, Channel> {
  const allowed = (opts.allowAgentGates ?? false) && (opts.claudeAvailable ?? false)
  return new Map<string, Channel>([
    ['human', new HumanChannel()],
    ['agent', new AgentChannel({ ...opts.agent, allowed })],
  ])
}
