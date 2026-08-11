import { Handler, findByHandler, type Graph } from '../dot/graph.ts'
import { reachableFrom } from '../dot/lint.ts'
import { isChannelViable, whyNotViable, type Channel, type ChannelRunContext } from './types.ts'

export interface GateViabilityDiagnostic {
  node: string
  chain: readonly string[]
  reasons: readonly string[]
}

function parseChain(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return ['human']
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

/**
 * Full static reachability from the graph's start node (reachableFrom, dot/lint.ts,
 * ADR-021), filtered to Handler.HUMAN nodes, each hop of each gate's human.channel
 * chain checked via isChannelViable. Condition-blind by design, same over-
 * approximation every TOPO-family rule already accepts. Not a lint()-time check --
 * viability depends on THIS invocation's runtime attendance, which pure static
 * lint() has no access to.
 */
export function preflightHumanGates(
  graph: Graph,
  channels: ReadonlyMap<string, Channel>,
  runContext: ChannelRunContext,
): GateViabilityDiagnostic[] {
  const starts = findByHandler(graph, Handler.START)
  // TOPO-001 (ERROR) already refuses any graph without exactly one start node, before
  // Engine.run()'s existing lint-refusal block ever lets this function be reached --
  // nothing sound to check here if that invariant somehow doesn't hold.
  if (starts.length !== 1) return []

  const reachable = reachableFrom(graph, starts[0].id)
  const diagnostics: GateViabilityDiagnostic[] = []

  for (const node of findByHandler(graph, Handler.HUMAN)) {
    if (!reachable.has(node.id)) continue

    const chain = parseChain(node.attrs['human.channel'])
    const anyViable = chain.some((name) => isChannelViable(name, runContext))
    if (!anyViable) {
      diagnostics.push({
        node: node.id,
        chain,
        reasons: chain.map((name) => whyNotViable(name, runContext)),
      })
    }
  }

  return diagnostics
}
