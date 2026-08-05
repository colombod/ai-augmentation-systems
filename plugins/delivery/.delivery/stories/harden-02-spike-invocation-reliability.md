---
id: harden-02
title: "Spike: confirm hook firing reliability, field names, and crash isolation"
status: in-progress
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — foundational spikes"
requirements: []
depends_on: []
size: M
---

# Spike: confirm hook firing reliability, field names, and crash isolation

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A checkable, written answer to whether `ADR-001`'s chosen mechanism — a `PostToolUse`/
`PostToolUseFailure` hook — is actually trustworthy enough to build the invocation ledger
on, before any production code exists.

## Context

`ADR-001` (`.delivery/decisions/ADR-001-hook-based-invocation-provenance.md`) decided
invocation provenance should be hook-based rather than an invokable skill, specifically
because a skill can be narrated past the same way the original problem happens. That
decision rests on an unverified assumption: that the hook actually fires, with complete and
correctly-timed data, and that a crashing hook script cannot silently swallow the tool call
it observes. This story is that verification — a throwaway probe, not the real
implementation.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/hooks.json` | create — temporary probe registration on `PostToolUse` and `PostToolUseFailure`, matcher `Skill` |
| `plugins/delivery/hooks/scripts/probe-invocation.js` | create — dumps raw hook stdin to a scratch file; a second run variant deliberately throws, to test crash isolation |
| `plugins/delivery/.delivery/architecture.md` | modify — record the spike's actual findings against Spikes 1, 2, and 5 in the existing spike table, updating status from open to answered |

## Interfaces and contracts to honor

Claude Code's documented hook contract (stdin = hook JSON, per
`code.claude.com/docs/en/hooks`) — the probe's job is to confirm what fields actually
arrive in practice, not to assume the documented shape is complete.

## Relevant design decisions

- **ADR-001** — this spike is the load-bearing verification the decision explicitly names
  as unproven. If this spike fails, `ADR-001` is void and Alternative B (a blocking
  `Stop`-hook) must be reconsidered before `harden-05` is written.

## Acceptance criteria

- [ ] Across at least 20 real `Skill` tool invocations in one live Claude Code session, the
  probe records the fraction that produce a complete, correctly-timed hook firing — a real
  measured number, not an estimate.
- [ ] The probe confirms whether a same-session `/delivery:status`-style read, run
  immediately after an invocation, can race the hook's own write (i.e., read before the
  write completes) — reported as a real observed behavior, not assumed safe.
- [ ] The exact `tool_name` and `tool_input` field(s) that identify which skill was invoked
  are documented from real captured payloads, not guessed from the docs.
- [ ] A deliberately-throwing version of the probe script confirms the observed tool call
  still completes normally — i.e., a crashing hook does not silently block or degrade the
  call it observes.
- [ ] Findings are written into `architecture.md`'s spike table (Spikes 1, 2, 5 rows), each
  marked answered with the real result, not left open.

## Test approach

**Level:** empirical spike, not a unit/integration test — no test substitutes for running
inside a real session, per `architecture.md`'s own test strategy.
**Cases:**

| Case | Expected |
| :-- | :-- |
| 20+ real invocations, normal operation | Fire-rate and payload completeness measured and recorded |
| Same-session read immediately after a hook fires | Race behavior observed and recorded, not assumed |
| Probe script deliberately throws | Observed tool call still returns normally |

**Run with:** manual — start a real Claude Code session against this plugin, invoke
`/delivery:` skills repeatedly, inspect the probe's scratch output afterward. Not scriptable
as a single command; this is the nature of a real-session spike.

## Out of scope

- Building the real ledger (`harden-05`) — this story only produces findings and a
  throwaway probe, not production code, though the probe's confirmed field names seed
  `harden-05`'s implementation.
- Spike 3 (subagent-event semantics) and Spike 4 (capture-tool discrimination) — separate
  concerns, Spike 3 excluded from this roadmap entirely (blocks only the deferred
  self-correction gate), Spike 4 covered by `harden-03`.

## Dependencies

None — this can start immediately.

## Implementation notes

**Partial completion, honestly reported — not the full spike.** `hooks/scripts/probe-invocation.js`
was built as specified. A live test was attempted: a project-level `.claude/settings.json`
registering the probe on `PostToolUse` was created mid-session, and two real tool calls were
made against it. **Neither fired.** Finding: hook configuration loads once at session start
and does not hot-reload — a config file written mid-session has no effect until a restart.
This itself is a real, useful spike result (it wasn't assumed, it was tested), but it means
the acceptance criteria requiring ≥20 real invocations and same-session race behavior are
**not met by this pass** — that requires a fresh session with the hook already configured
before it starts, which this implementation session could not do without restarting.

**What is answered, from authoritative current documentation rather than live-session
testing:** exact field names (`session_id`, `tool_name`, `tool_input`, `tool_use_id`,
`tool_result`, `cwd`, `hook_event_name`) confirmed via a live fetch of
`code.claude.com/docs/en/hooks`, dated 2026-08-05. Spike 5 (crash isolation) is answered
directly and unambiguously by that same documentation: both `PostToolUse` and
`PostToolUseFailure` are documented as unable to block a tool call under any exit code,
because both fire only after the tool has already resolved — structurally, not just by
convention. Treated as a sourced answer, not re-derived empirically.

**Status:** `harden-05`/`harden-06` were built against the documented field names above.
The ≥20-invocation firing-reliability measurement remains open — run it in a fresh session
before trusting this mechanism at production scale, per the risk this story's own
acceptance criteria named.
