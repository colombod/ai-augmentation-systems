# ADR-014: Ambiguous invocation records are written into every candidate `.delivery/`, including sibling plugins'

Status: accepted · 2026-08-27 · context-management (R-cm-4; gy5.2)

## Context

`record-invocation.js` declines to attribute a governed call when its cwd reaches more
than one `.delivery/` root ("ask, don't guess"). Before gy5.2 the decline wrote nothing —
the 2026-08-10..14 blackout: an entire pipeline unobserved for 14+ days, silence
indistinguishable from idleness. The fix records the call into **every** candidate
ledger, marked `attribution: "ambiguous"` with the candidate list. In this repo that
means delivery-session records land in `plugins/attractor/.delivery/invocations/` — a
tree the repo doctrine (`AGENTS.md`: a plugin owns nothing outside its own directory) and
the initiative's own out-of-scope line would otherwise forbid touching. The challenge
panel found this exception undecided anywhere (R-cm-4).

## Decision

The cross-candidate write is **accepted, narrowly**: the hook may append ambiguous
records to any candidate `.delivery/invocations/` it genuinely cannot choose between.
Rationale: the record must live where the status run that needs it will look, and at
decline time *neither* candidate is known wrong — writing to one would be the guess the
rule forbids; writing to neither is the silence the blackout proved fatal. The write is
bounded: append-only, whitelisted fields, one line per call per candidate, marked so no
reader can mistake it for attributed provenance.

Mitigations shipped with this ADR: `.gitattributes` declares `merge=union` for
`invocations/*.ndjson` (F-13's cheapest real hazard — a cross-clone merge silently
dropping lines); `/delivery:status` names `tool_use_id` as the one identity of a call
across N ledgers (R-cm-7).

## Consequences

- An attractor-side session will see delivery-session ambiguous lines in its tree. They
  are data about a shared ambiguity, not activity claims: its status run must report
  them as `Ambiguously observed`, never `Invoked`.
- `candidates` and `cwd` hold machine-absolute paths — consistent with every existing
  ledger line, meaningless across machines; `gy5.3`'s schema work owns whether that
  changes (F-13 is a named design constraint there).
- If attractor (or any future plugin) adopts its own observation doctrine that conflicts
  with foreign ambiguous lines, this ADR is the decision to revisit.
