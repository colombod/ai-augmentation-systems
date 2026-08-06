import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RunEvent {
  ts?: string
  type: string
  node?: string
  [key: string]: unknown
}

const FILE = 'events.jsonl'

/** Append-only run history. Every view over a run derives from this file. */
export class EventLog {
  private path: string

  constructor(runDir: string) {
    mkdirSync(runDir, { recursive: true })
    this.path = join(runDir, FILE)
  }

  append(event: RunEvent): void {
    const stamped: RunEvent = { ts: new Date().toISOString(), ...event }
    appendFileSync(this.path, `${JSON.stringify(stamped)}\n`, 'utf8')
  }

  /**
   * Read the log back.
   *
   * A crash during an append can leave a truncated final line. That line is
   * non-empty, so it survives the blank-line filter and would throw from
   * JSON.parse -- making the WHOLE log unreadable in exactly the situation
   * the log exists to survive. An append-only file can only be damaged at
   * its end, so an unparseable line ends the read and everything before it
   * is still returned.
   */
  all(): RunEvent[] {
    if (!existsSync(this.path)) return []
    const events: RunEvent[] = []
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        events.push(JSON.parse(line) as RunEvent)
      } catch {
        break
      }
    }
    return events
  }
}
