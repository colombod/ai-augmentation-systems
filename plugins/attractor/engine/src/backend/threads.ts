import { type Node } from '../dot/graph.ts'

/**
 * A node participates in a continued conversation only when it names a
 * thread AND asks for full fidelity. Every other mode starts fresh, which is
 * the conservative default: sharing a conversation by accident is far worse
 * than losing context that a prompt can restate.
 */
export function isFullFidelity(node: Node): boolean {
  return node.attrs.fidelity === 'full' && typeof node.attrs.thread_id === 'string'
}

export class ThreadStore {
  private sessions: Map<string, string>

  constructor(initial: Map<string, string> = new Map()) {
    this.sessions = new Map(initial)
  }

  resumeIdFor(node: Node): string | undefined {
    if (!isFullFidelity(node)) return undefined
    return this.sessions.get(node.attrs.thread_id as string)
  }

  record(node: Node, sessionId: string): void {
    if (!isFullFidelity(node)) return
    this.sessions.set(node.attrs.thread_id as string, sessionId)
  }

  /**
   * Branch-local copy. Parallel branches that shared a store would resume the
   * same conversation and interleave their turns, so a clone must not write
   * back to its parent.
   */
  clone(): ThreadStore {
    return new ThreadStore(this.sessions)
  }
}
