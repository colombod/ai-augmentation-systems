/**
 * Parse a `timeout`-style duration attribute: a bare integer (seconds) or an
 * integer suffixed with `ms`, `s`, `m` or `h`. Returns milliseconds, or `0`
 * -- meaning "no timeout" -- for anything absent or unparseable.
 *
 * Shared by `ToolHandler` (shell node timeouts) and `BoxHandler` (`claude`
 * subprocess timeouts) so both node kinds parse the same attribute the same
 * way. It lived only in `tool.ts` until BoxHandler needed to bound a hung
 * `claude -p`; duplicating the regex there would have let the two node
 * kinds' interpretation of `timeout="5m"` drift apart.
 */
export function parseDuration(value: string | undefined): number {
  if (!value) return 0
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(value.trim())
  if (!m) return 0
  const n = Number.parseInt(m[1], 10)
  const unit = m[2] ?? 's'
  const factors: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return n * factors[unit]
}
