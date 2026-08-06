import { Status, type Outcome } from '../core/outcome.ts'

export interface ClaudeResult {
  is_error?: boolean
  result?: unknown
  session_id?: string
  total_cost_usd?: number
  num_turns?: number
  usage?: Record<string, unknown>
  permission_denials?: unknown[]
  subtype?: string
}

const STATUS_BY_NAME: Record<string, Status> = {
  success: Status.SUCCESS,
  partial_success: Status.PARTIAL,
  retry: Status.RETRY,
  fail: Status.FAIL,
}

interface Verdict {
  status?: unknown
  preferred_label?: unknown
  notes?: unknown
}

/** `result` is a JSON string; a structured verdict is JSON nested inside it. */
function parseVerdict(result: unknown): Verdict | null {
  if (typeof result !== 'string') return null
  const trimmed = result.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Verdict
  } catch {
    return null
  }
}

export interface InterpretResultOptions {
  /**
   * Only a node that asked for the structured-verdict schema (`argv.ts`
   * requests `--json-schema` exactly when `node.attrs.goal_gate === 'true'`)
   * may have its `result` string read as a verdict. Without this gate, an
   * ordinary work node that happens to answer with a JSON object -- a status
   * report, a summary payload -- gets misread as a routing verdict by
   * accident of formatting: an unrecognised `status` value maps to FAIL
   * despite `is_error: false`, and the node's real output is discarded
   * because `verdict.notes` is not the field the model was asked to fill.
   * `claude.ts` passes the SAME condition `argv.ts` used to request the
   * schema, so the request and the interpretation cannot drift apart.
   */
  expectVerdict?: boolean
}

/**
 * Turn a `claude -p --output-format json` payload into an Outcome.
 *
 * Success is decided by `is_error` alone. `stop_reason` is deliberately
 * ignored: it reads "tool_use" even on a fully successful run, so routing on
 * it would fail every node that used a tool.
 *
 * Prose deliberately produces NO preferredLabel and NO contextUpdates. That
 * is what lets BoxHandler's fail-closed check downgrade a goal gate that
 * answered in prose -- the emptiness IS the signal.
 */
export function interpretResult(
  rawText: string,
  opts: InterpretResultOptions = {},
): { outcome: Outcome; sessionId?: string } {
  let parsed: ClaudeResult
  try {
    const value = JSON.parse(rawText) as unknown
    // Array.isArray is not redundant: `typeof [] === 'object'`, so without it
    // a top-level array slips through, every field reads undefined, and the
    // function reports SUCCESS with empty notes -- fail-open in the one
    // place that must fail closed.
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object')
    }
    parsed = value as ClaudeResult
  } catch {
    return {
      outcome: {
        status: Status.FAIL,
        notes: `could not parse claude output: ${rawText.slice(0, 200)}`,
      },
    }
  }

  const metrics: Record<string, number> = {}
  if (typeof parsed.total_cost_usd === 'number') metrics.costUsd = parsed.total_cost_usd
  if (typeof parsed.num_turns === 'number') metrics.turns = parsed.num_turns

  const denials = parsed.permission_denials ?? []
  const denialNote =
    denials.length > 0 ? ` (${denials.length} permission denial(s): ${JSON.stringify(denials)})` : ''

  // parseVerdict is only consulted when the caller actually requested the
  // schema. Otherwise a work node's JSON-shaped prose (a status report, a
  // summary payload) would be read as a routing verdict by accident of
  // formatting rather than by request.
  const verdict = opts.expectVerdict === true ? parseVerdict(parsed.result) : null
  if (verdict !== null && typeof verdict.status === 'string') {
    const status = STATUS_BY_NAME[verdict.status] ?? Status.FAIL
    const notesText = `${typeof verdict.notes === 'string' ? verdict.notes : ''}${denialNote}`
    return {
      outcome: {
        status: parsed.is_error === true ? Status.FAIL : status,
        preferredLabel:
          typeof verdict.preferred_label === 'string' ? verdict.preferred_label : undefined,
        notes: notesText === '' ? undefined : notesText,
        metrics,
      },
      sessionId: parsed.session_id,
    }
  }

  const text = typeof parsed.result === 'string' ? parsed.result : ''
  const notes = `${text}${denialNote}`
  return {
    outcome: {
      status: parsed.is_error === true ? Status.FAIL : Status.SUCCESS,
      notes: notes === '' ? undefined : notes,
      metrics,
    },
    sessionId: parsed.session_id,
  }
}
