---
id: harden-05
title: Record real skill invocations to a durable, per-session ledger
status: in-progress
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 2 — invocation ledger"
requirements: [FR-1, FR-2, FR-3]
depends_on: [harden-02]
size: M
---

# Record real skill invocations to a durable, per-session ledger

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

A real record exists of which pipeline skills actually ran in a session — written by
something the orchestrating agent cannot narrate around, because the harness itself
triggers it, not the agent's own text.

## Context

`ADR-001` decided this must be hook-based, not an invokable skill: an invokable check has
the same narration-without-invocation hole as the thing it's meant to catch. `harden-02`'s
spike confirmed (or, if it failed, this story does not proceed as specified — see
Dependencies) that a `PostToolUse`/`PostToolUseFailure` hook fires reliably enough to trust,
and documented the real field names to use.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/hooks.json` | create (finalize from `harden-02`'s probe registration) — real matcher list for `Skill`/`Agent` tool calls, using `harden-02`'s confirmed field names |
| `plugins/delivery/hooks/scripts/record-invocation.js` | create — Node script (no new dependency; Node is already required by Claude Code), reads hook stdin, resolves the nearest `.delivery/` by upward directory walk (no-ops if none found), extracts a whitelisted field set only, appends one JSON line to the session's ledger file |
| `plugins/delivery/hooks/scripts/record-invocation.test.js` | create — unit tests using Node's built-in test runner (`node:test`), no new dependency |
| `.delivery/invocations/<session_id>.ndjson` | create (at runtime, in whatever project uses this plugin — not a file in this repo) — one file per session, git-tracked with the project |
| `plugins/delivery/README.md` | modify — the "Everything is markdown" line is no longer true once this ships; update it to name the hook as the one exception |

## Interfaces and contracts to honor

```json
// One JSON line per event, appended to .delivery/invocations/<session_id>.ndjson
{"ts":"2026-08-05T14:32:10Z","session_id":"...","hook_event":"PostToolUse",
 "tool_name":"Skill","invoked_name":"delivery:prd","outcome":"success",
 "cwd":"...","delivery_root":".delivery"}
```

Whitelisted fields only — **never** raw `tool_input`. This is binding, not an
implementation detail: raw `tool_input` on other tool types can carry file contents or
secrets, and this ledger is git-tracked.

`record-invocation.js` exit code is always `0` — this hook only logs; per `harden-02`'s
crash-isolation finding, it must never block or degrade the call it observes. Concretely:
the script's entire body runs inside a top-level `try`/`catch`, and the `catch` branch exits
`0` regardless of what went wrong — this is a defensive guarantee the script itself makes,
not a reliance on Claude Code's own non-blocking behavior for a non-zero hook exit (which is
a separate, harness-level property `harden-02` verifies, not a substitute for this one).

## Relevant design decisions

- **ADR-001** — the reason this is a hook, not a skill. Directly governs this story's shape.
- Ledger location (`.delivery/invocations/`, git-tracked, not `${CLAUDE_PLUGIN_DATA}`) is
  required by `NFR-5` (retention tied to the annotated artifact's own lifetime, which only
  holds if the record travels with the repo).

## Acceptance criteria

- [ ] `FR-1` — every real `Skill`/`Agent` tool call that resolves (success or failure)
  produces one ledger line with a whitelisted field set.
- [ ] `FR-2` — a call that appears in the hook's own event stream but errors mid-run is
  recorded with `outcome: "error"` — distinguishable from a completed success.
- [ ] `FR-3` — replaying the real attractor-orchestration incident shape (assistant text
  claims a phase ran; no matching hook event occurred) produces zero matching ledger lines
  for that phase — i.e., the absence is real, not papered over.
- [ ] A retried invocation (same skill called twice after an error) produces two distinct
  ledger lines, not one overwritten line — the most recent real invocation is what later
  reporting (`harden-06`) treats as of record.
- [ ] No raw `tool_input` field ever appears in a ledger line — verified by inspecting
  actual output against the whitelist.
- [ ] A crashing/throwing `record-invocation.js` (per `harden-02`'s confirmed crash-isolation
  behavior) does not prevent the observed tool call from completing normally.

## Test approach

**Level:** unit tests for the script's own logic (field whitelisting, NDJSON formatting,
`.delivery/` resolution); the reliability claim itself is **not** re-tested here — it was
already established empirically in `harden-02` and is out of scope for unit coverage,
per `architecture.md`'s own test strategy (a unit test confirming the script parses JSON is
not the same claim as confirming it fires inside a real session).
**Cases:**

| Case | Expected |
| :-- | :-- |
| Canned `PostToolUse` payload, success | One correctly-whitelisted ledger line appended |
| Canned `PostToolUseFailure` payload | One ledger line with `outcome: "error"` |
| No `.delivery/` reachable from cwd | Script no-ops, exits `0`, writes nothing |
| Payload contains a large `tool_input` blob | Ledger line contains none of it — whitelist enforced |
| Internal logic throws (e.g. malformed hook payload) | Caught by the top-level `try`/`catch`; script exits `0` regardless — never propagates as a non-zero exit |

**Run with:** `node --test plugins/delivery/hooks/scripts/record-invocation.test.js`

## Out of scope

- Reporting the ledger into a human-readable form — that is `harden-06`.
- Blocking or gating anything based on the ledger's contents — recording only; blocking is
  the deferred self-correction gate (Stage 2), explicitly out of this MVP.

## Dependencies

- `harden-02` must be `done` first — this story implements against real confirmed field
  names and matcher behavior, not assumed ones. If `harden-02`'s spike came back
  unfavorable (hooks unreliable), this story does not proceed as specified; return to
  `ADR-001`'s Alternatives section instead.

## Implementation notes

**Live-verified, for real, in a genuinely fresh session — update to the earlier note
below.** After the first partial pass (unit tests only), a real end-to-end test was run:
a project-level hook was registered *before* launching fresh, real, non-interactive
`claude -p` sessions (the precondition that failed mid-session earlier) against this
actual repository. **Result: this surfaced a real bug, not a hook-registration problem.**
The first live run completed successfully (`delivery:status` genuinely ran via the Skill
tool) but produced no ledger entry. Root cause, confirmed by direct testing: `.delivery/`
in this repo lives at `plugins/delivery/.delivery/` — a *subdirectory* relative to the
session's actual working directory (the repo root) — and the original `findDeliveryRoot`
only walked *upward*. It could never find a `.delivery/` below cwd, which is exactly this
repo's real, live layout. Unit tests never caught it because every fixture placed
`.delivery/` at or above the test's starting directory, matching the implementation's own
(wrong) assumption rather than testing against it.

**Fixed:** `findDeliveryRoot` now tries the upward walk first (cheap, unambiguous), then
falls back to a bounded-depth (4 levels) downward search, skipping `node_modules`/`.git`/
build directories, declining (returning `null`, same as "nothing governed here") if more
than one `.delivery/` is found downward — a script can't "ask, don't guess" the way the
skill-level resolution algorithm does, so it stays conservative instead of picking one.
5 new unit tests cover this (marketplace-subdirectory case, ambiguous-multiple case,
node_modules-skipped case, depth-limit case, upward-wins-when-both-exist case) — 20/20
passing.

**Then re-verified live, for real, 21 times total, across two rounds:** with the fix in
place, fresh headless sessions each genuinely invoking the Skill tool for
`delivery:status` — 5 in the first round (verifying the fix), 16 more in a second round
run specifically to close the sample-size gap this note originally flagged. **All 21
produced a correct ledger entry** (real session IDs, real `tool_use_id`s, correct
`invoked_name`, `outcome: "success"`) — a 21-for-21 real fire rate, now past the story's
original ≥20-invocation target. Run times ranged 7 seconds to ~116 seconds (one instance
did more work than instructed before stopping; still logged correctly). This is real,
live, harness-triggered evidence across 21 independent process launches, not a synthetic
payload asserting the shape docs say to expect.

**One thing this pass did not confirm:** the `PostToolUseFailure` / `outcome: "error"`
path. A deliberately-invalid skill name (`delivery:this-skill-does-not-exist-xyz`) was
used to try to trigger it — the call errored as expected, but produced **no ledger entry
at all**, for either outcome. Reading the result: an invalid skill name appears to be
rejected before a real tool call is ever dispatched, so no `PostToolUse`/`PostToolUseFailure`
event fires for that specific failure mode — it's a different kind of failure than "the
tool ran and then failed," which is what `FR-2`'s mid-run-error case actually describes.
Confirming the true mid-run-error path needs a skill that starts running and then fails
partway (e.g. a real permission or runtime error), which this pass didn't attempt further,
for cost reasons — flagged as the one real remaining gap, not silently assumed to work.

All test/scratch artifacts (ledger files, the temporary project-level `.claude/settings.json`
used only for this test, `/tmp` output files) were removed after verification. Nothing from
this testing process is left in the repo except the fix itself and this record of what was
actually run.
