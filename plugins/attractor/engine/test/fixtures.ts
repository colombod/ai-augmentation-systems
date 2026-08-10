// Shared fixtures used by more than one test file. Deliberately not named
// *.test.ts -- node --test's default discovery would otherwise treat it as
// its own test file (harmless, since it registers no tests, but avoid the
// ambiguity) -- and more importantly, this lets it be imported without
// re-executing another file's top-level test() registrations.

import { type Context } from '../src/core/context.ts'
import { type Graph, type Node } from '../src/dot/graph.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { type Backend } from '../src/handlers/types.ts'

// Lints as an ERROR (TOPO-004: `orphan` is unreachable) but would otherwise
// execute cleanly: start -> a -> done, exit 0. That gap is what makes a test
// using this fixture discriminate: a fresh graph that fails for an unrelated
// structural reason (e.g. missing start node) would pass even with the lint
// gate deleted.
export const LINT_FAILS_BUT_WOULD_RUN = `
digraph LR {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  orphan [shape=box, prompt="never reached"]
  start -> a -> done
}
`

/**
 * A `Backend` whose `run()` never resolves on its own -- it blocks on an
 * internal per-node gate until the test explicitly `release()`s or
 * `reject()`s that node id. `StubBackend` resolves on the next microtask,
 * which cannot force two branches to genuinely overlap; this can, and is
 * what every Phase 5 concurrency test (this file, and later `engine.test.ts`/
 * `parallel.test.ts`) is built on. Do not duplicate this class elsewhere --
 * import it from here.
 */
export class GatedBackend implements Backend {
  inFlight = 0
  maxObserved = 0
  private gates = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  async run(node: Node): Promise<Outcome> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    try {
      await new Promise<void>((resolve, reject) => {
        this.gates.set(node.id, { resolve, reject })
      })
    } finally {
      this.inFlight--
    }
    return { status: Status.SUCCESS }
  }

  /** Test drives interleaving: let a specific gated node's run() resolve. */
  release(nodeId: string): void {
    this.gates.get(nodeId)?.resolve()
  }

  /** Rejects instead of resolving -- for later stories' branch-throws tests. */
  reject(nodeId: string, err: Error): void {
    this.gates.get(nodeId)?.reject(err)
  }
}
