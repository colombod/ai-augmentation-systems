# ADR-003: The chief-of-staff decision log gets its own store, not the invocation ledger

**Status:** proposed
**Date:** 2026-08-07
**Deciders:** solution-architect, with product-owner sign-off pending

## Context

`prd.md`'s Open Question 7 asks whether `FR-23`/`FR-36`–`39`/`FR-55`'s decision log reuses
`harden`'s invocation ledger or needs its own store. The ledger's real, shipped schema
(`harden-05`, `.delivery/invocations/<session_id>.ndjson`) is:

```json
{"ts":"...","session_id":"...","hook_event":"PostToolUse","tool_name":"Skill",
 "invoked_name":"delivery:prd","outcome":"success","cwd":"...","delivery_root":".delivery"}
```

Every field is mechanically whitelisted from a hook payload — `ADR-001` makes this binding:
"never raw `tool_input`," because the ledger is git-tracked and a raw field on other tool
types can carry file contents or secrets. The ledger is a **tool-call-event** record,
produced only when `PostToolUse`/`PostToolUseFailure` fires on a call that just resolved.

The glossary's own minimum content for the decision log — "a category distinguishing entry
types, the specific answer/citable traceback involved, and a timestamp" — is a
**triage-outcome** record: free-form judgment content (an excerpted answer, a diverging-output
description for S-11), written whenever someone — a different agent, the operator, a later
self-correction check — identifies a past chief-of-staff answer or flag was wrong. No hook
fires on "noticed wrong three turns later"; there is no tool-call resolution to hang it on.

## Decision

The decision log is a new, separate append-only NDJSON store,
`.delivery/chief-of-staff/decision-log/<session_id>.ndjson` — one file per session, git-tracked,
the same **storage pattern** `harden-05` already proved (per-session files make concurrent
writes a non-issue by construction) but a distinct file, distinct schema, and a distinct write
trigger (an agent or skill recording a judgment, never a hook). It never shares a file or a
schema with `.delivery/invocations/`.

## Alternatives considered

### A — Extend the invocation ledger's schema with optional chief-of-staff fields

**Why it was attractive:** one store, one reader; `/delivery:status` already knows how to walk
`.delivery/invocations/`.
**Why rejected:** breaks `ADR-001`'s binding whitelist the moment a free-text citable-traceback
excerpt enters a record whose entire point was "never raw content, only whitelisted fields."
The two records come from fundamentally different mechanisms — a hook observing a resolved
tool call, versus an agent recording a judgment with no tool-call resolution to trigger it.
Conflating them either smuggles semantic content through a channel built to exclude it, or asks
the hook-only ledger to serve writes no hook event corresponds to.

### B — A single project-wide decision-log file, not per-session

**Why it was attractive:** simpler to query "every decision-log entry ever" in one read;
matches the whole-effort lifetime some chief-of-staff artifacts (`mission.md`) actually need.
**Why rejected:** the ledger's per-session-file design was chosen specifically so concurrent
writes are a non-issue by construction (`architecture.md`, harden epic). A single file shared
across sessions reintroduces exactly the write-contention risk that design avoided, for no
benefit — `/delivery:status`-style aggregation already reads every ledger file for a project
in one pass; the same approach reads every decision-log file the same way.

## Consequences

**We gain:** schema honesty — the decision log carries the semantic content `FR-23`/`FR-36`–39/
`FR-55` actually require without diluting the ledger's binding whitelist guarantee, and with
zero change to `hooks/hooks.json` or `hooks/scripts/record-invocation.js`; this decision touches
neither.

**We accept:** a second store `/delivery:status` must learn to read. A real naming-collision
risk, stated explicitly: `.delivery/decisions/` already holds ADR files (`ADR-001`, this one,
`ADR-002`); the decision log lives at `.delivery/chief-of-staff/decision-log/`, nested and
distinctly named so the two are never confused by an implementer skimming the tree.

**We will need to revisit this if:** S-10's Stage-2 pattern-detection needs query patterns
(count real logged outcomes of one category, most-recent-first, across many sessions) that flat
per-session NDJSON files cannot serve at real volume — at which point a lightweight index or
consolidated read path is added on top, not a schema merge with the invocation ledger.
