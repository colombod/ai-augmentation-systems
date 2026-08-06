/**
 * Context keys the deterministic control plane owns, and which a model must
 * therefore never be able to write.
 *
 * ONE definition, read from both directions. `core/engine.ts` writes every
 * built-in through `setManaged`, which refuses a key this predicate does not
 * cover; `handlers/box.ts` refuses a backend-supplied `contextUpdates` key
 * that it does. So the engine cannot introduce a routing-visible key the
 * guard is unaware of, and the guard cannot reserve a namespace the engine
 * has abandoned -- the desync that a second, hand-kept copy of this list in
 * the guard would eventually produce, and the same reason `wantsVerdict` was
 * extracted into one predicate in `backend/argv.ts`.
 *
 * The bare names are spec section 3.2 step 4 and section 5.1's engine-managed
 * keys. The prefixes are namespaces owned by the deterministic layer:
 * `tool.` by ToolHandler (the original guard, which this generalises),
 * `graph.` by the graph attributes the engine mirrors, and `internal.` by
 * section 5.1's `internal.retry_count.<node_id>` -- reserved before it is
 * implemented, deliberately, because a namespace is cheaper to hold than to
 * reclaim.
 *
 * Two things are NOT reserved, on purpose:
 *
 * - `last_stage` and `last_response`. Section 5.1 attributes both to
 *   *handlers*, not the engine, so a handler writing them is conformant.
 * - Bare graph attribute names (`goal`, not `graph.goal`). Those live in the
 *   author's own namespace, which a node may legitimately update; reserving
 *   every attribute a graph happens to declare would make the general
 *   "a node can write context" feature depend on the graph's header.
 */
export const ENGINE_MANAGED_KEYS: readonly string[] = ['outcome', 'preferred_label', 'current_node']

export const ENGINE_MANAGED_PREFIXES: readonly string[] = ['tool.', 'graph.', 'internal.']

export function isEngineManagedKey(key: string): boolean {
  return ENGINE_MANAGED_KEYS.includes(key) || ENGINE_MANAGED_PREFIXES.some((p) => key.startsWith(p))
}

export class Context {
  private data: Map<string, string>

  /**
   * Keys written since the last `takeWritten()`.
   *
   * The engine's failed-output ledger has to know which keys were ACTUALLY
   * PRODUCED, so it can stop reporting a key as unavailable once some node has
   * written it. Three cheaper-looking answers are all wrong, and each is wrong
   * in a way that matters:
   *
   * - A node's `effectiveOutputs`. That is a CONTRACT, not evidence: a node
   *   can succeed while writing only part of what it declared. Clearing on the
   *   declaration marks keys available that nobody produced -- the dataflow
   *   plan's own failure mode, inverted.
   * - The presence of a value. The stale-label doctrine deliberately leaves a
   *   failed tool node's PREVIOUS `tool.last_line` in place, so a value being
   *   present is not evidence that this run produced it.
   * - A before/after diff of `snapshot()`. Silently wrong when a node rewrites
   *   a key with the value it already held -- two tool nodes that both end
   *   `printf ok` -- which reintroduces exactly the false halt this exists to
   *   remove.
   * - The Outcome's `contextUpdates`. This one is a SECURITY property, not a
   *   preference: `handlers/box.ts` merges only the ALLOWED updates into
   *   context but returns the RAW map on its Outcome, so a model answering
   *   `contextUpdates: {'tool.last_line': 'green'}` -- rejected by the
   *   engine-managed guard and never written -- would forge a ledger clear.
   *   That is the forgery Plan 3 demonstrated with `{current_node: 'start'}`.
   *   Filtering by `isEngineManagedKey` in the engine does not rescue it
   *   either: that would drop `ToolHandler`'s entirely legitimate
   *   `tool.last_line` write, which is the very key the bug was about.
   *
   * Recording the write where the write happens is the only answer that is
   * true by construction for every handler, present and future, and it cannot
   * be forged because a key that never reached `data` never reaches here.
   *
   * Values seeded through the constructor (`--param`, a resumed checkpoint)
   * are deliberately NOT recorded: they are inputs to the run, not something a
   * node produced.
   */
  private written: Set<string> = new Set()

  constructor(initial: Record<string, string> = {}) {
    this.data = new Map(Object.entries(initial))
  }

  static from(obj: Record<string, string>): Context {
    return new Context(obj)
  }

  get(key: string): string | undefined {
    return this.data.get(key)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  set(key: string, value: string): void {
    this.data.set(key, value)
    this.written.add(key)
  }

  merge(updates: Record<string, string>): void {
    for (const [k, v] of Object.entries(updates)) {
      this.data.set(k, String(v))
      this.written.add(k)
    }
  }

  /**
   * The keys written since the last call, and reset. Drained rather than read
   * so a caller cannot see one node's writes attributed to the next: the
   * engine drains before dispatching a node and reads immediately after, so
   * what it gets back is that node's writes and nothing else.
   */
  takeWritten(): string[] {
    const keys = [...this.written]
    this.written.clear()
    return keys
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.data)
  }

  clone(): Context {
    return new Context(this.snapshot())
  }
}
