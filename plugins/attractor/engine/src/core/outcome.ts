export const Status = {
  SUCCESS: 'success',
  PARTIAL: 'partial_success',
  RETRY: 'retry',
  FAIL: 'fail',
  SKIPPED: 'skipped',
} as const

export type Status = (typeof Status)[keyof typeof Status]

export interface Outcome {
  status: Status
  preferredLabel?: string
  suggestedNextIds?: string[]
  contextUpdates?: Record<string, string>
  notes?: string
  /**
   * Spec section 5.2: "`failure_reason : String -- reason for failure (when
   * status is FAIL or RETRY)`".
   *
   * ADDED BESIDE `notes`, not instead of it, and the distinction is the whole
   * point. `notes` is the human-readable execution summary for ANY status --
   * a SUCCESS puts its remark there too -- so a consumer reading `notes` could
   * never tell a reason from a remark. Every existing writer and reader of
   * `notes` is untouched; engine-authored failures now populate both, with
   * `notes` keeping the fuller sentence and `failure_reason` the bare cause.
   */
  failureReason?: string
  /** Spend and turn counts a Backend recorded for this dispatch. Unused today. */
  metrics?: Record<string, number>
}

export function isTerminalFailure(o: Outcome): boolean {
  return o.status === Status.FAIL
}
