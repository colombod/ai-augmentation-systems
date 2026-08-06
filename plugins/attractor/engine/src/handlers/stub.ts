import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type Backend } from './types.ts'

/**
 * Deterministic backend for tests and for `--dry-run`. Scripted by node id;
 * a node mapped to an array returns each entry in turn, so a test can drive a
 * convergence loop through failure and then success.
 */
export class StubBackend implements Backend {
  private script: Record<string, Outcome | Outcome[]>
  private cursor: Map<string, number> = new Map()
  private log: Array<{ nodeId: string; prompt: string }> = []

  constructor(script: Record<string, Outcome | Outcome[]> = {}) {
    this.script = script
  }

  async run(node: Node, prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    this.log.push({ nodeId: node.id, prompt })
    const entry = this.script[node.id]
    if (entry === undefined) {
      return { status: Status.SUCCESS, notes: `stub: no script for ${node.id}` }
    }
    if (!Array.isArray(entry)) return entry
    const i = this.cursor.get(node.id) ?? 0
    this.cursor.set(node.id, Math.min(i + 1, entry.length - 1))
    return entry[Math.min(i, entry.length - 1)]
  }

  calls(): Array<{ nodeId: string; prompt: string }> {
    return this.log
  }
}
