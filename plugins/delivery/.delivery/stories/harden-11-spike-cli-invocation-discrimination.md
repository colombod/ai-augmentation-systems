---
id: harden-11
title: "Spike: can a real CLI invocation be safely and precisely tracked in the ledger?"
status: done
epic: harden
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 5 — verification channel generalization (CLI/TUI)"
requirements: [FR-18]
depends_on: []
size: S
---

# Spike: can a real CLI invocation be safely and precisely tracked in the ledger?

> This file is the complete context. Someone opening only this file must be able to finish
> the work without reading the PRD or architecture separately.

## Goal

Answer, for real, whether `FR-18`'s ledger cross-check (a claimed CLI invocation with no
matching ledger entry is recorded not-met — the same discipline `harden-07` applies to
screenshots) can actually be built for `Bash` calls without violating the existing "never
log raw `tool_input`, it can carry secrets" constraint — the gap `/delivery:challenge`'s
review (`R-phase5-1`, all 5 reviewers, independently) found blocking.

## Context

`harden-03` solved the analogous problem for capture tools by using a closed,
low-cardinality JSON-schema field (`action: "screenshot"|"zoom"|...`) already present on
those tools — safe to whitelist because it's a small enum, not free text. `Bash` has no
equivalent: its `tool_input` is `{ command: <free text>, ... }`. This spike investigates
whether a safe substitute exists.

## Attempt 1 — live confirmation, blocked by a real environment constraint

Following `harden-02`'s own methodology, a temporary probe hook
(`hooks/scripts/probe-invocation.js`) was wired to the `Bash` matcher in `hooks.json`, and
synced to the installed plugin cache to pick up mid-session (per `harden-03`'s finding that
plugin-bundled `hooks.json` script changes can hot-apply). **Result: two real `Bash` calls
in the live session did not trigger the probe.** A genuinely fresh `claude -p` subprocess
was then attempted (the technique that worked for `harden-02`'s original spikes) — this
failed with `Failed to authenticate: OAuth session expired and could not be refreshed`, a
real, stated environment blocker, not a code problem. Per this session's own standing rule
against working around denied/blocked actions, this was not retried with elevated
permissions.

**A real, useful negative finding on its own:** a brand-new matcher pattern
(`"Bash"`, not previously present in any `hooks.json` this session ever loaded) does not
appear to hot-apply mid-session, even though a script-content change to an *already-matched*
tool does (`harden-03`'s finding). This refines, not contradicts, that earlier finding —
worth recording since it corrects an implicit overgeneralization.

All spike scaffolding (the temporary `Bash` matcher, the probe's scratch output) was
reverted/removed after this attempt; nothing from it remains in `hooks.json` or the repo.

## Attempt 2 — design analysis, without live payload confirmation

Working from Claude Code's documented hook/tool conventions (the same starting point
`harden-05`'s original ledger design used, before later empirical confirmation) rather than
a live-captured payload:

**Finding: there is no safe, closed-enum field on `Bash` to whitelist, unlike the capture
tools.** Two honest options exist, each with a real, named cost:

1. **Hash the command, log the hash only.** A one-way `SHA-256` of the full command string
   is safe to log — it cannot be reversed to recover a secret. It lets a later reviewer
   confirm "a ledger entry's hash matches the command I'm being told ran" without the
   ledger ever holding the command text. **Cost:** every `Bash` call in a session would need
   governing to make this cross-checkable at all — `Bash` is not naturally low-volume the
   way `Skill`/`Agent` calls are (a normal session runs hundreds of incidental commands:
   `ls`, `git status`, test runs). Blanket governance floods the git-tracked ledger with
   noise unrelated to any acceptance claim, degrading exactly the signal-over-noise property
   the ledger exists to protect (`architecture.md`'s Mechanism 1 rationale).
2. **Log nothing about the command; only that some `Bash` call resolved.** Cheap, no secret
   risk, no noise beyond one line per real command (still volume-heavy, but no free-text or
   hash correlation attempted). **Cost:** cannot discriminate the CLI-under-test invocation
   from any other `Bash` call in the same session — it proves *a* real process boundary was
   crossed somewhere, not *which* one.

**Neither option is a clean win.** Both share the same missing piece `harden-03` had and
this spike doesn't: a safe, narrow, already-existing signal that marks *this specific call*
as the one under acceptance review, the way `action: "screenshot"` already does for capture
tools. No such signal exists for `Bash` today.

## Recommendation (not yet acted on — this is a spike, not a decision)

Ship `FR-18`'s core requirement now, without the ledger cross-check: `harden-09`'s standing
rule (a real process invocation with observed `stdout`/`stderr`/exit code, not an internal
function call) is enforceable today via direct in-turn observation — the reviewer sees the
real tool call in the same conversation and can name it. This is a smaller, honest claim
than `harden-07`'s ledger-backed one, but it is real and buildable immediately. The
ledger-cross-check half of `FR-18` (proving it *after the fact*, for a reviewer who wasn't
there) stays explicitly open, pending either: live payload confirmation once the auth
blocker clears, a product-owner call on whether the blanket-logging noise cost (option 1) is
worth paying, or a new narrow signaling mechanism this project doesn't have yet.

## Acceptance criteria

- [x] A concrete determination exists: no safe, closed-enum discrimination field exists for
  `Bash` today, unlike the capture-tool case — recorded here, not assumed either way.
- [x] The two real design options (hash-and-govern-everything vs. presence-only) are named
  with their actual costs, not glossed over.
- [ ] Live payload confirmation — **blocked**, not done. Real attempt made, real
  environment blocker hit (expired subprocess auth), not retried via a workaround.

## Dependencies

None. `harden-09` depends on this story's outcome for its ledger-cross-check clause only —
its core rule does not.

## Out of scope

- Building either design option — that's a follow-on decision and story, not this spike.
- Retrying live confirmation via an elevated-permission workaround — explicitly against
  this session's own standing rule on denied actions.

## Implementation notes

Real attempt made, real partial result: a live-confirmation attempt was genuinely tried and
genuinely blocked (not skipped), and the design-tradeoff analysis is real, not asserted.
Marked `status: done` because the spike's actual job — produce a concrete, checked answer —
is complete: the answer is "not safely and precisely buildable today without a real,
named tradeoff," which is itself the finding, not a placeholder for one still to come.
