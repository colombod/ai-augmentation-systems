# Sprint 0c: restore the ledger observer, so shipped work can be verified

Declared 2026-11-23, before work starts. Closed round. Source: the owner's
requirement for verified shipping, done receipts and a ledger, and the finding
that Sprint 0a's removal of all hooks left the `status` skill unable to confirm
that any artifact was really produced by a skill or agent call (it reported
every document of a real run as "Not-invoked").

Customer: the owner, and anyone who needs "done" to mean verified.

## Deliverables

| ID | Done when |
| --- | --- |
| D0c.1 | `hooks/hooks.json` registers exactly the three entries that run `hooks/scripts/record-invocation.js` (PostToolUse on Write, Edit and NotebookEdit; PostToolUse on Skill, Agent and the two capture tools; PostToolUseFailure on Skill, Agent, Write, Edit, NotebookEdit and the two capture tools), with the same arguments, timeouts and async flags they had before Sprint 0a. No other hook is registered. |
| D0c.2 | The recorder is an observer and cannot gate: for every input tried (an empty stdin, invalid JSON, a Skill event, a Write event, a failure event, an unwritable project directory), it exits 0 and prints nothing that is a decision (no `decision`, `permissionDecision` or `block`). With `DELIVERY_LEDGER` unset it writes nothing anywhere. Tests assert these in both directions: nothing written when off, a ledger line written when on. |
| D0c.3 | The existing test that asserts `hooks.json` is empty is replaced by a test that asserts the registered hooks are exactly the recorder's three entries, on observer events only, and that nothing at user level is installed (the installer-name test stays). |
| D0c.4 | The sealed suite passes and CI is green. Version 0.44.1 in `plugin.json` and the one marketplace entry. |

## Bounds

Time: 2 hours. Review rounds: 1 independent review, 1 fix round. Attention: 0
decision requests. Model tiers: implementation and review on Sonnet (workers).

## Why this is strictly necessary, and why it is safe

It is the determination half of ADR-001 (`record-invocation.js` header): the
`status` skill uses it so it never has to trust an agent's narration, and so a
claimed screenshot can be checked against a real capture. Without it, verified
shipping cannot be shown. It never denies, never blocks the stop path, fails
open, writes only into the project's own `.delivery/invocations/`, and writes
nothing unless the owner sets `DELIVERY_LEDGER=1`.

## Out of scope

Every other hook (lane, leak, setup, send, ask, route-check, operator capture,
the Stop gate); deleting any runtime code; skills; the README.

## Evidence the owner will see

Rerun the plugin's own `status` report on a real initiative before and after:
the five documents of the plugin-uninstall dogfood move from "Not-invoked" to
recorded, when the ledger is on.
