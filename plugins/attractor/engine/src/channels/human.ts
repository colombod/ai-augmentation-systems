import { type Channel, type ChannelAnswer, type HumanGateContext } from './types.ts'

/**
 * Realizes ADR-002's TTY-check block-vs-fail-fast decision. Viability (is stdin a real
 * TTY) is isChannelViable's job, checked by the caller BEFORE answer() is ever invoked --
 * this interface has no isInteractive check anywhere in it, deliberately (ADR-023).
 */
export interface HumanGateWait {
  block(signal: AbortSignal): Promise<void>
}

/**
 * resume() + heartbeat, per ADR-002. Resolves ONLY when `signal` aborts -- if the signal
 * never aborts (timeoutMs: null, the default "waits on it exactly as today" case), this
 * never resolves, matching a real, present person's session lasting as long as it lasts.
 */
export class StdinHumanGateWait implements HumanGateWait {
  block(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.resume()
      // Heartbeat: keeps this promise's own timer bookkeeping alive without doing
      // anything observable -- matches ADR-002's "resume() + heartbeat" description.
      const heartbeat = setInterval(() => {}, 60_000)
      const onAbort = (): void => {
        clearInterval(heartbeat)
        resolve()
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/**
 * ADR-023: this channel has NO code path in this build that ever resolves with a real,
 * human-typed answer. It blocks via `wait`, bounded only by an optional timeoutMs; on
 * timeout it resolves {label: null} (escalate). With timeoutMs: null it never resolves
 * at all, for as long as `wait.block()` itself doesn't. Building real stdin-answer
 * parsing is out of scope this slice -- see ADR-023's Alternatives considered.
 */
export class HumanChannel implements Channel {
  private readonly wait: HumanGateWait

  constructor(wait: HumanGateWait = new StdinHumanGateWait()) {
    this.wait = wait
  }

  async answer(_ctx: HumanGateContext, timeoutMs: number | null): Promise<ChannelAnswer> {
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs !== null) {
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }
    await this.wait.block(controller.signal)
    if (timer) clearTimeout(timer)
    return { label: null }
  }
}
